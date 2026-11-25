import dns from 'dns';
import fs from 'fs';
import crypto from 'crypto';
import { execFileSync } from 'child_process';
import express from 'express';
import dotenv from 'dotenv';
import nodemailer from 'nodemailer';
import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  getRedeemDb,
  getRedeemCodeStats,
  queryRedeemCodes,
  generateUnusedRedeemCodes,
  addCustomRedeemCodes,
  verifyAndBurnRedeemCode,
  reserveUnusedRedeemCode,
  recordVerifiedReceiptAndReserveCode,
  updateRedeemCodeStatus,
  deleteRedeemCode,
  syncRedeemCodesFromGoogleSheet,
  ensureGoogleSheetSynced,
  checkRedeemCodeStatus,
  setRedeemCodePaid,
  issueNextPaidRedeemCode,
  listServerPromoCodes,
  upsertServerPromoCode,
  deleteServerPromoCode,
  verifyAndIncrementServerPromoCode,
  checkServerPromoCodeExists,
  getOrCreateSessionSigningSecret,
  listAdminAccounts,
  createOrUpdateAdminAccount,
  verifyDbAdminLogin,
  setAdminAccountActive,
  updateAdminAccountPassword,
  deleteAdminAccount,
  recordUniqueVisitSession,
  getTotalRecordedVisits,
  registerUserAccount,
  verifyUserLogin,
  upsertOtpUserAccount,
  getUserAccountByEmail,
  changeUserAccountPassword,
  resetUserAccountPassword,
  type RedeemCodeStatus,
  type AdminAccountRole,
  type PublicUserRecord,
} from './src/server/redeemDb.ts';
import {
  runServerSideOcrFallback,
  parseStructuredTextCorpus,
  parseFlexibleDate,
} from './src/server/serverOcr.ts';

dotenv.config();
dns.setDefaultResultOrder('ipv4first');
// Initialize persistent SQLite Redeem Code database with pre-seeded 'Unused' codes
getRedeemDb();

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
app.disable('x-powered-by');
const cliPort = getCliArg('--port') || getCliArg('-p');
const cliHost = getCliArg('--host');
const port = parseInt(cliPort || process.env.PORT || '3000', 10);
const host = cliHost || process.env.HOST || '0.0.0.0';

function isSameHostOrigin(origin: string | undefined, hostHeader: string | string[] | undefined): boolean {
  if (!origin || !hostHeader) return false;
  try {
    const originHost = new URL(origin).host.toLowerCase();
    const expectedHost = String(Array.isArray(hostHeader) ? hostHeader[0] : hostHeader)
      .split(',')[0]
      .trim()
      .toLowerCase();
    return Boolean(originHost && expectedHost && originHost === expectedHost);
  } catch {
    return false;
  }
}

function isRequestHttps(req: express.Request): boolean {
  const xfProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase();
  return req.secure || xfProto === 'https';
}

function parseCookies(req: express.Request): Record<string, string> {
  const raw = String(req.headers.cookie || '');
  const out: Record<string, string> = {};
  if (!raw) return out;
  for (const part of raw.split(';')) {
    const eqIdx = part.indexOf('=');
    if (eqIdx === -1) continue;
    const key = part.slice(0, eqIdx).trim();
    const val = part.slice(eqIdx + 1).trim();
    if (!key) continue;
    try {
      out[key] = decodeURIComponent(val);
    } catch {
      out[key] = val;
    }
  }
  return out;
}

function setHttpOnlyCookie(
  req: express.Request,
  res: express.Response,
  name: string,
  value: string,
  maxAgeSeconds: number
) {
  const https = isRequestHttps(req);
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    'Path=/',
    `Max-Age=${Math.max(0, Math.floor(maxAgeSeconds))}`,
    'HttpOnly',
    https ? 'SameSite=None' : 'SameSite=Lax',
  ];
  if (https) {
    parts.push('Secure', 'Partitioned');
  }
  res.append('Set-Cookie', parts.join('; '));
}

function clearHttpOnlyCookie(req: express.Request, res: express.Response, name: string) {
  const https = isRequestHttps(req);
  const parts = [
    `${name}=`,
    'Path=/',
    'Max-Age=0',
    'HttpOnly',
    https ? 'SameSite=None' : 'SameSite=Lax',
  ];
  if (https) {
    parts.push('Secure', 'Partitioned');
  }
  res.append('Set-Cookie', parts.join('; '));
}

function getRateLimitIp(req: express.Request): string {
  const trustedProxyIp =
    req.headers['cf-connecting-ip'] ||
    req.headers['x-appengine-user-ip'];
  if (typeof trustedProxyIp === 'string' && trustedProxyIp.trim()) {
    return trustedProxyIp.trim().slice(0, 64);
  }
  const raw = String(req.socket?.remoteAddress || req.ip || 'unknown').trim();
  return raw.startsWith('::ffff:') ? raw.slice(7) : raw;
}

function createRateLimiter(options: {
  maxRequests: number;
  windowMs: number;
  errorMessage: string;
}) {
  const buckets = new Map<string, number[]>();
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const now = Date.now();
    const ip = getRateLimitIp(req);
    const key = `${ip}:${req.baseUrl || ''}${req.path}`;
    const cutoff = now - options.windowMs;
    const recent = (buckets.get(key) || []).filter((ts) => ts > cutoff);
    if (recent.length >= options.maxRequests) {
      return res.status(429).json({
        success: false,
        error: options.errorMessage,
      });
    }
    recent.push(now);
    buckets.set(key, recent);
    if (buckets.size > 5000) {
      for (const [k, list] of buckets.entries()) {
        const active = list.filter((ts) => ts > cutoff);
        if (active.length === 0) buckets.delete(k);
        else buckets.set(k, active);
      }
    }
    next();
  };
}

const adminAuthRateLimiter = createRateLimiter({
  maxRequests: 15,
  windowMs: 15 * 60 * 1000,
  errorMessage: 'ព្យាយាមចូល Admin ច្រើនដងពេក! សូមរង់ចាំ ១៥ នាទីសិន។',
});

const userAuthRateLimiter = createRateLimiter({
  maxRequests: 25,
  windowMs: 15 * 60 * 1000,
  errorMessage: 'សំណើចូលគណនីច្រើនដងពេក! សូមរង់ចាំបន្តិចរួចព្យាយាមម្តងទៀត។',
});

const paymentRateLimiter = createRateLimiter({
  maxRequests: 30,
  windowMs: 15 * 60 * 1000,
  errorMessage: 'ព្យាយាមផ្ទៀងផ្ទាត់ការបង់ប្រាក់ច្រើនដងពេក! សូមរង់ចាំបន្តិច។',
});

const aiApiRateLimiter = createRateLimiter({
  maxRequests: 35,
  windowMs: 5 * 60 * 1000,
  errorMessage: 'ប្រព័ន្ធស្កេន OCR / AI ទទួលសំណើច្រើនពេកបណ្តោះអាសន្ន! សូមរង់ចាំបន្តិច។',
});

const visitorHeartbeatLimiter = createRateLimiter({
  maxRequests: 60,
  windowMs: 5 * 60 * 1000,
  errorMessage: 'Too many requests.',
});

// Global HTTP security headers (iframe-compatible for AI Studio preview, safe for Google Sign-In popups)
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(self), microphone=(), geolocation=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
  res.setHeader(
    'Content-Security-Policy',
    "frame-ancestors 'self' https://aistudio.google.com https://*.google.com https://*.googleusercontent.com"
  );
  res.setHeader('X-DNS-Prefetch-Control', 'off');
  next();
});

