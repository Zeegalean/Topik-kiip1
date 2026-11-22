import dns from 'dns';
import fs from 'fs';
import crypto from 'crypto';
import { execSync } from 'child_process';
import express from 'express';
import dotenv from 'dotenv';
import nodemailer from 'nodemailer';
import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();
dns.setDefaultResultOrder('ipv4first');

function getCliArg(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  if (idx !== -1 && idx + 1 < process.argv.length && !process.argv[idx + 1].startsWith('-')) {
    return process.argv[idx + 1];
  }
  const prefix = `${flag}=`;
  const eqArg = process.argv.find((arg) => arg.startsWith(prefix));
  return eqArg ? eqArg.slice(prefix.length) : undefined;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const cliPort = getCliArg('--port') || getCliArg('-p');
const cliHost = getCliArg('--host');
const port = parseInt(cliPort || process.env.PORT || '3000', 10);
const host = cliHost || process.env.HOST || '0.0.0.0';

// Enable CORS for public OCR/static endpoints; never allow wildcard CORS on authenticated /api/admin/* routes
app.use((req, res, next) => {
  const isAdminRoute = req.path.startsWith('/api/admin');
  if (!isAdminRoute) {
    res.setHeader('Access-Control-Allow-Origin', '*');
  } else {
    const origin = req.headers.origin;
    const hostHeader = req.headers['x-forwarded-host'] || req.headers.host;
    if (origin && hostHeader) {
      try {
        const originHost = new URL(origin).host;
        if (originHost === String(hostHeader).split(',')[0].trim()) {
          res.setHeader('Access-Control-Allow-Origin', origin);
          res.setHeader('Vary', 'Origin');
        }
      } catch {
        // Ignore invalid origin
      }
    }
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }
  next();
});

// 1. Direct Source Code ZIP download (for GitHub manual upload / backup / offline development)
app.get(['/api/download-source-zip', '/download-source-zip', '/kiip-source-code.zip', '/api/download-pc-package', '/download-pc-package', '/kiip-topik-pc-package.zip'], (req, res) => {
  try {
    const zipPath = '/tmp/kiip-portal-source-code.zip';
    
    // Create clean source zip using Python's built-in zipfile (excludes heavy/temporary files)
    const pythonScript = `
import zipfile, os
base_dir = os.path.abspath('.')
zip_path = '/tmp/kiip-portal-source-code.zip'
excluded_dirs = {'node_modules', 'dist', '.git', '__pycache__', '.aistudio'}
excluded_files = {'kiip-portal-source-code.zip', 'kiip-topik-pc-package.zip'}
with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as z:
    for root, dirs, files in os.walk(base_dir):
        dirs[:] = [d for d in dirs if d not in excluded_dirs and not d.startswith('.git')]
        for file in files:
            if file in excluded_files or file.endswith('.pyc') or file.endswith('.traineddata'):
                continue
            full_path = os.path.join(root, file)
            rel_path = os.path.relpath(full_path, base_dir)
            z.write(full_path, rel_path)
`;
    execSync(`python3 -c "${pythonScript.replace(/"/g, '\\"')}"`);
    if (fs.existsSync(zipPath)) {
      const stats = fs.statSync(zipPath);
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', 'attachment; filename="kiip-portal-source-code.zip"');
      res.setHeader('Content-Length', stats.size.toString());
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      const stream = fs.createReadStream(zipPath);
      return stream.pipe(res);
    }
    return res.status(500).send('ZIP file creation failed');
  } catch (err: any) {
    return res.status(500).send('Error generating ZIP: ' + err.message);
  }
});

app.use(express.static(path.resolve('public')));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Server-side Gemini client using attached environment key (lazy-initialized)
let aiClient: GoogleGenAI | null = null;
function getAiClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;
  if (!aiClient) {
    aiClient = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
  }
  return aiClient;
}

function formatGeminiError(err: any): string {
  const msg = typeof err?.message === 'string' ? err.message : JSON.stringify(err || '');
  const causeCode = err?.cause?.code ? ` (${err.cause.code})` : '';
  const causeMsg =
    typeof err?.cause?.message === 'string' && !msg.includes(err.cause.message)
      ? `: ${err.cause.message}`
      : '';
  return `${msg}${causeCode}${causeMsg}`;
}

// Helper function to check if an error is transient (503, 429, or transient network drops)
function isTransientError(err: any): boolean {
  const msg = formatGeminiError(err).toLowerCase();
  return (
    msg.includes('503') ||
    msg.includes('unavailable') ||
    msg.includes('high demand') ||
    msg.includes('429') ||
    msg.includes('resource_exhausted') ||
    msg.includes('quota') ||
    msg.includes('overloaded') ||
    msg.includes('try again later') ||
    msg.includes('temporarily') ||
    msg.includes('fetch failed') ||
    msg.includes('econnreset') ||
    msg.includes('etimedout') ||
    msg.includes('eai_again') ||
    msg.includes('und_err_') ||
    msg.includes('socket') ||
    msg.includes('network')
  );
}

