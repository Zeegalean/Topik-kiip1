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
import { extractPdfTextAndImageFromDataUrl, isPdfDataUrl } from './pdfOcrUtils';
import { findOfficeByAddress } from '../data/immigrationOffices';

export type OcrConfidenceKey =
  | 'name'
  | 'regNumber'
  | 'gender'
  | 'nationality'
  | 'visaStatus'
  | 'address'
  | 'docVerificationNo'
  | 'examNumber'
  | 'round'
  | 'examDate'
  | 'validUntil'
  | 'grade'
  | 'passportNo'
  | 'passportExpiry';

export type OcrConfidenceSource =
  | 'ai-vision'
  | 'pdf-digital'
  | 'tesseract'
  | 'svg-preset'
  | 'manual'
  | 'missing';

export interface OcrFieldConfidence {
  score: number;
  source: OcrConfidenceSource;
  reason?: string;
}

export type OcrFieldConfidenceMap = Partial<Record<OcrConfidenceKey, OcrFieldConfidence>>;

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
const ocrResultCache = new Map<string, { text: string; confidence: number }>();

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
  maxDim: number = 1800,
  quality: number = 0.88
): Promise<string | null | undefined> {
  if (!dataUrl || typeof dataUrl !== 'string') return dataUrl;
  if (dataUrl.startsWith('data:image/svg+xml') || isPdfDataUrl(dataUrl)) {
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
 * Run Tesseract.js OCR on a DataURL in the browser with caching and confidence tracking
 */
async function runBrowserOcrWithMeta(
  dataUrl: string | null | undefined,
  langSpec: string = 'kor+eng',
  enhanceContrast: boolean = false
): Promise<{ text: string; confidence: number }> {
  if (!dataUrl) return { text: '', confidence: 0 };

  const cacheKey = `${langSpec}:${enhanceContrast ? 'hc' : 'std'}:${dataUrl.length}:${dataUrl.slice(-120)}`;
  const cached = ocrResultCache.get(cacheKey);
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
        const entry = { text: decoded, confidence: 98 };
        ocrResultCache.set(cacheKey, entry);
        return entry;
      }
    } catch {
      return { text: '', confidence: 0 };
    }
  }

  // If PDF data URL, extract real digital text + rasterize Page 1 via pdfjs-dist (never raw atob binary!)
  if (isPdfDataUrl(dataUrl)) {
    try {
      const pdfParsed = await extractPdfTextAndImageFromDataUrl(dataUrl);
      let visualText = '';
      let visualConf = 94;
      // If scanned PDF (minimal digital text) and Page 1 rendered to image, also run Tesseract OCR
      if (pdfParsed.imageUrl && pdfParsed.text.trim().length < 80) {
        const processedPdfImg = await preprocessImageForOcr(pdfParsed.imageUrl, enhanceContrast);
        const ocrPromise = Tesseract.recognize(processedPdfImg, langSpec);
        const timeoutPromise = new Promise<{ data?: { text?: string; confidence?: number } }>((resolve) =>
          setTimeout(() => resolve({ data: { text: '', confidence: 0 } }), 35000)
        );
        const result = await Promise.race([ocrPromise, timeoutPromise]);
        visualText = result?.data?.text || '';
        visualConf = typeof result?.data?.confidence === 'number' ? Math.round(result.data.confidence) : 72;
      }
      const combinedPdfText = [pdfParsed.text, visualText].filter(Boolean).join('\n');
      const finalConf = pdfParsed.text.trim().length >= 80 ? 95 : visualConf;
      if (combinedPdfText.trim()) {
        ocrResultCache.set(cacheKey, { text: combinedPdfText, confidence: finalConf });
      }
      return { text: combinedPdfText, confidence: finalConf };
    } catch {
      return { text: '', confidence: 0 };
    }
  }

  try {
    const processedUrl = await preprocessImageForOcr(dataUrl, enhanceContrast);
    // Allow 45 seconds so initial kor+eng traineddata CDN download never gets aborted mid-flight
    const ocrPromise = Tesseract.recognize(processedUrl, langSpec);
    const timeoutPromise = new Promise<{ data?: { text?: string; confidence?: number } }>((resolve) =>
      setTimeout(() => resolve({ data: { text: '', confidence: 0 } }), 45000)
    );
    const result = await Promise.race([ocrPromise, timeoutPromise]);
    const text = result?.data?.text || '';
    const rawConf = typeof result?.data?.confidence === 'number' ? Math.round(result.data.confidence) : 74;
    const confidence = text.trim() ? Math.max(35, Math.min(96, rawConf)) : 0;
    if (text.trim()) {
      ocrResultCache.set(cacheKey, { text, confidence });
    }
    return { text, confidence };
  } catch (err) {
    console.warn('[Client OCR] Tesseract error:', err);
    return { text: '', confidence: 0 };
  }
}

async function runBrowserOcrOnImage(
  dataUrl: string | null | undefined,
  langSpec: string = 'kor+eng',
  enhanceContrast: boolean = false
): Promise<string> {
  const res = await runBrowserOcrWithMeta(dataUrl, langSpec, enhanceContrast);
  return res.text;
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
    .replace(/세\s*종\s*특\s*별\s*자\s*치\s*시/g, '세종특별자치시')
    .replace(/번\s+길/g, '번길')
    .replace(/체\s*류\s*지/g, '체류지');
}

const MONTH_NAME_MAP: Record<string, string> = {
  jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
  jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
};

function isValidYmd(y: number, m: number, d: number, minYear = 1920, maxYear = 2045): boolean {
  return y >= minYear && y <= maxYear && m >= 1 && m <= 12 && d >= 1 && d <= 31;
}

export function parseFlexibleDateClient(raw: string, minYear = 1920, maxYear = 2045): string | null {
  if (!raw) return null;
  const s = String(raw).trim();

  const ymd = s.match(/(\d{4})\s*[.\-년/]\s*(\d{1,2})\s*[.\-월/]\s*(\d{1,2})/);
  if (ymd) {
    const y = parseInt(ymd[1], 10);
    const m = parseInt(ymd[2], 10);
    const d = parseInt(ymd[3], 10);
    if (isValidYmd(y, m, d, minYear, maxYear)) {
      return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    }
  }

  const ymdSpace = s.match(/\b(\d{4})\s+(\d{1,2})\s+(\d{1,2})\b/);
  if (ymdSpace) {
    const y = parseInt(ymdSpace[1], 10);
    const m = parseInt(ymdSpace[2], 10);
    const d = parseInt(ymdSpace[3], 10);
    if (isValidYmd(y, m, d, minYear, maxYear)) {
      return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    }
  }

  const dmyEn = s.match(/\b(\d{1,2})\s+([A-Za-z]{3,9})[.,]?\s+(\d{4})\b/);
  if (dmyEn) {
    const mm = MONTH_NAME_MAP[dmyEn[2].toLowerCase().slice(0, 3)];
    const y = parseInt(dmyEn[3], 10);
    const d = parseInt(dmyEn[1], 10);
    if (mm && isValidYmd(y, parseInt(mm, 10), d, minYear, maxYear)) {
      return `${y}-${mm}-${String(d).padStart(2, '0')}`;
    }
  }

  const mdyEn = s.match(/\b([A-Za-z]{3,9})[.,]?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b/);
  if (mdyEn) {
    const mm = MONTH_NAME_MAP[mdyEn[1].toLowerCase().slice(0, 3)];
    const y = parseInt(mdyEn[3], 10);
    const d = parseInt(mdyEn[2], 10);
    if (mm && isValidYmd(y, parseInt(mm, 10), d, minYear, maxYear)) {
      return `${y}-${mm}-${String(d).padStart(2, '0')}`;
    }
  }

  const compact = s.match(/\b((?:19|20)\d{2})(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])\b/);
  if (compact) {
    const y = parseInt(compact[1], 10);
    const m = parseInt(compact[2], 10);
    const d = parseInt(compact[3], 10);
    if (isValidYmd(y, m, d, minYear, maxYear)) {
      return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    }
  }

  return null;
}

