import jsPDF from 'jspdf';
import { PDFDocument } from 'pdf-lib';
import {
  UploadedDocuments,
  ApplicationFormData,
  SignatureSettings,
} from '../types';
import { mergeArcFrontAndBack } from './imageUtils';
import { findOfficeByAddress } from '../data/immigrationOffices';
import { normalizeDocVerificationNo } from './sanitizers';

export interface GeneratePdfOptions {
  formElement?: HTMLElement | null;
  docs: UploadedDocuments;
  formData: ApplicationFormData;
  sigSettings?: SignatureSettings;
  showWatermark?: boolean;
}

export interface MergedPdfResult {
  output: (type?: string) => any;
  save: (filename: string) => void;
  getBlob: () => Blob;
  getBytes: () => Uint8Array;
}

/**
 * Checks if a given data URL contains PDF data.
 */
export function isPdfDataUrl(dataUrl?: string | null): boolean {
  if (!dataUrl || typeof dataUrl !== 'string') return false;
  const trimmed = dataUrl.trim().toLowerCase();
  return (
    trimmed.startsWith('data:application/pdf') ||
    trimmed.startsWith('data:application/x-pdf') ||
    trimmed.includes('application/pdf')
  );
}

/**
 * Converts a base64 Data URL to a Uint8Array byte array for pdf-lib.
 */
export function dataUrlToUint8Array(dataUrl: string): Uint8Array {
  const commaIndex = dataUrl.indexOf(',');
  const base64 = commaIndex >= 0 ? dataUrl.slice(commaIndex + 1) : dataUrl;
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

/**
 * Converts SVG or raw vector data URLs into standard high-resolution raster JPEG/PNG data URLs
 * to ensure 100% compatibility across all browsers.
 */
export async function ensureRasterDataUrl(dataUrl: string): Promise<string> {
  if (!dataUrl || typeof dataUrl !== 'string') return dataUrl;
  if (!dataUrl.startsWith('data:image/svg+xml') && !dataUrl.includes('image/svg+xml')) {
    return dataUrl;
  }
  return new Promise((resolve) => {
    try {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      const timer = setTimeout(() => resolve(dataUrl), 4000);
      img.onload = () => {
        clearTimeout(timer);
        try {
          const canvas = document.createElement('canvas');
          canvas.width = img.naturalWidth || img.width || 1200;
          canvas.height = img.naturalHeight || img.height || 1650;
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            resolve(canvas.toDataURL('image/jpeg', 0.95));
            return;
          }
        } catch (e) {
          console.warn('Canvas conversion error in ensureRasterDataUrl:', e);
        }
        resolve(dataUrl);
      };
      img.onerror = (e) => {
        clearTimeout(timer);
        console.warn('SVG image load error in ensureRasterDataUrl:', e);
        resolve(dataUrl);
      };
      img.src = dataUrl;
    } catch {
      resolve(dataUrl);
    }
  });
}

async function loadImageElement(src: string): Promise<HTMLImageElement | null> {
  if (!src) return null;
  const normalizedSrc =
    src.startsWith('data:image/svg+xml') || src.includes('image/svg+xml')
      ? await ensureRasterDataUrl(src)
      : src;

  return new Promise((resolve) => {
    try {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      const timer = setTimeout(() => resolve(null), 5000);
      img.onload = () => {
        clearTimeout(timer);
        resolve(img);
      };
      img.onerror = () => {
        clearTimeout(timer);
        resolve(null);
      };
      img.src = normalizedSrc;
    } catch {
      resolve(null);
    }
  });
}

async function ensureFormFontsLoaded(): Promise<void> {
  if (typeof document === 'undefined' || !document.fonts) return;
  try {
    await Promise.race([
      Promise.allSettled([
        document.fonts.ready,
        document.fonts.load('400 13px "Noto Serif KR"'),
        document.fonts.load('700 13px "Noto Serif KR"'),
        document.fonts.load('700 23px "Noto Serif KR"'),
        document.fonts.load('400 11px "Noto Sans KR"'),
        document.fonts.load('600 11px "Noto Sans KR"'),
      ]),
      new Promise((resolve) => setTimeout(resolve, 1500)),
    ]);
  } catch {
    // Gracefully fall back to system Korean fonts
  }
}

function getOfficeChiefTitle(address?: string): string {
  const matchedOffice = findOfficeByAddress(address || '');
  if (!matchedOffice) {
    return '○○ 출입국·외국인청(사무소)장 귀하';
  }
  return `${matchedOffice.name}장 귀하`;
}

function wrapTextLines(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number
): string[] {
  const raw = String(text || '').trim();
  if (!raw) return [''];
  if (ctx.measureText(raw).width <= maxWidth) return [raw];

  const lines: string[] = [];
  const words = raw.split(/\s+/);
  let current = '';

  const pushWordByChar = (word: string) => {
    let chunk = '';
    for (const ch of Array.from(word)) {
      const test = chunk + ch;
      if (ctx.measureText(test).width > maxWidth && chunk.length > 0) {
        lines.push(chunk);
        chunk = ch;
      } else {
        chunk = test;
      }
    }
    if (chunk) current = chunk;
  };

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (ctx.measureText(candidate).width <= maxWidth) {
      current = candidate;
    } else {
      if (current) {
        lines.push(current);
        current = '';
      }
      if (ctx.measureText(word).width <= maxWidth) {
        current = word;
      } else {
        pushWordByChar(word);
      }
    }
  }
  if (current) lines.push(current);
  return lines.length > 0 ? lines : [''];
}

function drawFittedText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  baseSize: number,
  weight: string,
  family: string,
  align: CanvasTextAlign = 'center',
  color = '#000000',
  minSize = 8.5
) {
  let fontSize = baseSize;
  ctx.save();
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';

  while (fontSize > minSize) {
    ctx.font = `${weight} ${fontSize}px ${family}`;
    if (ctx.measureText(text).width <= maxWidth) break;
    fontSize -= 0.5;
  }
  ctx.font = `${weight} ${fontSize}px ${family}`;
  ctx.fillText(text, x, y, maxWidth);
  ctx.restore();
}

function drawSpacedCenteredText(
  ctx: CanvasRenderingContext2D,
  text: string,
  centerX: number,
  y: number,
  extraSpacing: number
) {
  const chars = Array.from(text);
  const widths = chars.map((ch) => ctx.measureText(ch).width);
  const totalWidth =
    widths.reduce((acc, w) => acc + w, 0) +
    Math.max(0, chars.length - 1) * extraSpacing;

  let cursorX = centerX - totalWidth / 2;
  ctx.save();
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  for (let i = 0; i < chars.length; i++) {
    ctx.fillText(chars[i], cursorX, y);
    cursorX += widths[i] + extraSpacing;
  }
  ctx.restore();
}

function drawCheckbox(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  checked: boolean
) {
  ctx.save();
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(x, y, size, size);
  ctx.strokeStyle = '#000000';
  ctx.lineWidth = 1.25;
  ctx.strokeRect(x, y, size, size);

  if (checked) {
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 2.0;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(x + size * 0.2, y + size * 0.52);
    ctx.lineTo(x + size * 0.43, y + size * 0.76);
    ctx.lineTo(x + size * 0.82, y + size * 0.24);
    ctx.stroke();
  }
  ctx.restore();
}

function roundedRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