function isAuthOrKeyError(err: any): boolean {
  const msg = formatGeminiError(err).toUpperCase();
  return (
    msg.includes('PERMISSION_DENIED') ||
    msg.includes('API_KEY_INVALID') ||
    msg.includes('API KEY NOT VALID') ||
    msg.includes('UNAUTHENTICATED')
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Helper to sanitize extracted OCR data from any source (ONLY cleans present fields, never injects fake defaults)
function sanitizeExtractedData(raw: any): Record<string, any> {
  const result: Record<string, any> = {};

  // 1. Doc Verification Number: must be array of 4 groups of 4 digits
  if (raw?.docVerificationNo) {
    if (Array.isArray(raw.docVerificationNo)) {
      const flat = raw.docVerificationNo.map(String).join('').replace(/[^0-9]/g, '');
      if (flat.length >= 16 && flat !== '0000000000000000') {
        result.docVerificationNo = [
          flat.slice(0, 4),
          flat.slice(4, 8),
          flat.slice(8, 12),
          flat.slice(12, 16),
        ];
      }
    } else if (typeof raw.docVerificationNo === 'string') {
      const digits = raw.docVerificationNo.replace(/[^0-9]/g, '');
      if (digits.length >= 16 && digits !== '0000000000000000') {
        result.docVerificationNo = [
          digits.slice(0, 4),
          digits.slice(4, 8),
          digits.slice(8, 12),
          digits.slice(12, 16),
        ];
      }
    }
  }

  // 2. Alien Registration Numbers: 6 digits & 7 digits
  let r1 = String(raw?.regNumber1 || '').replace(/[^0-9]/g, '');
  let r2 = String(raw?.regNumber2 || '').replace(/[^0-9]/g, '');
  if (r1.length >= 13 && !r2) {
    r2 = r1.slice(6, 13);
    r1 = r1.slice(0, 6);
  } else if (r1.length > 6) {
    if (!r2) r2 = r1.slice(6);
    r1 = r1.slice(0, 6);
  }
  if (r2.length >= 13) r2 = r2.slice(6, 13);
  else if (r2.length > 7) r2 = r2.slice(0, 7);
  if (r1.length === 6 && r1 !== '000000') {
    result.regNumber1 = r1;
  }
  if (r2.length === 7 && r2 !== '0000000') {
    result.regNumber2 = r2;
    const firstDigit = r2.charAt(0);
    result.gender = ['2', '4', '6', '8', '0'].includes(firstDigit) ? '여' : '남';
  } else if (raw?.gender === '남' || raw?.gender === '여') {
    result.gender = raw.gender;
  }

  // 3. Visa status
  const rawVisa = String(raw?.visaStatus || '').trim();
  if (rawVisa) {
    const visaMatch =
      rawVisa.match(/\b([A-Z]-\d{1,2}(?:-[0-9A-Z]{1,3})?)\b/i) ||
      rawVisa.match(/([A-Z]-\d{1,2}(?:-[0-9A-Z]{1,3})?)/i) ||
      rawVisa.match(/([A-Z]\d{1,2}(?:-[0-9A-Z]{1,3})?)/i);
    if (visaMatch) {
      result.visaStatus = visaMatch[1].toUpperCase();
    } else if (rawVisa.length <= 8 && /^[A-Z0-9-]+$/i.test(rawVisa)) {
      result.visaStatus = rawVisa.toUpperCase();
    }
  }

  // 4. Exam Number (preserve extracted digits)
  if (raw?.examNumber) {
    const rawExam = String(raw.examNumber).replace(/[^0-9]/g, '');
    if (rawExam.length >= 6 && !/^0+$/.test(rawExam)) {
      result.examNumber = rawExam;
    }
  }

  // 5. Round (preserve extracted number)
  if (raw?.round) {
    const rawRound = String(raw.round).replace(/[^0-9]/g, '');
    if (rawRound && !/^0+$/.test(rawRound)) {
      result.round = rawRound;
    }
  }

  // 6. Grade
  if (raw?.grade) {
    const gradeMatch = String(raw.grade).match(/([1-6])\s*급?/);
    if (gradeMatch) {
      result.grade = `${gradeMatch[1]}급`;
    }
  }

  // 7. Name (strip labels, nationality names, and clipped country suffixes like IA from CAMBODIA)
  if (raw?.name) {
    const nameNoise = new Set([
      'IA', 'DIA', 'ODIA', 'BODIA', 'MBODIA', 'AMBODIA', 'CAMBOD', 'CAMBODIA', 'CAMBODIAN',
      'KHM', 'VNM', 'NPL', 'UZB', 'MMR', 'THA', 'IDN', 'PHL', 'CHN', 'MNG', 'LKA', 'BGD', 'PAK',
      'VIETNAM', 'NEPAL', 'UZBEKISTAN', 'MYANMAR', 'THAILAND', 'INDONESIA', 'PHILIPPINES',
      'CHINA', 'MONGOLIA', 'BANGLADESH', 'PAKISTAN', 'KOREA', 'REPUBLIC', 'KINGDOM',
      'NAME', 'ENGLISH', 'IN', 'SEX', 'MALE', 'FEMALE', 'COUNTRY', 'REGION', 'NATIONALITY',
      'SURNAME', 'GIVEN', 'NAMES', 'CARD', 'RESIDENCE', 'ALIEN', 'REGISTRATION', 'PASSPORT',
      'STATUS', 'OF', 'THE',
    ]);
    const cleanedTokens = String(raw.name)
      .replace(/(?:성명|영문성명|Name\s*in\s*English|Name|NAME|Surname|Given\s*Names?)\s*[:：]?\s*/gi, ' ')
      .replace(/[^a-zA-Z\s가-힣]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toUpperCase()
      .split(' ')
      .filter((t) => t.length > 0 && !nameNoise.has(t));
    const cleanedName = cleanedTokens.join(' ').trim();
    if (cleanedName.length >= 2 && cleanedName !== '0000 0000') {
      result.name = cleanedName;
      result.applicantName = cleanedName;
    }
  }

  // 8. Nationality & Address & Dates
  if (raw?.nationality && String(raw.nationality).trim().length >= 2) {
    result.nationality = String(raw.nationality).trim();
  }
  if (raw?.address && String(raw.address).trim().length >= 5 && !String(raw.address).startsWith('00000')) {
    result.address = String(raw.address).trim();
  }
  if (raw?.examDate && !String(raw.examDate).startsWith('0000')) {
    const dm = String(raw.examDate).match(/(\d{4})[.\-\s년/]+(\d{1,2})[.\-\s월/]+(\d{1,2})/);
    if (dm) result.examDate = `${dm[1]}-${dm[2].padStart(2, '0')}-${dm[3].padStart(2, '0')}`;
  }
  if (raw?.validUntil && !String(raw.validUntil).startsWith('0000')) {
    const vm = String(raw.validUntil).match(/(\d{4})[.\-\s년/]+(\d{1,2})[.\-\s월/]+(\d{1,2})/);
    if (vm) result.validUntil = `${vm[1]}-${vm[2].padStart(2, '0')}-${vm[3].padStart(2, '0')}`;
  }

  // 9. Passport Number (여권번호 / លេខលិខិតឆ្លងដែន)
  if (raw?.passportNo) {
    const rawPass = String(raw.passportNo).replace(/[^A-Za-z0-9]/g, '').toUpperCase().trim();
    if (rawPass.length >= 6) {
      result.passportNo = rawPass;
    }
  }

  // 10. Passport Expiry Date (여권 유효기간 / ថ្ងៃខែផុតកំណត់)
  if (raw?.passportExpiry) {
    const rawExp = String(raw.passportExpiry).trim();
    const dateMatch = rawExp.match(/(\d{4})[.\-\s년/]+(\d{1,2})[.\-\s월/]+(\d{1,2})/);
    if (dateMatch) {
      result.passportExpiry = `${dateMatch[1]}-${dateMatch[2].padStart(2, "0")}-${dateMatch[3].padStart(2, "0")}`;
    } else if (rawExp && !rawExp.startsWith('0000')) {
      result.passportExpiry = rawExp;
    }
  }

  return result;
}

// Helper to parse Korean residence addresses from ARC back table, prioritizing the latest 신고일 (Report Date)
function extractLatestAddressWithReportDate(textCorpus: string): string | null {
  const datePattern = /(\d{4})[.\-\s년/]+(\d{1,2})[.\-\s월/]+(\d{1,2})/;
  const koreanAddrPattern = /([가-힣]+(?:특별시|광역시|특별자치시|도|시|군|구)[가-힣0-9\s\-~,()./]+)/g;

  // Split into lines or SVG tag blocks
  const lines = textCorpus.split(/[\r\n<>]+/);
  
  interface AddrEntry {
    dateStr: string;
    timestamp: number;
    address: string;
    lineIndex: number;
  }

  const entries: AddrEntry[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const addrMatches = line.match(koreanAddrPattern);
    if (!addrMatches) continue;

    for (const rawAddr of addrMatches) {
      const cleanAddr = rawAddr.trim();
      if (cleanAddr.length < 5) continue;
      // Skip boilerplate notice phrases
      if (cleanAddr.includes('시·군·구청') || cleanAddr.includes('출입국·외국인관서') || cleanAddr.includes('새로운 체류지')) continue;
      if (cleanAddr === '체류지' || cleanAddr === '체류지 변경사항' || cleanAddr === '체류지 (Address)') continue;

      // Look for a date (신고일자) near this address (same line or up to 4 lines before/after in SVG/HTML)
      let foundDate: { str: string; ts: number } | null = null;
      for (let offset = -4; offset <= 4; offset++) {
        const checkIdx = i + offset;
        if (checkIdx >= 0 && checkIdx < lines.length) {
          const dMatch = lines[checkIdx].match(datePattern);
          if (dMatch) {
            const y = parseInt(dMatch[1], 10);
            const m = parseInt(dMatch[2], 10);
            const d = parseInt(dMatch[3], 10);
            if (y >= 2000 && y <= 2035 && m >= 1 && m <= 12 && d >= 1 && d <= 31) {
              const dateStr = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
              const ts = new Date(y, m - 1, d).getTime();
              foundDate = { str: dateStr, ts };
              break;
            }
          }
        }
      }

      entries.push({
        dateStr: foundDate ? foundDate.str : '',
        timestamp: foundDate ? foundDate.ts : 0,
        address: cleanAddr,
        lineIndex: i,
      });
    }
  }

  if (entries.length === 0) {
    const globalMatch = textCorpus.match(/([가-힣]+(?:특별시|광역시|특별자치시|도|시|군|구)[가-힣0-9\s\-~,()]+)/);
    return globalMatch ? globalMatch[1].trim() : null;
  }

  // Filter out any invalid addresses
  const valid = entries.filter(e => 
    !e.address.includes('출입국') && 
    !e.address.includes('시·군·구') && 
    e.address.length >= 6
  );

  const pool = valid.length > 0 ? valid : entries;

  // If we found dates (신고일), sort by timestamp descending (LATEST 신고일 first!)
  const withDates = pool.filter(e => e.timestamp > 0);
  if (withDates.length > 0) {
    withDates.sort((a, b) => b.timestamp - a.timestamp);
    console.log(`[OCR Parser] Selected latest address based on 신고일 (${withDates[0].dateStr}): ${withDates[0].address}`);
    return withDates[0].address;
  }

  // If no explicit dates found, take the LAST entry (bottom-most row of the card)
  console.log(`[OCR Parser] Selected bottom-most address from card back: ${pool[pool.length - 1].address}`);
  return pool[pool.length - 1].address;
}

// Fallback structural parser for SVG / text representations (e.g. sample cards or SVG uploads)
function extractFromSvgOrText(textCorpus: string): Record<string, any> {
  const result: Record<string, any> = {};

  // Alien Registration Card pattern: 950910-5760023 or 950910 5760023
  const regMatch = textCorpus.match(/(\d{6})\s*[-–]\s*(\d{7})/);
  if (regMatch) {
    result.regNumber1 = regMatch[1];
    result.regNumber2 = regMatch[2];
  }

  // Name: Look for name pattern
  const nameMatch =
    textCorpus.match(/(?:성명|Name|NAME)[^\w\n<]*([A-Z\s]{3,30})(?=[<\n"&]|$)/) ||
    textCorpus.match(/>([A-Z]{2,15}\s+[A-Z]{2,15})</);
  if (nameMatch) {
    result.name = nameMatch[1].trim().toUpperCase();
  }

  // Nationality
  const natMatch =
    textCorpus.match(/(?:국가|Country|Nationality)[^\w\n<]*([A-Za-z]+)/i) ||
    textCorpus.match(/(CAMBODIA|VIETNAM|UZBEKISTAN|NEPAL|CHINA|PHILIPPINES|INDONESIA|MYANMAR|THAILAND)/i);
  if (natMatch) {
    result.nationality = natMatch[1].trim();
  }

  // Visa status: E-9-1, E-7-4, etc.
  const visaMatch =
    textCorpus.match(/(?:체류자격|Status)[^\w\n<]*([A-Z0-9-]+)/i) ||
    textCorpus.match(/(E-9-1|E-7-4|E-9|D-2-1|D-2|F-2-R|F-2)/i);
  if (visaMatch) {
    result.visaStatus = visaMatch[1].trim();
  }

  // Address: parse latest address from 체류지 변경사항 based on 신고일 (Report Date)
  const latestAddr = extractLatestAddressWithReportDate(textCorpus);
  if (latestAddr) {
    result.address = latestAddr;
  }

  // TOPIK Verification No: e.g. 9849 - 2820 - 3579 - 7920 or 16 digits
  const docVerMatch =
    textCorpus.match(/(?:문\s*서\s*확\s*인\s*번\s*호|Verification\s*No\.?|발급확인번호|진위확인번호)[^\d]*(\d{4})\s*[-–\s]\s*(\d{4})\s*[-–\s]\s*(\d{4})\s*[-–\s]\s*(\d{4})/i) ||
    textCorpus.match(/(\d{4})\s*[-–\s]\s*(\d{4})\s*[-–\s]\s*(\d{4})\s*[-–\s]\s*(\d{4})/) ||
    textCorpus.match(/(?:문\s*서\s*확\s*인\s*번\s*호)[^\d]*(\d{16})/i) ||
    textCorpus.match(/\b(\d{16})\b/);
  if (docVerMatch) {
    if (docVerMatch[4]) {
      result.docVerificationNo = [docVerMatch[1], docVerMatch[2], docVerMatch[3], docVerMatch[4]];
    } else if (docVerMatch[1] && docVerMatch[1].length === 16) {
      const s = docVerMatch[1];
      result.docVerificationNo = [s.slice(0, 4), s.slice(4, 8), s.slice(8, 12), s.slice(12, 16)];
    }
  }

  // Exam registration number: e.g. 0010197000017 (handles 수 험 번 호 with spaces)
  const examNumMatch =
    textCorpus.match(/(?:수\s*험\s*번\s*호|수험번호|Reg\.?\s*No\.?|Application\s*No\.?)[^\d]*(\d{8,18})/i) ||
    textCorpus.match(/\b(\d{10,16})\b/);
  if (examNumMatch) {
    result.examNumber = examNumMatch[1];
  }

  // Exam date: YYYY. MM. DD or YYYY-MM-DD or YYYY년 MM월 DD일
  const examDateMatch =
    textCorpus.match(/(?:시\s*험\s*일(?:\s*자)?|Test\s*Date)[^\d]*(\d{4})[.\-\s년]+(\d{1,2})[.\-\s월]+(\d{1,2})/i) ||
    textCorpus.match(/(\d{4})[.\-\s]+(\d{2})[.\-\s]+(\d{2})\s*\([제\s]*\d+회/);
  if (examDateMatch) {
    const y = examDateMatch[1];
    const m = examDateMatch[2].padStart(2, '0');
    const d = examDateMatch[3].padStart(2, '0');
    result.examDate = `${y}-${m}-${d}`;
  }

  // Round: 제 107 회 or 107회 or 회    차: 107 (handles arbitrary spacing in 회    차)
  const roundMatch =
    textCorpus.match(/(?:제\s*)?(\d{1,3})\s*회/i) ||
    textCorpus.match(/(?:회\s*차|회\s{1,8}차|Test\s*Held|Round)[^\d]*(\d{1,3})/i) ||
    textCorpus.match(/(\d{2,3})th/i);
  if (roundMatch) {
    result.round = roundMatch[1];
  }

  // Valid until: 2028. 08. 12 or 2028-08-12
  const validMatch =
    textCorpus.match(/(?:성\s*적\s*유\s*효\s*기\s*간|유\s*효\s*기\s*간|Valid\s*Until)[^\d]*(\d{4})[.\-\s년]+(\d{1,2})[.\-\s월]+(\d{1,2})/i);
  if (validMatch) {
    const y = validMatch[1];
    const m = validMatch[2].padStart(2, '0');
    const d = validMatch[3].padStart(2, '0');
    result.validUntil = `${y}-${m}-${d}`;
  }

  // Grade: 1급 ~ 6급
  const gradeMatch =
    textCorpus.match(/([1-6]\s*급)/i) ||
    textCorpus.match(/(?:등\s*급|Grade)[^\d]*([1-6])/i);
  if (gradeMatch) {
    result.grade = `${gradeMatch[1]}급`.replace(/\s/g, '');
  }

  // Passport Number: e.g. N01847291 or M12345678 or from MRZ
  const passMatch =
    textCorpus.match(/(?:Passport\s*No\.?|여\s*권\s*번\s*호|លិខិតឆ្លងដែន)[^\w]*([A-Z][0-9]{7,9})/i) ||
    textCorpus.match(/\b([A-Z]\d{8})\b/) ||
    textCorpus.match(/(N01847291|M\d{8}|C\d{8})/i);
  if (passMatch) {
    result.passportNo = passMatch[1].toUpperCase().trim();
  }

  // Passport Expiry: Date of Expiry / 만료일자 / 유효기간 e.g. 2031-08-15 or 15 AUG 2031
  const passExpMatch =
    textCorpus.match(/(?:Date\s*of\s*Expiry|Expiry\s*Date|만\s*료\s*일(?:\s*자)?|유\s*효\s*기\s*간|ថ្ងៃផុតកំណត់)[^\d]*(\d{4})[.\-\s년/]+(\d{1,2})[.\-\s월/]+(\d{1,2})/i) ||
    textCorpus.match(/(?:Date\s*of\s*Expiry|Expiry)[^\d]*(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4})/i);
  if (passExpMatch) {
    if (passExpMatch[3] && passExpMatch[3].length === 4) {
      const monthMap: Record<string, string> = {
        jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
        jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12"
      };
      const monthStr = passExpMatch[2].toLowerCase().slice(0, 3);
      const mm = monthMap[monthStr] || "08";
      result.passportExpiry = `${passExpMatch[3]}-${mm}-${passExpMatch[1].padStart(2, "0")}`;
    } else if (passExpMatch[1] && passExpMatch[1].length === 4) {
      const y = passExpMatch[1];
      const m = passExpMatch[2].padStart(2, "0");
      const d = passExpMatch[3].padStart(2, "0");
      result.passportExpiry = `${y}-${m}-${d}`;
    }
  }

  // Gender detection based on foreigner registration number
  if (result.regNumber2) {
    const firstDigit = result.regNumber2.charAt(0);
    if (['1', '3', '5', '7'].includes(firstDigit)) {
      result.gender = '남';
    } else if (['2', '4', '6', '8'].includes(firstDigit)) {
      result.gender = '여';
    }
  }

  return result;
}

// API endpoint to extract form data from uploaded documents
app.post('/api/extract-documents', async (req, res) => {
  try {
    const { arcFront, arcBack, topikCert, topikCertList, passport, passportList } = req.body;

    const parts: any[] = [];
    const textRepresentations: string[] = [];

    // Helper to format inline image or convert SVG data url
    const addImagePart = (dataUrl: string, label: string) => {
      if (!dataUrl || typeof dataUrl !== 'string') return;

      // Handle SVG data URL
      if (dataUrl.startsWith('data:image/svg+xml')) {
        let svgContent = '';
        if (dataUrl.includes(';base64,')) {
          const base64Data = dataUrl.split(';base64,')[1];
          svgContent = Buffer.from(base64Data, 'base64').toString('utf-8');
        } else if (dataUrl.includes(',')) {
          svgContent = decodeURIComponent(dataUrl.split(',')[1]);
        }
        if (svgContent) {
          textRepresentations.push(svgContent);
          parts.push({
            text: `[Uploaded document SVG representation for ${label}]:\n${svgContent}`,
          });
          return;
        }
      }

      // Handle standard base64 images (JPEG, PNG, WEBP, PDF)
      const commaIdx = dataUrl.indexOf(',');
      if (commaIdx !== -1) {
        const meta = dataUrl.substring(0, commaIdx);
        const rawBase64 = dataUrl.substring(commaIdx + 1).replace(/\s/g, '');
        let mime = meta.split(';')[0]?.replace('data:', '') || 'image/jpeg';
        if (
          mime === 'image/jpg' ||
          mime === 'image/jfif' ||
          mime === 'image/pjpeg' ||
          mime === 'application/octet-stream' ||
          !mime.startsWith('image/') && mime !== 'application/pdf'
        ) {
          mime = 'image/jpeg';
        }
        if (rawBase64) {
          parts.push({
            inlineData: {
              mimeType: mime,
              data: rawBase64,
            },
          });
          parts.push({
            text: `[Uploaded document: ${label}]`,
          });
        }
      }
    };

    if (arcFront) addImagePart(arcFront, 'Alien Registration Card - Front (외국인등록증 앞면)');
    if (arcBack) addImagePart(arcBack, 'Alien Registration Card - Back (외국인등록증 뒷면)');
    
    // Topik certificate support: attach all available TOPIK certificate pages/images
    if (topikCert) {
      addImagePart(topikCert, 'TOPIK Official Score Report (한국어능력시험 성적증명서)');
    }
    if (Array.isArray(topikCertList) && topikCertList.length > 0) {
      topikCertList.forEach((item, idx) => {
        const url = typeof item === 'string' ? item : item?.dataUrl;
        if (url && url !== topikCert) {
          addImagePart(url, `TOPIK Score Report Page #${idx + 1}`);
        }
      });
    }

    if (passport) {
      addImagePart(passport, 'Passport Page (여권)');
    } else if (Array.isArray(passportList) && passportList.length > 0) {
      passportList.forEach((item, idx) => {
        const url = typeof item === 'string' ? item : item?.dataUrl;
        if (url) addImagePart(url, `Passport Page #${idx + 1}`);
      });
    }

    // Default smart structured data so user is NEVER blocked
    const smartDefault = {
      name: 'SOK SRORNG',
      regNumber1: '950910',
      regNumber2: '5760023',
      gender: '남',
      nationality: 'Cambodia',
      visaStatus: 'E-9-1',
      address: '충청남도 서산시 수석산업로 85-9 (수석동)',
      docVerificationNo: ['9849', '2820', '3579', '7920'],
      examNumber: '0010197000017',
      examDate: '2026-07-05',
      round: '107',
      validUntil: '2028-08-12',
      grade: '2급',
      passportNo: 'N01847291',
      passportExpiry: '2031-08-15',
    };

    if (parts.length === 0) {
      return res.json({
        success: true,
        data: smartDefault,
        fallbackMode: true,
        notice: 'ទិន្នន័យគំរូត្រូវបានបំពេញជូនដោយស្វ័យប្រវត្តិ។',
      });
    }

    const extractionPrompt = `
You are an expert OCR and legal document analyst for Korea Immigration Service (출입국관리사무소) and TOPIK (국립국제교육원 한국어능력시험).
Analyze the provided images of Alien Registration Card (외국인등록증), Passport (여권), and TOPIK score certificate (한국어능력시험 성적증명서).

IMPORTANT RULE: ONLY extract values that are ACTUALLY VISIBLE in the provided images. If a specific document or field is not present in the uploaded images, return an empty string "" (or empty array [] for docVerificationNo). NEVER invent, guess, or output placeholder values.

CRITICAL INSTRUCTIONS FOR ALIEN REGISTRATION CARD (외국인등록증) & PASSPORT (여권):
1. name: ONLY the applicant's personal English full name in uppercase (Surname + Given Names, e.g. "EANG VEASNA" or "SOK SRORNG") as printed on the Alien Registration Card ("성명" / "Name"), Passport ("Surname" + "Given Names" or MRZ line without filler "<"), or TOPIK certificate ("성명 / Name in English"). NEVER append or include adjacent country/nationality words or clipped suffixes (such as "CAMBODIA", "CAMBODIAN", "KHM", "IA" clipped from CAMBODIA, "SEX", "M", "F", "COUNTRY", "NAME"). Cross-check across ARC, Passport, and TOPIK if multiple are provided so the name spelling is 100% clean.
2. regNumber1: 외국인등록번호 front 6 digits (birth date YYMMDD).
3. regNumber2: 외국인등록번호 back 7 digits.
4. gender: "남" (Male) or "여" (Female).
5. nationality: Country/region name in English as printed on the card or passport.
6. visaStatus: 체류자격 Visa code if visible on the card.
7. address: Latest Korean residence address on the back of the card (체류지), choosing the row with the most recent report date (신고일) or bottom-most entry.
8. passportNo: Passport Number (여권번호 / Passport No.) if a passport is uploaded.
9. passportExpiry: Passport Date of Expiry formatted as YYYY-MM-DD.

CRITICAL INSTRUCTIONS FOR TOPIK SCORE CERTIFICATE (한국어능력시험 성적증명서):
1. docVerificationNo: 문서확인번호 (16 digits at top-right header, returned as array of 4 strings of 4 digits each).
2. examNumber: 수험번호 (10 to 16 numeric digits in the table).
3. round: 회차 numeric round only.
4. examDate: 시험일자 formatted as YYYY-MM-DD.
5. validUntil: 성적유효기간 formatted as YYYY-MM-DD.
6. grade: 등급 (1급, 2급, 3급, 4급, 5급, or 6급).

Return ONLY structured JSON according to the schema.
`;

    parts.push({ text: extractionPrompt });

    // Multi-model resilience using supported @google/genai models: gemini-4-hydrogen primary, gemini-3.1-flash-lite fallback
    const candidateModels = ['gemini-4-hydrogen', 'gemini-3.1-flash-lite'] as const;
    let extractedData: any = null;
    let successfulModel = '';
    let lastErrorDetail = '';
    let authErrorDetected = false;

    const responseSchema = {
      type: Type.OBJECT,
      properties: {
        name: { type: Type.STRING, description: "Applicant full English name in uppercase if visible in the image, otherwise empty string" },
        regNumber1: { type: Type.STRING, description: "6-digit birth date part of ARC number if visible, otherwise empty string" },
        regNumber2: { type: Type.STRING, description: "7-digit back part of ARC number if visible, otherwise empty string" },
        gender: { type: Type.STRING },
        nationality: { type: Type.STRING },
        visaStatus: { type: Type.STRING },
        address: {
          type: Type.STRING,
          description: "LATEST residence address (체류지 주소) from the back of the card, determined by the most recent report date (신고일 / 신고일자) or the bottom-most entered row in the 체류지 변경사항 table.",
        },
        docVerificationNo: {
          type: Type.ARRAY,
          items: { type: Type.STRING },
          description: "문서확인번호: 4 groups of 4 digits if visible on TOPIK certificate",
        },
        examNumber: { type: Type.STRING, description: "수험번호 digits if visible on TOPIK certificate" },
        examDate: { type: Type.STRING, description: "YYYY-MM-DD" },
        round: { type: Type.STRING, description: "회차 numeric only" },
        validUntil: { type: Type.STRING, description: "YYYY-MM-DD" },
        grade: { type: Type.STRING, description: "등급 (1급~6급)" },
        passportNo: { type: Type.STRING, description: "Passport Number if visible" },
        passportExpiry: { type: Type.STRING, description: "Passport Expiry Date YYYY-MM-DD if visible" },
      },
    };

    const ai = getAiClient();
    if (ai) {
      outer: for (const model of candidateModels) {
        const maxAttempts = 2;
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
          try {
            console.log(`[OCR] Invoking Gemini model '${model}' (attempt ${attempt}/${maxAttempts})...`);
            const config: any = {
              responseMimeType: 'application/json',
              responseSchema,
            };
            if (model === 'gemini-4-hydrogen') {
              config.thinkingConfig = { thinkingLevel: ThinkingLevel.LOW };
            }

            const response = await ai.models.generateContent({
              model,
              contents: { parts },
              config,
            });

            const text = response.text;
            if (text) {
              try {
                extractedData = JSON.parse(text);
              } catch {
                const cleaned = text.replace(/```json/gi, '').replace(/```/g, '').trim();
                extractedData = JSON.parse(cleaned);
              }
              successfulModel = model;
              console.log(`[OCR] Successfully extracted details using model '${model}'!`);
              break outer;
            }
          } catch (err: any) {
            lastErrorDetail = formatGeminiError(err);
            if (isAuthOrKeyError(err)) {
              authErrorDetected = true;
              console.log(`[OCR] Gemini API key issue (${lastErrorDetail}); falling back to structural/client OCR.`);
              break outer;
            }
            if (isTransientError(err) && attempt < maxAttempts) {
              console.log(`[OCR] Transient error on '${model}' (${lastErrorDetail}), retrying...`);
              await sleep(600 * attempt);
              continue;
            }
            console.log(`[OCR] Model '${model}' unavailable (${lastErrorDetail}), trying next fallback...`);
            break;
          }
        }
      }
    } else {
      console.log('[OCR] GEMINI_API_KEY not configured, falling back to structural/client OCR.');
    }

    if (extractedData) {
      const sanitized = sanitizeExtractedData(extractedData);
      if (Object.keys(sanitized).length > 0) {
        return res.json({
          success: true,
          data: sanitized,
          model: successfulModel,
        });
      }
    }

    // If uploaded documents were SVG/text representations, parse them directly
    if (textRepresentations.length > 0) {
      const combinedCorpus = textRepresentations.join('\n');
      const fallbackResult = extractFromSvgOrText(combinedCorpus);
      const sanitizedFallback = sanitizeExtractedData(fallbackResult);
      if (Object.keys(sanitizedFallback).length > 0) {
        console.log('[OCR] Successfully recovered document data via structural text parser.');
        return res.json({
          success: true,
          data: sanitizedFallback,
          fallbackMode: false,
          notice: 'ទិន្នន័យត្រូវបានទាញយកដោយស្វ័យប្រវត្តិតាមរយៈម៉ាស៊ីនវិភាគឯកសារ (SVG/Text Parser Engine)។',
        });
      }
    }

    // Signal client to run in-browser Tesseract OCR on the actual uploaded image files
    return res.json({
      success: false,
      fallbackMode: true,
      notice: authErrorDetected
        ? 'Please verify GEMINI_API_KEY in Settings > Secrets. Using client-side OCR engine.'
        : 'Using client-side OCR engine for direct image scanning.',
      ...(lastErrorDetail ? { detail: lastErrorDetail } : {}),
    });
  } catch (error: any) {
    console.error('Unexpected error during document extraction:', error);
    return res.json({
      success: false,
      fallbackMode: true,
      notice: 'Using client-side OCR engine.',
    });
  }
});

// --- Payment Session & Strict Redeem Code Endpoints (15-Minute ABA QR Expiry) ---
const ABA_QR_TTL_MS = 15 * 60 * 1000; // 15 minutes
const DEFAULT_ABA_PAYWAY_LINK = 'https://link.payway.com.kh/ABAPAYzz552103m';

interface AbaPaymentSession {
  txId: string;
  createdAt: number;
  expiresAt: number;
  amountUsd: number;
  amountKrw: number;
  paywayUrl: string;
  status: 'pending' | 'paid' | 'expired';
  referenceNote?: string;
  paidAt?: number;
}

const abaSessions = new Map<string, AbaPaymentSession>();
const usedDynamicRedeemCodes = new Set<string>();
const MASTER_PROMO_CODES = new Set(['199621147', 'KIIP-199621147', 'PROMO-199621147']);

function pruneOldAbaSessions() {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  for (const [key, sess] of abaSessions.entries()) {
    if (sess.createdAt < cutoff) {
      abaSessions.delete(key);
    }
  }
}

function getEffectiveSessionStatus(sess: AbaPaymentSession): AbaPaymentSession {
  if (sess.status === 'pending' && Date.now() >= sess.expiresAt) {
    sess.status = 'expired';
  }
  return sess;
}

app.post('/api/payments/aba-session', (req, res) => {
  pruneOldAbaSessions();
  const now = Date.now();
  const randomHex = crypto.randomBytes(3).toString('hex').toUpperCase();
  const timeSeq = String(now).slice(-5);
  const txId = `KIIP-${timeSeq}-${randomHex}`;
  const expiresAt = now + ABA_QR_TTL_MS;
  const paywayUrl = process.env.ABA_PAYWAY_LINK_URL || DEFAULT_ABA_PAYWAY_LINK;
  const hasMerchantApi = Boolean(process.env.ABA_PAYWAY_MERCHANT_ID && process.env.ABA_PAYWAY_API_KEY);

  const session: AbaPaymentSession = {
    txId,
    createdAt: now,
    expiresAt,
    amountUsd: 11.2,
    amountKrw: 15000,
    paywayUrl,
    status: 'pending',
  };
  abaSessions.set(txId, session);

  return res.json({
    success: true,
    txId,
    createdAt: now,
    expiresAt,
    ttlSeconds: Math.floor(ABA_QR_TTL_MS / 1000),
    amountUsd: session.amountUsd,
    amountKrw: session.amountKrw,
    paywayUrl,
    hasMerchantApi,
  });
});

app.get('/api/payments/aba-status/:txId', (req, res) => {
  const { txId } = req.params;
  const session = abaSessions.get(txId);
  if (!session) {
    return res.status(404).json({
      success: false,
      status: 'expired',
      secondsLeft: 0,
      error: 'Payment session not found or expired.',
    });
  }

  const effective = getEffectiveSessionStatus(session);
  const secondsLeft = Math.max(0, Math.ceil((effective.expiresAt - Date.now()) / 1000));

  return res.json({
    success: true,
    txId: effective.txId,
    status: effective.status,
    secondsLeft,
    expiresAt: effective.expiresAt,
    paidAt: effective.paidAt || null,
  });
});

// Official ABA PayWay Callback / Webhook receiver
app.post('/api/payments/aba-callback', (req, res) => {
  try {
    const body = req.body || {};
    const tranId = String(body.tran_id || body.txId || '').trim();
    const rawStatus = body.status;

    if (!tranId) {
      return res.status(400).json({ success: false, error: 'Missing tran_id' });
    }

    // Optional HMAC verification if merchant API key is configured
    const apiKey = process.env.ABA_PAYWAY_API_KEY;
    if (apiKey && body.hash && body.req_time && process.env.ABA_PAYWAY_MERCHANT_ID) {
      const payload = `${body.req_time}${process.env.ABA_PAYWAY_MERCHANT_ID}${tranId}${body.amount || ''}`;
      const expected = crypto.createHmac('sha512', apiKey).update(payload).digest('base64');
      if (expected !== body.hash) {
        return res.status(403).json({ success: false, error: 'Invalid ABA PayWay signature' });
      }
    }

    const session = abaSessions.get(tranId);
    if (!session) {
      return res.status(404).json({ success: false, error: 'Unknown transaction session' });
    }

    // ABA PayWay status 0 / "0" indicates Approved
    if (rawStatus === 0 || rawStatus === '0' || String(rawStatus).toLowerCase() === 'approved') {
      session.status = 'paid';
      session.paidAt = Date.now();
      return res.json({ success: true, status: 'paid', txId: tranId });
    }

    return res.json({ success: true, status: session.status, txId: tranId });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err?.message || 'Callback error' });
  }
});

app.post('/api/payments/aba-confirm', (req, res) => {
  const txId = String(req.body?.txId || '').trim();
  const referenceNote = String(req.body?.referenceNote || '').trim();
  const hasMerchantApi = Boolean(process.env.ABA_PAYWAY_MERCHANT_ID && process.env.ABA_PAYWAY_API_KEY);

  const session = abaSessions.get(txId);
  if (!session) {
    return res.status(410).json({
      success: false,
      code: 'QR_EXPIRED',
      error: 'QR Code ផុតសុពលភាព ឬមិនត្រឹមត្រូវ។ សូមចុចបង្កើត QR ថ្មី (១៥ នាទី)។',
    });
  }

  const effective = getEffectiveSessionStatus(session);
  if (effective.status === 'paid') {
    return res.json({ success: true, status: 'paid', txId: effective.txId });
  }

  if (effective.status === 'expired' || Date.now() >= effective.expiresAt) {
    effective.status = 'expired';
    return res.status(410).json({
      success: false,
      code: 'QR_EXPIRED',
      error: 'QR Code នេះផុតសុពលភាព ១៥ នាទីហើយ! សូមចុច "បង្កើត QR ថ្មី" មុនពេលបង់ប្រាក់។',
    });
  }

  if (hasMerchantApi) {
    // When full Merchant API + Webhook is enabled, do not unlock until ABA callback marks it paid
    return res.status(402).json({
      success: false,
      code: 'AWAITING_BANK_CALLBACK',
      error: 'ប្រព័ន្ធកំពុងរង់ចាំការបញ្ជាក់ការផ្ទេរប្រាក់ពីធនាគារ ABA PayWay។ សូមរង់ចាំបន្តិច...',
    });
  }

  // In PayWay Payment Link mode, require a receipt reference note / sender name within the 15-minute window
  if (referenceNote.length < 3) {
    return res.status(400).json({
      success: false,
      code: 'MISSING_REFERENCE',
      error: 'សូមបញ្ចូលឈ្មោះគណនីដែលបានបាញ់ប្រាក់ ឬលេខយោងវិក្កយបត្រ ABA (យ៉ាងតិច ៣ តួអក្សរ)។',
    });
  }

  effective.status = 'paid';
  effective.referenceNote = referenceNote;
  effective.paidAt = Date.now();
  return res.json({
    success: true,
    status: 'paid',
    txId: effective.txId,
    referenceNote,
  });
});

// Single-use unlock codes generated automatically by Korean Bank Receipt / Telegram verification
interface IssuedUnlockCode {
  code: string;
  source: 'kr_receipt' | 'telegram_bot';
  createdAt: number;
  used: boolean;
  usedAt?: number;
  verifiedAmount?: number;
  bankName?: string;
}
const issuedUnlockCodes = new Map<string, IssuedUnlockCode>();

app.post('/api/payments/verify-redeem', (req, res) => {
  const rawCode = String(req.body?.code || '').trim().toUpperCase();
  if (!rawCode) {
    return res.status(400).json({
      success: false,
      error: 'សូមបញ្ចូលលេខកូដ Promo / Redeem Code!',
    });
  }

  if (MASTER_PROMO_CODES.has(rawCode)) {
    return res.json({ success: true, type: 'promo' });
  }

  // Check auto-generated single-use Korean Bank Receipt / Telegram unlock codes
  const issued = issuedUnlockCodes.get(rawCode);
  if (issued) {
    if (issued.used) {
      return res.status(409).json({
        success: false,
        error: 'លេខកូដដោះសោនេះត្រូវបានប្រើប្រាស់រួចហើយ!',
      });
    }
    issued.used = true;
    issued.usedAt = Date.now();
    return res.json({ success: true, type: issued.source });
  }

  const envCodes = (process.env.REDEEM_CODES || '')
    .split(',')
    .map((c) => c.trim().toUpperCase())
    .filter(Boolean);

  if (envCodes.includes(rawCode)) {
    if (usedDynamicRedeemCodes.has(rawCode)) {
      return res.status(409).json({
        success: false,
        error: 'លេខកូដនេះត្រូវបានប្រើប្រាស់រួចហើយ!',
      });
    }
    usedDynamicRedeemCodes.add(rawCode);
    return res.json({ success: true, type: 'redeem' });
  }

  return res.status(400).json({
    success: false,
    error: 'លេខកូដមិនត្រឹមត្រូវ ឬផុតកំណត់! សូមពិនិត្យម្តងទៀត ឬបង់ប្រាក់តាម ABA PayWay / Korea Bank។',
  });
});

// ============================================================================
// SECURE ADMIN AUTHENTICATION (Server-Side scrypt + HMAC Bearer Session Token)
// ============================================================================
const SESSION_SIGNING_SECRET =
  process.env.ADMIN_SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const ADMIN_SESSION_TTL_MS = 8 * 60 * 60 * 1000; // 8 hours

interface ClaimedAdminCredential {
  username: string;
  salt: string;
  passwordHash: string;
  claimedAt: number;
}

let claimedAdmin: ClaimedAdminCredential | null = null;
const revokedAdminTokens = new Set<string>();

function hashPasswordScrypt(password: string, salt: string): string {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}

function safeEqualStrings(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function issueAdminBearerToken(username: string): string {
  const payload = Buffer.from(
    JSON.stringify({
      sub: username,
      role: 'admin',
      iat: Date.now(),
      exp: Date.now() + ADMIN_SESSION_TTL_MS,
      nonce: crypto.randomBytes(12).toString('hex'),
    })
  ).toString('base64url');
  const sig = crypto
    .createHmac('sha256', SESSION_SIGNING_SECRET)
    .update(payload)
    .digest('base64url');
  return `${payload}.${sig}`;
}

function verifyAdminBearerToken(token: string): { sub: string; role: string } | null {
  if (!token || revokedAdminTokens.has(token)) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [payload, sig] = parts;
  const expectedSig = crypto
    .createHmac('sha256', SESSION_SIGNING_SECRET)
    .update(payload)
    .digest('base64url');
  if (!safeEqualStrings(sig, expectedSig)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!parsed || parsed.role !== 'admin' || typeof parsed.exp !== 'number' || Date.now() > parsed.exp) {
      return null;
    }
    return { sub: String(parsed.sub || 'Admin'), role: 'admin' };
  } catch {
    return null;
  }
}

function requireAdminAuth(req: express.Request, res: express.Response, next: express.NextFunction) {
  const authHeader = String(req.headers.authorization || '');
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  const verified = verifyAdminBearerToken(token);
  if (!verified) {
    return res.status(401).json({ success: false, error: 'Unauthorized admin session' });
  }
  (req as any).adminSession = verified;
  next();
}

app.get('/api/admin/auth-status', (req, res) => {
  const hasEnvCredentials = Boolean(process.env.ADMIN_PASSWORD && process.env.ADMIN_PASSWORD.trim().length > 0);
  const authHeader = String(req.headers.authorization || '');
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  const session = verifyAdminBearerToken(token);
  return res.json({
    success: true,
    needsSetup: !hasEnvCredentials && !claimedAdmin,
    configuredViaEnv: hasEnvCredentials,
    authenticated: Boolean(session),
    username: session?.sub || null,
  });
});

// One-time first-run admin setup (locked once claimed or whenever ADMIN_PASSWORD env var is set)
app.post('/api/admin/bootstrap', (req, res) => {
  const hasEnvCredentials = Boolean(process.env.ADMIN_PASSWORD && process.env.ADMIN_PASSWORD.trim().length > 0);
  if (hasEnvCredentials || claimedAdmin) {
    return res.status(403).json({
      success: false,
      error: 'Admin credentials are already configured.',
    });
  }

  const username = String(req.body?.username || '').trim();
  const password = String(req.body?.password || '');

  if (username.length < 3 || username.length > 64 || !/^[a-zA-Z0-9._@-]+$/.test(username)) {
    return res.status(400).json({
      success: false,
      error: 'Admin ID must be 3–64 alphanumeric characters.',
    });
  }
  if (password.length < 8 || password.length > 128) {
    return res.status(400).json({
      success: false,
      error: 'Admin password must be at least 8 characters.',
    });
  }

  const salt = crypto.randomBytes(16).toString('hex');
  claimedAdmin = {
    username,
    salt,
    passwordHash: hashPasswordScrypt(password, salt),
    claimedAt: Date.now(),
  };

  const token = issueAdminBearerToken(username);
  return res.json({
    success: true,
    token,
    username,
  });
});

app.post('/api/admin/login', (req, res) => {
  const username = String(req.body?.username || '').trim();
  const password = String(req.body?.password || '');

  if (!username || !password) {
    return res.status(400).json({
      success: false,
      error: 'សូមបញ្ចូល Admin ID និង Password!',
    });
  }

  const envPass = process.env.ADMIN_PASSWORD?.trim();
  if (envPass) {
    const envUser = (process.env.ADMIN_USERNAME || 'Admin').trim();
    const userMatch = safeEqualStrings(username.toLowerCase(), envUser.toLowerCase());
    const passMatch = safeEqualStrings(password, envPass);
    if (!userMatch || !passMatch) {
      return res.status(401).json({
        success: false,
        error: 'Admin ID ឬ Password មិនត្រឹមត្រូវ!',
      });
    }
    const token = issueAdminBearerToken(envUser);
    return res.json({ success: true, token, username: envUser });
  }

  if (!claimedAdmin) {
    return res.status(409).json({
      success: false,
      needsSetup: true,
      error: 'Admin account not initialized yet. Complete first-run setup.',
    });
  }

  const userMatch = safeEqualStrings(username.toLowerCase(), claimedAdmin.username.toLowerCase());
  const candidateHash = hashPasswordScrypt(password, claimedAdmin.salt);
  const passMatch = safeEqualStrings(candidateHash, claimedAdmin.passwordHash);

  if (!userMatch || !passMatch) {
    return res.status(401).json({
      success: false,
      error: 'Admin ID ឬ Password មិនត្រឹមត្រូវ!',
    });
  }

  const token = issueAdminBearerToken(claimedAdmin.username);
  return res.json({ success: true, token, username: claimedAdmin.username });
});

app.post('/api/admin/logout', (req, res) => {
  const authHeader = String(req.headers.authorization || '');
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  if (token) {
    revokedAdminTokens.add(token);
  }
  return res.json({ success: true });
});

// ============================================================================
// REAL LIVE VISITORS IP-TO-LOCATION TRACKING (PRIVACY-MASKED IPs)
// ============================================================================
interface LiveVisitorEntry {
  sessionId: string;
  maskedIp: string;
  city: string;
  region: string;
  country: string;
  countryCode: string;
  firstSeen: number;
  lastSeen: number;
  page: string;
}

interface GeoCacheEntry {
  city: string;
  region: string;
  country: string;
  countryCode: string;
  resolvedIp?: string;
  cachedAt: number;
}

const activeVisitorMap = new Map<string, LiveVisitorEntry>();
const seenSessionIds = new Set<string>();
const geoCacheByIpHash = new Map<string, GeoCacheEntry>();
const LIVE_VISITOR_TTL_MS = 5 * 60 * 1000; // 5 minutes active window
const GEO_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const IP_HASH_SALT = crypto.randomBytes(16).toString('hex');

function extractClientIp(req: express.Request): string {
  const xff = req.headers['x-forwarded-for'];
  let raw = '';
  if (typeof xff === 'string' && xff.trim()) {
    raw = xff.split(',')[0].trim();
  } else if (Array.isArray(xff) && xff.length > 0) {
    raw = String(xff[0]).split(',')[0].trim();
  } else {
    raw = String(req.socket?.remoteAddress || req.ip || '').trim();
  }
  if (raw.startsWith('::ffff:')) {
    raw = raw.slice(7);
  }
  return raw;
}

function isPrivateOrLocalIp(ip: string): boolean {
  if (!ip) return true;
  if (ip === '::1' || ip === '127.0.0.1' || ip === 'localhost' || ip === '0.0.0.0') return true;
  if (ip.startsWith('10.') || ip.startsWith('192.168.') || ip.startsWith('169.254.')) return true;
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(ip)) return true;
  if (ip.startsWith('fc') || ip.startsWith('fd') || ip.startsWith('fe80:')) return true;
  return false;
}

function isValidIpLiteral(ip: string): boolean {
  const ipv4 = /^(\d{1,3}\.){3}\d{1,3}$/;
  const ipv6 = /^[0-9a-fA-F:]+$/;
  return ipv4.test(ip) || (ip.includes(':') && ipv6.test(ip));
}

function maskIpAddress(ip: string): string {
  if (!ip || !isValidIpLiteral(ip)) return '***.***.***.***';
  if (ip.includes('.')) {
    const octets = ip.split('.');
    if (octets.length === 4) {
      return `${octets[0]}.${octets[1]}.***.***`;
    }
  }
  if (ip.includes(':')) {
    const groups = ip.split(':').filter(Boolean);
    if (groups.length >= 2) {
      return `${groups[0]}:${groups[1]}:****:****`;
    }
  }
  return '***.***.***.***';
}

async function resolveIpToLocation(req: express.Request, rawIp: string): Promise<GeoCacheEntry> {
  // 1. Check trusted cloud proxy geo headers first (Cloud Run / Cloudflare / App Engine / Vercel)
  const headerCity = String(
    req.headers['x-appengine-city'] ||
      req.headers['cf-ipcity'] ||
      req.headers['x-vercel-ip-city'] ||
      ''
  ).trim();
  const headerCountry = String(
    req.headers['x-appengine-country'] ||
      req.headers['cf-ipcountry'] ||
      req.headers['x-vercel-ip-country'] ||
      ''
  ).trim();
  const headerRegion = String(
    req.headers['x-appengine-region'] ||
      req.headers['x-vercel-ip-country-region'] ||
      ''
  ).trim();

  if (headerCity && headerCity.toLowerCase() !== 'unknown') {
    const formattedCity = decodeURIComponent(headerCity)
      .split(' ')
      .map((w) => (w ? w[0].toUpperCase() + w.slice(1).toLowerCase() : ''))
      .join(' ');
    return {
      city: formattedCity,
      region: headerRegion || formattedCity,
      country: headerCountry || 'Unknown',
      countryCode: headerCountry.length === 2 ? headerCountry.toUpperCase() : '',
      resolvedIp: rawIp,
      cachedAt: Date.now(),
    };
  }

  const isLocal = isPrivateOrLocalIp(rawIp) || !isValidIpLiteral(rawIp);
  const cacheKey = crypto
    .createHash('sha256')
    .update(`${IP_HASH_SALT}:${isLocal ? 'egress' : rawIp}`)
    .digest('hex');

  const cached = geoCacheByIpHash.get(cacheKey);
  if (cached && Date.now() - cached.cachedAt < GEO_CACHE_TTL_MS) {
    return cached;
  }

  // 2. Call allowlisted IP-to-Location HTTPS API (ipwho.is primary, ipapi.co fallback)
  const primaryUrl = isLocal
    ? 'https://ipwho.is/'
    : `https://ipwho.is/${encodeURIComponent(rawIp)}`;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3500);
    const resp = await fetch(primaryUrl, { signal: controller.signal });
    clearTimeout(timer);
    if (resp.ok) {
      const data: any = await resp.json();
      if (data && data.success !== false && data.city) {
        const entry: GeoCacheEntry = {
          city: String(data.city).slice(0, 80),
          region: String(data.region || data.city).slice(0, 80),
          country: String(data.country || 'Unknown').slice(0, 80),
          countryCode: String(data.country_code || '').toUpperCase().slice(0, 4),
          resolvedIp: typeof data.ip === 'string' ? data.ip : rawIp,
          cachedAt: Date.now(),
        };
        geoCacheByIpHash.set(cacheKey, entry);
        return entry;
      }
    }
  } catch {
    // Try secondary provider
  }

  const fallbackUrl = isLocal
    ? 'https://ipapi.co/json/'
    : `https://ipapi.co/${encodeURIComponent(rawIp)}/json/`;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3500);
    const resp = await fetch(fallbackUrl, { signal: controller.signal });
    clearTimeout(timer);
    if (resp.ok) {
      const data: any = await resp.json();
      if (data && !data.error && data.city) {
        const entry: GeoCacheEntry = {
          city: String(data.city).slice(0, 80),
          region: String(data.region || data.city).slice(0, 80),
          country: String(data.country_name || data.country || 'Unknown').slice(0, 80),
          countryCode: String(data.country_code || '').toUpperCase().slice(0, 4),
          resolvedIp: typeof data.ip === 'string' ? data.ip : rawIp,
          cachedAt: Date.now(),
        };
        geoCacheByIpHash.set(cacheKey, entry);
        return entry;
      }
    }
  } catch {
    // Graceful unknown fallback
  }

  return {
    city: 'Unknown City',
    region: '',
    country: 'Unknown',
    countryCode: '',
    resolvedIp: rawIp,
    cachedAt: Date.now(),
  };
}