// Strict Same-Origin CORS & Cross-Site Request Protection for API routes
app.use((req, res, next) => {
  if (!req.path.startsWith('/api') && !req.path.startsWith('/download-') && !req.path.endsWith('.zip')) {
    return next();
  }

  const origin = req.headers.origin;
  const hostHeader = req.headers['x-forwarded-host'] || req.headers.host;
  const sameOrigin = isSameHostOrigin(origin, hostHeader);

  if (sameOrigin && origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Vary', 'Origin');
  }

  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    if (origin && !sameOrigin) {
      return res.sendStatus(403);
    }
    return res.sendStatus(204);
  }

  // Enforce Origin match on state-changing requests to auth/admin/payment routes when Origin header is present
  const isSensitiveStateRoute =
    req.path.startsWith('/api/admin') ||
    req.path.startsWith('/api/auth') ||
    req.path.startsWith('/api/payments');
  if (
    isSensitiveStateRoute &&
    req.method !== 'GET' &&
    req.method !== 'HEAD' &&
    origin &&
    !sameOrigin
  ) {
    return res.status(403).json({
      success: false,
      error: 'Cross-origin request forbidden.',
    });
  }

  next();
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

  // 5. Round (preserve extracted number 1..300)
  if (raw?.round) {
    const rawRound = String(raw.round).replace(/[^0-9]/g, '');
    const roundNum = parseInt(rawRound, 10);
    if (!Number.isNaN(roundNum) && roundNum >= 1 && roundNum <= 300) {
      result.round = String(roundNum);
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
    const parsedExam = parseFlexibleDate(String(raw.examDate), 2012, 2035);
    if (parsedExam) result.examDate = parsedExam;
  }
  if (raw?.validUntil && !String(raw.validUntil).startsWith('0000')) {
    const rawValid = String(raw.validUntil).trim();
    const endPart = rawValid.includes('~') || rawValid.includes('～')
      ? (rawValid.split(/[~～]/).pop() || rawValid)
      : rawValid;
    const parsedValid = parseFlexibleDate(endPart, 2014, 2040) || parseFlexibleDate(rawValid, 2014, 2040);
    if (parsedValid) result.validUntil = parsedValid;
  }

  // 9. Passport Number (여권번호 / លេខលិខិតឆ្លងដែន)
  if (raw?.passportNo) {
    const rawPass = String(raw.passportNo).replace(/[^A-Za-z0-9]/g, '').toUpperCase().trim();
    if (rawPass.length >= 6) {
      result.passportNo = rawPass;
    }
  }

  // 10. Passport Expiry Date (여권 유효기간 / ថ្ងៃខែផុតកំណត់)
  if (raw?.passportExpiry && !String(raw.passportExpiry).startsWith('0000')) {
    const rawExp = String(raw.passportExpiry).trim();
    const parsedExp = parseFlexibleDate(rawExp, 2015, 2045);
    if (parsedExp) {
      result.passportExpiry = parsedExp;
    } else if (rawExp) {
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

  // Exam date: YYYY. MM. DD or YYYY-MM-DD or YYYY년 MM월 DD일 (including 시행일/응시일)
  const examDateMatch =
    textCorpus.match(/(?:시\s*험\s*일(?:\s*자|\s*시)?|시\s*행\s*일(?:\s*자)?|응\s*시\s*일(?:\s*자)?|Test\s*Date|Exam\s*Date)[\s\S]{0,40}?(\d{4})[.\-\s년/]+(\d{1,2})[.\-\s월/]+(\d{1,2})/i) ||
    textCorpus.match(/(\d{4})[.\-\s]+(\d{2})[.\-\s]+(\d{2})\s*\([제\s]*\d+회/);
  if (examDateMatch) {
    const y = examDateMatch[1];
    const m = examDateMatch[2].padStart(2, '0');
    const d = examDateMatch[3].padStart(2, '0');
    result.examDate = `${y}-${m}-${d}`;
  }

  // Round: 제 107 회 or 107회 or 시행회차/회차: 107
  const roundMatch =
    textCorpus.match(/(?:제\s*)?(\d{1,3})\s*회/i) ||
    textCorpus.match(/(?:시\s*행\s*회\s*차|시\s*험\s*회\s*차|회\s*차|Test\s*Held|Round)[\s\S]{0,30}?(\d{1,3})/i) ||
    textCorpus.match(/(\d{2,3})(?:st|nd|rd|th)/i);
  if (roundMatch) {
    result.round = roundMatch[1];
  }

  // Valid until: 2028. 08. 12 or START ~ END range
  const validRangeMatch = textCorpus.match(
    /(?:성\s*적\s*유\s*효\s*기\s*간|유\s*효\s*기\s*간|Valid\s*(?:Until|Period))[\s\S]{0,60}?[~～]\s*(\d{4})[.\-\s년/]+(\d{1,2})[.\-\s월/]+(\d{1,2})/i
  );
  const validMatch =
    validRangeMatch ||
    textCorpus.match(/(?:성\s*적\s*유\s*효\s*기\s*간|유\s*효\s*기\s*간|Valid\s*Until)[\s\S]{0,40}?(\d{4})[.\-\s년/]+(\d{1,2})[.\-\s월/]+(\d{1,2})/i);
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
app.post('/api/extract-documents', aiApiRateLimiter, async (req, res) => {
  try {
    const { arcFront, arcBack, topikCert, topikCertList, passport, passportList, pdfTexts } = req.body || {};

    const parts: any[] = [];
    const textRepresentations: string[] = [];

    const firstTopikUrl =
      topikCert ||
      (Array.isArray(topikCertList) && topikCertList.length > 0
        ? (typeof topikCertList[0] === 'string' ? topikCertList[0] : topikCertList[0]?.dataUrl)
        : null);
    const firstPassportUrl =
      passport ||
      (Array.isArray(passportList) && passportList.length > 0
        ? (typeof passportList[0] === 'string' ? passportList[0] : passportList[0]?.dataUrl)
        : null);

    // Collect any extracted digital PDF text sent by the browser
    if (pdfTexts && typeof pdfTexts === 'object') {
      for (const [k, v] of Object.entries(pdfTexts)) {
        if (typeof v === 'string' && v.trim()) {
          textRepresentations.push(v.trim());
          parts.push({
            text: `[Extracted PDF Digital Text for ${k}]:\n${v.trim().slice(0, 6000)}`,
          });
        }
      }
    }

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
          (!mime.startsWith('image/') && mime !== 'application/pdf')
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

    if (parts.length === 0) {
      return res.json({
        success: false,
        fallbackMode: true,
        notice: 'សូម Upload ឯកសារជាមុនសិន មុននឹងចាប់ផ្តើមស្កេន OCR។',
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
7. address: Latest Korean residence address on the back of the card (체류지 / 체류지 변경사항 table). Read EVERY row carefully (including road name 도로명, building number 건물번호, and multi-line wrapped 동/호 details), ignore the printed fine notice ("새로운 체류지... 14일 이내..."), and return ONLY the row with the MOST RECENT 신고일 (Report Date) or bottom-most entered row.
8. passportNo: Passport Number (여권번호 / Passport No.) if a passport is uploaded.
9. passportExpiry: Passport Date of Expiry formatted as YYYY-MM-DD.

CRITICAL INSTRUCTIONS FOR TOPIK SCORE CERTIFICATE (한국어능력시험 성적증명서):
1. docVerificationNo: 문서확인번호 (16 digits at top-right header, returned as array of 4 strings of 4 digits each).
2. examNumber: 수험번호 (10 to 16 numeric digits in the table).
3. round: 회 / 회차 / 시행회차 numeric digits ONLY (e.g. from "제 93 회", "107회", or "The 93rd Test" extract "93" or "107").
4. examDate: 시험일 / 시행일 / Test Date formatted STRICTLY as YYYY-MM-DD (NEVER return 생년월일 Birth Date or 발급일 Issue Date).
5. validUntil: 성적유효기간 / Valid Until formatted STRICTLY as YYYY-MM-DD. If printed as a range like "2024.05.30 ~ 2026.05.30", ALWAYS return the END/EXPIRATION date ("2026-05-30").
6. grade: 등급 (1급, 2급, 3급, 4급, 5급, or 6급).

Return ONLY structured JSON according to the schema.
`;

    parts.push({ text: extractionPrompt });

    // Also parse digital PDF texts upfront as a structured safety net
    const parsedFromPdfTexts =
      pdfTexts && typeof pdfTexts === 'object'
        ? sanitizeExtractedData(
            parseStructuredTextCorpus({
              arcFrontText: String(pdfTexts.arcFront || ''),
              arcBackText: String(pdfTexts.arcBack || ''),
              topikText: String(pdfTexts.topikCert || ''),
              passportText: String(pdfTexts.passport || ''),
            })
          )
        : {};

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
        examDate: { type: Type.STRING, description: "TOPIK 시험일 / 시행일 / Test Date in YYYY-MM-DD format (not birth date)" },
        round: { type: Type.STRING, description: "TOPIK 제XX회 / 시행회차 numeric digits only (e.g. 93 or 107)" },
        validUntil: { type: Type.STRING, description: "TOPIK 성적유효기간 / Valid Until END date in YYYY-MM-DD format" },
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

    // Merge Gemini output with PDF digital text parse + raw preview
    const pdfRawPreview = pdfTexts && typeof pdfTexts === 'object'
      ? Object.entries(pdfTexts)
          .filter(([, v]) => typeof v === 'string' && v.trim())
          .map(([k, v]) => `[${k} PDF Text]\n${String(v).trim()}`)
          .join('\n\n')
          .slice(0, 2000)
      : '';

    if (extractedData) {
      let merged = { ...parsedFromPdfTexts, ...sanitizeExtractedData(extractedData) };
      const needsBackFill = Boolean(arcBack && !merged.address);
      const needsTopikFill = Boolean(
        firstTopikUrl &&
          (!merged.examDate || !merged.validUntil || !merged.round || !merged.examNumber || !merged.grade)
      );
      let rawTextPreview = pdfRawPreview;

      if (needsBackFill || needsTopikFill) {
        try {
          const targetedOcr = await runServerSideOcrFallback({
            arcBack: needsBackFill ? arcBack : null,
            topikCert: needsTopikFill ? firstTopikUrl : null,
            pdfTexts: pdfTexts && typeof pdfTexts === 'object' ? pdfTexts : undefined,
          });
          const sanitizedTargeted = sanitizeExtractedData(targetedOcr.data);
          merged = { ...sanitizedTargeted, ...merged };
          if (targetedOcr.rawTextPreview) {
            rawTextPreview = [rawTextPreview, targetedOcr.rawTextPreview].filter(Boolean).join('\n\n').slice(0, 3500);
          }
        } catch (gapErr) {
          console.warn('[OCR] Targeted gap-fill notice:', gapErr);
        }
      }

      if (Object.keys(merged).length > 0) {
        return res.json({
          success: true,
          data: merged,
          model: successfulModel,
          ...(rawTextPreview ? { rawTextPreview } : {}),
        });
      }
    }

    // Run server-side Node Tesseract + structured PDF/SVG/Text OCR fallback
    try {
      const ocrFallback = await runServerSideOcrFallback({
        arcFront,
        arcBack,
        topikCert: firstTopikUrl,
        passport: firstPassportUrl,
        pdfTexts: pdfTexts && typeof pdfTexts === 'object' ? pdfTexts : undefined,
      });

      const sanitizedServerOcr = { ...parsedFromPdfTexts, ...sanitizeExtractedData(ocrFallback.data) };
      if (Object.keys(sanitizedServerOcr).length > 0) {
        console.log('[OCR] Successfully extracted document fields via server-side Tesseract/PDF parser.');
        return res.json({
          success: true,
          data: sanitizedServerOcr,
          model: 'server-ocr-tesseract',
          rawTextPreview: ocrFallback.rawTextPreview || pdfRawPreview,
        });
      }

      // Also check legacy textRepresentations if present
      if (textRepresentations.length > 0) {
        const combinedCorpus = textRepresentations.join('\n');
        const fallbackResult = extractFromSvgOrText(combinedCorpus);
        const sanitizedFallback = sanitizeExtractedData(fallbackResult);
        if (Object.keys(sanitizedFallback).length > 0) {
          console.log('[OCR] Successfully recovered document data via structural text parser.');
          return res.json({
            success: true,
            data: sanitizedFallback,
            model: 'server-text-parser',
            rawTextPreview: ocrFallback.rawTextPreview,
          });
        }
      }

      // Signal client to run secondary browser pass if server OCR detected 0 fields
      return res.json({
        success: false,
        fallbackMode: true,
        rawTextPreview: ocrFallback.rawTextPreview,
        notice: authErrorDetected
          ? 'Please verify GEMINI_API_KEY in Settings > Secrets. Trying browser OCR engine.'
          : 'Server OCR did not detect clear fields; trying browser OCR engine.',
        ...(lastErrorDetail ? { detail: lastErrorDetail } : {}),
      });
    } catch (ocrErr: any) {
      console.warn('[OCR] Server-side fallback failed:', ocrErr);
      return res.json({
        success: false,
        fallbackMode: true,
        notice: 'Using client-side OCR engine for direct image scanning.',
        ...(lastErrorDetail ? { detail: lastErrorDetail } : {}),
      });
    }
  } catch (error: any) {
    console.error('Unexpected error during document extraction:', error);
    return res.json({
      success: false,
      fallbackMode: true,
      notice: 'Using client-side OCR engine.',
    });
  }
});

// --- Payment Session & Strict Redeem Code Endpoints ---
const UNLOCK_COOKIE_NAME = 'kiip_unlock_session';
const UNLOCK_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const MASTER_PROMO_CODES = new Set(['199621147', 'KIIP-199621147', 'PROMO-199621147']);

function issueUnlockToken(method: string, ref: string): string {
  const payload = Buffer.from(
    JSON.stringify({
      type: 'pdf_unlock',
      method: method.slice(0, 40),
      ref: ref.slice(0, 64),
      iat: Date.now(),
      exp: Date.now() + UNLOCK_SESSION_TTL_MS,
    })
  ).toString('base64url');
  const sig = crypto
    .createHmac('sha256', SESSION_SIGNING_SECRET)
    .update(payload)
    .digest('base64url');
  return `${payload}.${sig}`;
}

function verifyUnlockToken(token: string): boolean {
  if (!token) return false;
  const parts = token.split('.');
  if (parts.length !== 2) return false;
  const [payload, sig] = parts;
  const expectedSig = crypto
    .createHmac('sha256', SESSION_SIGNING_SECRET)
    .update(payload)
    .digest('base64url');
  if (!safeEqualStrings(sig, expectedSig)) return false;
  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return Boolean(
      parsed &&
        parsed.type === 'pdf_unlock' &&
        typeof parsed.exp === 'number' &&
        Date.now() <= parsed.exp
    );
  } catch {
    return false;
  }
}

function grantUnlockCookie(req: express.Request, res: express.Response, method: string, ref: string) {
  const unlockToken = issueUnlockToken(method, ref);
  setHttpOnlyCookie(
    req,
    res,
    UNLOCK_COOKIE_NAME,
    unlockToken,
    Math.floor(UNLOCK_SESSION_TTL_MS / 1000)
  );
}

app.get('/api/payments/unlock-status', (req, res) => {
  const cookies = parseCookies(req);
  const unlocked = verifyUnlockToken(cookies[UNLOCK_COOKIE_NAME] || '');
  return res.json({ success: true, unlocked });
});

app.post('/api/payments/aba-session', paymentRateLimiter, (_req, res) => {
  return res.status(501).json({
    success: false,
    error: 'ABA automated API session is disabled. Scan the ABA PayWay QR and send your receipt or enter a Redeem Code.',
  });
});

app.post('/api/payments/aba-confirm', paymentRateLimiter, (_req, res) => {
  return res.status(501).json({
    success: false,
    error: 'Automatic ABA PayWay callback is not active. Please submit your payment screenshot via Telegram Bot / Facebook Page to receive a verified Redeem Code.',
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

type UnlockErrorCode =
  | 'EMPTY'
  | 'NOT_FOUND'
  | 'ALREADY_USED'
  | 'REVOKED'
  | 'PAYMENT_REQUIRED'
  | 'INACTIVE'
  | 'EXPIRED'
  | 'LIMIT_REACHED'
  | 'WRONG_BOX_PROMO'
  | 'WRONG_BOX_REDEEM';

function localizeCodeError(errorCode: UnlockErrorCode, lang: string): string {
  const l = String(lang || 'km').toLowerCase();
  if (l === 'ko') {
    switch (errorCode) {
      case 'EMPTY':
        return '리딤 코드 또는 프로모션 코드를 입력해 주세요.';
      case 'PAYMENT_REQUIRED':
        return '결제가 확인되지 않은 Google Sheet 리딤 코드입니다. 계좌이체 또는 ABA 결제 완료 후 코드를 사용해 주세요.';
      case 'WRONG_BOX_PROMO':
        return '이 코드는 프로모션 코드입니다. 별도의 "프로모션 코드(Promo Code)" 입력란에 입력해 주세요.';
      case 'WRONG_BOX_REDEEM':
        return '이 코드는 결제 완료된 리딤 코드입니다. "리딤 코드(Redeem Code)" 입력란에 입력해 주세요.';
      case 'ALREADY_USED':
        return '이미 사용된 일회용 코드입니다. 새 코드를 입력해 주세요.';
      case 'REVOKED':
        return '취소되었거나 비활성화된 코드입니다.';
      case 'INACTIVE':
        return '비활성화된 프로모션 코드입니다.';
      case 'EXPIRED':
        return '만료된 프로모션 코드입니다.';
      case 'LIMIT_REACHED':
        return '사용 한도가 모두 소진된 프로모션 코드입니다.';
      case 'NOT_FOUND':
      default:
        return '시스템에서 일치하는 코드를 찾을 수 없습니다. 오타나 공백을 다시 확인해 주세요.';
    }
  }
  if (l === 'en') {
    switch (errorCode) {
      case 'EMPTY':
        return 'Please enter a Redeem Code or Promo Code.';
      case 'PAYMENT_REQUIRED':
        return 'Payment required! This Google Sheet Redeem Code has not been paid/activated yet. Please complete payment via Korea Bank or ABA PayWay first.';
      case 'WRONG_BOX_PROMO':
        return 'This is a Promo Code. Please enter it in the separate Promo Code box.';
      case 'WRONG_BOX_REDEEM':
        return 'This is a Paid Redeem Code. Please enter it in the Redeem Code box.';
      case 'ALREADY_USED':
        return 'This single-use code has already been redeemed.';
      case 'REVOKED':
        return 'This code has been revoked or disabled.';
      case 'INACTIVE':
        return 'This promo code is currently inactive.';
      case 'EXPIRED':
        return 'This promo code has expired.';
      case 'LIMIT_REACHED':
        return 'This promo code has reached its maximum usage limit.';
      case 'NOT_FOUND':
      default:
        return 'Code not found. Please double-check your code and make sure you are using the right box.';
    }
  }
  // Default: Khmer
  switch (errorCode) {
    case 'EMPTY':
      return 'សូមបញ្ចូលលេខកូដ Redeem Code ឬ Promo Code!';
    case 'PAYMENT_REQUIRED':
      return 'លេខកូដ Redeem Code (Google Sheet) នេះមិនទាន់បានបង់ប្រាក់ទេ! សូមបង់ប្រាក់តាមធនាគារកូរ៉េ ឬ ABA PayWay ជាមុនសិន ទើបប្រព័ន្ធ ឬ Admin បើកសិទ្ធិដោះសោបាន។';
    case 'WRONG_BOX_PROMO':
      return 'នេះជាលេខកូដ Promo Code! សូមយកទៅវាយបញ្ចូលក្នុង "ប្រអប់ Promo Code ផ្សេង" វិញ។';
    case 'WRONG_BOX_REDEEM':
      return 'នេះជាលេខកូដ Redeem Code! សូមយកទៅវាយបញ្ចូលក្នុង "ប្រអប់ Redeem Code" វិញ។';
    case 'ALREADY_USED':
      return 'លេខកូដដោះសោនេះត្រូវបានប្រើប្រាស់រួចហើយ (Used)! សូមប្រើលេខកូដថ្មីផ្សេងទៀត។';
    case 'REVOKED':
      return 'លេខកូដនេះត្រូវបានផ្អាក ឬផុតសុពលភាព (Revoked)!';
    case 'INACTIVE':
      return 'លេខកូដ Promo Code នេះត្រូវបានផ្អាកដំណើរការ!';
    case 'EXPIRED':
      return 'លេខកូដ Promo Code នេះបានផុតកំណត់ហើយ!';
    case 'LIMIT_REACHED':
      return 'លេខកូដ Promo Code នេះត្រូវបានប្រើអស់ចំនួនកំណត់ហើយ!';
    case 'NOT_FOUND':
    default:
      return 'រកមិនឃើញលេខកូដនេះក្នុងប្រព័ន្ធឡើយ! សូមពិនិត្យអក្សរឡើងវិញ ឬបង់ប្រាក់ដើម្បីទទួលលេខកូដ។';
  }
}

async function lookupFirestorePromoCode(
  code: string,
  firebaseIdToken?: string
): Promise<{
  code: string;
  centerId: string;
  monthLabel: string;
  usageLimit: number;
  usageCount: number;
  expiresAt: string;
  isActive: boolean;
} | null> {
  if (!FIREBASE_PROJECT_ID) return null;
  const safeCode = String(code || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, '')
    .slice(0, 64);
  if (safeCode.length < 3 || !/^[A-Z0-9_-]{3,64}$/.test(safeCode)) return null;
  try {
    const headers: Record<string, string> = {};
    if (firebaseIdToken && firebaseIdToken.length <= 8192) {
      const verifiedUser = await verifyFirebaseIdToken(firebaseIdToken);
      if (verifiedUser) {
        headers.Authorization = `Bearer ${firebaseIdToken}`;
      }
    }
    const fsResp = await fetch(
      `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(FIREBASE_PROJECT_ID)}/databases/${encodeURIComponent(FIREBASE_DATABASE_ID)}/documents/promoCodes/${encodeURIComponent(safeCode)}`,
      {
        headers,
        signal: AbortSignal.timeout(6000),
      }
    ).catch(() => null);
    if (!fsResp || !fsResp.ok) return null;
    const fsDoc = (await fsResp.json().catch(() => null)) as any;
    const fields = fsDoc?.fields;
    if (!fields || typeof fields !== 'object') return null;

    const readInt = (f: any, fallback: number): number => {
      if (!f) return fallback;
      if (f.integerValue !== undefined) return Number(f.integerValue);
      if (f.doubleValue !== undefined) return Math.floor(Number(f.doubleValue));
      return fallback;
    };

    return {
      code: String(fields.code?.stringValue || safeCode).toUpperCase(),
      centerId: String(fields.centerId?.stringValue || 'general'),
      monthLabel: String(fields.monthLabel?.stringValue || ''),
      usageLimit: Math.max(1, readInt(fields.usageLimit, 50)),
      usageCount: Math.max(0, readInt(fields.usageCount, 0)),
      expiresAt: String(fields.expiresAt?.stringValue || ''),
      isActive: fields.isActive?.booleanValue !== false,
    };
  } catch {
    return null;
  }
}

app.post('/api/payments/verify-redeem', paymentRateLimiter, async (req, res) => {
  const rawCode = String(req.body?.code || '').trim().toUpperCase();
  const userEmail = String(req.body?.userEmail || '').trim().slice(0, 160);
  const lang = String(req.body?.lang || 'km').trim().toLowerCase();
  const mode: 'redeem' | 'promo' = req.body?.mode === 'promo' ? 'promo' : 'redeem';
  const firebaseIdToken = String(req.body?.firebaseIdToken || '').trim();

  if (!rawCode) {
    return res.status(400).json({
      success: false,
      errorCode: 'EMPTY',
      error: localizeCodeError('EMPTY', lang),
    });
  }

  // ============================================================================
  // MODE A: SEPARATE PROMO CODE BOX (Free / Admin Promo Codes ONLY — never bypasses paid Google Sheet codes!)
  // ============================================================================
  if (mode === 'promo') {
    if (MASTER_PROMO_CODES.has(rawCode)) {
      grantUnlockCookie(req, res, 'promo', rawCode);
      return res.json({ success: true, type: 'promo', code: rawCode });
    }

    try {
      let promoCheck = verifyAndIncrementServerPromoCode(rawCode);
      // If not yet mirrored in Server SQLite (or if Admin updated its status/limit/expiry in Firestore),
      // verify live by exact code ID against Cloud Firestore /promoCodes/{CODE} (works for BOTH guests and signed-in users!)
      // and automatically mirror it into SQLite!
      if (!promoCheck.ok) {
        const fsPromo = await lookupFirestorePromoCode(rawCode, firebaseIdToken || undefined);
        if (fsPromo) {
          upsertServerPromoCode({
            code: fsPromo.code,
            centerId: fsPromo.centerId,
            monthLabel: fsPromo.monthLabel,
            usageLimit: fsPromo.usageLimit,
            usageCount: fsPromo.usageCount,
            expiresAt: fsPromo.expiresAt,
            isActive: fsPromo.isActive,
            preserveUsageCount: true,
          });
          promoCheck = verifyAndIncrementServerPromoCode(fsPromo.code);
        }
      }
      if (promoCheck.ok && promoCheck.promo) {
        grantUnlockCookie(req, res, 'admin_promo', promoCheck.promo.code);
        return res.json({
          success: true,
          type: 'admin_promo',
          code: promoCheck.promo.code,
          centerId: promoCheck.promo.centerId,
          usageCount: promoCheck.promo.usageCount,
          usageLimit: promoCheck.promo.usageLimit,
        });
      }
      if (
        promoCheck.errorCode === 'EXPIRED' ||
        promoCheck.errorCode === 'INACTIVE' ||
        promoCheck.errorCode === 'LIMIT_REACHED'
      ) {
        return res.status(promoCheck.statusCode).json({
          success: false,
          errorCode: promoCheck.errorCode,
          error: localizeCodeError(promoCheck.errorCode, lang),
        });
      }
    } catch (err) {
      console.error('[PromoDB] Verification error:', err);
    }

    // Read-only check: if the user pasted a Google Sheet / Redeem DB code into the Promo box, guide them clearly
    try {
      const redeemLookup = checkRedeemCodeStatus(rawCode);
      if (redeemLookup.found && redeemLookup.record) {
        if (!redeemLookup.record.is_paid) {
          return res.status(402).json({
            success: false,
            errorCode: 'PAYMENT_REQUIRED',
            error: localizeCodeError('PAYMENT_REQUIRED', lang),
          });
        }
        return res.status(400).json({
          success: false,
          errorCode: 'WRONG_BOX_REDEEM',
          error: localizeCodeError('WRONG_BOX_REDEEM', lang),
        });
      }
    } catch {
      // ignore read-only diagnostic errors
    }

    return res.status(404).json({
      success: false,
      errorCode: 'NOT_FOUND',
      error: localizeCodeError('NOT_FOUND', lang),
    });
  }

  // ============================================================================
  // MODE B: PAID REDEEM CODE BOX (Google Sheet 10,000 codes & Redeem DB — MUST BE PAID FIRST!)
  // ============================================================================
  try {
    let dbCheck = verifyAndBurnRedeemCode(rawCode, userEmail || 'web_user');
    if (!dbCheck.ok && dbCheck.statusCode === 404) {
      const syncResult = await ensureGoogleSheetSynced({ cooldownMs: 30_000 });
      if (syncResult?.success && syncResult.rowsRead > 0) {
        dbCheck = verifyAndBurnRedeemCode(rawCode, userEmail || 'web_user');
      }
    }
    if (dbCheck.ok && dbCheck.record) {
      const issued = issuedUnlockCodes.get(rawCode);
      if (issued) {
        issued.used = true;
        issued.usedAt = Date.now();
      }
      grantUnlockCookie(req, res, dbCheck.record.source || 'redeem', dbCheck.record.code);
      return res.json({
        success: true,
        type: dbCheck.record.source || 'redeem',
        code: dbCheck.record.code,
        status: 'Used',
      });
    }
    if (dbCheck.statusCode === 402 && dbCheck.errorCode === 'PAYMENT_REQUIRED') {
      return res.status(402).json({
        success: false,
        errorCode: 'PAYMENT_REQUIRED',
        error: localizeCodeError('PAYMENT_REQUIRED', lang),
      });
    }
    if (dbCheck.statusCode === 409 || dbCheck.statusCode === 403) {
      const errCode = dbCheck.errorCode === 'REVOKED' ? 'REVOKED' : 'ALREADY_USED';
      return res.status(dbCheck.statusCode).json({
        success: false,
        errorCode: errCode,
        error: localizeCodeError(errCode, lang),
      });
    }
  } catch (err) {
    console.error('[RedeemDB] Verification error:', err);
  }

  // Fallback check in-memory issued unlock codes (only created after verified Korea Bank / Telegram payment)
  const issued = issuedUnlockCodes.get(rawCode);
  if (issued) {
    if (issued.used) {
      return res.status(409).json({
        success: false,
        errorCode: 'ALREADY_USED',
        error: localizeCodeError('ALREADY_USED', lang),
      });
    }
    issued.used = true;
    issued.usedAt = Date.now();
    grantUnlockCookie(req, res, issued.source, issued.code);
    return res.json({ success: true, type: issued.source, code: issued.code });
  }

  // Guide user if they entered a Promo Code inside the Redeem Code box
  if (MASTER_PROMO_CODES.has(rawCode) || checkServerPromoCodeExists(rawCode)) {
    return res.status(400).json({
      success: false,
      errorCode: 'WRONG_BOX_PROMO',
      error: localizeCodeError('WRONG_BOX_PROMO', lang),
    });
  }

  {
    const fsPromo = await lookupFirestorePromoCode(rawCode, firebaseIdToken || undefined);
    if (fsPromo) {
      upsertServerPromoCode({
        code: fsPromo.code,
        centerId: fsPromo.centerId,
        monthLabel: fsPromo.monthLabel,
        usageLimit: fsPromo.usageLimit,
        usageCount: fsPromo.usageCount,
        expiresAt: fsPromo.expiresAt,
        isActive: fsPromo.isActive,
        preserveUsageCount: true,
      });
      return res.status(400).json({
        success: false,
        errorCode: 'WRONG_BOX_PROMO',
        error: localizeCodeError('WRONG_BOX_PROMO', lang),
      });
    }
  }

  return res.status(404).json({
    success: false,
    errorCode: 'NOT_FOUND',
    error: localizeCodeError('NOT_FOUND', lang),
  });
});

// ============================================================================
// SECURE ADMIN AUTHENTICATION (Server-Side scrypt + HMAC Bearer Session Token)
// ============================================================================
const SESSION_SIGNING_SECRET = getOrCreateSessionSigningSecret();
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

function issueAdminBearerToken(username: string, role: AdminAccountRole = 'root_admin'): string {
  const payload = Buffer.from(
    JSON.stringify({
      sub: username,
      role,
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

function verifyAdminBearerToken(token: string): { sub: string; role: AdminAccountRole } | null {
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
    if (!parsed || typeof parsed.exp !== 'number' || Date.now() > parsed.exp) {
      return null;
    }
    const rawRole = String(parsed.role || '');
    if (rawRole !== 'root_admin' && rawRole !== 'manager' && rawRole !== 'admin') {
      return null;
    }
    const normalizedRole: AdminAccountRole = rawRole === 'manager' ? 'manager' : 'root_admin';
    return { sub: String(parsed.sub || 'Admin'), role: normalizedRole };
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

function requireRootAdminAuth(req: express.Request, res: express.Response, next: express.NextFunction) {
  const authHeader = String(req.headers.authorization || '');
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  const verified = verifyAdminBearerToken(token);
  if (!verified) {
    return res.status(401).json({ success: false, error: 'Unauthorized admin session' });
  }
  if (verified.role !== 'root_admin') {
    return res.status(403).json({
      success: false,
      error: 'សិទ្ធិត្រូវបានបដិសេធ! មានតែ Root Admin ប៉ុណ្ណោះដែលអាចគ្រប់គ្រងគណនី Admin/Staff បាន។',
    });
  }
  (req as any).adminSession = verified;
  next();
}

app.get('/api/admin/auth-status', (req, res) => {
  const hasEnvCredentials = Boolean(process.env.ADMIN_PASSWORD && process.env.ADMIN_PASSWORD.trim().length > 0);
  const hasDbAccounts = listAdminAccounts().length > 0;
  const authHeader = String(req.headers.authorization || '');
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  const session = verifyAdminBearerToken(token);
  return res.json({
    success: true,
    needsSetup: !hasEnvCredentials && !claimedAdmin && !hasDbAccounts,
    configuredViaEnv: hasEnvCredentials,
    authenticated: Boolean(session),
    username: session?.sub || null,
    role: session?.role || null,
  });
});

// Protected Source Code / PC Package ZIP download (Root Admin Only, strictly excludes DB/secrets)
app.get(
  [
    '/api/download-source-zip',
    '/download-source-zip',
    '/kiip-source-code.zip',
    '/api/download-pc-package',
    '/download-pc-package',
    '/kiip-topik-pc-package.zip',
  ],
  requireRootAdminAuth,
  (_req, res) => {
    try {
      const zipPath = '/tmp/kiip-portal-source-code.zip';
      const pythonScript = [
        'import zipfile, os',
        "base_dir = os.path.abspath('.')",
        "zip_path = '/tmp/kiip-portal-source-code.zip'",
        "excluded_dirs = {'node_modules', 'dist', 'dist-pc', '.git', '__pycache__', '.aistudio', 'data'}",
        "excluded_files = {'kiip-portal-source-code.zip', 'kiip-topik-pc-package.zip', 'firebase-applet-config.json', 'server.js'}",
        "with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as z:",
        '    for root, dirs, files in os.walk(base_dir):',
        "        dirs[:] = [d for d in dirs if d not in excluded_dirs and not d.startswith('.git')]",
        '        for file in files:',
        "            lower = file.lower()",
        "            if file in excluded_files or lower.startswith('.env') or lower.endswith(('.pyc', '.traineddata', '.sqlite', '.sqlite3', '.db', '.db-wal', '.db-shm')):",
        '                continue',
        '            full_path = os.path.join(root, file)',
        '            rel_path = os.path.relpath(full_path, base_dir)',
        '            z.write(full_path, rel_path)',
      ].join('\n');

      execFileSync('python3', ['-c', pythonScript], { stdio: 'ignore', timeout: 25000 });
      if (fs.existsSync(zipPath)) {
        const stats = fs.statSync(zipPath);
        res.setHeader('Content-Type', 'application/zip');
        res.setHeader('Content-Disposition', 'attachment; filename="kiip-portal-source-code.zip"');
        res.setHeader('Content-Length', stats.size.toString());
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        const stream = fs.createReadStream(zipPath);
        return stream.pipe(res);
      }
      return res.status(500).json({ success: false, error: 'Archive generation failed.' });
    } catch (err) {
      console.error('[Download ZIP] Error:', err);
      return res.status(500).json({ success: false, error: 'Archive generation failed.' });
    }
  }
);

// One-time first-run admin setup (locked once claimed, DB accounts exist, or ADMIN_PASSWORD env var is set)
app.post('/api/admin/bootstrap', adminAuthRateLimiter, (req, res) => {
  const hasEnvCredentials = Boolean(process.env.ADMIN_PASSWORD && process.env.ADMIN_PASSWORD.trim().length > 0);
  if (hasEnvCredentials || claimedAdmin || listAdminAccounts().length > 0) {
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

  const token = issueAdminBearerToken(username, 'root_admin');
  return res.json({
    success: true,
    token,
    username,
    role: 'root_admin',
  });
});

app.post('/api/admin/login', adminAuthRateLimiter, (req, res) => {
  const username = String(req.body?.username || '').trim();
  const password = String(req.body?.password || '');

  if (!username || !password) {
    return res.status(400).json({
      success: false,
      error: 'សូមបញ្ចូល Admin ID និង Password!',
    });
  }

  // 1. Check persistent SQLite admin & delegated staff/manager accounts first
  const dbAuth = verifyDbAdminLogin(username, password);
  if (dbAuth.ok && dbAuth.username) {
    const role: AdminAccountRole = dbAuth.role === 'root_admin' ? 'root_admin' : 'manager';
    const token = issueAdminBearerToken(dbAuth.username, role);
    return res.json({ success: true, token, username: dbAuth.username, role });
  }

  // 2. Check configured environment secret (ADMIN_USERNAME / ADMIN_PASSWORD)
  const envPass = process.env.ADMIN_PASSWORD?.trim();
  if (envPass) {
    const envUser = (process.env.ADMIN_USERNAME || 'Admin').trim();
    const userMatch = safeEqualStrings(username.toLowerCase(), envUser.toLowerCase());
    const passMatch = safeEqualStrings(password, envPass);
    if (userMatch && passMatch) {
      const token = issueAdminBearerToken(envUser, 'root_admin');
      return res.json({ success: true, token, username: envUser, role: 'root_admin' });
    }
    return res.status(401).json({
      success: false,
      error: 'Admin ID ឬ Password មិនត្រឹមត្រូវ!',
    });
  }

  // 3. Check in-memory first-run claimed admin (if any)
  if (claimedAdmin) {
    const userMatch = safeEqualStrings(username.toLowerCase(), claimedAdmin.username.toLowerCase());
    const candidateHash = hashPasswordScrypt(password, claimedAdmin.salt);
    const passMatch = safeEqualStrings(candidateHash, claimedAdmin.passwordHash);
    if (userMatch && passMatch) {
      const token = issueAdminBearerToken(claimedAdmin.username, 'root_admin');
      return res.json({ success: true, token, username: claimedAdmin.username, role: 'root_admin' });
    }
    return res.status(401).json({
      success: false,
      error: 'Admin ID ឬ Password មិនត្រឹមត្រូវ!',
    });
  }

  if (listAdminAccounts().length === 0) {
    return res.status(409).json({
      success: false,
      needsSetup: true,
      error: 'Admin account not initialized yet. Complete first-run setup.',
    });
  }

  return res.status(401).json({
    success: false,
    error: 'Admin ID ឬ Password មិនត្រឹមត្រូវ!',
  });
});

app.post('/api/admin/logout', (req, res) => {
  const authHeader = String(req.headers.authorization || '');
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  if (token) {
    revokedAdminTokens.add(token);
  }
  return res.json({ success: true });
});

// Root Admin Google Sign-In Verification (Verifies Firebase ID Token RS256 signature via Google JWKS)
const ROOT_ADMIN_EMAIL = 'zeekhmerads@gmail.com';
const FIREBASE_CONFIG_JSON = (() => {
  try {
    const raw = fs.readFileSync(path.join(__dirname, 'firebase-applet-config.json'), 'utf8');
    return JSON.parse(raw) as { projectId?: string; firestoreDatabaseId?: string };
  } catch {
    return {};
  }
})();
const FIREBASE_PROJECT_ID = String(FIREBASE_CONFIG_JSON?.projectId || '').trim();
const FIREBASE_DATABASE_ID = String(FIREBASE_CONFIG_JSON?.firestoreDatabaseId || '(default)').trim() || '(default)';

let cachedGoogleJwks: { keys: any[]; fetchedAt: number } | null = null;

async function fetchGoogleSecureTokenJwk(kid: string): Promise<any | null> {
  const now = Date.now();
  if (!cachedGoogleJwks || now - cachedGoogleJwks.fetchedAt > 60 * 60 * 1000) {
    const resp = await fetch(
      'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com',
      { signal: AbortSignal.timeout(8000) }
    );
    if (!resp.ok) return null;
    const json = (await resp.json()) as { keys?: any[] };
    cachedGoogleJwks = { keys: Array.isArray(json.keys) ? json.keys : [], fetchedAt: now };
  }
  let match = cachedGoogleJwks.keys.find((k) => k?.kid === kid);
  if (!match) {
    // Refresh once on key rotation miss
    const resp = await fetch(
      'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com',
      { signal: AbortSignal.timeout(8000) }
    );
    if (resp.ok) {
      const json = (await resp.json()) as { keys?: any[] };
      cachedGoogleJwks = { keys: Array.isArray(json.keys) ? json.keys : [], fetchedAt: Date.now() };
      match = cachedGoogleJwks.keys.find((k) => k?.kid === kid);
    }
  }
  return match || null;
}

async function verifyFirebaseIdToken(
  idToken: string
): Promise<{ email: string; uid: string; emailVerified: boolean } | null> {
  if (!FIREBASE_PROJECT_ID || typeof idToken !== 'string') return null;
  const parts = idToken.split('.');
  if (parts.length !== 3) return null;

  const [headerB64, payloadB64, sigB64] = parts;
  let header: any;
  let payload: any;
  try {
    header = JSON.parse(Buffer.from(headerB64, 'base64url').toString('utf8'));
    payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
  } catch {
    return null;
  }

  if (header?.alg !== 'RS256' || typeof header?.kid !== 'string' || !header.kid) {
    return null;
  }

  const nowSec = Math.floor(Date.now() / 1000);
  if (
    payload?.aud !== FIREBASE_PROJECT_ID ||
    payload?.iss !== `https://securetoken.google.com/${FIREBASE_PROJECT_ID}` ||
    typeof payload?.sub !== 'string' ||
    !payload.sub ||
    typeof payload?.exp !== 'number' ||
    payload.exp <= nowSec ||
    typeof payload?.iat !== 'number' ||
    payload.iat > nowSec + 300 ||
    payload?.email_verified !== true ||
    typeof payload?.email !== 'string'
  ) {
    return null;
  }

  const jwk = await fetchGoogleSecureTokenJwk(header.kid);
  if (!jwk) return null;

  const pubKey = crypto.createPublicKey({ key: jwk, format: 'jwk' });
  const verified = crypto.verify(
    'RSA-SHA256',
    Buffer.from(`${headerB64}.${payloadB64}`, 'utf8'),
    pubKey,
    Buffer.from(sigB64, 'base64url')
  );
  if (!verified) return null;

  return {
    email: payload.email.toLowerCase(),
    uid: payload.sub,
    emailVerified: Boolean(payload.email_verified),
  };
}

async function verifyFirebaseAdminIdToken(
  idToken: string
): Promise<{ email: string; uid: string } | null> {
  const verified = await verifyFirebaseIdToken(idToken);
  if (!verified || verified.email !== ROOT_ADMIN_EMAIL) {
    return null;
  }
  return { email: verified.email, uid: verified.uid };
}

app.post('/api/payments/confirm-firebase-unlock', paymentRateLimiter, async (req, res) => {
  try {
    const idToken = String(req.body?.idToken || '').trim();
    const promoCode = String(req.body?.promoCode || '')
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9_-]/g, '')
      .slice(0, 64);
    if (!idToken || idToken.length > 8192 || !promoCode) {
      return res.status(400).json({ success: false, error: 'Invalid unlock verification request.' });
    }
    const verifiedUser = await verifyFirebaseIdToken(idToken);
    if (!verifiedUser) {
      return res.status(401).json({ success: false, error: 'Unauthorized Firebase session.' });
    }
    // Verify the promoCode document exists & is active via Firestore REST API before granting unlock cookie
    const fsResp = await fetch(
      `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(FIREBASE_PROJECT_ID)}/databases/${encodeURIComponent(FIREBASE_DATABASE_ID)}/documents/promoCodes/${encodeURIComponent(promoCode)}`,
      {
        headers: { Authorization: `Bearer ${idToken}` },
        signal: AbortSignal.timeout(6000),
      }
    ).catch(() => null);
    if (!fsResp || !fsResp.ok) {
      return res.status(403).json({ success: false, error: 'Invalid promo code record.' });
    }
    const fsDoc = (await fsResp.json().catch(() => null)) as any;
    const isActive = Boolean(fsDoc?.fields?.isActive?.booleanValue);
    if (!isActive) {
      return res.status(403).json({ success: false, error: 'Promo code is inactive.' });
    }
    grantUnlockCookie(req, res, 'firebase_promo', promoCode);
    return res.json({ success: true });
  } catch {
    return res.status(500).json({ success: false, error: 'Unable to confirm promo unlock.' });
  }
});

app.post('/api/admin/login-google', adminAuthRateLimiter, async (req, res) => {
  try {
    const idToken = String(req.body?.idToken || '').trim();
    if (!idToken || idToken.length > 8192) {
      return res.status(400).json({ success: false, error: 'Missing Firebase ID token.' });
    }
    const verified = await verifyFirebaseAdminIdToken(idToken);
    if (!verified) {
      return res.status(403).json({
        success: false,
        error: `សិទ្ធិត្រូវបានបដិសេធ! មានតែគណនី Google Admin (${ROOT_ADMIN_EMAIL}) ប៉ុណ្ណោះដែលអាចចូលបាន។`,
      });
    }
    const token = issueAdminBearerToken(verified.email, 'root_admin');
    return res.json({
      success: true,
      token,
      username: verified.email,
      role: 'root_admin',
    });
  } catch (err) {
    console.error('[Admin Google Login] Verification error:', err);
    return res.status(500).json({
      success: false,
      error: 'មានបញ្ហាផ្ទៀងផ្ទាត់គណនី Google Admin។ សូមព្យាយាមម្តងទៀត។',
    });
  }
});

// ============================================================================
// ROOT-ADMIN-ONLY DELEGATED ADMIN & STAFF ACCOUNT MANAGEMENT
// ============================================================================
app.get('/api/admin/accounts', requireRootAdminAuth, (_req, res) => {
  return res.json({
    success: true,
    accounts: listAdminAccounts(),
  });
});

app.post('/api/admin/accounts', requireRootAdminAuth, (req, res) => {
  const session = (req as any).adminSession as { sub: string; role: AdminAccountRole };
  const username = String(req.body?.username || '').trim();
  const displayName = String(req.body?.displayName || '').trim();
  const password = String(req.body?.password || '');
  const role: AdminAccountRole = req.body?.role === 'root_admin' ? 'root_admin' : 'manager';

  const result = createOrUpdateAdminAccount({
    username,
    displayName,
    password,
    role,
    createdBy: session?.sub || ROOT_ADMIN_EMAIL,
  });

  if (!result.ok) {
    return res.status(400).json({ success: false, error: result.error || 'Invalid account data' });
  }
  return res.json({ success: true, account: result.account });
});

app.patch('/api/admin/accounts/:id/status', requireRootAdminAuth, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ success: false, error: 'Invalid account ID' });
  }
  const updated = setAdminAccountActive(id, Boolean(req.body?.isActive));
  if (!updated) {
    return res.status(404).json({ success: false, error: 'Account not found' });
  }
  return res.json({ success: true });
});

app.patch('/api/admin/accounts/:id/password', requireRootAdminAuth, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ success: false, error: 'Invalid account ID' });
  }
  const password = String(req.body?.password || '');
  const result = updateAdminAccountPassword(id, password);
  if (!result.ok) {
    return res.status(400).json({ success: false, error: result.error || 'Failed to update password' });
  }
  return res.json({ success: true });
});