function drawCanvasWatermark(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number
) {
  ctx.save();

  // 1. Subtle Repeated Diagonal Background Grid
  ctx.save();
  ctx.fillStyle = 'rgba(185, 28, 28, 0.13)';
  ctx.font = '800 14px "Noto Sans KR", "Inter", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const rows = 8;
  const cols = 4;
  for (let r = 0; r < rows; r++) {
    const cy = 70 + ((h - 140) / (rows - 1)) * r;
    for (let c = 0; c < cols; c++) {
      const cx = 100 + ((w - 200) / (cols - 1)) * c;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate((-30 * Math.PI) / 180);
      ctx.fillText('REJECTION • UNPAID', 0, 0);
      ctx.restore();
    }
  }
  ctx.restore();

  // 2. Top-Right Official REJECTION COPY Badge
  ctx.save();
  ctx.translate(w - 135, 76);
  ctx.rotate((6 * Math.PI) / 180);
  const bx = -102;
  const by = -32;
  const bw = 204;
  const bh = 64;
  ctx.fillStyle = 'rgba(254, 242, 242, 0.85)';
  ctx.strokeStyle = 'rgba(220, 38, 38, 0.85)';
  ctx.lineWidth = 2.5;
  ctx.setLineDash([5, 4]);
  roundedRectPath(ctx, bx, by, bw, bh, 10);
  ctx.fill();
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#b91c1c';
  ctx.font = '900 12px "Noto Sans KR", "Inter", sans-serif';
  ctx.fillText('⚠ REJECTION COPY', 0, -14);
  ctx.font = '700 9px "Noto Serif KR", serif';
  ctx.fillStyle = '#991b1b';
  ctx.fillText('출입국 제출불가 (심사용 미결제본)', 0, 3);
  ctx.font = '500 8.5px "Noto Sans KR", sans-serif';
  ctx.fillStyle = '#334155';
  ctx.fillText('NOT VALID FOR SUBMISSION', 0, 18);
  ctx.restore();

  // 3. Center Huge Diagonal REJECTION Stamp
  ctx.save();
  ctx.translate(w / 2, h / 2 - 16);
  ctx.rotate((-28 * Math.PI) / 180);
  const sw = 540;
  const sh = 175;
  ctx.fillStyle = 'rgba(239, 68, 68, 0.11)';
  ctx.strokeStyle = 'rgba(220, 38, 38, 0.85)';
  ctx.lineWidth = 6;
  roundedRectPath(ctx, -sw / 2, -sh / 2, sw, sh, 22);
  ctx.fill();
  ctx.stroke();

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#b91c1c';
  ctx.font = '800 13px "Noto Sans KR", "Inter", sans-serif';
  ctx.fillText('▲  OFFICIAL SAMPLE DOCUMENT  ▲', 0, -58);

  ctx.fillStyle = '#dc2626';
  ctx.font = '900 66px "Noto Sans KR", "Inter", sans-serif';
  drawSpacedCenteredText(ctx, 'REJECTION', 0, -6, 10);

  ctx.fillStyle = '#991b1b';
  ctx.font = '800 12.5px "Noto Serif KR", serif';
  ctx.fillText('반려본 / 심사용 미결제본 (UNPAID COPY)', 0, 42);

  ctx.fillStyle = '#b91c1c';
  ctx.font = '700 10px "Noto Sans KR", monospace';
  ctx.fillText('NOT VALID FOR SUBMISSION • UNLOCK CLEAN COPY VIA PAYMENT', 0, 62);
  ctx.restore();

  // 4. Bottom Warning Strip
  ctx.save();
  ctx.fillStyle = 'rgba(220, 38, 38, 0.92)';
  ctx.strokeStyle = '#b91c1c';
  ctx.lineWidth = 1;
  roundedRectPath(ctx, 18, h - 42, w - 36, 26, 7);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '700 10.5px "Noto Sans KR", sans-serif';
  ctx.fillText(
    '⚠ UNPAID REJECTION COPY — 출입국 제출 불가 (결제 또는 Promo Code 입력 후 깨끗한 PDF 다운로드 가능)',
    w / 2,
    h - 29
  );
  ctx.restore();

  ctx.restore();
}

/**
 * Deterministically renders Page 1 (사회통합프로그램 연계 신청서) directly onto a
 * high-DPI A4 Canvas (1654 x 2339 px @ 200 DPI).
 * Eliminates all Tailwind v4 / CSS oklch / html2canvas DOM-cloning bugs across Desktop, iOS, and Android.
 */
