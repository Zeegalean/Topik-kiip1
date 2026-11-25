import crypto from 'crypto';
import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';

export interface KoreanBankPaymentInfo {
  bankName: string;
  accountNumber: string;
  accountHolder: string;
}

export interface KoreanReceiptChecks {
  isReceipt: boolean;
  recipientMatched: boolean;
  amountMatched: boolean;
  statusSuccess: boolean;
  timeVerified: boolean;
}

export interface KoreanReceiptAnalysisResult {
  isValidReceipt: boolean;
  verdict: 'ពិត' | 'មិនពិត';
  amountKrw: number;
  bankName: string;
  recipientName: string;
  senderName?: string;
  statusText: string;
  transferTimestamp: string;
  transferFingerprint: string;
  transferCompleted: boolean;
  checks: KoreanReceiptChecks;
  reason: string;
  httpStatus?: number;
  modelUsed?: string;
}

let sharedAiClient: GoogleGenAI | null = null;

function getSharedAiClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) return null;
  if (!sharedAiClient) {
    sharedAiClient = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
  }
  return sharedAiClient;
}

export function getKoreaBankPaymentInfo(): KoreanBankPaymentInfo {
  return {
    bankName: process.env.KR_BANK_NAME || 'KOOKMIN BANK (KB 국민은행)',
    accountNumber: process.env.KR_BANK_ACCOUNT || '893801-00-097236',
    accountHolder: process.env.KR_BANK_HOLDER || 'EANG VEASNA',
  };
}

export function getCurrentKstInfo(): { nowMs: number; kstYear: number; kstMonth: number; kstDay: number; kstDateTimeLabel: string } {
  const nowMs = Date.now();
  const kst = new Date(nowMs + 9 * 60 * 60 * 1000);
  const kstYear = kst.getUTCFullYear();
  const kstMonth = kst.getUTCMonth() + 1;
  const kstDay = kst.getUTCDate();
  const mm = String(kstMonth).padStart(2, '0');
  const dd = String(kstDay).padStart(2, '0');
  const hh = String(kst.getUTCHours()).padStart(2, '0');
  const mi = String(kst.getUTCMinutes()).padStart(2, '0');
  return {
    nowMs,
    kstYear,
    kstMonth,
    kstDay,
    kstDateTimeLabel: `${kstYear}-${mm}-${dd} ${hh}:${mi} KST`,
  };
}

