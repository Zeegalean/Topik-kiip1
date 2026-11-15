import Tesseract from 'tesseract.js';
import { ApplicationFormData } from '../types';
import {
  cleanVisaStatus,
  normalizeDocVerificationNo,
  normalizeRegNumbers,
  cleanExamNumber,
  cleanRound,
  cleanGrade,
  cleanName,
} from './sanitizers';

export interface ExtractedDocumentData {
  name?: string | null;
  regNumber1?: string | null;
  regNumber2?: string | null;
  gender?: '남' | '여' | '' | null;
  nationality?: string | null;
  visaStatus?: string | null;
  passportNo?: string | null;
  passportExpiry?: string | null;
  address?: string | null;
  docVerificationNo?: string[] | string | null;
  examNumber?: string | null;
  examDate?: string | null;
  round?: string | null;
  validUntil?: string | null;
  grade?: string | null;
}

// In-memory cache so mobile browsers never re-run WASM OCR on the same uploaded image twice
const ocrTextCache = new Map<string, string>();

// Words commonly printed on ARC / Passport / TOPIK headers that are NOT applicant names
const NON_NAME_WORDS = new Set([
  'REPUBLIC', 'OF', 'KOREA', 'FOREIGN', 'NATIONAL', 'RESIDENCE', 'CARD',
  'RESIDENT', 'ALIEN', 'REGISTRATION', 'CERTIFICATE', 'MINISTRY', 'JUSTICE',
  'NAME', 'IN', 'ENGLISH', 'SEX', 'COUNTRY', 'REGION', 'STATUS', 'ISSUE',
  'DATE', 'ISSUED', 'BY', 'EXPIRY', 'PASSPORT', 'TYPE', 'CODE', 'SURNAME',
  'GIVEN', 'NAMES', 'NATIONALITY', 'BIRTH', 'PLACE', 'AUTHORITY', 'HOLDER',
  'SIGNATURE', 'KINGDOM', 'CAMBODIA', 'VIETNAM', 'NEPAL', 'UZBEKISTAN',
  'MYANMAR', 'THAILAND', 'INDONESIA', 'PHILIPPINES', 'CHINA', 'MONGOLIA',
  'LANKA', 'SRI', 'BANGLADESH', 'PAKISTAN', 'TEST', 'PROFICIENCY', 'KOREAN',
  'TOPIK', 'SCORE', 'REPORT', 'INSTITUTE', 'INTERNATIONAL', 'EDUCATION',
  'LEVEL', 'TOTAL', 'POINTS', 'GRADE', 'VALID', 'UNTIL', 'APPLICATION',
  'NUMBER', 'VERIFICATION', 'DOCUMENT', 'IMMIGRATION', 'SERVICE', 'OFFICE',
  'CHIEF', 'BRANCH', 'MALE', 'FEMALE', 'KHM', 'VNM', 'NPL', 'UZB', 'MMR',
  'THA', 'IDN', 'PHL', 'CHN', 'MNG', 'LKA', 'NO', 'REG', 'THE', 'AND', 'FOR',
  'WITH', 'FROM', 'THIS', 'THAT', 'PERMIT', 'VISA', 'WORK', 'EMPLOYMENT',
  'QUALIFICATION', 'PERIOD', 'STAY', 'ADDRESS', 'CHANGE', 'REPORTED',
  // Common 2-letter OCR artifacts from Hangul labels, borders, or clipped country suffixes (e.g. IA from CAMBODIA)
  'IA', 'DIA', 'ODIA', 'BODIA', 'MBODIA', 'AMBODIA', 'CAMBOD', 'CAMBODIAN', 'NESIA',
  'BIOMETRIC', 'DIPLOMATIC', 'ORDINARY', 'ISSUING', 'EXPIRATION', 'GENDER', 'BIRTHDATE',
  'OI', 'II', 'IL', 'LI', 'OO', 'EE', 'SS', 'MM', 'NN', 'CC', 'GG', 'UU',
  'RR', 'TT', 'PP', 'AA', 'DD', 'FF', 'HH', 'JJ', 'KK', 'VV', 'WW', 'XX',
  'YY', 'ZZ', 'ID', 'KR', 'RO', 'OK', 'ROK', 'CK', 'KL', 'LC', 'KC', 'CL',
  'LK', 'CKL', 'KLC', 'CCC', 'KKK', 'LLL', 'III', 'OOO', 'XXX'
]);

/**
 * Compresses raster DataURLs cleanly before sending to /api/extract-documents
 * so multiple smartphone photos stay well under Vercel's 4.5 MB serverless payload limit.
 */
export async function compressImageForApi(
  dataUrl: string | null | undefined,
  maxDim: number = 1400,
  quality: number = 0.82
): Promise<string | null | undefined> {
  if (!dataUrl || typeof dataUrl !== 'string') return dataUrl;
  if (dataUrl.startsWith('data:image/svg+xml') || dataUrl.startsWith('data:application/pdf')) {
    return dataUrl;
  }

  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        let width = img.naturalWidth || img.width;
        let height = img.naturalHeight || img.height;
        if (!width || !height) {
          resolve(dataUrl);
          return;
        }
        if (width > maxDim || height > maxDim) {
          if (width > height) {
            height = Math.round((height * maxDim) / width);
            width = maxDim;
          } else {
            width = Math.round((width * maxDim) / height);
            height = maxDim;
          }
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(dataUrl);
          return;
        }
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      } catch {
        resolve(dataUrl);
      }
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

/**
 * Normalizes image dimensions (including upscaling small images) and optionally applies
 * grayscale contrast stretching so Tesseract reads small Hangul/digits cleanly on colored cards.
 */