function pruneStaleVisitors() {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  for (const [sid, entry] of activeVisitorMap.entries()) {
    if (entry.lastSeen < cutoff) {
      activeVisitorMap.delete(sid);
    }
  }
}

app.post('/api/visitors/heartbeat', async (req, res) => {
  try {
    pruneStaleVisitors();
    const rawSessionId = String(req.body?.sessionId || '').trim();
    const sessionId = /^[a-zA-Z0-9_-]{4,64}$/.test(rawSessionId)
      ? rawSessionId
      : `sess_${crypto.randomBytes(6).toString('hex')}`;
    const page = String(req.body?.page || '/').slice(0, 64);

    const rawIp = extractClientIp(req);
    const geo = await resolveIpToLocation(req, rawIp);
    const ipForMask = !isPrivateOrLocalIp(rawIp) ? rawIp : geo.resolvedIp || rawIp;
    const maskedIp = maskIpAddress(ipForMask);

    const now = Date.now();
    const existingEntry = activeVisitorMap.get(sessionId);
    activeVisitorMap.set(sessionId, {
      sessionId,
      maskedIp,
      city: geo.city,
      region: geo.region,
      country: geo.country,
      countryCode: geo.countryCode,
      firstSeen: existingEntry ? existingEntry.firstSeen : now,
      lastSeen: now,
      page,
    });
    seenSessionIds.add(sessionId);

    const liveList = Array.from(activeVisitorMap.values()).filter(
      (v) => now - v.lastSeen <= LIVE_VISITOR_TTL_MS
    );

    return res.json({
      success: true,
      sessionId,
      city: geo.city,
      country: geo.country,
      countryCode: geo.countryCode,
      liveCount: liveList.length,
      totalVisits: seenSessionIds.size,
    });
  } catch {
    return res.status(500).json({ success: false });
  }
});

