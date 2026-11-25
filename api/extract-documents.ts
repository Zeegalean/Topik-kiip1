import dns from 'dns';
import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import { parseStructuredTextCorpus, parseFlexibleDate } from '../src/server/serverOcr.ts';

dns.setDefaultResultOrder('ipv4first');

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

function sanitizeExtractedData(raw: any): Record<string, any> {
  const result: Record<string, any> = {};

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

  if (raw?.examNumber) {
    const rawExam = String(raw.examNumber).replace(/[^0-9]/g, '');
    if (rawExam.length >= 6 && !/^0+$/.test(rawExam)) {
      result.examNumber = rawExam;
    }
  }

  if (raw?.round) {
    const rawRound = String(raw.round).replace(/[^0-9]/g, '');
    const roundNum = parseInt(rawRound, 10);
    if (rawRound && !/^0+$/.test(rawRound) && roundNum >= 1 && roundNum <= 300) {
      result.round = String(roundNum);
    }
  }

  if (raw?.grade) {
    const gradeMatch = String(raw.grade).match(/([1-6])\s*급?/);
    if (gradeMatch) {
      result.grade = `${gradeMatch[1]}급`;
    }
  }

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

  if (raw?.nationality && String(raw.nationality).trim().length >= 2) {
    result.nationality = String(raw.nationality).trim();
  }
  if (raw?.address && String(raw.address).trim().length >= 5 && !String(raw.address).startsWith('00000')) {
    result.address = String(raw.address).trim();
  }
  if (raw?.examDate && !String(raw.examDate).startsWith('0000')) {
    const parsedExamDate = parseFlexibleDate(String(raw.examDate), 2012, 2035);
    if (parsedExamDate) {
      result.examDate = parsedExamDate;
    }
  }
  if (raw?.validUntil && !String(raw.validUntil).startsWith('0000')) {
    const validRaw = String(raw.validUntil);
    const rangeParts = validRaw.split(/[~～〜]/);
    const candidate = rangeParts.length >= 2 ? rangeParts[rangeParts.length - 1] : validRaw;
    const parsedValid = parseFlexibleDate(candidate, 2015, 2040) || parseFlexibleDate(validRaw, 2015, 2040);
    if (parsedValid) {
      result.validUntil = parsedValid;
    }
  }

  if (raw?.passportNo) {
    const rawPass = String(raw.passportNo).replace(/[^A-Za-z0-9]/g, '').toUpperCase().trim();
    if (rawPass.length >= 6) {
      result.passportNo = rawPass;
    }
  }

  if (raw?.passportExpiry) {
    const rawExp = String(raw.passportExpiry).trim();
    const parsedExp = parseFlexibleDate(rawExp, 2018, 2050);
    if (parsedExp) {
      result.passportExpiry = parsedExp;
    } else if (rawExp && !rawExp.startsWith('0000')) {
      result.passportExpiry = rawExp;
    }
  }

  if (raw?.entryDate && !String(raw.entryDate).startsWith('0000')) {
    const parsedEntry = parseFlexibleDate(String(raw.entryDate).trim(), 1995, 2035);
    if (parsedEntry) {
      result.entryDate = parsedEntry;
    }
  }

  return result;
}

async function readJsonBody(req: any): Promise<any> {
  if (req.body && typeof req.body === 'object') {
    return req.body;
  }
  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body);
    } catch {
      return {};
    }
  }
  return await new Promise((resolve) => {
    let raw = '';
    req.on?.('data', (chunk: any) => {
      raw += chunk;
    });
    req.on?.('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        resolve({});
      }
    });
    req.on?.('error', () => resolve({}));
  });
}

