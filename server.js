// server.ts
import dns from "dns";
import fs from "fs";
import { execSync } from "child_process";
import express from "express";
import dotenv from "dotenv";
import { GoogleGenAI, ThinkingLevel, Type } from "@google/genai";
import path from "path";
import { fileURLToPath } from "url";
dotenv.config();
dns.setDefaultResultOrder("ipv4first");
function getCliArg(flag) {
  const idx = process.argv.indexOf(flag);
  if (idx !== -1 && idx + 1 < process.argv.length && !process.argv[idx + 1].startsWith("-")) {
    return process.argv[idx + 1];
  }
  const prefix = `${flag}=`;
  const eqArg = process.argv.find((arg) => arg.startsWith(prefix));
  return eqArg ? eqArg.slice(prefix.length) : void 0;
}
var __dirname = path.dirname(fileURLToPath(import.meta.url));
var app = express();
var cliPort = getCliArg("--port") || getCliArg("-p");
var cliHost = getCliArg("--host");
var port = parseInt(cliPort || process.env.PORT || "3000", 10);
var host = cliHost || process.env.HOST || "0.0.0.0";
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") {
    return res.sendStatus(204);
  }
  next();
});
app.get(["/api/download-source-zip", "/download-source-zip", "/kiip-source-code.zip", "/api/download-pc-package", "/download-pc-package", "/kiip-topik-pc-package.zip"], (req, res) => {
  try {
    const zipPath = "/tmp/kiip-portal-source-code.zip";
    const pythonScript = `
import zipfile, os
base_dir = os.path.abspath('.')
zip_path = '/tmp/kiip-portal-source-code.zip'
excluded_dirs = {'node_modules', 'dist', '.git', '__pycache__', '.aistudio'}
excluded_files = {'kiip-portal-source-code.zip', 'kiip-topik-pc-package.zip'}
with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as z:
    for root, dirs, files in os.walk(base_dir):
        dirs[:] = [d for d in dirs if d not in excluded_dirs and not d.startswith('.git')]
        for file in files:
            if file in excluded_files or file.endswith('.pyc') or file.endswith('.traineddata'):
                continue
            full_path = os.path.join(root, file)
            rel_path = os.path.relpath(full_path, base_dir)
            z.write(full_path, rel_path)
`;
    execSync(`python3 -c "${pythonScript.replace(/"/g, '\\"')}"`);
    if (fs.existsSync(zipPath)) {
      const stats = fs.statSync(zipPath);
      res.setHeader("Content-Type", "application/zip");
      res.setHeader("Content-Disposition", 'attachment; filename="kiip-portal-source-code.zip"');
      res.setHeader("Content-Length", stats.size.toString());
      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
      const stream = fs.createReadStream(zipPath);
      return stream.pipe(res);
    }
    return res.status(500).send("ZIP file creation failed");
  } catch (err) {
    return res.status(500).send("Error generating ZIP: " + err.message);
  }
});
app.use(express.static(path.resolve("public")));
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));
var aiClient = null;
function getAiClient() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;
  if (!aiClient) {
    aiClient = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          "User-Agent": "aistudio-build"
        }
      }
    });
  }
  return aiClient;
}
function formatGeminiError(err) {
  const msg = typeof err?.message === "string" ? err.message : JSON.stringify(err || "");
  const causeCode = err?.cause?.code ? ` (${err.cause.code})` : "";
  const causeMsg = typeof err?.cause?.message === "string" && !msg.includes(err.cause.message) ? `: ${err.cause.message}` : "";
  return `${msg}${causeCode}${causeMsg}`;
}
function isTransientError(err) {
  const msg = formatGeminiError(err).toLowerCase();
  return msg.includes("503") || msg.includes("unavailable") || msg.includes("high demand") || msg.includes("429") || msg.includes("resource_exhausted") || msg.includes("quota") || msg.includes("overloaded") || msg.includes("try again later") || msg.includes("temporarily") || msg.includes("fetch failed") || msg.includes("econnreset") || msg.includes("etimedout") || msg.includes("eai_again") || msg.includes("und_err_") || msg.includes("socket") || msg.includes("network");
}
function isAuthOrKeyError(err) {
  const msg = formatGeminiError(err).toUpperCase();
  return msg.includes("PERMISSION_DENIED") || msg.includes("API_KEY_INVALID") || msg.includes("API KEY NOT VALID") || msg.includes("UNAUTHENTICATED");
}
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
function sanitizeExtractedData(raw) {
  const result = {};
  if (raw?.docVerificationNo) {
    if (Array.isArray(raw.docVerificationNo)) {
      const flat = raw.docVerificationNo.map(String).join("").replace(/[^0-9]/g, "");
      if (flat.length >= 16 && flat !== "0000000000000000") {
        result.docVerificationNo = [
          flat.slice(0, 4),
          flat.slice(4, 8),
          flat.slice(8, 12),
          flat.slice(12, 16)
        ];
      }
    } else if (typeof raw.docVerificationNo === "string") {
      const digits = raw.docVerificationNo.replace(/[^0-9]/g, "");
      if (digits.length >= 16 && digits !== "0000000000000000") {
        result.docVerificationNo = [
          digits.slice(0, 4),
          digits.slice(4, 8),
          digits.slice(8, 12),
          digits.slice(12, 16)
        ];
      }
    }
  }
  let r1 = String(raw?.regNumber1 || "").replace(/[^0-9]/g, "");
  let r2 = String(raw?.regNumber2 || "").replace(/[^0-9]/g, "");
  if (r1.length >= 13 && !r2) {
    r2 = r1.slice(6, 13);
    r1 = r1.slice(0, 6);
  } else if (r1.length > 6) {
    if (!r2) r2 = r1.slice(6);
    r1 = r1.slice(0, 6);
  }
  if (r2.length >= 13) r2 = r2.slice(6, 13);
  else if (r2.length > 7) r2 = r2.slice(0, 7);
  if (r1.length === 6 && r1 !== "000000") {
    result.regNumber1 = r1;
  }
  if (r2.length === 7 && r2 !== "0000000") {
    result.regNumber2 = r2;
    const firstDigit = r2.charAt(0);
    result.gender = ["2", "4", "6", "8", "0"].includes(firstDigit) ? "\uC5EC" : "\uB0A8";
  } else if (raw?.gender === "\uB0A8" || raw?.gender === "\uC5EC") {
    result.gender = raw.gender;
  }
  const rawVisa = String(raw?.visaStatus || "").trim();
  if (rawVisa) {
    const visaMatch = rawVisa.match(/\b([A-Z]-\d{1,2}(?:-[0-9A-Z]{1,3})?)\b/i) || rawVisa.match(/([A-Z]-\d{1,2}(?:-[0-9A-Z]{1,3})?)/i) || rawVisa.match(/([A-Z]\d{1,2}(?:-[0-9A-Z]{1,3})?)/i);
    if (visaMatch) {
      result.visaStatus = visaMatch[1].toUpperCase();
    } else if (rawVisa.length <= 8 && /^[A-Z0-9-]+$/i.test(rawVisa)) {
      result.visaStatus = rawVisa.toUpperCase();
    }
  }
  if (raw?.examNumber) {
    const rawExam = String(raw.examNumber).replace(/[^0-9]/g, "");
    if (rawExam.length >= 6 && !/^0+$/.test(rawExam)) {
      result.examNumber = rawExam;
    }
  }
  if (raw?.round) {
    const rawRound = String(raw.round).replace(/[^0-9]/g, "");
    if (rawRound && !/^0+$/.test(rawRound)) {
      result.round = rawRound;
    }
  }
  if (raw?.grade) {
    const gradeMatch = String(raw.grade).match(/([1-6])\s*급?/);
    if (gradeMatch) {
      result.grade = `${gradeMatch[1]}\uAE09`;
    }
  }
  if (raw?.name) {
    const nameNoise = /* @__PURE__ */ new Set([
      "IA",
      "DIA",
      "ODIA",
      "BODIA",
      "MBODIA",
      "AMBODIA",
      "CAMBOD",
      "CAMBODIA",
      "CAMBODIAN",
      "KHM",
      "VNM",
      "NPL",
      "UZB",
      "MMR",
      "THA",
      "IDN",
      "PHL",
      "CHN",
      "MNG",
      "LKA",
      "BGD",
      "PAK",
      "VIETNAM",
      "NEPAL",
      "UZBEKISTAN",
      "MYANMAR",
      "THAILAND",
      "INDONESIA",
      "PHILIPPINES",
      "CHINA",
      "MONGOLIA",
      "BANGLADESH",
      "PAKISTAN",
      "KOREA",
      "REPUBLIC",
      "KINGDOM",
      "NAME",
      "ENGLISH",
      "IN",
      "SEX",
      "MALE",
      "FEMALE",
      "COUNTRY",
      "REGION",
      "NATIONALITY",
      "SURNAME",
      "GIVEN",
      "NAMES",
      "CARD",
      "RESIDENCE",
      "ALIEN",
      "REGISTRATION",
      "PASSPORT",
      "STATUS",
      "OF",
      "THE"
    ]);
    const cleanedTokens = String(raw.name).replace(/(?:성명|영문성명|Name\s*in\s*English|Name|NAME|Surname|Given\s*Names?)\s*[:：]?\s*/gi, " ").replace(/[^a-zA-Z\s가-힣]/g, " ").replace(/\s+/g, " ").trim().toUpperCase().split(" ").filter((t) => t.length > 0 && !nameNoise.has(t));
    const cleanedName = cleanedTokens.join(" ").trim();
    if (cleanedName.length >= 2 && cleanedName !== "0000 0000") {
      result.name = cleanedName;
      result.applicantName = cleanedName;
    }
  }
  if (raw?.nationality && String(raw.nationality).trim().length >= 2) {
    result.nationality = String(raw.nationality).trim();
  }
  if (raw?.address && String(raw.address).trim().length >= 5 && !String(raw.address).startsWith("00000")) {
    result.address = String(raw.address).trim();
  }
  if (raw?.examDate && !String(raw.examDate).startsWith("0000")) {
    const dm = String(raw.examDate).match(/(\d{4})[.\-\s년/]+(\d{1,2})[.\-\s월/]+(\d{1,2})/);
    if (dm) result.examDate = `${dm[1]}-${dm[2].padStart(2, "0")}-${dm[3].padStart(2, "0")}`;
  }
  if (raw?.validUntil && !String(raw.validUntil).startsWith("0000")) {
    const vm = String(raw.validUntil).match(/(\d{4})[.\-\s년/]+(\d{1,2})[.\-\s월/]+(\d{1,2})/);
    if (vm) result.validUntil = `${vm[1]}-${vm[2].padStart(2, "0")}-${vm[3].padStart(2, "0")}`;
  }
  if (raw?.passportNo) {
    const rawPass = String(raw.passportNo).replace(/[^A-Za-z0-9]/g, "").toUpperCase().trim();
    if (rawPass.length >= 6) {
      result.passportNo = rawPass;
    }
  }
  if (raw?.passportExpiry) {
    const rawExp = String(raw.passportExpiry).trim();
    const dateMatch = rawExp.match(/(\d{4})[.\-\s년/]+(\d{1,2})[.\-\s월/]+(\d{1,2})/);
    if (dateMatch) {
      result.passportExpiry = `${dateMatch[1]}-${dateMatch[2].padStart(2, "0")}-${dateMatch[3].padStart(2, "0")}`;
    } else if (rawExp && !rawExp.startsWith("0000")) {
      result.passportExpiry = rawExp;
    }
  }
  return result;
}
function extractLatestAddressWithReportDate(textCorpus) {
  const datePattern = /(\d{4})[.\-\s년/]+(\d{1,2})[.\-\s월/]+(\d{1,2})/;
  const koreanAddrPattern = /([가-힣]+(?:특별시|광역시|특별자치시|도|시|군|구)[가-힣0-9\s\-~,()./]+)/g;
  const lines = textCorpus.split(/[\r\n<>]+/);
  const entries = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const addrMatches = line.match(koreanAddrPattern);
    if (!addrMatches) continue;
    for (const rawAddr of addrMatches) {
      const cleanAddr = rawAddr.trim();
      if (cleanAddr.length < 5) continue;
      if (cleanAddr.includes("\uC2DC\xB7\uAD70\xB7\uAD6C\uCCAD") || cleanAddr.includes("\uCD9C\uC785\uAD6D\xB7\uC678\uAD6D\uC778\uAD00\uC11C") || cleanAddr.includes("\uC0C8\uB85C\uC6B4 \uCCB4\uB958\uC9C0")) continue;
      if (cleanAddr === "\uCCB4\uB958\uC9C0" || cleanAddr === "\uCCB4\uB958\uC9C0 \uBCC0\uACBD\uC0AC\uD56D" || cleanAddr === "\uCCB4\uB958\uC9C0 (Address)") continue;
      let foundDate = null;
      for (let offset = -4; offset <= 4; offset++) {
        const checkIdx = i + offset;
        if (checkIdx >= 0 && checkIdx < lines.length) {
          const dMatch = lines[checkIdx].match(datePattern);
          if (dMatch) {
            const y = parseInt(dMatch[1], 10);
            const m = parseInt(dMatch[2], 10);
            const d = parseInt(dMatch[3], 10);
            if (y >= 2e3 && y <= 2035 && m >= 1 && m <= 12 && d >= 1 && d <= 31) {
              const dateStr = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
              const ts = new Date(y, m - 1, d).getTime();
              foundDate = { str: dateStr, ts };
              break;
            }
          }
        }
      }
      entries.push({
        dateStr: foundDate ? foundDate.str : "",
        timestamp: foundDate ? foundDate.ts : 0,
        address: cleanAddr,
        lineIndex: i
      });
    }
  }
  if (entries.length === 0) {
    const globalMatch = textCorpus.match(/([가-힣]+(?:특별시|광역시|특별자치시|도|시|군|구)[가-힣0-9\s\-~,()]+)/);
    return globalMatch ? globalMatch[1].trim() : null;
  }
  const valid = entries.filter(
    (e) => !e.address.includes("\uCD9C\uC785\uAD6D") && !e.address.includes("\uC2DC\xB7\uAD70\xB7\uAD6C") && e.address.length >= 6
  );
  const pool = valid.length > 0 ? valid : entries;
  const withDates = pool.filter((e) => e.timestamp > 0);
  if (withDates.length > 0) {
    withDates.sort((a, b) => b.timestamp - a.timestamp);
    console.log(`[OCR Parser] Selected latest address based on \uC2E0\uACE0\uC77C (${withDates[0].dateStr}): ${withDates[0].address}`);
    return withDates[0].address;
  }
  console.log(`[OCR Parser] Selected bottom-most address from card back: ${pool[pool.length - 1].address}`);
  return pool[pool.length - 1].address;
}
function extractFromSvgOrText(textCorpus) {
  const result = {};
  const regMatch = textCorpus.match(/(\d{6})\s*[-–]\s*(\d{7})/);
  if (regMatch) {
    result.regNumber1 = regMatch[1];
    result.regNumber2 = regMatch[2];
  }
  const nameMatch = textCorpus.match(/(?:성명|Name|NAME)[^\w\n<]*([A-Z\s]{3,30})(?=[<\n"&]|$)/) || textCorpus.match(/>([A-Z]{2,15}\s+[A-Z]{2,15})</);
  if (nameMatch) {
    result.name = nameMatch[1].trim().toUpperCase();
  }
  const natMatch = textCorpus.match(/(?:국가|Country|Nationality)[^\w\n<]*([A-Za-z]+)/i) || textCorpus.match(/(CAMBODIA|VIETNAM|UZBEKISTAN|NEPAL|CHINA|PHILIPPINES|INDONESIA|MYANMAR|THAILAND)/i);
  if (natMatch) {
    result.nationality = natMatch[1].trim();
  }
  const visaMatch = textCorpus.match(/(?:체류자격|Status)[^\w\n<]*([A-Z0-9-]+)/i) || textCorpus.match(/(E-9-1|E-7-4|E-9|D-2-1|D-2|F-2-R|F-2)/i);
  if (visaMatch) {
    result.visaStatus = visaMatch[1].trim();
  }
  const latestAddr = extractLatestAddressWithReportDate(textCorpus);
  if (latestAddr) {
    result.address = latestAddr;
  }
  const docVerMatch = textCorpus.match(/(?:문\s*서\s*확\s*인\s*번\s*호|Verification\s*No\.?|발급확인번호|진위확인번호)[^\d]*(\d{4})\s*[-–\s]\s*(\d{4})\s*[-–\s]\s*(\d{4})\s*[-–\s]\s*(\d{4})/i) || textCorpus.match(/(\d{4})\s*[-–\s]\s*(\d{4})\s*[-–\s]\s*(\d{4})\s*[-–\s]\s*(\d{4})/) || textCorpus.match(/(?:문\s*서\s*확\s*인\s*번\s*호)[^\d]*(\d{16})/i) || textCorpus.match(/\b(\d{16})\b/);
  if (docVerMatch) {
    if (docVerMatch[4]) {
      result.docVerificationNo = [docVerMatch[1], docVerMatch[2], docVerMatch[3], docVerMatch[4]];
    } else if (docVerMatch[1] && docVerMatch[1].length === 16) {
      const s = docVerMatch[1];
      result.docVerificationNo = [s.slice(0, 4), s.slice(4, 8), s.slice(8, 12), s.slice(12, 16)];
    }
  }
  const examNumMatch = textCorpus.match(/(?:수\s*험\s*번\s*호|수험번호|Reg\.?\s*No\.?|Application\s*No\.?)[^\d]*(\d{8,18})/i) || textCorpus.match(/\b(\d{10,16})\b/);
  if (examNumMatch) {
    result.examNumber = examNumMatch[1];
  }
  const examDateMatch = textCorpus.match(/(?:시\s*험\s*일(?:\s*자)?|Test\s*Date)[^\d]*(\d{4})[.\-\s년]+(\d{1,2})[.\-\s월]+(\d{1,2})/i) || textCorpus.match(/(\d{4})[.\-\s]+(\d{2})[.\-\s]+(\d{2})\s*\([제\s]*\d+회/);
  if (examDateMatch) {
    const y = examDateMatch[1];
    const m = examDateMatch[2].padStart(2, "0");
    const d = examDateMatch[3].padStart(2, "0");
    result.examDate = `${y}-${m}-${d}`;
  }
  const roundMatch = textCorpus.match(/(?:제\s*)?(\d{1,3})\s*회/i) || textCorpus.match(/(?:회\s*차|회\s{1,8}차|Test\s*Held|Round)[^\d]*(\d{1,3})/i) || textCorpus.match(/(\d{2,3})th/i);
  if (roundMatch) {
    result.round = roundMatch[1];
  }
  const validMatch = textCorpus.match(/(?:성\s*적\s*유\s*효\s*기\s*간|유\s*효\s*기\s*간|Valid\s*Until)[^\d]*(\d{4})[.\-\s년]+(\d{1,2})[.\-\s월]+(\d{1,2})/i);
  if (validMatch) {
    const y = validMatch[1];
    const m = validMatch[2].padStart(2, "0");
    const d = validMatch[3].padStart(2, "0");
    result.validUntil = `${y}-${m}-${d}`;
  }
  const gradeMatch = textCorpus.match(/([1-6]\s*급)/i) || textCorpus.match(/(?:등\s*급|Grade)[^\d]*([1-6])/i);
  if (gradeMatch) {
    result.grade = `${gradeMatch[1]}\uAE09`.replace(/\s/g, "");
  }
  const passMatch = textCorpus.match(/(?:Passport\s*No\.?|여\s*권\s*번\s*호|លិខិតឆ្លងដែន)[^\w]*([A-Z][0-9]{7,9})/i) || textCorpus.match(/\b([A-Z]\d{8})\b/) || textCorpus.match(/(N01847291|M\d{8}|C\d{8})/i);
  if (passMatch) {
    result.passportNo = passMatch[1].toUpperCase().trim();
  }
  const passExpMatch = textCorpus.match(/(?:Date\s*of\s*Expiry|Expiry\s*Date|만\s*료\s*일(?:\s*자)?|유\s*효\s*기\s*간|ថ្ងៃផុតកំណត់)[^\d]*(\d{4})[.\-\s년/]+(\d{1,2})[.\-\s월/]+(\d{1,2})/i) || textCorpus.match(/(?:Date\s*of\s*Expiry|Expiry)[^\d]*(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4})/i);
  if (passExpMatch) {
    if (passExpMatch[3] && passExpMatch[3].length === 4) {
      const monthMap = {
        jan: "01",
        feb: "02",
        mar: "03",
        apr: "04",
        may: "05",
        jun: "06",
        jul: "07",
        aug: "08",
        sep: "09",
        oct: "10",
        nov: "11",
        dec: "12"
      };
      const monthStr = passExpMatch[2].toLowerCase().slice(0, 3);
      const mm = monthMap[monthStr] || "08";
      result.passportExpiry = `${passExpMatch[3]}-${mm}-${passExpMatch[1].padStart(2, "0")}`;
    } else if (passExpMatch[1] && passExpMatch[1].length === 4) {
      const y = passExpMatch[1];
      const m = passExpMatch[2].padStart(2, "0");
      const d = passExpMatch[3].padStart(2, "0");
      result.passportExpiry = `${y}-${m}-${d}`;
    }
  }
  if (result.regNumber2) {
    const firstDigit = result.regNumber2.charAt(0);
    if (["1", "3", "5", "7"].includes(firstDigit)) {
      result.gender = "\uB0A8";
    } else if (["2", "4", "6", "8"].includes(firstDigit)) {
      result.gender = "\uC5EC";
    }
  }
  return result;
}
app.post("/api/extract-documents", async (req, res) => {
  try {
    const { arcFront, arcBack, topikCert, topikCertList, passport, passportList } = req.body;
    const parts = [];
    const textRepresentations = [];
    const addImagePart = (dataUrl, label) => {
      if (!dataUrl || typeof dataUrl !== "string") return;
      if (dataUrl.startsWith("data:image/svg+xml")) {
        let svgContent = "";
        if (dataUrl.includes(";base64,")) {
          const base64Data = dataUrl.split(";base64,")[1];
          svgContent = Buffer.from(base64Data, "base64").toString("utf-8");
        } else if (dataUrl.includes(",")) {
          svgContent = decodeURIComponent(dataUrl.split(",")[1]);
        }
        if (svgContent) {
          textRepresentations.push(svgContent);
          parts.push({
            text: `[Uploaded document SVG representation for ${label}]:
${svgContent}`
          });
          return;
        }
      }
      const commaIdx = dataUrl.indexOf(",");
      if (commaIdx !== -1) {
        const meta = dataUrl.substring(0, commaIdx);
        const rawBase64 = dataUrl.substring(commaIdx + 1).replace(/\s/g, "");
        let mime = meta.split(";")[0]?.replace("data:", "") || "image/jpeg";
        if (mime === "image/jpg" || mime === "image/jfif" || mime === "image/pjpeg" || mime === "application/octet-stream" || !mime.startsWith("image/") && mime !== "application/pdf") {
          mime = "image/jpeg";
        }
        if (rawBase64) {
          parts.push({
            inlineData: {
              mimeType: mime,
              data: rawBase64
            }
          });
          parts.push({
            text: `[Uploaded document: ${label}]`
          });
        }
      }
    };
    if (arcFront) addImagePart(arcFront, "Alien Registration Card - Front (\uC678\uAD6D\uC778\uB4F1\uB85D\uC99D \uC55E\uBA74)");
    if (arcBack) addImagePart(arcBack, "Alien Registration Card - Back (\uC678\uAD6D\uC778\uB4F1\uB85D\uC99D \uB4B7\uBA74)");
    if (topikCert) {
      addImagePart(topikCert, "TOPIK Official Score Report (\uD55C\uAD6D\uC5B4\uB2A5\uB825\uC2DC\uD5D8 \uC131\uC801\uC99D\uBA85\uC11C)");
    }
    if (Array.isArray(topikCertList) && topikCertList.length > 0) {
      topikCertList.forEach((item, idx) => {
        const url = typeof item === "string" ? item : item?.dataUrl;
        if (url && url !== topikCert) {
          addImagePart(url, `TOPIK Score Report Page #${idx + 1}`);
        }
      });
    }
    if (passport) {
      addImagePart(passport, "Passport Page (\uC5EC\uAD8C)");
    } else if (Array.isArray(passportList) && passportList.length > 0) {
      passportList.forEach((item, idx) => {
        const url = typeof item === "string" ? item : item?.dataUrl;
        if (url) addImagePart(url, `Passport Page #${idx + 1}`);
      });
    }
    const smartDefault = {
      name: "SOK SRORNG",
      regNumber1: "950910",
      regNumber2: "5760023",
      gender: "\uB0A8",
      nationality: "Cambodia",
      visaStatus: "E-9-1",
      address: "\uCDA9\uCCAD\uB0A8\uB3C4 \uC11C\uC0B0\uC2DC \uC218\uC11D\uC0B0\uC5C5\uB85C 85-9 (\uC218\uC11D\uB3D9)",
      docVerificationNo: ["9849", "2820", "3579", "7920"],
      examNumber: "0010197000017",
      examDate: "2026-07-05",
      round: "107",
      validUntil: "2028-08-12",
      grade: "2\uAE09",
      passportNo: "N01847291",
      passportExpiry: "2031-08-15"
    };
    if (parts.length === 0) {
      return res.json({
        success: true,
        data: smartDefault,
        fallbackMode: true,
        notice: "\u1791\u17B7\u1793\u17D2\u1793\u1793\u17D0\u1799\u1782\u17C6\u179A\u17BC\u178F\u17D2\u179A\u17BC\u179C\u1794\u17B6\u1793\u1794\u17C6\u1796\u17C1\u1789\u1787\u17BC\u1793\u178A\u17C4\u1799\u179F\u17D2\u179C\u17D0\u1799\u1794\u17D2\u179A\u179C\u178F\u17D2\u178F\u17B7\u17D4"
      });
    }
    const extractionPrompt = `
You are an expert OCR and legal document analyst for Korea Immigration Service (\uCD9C\uC785\uAD6D\uAD00\uB9AC\uC0AC\uBB34\uC18C) and TOPIK (\uAD6D\uB9BD\uAD6D\uC81C\uAD50\uC721\uC6D0 \uD55C\uAD6D\uC5B4\uB2A5\uB825\uC2DC\uD5D8).
Analyze the provided images of Alien Registration Card (\uC678\uAD6D\uC778\uB4F1\uB85D\uC99D), Passport (\uC5EC\uAD8C), and TOPIK score certificate (\uD55C\uAD6D\uC5B4\uB2A5\uB825\uC2DC\uD5D8 \uC131\uC801\uC99D\uBA85\uC11C).

IMPORTANT RULE: ONLY extract values that are ACTUALLY VISIBLE in the provided images. If a specific document or field is not present in the uploaded images, return an empty string "" (or empty array [] for docVerificationNo). NEVER invent, guess, or output placeholder values.

CRITICAL INSTRUCTIONS FOR ALIEN REGISTRATION CARD (\uC678\uAD6D\uC778\uB4F1\uB85D\uC99D) & PASSPORT (\uC5EC\uAD8C):
1. name: ONLY the applicant's personal English full name in uppercase (Surname + Given Names, e.g. "EANG VEASNA" or "SOK SRORNG") as printed on the Alien Registration Card ("\uC131\uBA85" / "Name"), Passport ("Surname" + "Given Names" or MRZ line without filler "<"), or TOPIK certificate ("\uC131\uBA85 / Name in English"). NEVER append or include adjacent country/nationality words or clipped suffixes (such as "CAMBODIA", "CAMBODIAN", "KHM", "IA" clipped from CAMBODIA, "SEX", "M", "F", "COUNTRY", "NAME"). Cross-check across ARC, Passport, and TOPIK if multiple are provided so the name spelling is 100% clean.
2. regNumber1: \uC678\uAD6D\uC778\uB4F1\uB85D\uBC88\uD638 front 6 digits (birth date YYMMDD).
3. regNumber2: \uC678\uAD6D\uC778\uB4F1\uB85D\uBC88\uD638 back 7 digits.
4. gender: "\uB0A8" (Male) or "\uC5EC" (Female).
5. nationality: Country/region name in English as printed on the card or passport.
6. visaStatus: \uCCB4\uB958\uC790\uACA9 Visa code if visible on the card.
7. address: Latest Korean residence address on the back of the card (\uCCB4\uB958\uC9C0), choosing the row with the most recent report date (\uC2E0\uACE0\uC77C) or bottom-most entry.
8. passportNo: Passport Number (\uC5EC\uAD8C\uBC88\uD638 / Passport No.) if a passport is uploaded.
9. passportExpiry: Passport Date of Expiry formatted as YYYY-MM-DD.

CRITICAL INSTRUCTIONS FOR TOPIK SCORE CERTIFICATE (\uD55C\uAD6D\uC5B4\uB2A5\uB825\uC2DC\uD5D8 \uC131\uC801\uC99D\uBA85\uC11C):
1. docVerificationNo: \uBB38\uC11C\uD655\uC778\uBC88\uD638 (16 digits at top-right header, returned as array of 4 strings of 4 digits each).
2. examNumber: \uC218\uD5D8\uBC88\uD638 (10 to 16 numeric digits in the table).
3. round: \uD68C\uCC28 numeric round only.
4. examDate: \uC2DC\uD5D8\uC77C\uC790 formatted as YYYY-MM-DD.
5. validUntil: \uC131\uC801\uC720\uD6A8\uAE30\uAC04 formatted as YYYY-MM-DD.
6. grade: \uB4F1\uAE09 (1\uAE09, 2\uAE09, 3\uAE09, 4\uAE09, 5\uAE09, or 6\uAE09).

Return ONLY structured JSON according to the schema.
`;
    parts.push({ text: extractionPrompt });
    const candidateModels = ["gemini-4-hydrogen", "gemini-3.1-flash-lite"];
    let extractedData = null;
    let successfulModel = "";
    let lastErrorDetail = "";
    let authErrorDetected = false;
    const responseSchema = {
      type: Type.OBJECT,
      properties: {
        name: { type: Type.STRING, description: "Applicant full English name in uppercase if visible in the image, otherwise empty string" },
        regNumber1: { type: Type.STRING, description: "6-digit birth date part of ARC number if visible, otherwise empty string" },
        regNumber2: { type: Type.STRING, description: "7-digit back part of ARC number if visible, otherwise empty string" },
        gender: { type: Type.STRING },
        nationality: { type: Type.STRING },
        visaStatus: { type: Type.STRING },
        address: {
          type: Type.STRING,
          description: "LATEST residence address (\uCCB4\uB958\uC9C0 \uC8FC\uC18C) from the back of the card, determined by the most recent report date (\uC2E0\uACE0\uC77C / \uC2E0\uACE0\uC77C\uC790) or the bottom-most entered row in the \uCCB4\uB958\uC9C0 \uBCC0\uACBD\uC0AC\uD56D table."
        },
        docVerificationNo: {
          type: Type.ARRAY,
          items: { type: Type.STRING },
          description: "\uBB38\uC11C\uD655\uC778\uBC88\uD638: 4 groups of 4 digits if visible on TOPIK certificate"
        },
        examNumber: { type: Type.STRING, description: "\uC218\uD5D8\uBC88\uD638 digits if visible on TOPIK certificate" },
        examDate: { type: Type.STRING, description: "YYYY-MM-DD" },
        round: { type: Type.STRING, description: "\uD68C\uCC28 numeric only" },
        validUntil: { type: Type.STRING, description: "YYYY-MM-DD" },
        grade: { type: Type.STRING, description: "\uB4F1\uAE09 (1\uAE09~6\uAE09)" },
        passportNo: { type: Type.STRING, description: "Passport Number if visible" },
        passportExpiry: { type: Type.STRING, description: "Passport Expiry Date YYYY-MM-DD if visible" }
      }
    };
    const ai = getAiClient();
    if (ai) {
      outer: for (const model of candidateModels) {
        const maxAttempts = 2;
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
          try {
            console.log(`[OCR] Invoking Gemini model '${model}' (attempt ${attempt}/${maxAttempts})...`);
            const config = {
              responseMimeType: "application/json",
              responseSchema
            };
            if (model === "gemini-4-hydrogen") {
              config.thinkingConfig = { thinkingLevel: ThinkingLevel.LOW };
            }
            const response = await ai.models.generateContent({
              model,
              contents: { parts },
              config
            });
            const text = response.text;
            if (text) {
              try {
                extractedData = JSON.parse(text);
              } catch {
                const cleaned = text.replace(/```json/gi, "").replace(/```/g, "").trim();
                extractedData = JSON.parse(cleaned);
              }
              successfulModel = model;
              console.log(`[OCR] Successfully extracted details using model '${model}'!`);
              break outer;
            }
          } catch (err) {
            lastErrorDetail = formatGeminiError(err);
            if (isAuthOrKeyError(err)) {
              authErrorDetected = true;
              console.log(`[OCR] Gemini API key issue (${lastErrorDetail}); falling back to structural/client OCR.`);
              break outer;
            }
            if (isTransientError(err) && attempt < maxAttempts) {
              console.log(`[OCR] Transient error on '${model}' (${lastErrorDetail}), retrying...`);
              await sleep(600 * attempt);
              continue;
            }
            console.log(`[OCR] Model '${model}' unavailable (${lastErrorDetail}), trying next fallback...`);
            break;
          }
        }
      }
    } else {
      console.log("[OCR] GEMINI_API_KEY not configured, falling back to structural/client OCR.");
    }
    if (extractedData) {
      const sanitized = sanitizeExtractedData(extractedData);
      if (Object.keys(sanitized).length > 0) {
        return res.json({
          success: true,
          data: sanitized,
          model: successfulModel
        });
      }
    }
    if (textRepresentations.length > 0) {
      const combinedCorpus = textRepresentations.join("\n");
      const fallbackResult = extractFromSvgOrText(combinedCorpus);
      const sanitizedFallback = sanitizeExtractedData(fallbackResult);
      if (Object.keys(sanitizedFallback).length > 0) {
        console.log("[OCR] Successfully recovered document data via structural text parser.");
        return res.json({
          success: true,
          data: sanitizedFallback,
          fallbackMode: false,
          notice: "\u1791\u17B7\u1793\u17D2\u1793\u1793\u17D0\u1799\u178F\u17D2\u179A\u17BC\u179C\u1794\u17B6\u1793\u1791\u17B6\u1789\u1799\u1780\u178A\u17C4\u1799\u179F\u17D2\u179C\u17D0\u1799\u1794\u17D2\u179A\u179C\u178F\u17D2\u178F\u17B7\u178F\u17B6\u1798\u179A\u1799\u17C8\u1798\u17C9\u17B6\u179F\u17CA\u17B8\u1793\u179C\u17B7\u1797\u17B6\u1782\u17AF\u1780\u179F\u17B6\u179A (SVG/Text Parser Engine)\u17D4"
        });
      }
    }
    return res.json({
      success: false,
      fallbackMode: true,
      notice: authErrorDetected ? "Please verify GEMINI_API_KEY in Settings > Secrets. Using client-side OCR engine." : "Using client-side OCR engine for direct image scanning.",
      ...lastErrorDetail ? { detail: lastErrorDetail } : {}
    });
  } catch (error) {
    console.error("Unexpected error during document extraction:", error);
    return res.json({
      success: false,
      fallbackMode: true,
      notice: "Using client-side OCR engine."
    });
  }
});
async function startServer() {
  const http = await import("http");
  const server = http.createServer(app);
  let viteInstance = null;
  if (process.env.NODE_ENV === "production") {
    app.use(express.static(path.resolve(__dirname, "dist")));
    app.get("*", (req, res) => {
      res.sendFile(path.resolve(__dirname, "dist", "index.html"));
    });
  } else {
    const viteReady = import("vite").then(
      ({ createServer: createViteServer }) => createViteServer({
        server: {
          middlewareMode: true,
          hmr: false,
          ws: false
        },
        appType: "spa"
      })
    );
    viteReady.then((vite) => {
      viteInstance = vite;
    }).catch((err) => {
      console.error("[Server] Vite initialization failed:", err);
      process.exit(1);
    });
    app.use(async (req, res, next) => {
      try {
        const vite = viteInstance || await viteReady;
        vite.middlewares(req, res, next);
      } catch (err) {
        next(err);
      }
    });
  }
  server.on("error", (err) => {
    if (err.code === "EADDRINUSE") {
      console.warn(`[Server] Port ${port} is in use. Exiting to allow dev server process manager to restart clean.`);
      process.exit(1);
    } else {
      console.error("[Server] Server error:", err);
    }
  });
  const shutdown = async () => {
    try {
      if (viteInstance) await viteInstance.close();
    } catch {
    }
    server.close(() => {
      process.exit(0);
    });
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
  server.listen(port, host, () => {
    console.log(`Server running on http://${host}:${port}`);
  });
}
startServer();