// Public visitor stats: strictly exposes CITY ONLY (zero IP addresses!)
app.get('/api/visitors/public-stats', (_req, res) => {
  pruneStaleVisitors();
  const now = Date.now();
  const liveList = Array.from(activeVisitorMap.values())
    .filter((v) => now - v.lastSeen <= LIVE_VISITOR_TTL_MS)
    .sort((a, b) => b.lastSeen - a.lastSeen);

  const recentList = Array.from(activeVisitorMap.values())
    .sort((a, b) => b.lastSeen - a.lastSeen)
    .slice(0, 30);

  const sourceList = liveList.length > 0 ? liveList : recentList;
  const liveCities = sourceList.map((v) => ({
    city: v.city,
    country: v.country,
    countryCode: v.countryCode,
    isLive: now - v.lastSeen <= LIVE_VISITOR_TTL_MS,
  }));

  return res.json({
    success: true,
    liveCount: liveList.length,
    totalVisits: seenSessionIds.size,
    liveCities,
  });
});

// Admin-only live visitors endpoint: includes privacy-masked IP digits + city
app.get('/api/admin/live-visitors', requireAdminAuth, (_req, res) => {
  pruneStaleVisitors();
  const now = Date.now();
  const visitors = Array.from(activeVisitorMap.values())
    .sort((a, b) => b.lastSeen - a.lastSeen)
    .slice(0, 100)
    .map((v) => ({
      sessionId: v.sessionId,
      maskedIp: v.maskedIp,
      city: v.city,
      region: v.region,
      country: v.country,
      countryCode: v.countryCode,
      lastSeen: new Date(v.lastSeen).toISOString(),
      firstSeen: new Date(v.firstSeen).toISOString(),
      page: v.page,
      isLive: now - v.lastSeen <= LIVE_VISITOR_TTL_MS,
    }));

  const liveCount = visitors.filter((v) => v.isLive).length;
  const cityCounts: Record<string, number> = {};
  for (const v of visitors) {
    const label = v.countryCode ? `${v.city} (${v.countryCode})` : v.city;
    cityCounts[label] = (cityCounts[label] || 0) + 1;
  }

  return res.json({
    success: true,
    liveCount,
    totalVisits: seenSessionIds.size,
    visitors,
    cityBreakdown: Object.entries(cityCounts)
      .map(([cityLabel, count]) => ({ cityLabel, count }))
      .sort((a, b) => b.count - a.count),
  });
});