async function preprocessImageForOcr(dataUrl: string, enhanceContrast: boolean = false): Promise<string> {
  if (!dataUrl || dataUrl.startsWith('data:image/svg+xml') || dataUrl.startsWith('data:application/pdf')) {
    return dataUrl;
  }

  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const maxDim = 1800;
        const minTargetDim = 1350;
        let width = img.naturalWidth || img.width;
        let height = img.naturalHeight || img.height;

        if (!width || !height) {
          resolve(dataUrl);
          return;
        }

        const longest = Math.max(width, height);
        if (longest > maxDim) {
          const scale = maxDim / longest;
          width = Math.round(width * scale);
          height = Math.round(height * scale);
        } else if (longest < minTargetDim) {
          const scale = Math.min(2.2, minTargetDim / longest);
          width = Math.round(width * scale);
          height = Math.round(height * scale);
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(dataUrl);
          return;
        }

        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, width, height);
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, width, height);

        if (enhanceContrast) {
          const imgData = ctx.getImageData(0, 0, width, height);
          const pixels = imgData.data;
          const contrastFactor = 1.45;
          for (let i = 0; i < pixels.length; i += 4) {
            const lum = 0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2];
            const boosted = Math.max(0, Math.min(255, (lum - 128) * contrastFactor + 132));
            pixels[i] = boosted;
            pixels[i + 1] = boosted;
            pixels[i + 2] = boosted;
          }
          ctx.putImageData(imgData, 0, 0);
        }

        resolve(canvas.toDataURL('image/jpeg', 0.95));
      } catch {
        resolve(dataUrl);
      }
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

/**
 * Crops the bottom band of a passport image (where the 2 ICAO MRZ lines sit)
 * and upscales with high-contrast grayscale for accurate MRZ OCR.
 */
async function cropPassportMrzForOcr(dataUrl: string): Promise<string> {
  if (!dataUrl || dataUrl.startsWith('data:image/svg+xml') || dataUrl.startsWith('data:application/pdf')) {
    return dataUrl;
  }

  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const w = img.naturalWidth || img.width;
        const h = img.naturalHeight || img.height;
        if (!w || !h) {
          resolve(dataUrl);
          return;
        }
        const cropY = Math.floor(h * 0.58);
        const cropH = h - cropY;
        const targetW = Math.max(1400, Math.min(2000, w));
        const targetH = Math.round((cropH * targetW) / w);

        const canvas = document.createElement('canvas');
        canvas.width = targetW;
        canvas.height = targetH;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(dataUrl);
          return;
        }
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, targetW, targetH);
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, cropY, w, cropH, 0, 0, targetW, targetH);

        const imgData = ctx.getImageData(0, 0, targetW, targetH);
        const pixels = imgData.data;
        for (let i = 0; i < pixels.length; i += 4) {
          const lum = 0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2];
          const boosted = Math.max(0, Math.min(255, (lum - 125) * 1.55 + 128));
          pixels[i] = boosted;
          pixels[i + 1] = boosted;
          pixels[i + 2] = boosted;
        }
        ctx.putImageData(imgData, 0, 0);

        resolve(canvas.toDataURL('image/jpeg', 0.95));
      } catch {
        resolve(dataUrl);
      }
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

/**
 * Run Tesseract.js OCR on a DataURL in the browser with caching
 */
async function runBrowserOcrOnImage(
  dataUrl: string | null | undefined,
  langSpec: string = 'kor+eng',
  enhanceContrast: boolean = false
): Promise<string> {
  if (!dataUrl) return '';

  const cacheKey = `${langSpec}:${enhanceContrast ? 'hc' : 'std'}:${dataUrl.length}:${dataUrl.slice(-120)}`;
  const cached = ocrTextCache.get(cacheKey);
  if (cached !== undefined) {
    return cached;
  }

  // Check if SVG data URL
  if (dataUrl.startsWith('data:image/svg+xml')) {
    try {
      const commaIdx = dataUrl.indexOf(',');
      if (commaIdx !== -1) {
        const payload = dataUrl.slice(commaIdx + 1);
        const decoded = dataUrl.includes(';base64,')
          ? decodeURIComponent(escape(atob(payload)))
          : decodeURIComponent(payload);
        ocrTextCache.set(cacheKey, decoded);
        return decoded;
      }
    } catch {
      return '';
    }
  }

  // If PDF data URL, extract any embedded readable ASCII/text strings
  if (dataUrl.startsWith('data:application/pdf')) {
    try {
      const base64 = dataUrl.split(';base64,')[1];
      if (base64) {
        const text = atob(base64);
        ocrTextCache.set(cacheKey, text);
        return text;
      }
    } catch {
      return '';
    }
    return '';
  }

  try {
    const processedUrl = await preprocessImageForOcr(dataUrl, enhanceContrast);
    // Allow 45 seconds so initial kor+eng traineddata CDN download never gets aborted mid-flight
    const ocrPromise = Tesseract.recognize(processedUrl, langSpec);
    const timeoutPromise = new Promise<{ data?: { text?: string } }>((resolve) =>
      setTimeout(() => resolve({ data: { text: '' } }), 45000)
    );
    const result = await Promise.race([ocrPromise, timeoutPromise]);
    const text = result?.data?.text || '';
    if (text.trim()) {
      ocrTextCache.set(cacheKey, text);
    }
    return text;
  } catch (err) {
    console.warn('[Client OCR] Tesseract error:', err);
    return '';
  }
}

/**
 * Normalize spaced Korean province/city names from OCR
 */
function normalizeKoreanAdminSpacing(text: string): string {
  return text
    .replace(/충\s*청\s*남\s*도/g, '충청남도')
    .replace(/충\s*청\s*북\s*도/g, '충청북도')
    .replace(/경\s*기\s*도/g, '경기도')
    .replace(/경\s*상\s*남\s*도/g, '경상남도')
    .replace(/경\s*상\s*북\s*도/g, '경상북도')
    .replace(/전\s*라\s*남\s*도/g, '전라남도')
    .replace(/전\s*라\s*북\s*도/g, '전라북도')
    .replace(/전\s*북\s*특\s*별\s*자\s*치\s*도/g, '전북특별자치도')
    .replace(/강\s*원\s*특\s*별\s*자\s*치\s*도/g, '강원특별자치도')
    .replace(/강\s*원\s*도/g, '강원도')
    .replace(/제\s*주\s*특\s*별\s*자\s*치\s*도/g, '제주특별자치도')
    .replace(/서\s*울\s*특\s*별\s*시/g, '서울특별시')
    .replace(/인\s*천\s*광\s*역\s*시/g, '인천광역시')
    .replace(/부\s*산\s*광\s*역\s*시/g, '부산광역시')
    .replace(/대\s*구\s*광\s*역\s*시/g, '대구광역시')
    .replace(/광\s*주\s*광\s*역\s*시/g, '광주광역시')
    .replace(/대\s*전\s*광\s*역\s*시/g, '대전광역시')
    .replace(/울\s*산\s*광\s*역\s*시/g, '울산광역시')
    .replace(/세\s*종\s*특\s*별\s*자\s*치\s*시/g, '세종특별자치시');
}