export async function renderOfficialFormToCanvas({
  formData,
  docs,
  sigSettings = { x: 0, y: 0, scale: 1.0, removeBg: true },
  showWatermark = false,
}: {
  formData: ApplicationFormData;
  docs: UploadedDocuments;
  sigSettings?: SignatureSettings;
  showWatermark?: boolean;
}): Promise<HTMLCanvasElement> {
  await ensureFormFontsLoaded();

  const sigImg = docs.signature ? await loadImageElement(docs.signature) : null;

  // High-DPI A4 Canvas (210mm x 297mm @ 200 DPI)
  const CANVAS_W = 1654;
  const CANVAS_H = 2339;
  const LOGICAL_W = 794;
  const LOGICAL_H = 1123;

  const canvas = document.createElement('canvas');
  canvas.width = CANVAS_W;
  canvas.height = CANVAS_H;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Cannot initialize 2D canvas context');
  }

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  // Pure white A4 background
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

  ctx.scale(CANVAS_W / LOGICAL_W, CANVAS_H / LOGICAL_H);

  const SERIF =
    '"Noto Serif KR", "Batang", "Nanum Myeongjo", "Apple SD Gothic Neo", "Malgun Gothic", serif';
  const SANS =
    '"Noto Sans KR", "Inter", "Apple SD Gothic Neo", "Malgun Gothic", sans-serif';

  const PAD_X = 53; // ~14mm
  const PAD_TOP = 47; // ~12.5mm
  const CONTENT_W = LOGICAL_W - PAD_X * 2; // 688

  // Pre-calculate address lines so long addresses dynamically expand the table row
  ctx.font = `700 12.5px ${SERIF}`;
  const colW = [
    CONTENT_W * 0.18,
    CONTENT_W * 0.16,
    CONTENT_W * 0.25,
    CONTENT_W * 0.16,
    CONTENT_W * 0.25,
  ];
  const colX = [
    PAD_X,
    PAD_X + colW[0],
    PAD_X + colW[0] + colW[1],
    PAD_X + colW[0] + colW[1] + colW[2],
    PAD_X + colW[0] + colW[1] + colW[2] + colW[3],
  ];
  const addrBoxW = colW[2] + colW[3] + colW[4] - 20;
  const addrLines = wrapTextLines(ctx, formData.address || '', addrBoxW);
  const addrRowH = Math.max(36, 16 + addrLines.length * 17);

  // Compute total height first to verify fit within LOGICAL_H - 42 bottom margin
  const tableRowHeights = {
    b1r1: 33,
    b1r2: 33,
    b2r1: 35,
    b2r2: 40,
    b2r3: 35,
    b2r4: 36,
    b2r5: addrRowH,
    b2r6: 35,
    b3r1: 52,
    b3r2: 38,
    b3r3: 44,
    b3r4: 44,
    b4r1: 78,
  };
  const totalTableH = Object.values(tableRowHeights).reduce((a, b) => a + b, 0);
  const estimatedEndY = PAD_TOP + 68 + totalTableH + 6 + 58 + 50 + 78 + 48 + 148;
  const maxAllowedEndY = LOGICAL_H - 28;
  const vScale = estimatedEndY > maxAllowedEndY ? (maxAllowedEndY - PAD_TOP) / (estimatedEndY - PAD_TOP) : 1;

  if (vScale < 1) {
    ctx.translate(0, PAD_TOP * (1 - vScale));
    ctx.scale(1, vScale);
  }

  let y = PAD_TOP;

  // ==========================================================
  // 1. HEADER
  // ==========================================================
  ctx.fillStyle = '#334155';
  ctx.font = `400 10px ${SERIF}`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText('[별지 서식] 사회통합정보망(www.socinet.go.kr) - 민원서식', PAD_X, y + 6);

  ctx.fillStyle = '#000000';
  ctx.font = `700 23px ${SERIF}`;
  drawSpacedCenteredText(ctx, '사회통합프로그램 연계 신청서', LOGICAL_W / 2, y + 32, 3);

  ctx.fillStyle = '#475569';
  ctx.font = `400 11px ${SANS}`;
  ctx.textAlign = 'center';
  ctx.fillText(
    '(Application for Korea Immigration & Integration Program Linkage)',
    LOGICAL_W / 2,
    y + 53
  );

  y += 68;

  // ==========================================================
  // 2. MAIN OFFICIAL FORM TABLE (4 Blocks, 5 Columns)
  // ==========================================================
  const tableStartY = y;
  const fillCell = (x: number, cy: number, w: number, h: number, color = '#f2f2f2') => {
    ctx.fillStyle = color;
    ctx.fillRect(x, cy, w, h);
  };
  const hLine = (x1: number, x2: number, ly: number, width = 1) => {
    ctx.save();
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = width;
    ctx.lineCap = 'square';
    ctx.beginPath();
    ctx.moveTo(x1, ly);
    ctx.lineTo(x2, ly);
    ctx.stroke();
    ctx.restore();
  };
  const vLine = (lx: number, y1: number, y2: number, width = 1) => {
    ctx.save();
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = width;
    ctx.lineCap = 'square';
    ctx.beginPath();
    ctx.moveTo(lx, y1);
    ctx.lineTo(lx, y2);
    ctx.stroke();
    ctx.restore();
  };

  // --- BLOCK 1: 신청 대상 ---
  const b1Y = y;
  const b1H = tableRowHeights.b1r1 + tableRowHeights.b1r2;
  fillCell(colX[0], b1Y, colW[0], b1H, '#f2f2f2');
  fillCell(colX[1], b1Y, CONTENT_W - colW[0], b1H, '#ffffff');

  ctx.fillStyle = '#000000';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `700 12.5px ${SERIF}`;
  ctx.fillText('신청 대상', colX[0] + colW[0] / 2, b1Y + b1H / 2 - 8);
  ctx.fillStyle = '#475569';
  ctx.font = `400 10px ${SANS}`;
  ctx.fillText('(※해당√표)', colX[0] + colW[0] / 2, b1Y + b1H / 2 + 10);

  // Row 1: TOPIK
  const cbSize = 13.5;
  drawCheckbox(
    ctx,
    colX[1] + 10,
    b1Y + (tableRowHeights.b1r1 - cbSize) / 2,
    cbSize,
    formData.applyType === 'topik'
  );
  ctx.fillStyle = '#000000';
  ctx.textAlign = 'left';
  ctx.font = `700 13px ${SERIF}`;
  ctx.fillText(
    '한국어능력시험(TOPIK) 연계평가 신청',
    colX[1] + 31,
    b1Y + tableRowHeights.b1r1 / 2 + 0.5
  );

  // Row 2: Marriage
  const b1r2Y = b1Y + tableRowHeights.b1r1;
  drawCheckbox(
    ctx,
    colX[1] + 10,
    b1r2Y + (tableRowHeights.b1r2 - cbSize) / 2,
    cbSize,
    formData.applyType === 'marriage'
  );
  ctx.fillStyle = '#1e293b';
  ctx.font = `400 13px ${SERIF}`;
  ctx.fillText(
    '결혼이민사증 소지자의 2단계 연계 신청',
    colX[1] + 31,
    b1r2Y + tableRowHeights.b1r2 / 2 + 0.5
  );

  hLine(colX[1], PAD_X + CONTENT_W, b1r2Y, 1);
  vLine(colX[1], b1Y, b1Y + b1H, 1);
  y = b1Y + b1H;

  // --- BLOCK 2: 신청인 ---
  const b2Y = y;
  const b2H =
    tableRowHeights.b2r1 +
    tableRowHeights.b2r2 +
    tableRowHeights.b2r3 +
    tableRowHeights.b2r4 +
    tableRowHeights.b2r5 +
    tableRowHeights.b2r6;

  // Fill background cells
  fillCell(colX[0], b2Y, colW[0], b2H, '#f2f2f2');
  fillCell(colX[1], b2Y, colW[1], b2H, '#f2f2f2');
  fillCell(colX[2], b2Y, colW[2] + colW[3] + colW[4], b2H, '#ffffff');
  // Label cells on col 3 for rows 2,3,4,6
  const b2r2Y = b2Y + tableRowHeights.b2r1;
  const b2r3Y = b2r2Y + tableRowHeights.b2r2;
  const b2r4Y = b2r3Y + tableRowHeights.b2r3;
  const b2r5Y = b2r4Y + tableRowHeights.b2r4;
  const b2r6Y = b2r5Y + tableRowHeights.b2r5;

  fillCell(colX[3], b2r2Y, colW[3], tableRowHeights.b2r2, '#f2f2f2');
  fillCell(colX[3], b2r3Y, colW[3], tableRowHeights.b2r3, '#f2f2f2');
  fillCell(colX[3], b2r4Y, colW[3], tableRowHeights.b2r4, '#f2f2f2');
  fillCell(colX[3], b2r6Y, colW[3], tableRowHeights.b2r6, '#f2f2f2');

  // Left vertical label: 신 청 인
  ctx.fillStyle = '#000000';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `700 13px ${SERIF}`;
  ctx.fillText('신  청  인', colX[0] + colW[0] / 2, b2Y + b2H / 2);

  // Row 1: 성 명
  ctx.fillText('성    명', colX[1] + colW[1] / 2, b2Y + tableRowHeights.b2r1 / 2);
  drawFittedText(
    ctx,
    formData.name || '',
    colX[2] + 10,
    b2Y + tableRowHeights.b2r1 / 2 + 0.5,
    colW[2] + colW[3] + colW[4] - 20,
    14,
    '700',
    SERIF,
    'left',
    '#000000'
  );

  // Row 2: 외국인(주민) 등록번호 | 성 별
  ctx.fillStyle = '#000000';
  ctx.font = `700 11.5px ${SERIF}`;
  ctx.textAlign = 'center';
  ctx.fillText('외국인(주민)', colX[1] + colW[1] / 2, b2r2Y + tableRowHeights.b2r2 / 2 - 7);
  ctx.fillText('등록번호', colX[1] + colW[1] / 2, b2r2Y + tableRowHeights.b2r2 / 2 + 8);

  const regText =
    formData.regNumber1 && formData.regNumber2
      ? `${formData.regNumber1} - ${formData.regNumber2}`
      : formData.regNumber1 || formData.regNumber2 || '';
  drawFittedText(
    ctx,
    regText,
    colX[2] + colW[2] / 2,
    b2r2Y + tableRowHeights.b2r2 / 2 + 0.5,
    colW[2] - 12,
    14,
    '700',
    SERIF,
    'center',
    '#000000'
  );
  ctx.fillStyle = '#000000';
  ctx.font = `700 13px ${SERIF}`;
  ctx.textAlign = 'center';
  ctx.fillText('성  별', colX[3] + colW[3] / 2, b2r2Y + tableRowHeights.b2r2 / 2);
  ctx.fillText(
    formData.gender ? `${formData.gender}자` : '남자',
    colX[4] + colW[4] / 2,
    b2r2Y + tableRowHeights.b2r2 / 2 + 0.5
  );

  // Row 3: 국 적 | 체류자격
  ctx.fillStyle = '#000000';
  ctx.font = `700 13px ${SERIF}`;
  ctx.fillText('국    적', colX[1] + colW[1] / 2, b2r3Y + tableRowHeights.b2r3 / 2);
  drawFittedText(
    ctx,
    formData.nationality || 'Cambodia',
    colX[2] + colW[2] / 2,
    b2r3Y + tableRowHeights.b2r3 / 2 + 0.5,
    colW[2] - 12,
    13,
    '700',
    SERIF,
    'center',
    '#000000'
  );
  ctx.fillStyle = '#000000';
  ctx.font = `700 13px ${SERIF}`;
  ctx.fillText('체류자격', colX[3] + colW[3] / 2, b2r3Y + tableRowHeights.b2r3 / 2);
  drawFittedText(
    ctx,
    formData.visaStatus || 'E-9-1',
    colX[4] + colW[4] / 2,
    b2r3Y + tableRowHeights.b2r3 / 2 + 0.5,
    colW[4] - 12,
    13,
    '700',
    SERIF,
    'center',
    '#000000'
  );

  // Row 4: 여권번호 | 여권 유효기간
  ctx.fillStyle = '#000000';
  ctx.font = `700 13px ${SERIF}`;
  ctx.fillText('여권번호', colX[1] + colW[1] / 2, b2r4Y + tableRowHeights.b2r4 / 2);
  drawFittedText(
    ctx,
    formData.passportNo || 'N01847291',
    colX[2] + colW[2] / 2,
    b2r4Y + tableRowHeights.b2r4 / 2 + 0.5,
    colW[2] - 12,
    13,
    '700',
    SERIF,
    'center',
    '#000000'
  );
  ctx.fillStyle = '#000000';
  ctx.font = `700 11.5px ${SERIF}`;
  ctx.fillText('여권 유효기간', colX[3] + colW[3] / 2, b2r4Y + tableRowHeights.b2r4 / 2);
  drawFittedText(
    ctx,
    formData.passportExpiry || '2031-08-15',
    colX[4] + colW[4] / 2,
    b2r4Y + tableRowHeights.b2r4 / 2 + 0.5,
    colW[4] - 12,
    13,
    '700',
    SERIF,
    'center',
    '#000000'
  );

  // Row 5: 체 류 지 (multi-line supported)
  ctx.fillStyle = '#000000';
  ctx.font = `700 13px ${SERIF}`;
  ctx.textAlign = 'center';
  ctx.fillText('체 류 지', colX[1] + colW[1] / 2, b2r5Y + tableRowHeights.b2r5 / 2);

  ctx.textAlign = 'left';
  ctx.font = `700 12.5px ${SERIF}`;
  const lineH = 16.5;
  const startAddrY =
    b2r5Y + tableRowHeights.b2r5 / 2 - ((addrLines.length - 1) * lineH) / 2 + 0.5;
  addrLines.forEach((line, i) => {
    ctx.fillText(line, colX[2] + 10, startAddrY + i * lineH);
  });

  // Row 6: 전화번호 | 휴대폰
  ctx.fillStyle = '#000000';
  ctx.font = `700 13px ${SERIF}`;
  ctx.textAlign = 'center';
  ctx.fillText('전화번호', colX[1] + colW[1] / 2, b2r6Y + tableRowHeights.b2r6 / 2);
  drawFittedText(
    ctx,
    formData.phone || formData.mobile || '',
    colX[2] + colW[2] / 2,
    b2r6Y + tableRowHeights.b2r6 / 2 + 0.5,
    colW[2] - 12,
    13,
    '700',
    SERIF,
    'center',
    '#000000'
  );
  ctx.fillStyle = '#000000';
  ctx.font = `700 13px ${SERIF}`;
  ctx.fillText('휴대폰', colX[3] + colW[3] / 2, b2r6Y + tableRowHeights.b2r6 / 2);
  drawFittedText(
    ctx,
    formData.mobile || formData.phone || '',
    colX[4] + colW[4] / 2,
    b2r6Y + tableRowHeights.b2r6 / 2 + 0.5,
    colW[4] - 12,
    13,
    '700',
    SERIF,
    'center',
    '#000000'
  );

  // Inner grid lines for Block 2
  hLine(colX[1], PAD_X + CONTENT_W, b2r2Y, 1);
  hLine(colX[1], PAD_X + CONTENT_W, b2r3Y, 1);
  hLine(colX[1], PAD_X + CONTENT_W, b2r4Y, 1);
  hLine(colX[1], PAD_X + CONTENT_W, b2r5Y, 1);
  hLine(colX[1], PAD_X + CONTENT_W, b2r6Y, 1);
  vLine(colX[1], b2Y, b2Y + b2H, 1);
  vLine(colX[2], b2Y, b2Y + b2H, 1);
  vLine(colX[3], b2r2Y, b2r5Y, 1);
  vLine(colX[4], b2r2Y, b2r5Y, 1);
  vLine(colX[3], b2r6Y, b2Y + b2H, 1);
  vLine(colX[4], b2r6Y, b2Y + b2H, 1);

  y = b2Y + b2H;

  // --- BLOCK 3: 한국어 능력시험 성적증명서 ---
  const b3Y = y;
  const b3H =
    tableRowHeights.b3r1 +
    tableRowHeights.b3r2 +
    tableRowHeights.b3r3 +
    tableRowHeights.b3r4;
  const b3r2Y = b3Y + tableRowHeights.b3r1;
  const b3r3Y = b3r2Y + tableRowHeights.b3r2;
  const b3r4Y = b3r3Y + tableRowHeights.b3r3;

  fillCell(colX[0], b3Y, colW[0], b3H, '#f2f2f2');
  fillCell(colX[1], b3Y, colW[1], tableRowHeights.b3r1, '#f2f2f2');
  fillCell(colX[2], b3Y, colW[2] + colW[3] + colW[4], tableRowHeights.b3r1, '#ffffff');
  fillCell(colX[1], b3r2Y, colW[1] + colW[2], tableRowHeights.b3r2, '#f2f2f2');
  fillCell(colX[3], b3r2Y, colW[3] + colW[4], tableRowHeights.b3r2, '#ffffff');
  fillCell(colX[1], b3r3Y, colW[1], tableRowHeights.b3r3 + tableRowHeights.b3r4, '#f2f2f2');
  fillCell(colX[2], b3r3Y, colW[2], tableRowHeights.b3r3 + tableRowHeights.b3r4, '#ffffff');
  fillCell(colX[3], b3r3Y, colW[3], tableRowHeights.b3r3 + tableRowHeights.b3r4, '#f2f2f2');
  fillCell(colX[4], b3r3Y, colW[4], tableRowHeights.b3r3 + tableRowHeights.b3r4, '#ffffff');

  // Left block label
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#000000';
  ctx.font = `700 12px ${SERIF}`;
  const b3Mid = b3Y + b3H / 2;
  ctx.fillText('한국어', colX[0] + colW[0] / 2, b3Mid - 36);
  ctx.fillText('능력시험', colX[0] + colW[0] / 2, b3Mid - 20);
  ctx.fillText('성적증명서', colX[0] + colW[0] / 2, b3Mid - 4);
  ctx.fillStyle = '#334155';
  ctx.font = `400 9.5px ${SANS}`;
  ctx.fillText('(OFFICIAL', colX[0] + colW[0] / 2, b3Mid + 14);
  ctx.fillText('TOPIK SCORE', colX[0] + colW[0] / 2, b3Mid + 27);
  ctx.fillText('REPORT)', colX[0] + colW[0] / 2, b3Mid + 40);

  // Row 1: 문서확인번호
  ctx.fillStyle = '#000000';
  ctx.font = `700 12.5px ${SERIF}`;
  ctx.fillText('문서확인번호', colX[1] + colW[1] / 2, b3Y + tableRowHeights.b3r1 / 2);

  const [d0, d1, d2, d3] = normalizeDocVerificationNo(formData.docVerificationNo);
  const docStr = d0 || d1 || d2 || d3 ? `${d0} - ${d1} - ${d2} - ${d3}` : '';
  drawFittedText(
    ctx,
    docStr,
    colX[2] + (colW[2] + colW[3] + colW[4]) / 2,
    b3Y + tableRowHeights.b3r1 / 2 - 8,
    colW[2] + colW[3] + colW[4] - 24,
    16,
    '700',
    SERIF,
    'center',
    '#000000'
  );
  ctx.fillStyle = '#64748b';
  ctx.font = `400 10px ${SANS}`;
  ctx.textAlign = 'center';
  ctx.fillText(
    '※ 온라인 출력 성적증명서 확인번호 (16자리)',
    colX[2] + (colW[2] + colW[3] + colW[4]) / 2,
    b3Y + tableRowHeights.b3r1 / 2 + 12
  );

  // Row 2: 수험번호
  const examLabelCenter = colX[1] + (colW[1] + colW[2]) / 2;
  ctx.fillStyle = '#000000';
  ctx.font = `700 12px ${SERIF}`;
  const koPart = '수 험 번 호 ';
  ctx.font = `400 10px ${SANS}`;
  const enPart = '(Registration No. / Application No.)';
  ctx.font = `700 12px ${SERIF}`;
  const koW = ctx.measureText(koPart).width;
  ctx.font = `400 10px ${SANS}`;
  const enW = ctx.measureText(enPart).width;
  const totalExamLabelW = koW + enW;
  const startExamX = examLabelCenter - totalExamLabelW / 2;
  ctx.textAlign = 'left';
  ctx.fillStyle = '#000000';
  ctx.font = `700 12px ${SERIF}`;
  ctx.fillText(koPart, startExamX, b3r2Y + tableRowHeights.b3r2 / 2);
  ctx.fillStyle = '#475569';
  ctx.font = `400 10px ${SANS}`;
  ctx.fillText(enPart, startExamX + koW, b3r2Y + tableRowHeights.b3r2 / 2 + 0.5);

  drawFittedText(
    ctx,
    formData.examNumber || '',
    colX[3] + (colW[3] + colW[4]) / 2,
    b3r2Y + tableRowHeights.b3r2 / 2 + 0.5,
    colW[3] + colW[4] - 20,
    14,
    '700',
    SERIF,
    'center',
    '#000000'
  );

  // Row 3: 시험일 | 회차
  ctx.textAlign = 'center';
  ctx.fillStyle = '#000000';
  ctx.font = `700 12px ${SERIF}`;
  ctx.fillText('시 험 일', colX[1] + colW[1] / 2, b3r3Y + tableRowHeights.b3r3 / 2 - 7);
  ctx.fillStyle = '#475569';
  ctx.font = `400 10px ${SANS}`;
  ctx.fillText('(Test Date)', colX[1] + colW[1] / 2, b3r3Y + tableRowHeights.b3r3 / 2 + 9);

  drawFittedText(
    ctx,
    formData.examDate || '',
    colX[2] + colW[2] / 2,
    b3r3Y + tableRowHeights.b3r3 / 2 + 0.5,
    colW[2] - 12,
    13,
    '700',
    SERIF,
    'center',
    '#000000'
  );

  ctx.fillStyle = '#000000';
  ctx.font = `700 12px ${SERIF}`;
  ctx.fillText('회    차', colX[3] + colW[3] / 2, b3r3Y + tableRowHeights.b3r3 / 2 - 7);
  ctx.fillStyle = '#475569';
  ctx.font = `400 10px ${SANS}`;
  ctx.fillText('(Test Held)', colX[3] + colW[3] / 2, b3r3Y + tableRowHeights.b3r3 / 2 + 9);

  ctx.fillStyle = '#000000';
  ctx.font = `700 13.5px ${SERIF}`;
  ctx.fillText(
    formData.round ? `제 ${formData.round} 회` : '',
    colX[4] + colW[4] / 2,
    b3r3Y + tableRowHeights.b3r3 / 2 + 0.5
  );

  // Row 4: 성적유효기간 | 등급
  ctx.fillStyle = '#000000';
  ctx.font = `700 12px ${SERIF}`;
  ctx.fillText('성적유효기간', colX[1] + colW[1] / 2, b3r4Y + tableRowHeights.b3r4 / 2 - 7);
  ctx.fillStyle = '#475569';
  ctx.font = `400 10px ${SANS}`;
  ctx.fillText('(Valid Until)', colX[1] + colW[1] / 2, b3r4Y + tableRowHeights.b3r4 / 2 + 9);

  drawFittedText(
    ctx,
    formData.validUntil || '',
    colX[2] + colW[2] / 2,
    b3r4Y + tableRowHeights.b3r4 / 2 + 0.5,
    colW[2] - 12,
    13,
    '700',
    SERIF,
    'center',
    '#be123c'
  );

  ctx.fillStyle = '#000000';
  ctx.font = `700 12px ${SERIF}`;
  ctx.fillText('등    급', colX[3] + colW[3] / 2, b3r4Y + tableRowHeights.b3r4 / 2 - 7);
  ctx.fillStyle = '#475569';
  ctx.font = `400 10px ${SANS}`;
  ctx.fillText('(Grade)', colX[3] + colW[3] / 2, b3r4Y + tableRowHeights.b3r4 / 2 + 9);

  ctx.fillStyle = '#065f46';
  ctx.font = `700 14px ${SERIF}`;
  ctx.fillText(
    formData.grade || '0급',
    colX[4] + colW[4] / 2,
    b3r4Y + tableRowHeights.b3r4 / 2 + 0.5
  );

  // Inner grid lines for Block 3
  hLine(colX[1], PAD_X + CONTENT_W, b3r2Y, 1);
  hLine(colX[1], PAD_X + CONTENT_W, b3r3Y, 1);
  hLine(colX[1], PAD_X + CONTENT_W, b3r4Y, 1);
  vLine(colX[1], b3Y, b3Y + b3H, 1);
  vLine(colX[2], b3Y, b3r2Y, 1);
  vLine(colX[3], b3r2Y, b3r3Y, 1);
  vLine(colX[2], b3r3Y, b3Y + b3H, 1);
  vLine(colX[3], b3r3Y, b3Y + b3H, 1);
  vLine(colX[4], b3r3Y, b3Y + b3H, 1);

  y = b3Y + b3H;

  // --- BLOCK 4: 법무부 지정 해외 한국어 교육기관 이수증 사항 ---
  const b4Y = y;
  const b4H = tableRowHeights.b4r1;
  fillCell(colX[0], b4Y, colW[0], b4H, '#f2f2f2');
  fillCell(colX[1], b4Y, CONTENT_W - colW[0], b4H, '#ffffff');

  ctx.textAlign = 'center';
  ctx.fillStyle = '#000000';
  ctx.font = `700 11.5px ${SERIF}`;
  const b4Mid = b4Y + b4H / 2;
  ctx.fillText('법무부 지정', colX[0] + colW[0] / 2, b4Mid - 22);
  ctx.fillText('해외 한국어', colX[0] + colW[0] / 2, b4Mid - 7);
  ctx.fillText('교육기관', colX[0] + colW[0] / 2, b4Mid + 8);
  ctx.fillText('이수증 사항', colX[0] + colW[0] / 2, b4Mid + 23);

  const b4Col1Center = colX[1] + (colW[1] + colW[2]) / 2;
  ctx.font = `700 11.5px ${SERIF}`;
  ctx.fillStyle = '#000000';
  ctx.fillText('교육기관명', b4Col1Center, b4Mid - 18);
  drawFittedText(
    ctx,
    formData.instituteName || '-',
    b4Col1Center,
    b4Mid + 1,
    colW[1] + colW[2] - 20,
    12,
    '400',
    SERIF,
    'center',
    '#1e293b'
  );
  ctx.fillStyle = '#64748b';
  ctx.font = `400 10px ${SANS}`;
  ctx.fillText('※ 결혼이민사증 2단계 연계자만 작성', b4Col1Center, b4Mid + 20);

  const b4Col2Center = colX[3] + (colW[3] + colW[4]) / 2;
  ctx.fillStyle = '#000000';
  ctx.font = `700 11.5px ${SERIF}`;
  ctx.fillText('이수일자', b4Col2Center, b4Mid - 10);
  ctx.fillStyle = '#1e293b';
  ctx.font = `400 12px ${SERIF}`;
  ctx.fillText(formData.completionDate || '-', b4Col2Center, b4Mid + 10);

  vLine(colX[1], b4Y, b4Y + b4H, 1);
  vLine(colX[3], b4Y, b4Y + b4H, 1);

  y = b4Y + b4H;

  // --- OUTER & SECTION THICK 2px BORDERS ---
  hLine(PAD_X, PAD_X + CONTENT_W, tableStartY, 2);
  hLine(PAD_X, PAD_X + CONTENT_W, b2Y, 2);
  hLine(PAD_X, PAD_X + CONTENT_W, b3Y, 2);
  hLine(PAD_X, PAD_X + CONTENT_W, b4Y, 2);
  hLine(PAD_X, PAD_X + CONTENT_W, y, 2);
  vLine(PAD_X, tableStartY, y, 2);
  vLine(PAD_X + CONTENT_W, tableStartY, y, 2);

  // ==========================================================
  // 3. SOCINET ACCOUNT BOX
  // ==========================================================
  y += 6;
  const socH = 56;
  ctx.fillStyle = '#f8fafc';
  ctx.fillRect(PAD_X, y, CONTENT_W, socH);
  ctx.strokeStyle = '#475569';
  ctx.lineWidth = 1;
  ctx.strokeRect(PAD_X, y, CONTENT_W, socH);

  // Header
  ctx.fillStyle = '#334155';
  ctx.font = `500 9.5px ${SERIF}`;
  ctx.textAlign = 'left';
  ctx.fillText('※ 사회통합정보망(Socinet) 계정 정보 (연계 접수 확인용)', PAD_X + 8, y + 11);

  ctx.fillStyle = '#64748b';
  ctx.font = `400 8.5px ${SANS}`;
  ctx.textAlign = 'right';
  ctx.fillText('www.socinet.go.kr', PAD_X + CONTENT_W - 8, y + 11);

  ctx.strokeStyle = '#cbd5e1';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(PAD_X + 8, y + 21);
  ctx.lineTo(PAD_X + CONTENT_W - 8, y + 21);
  ctx.stroke();

  // Two input fields: 아이디 (ID) and 비밀번호 (PW)
  const fieldY = y + 26;
  const fieldH = 22;
  const halfW = (CONTENT_W - 16 - 10) / 2;
  const drawSocinetField = (fx: number, label: string, val: string) => {
    ctx.fillStyle = '#475569';
    ctx.font = `500 9.5px ${SANS}`;
    ctx.textAlign = 'left';
    ctx.fillText(label, fx, fieldY + fieldH / 2);

    const boxX = fx + 68;
    const boxW = halfW - 68;
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#94a3b8';
    ctx.lineWidth = 1;
    roundedRectPath(ctx, boxX, fieldY, boxW, fieldH, 3);
    ctx.fill();
    ctx.stroke();

    drawFittedText(
      ctx,
      val || '-',
      boxX + 7,
      fieldY + fieldH / 2 + 0.5,
      boxW - 14,
      9.5,
      '400',
      SANS,
      'left',
      '#334155',
      7.5
    );
  };

  drawSocinetField(PAD_X + 8, '아이디 (ID)', formData.socinetId);
  drawSocinetField(PAD_X + 8 + halfW + 10, '비밀번호 (PW)', formData.socinetPw);

  y += socH;

  // ==========================================================
  // 4. OFFICIAL DECLARATION
  // ==========================================================
  y += 14;
  ctx.fillStyle = '#000000';
  ctx.textAlign = 'center';
  ctx.font = `700 13.5px ${SERIF}`;
  ctx.fillText('나는 위에 기재한 사항이 사실과 틀림없음을 서약하고,', LOGICAL_W / 2, y + 10);
  ctx.fillText('사회통합프로그램 연계를 신청합니다.', LOGICAL_W / 2, y + 30);
  y += 48;

  // ==========================================================
  // 5. PRIVACY CONSENT BOX
  // ==========================================================
  const privH = 74;
  ctx.fillStyle = '#fbfbfb';
  ctx.fillRect(PAD_X, y, CONTENT_W, privH);
  hLine(PAD_X, PAD_X + CONTENT_W, y, 1.5);
  hLine(PAD_X, PAD_X + CONTENT_W, y + privH, 1);

  // Row 1: Prompt + Checkboxes on one crisp horizontal line
  const row1Y = y + 18;
  const optRightX = PAD_X + CONTENT_W - 10;
  ctx.font = `700 11.5px ${SERIF}`;
  const disagreeW = ctx.measureText('동의하지 않음').width;
  const agreeW = ctx.measureText('동의함').width;
  const smallCb = 12;
  const disagreeLabelX = optRightX - disagreeW;
  const disagreeCbX = disagreeLabelX - 4 - smallCb;
  const agreeLabelX = disagreeCbX - 12 - agreeW;
  const agreeCbX = agreeLabelX - 4 - smallCb;

  const promptMaxW = agreeCbX - (PAD_X + 10) - 8;
  drawFittedText(
    ctx,
    'o 상기 본인은 사회통합프로그램 연계 신청을 위한 개인정보 이용에 동의합니다.',
    PAD_X + 10,
    row1Y,
    promptMaxW,
    11,
    '700',
    SERIF,
    'left',
    '#000000',
    8.5
  );

  drawCheckbox(ctx, agreeCbX, row1Y - smallCb / 2, smallCb, formData.consent === 'agree');
  ctx.fillStyle = '#000000';
  ctx.textAlign = 'left';
  ctx.font = `700 11.5px ${SERIF}`;
  ctx.fillText('동의함', agreeLabelX, row1Y + 0.5);

  drawCheckbox(ctx, disagreeCbX, row1Y - smallCb / 2, smallCb, formData.consent === 'disagree');
  ctx.fillStyle = '#000000';
  ctx.fillText('동의하지 않음', disagreeLabelX, row1Y + 0.5);

  // Bullets
  ctx.fillStyle = '#334155';
  ctx.font = `400 10.5px ${SERIF}`;
  ctx.fillText(
    '• 이용·보유기간 : 제공일로부터 5년(보유기간 경과 시 즉각 폐기) - 개인정보보호법 제15조 및 제24조 의거',
    PAD_X + 18,
    y + 39
  );
  ctx.fillText(
    '• 거부시 불이익 조치 : 개인정보이용제공 부동의 시 본 연계 신청 불가',
    PAD_X + 18,
    y + 57
  );

  y += privH;

  // ==========================================================
  // 6. WARNING BOX
  // ==========================================================
  ctx.font = `400 10.5px ${SERIF}`;
  const warnText =
    '※ 신청서에 허위사실을 기재하거나 허위의 한국어능력시험 성적증명서 또는 이수증(수료증)을 제출하였을 경우 당해 연계 신청 및 승인된 후 수료한 모든 사회통합프로그램 과정이 무효가 되며 이와 관련하여 처벌받을 수 있음';
  const warnLines = wrapTextLines(ctx, warnText, CONTENT_W - 16);
  const warnH = Math.max(44, 16 + warnLines.length * 16);

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(PAD_X, y, CONTENT_W, warnH);
  hLine(PAD_X, PAD_X + CONTENT_W, y + warnH, 1.5);

  ctx.fillStyle = '#1e293b';
  ctx.textAlign = 'left';
  warnLines.forEach((line, idx) => {
    ctx.fillText(line, PAD_X + 8, y + 16 + idx * 16);
  });

  y += warnH;

  // ==========================================================
  // 7. FOOTER: DATE, APPLICANT, SIGNATURE STAMP, CHIEF TITLE
  // ==========================================================
  y += 22;
  const now = new Date();
  const applyYear =
    formData.applyYear && formData.applyYear !== '0000'
      ? formData.applyYear
      : String(now.getFullYear());
  const applyMonth =
    formData.applyMonth && formData.applyMonth !== '00'
      ? formData.applyMonth
      : String(now.getMonth() + 1).padStart(2, '0');
  const applyDay =
    formData.applyDay && formData.applyDay !== '00'
      ? formData.applyDay
      : String(now.getDate()).padStart(2, '0');

  const rightMarginX = PAD_X + CONTENT_W - 16;

  // Application Date
  ctx.fillStyle = '#000000';
  ctx.textAlign = 'right';
  ctx.font = `700 12.5px ${SERIF}`;
  ctx.fillText(
    `신청일자 :   ${applyYear} 년   ${applyMonth} 월   ${applyDay} 일`,
    rightMarginX,
    y + 10
  );

  // Applicant Row
  const appRowTop = y + 32;
  const appRowMid = appRowTop + 12;

  ctx.textAlign = 'right';
  const sealHint = '(서명 또는 인)';
  ctx.font = `400 11px ${SERIF}`;
  const sealHintW = ctx.measureText(sealHint).width;
  ctx.fillStyle = '#475569';
  ctx.fillText(sealHint, rightMarginX, appRowMid);

  const appName = formData.applicantName || formData.name || '';
  const nameRightX = rightMarginX - sealHintW - 8;
  ctx.font = `700 13px ${SERIF}`;
  const appNameW = ctx.measureText(appName).width;
  ctx.fillStyle = '#000000';
  ctx.fillText(appName, nameRightX, appRowMid);

  const labelRightX = nameRightX - appNameW - 8;
  ctx.font = `700 12.5px ${SERIF}`;
  ctx.fillText('신 청 자 :  ', labelRightX, appRowMid);

  // Draw Signature Stamp matching InteractiveSignatureOverlay.tsx exact coordinates:
  // right: 12px relative to applicant row right edge, top: -16px relative to row top,
  // img h-14 (56px), max-w-[165px], wrapped in p-1.5 (6px padding), transform translate(x,y) scale(scale)
  if (sigImg) {
    const natW = sigImg.naturalWidth || sigImg.width || 140;
    const natH = sigImg.naturalHeight || sigImg.height || 56;
    const baseImgH = 56;
    const baseImgW = Math.min(165, Math.max(24, baseImgH * (natW / natH)));

    // Exact fitted draw size inside (baseImgW x baseImgH) for object-contain
    const aspectFitScale = Math.min(baseImgW / natW, baseImgH / natH);
    const drawW = natW * aspectFitScale;
    const drawH = natH * aspectFitScale;

    const pad = 6;
    const boxW = baseImgW + pad * 2;
    const boxH = baseImgH + pad * 2;

    const boxLeft = rightMarginX - 12 - boxW;
    const boxTop = appRowTop - 16;
    const centerX = boxLeft + boxW / 2 + (sigSettings?.x || 0);
    const centerY = boxTop + boxH / 2 + (sigSettings?.y || 0);
    const sc = sigSettings?.scale || 1.0;

    ctx.save();
    ctx.translate(centerX, centerY);
    ctx.scale(sc, sc);
    ctx.drawImage(sigImg, -drawW / 2, -drawH / 2, drawW, drawH);
    ctx.restore();
  }

  // Dynamic Immigration Office Chief Designation
  ctx.fillStyle = '#000000';
  ctx.textAlign = 'left';
  ctx.font = `700 14px ${SERIF}`;
  ctx.fillText(getOfficeChiefTitle(formData.address), PAD_X, appRowTop + 56);

  // ==========================================================
  // 8. OPTIONAL WATERMARK OVERLAY (IF UNPAID)
  // ==========================================================
  if (showWatermark) {
    drawCanvasWatermark(ctx, LOGICAL_W, LOGICAL_H);
  }

  return canvas;
}