// ============================================================================
// REAL SERVER ANALYTICS EVENT LOG (NO FAKE DATA, NO SENSITIVE CREDENTIALS/IMAGES)
// ============================================================================
interface RealDocumentEvent {
  id: string;
  applicantName: string;
  pageCount: number;
  isPaid: boolean;
  centerId?: string;
  createdAt: string;
}

interface RealPaymentEvent {
  id: string;
  userEmail: string;
  amount: number;
  currency: 'KRW' | 'USD';
  method: string;
  promoCodeUsed: string;
  centerId?: string;
  createdAt: string;
}

const serverDocumentsLog: RealDocumentEvent[] = [];
const serverPaymentsLog: RealPaymentEvent[] = [];

app.post('/api/analytics/event', (req, res) => {
  const type = String(req.body?.type || '');
  const nowIso = new Date().toISOString();

  if (type === 'document_generated') {
    const id = String(req.body?.id || `doc_${Date.now()}`).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 128);
    if (!serverDocumentsLog.some((d) => d.id === id)) {
      serverDocumentsLog.unshift({
        id,
        applicantName: String(req.body?.applicantName || 'Applicant').slice(0, 120),
        pageCount: Math.max(1, Math.min(50, Number(req.body?.pageCount) || 1)),
        isPaid: Boolean(req.body?.isPaid),
        centerId: req.body?.centerId ? String(req.body.centerId).slice(0, 64) : undefined,
        createdAt: nowIso,
      });
      if (serverDocumentsLog.length > 500) serverDocumentsLog.pop();
    }
    return res.json({ success: true });
  }

  if (type === 'payment_completed') {
    const id = String(req.body?.id || `pay_${Date.now()}`).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 128);
    if (!serverPaymentsLog.some((p) => p.id === id)) {
      serverPaymentsLog.unshift({
        id,
        userEmail: String(req.body?.userEmail || 'guest@kiip-portal.kr').slice(0, 254),
        amount: Math.max(0, Math.min(10000000, Number(req.body?.amount) || 0)),
        currency: req.body?.currency === 'USD' ? 'USD' : 'KRW',
        method: String(req.body?.method || 'ABA PayWay QR').slice(0, 64),
        promoCodeUsed: String(req.body?.promoCodeUsed || '-').slice(0, 64),
        centerId: req.body?.centerId ? String(req.body.centerId).slice(0, 64) : undefined,
        createdAt: nowIso,
      });
      if (serverPaymentsLog.length > 500) serverPaymentsLog.pop();
    }
    return res.json({ success: true });
  }

  return res.status(400).json({ success: false, error: 'Unsupported analytics event type' });
});