function extractAllDatesInTextClient(
  text: string,
  minYear = 2010,
  maxYear = 2040
): { date: string; ts: number; index: number; endIndex: number }[] {
  if (!text) return [];
  const found: { date: string; ts: number; index: number; endIndex: number }[] = [];
  const patterns = [
    /(\d{4})\s*[.\-년/]\s*(\d{1,2})\s*[.\-월/]\s*(\d{1,2})(?:\s*일)?/g,
    /\b(\d{1,2})\s+([A-Za-z]{3,9})[.,]?\s+(\d{4})\b/g,
    /\b([A-Za-z]{3,9})[.,]?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b/g,
    /\b((?:19|20)\d{2})(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])\b/g,
  ];

  for (const regex of patterns) {
    let m: RegExpExecArray | null;
    while ((m = regex.exec(text)) !== null) {
      const parsed = parseFlexibleDateClient(m[0], minYear, maxYear);
      if (parsed) {
        const [y, mo, da] = parsed.split('-').map((v) => parseInt(v, 10));
        const ts = new Date(y, mo - 1, da).getTime();
        const overlap = found.some((f) => Math.abs(f.index - m!.index) < 4 && f.date === parsed);
        if (!overlap) {
          found.push({
            date: parsed,
            ts,
            index: m.index,
            endIndex: m.index + m[0].length,
          });
        }
      }
    }
  }

  found.sort((a, b) => a.index - b.index);
  return found;
}

const ARC_BACK_BOILERPLATE_REGEX =
  /시[·.\s]*군[·.\s]*구|출입국|외국인(?:관서|청|사무소|등록증)|새로운\s*체류지|신고하여야|신고하지|범칙금|과태료|지방출입국|14일\s*이내|변경된\s*날|전입신고|관할|허가기간|체류기간\s*연장|확인\s*인|담당자/;