export function parseKstTimestampFromReceipt(
  dateIsoRaw: string,
  time24hRaw: string,
  rawText: string
): { valid: boolean; utcMs: number | null; displayLabel: string; fingerprintPart: string; hasTime: boolean } {
  const cleanDateIso = String(dateIsoRaw || '').trim();
  const cleanTime24h = String(time24hRaw || '').trim();
  const combinedRaw = String(rawText || '').trim();
  const { kstYear, kstMonth, kstDay } = getCurrentKstInfo();

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
    const rawFullDate = combinedRaw.match(/(20\d{2})[.\-/년\s]+(\d{1,2})[.\-/월\s]+(\d{1,2})/);
    if (rawFullDate) {
      year = Number(rawFullDate[1]);
      month = Number(rawFullDate[2]);
      day = Number(rawFullDate[3]);
    } else {
      const rawShortYear = combinedRaw.match(/\b(2[3-9])[.\-/](\d{1,2})[.\-/](\d{1,2})\b/);
      if (rawShortYear) {
        year = 2000 + Number(rawShortYear[1]);
        month = Number(rawShortYear[2]);
        day = Number(rawShortYear[3]);
      } else {
        // Common Toss / KakaoBank format without year: "11월 25일" or "11.25" or "오늘"
        const krMonthDay = combinedRaw.match(/(\d{1,2})\s*월\s*(\d{1,2})\s*일/);
        const dotMonthDay = combinedRaw.match(/(?:^|\s)(\d{1,2})[./-](\d{1,2})(?:\s|$|\()/);
        if (krMonthDay) {
          year = kstYear;
          month = Number(krMonthDay[1]);
          day = Number(krMonthDay[2]);
        } else if (dotMonthDay) {
          year = kstYear;
          month = Number(dotMonthDay[1]);
          day = Number(dotMonthDay[2]);
        } else if (/오늘|today/i.test(combinedRaw)) {
          year = kstYear;
          month = kstMonth;
          day = kstDay;
        }
      }
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

  // Date only (no HH:MM shown) — interpret as midday KST for freshness window check
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

export function matchesExpectedKoreanRecipient(params: {
  recipientName: string;
  accountDigits: string;
  expectedHolder: string;
  expectedAccountDigits: string;
}): boolean {
  const { recipientName, accountDigits, expectedHolder, expectedAccountDigits } = params;
  const expectedTail4 = expectedAccountDigits.slice(-4);
  const expectedTail6 = expectedAccountDigits.slice(-6);
  const expectedPrefix6 = expectedAccountDigits.slice(0, 6);

  // If account digits are clearly visible (>= 6 digits) and do NOT match the expected account prefix/suffix/substring, reject
  if (expectedAccountDigits.length >= 6 && accountDigits.length >= 6) {
    const matchesAnySegment =
      expectedAccountDigits.includes(accountDigits) ||
      accountDigits.includes(expectedAccountDigits) ||
      (expectedTail4 && accountDigits.endsWith(expectedTail4)) ||
      (expectedPrefix6 && accountDigits.startsWith(expectedPrefix6));
    if (!matchesAnySegment) {
      return false;
    }
  } else if (expectedTail4 && accountDigits.length >= 4 && !expectedAccountDigits.includes(accountDigits)) {
    return false;
  }

  const accountConfirmedStrong = Boolean(
    (expectedTail6 && accountDigits.endsWith(expectedTail6)) ||
      (accountDigits.length >= 8 && expectedAccountDigits.includes(accountDigits))
  );
  const accountConfirmedPartial = Boolean(
    (expectedTail4 && accountDigits.endsWith(expectedTail4)) ||
      (expectedPrefix6 && accountDigits.startsWith(expectedPrefix6))
  );

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
    ? ['이앙베아스나', '응베아스나', '에앙베아스나', '앙베아스나', '베아스나', '이앙', '에앙']
    : [];

  let nameMatched = false;
  if (compactRecipient && compactExpected) {
    if (
      compactRecipient.includes(compactExpected) ||
      (compactExpected.includes(compactRecipient) && compactRecipient.length >= 5)
    ) {
      nameMatched = true;
    } else if (expectedTokens.length >= 2) {
      const matchedTokens = expectedTokens.filter((tok) => compactRecipient.includes(tok));
      if (matchedTokens.length >= 2) {
        nameMatched = true;
      } else if (matchedTokens.length === 1 && accountConfirmedPartial) {
        // Masked display like "EANG***" paired with matching account digits
        nameMatched = true;
      }
    } else if (expectedTokens.length === 1 && compactRecipient.includes(expectedTokens[0])) {
      nameMatched = true;
    }
  }

  if (!nameMatched && compactRecipient) {
    if (koreanAliases.slice(0, 5).some((alias) => compactRecipient.includes(alias))) {
      nameMatched = true;
    } else if (accountConfirmedPartial && koreanAliases.some((alias) => compactRecipient.includes(alias))) {
      nameMatched = true;
    }
  }

  if (nameMatched) return true;
  if (accountConfirmedStrong && !cleanRecipient) return true;
  return false;
}

function formatGeminiError(err: any): string {
  const msg = typeof err?.message === 'string' ? err.message : JSON.stringify(err || '');
  const causeCode = err?.cause?.code ? ` (${err.cause.code})` : '';
  return `${msg}${causeCode}`;
}

function isTransientError(err: any): boolean {
  const msg = formatGeminiError(err).toLowerCase();
  return (
    msg.includes('503') ||
    msg.includes('unavailable') ||
    msg.includes('high demand') ||
    msg.includes('overloaded') ||
    msg.includes('temporarily') ||
    msg.includes('fetch failed') ||
    msg.includes('econnreset') ||
    msg.includes('etimedout') ||
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

function isQuotaError(err: any): boolean {
  const msg = formatGeminiError(err).toUpperCase();
  return msg.includes('RESOURCE_EXHAUSTED') || msg.includes('429') || msg.includes('QUOTA');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function analyzeKoreanBankReceiptWithGemini(
  imageBase64: string,
  rawMimeType: string,
  lang = 'km',
  aiOverride?: GoogleGenAI | null
): Promise<KoreanReceiptAnalysisResult> {
  const emptyChecks: KoreanReceiptChecks = {
    isReceipt: false,
    recipientMatched: false,
    amountMatched: false,
    statusSuccess: false,
    timeVerified: false,
  };

  const ai = aiOverride ?? getSharedAiClient();
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
      httpStatus: 503,
      reason:
        lang === 'ko'
          ? '서버에 자동 영수증 검증용 GEMINI_API_KEY가 설정되어 있지 않습니다.'
          : lang === 'en'
          ? 'GEMINI_API_KEY is not configured on the server for automated receipt inspection.'
          : 'ម៉ាស៊ីនមេមិនទាន់កំណត់ GEMINI_API_KEY សម្រាប់ផ្ទៀងផ្ទាត់វិក្កយបត្រដោយស្វ័យប្រវត្តិទេ។',
    };
  }

  const normalizedMime = rawMimeType.toLowerCase() === 'image/jpg' ? 'image/jpeg' : rawMimeType.toLowerCase();
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
8. senderName: exact sender / depositor name visible on the receipt if shown (보내는분 / 출금계좌 예금주 / 송금인 / 내 통장 표시). Return "" if not visible.
9. transferDateTimeRaw: exact transfer date and time string visible on the screenshot (거래일시 / 이체일시 / 송금일시). Return "" if not visible.
10. transferDateIso: normalized transfer date in "YYYY-MM-DD" (KST). If year is omitted on the receipt (e.g. "11월 25일"), infer current KST year from ${kstDateTimeLabel}. Return "" if date is not visible.
11. transferTime24h: normalized transfer time in 24-hour "HH:MM" (KST). Return "" if time is not visible.
12. verdictKhmer: return "ពិត" ONLY if ALL conditions are clearly satisfied (genuine completed bank transfer + recipient matches "${expectedHolder}" + amount >= 35000 + valid transfer date/time visible); otherwise return "មិនពិត".

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
      senderName: { type: Type.STRING },
      transferDateTimeRaw: { type: Type.STRING },
      transferDateIso: { type: Type.STRING },
      transferTime24h: { type: Type.STRING },
      verdictKhmer: { type: Type.STRING },
    },
  };

  let authErrorDetected = false;
  let quotaErrorDetected = false;
  let lastErrorMsg = '';

  for (const model of ['gemini-4-hydrogen', 'gemini-3.1-flash-lite'] as const) {
    const maxAttempts = 2;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 20000);
      try {
        const config: any = {
          responseMimeType: 'application/json',
          responseSchema: schema,
          abortSignal: controller.signal,
        };
        if (model === 'gemini-4-hydrogen') {
          config.thinkingConfig = { thinkingLevel: ThinkingLevel.LOW };
        }

        const response = await ai.models.generateContent({
          model,
          contents: {
            parts: [
              { inlineData: { mimeType: normalizedMime, data: imageBase64 } },
              { text: prompt },
            ],
          },
          config,
        });
        clearTimeout(timeoutId);

        const text = response.text;
        if (!text) {
          lastErrorMsg = `Empty response from ${model}`;
          continue;
        }
        const parsed = JSON.parse(text.replace(/```json/gi, '').replace(/```/g, '').trim());

        const isReceipt = Boolean(parsed.isBankTransferScreenshot);
        const statusSuccess = Boolean(parsed.transferCompleted);
        const statusText = String(parsed.statusText || (statusSuccess ? '이체완료' : '')).slice(0, 60);
        const amountKrw = Math.round(Number(parsed.amountKrw) || 0);
        const amountMatched = amountKrw >= 35000;
        const bankName = String(parsed.bankName || 'Korea Bank').slice(0, 60);
        const recipientName = String(parsed.recipientName || '').trim().slice(0, 100);
        const senderName = String(parsed.senderName || '').trim().slice(0, 100);
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
        const futureToleranceMs = 20 * 60 * 1000;
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
            modelUsed: model,
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
            modelUsed: model,
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
            modelUsed: model,
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
            modelUsed: model,
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
            modelUsed: model,
            reason: timeFailureReason,
          };
        }

        return {
          isValidReceipt: true,
          verdict: 'ពិត',
          amountKrw,
          bankName,
          recipientName: recipientName || expectedHolder,
          senderName,
          statusText: statusText || '이체완료',
          transferTimestamp,
          transferFingerprint,
          transferCompleted: true,
          checks,
          modelUsed: model,
          reason: 'ពិត (Verified)',
        };
      } catch (err: any) {
        lastErrorMsg = formatGeminiError(err);
        console.error(`[KR Receipt] Gemini model '${model}' attempt ${attempt} failed:`, lastErrorMsg);
        if (isAuthOrKeyError(err)) {
          authErrorDetected = true;
          break;
        }
        if (isQuotaError(err)) {
          quotaErrorDetected = true;
        }
        if (isTransientError(err) && attempt < maxAttempts) {
          await sleep(600 * attempt);
          continue;
        }
        break;
      } finally {
        clearTimeout(timeoutId);
      }
    }
    if (authErrorDetected) break;
  }

  if (authErrorDetected) {
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
      httpStatus: 503,
      reason:
        lang === 'ko'
          ? '서버의 GEMINI_API_KEY가 유효하지 않습니다. 환경 변수(Settings > Secrets)를 확인해 주세요.'
          : lang === 'en'
          ? 'Server GEMINI_API_KEY is invalid or lacks permission. Please verify GEMINI_API_KEY in server environment variables.'
          : 'GEMINI_API_KEY នៅលើម៉ាស៊ីនមេមិនត្រឹមត្រូវ ឬគ្មានសិទ្ធិប្រើប្រាស់។ សូមពិនិត្យការកំណត់ GEMINI_API_KEY លើម៉ាស៊ីនមេ!',
    };
  }

  if (quotaErrorDetected) {
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
      httpStatus: 429,
      reason:
        lang === 'ko'
          ? 'AI 검증 요청 한도를 초과했습니다. 잠시 후 다시 시도하거나 아래 채널로 스크린샷을 보내 주세요.'
          : lang === 'en'
          ? 'AI verification quota temporarily reached. Please try again in a moment or send your screenshot below.'
          : 'ប្រព័ន្ធ AI កំពុងមានអ្នកប្រើប្រាស់ច្រើនពេក (Quota Limit)។ សូមរង់ចាំបន្តិចរួចព្យាយាមម្តងទៀត!',
    };
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
    httpStatus: 422,
    reason:
      lang === 'ko'
        ? `영수증 이미지를 판독할 수 없습니다. 선명한 PNG/JPG 스크린샷으로 다시 시도해 주세요.${lastErrorMsg ? '' : ''}`
        : lang === 'en'
        ? 'Could not read the receipt image clearly. Please upload a sharper PNG/JPG screenshot.'
        : 'មិនអាចអានរូបភាពវិក្កយបត្របានច្បាស់នៅពេលនេះទេ។ សូមព្យាយាមម្តងទៀតជាមួយរូបភាព Screenshot ច្បាស់!',
  };
}