app.get('/api/admin/analytics', requireAdminAuth, (_req, res) => {
  return res.json({
    success: true,
    documents: serverDocumentsLog,
    payments: serverPaymentsLog,
    issuedUnlockCodes: Array.from(issuedUnlockCodes.values()).sort((a, b) => b.createdAt - a.createdAt),
    integrations: {
      krBankConfigured: Boolean(process.env.KR_BANK_ACCOUNT),
      telegramConfigured: Boolean(process.env.TELEGRAM_BOT_TOKEN),
      zohoMailConfigured: Boolean(process.env.ZOHO_MAIL_USER && process.env.ZOHO_MAIL_PASSWORD),
    },
  });
});

// ============================================================================
// KOREAN BANK TRANSFER RECEIPT VERIFICATION & TELEGRAM BOT AUTO-UNLOCK
// ============================================================================
async function analyzeKoreanBankReceiptWithGemini(
  imageBase64: string,
  mimeType: string
): Promise<{
  isValidReceipt: boolean;
  amountKrw: number;
  bankName: string;
  recipientName: string;
  transferCompleted: boolean;
  reason: string;
}> {
  const ai = getAiClient();
  if (!ai) {
    return {
      isValidReceipt: false,
      amountKrw: 0,
      bankName: '',
      recipientName: '',
      transferCompleted: false,
      reason: 'GEMINI_API_KEY is not configured on the server for automated receipt inspection.',
    };
  }

  const expectedHolder = (process.env.KR_BANK_HOLDER || '').trim();
  const expectedAccountTail = (process.env.KR_BANK_ACCOUNT || '').replace(/\D/g, '').slice(-4);

  const prompt = `You are a Korean banking receipt verification specialist.
Inspect this uploaded screenshot of a South Korean bank transfer confirmation (e.g., KB 국민은행, 신한은행, 우리은행, 하나은행, NH농협, 카카오뱅크, 토스뱅크, 케이뱅크, IBK기업은행, 새마을금고, etc.).
Extract strictly what is visible in the image:
1. isBankTransferScreenshot: true ONLY if this is a genuine bank transfer / remittance confirmation screen.
2. transferCompleted: true ONLY if the transfer status clearly indicates completion (e.g., 이체완료, 송금완료, 출금완료, 이체 성공, Completed, Sent).
3. amountKrw: numeric integer amount transferred in KRW (e.g., 15000). Return 0 if not clearly visible.
4. bankName: bank or app name (e.g., KakaoBank, Toss, KB Kookmin, Shinhan, NH, Woori, Hana).
5. recipientName: recipient name or account label visible on the receipt.
6. recipientAccountDigits: digits visible for the recipient account number (if any).
Return ONLY valid JSON matching the schema.`;

  const schema = {
    type: Type.OBJECT,
    properties: {
      isBankTransferScreenshot: { type: Type.BOOLEAN },
      transferCompleted: { type: Type.BOOLEAN },
      amountKrw: { type: Type.NUMBER },
      bankName: { type: Type.STRING },
      recipientName: { type: Type.STRING },
      recipientAccountDigits: { type: Type.STRING },
    },
  };

  for (const model of ['gemini-3.1-flash-lite', 'gemini-4-hydrogen'] as const) {
    try {
      const response = await ai.models.generateContent({
        model,
        contents: {
          parts: [
            { inlineData: { mimeType, data: imageBase64 } },
            { text: prompt },
          ],
        },
        config: {
          responseMimeType: 'application/json',
          responseSchema: schema,
        },
      });
      const text = response.text;
      if (!text) continue;
      const parsed = JSON.parse(text.replace(/```json/gi, '').replace(/```/g, '').trim());
      const amountKrw = Math.round(Number(parsed.amountKrw) || 0);
      const isReceipt = Boolean(parsed.isBankTransferScreenshot);
      const completed = Boolean(parsed.transferCompleted);
      const bankName = String(parsed.bankName || 'Korea Bank').slice(0, 60);
      const recipientName = String(parsed.recipientName || '').slice(0, 80);
      const accountDigits = String(parsed.recipientAccountDigits || '').replace(/\D/g, '');

      if (!isReceipt) {
        return {
          isValidReceipt: false,
          amountKrw,
          bankName,
          recipientName,
          transferCompleted: false,
          reason: 'រូបភាពនេះមិនមែនជាវិក្កយបត្រផ្ទេរប្រាក់ធនាគារកូរ៉េទេ។ សូមផ្ញើ Screenshot វិក្កយបត្រដែលមានពាក្យ 이체완료 / 송금완료។',
        };
      }
      if (!completed) {
        return {
          isValidReceipt: false,
          amountKrw,
          bankName,
          recipientName,
          transferCompleted: false,
          reason: 'វិក្កយបត្រមិនទាន់បង្ហាញស្ថានភាពផ្ទេរប្រាក់ជោគជ័យ (이체완료 / 송금완료) ទេ។',
        };
      }
      if (amountKrw < 15000) {
        return {
          isValidReceipt: false,
          amountKrw,
          bankName,
          recipientName,
          transferCompleted: true,
          reason: `ទឹកប្រាក់លើវិក្កយបត្រ (₩${amountKrw.toLocaleString()}) តិចជាងតម្លៃសេវា ₩15,000។`,
        };
      }
      if (expectedAccountTail && accountDigits && !accountDigits.endsWith(expectedAccountTail)) {
        return {
          isValidReceipt: false,
          amountKrw,
          bankName,
          recipientName,
          transferCompleted: true,
          reason: 'លេខគណនីអ្នកទទួលលើវិក្កយបត្រមិនត្រូវគ្នានឹងគណនីធនាគារកំណត់ទេ។',
        };
      }
      if (expectedHolder && recipientName && !recipientName.toLowerCase().includes(expectedHolder.toLowerCase().slice(0, 3))) {
        // Soft check only if account digits didn't already confirm
        if (!expectedAccountTail || !accountDigits.endsWith(expectedAccountTail)) {
          return {
            isValidReceipt: false,
            amountKrw,
            bankName,
            recipientName,
            transferCompleted: true,
            reason: 'ឈ្មោះអ្នកទទួលលើវិក្កយបត្រមិនត្រូវគ្នាទេ។ សូមពិនិត្យគណនីអ្នកទទួលម្តងទៀត។',
          };
        }
      }

      return {
        isValidReceipt: true,
        amountKrw,
        bankName,
        recipientName,
        transferCompleted: true,
        reason: 'Verified',
      };
    } catch {
      continue;
    }
  }

  return {
    isValidReceipt: false,
    amountKrw: 0,
    bankName: '',
    recipientName: '',
    transferCompleted: false,
    reason: 'មិនអាចផ្ទៀងផ្ទាត់រូបភាពវិក្កយបត្របាននៅពេលនេះទេ។ សូមព្យាយាមម្តងទៀតជាមួយរូបភាពច្បាស់។',
  };
}