app.delete('/api/admin/accounts/:id', requireRootAdminAuth, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ success: false, error: 'Invalid account ID' });
  }
  const deleted = deleteAdminAccount(id);
  if (!deleted) {
    return res.status(404).json({ success: false, error: 'Account not found' });
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

app.post('/api/visitors/heartbeat', visitorHeartbeatLimiter, async (req, res) => {
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
    const persistentTotalVisits = Math.max(seenSessionIds.size, recordUniqueVisitSession(sessionId));

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
      totalVisits: persistentTotalVisits,
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
    totalVisits: Math.max(seenSessionIds.size, getTotalRecordedVisits()),
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
    totalVisits: Math.max(seenSessionIds.size, getTotalRecordedVisits()),
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

app.post('/api/analytics/event', aiApiRateLimiter, (req, res) => {
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

// Public Korea Bank receiving account details (overridable via Settings → Secrets)
function getKoreaBankPaymentInfo() {
  return {
    bankName: (process.env.KR_BANK_NAME || 'KOOKMIN BANK (KB 국민은행)').trim(),
    accountNumber: (process.env.KR_BANK_ACCOUNT || '893801-00-097236').trim(),
    accountHolder: (process.env.KR_BANK_HOLDER || 'EANG VEASNA').trim(),
  };
}

app.get('/api/admin/analytics', requireAdminAuth, (_req, res) => {
  const krBank = getKoreaBankPaymentInfo();
  return res.json({
    success: true,
    documents: serverDocumentsLog,
    payments: serverPaymentsLog,
    issuedUnlockCodes: Array.from(issuedUnlockCodes.values()).sort((a, b) => b.createdAt - a.createdAt),
    integrations: {
      krBankConfigured: Boolean(krBank.accountNumber),
      telegramConfigured: Boolean(process.env.TELEGRAM_BOT_TOKEN),
    },
  });
});

// ============================================================================
// KOREAN BANK TRANSFER RECEIPT VERIFICATION & TELEGRAM BOT AUTO-UNLOCK
// ============================================================================
interface KoreanReceiptChecks {
  isReceipt: boolean;
  recipientMatched: boolean;
  amountMatched: boolean;
  statusSuccess: boolean;
  timeVerified: boolean;
}

interface KoreanReceiptAnalysisResult {
  isValidReceipt: boolean;
  verdict: 'ពិត' | 'មិនពិត';
  amountKrw: number;
  bankName: string;
  recipientName: string;
  statusText: string;
  transferTimestamp: string;
  transferFingerprint: string;
  transferCompleted: boolean;
  checks: KoreanReceiptChecks;
  reason: string;
}

function getCurrentKstInfo(): { nowMs: number; kstDateTimeLabel: string } {
  const nowMs = Date.now();
  const kst = new Date(nowMs + 9 * 60 * 60 * 1000);
  const yyyy = kst.getUTCFullYear();
  const mm = String(kst.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(kst.getUTCDate()).padStart(2, '0');
  const hh = String(kst.getUTCHours()).padStart(2, '0');
  const mi = String(kst.getUTCMinutes()).padStart(2, '0');
  return {
    nowMs,
    kstDateTimeLabel: `${yyyy}-${mm}-${dd} ${hh}:${mi} KST`,
  };
}

function parseKstTimestampFromReceipt(
  dateIsoRaw: string,
  time24hRaw: string,
  rawText: string
): { valid: boolean; utcMs: number | null; displayLabel: string; fingerprintPart: string; hasTime: boolean } {
  const cleanDateIso = String(dateIsoRaw || '').trim();
  const cleanTime24h = String(time24hRaw || '').trim();
  const combinedRaw = String(rawText || '').trim();

  let year = 0;
  let month = 0;
  let day = 0;
  let hour: number | null = null;
  let minute: number | null = null;

  const isoDateMatch = cleanDateIso.match(/^(\d{4})[-./](\d{1,2})[-./](\d{1,2})$/);
  if (isoDateMatch) {
    year = Number(isoDateMatch[1]);
    month = Number(isoDateMatch[2]);
    day = Number(isoDateMatch[3]);
  } else {
    const rawDateMatch = combinedRaw.match(/(20\d{2})[.\-/년\s]+(\d{1,2})[.\-/월\s]+(\d{1,2})/);
    if (rawDateMatch) {
      year = Number(rawDateMatch[1]);
      month = Number(rawDateMatch[2]);
      day = Number(rawDateMatch[3]);
    }
  }

  if (!year || month < 1 || month > 12 || day < 1 || day > 31) {
    return { valid: false, utcMs: null, displayLabel: combinedRaw || '', fingerprintPart: '', hasTime: false };
  }

  const timeMatch =
    cleanTime24h.match(/^(\d{1,2}):(\d{2})/) ||
    combinedRaw.match(/(오전|오후|AM|PM)?\s*(\d{1,2})\s*[:시]\s*(\d{2})/i);

  if (timeMatch) {
    if (cleanTime24h.match(/^(\d{1,2}):(\d{2})/)) {
      const m = cleanTime24h.match(/^(\d{1,2}):(\d{2})/)!;
      hour = Number(m[1]);
      minute = Number(m[2]);
    } else {
      const m = combinedRaw.match(/(오전|오후|AM|PM)?\s*(\d{1,2})\s*[:시]\s*(\d{2})/i)!;
      const meridiem = (m[1] || '').toUpperCase();
      let h = Number(m[2]);
      const min = Number(m[3]);
      if ((meridiem === '오후' || meridiem === 'PM') && h < 12) h += 12;
      if ((meridiem === '오전' || meridiem === 'AM') && h === 12) h = 0;
      hour = h;
      minute = min;
    }
  }

  const mmStr = String(month).padStart(2, '0');
  const ddStr = String(day).padStart(2, '0');

  if (hour !== null && minute !== null && hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) {
    const hhStr = String(hour).padStart(2, '0');
    const miStr = String(minute).padStart(2, '0');
    const utcMs = Date.parse(`${year}-${mmStr}-${ddStr}T${hhStr}:${miStr}:00+09:00`);
    if (Number.isNaN(utcMs)) {
      return { valid: false, utcMs: null, displayLabel: combinedRaw, fingerprintPart: '', hasTime: false };
    }
    return {
      valid: true,
      utcMs,
      displayLabel: `${year}-${mmStr}-${ddStr} ${hhStr}:${miStr} (KST)`,
      fingerprintPart: `${year}-${mmStr}-${ddStr}_${hhStr}:${miStr}`,
      hasTime: true,
    };
  }

  // Date only (no HH:MM shown) — interpret as midday KST for date freshness check
  const utcMs = Date.parse(`${year}-${mmStr}-${ddStr}T12:00:00+09:00`);
  if (Number.isNaN(utcMs)) {
    return { valid: false, utcMs: null, displayLabel: combinedRaw, fingerprintPart: '', hasTime: false };
  }
  return {
    valid: true,
    utcMs,
    displayLabel: `${year}-${mmStr}-${ddStr} (KST)`,
    fingerprintPart: `${year}-${mmStr}-${ddStr}`,
    hasTime: false,
  };
}

function matchesExpectedKoreanRecipient(params: {
  recipientName: string;
  accountDigits: string;
  expectedHolder: string;
  expectedAccountDigits: string;
}): boolean {
  const { recipientName, accountDigits, expectedHolder, expectedAccountDigits } = params;
  const expectedTail4 = expectedAccountDigits.slice(-4);
  const expectedTail6 = expectedAccountDigits.slice(-6);

  // If account digits are visible (>= 4 digits) and clearly belong to a DIFFERENT account, reject immediately
  if (expectedTail4 && accountDigits.length >= 4 && !accountDigits.endsWith(expectedTail4)) {
    return false;
  }

  const accountConfirmedStrong = Boolean(expectedTail6 && accountDigits.endsWith(expectedTail6));
  const accountConfirmedTail4 = Boolean(expectedTail4 && accountDigits.endsWith(expectedTail4));

  const cleanRecipient = recipientName
    .toUpperCase()
    .replace(/[^A-Z0-9가-힣\s*]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const compactRecipient = cleanRecipient.replace(/[\s*]/g, '');

  const expectedTokens = expectedHolder
    .toUpperCase()
    .replace(/[^A-Z0-9가-힣\s]/g, ' ')
    .split(/\s+/)
    .filter((tok) => tok.length >= 2);
  const compactExpected = expectedTokens.join('');

  // Known Korean transliterations for default holder (EANG VEASNA)
  const isDefaultHolder = compactExpected === 'EANGVEASNA';
  const koreanAliases = isDefaultHolder
    ? ['이앙베아스나', '응베아스나', '에앙베아스나', '앙베아스나', '베아스나']
    : [];

  let nameMatched = false;
  if (compactRecipient && compactExpected) {
    if (
      compactRecipient.includes(compactExpected) ||
      compactExpected.includes(compactRecipient) && compactRecipient.length >= 6
    ) {
      nameMatched = true;
    } else if (expectedTokens.length >= 2) {
      const matchedTokens = expectedTokens.filter((tok) => compactRecipient.includes(tok));
      if (matchedTokens.length >= 2) {
        nameMatched = true;
      } else if (matchedTokens.length === 1 && accountConfirmedTail4) {
        // E.g. Korean bank masked display "EANG***" paired with matching last-4 account digits
        nameMatched = true;
      }
    } else if (expectedTokens.length === 1 && compactRecipient.includes(expectedTokens[0])) {
      nameMatched = true;
    }
  }

  if (!nameMatched && compactRecipient && koreanAliases.some((alias) => compactRecipient.includes(alias))) {
    nameMatched = true;
  }

  // Require either a verified recipient name match OR strong 6-digit account number match (when bank hides full name)
  if (nameMatched) return true;
  if (accountConfirmedStrong && !cleanRecipient) return true;
  return false;
}

async function analyzeKoreanBankReceiptWithGemini(
  imageBase64: string,
  mimeType: string,
  lang = 'km'
): Promise<KoreanReceiptAnalysisResult> {
  const emptyChecks: KoreanReceiptChecks = {
    isReceipt: false,
    recipientMatched: false,
    amountMatched: false,
    statusSuccess: false,
    timeVerified: false,
  };

  const ai = getAiClient();
  if (!ai) {
    return {
      isValidReceipt: false,
      verdict: 'មិនពិត',
      amountKrw: 0,
      bankName: '',
      recipientName: '',
      statusText: '',
      transferTimestamp: '',
      transferFingerprint: '',
      transferCompleted: false,
      checks: emptyChecks,
      reason:
        lang === 'ko'
          ? '서버에 자동 영수증 검증용 GEMINI_API_KEY가 설정되어 있지 않습니다.'
          : lang === 'en'
          ? 'GEMINI_API_KEY is not configured on the server for automated receipt inspection.'
          : 'ម៉ាស៊ីនមេមិនទាន់កំណត់ GEMINI_API_KEY សម្រាប់ផ្ទៀងផ្ទាត់វិក្កយបត្រដោយស្វ័យប្រវត្តិទេ។',
    };
  }

  const krBank = getKoreaBankPaymentInfo();
  const expectedHolder = krBank.accountHolder;
  const expectedAccountDigits = krBank.accountNumber.replace(/\D/g, '');
  const { nowMs, kstDateTimeLabel } = getCurrentKstInfo();
  const maxAgeHours = Math.max(1, Number(process.env.KR_RECEIPT_MAX_AGE_HOURS) || 72);

  const prompt = `You are a strict South Korean bank transfer receipt verification auditor.
Current server time in Korea Standard Time (KST): ${kstDateTimeLabel}.
Expected receiving account holder: "${expectedHolder}" (${krBank.bankName}, account ending in "${expectedAccountDigits.slice(-4)}").
Expected minimum transfer amount: 35,000 KRW (₩35,000).

Inspect the uploaded screenshot carefully and extract ONLY what is genuinely visible in the image:
1. isBankTransferScreenshot: true ONLY if this is a real bank transfer / remittance confirmation screen (KB 국민은행, 신한, 우리, 하나, NH농협, 카카오뱅크, 토스뱅크, 케이뱅크, IBK, 새마을금고, etc.). Return false for unrelated photos, edited blanks, or pre-transfer input forms.
2. transferCompleted: true ONLY if the screenshot clearly shows transfer completion/success (e.g., 이체완료, 송금완료, 출금완료, 이체 성공, Completed, Sent, Success). Return false for 예약이체 (scheduled), 실패 (failed), 취소 (cancelled), or confirm-before-sending screens.
3. statusText: exact completion/status text visible in the image (e.g., "이체완료", "송금완료", "Completed").
4. amountKrw: exact integer KRW amount transferred (e.g., 35000). Return 0 if not clearly visible.
5. bankName: bank or app name shown on the receipt.
6. recipientName: exact recipient / beneficiary name visible on the receipt (받는분 / 입금계좌 예금주 / 받는 사람). Return "" if not visible.
7. recipientAccountDigits: digits visible for the recipient account number (입금계좌번호), digits only. Return "" if not visible.
8. transferDateTimeRaw: exact transfer date and time string visible on the screenshot (거래일시 / 이체일시 / 송금일시). Return "" if not visible.
9. transferDateIso: normalized transfer date in "YYYY-MM-DD" (KST). Return "" if date is not visible.
10. transferTime24h: normalized transfer time in 24-hour "HH:MM" (KST). Return "" if time is not visible.
11. verdictKhmer: return "ពិត" ONLY if ALL conditions are clearly satisfied (genuine completed bank transfer + recipient matches "${expectedHolder}" + amount >= 35000 + valid transfer date/time visible); otherwise return "មិនពិត".

Return ONLY valid JSON matching the schema.`;

  const schema = {
    type: Type.OBJECT,
    properties: {
      isBankTransferScreenshot: { type: Type.BOOLEAN },
      transferCompleted: { type: Type.BOOLEAN },
      statusText: { type: Type.STRING },
      amountKrw: { type: Type.NUMBER },
      bankName: { type: Type.STRING },
      recipientName: { type: Type.STRING },
      recipientAccountDigits: { type: Type.STRING },
      transferDateTimeRaw: { type: Type.STRING },
      transferDateIso: { type: Type.STRING },
      transferTime24h: { type: Type.STRING },
      verdictKhmer: { type: Type.STRING },
    },
  };

  for (const model of ['gemini-4-hydrogen', 'gemini-3.1-flash-lite'] as const) {
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

      const isReceipt = Boolean(parsed.isBankTransferScreenshot);
      const statusSuccess = Boolean(parsed.transferCompleted);
      const statusText = String(parsed.statusText || (statusSuccess ? '이체완료' : '')).slice(0, 60);
      const amountKrw = Math.round(Number(parsed.amountKrw) || 0);
      const amountMatched = amountKrw >= 35000;
      const bankName = String(parsed.bankName || 'Korea Bank').slice(0, 60);
      const recipientName = String(parsed.recipientName || '').trim().slice(0, 100);
      const accountDigits = String(parsed.recipientAccountDigits || '').replace(/\D/g, '');
      const transferDateTimeRaw = String(parsed.transferDateTimeRaw || '').trim().slice(0, 80);
      const transferDateIso = String(parsed.transferDateIso || '').trim().slice(0, 20);
      const transferTime24h = String(parsed.transferTime24h || '').trim().slice(0, 10);

      const recipientMatched = matchesExpectedKoreanRecipient({
        recipientName,
        accountDigits,
        expectedHolder,
        expectedAccountDigits,
      });

      const parsedTime = parseKstTimestampFromReceipt(
        transferDateIso,
        transferTime24h,
        transferDateTimeRaw
      );

      const maxAgeMs = maxAgeHours * 60 * 60 * 1000;
      const futureToleranceMs = 20 * 60 * 1000; // allow 20 min phone clock skew
      let timeVerified = false;
      let timeFailureReason = '';

      if (!parsedTime.valid || parsedTime.utcMs === null) {
        timeVerified = false;
        timeFailureReason =
          lang === 'ko'
            ? '이체 일시(날짜·시간)가 보이지 않습니다. 거래일시가 포함된 전체 스크린샷을 업로드해 주세요.'
            : lang === 'en'
            ? 'Transfer date/time is not visible. Please upload the full screenshot showing the transfer timestamp.'
            : 'រកមិនឃើញកាលបរិច្ឆេទ និងពេលវេលាផ្ទេរប្រាក់លើរូបភាពទេ។ សូមថត Screenshot ពេញដែលបង្ហាញកាលបរិច្ឆេទ និងម៉ោងផ្ទេរប្រាក់!';
      } else {
        const diffMs = nowMs - parsedTime.utcMs;
        if (diffMs < -futureToleranceMs) {
          timeVerified = false;
          timeFailureReason =
            lang === 'ko'
              ? `영수증의 이체 시간(${parsedTime.displayLabel})이 현재 시각과 일치하지 않습니다.`
              : lang === 'en'
              ? `The receipt timestamp (${parsedTime.displayLabel}) is in the future and invalid.`
              : `ពេលវេលាលើវិក្កយបត្រ (${parsedTime.displayLabel}) មិនត្រឹមត្រូវតាមពេលវេលាបច្ចុប្បន្នទេ។`;
        } else if (diffMs > maxAgeMs) {
          timeVerified = false;
          timeFailureReason =
            lang === 'ko'
              ? `이체 시간(${parsedTime.displayLabel})이 유효 기간(${maxAgeHours}시간)을 초과했습니다. 최근 이체 내역을 업로드해 주세요.`
              : lang === 'en'
              ? `The transfer timestamp (${parsedTime.displayLabel}) is older than the ${maxAgeHours}-hour verification window.`
              : `ពេលវេលាផ្ទេរប្រាក់ (${parsedTime.displayLabel}) ចាស់លើសកំណត់ (${maxAgeHours} ម៉ោង)។ សូមប្រើវិក្កយបត្រផ្ទេរប្រាក់ថ្មីៗនេះ!`;
        } else {
          timeVerified = true;
        }
      }

      const checks: KoreanReceiptChecks = {
        isReceipt,
        recipientMatched,
        amountMatched,
        statusSuccess,
        timeVerified,
      };

      const transferTimestamp = parsedTime.displayLabel || transferDateTimeRaw;
      const transferFingerprint = parsedTime.fingerprintPart
        ? `${parsedTime.fingerprintPart}|${amountKrw}|${recipientName.toUpperCase().replace(/\s+/g, '') || expectedHolder.toUpperCase().replace(/\s+/g, '')}`
        : '';

      if (!isReceipt) {
        return {
          isValidReceipt: false,
          verdict: 'មិនពិត',
          amountKrw,
          bankName,
          recipientName,
          statusText,
          transferTimestamp,
          transferFingerprint,
          transferCompleted: false,
          checks,
          reason:
            lang === 'ko'
              ? '한국 은행 이체 확인 스크린샷이 아닙니다. 이체완료 화면을 업로드해 주세요.'
              : lang === 'en'
              ? 'This image is not a valid Korean bank transfer confirmation screenshot.'
              : 'រូបភាពនេះមិនមែនជាវិក្កយបត្រផ្ទេរប្រាក់ធនាគារកូរ៉េទេ។ សូម Upload Screenshot វិក្កយបត្រដែលមានពាក្យ 이체완료 / 송금완료។',
        };
      }

      if (!statusSuccess) {
        return {
          isValidReceipt: false,
          verdict: 'មិនពិត',
          amountKrw,
          bankName,
          recipientName,
          statusText,
          transferTimestamp,
          transferFingerprint,
          transferCompleted: false,
          checks,
          reason:
            lang === 'ko'
              ? '이체 완료 상태(이체완료 / 송금완료)가 확인되지 않았습니다.'
              : lang === 'en'
              ? 'Transfer completion status (이체완료 / Completed) is not confirmed on this screenshot.'
              : 'វិក្កយបត្រមិនទាន់បង្ហាញស្ថានភាពផ្ទេរប្រាក់ជោគជ័យ (이체완료 / 송금완료) ទេ។',
        };
      }

      if (!recipientMatched) {
        return {
          isValidReceipt: false,
          verdict: 'មិនពិត',
          amountKrw,
          bankName,
          recipientName,
          statusText,
          transferTimestamp,
          transferFingerprint,
          transferCompleted: true,
          checks,
          reason:
            lang === 'ko'
              ? `받는 분(${recipientName || '미확인'}) 또는 계좌번호가 지정 계좌(${expectedHolder})와 일치하지 않습니다.`
              : lang === 'en'
              ? `Recipient (${recipientName || 'Unrecognized'}) does not match the required account holder (${expectedHolder}).`
              : `ឈ្មោះអ្នកទទួល (${recipientName || 'មិនឃើញ'}) ឬលេខគណនីមិនត្រូវគ្នានឹងគណនី ${expectedHolder} ទេ។ សូមពិនិត្យម្តងទៀត!`,
        };
      }

      if (!amountMatched) {
        return {
          isValidReceipt: false,
          verdict: 'មិនពិត',
          amountKrw,
          bankName,
          recipientName,
          statusText,
          transferTimestamp,
          transferFingerprint,
          transferCompleted: true,
          checks,
          reason:
            lang === 'ko'
              ? `이체 금액(₩${amountKrw.toLocaleString()})이 서비스 금액 ₩35,000 미만입니다.`
              : lang === 'en'
              ? `Transferred amount (₩${amountKrw.toLocaleString()}) is less than the required ₩35,000.`
              : `ចំនួនទឹកប្រាក់លើវិក្កយបត្រ (₩${amountKrw.toLocaleString()}) តិចជាងតម្លៃសេវា ₩35,000។`,
        };
      }

      if (!timeVerified) {
        return {
          isValidReceipt: false,
          verdict: 'មិនពិត',
          amountKrw,
          bankName,
          recipientName,
          statusText,
          transferTimestamp,
          transferFingerprint,
          transferCompleted: true,
          checks,
          reason: timeFailureReason,
        };
      }

      return {
        isValidReceipt: true,
        verdict: 'ពិត',
        amountKrw,
        bankName,
        recipientName: recipientName || expectedHolder,
        statusText: statusText || '이체완료',
        transferTimestamp,
        transferFingerprint,
        transferCompleted: true,
        checks,
        reason: 'ពិត (Verified)',
      };
    } catch {
      continue;
    }
  }

  return {
    isValidReceipt: false,
    verdict: 'មិនពិត',
    amountKrw: 0,
    bankName: '',
    recipientName: '',
    statusText: '',
    transferTimestamp: '',
    transferFingerprint: '',
    transferCompleted: false,
    checks: emptyChecks,
    reason:
      lang === 'ko'
        ? '영수증 이미지를 판독할 수 없습니다. 글자가 선명한 스크린샷으로 다시 시도해 주세요.'
        : lang === 'en'
        ? 'Could not read the receipt image clearly. Please upload a sharper screenshot.'
        : 'មិនអាចអានរូបភាពវិក្កយបត្របានច្បាស់នៅពេលនេះទេ។ សូមព្យាយាមម្តងទៀតជាមួយរូបភាពច្បាស់។',
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
  const krBank = getKoreaBankPaymentInfo();
  return res.json({
    success: true,
    bankName: krBank.bankName,
    accountNumber: krBank.accountNumber,
    accountHolder: krBank.accountHolder,
    telegramBotUsername: (process.env.TELEGRAM_BOT_USERNAME || '').replace(/^@/, ''),
    amountKrw: 35000,
    autoReceiptVerifyEnabled: Boolean(process.env.GEMINI_API_KEY),
    telegramBotEnabled: Boolean(process.env.TELEGRAM_BOT_TOKEN),
  });
});

app.post('/api/payments/verify-kr-receipt', paymentRateLimiter, async (req, res) => {
  try {
    const receiptImage = String(req.body?.receiptImage || '');
    const userEmail = String(req.body?.userEmail || 'guest@kiip-portal.kr').slice(0, 254);
    const lang = String(req.body?.lang || 'km').slice(0, 10);
    const commaIdx = receiptImage.indexOf(',');
    if (!receiptImage.startsWith('data:image/') || commaIdx === -1) {
      return res.status(400).json({
        success: false,
        verdict: 'មិនពិត',
        verdictBoolean: false,
        error:
          lang === 'ko'
            ? '이체 확인 스크린샷 이미지(PNG / JPG)를 업로드해 주세요.'
            : lang === 'en'
            ? 'Please upload a transfer receipt screenshot image (PNG / JPG).'
            : 'សូម Upload រូបភាព Screenshot វិក្កយបត្រផ្ទេរប្រាក់ (PNG / JPG)!',
      });
    }

    const meta = receiptImage.substring(0, commaIdx);
    const base64Data = receiptImage.substring(commaIdx + 1).replace(/\s/g, '');
    const mimeType = meta.split(';')[0]?.replace('data:', '') || 'image/jpeg';

    if (!/^image\/(png|jpeg|jpg|webp)$/i.test(mimeType)) {
      return res.status(400).json({
        success: false,
        verdict: 'មិនពិត',
        verdictBoolean: false,
        error:
          lang === 'ko'
            ? 'PNG, JPG 또는 WebP 이미지만 업로드할 수 있습니다.'
            : lang === 'en'
            ? 'Only PNG, JPG, or WebP screenshots are supported.'
            : 'គាំទ្រតែរូបភាព PNG, JPG ឬ WebP ប៉ុណ្ណោះ។',
      });
    }

    if (base64Data.length < 100 || base64Data.length > 14 * 1024 * 1024) {
      return res.status(400).json({
        success: false,
        verdict: 'មិនពិត',
        verdictBoolean: false,
        error:
          lang === 'ko'
            ? '이미지 크기가 올바르지 않습니다 (최대 10MB).'
            : lang === 'en'
            ? 'Invalid image size (maximum 10MB).'
            : 'ទំហំរូបភាពមិនត្រឹមត្រូវ (អតិបរមា 10MB)។',
      });
    }

    const imageSha256 = crypto
      .createHash('sha256')
      .update(Buffer.from(base64Data, 'base64'))
      .digest('hex');

    const analysis = await analyzeKoreanBankReceiptWithGemini(base64Data, mimeType, lang);
    if (!analysis.isValidReceipt) {
      return res.status(422).json({
        success: false,
        verdict: 'មិនពិត',
        verdictBoolean: false,
        error: analysis.reason,
        checks: analysis.checks,
        detected: {
          bankName: analysis.bankName,
          recipientName: analysis.recipientName,
          amountKrw: analysis.amountKrw,
          statusText: analysis.statusText,
          transferTimestamp: analysis.transferTimestamp,
        },
      });
    }

    const reservation = recordVerifiedReceiptAndReserveCode({
      imageSha256,
      transferFingerprint: analysis.transferFingerprint,
      source: 'kr_receipt',
      assignedTo: userEmail,
      note: `Korea Bank (${analysis.bankName}) ₩${analysis.amountKrw.toLocaleString()} · ${analysis.transferTimestamp}`,
      bankName: analysis.bankName,
      recipientName: analysis.recipientName,
      amountKrw: analysis.amountKrw,
      transferTimestamp: analysis.transferTimestamp,
      fallbackPrefix: 'KIIP-KR',
    });

    if (!reservation.ok || reservation.duplicate || !reservation.record) {
      return res.status(409).json({
        success: false,
        verdict: 'មិនពិត',
        verdictBoolean: false,
        duplicate: true,
        checks: analysis.checks,
        error:
          lang === 'ko'
            ? '이 이체 내역 스크린샷은 이미 리딤 코드 발급에 사용되었습니다. 중복 사용할 수 없습니다.'
            : lang === 'en'
            ? 'This transfer receipt screenshot has already been used to issue a Redeem Code.'
            : 'រូបភាពវិក្កយបត្រផ្ទេរប្រាក់នេះត្រូវបានប្រើដើម្បីបញ្ចេញ Redeem Code រួចហើយ! មិនអាចប្រើវិក្កយបត្រដដែលម្តងទៀតបានទេ។',
      });
    }

    const unlockCode = reservation.record.code;
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
        `✅ AI Verified Korea Bank Transfer (Verdict: ពិត)\nBank: ${analysis.bankName}\nRecipient: ${analysis.recipientName}\nAmount: ₩${analysis.amountKrw.toLocaleString()}\nTime: ${analysis.transferTimestamp}\nUser: ${userEmail}\nIssued Redeem Code: ${unlockCode}`
      );
    }

    return res.json({
      success: true,
      verdict: 'ពិត',
      verdictBoolean: true,
      unlockCode,
      verifiedAmount: analysis.amountKrw,
      bankName: analysis.bankName,
      recipientName: analysis.recipientName,
      statusText: analysis.statusText,
      transferTimestamp: analysis.transferTimestamp,
      checks: analysis.checks,
    });
  } catch (err: any) {
    console.error('[KR Receipt] Verification failed:', err);
    return res.status(500).json({
      success: false,
      verdict: 'មិនពិត',
      verdictBoolean: false,
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
        'សួស្តី! សូមផ្ញើរូបភាព Screenshot វិក្កយបត្រផ្ទេរប្រាក់ (₩35,000) មកទីនេះ ដើម្បីទទួលបានលេខកូដដោះសោ KIIP-TOPIK PDF ដោយស្វ័យប្រវត្តិ។'
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
    const imageSha256 = crypto.createHash('sha256').update(imgBuf).digest('hex');

    const analysis = await analyzeKoreanBankReceiptWithGemini(base64Img, 'image/jpeg', 'km');
    if (!analysis.isValidReceipt) {
      await sendTelegramMessage(chatId, `❌ ផ្ទៀងផ្ទាត់មិនជោគជ័យ (មិនពិត)៖ ${analysis.reason}`);
      return res.json({ ok: true });
    }

    const senderLabel = message?.from?.username
      ? `@${message.from.username}`
      : `tg_${chatId}`;

    const reservation = recordVerifiedReceiptAndReserveCode({
      imageSha256,
      transferFingerprint: analysis.transferFingerprint,
      source: 'telegram_bot',
      assignedTo: `${senderLabel}@telegram`,
      note: `Telegram Receipt (${analysis.bankName}) ₩${analysis.amountKrw.toLocaleString()} · ${analysis.transferTimestamp}`,
      bankName: analysis.bankName,
      recipientName: analysis.recipientName,
      amountKrw: analysis.amountKrw,
      transferTimestamp: analysis.transferTimestamp,
      fallbackPrefix: 'KIIP-TG',
    });

    if (!reservation.ok || reservation.duplicate || !reservation.record) {
      await sendTelegramMessage(
        chatId,
        '❌ រូបភាពវិក្កយបត្រនេះត្រូវបានប្រើដើម្បីបញ្ចេញ Redeem Code រួចហើយ! មិនអាចប្រើម្តងទៀតបានទេ។'
      );
      return res.json({ ok: true });
    }

    const unlockCode = reservation.record.code;
    issuedUnlockCodes.set(unlockCode, {
      code: unlockCode,
      source: 'telegram_bot',
      createdAt: Date.now(),
      used: false,
      verifiedAmount: analysis.amountKrw,
      bankName: analysis.bankName,
    });

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
      `✅ ផ្ទៀងផ្ទាត់វិក្កយបត្រជោគជ័យ (លទ្ធផល: ពិត)!\n🏦 ${analysis.bankName} · ₩${analysis.amountKrw.toLocaleString()}\n👤 អ្នកទទួល: ${analysis.recipientName}\n🕒 ពេលវេលា: ${analysis.transferTimestamp}\n\n🔑 លេខកូដដោះសោរបស់អ្នក (Redeem Code):\n${unlockCode}\n\nសូមចម្លងលេខកូដនេះយកទៅបញ្ចូលក្នុងប្រអប់ Redeem Code លើគេហទំព័រដើម្បីទាញយកឯកសារ Clean PDF ភ្លាមៗ!`
    );

    if (process.env.TELEGRAM_ADMIN_CHAT_ID && String(process.env.TELEGRAM_ADMIN_CHAT_ID) !== String(chatId)) {
      await sendTelegramMessage(
        process.env.TELEGRAM_ADMIN_CHAT_ID,
        `🤖 Telegram Auto-Unlock Issued (ពិត)\nFrom: ${senderLabel}\nBank: ${analysis.bankName}\nRecipient: ${analysis.recipientName}\nAmount: ₩${analysis.amountKrw.toLocaleString()}\nTime: ${analysis.transferTimestamp}\nCode: ${unlockCode}`
      );
    }

    return res.json({ ok: true });
  } catch (err) {
    console.error('[Telegram Webhook] Error:', err);
    return res.json({ ok: true });
  }
});

// ============================================================================
// ADMIN-PROTECTED REDEEM CODE DATABASE & GOOGLE SHEETS READER API
// ============================================================================
app.get('/api/admin/redeem-codes', requireAdminAuth, (req, res) => {
  try {
    const rawStatus = String(req.query?.status || 'all');
    const filter: 'Unused' | 'Used' | 'Revoked' | 'Paid' | 'Unpaid' | 'all' =
      rawStatus === 'Unused' ||
      rawStatus === 'Used' ||
      rawStatus === 'Revoked' ||
      rawStatus === 'Paid' ||
      rawStatus === 'Unpaid'
        ? rawStatus
        : 'all';
    const search = String(req.query?.search || '').trim();
    const page = Math.max(1, Number(req.query?.page) || 1);
    const pageSize = Math.min(500, Math.max(10, Number(req.query?.pageSize) || 100));

    const result = queryRedeemCodes({
      statusFilter: filter,
      search,
      page,
      pageSize,
    });
    const stats = getRedeemCodeStats();
    return res.json({
      success: true,
      stats,
      codes: result.codes,
      pagination: {
        page: result.page,
        pageSize: result.pageSize,
        totalMatched: result.totalMatched,
        totalPages: result.totalPages,
      },
    });
  } catch (err) {
    console.error('[Admin RedeemDB] Read failed:', err);
    return res.status(500).json({ success: false, error: 'Failed to read redeem codes database' });
  }
});

app.post('/api/admin/redeem-codes/generate', requireAdminAuth, (req, res) => {
  try {
    const count = Math.min(500, Math.max(1, Number(req.body?.count) || 10));
    const prefix = String(req.body?.prefix || 'KIIP-26').trim();
    const note = String(req.body?.note || 'Admin Generated Batch').trim();
    const created = generateUnusedRedeemCodes(count, prefix, note);
    const stats = getRedeemCodeStats();
    return res.json({
      success: true,
      createdCount: created.length,
      created,
      stats,
    });
  } catch (err) {
    console.error('[Admin RedeemDB] Generate failed:', err);
    return res.status(500).json({ success: false, error: 'Failed to generate redeem codes' });
  }
});

app.post('/api/admin/redeem-codes/add', requireAdminAuth, (req, res) => {
  try {
    const rawList = Array.isArray(req.body?.codes)
      ? req.body.codes.map((c: unknown) => String(c || ''))
      : String(req.body?.codesText || '')
          .split(/[\n,;]+/)
          .map((c) => c.trim())
          .filter(Boolean);

    if (rawList.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'សូមបញ្ចូលយ៉ាងតិច ១ លេខកូដ (យ៉ាងតិច ៤ តួអក្សរ)។',
      });
    }

    const note = String(req.body?.note || 'Manual Import').trim();
    const result = addCustomRedeemCodes(rawList, note, 'admin');
    const stats = getRedeemCodeStats();
    return res.json({
      success: true,
      ...result,
      stats,
    });
  } catch (err) {
    console.error('[Admin RedeemDB] Add failed:', err);
    return res.status(500).json({ success: false, error: 'Failed to add redeem codes' });
  }
});

app.post('/api/admin/redeem-codes/sync-sheets', requireAdminAuth, async (req, res) => {
  try {
    const sheetId = String(req.body?.sheetId || '').trim() || undefined;
    const sheetName = String(req.body?.sheetName || '').trim() || undefined;
    const result = await syncRedeemCodesFromGoogleSheet({ sheetId, sheetName });
    const stats = getRedeemCodeStats();
    if (!result.success) {
      return res.status(400).json({ ...result, stats });
    }
    return res.json({ ...result, stats });
  } catch (err) {
    console.error('[Admin RedeemDB] Google Sheets sync failed:', err);
    return res.status(500).json({ success: false, error: 'Google Sheets sync failed' });
  }
});

app.get('/api/admin/redeem-codes/check', requireAdminAuth, (req, res) => {
  try {
    const code = String(req.query?.code || '').trim();
    if (!code) {
      return res.status(400).json({ success: false, error: 'Code is required' });
    }
    const result = checkRedeemCodeStatus(code);
    return res.json({ success: true, ...result });
  } catch (err) {
    console.error('[Admin RedeemDB] Check code failed:', err);
    return res.status(500).json({ success: false, error: 'Failed to check code' });
  }
});

app.post('/api/admin/redeem-codes/issue-paid', requireAdminAuth, (req, res) => {
  try {
    const assignedTo = String(req.body?.assignedTo || 'paid_customer').trim().slice(0, 160);
    const note = String(req.body?.note || 'Admin Payment Confirmed (ABA / Bank)').trim().slice(0, 160);
    const record = issueNextPaidRedeemCode({ assignedTo, note });
    return res.json({
      success: true,
      record,
      stats: getRedeemCodeStats(),
    });
  } catch (err) {
    console.error('[Admin RedeemDB] Issue paid code failed:', err);
    return res.status(500).json({ success: false, error: 'Failed to issue paid redeem code' });
  }
});

app.patch('/api/admin/redeem-codes/:code/paid', requireAdminAuth, (req, res) => {
  try {
    const code = String(req.params.code || '');
    const isPaid = Boolean(req.body?.isPaid);
    const assignedTo = typeof req.body?.assignedTo === 'string' ? req.body.assignedTo : undefined;
    const note = typeof req.body?.note === 'string' ? req.body.note : undefined;
    const record = setRedeemCodePaid(code, isPaid, assignedTo, note);
    if (!record) {
      return res.status(404).json({ success: false, error: 'Redeem code not found' });
    }
    return res.json({ success: true, record, stats: getRedeemCodeStats() });
  } catch (err) {
    console.error('[Admin RedeemDB] Update paid status failed:', err);
    return res.status(500).json({ success: false, error: 'Failed to update paid status' });
  }
});

app.patch('/api/admin/redeem-codes/:code/status', requireAdminAuth, (req, res) => {
  try {
    const code = String(req.params.code || '');
    const status = String(req.body?.status || '') as RedeemCodeStatus;
    if (status !== 'Unused' && status !== 'Used' && status !== 'Revoked') {
      return res.status(400).json({ success: false, error: 'Invalid status. Must be Unused, Used, or Revoked.' });
    }
    const updated = updateRedeemCodeStatus(code, status);
    if (!updated) {
      return res.status(404).json({ success: false, error: 'Redeem code not found' });
    }
    return res.json({ success: true, stats: getRedeemCodeStats() });
  } catch (err) {
    console.error('[Admin RedeemDB] Update status failed:', err);
    return res.status(500).json({ success: false, error: 'Failed to update status' });
  }
});

app.delete('/api/admin/redeem-codes/:code', requireAdminAuth, (req, res) => {
  try {
    const code = String(req.params.code || '');
    const deleted = deleteRedeemCode(code);
    if (!deleted) {
      return res.status(404).json({ success: false, error: 'Redeem code not found' });
    }
    return res.json({ success: true, stats: getRedeemCodeStats() });
  } catch (err) {
    console.error('[Admin RedeemDB] Delete failed:', err);
    return res.status(500).json({ success: false, error: 'Failed to delete redeem code' });
  }
});

// ============================================================================
// ADMIN-PROTECTED PROMO CODES API (SQLite mirror so ALL users can unlock without Google login)
// ============================================================================
app.get('/api/admin/promo-codes', requireAdminAuth, (_req, res) => {
  try {
    return res.json({
      success: true,
      promoCodes: listServerPromoCodes(),
    });
  } catch (err) {
    console.error('[Admin PromoDB] Read failed:', err);
    return res.status(500).json({ success: false, error: 'Failed to read promo codes' });
  }
});

app.post('/api/admin/promo-codes', requireAdminAuth, (req, res) => {
  try {
    // Bulk mirror mode (used by Admin Dashboard to mirror existing Firestore promo codes into SQLite)
    if (Array.isArray(req.body?.promos)) {
      const items = req.body.promos.slice(0, 500);
      let synced = 0;
      for (const item of items) {
        if (!item || typeof item !== 'object') continue;
        const r = upsertServerPromoCode({
          code: String((item as any).code || (item as any).id || ''),
          centerId: String((item as any).centerId || 'general'),
          monthLabel: String((item as any).monthLabel || ''),
          usageLimit: Number((item as any).usageLimit) || 50,
          usageCount: Number((item as any).usageCount) || 0,
          expiresAt: String((item as any).expiresAt || ''),
          isActive: (item as any).isActive !== false,
          createdAt: typeof (item as any).createdAt === 'string' ? (item as any).createdAt : undefined,
          preserveUsageCount: true,
        });
        if (r.ok) synced++;
      }
      return res.json({
        success: true,
        synced,
        promoCodes: listServerPromoCodes(),
      });
    }

    const result = upsertServerPromoCode({
      code: String(req.body?.code || ''),
      centerId: String(req.body?.centerId || 'general'),
      monthLabel: String(req.body?.monthLabel || ''),
      usageLimit: Number(req.body?.usageLimit) || 50,
      expiresAt: String(req.body?.expiresAt || ''),
      isActive: req.body?.isActive !== false,
    });
    if (!result.ok) {
      return res.status(400).json({ success: false, error: result.error || 'Invalid promo code' });
    }
    return res.json({
      success: true,
      promo: result.promo,
      promoCodes: listServerPromoCodes(),
    });
  } catch (err) {
    console.error('[Admin PromoDB] Upsert failed:', err);
    return res.status(500).json({ success: false, error: 'Failed to save promo code' });
  }
});

app.delete('/api/admin/promo-codes/:code', requireAdminAuth, (req, res) => {
  try {
    const code = String(req.params.code || '');
    deleteServerPromoCode(code);
    return res.json({ success: true, promoCodes: listServerPromoCodes() });
  } catch (err) {
    console.error('[Admin PromoDB] Delete failed:', err);
    return res.status(500).json({ success: false, error: 'Failed to delete promo code' });
  }
});

app.post('/api/mail/send-receipt', aiApiRateLimiter, async (req, res) => {
  try {
    const { recipientEmail, officeEmail } = req.body || {};
    if (!recipientEmail && !officeEmail) {
      return res.status(400).json({ success: false, error: 'Recipient email required' });
    }

    return res.json({
      success: true,
      simulated: true,
      message: 'Please send the attached PDF directly using your preferred email client (Gmail / Naver / Daum / Mail app).',
    });
  } catch (err) {
    console.error('Mail endpoint error:', err);
    return res.status(500).json({ success: false, error: 'Failed to process email request' });
  }
});

// ============================================================================
// MULTI-TURN WEBSITE NAVIGATION & HELP CHATBOT (Gemini 4 Hydrogen, SSE Stream)
// ============================================================================
interface ChatGuideHistoryItem {
  role: 'user' | 'model';
  text: string;
}

function buildWebsiteGuideSystemInstruction(ctx: {
  lang: string;
  activeTab: string;
  currentStep: number;
  isStep1Ready: boolean;
  missingItems: string[];
  isPaid: boolean;
}): string {
  const missingSummary =
    ctx.missingItems.length > 0 ? ctx.missingItems.join(', ') : 'None — all 6 mandatory Step 1 items are complete.';

  return [
    'You are the official Website Navigation & Help Assistant for the KIIP & TOPIK Linkage Application Portal (사회통합프로그램 TOPIK 성적 연계 신청 포털).',
    'Your role is to help visitors smoothly navigate this website, complete their TOPIK-to-KIIP linkage application step by step, troubleshoot upload/form/PDF/email questions, and jump directly to the right page or tool.',
    '',
    'LANGUAGE RULE:',
    `- The website interface is currently set to language code "${ctx.lang}".`,
    '- Always respond in the exact language the user writes in (Khmer, Korean, English, or any other language). If ambiguous, use the current website language.',
    '- Keep responses concise, structured, friendly, and directly actionable (short paragraphs or crisp bullet points).',
    '',
    'LIVE USER SESSION CONTEXT:',
    `- Current View: ${ctx.activeTab === 'about' ? 'About Me & Contact page' : ctx.activeTab === 'guide' ? 'TOPIK-to-KIIP Official Guide tab' : `Application Workflow — Step ${ctx.currentStep} of 5`}`,
    `- Step 1 Mandatory Checklist Ready: ${ctx.isStep1Ready ? 'Yes (Steps 2–4 unlocked)' : 'No'}`,
    `- Missing Step 1 Items: ${missingSummary}`,
    `- PDF/Step 5 Unlock Status: ${ctx.isPaid ? 'Unlocked (Watermark removed & Step 5 enabled)' : 'Locked (Requires Korea Bank transfer receipt, Telegram bot code, or Redeem/Promo code in Step 4)'}`,
    '',
    'ACCURATE WEBSITE MAP & WORKFLOW:',
    '1. Guide Tab (TOPIK → KIIP Linkage Guide): Explains eligibility, official TOPIK-to-KIIP level conversion (TOPIK Level 2 → KIIP Level 3, TOPIK Level 3 → KIIP Level 4, TOPIK Level 4 → KIIP Level 5 Basic, TOPIK Level 5–6 → KIIP Level 5 exam track), validity rules, and submission tips.',
    '2. Step 1 — Upload Documents & Info (Mandatory 6 items to unlock Steps 2–5):',
    '   (1) ARC Front & Back (외국인등록증 앞·뒷면) — supports automatic AI OCR extraction of Name, ARC number, Visa, Nationality, and Residence Address (체류지).',
    '   (2) TOPIK Score Certificate (성적증명서) — supports automatic AI OCR extraction of Exam number, Exam date, Round (회), Validity date, Grade, and Verification number.',
    '   (3) Passport Copy (여권 사본).',
    '   (4) Signature (서명) — draw directly on screen or upload photo with automatic background removal.',
    '   (5) Socinet Account ID & Password (사회통합정보망 아이디/비밀번호 — required by immigration officers to link your TOPIK score on socinet.go.kr; note: must already have a registered Socinet account).',
    '   (6) Korean Phone Number (전화번호).',
    '   Tip: Users who just want to preview how the portal works can click "Load Sample" to populate demo documents in 1 click.',
    '3. Step 2 — Verify & Edit OCR Extracted Results: Lets users compare uploaded document previews side-by-side with all OCR-extracted text fields (ARC 체류지 address, TOPIK 시험일/회/성적유효기간/등급/수험번호/문서확인번호, Passport, and Identity) and edit or re-scan any field before confirming injection into the official form.',
    '4. Step 3 — Official Application Form & Signature Placement: Review/edit the Ministry of Justice KIIP-TOPIK linkage application form (사회통합프로그램 연계신청서) populated from Step 2 and drag/resize the signature inside the signature box.',
    '5. Step 4 — Merged PDF Preview & Unlock: Combines the filled application form + ARC + Passport + TOPIK certificate into one print-ready official PDF. To remove the watermark and unlock Step 5, users can:',
    '   - Transfer via Korea Bank and upload the transfer receipt screenshot for instant AI verification & auto-unlock,',
    '   - Use the Telegram bot auto-unlock receipt flow, or',
    '   - Enter a valid Redeem Code / Center Promo Code.',
    '6. Step 5 — Immigration Center Email Submission: Matches the applicant region/address to the jurisdiction Immigration / KIIP Operation Center email (출입국·외국인청 / 사회통합운영기관) and prepares the email with ready-to-paste subject & body so the user can attach their merged PDF and send.',
    '7. About Me & Contact Page: Introduces the portal creator (Eang Veasna), explains the 1-minute private PDF workflow, and provides direct channels to send payment screenshots for fast Unlock / Redeem Code delivery: Facebook Page (https://www.facebook.com/eang.veasna.667/) and KakaoTalk ID: 9111veasna.',
    '8. Extra Portal Tools: 50+ Language Selector in the top bar, Socinet Account Notice popup, Background Wallpaper Settings, and automatic draft saving.',
    '',
    'INTERACTIVE NAVIGATION SHORTCUTS:',
    'When guiding the user to open a specific step or dialog on this website, you may append up to 2 action tags on a new line at the very end of your reply using ONLY these exact tokens:',
    '  [[NAV:step1]] — Jump to Step 1 (Upload Documents)',
    '  [[NAV:step2]] — Jump to Step 2 (Verify & Edit OCR Data)',
    '  [[NAV:step3]] — Jump to Step 3 (Official Application Form)',
    '  [[NAV:step4]] — Jump to Step 4 (PDF Preview & Download)',
    '  [[NAV:step5]] — Jump to Step 5 (Send Email to Immigration)',
    '  [[NAV:guide]] — Open TOPIK → KIIP Official Guide tab',
    '  [[NAV:about]] — Open About Me & Contact page (Facebook / KakaoTalk)',
    '  [[NAV:socinet]] — Open Socinet ID/Password Notice',
    '  [[NAV:payment]] — Open Unlock / Redeem Code dialog',
    '  [[NAV:language]] — Open 50+ Language Selector',
    '  [[NAV:sample]] — Load 1-Click Sample Documents for testing',
    'Only include navigation tags that genuinely help answer the user’s request. Never invent any other tag names.',
    '',
    'SAFETY & ACCURACY RULES:',
    '- Never invent fake immigration center emails, fake redeem codes, or promise official Ministry of Justice approval.',
    '- Never ask for or discuss API keys, passwords to the admin dashboard, or internal server configuration.',
  ].join('\n');
}

app.post('/api/chat-guide', aiApiRateLimiter, async (req, res) => {
  const ai = getAiClient();
  if (!ai) {
    return res.status(503).json({
      success: false,
      error: 'AI Assistant is temporarily unavailable because GEMINI_API_KEY is not configured on the server.',
    });
  }

  const rawMessages = Array.isArray(req.body?.messages) ? req.body.messages : [];
  if (rawMessages.length === 0) {
    return res.status(400).json({ success: false, error: 'Please enter a message.' });
  }

  // Sanitize & cap multi-turn history
  const cleaned: ChatGuideHistoryItem[] = [];
  for (const item of rawMessages.slice(-24)) {
    const role = item?.role === 'model' ? 'model' : item?.role === 'user' ? 'user' : null;
    const text = typeof item?.text === 'string' ? item.text.trim().slice(0, 2000) : '';
    if (!role || !text) continue;
    cleaned.push({ role, text });
  }

  if (cleaned.length === 0 || cleaned[cleaned.length - 1].role !== 'user') {
    return res.status(400).json({ success: false, error: 'The latest message must be from the user.' });
  }

  const latestUserMessage = cleaned[cleaned.length - 1].text;
  const priorHistory = cleaned.slice(0, -1).map((m) => ({
    role: m.role,
    parts: [{ text: m.text }],
  }));

  const rawCtx = req.body?.context && typeof req.body.context === 'object' ? req.body.context : {};
  const ctx = {
    lang: String(rawCtx.lang || 'km').slice(0, 12),
    activeTab: rawCtx.activeTab === 'about' ? 'about' : rawCtx.activeTab === 'guide' ? 'guide' : 'flow',
    currentStep: Math.min(4, Math.max(1, Number(rawCtx.currentStep) || 1)),
    isStep1Ready: Boolean(rawCtx.isStep1Ready),
    missingItems: Array.isArray(rawCtx.missingItems)
      ? rawCtx.missingItems.map((x: any) => String(x).slice(0, 60)).slice(0, 10)
      : [],
    isPaid: Boolean(rawCtx.isPaid),
  };

  const systemInstruction = buildWebsiteGuideSystemInstruction(ctx);

  let streamResponse: AsyncIterable<any> | null = null;
  let lastError: any = null;

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const chat = ai.chats.create({
        model: 'gemini-4-hydrogen',
        history: priorHistory,
        config: {
          systemInstruction,
          thinkingConfig: {
            thinkingLevel: ThinkingLevel.LOW,
          },
        },
      });
      streamResponse = await chat.sendMessageStream({ message: latestUserMessage });
      break;
    } catch (err: any) {
      lastError = err;
      if (attempt === 0 && isTransientError(err)) {
        await sleep(800);
        continue;
      }
      break;
    }
  }

  if (!streamResponse) {
    const errMsg = formatGeminiError(lastError);
    console.error('[ChatGuide] Gemini stream init failed:', errMsg);
    if (isAuthOrKeyError(lastError)) {
      return res.status(401).json({
        success: false,
        error: 'Gemini API authentication failed. Please check the API key in Settings > Secrets.',
      });
    }
    return res.status(502).json({
      success: false,
      error: 'Unable to reach the assistant right now. Please try again in a moment.',
    });
  }

  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  let clientClosed = false;
  req.on('close', () => {
    clientClosed = true;
  });

  try {
    for await (const chunk of streamResponse) {
      if (clientClosed) break;
      const delta = chunk?.text;
      if (typeof delta === 'string' && delta.length > 0) {
        res.write(`data: ${JSON.stringify({ delta })}\n\n`);
      }
    }
    if (!clientClosed) {
      res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
      res.end();
    }
  } catch (err: any) {
    console.error('[ChatGuide] Stream interrupted:', formatGeminiError(err));
    if (!clientClosed) {
      res.write(
        `data: ${JSON.stringify({
          error: 'The response stream was interrupted. Please try sending your question again.',
        })}\n\n`
      );
      res.end();
    }
  }
});

// ============================================================================
// PUBLIC USER AUTHENTICATION (Sign Up, Sign In, Change Password & Safe Reset)
// ============================================================================
const USER_COOKIE_NAME = 'kiip_user_session';
const USER_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const OTP_TTL_MS = 10 * 60 * 1000; // 10 minutes
const pendingUserOtps = new Map<string, { code: string; expiresAt: number; attempts: number }>();
const revokedUserTokens = new Set<string>();

function isSmtpConfigured(): boolean {
  return Boolean(
    process.env.SMTP_HOST?.trim() &&
      process.env.SMTP_USER?.trim() &&
      process.env.SMTP_PASS?.trim()
  );
}

async function sendVerificationEmail(to: string, subject: string, textBody: string): Promise<boolean> {
  if (!isSmtpConfigured()) return false;
  try {
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST!.trim(),
      port: parseInt(process.env.SMTP_PORT || '587', 10),
      secure: process.env.SMTP_SECURE === 'true' || process.env.SMTP_PORT === '465',
      auth: {
        user: process.env.SMTP_USER!.trim(),
        pass: process.env.SMTP_PASS!.trim(),
      },
    });
    await transporter.sendMail({
      from: (process.env.SMTP_FROM || process.env.SMTP_USER!).trim(),
      to,
      subject,
      text: textBody,
    });
    return true;
  } catch (err) {
    console.error('[SMTP] Failed to send email:', err);
    return false;
  }
}