/**
 * Renders an attachment image onto a clean A4 Canvas page preserving aspect ratio and
 * drawing crisp Korean header text natively on canvas (avoiding jsPDF's ASCII-only Helvetica font).
 */
async function renderAttachmentImageToA4DataUrl(
  dataUrl: string,
  headerTitle: string
): Promise<string> {
  const img = await loadImageElement(dataUrl);
  if (!img) return await ensureRasterDataUrl(dataUrl);

  try {
    const canvas = document.createElement('canvas');
    canvas.width = 1240;
    canvas.height = 1754; // A4 @ 150 DPI
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return await ensureRasterDataUrl(dataUrl);
    }
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = '#475569';
    ctx.font = '600 22px "Noto Sans KR", "Apple SD Gothic Neo", "Malgun Gothic", sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(headerTitle, 70, 62);

    const maxW = canvas.width - 140;
    const maxH = canvas.height - 140;
    const natW = img.naturalWidth || img.width || maxW;
    const natH = img.naturalHeight || img.height || maxH;
    const scale = Math.min(maxW / natW, maxH / natH);
    const drawW = Math.round(natW * scale);
    const drawH = Math.round(natH * scale);
    const drawX = Math.round((canvas.width - drawW) / 2);
    const drawY = 92 + Math.round((maxH - drawH) / 2);

    ctx.drawImage(img, drawX, drawY, drawW, drawH);
    return canvas.toDataURL('image/jpeg', 0.94);
  } catch {
    return await ensureRasterDataUrl(dataUrl);
  }
}