/**
 * Extract latest Korean residence address (체류지) from ARC back or front text,
 * including wrapped 2nd-line building/dong details.
 */
export function extractKoreanAddressFromText(rawCorpus: string): string | null {
  if (!rawCorpus) return null;

  const textCorpus = normalizeKoreanAdminSpacing(rawCorpus);
  const rawLines = textCorpus
    .split(/[\r\n<>]+/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const datePattern = /(\d{4}|\d{2})[.\-\s년/]+(\d{1,2})[.\-\s월/]+(\d{1,2})/;

  // Matches Korean province/city start OR city/county/district + road/dong
  const addrStartRegex = /((?:서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충북|충남|충청북도|충청남도|전북|전남|전라북도|전라남도|전북특별자치도|강원특별자치도|경북|경남|경상북도|경상남도|제주)[가-힣]*\s+[가-힣0-9\s\-~,().]+|[가-힣]{2,6}(?:시|군|구)\s+[가-힣]{1,12}(?:구|읍|면|동|로|길|가)\s*[가-힣0-9\s\-~,().]*)/;

  interface AddrCandidate {
    address: string;
    timestamp: number;
    lineIndex: number;
  }

  const candidates: AddrCandidate[] = [];

  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i];
    if (line.length < 4) continue;

    // Skip administrative notice lines
    if (
      line.includes('시·군·구청') ||
      line.includes('출입국·외국인') ||
      line.includes('새로운 체류지') ||
      line.includes('신고하여야') ||
      line.includes('범칙금') ||
      line.includes('지방출입국')
    ) {
      continue;
    }

    const match = line.match(addrStartRegex);
    if (!match) continue;

    let cleanAddr = match[1]
      .replace(/^(?:체류지|국내거소|주소|변경사항|신고일|신고일자)\s*[:：]?\s*/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    if (cleanAddr.length < 5) continue;
    if (cleanAddr.includes('출입국') || cleanAddr.includes('외국인청') || cleanAddr.includes('사무소')) continue;

    // Check if the next line is a wrapped continuation of this address (e.g. "85-9 (수석동)" or "101동 203호")
    if (i + 1 < rawLines.length) {
      const nextLine = rawLines[i + 1];
      const nextHasDate = datePattern.test(nextLine);
      const nextHasNewProvince = addrStartRegex.test(nextLine);
      const nextIsBoilerplate =
        nextLine.includes('시·군·구') ||
        nextLine.includes('출입국') ||
        nextLine.includes('체류지') ||
        nextLine.includes('변경사항') ||
        nextLine.includes('확인');

      if (
        !nextHasDate &&
        !nextHasNewProvince &&
        !nextIsBoilerplate &&
        nextLine.length >= 2 &&
        nextLine.length <= 35 &&
        /(?:\d+|번길|로|길|동|호|층|읍|면|리|\([가-힣0-9]+\))/.test(nextLine)
      ) {
        const cleanedCont = nextLine.replace(/[^가-힣0-9\s\-~,().]/g, '').trim();
        if (cleanedCont.length >= 2) {
          cleanAddr = `${cleanAddr} ${cleanedCont}`.replace(/\s+/g, ' ').trim();
        }
      }
    }

    // Check for report date (신고일) on same line or nearby lines
    let ts = 0;
    for (let offset = -1; offset <= 1; offset++) {
      const idx = i + offset;
      if (idx >= 0 && idx < rawLines.length) {
        const dMatch = rawLines[idx].match(datePattern);
        if (dMatch) {
          let y = parseInt(dMatch[1], 10);
          if (y < 100) y += 2000;
          const mo = parseInt(dMatch[2], 10);
          const da = parseInt(dMatch[3], 10);
          if (y >= 2010 && y <= 2035 && mo >= 1 && mo <= 12 && da >= 1 && da <= 31) {
            ts = new Date(y, mo - 1, da).getTime();
            break;
          }
        }
      }
    }

    candidates.push({
      address: cleanAddr,
      timestamp: ts,
      lineIndex: i,
    });
  }

  if (candidates.length === 0) return null;

  const withDates = candidates.filter((c) => c.timestamp > 0);
  if (withDates.length > 0) {
    withDates.sort((a, b) => b.timestamp - a.timestamp);
    return withDates[0].address;
  }

  return candidates[candidates.length - 1].address;
}

/**
 * Helper to clean and validate candidate name words.
 * When requireLongWord is true (used for unlabeled fallback lines), requires at least one word >= 4 letters
 * so short 2-3 letter OCR noise pairs like "MIM FIN" are rejected.
 */
