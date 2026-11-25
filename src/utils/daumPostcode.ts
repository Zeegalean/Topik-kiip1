import {
  KoreanAddressValidationResult,
  normalizeKoreanAddressFormat,
  validateKoreanAddress,
} from './koreanAddressValidator';

/**
 * Official payload returned by Daum / Kakao Postcode Service v2 `oncomplete` callback.
 * Reference: https://postcode.map.daum.net/guide
 */
export interface DaumPostcodeData {
  zonecode: string;
  address: string;
  addressEnglish?: string;
  addressType: 'R' | 'J';
  userSelectedType: 'R' | 'J';
  userLanguageType?: 'K' | 'E';
  roadAddress: string;
  roadAddressEnglish?: string;
  jibunAddress: string;
  jibunAddressEnglish?: string;
  autoRoadAddress?: string;
  autoRoadAddressEnglish?: string;
  autoJibunAddress?: string;
  autoJibunAddressEnglish?: string;
  buildingCode?: string;
  buildingName?: string;
  apartment?: 'Y' | 'N';
  sido?: string;
  sidoEnglish?: string;
  sigungu?: string;
  sigunguEnglish?: string;
  sigunguCode?: string;
  bcode?: string;
  bname?: string;
  bnameEnglish?: string;
  bname1?: string;
  bname2?: string;
  hname?: string;
  query?: string;
  roadname?: string;
  roadnameCode?: string;
}

export interface DaumPostcodeOptions {
  oncomplete: (data: DaumPostcodeData) => void;
  onresize?: (size: { width: number; height: number }) => void;
  onclose?: (state: 'FORCE_CLOSE' | 'COMPLETE_CLOSE') => void;
  width?: string | number;
  height?: string | number;
  animation?: boolean;
  hideMapBtn?: boolean;
  hideEngBtn?: boolean;
  pleaseReadGuide?: number;
  submitMode?: boolean;
  shorthand?: boolean;
}

export interface DaumPostcodeEmbedOptions {
  q?: string;
  autoClose?: boolean;
}

export interface DaumPostcodeInstance {
  embed: (element: HTMLElement, options?: DaumPostcodeEmbedOptions) => void;
  open: (options?: { q?: string; left?: number; top?: number; popupTitle?: string; popupKey?: string; autoClose?: boolean }) => void;
}

declare global {
  interface Window {
    daum?: {
      Postcode: new (options: DaumPostcodeOptions) => DaumPostcodeInstance;
    };
  }
}

export interface FormattedDaumAddress {
  zonecode: string;
  baseRoadAddress: string;
  jibunAddress: string;
  extraRef: string;
  detailAddress: string;
  /** Immigration-office compliant full Korean 체류지 string */
  fullAddress: string;
  validation: KoreanAddressValidationResult;
}

const DAUM_POSTCODE_SCRIPT_SRC =
  'https://t1.daumcdn.net/mapjsapi/bundle/postcode/prod/postcode.v2.js';

let scriptLoadPromise: Promise<void> | null = null;

/**
 * Lazily loads the official Daum Postcode v2 script once per browser session.
 */
export function loadDaumPostcodeScript(timeoutMs = 12000): Promise<void> {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('Window is unavailable'));
  }

  if (window.daum?.Postcode) {
    return Promise.resolve();
  }

  if (scriptLoadPromise) {
    return scriptLoadPromise;
  }

  scriptLoadPromise = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      'script[data-daum-postcode="true"]'
    );

    const timer = window.setTimeout(() => {
      scriptLoadPromise = null;
      reject(new Error('Daum Postcode API timed out while loading.'));
    }, timeoutMs);

    const cleanupAndResolve = () => {
      window.clearTimeout(timer);
      if (window.daum?.Postcode) {
        resolve();
      } else {
        scriptLoadPromise = null;
        reject(new Error('Daum Postcode constructor unavailable after script load.'));
      }
    };

    const cleanupAndReject = () => {
      window.clearTimeout(timer);
      scriptLoadPromise = null;
      reject(new Error('Failed to load Daum Postcode API script.'));
    };

    if (existing) {
      if (window.daum?.Postcode) {
        cleanupAndResolve();
        return;
      }
      existing.addEventListener('load', cleanupAndResolve, { once: true });
      existing.addEventListener('error', cleanupAndReject, { once: true });
      return;
    }

    const script = document.createElement('script');
    script.src = DAUM_POSTCODE_SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.dataset.daumPostcode = 'true';
    script.onload = cleanupAndResolve;
    script.onerror = cleanupAndReject;
    document.head.appendChild(script);
  });

  return scriptLoadPromise;
}

/**
 * Formats a Daum Postcode selection into the canonical Korean Road Name Address (도로명주소)
 * format accepted by South Korean Immigration Offices (출입국·외국인관서) and HiKorea filings.
 */
export function formatDaumAddressForImmigration(
  data: DaumPostcodeData,
  detailAddressRaw = ''
): FormattedDaumAddress {
  // Always prioritize the official Road Name Address (도로명주소) for immigration filings
  const rawBase =
    data.roadAddress ||
    data.autoRoadAddress ||
    data.address ||
    data.jibunAddress ||
    data.autoJibunAddress ||
    '';

  const baseRoadAddress = normalizeKoreanAddressFormat(rawBase);

  const rawJibun = data.jibunAddress || data.autoJibunAddress || '';
  const jibunAddress = rawJibun ? normalizeKoreanAddressFormat(rawJibun) : '';

  // Build standard Road Name Address Act extra reference: (법정동, 공동주택명)
  const extraParts: string[] = [];
  if (data.bname && /[동|로|가]$/.test(data.bname)) {
    extraParts.push(data.bname);
  }
  if (data.buildingName && data.apartment === 'Y') {
    if (!extraParts.includes(data.buildingName)) {
      extraParts.push(data.buildingName);
    }
  }
  const extraRef = extraParts.length > 0 ? `(${extraParts.join(', ')})` : '';

  const detailAddress = detailAddressRaw.trim().replace(/\s+/g, ' ');

  // Official Korean Road Name Address standard:
  // "도로명주소, 상세주소 (법정동, 공동주택명)" or "도로명주소 (법정동)"
  let fullAddress = baseRoadAddress;
  if (detailAddress) {
    fullAddress = extraRef
      ? `${baseRoadAddress}, ${detailAddress} ${extraRef}`
      : `${baseRoadAddress}, ${detailAddress}`;
  } else if (extraRef && !baseRoadAddress.includes(extraRef)) {
    fullAddress = `${baseRoadAddress} ${extraRef}`;
  }

  fullAddress = fullAddress.replace(/\s+/g, ' ').trim();
  const validation = validateKoreanAddress(fullAddress);

  return {
    zonecode: data.zonecode || '',
    baseRoadAddress,
    jibunAddress,
    extraRef,
    detailAddress,
    fullAddress,
    validation,
  };
}