/**
 * Generates a unified high-resolution multi-page PDF in the strict required sequence:
 * Page 1: 사회통합프로그램 연계 신청서 (Official Form Template - Deterministic Canvas 2D)
 * Page 2: TOPIK 성적증명서 (Official TOPIK Score Report - Vector PDF or Image)
 * Page 3: 외국인등록증 — 앞면 + 뒷면 (Merged ARC on a single page)
 * Page 4+: 여권 (Passport pages, if uploaded)
 */
export async function generateMergedPdf({
  docs,
  formData,
  sigSettings,
  showWatermark = false,
}: GeneratePdfOptions): Promise<MergedPdfResult> {
  const mergedPdfDoc = await PDFDocument.create();

  // ==========================================
  // PAGE 1: 사회통합프로그램 연계 신청서 Template (Direct High-DPI Canvas 2D)
  // ==========================================
  const formCanvas = await renderOfficialFormToCanvas({
    formData,
    docs,
    sigSettings,
    showWatermark,
  });
  const formImgData = formCanvas.toDataURL('image/jpeg', 0.96);

  const formJsPdf = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
    compress: true,
  });
  formJsPdf.addImage(formImgData, 'JPEG', 0, 0, 210, 297, undefined, 'FAST');

  const formPdfBytes = formJsPdf.output('arraybuffer');
  const formPdfDoc = await PDFDocument.load(formPdfBytes);
  const [copiedFormPage] = await mergedPdfDoc.copyPages(formPdfDoc, [0]);
  mergedPdfDoc.addPage(copiedFormPage);

  // ==========================================
  // PAGE 2: TOPIK 성적증명서
  // ==========================================
  if (docs.topikCertList && docs.topikCertList.length > 0) {
    for (let i = 0; i < docs.topikCertList.length; i++) {
      const topikItem = docs.topikCertList[i];
      if (!topikItem?.dataUrl) continue;

      if (isPdfDataUrl(topikItem.dataUrl)) {
        try {
          const topikBytes = dataUrlToUint8Array(topikItem.dataUrl);
          const topikDoc = await PDFDocument.load(topikBytes, { ignoreEncryption: true });
          const indices = topikDoc.getPageIndices();
          const copiedPages = await mergedPdfDoc.copyPages(topikDoc, indices);
          for (const page of copiedPages) {
            mergedPdfDoc.addPage(page);
          }
        } catch (err) {
          console.error('Failed to parse uploaded TOPIK PDF with pdf-lib:', err);
          const fallbackJsPdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
          fallbackJsPdf.setFontSize(12);
          fallbackJsPdf.setTextColor(15, 23, 42);
          fallbackJsPdf.text(
            `[Attachment 1] TOPIK Score Report - ${formData.name || 'Applicant'}`,
            15,
            15
          );
          fallbackJsPdf.setFontSize(10);
          fallbackJsPdf.setTextColor(100, 116, 139);
          fallbackJsPdf.text(`(File: ${topikItem.name || 'topik_certificate.pdf'})`, 15, 25);
          const fbBytes = fallbackJsPdf.output('arraybuffer');
          const fbDoc = await PDFDocument.load(fbBytes);
          const [fbPage] = await mergedPdfDoc.copyPages(fbDoc, [0]);
          mergedPdfDoc.addPage(fbPage);
        }
      } else {
        const pageDataUrl = await renderAttachmentImageToA4DataUrl(
          topikItem.dataUrl,
          `[첨부 1] 한국어능력시험(TOPIK) 성적증명서 사본 — ${formData.name || '신청인'}`
        );
        const topikJsPdf = new jsPDF({
          orientation: 'portrait',
          unit: 'mm',
          format: 'a4',
          compress: true,
        });
        topikJsPdf.addImage(pageDataUrl, 'JPEG', 0, 0, 210, 297, undefined, 'FAST');

        const tBytes = topikJsPdf.output('arraybuffer');
        const tDoc = await PDFDocument.load(tBytes);
        const [tPage] = await mergedPdfDoc.copyPages(tDoc, [0]);
        mergedPdfDoc.addPage(tPage);
      }
    }
  }

  // ==========================================
  // PAGE 3: 외국인등록증 (앞면 + 뒷면 Merged on 1 Page)
  // ==========================================
  if (docs.arcFront && docs.arcBack) {
    const mergedArcDataUrl = await mergeArcFrontAndBack(
      docs.arcFront,
      docs.arcBack,
      formData.name
    );

    const arcJsPdf = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4',
      compress: true,
    });
    arcJsPdf.addImage(mergedArcDataUrl, 'JPEG', 0, 0, 210, 297, undefined, 'FAST');

    const arcBytes = arcJsPdf.output('arraybuffer');
    const arcDoc = await PDFDocument.load(arcBytes);
    const [arcPage] = await mergedPdfDoc.copyPages(arcDoc, [0]);
    mergedPdfDoc.addPage(arcPage);
  } else if (docs.arcFront) {
    const pageDataUrl = await renderAttachmentImageToA4DataUrl(
      docs.arcFront,
      `[첨부 2] 외국인등록증 사본 — ${formData.name || '신청인'}`
    );
    const arcJsPdf = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4',
      compress: true,
    });
    arcJsPdf.addImage(pageDataUrl, 'JPEG', 0, 0, 210, 297, undefined, 'FAST');

    const arcBytes = arcJsPdf.output('arraybuffer');
    const arcDoc = await PDFDocument.load(arcBytes);
    const [arcPage] = await mergedPdfDoc.copyPages(arcDoc, [0]);
    mergedPdfDoc.addPage(arcPage);
  }

  // ==========================================
  // PAGE 4+: 여권 (Passport pages if uploaded)
  // ==========================================
  if (docs.passportList && docs.passportList.length > 0) {
    for (let i = 0; i < docs.passportList.length; i++) {
      const pass = docs.passportList[i];
      if (!pass?.dataUrl) continue;

      if (isPdfDataUrl(pass.dataUrl)) {
        try {
          const passBytes = dataUrlToUint8Array(pass.dataUrl);
          const passDoc = await PDFDocument.load(passBytes, { ignoreEncryption: true });
          const indices = passDoc.getPageIndices();
          const copiedPages = await mergedPdfDoc.copyPages(passDoc, indices);
          for (const page of copiedPages) {
            mergedPdfDoc.addPage(page);
          }
        } catch (err) {
          console.error('Failed to parse uploaded Passport PDF with pdf-lib:', err);
        }
      } else {
        const pageDataUrl = await renderAttachmentImageToA4DataUrl(
          pass.dataUrl,
          `[첨부 3] 여권 사본 (${i + 1}/${docs.passportList.length}) — ${formData.name || '신청인'}`
        );
        const passJsPdf = new jsPDF({
          orientation: 'portrait',
          unit: 'mm',
          format: 'a4',
          compress: true,
        });
        passJsPdf.addImage(pageDataUrl, 'JPEG', 0, 0, 210, 297, undefined, 'FAST');

        const pBytes = passJsPdf.output('arraybuffer');
        const pDoc = await PDFDocument.load(pBytes);
        const [pPage] = await mergedPdfDoc.copyPages(pDoc, [0]);
        mergedPdfDoc.addPage(pPage);
      }
    }
  }

  const mergedBytes = await mergedPdfDoc.save();
  const createBlob = () => new Blob([mergedBytes.buffer as ArrayBuffer], { type: 'application/pdf' });

  return {
    output(type?: string): any {
      if (type === 'arraybuffer') {
        return mergedBytes.buffer;
      }
      return createBlob();
    },
    save(filename: string) {
      const blob = createBlob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        try {
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
        } catch {}
      }, 2000);
    },
    getBlob() {
      return createBlob();
    },
    getBytes() {
      return mergedBytes;
    },
  };
}