function issueUserBearerToken(user: PublicUserRecord): string {
  const payload = Buffer.from(
    JSON.stringify({
      type: 'public_user',
      uid: user.id,
      sub: user.email,
      name: user.name,
      phone: user.phone || '',
      provider: user.provider,
      iat: Date.now(),
      exp: Date.now() + USER_SESSION_TTL_MS,
      jti: crypto.randomBytes(10).toString('hex'),
    })
  ).toString('base64url');
  const sig = crypto
    .createHmac('sha256', SESSION_SIGNING_SECRET)
    .update(payload)
    .digest('base64url');
  return `${payload}.${sig}`;
}

function verifyUserBearerToken(token: string): {
  uid: number;
  email: string;
  name: string;
  phone: string;
  provider: 'email' | 'otp' | 'google';
} | null {
  if (!token || revokedUserTokens.has(token)) return null;
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
    if (!parsed || parsed.type !== 'public_user' || typeof parsed.exp !== 'number' || Date.now() > parsed.exp) {
      return null;
    }
    return {
      uid: Number(parsed.uid) || 0,
      email: String(parsed.sub || ''),
      name: String(parsed.name || ''),
      phone: String(parsed.phone || ''),
      provider: parsed.provider === 'otp' ? 'otp' : parsed.provider === 'google' ? 'google' : 'email',
    };
  } catch {
    return null;
  }
}

