import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { fileToDataUrl } from './imageUtils';

if (typeof window !== 'undefined' && pdfjsLib.GlobalWorkerOptions) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
}

export interface PdfExtractionResult {
  text: string;
  imageUrl: string | null;
  pageCount: number;
}

const pdfCache = new Map<string, PdfExtractionResult>();

export function isPdfDataUrl(dataUrl?: string | null): boolean {
  if (!dataUrl || typeof dataUrl !== 'string') return false;
  const head = dataUrl.slice(0, 64).trim().toLowerCase();
  return head.startsWith('data:application/pdf') || head.startsWith('data:application/x-pdf');
}

function decodeBase64DataUrl(dataUrl: string): Uint8Array {
  const commaIdx = dataUrl.indexOf(',');
  const base64 = (commaIdx >= 0 ? dataUrl.slice(commaIdx + 1) : dataUrl).replace(/\s/g, '');
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Extracts digital text (preserving reading order by Y/X coordinates) and
 * rasterizes Page 1 into a crisp JPEG dataUrl using pdfjs-dist.
 */
export async function extractPdfTextAndImageFromDataUrl(
  pdfDataUrl: string,
  maxRenderDim: number = 1700
): Promise<PdfExtractionResult> {
  if (!isPdfDataUrl(pdfDataUrl)) {
    return { text: '', imageUrl: null, pageCount: 0 };
  }

  const cacheKey = `${maxRenderDim}:${pdfDataUrl.length}:${pdfDataUrl.slice(-120)}`;
  const cached = pdfCache.get(cacheKey);
  if (cached) return cached;

  try {
    const bytes = decodeBase64DataUrl(pdfDataUrl);
    const loadingTask = pdfjsLib.getDocument({
      data: bytes,
      verbosity: 0,
      useSystemFonts: true,
    });
    const pdf = await loadingTask.promise;
    const pageCount = pdf.numPages || 1;
    const pagesToRead = Math.min(3, pageCount);
    const allPageTexts: string[] = [];
    let firstPageImageUrl: string | null = null;

    for (let pageNum = 1; pageNum <= pagesToRead; pageNum++) {
      const page = await pdf.getPage(pageNum);

      // 1. Extract structured digital text sorted into visual lines
      try {
        const textContent = await page.getTextContent();
        const items: Array<{ str: string; x: number; y: number }> = [];
        for (const item of textContent.items as any[]) {
          const str = typeof item?.str === 'string' ? item.str : '';
          if (!str.trim()) continue;
          const transform = Array.isArray(item?.transform) ? item.transform : [1, 0, 0, 1, 0, 0];
          items.push({
            str,
            x: Number(transform[4]) || 0,
            y: Number(transform[5]) || 0,
          });
        }

        // Group items on approximately the same baseline Y coordinate
        items.sort((a, b) => {
          if (Math.abs(b.y - a.y) > 4.5) return b.y - a.y;
          return a.x - b.x;
        });

        const lines: Array<{ y: number; parts: Array<{ x: number; str: string }> }> = [];
        for (const it of items) {
          const last = lines[lines.length - 1];
          if (last && Math.abs(last.y - it.y) <= 4.5) {
            last.parts.push({ x: it.x, str: it.str });
          } else {
            lines.push({ y: it.y, parts: [{ x: it.x, str: it.str }] });
          }
        }

        const pageLines = lines.map((line) => {
          line.parts.sort((a, b) => a.x - b.x);
          return line.parts.map((p) => p.str.trim()).join(' ');
        });
        if (pageLines.length > 0) {
          allPageTexts.push(pageLines.join('\n'));
        }
      } catch (textErr) {
        console.warn(`[PDF OCR] Text extraction failed on page ${pageNum}:`, textErr);
      }

      // 2. Render Page 1 as high-res JPEG so scanned PDFs also work with visual OCR & preview thumbnails
      if (pageNum === 1 && typeof document !== 'undefined') {
        try {
          const baseViewport = page.getViewport({ scale: 1 });
          const longest = Math.max(baseViewport.width || 1, baseViewport.height || 1);
          const scale = Math.min(2.6, Math.max(1.4, maxRenderDim / longest));
          const viewport = page.getViewport({ scale });

          const canvas = document.createElement('canvas');
          canvas.width = Math.round(viewport.width);
          canvas.height = Math.round(viewport.height);
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.fillStyle = '#FFFFFF';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            await page.render({
              canvasContext: ctx,
              viewport,
              canvas,
            } as any).promise;
            firstPageImageUrl = canvas.toDataURL('image/jpeg', 0.92);
          }
        } catch (renderErr) {
          console.warn('[PDF OCR] Page 1 render error:', renderErr);
        }
      }
    }

    const result: PdfExtractionResult = {
      text: allPageTexts.join('\n\n').trim(),
      imageUrl: firstPageImageUrl,
      pageCount,
    };
    pdfCache.set(cacheKey, result);
    return result;
  } catch (err) {
    console.warn('[PDF OCR] Failed to parse PDF document:', err);
    return { text: '', imageUrl: null, pageCount: 0 };
  }
}

export interface ProcessedUploadData {
  dataUrl: string;
  name: string;
  isPdf: boolean;
  previewImageUrl: string | null;
  extractedText: string;
}

export async function processUploadedFileToData(file: File): Promise<ProcessedUploadData> {
  const dataUrl = await fileToDataUrl(file);
  const isPdf = isPdfDataUrl(dataUrl) || file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
  if (!isPdf) {
    return {
      dataUrl,
      name: file.name,
      isPdf: false,
      previewImageUrl: null,
      extractedText: '',
    };
  }

  const pdfRes = await extractPdfTextAndImageFromDataUrl(dataUrl);
  return {
    dataUrl,
    name: file.name,
    isPdf: true,
    previewImageUrl: pdfRes.imageUrl,
    extractedText: pdfRes.text,
  };
}