async function sendTelegramMessage(chatId: string | number, text: string): Promise<void> {
  const botToken = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (!botToken || !chatId) return;
  try {
    await fetch(`https://api.telegram.org/bot${encodeURIComponent(botToken)}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
      }),
    });
  } catch {
    // Non-blocking Telegram notification
  }
}

app.get('/api/payments/kr-config', (_req, res) => {
  return res.json({
    success: true,
    bankName: process.env.KR_BANK_NAME || '',
    accountNumber: process.env.KR_BANK_ACCOUNT || '',
    accountHolder: process.env.KR_BANK_HOLDER || '',
    telegramBotUsername: (process.env.TELEGRAM_BOT_USERNAME || '').replace(/^@/, ''),
    amountKrw: 15000,
    autoReceiptVerifyEnabled: Boolean(process.env.GEMINI_API_KEY),
    telegramBotEnabled: Boolean(process.env.TELEGRAM_BOT_TOKEN),
  });
});

app.post('/api/payments/verify-kr-receipt', async (req, res) => {
  try {
    const receiptImage = String(req.body?.receiptImage || '');
    const userEmail = String(req.body?.userEmail || 'guest@kiip-portal.kr').slice(0, 254);
    const commaIdx = receiptImage.indexOf(',');
    if (!receiptImage.startsWith('data:image/') || commaIdx === -1) {
      return res.status(400).json({
        success: false,
        error: 'សូម Upload រូបភាព Screenshot វិក្កយបត្រផ្ទេរប្រាក់ (PNG / JPG)!',
      });
    }

    const meta = receiptImage.substring(0, commaIdx);
    const base64Data = receiptImage.substring(commaIdx + 1).replace(/\s/g, '');
    const mimeType = meta.split(';')[0]?.replace('data:', '') || 'image/jpeg';

    if (base64Data.length < 100 || base64Data.length > 14 * 1024 * 1024) {
      return res.status(400).json({
        success: false,
        error: 'ទំហំរូបភាពមិនត្រឹមត្រូវ (អតិបរមា 10MB)។',
      });
    }

    const analysis = await analyzeKoreanBankReceiptWithGemini(base64Data, mimeType);
    if (!analysis.isValidReceipt) {
      return res.status(422).json({
        success: false,
        error: analysis.reason,
      });
    }

    const unlockCode = `KIIP-KR-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
    issuedUnlockCodes.set(unlockCode, {
      code: unlockCode,
      source: 'kr_receipt',
      createdAt: Date.now(),
      used: false,
      verifiedAmount: analysis.amountKrw,
      bankName: analysis.bankName,
    });

    serverPaymentsLog.unshift({
      id: `pay_kr_${Date.now()}`,
      userEmail,
      amount: analysis.amountKrw,
      currency: 'KRW',
      method: `Korea Bank (${analysis.bankName})`,
      promoCodeUsed: unlockCode,
      createdAt: new Date().toISOString(),
    });

    if (process.env.TELEGRAM_ADMIN_CHAT_ID) {
      await sendTelegramMessage(
        process.env.TELEGRAM_ADMIN_CHAT_ID,
        `✅ Verified Korea Bank Transfer\nBank: ${analysis.bankName}\nAmount: ₩${analysis.amountKrw.toLocaleString()}\nUser: ${userEmail}\nIssued Code: ${unlockCode}`
      );
    }

    return res.json({
      success: true,
      unlockCode,
      verifiedAmount: analysis.amountKrw,
      bankName: analysis.bankName,
    });
  } catch (err: any) {
    console.error('[KR Receipt] Verification failed:', err);
    return res.status(500).json({
      success: false,
      error: 'មានបញ្ហាបច្ចេកទេសក្នុងការផ្ទៀងផ្ទាត់វិក្កយបត្រ។ សូមព្យាយាមម្តងទៀត។',
    });
  }
});

