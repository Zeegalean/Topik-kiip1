import { ImmigrationOffice } from '../types';
import { findOfficeByAddress } from '../data/immigrationOffices';

export interface KoreanAddressCheck {
  id: 'sido' | 'sigungu' | 'roadOrJibun' | 'detail' | 'jurisdiction' | 'formatting';
  label: string;
  ok: boolean;
  severity: 'pass' | 'warn' | 'fail';
  message: string;
}

export interface KoreanAddressValidationResult {
  status: 'valid' | 'needs-review' | 'invalid' | 'empty';
  score: number;
  sido: string | null;
  sigungu: string | null;
  guRequiredCity: string | null;
  suggestedGus: string[];
  hasRoadName: boolean;
  hasBuildingNo: boolean;
  hasJibun: boolean;
  hasDetailUnit: boolean;
  formattedAddress: string | null;
  matchedOffice: ImmigrationOffice | null;
  checks: KoreanAddressCheck[];
}

const SIDO_CANONICAL_RULES: Array<{ canonical: string; patterns: RegExp[] }> = [
  { canonical: '서울특별시', patterns: [/^서울특별시/, /^서울시/, /^서울(?=\s|[가-힣]+구)/] },
  { canonical: '부산광역시', patterns: [/^부산광역시/, /^부산시/, /^부산(?=\s|[가-힣]+구)/] },
  { canonical: '대구광역시', patterns: [/^대구광역시/, /^대구시/, /^대구(?=\s|[가-힣]+구)/] },
  { canonical: '인천광역시', patterns: [/^인천광역시/, /^인천시/, /^인천(?=\s|[가-힣]+구)/] },
  { canonical: '광주광역시', patterns: [/^광주광역시/, /^광주시(?=\s*(?:동구|서구|남구|북구|광산구))/] },
  { canonical: '대전광역시', patterns: [/^대전광역시/, /^대전시/, /^대전(?=\s|[가-힣]+구)/] },
  { canonical: '울산광역시', patterns: [/^울산광역시/, /^울산시/, /^울산(?=\s|[가-힣]+[구군])/] },
  { canonical: '세종특별자치시', patterns: [/^세종특별자치시/, /^세종시/, /^세종(?=\s)/] },
  { canonical: '경기도', patterns: [/^경기도/, /^경기(?=\s|[가-힣]+[시군])/] },
  { canonical: '강원특별자치도', patterns: [/^강원특별자치도/, /^강원도/, /^강원(?=\s|[가-힣]+[시군])/] },
  { canonical: '충청북도', patterns: [/^충청북도/, /^충북(?=\s|[가-힣]+[시군])/] },
  { canonical: '충청남도', patterns: [/^충청남도/, /^충남(?=\s|[가-힣]+[시군])/] },
  { canonical: '전북특별자치도', patterns: [/^전북특별자치도/, /^전라북도/, /^전북(?=\s|[가-힣]+[시군])/] },
  { canonical: '전라남도', patterns: [/^전라남도/, /^전남(?=\s|[가-힣]+[시군])/] },
  { canonical: '경상북도', patterns: [/^경상북도/, /^경북(?=\s|[가-힣]+[시군])/] },
  { canonical: '경상남도', patterns: [/^경상남도/, /^경남(?=\s|[가-힣]+[시군])/] },
  { canonical: '제주특별자치도', patterns: [/^제주특별자치도/, /^제주도/, /^제주(?=\s|[가-힣]+시)/] },
];

// Cities in Korea that formally require an administrative 구 (Gu) in official Immigration filings
export const SUBDIVIDED_CITY_GUS: Record<string, string[]> = {
  수원시: ['장안구', '권선구', '팔달구', '영통구'],
  성남시: ['수정구', '중원구', '분당구'],
  안양시: ['만안구', '동안구'],
  안산시: ['상록구', '단원구'],
  고양시: ['덕양구', '일산동구', '일산서구'],
  용인시: ['처인구', '기흥구', '수지구'],
  천안시: ['동남구', '서북구'],
  청주시: ['상당구', '서원구', '흥덕구', '청원구'],
  전주시: ['완산구', '덕진구'],
  포항시: ['남구', '북구'],
  창원시: ['의창구', '성산구', '마산합포구', '마산회원구', '진해구'],
};