/**
 * Generates a single-page high-resolution PDF of only the official application form template
 */
export async function generateSingleFormPdf({
  formData,
  docs,
  sigSettings,
  showWatermark = false,
}: {
  formData: ApplicationFormData;
  docs: UploadedDocuments;
  sigSettings?: SignatureSettings;
  showWatermark?: boolean;
}): Promise<jsPDF> {
  const pdf = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
    compress: true,
  });

  const formCanvas = await renderOfficialFormToCanvas({
    formData,
    docs,
    sigSettings,
    showWatermark,
  });
  const formImgData = formCanvas.toDataURL('image/jpeg', 0.96);
  pdf.addImage(formImgData, 'JPEG', 0, 0, 210, 297, undefined, 'FAST');
  return pdf;
}

export interface DownloadResult {
  blob: Blob;
  blobUrl: string;
  filename: string;
  sharedViaWebShare: boolean;
}

/**
 * Detects if the current user agent is on a mobile device or tablet.
 */
export function isMobileBrowser(): boolean {
  if (typeof navigator === 'undefined') return false;
  return (
    /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ||
    (Boolean(navigator.maxTouchPoints) && navigator.maxTouchPoints > 2)
  );
}

/**
 * Detects if the current device is iOS (iPhone/iPad/iPod).
 */