function parseArcReportDateTsClient(line: string): number {
  const m = line.match(/(\d{4}|\d{2})\s*[.\-년/]\s*(\d{1,2})\s*[.\-월/]\s*(\d{1,2})/);
  if (!m) return 0;
  let y = parseInt(m[1], 10);
  if (y < 100) y += 2000;
  const mo = parseInt(m[2], 10);
  const da = parseInt(m[3], 10);
  if (y >= 2010 && y <= 2035 && mo >= 1 && mo <= 12 && da >= 1 && da <= 31) {
    return new Date(y, mo - 1, da).getTime();
  }
  return 0;
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

  const addrStartRegex =
    /((?:서울특별시|서울시|서울|부산광역시|부산시|부산|대구광역시|대구시|대구|인천광역시|인천시|인천|광주광역시|광주시|광주|대전광역시|대전시|대전|울산광역시|울산시|울산|세종특별자치시|세종시|세종|경기도|경기|강원특별자치도|강원도|강원|충청북도|충북|충청남도|충남|전북특별자치도|전라북도|전북|전라남도|전남|경상북도|경북|경상남도|경남|제주특별자치도|제주도|제주)\s*[가-힣0-9][가-힣0-9\s\-~,()./]+|[가-힣]{2,6}(?:시|군)\s+[가-힣]{1,12}(?:구|읍|면|동|로|길|가)\s*[가-힣0-9\s\-~,()./]*)/;

  const candidates: { address: string; timestamp: number; lineIndex: number }[] = [];

  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i];
    if (line.length < 4 || ARC_BACK_BOILERPLATE_REGEX.test(line)) {
      continue;
    }

    const sameLineTs = parseArcReportDateTsClient(line);
    const strippedLine = line
      .replace(/^[\s|[\]()·•\-]*(?:\d{4}|\d{2})\s*[.\-년/]\s*\d{1,2}\s*[.\-월/]\s*\d{1,2}\s*[.\-일]?\s*/, '')
      .replace(/^(?:체류지|국내거소|주소|변경사항|신고일|신고일자|거소지|Address)\s*[:：|]?\s*/gi, '')
      .trim();

    const match = strippedLine.match(addrStartRegex);
    if (!match) continue;

    let cleanAddr = match[1]
      .replace(/^(?:체류지|국내거소|주소|변경사항|신고일|신고일자)\s*[:：]?\s*/g, '')
      .replace(/\s+(?:확인|담당|인|서명|신고|접수)\s*$/, '')
      .replace(/\s+/g, ' ')
      .trim();

    const looksLikeKoreanAddr =
      /(?:시|군|구|읍|면|동|리|로|길|가|번지|번길|\d+)/.test(cleanAddr) && cleanAddr.length >= 6;
    if (!looksLikeKoreanAddr || ARC_BACK_BOILERPLATE_REGEX.test(cleanAddr)) continue;

    for (let contOffset = 1; contOffset <= 2; contOffset++) {
      if (i + contOffset >= rawLines.length) break;
      const nextLine = rawLines[i + contOffset];
      if (!nextLine || nextLine.length < 2 || nextLine.length > 45) break;
      if (parseArcReportDateTsClient(nextLine) > 0) break;
      if (addrStartRegex.test(nextLine)) break;
      if (ARC_BACK_BOILERPLATE_REGEX.test(nextLine)) break;
      if (/^(?:체류지|변경사항|신고일|신고일자|확인|국내거소|체류기간|만료일자)/.test(nextLine)) break;

      if (/(?:\d+|번길|로|길|동|호|층|읍|면|리|아파트|빌라|오피스텔|원룸|기숙사|\([가-힣0-9\s]+\))/.test(nextLine)) {
        const cont = nextLine
          .replace(/[^가-힣0-9A-Za-z\s\-~,().]/g, ' ')
          .replace(/\s+(?:확인|담당|인)\s*$/, '')
          .replace(/\s+/g, ' ')
          .trim();
        if (cont.length >= 2 && !cleanAddr.includes(cont)) {
          cleanAddr = `${cleanAddr} ${cont}`.replace(/\s+/g, ' ').trim();
        }
      } else {
        break;
      }
    }

    let ts = sameLineTs;
    if (!ts) {
      for (const off of [-1, 1, -2]) {
        const idx = i + off;
        if (idx >= 0 && idx < rawLines.length) {
          const foundTs = parseArcReportDateTsClient(rawLines[idx]);
          if (foundTs > 0) {
            ts = foundTs;
            break;
          }
        }
      }
    }

    candidates.push({ address: cleanAddr, timestamp: ts, lineIndex: i });
  }

  if (candidates.length === 0) return null;

  const withDates = candidates.filter((c) => c.timestamp > 0);
  if (withDates.length > 0) {
    withDates.sort((a, b) => (b.timestamp - a.timestamp) || (b.lineIndex - a.lineIndex));
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

function extractTopikRoundClient(topikText: string, combined: string): string | null {
  const isValidRound = (val: string): string | null => {
    const num = parseInt(val.replace(/[^0-9]/g, ''), 10);
    if (!Number.isNaN(num) && num >= 1 && num <= 300) return String(num);
    return null;
  };

  const sources = [topikText, combined].filter(Boolean);
  for (const src of sources) {
    const jeMatch = src.match(/제\s*(\d{1,3})\s*[회희외화]/i);
    if (jeMatch) {
      const v = isValidRound(jeMatch[1]);
      if (v) return v;
    }

    const huiMatch = src.match(/(?<!\d)(\d{2,3})\s*[회희](?!\s*원|\s*사|\s*의)/);
    if (huiMatch) {
      const v = isValidRound(huiMatch[1]);
      if (v) return v;
    }

    const labelRegex =
      /(?:시\s*행\s*회\s*차|시\s*험\s*회\s*차|응\s*시\s*회\s*차|회\s*차|차\s*수|Test\s*(?:Held|Number|No\.?)|Round|Edition)/gi;
    let lm: RegExpExecArray | null;
    while ((lm = labelRegex.exec(src)) !== null) {
      const windowStr = src.slice(lm.index + lm[0].length, lm.index + lm[0].length + 60);
      const cutWindow = windowStr.split(/(?:수\s*험\s*번\s*호|생\s*년\s*월\s*일|문\s*서\s*확\s*인|Registration|Birth)/i)[0];
      const valMatch = cutWindow.match(/(?:제\s*)?(\d{1,3})(?:\s*[회희외화]|(?:\s*(?:st|nd|rd|th))?\b)/i);
      if (valMatch) {
        const v = isValidRound(valMatch[1]);
        if (v) return v;
      }
    }

    const enMatch =
      src.match(/The\s*(\d{1,3})(?:st|nd|rd|th)\s*(?:Test|TOPIK|Korean)?/i) ||
      src.match(/\b(\d{2,3})(?:st|nd|rd|th)\s*(?:Test|TOPIK)\b/i);
    if (enMatch) {
      const v = isValidRound(enMatch[1]);
      if (v) return v;
    }
  }
  return null;
}

function extractTopikDatesClient(topikText: string): { examDate?: string; validUntil?: string } {
  const out: { examDate?: string; validUntil?: string } = {};
  if (!topikText) return out;

  const examLabelRegex =
    /(?:시\s*험\s*일(?:\s*자|\s*시)?|시\s*행\s*일(?:\s*자)?|응\s*시\s*일(?:\s*자)?|Test\s*Date|Date\s*of\s*Test|Exam\s*Date)/gi;
  let em: RegExpExecArray | null;
  while ((em = examLabelRegex.exec(topikText)) !== null) {
    const windowStr = topikText.slice(em.index + em[0].length, em.index + em[0].length + 85);
    const cutWindow = windowStr.split(
      /(?:성\s*적\s*유\s*효|유\s*효\s*기\s*간|Valid\s*Until|Expiration|생\s*년\s*월\s*일|Birth|발\s*급\s*일|Issue\s*Date)/i
    )[0];
    const dates = extractAllDatesInTextClient(cutWindow, 2012, 2035);
    if (dates.length > 0) {
      out.examDate = dates[0].date;
      break;
    }
  }

  if (!out.examDate) {
    const paired1 = topikText.match(/(\d{4}[.\-\s/]+\d{1,2}[.\-\s/]+\d{1,2})\s*\([제\s]*\d{1,3}\s*회/);
    const paired2 = topikText.match(/제\s*\d{1,3}\s*회[^\n]{0,25}?(\d{4}[.\-\s/]+\d{1,2}[.\-\s/]+\d{1,2})/);
    const parsed = parseFlexibleDateClient((paired1?.[1] || paired2?.[1] || ''), 2012, 2035);
    if (parsed) out.examDate = parsed;
  }

  const validLabelRegex =
    /(?:성\s*적\s*유\s*효\s*기\s*간|유\s*효\s*기\s*간|유\s*효\s*일(?:\s*자)?|만\s*료\s*일(?:\s*자)?|Valid\s*(?:Until|Period|Thru|Through|Date)|Date\s*of\s*Expiration|Expiration\s*Date)/gi;
  let vm: RegExpExecArray | null;
  while ((vm = validLabelRegex.exec(topikText)) !== null) {
    const windowStr = topikText.slice(vm.index + vm[0].length, vm.index + vm[0].length + 100);
    const cutWindow = windowStr.split(
      /(?:취\s*득\s*등\s*급|등\s*급|총\s*점|발\s*급\s*일|발\s*행\s*일|Issue\s*Date|Print\s*Date|수\s*험\s*번\s*호|생\s*년\s*월\s*일|Birth)/i
    )[0];
    const dates = extractAllDatesInTextClient(cutWindow, 2014, 2040);
    if (dates.length > 0) {
      out.validUntil = dates[dates.length - 1].date;
      break;
    }
  }

  if (!out.validUntil) {
    const tildeMatch = topikText.match(/[~～]\s*(\d{4}\s*[.\-년/]\s*\d{1,2}\s*[.\-월/]\s*\d{1,2})(?:\s*일)?(?:\s*까지)?/);
    if (tildeMatch) {
      const parsed = parseFlexibleDateClient(tildeMatch[1], 2014, 2040);
      if (parsed) out.validUntil = parsed;
    }
  }

  if (!out.examDate || !out.validUntil) {
    const allDates = extractAllDatesInTextClient(topikText, 2015, 2040).filter((d) => {
      const before = topikText.slice(Math.max(0, d.index - 28), d.index);
      if (/(?:생\s*년\s*월\s*일|Date\s*of\s*Birth|Birth|발\s*급\s*일|발\s*행\s*일|출\s*력\s*일|Issue\s*Date|Print\s*Date)/i.test(before)) {
        return false;
      }
      return true;
    });

    const uniqueByDate = Array.from(new Map(allDates.map((d) => [d.date, d])).values()).sort((a, b) => a.ts - b.ts);
    const DAY_MS = 24 * 60 * 60 * 1000;

    if (out.examDate && !out.validUntil) {
      const [ey, em2, ed] = out.examDate.split('-').map((n) => parseInt(n, 10));
      const examTs = new Date(ey, em2 - 1, ed).getTime();
      const matchValid = uniqueByDate.find((d) => {
        const diffDays = (d.ts - examTs) / DAY_MS;
        return diffDays >= 500 && diffDays <= 900;
      });
      if (matchValid) out.validUntil = matchValid.date;
    } else if (!out.examDate && out.validUntil) {
      const [vy, vm2, vd] = out.validUntil.split('-').map((n) => parseInt(n, 10));
      const validTs = new Date(vy, vm2 - 1, vd).getTime();
      const matchExam = uniqueByDate.find((d) => {
        const diffDays = (validTs - d.ts) / DAY_MS;
        return diffDays >= 500 && diffDays <= 900;
      });
      if (matchExam) out.examDate = matchExam.date;
    } else if (!out.examDate && !out.validUntil && uniqueByDate.length >= 2) {
      for (let i = 0; i < uniqueByDate.length; i++) {
        for (let j = i + 1; j < uniqueByDate.length; j++) {
          const diffDays = (uniqueByDate[j].ts - uniqueByDate[i].ts) / DAY_MS;
          if (diffDays >= 500 && diffDays <= 900) {
            out.examDate = uniqueByDate[i].date;
            out.validUntil = uniqueByDate[j].date;
            break;
          }
        }
        if (out.examDate && out.validUntil) break;
      }
    }
  }

  return out;
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
  const arcAndPassport = `${arcFrontText}\n${arcBackText}\n${passportText}`;
  const regFound =
    findArcRegNumberInText(arcFrontText) ||
    findArcRegNumberInText(arcAndPassport);
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
    topikText.match(/(?:수\s*험\s*번\s*호|Registration\s*(?:No\.?)?|Examinee(?:\s*No\.?)?|Application\s*(?:No\.?)?)[\s\S]{0,45}?(\d{8,16})/i) ||
    topikText.match(/\b(0\d{10,14})\b/) ||
    combined.match(/\b(00\d{11,13})\b/) ||
    topikText.match(/\b(\d{11,14})\b/);

  if (examNumMatch) {
    const rawDigits = examNumMatch[1].replace(/[^0-9]/g, '');
    if (rawDigits.length >= 6 && !/^0+$/.test(rawDigits)) {
      result.examNumber = rawDigits;
    }
  }

  // 9. TOPIK Round (회차: e.g. 제 89 회, 92회, 107회, 시행회차 across newlines)
  const detectedRound = extractTopikRoundClient(topikText, combined);
  if (detectedRound) {
    result.round = detectedRound;
  }

  // 10. TOPIK Grade (취득등급 / 등급: 1급 ~ 6급)
  const gradeMatch =
    topikText.match(/(?:취\s*득\s*등\s*급|합\s*격\s*등\s*급|등\s*급|Grade|Level|Evaluation)[\s\S]{0,35}?([1-6])\s*급/i) ||
    topikText.match(/(?:취\s*득\s*등\s*급|합\s*격\s*등\s*급|등\s*급|Grade|Level)[^\d\n]{0,20}([1-6])\b/i) ||
    topikText.match(/(?:TOPIK\s*[I|II]{1,2})[^\d\n]{0,15}([1-6])\s*급/i) ||
    topikText.match(/([1-6])\s*급/) ||
    combined.match(/(?:취득등급|합격등급|등급)[^\d\n]{0,12}([1-6])/i) ||
    combined.match(/([1-6])\s*급/);

  if (gradeMatch) {
    result.grade = `${gradeMatch[1]}급`;
  } else {
    const scoreMatch = topikText.match(/(?:총\s*점|Total\s*Score|점\s*수)[\s\S]{0,25}?(\d{2,3})/i);
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

  // 11. TOPIK Exam Date (시험일 / 시행일) & Valid Until Date (성적유효기간 END date)
  if (topikText && topikText.trim().length > 0) {
    const topikDates = extractTopikDatesClient(topikText);
    if (topikDates.examDate) {
      result.examDate = topikDates.examDate;
    }
    if (topikDates.validUntil) {
      result.validUntil = topikDates.validUntil;
    }
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
 * Counts meaningful extracted OCR fields (ignoring placeholders).
 */
export function countExtractedFields(data: ExtractedDocumentData | null | undefined): number {
  if (!data) return 0;
  let count = 0;
  if (data.name && data.name.trim() && data.name.trim() !== '0000 0000') count++;
  if (data.regNumber1 && /^\d{6}$/.test(data.regNumber1) && data.regNumber1 !== '000000') count++;
  if (data.regNumber2 && /^\d{7}$/.test(data.regNumber2) && data.regNumber2 !== '0000000') count++;
  if (data.visaStatus && data.visaStatus.trim()) count++;
  if (data.address && data.address.trim().length >= 5 && !data.address.startsWith('00000')) count++;
  if (data.passportNo && data.passportNo.trim().length >= 6) count++;
  if (data.passportExpiry && !data.passportExpiry.startsWith('0000')) count++;
  if (data.examNumber && data.examNumber.trim().length >= 6 && !/^0+$/.test(data.examNumber)) count++;
  if (data.round && data.round.trim() && data.round !== '0' && data.round !== '000') count++;
  if (data.grade && /^[1-6]급$/.test(data.grade.trim())) count++;
  if (data.examDate && !data.examDate.startsWith('0000')) count++;
  if (data.validUntil && !data.validUntil.startsWith('0000')) count++;
  if (Array.isArray(data.docVerificationNo) && data.docVerificationNo.some((p) => p && p !== '0000')) count++;
  else if (typeof data.docVerificationNo === 'string' && data.docVerificationNo.replace(/0|-|\s/g, '').length > 0) count++;
  return count;
}

/**
 * Prepares any document DataURL (Raster Image, SVG, or PDF) for /api/extract-documents:
 * converts PDFs to both extracted digital text + high-res rasterized Page 1 JPEG so server-side
 * OCR & Gemini Vision work seamlessly on both scanned and digital PDFs.
 */
export async function prepareDocumentForOcrApi(
  dataUrl: string | null | undefined
): Promise<{ apiUrl: string | null | undefined; pdfText: string }> {
  if (!dataUrl) return { apiUrl: dataUrl, pdfText: '' };
  if (isPdfDataUrl(dataUrl)) {
    const parsed = await extractPdfTextAndImageFromDataUrl(dataUrl, 1900);
    const compressedImg = parsed.imageUrl
      ? await compressImageForApi(parsed.imageUrl, 1800, 0.88)
      : dataUrl;
    return {
      apiUrl: compressedImg || dataUrl,
      pdfText: parsed.text || '',
    };
  }
  return {
    apiUrl: await compressImageForApi(dataUrl, 1800, 0.88),
    pdfText: '',
  };
}

export interface OcrPipelineResult {
  data: ExtractedDocumentData;
  confidence: OcrFieldConfidenceMap;
  rawTextPreview: string;
  model: string;
}

export function mergeExtractedDrafts(
  primary: ExtractedDocumentData | null | undefined,
  secondary: ExtractedDocumentData | null | undefined
): ExtractedDocumentData {
  const a = primary || {};
  const b = secondary || {};
  const hasRealStr = (v?: string | null) => Boolean(v && v.trim() && !/^0+$/.test(v.trim()) && v !== '0000 0000' && v !== '0000-00-00' && v !== '000000' && v !== '0000000' && v !== '000' && v !== '0급');
  const hasRealDocVer = (v?: string[] | string | null) =>
    Array.isArray(v)
      ? v.some((p) => p && p !== '0000')
      : typeof v === 'string' && v.replace(/0|-|\s/g, '').length > 0;

  return {
    name: hasRealStr(a.name) ? a.name : (b.name || ''),
    regNumber1: hasRealStr(a.regNumber1) ? a.regNumber1 : (b.regNumber1 || ''),
    regNumber2: hasRealStr(a.regNumber2) ? a.regNumber2 : (b.regNumber2 || ''),
    gender: a.gender || b.gender || '',
    nationality: hasRealStr(a.nationality) ? a.nationality : (b.nationality || ''),
    visaStatus: hasRealStr(a.visaStatus) ? a.visaStatus : (b.visaStatus || ''),
    passportNo: hasRealStr(a.passportNo) ? a.passportNo : (b.passportNo || ''),
    passportExpiry: hasRealStr(a.passportExpiry) ? a.passportExpiry : (b.passportExpiry || ''),
    address: hasRealStr(a.address) ? a.address : (b.address || ''),
    docVerificationNo: hasRealDocVer(a.docVerificationNo) ? a.docVerificationNo : (b.docVerificationNo || ['', '', '', '']),
    examNumber: hasRealStr(a.examNumber) ? a.examNumber : (b.examNumber || ''),
    examDate: hasRealStr(a.examDate) ? a.examDate : (b.examDate || ''),
    round: hasRealStr(a.round) ? a.round : (b.round || ''),
    validUntil: hasRealStr(a.validUntil) ? a.validUntil : (b.validUntil || ''),
    grade: hasRealStr(a.grade) ? a.grade : (b.grade || ''),
  };
}

/**
 * Full hybrid OCR pipeline (Server Gemini/Tesseract + Targeted Client PDF/Tesseract Gap-Fill).
 * Always fills missing ARC `address` (체류지) and TOPIK `examDate` / `validUntil` / `round`
 * locally if the primary server pass left gaps.
 */
export async function runFullDocumentOcrPipeline(params: {
  arcFront?: string | null;
  arcBack?: string | null;
  topikCert?: string | null;
  passport?: string | null;
  pdfTexts?: {
    arcFront?: string;
    arcBack?: string;
    topikCert?: string;
    passport?: string;
  };
  skipServer?: boolean;
}): Promise<OcrPipelineResult> {
  const [pFront, pBack, pTopik, pPassport] = await Promise.all([
    prepareDocumentForOcrApi(params.arcFront),
    prepareDocumentForOcrApi(params.arcBack),
    prepareDocumentForOcrApi(params.topikCert),
    prepareDocumentForOcrApi(params.passport),
  ]);

  const mergedPdfTexts = {
    arcFront: [params.pdfTexts?.arcFront || '', pFront.pdfText].filter(Boolean).join('\n'),
    arcBack: [params.pdfTexts?.arcBack || '', pBack.pdfText].filter(Boolean).join('\n'),
    topikCert: [params.pdfTexts?.topikCert || '', pTopik.pdfText].filter(Boolean).join('\n'),
    passport: [params.pdfTexts?.passport || '', pPassport.pdfText].filter(Boolean).join('\n'),
  };

  let serverData: ExtractedDocumentData = {};
  let serverConfidenceRaw: Record<string, number> = {};
  let serverRawPreview = '';
  let serverModel = '';

  const isStaticGitHubPages = typeof window !== 'undefined' && window.location.hostname.includes('github.io');
  if (!params.skipServer && !isStaticGitHubPages) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 45000);
      const res = await fetch('/api/extract-documents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          arcFront: pFront.apiUrl,
          arcBack: pBack.apiUrl,
          topikCert: pTopik.apiUrl,
          passport: pPassport.apiUrl,
          pdfTexts: mergedPdfTexts,
        }),
      });
      clearTimeout(timer);
      if (res.ok) {
        const result = await res.json().catch(() => ({}));
        if (result?.rawTextPreview) {
          serverRawPreview = String(result.rawTextPreview);
        }
        if (result?.model) {
          serverModel = String(result.model);
        }
        if (result?.confidence && typeof result.confidence === 'object') {
          serverConfidenceRaw = result.confidence as Record<string, number>;
        }
        if (result?.success && result?.data && !result?.fallbackMode) {
          serverData = result.data as ExtractedDocumentData;
        }
      }
    } catch (err) {
      console.warn('[Client OCR] Server extraction failed, running local OCR:', err);
    }
  }

  const frontSource = isPdfDataUrl(params.arcFront) ? (pFront.apiUrl || params.arcFront) : params.arcFront;
  const backSource = isPdfDataUrl(params.arcBack) ? (pBack.apiUrl || params.arcBack) : params.arcBack;
  const topikSource = isPdfDataUrl(params.topikCert) ? (pTopik.apiUrl || params.topikCert) : params.topikCert;
  const passportSource = isPdfDataUrl(params.passport) ? (pPassport.apiUrl || params.passport) : params.passport;

  // Determine which documents still need local structural / Tesseract OCR gap-fill
  const needFrontOcr = Boolean(frontSource && (!serverData.name || !serverData.regNumber1 || !serverData.regNumber2 || !serverData.visaStatus));
  const needBackOcr = Boolean(backSource && !serverData.address);
  const needTopikOcr = Boolean(
    topikSource &&
      (!serverData.examDate ||
        !serverData.validUntil ||
        !serverData.round ||
        !serverData.examNumber ||
        !serverData.grade ||
        !serverData.docVerificationNo ||
        (Array.isArray(serverData.docVerificationNo) && serverData.docVerificationNo.every((p) => !p || p === '0000')))
  );
  const needPassportOcr = Boolean(passportSource && (!serverData.passportNo || !serverData.passportExpiry || !serverData.name));

  let arcFrontText = mergedPdfTexts.arcFront;
  let arcBackText = mergedPdfTexts.arcBack;
  let topikText = mergedPdfTexts.topikCert;
  let passportText = mergedPdfTexts.passport;

  let frontTesseractConf = mergedPdfTexts.arcFront.trim().length > 40 ? 94 : 0;
  let backTesseractConf = mergedPdfTexts.arcBack.trim().length > 40 ? 94 : 0;
  let topikTesseractConf = mergedPdfTexts.topikCert.trim().length > 60 ? 95 : 0;
  let passportTesseractConf = mergedPdfTexts.passport.trim().length > 40 ? 94 : 0;

  // Always parse any available PDF/SVG digital text immediately
  const digitalParsed = parseOcrCorpusToData(arcFrontText, arcBackText, topikText, passportText);
  let merged = mergeExtractedDrafts(serverData, digitalParsed);

  const stillNeedFront = Boolean(frontSource && !isPdfDataUrl(frontSource) && (!merged.name || !merged.regNumber1 || !merged.regNumber2 || !merged.visaStatus));
  const stillNeedBack = Boolean(backSource && !isPdfDataUrl(backSource) && !merged.address);
  const stillNeedTopik = Boolean(
    topikSource &&
      !isPdfDataUrl(topikSource) &&
      (!merged.examDate ||
        !merged.validUntil ||
        !merged.round ||
        !merged.examNumber ||
        !merged.grade ||
        !merged.docVerificationNo ||
        (Array.isArray(merged.docVerificationNo) && merged.docVerificationNo.every((p) => !p || p === '0000')))
  );
  const stillNeedPassport = Boolean(passportSource && !isPdfDataUrl(passportSource) && (!merged.passportNo || !merged.passportExpiry || !merged.name));

  if (needFrontOcr && stillNeedFront && frontSource) {
    const tFront = await runBrowserOcrWithMeta(frontSource, 'eng', false);
    if (tFront.text) {
      arcFrontText = [arcFrontText, tFront.text].filter(Boolean).join('\n');
      frontTesseractConf = Math.max(frontTesseractConf, tFront.confidence);
    }
  }
  if (needPassportOcr && stillNeedPassport && passportSource) {
    const tPass = await runBrowserOcrWithMeta(passportSource, 'eng', false);
    if (tPass.text) {
      passportText = [passportText, tPass.text].filter(Boolean).join('\n');
      passportTesseractConf = Math.max(passportTesseractConf, tPass.confidence);
    }
  }
  if (needBackOcr && stillNeedBack && backSource) {
    // Use kor+eng on ARC Back so road numbers, dash digits, and Hangul district names stay crisp
    const tBack = await runBrowserOcrWithMeta(backSource, 'kor+eng', false);
    if (tBack.text) {
      arcBackText = [arcBackText, tBack.text].filter(Boolean).join('\n');
      backTesseractConf = Math.max(backTesseractConf, tBack.confidence);
    }
  }
  if (needTopikOcr && stillNeedTopik && topikSource) {
    const tTopik = await runBrowserOcrWithMeta(topikSource, 'kor+eng', false);
    if (tTopik.text) {
      topikText = [topikText, tTopik.text].filter(Boolean).join('\n');
      topikTesseractConf = Math.max(topikTesseractConf, tTopik.confidence);
    }
  }

  let localParsed = parseOcrCorpusToData(arcFrontText, arcBackText, topikText, passportText);
  merged = mergeExtractedDrafts(merged, localParsed);

  // Targeted high-contrast / MRZ second-pass if key fields are still missing
  let ranSecondPass = false;
  let usedSecondPassFront = false;
  let usedSecondPassBack = false;
  let usedSecondPassTopik = false;
  let usedSecondPassPassport = false;

  if (stillNeedFront && frontSource && (!merged.regNumber1 || !merged.name || !merged.visaStatus)) {
    const hcFront = await runBrowserOcrWithMeta(frontSource, 'eng', true);
    if (hcFront.text) {
      arcFrontText = [arcFrontText, hcFront.text].filter(Boolean).join('\n');
      frontTesseractConf = Math.max(frontTesseractConf, Math.max(45, hcFront.confidence - 6));
      ranSecondPass = true;
      usedSecondPassFront = true;
    }
  }
  if (stillNeedBack && backSource && !merged.address) {
    const hcBack = await runBrowserOcrWithMeta(backSource, 'kor+eng', true);
    if (hcBack.text) {
      arcBackText = [arcBackText, hcBack.text].filter(Boolean).join('\n');
      backTesseractConf = Math.max(backTesseractConf, Math.max(45, hcBack.confidence - 8));
      ranSecondPass = true;
      usedSecondPassBack = true;
    }
  }
  if (stillNeedPassport && passportSource && (!merged.passportNo || !merged.name)) {
    const mrzCropUrl = await cropPassportMrzForOcr(passportSource);
    const mrzRes = await runBrowserOcrWithMeta(mrzCropUrl, 'eng', false);
    if (mrzRes.text) {
      passportText = [passportText, mrzRes.text].filter(Boolean).join('\n');
      passportTesseractConf = Math.max(passportTesseractConf, mrzRes.confidence);
      ranSecondPass = true;
      usedSecondPassPassport = true;
    }
  }
  if (stillNeedTopik && topikSource && (!merged.examNumber || !merged.examDate || !merged.validUntil || !merged.round)) {
    const hcTopik = await runBrowserOcrWithMeta(topikSource, 'kor+eng', true);
    if (hcTopik.text) {
      topikText = [topikText, hcTopik.text].filter(Boolean).join('\n');
      topikTesseractConf = Math.max(topikTesseractConf, Math.max(45, hcTopik.confidence - 6));
      ranSecondPass = true;
      usedSecondPassTopik = true;
    }
  }

  if (ranSecondPass) {
    localParsed = parseOcrCorpusToData(arcFrontText, arcBackText, topikText, passportText);
    merged = mergeExtractedDrafts(merged, localParsed);
  }

  const baseConfidence = buildPipelineConfidenceMap({
    merged,
    serverData,
    digitalParsed,
    localParsed,
    serverConfidenceRaw,
    serverModel,
    docMetrics: {
      frontConf: frontTesseractConf,
      backConf: backTesseractConf,
      topikConf: topikTesseractConf,
      passportConf: passportTesseractConf,
      hasDigitalFront: mergedPdfTexts.arcFront.trim().length > 40,
      hasDigitalBack: mergedPdfTexts.arcBack.trim().length > 40,
      hasDigitalTopik: mergedPdfTexts.topikCert.trim().length > 60,
      hasDigitalPassport: mergedPdfTexts.passport.trim().length > 40,
      usedSecondPassFront,
      usedSecondPassBack,
      usedSecondPassTopik,
      usedSecondPassPassport,
    },
  });

  const confidence = evaluateDraftConfidence(merged, baseConfidence);

  const localRawBlocks = [
    arcFrontText ? `[ARC Front]\n${arcFrontText}` : '',
    arcBackText ? `[ARC Back]\n${arcBackText}` : '',
    topikText ? `[TOPIK]\n${topikText}` : '',
    passportText ? `[Passport]\n${passportText}` : '',
  ]
    .filter(Boolean)
    .join('\n\n');

  const rawTextPreview = [serverRawPreview, localRawBlocks]
    .filter(Boolean)
    .join('\n\n')
    .slice(0, 4000);

  return {
    data: merged,
    confidence,
    rawTextPreview,
    model: serverModel || 'browser-ocr',
  };
}