function getStatelessCodeSecret(): string {
  return (
    process.env.ADMIN_SESSION_SECRET ||
    process.env.GEMINI_API_KEY ||
    'kiip-kr-receipt-stateless-fallback-key'
  );
}

/**
 * Generates an HMAC-signed paid Redeem Code for serverless platforms (e.g., Vercel)
 * where a persistent local SQLite database is unavailable across invocations.
 * Format: KIIP-KR-<6HEX>-<6SIG>
 */
export function createSignedPaidRedeemCode(seed: string): string {
  const nonce = crypto
    .createHash('sha256')
    .update(`${seed}:${Date.now()}:${crypto.randomBytes(4).toString('hex')}`)
    .digest('hex')
    .slice(0, 6)
    .toUpperCase();
  const sig = crypto
    .createHmac('sha256', getStatelessCodeSecret())
    .update(`KIIP-KR-${nonce}`)
    .digest('hex')
    .slice(0, 6)
    .toUpperCase();
  return `KIIP-KR-${nonce}-${sig}`;
}

export function verifySignedPaidRedeemCode(rawCode: string): boolean {
  const clean = String(rawCode || '')
    .trim()
    .toUpperCase();
  const match = clean.match(/^KIIP-KR-([A-F0-9]{6})-([A-F0-9]{6})$/);
  if (!match) return false;
  const expectedSig = crypto
    .createHmac('sha256', getStatelessCodeSecret())
    .update(`KIIP-KR-${match[1]}`)
    .digest('hex')
    .slice(0, 6)
    .toUpperCase();
  const a = Buffer.from(match[2], 'utf8');
  const b = Buffer.from(expectedSig, 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