function filterValidNameWords(rawPhrase: string, requireLongWord: boolean = false): string | null {
  const cleaned = rawPhrase
    .toUpperCase()
    .replace(/[^A-Z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!cleaned) return null;

  const words = cleaned
    .split(' ')
    .filter((w) => w.length >= 2 && !NON_NAME_WORDS.has(w));

  if (words.length >= 2 && words.length <= 4) {
    const minNeeded = requireLongWord ? 4 : 3;
    if (words.some((w) => w.length >= minNeeded)) {
      return words.join(' ');
    }
  }
  return null;
}

/**
 * Helper to find 13-digit Alien Registration Number even if OCR misreads 0 as O, 1 as I/l, 5 as S, or 8 as B
 */
function findArcRegNumberInText(text: string): { reg1: string; reg2: string; matchIndex: number; matchLength: number } | null {
  if (!text) return null;
  // Direct clean match first
  const cleanMatch = text.match(/\b(\d{6})\s*[-–~.\s]\s*([1-8]\d{6})\b/);
  if (cleanMatch && cleanMatch.index !== undefined) {
    return {
      reg1: cleanMatch[1],
      reg2: cleanMatch[2],
      matchIndex: cleanMatch.index,
      matchLength: cleanMatch[0].length,
    };
  }

  // Tolerant OCR digit match (e.g. 95O91O-576OO23)
  const tokenRegex = /\b([0-9OIlSB]{6})\s*[-–~.\s]+\s*([1-8OIlSB][0-9OIlSB]{6})\b/g;
  let m: RegExpExecArray | null;
  while ((m = tokenRegex.exec(text)) !== null) {
    const fixDigits = (s: string) =>
      s
        .replace(/O/gi, '0')
        .replace(/[Il|]/g, '1')
        .replace(/S/gi, '5')
        .replace(/B/gi, '8');
    const r1 = fixDigits(m[1]);
    const r2 = fixDigits(m[2]);
    if (/^\d{6}$/.test(r1) && /^[1-8]\d{6}$/.test(r2)) {
      const mm = parseInt(r1.slice(2, 4), 10);
      const dd = parseInt(r1.slice(4, 6), 10);
      if (mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31) {
        return {
          reg1: r1,
          reg2: r2,
          matchIndex: m.index,
          matchLength: m[0].length,
        };
      }
    }
  }
  return null;
}

/**
 * Tier 1: Extract name from Passport MRZ line 1 (P<KHMSURNAME<<GIVENNAME)
 */
function extractMrzNameFromText(textCorpus: string): string | null {
  if (!textCorpus) return null;
  const upperCorpus = textCorpus.toUpperCase();
  const mrzLineMatch = upperCorpus.match(
    /P[A-Z0-9<«(\s]{0,2}(?:KHM|VNM|NPL|UZB|MMR|THA|IDN|PHL|CHN|MNG|LKA|BGD|PAK|IND|KAZ|KGZ|TLS|LAO)([A-Z0-9<«\s]{5,42})/
  );
  if (mrzLineMatch) {
    const rawMrzTail = mrzLineMatch[1].replace(/«/g, '<').trim();
    const parts = rawMrzTail
      .split(/<{2,}/)
      .map((s) => s.replace(/</g, ' ').replace(/\b[CKL]{3,}\b/g, ' ').replace(/[CKL]{4,}$/g, '').trim())
      .filter((s) => s.length >= 2);
    if (parts.length >= 2) {
      const combinedMrz = filterValidNameWords(`${parts[0]} ${parts[1]}`);
      if (combinedMrz) return combinedMrz;
    } else if (parts.length === 1) {
      const fallbackSpaceParts = parts[0].split(/\s+/);
      if (fallbackSpaceParts.length >= 2) {
        const combinedMrz = filterValidNameWords(`${fallbackSpaceParts[0]} ${fallbackSpaceParts[1]}`);
        if (combinedMrz) return combinedMrz;
      }
    }
  }

  const mrzCountryDirect = upperCorpus.match(
    /(?:KHM|VNM|NPL|UZB|MMR|THA|IDN|PHL|CHN|MNG|LKA|BGD|PAK)\s*([A-Z]{2,18})[<«\s]{2,}([A-Z]{2,18})/
  );
  if (mrzCountryDirect) {
    const surname = mrzCountryDirect[1].trim();
    const given = mrzCountryDirect[2].replace(/[KLC<«]{3,}$/g, '').trim();
    const combinedMrz = filterValidNameWords(`${surname} ${given}`);
    if (combinedMrz) return combinedMrz;
  }
  return null;
}

/**
 * Tier 2: Extract name from explicit labels (성명 / 영문성명 / Name in English / Surname)
 */
function extractLabeledNameFromText(textCorpus: string): string | null {
  if (!textCorpus) return null;
  const lines = textCorpus
    .split(/[\r\n<>]+/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/(?:성\s*명|영문성명|Name\s*in\s*English|\bName\b|\bSurname\b)/i.test(line)) {
      const strippedSame = line
        .replace(/[가-힣()/:：,]+/g, ' ')
        .replace(/\b(?:Name|in|English|Date|of|Birth|Sex|Gender|Male|Female|Surname|Given|Names|Registration|No|Country|Region|Nationality|Cambodia)\b/gi, ' ');
      const sameCandidate = filterValidNameWords(strippedSame);
      if (sameCandidate) return sameCandidate;

      for (let offset = 1; offset <= 2; offset++) {
        if (i + offset < lines.length) {
          const nextRaw = lines[i + offset];
          // Require uppercase-only tokens on following lines to avoid Hangul OCR garbage
          const upperMatches = nextRaw.match(/\b([A-Z]{2,18}(?:[,\s]+[A-Z]{2,18}){1,3})\b/g);
          if (upperMatches) {
            for (const um of upperMatches) {
              const nextCandidate = filterValidNameWords(um);
              if (nextCandidate) return nextCandidate;
            }
          }
        }
      }
    }
  }
  return null;
}

/**
 * Tier 3: Extract strict ALL-CAPS English name printed right after the 13-digit ARC Reg Number
 */
function extractArcRegAdjacentName(textCorpus: string): string | null {
  if (!textCorpus) return null;
  const regFound = findArcRegNumberInText(textCorpus);
  if (!regFound) return null;

  const afterReg = textCorpus.slice(
    regFound.matchIndex + regFound.matchLength,
    regFound.matchIndex + regFound.matchLength + 260
  );
  const afterLines = afterReg
    .split(/[\r\n<>]+/)
    .map((l) => l.trim())
    .filter((l) => l.length >= 3);

  for (let i = 0; i < Math.min(4, afterLines.length); i++) {
    // Only consider strictly ALL-UPPERCASE sequences so Hangul-misread mixed-case noise (e.g. "Mim fin") is ignored
    const upperMatches = afterLines[i].match(/\b([A-Z]{2,18}(?:[,\s]+[A-Z]{2,18}){1,3})\b/g);
    if (!upperMatches) continue;
    for (const um of upperMatches) {
      const candidate = filterValidNameWords(um, true);
      if (candidate) return candidate;
    }
  }
  return null;
}

/**
 * Tier 4: Lowest-priority scan for strictly ALL-UPPERCASE 2-4 word name lines
 */
function extractStrictUppercaseFallbackName(textCorpus: string): string | null {
  if (!textCorpus) return null;
  const lines = textCorpus
    .split(/[\r\n<>]+/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/RESIDENCE\s+CARD|REGISTRATION\s+CARD|REPUBLIC\s+OF\s+KOREA|PROFICIENCY\s+IN\s+KOREAN/i.test(line)) {
      continue;
    }
    const upperMatches = line.match(/\b([A-Z]{2,18}(?:[,\s]+[A-Z]{2,18}){1,3})\b/g);
    if (!upperMatches) continue;
    for (const raw of upperMatches) {
      const candidate = filterValidNameWords(raw, true);
      if (candidate) return candidate;
    }
  }
  return null;
}

