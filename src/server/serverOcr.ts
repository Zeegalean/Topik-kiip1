import Tesseract from 'tesseract.js';

export interface ServerOcrInput {
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
}

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
  'IA', 'DIA', 'ODIA', 'BODIA', 'MBODIA', 'AMBODIA', 'CAMBOD', 'CAMBODIAN', 'NESIA',
  'BIOMETRIC', 'DIPLOMATIC', 'ORDINARY', 'ISSUING', 'EXPIRATION', 'GENDER', 'BIRTHDATE',
  'OI', 'II', 'IL', 'LI', 'OO', 'EE', 'SS', 'MM', 'NN', 'CC', 'GG', 'UU',
  'RR', 'TT', 'PP', 'AA', 'DD', 'FF', 'HH', 'JJ', 'KK', 'VV', 'WW', 'XX',
  'YY', 'ZZ', 'ID', 'KR', 'RO', 'OK', 'ROK', 'CK', 'KL', 'LC', 'KC', 'CL',
  'LK', 'CKL', 'KLC', 'CCC', 'KKK', 'LLL', 'III', 'OOO', 'XXX',
]);

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

export function parseFlexibleDate(raw: string, minYear = 1920, maxYear = 2045): string | null {
  if (!raw) return null;
  const s = String(raw).trim();

  // 1. YYYY.MM.DD / YYYY-MM-DD / YYYY/MM/DD / YYYY년 MM월 DD일
  const ymd = s.match(/(\d{4})\s*[.\-년/]\s*(\d{1,2})\s*[.\-월/]\s*(\d{1,2})/);
  if (ymd) {
    const y = parseInt(ymd[1], 10);
    const m = parseInt(ymd[2], 10);
    const d = parseInt(ymd[3], 10);
    if (isValidYmd(y, m, d, minYear, maxYear)) {
      return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    }
  }

  // 2. YYYY MM DD (space-separated)
  const ymdSpace = s.match(/\b(\d{4})\s+(\d{1,2})\s+(\d{1,2})\b/);
  if (ymdSpace) {
    const y = parseInt(ymdSpace[1], 10);
    const m = parseInt(ymdSpace[2], 10);
    const d = parseInt(ymdSpace[3], 10);
    if (isValidYmd(y, m, d, minYear, maxYear)) {
      return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    }
  }

  // 3. DD MMM YYYY (e.g. 14 APR 2024)
  const dmyEn = s.match(/\b(\d{1,2})\s+([A-Za-z]{3,9})[.,]?\s+(\d{4})\b/);
  if (dmyEn) {
    const mm = MONTH_NAME_MAP[dmyEn[2].toLowerCase().slice(0, 3)];
    const y = parseInt(dmyEn[3], 10);
    const d = parseInt(dmyEn[1], 10);
    if (mm && isValidYmd(y, parseInt(mm, 10), d, minYear, maxYear)) {
      return `${y}-${mm}-${String(d).padStart(2, '0')}`;
    }
  }

  // 4. MMM DD, YYYY (e.g. Apr 14, 2024)
  const mdyEn = s.match(/\b([A-Za-z]{3,9})[.,]?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b/);
  if (mdyEn) {
    const mm = MONTH_NAME_MAP[mdyEn[1].toLowerCase().slice(0, 3)];
    const y = parseInt(mdyEn[3], 10);
    const d = parseInt(mdyEn[2], 10);
    if (mm && isValidYmd(y, parseInt(mm, 10), d, minYear, maxYear)) {
      return `${y}-${mm}-${String(d).padStart(2, '0')}`;
    }
  }

  // 5. Compact YYYYMMDD (e.g. 20240414)
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

function extractAllDatesInText(
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
      const parsed = parseFlexibleDate(m[0], minYear, maxYear);
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

function filterValidNameWords(rawPhrase: string, requireLongWord = false): string | null {
  const cleaned = rawPhrase
    .toUpperCase()
    .replace(/[^A-Z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return null;
  const words = cleaned.split(' ').filter((w) => w.length >= 2 && !NON_NAME_WORDS.has(w));
  if (words.length >= 2 && words.length <= 4) {
    const minNeeded = requireLongWord ? 4 : 3;
    if (words.some((w) => w.length >= minNeeded)) {
      return words.join(' ');
    }
  }
  return null;
}

function findArcRegNumber(text: string): { reg1: string; reg2: string; matchIndex: number; matchLength: number } | null {
  if (!text) return null;
  const cleanMatch = text.match(/\b(\d{6})\s*[-–~._:/\s]*([1-8]\d{6})\b/);
  if (cleanMatch && cleanMatch.index !== undefined) {
    return {
      reg1: cleanMatch[1],
      reg2: cleanMatch[2],
      matchIndex: cleanMatch.index,
      matchLength: cleanMatch[0].length,
    };
  }
  const tokenRegex = /\b([0-9OIlSB]{6})\s*[-–~._:/\s]+\s*([1-8OIlSB][0-9OIlSB]{6})\b/g;
  let m: RegExpExecArray | null;
  while ((m = tokenRegex.exec(text)) !== null) {
    const fix = (s: string) =>
      s.replace(/O/gi, '0').replace(/[Il|]/g, '1').replace(/S/gi, '5').replace(/B/gi, '8');
    const r1 = fix(m[1]);
    const r2 = fix(m[2]);
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

const ARC_BACK_BOILERPLATE_REGEX =
  /시[·.\s]*군[·.\s]*구|출입국|외국인(?:관서|청|사무소|등록증)|새로운\s*체류지|신고하여야|신고하지|범칙금|과태료|지방출입국|14일\s*이내|변경된\s*날|전입신고|관할|허가기간|체류기간\s*연장|확인\s*인|담당자/;

function parseArcReportDateTs(line: string): number {
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

export function extractKoreanAddress(rawCorpus: string): string | null {
  if (!rawCorpus) return null;
  const textCorpus = normalizeKoreanAdminSpacing(rawCorpus);
  const rawLines = textCorpus
    .split(/[\r\n<>]+/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  // Matches province/metro (with OR without space after province, e.g. 경기도안산시... or 경기도 안산시...)
  // OR city/county/district + district/eup/myeon/dong/road/gil (e.g. 화성시 향남읍..., 안산시 단원구...)
  const addrStartRegex =
    /((?:서울특별시|서울시|서울|부산광역시|부산시|부산|대구광역시|대구시|대구|인천광역시|인천시|인천|광주광역시|광주시|광주|대전광역시|대전시|대전|울산광역시|울산시|울산|세종특별자치시|세종시|세종|경기도|경기|강원특별자치도|강원도|강원|충청북도|충북|충청남도|충남|전북특별자치도|전라북도|전북|전라남도|전남|경상북도|경북|경상남도|경남|제주특별자치도|제주도|제주)\s*[가-힣0-9][가-힣0-9\s\-~,()./]+|[가-힣]{2,6}(?:시|군)\s+[가-힣]{1,12}(?:구|읍|면|동|로|길|가)\s*[가-힣0-9\s\-~,()./]*)/;

  const candidates: { address: string; timestamp: number; lineIndex: number }[] = [];

  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i];
    if (line.length < 4 || ARC_BACK_BOILERPLATE_REGEX.test(line)) {
      continue;
    }

    // Record any report date sitting on the same line, then strip leading date/labels before address matching
    const sameLineTs = parseArcReportDateTs(line);
    const strippedLine = line
      .replace(/^[\s|[\]()·•\-]*(?:\d{4}|\d{2})\s*[.\-년/]\s*\d{1,2}\s*[.\-월/]\s*\d{1,2}\s*[.\-일]?\s*/, '')
      .replace(/^(?:체류지|국내거소|주소|변경사항|신고일|신고일자|거소지|Address)\s*[:：|]?\s*/gi, '')
      .trim();

    const match = strippedLine.match(addrStartRegex);
    if (!match) continue;

    let cleanAddr = match[1]
      .replace(/^(?:체류지|국내거소|주소|변경사항|신고일|신고일자)\s*[:：]?\s*/g, '')
      // Strip trailing stamp/date noise if printed at end of same line
      .replace(/\s+(?:확인|담당|인|서명|신고|접수)\s*$/, '')
      .replace(/\s+/g, ' ')
      .trim();

    // Must contain at least a Korean district/road/dong marker or street number
    const looksLikeKoreanAddr =
      /(?:시|군|구|읍|면|동|리|로|길|가|번지|번길|\d+)/.test(cleanAddr) && cleanAddr.length >= 6;
    if (!looksLikeKoreanAddr || ARC_BACK_BOILERPLATE_REGEX.test(cleanAddr)) continue;

    // Collect up to 2 wrapped continuation lines (e.g. road name + building number + (법정동) + 202호)
    for (let contOffset = 1; contOffset <= 2; contOffset++) {
      if (i + contOffset >= rawLines.length) break;
      const nextLine = rawLines[i + contOffset];
      if (!nextLine || nextLine.length < 2 || nextLine.length > 45) break;
      if (parseArcReportDateTs(nextLine) > 0) break;
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

    // Check report date (신고일) on same line first, then nearby lines (-2..+1)
    let ts = sameLineTs;
    if (!ts) {
      for (const off of [-1, 1, -2]) {
        const idx = i + off;
        if (idx >= 0 && idx < rawLines.length) {
          const foundTs = parseArcReportDateTs(rawLines[idx]);
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

function extractMrzName(text: string): string | null {
  if (!text) return null;
  const upper = text.toUpperCase();
  const m = upper.match(
    /P[A-Z0-9<«(\s]{0,2}(?:KHM|VNM|NPL|UZB|MMR|THA|IDN|PHL|CHN|MNG|LKA|BGD|PAK|IND|KAZ|KGZ|TLS|LAO)([A-Z0-9<«\s]{5,42})/
  );
  if (m) {
    const tail = m[1].replace(/«/g, '<').trim();
    const parts = tail
      .split(/<{2,}/)
      .map((s) => s.replace(/</g, ' ').replace(/\b[CKL]{3,}\b/g, ' ').replace(/[CKL]{4,}$/g, '').trim())
      .filter((s) => s.length >= 2);
    if (parts.length >= 2) {
      const candidate = filterValidNameWords(`${parts[0]} ${parts[1]}`);
      if (candidate) return candidate;
    }
  }
  return null;
}

function extractLabeledName(text: string): string | null {
  if (!text) return null;
  const lines = text.split(/[\r\n<>]+/).map((l) => l.trim()).filter(Boolean);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/(?:성\s*명|영문성명|Name\s*in\s*English|\bName\b|\bSurname\b)/i.test(line)) {
      const same = line
        .replace(/[가-힣()/:：,]+/g, ' ')
        .replace(/\b(?:Name|in|English|Date|of|Birth|Sex|Gender|Male|Female|Surname|Given|Names|Registration|No|Country|Region|Nationality|Cambodia)\b/gi, ' ');
      const sameCandidate = filterValidNameWords(same);
      if (sameCandidate) return sameCandidate;

      for (let off = 1; off <= 2; off++) {
        if (i + off < lines.length) {
          const upperMatches = lines[i + off].match(/\b([A-Z]{2,18}(?:[,\s]+[A-Z]{2,18}){1,3})\b/g);
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

function extractStrictUppercaseName(text: string): string | null {
  if (!text) return null;
  const lines = text.split(/[\r\n<>]+/).map((l) => l.trim()).filter(Boolean);
  for (const line of lines) {
    if (/RESIDENCE\s+CARD|REGISTRATION\s+CARD|REPUBLIC\s+OF\s+KOREA|PROFICIENCY\s+IN\s+KOREAN/i.test(line)) {
      continue;
    }
    const upperMatches = line.match(/\b([A-Z]{2,18}(?:[,\s]+[A-Z]{2,18}){1,3})\b/g);
    if (!upperMatches) continue;
    for (const um of upperMatches) {
      const candidate = filterValidNameWords(um, true);
      if (candidate) return candidate;
    }
  }
  return null;
}

function extractTopikRound(topikText: string, combined: string): string | null {
  const isValidRound = (val: string): string | null => {
    const num = parseInt(val.replace(/[^0-9]/g, ''), 10);
    if (!Number.isNaN(num) && num >= 1 && num <= 300) return String(num);
    return null;
  };

  const sources = [topikText, combined].filter(Boolean);
  for (const src of sources) {
    // 1. Explicit "제 93 회" / "제93회" / OCR typo "제93희"
    const jeMatch = src.match(/제\s*(\d{1,3})\s*[회희외화]/i);
    if (jeMatch) {
      const v = isValidRound(jeMatch[1]);
      if (v) return v;
    }

    // 2. Standalone "93회" / "107 회" (not preceded by a digit like 2024년)
    const huiMatch = src.match(/(?<!\d)(\d{2,3})\s*[회희](?!\s*원|\s*사|\s*의)/);
    if (huiMatch) {
      const v = isValidRound(huiMatch[1]);
      if (v) return v;
    }

    // 3. Labeled "회차" / "시험회차" / "시행회차" / "Test Held" / "Round" — allows newline between table header and value!
    const labelRegex =
      /(?:시\s*행\s*회\s*차|시\s*험\s*회\s*차|응\s*시\s*회\s*차|회\s*차|차\s*수|Test\s*(?:Held|Number|No\.?)|Round|Edition)/gi;
    let lm: RegExpExecArray | null;
    while ((lm = labelRegex.exec(src)) !== null) {
      const windowStr = src.slice(lm.index + lm[0].length, lm.index + lm[0].length + 60);
      // Stop window before unrelated fields like 수험번호 or 생년월일
      const cutWindow = windowStr.split(/(?:수\s*험\s*번\s*호|생\s*년\s*월\s*일|문\s*서\s*확\s*인|Registration|Birth)/i)[0];
      const valMatch = cutWindow.match(/(?:제\s*)?(\d{1,3})(?:\s*[회희외화]|(?:\s*(?:st|nd|rd|th))?\b)/i);
      if (valMatch) {
        const v = isValidRound(valMatch[1]);
        if (v) return v;
      }
    }

    // 4. English ordinal: "The 93rd Test of Proficiency in Korean" or "96th TOPIK"
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

function extractTopikDates(topikText: string): { examDate?: string; validUntil?: string } {
  const out: { examDate?: string; validUntil?: string } = {};
  if (!topikText) return out;

  // A. Exam Date (시험일 / 시험일자 / 시행일 / 시행일자 / 응시일 / Test Date) — allows multi-line table header -> value
  const examLabelRegex =
    /(?:시\s*험\s*일(?:\s*자|\s*시)?|시\s*행\s*일(?:\s*자)?|응\s*시\s*일(?:\s*자)?|Test\s*Date|Date\s*of\s*Test|Exam\s*Date)/gi;
  let em: RegExpExecArray | null;
  while ((em = examLabelRegex.exec(topikText)) !== null) {
    const windowStr = topikText.slice(em.index + em[0].length, em.index + em[0].length + 85);
    const cutWindow = windowStr.split(
      /(?:성\s*적\s*유\s*효|유\s*효\s*기\s*간|Valid\s*Until|Expiration|생\s*년\s*월\s*일|Birth|발\s*급\s*일|Issue\s*Date)/i
    )[0];
    const dates = extractAllDatesInText(cutWindow, 2012, 2035);
    if (dates.length > 0) {
      out.examDate = dates[0].date;
      break;
    }
  }

  // Fallback examDate paired next to round: "2024.04.14 (제93회)" or "제93회 (2024.04.14)"
  if (!out.examDate) {
    const paired1 = topikText.match(/(\d{4}[.\-\s/]+\d{1,2}[.\-\s/]+\d{1,2})\s*\([제\s]*\d{1,3}\s*회/);
    const paired2 = topikText.match(/제\s*\d{1,3}\s*회[^\n]{0,25}?(\d{4}[.\-\s/]+\d{1,2}[.\-\s/]+\d{1,2})/);
    const parsed = parseFlexibleDate((paired1?.[1] || paired2?.[1] || ''), 2012, 2035);
    if (parsed) out.examDate = parsed;
  }

  // B. Valid Until Date (성적유효기간 / 유효기간 / 유효일자 / Valid Until / Expiration Date)
  // If printed as a range (e.g. "2024.05.30 ~ 2026.05.30"), ALWAYS take the END date!
  const validLabelRegex =
    /(?:성\s*적\s*유\s*효\s*기\s*간|유\s*효\s*기\s*간|유\s*효\s*일(?:\s*자)?|만\s*료\s*일(?:\s*자)?|Valid\s*(?:Until|Period|Thru|Through|Date)|Date\s*of\s*Expiration|Expiration\s*Date)/gi;
  let vm: RegExpExecArray | null;
  while ((vm = validLabelRegex.exec(topikText)) !== null) {
    const windowStr = topikText.slice(vm.index + vm[0].length, vm.index + vm[0].length + 100);
    const cutWindow = windowStr.split(
      /(?:취\s*득\s*등\s*급|등\s*급|총\s*점|발\s*급\s*일|발\s*행\s*일|Issue\s*Date|Print\s*Date|수\s*험\s*번\s*호|생\s*년\s*월\s*일|Birth)/i
    )[0];
    const dates = extractAllDatesInText(cutWindow, 2014, 2040);
    if (dates.length > 0) {
      // If range START ~ END, last/latest date is the expiration date
      out.validUntil = dates[dates.length - 1].date;
      break;
    }
  }

  // Fallback validUntil with tilde "~ 2026.05.30" or "2026.05.30까지"
  if (!out.validUntil) {
    const tildeMatch = topikText.match(/[~～]\s*(\d{4}\s*[.\-년/]\s*\d{1,2}\s*[.\-월/]\s*\d{1,2})(?:\s*일)?(?:\s*까지)?/);
    if (tildeMatch) {
      const parsed = parseFlexibleDate(tildeMatch[1], 2014, 2040);
      if (parsed) out.validUntil = parsed;
    }
  }

  // C. Smart Table Multi-Date Inference (handles OCR'd column headers on line N and dates on line N+1)
  if (!out.examDate || !out.validUntil) {
    const allDates = extractAllDatesInText(topikText, 2015, 2040).filter((d) => {
      const before = topikText.slice(Math.max(0, d.index - 28), d.index);
      // Exclude Birth Date & Print/Issue Date
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
      // Find a pair separated by ~2 years (TOPIK validity = 2 years from score announcement)
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

export function parseStructuredTextCorpus(params: {
  arcFrontText?: string;
  arcBackText?: string;
  topikText?: string;
  passportText?: string;
}): Record<string, any> {
  const {
    arcFrontText = '',
    arcBackText = '',
    topikText = '',
    passportText = '',
  } = params;
  const combined = `${arcFrontText}\n${arcBackText}\n${topikText}\n${passportText}`;
  const result: Record<string, any> = {};

  const arcAndPassport = `${arcFrontText}\n${arcBackText}\n${passportText}`;

  // 1. Name
  const regFound = findArcRegNumber(arcFrontText) || findArcRegNumber(arcAndPassport);
  let adjacentName: string | null = null;
  if (regFound) {
    const sourceText = arcFrontText.includes(regFound.reg1) ? arcFrontText : combined;
    const afterReg = sourceText.slice(regFound.matchIndex + regFound.matchLength, regFound.matchIndex + regFound.matchLength + 260);
    for (const ln of afterReg.split(/[\r\n<>]+/).slice(0, 4)) {
      const matches = ln.match(/\b([A-Z]{2,18}(?:[,\s]+[A-Z]{2,18}){1,3})\b/g);
      if (matches) {
        for (const m of matches) {
          const cand = filterValidNameWords(m, true);
          if (cand) {
            adjacentName = cand;
            break;
          }
        }
      }
      if (adjacentName) break;
    }
  }

  const detectedName =
    extractMrzName(passportText) ||
    extractMrzName(combined) ||
    extractLabeledName(topikText) ||
    extractLabeledName(passportText) ||
    extractLabeledName(arcFrontText) ||
    adjacentName ||
    extractStrictUppercaseName(topikText) ||
    extractStrictUppercaseName(passportText) ||
    extractStrictUppercaseName(arcFrontText);
  if (detectedName) {
    result.name = detectedName;
    result.applicantName = detectedName;
  }

  // 2. ARC Reg Number
  if (regFound) {
    result.regNumber1 = regFound.reg1;
    result.regNumber2 = regFound.reg2;
  }

  // 3. Gender
  if (result.regNumber2) {
    const firstDigit = result.regNumber2.charAt(0);
    if (['1', '3', '5', '7'].includes(firstDigit)) result.gender = '남';
    else if (['2', '4', '6', '8'].includes(firstDigit)) result.gender = '여';
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

  // 5. Visa Status
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

  // 6. Address (체류지)
  const addr =
    extractKoreanAddress(arcBackText) ||
    extractKoreanAddress(arcFrontText) ||
    extractKoreanAddress(combined);
  if (addr) result.address = addr;

  // 7. TOPIK Verification No (16 digits)
  const docVerCleaned = `${topikText}\n${combined}`
    .replace(/(?<=\d)[oO](?=\d)/g, '0')
    .replace(/(?<=\d)[lI](?=\d)/g, '1');
  const docVer4 =
    docVerCleaned.match(/(?:문\s*서\s*확\s*인\s*번\s*호|발급확인번호|진위확인번호|Verification\s*(?:No\.?)?)[\s\S]{0,40}?(\d{4})[^\d\n]{1,4}(\d{4})[^\d\n]{1,4}(\d{4})[^\d\n]{1,4}(\d{4})/i) ||
    docVerCleaned.match(/\b(\d{4})[.\-\s–—]{1,3}(\d{4})[.\-\s–—]{1,3}(\d{4})[.\-\s–—]{1,3}(\d{4})\b/);
  if (docVer4) {
    result.docVerificationNo = [docVer4[1], docVer4[2], docVer4[3], docVer4[4]];
  } else {
    const docVer16 =
      docVerCleaned.match(/(?:문\s*서\s*확\s*인\s*번\s*호|Verification|발급확인|진위확인)[\s\S]{0,40}?(\d{16})/i) ||
      docVerCleaned.match(/\b(\d{16})\b/);
    if (docVer16 && docVer16[1] !== '0000000000000000') {
      const s = docVer16[1];
      result.docVerificationNo = [s.slice(0, 4), s.slice(4, 8), s.slice(8, 12), s.slice(12, 16)];
    }
  }

  // 8. TOPIK Exam No (allows newline between label and value)
  const examMatch =
    topikText.match(/(?:수\s*험\s*번\s*호|Registration\s*(?:No\.?)?|Examinee(?:\s*No\.?)?|Application\s*(?:No\.?)?)[\s\S]{0,45}?(\d{8,16})/i) ||
    topikText.match(/\b(0\d{10,14})\b/) ||
    combined.match(/\b(00\d{11,13})\b/) ||
    topikText.match(/\b(\d{11,14})\b/);
  if (examMatch) {
    const digits = examMatch[1].replace(/[^0-9]/g, '');
    if (digits.length >= 6 && !/^0+$/.test(digits)) result.examNumber = digits;
  }

  // 9. TOPIK Round (회 / 회차)
  const detectedRound = extractTopikRound(topikText, combined);
  if (detectedRound) {
    result.round = detectedRound;
  }

  // 10. TOPIK Grade
  const gradeMatch =
    topikText.match(/(?:취\s*득\s*등\s*급|합\s*격\s*등\s*급|등\s*급|Grade|Level)[\s\S]{0,35}?([1-6])\s*급/i) ||
    topikText.match(/(?:취\s*득\s*등\s*급|합\s*격\s*등\s*급|등\s*급|Grade|Level)[^\d\n]{0,20}([1-6])\b/i) ||
    topikText.match(/([1-6])\s*급/) ||
    combined.match(/(?:취득등급|합격등급|등급)[^\d\n]{0,12}([1-6])/i);
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

  // 11. Dates (Exam Date 시험일/시행일 & Valid Until 성적유효기간) — only scan topikText so ARC Back 신고일 dates never leak
  if (topikText && topikText.trim().length > 0) {
    const topikDates = extractTopikDates(topikText);
    if (topikDates.examDate) result.examDate = topikDates.examDate;
    if (topikDates.validUntil) result.validUntil = topikDates.validUntil;
  }

  // 12. Passport MRZ & Number
  const mrzLine2 = combined.match(/([A-Z0-9<]{9})\d[A-Z]{3}(\d{6})\d([MF<])(\d{6})/);
  if (mrzLine2) {
    const rawPassNo = mrzLine2[1].replace(/</g, '').trim();
    if (rawPassNo.length >= 6) result.passportNo = rawPassNo;
    if (!result.regNumber1 && /^\d{6}$/.test(mrzLine2[2])) result.regNumber1 = mrzLine2[2];
    const expRaw = mrzLine2[4];
    if (/^\d{6}$/.test(expRaw)) {
      result.passportExpiry = `${2000 + parseInt(expRaw.slice(0, 2), 10)}-${expRaw.slice(2, 4)}-${expRaw.slice(4, 6)}`;
    }
  }
  if (!result.passportNo) {
    const passMatch =
      passportText.match(/\b([A-Z]{1,2}\d{7,8})\b/) ||
      combined.match(/(?:여\s*권\s*번\s*호|Passport\s*No)[^\nA-Z0-9]{0,12}([A-Z]{1,2}\d{7,8})/i);
    if (passMatch) result.passportNo = passMatch[1].toUpperCase();
  }

  return result;
}

async function recognizeDataUrlServer(
  dataUrl: string | null | undefined,
  langSpec: string
): Promise<string> {
  if (!dataUrl || typeof dataUrl !== 'string') return '';
  if (dataUrl.startsWith('data:image/svg+xml')) {
    try {
      if (dataUrl.includes(';base64,')) {
        return Buffer.from(dataUrl.split(';base64,')[1], 'base64').toString('utf8');
      }
      if (dataUrl.includes(',')) {
        return decodeURIComponent(dataUrl.split(',')[1]);
      }
    } catch {
      return '';
    }
  }
  if (dataUrl.startsWith('data:application/pdf')) {
    // Digital PDF text is sent via pdfTexts and rasterized page image is sent from client
    return '';
  }

  const commaIdx = dataUrl.indexOf(',');
  if (commaIdx === -1) return '';
  const base64 = dataUrl.slice(commaIdx + 1).replace(/\s/g, '');
  if (!base64 || base64.length < 100) return '';

  try {
    const buf = Buffer.from(base64, 'base64');
    const ocrPromise = Tesseract.recognize(buf, langSpec);
    const timeoutPromise = new Promise<{ data?: { text?: string } }>((resolve) =>
      setTimeout(() => resolve({ data: { text: '' } }), 20000)
    );
    const res = await Promise.race([ocrPromise, timeoutPromise]);
    return res?.data?.text || '';
  } catch (err) {
    console.warn(`[Server OCR] Tesseract (${langSpec}) error:`, err);
    return '';
  }
}

export async function runServerSideOcrFallback(input: ServerOcrInput): Promise<{
  data: Record<string, any>;
  rawTextPreview: string;
}> {
  const pdfTexts = input.pdfTexts || {};
  const [arcFrontOcr, arcBackOcr, topikOcr, passportOcr] = await Promise.all([
    input.arcFront ? recognizeDataUrlServer(input.arcFront, 'eng') : Promise.resolve(''),
    input.arcBack ? recognizeDataUrlServer(input.arcBack, 'kor+eng') : Promise.resolve(''),
    input.topikCert ? recognizeDataUrlServer(input.topikCert, 'kor+eng') : Promise.resolve(''),
    input.passport ? recognizeDataUrlServer(input.passport, 'eng') : Promise.resolve(''),
  ]);

  const arcFrontText = [pdfTexts.arcFront || '', arcFrontOcr].filter(Boolean).join('\n');
  const arcBackText = [pdfTexts.arcBack || '', arcBackOcr].filter(Boolean).join('\n');
  const topikText = [pdfTexts.topikCert || '', topikOcr].filter(Boolean).join('\n');
  const passportText = [pdfTexts.passport || '', passportOcr].filter(Boolean).join('\n');

  const data = parseStructuredTextCorpus({
    arcFrontText,
    arcBackText,
    topikText,
    passportText,
  });

  const rawTextPreview = [
    arcFrontText ? `[ARC Front]\n${arcFrontText}` : '',
    arcBackText ? `[ARC Back]\n${arcBackText}` : '',
    topikText ? `[TOPIK]\n${topikText}` : '',
    passportText ? `[Passport]\n${passportText}` : '',
  ]
    .filter(Boolean)
    .join('\n\n')
    .slice(0, 2500);

  return { data, rawTextPreview };
}