const METRO_SIDOS_WITH_DIRECT_GU = new Set([
  '서울특별시',
  '부산광역시',
  '대구광역시',
  '인천광역시',
  '광주광역시',
  '대전광역시',
  '울산광역시',
]);

/**
 * Normalizes common spacing, abbreviation, and OCR punctuation quirks in Korean addresses.
 */
export function normalizeKoreanAddressFormat(raw: string): string {
  if (!raw || typeof raw !== 'string') return '';
  let s = raw
    .replace(/^\(\d{5}\)\s*/, '') // remove leading postal prefix if accidentally pasted
    .replace(/[·•]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // Expand abbreviated Si/Do prefix at the beginning
  for (const rule of SIDO_CANONICAL_RULES) {
    for (const pat of rule.patterns) {
      if (pat.test(s)) {
        s = s.replace(pat, `${rule.canonical} `);
        break;
      }
    }
  }

  // Insert missing spaces between Korean administrative units only from the leading admin prefix
  s = s
    .replace(
      /^(서울특별시|부산광역시|대구광역시|인천광역시|광주광역시|대전광역시|울산광역시|세종특별자치시|경기도|강원특별자치도|강원도|충청북도|충청남도|전북특별자치도|전라북도|전라남도|경상북도|경상남도|제주특별자치도|제주도)(?=[가-힣])/,
      '$1 '
    )
    .replace(
      /^((?:경기도|강원특별자치도|강원도|충청북도|충청남도|전북특별자치도|전라북도|전라남도|경상북도|경상남도|제주특별자치도|제주도)\s+[가-힣]{1,5}(?:시|군))(?=[가-힣]{1,5}(?:구|읍|면|동))/,
      '$1 '
    )
    .replace(
      /^((?:[가-힣]+(?:특별시|광역시|특별자치도|도)\s+)?(?:[가-힣]{1,5}(?:시|군)\s+)?[가-힣]{1,5}구)(?=[가-힣]{1,6}(?:동|로|길|읍|면))/,
      '$1 '
    )
    .replace(
      /^((?:[가-힣]+(?:도|시|군)\s+){1,2}[가-힣]{1,5}(?:읍|면))(?=[가-힣]{1,6}(?:리|로|길))/,
      '$1 '
    )
    .replace(/([가-힣0-9]+(?:대로|번길|로|길))(?=\d+(?!\d|\s*(?:번길|길)))/g, '$1 ')
    .replace(/(\d+(?:동|층))(?=\d+(?:호|층))/g, '$1 ')
    .replace(/\s*,\s*/g, ', ')
    .replace(/\s+/g, ' ')
    .trim();

  return s;
}

/**
 * Validates a Korean address against administrative district & 출입국 체류지 formatting conventions.
 */
export function validateKoreanAddress(rawAddress: string): KoreanAddressValidationResult {
  const trimmed = (rawAddress || '').trim();
  const isEmpty = !trimmed || /^0+(\s+0+)*$/.test(trimmed) || trimmed === '00000 0000 000';

  if (isEmpty) {
    return {
      status: 'empty',
      score: 0,
      sido: null,
      sigungu: null,
      guRequiredCity: null,
      suggestedGus: [],
      hasRoadName: false,
      hasBuildingNo: false,
      hasJibun: false,
      hasDetailUnit: false,
      formattedAddress: null,
      matchedOffice: null,
      checks: [
        {
          id: 'sido',
          label: '시/도 (Province/Metro)',
          ok: false,
          severity: 'fail',
          message: 'Enter a full Korean address starting with 시/도 (e.g., 경기도, 충청남도, 서울특별시).',
        },
      ],
    };
  }

  const normalized = normalizeKoreanAddressFormat(trimmed);
  const formattedAddress = normalized && normalized !== trimmed ? normalized : null;

  // 1. Detect Si/Do
  let detectedSido: string | null = null;
  for (const rule of SIDO_CANONICAL_RULES) {
    if (normalized.startsWith(rule.canonical)) {
      detectedSido = rule.canonical;
      break;
    }
  }

  // 2. Detect Si/Gun/Gu
  const afterSido = detectedSido ? normalized.slice(detectedSido.length).trim() : normalized;
  let detectedSigungu: string | null = null;
  let guRequiredCity: string | null = null;
  let suggestedGus: string[] = [];

  if (detectedSido === '세종특별자치시') {
    detectedSigungu = '세종특별자치시';
  } else if (detectedSido && METRO_SIDOS_WITH_DIRECT_GU.has(detectedSido)) {
    const metroGuMatch = afterSido.match(/^([가-힣]{1,6}(?:구|군))(?=\s|$)/);
    if (metroGuMatch) {
      detectedSigungu = metroGuMatch[1];
    }
  } else {
    const cityGuMatch = afterSido.match(/^([가-힣]{1,6}(?:시|군))(?:\s+([가-힣]{1,6}구))?/);
    if (cityGuMatch) {
      const city = cityGuMatch[1];
      const gu = cityGuMatch[2];
      if (SUBDIVIDED_CITY_GUS[city]) {
        if (gu && SUBDIVIDED_CITY_GUS[city].includes(gu)) {
          detectedSigungu = `${city} ${gu}`;
        } else if (gu) {
          detectedSigungu = `${city} ${gu}`;
        } else {
          detectedSigungu = city;
          guRequiredCity = city;
          suggestedGus = SUBDIVIDED_CITY_GUS[city];
        }
      } else {
        detectedSigungu = gu ? `${city} ${gu}` : city;
      }
    }
  }

  // 3. Road-name + building number vs Jibun
  const roadMatch = normalized.match(
    /([가-힣0-9]+(?:대로|번길|로|길)(?:\s+\d+(?:번길|길))?)\s+(\d+(?:-\d+)?)(?!\s*(?:번길|길))/
  );
  const roadOnlyMatch = normalized.match(/([가-힣0-9]+(?:대로|번길|로|길)(?:\s+\d+(?:번길|길))?)/);
  const jibunMatch = normalized.match(/([가-힣0-9]+(?:동|리|가))\s*(\d+(?:-\d+)?)(?!\s*(?:동|호|층|번길|길))/);

  const hasRoadName = Boolean(roadOnlyMatch);
  const hasBuildingNo = Boolean(roadMatch);
  const hasJibun = Boolean(jibunMatch);

  // 4. Detail unit (동 / 호 / 층 / 기숙사)
  const hasDetailUnit = /(?:^|[\s,])(?:\d+\s*동|\d+\s*호|B?\d+\s*층|[가-힣A-Za-z0-9]+(?:빌라|아파트|오피스텔|기숙사|원룸|공장|타워|센터|빌딩))/.test(
    normalized
  );

  // 5. Formatting & OCR noise check
  const hasNoise =
    /[0]{5}/.test(trimmed) ||
    /신고일|변경사항|시·군·구|출입국|범칙금/.test(trimmed) ||
    /[A-Za-z]{4,}/.test(trimmed.replace(/\b(?:apt|dong|ho)\b/gi, '')) ||
    /\s{2,}/.test(trimmed);

  // 6. Jurisdiction office check
  const matchedOffice = findOfficeByAddress(normalized);

  const checks: KoreanAddressCheck[] = [];

  // Check 1: Si/Do
  if (detectedSido) {
    checks.push({
      id: 'sido',
      label: '시/도 (Province / Metro City)',
      ok: true,
      severity: 'pass',
      message: `${detectedSido} verified`,
    });
  } else {
    checks.push({
      id: 'sido',
      label: '시/도 (Province / Metro City)',
      ok: false,
      severity: 'fail',
      message: 'Missing standard 시/도 prefix (e.g., 경기도, 충청남도, 서울특별시).',
    });
  }

  // Check 2: Si/Gun/Gu
  if (guRequiredCity) {
    checks.push({
      id: 'sigungu',
      label: '시/군/구 (Local District)',
      ok: false,
      severity: 'warn',
      message: `${guRequiredCity} requires its administrative 구 (${suggestedGus.join(', ')}).`,
    });
  } else if (detectedSigungu) {
    checks.push({
      id: 'sigungu',
      label: '시/군/구 (Local District)',
      ok: true,
      severity: 'pass',
      message: `${detectedSigungu} verified`,
    });
  } else {
    checks.push({
      id: 'sigungu',
      label: '시/군/구 (Local District)',
      ok: false,
      severity: 'fail',
      message: 'Missing 시/군/구 district (e.g., 단원구, 화성시, 서산시).',
    });
  }

  // Check 3: Road Name + Building Number
  if (hasRoadName && hasBuildingNo) {
    checks.push({
      id: 'roadOrJibun',
      label: '도로명 + 건물번호 (Road Address)',
      ok: true,
      severity: 'pass',
      message: `Valid road-name format (${roadMatch![1]} ${roadMatch![2]}).`,
    });
  } else if (hasJibun) {
    checks.push({
      id: 'roadOrJibun',
      label: '도로명 + 건물번호 (Road Address)',
      ok: true,
      severity: 'warn',
      message: `Jibun format detected (${jibunMatch![1]} ${jibunMatch![2]}). Immigration prefers 도로명주소 if available.`,
    });
  } else if (hasRoadName) {
    checks.push({
      id: 'roadOrJibun',
      label: '도로명 + 건물번호 (Road Address)',
      ok: false,
      severity: 'fail',
      message: 'Road name found without a building number (건물번호, e.g., 12 or 85-9).',
    });
  } else {
    checks.push({
      id: 'roadOrJibun',
      label: '도로명 + 건물번호 (Road Address)',
      ok: false,
      severity: 'fail',
      message: 'Missing Korean road name (~로 / ~길) and building number.',
    });
  }

  // Check 4: Detail Address (동 / 호)
  if (hasDetailUnit) {
    checks.push({
      id: 'detail',
      label: '상세주소 (동·호·층 / Building)',
      ok: true,
      severity: 'pass',
      message: 'Unit / building detail included.',
    });
  } else {
    checks.push({
      id: 'detail',
      label: '상세주소 (동·호·층 / Building)',
      ok: false,
      severity: 'warn',
      message: 'No unit/room (동·호·층) detected — add if living in an apartment, villa, or dormitory.',
    });
  }

  // Check 5: Formatting & Spacing
  if (hasNoise) {
    checks.push({
      id: 'formatting',
      label: '표기 형식 (District Spacing & Cleanliness)',
      ok: false,
      severity: 'fail',
      message: 'Contains stray OCR boilerplate, English text, or placeholder characters.',
    });
  } else if (formattedAddress) {
    checks.push({
      id: 'formatting',
      label: '표기 형식 (District Spacing & Cleanliness)',
      ok: false,
      severity: 'warn',
      message: 'Spacing or abbreviated province name can be normalized to official Korean format.',
    });
  } else {
    checks.push({
      id: 'formatting',
      label: '표기 형식 (District Spacing & Cleanliness)',
      ok: true,
      severity: 'pass',
      message: 'Clean official spacing.',
    });
  }

  // Check 6: Immigration Jurisdiction
  if (matchedOffice) {
    checks.push({
      id: 'jurisdiction',
      label: '관할 출입국·외국인관서 (Jurisdiction)',
      ok: true,
      severity: 'pass',
      message: `Routes to ${matchedOffice.name}`,
    });
  } else {
    checks.push({
      id: 'jurisdiction',
      label: '관할 출입국·외국인관서 (Jurisdiction)',
      ok: false,
      severity: 'fail',
      message: 'Could not map to a regional Immigration Office — verify 시/도 and 시/군/구.',
    });
  }

  // Compute readiness score
  let score = 0;
  if (detectedSido) score += 22;
  if (detectedSigungu && !guRequiredCity) score += 22;
  else if (guRequiredCity) score += 10;
  if (hasRoadName && hasBuildingNo) score += 26;
  else if (hasJibun) score += 18;
  else if (hasRoadName) score += 8;
  if (hasDetailUnit) score += 10;
  if (!hasNoise && !formattedAddress) score += 10;
  else if (!hasNoise) score += 5;
  if (matchedOffice) score += 10;

  const hasFail = checks.some((c) => c.severity === 'fail');
  const hasWarn = checks.some((c) => c.severity === 'warn');

  const status: KoreanAddressValidationResult['status'] = hasFail
    ? 'invalid'
    : hasWarn
    ? 'needs-review'
    : 'valid';

  return {
    status,
    score: Math.min(100, score),
    sido: detectedSido,
    sigungu: detectedSigungu,
    guRequiredCity,
    suggestedGus,
    hasRoadName,
    hasBuildingNo,
    hasJibun,
    hasDetailUnit,
    formattedAddress,
    matchedOffice,
    checks,
  };
}