/**
 * Extract applicant's English uppercase name from OCR text (ARC / Passport MRZ / TOPIK)
 */
export function extractApplicantNameFromText(textCorpus: string): string | null {
  if (!textCorpus) return null;
  return (
    extractMrzNameFromText(textCorpus) ||
    extractLabeledNameFromText(textCorpus) ||
    extractArcRegAdjacentName(textCorpus) ||
    extractStrictUppercaseFallbackName(textCorpus)
  );
}

/**
 * Parse combined OCR text from ARC Front, ARC Back, TOPIK Certificate, and Passport
 */
export function parseOcrCorpusToData(
  arcFrontText: string,
  arcBackText: string,
  topikText: string,
  passportText: string
): ExtractedDocumentData {
  const combined = `${arcFrontText}\n${arcBackText}\n${topikText}\n${passportText}`;
  const result: ExtractedDocumentData = {};

  // 1. Name (Confidence-tiered across ALL docs so clean Passport MRZ & TOPIK always beat noisy ARC lines)
  const detectedName =
    extractMrzNameFromText(passportText) ||
    extractMrzNameFromText(combined) ||
    extractLabeledNameFromText(topikText) ||
    extractLabeledNameFromText(passportText) ||
    extractLabeledNameFromText(arcFrontText) ||
    extractArcRegAdjacentName(arcFrontText) ||
    extractStrictUppercaseFallbackName(topikText) ||
    extractStrictUppercaseFallbackName(passportText) ||
    extractStrictUppercaseFallbackName(arcFrontText);
  if (detectedName) {
    result.name = detectedName;
  }

  // 2. Alien Registration Number (6 digits - 7 digits) with OCR digit typo tolerance
  const regFound =
    findArcRegNumberInText(arcFrontText) ||
    findArcRegNumberInText(combined);
  if (regFound) {
    result.regNumber1 = regFound.reg1;
    result.regNumber2 = regFound.reg2;
  } else {
    const fallbackReg =
      arcFrontText.match(/\b(\d{6})[\s\-–._/]*([1-8]\d{6})\b/) ||
      combined.match(/\b(\d{6})[\s\-–._/]*([1-8]\d{6})\b/) ||
      arcFrontText.match(/\b(\d{13})\b/) ||
      combined.match(/(\d{6})\s*[-–]\s*(\d{7})/);
    if (fallbackReg) {
      if (fallbackReg[2]) {
        result.regNumber1 = fallbackReg[1];
        result.regNumber2 = fallbackReg[2];
      } else if (fallbackReg[1] && fallbackReg[1].length === 13) {
        result.regNumber1 = fallbackReg[1].slice(0, 6);
        result.regNumber2 = fallbackReg[1].slice(6, 13);
      }
    }
  }

  // 3. Gender
  if (result.regNumber2) {
    const firstDigit = result.regNumber2.charAt(0);
    if (['1', '3', '5', '7'].includes(firstDigit)) {
      result.gender = '남';
    } else if (['2', '4', '6', '8'].includes(firstDigit)) {
      result.gender = '여';
    }
  }
  if (!result.gender) {
    if (/\b(?:FEMALE|여\s*자|\/\s*여)\b/i.test(combined)) {
      result.gender = '여';
    } else if (/\b(?:MALE|남\s*자|\/\s*남)\b/i.test(combined)) {
      result.gender = '남';
    }
  }

  // 4. Nationality
  const natMatch = combined.match(
    /\b(CAMBODIA|VIETNAM|NEPAL|UZBEKISTAN|MYANMAR|THAILAND|INDONESIA|PHILIPPINES|CHINA|MONGOLIA|SRI\s*LANKA|BANGLADESH|PAKISTAN)\b/i
  );
  if (natMatch) {
    const rawNat = natMatch[1].toUpperCase();
    result.nationality = rawNat.charAt(0) + rawNat.slice(1).toLowerCase();
  } else if (/KHM|캄보디아/.test(combined)) {
    result.nationality = 'Cambodia';
  }

  // 5. Visa Status (체류자격)
  const visaMatch =
    arcFrontText.match(/\b(E-?9-?1|E-?7-?4|E-?7-?1|E-?9|E-?7|F-?2-?R|F-?2|F-?5|F-?6|D-?2|D-?4|D-?10|H-?2)\b/i) ||
    combined.match(/(?:체\s*류\s*자\s*격|Status)[^\nA-Za-z0-9]{0,12}([A-Z]\s*[-–]?\s*\d(?:\s*[-–]?\s*[A-Z0-9])?)/i);
  if (visaMatch) {
    let v = visaMatch[1].toUpperCase().replace(/\s+/g, '');
    if (/^E91$/.test(v)) v = 'E-9-1';
    else if (/^E74$/.test(v)) v = 'E-7-4';
    else if (/^E71$/.test(v)) v = 'E-7-1';
    else if (/^F2R$/.test(v)) v = 'F-2-R';
    result.visaStatus = v;
  }

  // 6. Korean Residence Address (Prefer ARC Back -> ARC Front -> Combined)
  const detectedAddress =
    extractKoreanAddressFromText(arcBackText) ||
    extractKoreanAddressFromText(arcFrontText) ||
    extractKoreanAddressFromText(combined);
  if (detectedAddress) {
    result.address = detectedAddress;
  }

  // 7. TOPIK Verification Number (문서확인번호: 16 digits, XXXX-XXXX-XXXX-XXXX)
  let detectedDocVer: string[] | null = null;
  // Clean OCR text for verification number (normalize common OCR digit confusions O->0, l/I->1 within number blocks)
  const docVerCleaned = (topikText + '\n' + combined)
    .replace(/(?<=\d)[oO](?=\d)/g, '0')
    .replace(/(?<=\d)[lI](?=\d)/g, '1');

  // Match 4 groups of 4 digits separated by any punctuation/space
  const docVer4Match =
    docVerCleaned.match(/(?:문\s*서\s*확\s*인\s*번\s*호|발급확인번호|진위확인번호|Verification\s*(?:No\.?)?)[^\d\n]{0,25}(\d{4})[^\d\n]{1,4}(\d{4})[^\d\n]{1,4}(\d{4})[^\d\n]{1,4}(\d{4})/i) ||
    docVerCleaned.match(/\b(\d{4})[.\-\s–—]{1,3}(\d{4})[.\-\s–—]{1,3}(\d{4})[.\-\s–—]{1,3}(\d{4})\b/);

  if (docVer4Match) {
    detectedDocVer = [docVer4Match[1], docVer4Match[2], docVer4Match[3], docVer4Match[4]];
  } else {
    // Match 16 consecutive digits near keywords
    const docVer16Match =
      docVerCleaned.match(/(?:문\s*서\s*확\s*인\s*번\s*호|Verification|발급확인|진위확인)[^\d\n]{0,25}(\d{16})/i) ||
      docVerCleaned.match(/\b(\d{16})\b/);
    if (docVer16Match) {
      const s = docVer16Match[1];
      if (s !== '0000000000000000') {
        detectedDocVer = [s.slice(0, 4), s.slice(4, 8), s.slice(8, 12), s.slice(12, 16)];
      }
    }
  }

  if (detectedDocVer && detectedDocVer.some(p => p && p !== '0000')) {
    result.docVerificationNo = detectedDocVer;
  }

  // 8. TOPIK Exam Registration Number (수험번호: 10~16 digits, usually 12-14 digits)
  const examNumMatch =
    topikText.match(/(?:수\s*험\s*번\s*호|수\s*험\s*번호|Registration\s*(?:No\.?)?|Examinee(?:\s*No\.?)?|Application\s*(?:No\.?)?)[^\d\n]{0,25}(\d{8,16})/i) ||
    topikText.match(/(?:수\s*험\s*번\s*호|Registration\s*No)[^\d]{0,40}\n[^\d]{0,10}(\d{8,16})/i) ||
    topikText.match(/\b(0\d{10,14})\b/) ||
    combined.match(/\b(00\d{11,13})\b/) ||
    topikText.match(/\b(\d{11,14})\b/);

  if (examNumMatch) {
    const rawDigits = examNumMatch[1].replace(/[^0-9]/g, '');
    if (rawDigits.length >= 6 && !/^0+$/.test(rawDigits)) {
      result.examNumber = rawDigits;
    }
  }

  // 9. TOPIK Round (회차: e.g. 제 89 회, 92회, 107회)
  const roundMatch =
    topikText.match(/(?:제\s*)?(\d{1,3})\s*회/i) ||
    topikText.match(/(?:회\s*차|회\s{1,8}차|Test\s*(?:Held|Number|No\.?)|Round|Edition)[^\d\n]{0,20}(\d{1,3})/i) ||
    topikText.match(/The\s*(\d{1,3})(?:st|nd|rd|th)\s*(?:Test|TOPIK)/i) ||
    topikText.match(/(\d{2,3})(?:st|nd|rd|th)/i) ||
    combined.match(/(?:제\s*)?(\d{2,3})\s*회/);

  if (roundMatch) {
    const r = roundMatch[1].replace(/[^0-9]/g, '');
    if (r && r !== '0' && r !== '000') {
      result.round = r;
    }
  }

  // 10. TOPIK Grade (취득등급 / 등급: 1급 ~ 6급)
  const gradeMatch =
    topikText.match(/(?:취\s*득\s*등\s*급|합\s*격\s*등\s*급|등\s*급|Grade|Level|Evaluation)[^\d\n]{0,15}([1-6])\s*급?/i) ||
    topikText.match(/(?:TOPIK\s*[I|II]{1,2})[^\d\n]{0,15}([1-6])\s*급/i) ||
    topikText.match(/([1-6])\s*급/) ||
    combined.match(/(?:취득등급|합격등급|등급)[^\d\n]{0,12}([1-6])/i) ||
    combined.match(/([1-6])\s*급/);

  if (gradeMatch) {
    result.grade = `${gradeMatch[1]}급`;
  } else {
    // Score inference if total score (총점) is visible:
    const scoreMatch = topikText.match(/(?:총\s*점|Total\s*Score|점\s*수)[^\d\n]{0,15}(\d{2,3})/i);
    if (scoreMatch) {
      const score = parseInt(scoreMatch[1], 10);
      const isTopikI = /\bTOPIK\s*I\b(?!I)/i.test(topikText);
      if (isTopikI) {
        if (score >= 140) result.grade = '2급';
        else if (score >= 80) result.grade = '1급';
      } else {
        if (score >= 230) result.grade = '6급';
        else if (score >= 190) result.grade = '5급';
        else if (score >= 150) result.grade = '4급';
        else if (score >= 120) result.grade = '3급';
        else if (score >= 80) result.grade = '1급';
      }
    }
  }

  // 11. TOPIK Exam Date & Valid Until Date
  const examDateMatch =
    topikText.match(/(?:시\s*험\s*일(?:\s*자)?|Test\s*Date)[^\d\n]{0,20}(\d{4})[.\-\s년/]+(\d{1,2})[.\-\s월/]+(\d{1,2})/i) ||
    topikText.match(/(\d{4})[.\-\s/]+(\d{1,2})[.\-\s/]+(\d{1,2})\s*\([제\s]*\d+회/);
  if (examDateMatch) {
    const y = examDateMatch[1];
    const m = examDateMatch[2].padStart(2, '0');
    const d = examDateMatch[3].padStart(2, '0');
    result.examDate = `${y}-${m}-${d}`;
  }

  const validMatch =
    topikText.match(/(?:성\s*적\s*유\s*효\s*기\s*간|유\s*효\s*기\s*간|Valid\s*Until|Expiration)[^\d\n]{0,25}(\d{4})[.\-\s년/]+(\d{1,2})[.\-\s월/]+(\d{1,2})/i);
  if (validMatch) {
    const y = validMatch[1];
    const m = validMatch[2].padStart(2, '0');
    const d = validMatch[3].padStart(2, '0');
    result.validUntil = `${y}-${m}-${d}`;
  }

  // 12. Name & Birth Date from TOPIK Certificate (if not already found on ARC)
  if (!result.name) {
    const topikNameMatch =
      topikText.match(/(?:Name\s*in\s*English|영\s*문\s*성\s*명|성\s*명\s*\(?영\s*문\)?)[^A-Z\n]{0,20}([A-Z]{2,18}(?:[,\s]+[A-Z]{2,18}){1,3})/) ||
      topikText.match(/(?:성\s*명|Name)[^A-Z\n]{0,12}([A-Z]{2,15}(?:[,\s]+[A-Z]{2,15}){1,2})/);
    if (topikNameMatch) {
      const cleanTopikName = cleanName(topikNameMatch[1]);
      if (cleanTopikName && cleanTopikName !== '0000 0000') {
        result.name = cleanTopikName;
      }
    }
  }

  if (!result.regNumber1) {
    const topikBirthMatch = topikText.match(/(?:생\s*년\s*월\s*일|Date\s*of\s*Birth|Birth\s*Date)[^\d\n]{0,20}(\d{2,4})[.\-\s년/]+(\d{1,2})[.\-\s월/]+(\d{1,2})/i);
    if (topikBirthMatch) {
      const yStr = topikBirthMatch[1].slice(-2);
      const mStr = topikBirthMatch[2].padStart(2, '0');
      const dStr = topikBirthMatch[3].padStart(2, '0');
      result.regNumber1 = `${yStr}${mStr}${dStr}`;
    }
  }

  // 12. Passport Number & Expiry (including ICAO MRZ line 2)
  const mrzLine2 = combined.match(/([A-Z0-9<]{9})\d[A-Z]{3}(\d{6})\d([MF<])(\d{6})/);
  if (mrzLine2) {
    const rawPassNo = mrzLine2[1].replace(/</g, '').trim();
    if (rawPassNo.length >= 6) {
      result.passportNo = rawPassNo;
    }
    if (!result.regNumber1 && /^\d{6}$/.test(mrzLine2[2])) {
      result.regNumber1 = mrzLine2[2];
    }
    const expRaw = mrzLine2[4];
    if (/^\d{6}$/.test(expRaw)) {
      const yy = parseInt(expRaw.slice(0, 2), 10);
      const mm = expRaw.slice(2, 4);
      const dd = expRaw.slice(4, 6);
      result.passportExpiry = `${2000 + yy}-${mm}-${dd}`;
    }
  }

  if (!result.passportNo) {
    const passMatch =
      passportText.match(/\b([A-Z]{1,2}\d{7,8})\b/) ||
      combined.match(/(?:여\s*권\s*번\s*호|Passport\s*No)[^\nA-Z0-9]{0,12}([A-Z]{1,2}\d{7,8})/i);
    if (passMatch) {
      result.passportNo = passMatch[1].toUpperCase();
    }
  }

  return result;
}

/**
 * Server-side Gemini document extraction proxy with local Tesseract.js fallback.
 * All Gemini model calls are executed exclusively on the server.
 */
export async function extractDocumentsClientSide(params: {
  arcFront?: string | null;
  arcBack?: string | null;
  topikCert?: string | null;
  passport?: string | null;
  skipServer?: boolean;
}): Promise<ExtractedDocumentData> {
  // 1. Try server-side Gemini OCR endpoint first unless caller already attempted it
  if (!params.skipServer) {
    try {
      const [cFront, cBack, cTopik, cPassport] = await Promise.all([
        compressImageForApi(params.arcFront),
        compressImageForApi(params.arcBack),
        compressImageForApi(params.topikCert),
        compressImageForApi(params.passport),
      ]);
      const res = await fetch('/api/extract-documents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          arcFront: cFront,
          arcBack: cBack,
          topikCert: cTopik,
          passport: cPassport,
        }),
      });
      if (res.ok) {
        const result = await res.json();
        if (
          result.success &&
          result.data &&
          (result.data.name ||
            result.data.regNumber1 ||
            result.data.examNumber ||
            (Array.isArray(result.data.docVerificationNo) && result.data.docVerificationNo.length > 0))
        ) {
          return result.data as ExtractedDocumentData;
        }
      }
    } catch (err) {
      console.warn('[Client OCR] Server-side extraction attempt failed, falling back to local OCR:', err);
    }
  }

  // 2. Fallback to local Tesseract.js OCR if server is unreachable or GEMINI_API_KEY is missing
  // Run clean 'eng' pass on ARC Front + Passport first so Hangul character confusion never garbles English names/digits
  let arcFrontText = params.arcFront ? await runBrowserOcrOnImage(params.arcFront, 'eng', false) : '';
  let passportText = params.passport ? await runBrowserOcrOnImage(params.passport, 'eng', false) : '';
  let arcBackText = params.arcBack ? await runBrowserOcrOnImage(params.arcBack, 'kor', false) : '';
  let topikText = params.topikCert ? await runBrowserOcrOnImage(params.topikCert, 'kor+eng', false) : '';

  let parsed = parseOcrCorpusToData(arcFrontText, arcBackText, topikText, passportText);

  // 3. Targeted high-contrast / MRZ / kor+eng second-pass if primary pass missed key fields
  if (params.arcFront && (!parsed.regNumber1 || !parsed.name || !parsed.visaStatus)) {
    const hcFront = await runBrowserOcrOnImage(params.arcFront, 'eng', true);
    if (hcFront) arcFrontText = `${arcFrontText}\n${hcFront}`;
  }
  if (params.arcBack && !parsed.address) {
    const hcBack = await runBrowserOcrOnImage(params.arcBack, 'kor', true);
    if (hcBack) arcBackText = `${arcBackText}\n${hcBack}`;
  }
  if (params.passport && (!parsed.passportNo || !parsed.name)) {
    const mrzCropUrl = await cropPassportMrzForOcr(params.passport);
    const mrzText = await runBrowserOcrOnImage(mrzCropUrl, 'eng', false);
    if (mrzText) passportText = `${passportText}\n${mrzText}`;
  }
  if (params.topikCert && (!parsed.examNumber || !parsed.docVerificationNo)) {
    const hcTopik = await runBrowserOcrOnImage(params.topikCert, 'kor+eng', true);
    if (hcTopik) topikText = `${topikText}\n${hcTopik}`;
  }

  parsed = parseOcrCorpusToData(arcFrontText, arcBackText, topikText, passportText);
  return parsed;
}