/**
 * Server-side OCR proxy with local Tesseract.js + PDF.js fallback.
 */
export async function extractDocumentsClientSide(params: {
  arcFront?: string | null;
  arcBack?: string | null;
  topikCert?: string | null;
  passport?: string | null;
  pdfTexts?: {
    arcFront?: string;
    arcBack?: string;
    topikCert?: string;
    passport?: string;
  };
  skipServer?: boolean;
}): Promise<ExtractedDocumentData> {
  const res = await runFullDocumentOcrPipeline(params);
  return res.data;
}

/**
 * Converts existing ApplicationFormData into an editable ExtractedDocumentData draft.
 */
export function formDataToExtractedDraft(data: ApplicationFormData): ExtractedDocumentData {
  const cleanStr = (v: string, placeholders: string[]) =>
    placeholders.includes(v.trim()) ? '' : v;

  return {
    name: cleanStr(data.name, ['0000 0000', '0000']),
    regNumber1: cleanStr(data.regNumber1, ['000000']),
    regNumber2: cleanStr(data.regNumber2, ['0000000', '1000000']),
    gender: data.gender || '',
    nationality: data.nationality || 'Cambodia',
    visaStatus: data.visaStatus || '',
    passportNo: data.passportNo || '',
    passportExpiry: cleanStr(data.passportExpiry, ['0000-00-00']),
    address: cleanStr(data.address, ['00000 0000 000', '00000']),
    docVerificationNo: Array.isArray(data.docVerificationNo)
      ? data.docVerificationNo.map((p) => (p === '0000' ? '' : p))
      : ['', '', '', ''],
    examNumber: cleanStr(data.examNumber, ['0000000000000']),
    examDate: cleanStr(data.examDate, ['0000-00-00']),
    round: cleanStr(data.round, ['000', '0']),
    validUntil: cleanStr(data.validUntil, ['0000-00-00']),
    grade: cleanStr(data.grade, ['0급']),
  };
}