export function isIOSDevice(): boolean {
  if (typeof navigator === 'undefined') return false;
  return (
    /iPhone|iPad|iPod/i.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && Boolean(navigator.maxTouchPoints) && navigator.maxTouchPoints > 1)
  );
}

/**
 * Downloads or shares the generated PDF.
 * Fully compatible with Mobile (iOS Safari, Android Chrome) using direct link triggers
 * and leaving blob URLs active for modal save/share interactions.
 */
export async function downloadPdfFile(
  pdf: jsPDF | MergedPdfResult | any,
  applicantName: string
): Promise<DownloadResult> {
  const safeName = (applicantName || '신청인').replace(/[^a-zA-Z0-9가-힣]/g, '_');
  const filename = `사회통합프로그램_연계신청서_통합서류_${safeName}.pdf`;

  const blob: Blob =
    typeof pdf?.getBlob === 'function'
      ? pdf.getBlob()
      : typeof pdf?.output === 'function'
      ? (pdf.output('blob') as Blob)
      : new Blob([pdf], { type: 'application/pdf' });

  const blobUrl = URL.createObjectURL(blob);
  const sharedViaWebShare = false;
  const isIOS = isIOSDevice();

  try {
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = filename;
    a.rel = 'noopener noreferrer';

    if (isIOS) {
      try {
        window.open(blobUrl, '_blank');
      } catch (err) {
        console.warn('iOS window.open error:', err);
      }
    } else {
      a.target = '_blank';
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        try {
          document.body.removeChild(a);
        } catch {}
      }, 3000);
    }
  } catch (err) {
    console.warn('Auto download error, user can still use manual button:', err);
    if (typeof pdf?.save === 'function') {
      try {
        pdf.save(filename);
      } catch {}
    }
  }

  return { blob, blobUrl, filename, sharedViaWebShare };
}