/**
 * Smartly merges newly extracted OCR fields into existing ApplicationFormData,
 * replacing initial '0000' placeholders while preserving already-extracted real fields.
 * NEVER rejects real user data.
 */
export function mergeExtractedIntoFormData(
  prev: ApplicationFormData,
  ext: ExtractedDocumentData
): ApplicationFormData {
  const isPlaceholderName = (v?: string | null) =>
    !v || !v.trim() || /^0+(\s+0+)*$/.test(v.trim()) || v.trim() === '0000 0000' || v.trim() === '0000';
  const isPlaceholderReg1 = (v?: string | null) =>
    !v || !v.trim() || /^0{6}$/.test(v.trim());
  const isPlaceholderReg2 = (v?: string | null) =>
    !v || !v.trim() || /^0{7}$/.test(v.trim()) || v.trim() === '1000000';
  const isPlaceholderAddr = (v?: string | null) =>
    !v || !v.trim() || /^0+(\s+0+)*$/.test(v.trim()) || v.trim() === '00000 0000 000';
  const isPlaceholderExamNo = (v?: string | null) =>
    !v || !v.trim() || /^0+$/.test(v.trim());
  const isPlaceholderDate = (v?: string | null) =>
    !v || !v.trim() || v.trim() === '0000-00-00';
  const isPlaceholderRound = (v?: string | null) =>
    !v || !v.trim() || v.trim() === '000' || v.trim() === '0';
  const isPlaceholderGrade = (v?: string | null) =>
    !v || !v.trim() || v.trim() === '0급';

  const rawName =
    ext.name && !isPlaceholderName(ext.name)
      ? ext.name
      : !isPlaceholderName(prev.name)
      ? prev.name
      : '';
  const finalName = rawName ? cleanName(rawName) : prev.name;

  const rawReg1 =
    ext.regNumber1 && !isPlaceholderReg1(ext.regNumber1)
      ? ext.regNumber1
      : !isPlaceholderReg1(prev.regNumber1)
      ? prev.regNumber1
      : '';
  const rawReg2 =
    ext.regNumber2 && !isPlaceholderReg2(ext.regNumber2)
      ? ext.regNumber2
      : !isPlaceholderReg2(prev.regNumber2)
      ? prev.regNumber2
      : '';
  const reg = normalizeRegNumbers(rawReg1, rawReg2);

  const finalAddress =
    ext.address && !isPlaceholderAddr(ext.address) ? ext.address : (isPlaceholderAddr(prev.address) ? '' : prev.address);

  const hasNewDocVer = Array.isArray(ext.docVerificationNo)
    ? ext.docVerificationNo.length === 4 &&
      ext.docVerificationNo.some((p: string) => p && p !== '0000') &&
      ext.docVerificationNo.join('') !== '0000000000000000'
    : typeof ext.docVerificationNo === 'string' &&
      ext.docVerificationNo.replace(/0|-|\s/g, '').length > 0;
  
  let docParts = prev.docVerificationNo;
  if (hasNewDocVer && ext.docVerificationNo) {
    docParts = normalizeDocVerificationNo(ext.docVerificationNo, prev.docVerificationNo);
  } else if (Array.isArray(prev.docVerificationNo) && prev.docVerificationNo.every(p => !p || p === '0000')) {
    docParts = ['', '', '', ''];
  }

  const finalExamNo =
    ext.examNumber && !isPlaceholderExamNo(ext.examNumber)
      ? cleanExamNumber(ext.examNumber)
      : isPlaceholderExamNo(prev.examNumber)
      ? ''
      : prev.examNumber;

  const finalExamDate =
    ext.examDate && !isPlaceholderDate(ext.examDate)
      ? ext.examDate
      : isPlaceholderDate(prev.examDate)
      ? ''
      : prev.examDate;

  const finalRound =
    ext.round && !isPlaceholderRound(ext.round)
      ? cleanRound(ext.round)
      : isPlaceholderRound(prev.round)
      ? ''
      : prev.round;

  const finalValidUntil =
    ext.validUntil && !isPlaceholderDate(ext.validUntil)
      ? ext.validUntil
      : isPlaceholderDate(prev.validUntil)
      ? ''
      : prev.validUntil;

  const finalGrade =
    ext.grade && !isPlaceholderGrade(ext.grade)
      ? cleanGrade(ext.grade)
      : isPlaceholderGrade(prev.grade)
      ? ''
      : prev.grade;

  return {
    ...prev,
    name: finalName,
    applicantName: finalName,
    regNumber1: reg.regNumber1,
    regNumber2: reg.regNumber2,
    gender:
      ext.gender === '여'
        ? '여'
        : ext.gender === '남'
        ? '남'
        : !isPlaceholderReg2(reg.regNumber2)
        ? reg.gender
        : prev.gender,
    nationality: ext.nationality || prev.nationality || 'Cambodia',
    visaStatus: ext.visaStatus ? cleanVisaStatus(ext.visaStatus) : prev.visaStatus,
    passportNo: (ext.passportNo || prev.passportNo || '').toUpperCase().trim(),
    passportExpiry: ext.passportExpiry || prev.passportExpiry || '',
    address: finalAddress,
    docVerificationNo: docParts,
    examNumber: finalExamNo,
    examDate: finalExamDate,
    round: finalRound,
    validUntil: finalValidUntil,
    grade: finalGrade,
  };
}