function extractUserTokenFromReq(req: express.Request): string {
  const authHeader = String(req.headers.authorization || '');
  if (authHeader.startsWith('Bearer ')) {
    const t = authHeader.slice(7).trim();
    if (t) return t;
  }
  const cookies = parseCookies(req);
  return String(cookies[USER_COOKIE_NAME] || '').trim();
}

app.post('/api/auth/register', userAuthRateLimiter, (req, res) => {
  try {
    const { email, name, phone, password } = req.body || {};
    const result = registerUserAccount({ email, name, phone, password });
    if (!result.ok || !result.user) {
      return res.status(400).json({ success: false, error: result.error || 'Registration failed' });
    }
    const token = issueUserBearerToken(result.user);
    setHttpOnlyCookie(req, res, USER_COOKIE_NAME, token, Math.floor(USER_SESSION_TTL_MS / 1000));
    return res.json({
      success: true,
      user: {
        isLoggedIn: true,
        name: result.user.name,
        email: result.user.email,
        phone: result.user.phone,
        avatar: '',
        provider: result.user.provider,
      },
    });
  } catch (err) {
    console.error('[Auth] Register error:', err);
    return res.status(500).json({ success: false, error: 'ប្រព័ន្ធមានបញ្ហាក្នុងការចុះឈ្មោះ!' });
  }
});