/**
 * Smartly merges newly extracted or user-verified OCR fields into existing ApplicationFormData.
 * When `forceOverwrite` is true (used when user confirms Step 2 OCR Verification), any edits—
 * including intentional overrides—are committed cleanly into the official form.
 */
export function mergeExtractedIntoFormData(
  prev: ApplicationFormData,
  ext: ExtractedDocumentData,
  forceOverwrite: boolean = false
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

  const rawName = forceOverwrite
    ? (ext.name || '')
    : ext.name && !isPlaceholderName(ext.name)
    ? ext.name
    : !isPlaceholderName(prev.name)
    ? prev.name
    : '';
  const finalName = rawName ? cleanName(rawName) : (forceOverwrite ? '' : prev.name);

  const rawReg1 = forceOverwrite
    ? (ext.regNumber1 || '')
    : ext.regNumber1 && !isPlaceholderReg1(ext.regNumber1)
    ? ext.regNumber1
    : !isPlaceholderReg1(prev.regNumber1)
    ? prev.regNumber1
    : '';
  const rawReg2 = forceOverwrite
    ? (ext.regNumber2 || '')
    : ext.regNumber2 && !isPlaceholderReg2(ext.regNumber2)
    ? ext.regNumber2
    : !isPlaceholderReg2(prev.regNumber2)
    ? prev.regNumber2
    : '';
  const reg = normalizeRegNumbers(rawReg1, rawReg2);

  const finalAddress = forceOverwrite
    ? (ext.address !== undefined ? (ext.address || '') : prev.address)
    : ext.address && !isPlaceholderAddr(ext.address)
    ? ext.address
    : isPlaceholderAddr(prev.address)
    ? ''
    : prev.address;

  const hasNewDocVer = Array.isArray(ext.docVerificationNo)
    ? ext.docVerificationNo.length === 4 &&
      ext.docVerificationNo.some((p: string) => p && p !== '0000') &&
      ext.docVerificationNo.join('') !== '0000000000000000'
    : typeof ext.docVerificationNo === 'string' &&
      ext.docVerificationNo.replace(/0|-|\s/g, '').length > 0;

  let docParts = prev.docVerificationNo;
  if (forceOverwrite && Array.isArray(ext.docVerificationNo)) {
    docParts = [0, 1, 2, 3].map((idx) => (ext.docVerificationNo?.[idx] || '').replace(/[^0-9]/g, '').slice(0, 4));
  } else if (hasNewDocVer && ext.docVerificationNo) {
    docParts = normalizeDocVerificationNo(ext.docVerificationNo, prev.docVerificationNo);
  } else if (Array.isArray(prev.docVerificationNo) && prev.docVerificationNo.every((p) => !p || p === '0000')) {
    docParts = ['', '', '', ''];
  }

  const finalExamNo = forceOverwrite
    ? cleanExamNumber(ext.examNumber || '')
    : ext.examNumber && !isPlaceholderExamNo(ext.examNumber)
    ? cleanExamNumber(ext.examNumber)
    : isPlaceholderExamNo(prev.examNumber)
    ? ''
    : prev.examNumber;

  const finalExamDate = forceOverwrite
    ? (ext.examDate || '')
    : ext.examDate && !isPlaceholderDate(ext.examDate)
    ? ext.examDate
    : isPlaceholderDate(prev.examDate)
    ? ''
    : prev.examDate;

  const finalRound = forceOverwrite
    ? cleanRound(ext.round || '')
    : ext.round && !isPlaceholderRound(ext.round)
    ? cleanRound(ext.round)
    : isPlaceholderRound(prev.round)
    ? ''
    : prev.round;

  const finalValidUntil = forceOverwrite
    ? (ext.validUntil || '')
    : ext.validUntil && !isPlaceholderDate(ext.validUntil)
    ? ext.validUntil
    : isPlaceholderDate(prev.validUntil)
    ? ''
    : prev.validUntil;

  const finalGrade = forceOverwrite
    ? (ext.grade ? cleanGrade(ext.grade) : '')
    : ext.grade && !isPlaceholderGrade(ext.grade)
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
    nationality: forceOverwrite ? (ext.nationality || prev.nationality || 'Cambodia') : (ext.nationality || prev.nationality || 'Cambodia'),
    visaStatus: forceOverwrite
      ? (ext.visaStatus ? cleanVisaStatus(ext.visaStatus) : '')
      : ext.visaStatus
      ? cleanVisaStatus(ext.visaStatus)
      : prev.visaStatus,
    passportNo: forceOverwrite
      ? (ext.passportNo || '').toUpperCase().trim()
      : (ext.passportNo || prev.passportNo || '').toUpperCase().trim(),
    passportExpiry: forceOverwrite
      ? (ext.passportExpiry || '')
      : ext.passportExpiry || prev.passportExpiry || '',
    address: finalAddress,
    docVerificationNo: docParts,
    examNumber: finalExamNo,
    examDate: finalExamDate,
    round: finalRound,
    validUntil: finalValidUntil,
    grade: finalGrade,
  };
}