export default async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    const body = await readJsonBody(req);
    const { arcFront, arcBack, topikCert, topikCertList, passport, passportList, pdfTexts } = body || {};

    const parts: any[] = [];
    if (pdfTexts && typeof pdfTexts === 'object') {
      for (const [k, v] of Object.entries(pdfTexts)) {
        if (typeof v === 'string' && v.trim()) {
          parts.push({
            text: `[Extracted PDF Digital Text for ${k}]:\n${v.trim().slice(0, 6000)}`,
          });
        }
      }
    }

    const addImagePart = (dataUrl: string, label: string) => {
      if (!dataUrl || typeof dataUrl !== 'string') return;

      if (dataUrl.startsWith('data:image/svg+xml')) {
        let svgContent = '';
        if (dataUrl.includes(';base64,')) {
          const base64Data = dataUrl.split(';base64,')[1];
          svgContent = Buffer.from(base64Data, 'base64').toString('utf-8');
        } else if (dataUrl.includes(',')) {
          svgContent = decodeURIComponent(dataUrl.split(',')[1]);
        }
        if (svgContent) {
          parts.push({
            text: `[Uploaded document SVG representation for ${label}]:\n${svgContent}`,
          });
          return;
        }
      }

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
    if (topikCert) addImagePart(topikCert, 'TOPIK Official Score Report (한국어능력시험 성적증명서)');

    if (Array.isArray(topikCertList) && topikCertList.length > 0) {
      topikCertList.forEach((item: any, idx: number) => {
        const url = typeof item === 'string' ? item : item?.dataUrl;
        if (url && url !== topikCert) {
          addImagePart(url, `TOPIK Score Report Page #${idx + 1}`);
        }
      });
    }

    if (passport) {
      addImagePart(passport, 'Passport Page (여권)');
    } else if (Array.isArray(passportList) && passportList.length > 0) {
      passportList.forEach((item: any, idx: number) => {
        const url = typeof item === 'string' ? item : item?.dataUrl;
        if (url) addImagePart(url, `Passport Page #${idx + 1}`);
      });
    }

    if (parts.length === 0) {
      return res.status(200).json({
        success: false,
        fallbackMode: true,
        notice: 'No document images provided.',
      });
    }

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

    const ai = getAiClient();
    if (!ai) {
      if (Object.keys(parsedFromPdfTexts).length > 0) {
        return res.status(200).json({
          success: true,
          data: parsedFromPdfTexts,
          model: 'pdf-text-parser',
        });
      }
      return res.status(200).json({
        success: false,
        fallbackMode: true,
        notice: 'GEMINI_API_KEY is not configured in Vercel Environment Variables. Using client-side OCR.',
      });
    }

    const extractionPrompt = `
You are an expert OCR and legal document analyst for Korea Immigration Service (출입국관리사무소) and TOPIK (국립국제교육원 한국어능력시험).
Analyze the provided images of Alien Registration Card (외국인등록증), Passport (여권), and TOPIK score certificate (한국어능력시험 성적증명서).

IMPORTANT RULE: ONLY extract values that are ACTUALLY VISIBLE in the provided images. If a specific document or field is not present in the uploaded images, return an empty string "" (or empty array [] for docVerificationNo). NEVER invent, guess, or output placeholder values.

CRITICAL INSTRUCTIONS FOR ALIEN REGISTRATION CARD (외국인등록증) & PASSPORT (여권):
1. name: ONLY the applicant's personal English full name in uppercase (Surname + Given Names, e.g. "EANG VEASNA" or "SOK SRORNG") as printed on the Alien Registration Card ("성명" / "Name"), Passport ("Surname" + "Given Names" or MRZ line without filler "<"), or TOPIK certificate ("성명 / Name in English"). NEVER append or include adjacent country/nationality words or clipped suffixes (such as "CAMBODIA", "CAMBODIAN", "KHM", "IA" clipped from CAMBODIA, "SEX", "M", "F", "COUNTRY", "NAME").
2. regNumber1: 외국인등록번호 front 6 digits (birth date YYMMDD).
3. regNumber2: 외국인등록번호 back 7 digits.
4. gender: "남" (Male) or "여" (Female).
5. nationality: Country/region name in English as printed on the card or passport.
6. visaStatus: 체류자격 Visa code if visible on the card.
7. address: Latest Korean residence address on the back of the card (체류지 / 체류지 변경사항 table). Read EVERY row carefully (including road name 도로명, building number 건물번호, and multi-line wrapped 동/호 details), ignore the printed fine notice ("새로운 체류지... 14일 이내..."), and return ONLY the row with the MOST RECENT 신고일 (Report Date) or bottom-most entered row.
8. passportNo: Passport Number (여권번호 / Passport No.) if a passport is uploaded.
9. passportExpiry: Passport Date of Expiry formatted as YYYY-MM-DD.
10. entryDate: Date of Entry into Korea (입국일 / 입국일자 / Date of Entry / Korean arrival stamp date) formatted as YYYY-MM-DD if visible on the ARC or Passport (otherwise leave empty "").

CRITICAL INSTRUCTIONS FOR TOPIK SCORE CERTIFICATE (한국어능력시험 성적증명서):
1. docVerificationNo: 문서확인번호 (16 digits at top-right header, returned as array of 4 strings of 4 digits each).
2. examNumber: 수험번호 (10 to 16 numeric digits in the table).
3. round: 회 / 회차 / 시행회차 numeric digits ONLY (e.g. from "제 93 회", "107회", or "The 93rd Test" extract "93" or "107").
4. examDate: 시험일 / 시행일 / Test Date formatted STRICTLY as YYYY-MM-DD (NEVER return 생년월일 Birth Date or 발급일 Issue Date).
5. validUntil: 성적유효기간 / Valid Until formatted STRICTLY as YYYY-MM-DD. If printed as a range like "2024.05.30 ~ 2026.05.30", ALWAYS return the END/EXPIRATION date ("2026-05-30").
6. grade: 등급 (1급, 2급, 3급, 4급, 5급, or 6급).

CRITICAL INSTRUCTIONS FOR CONFIDENCE SCORING (fieldConfidence):
For each field you extract, provide an integer confidence score from 0 to 100 in fieldConfidence based on visual clarity in the document image (95-100 = crystal clear printed text; 75-94 = slightly blurry, small, glare, or angled; 40-74 = uncertain characters, faded ink, or partial occlusion; 0 = field not visible or not present in uploaded documents).

Return ONLY structured JSON according to the schema.
`;

    parts.push({ text: extractionPrompt });

    const candidateModels = ['gemini-3.1-flash-lite', 'gemini-4-hydrogen'] as const;
    let extractedData: any = null;
    let successfulModel = '';
    let lastErrorDetail = '';
    let authErrorDetected = false;

    const responseSchema = {
      type: Type.OBJECT,
      properties: {
        name: { type: Type.STRING },
        regNumber1: { type: Type.STRING },
        regNumber2: { type: Type.STRING },
        gender: { type: Type.STRING },
        nationality: { type: Type.STRING },
        visaStatus: { type: Type.STRING },
        address: {
          type: Type.STRING,
          description: "LATEST residence address (체류지 주소) from ARC back based on most recent 신고일 or bottom-most row.",
        },
        docVerificationNo: {
          type: Type.ARRAY,
          items: { type: Type.STRING },
        },
        examNumber: { type: Type.STRING },
        examDate: { type: Type.STRING, description: "TOPIK 시험일 / 시행일 YYYY-MM-DD (not birth date)" },
        round: { type: Type.STRING, description: "TOPIK 제XX회 / 시행회차 numeric digits only" },
        validUntil: { type: Type.STRING, description: "TOPIK 성적유효기간 END date YYYY-MM-DD" },
        grade: { type: Type.STRING },
        passportNo: { type: Type.STRING },
        passportExpiry: { type: Type.STRING },
        entryDate: { type: Type.STRING, description: "Date of Entry into Korea (입국일 / Entry Date) YYYY-MM-DD if visible" },
        fieldConfidence: {
          type: Type.OBJECT,
          description: "0-100 integer visual legibility confidence per extracted field",
          properties: {
            name: { type: Type.INTEGER },
            regNumber: { type: Type.INTEGER },
            gender: { type: Type.INTEGER },
            nationality: { type: Type.INTEGER },
            visaStatus: { type: Type.INTEGER },
            address: { type: Type.INTEGER },
            docVerificationNo: { type: Type.INTEGER },
            examNumber: { type: Type.INTEGER },
            examDate: { type: Type.INTEGER },
            round: { type: Type.INTEGER },
            validUntil: { type: Type.INTEGER },
            grade: { type: Type.INTEGER },
            passportNo: { type: Type.INTEGER },
            passportExpiry: { type: Type.INTEGER },
            entryDate: { type: Type.INTEGER },
          },
        },
      },
    };

    outer: for (const model of candidateModels) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 9000);
      try {
        const config: any = {
          responseMimeType: 'application/json',
          responseSchema,
          abortSignal: controller.signal,
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
          break outer;
        }
      } catch (err: any) {
        lastErrorDetail = controller.signal.aborted
          ? `Model '${model}' timed out after 9s`
          : formatGeminiError(err);
        if (isAuthOrKeyError(err)) {
          authErrorDetected = true;
          break outer;
        }
      } finally {
        clearTimeout(timeoutId);
      }
    }

    const pdfRawPreview = pdfTexts && typeof pdfTexts === 'object'
      ? Object.entries(pdfTexts)
          .filter(([, v]) => typeof v === 'string' && v.trim())
          .map(([k, v]) => `[${k} PDF Text]\n${String(v).trim()}`)
          .join('\n\n')
          .slice(0, 2000)
      : '';

    if (extractedData) {
      const merged = { ...parsedFromPdfTexts, ...sanitizeExtractedData(extractedData) };
      const rawConf = extractedData?.fieldConfidence;
      const sanitizedConfidence: Record<string, number> = {};
      if (rawConf && typeof rawConf === 'object') {
        for (const [k, v] of Object.entries(rawConf)) {
          const num = Number(v);
          if (Number.isFinite(num)) {
            sanitizedConfidence[k] = Math.max(0, Math.min(100, Math.round(num)));
          }
        }
      }
      if (Object.keys(merged).length > 0) {
        return res.status(200).json({
          success: true,
          data: merged,
          confidence: sanitizedConfidence,
          model: successfulModel,
          ...(pdfRawPreview ? { rawTextPreview: pdfRawPreview } : {}),
        });
      }
    }

    if (Object.keys(parsedFromPdfTexts).length > 0) {
      return res.status(200).json({
        success: true,
        data: parsedFromPdfTexts,
        model: 'pdf-text-parser',
        ...(pdfRawPreview ? { rawTextPreview: pdfRawPreview } : {}),
      });
    }

    return res.status(200).json({
      success: false,
      fallbackMode: true,
      notice: authErrorDetected
        ? 'GEMINI_API_KEY is invalid on Vercel. Using client-side OCR.'
        : 'Using client-side OCR engine.',
      ...(lastErrorDetail ? { detail: lastErrorDetail } : {}),
    });
  } catch (err: any) {
    return res.status(200).json({
      success: false,
      fallbackMode: true,
      notice: 'Using client-side OCR engine.',
      detail: err?.message || 'Unknown error',
    });
  }
}