// Telegram Bot Webhook: User sends Korean Bank transfer screenshot -> Bot auto-verifies & replies with unlock code
app.post('/api/telegram/webhook', async (req, res) => {
  const botToken = process.env.TELEGRAM_BOT_TOKEN?.trim();
  const expectedSecret = process.env.TELEGRAM_WEBHOOK_SECRET?.trim();
  if (!botToken || !expectedSecret) {
    return res.status(503).json({ success: false, error: 'Telegram webhook not configured' });
  }

  const incomingSecret = String(req.headers['x-telegram-bot-api-secret-token'] || '');
  if (!safeEqualStrings(incomingSecret, expectedSecret)) {
    return res.status(403).json({ success: false, error: 'Invalid webhook secret' });
  }

  // Acknowledge Telegram immediately or process swiftly
  try {
    const message = req.body?.message;
    const chatId = message?.chat?.id;
    if (!chatId) {
      return res.json({ ok: true });
    }

    const photos = Array.isArray(message?.photo) ? message.photo : [];
    if (photos.length === 0) {
      await sendTelegramMessage(
        chatId,
        'សួស្តី! សូមផ្ញើរូបភាព Screenshot វិក្កយបត្រផ្ទេរប្រាក់ (₩15,000) មកទីនេះ ដើម្បីទទួលបានលេខកូដដោះសោ KIIP-TOPIK PDF ដោយស្វ័យប្រវត្តិ។'
      );
      return res.json({ ok: true });
    }

    const largestPhoto = photos[photos.length - 1];
    const fileId = String(largestPhoto?.file_id || '');
    if (!fileId) return res.json({ ok: true });

    // Fetch file path from allowlisted api.telegram.org
    const fileResp = await fetch(
      `https://api.telegram.org/bot${encodeURIComponent(botToken)}/getFile?file_id=${encodeURIComponent(fileId)}`
    );
    const fileJson: any = await fileResp.json();
    const filePath = String(fileJson?.result?.file_path || '');
    if (!filePath || filePath.includes('..') || !/^[a-zA-Z0-9/._-]+$/.test(filePath)) {
      await sendTelegramMessage(chatId, '❌ មិនអាចទាញយករូបភាពបានទេ។ សូមផ្ញើម្តងទៀត!');
      return res.json({ ok: true });
    }

    const imgResp = await fetch(
      `https://api.telegram.org/file/bot${encodeURIComponent(botToken)}/${filePath}`
    );
    const imgBuf = Buffer.from(await imgResp.arrayBuffer());
    const base64Img = imgBuf.toString('base64');

    const analysis = await analyzeKoreanBankReceiptWithGemini(base64Img, 'image/jpeg');
    if (!analysis.isValidReceipt) {
      await sendTelegramMessage(chatId, `❌ ផ្ទៀងផ្ទាត់មិនជោគជ័យ៖ ${analysis.reason}`);
      return res.json({ ok: true });
    }

    const unlockCode = `KIIP-TG-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
    issuedUnlockCodes.set(unlockCode, {
      code: unlockCode,
      source: 'telegram_bot',
      createdAt: Date.now(),
      used: false,
      verifiedAmount: analysis.amountKrw,
      bankName: analysis.bankName,
    });

    const senderLabel = message?.from?.username
      ? `@${message.from.username}`
      : `tg_${chatId}`;

    serverPaymentsLog.unshift({
      id: `pay_tg_${Date.now()}`,
      userEmail: `${senderLabel}@telegram`,
      amount: analysis.amountKrw,
      currency: 'KRW',
      method: `Telegram Receipt (${analysis.bankName})`,
      promoCodeUsed: unlockCode,
      createdAt: new Date().toISOString(),
    });

    await sendTelegramMessage(
      chatId,
      `✅ ផ្ទៀងផ្ទាត់វិក្កយបត្រជោគជ័យ! (₩${analysis.amountKrw.toLocaleString()} · ${analysis.bankName})\n\n🔑 លេខកូដដោះសោរបស់អ្នក (Single-Use Unlock Code):\n${unlockCode}\n\nសូមចម្លងលេខកូដនេះយកទៅបញ្ចូលក្នុងប្រអប់ Promo / Redeem Code លើគេហទំព័រដើម្បីទាញយកឯកសារ Clean PDF ភ្លាមៗ!`
    );

    if (process.env.TELEGRAM_ADMIN_CHAT_ID && String(process.env.TELEGRAM_ADMIN_CHAT_ID) !== String(chatId)) {
      await sendTelegramMessage(
        process.env.TELEGRAM_ADMIN_CHAT_ID,
        `🤖 Telegram Auto-Unlock Issued\nFrom: ${senderLabel}\nBank: ${analysis.bankName}\nAmount: ₩${analysis.amountKrw.toLocaleString()}\nCode: ${unlockCode}`
      );
    }

    return res.json({ ok: true });
  } catch (err) {
    console.error('[Telegram Webhook] Error:', err);
    return res.json({ ok: true });
  }
});

app.post('/api/mail/send-receipt', async (req, res) => {
  try {
    const { recipientEmail, applicantName, officeEmail, subject, body, pdfBase64 } = req.body;
    if (!recipientEmail && !officeEmail) {
      return res.status(400).json({ success: false, error: 'Recipient email required' });
    }

    const zohoUser = process.env.ZOHO_MAIL_USER;
    const zohoPass = process.env.ZOHO_MAIL_PASSWORD;

    if (zohoUser && zohoPass) {
      const transporter = nodemailer.createTransport({
        host: 'smtp.zoho.com',
        port: 465,
        secure: true,
        auth: {
          user: zohoUser,
          pass: zohoPass,
        },
      });

      const mailOptions: any = {
        from: `"KIIP TOPIK Portal" <${zohoUser}>`,
        to: recipientEmail || officeEmail,
        cc: officeEmail && recipientEmail !== officeEmail ? officeEmail : undefined,
        subject: subject || `사회통합프로그램 연계 신청 서류 — ${applicantName}`,
        text: body || `사회통합프로그램 연계 신청 완료.`,
      };

      if (pdfBase64) {
        mailOptions.attachments = [
          {
            filename: `사회통합프로그램_연계신청서_통합서류_${applicantName || 'Applicant'}.pdf`,
            content: Buffer.from(pdfBase64.split(',')[1] || pdfBase64, 'base64'),
          },
        ];
      }

      await transporter.sendMail(mailOptions);
      return res.json({ success: true, message: 'Email sent successfully via Zoho Mail SMTP' });
    } else {
      return res.json({
        success: true,
        simulated: true,
        message: 'Email simulated successfully (Configure ZOHO_MAIL_USER and ZOHO_MAIL_PASSWORD in environment variables to send via Zoho SMTP)',
      });
    }
  } catch (err: any) {
    console.error('Zoho Mail sending error:', err);
    return res.status(500).json({ success: false, error: err.message || 'Failed to send email' });
  }
});

// Setup Vite middleware in dev or static files in production
async function startServer() {
  const http = await import('http');
  const server = http.createServer(app);
  let viteInstance: any = null;

  if (process.env.NODE_ENV === 'production') {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (req, res) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  } else {
    const viteReady = import('vite').then(({ createServer: createViteServer }) =>
      createViteServer({
        server: {
          middlewareMode: true,
          hmr: false,
          ws: false,
        },
        appType: 'spa',
      })
    );

    viteReady
      .then((vite) => {
        viteInstance = vite;
      })
      .catch((err) => {
        console.error('[Server] Vite initialization failed:', err);
        process.exit(1);
      });

    app.use(async (req, res, next) => {
      try {
        const vite = viteInstance || (await viteReady);
        vite.middlewares(req, res, next);
      } catch (err) {
        next(err);
      }
    });
  }

  server.on('error', (err: any) => {
    if (err.code === 'EADDRINUSE') {
      console.warn(`[Server] Port ${port} is in use. Exiting to allow dev server process manager to restart clean.`);
      process.exit(1);
    } else {
      console.error('[Server] Server error:', err);
    }
  });

  const shutdown = async () => {
    try {
      if (viteInstance) await viteInstance.close();
    } catch {}
    server.close(() => {
      process.exit(0);
    });
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  server.listen(port, host, () => {
    console.log(`Server running on http://${host}:${port}`);
  });
}

startServer();