function clampConfidenceScore(val: number): number {
  return Math.max(0, Math.min(100, Math.round(val)));
}

function hasUsableDocVer(val?: string[] | string | null): boolean {
  if (Array.isArray(val)) {
    return val.length === 4 && val.every((p) => /^\d{4}$/.test(p || '')) && val.join('') !== '0000000000000000';
  }
  if (typeof val === 'string') {
    const digits = val.replace(/[^0-9]/g, '');
    return digits.length === 16 && digits !== '0000000000000000';
  }
  return false;
}

function hasPartialDocVer(val?: string[] | string | null): boolean {
  if (Array.isArray(val)) {
    return val.some((p) => (p || '').replace(/[^0-9]/g, '').length > 0 && (p || '') !== '0000');
  }
  if (typeof val === 'string') {
    return val.replace(/[^0-9]/g, '').length > 0;
  }
  return false;
}

export function buildPipelineConfidenceMap(params: {
  merged: ExtractedDocumentData;
  serverData: ExtractedDocumentData;
  digitalParsed: ExtractedDocumentData;
  localParsed: ExtractedDocumentData;
  serverConfidenceRaw?: Record<string, number>;
  serverModel?: string;
  docMetrics: {
    frontConf: number;
    backConf: number;
    topikConf: number;
    passportConf: number;
    hasDigitalFront: boolean;
    hasDigitalBack: boolean;
    hasDigitalTopik: boolean;
    hasDigitalPassport: boolean;
    usedSecondPassFront: boolean;
    usedSecondPassBack: boolean;
    usedSecondPassTopik: boolean;
    usedSecondPassPassport: boolean;
  };
}): OcrFieldConfidenceMap {
  const {
    merged,
    serverData,
    digitalParsed,
    localParsed,
    serverConfidenceRaw = {},
    serverModel = '',
    docMetrics,
  } = params;

  const map: OcrFieldConfidenceMap = {};
  const isAiModel = Boolean(serverModel && !serverModel.includes('pdf-text') && !serverModel.includes('browser'));

  const pickConfidence = (
    key: OcrConfidenceKey,
    hasValue: boolean,
    fromServer: boolean,
    fromDigital: boolean,
    fromLocal: boolean,
    docTesseractConf: number,
    usedSecondPass: boolean
  ): OcrFieldConfidence => {
    if (!hasValue) {
      return { score: 0, source: 'missing', reason: 'Not detected in uploaded documents' };
    }

    const aiRaw = typeof serverConfidenceRaw[key] === 'number' ? serverConfidenceRaw[key] : undefined;

    if (fromServer && isAiModel) {
      const base = aiRaw !== undefined ? aiRaw : 89;
      if (fromDigital) {
        return {
          score: clampConfidenceScore(Math.max(base, 95)),
          source: 'ai-vision',
          reason: 'Confirmed by AI Vision & digital PDF text',
        };
      }
      if (fromLocal) {
        return {
          score: clampConfidenceScore(Math.max(base, 92)),
          source: 'ai-vision',
          reason: 'Confirmed by AI Vision & local OCR pattern',
        };
      }
      return {
        score: clampConfidenceScore(base),
        source: 'ai-vision',
        reason: base < 80 ? 'AI Vision flagged visual blur or low legibility' : 'Extracted by AI Vision',
      };
    }

    if (fromDigital) {
      return {
        score: 94,
        source: 'pdf-digital',
        reason: 'Extracted from digital PDF text layer',
      };
    }

    if (fromLocal) {
      const rawT = docTesseractConf > 0 ? docTesseractConf : 72;
      const adjusted = usedSecondPass ? Math.min(rawT, 76) : rawT;
      return {
        score: clampConfidenceScore(adjusted),
        source: 'tesseract',
        reason: usedSecondPass
          ? 'Detected only after high-contrast OCR pass — verify carefully'
          : adjusted < 80
          ? 'Browser OCR confidence is moderate — verify against document'
          : 'Extracted via browser OCR',
      };
    }

    return {
      score: 78,
      source: 'tesseract',
      reason: 'Extracted from document',
    };
  };

  map.name = pickConfidence(
    'name',
    Boolean(merged.name && merged.name.trim().length >= 2),
    Boolean(serverData.name),
    Boolean(digitalParsed.name),
    Boolean(localParsed.name),
    Math.max(docMetrics.frontConf, docMetrics.topikConf, docMetrics.passportConf),
    docMetrics.usedSecondPassFront && !docMetrics.usedSecondPassPassport
  );

  map.regNumber = pickConfidence(
    'regNumber',
    Boolean((merged.regNumber1 || '').trim() || (merged.regNumber2 || '').trim()),
    Boolean(serverData.regNumber1 || serverData.regNumber2),
    Boolean(digitalParsed.regNumber1 || digitalParsed.regNumber2),
    Boolean(localParsed.regNumber1 || localParsed.regNumber2),
    docMetrics.frontConf,
    docMetrics.usedSecondPassFront
  );

  map.gender = pickConfidence(
    'gender',
    Boolean(merged.gender === '남' || merged.gender === '여'),
    Boolean(serverData.gender),
    Boolean(digitalParsed.gender),
    Boolean(localParsed.gender),
    docMetrics.frontConf,
    docMetrics.usedSecondPassFront
  );

  map.nationality = pickConfidence(
    'nationality',
    Boolean(merged.nationality && merged.nationality.trim().length >= 2),
    Boolean(serverData.nationality),
    Boolean(digitalParsed.nationality),
    Boolean(localParsed.nationality),
    Math.max(docMetrics.frontConf, docMetrics.passportConf),
    docMetrics.usedSecondPassFront
  );

  map.visaStatus = pickConfidence(
    'visaStatus',
    Boolean(merged.visaStatus && merged.visaStatus.trim().length >= 2),
    Boolean(serverData.visaStatus),
    Boolean(digitalParsed.visaStatus),
    Boolean(localParsed.visaStatus),
    docMetrics.frontConf,
    docMetrics.usedSecondPassFront
  );

  map.address = pickConfidence(
    'address',
    Boolean(merged.address && merged.address.trim().length >= 5),
    Boolean(serverData.address),
    Boolean(digitalParsed.address),
    Boolean(localParsed.address),
    docMetrics.backConf,
    docMetrics.usedSecondPassBack
  );

  map.docVerificationNo = pickConfidence(
    'docVerificationNo',
    hasPartialDocVer(merged.docVerificationNo),
    hasPartialDocVer(serverData.docVerificationNo),
    hasPartialDocVer(digitalParsed.docVerificationNo),
    hasPartialDocVer(localParsed.docVerificationNo),
    docMetrics.topikConf,
    docMetrics.usedSecondPassTopik
  );

  map.examNumber = pickConfidence(
    'examNumber',
    Boolean(merged.examNumber && merged.examNumber.trim().length >= 4),
    Boolean(serverData.examNumber),
    Boolean(digitalParsed.examNumber),
    Boolean(localParsed.examNumber),
    docMetrics.topikConf,
    docMetrics.usedSecondPassTopik
  );

  map.round = pickConfidence(
    'round',
    Boolean(merged.round && merged.round.trim().length >= 1),
    Boolean(serverData.round),
    Boolean(digitalParsed.round),
    Boolean(localParsed.round),
    docMetrics.topikConf,
    docMetrics.usedSecondPassTopik
  );

  map.examDate = pickConfidence(
    'examDate',
    Boolean(merged.examDate && merged.examDate.trim().length >= 8),
    Boolean(serverData.examDate),
    Boolean(digitalParsed.examDate),
    Boolean(localParsed.examDate),
    docMetrics.topikConf,
    docMetrics.usedSecondPassTopik
  );

  map.validUntil = pickConfidence(
    'validUntil',
    Boolean(merged.validUntil && merged.validUntil.trim().length >= 8),
    Boolean(serverData.validUntil),
    Boolean(digitalParsed.validUntil),
    Boolean(localParsed.validUntil),
    docMetrics.topikConf,
    docMetrics.usedSecondPassTopik
  );

  map.grade = pickConfidence(
    'grade',
    Boolean(merged.grade && merged.grade.trim().length >= 1),
    Boolean(serverData.grade),
    Boolean(digitalParsed.grade),
    Boolean(localParsed.grade),
    docMetrics.topikConf,
    docMetrics.usedSecondPassTopik
  );

  map.passportNo = pickConfidence(
    'passportNo',
    Boolean(merged.passportNo && merged.passportNo.trim().length >= 5),
    Boolean(serverData.passportNo),
    Boolean(digitalParsed.passportNo),
    Boolean(localParsed.passportNo),
    docMetrics.passportConf,
    docMetrics.usedSecondPassPassport
  );

  map.passportExpiry = pickConfidence(
    'passportExpiry',
    Boolean(merged.passportExpiry && merged.passportExpiry.trim().length >= 8),
    Boolean(serverData.passportExpiry),
    Boolean(digitalParsed.passportExpiry),
    Boolean(localParsed.passportExpiry),
    docMetrics.passportConf,
    docMetrics.usedSecondPassPassport
  );

  return map;
}

