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
    .replace(/세\s*종\s*특\s*별\s*자\s*치\s*시/g, '세종특별자치시');
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
  const tokenRegex = /\b([0-9OIlSB]{6})\s*[-–~._:/\s]*([1-8OIlSB][0-9OIlSB]{6})\b/g;
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

function extractKoreanAddress(rawCorpus: string): string | null {
  if (!rawCorpus) return null;
  const textCorpus = normalizeKoreanAdminSpacing(rawCorpus);
  const rawLines = textCorpus
    .split(/[\r\n<>]+/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  const datePattern = /(\d{4}|\d{2})[.\-\s년/]+(\d{1,2})[.\-\s월/]+(\d{1,2})/;
  const addrStartRegex =
    /((?:서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충북|충남|충청북도|충청남도|전북|전남|전라북도|전라남도|전북특별자치도|강원특별자치도|경북|경남|경상북도|경상남도|제주)[가-힣]*\s+[가-힣0-9\s\-~,().]+|[가-힣]{2,6}(?:시|군|구)\s+[가-힣]{1,12}(?:구|읍|면|동|로|길|가)\s*[가-힣0-9\s\-~,().]*)/;

  const candidates: { address: string; timestamp: number }[] = [];

  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i];
    if (
      line.length < 4 ||
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
    if (cleanAddr.length < 5 || cleanAddr.includes('출입국') || cleanAddr.includes('외국인청')) continue;

    if (i + 1 < rawLines.length) {
      const nextLine = rawLines[i + 1];
      if (
        !datePattern.test(nextLine) &&
        !addrStartRegex.test(nextLine) &&
        !nextLine.includes('시·군·구') &&
        !nextLine.includes('체류지') &&
        nextLine.length >= 2 &&
        nextLine.length <= 35 &&
        /(?:\d+|번길|로|길|동|호|층|읍|면|리|\([가-힣0-9]+\))/.test(nextLine)
      ) {
        const cont = nextLine.replace(/[^가-힣0-9\s\-~,().]/g, '').trim();
        if (cont.length >= 2) cleanAddr = `${cleanAddr} ${cont}`.replace(/\s+/g, ' ').trim();
      }
    }

    let ts = 0;
    for (let off = -1; off <= 1; off++) {
      const idx = i + off;
      if (idx >= 0 && idx < rawLines.length) {
        const dm = rawLines[idx].match(datePattern);
        if (dm) {
          let y = parseInt(dm[1], 10);
          if (y < 100) y += 2000;
          const mo = parseInt(dm[2], 10);
          const da = parseInt(dm[3], 10);
          if (y >= 2010 && y <= 2035 && mo >= 1 && mo <= 12 && da >= 1 && da <= 31) {
            ts = new Date(y, mo - 1, da).getTime();
            break;
          }
        }
      }
    }
    candidates.push({ address: cleanAddr, timestamp: ts });
  }

  if (candidates.length === 0) return null;
  const withDates = candidates.filter((c) => c.timestamp > 0);
  if (withDates.length > 0) {
    withDates.sort((a, b) => b.timestamp - a.timestamp);
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

export function parseStructuredTextCorpus(params: {
  arcFrontText: string;
  arcBackText: string;
  topikText: string;
  passportText: string;
}): Record<string, any> {
  const { arcFrontText, arcBackText, topikText, passportText } = params;
  const combined = `${arcFrontText}\n${arcBackText}\n${topikText}\n${passportText}`;
  const result: Record<string, any> = {};

  // 1. Name
  const regFound = findArcRegNumber(arcFrontText) || findArcRegNumber(combined);
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

  // 6. Address
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
    docVerCleaned.match(/(?:문\s*서\s*확\s*인\s*번\s*호|발급확인번호|진위확인번호|Verification\s*(?:No\.?)?)[^\d\n]{0,30}(\d{4})[^\d\n]{1,4}(\d{4})[^\d\n]{1,4}(\d{4})[^\d\n]{1,4}(\d{4})/i) ||
    docVerCleaned.match(/\b(\d{4})[.\-\s–—]{1,3}(\d{4})[.\-\s–—]{1,3}(\d{4})[.\-\s–—]{1,3}(\d{4})\b/);
  if (docVer4) {
    result.docVerificationNo = [docVer4[1], docVer4[2], docVer4[3], docVer4[4]];
  } else {
    const docVer16 =
      docVerCleaned.match(/(?:문\s*서\s*확\s*인\s*번\s*호|Verification|발급확인|진위확인)[^\d\n]{0,30}(\d{16})/i) ||
      docVerCleaned.match(/\b(\d{16})\b/);
    if (docVer16 && docVer16[1] !== '0000000000000000') {
      const s = docVer16[1];
      result.docVerificationNo = [s.slice(0, 4), s.slice(4, 8), s.slice(8, 12), s.slice(12, 16)];
    }
  }

  // 8. TOPIK Exam No
  const examMatch =
    topikText.match(/(?:수\s*험\s*번\s*호|Registration\s*(?:No\.?)?|Examinee(?:\s*No\.?)?|Application\s*(?:No\.?)?)[^\d\n]{0,30}(\d{8,16})/i) ||
    topikText.match(/\b(0\d{10,14})\b/) ||
    combined.match(/\b(00\d{11,13})\b/) ||
    topikText.match(/\b(\d{11,14})\b/);
  if (examMatch) {
    const digits = examMatch[1].replace(/[^0-9]/g, '');
    if (digits.length >= 6 && !/^0+$/.test(digits)) result.examNumber = digits;
  }

  // 9. TOPIK Round
  const roundMatch =
    topikText.match(/(?:제\s*)?(\d{1,3})\s*회/i) ||
    topikText.match(/(?:회\s*차|Test\s*(?:Held|Number|No\.?)|Round|Edition)[^\d\n]{0,20}(\d{1,3})/i) ||
    topikText.match(/The\s*(\d{1,3})(?:st|nd|rd|th)\s*(?:Test|TOPIK)/i) ||
    combined.match(/(?:제\s*)?(\d{2,3})\s*회/);
  if (roundMatch) {
    const r = roundMatch[1].replace(/[^0-9]/g, '');
    if (r && r !== '0' && r !== '000') result.round = r;
  }

  // 10. TOPIK Grade
  const gradeMatch =
    topikText.match(/(?:취\s*득\s*등\s*급|합\s*격\s*등\s*급|등\s*급|Grade|Level)[^\d\n]{0,15}([1-6])\s*급?/i) ||
    topikText.match(/([1-6])\s*급/) ||
    combined.match(/(?:취득등급|합격등급|등급)[^\d\n]{0,12}([1-6])/i);
  if (gradeMatch) {
    result.grade = `${gradeMatch[1]}급`;
  } else {
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

  // 11. Dates (Exam Date & Valid Until)
  const examDateMatch =
    topikText.match(/(?:시\s*험\s*일(?:\s*자)?|Test\s*Date)[^\d\n]{0,20}(\d{4})[.\-\s년/]+(\d{1,2})[.\-\s월/]+(\d{1,2})/i) ||
    topikText.match(/(\d{4})[.\-\s/]+(\d{1,2})[.\-\s/]+(\d{1,2})\s*\([제\s]*\d+회/);
  if (examDateMatch) {
    result.examDate = `${examDateMatch[1]}-${examDateMatch[2].padStart(2, '0')}-${examDateMatch[3].padStart(2, '0')}`;
  }
  const validMatch =
    topikText.match(/(?:성\s*적\s*유\s*효\s*기\s*간|유\s*효\s*기\s*간|Valid\s*Until|Expiration)[^\d\n]{0,25}(\d{4})[.\-\s년/]+(\d{1,2})[.\-\s월/]+(\d{1,2})/i);
  if (validMatch) {
    result.validUntil = `${validMatch[1]}-${validMatch[2].padStart(2, '0')}-${validMatch[3].padStart(2, '0')}`;
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
    input.arcBack ? recognizeDataUrlServer(input.arcBack, 'kor') : Promise.resolve(''),
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