/**
 * Downloads only the single-page application form.
 */
export async function downloadSingleFormPdf(
  pdf: jsPDF | MergedPdfResult | any,
  applicantName: string
): Promise<DownloadResult> {
  const safeName = (applicantName || '신청인').replace(/[^a-zA-Z0-9가-힣]/g, '_');
  const filename = `사회통합프로그램_연계신청서_단독본문_${safeName}.pdf`;

  const blob: Blob =
    typeof pdf?.getBlob === 'function'
      ? pdf.getBlob()
      : typeof pdf?.output === 'function'
      ? (pdf.output('blob') as Blob)
      : new Blob([pdf], { type: 'application/pdf' });

  const blobUrl = URL.createObjectURL(blob);
  let sharedViaWebShare = false;

  if (typeof navigator !== 'undefined' && navigator.share && navigator.canShare) {
    try {
      const file = new File([blob], filename, { type: 'application/pdf' });
      if (navigator.canShare({ files: [file] })) {
        await navigator.share({
          title: filename,
          text: `ពាក្យសុំទម្រង់ផ្លូវការ - ${applicantName || '신청인'}`,
          files: [file],
        });
        sharedViaWebShare = true;
      }
    } catch (e: any) {
      if (e && e.name !== 'AbortError') {
        console.warn('Web Share API error:', e);
      }
    }
  }

  if (!sharedViaWebShare) {
    try {
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = filename;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        try {
          document.body.removeChild(a);
        } catch {}
      }, 2000);
    } catch {
      if (typeof pdf?.save === 'function') {
        pdf.save(filename);
      }
    }
  }

  return { blob, blobUrl, filename, sharedViaWebShare };
}