/**
 * Evaluates and calibrates per-field OCR confidence against structural & cross-field rules.
 * Used both right after OCR extraction and live inside Step 2 when users inspect or edit fields.
 */
export function evaluateDraftConfidence(
  draft: ExtractedDocumentData,
  baseConfidence?: OcrFieldConfidenceMap | null,
  editedKeys?: Set<OcrConfidenceKey> | null,
  presetSource: OcrConfidenceSource = 'tesseract'
): OcrFieldConfidenceMap {
  const out: OcrFieldConfidenceMap = {};

  const resolve = (
    key: OcrConfidenceKey,
    hasValue: boolean,
    validate: (baseScore: number) => { score: number; reason?: string }
  ): OcrFieldConfidence => {
    if (!hasValue) {
      return { score: 0, source: 'missing', reason: 'Field is empty — enter manually from document' };
    }
    const isManual = Boolean(editedKeys?.has(key));
    const existing = baseConfidence?.[key];
    const source: OcrConfidenceSource = isManual
      ? 'manual'
      : existing && existing.source !== 'missing'
      ? existing.source
      : presetSource;

    const baseScore = isManual
      ? 100
      : existing && existing.score > 0
      ? existing.score
      : presetSource === 'svg-preset'
      ? 96
      : 82;

    const validated = validate(baseScore);
    return {
      score: clampConfidenceScore(validated.score),
      source,
      reason: validated.reason || (isManual ? 'Verified by manual edit' : existing?.reason),
    };
  };

  // 1. Name
  const nameVal = (draft.name || '').trim();
  out.name = resolve('name', nameVal.length > 0 && nameVal !== '0000 0000', (base) => {
    const words = nameVal.split(/\s+/).filter(Boolean);
    if (!/^[A-Za-z\s\-'.]+$/.test(nameVal)) {
      return { score: Math.min(base, 54), reason: 'Contains unexpected characters — verify English spelling' };
    }
    if (words.length < 2 || nameVal.length < 4) {
      return { score: Math.min(base, 64), reason: 'Single word or short name — check surname + given name' };
    }
    return { score: base };
  });

  // 2. ARC Registration Number
  const r1 = (draft.regNumber1 || '').trim();
  const r2 = (draft.regNumber2 || '').trim();
  out.regNumber = resolve('regNumber', r1.length > 0 || r2.length > 0, (base) => {
    if (!/^\d{6}$/.test(r1) || !/^\d{7}$/.test(r2) || r1 === '000000' || r2 === '0000000') {
      return { score: Math.min(base, 45), reason: 'Incomplete ARC number (requires 6 + 7 digits)' };
    }
    const mm = parseInt(r1.slice(2, 4), 10);
    const dd = parseInt(r1.slice(4, 6), 10);
    const firstBack = r2.charAt(0);
    if (mm < 1 || mm > 12 || dd < 1 || dd > 31 || !['1', '2', '3', '4', '5', '6', '7', '8'].includes(firstBack)) {
      return { score: Math.min(base, 55), reason: 'Check birth date digits or gender code on ARC front' };
    }
    return { score: Math.max(base, editedKeys?.has('regNumber') ? 100 : Math.min(98, base + 2)) };
  });

  // 3. Gender
  const genderVal = draft.gender || '';
  out.gender = resolve('gender', genderVal === '남' || genderVal === '여', (base) => {
    if (/^\d{7}$/.test(r2)) {
      const d = r2.charAt(0);
      const expected = ['2', '4', '6', '8'].includes(d) ? '여' : '남';
      if (genderVal !== expected) {
        return { score: 42, reason: 'Gender conflicts with 7th digit of ARC number' };
      }
      return { score: Math.max(base, 96) };
    }
    return { score: Math.min(base, 84) };
  });

  // 4. Nationality
  const natVal = (draft.nationality || '').trim();
  out.nationality = resolve('nationality', natVal.length >= 2, (base) => {
    if (natVal.length < 3) {
      return { score: Math.min(base, 65), reason: 'Verify full country name in English' };
    }
    return { score: base };
  });

  // 5. Visa Status
  const visaVal = (draft.visaStatus || '').trim();
  out.visaStatus = resolve('visaStatus', visaVal.length > 0, (base) => {
    if (!/^[A-Z]-\d{1,2}(?:-[A-Z0-9]{1,3})?$/i.test(visaVal)) {
      return { score: Math.min(base, 62), reason: 'Unusual visa format — confirm code (e.g. E-9, E-7-4)' };
    }
    return { score: base };
  });

  // 6. Korean Residence Address (체류지)
  const addrVal = (draft.address || '').trim();
  out.address = resolve('address', addrVal.length > 0 && !addrVal.startsWith('00000'), (base) => {
    const matchedOffice = findOfficeByAddress(addrVal);
    const hasKorean = /[가-힣]/.test(addrVal);
    const hasRoadOrRegion = /(시|도|군|구|로|길|읍|면|동)/.test(addrVal);
    const hasDigit = /\d/.test(addrVal);
    if (!hasKorean || addrVal.length < 8) {
      return { score: Math.min(base, 46), reason: 'Address looks too short — check ARC Back (체류지)' };
    }
    if (!matchedOffice) {
      return { score: Math.min(base, 64), reason: 'Jurisdiction office not matched — verify 시/도 & 구/군 spelling' };
    }
    if (!hasRoadOrRegion || !hasDigit) {
      return { score: Math.min(base, 72), reason: 'Verify road number and building/unit (동·호)' };
    }
    return {
      score: editedKeys?.has('address') ? 100 : Math.min(97, Math.max(base, 86)),
      reason: `Matched jurisdiction: ${matchedOffice.name}`,
    };
  });

  // 7. TOPIK Document Verification No (16 digits)
  out.docVerificationNo = resolve('docVerificationNo', hasPartialDocVer(draft.docVerificationNo), (base) => {
    if (!hasUsableDocVer(draft.docVerificationNo)) {
      return { score: Math.min(base, 44), reason: 'Requires all 4 blocks × 4 digits (16 digits total)' };
    }
    return { score: Math.max(base, editedKeys?.has('docVerificationNo') ? 100 : Math.min(97, base)) };
  });

  // 8. TOPIK Exam Number
  const examNoVal = (draft.examNumber || '').trim();
  out.examNumber = resolve('examNumber', examNoVal.length > 0 && !/^0+$/.test(examNoVal), (base) => {
    if (!/^\d{10,16}$/.test(examNoVal)) {
      return { score: Math.min(base, 66), reason: 'TOPIK 수험번호 is typically 11–14 digits — double-check' };
    }
    return { score: base };
  });

  // 9. TOPIK Round (회)
  const roundVal = (draft.round || '').trim();
  out.round = resolve('round', roundVal.length > 0 && !/^0+$/.test(roundVal), (base) => {
    const num = parseInt(roundVal, 10);
    if (!/^\d{1,3}$/.test(roundVal) || Number.isNaN(num) || num < 1 || num > 300) {
      return { score: Math.min(base, 48), reason: 'Invalid TOPIK round number (expected 1–300)' };
    }
    if (num < 30) {
      return { score: Math.min(base, 68), reason: 'Older or low round number — verify 제XX회 on certificate' };
    }
    return { score: base };
  });

  // 10. Exam Date (시험일) & 11. Valid Until (성적유효기간)
  const examDateVal = (draft.examDate || '').trim();
  const validUntilVal = (draft.validUntil || '').trim();
  const examTs = /^\d{4}-\d{2}-\d{2}$/.test(examDateVal) ? Date.parse(examDateVal) : NaN;
  const validTs = /^\d{4}-\d{2}-\d{2}$/.test(validUntilVal) ? Date.parse(validUntilVal) : NaN;

  out.examDate = resolve('examDate', examDateVal.length > 0 && !examDateVal.startsWith('0000'), (base) => {
    if (Number.isNaN(examTs)) {
      return { score: Math.min(base, 46), reason: 'Use YYYY-MM-DD format for 시험일' };
    }
    const year = parseInt(examDateVal.slice(0, 4), 10);
    if (year < 2012 || year > 2032) {
      return { score: Math.min(base, 52), reason: 'Year looks outside normal TOPIK exam range' };
    }
    if (!Number.isNaN(validTs) && examTs >= validTs) {
      return { score: 42, reason: '시험일 must be earlier than 성적유효기간' };
    }
    return { score: base };
  });

  out.validUntil = resolve('validUntil', validUntilVal.length > 0 && !validUntilVal.startsWith('0000'), (base) => {
    if (Number.isNaN(validTs)) {
      return { score: Math.min(base, 46), reason: 'Use YYYY-MM-DD format for 성적유효기간' };
    }
    if (!Number.isNaN(examTs)) {
      const diffDays = (validTs - examTs) / (1000 * 60 * 60 * 24);
      if (diffDays <= 0) {
        return { score: 38, reason: '성적유효기간 must be after 시험일' };
      }
      if (diffDays < 500 || diffDays > 900) {
        return { score: Math.min(base, 65), reason: 'TOPIK validity is normally ~2 years after 시험일 — verify' };
      }
      return { score: editedKeys?.has('validUntil') ? 100 : Math.min(97, Math.max(base, 88)) };
    }
    return { score: Math.min(base, 76), reason: '시험일 missing — verify 2-year expiration date' };
  });

  // 12. Grade (등급)
  const gradeVal = (draft.grade || '').trim();
  out.grade = resolve('grade', gradeVal.length > 0 && gradeVal !== '0급', (base) => {
    if (!/^[1-6]급$/.test(gradeVal)) {
      return { score: Math.min(base, 55), reason: 'Select valid TOPIK grade (1급–6급)' };
    }
    return { score: base };
  });

  // 13. Passport No
  const passVal = (draft.passportNo || '').trim();
  out.passportNo = resolve('passportNo', passVal.length > 0, (base) => {
    if (!/^[A-Z0-9]{6,12}$/i.test(passVal)) {
      return { score: Math.min(base, 62), reason: 'Check passport number characters against MRZ line' };
    }
    return { score: base };
  });

  // 14. Passport Expiry
  const passExpVal = (draft.passportExpiry || '').trim();
  out.passportExpiry = resolve('passportExpiry', passExpVal.length > 0 && !passExpVal.startsWith('0000'), (base) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(passExpVal)) {
      return { score: Math.min(base, 48), reason: 'Use YYYY-MM-DD format for passport expiry' };
    }
    return { score: base };
  });

  return out;
}