app.post('/api/auth/login', userAuthRateLimiter, (req, res) => {
  try {
    const { email, identifier, password } = req.body || {};
    const result = verifyUserLogin({
      identifier: String(identifier || email || ''),
      password: String(password || ''),
    });
    if (!result.ok || !result.user) {
      return res.status(401).json({ success: false, error: result.error || 'Invalid credentials' });
    }
    const token = issueUserBearerToken(result.user);
    setHttpOnlyCookie(req, res, USER_COOKIE_NAME, token, Math.floor(USER_SESSION_TTL_MS / 1000));
    return res.json({
      success: true,
      user: {
        isLoggedIn: true,
        name: result.user.name,
        email: result.user.email,
        phone: result.user.phone,
        avatar: '',
        provider: result.user.provider,
      },
    });
  } catch (err) {
    console.error('[Auth] Login error:', err);
    return res.status(500).json({ success: false, error: 'ប្រព័ន្ធមានបញ្ហាក្នុងការចូលគណនី!' });
  }
});

app.post('/api/auth/logout', (req, res) => {
  const token = extractUserTokenFromReq(req);
  if (token) {
    revokedUserTokens.add(token);
  }
  clearHttpOnlyCookie(req, res, USER_COOKIE_NAME);
  return res.json({ success: true });
});

app.get('/api/auth/me', (req, res) => {
  const token = extractUserTokenFromReq(req);
  const session = verifyUserBearerToken(token);
  if (!session) {
    return res.status(401).json({ success: false, error: 'Session expired or invalid' });
  }
  const dbUser = session.email ? getUserAccountByEmail(session.email) : null;
  if (!dbUser) {
    return res.status(401).json({ success: false, error: 'Account no longer exists' });
  }
  return res.json({
    success: true,
    user: {
      isLoggedIn: true,
      name: dbUser.name || session.name || session.email.split('@')[0],
      email: dbUser.email || session.email,
      phone: dbUser.phone || session.phone,
      avatar: '',
      provider: dbUser.provider || session.provider,
    },
  });
});

app.post('/api/auth/change-password', userAuthRateLimiter, (req, res) => {
  const token = extractUserTokenFromReq(req);
  const session = verifyUserBearerToken(token);
  if (!session || !session.email) {
    return res.status(401).json({ success: false, error: 'សូមចូលគណនីជាមុនសិន!' });
  }
  const currentPassword = String(req.body?.currentPassword || '');
  const newPassword = String(req.body?.newPassword || '');
  const result = changeUserAccountPassword({
    email: session.email,
    currentPassword,
    newPassword,
  });
  if (!result.ok) {
    return res.status(400).json({ success: false, error: result.error || 'Failed to change password' });
  }
  return res.json({ success: true });
});

app.post('/api/auth/otp/send', userAuthRateLimiter, async (req, res) => {
  const rawTarget = String(req.body?.target || '').trim().slice(0, 254);
  if (!rawTarget || rawTarget.length < 5 || !rawTarget.includes('@')) {
    return res.status(400).json({
      success: false,
      error: 'សូមបញ្ចូលអាសយដ្ឋាន Email ឱ្យបានត្រឹមត្រូវ!',
    });
  }
  if (!isSmtpConfigured()) {
    return res.status(503).json({
      success: false,
      error: 'សេវាផ្ញើកូដ OTP តាម Email មិនទាន់បានកំណត់នៅលើ Server ទេ។ សូមចុះឈ្មោះ/ចូលគណនីដោយប្រើ Email & Password ឬ Continue with Google!',
    });
  }

  const key = `otp:${rawTarget.toLowerCase()}`;
  const code = String(crypto.randomInt(100000, 999999));
  pendingUserOtps.set(key, {
    code,
    expiresAt: Date.now() + OTP_TTL_MS,
    attempts: 0,
  });

  for (const [k, v] of pendingUserOtps.entries()) {
    if (Date.now() > v.expiresAt) pendingUserOtps.delete(k);
  }

  const sent = await sendVerificationEmail(
    rawTarget,
    'KIIP & TOPIK Portal — Verification Code',
    `Your 6-digit verification code is: ${code}\n\nThis code expires in 10 minutes.`
  );
  if (!sent) {
    pendingUserOtps.delete(key);
    return res.status(502).json({
      success: false,
      error: 'មិនអាចផ្ញើ Email ផ្ទៀងផ្ទាត់បានទេនៅពេលនេះ។ សូមប្រើ Email & Password ឬ Google Sign-In!',
    });
  }

  return res.json({
    success: true,
    target: rawTarget,
    expiresInSeconds: 600,
    delivery: 'email',
  });
});

app.post('/api/auth/otp/verify', userAuthRateLimiter, (req, res) => {
  const rawTarget = String(req.body?.target || '').trim().slice(0, 254);
  const rawCode = String(req.body?.code || '').trim();
  const rawName = String(req.body?.name || '').trim().slice(0, 120);

  if (!rawTarget || !rawCode) {
    return res.status(400).json({
      success: false,
      error: 'សូមបញ្ចូល Email និងកូដ OTP ៦ ខ្ទង់!',
    });
  }

  const key = `otp:${rawTarget.toLowerCase()}`;
  const entry = pendingUserOtps.get(key);
  if (!entry || Date.now() > entry.expiresAt) {
    pendingUserOtps.delete(key);
    return res.status(400).json({
      success: false,
      error: 'កូដ OTP ផុតកំណត់ ឬមិនទាន់បានផ្ញើ! សូមចុច "ផ្ញើកូដ OTP" ម្តងទៀត។',
    });
  }

  if (entry.attempts >= 5) {
    pendingUserOtps.delete(key);
    return res.status(429).json({
      success: false,
      error: 'បញ្ចូលកូដខុសច្រើនដងពេក! សូមស្នើសុំកូដ OTP ថ្មី។',
    });
  }

  if (!safeEqualStrings(rawCode, entry.code)) {
    entry.attempts += 1;
    return res.status(400).json({
      success: false,
      error: 'លេខកូដ OTP មិនត្រឹមត្រូវទេ! សូមពិនិត្យម្តងទៀត។',
    });
  }

  pendingUserOtps.delete(key);
  const otpResult = upsertOtpUserAccount({ target: rawTarget, name: rawName });
  if (!otpResult.ok || !otpResult.user) {
    return res.status(409).json({
      success: false,
      error: otpResult.error || 'គណនីនេះត្រូវបានការពារដោយពាក្យសម្ងាត់! សូមចូលតាម Email & Password។',
    });
  }
  const token = issueUserBearerToken(otpResult.user);
  setHttpOnlyCookie(req, res, USER_COOKIE_NAME, token, Math.floor(USER_SESSION_TTL_MS / 1000));

  return res.json({
    success: true,
    user: {
      isLoggedIn: true,
      name: otpResult.user.name,
      email: otpResult.user.email,
      phone: otpResult.user.phone,
      avatar: '',
      provider: 'otp',
    },
  });
});

app.post('/api/auth/reset-password/request', userAuthRateLimiter, async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ success: false, error: 'សូមបញ្ចូលអាសយដ្ឋាន Email ឱ្យបានត្រឹមត្រូវ!' });
  }
  if (!isSmtpConfigured()) {
    return res.status(503).json({
      success: false,
      error: 'ការផ្ញើកូដប្ដូរពាក្យសម្ងាត់តាម Email មិនទាន់បានកំណត់នៅលើ Server ទេ។ សូមចូលតាម Google ឬទាក់ទង Admin (Facebook/KakaoTalk: 9111veasna) ដើម្បីជួយស្តារគណនី។',
    });
  }

  const existing = getUserAccountByEmail(email);
  if (existing) {
    const code = String(crypto.randomInt(100000, 999999));
    pendingUserOtps.set(`reset:${email}`, {
      code,
      expiresAt: Date.now() + OTP_TTL_MS,
      attempts: 0,
    });
    await sendVerificationEmail(
      email,
      'KIIP & TOPIK Portal — Password Reset Code',
      `Your 6-digit password reset code is: ${code}\n\nIf you did not request this, ignore this email.`
    );
  }
  // Never reveal account existence or secret reset code in HTTP JSON response
  return res.json({
    success: true,
    message: 'ប្រសិនបើ Email នេះមានក្នុងប្រព័ន្ធ កូដកំណត់ពាក្យសម្ងាត់ថ្មីត្រូវបានផ្ញើទៅប្រអប់សារ Email របស់អ្នកហើយ។',
  });
});

app.post('/api/auth/reset-password/confirm', userAuthRateLimiter, (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const code = String(req.body?.code || '').trim();
  const newPassword = String(req.body?.newPassword || '');

  const key = `reset:${email}`;
  const entry = pendingUserOtps.get(key);
  if (!entry || Date.now() > entry.expiresAt) {
    pendingUserOtps.delete(key);
    return res.status(400).json({
      success: false,
      error: 'កូដកំណត់ពាក្យសម្ងាត់ផុតកំណត់ហើយ! សូមស្នើសុំកូដថ្មី។',
    });
  }
  if (entry.attempts >= 5) {
    pendingUserOtps.delete(key);
    return res.status(429).json({ success: false, error: 'បញ្ចូលកូដខុសច្រើនដងពេក!' });
  }
  if (!safeEqualStrings(code, entry.code)) {
    entry.attempts += 1;
    return res.status(400).json({ success: false, error: 'លេខកូដកំណត់ពាក្យសម្ងាត់មិនត្រឹមត្រូវទេ!' });
  }

  const resetRes = resetUserAccountPassword({ email, newPassword });
  if (!resetRes.ok) {
    return res.status(400).json({ success: false, error: resetRes.error || 'Password reset failed' });
  }
  pendingUserOtps.delete(key);
  return res.json({ success: true });
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
    // Non-blocking startup sync if GOOGLE_SHEET_ID or a saved Google Sheet is configured
    ensureGoogleSheetSynced({ force: true }).catch((err) => {
      console.warn('[RedeemDB] Startup Google Sheet sync skipped:', err?.message || err);
    });
  });
}

startServer();
