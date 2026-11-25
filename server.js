// server.ts
import dns from "dns";
import fs2 from "fs";
import crypto2 from "crypto";
import { execFileSync } from "child_process";
import express from "express";
import dotenv from "dotenv";
import nodemailer from "nodemailer";
import { GoogleGenAI, ThinkingLevel, Type } from "@google/genai";
import path2 from "path";
import { fileURLToPath } from "url";

// src/server/redeemDb.ts
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { DatabaseSync } from "node:sqlite";
var DATA_DIR = path.resolve(process.cwd(), "data");
var DB_FILE_PATH = path.join(DATA_DIR, "redeem_codes.sqlite");
var INITIAL_UNUSED_SEED_COUNT = 25;
var MAX_BULK_IMPORT_CODES = 5e4;
var dbInstance = null;
function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}
function normalizeCode(raw) {
  return String(raw || "").trim().toUpperCase().replace(/[^A-Z0-9_-]/g, "").slice(0, 64);
}
function normalizeStatus(raw) {
  const s = String(raw || "").trim().toLowerCase();
  if (s === "used" || s === "claimed" || s === "redeemed") return "Used";
  if (s === "revoked" || s === "disabled" || s === "expired") return "Revoked";
  return "Unused";
}
function generateSecureCode(prefix = "KIIP-26") {
  const cleanPrefix = normalizeCode(prefix).slice(0, 16) || "KIIP-26";
  const suffix = crypto.randomBytes(3).toString("hex").toUpperCase();
  return `${cleanPrefix}-${suffix}`;
}
function getRedeemDb() {
  if (dbInstance) return dbInstance;
  ensureDataDir();
  const db = new DatabaseSync(DB_FILE_PATH);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS redeem_codes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'Unused' CHECK (status IN ('Unused', 'Used', 'Revoked')),
      source TEXT NOT NULL DEFAULT 'database',
      note TEXT NOT NULL DEFAULT '',
      assigned_to TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      used_at TEXT DEFAULT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_redeem_codes_status ON redeem_codes(status);
    CREATE INDEX IF NOT EXISTS idx_redeem_codes_code ON redeem_codes(code);

    CREATE TABLE IF NOT EXISTS admin_accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE COLLATE NOCASE,
      display_name TEXT NOT NULL DEFAULT '',
      role TEXT NOT NULL DEFAULT 'manager' CHECK (role IN ('root_admin', 'manager')),
      salt TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_by TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      last_login_at TEXT DEFAULT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_admin_accounts_username ON admin_accounts(username);

    CREATE TABLE IF NOT EXISTS visitor_sessions (
      session_id TEXT PRIMARY KEY,
      first_seen TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS user_accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE COLLATE NOCASE,
      name TEXT NOT NULL DEFAULT '',
      phone TEXT NOT NULL DEFAULT '',
      provider TEXT NOT NULL DEFAULT 'email',
      salt TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL,
      last_login_at TEXT DEFAULT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_user_accounts_email ON user_accounts(email);
  `);
  dbInstance = db;
  seedInitialUnusedCodes(db);
  return db;
}
function seedInitialUnusedCodes(db) {
  const countRow = db.prepare("SELECT COUNT(*) as cnt FROM redeem_codes").get();
  const nowIso = (/* @__PURE__ */ new Date()).toISOString();
  const insertStmt = db.prepare(
    `INSERT OR IGNORE INTO redeem_codes (code, status, source, note, assigned_to, created_at)
     VALUES (?, 'Unused', ?, ?, '', ?)`
  );
  const envCodes = (process.env.REDEEM_CODES || "").split(",").map((c) => normalizeCode(c)).filter((c) => c.length >= 4);
  for (const code of envCodes) {
    insertStmt.run(code, "env_seed", "Imported from REDEEM_CODES", nowIso);
  }
  if (Number(countRow?.cnt || 0) === 0) {
    for (let i = 1; i <= INITIAL_UNUSED_SEED_COUNT; i++) {
      const batchLabel = `Pre-seeded Batch #${String(i).padStart(2, "0")}`;
      const code = generateSecureCode("KIIP-26");
      insertStmt.run(code, "database", batchLabel, nowIso);
    }
    console.log(
      `[RedeemDB] Initialized SQLite database with ${INITIAL_UNUSED_SEED_COUNT} pre-seeded 'Unused' redeem codes.`
    );
  }
}
function getRedeemCodeStats() {
  const db = getRedeemDb();
  const rows = db.prepare("SELECT status, COUNT(*) as cnt FROM redeem_codes GROUP BY status").all();
  let unusedCount = 0;
  let usedCount = 0;
  let revokedCount = 0;
  for (const r of rows) {
    if (r.status === "Unused") unusedCount = Number(r.cnt) || 0;
    else if (r.status === "Used") usedCount = Number(r.cnt) || 0;
    else if (r.status === "Revoked") revokedCount = Number(r.cnt) || 0;
  }
  return {
    total: unusedCount + usedCount + revokedCount,
    unusedCount,
    usedCount,
    revokedCount,
    databasePath: "data/redeem_codes.sqlite",
    googleSheetConfigured: Boolean(process.env.GOOGLE_SHEET_ID?.trim())
  };
}
function queryRedeemCodes(params) {
  const db = getRedeemDb();
  const statusFilter = params?.statusFilter || "all";
  const safePageSize = Math.min(500, Math.max(10, Math.floor(params?.pageSize ?? 100)));
  const requestedPage = Math.max(1, Math.floor(params?.page ?? 1));
  const rawSearch = String(params?.search || "").trim().slice(0, 80);
  const conditions = [];
  const whereArgs = [];
  if (statusFilter === "Unused" || statusFilter === "Used" || statusFilter === "Revoked") {
    conditions.push("status = ?");
    whereArgs.push(statusFilter);
  }
  if (rawSearch) {
    const escaped = rawSearch.replace(/[\\%_]/g, "\\$&");
    const likePattern = `%${escaped}%`;
    conditions.push(`(code LIKE ? ESCAPE '\\' OR note LIKE ? ESCAPE '\\' OR assigned_to LIKE ? ESCAPE '\\')`);
    whereArgs.push(likePattern, likePattern, likePattern);
  }
  const whereSql = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const countRow = db.prepare(`SELECT COUNT(*) as cnt FROM redeem_codes ${whereSql}`).get(...whereArgs);
  const totalMatched = Number(countRow?.cnt || 0);
  const totalPages = Math.max(1, Math.ceil(totalMatched / safePageSize));
  const page = Math.min(requestedPage, totalPages);
  const offset = (page - 1) * safePageSize;
  const orderSql = statusFilter === "Unused" || statusFilter === "Used" || statusFilter === "Revoked" ? "id DESC" : "CASE status WHEN 'Unused' THEN 0 WHEN 'Used' THEN 1 ELSE 2 END, id DESC";
  const codes = db.prepare(
    `SELECT id, code, status, source, note, assigned_to, created_at, used_at
       FROM redeem_codes
       ${whereSql}
       ORDER BY ${orderSql}
       LIMIT ? OFFSET ?`
  ).all(...whereArgs, safePageSize, offset);
  return {
    codes,
    totalMatched,
    page,
    pageSize: safePageSize,
    totalPages
  };
}
function generateUnusedRedeemCodes(count, prefix = "KIIP-26", note = "Admin Generated") {
  const db = getRedeemDb();
  const safeCount = Math.min(500, Math.max(1, Math.floor(count)));
  const safeNote = String(note || "Admin Generated").trim().slice(0, 140);
  const nowIso = (/* @__PURE__ */ new Date()).toISOString();
  const insertStmt = db.prepare(
    `INSERT OR IGNORE INTO redeem_codes (code, status, source, note, assigned_to, created_at)
     VALUES (?, 'Unused', 'admin', ?, '', ?)`
  );
  const selectStmt = db.prepare(
    `SELECT id, code, status, source, note, assigned_to, created_at, used_at
     FROM redeem_codes WHERE code = ?`
  );
  const created = [];
  let attempts = 0;
  db.exec("BEGIN IMMEDIATE");
  try {
    while (created.length < safeCount && attempts < safeCount * 5) {
      attempts++;
      const code = generateSecureCode(prefix);
      const info = insertStmt.run(code, safeNote, nowIso);
      if (Number(info.changes) > 0) {
        const row = selectStmt.get(code);
        if (row) created.push(row);
      }
    }
    db.exec("COMMIT");
  } catch (err) {
    try {
      db.exec("ROLLBACK");
    } catch {
    }
    throw err;
  }
  return created;
}
function addCustomRedeemCodes(rawCodes, note = "Manual Import", source = "admin") {
  const db = getRedeemDb();
  const safeNote = String(note || "Manual Import").trim().slice(0, 140);
  const safeSource = String(source || "admin").trim().slice(0, 32);
  const nowIso = (/* @__PURE__ */ new Date()).toISOString();
  const insertStmt = db.prepare(
    `INSERT OR IGNORE INTO redeem_codes (code, status, source, note, assigned_to, created_at)
     VALUES (?, 'Unused', ?, ?, '', ?)`
  );
  const totalReceived = rawCodes.length;
  const truncated = totalReceived > MAX_BULK_IMPORT_CODES;
  const sliceToProcess = truncated ? rawCodes.slice(0, MAX_BULK_IMPORT_CODES) : rawCodes;
  let added = 0;
  let skipped = 0;
  const insertedSample = [];
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const raw of sliceToProcess) {
      const code = normalizeCode(raw);
      if (code.length < 4) {
        skipped++;
        continue;
      }
      const info = insertStmt.run(code, safeSource, safeNote, nowIso);
      if (Number(info.changes) > 0) {
        added++;
        if (insertedSample.length < 50) {
          insertedSample.push(code);
        }
      } else {
        skipped++;
      }
    }
    db.exec("COMMIT");
  } catch (err) {
    try {
      db.exec("ROLLBACK");
    } catch {
    }
    throw err;
  }
  return { added, skipped, totalReceived, truncated, codes: insertedSample };
}
function verifyAndBurnRedeemCode(rawCode, usedBy = "") {
  const code = normalizeCode(rawCode);
  if (!code || code.length < 4) {
    return {
      ok: false,
      statusCode: 400,
      error: "\u179F\u17BC\u1798\u1794\u1789\u17D2\u1785\u17BC\u179B\u179B\u17C1\u1781\u1780\u17BC\u178A Redeem Code \u17B1\u17D2\u1799\u1794\u17B6\u1793\u178F\u17D2\u179A\u17B9\u1798\u178F\u17D2\u179A\u17BC\u179C!"
    };
  }
  const db = getRedeemDb();
  const safeUser = String(usedBy || "").trim().slice(0, 160);
  const nowIso = (/* @__PURE__ */ new Date()).toISOString();
  db.exec("BEGIN IMMEDIATE");
  try {
    const existing = db.prepare(
      `SELECT id, code, status, source, note, assigned_to, created_at, used_at
         FROM redeem_codes WHERE code = ?`
    ).get(code);
    if (!existing) {
      db.exec("COMMIT");
      return {
        ok: false,
        statusCode: 404,
        error: "\u179A\u1780\u1798\u17B7\u1793\u1783\u17BE\u1789\u179B\u17C1\u1781\u1780\u17BC\u178A\u1793\u17C1\u17C7\u1780\u17D2\u1793\u17BB\u1784\u1794\u17D2\u179A\u1796\u17D0\u1793\u17D2\u1792 Database \u17A1\u17BE\u1799!"
      };
    }
    if (existing.status === "Used") {
      db.exec("COMMIT");
      return {
        ok: false,
        statusCode: 409,
        error: "\u179B\u17C1\u1781\u1780\u17BC\u178A\u178A\u17C4\u17C7\u179F\u17C4\u1793\u17C1\u17C7\u178F\u17D2\u179A\u17BC\u179C\u1794\u17B6\u1793\u1794\u17D2\u179A\u17BE\u1794\u17D2\u179A\u17B6\u179F\u17CB\u179A\u17BD\u1785\u17A0\u17BE\u1799 (Used)!"
      };
    }
    if (existing.status === "Revoked") {
      db.exec("COMMIT");
      return {
        ok: false,
        statusCode: 403,
        error: "\u179B\u17C1\u1781\u1780\u17BC\u178A\u1793\u17C1\u17C7\u178F\u17D2\u179A\u17BC\u179C\u1794\u17B6\u1793\u1795\u17D2\u17A2\u17B6\u1780 \u17AC\u1795\u17BB\u178F\u179F\u17BB\u1796\u179B\u1797\u17B6\u1796 (Revoked)!"
      };
    }
    const assignee = existing.assigned_to || safeUser || "web_user";
    db.prepare(
      `UPDATE redeem_codes
       SET status = 'Used', used_at = ?, assigned_to = ?
       WHERE id = ? AND status = 'Unused'`
    ).run(nowIso, assignee, existing.id);
    db.exec("COMMIT");
    return {
      ok: true,
      statusCode: 200,
      record: {
        ...existing,
        status: "Used",
        used_at: nowIso,
        assigned_to: assignee
      }
    };
  } catch (err) {
    try {
      db.exec("ROLLBACK");
    } catch {
    }
    throw err;
  }
}
function reserveUnusedRedeemCode(params) {
  const db = getRedeemDb();
  const safeAssignee = String(params.assignedTo || "customer").trim().slice(0, 160);
  const safeNote = String(params.note || "").trim().slice(0, 160);
  const nowIso = (/* @__PURE__ */ new Date()).toISOString();
  db.exec("BEGIN IMMEDIATE");
  try {
    const candidate = db.prepare(
      `SELECT id, code, status, source, note, assigned_to, created_at, used_at
         FROM redeem_codes
         WHERE status = 'Unused' AND (assigned_to IS NULL OR assigned_to = '')
         ORDER BY id ASC
         LIMIT 1`
    ).get();
    if (candidate) {
      db.prepare(
        `UPDATE redeem_codes
         SET assigned_to = ?, note = ?, source = ?
         WHERE id = ?`
      ).run(safeAssignee, safeNote || candidate.note, params.source, candidate.id);
      db.exec("COMMIT");
      return {
        ...candidate,
        assigned_to: safeAssignee,
        note: safeNote || candidate.note,
        source: params.source
      };
    }
    const newCode = generateSecureCode(params.fallbackPrefix || (params.source === "telegram_bot" ? "KIIP-TG" : "KIIP-KR"));
    db.prepare(
      `INSERT INTO redeem_codes (code, status, source, note, assigned_to, created_at)
       VALUES (?, 'Unused', ?, ?, ?, ?)`
    ).run(newCode, params.source, safeNote, safeAssignee, nowIso);
    const created = db.prepare(
      `SELECT id, code, status, source, note, assigned_to, created_at, used_at
         FROM redeem_codes WHERE code = ?`
    ).get(newCode);
    db.exec("COMMIT");
    return created;
  } catch (err) {
    try {
      db.exec("ROLLBACK");
    } catch {
    }
    throw err;
  }
}
function updateRedeemCodeStatus(rawCode, newStatus) {
  const code = normalizeCode(rawCode);
  if (!code) return false;
  const db = getRedeemDb();
  const usedAt = newStatus === "Used" ? (/* @__PURE__ */ new Date()).toISOString() : null;
  const info = db.prepare("UPDATE redeem_codes SET status = ?, used_at = ? WHERE code = ?").run(newStatus, usedAt, code);
  return Number(info.changes) > 0;
}
function deleteRedeemCode(rawCode) {
  const code = normalizeCode(rawCode);
  if (!code) return false;
  const db = getRedeemDb();
  const info = db.prepare("DELETE FROM redeem_codes WHERE code = ?").run(code);
  return Number(info.changes) > 0;
}
function parseCsvRows(csvText) {
  const rows = [];
  let row = [];
  let cell = "";
  let inQuotes = false;
  for (let i = 0; i < csvText.length; i++) {
    const ch = csvText[i];
    const next = csvText[i + 1];
    if (inQuotes) {
      if (ch === '"' && next === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cell += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ",") {
        row.push(cell.trim());
        cell = "";
      } else if (ch === "\r" && next === "\n") {
        row.push(cell.trim());
        rows.push(row);
        row = [];
        cell = "";
        i++;
      } else if (ch === "\n" || ch === "\r") {
        row.push(cell.trim());
        rows.push(row);
        row = [];
        cell = "";
      } else {
        cell += ch;
      }
    }
  }
  if (cell.length > 0 || row.length > 0) {
    row.push(cell.trim());
    rows.push(row);
  }
  return rows.filter((r) => r.some((v) => v.length > 0));
}
var SHEET_ID_REGEX = /^[a-zA-Z0-9_-]{10,120}$/;
var PUBLISHED_ID_REGEX = /^2PACX-[a-zA-Z0-9_-]{10,160}$/;
var GID_REGEX = /^[0-9]{1,20}$/;
function parseGoogleSheetReference(rawInput) {
  const input = String(rawInput || "").trim();
  if (!input) return null;
  if (PUBLISHED_ID_REGEX.test(input)) {
    return { publishedId: input };
  }
  if (SHEET_ID_REGEX.test(input)) {
    return { sheetId: input };
  }
  try {
    const candidate = input.startsWith("http://") || input.startsWith("https://") ? input : `https://${input}`;
    const parsedUrl = new URL(candidate);
    if (parsedUrl.hostname.toLowerCase() !== "docs.google.com") {
      return null;
    }
    let gid = parsedUrl.searchParams.get("gid") || void 0;
    if (!gid && parsedUrl.hash) {
      const hashMatch = parsedUrl.hash.match(/gid=([0-9]+)/i);
      if (hashMatch) gid = hashMatch[1];
    }
    if (gid && !GID_REGEX.test(gid)) {
      gid = void 0;
    }
    const pubMatch = parsedUrl.pathname.match(/\/spreadsheets\/d\/e\/(2PACX-[a-zA-Z0-9_-]{10,160})/i);
    if (pubMatch && PUBLISHED_ID_REGEX.test(pubMatch[1])) {
      return { publishedId: pubMatch[1], gid };
    }
    const stdMatch = parsedUrl.pathname.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]{10,120})/i);
    if (stdMatch && SHEET_ID_REGEX.test(stdMatch[1])) {
      return { sheetId: stdMatch[1], gid };
    }
  } catch {
    return null;
  }
  return null;
}
async function fetchCsvFromGoogleUrl(url) {
  const resp = await fetch(url, {
    redirect: "follow",
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; KIIP-Portal-SheetSync/1.0)",
      Accept: "text/csv, text/plain, */*"
    },
    signal: AbortSignal.timeout(12e3)
  });
  if (!resp.ok) {
    return { ok: false, status: resp.status, isHtmlLogin: false, rows: [], errorText: `HTTP ${resp.status}` };
  }
  const rawText = await resp.text();
  const cleanText = rawText.replace(/^\uFEFF/, "").trim();
  if (!cleanText) {
    return { ok: true, status: resp.status, isHtmlLogin: false, rows: [] };
  }
  const lowerHead = cleanText.slice(0, 300).toLowerCase();
  if (lowerHead.startsWith("<!doctype html") || lowerHead.startsWith("<html") || lowerHead.includes("accounts.google.com") || lowerHead.includes("servicelogin")) {
    return { ok: false, status: resp.status, isHtmlLogin: true, rows: [] };
  }
  return { ok: true, status: resp.status, isHtmlLogin: false, rows: parseCsvRows(cleanText) };
}
async function syncRedeemCodesFromGoogleSheet(params) {
  const rawSheetInput = String(params?.sheetId || process.env.GOOGLE_SHEET_ID || "").trim();
  const requestedSheetName = String(params?.sheetName ?? process.env.GOOGLE_SHEET_TAB ?? "").trim().slice(0, 80);
  const parsedRef = parseGoogleSheetReference(rawSheetInput);
  if (!parsedRef) {
    return {
      success: false,
      sheetId: rawSheetInput,
      sheetName: requestedSheetName || "Sheet1",
      rowsRead: 0,
      imported: 0,
      skipped: 0,
      error: "\u179F\u17BC\u1798\u1794\u1789\u17D2\u1785\u17BC\u179B Link Google Sheet \u1791\u17B6\u17C6\u1784\u1798\u17BC\u179B (https://docs.google.com/spreadsheets/d/...) \u17AC Google Sheet ID \u17B1\u17D2\u1799\u1794\u17B6\u1793\u178F\u17D2\u179A\u17B9\u1798\u178F\u17D2\u179A\u17BC\u179C!"
    };
  }
  const resolvedId = parsedRef.sheetId || parsedRef.publishedId || rawSheetInput;
  let effectiveSheetName = requestedSheetName || (parsedRef.gid ? `gid:${parsedRef.gid}` : "Tab 1");
  let parsedRows = [];
  let sawHtmlLogin = false;
  let lastHttpStatus = 0;
  const apiKey = process.env.GOOGLE_SHEETS_API_KEY?.trim();
  try {
    if (parsedRef.publishedId) {
      const pubUrl = parsedRef.gid ? `https://docs.google.com/spreadsheets/d/e/${encodeURIComponent(parsedRef.publishedId)}/pub?gid=${encodeURIComponent(parsedRef.gid)}&single=true&output=csv` : `https://docs.google.com/spreadsheets/d/e/${encodeURIComponent(parsedRef.publishedId)}/pub?output=csv`;
      const r = await fetchCsvFromGoogleUrl(pubUrl);
      if (r.ok) {
        parsedRows = r.rows;
      } else {
        sawHtmlLogin = r.isHtmlLogin;
        lastHttpStatus = r.status;
      }
    } else if (parsedRef.sheetId) {
      let fetched = false;
      if (apiKey) {
        let targetTab = requestedSheetName;
        if (!targetTab) {
          const metaResp = await fetch(
            `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(parsedRef.sheetId)}?fields=sheets.properties.title&key=${encodeURIComponent(apiKey)}`,
            { signal: AbortSignal.timeout(1e4) }
          );
          if (metaResp.ok) {
            const metaJson = await metaResp.json();
            targetTab = metaJson?.sheets?.[0]?.properties?.title || "Sheet1";
            effectiveSheetName = targetTab;
          }
        }
        const range = encodeURIComponent(targetTab ? `${targetTab}!A1:E50000` : "A1:E50000");
        const apiUrl = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(parsedRef.sheetId)}/values/${range}?key=${encodeURIComponent(apiKey)}`;
        const apiResp = await fetch(apiUrl, { signal: AbortSignal.timeout(1e4) });
        if (apiResp.ok) {
          const json = await apiResp.json();
          parsedRows = Array.isArray(json.values) ? json.values : [];
          fetched = true;
        } else {
          lastHttpStatus = apiResp.status;
        }
      }
      if (!fetched && requestedSheetName) {
        const gvizNamed = `https://docs.google.com/spreadsheets/d/${encodeURIComponent(parsedRef.sheetId)}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(requestedSheetName)}`;
        const r = await fetchCsvFromGoogleUrl(gvizNamed);
        if (r.ok && r.rows.length > 0) {
          parsedRows = r.rows;
          fetched = true;
        } else {
          if (r.isHtmlLogin) sawHtmlLogin = true;
          if (r.status) lastHttpStatus = r.status;
        }
      }
      if (!fetched) {
        const exportUrl = parsedRef.gid ? `https://docs.google.com/spreadsheets/d/${encodeURIComponent(parsedRef.sheetId)}/export?format=csv&gid=${encodeURIComponent(parsedRef.gid)}` : `https://docs.google.com/spreadsheets/d/${encodeURIComponent(parsedRef.sheetId)}/export?format=csv`;
        const r = await fetchCsvFromGoogleUrl(exportUrl);
        if (r.ok) {
          parsedRows = r.rows;
          fetched = true;
          if (!requestedSheetName) {
            effectiveSheetName = parsedRef.gid ? `gid:${parsedRef.gid}` : "Tab 1";
          }
        } else {
          if (r.isHtmlLogin) sawHtmlLogin = true;
          if (r.status) lastHttpStatus = r.status;
        }
      }
      if (!fetched) {
        const gvizFirst = `https://docs.google.com/spreadsheets/d/${encodeURIComponent(parsedRef.sheetId)}/gviz/tq?tqx=out:csv`;
        const r = await fetchCsvFromGoogleUrl(gvizFirst);
        if (r.ok) {
          parsedRows = r.rows;
          fetched = true;
          effectiveSheetName = "Tab 1";
        } else {
          if (r.isHtmlLogin) sawHtmlLogin = true;
          if (r.status) lastHttpStatus = r.status;
        }
      }
      if (!fetched) {
        if (sawHtmlLogin || lastHttpStatus === 401 || lastHttpStatus === 403) {
          return {
            success: false,
            sheetId: resolvedId,
            sheetName: effectiveSheetName,
            rowsRead: 0,
            imported: 0,
            skipped: 0,
            error: 'Google Sheet \u1793\u17C1\u17C7\u1787\u17B6\u1794\u17CB\u179F\u17B7\u1791\u17D2\u1792\u17B7 Private! \u179F\u17BC\u1798\u1794\u17BE\u1780 Google Sheet \u2192 \u1785\u17BB\u1785 "Share" \u2192 \u1794\u17D2\u178F\u17BC\u179A General access \u1791\u17C5\u1787\u17B6 "Anyone with the link (Viewer)" \u179A\u17BD\u1785\u179F\u17B6\u1780\u179B\u17D2\u1794\u1784\u1798\u17D2\u178F\u1784\u1791\u17C0\u178F (\u17AC Export \u1787\u17B6 .CSV \u17A0\u17BE\u1799 Upload \u1795\u17D2\u1791\u17B6\u179B\u17CB)\u17D4'
          };
        }
        return {
          success: false,
          sheetId: resolvedId,
          sheetName: effectiveSheetName,
          rowsRead: 0,
          imported: 0,
          skipped: 0,
          error: `\u1798\u17B7\u1793\u17A2\u17B6\u1785\u17A2\u17B6\u1793 Google Sheet \u1794\u17B6\u1793\u1791\u17C1 (HTTP ${lastHttpStatus || "Error"})\u17D4 \u179F\u17BC\u1798\u1796\u17B7\u1793\u17B7\u178F\u17D2\u1799\u1790\u17B6 Link/ID \u178F\u17D2\u179A\u17B9\u1798\u178F\u17D2\u179A\u17BC\u179C \u17A0\u17BE\u1799 Sheet \u1794\u17BE\u1780\u179F\u17B7\u1791\u17D2\u1792\u17B7 "Anyone with the link (Viewer)"\u17D4`
        };
      }
    }
  } catch (err) {
    return {
      success: false,
      sheetId: resolvedId,
      sheetName: effectiveSheetName,
      rowsRead: 0,
      imported: 0,
      skipped: 0,
      error: `\u1794\u179A\u17B6\u1787\u17D0\u1799\u1780\u17D2\u1793\u17BB\u1784\u1780\u17B6\u179A\u178F\u1797\u17D2\u1787\u17B6\u1794\u17CB Google Sheets: ${err?.message || "Network timeout"}`
    };
  }
  if (parsedRows.length === 0) {
    return {
      success: true,
      sheetId: resolvedId,
      sheetName: effectiveSheetName,
      rowsRead: 0,
      imported: 0,
      skipped: 0
    };
  }
  const firstRowLower = parsedRows[0].map((c) => c.replace(/^\uFEFF/, "").trim().toLowerCase());
  const isCodeHeader = (c) => c.includes("code") || c.includes("redeem") || c.includes("voucher") || c.includes("\u1780\u17BC\u178A") || c.includes("\uCF54\uB4DC");
  const isStatusHeader = (c) => c.includes("status") || c.includes("\u179F\u17D2\u1790\u17B6\u1793\u1797\u17B6\u1796") || c.includes("\uC0C1\uD0DC");
  const isNoteHeader = (c) => c.includes("note") || c.includes("desc") || c.includes("center") || c.includes("\u179F\u1798\u17D2\u1782\u17B6\u179B\u17CB") || c.includes("\uBE44\uACE0");
  const hasHeader = firstRowLower.some((c) => isCodeHeader(c) || isStatusHeader(c) || isNoteHeader(c));
  let codeCol = 0;
  let statusCol = 1;
  let noteCol = 2;
  if (hasHeader) {
    const foundCode = firstRowLower.findIndex(isCodeHeader);
    const foundStatus = firstRowLower.findIndex(isStatusHeader);
    const foundNote = firstRowLower.findIndex(isNoteHeader);
    if (foundCode >= 0) codeCol = foundCode;
    if (foundStatus >= 0) statusCol = foundStatus;
    if (foundNote >= 0) noteCol = foundNote;
  } else if (parsedRows[0].length >= 2) {
    const col0 = normalizeCode(parsedRows[0][0] || "");
    const col1 = normalizeCode(parsedRows[0][1] || "");
    if (col0.length < 4 && col1.length >= 4) {
      codeCol = 1;
      statusCol = 2;
      noteCol = 3;
    }
  }
  const dataRows = hasHeader ? parsedRows.slice(1) : parsedRows;
  const db = getRedeemDb();
  const nowIso = (/* @__PURE__ */ new Date()).toISOString();
  const insertStmt = db.prepare(
    `INSERT OR IGNORE INTO redeem_codes (code, status, source, note, assigned_to, created_at)
     VALUES (?, ?, 'google_sheets', ?, '', ?)`
  );
  let imported = 0;
  let skipped = 0;
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const r of dataRows.slice(0, MAX_BULK_IMPORT_CODES)) {
      const code = normalizeCode(r[codeCol] || "");
      if (code.length < 4) {
        skipped++;
        continue;
      }
      const status = normalizeStatus(r[statusCol] || "Unused");
      const note = String(r[noteCol] || `Sheet: ${effectiveSheetName}`).trim().slice(0, 140);
      const info = insertStmt.run(code, status, note, nowIso);
      if (Number(info.changes) > 0) {
        imported++;
      } else {
        skipped++;
      }
    }
    db.exec("COMMIT");
  } catch (err) {
    try {
      db.exec("ROLLBACK");
    } catch {
    }
    throw err;
  }
  return {
    success: true,
    sheetId: resolvedId,
    sheetName: effectiveSheetName,
    rowsRead: dataRows.length,
    imported,
    skipped
  };
}
function hashAdminPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString("hex");
}
function timingSafeHexEqual(a, b) {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}
function listAdminAccounts() {
  const db = getRedeemDb();
  const rows = db.prepare(
    `SELECT id, username, display_name, role, is_active, created_by, created_at, last_login_at
       FROM admin_accounts
       ORDER BY id DESC`
  ).all();
  return rows.map((r) => ({
    id: Number(r.id),
    username: String(r.username),
    display_name: String(r.display_name || ""),
    role: r.role === "root_admin" ? "root_admin" : "manager",
    is_active: Boolean(r.is_active),
    created_by: String(r.created_by || ""),
    created_at: String(r.created_at || ""),
    last_login_at: r.last_login_at ? String(r.last_login_at) : null
  }));
}
function createOrUpdateAdminAccount(params) {
  const username = String(params.username || "").trim();
  const password = String(params.password || "");
  const displayName = String(params.displayName || username).trim().slice(0, 80);
  const role = params.role === "root_admin" ? "root_admin" : "manager";
  const createdBy = String(params.createdBy || "root_admin").trim().slice(0, 120);
  if (username.length < 3 || username.length > 64 || !/^[a-zA-Z0-9._@-]+$/.test(username)) {
    return { ok: false, error: "Admin ID \u178F\u17D2\u179A\u17BC\u179C\u1798\u17B6\u1793 3\u201364 \u178F\u17BD\u17A2\u1780\u17D2\u179F\u179A (\u17A2\u1780\u17D2\u179F\u179A \u179B\u17C1\u1781 . _ @ -)!" };
  }
  if (password.length < 6 || password.length > 128) {
    return { ok: false, error: "\u1796\u17B6\u1780\u17D2\u1799\u179F\u1798\u17D2\u1784\u17B6\u178F\u17CB\u178F\u17D2\u179A\u17BC\u179C\u1798\u17B6\u1793\u1799\u17C9\u17B6\u1784\u178F\u17B7\u1785 6 \u178F\u17BD\u17A2\u1780\u17D2\u179F\u179A!" };
  }
  const db = getRedeemDb();
  const salt = crypto.randomBytes(16).toString("hex");
  const passwordHash = hashAdminPassword(password, salt);
  const nowIso = (/* @__PURE__ */ new Date()).toISOString();
  const existing = db.prepare("SELECT id FROM admin_accounts WHERE username = ? COLLATE NOCASE").get(username);
  if (existing) {
    db.prepare(
      `UPDATE admin_accounts
       SET display_name = ?, role = ?, salt = ?, password_hash = ?, is_active = 1
       WHERE id = ?`
    ).run(displayName, role, salt, passwordHash, existing.id);
  } else {
    db.prepare(
      `INSERT INTO admin_accounts (username, display_name, role, salt, password_hash, is_active, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, 1, ?, ?)`
    ).run(username, displayName, role, salt, passwordHash, createdBy, nowIso);
  }
  const row = db.prepare(
    `SELECT id, username, display_name, role, is_active, created_by, created_at, last_login_at
       FROM admin_accounts WHERE username = ? COLLATE NOCASE`
  ).get(username);
  return {
    ok: true,
    account: {
      id: Number(row.id),
      username: String(row.username),
      display_name: String(row.display_name || ""),
      role: row.role === "root_admin" ? "root_admin" : "manager",
      is_active: Boolean(row.is_active),
      created_by: String(row.created_by || ""),
      created_at: String(row.created_at || ""),
      last_login_at: row.last_login_at ? String(row.last_login_at) : null
    }
  };
}
function verifyDbAdminLogin(username, password) {
  const cleanUser = String(username || "").trim();
  const cleanPass = String(password || "");
  if (!cleanUser || !cleanPass) return { ok: false };
  const db = getRedeemDb();
  const row = db.prepare(
    `SELECT id, username, display_name, role, salt, password_hash, is_active
       FROM admin_accounts WHERE username = ? COLLATE NOCASE`
  ).get(cleanUser);
  if (!row || !row.is_active) return { ok: false };
  const candidateHash = hashAdminPassword(cleanPass, row.salt);
  if (!timingSafeHexEqual(candidateHash, row.password_hash)) {
    return { ok: false };
  }
  db.prepare("UPDATE admin_accounts SET last_login_at = ? WHERE id = ?").run(
    (/* @__PURE__ */ new Date()).toISOString(),
    row.id
  );
  return {
    ok: true,
    username: row.username,
    role: row.role === "root_admin" ? "root_admin" : "manager"
  };
}
function setAdminAccountActive(id, isActive) {
  const db = getRedeemDb();
  const info = db.prepare("UPDATE admin_accounts SET is_active = ? WHERE id = ?").run(isActive ? 1 : 0, Math.floor(id));
  return Number(info.changes) > 0;
}
function updateAdminAccountPassword(id, newPassword) {
  if (newPassword.length < 6 || newPassword.length > 128) {
    return { ok: false, error: "\u1796\u17B6\u1780\u17D2\u1799\u179F\u1798\u17D2\u1784\u17B6\u178F\u17CB\u1790\u17D2\u1798\u17B8\u178F\u17D2\u179A\u17BC\u179C\u1798\u17B6\u1793\u1799\u17C9\u17B6\u1784\u178F\u17B7\u1785 6 \u178F\u17BD\u17A2\u1780\u17D2\u179F\u179A!" };
  }
  const db = getRedeemDb();
  const salt = crypto.randomBytes(16).toString("hex");
  const passwordHash = hashAdminPassword(newPassword, salt);
  const info = db.prepare("UPDATE admin_accounts SET salt = ?, password_hash = ? WHERE id = ?").run(salt, passwordHash, Math.floor(id));
  if (Number(info.changes) === 0) {
    return { ok: false, error: "\u179A\u1780\u1798\u17B7\u1793\u1783\u17BE\u1789\u1782\u178E\u1793\u17B8 Admin \u1793\u17C1\u17C7\u1791\u17C1!" };
  }
  return { ok: true };
}
function deleteAdminAccount(id) {
  const db = getRedeemDb();
  const info = db.prepare("DELETE FROM admin_accounts WHERE id = ?").run(Math.floor(id));
  return Number(info.changes) > 0;
}
function ensureVisitorSessionsTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS visitor_sessions (
      session_id TEXT PRIMARY KEY,
      first_seen TEXT NOT NULL
    );
  `);
}
function recordUniqueVisitSession(sessionId) {
  const cleanId = String(sessionId || "").trim().slice(0, 64);
  const db = getRedeemDb();
  ensureVisitorSessionsTable(db);
  if (cleanId) {
    db.prepare(
      `INSERT OR IGNORE INTO visitor_sessions (session_id, first_seen) VALUES (?, ?)`
    ).run(cleanId, (/* @__PURE__ */ new Date()).toISOString());
  }
  const row = db.prepare("SELECT COUNT(*) as cnt FROM visitor_sessions").get();
  return Math.max(1, Number(row?.cnt || 0));
}
function getTotalRecordedVisits() {
  const db = getRedeemDb();
  ensureVisitorSessionsTable(db);
  const row = db.prepare("SELECT COUNT(*) as cnt FROM visitor_sessions").get();
  return Math.max(1, Number(row?.cnt || 0));
}
function ensureUserAccountsTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE COLLATE NOCASE,
      name TEXT NOT NULL DEFAULT '',
      phone TEXT NOT NULL DEFAULT '',
      provider TEXT NOT NULL DEFAULT 'email',
      salt TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL,
      last_login_at TEXT DEFAULT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_user_accounts_email ON user_accounts(email);
  `);
}
function hashUserPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString("hex");
}
function verifyUserPasswordHash(password, salt, storedHash) {
  const candidate = hashUserPassword(password, salt);
  const a = Buffer.from(candidate, "utf8");
  const b = Buffer.from(storedHash, "utf8");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
function registerUserAccount(params) {
  const email = String(params.email || "").trim().toLowerCase().slice(0, 254);
  const name = String(params.name || "").trim().slice(0, 120);
  const phone = String(params.phone || "").trim().slice(0, 40);
  const password = String(params.password || "");
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, error: "\u179F\u17BC\u1798\u1794\u1789\u17D2\u1785\u17BC\u179B\u17A2\u17B6\u179F\u1799\u178A\u17D2\u178B\u17B6\u1793 Email \u17B1\u17D2\u1799\u1794\u17B6\u1793\u178F\u17D2\u179A\u17B9\u1798\u178F\u17D2\u179A\u17BC\u179C!" };
  }
  if (password.length < 6 || password.length > 128) {
    return { ok: false, error: "\u1796\u17B6\u1780\u17D2\u1799\u179F\u1798\u17D2\u1784\u17B6\u178F\u17CB\u178F\u17D2\u179A\u17BC\u179C\u1798\u17B6\u1793\u1799\u17C9\u17B6\u1784\u178F\u17B7\u1785 \u17E6 \u178F\u17BD\u17A2\u1780\u17D2\u179F\u179A!" };
  }
  const db = getRedeemDb();
  ensureUserAccountsTable(db);
  const existing = db.prepare("SELECT id FROM user_accounts WHERE email = ?").get(email);
  if (existing) {
    return {
      ok: false,
      error: 'Email \u1793\u17C1\u17C7\u178F\u17D2\u179A\u17BC\u179C\u1794\u17B6\u1793\u1785\u17BB\u17C7\u1788\u17D2\u1798\u17C4\u17C7\u179A\u17BD\u1785\u17A0\u17BE\u1799! \u179F\u17BC\u1798\u1787\u17D2\u179A\u17BE\u179F\u179A\u17BE\u179F "\u1785\u17BC\u179B\u1782\u178E\u1793\u17B8 (Sign In)" \u1787\u17C6\u1793\u17BD\u179F\u179C\u17B7\u1789\u17D4'
    };
  }
  const displayName = name || email.split("@")[0];
  const salt = crypto.randomBytes(16).toString("hex");
  const passwordHash = hashUserPassword(password, salt);
  const nowIso = (/* @__PURE__ */ new Date()).toISOString();
  const info = db.prepare(
    `INSERT INTO user_accounts (email, name, phone, provider, salt, password_hash, created_at, last_login_at)
       VALUES (?, ?, ?, 'email', ?, ?, ?, ?)`
  ).run(email, displayName, phone, salt, passwordHash, nowIso, nowIso);
  return {
    ok: true,
    user: {
      id: Number(info.lastInsertRowid),
      email,
      name: displayName,
      phone,
      provider: "email",
      createdAt: nowIso,
      lastLoginAt: nowIso
    }
  };
}
function verifyUserLogin(params) {
  const identifier = String(params.identifier || "").trim();
  const password = String(params.password || "");
  if (!identifier || !password) {
    return { ok: false, error: "\u179F\u17BC\u1798\u1794\u1789\u17D2\u1785\u17BC\u179B Email \u1793\u17B7\u1784\u1796\u17B6\u1780\u17D2\u1799\u179F\u1798\u17D2\u1784\u17B6\u178F\u17CB!" };
  }
  const db = getRedeemDb();
  ensureUserAccountsTable(db);
  const lower = identifier.toLowerCase();
  const cleanPhone = identifier.replace(/[^0-9+]/g, "");
  const row = db.prepare(
    `SELECT id, email, name, phone, provider, salt, password_hash, created_at, last_login_at
       FROM user_accounts
       WHERE email = ? OR (phone != '' AND phone = ?)
       LIMIT 1`
  ).get(lower, cleanPhone || "__no_phone__");
  if (!row) {
    return {
      ok: false,
      error: '\u179A\u1780\u1798\u17B7\u1793\u1783\u17BE\u1789\u1782\u178E\u1793\u17B8\u1793\u17C1\u17C7\u1791\u17C1! \u179F\u17BC\u1798\u1796\u17B7\u1793\u17B7\u178F\u17D2\u1799 Email \u17AC\u1785\u17BB\u1785 "\u1785\u17BB\u17C7\u1788\u17D2\u1798\u17C4\u17C7 (Sign Up)" \u1787\u17B6\u1798\u17BB\u1793\u179F\u17B7\u1793\u17D4'
    };
  }
  if (!verifyUserPasswordHash(password, row.salt, row.password_hash)) {
    return {
      ok: false,
      error: "\u1796\u17B6\u1780\u17D2\u1799\u179F\u1798\u17D2\u1784\u17B6\u178F\u17CB\u1798\u17B7\u1793\u178F\u17D2\u179A\u17B9\u1798\u178F\u17D2\u179A\u17BC\u179C\u1791\u17C1! \u179F\u17BC\u1798\u1796\u17D2\u1799\u17B6\u1799\u17B6\u1798\u1798\u17D2\u178F\u1784\u1791\u17C0\u178F \u17AC\u1785\u17BB\u1785\u1797\u17D2\u179B\u17C1\u1785\u1796\u17B6\u1780\u17D2\u1799\u179F\u1798\u17D2\u1784\u17B6\u178F\u17CB\u17D4"
    };
  }
  const nowIso = (/* @__PURE__ */ new Date()).toISOString();
  db.prepare("UPDATE user_accounts SET last_login_at = ? WHERE id = ?").run(nowIso, row.id);
  return {
    ok: true,
    user: {
      id: Number(row.id),
      email: String(row.email),
      name: String(row.name || row.email.split("@")[0]),
      phone: String(row.phone || ""),
      provider: row.provider === "otp" ? "otp" : "email",
      createdAt: String(row.created_at),
      lastLoginAt: nowIso
    }
  };
}
function upsertOtpUserAccount(params) {
  const rawTarget = String(params.target || "").trim().slice(0, 254);
  const isEmail = rawTarget.includes("@");
  const normalizedPhone = isEmail ? "" : rawTarget.replace(/[^0-9+]/g, "") || rawTarget;
  const normalizedEmail = isEmail ? rawTarget.toLowerCase() : `${normalizedPhone.replace(/[^a-zA-Z0-9]/g, "") || "user"}@otp.kiip-portal.kr`;
  const db = getRedeemDb();
  ensureUserAccountsTable(db);
  const existing = db.prepare(
    `SELECT id, email, name, phone, provider, created_at
       FROM user_accounts
       WHERE email = ? OR (phone != '' AND phone = ?)
       LIMIT 1`
  ).get(normalizedEmail, normalizedPhone || "__no_phone__");
  const nowIso = (/* @__PURE__ */ new Date()).toISOString();
  if (existing) {
    if (existing.provider === "email") {
      return {
        ok: false,
        error: "\u1782\u178E\u1793\u17B8 Email \u1793\u17C1\u17C7\u178F\u17D2\u179A\u17BC\u179C\u1794\u17B6\u1793\u1780\u17B6\u179A\u1796\u17B6\u179A\u178A\u17C4\u1799\u1796\u17B6\u1780\u17D2\u1799\u179F\u1798\u17D2\u1784\u17B6\u178F\u17CB! \u179F\u17BC\u1798\u1785\u17BC\u179B\u178F\u17B6\u1798 Email \u1793\u17B7\u1784 Password \u1787\u17C6\u1793\u17BD\u179F\u179C\u17B7\u1789\u17D4"
      };
    }
    const nextName = String(params.name || "").trim() || existing.name || normalizedEmail.split("@")[0];
    db.prepare("UPDATE user_accounts SET last_login_at = ?, name = ? WHERE id = ?").run(
      nowIso,
      nextName,
      existing.id
    );
    return {
      ok: true,
      user: {
        id: Number(existing.id),
        email: String(existing.email),
        name: nextName,
        phone: String(existing.phone || normalizedPhone),
        provider: "otp",
        createdAt: String(existing.created_at),
        lastLoginAt: nowIso
      }
    };
  }
  const displayName = String(params.name || "").trim() || (isEmail ? normalizedEmail.split("@")[0] : `User (${rawTarget})`);
  const salt = crypto.randomBytes(16).toString("hex");
  const randomHash = hashUserPassword(crypto.randomBytes(24).toString("hex"), salt);
  const info = db.prepare(
    `INSERT INTO user_accounts (email, name, phone, provider, salt, password_hash, created_at, last_login_at)
       VALUES (?, ?, ?, 'otp', ?, ?, ?, ?)`
  ).run(normalizedEmail, displayName, normalizedPhone, salt, randomHash, nowIso, nowIso);
  return {
    ok: true,
    user: {
      id: Number(info.lastInsertRowid),
      email: normalizedEmail,
      name: displayName,
      phone: normalizedPhone,
      provider: "otp",
      createdAt: nowIso,
      lastLoginAt: nowIso
    }
  };
}
function getUserAccountByEmail(email) {
  const cleanEmail = String(email || "").trim().toLowerCase();
  if (!cleanEmail) return null;
  const db = getRedeemDb();
  ensureUserAccountsTable(db);
  const row = db.prepare(
    `SELECT id, email, name, phone, provider, created_at, last_login_at
       FROM user_accounts
       WHERE email = ?
       LIMIT 1`
  ).get(cleanEmail);
  if (!row) return null;
  return {
    id: Number(row.id),
    email: String(row.email),
    name: String(row.name || row.email.split("@")[0]),
    phone: String(row.phone || ""),
    provider: row.provider === "otp" ? "otp" : "email",
    createdAt: String(row.created_at),
    lastLoginAt: row.last_login_at ? String(row.last_login_at) : null
  };
}
function changeUserAccountPassword(params) {
  const email = String(params.email || "").trim().toLowerCase();
  const currentPassword = String(params.currentPassword || "");
  const newPassword = String(params.newPassword || "");
  if (!email) return { ok: false, error: "\u179F\u17BC\u1798\u1794\u1789\u17D2\u1785\u17BC\u179B Email!" };
  if (!currentPassword) return { ok: false, error: "\u179F\u17BC\u1798\u1794\u1789\u17D2\u1785\u17BC\u179B\u1796\u17B6\u1780\u17D2\u1799\u179F\u1798\u17D2\u1784\u17B6\u178F\u17CB\u1794\u1785\u17D2\u1785\u17BB\u1794\u17D2\u1794\u1793\u17D2\u1793!" };
  if (newPassword.length < 6 || newPassword.length > 128) {
    return { ok: false, error: "\u1796\u17B6\u1780\u17D2\u1799\u179F\u1798\u17D2\u1784\u17B6\u178F\u17CB\u1790\u17D2\u1798\u17B8\u178F\u17D2\u179A\u17BC\u179C\u1798\u17B6\u1793\u1799\u17C9\u17B6\u1784\u178F\u17B7\u1785 \u17E6 \u178F\u17BD\u17A2\u1780\u17D2\u179F\u179A!" };
  }
  const db = getRedeemDb();
  ensureUserAccountsTable(db);
  const row = db.prepare("SELECT id, salt, password_hash FROM user_accounts WHERE email = ? LIMIT 1").get(email);
  if (!row) {
    return { ok: false, error: "\u179A\u1780\u1798\u17B7\u1793\u1783\u17BE\u1789\u1782\u178E\u1793\u17B8\u178A\u17C2\u179B\u1794\u17D2\u179A\u17BE Email \u1793\u17C1\u17C7\u1791\u17C1!" };
  }
  if (!verifyUserPasswordHash(currentPassword, row.salt, row.password_hash)) {
    return { ok: false, error: "\u1796\u17B6\u1780\u17D2\u1799\u179F\u1798\u17D2\u1784\u17B6\u178F\u17CB\u1794\u1785\u17D2\u1785\u17BB\u1794\u17D2\u1794\u1793\u17D2\u1793\u1798\u17B7\u1793\u178F\u17D2\u179A\u17B9\u1798\u178F\u17D2\u179A\u17BC\u179C\u1791\u17C1!" };
  }
  const salt = crypto.randomBytes(16).toString("hex");
  const passwordHash = hashUserPassword(newPassword, salt);
  db.prepare("UPDATE user_accounts SET salt = ?, password_hash = ? WHERE id = ?").run(
    salt,
    passwordHash,
    row.id
  );
  return { ok: true };
}
function resetUserAccountPassword(params) {
  const email = String(params.email || "").trim().toLowerCase();
  const newPassword = String(params.newPassword || "");
  if (!email) return { ok: false, error: "\u179F\u17BC\u1798\u1794\u1789\u17D2\u1785\u17BC\u179B Email!" };
  if (newPassword.length < 6 || newPassword.length > 128) {
    return { ok: false, error: "\u1796\u17B6\u1780\u17D2\u1799\u179F\u1798\u17D2\u1784\u17B6\u178F\u17CB\u1790\u17D2\u1798\u17B8\u178F\u17D2\u179A\u17BC\u179C\u1798\u17B6\u1793\u1799\u17C9\u17B6\u1784\u178F\u17B7\u1785 \u17E6 \u178F\u17BD\u17A2\u1780\u17D2\u179F\u179A!" };
  }
  const db = getRedeemDb();
  ensureUserAccountsTable(db);
  const salt = crypto.randomBytes(16).toString("hex");
  const passwordHash = hashUserPassword(newPassword, salt);
  const info = db.prepare("UPDATE user_accounts SET salt = ?, password_hash = ? WHERE email = ?").run(salt, passwordHash, email);
  if (Number(info.changes) === 0) {
    return { ok: false, error: "\u179A\u1780\u1798\u17B7\u1793\u1783\u17BE\u1789\u1782\u178E\u1793\u17B8\u178A\u17C2\u179B\u1794\u17D2\u179A\u17BE Email \u1793\u17C1\u17C7\u1791\u17C1!" };
  }
  return { ok: true };
}

// src/server/serverOcr.ts
import Tesseract from "tesseract.js";
var NON_NAME_WORDS = /* @__PURE__ */ new Set([
  "REPUBLIC",
  "OF",
  "KOREA",
  "FOREIGN",
  "NATIONAL",
  "RESIDENCE",
  "CARD",
  "RESIDENT",
  "ALIEN",
  "REGISTRATION",
  "CERTIFICATE",
  "MINISTRY",
  "JUSTICE",
  "NAME",
  "IN",
  "ENGLISH",
  "SEX",
  "COUNTRY",
  "REGION",
  "STATUS",
  "ISSUE",
  "DATE",
  "ISSUED",
  "BY",
  "EXPIRY",
  "PASSPORT",
  "TYPE",
  "CODE",
  "SURNAME",
  "GIVEN",
  "NAMES",
  "NATIONALITY",
  "BIRTH",
  "PLACE",
  "AUTHORITY",
  "HOLDER",
  "SIGNATURE",
  "KINGDOM",
  "CAMBODIA",
  "VIETNAM",
  "NEPAL",
  "UZBEKISTAN",
  "MYANMAR",
  "THAILAND",
  "INDONESIA",
  "PHILIPPINES",
  "CHINA",
  "MONGOLIA",
  "LANKA",
  "SRI",
  "BANGLADESH",
  "PAKISTAN",
  "TEST",
  "PROFICIENCY",
  "KOREAN",
  "TOPIK",
  "SCORE",
  "REPORT",
  "INSTITUTE",
  "INTERNATIONAL",
  "EDUCATION",
  "LEVEL",
  "TOTAL",
  "POINTS",
  "GRADE",
  "VALID",
  "UNTIL",
  "APPLICATION",
  "NUMBER",
  "VERIFICATION",
  "DOCUMENT",
  "IMMIGRATION",
  "SERVICE",
  "OFFICE",
  "CHIEF",
  "BRANCH",
  "MALE",
  "FEMALE",
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
  "NO",
  "REG",
  "THE",
  "AND",
  "FOR",
  "WITH",
  "FROM",
  "THIS",
  "THAT",
  "PERMIT",
  "VISA",
  "WORK",
  "EMPLOYMENT",
  "QUALIFICATION",
  "PERIOD",
  "STAY",
  "ADDRESS",
  "CHANGE",
  "REPORTED",
  "IA",
  "DIA",
  "ODIA",
  "BODIA",
  "MBODIA",
  "AMBODIA",
  "CAMBOD",
  "CAMBODIAN",
  "NESIA",
  "BIOMETRIC",
  "DIPLOMATIC",
  "ORDINARY",
  "ISSUING",
  "EXPIRATION",
  "GENDER",
  "BIRTHDATE",
  "OI",
  "II",
  "IL",
  "LI",
  "OO",
  "EE",
  "SS",
  "MM",
  "NN",
  "CC",
  "GG",
  "UU",
  "RR",
  "TT",
  "PP",
  "AA",
  "DD",
  "FF",
  "HH",
  "JJ",
  "KK",
  "VV",
  "WW",
  "XX",
  "YY",
  "ZZ",
  "ID",
  "KR",
  "RO",
  "OK",
  "ROK",
  "CK",
  "KL",
  "LC",
  "KC",
  "CL",
  "LK",
  "CKL",
  "KLC",
  "CCC",
  "KKK",
  "LLL",
  "III",
  "OOO",
  "XXX"
]);
function normalizeKoreanAdminSpacing(text) {
  return text.replace(/충\s*청\s*남\s*도/g, "\uCDA9\uCCAD\uB0A8\uB3C4").replace(/충\s*청\s*북\s*도/g, "\uCDA9\uCCAD\uBD81\uB3C4").replace(/경\s*기\s*도/g, "\uACBD\uAE30\uB3C4").replace(/경\s*상\s*남\s*도/g, "\uACBD\uC0C1\uB0A8\uB3C4").replace(/경\s*상\s*북\s*도/g, "\uACBD\uC0C1\uBD81\uB3C4").replace(/전\s*라\s*남\s*도/g, "\uC804\uB77C\uB0A8\uB3C4").replace(/전\s*라\s*북\s*도/g, "\uC804\uB77C\uBD81\uB3C4").replace(/전\s*북\s*특\s*별\s*자\s*치\s*도/g, "\uC804\uBD81\uD2B9\uBCC4\uC790\uCE58\uB3C4").replace(/강\s*원\s*특\s*별\s*자\s*치\s*도/g, "\uAC15\uC6D0\uD2B9\uBCC4\uC790\uCE58\uB3C4").replace(/강\s*원\s*도/g, "\uAC15\uC6D0\uB3C4").replace(/제\s*주\s*특\s*별\s*자\s*치\s*도/g, "\uC81C\uC8FC\uD2B9\uBCC4\uC790\uCE58\uB3C4").replace(/서\s*울\s*특\s*별\s*시/g, "\uC11C\uC6B8\uD2B9\uBCC4\uC2DC").replace(/인\s*천\s*광\s*역\s*시/g, "\uC778\uCC9C\uAD11\uC5ED\uC2DC").replace(/부\s*산\s*광\s*역\s*시/g, "\uBD80\uC0B0\uAD11\uC5ED\uC2DC").replace(/대\s*구\s*광\s*역\s*시/g, "\uB300\uAD6C\uAD11\uC5ED\uC2DC").replace(/광\s*주\s*광\s*역\s*시/g, "\uAD11\uC8FC\uAD11\uC5ED\uC2DC").replace(/대\s*전\s*광\s*역\s*시/g, "\uB300\uC804\uAD11\uC5ED\uC2DC").replace(/울\s*산\s*광\s*역\s*시/g, "\uC6B8\uC0B0\uAD11\uC5ED\uC2DC").replace(/세\s*종\s*특\s*별\s*자\s*치\s*시/g, "\uC138\uC885\uD2B9\uBCC4\uC790\uCE58\uC2DC").replace(/번\s+길/g, "\uBC88\uAE38").replace(/체\s*류\s*지/g, "\uCCB4\uB958\uC9C0");
}
var MONTH_NAME_MAP = {
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
function isValidYmd(y, m, d, minYear = 1920, maxYear = 2045) {
  return y >= minYear && y <= maxYear && m >= 1 && m <= 12 && d >= 1 && d <= 31;
}
function parseFlexibleDate(raw, minYear = 1920, maxYear = 2045) {
  if (!raw) return null;
  const s = String(raw).trim();
  const ymd = s.match(/(\d{4})\s*[.\-년/]\s*(\d{1,2})\s*[.\-월/]\s*(\d{1,2})/);
  if (ymd) {
    const y = parseInt(ymd[1], 10);
    const m = parseInt(ymd[2], 10);
    const d = parseInt(ymd[3], 10);
    if (isValidYmd(y, m, d, minYear, maxYear)) {
      return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    }
  }
  const ymdSpace = s.match(/\b(\d{4})\s+(\d{1,2})\s+(\d{1,2})\b/);
  if (ymdSpace) {
    const y = parseInt(ymdSpace[1], 10);
    const m = parseInt(ymdSpace[2], 10);
    const d = parseInt(ymdSpace[3], 10);
    if (isValidYmd(y, m, d, minYear, maxYear)) {
      return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    }
  }
  const dmyEn = s.match(/\b(\d{1,2})\s+([A-Za-z]{3,9})[.,]?\s+(\d{4})\b/);
  if (dmyEn) {
    const mm = MONTH_NAME_MAP[dmyEn[2].toLowerCase().slice(0, 3)];
    const y = parseInt(dmyEn[3], 10);
    const d = parseInt(dmyEn[1], 10);
    if (mm && isValidYmd(y, parseInt(mm, 10), d, minYear, maxYear)) {
      return `${y}-${mm}-${String(d).padStart(2, "0")}`;
    }
  }
  const mdyEn = s.match(/\b([A-Za-z]{3,9})[.,]?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b/);
  if (mdyEn) {
    const mm = MONTH_NAME_MAP[mdyEn[1].toLowerCase().slice(0, 3)];
    const y = parseInt(mdyEn[3], 10);
    const d = parseInt(mdyEn[2], 10);
    if (mm && isValidYmd(y, parseInt(mm, 10), d, minYear, maxYear)) {
      return `${y}-${mm}-${String(d).padStart(2, "0")}`;
    }
  }
  const compact = s.match(/\b((?:19|20)\d{2})(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])\b/);
  if (compact) {
    const y = parseInt(compact[1], 10);
    const m = parseInt(compact[2], 10);
    const d = parseInt(compact[3], 10);
    if (isValidYmd(y, m, d, minYear, maxYear)) {
      return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    }
  }
  return null;
}
function extractAllDatesInText(text, minYear = 2010, maxYear = 2040) {
  if (!text) return [];
  const found = [];
  const patterns = [
    /(\d{4})\s*[.\-년/]\s*(\d{1,2})\s*[.\-월/]\s*(\d{1,2})(?:\s*일)?/g,
    /\b(\d{1,2})\s+([A-Za-z]{3,9})[.,]?\s+(\d{4})\b/g,
    /\b([A-Za-z]{3,9})[.,]?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b/g,
    /\b((?:19|20)\d{2})(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])\b/g
  ];
  for (const regex of patterns) {
    let m;
    while ((m = regex.exec(text)) !== null) {
      const parsed = parseFlexibleDate(m[0], minYear, maxYear);
      if (parsed) {
        const [y, mo, da] = parsed.split("-").map((v) => parseInt(v, 10));
        const ts = new Date(y, mo - 1, da).getTime();
        const overlap = found.some((f) => Math.abs(f.index - m.index) < 4 && f.date === parsed);
        if (!overlap) {
          found.push({
            date: parsed,
            ts,
            index: m.index,
            endIndex: m.index + m[0].length
          });
        }
      }
    }
  }
  found.sort((a, b) => a.index - b.index);
  return found;
}
function filterValidNameWords(rawPhrase, requireLongWord = false) {
  const cleaned = rawPhrase.toUpperCase().replace(/[^A-Z\s]/g, " ").replace(/\s+/g, " ").trim();
  if (!cleaned) return null;
  const words = cleaned.split(" ").filter((w) => w.length >= 2 && !NON_NAME_WORDS.has(w));
  if (words.length >= 2 && words.length <= 4) {
    const minNeeded = requireLongWord ? 4 : 3;
    if (words.some((w) => w.length >= minNeeded)) {
      return words.join(" ");
    }
  }
  return null;
}
function findArcRegNumber(text) {
  if (!text) return null;
  const cleanMatch = text.match(/\b(\d{6})\s*[-–~._:/\s]*([1-8]\d{6})\b/);
  if (cleanMatch && cleanMatch.index !== void 0) {
    return {
      reg1: cleanMatch[1],
      reg2: cleanMatch[2],
      matchIndex: cleanMatch.index,
      matchLength: cleanMatch[0].length
    };
  }
  const tokenRegex = /\b([0-9OIlSB]{6})\s*[-–~._:/\s]+\s*([1-8OIlSB][0-9OIlSB]{6})\b/g;
  let m;
  while ((m = tokenRegex.exec(text)) !== null) {
    const fix = (s) => s.replace(/O/gi, "0").replace(/[Il|]/g, "1").replace(/S/gi, "5").replace(/B/gi, "8");
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
          matchLength: m[0].length
        };
      }
    }
  }
  return null;
}
var ARC_BACK_BOILERPLATE_REGEX = /시[·.\s]*군[·.\s]*구|출입국|외국인(?:관서|청|사무소|등록증)|새로운\s*체류지|신고하여야|신고하지|범칙금|과태료|지방출입국|14일\s*이내|변경된\s*날|전입신고|관할|허가기간|체류기간\s*연장|확인\s*인|담당자/;
function parseArcReportDateTs(line) {
  const m = line.match(/(\d{4}|\d{2})\s*[.\-년/]\s*(\d{1,2})\s*[.\-월/]\s*(\d{1,2})/);
  if (!m) return 0;
  let y = parseInt(m[1], 10);
  if (y < 100) y += 2e3;
  const mo = parseInt(m[2], 10);
  const da = parseInt(m[3], 10);
  if (y >= 2010 && y <= 2035 && mo >= 1 && mo <= 12 && da >= 1 && da <= 31) {
    return new Date(y, mo - 1, da).getTime();
  }
  return 0;
}
function extractKoreanAddress(rawCorpus) {
  if (!rawCorpus) return null;
  const textCorpus = normalizeKoreanAdminSpacing(rawCorpus);
  const rawLines = textCorpus.split(/[\r\n<>]+/).map((l) => l.trim()).filter((l) => l.length > 0);
  const addrStartRegex = /((?:서울특별시|서울시|서울|부산광역시|부산시|부산|대구광역시|대구시|대구|인천광역시|인천시|인천|광주광역시|광주시|광주|대전광역시|대전시|대전|울산광역시|울산시|울산|세종특별자치시|세종시|세종|경기도|경기|강원특별자치도|강원도|강원|충청북도|충북|충청남도|충남|전북특별자치도|전라북도|전북|전라남도|전남|경상북도|경북|경상남도|경남|제주특별자치도|제주도|제주)\s*[가-힣0-9][가-힣0-9\s\-~,()./]+|[가-힣]{2,6}(?:시|군)\s+[가-힣]{1,12}(?:구|읍|면|동|로|길|가)\s*[가-힣0-9\s\-~,()./]*)/;
  const candidates = [];
  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i];
    if (line.length < 4 || ARC_BACK_BOILERPLATE_REGEX.test(line)) {
      continue;
    }
    const sameLineTs = parseArcReportDateTs(line);
    const strippedLine = line.replace(/^[\s|[\]()·•\-]*(?:\d{4}|\d{2})\s*[.\-년/]\s*\d{1,2}\s*[.\-월/]\s*\d{1,2}\s*[.\-일]?\s*/, "").replace(/^(?:체류지|국내거소|주소|변경사항|신고일|신고일자|거소지|Address)\s*[:：|]?\s*/gi, "").trim();
    const match = strippedLine.match(addrStartRegex);
    if (!match) continue;
    let cleanAddr = match[1].replace(/^(?:체류지|국내거소|주소|변경사항|신고일|신고일자)\s*[:：]?\s*/g, "").replace(/\s+(?:확인|담당|인|서명|신고|접수)\s*$/, "").replace(/\s+/g, " ").trim();
    const looksLikeKoreanAddr = /(?:시|군|구|읍|면|동|리|로|길|가|번지|번길|\d+)/.test(cleanAddr) && cleanAddr.length >= 6;
    if (!looksLikeKoreanAddr || ARC_BACK_BOILERPLATE_REGEX.test(cleanAddr)) continue;
    for (let contOffset = 1; contOffset <= 2; contOffset++) {
      if (i + contOffset >= rawLines.length) break;
      const nextLine = rawLines[i + contOffset];
      if (!nextLine || nextLine.length < 2 || nextLine.length > 45) break;
      if (parseArcReportDateTs(nextLine) > 0) break;
      if (addrStartRegex.test(nextLine)) break;
      if (ARC_BACK_BOILERPLATE_REGEX.test(nextLine)) break;
      if (/^(?:체류지|변경사항|신고일|신고일자|확인|국내거소|체류기간|만료일자)/.test(nextLine)) break;
      if (/(?:\d+|번길|로|길|동|호|층|읍|면|리|아파트|빌라|오피스텔|원룸|기숙사|\([가-힣0-9\s]+\))/.test(nextLine)) {
        const cont = nextLine.replace(/[^가-힣0-9A-Za-z\s\-~,().]/g, " ").replace(/\s+(?:확인|담당|인)\s*$/, "").replace(/\s+/g, " ").trim();
        if (cont.length >= 2 && !cleanAddr.includes(cont)) {
          cleanAddr = `${cleanAddr} ${cont}`.replace(/\s+/g, " ").trim();
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
    withDates.sort((a, b) => b.timestamp - a.timestamp || b.lineIndex - a.lineIndex);
    return withDates[0].address;
  }
  return candidates[candidates.length - 1].address;
}
function extractMrzName(text) {
  if (!text) return null;
  const upper = text.toUpperCase();
  const m = upper.match(
    /P[A-Z0-9<«(\s]{0,2}(?:KHM|VNM|NPL|UZB|MMR|THA|IDN|PHL|CHN|MNG|LKA|BGD|PAK|IND|KAZ|KGZ|TLS|LAO)([A-Z0-9<«\s]{5,42})/
  );
  if (m) {
    const tail = m[1].replace(/«/g, "<").trim();
    const parts = tail.split(/<{2,}/).map((s) => s.replace(/</g, " ").replace(/\b[CKL]{3,}\b/g, " ").replace(/[CKL]{4,}$/g, "").trim()).filter((s) => s.length >= 2);
    if (parts.length >= 2) {
      const candidate = filterValidNameWords(`${parts[0]} ${parts[1]}`);
      if (candidate) return candidate;
    }
  }
  return null;
}
function extractLabeledName(text) {
  if (!text) return null;
  const lines = text.split(/[\r\n<>]+/).map((l) => l.trim()).filter(Boolean);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/(?:성\s*명|영문성명|Name\s*in\s*English|\bName\b|\bSurname\b)/i.test(line)) {
      const same = line.replace(/[가-힣()/:：,]+/g, " ").replace(/\b(?:Name|in|English|Date|of|Birth|Sex|Gender|Male|Female|Surname|Given|Names|Registration|No|Country|Region|Nationality|Cambodia)\b/gi, " ");
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
function extractStrictUppercaseName(text) {
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
function extractTopikRound(topikText, combined) {
  const isValidRound = (val) => {
    const num = parseInt(val.replace(/[^0-9]/g, ""), 10);
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
    const labelRegex = /(?:시\s*행\s*회\s*차|시\s*험\s*회\s*차|응\s*시\s*회\s*차|회\s*차|차\s*수|Test\s*(?:Held|Number|No\.?)|Round|Edition)/gi;
    let lm;
    while ((lm = labelRegex.exec(src)) !== null) {
      const windowStr = src.slice(lm.index + lm[0].length, lm.index + lm[0].length + 60);
      const cutWindow = windowStr.split(/(?:수\s*험\s*번\s*호|생\s*년\s*월\s*일|문\s*서\s*확\s*인|Registration|Birth)/i)[0];
      const valMatch = cutWindow.match(/(?:제\s*)?(\d{1,3})(?:\s*[회희외화]|(?:\s*(?:st|nd|rd|th))?\b)/i);
      if (valMatch) {
        const v = isValidRound(valMatch[1]);
        if (v) return v;
      }
    }
    const enMatch = src.match(/The\s*(\d{1,3})(?:st|nd|rd|th)\s*(?:Test|TOPIK|Korean)?/i) || src.match(/\b(\d{2,3})(?:st|nd|rd|th)\s*(?:Test|TOPIK)\b/i);
    if (enMatch) {
      const v = isValidRound(enMatch[1]);
      if (v) return v;
    }
  }
  return null;
}
function extractTopikDates(topikText) {
  const out = {};
  if (!topikText) return out;
  const examLabelRegex = /(?:시\s*험\s*일(?:\s*자|\s*시)?|시\s*행\s*일(?:\s*자)?|응\s*시\s*일(?:\s*자)?|Test\s*Date|Date\s*of\s*Test|Exam\s*Date)/gi;
  let em;
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
  if (!out.examDate) {
    const paired1 = topikText.match(/(\d{4}[.\-\s/]+\d{1,2}[.\-\s/]+\d{1,2})\s*\([제\s]*\d{1,3}\s*회/);
    const paired2 = topikText.match(/제\s*\d{1,3}\s*회[^\n]{0,25}?(\d{4}[.\-\s/]+\d{1,2}[.\-\s/]+\d{1,2})/);
    const parsed = parseFlexibleDate(paired1?.[1] || paired2?.[1] || "", 2012, 2035);
    if (parsed) out.examDate = parsed;
  }
  const validLabelRegex = /(?:성\s*적\s*유\s*효\s*기\s*간|유\s*효\s*기\s*간|유\s*효\s*일(?:\s*자)?|만\s*료\s*일(?:\s*자)?|Valid\s*(?:Until|Period|Thru|Through|Date)|Date\s*of\s*Expiration|Expiration\s*Date)/gi;
  let vm;
  while ((vm = validLabelRegex.exec(topikText)) !== null) {
    const windowStr = topikText.slice(vm.index + vm[0].length, vm.index + vm[0].length + 100);
    const cutWindow = windowStr.split(
      /(?:취\s*득\s*등\s*급|등\s*급|총\s*점|발\s*급\s*일|발\s*행\s*일|Issue\s*Date|Print\s*Date|수\s*험\s*번\s*호|생\s*년\s*월\s*일|Birth)/i
    )[0];
    const dates = extractAllDatesInText(cutWindow, 2014, 2040);
    if (dates.length > 0) {
      out.validUntil = dates[dates.length - 1].date;
      break;
    }
  }
  if (!out.validUntil) {
    const tildeMatch = topikText.match(/[~～]\s*(\d{4}\s*[.\-년/]\s*\d{1,2}\s*[.\-월/]\s*\d{1,2})(?:\s*일)?(?:\s*까지)?/);
    if (tildeMatch) {
      const parsed = parseFlexibleDate(tildeMatch[1], 2014, 2040);
      if (parsed) out.validUntil = parsed;
    }
  }
  if (!out.examDate || !out.validUntil) {
    const allDates = extractAllDatesInText(topikText, 2015, 2040).filter((d) => {
      const before = topikText.slice(Math.max(0, d.index - 28), d.index);
      if (/(?:생\s*년\s*월\s*일|Date\s*of\s*Birth|Birth|발\s*급\s*일|발\s*행\s*일|출\s*력\s*일|Issue\s*Date|Print\s*Date)/i.test(before)) {
        return false;
      }
      return true;
    });
    const uniqueByDate = Array.from(new Map(allDates.map((d) => [d.date, d])).values()).sort((a, b) => a.ts - b.ts);
    const DAY_MS = 24 * 60 * 60 * 1e3;
    if (out.examDate && !out.validUntil) {
      const [ey, em2, ed] = out.examDate.split("-").map((n) => parseInt(n, 10));
      const examTs = new Date(ey, em2 - 1, ed).getTime();
      const matchValid = uniqueByDate.find((d) => {
        const diffDays = (d.ts - examTs) / DAY_MS;
        return diffDays >= 500 && diffDays <= 900;
      });
      if (matchValid) out.validUntil = matchValid.date;
    } else if (!out.examDate && out.validUntil) {
      const [vy, vm2, vd] = out.validUntil.split("-").map((n) => parseInt(n, 10));
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
function parseStructuredTextCorpus(params) {
  const {
    arcFrontText = "",
    arcBackText = "",
    topikText = "",
    passportText = ""
  } = params;
  const combined = `${arcFrontText}
${arcBackText}
${topikText}
${passportText}`;
  const result = {};
  const arcAndPassport = `${arcFrontText}
${arcBackText}
${passportText}`;
  const regFound = findArcRegNumber(arcFrontText) || findArcRegNumber(arcAndPassport);
  let adjacentName = null;
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
  const detectedName = extractMrzName(passportText) || extractMrzName(combined) || extractLabeledName(topikText) || extractLabeledName(passportText) || extractLabeledName(arcFrontText) || adjacentName || extractStrictUppercaseName(topikText) || extractStrictUppercaseName(passportText) || extractStrictUppercaseName(arcFrontText);
  if (detectedName) {
    result.name = detectedName;
    result.applicantName = detectedName;
  }
  if (regFound) {
    result.regNumber1 = regFound.reg1;
    result.regNumber2 = regFound.reg2;
  }
  if (result.regNumber2) {
    const firstDigit = result.regNumber2.charAt(0);
    if (["1", "3", "5", "7"].includes(firstDigit)) result.gender = "\uB0A8";
    else if (["2", "4", "6", "8"].includes(firstDigit)) result.gender = "\uC5EC";
  }
  const natMatch = combined.match(
    /\b(CAMBODIA|VIETNAM|NEPAL|UZBEKISTAN|MYANMAR|THAILAND|INDONESIA|PHILIPPINES|CHINA|MONGOLIA|SRI\s*LANKA|BANGLADESH|PAKISTAN)\b/i
  );
  if (natMatch) {
    const rawNat = natMatch[1].toUpperCase();
    result.nationality = rawNat.charAt(0) + rawNat.slice(1).toLowerCase();
  } else if (/KHM|캄보디아/.test(combined)) {
    result.nationality = "Cambodia";
  }
  const visaMatch = arcFrontText.match(/\b(E-?9-?1|E-?7-?4|E-?7-?1|E-?9|E-?7|F-?2-?R|F-?2|F-?5|F-?6|D-?2|D-?4|D-?10|H-?2)\b/i) || combined.match(/(?:체\s*류\s*자\s*격|Status)[^\nA-Za-z0-9]{0,12}([A-Z]\s*[-–]?\s*\d(?:\s*[-–]?\s*[A-Z0-9])?)/i);
  if (visaMatch) {
    let v = visaMatch[1].toUpperCase().replace(/\s+/g, "");
    if (/^E91$/.test(v)) v = "E-9-1";
    else if (/^E74$/.test(v)) v = "E-7-4";
    else if (/^E71$/.test(v)) v = "E-7-1";
    else if (/^F2R$/.test(v)) v = "F-2-R";
    result.visaStatus = v;
  }
  const addr = extractKoreanAddress(arcBackText) || extractKoreanAddress(arcFrontText) || extractKoreanAddress(combined);
  if (addr) result.address = addr;
  const docVerCleaned = `${topikText}
${combined}`.replace(/(?<=\d)[oO](?=\d)/g, "0").replace(/(?<=\d)[lI](?=\d)/g, "1");
  const docVer4 = docVerCleaned.match(/(?:문\s*서\s*확\s*인\s*번\s*호|발급확인번호|진위확인번호|Verification\s*(?:No\.?)?)[\s\S]{0,40}?(\d{4})[^\d\n]{1,4}(\d{4})[^\d\n]{1,4}(\d{4})[^\d\n]{1,4}(\d{4})/i) || docVerCleaned.match(/\b(\d{4})[.\-\s–—]{1,3}(\d{4})[.\-\s–—]{1,3}(\d{4})[.\-\s–—]{1,3}(\d{4})\b/);
  if (docVer4) {
    result.docVerificationNo = [docVer4[1], docVer4[2], docVer4[3], docVer4[4]];
  } else {
    const docVer16 = docVerCleaned.match(/(?:문\s*서\s*확\s*인\s*번\s*호|Verification|발급확인|진위확인)[\s\S]{0,40}?(\d{16})/i) || docVerCleaned.match(/\b(\d{16})\b/);
    if (docVer16 && docVer16[1] !== "0000000000000000") {
      const s = docVer16[1];
      result.docVerificationNo = [s.slice(0, 4), s.slice(4, 8), s.slice(8, 12), s.slice(12, 16)];
    }
  }
  const examMatch = topikText.match(/(?:수\s*험\s*번\s*호|Registration\s*(?:No\.?)?|Examinee(?:\s*No\.?)?|Application\s*(?:No\.?)?)[\s\S]{0,45}?(\d{8,16})/i) || topikText.match(/\b(0\d{10,14})\b/) || combined.match(/\b(00\d{11,13})\b/) || topikText.match(/\b(\d{11,14})\b/);
  if (examMatch) {
    const digits = examMatch[1].replace(/[^0-9]/g, "");
    if (digits.length >= 6 && !/^0+$/.test(digits)) result.examNumber = digits;
  }
  const detectedRound = extractTopikRound(topikText, combined);
  if (detectedRound) {
    result.round = detectedRound;
  }
  const gradeMatch = topikText.match(/(?:취\s*득\s*등\s*급|합\s*격\s*등\s*급|등\s*급|Grade|Level)[\s\S]{0,35}?([1-6])\s*급/i) || topikText.match(/(?:취\s*득\s*등\s*급|합\s*격\s*등\s*급|등\s*급|Grade|Level)[^\d\n]{0,20}([1-6])\b/i) || topikText.match(/([1-6])\s*급/) || combined.match(/(?:취득등급|합격등급|등급)[^\d\n]{0,12}([1-6])/i);
  if (gradeMatch) {
    result.grade = `${gradeMatch[1]}\uAE09`;
  } else {
    const scoreMatch = topikText.match(/(?:총\s*점|Total\s*Score|점\s*수)[\s\S]{0,25}?(\d{2,3})/i);
    if (scoreMatch) {
      const score = parseInt(scoreMatch[1], 10);
      const isTopikI = /\bTOPIK\s*I\b(?!I)/i.test(topikText);
      if (isTopikI) {
        if (score >= 140) result.grade = "2\uAE09";
        else if (score >= 80) result.grade = "1\uAE09";
      } else {
        if (score >= 230) result.grade = "6\uAE09";
        else if (score >= 190) result.grade = "5\uAE09";
        else if (score >= 150) result.grade = "4\uAE09";
        else if (score >= 120) result.grade = "3\uAE09";
        else if (score >= 80) result.grade = "1\uAE09";
      }
    }
  }
  if (topikText && topikText.trim().length > 0) {
    const topikDates = extractTopikDates(topikText);
    if (topikDates.examDate) result.examDate = topikDates.examDate;
    if (topikDates.validUntil) result.validUntil = topikDates.validUntil;
  }
  const mrzLine2 = combined.match(/([A-Z0-9<]{9})\d[A-Z]{3}(\d{6})\d([MF<])(\d{6})/);
  if (mrzLine2) {
    const rawPassNo = mrzLine2[1].replace(/</g, "").trim();
    if (rawPassNo.length >= 6) result.passportNo = rawPassNo;
    if (!result.regNumber1 && /^\d{6}$/.test(mrzLine2[2])) result.regNumber1 = mrzLine2[2];
    const expRaw = mrzLine2[4];
    if (/^\d{6}$/.test(expRaw)) {
      result.passportExpiry = `${2e3 + parseInt(expRaw.slice(0, 2), 10)}-${expRaw.slice(2, 4)}-${expRaw.slice(4, 6)}`;
    }
  }
  if (!result.passportNo) {
    const passMatch = passportText.match(/\b([A-Z]{1,2}\d{7,8})\b/) || combined.match(/(?:여\s*권\s*번\s*호|Passport\s*No)[^\nA-Z0-9]{0,12}([A-Z]{1,2}\d{7,8})/i);
    if (passMatch) result.passportNo = passMatch[1].toUpperCase();
  }
  return result;
}
async function recognizeDataUrlServer(dataUrl, langSpec) {
  if (!dataUrl || typeof dataUrl !== "string") return "";
  if (dataUrl.startsWith("data:image/svg+xml")) {
    try {
      if (dataUrl.includes(";base64,")) {
        return Buffer.from(dataUrl.split(";base64,")[1], "base64").toString("utf8");
      }
      if (dataUrl.includes(",")) {
        return decodeURIComponent(dataUrl.split(",")[1]);
      }
    } catch {
      return "";
    }
  }
  if (dataUrl.startsWith("data:application/pdf")) {
    return "";
  }
  const commaIdx = dataUrl.indexOf(",");
  if (commaIdx === -1) return "";
  const base64 = dataUrl.slice(commaIdx + 1).replace(/\s/g, "");
  if (!base64 || base64.length < 100) return "";
  try {
    const buf = Buffer.from(base64, "base64");
    const ocrPromise = Tesseract.recognize(buf, langSpec);
    const timeoutPromise = new Promise(
      (resolve) => setTimeout(() => resolve({ data: { text: "" } }), 2e4)
    );
    const res = await Promise.race([ocrPromise, timeoutPromise]);
    return res?.data?.text || "";
  } catch (err) {
    console.warn(`[Server OCR] Tesseract (${langSpec}) error:`, err);
    return "";
  }
}
async function runServerSideOcrFallback(input) {
  const pdfTexts = input.pdfTexts || {};
  const [arcFrontOcr, arcBackOcr, topikOcr, passportOcr] = await Promise.all([
    input.arcFront ? recognizeDataUrlServer(input.arcFront, "eng") : Promise.resolve(""),
    input.arcBack ? recognizeDataUrlServer(input.arcBack, "kor+eng") : Promise.resolve(""),
    input.topikCert ? recognizeDataUrlServer(input.topikCert, "kor+eng") : Promise.resolve(""),
    input.passport ? recognizeDataUrlServer(input.passport, "eng") : Promise.resolve("")
  ]);
  const arcFrontText = [pdfTexts.arcFront || "", arcFrontOcr].filter(Boolean).join("\n");
  const arcBackText = [pdfTexts.arcBack || "", arcBackOcr].filter(Boolean).join("\n");
  const topikText = [pdfTexts.topikCert || "", topikOcr].filter(Boolean).join("\n");
  const passportText = [pdfTexts.passport || "", passportOcr].filter(Boolean).join("\n");
  const data = parseStructuredTextCorpus({
    arcFrontText,
    arcBackText,
    topikText,
    passportText
  });
  const rawTextPreview = [
    arcFrontText ? `[ARC Front]
${arcFrontText}` : "",
    arcBackText ? `[ARC Back]
${arcBackText}` : "",
    topikText ? `[TOPIK]
${topikText}` : "",
    passportText ? `[Passport]
${passportText}` : ""
  ].filter(Boolean).join("\n\n").slice(0, 2500);
  return { data, rawTextPreview };
}

// server.ts
dotenv.config();
dns.setDefaultResultOrder("ipv4first");
getRedeemDb();
function getCliArg(flag) {
  const idx = process.argv.indexOf(flag);
  if (idx !== -1 && idx + 1 < process.argv.length && !process.argv[idx + 1].startsWith("-")) {
    return process.argv[idx + 1];
  }
  const prefix = `${flag}=`;
  const eqArg = process.argv.find((arg) => arg.startsWith(prefix));
  return eqArg ? eqArg.slice(prefix.length) : void 0;
}
var __dirname = path2.dirname(fileURLToPath(import.meta.url));
var app = express();
app.disable("x-powered-by");
var cliPort = getCliArg("--port") || getCliArg("-p");
var cliHost = getCliArg("--host");
var port = parseInt(cliPort || process.env.PORT || "3000", 10);
var host = cliHost || process.env.HOST || "0.0.0.0";
function isSameHostOrigin(origin, hostHeader) {
  if (!origin || !hostHeader) return false;
  try {
    const originHost = new URL(origin).host.toLowerCase();
    const expectedHost = String(Array.isArray(hostHeader) ? hostHeader[0] : hostHeader).split(",")[0].trim().toLowerCase();
    return Boolean(originHost && expectedHost && originHost === expectedHost);
  } catch {
    return false;
  }
}
function isRequestHttps(req) {
  const xfProto = String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim().toLowerCase();
  return req.secure || xfProto === "https";
}
function parseCookies(req) {
  const raw = String(req.headers.cookie || "");
  const out = {};
  if (!raw) return out;
  for (const part of raw.split(";")) {
    const eqIdx = part.indexOf("=");
    if (eqIdx === -1) continue;
    const key = part.slice(0, eqIdx).trim();
    const val = part.slice(eqIdx + 1).trim();
    if (!key) continue;
    try {
      out[key] = decodeURIComponent(val);
    } catch {
      out[key] = val;
    }
  }
  return out;
}
function setHttpOnlyCookie(req, res, name, value, maxAgeSeconds) {
  const https = isRequestHttps(req);
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    "Path=/",
    `Max-Age=${Math.max(0, Math.floor(maxAgeSeconds))}`,
    "HttpOnly",
    https ? "SameSite=None" : "SameSite=Lax"
  ];
  if (https) {
    parts.push("Secure", "Partitioned");
  }
  res.append("Set-Cookie", parts.join("; "));
}
function clearHttpOnlyCookie(req, res, name) {
  const https = isRequestHttps(req);
  const parts = [
    `${name}=`,
    "Path=/",
    "Max-Age=0",
    "HttpOnly",
    https ? "SameSite=None" : "SameSite=Lax"
  ];
  if (https) {
    parts.push("Secure", "Partitioned");
  }
  res.append("Set-Cookie", parts.join("; "));
}
function getRateLimitIp(req) {
  const trustedProxyIp = req.headers["cf-connecting-ip"] || req.headers["x-appengine-user-ip"];
  if (typeof trustedProxyIp === "string" && trustedProxyIp.trim()) {
    return trustedProxyIp.trim().slice(0, 64);
  }
  const raw = String(req.socket?.remoteAddress || req.ip || "unknown").trim();
  return raw.startsWith("::ffff:") ? raw.slice(7) : raw;
}
function createRateLimiter(options) {
  const buckets = /* @__PURE__ */ new Map();
  return (req, res, next) => {
    const now = Date.now();
    const ip = getRateLimitIp(req);
    const key = `${ip}:${req.baseUrl || ""}${req.path}`;
    const cutoff = now - options.windowMs;
    const recent = (buckets.get(key) || []).filter((ts) => ts > cutoff);
    if (recent.length >= options.maxRequests) {
      return res.status(429).json({
        success: false,
        error: options.errorMessage
      });
    }
    recent.push(now);
    buckets.set(key, recent);
    if (buckets.size > 5e3) {
      for (const [k, list] of buckets.entries()) {
        const active = list.filter((ts) => ts > cutoff);
        if (active.length === 0) buckets.delete(k);
        else buckets.set(k, active);
      }
    }
    next();
  };
}
var adminAuthRateLimiter = createRateLimiter({
  maxRequests: 15,
  windowMs: 15 * 60 * 1e3,
  errorMessage: "\u1796\u17D2\u1799\u17B6\u1799\u17B6\u1798\u1785\u17BC\u179B Admin \u1785\u17D2\u179A\u17BE\u1793\u178A\u1784\u1796\u17C1\u1780! \u179F\u17BC\u1798\u179A\u1784\u17CB\u1785\u17B6\u17C6 \u17E1\u17E5 \u1793\u17B6\u1791\u17B8\u179F\u17B7\u1793\u17D4"
});
var userAuthRateLimiter = createRateLimiter({
  maxRequests: 25,
  windowMs: 15 * 60 * 1e3,
  errorMessage: "\u179F\u17C6\u178E\u17BE\u1785\u17BC\u179B\u1782\u178E\u1793\u17B8\u1785\u17D2\u179A\u17BE\u1793\u178A\u1784\u1796\u17C1\u1780! \u179F\u17BC\u1798\u179A\u1784\u17CB\u1785\u17B6\u17C6\u1794\u1793\u17D2\u178F\u17B7\u1785\u179A\u17BD\u1785\u1796\u17D2\u1799\u17B6\u1799\u17B6\u1798\u1798\u17D2\u178F\u1784\u1791\u17C0\u178F\u17D4"
});
var paymentRateLimiter = createRateLimiter({
  maxRequests: 30,
  windowMs: 15 * 60 * 1e3,
  errorMessage: "\u1796\u17D2\u1799\u17B6\u1799\u17B6\u1798\u1795\u17D2\u1791\u17C0\u1784\u1795\u17D2\u1791\u17B6\u178F\u17CB\u1780\u17B6\u179A\u1794\u1784\u17CB\u1794\u17D2\u179A\u17B6\u1780\u17CB\u1785\u17D2\u179A\u17BE\u1793\u178A\u1784\u1796\u17C1\u1780! \u179F\u17BC\u1798\u179A\u1784\u17CB\u1785\u17B6\u17C6\u1794\u1793\u17D2\u178F\u17B7\u1785\u17D4"
});
var aiApiRateLimiter = createRateLimiter({
  maxRequests: 35,
  windowMs: 5 * 60 * 1e3,
  errorMessage: "\u1794\u17D2\u179A\u1796\u17D0\u1793\u17D2\u1792\u179F\u17D2\u1780\u17C1\u1793 OCR / AI \u1791\u1791\u17BD\u179B\u179F\u17C6\u178E\u17BE\u1785\u17D2\u179A\u17BE\u1793\u1796\u17C1\u1780\u1794\u178E\u17D2\u178F\u17C4\u17C7\u17A2\u17B6\u179F\u1793\u17D2\u1793! \u179F\u17BC\u1798\u179A\u1784\u17CB\u1785\u17B6\u17C6\u1794\u1793\u17D2\u178F\u17B7\u1785\u17D4"
});
var visitorHeartbeatLimiter = createRateLimiter({
  maxRequests: 60,
  windowMs: 5 * 60 * 1e3,
  errorMessage: "Too many requests."
});
app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(self), microphone=(), geolocation=()");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin-allow-popups");
  res.setHeader(
    "Content-Security-Policy",
    "frame-ancestors 'self' https://aistudio.google.com https://*.google.com https://*.googleusercontent.com"
  );
  res.setHeader("X-DNS-Prefetch-Control", "off");
  next();
});
app.use((req, res, next) => {
  if (!req.path.startsWith("/api") && !req.path.startsWith("/download-") && !req.path.endsWith(".zip")) {
    return next();
  }
  const origin = req.headers.origin;
  const hostHeader = req.headers["x-forwarded-host"] || req.headers.host;
  const sameOrigin = isSameHostOrigin(origin, hostHeader);
  if (sameOrigin && origin) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") {
    if (origin && !sameOrigin) {
      return res.sendStatus(403);
    }
    return res.sendStatus(204);
  }
  const isSensitiveStateRoute = req.path.startsWith("/api/admin") || req.path.startsWith("/api/auth") || req.path.startsWith("/api/payments");
  if (isSensitiveStateRoute && req.method !== "GET" && req.method !== "HEAD" && origin && !sameOrigin) {
    return res.status(403).json({
      success: false,
      error: "Cross-origin request forbidden."
    });
  }
  next();
});
app.use(express.static(path2.resolve("public")));
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
    const roundNum = parseInt(rawRound, 10);
    if (!Number.isNaN(roundNum) && roundNum >= 1 && roundNum <= 300) {
      result.round = String(roundNum);
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
    const parsedExam = parseFlexibleDate(String(raw.examDate), 2012, 2035);
    if (parsedExam) result.examDate = parsedExam;
  }
  if (raw?.validUntil && !String(raw.validUntil).startsWith("0000")) {
    const rawValid = String(raw.validUntil).trim();
    const endPart = rawValid.includes("~") || rawValid.includes("\uFF5E") ? rawValid.split(/[~～]/).pop() || rawValid : rawValid;
    const parsedValid = parseFlexibleDate(endPart, 2014, 2040) || parseFlexibleDate(rawValid, 2014, 2040);
    if (parsedValid) result.validUntil = parsedValid;
  }
  if (raw?.passportNo) {
    const rawPass = String(raw.passportNo).replace(/[^A-Za-z0-9]/g, "").toUpperCase().trim();
    if (rawPass.length >= 6) {
      result.passportNo = rawPass;
    }
  }
  if (raw?.passportExpiry && !String(raw.passportExpiry).startsWith("0000")) {
    const rawExp = String(raw.passportExpiry).trim();
    const parsedExp = parseFlexibleDate(rawExp, 2015, 2045);
    if (parsedExp) {
      result.passportExpiry = parsedExp;
    } else if (rawExp) {
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
  const examDateMatch = textCorpus.match(/(?:시\s*험\s*일(?:\s*자|\s*시)?|시\s*행\s*일(?:\s*자)?|응\s*시\s*일(?:\s*자)?|Test\s*Date|Exam\s*Date)[\s\S]{0,40}?(\d{4})[.\-\s년/]+(\d{1,2})[.\-\s월/]+(\d{1,2})/i) || textCorpus.match(/(\d{4})[.\-\s]+(\d{2})[.\-\s]+(\d{2})\s*\([제\s]*\d+회/);
  if (examDateMatch) {
    const y = examDateMatch[1];
    const m = examDateMatch[2].padStart(2, "0");
    const d = examDateMatch[3].padStart(2, "0");
    result.examDate = `${y}-${m}-${d}`;
  }
  const roundMatch = textCorpus.match(/(?:제\s*)?(\d{1,3})\s*회/i) || textCorpus.match(/(?:시\s*행\s*회\s*차|시\s*험\s*회\s*차|회\s*차|Test\s*Held|Round)[\s\S]{0,30}?(\d{1,3})/i) || textCorpus.match(/(\d{2,3})(?:st|nd|rd|th)/i);
  if (roundMatch) {
    result.round = roundMatch[1];
  }
  const validRangeMatch = textCorpus.match(
    /(?:성\s*적\s*유\s*효\s*기\s*간|유\s*효\s*기\s*간|Valid\s*(?:Until|Period))[\s\S]{0,60}?[~～]\s*(\d{4})[.\-\s년/]+(\d{1,2})[.\-\s월/]+(\d{1,2})/i
  );
  const validMatch = validRangeMatch || textCorpus.match(/(?:성\s*적\s*유\s*효\s*기\s*간|유\s*효\s*기\s*간|Valid\s*Until)[\s\S]{0,40}?(\d{4})[.\-\s년/]+(\d{1,2})[.\-\s월/]+(\d{1,2})/i);
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
app.post("/api/extract-documents", aiApiRateLimiter, async (req, res) => {
  try {
    const { arcFront, arcBack, topikCert, topikCertList, passport, passportList, pdfTexts } = req.body || {};
    const parts = [];
    const textRepresentations = [];
    const firstTopikUrl = topikCert || (Array.isArray(topikCertList) && topikCertList.length > 0 ? typeof topikCertList[0] === "string" ? topikCertList[0] : topikCertList[0]?.dataUrl : null);
    const firstPassportUrl = passport || (Array.isArray(passportList) && passportList.length > 0 ? typeof passportList[0] === "string" ? passportList[0] : passportList[0]?.dataUrl : null);
    if (pdfTexts && typeof pdfTexts === "object") {
      for (const [k, v] of Object.entries(pdfTexts)) {
        if (typeof v === "string" && v.trim()) {
          textRepresentations.push(v.trim());
          parts.push({
            text: `[Extracted PDF Digital Text for ${k}]:
${v.trim().slice(0, 6e3)}`
          });
        }
      }
    }
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
    if (parts.length === 0) {
      return res.json({
        success: false,
        fallbackMode: true,
        notice: "\u179F\u17BC\u1798 Upload \u17AF\u1780\u179F\u17B6\u179A\u1787\u17B6\u1798\u17BB\u1793\u179F\u17B7\u1793 \u1798\u17BB\u1793\u1793\u17B9\u1784\u1785\u17B6\u1794\u17CB\u1795\u17D2\u178F\u17BE\u1798\u179F\u17D2\u1780\u17C1\u1793 OCR\u17D4"
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
7. address: Latest Korean residence address on the back of the card (\uCCB4\uB958\uC9C0 / \uCCB4\uB958\uC9C0 \uBCC0\uACBD\uC0AC\uD56D table). Read EVERY row carefully (including road name \uB3C4\uB85C\uBA85, building number \uAC74\uBB3C\uBC88\uD638, and multi-line wrapped \uB3D9/\uD638 details), ignore the printed fine notice ("\uC0C8\uB85C\uC6B4 \uCCB4\uB958\uC9C0... 14\uC77C \uC774\uB0B4..."), and return ONLY the row with the MOST RECENT \uC2E0\uACE0\uC77C (Report Date) or bottom-most entered row.
8. passportNo: Passport Number (\uC5EC\uAD8C\uBC88\uD638 / Passport No.) if a passport is uploaded.
9. passportExpiry: Passport Date of Expiry formatted as YYYY-MM-DD.

CRITICAL INSTRUCTIONS FOR TOPIK SCORE CERTIFICATE (\uD55C\uAD6D\uC5B4\uB2A5\uB825\uC2DC\uD5D8 \uC131\uC801\uC99D\uBA85\uC11C):
1. docVerificationNo: \uBB38\uC11C\uD655\uC778\uBC88\uD638 (16 digits at top-right header, returned as array of 4 strings of 4 digits each).
2. examNumber: \uC218\uD5D8\uBC88\uD638 (10 to 16 numeric digits in the table).
3. round: \uD68C / \uD68C\uCC28 / \uC2DC\uD589\uD68C\uCC28 numeric digits ONLY (e.g. from "\uC81C 93 \uD68C", "107\uD68C", or "The 93rd Test" extract "93" or "107").
4. examDate: \uC2DC\uD5D8\uC77C / \uC2DC\uD589\uC77C / Test Date formatted STRICTLY as YYYY-MM-DD (NEVER return \uC0DD\uB144\uC6D4\uC77C Birth Date or \uBC1C\uAE09\uC77C Issue Date).
5. validUntil: \uC131\uC801\uC720\uD6A8\uAE30\uAC04 / Valid Until formatted STRICTLY as YYYY-MM-DD. If printed as a range like "2024.05.30 ~ 2026.05.30", ALWAYS return the END/EXPIRATION date ("2026-05-30").
6. grade: \uB4F1\uAE09 (1\uAE09, 2\uAE09, 3\uAE09, 4\uAE09, 5\uAE09, or 6\uAE09).

Return ONLY structured JSON according to the schema.
`;
    parts.push({ text: extractionPrompt });
    const parsedFromPdfTexts = pdfTexts && typeof pdfTexts === "object" ? sanitizeExtractedData(
      parseStructuredTextCorpus({
        arcFrontText: String(pdfTexts.arcFront || ""),
        arcBackText: String(pdfTexts.arcBack || ""),
        topikText: String(pdfTexts.topikCert || ""),
        passportText: String(pdfTexts.passport || "")
      })
    ) : {};
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
        examDate: { type: Type.STRING, description: "TOPIK \uC2DC\uD5D8\uC77C / \uC2DC\uD589\uC77C / Test Date in YYYY-MM-DD format (not birth date)" },
        round: { type: Type.STRING, description: "TOPIK \uC81CXX\uD68C / \uC2DC\uD589\uD68C\uCC28 numeric digits only (e.g. 93 or 107)" },
        validUntil: { type: Type.STRING, description: "TOPIK \uC131\uC801\uC720\uD6A8\uAE30\uAC04 / Valid Until END date in YYYY-MM-DD format" },
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
    const pdfRawPreview = pdfTexts && typeof pdfTexts === "object" ? Object.entries(pdfTexts).filter(([, v]) => typeof v === "string" && v.trim()).map(([k, v]) => `[${k} PDF Text]
${String(v).trim()}`).join("\n\n").slice(0, 2e3) : "";
    if (extractedData) {
      let merged = { ...parsedFromPdfTexts, ...sanitizeExtractedData(extractedData) };
      const needsBackFill = Boolean(arcBack && !merged.address);
      const needsTopikFill = Boolean(
        firstTopikUrl && (!merged.examDate || !merged.validUntil || !merged.round || !merged.examNumber || !merged.grade)
      );
      let rawTextPreview = pdfRawPreview;
      if (needsBackFill || needsTopikFill) {
        try {
          const targetedOcr = await runServerSideOcrFallback({
            arcBack: needsBackFill ? arcBack : null,
            topikCert: needsTopikFill ? firstTopikUrl : null,
            pdfTexts: pdfTexts && typeof pdfTexts === "object" ? pdfTexts : void 0
          });
          const sanitizedTargeted = sanitizeExtractedData(targetedOcr.data);
          merged = { ...sanitizedTargeted, ...merged };
          if (targetedOcr.rawTextPreview) {
            rawTextPreview = [rawTextPreview, targetedOcr.rawTextPreview].filter(Boolean).join("\n\n").slice(0, 3500);
          }
        } catch (gapErr) {
          console.warn("[OCR] Targeted gap-fill notice:", gapErr);
        }
      }
      if (Object.keys(merged).length > 0) {
        return res.json({
          success: true,
          data: merged,
          model: successfulModel,
          ...rawTextPreview ? { rawTextPreview } : {}
        });
      }
    }
    try {
      const ocrFallback = await runServerSideOcrFallback({
        arcFront,
        arcBack,
        topikCert: firstTopikUrl,
        passport: firstPassportUrl,
        pdfTexts: pdfTexts && typeof pdfTexts === "object" ? pdfTexts : void 0
      });
      const sanitizedServerOcr = { ...parsedFromPdfTexts, ...sanitizeExtractedData(ocrFallback.data) };
      if (Object.keys(sanitizedServerOcr).length > 0) {
        console.log("[OCR] Successfully extracted document fields via server-side Tesseract/PDF parser.");
        return res.json({
          success: true,
          data: sanitizedServerOcr,
          model: "server-ocr-tesseract",
          rawTextPreview: ocrFallback.rawTextPreview || pdfRawPreview
        });
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
            model: "server-text-parser",
            rawTextPreview: ocrFallback.rawTextPreview
          });
        }
      }
      return res.json({
        success: false,
        fallbackMode: true,
        rawTextPreview: ocrFallback.rawTextPreview,
        notice: authErrorDetected ? "Please verify GEMINI_API_KEY in Settings > Secrets. Trying browser OCR engine." : "Server OCR did not detect clear fields; trying browser OCR engine.",
        ...lastErrorDetail ? { detail: lastErrorDetail } : {}
      });
    } catch (ocrErr) {
      console.warn("[OCR] Server-side fallback failed:", ocrErr);
      return res.json({
        success: false,
        fallbackMode: true,
        notice: "Using client-side OCR engine for direct image scanning.",
        ...lastErrorDetail ? { detail: lastErrorDetail } : {}
      });
    }
  } catch (error) {
    console.error("Unexpected error during document extraction:", error);
    return res.json({
      success: false,
      fallbackMode: true,
      notice: "Using client-side OCR engine."
    });
  }
});
var UNLOCK_COOKIE_NAME = "kiip_unlock_session";
var UNLOCK_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1e3;
var MASTER_PROMO_CODES = /* @__PURE__ */ new Set(["199621147", "KIIP-199621147", "PROMO-199621147"]);
function issueUnlockToken(method, ref) {
  const payload = Buffer.from(
    JSON.stringify({
      type: "pdf_unlock",
      method: method.slice(0, 40),
      ref: ref.slice(0, 64),
      iat: Date.now(),
      exp: Date.now() + UNLOCK_SESSION_TTL_MS
    })
  ).toString("base64url");
  const sig = crypto2.createHmac("sha256", SESSION_SIGNING_SECRET).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}
function verifyUnlockToken(token) {
  if (!token) return false;
  const parts = token.split(".");
  if (parts.length !== 2) return false;
  const [payload, sig] = parts;
  const expectedSig = crypto2.createHmac("sha256", SESSION_SIGNING_SECRET).update(payload).digest("base64url");
  if (!safeEqualStrings(sig, expectedSig)) return false;
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return Boolean(
      parsed && parsed.type === "pdf_unlock" && typeof parsed.exp === "number" && Date.now() <= parsed.exp
    );
  } catch {
    return false;
  }
}
function grantUnlockCookie(req, res, method, ref) {
  const unlockToken = issueUnlockToken(method, ref);
  setHttpOnlyCookie(
    req,
    res,
    UNLOCK_COOKIE_NAME,
    unlockToken,
    Math.floor(UNLOCK_SESSION_TTL_MS / 1e3)
  );
}
app.get("/api/payments/unlock-status", (req, res) => {
  const cookies = parseCookies(req);
  const unlocked = verifyUnlockToken(cookies[UNLOCK_COOKIE_NAME] || "");
  return res.json({ success: true, unlocked });
});
app.post("/api/payments/aba-session", paymentRateLimiter, (_req, res) => {
  return res.status(501).json({
    success: false,
    error: "ABA automated API session is disabled. Scan the ABA PayWay QR and send your receipt or enter a Redeem Code."
  });
});
app.post("/api/payments/aba-confirm", paymentRateLimiter, (_req, res) => {
  return res.status(501).json({
    success: false,
    error: "Automatic ABA PayWay callback is not active. Please submit your payment screenshot via Telegram Bot / Facebook Page to receive a verified Redeem Code."
  });
});
var issuedUnlockCodes = /* @__PURE__ */ new Map();
app.post("/api/payments/verify-redeem", paymentRateLimiter, (req, res) => {
  const rawCode = String(req.body?.code || "").trim().toUpperCase();
  const userEmail = String(req.body?.userEmail || "").trim().slice(0, 160);
  if (!rawCode) {
    return res.status(400).json({
      success: false,
      error: "\u179F\u17BC\u1798\u1794\u1789\u17D2\u1785\u17BC\u179B\u179B\u17C1\u1781\u1780\u17BC\u178A Promo / Redeem Code!"
    });
  }
  if (MASTER_PROMO_CODES.has(rawCode)) {
    grantUnlockCookie(req, res, "promo", rawCode);
    return res.json({ success: true, type: "promo" });
  }
  try {
    const dbCheck = verifyAndBurnRedeemCode(rawCode, userEmail || "web_user");
    if (dbCheck.ok && dbCheck.record) {
      const issued2 = issuedUnlockCodes.get(rawCode);
      if (issued2) {
        issued2.used = true;
        issued2.usedAt = Date.now();
      }
      grantUnlockCookie(req, res, dbCheck.record.source || "redeem", dbCheck.record.code);
      return res.json({
        success: true,
        type: dbCheck.record.source || "redeem",
        code: dbCheck.record.code,
        status: "Used"
      });
    }
    if (dbCheck.statusCode === 409 || dbCheck.statusCode === 403) {
      return res.status(dbCheck.statusCode).json({
        success: false,
        error: dbCheck.error
      });
    }
  } catch (err) {
    console.error("[RedeemDB] Verification error:", err);
  }
  const issued = issuedUnlockCodes.get(rawCode);
  if (issued) {
    if (issued.used) {
      return res.status(409).json({
        success: false,
        error: "\u179B\u17C1\u1781\u1780\u17BC\u178A\u178A\u17C4\u17C7\u179F\u17C4\u1793\u17C1\u17C7\u178F\u17D2\u179A\u17BC\u179C\u1794\u17B6\u1793\u1794\u17D2\u179A\u17BE\u1794\u17D2\u179A\u17B6\u179F\u17CB\u179A\u17BD\u1785\u17A0\u17BE\u1799!"
      });
    }
    issued.used = true;
    issued.usedAt = Date.now();
    grantUnlockCookie(req, res, issued.source, issued.code);
    return res.json({ success: true, type: issued.source });
  }
  return res.status(400).json({
    success: false,
    error: "\u179B\u17C1\u1781\u1780\u17BC\u178A\u1798\u17B7\u1793\u178F\u17D2\u179A\u17B9\u1798\u178F\u17D2\u179A\u17BC\u179C \u17AC\u1795\u17BB\u178F\u1780\u17C6\u178E\u178F\u17CB! \u179F\u17BC\u1798\u1796\u17B7\u1793\u17B7\u178F\u17D2\u1799\u1798\u17D2\u178F\u1784\u1791\u17C0\u178F \u17AC\u1794\u1784\u17CB\u1794\u17D2\u179A\u17B6\u1780\u17CB\u178F\u17B6\u1798 ABA PayWay / Korea Bank\u17D4"
  });
});
var SESSION_SIGNING_SECRET = process.env.ADMIN_SESSION_SECRET || crypto2.randomBytes(32).toString("hex");
var ADMIN_SESSION_TTL_MS = 8 * 60 * 60 * 1e3;
var claimedAdmin = null;
var revokedAdminTokens = /* @__PURE__ */ new Set();
function hashPasswordScrypt(password, salt) {
  return crypto2.scryptSync(password, salt, 64).toString("hex");
}
function safeEqualStrings(a, b) {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return crypto2.timingSafeEqual(bufA, bufB);
}
function issueAdminBearerToken(username, role = "root_admin") {
  const payload = Buffer.from(
    JSON.stringify({
      sub: username,
      role,
      iat: Date.now(),
      exp: Date.now() + ADMIN_SESSION_TTL_MS,
      nonce: crypto2.randomBytes(12).toString("hex")
    })
  ).toString("base64url");
  const sig = crypto2.createHmac("sha256", SESSION_SIGNING_SECRET).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}
function verifyAdminBearerToken(token) {
  if (!token || revokedAdminTokens.has(token)) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [payload, sig] = parts;
  const expectedSig = crypto2.createHmac("sha256", SESSION_SIGNING_SECRET).update(payload).digest("base64url");
  if (!safeEqualStrings(sig, expectedSig)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!parsed || typeof parsed.exp !== "number" || Date.now() > parsed.exp) {
      return null;
    }
    const rawRole = String(parsed.role || "");
    if (rawRole !== "root_admin" && rawRole !== "manager" && rawRole !== "admin") {
      return null;
    }
    const normalizedRole = rawRole === "manager" ? "manager" : "root_admin";
    return { sub: String(parsed.sub || "Admin"), role: normalizedRole };
  } catch {
    return null;
  }
}
function requireAdminAuth(req, res, next) {
  const authHeader = String(req.headers.authorization || "");
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  const verified = verifyAdminBearerToken(token);
  if (!verified) {
    return res.status(401).json({ success: false, error: "Unauthorized admin session" });
  }
  req.adminSession = verified;
  next();
}
function requireRootAdminAuth(req, res, next) {
  const authHeader = String(req.headers.authorization || "");
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  const verified = verifyAdminBearerToken(token);
  if (!verified) {
    return res.status(401).json({ success: false, error: "Unauthorized admin session" });
  }
  if (verified.role !== "root_admin") {
    return res.status(403).json({
      success: false,
      error: "\u179F\u17B7\u1791\u17D2\u1792\u17B7\u178F\u17D2\u179A\u17BC\u179C\u1794\u17B6\u1793\u1794\u178A\u17B7\u179F\u17C1\u1792! \u1798\u17B6\u1793\u178F\u17C2 Root Admin \u1794\u17C9\u17BB\u178E\u17D2\u178E\u17C4\u17C7\u178A\u17C2\u179B\u17A2\u17B6\u1785\u1782\u17D2\u179A\u1794\u17CB\u1782\u17D2\u179A\u1784\u1782\u178E\u1793\u17B8 Admin/Staff \u1794\u17B6\u1793\u17D4"
    });
  }
  req.adminSession = verified;
  next();
}
app.get("/api/admin/auth-status", (req, res) => {
  const hasEnvCredentials = Boolean(process.env.ADMIN_PASSWORD && process.env.ADMIN_PASSWORD.trim().length > 0);
  const hasDbAccounts = listAdminAccounts().length > 0;
  const authHeader = String(req.headers.authorization || "");
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  const session = verifyAdminBearerToken(token);
  return res.json({
    success: true,
    needsSetup: !hasEnvCredentials && !claimedAdmin && !hasDbAccounts,
    configuredViaEnv: hasEnvCredentials,
    authenticated: Boolean(session),
    username: session?.sub || null,
    role: session?.role || null
  });
});
app.get(
  [
    "/api/download-source-zip",
    "/download-source-zip",
    "/kiip-source-code.zip",
    "/api/download-pc-package",
    "/download-pc-package",
    "/kiip-topik-pc-package.zip"
  ],
  requireRootAdminAuth,
  (_req, res) => {
    try {
      const zipPath = "/tmp/kiip-portal-source-code.zip";
      const pythonScript = [
        "import zipfile, os",
        "base_dir = os.path.abspath('.')",
        "zip_path = '/tmp/kiip-portal-source-code.zip'",
        "excluded_dirs = {'node_modules', 'dist', 'dist-pc', '.git', '__pycache__', '.aistudio', 'data'}",
        "excluded_files = {'kiip-portal-source-code.zip', 'kiip-topik-pc-package.zip', 'firebase-applet-config.json', 'server.js'}",
        "with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as z:",
        "    for root, dirs, files in os.walk(base_dir):",
        "        dirs[:] = [d for d in dirs if d not in excluded_dirs and not d.startswith('.git')]",
        "        for file in files:",
        "            lower = file.lower()",
        "            if file in excluded_files or lower.startswith('.env') or lower.endswith(('.pyc', '.traineddata', '.sqlite', '.sqlite3', '.db', '.db-wal', '.db-shm')):",
        "                continue",
        "            full_path = os.path.join(root, file)",
        "            rel_path = os.path.relpath(full_path, base_dir)",
        "            z.write(full_path, rel_path)"
      ].join("\n");
      execFileSync("python3", ["-c", pythonScript], { stdio: "ignore", timeout: 25e3 });
      if (fs2.existsSync(zipPath)) {
        const stats = fs2.statSync(zipPath);
        res.setHeader("Content-Type", "application/zip");
        res.setHeader("Content-Disposition", 'attachment; filename="kiip-portal-source-code.zip"');
        res.setHeader("Content-Length", stats.size.toString());
        res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
        const stream = fs2.createReadStream(zipPath);
        return stream.pipe(res);
      }
      return res.status(500).json({ success: false, error: "Archive generation failed." });
    } catch (err) {
      console.error("[Download ZIP] Error:", err);
      return res.status(500).json({ success: false, error: "Archive generation failed." });
    }
  }
);
app.post("/api/admin/bootstrap", adminAuthRateLimiter, (req, res) => {
  const hasEnvCredentials = Boolean(process.env.ADMIN_PASSWORD && process.env.ADMIN_PASSWORD.trim().length > 0);
  if (hasEnvCredentials || claimedAdmin || listAdminAccounts().length > 0) {
    return res.status(403).json({
      success: false,
      error: "Admin credentials are already configured."
    });
  }
  const username = String(req.body?.username || "").trim();
  const password = String(req.body?.password || "");
  if (username.length < 3 || username.length > 64 || !/^[a-zA-Z0-9._@-]+$/.test(username)) {
    return res.status(400).json({
      success: false,
      error: "Admin ID must be 3\u201364 alphanumeric characters."
    });
  }
  if (password.length < 8 || password.length > 128) {
    return res.status(400).json({
      success: false,
      error: "Admin password must be at least 8 characters."
    });
  }
  const salt = crypto2.randomBytes(16).toString("hex");
  claimedAdmin = {
    username,
    salt,
    passwordHash: hashPasswordScrypt(password, salt),
    claimedAt: Date.now()
  };
  const token = issueAdminBearerToken(username, "root_admin");
  return res.json({
    success: true,
    token,
    username,
    role: "root_admin"
  });
});
app.post("/api/admin/login", adminAuthRateLimiter, (req, res) => {
  const username = String(req.body?.username || "").trim();
  const password = String(req.body?.password || "");
  if (!username || !password) {
    return res.status(400).json({
      success: false,
      error: "\u179F\u17BC\u1798\u1794\u1789\u17D2\u1785\u17BC\u179B Admin ID \u1793\u17B7\u1784 Password!"
    });
  }
  const dbAuth = verifyDbAdminLogin(username, password);
  if (dbAuth.ok && dbAuth.username) {
    const role = dbAuth.role === "root_admin" ? "root_admin" : "manager";
    const token = issueAdminBearerToken(dbAuth.username, role);
    return res.json({ success: true, token, username: dbAuth.username, role });
  }
  const envPass = process.env.ADMIN_PASSWORD?.trim();
  if (envPass) {
    const envUser = (process.env.ADMIN_USERNAME || "Admin").trim();
    const userMatch = safeEqualStrings(username.toLowerCase(), envUser.toLowerCase());
    const passMatch = safeEqualStrings(password, envPass);
    if (userMatch && passMatch) {
      const token = issueAdminBearerToken(envUser, "root_admin");
      return res.json({ success: true, token, username: envUser, role: "root_admin" });
    }
    return res.status(401).json({
      success: false,
      error: "Admin ID \u17AC Password \u1798\u17B7\u1793\u178F\u17D2\u179A\u17B9\u1798\u178F\u17D2\u179A\u17BC\u179C!"
    });
  }
  if (claimedAdmin) {
    const userMatch = safeEqualStrings(username.toLowerCase(), claimedAdmin.username.toLowerCase());
    const candidateHash = hashPasswordScrypt(password, claimedAdmin.salt);
    const passMatch = safeEqualStrings(candidateHash, claimedAdmin.passwordHash);
    if (userMatch && passMatch) {
      const token = issueAdminBearerToken(claimedAdmin.username, "root_admin");
      return res.json({ success: true, token, username: claimedAdmin.username, role: "root_admin" });
    }
    return res.status(401).json({
      success: false,
      error: "Admin ID \u17AC Password \u1798\u17B7\u1793\u178F\u17D2\u179A\u17B9\u1798\u178F\u17D2\u179A\u17BC\u179C!"
    });
  }
  if (listAdminAccounts().length === 0) {
    return res.status(409).json({
      success: false,
      needsSetup: true,
      error: "Admin account not initialized yet. Complete first-run setup."
    });
  }
  return res.status(401).json({
    success: false,
    error: "Admin ID \u17AC Password \u1798\u17B7\u1793\u178F\u17D2\u179A\u17B9\u1798\u178F\u17D2\u179A\u17BC\u179C!"
  });
});
app.post("/api/admin/logout", (req, res) => {
  const authHeader = String(req.headers.authorization || "");
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  if (token) {
    revokedAdminTokens.add(token);
  }
  return res.json({ success: true });
});
var ROOT_ADMIN_EMAIL = "zeekhmerads@gmail.com";
var FIREBASE_PROJECT_ID = (() => {
  try {
    const raw = fs2.readFileSync(path2.join(__dirname, "firebase-applet-config.json"), "utf8");
    return String(JSON.parse(raw)?.projectId || "").trim();
  } catch {
    return "";
  }
})();
var cachedGoogleJwks = null;
async function fetchGoogleSecureTokenJwk(kid) {
  const now = Date.now();
  if (!cachedGoogleJwks || now - cachedGoogleJwks.fetchedAt > 60 * 60 * 1e3) {
    const resp = await fetch(
      "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com",
      { signal: AbortSignal.timeout(8e3) }
    );
    if (!resp.ok) return null;
    const json = await resp.json();
    cachedGoogleJwks = { keys: Array.isArray(json.keys) ? json.keys : [], fetchedAt: now };
  }
  let match = cachedGoogleJwks.keys.find((k) => k?.kid === kid);
  if (!match) {
    const resp = await fetch(
      "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com",
      { signal: AbortSignal.timeout(8e3) }
    );
    if (resp.ok) {
      const json = await resp.json();
      cachedGoogleJwks = { keys: Array.isArray(json.keys) ? json.keys : [], fetchedAt: Date.now() };
      match = cachedGoogleJwks.keys.find((k) => k?.kid === kid);
    }
  }
  return match || null;
}
async function verifyFirebaseIdToken(idToken) {
  if (!FIREBASE_PROJECT_ID || typeof idToken !== "string") return null;
  const parts = idToken.split(".");
  if (parts.length !== 3) return null;
  const [headerB64, payloadB64, sigB64] = parts;
  let header;
  let payload;
  try {
    header = JSON.parse(Buffer.from(headerB64, "base64url").toString("utf8"));
    payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (header?.alg !== "RS256" || typeof header?.kid !== "string" || !header.kid) {
    return null;
  }
  const nowSec = Math.floor(Date.now() / 1e3);
  if (payload?.aud !== FIREBASE_PROJECT_ID || payload?.iss !== `https://securetoken.google.com/${FIREBASE_PROJECT_ID}` || typeof payload?.sub !== "string" || !payload.sub || typeof payload?.exp !== "number" || payload.exp <= nowSec || typeof payload?.iat !== "number" || payload.iat > nowSec + 300 || payload?.email_verified !== true || typeof payload?.email !== "string") {
    return null;
  }
  const jwk = await fetchGoogleSecureTokenJwk(header.kid);
  if (!jwk) return null;
  const pubKey = crypto2.createPublicKey({ key: jwk, format: "jwk" });
  const verified = crypto2.verify(
    "RSA-SHA256",
    Buffer.from(`${headerB64}.${payloadB64}`, "utf8"),
    pubKey,
    Buffer.from(sigB64, "base64url")
  );
  if (!verified) return null;
  return {
    email: payload.email.toLowerCase(),
    uid: payload.sub,
    emailVerified: Boolean(payload.email_verified)
  };
}
async function verifyFirebaseAdminIdToken(idToken) {
  const verified = await verifyFirebaseIdToken(idToken);
  if (!verified || verified.email !== ROOT_ADMIN_EMAIL) {
    return null;
  }
  return { email: verified.email, uid: verified.uid };
}
app.post("/api/payments/confirm-firebase-unlock", paymentRateLimiter, async (req, res) => {
  try {
    const idToken = String(req.body?.idToken || "").trim();
    const promoCode = String(req.body?.promoCode || "").trim().toUpperCase().replace(/[^A-Z0-9_-]/g, "").slice(0, 64);
    if (!idToken || idToken.length > 8192 || !promoCode) {
      return res.status(400).json({ success: false, error: "Invalid unlock verification request." });
    }
    const verifiedUser = await verifyFirebaseIdToken(idToken);
    if (!verifiedUser) {
      return res.status(401).json({ success: false, error: "Unauthorized Firebase session." });
    }
    const fsResp = await fetch(
      `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(FIREBASE_PROJECT_ID)}/databases/(default)/documents/promoCodes/${encodeURIComponent(promoCode)}`,
      {
        headers: { Authorization: `Bearer ${idToken}` },
        signal: AbortSignal.timeout(6e3)
      }
    ).catch(() => null);
    if (!fsResp || !fsResp.ok) {
      return res.status(403).json({ success: false, error: "Invalid promo code record." });
    }
    const fsDoc = await fsResp.json().catch(() => null);
    const isActive = Boolean(fsDoc?.fields?.isActive?.booleanValue);
    if (!isActive) {
      return res.status(403).json({ success: false, error: "Promo code is inactive." });
    }
    grantUnlockCookie(req, res, "firebase_promo", promoCode);
    return res.json({ success: true });
  } catch {
    return res.status(500).json({ success: false, error: "Unable to confirm promo unlock." });
  }
});
app.post("/api/admin/login-google", adminAuthRateLimiter, async (req, res) => {
  try {
    const idToken = String(req.body?.idToken || "").trim();
    if (!idToken || idToken.length > 8192) {
      return res.status(400).json({ success: false, error: "Missing Firebase ID token." });
    }
    const verified = await verifyFirebaseAdminIdToken(idToken);
    if (!verified) {
      return res.status(403).json({
        success: false,
        error: `\u179F\u17B7\u1791\u17D2\u1792\u17B7\u178F\u17D2\u179A\u17BC\u179C\u1794\u17B6\u1793\u1794\u178A\u17B7\u179F\u17C1\u1792! \u1798\u17B6\u1793\u178F\u17C2\u1782\u178E\u1793\u17B8 Google Admin (${ROOT_ADMIN_EMAIL}) \u1794\u17C9\u17BB\u178E\u17D2\u178E\u17C4\u17C7\u178A\u17C2\u179B\u17A2\u17B6\u1785\u1785\u17BC\u179B\u1794\u17B6\u1793\u17D4`
      });
    }
    const token = issueAdminBearerToken(verified.email, "root_admin");
    return res.json({
      success: true,
      token,
      username: verified.email,
      role: "root_admin"
    });
  } catch (err) {
    console.error("[Admin Google Login] Verification error:", err);
    return res.status(500).json({
      success: false,
      error: "\u1798\u17B6\u1793\u1794\u1789\u17D2\u17A0\u17B6\u1795\u17D2\u1791\u17C0\u1784\u1795\u17D2\u1791\u17B6\u178F\u17CB\u1782\u178E\u1793\u17B8 Google Admin\u17D4 \u179F\u17BC\u1798\u1796\u17D2\u1799\u17B6\u1799\u17B6\u1798\u1798\u17D2\u178F\u1784\u1791\u17C0\u178F\u17D4"
    });
  }
});
app.get("/api/admin/accounts", requireRootAdminAuth, (_req, res) => {
  return res.json({
    success: true,
    accounts: listAdminAccounts()
  });
});
app.post("/api/admin/accounts", requireRootAdminAuth, (req, res) => {
  const session = req.adminSession;
  const username = String(req.body?.username || "").trim();
  const displayName = String(req.body?.displayName || "").trim();
  const password = String(req.body?.password || "");
  const role = req.body?.role === "root_admin" ? "root_admin" : "manager";
  const result = createOrUpdateAdminAccount({
    username,
    displayName,
    password,
    role,
    createdBy: session?.sub || ROOT_ADMIN_EMAIL
  });
  if (!result.ok) {
    return res.status(400).json({ success: false, error: result.error || "Invalid account data" });
  }
  return res.json({ success: true, account: result.account });
});
app.patch("/api/admin/accounts/:id/status", requireRootAdminAuth, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ success: false, error: "Invalid account ID" });
  }
  const updated = setAdminAccountActive(id, Boolean(req.body?.isActive));
  if (!updated) {
    return res.status(404).json({ success: false, error: "Account not found" });
  }
  return res.json({ success: true });
});
app.patch("/api/admin/accounts/:id/password", requireRootAdminAuth, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ success: false, error: "Invalid account ID" });
  }
  const password = String(req.body?.password || "");
  const result = updateAdminAccountPassword(id, password);
  if (!result.ok) {
    return res.status(400).json({ success: false, error: result.error || "Failed to update password" });
  }
  return res.json({ success: true });
});
app.delete("/api/admin/accounts/:id", requireRootAdminAuth, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ success: false, error: "Invalid account ID" });
  }
  const deleted = deleteAdminAccount(id);
  if (!deleted) {
    return res.status(404).json({ success: false, error: "Account not found" });
  }
  return res.json({ success: true });
});
var activeVisitorMap = /* @__PURE__ */ new Map();
var seenSessionIds = /* @__PURE__ */ new Set();
var geoCacheByIpHash = /* @__PURE__ */ new Map();
var LIVE_VISITOR_TTL_MS = 5 * 60 * 1e3;
var GEO_CACHE_TTL_MS = 24 * 60 * 60 * 1e3;
var IP_HASH_SALT = crypto2.randomBytes(16).toString("hex");
function extractClientIp(req) {
  const xff = req.headers["x-forwarded-for"];
  let raw = "";
  if (typeof xff === "string" && xff.trim()) {
    raw = xff.split(",")[0].trim();
  } else if (Array.isArray(xff) && xff.length > 0) {
    raw = String(xff[0]).split(",")[0].trim();
  } else {
    raw = String(req.socket?.remoteAddress || req.ip || "").trim();
  }
  if (raw.startsWith("::ffff:")) {
    raw = raw.slice(7);
  }
  return raw;
}
function isPrivateOrLocalIp(ip) {
  if (!ip) return true;
  if (ip === "::1" || ip === "127.0.0.1" || ip === "localhost" || ip === "0.0.0.0") return true;
  if (ip.startsWith("10.") || ip.startsWith("192.168.") || ip.startsWith("169.254.")) return true;
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(ip)) return true;
  if (ip.startsWith("fc") || ip.startsWith("fd") || ip.startsWith("fe80:")) return true;
  return false;
}
function isValidIpLiteral(ip) {
  const ipv4 = /^(\d{1,3}\.){3}\d{1,3}$/;
  const ipv6 = /^[0-9a-fA-F:]+$/;
  return ipv4.test(ip) || ip.includes(":") && ipv6.test(ip);
}
function maskIpAddress(ip) {
  if (!ip || !isValidIpLiteral(ip)) return "***.***.***.***";
  if (ip.includes(".")) {
    const octets = ip.split(".");
    if (octets.length === 4) {
      return `${octets[0]}.${octets[1]}.***.***`;
    }
  }
  if (ip.includes(":")) {
    const groups = ip.split(":").filter(Boolean);
    if (groups.length >= 2) {
      return `${groups[0]}:${groups[1]}:****:****`;
    }
  }
  return "***.***.***.***";
}
async function resolveIpToLocation(req, rawIp) {
  const headerCity = String(
    req.headers["x-appengine-city"] || req.headers["cf-ipcity"] || req.headers["x-vercel-ip-city"] || ""
  ).trim();
  const headerCountry = String(
    req.headers["x-appengine-country"] || req.headers["cf-ipcountry"] || req.headers["x-vercel-ip-country"] || ""
  ).trim();
  const headerRegion = String(
    req.headers["x-appengine-region"] || req.headers["x-vercel-ip-country-region"] || ""
  ).trim();
  if (headerCity && headerCity.toLowerCase() !== "unknown") {
    const formattedCity = decodeURIComponent(headerCity).split(" ").map((w) => w ? w[0].toUpperCase() + w.slice(1).toLowerCase() : "").join(" ");
    return {
      city: formattedCity,
      region: headerRegion || formattedCity,
      country: headerCountry || "Unknown",
      countryCode: headerCountry.length === 2 ? headerCountry.toUpperCase() : "",
      resolvedIp: rawIp,
      cachedAt: Date.now()
    };
  }
  const isLocal = isPrivateOrLocalIp(rawIp) || !isValidIpLiteral(rawIp);
  const cacheKey = crypto2.createHash("sha256").update(`${IP_HASH_SALT}:${isLocal ? "egress" : rawIp}`).digest("hex");
  const cached = geoCacheByIpHash.get(cacheKey);
  if (cached && Date.now() - cached.cachedAt < GEO_CACHE_TTL_MS) {
    return cached;
  }
  const primaryUrl = isLocal ? "https://ipwho.is/" : `https://ipwho.is/${encodeURIComponent(rawIp)}`;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3500);
    const resp = await fetch(primaryUrl, { signal: controller.signal });
    clearTimeout(timer);
    if (resp.ok) {
      const data = await resp.json();
      if (data && data.success !== false && data.city) {
        const entry = {
          city: String(data.city).slice(0, 80),
          region: String(data.region || data.city).slice(0, 80),
          country: String(data.country || "Unknown").slice(0, 80),
          countryCode: String(data.country_code || "").toUpperCase().slice(0, 4),
          resolvedIp: typeof data.ip === "string" ? data.ip : rawIp,
          cachedAt: Date.now()
        };
        geoCacheByIpHash.set(cacheKey, entry);
        return entry;
      }
    }
  } catch {
  }
  const fallbackUrl = isLocal ? "https://ipapi.co/json/" : `https://ipapi.co/${encodeURIComponent(rawIp)}/json/`;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3500);
    const resp = await fetch(fallbackUrl, { signal: controller.signal });
    clearTimeout(timer);
    if (resp.ok) {
      const data = await resp.json();
      if (data && !data.error && data.city) {
        const entry = {
          city: String(data.city).slice(0, 80),
          region: String(data.region || data.city).slice(0, 80),
          country: String(data.country_name || data.country || "Unknown").slice(0, 80),
          countryCode: String(data.country_code || "").toUpperCase().slice(0, 4),
          resolvedIp: typeof data.ip === "string" ? data.ip : rawIp,
          cachedAt: Date.now()
        };
        geoCacheByIpHash.set(cacheKey, entry);
        return entry;
      }
    }
  } catch {
  }
  return {
    city: "Unknown City",
    region: "",
    country: "Unknown",
    countryCode: "",
    resolvedIp: rawIp,
    cachedAt: Date.now()
  };
}
function pruneStaleVisitors() {
  const cutoff = Date.now() - 24 * 60 * 60 * 1e3;
  for (const [sid, entry] of activeVisitorMap.entries()) {
    if (entry.lastSeen < cutoff) {
      activeVisitorMap.delete(sid);
    }
  }
}
app.post("/api/visitors/heartbeat", visitorHeartbeatLimiter, async (req, res) => {
  try {
    pruneStaleVisitors();
    const rawSessionId = String(req.body?.sessionId || "").trim();
    const sessionId = /^[a-zA-Z0-9_-]{4,64}$/.test(rawSessionId) ? rawSessionId : `sess_${crypto2.randomBytes(6).toString("hex")}`;
    const page = String(req.body?.page || "/").slice(0, 64);
    const rawIp = extractClientIp(req);
    const geo = await resolveIpToLocation(req, rawIp);
    const ipForMask = !isPrivateOrLocalIp(rawIp) ? rawIp : geo.resolvedIp || rawIp;
    const maskedIp = maskIpAddress(ipForMask);
    const now = Date.now();
    const existingEntry = activeVisitorMap.get(sessionId);
    activeVisitorMap.set(sessionId, {
      sessionId,
      maskedIp,
      city: geo.city,
      region: geo.region,
      country: geo.country,
      countryCode: geo.countryCode,
      firstSeen: existingEntry ? existingEntry.firstSeen : now,
      lastSeen: now,
      page
    });
    seenSessionIds.add(sessionId);
    const persistentTotalVisits = Math.max(seenSessionIds.size, recordUniqueVisitSession(sessionId));
    const liveList = Array.from(activeVisitorMap.values()).filter(
      (v) => now - v.lastSeen <= LIVE_VISITOR_TTL_MS
    );
    return res.json({
      success: true,
      sessionId,
      city: geo.city,
      country: geo.country,
      countryCode: geo.countryCode,
      liveCount: liveList.length,
      totalVisits: persistentTotalVisits
    });
  } catch {
    return res.status(500).json({ success: false });
  }
});
app.get("/api/visitors/public-stats", (_req, res) => {
  pruneStaleVisitors();
  const now = Date.now();
  const liveList = Array.from(activeVisitorMap.values()).filter((v) => now - v.lastSeen <= LIVE_VISITOR_TTL_MS).sort((a, b) => b.lastSeen - a.lastSeen);
  const recentList = Array.from(activeVisitorMap.values()).sort((a, b) => b.lastSeen - a.lastSeen).slice(0, 30);
  const sourceList = liveList.length > 0 ? liveList : recentList;
  const liveCities = sourceList.map((v) => ({
    city: v.city,
    country: v.country,
    countryCode: v.countryCode,
    isLive: now - v.lastSeen <= LIVE_VISITOR_TTL_MS
  }));
  return res.json({
    success: true,
    liveCount: liveList.length,
    totalVisits: Math.max(seenSessionIds.size, getTotalRecordedVisits()),
    liveCities
  });
});
app.get("/api/admin/live-visitors", requireAdminAuth, (_req, res) => {
  pruneStaleVisitors();
  const now = Date.now();
  const visitors = Array.from(activeVisitorMap.values()).sort((a, b) => b.lastSeen - a.lastSeen).slice(0, 100).map((v) => ({
    sessionId: v.sessionId,
    maskedIp: v.maskedIp,
    city: v.city,
    region: v.region,
    country: v.country,
    countryCode: v.countryCode,
    lastSeen: new Date(v.lastSeen).toISOString(),
    firstSeen: new Date(v.firstSeen).toISOString(),
    page: v.page,
    isLive: now - v.lastSeen <= LIVE_VISITOR_TTL_MS
  }));
  const liveCount = visitors.filter((v) => v.isLive).length;
  const cityCounts = {};
  for (const v of visitors) {
    const label = v.countryCode ? `${v.city} (${v.countryCode})` : v.city;
    cityCounts[label] = (cityCounts[label] || 0) + 1;
  }
  return res.json({
    success: true,
    liveCount,
    totalVisits: Math.max(seenSessionIds.size, getTotalRecordedVisits()),
    visitors,
    cityBreakdown: Object.entries(cityCounts).map(([cityLabel, count]) => ({ cityLabel, count })).sort((a, b) => b.count - a.count)
  });
});
var serverDocumentsLog = [];
var serverPaymentsLog = [];
app.post("/api/analytics/event", aiApiRateLimiter, (req, res) => {
  const type = String(req.body?.type || "");
  const nowIso = (/* @__PURE__ */ new Date()).toISOString();
  if (type === "document_generated") {
    const id = String(req.body?.id || `doc_${Date.now()}`).replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 128);
    if (!serverDocumentsLog.some((d) => d.id === id)) {
      serverDocumentsLog.unshift({
        id,
        applicantName: String(req.body?.applicantName || "Applicant").slice(0, 120),
        pageCount: Math.max(1, Math.min(50, Number(req.body?.pageCount) || 1)),
        isPaid: Boolean(req.body?.isPaid),
        centerId: req.body?.centerId ? String(req.body.centerId).slice(0, 64) : void 0,
        createdAt: nowIso
      });
      if (serverDocumentsLog.length > 500) serverDocumentsLog.pop();
    }
    return res.json({ success: true });
  }
  if (type === "payment_completed") {
    const id = String(req.body?.id || `pay_${Date.now()}`).replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 128);
    if (!serverPaymentsLog.some((p) => p.id === id)) {
      serverPaymentsLog.unshift({
        id,
        userEmail: String(req.body?.userEmail || "guest@kiip-portal.kr").slice(0, 254),
        amount: Math.max(0, Math.min(1e7, Number(req.body?.amount) || 0)),
        currency: req.body?.currency === "USD" ? "USD" : "KRW",
        method: String(req.body?.method || "ABA PayWay QR").slice(0, 64),
        promoCodeUsed: String(req.body?.promoCodeUsed || "-").slice(0, 64),
        centerId: req.body?.centerId ? String(req.body.centerId).slice(0, 64) : void 0,
        createdAt: nowIso
      });
      if (serverPaymentsLog.length > 500) serverPaymentsLog.pop();
    }
    return res.json({ success: true });
  }
  return res.status(400).json({ success: false, error: "Unsupported analytics event type" });
});
function getKoreaBankPaymentInfo() {
  return {
    bankName: (process.env.KR_BANK_NAME || "KOOKMIN BANK (KB \uAD6D\uBBFC\uC740\uD589)").trim(),
    accountNumber: (process.env.KR_BANK_ACCOUNT || "893801-00-097236").trim(),
    accountHolder: (process.env.KR_BANK_HOLDER || "EANG VEASNA").trim()
  };
}
app.get("/api/admin/analytics", requireAdminAuth, (_req, res) => {
  const krBank = getKoreaBankPaymentInfo();
  return res.json({
    success: true,
    documents: serverDocumentsLog,
    payments: serverPaymentsLog,
    issuedUnlockCodes: Array.from(issuedUnlockCodes.values()).sort((a, b) => b.createdAt - a.createdAt),
    integrations: {
      krBankConfigured: Boolean(krBank.accountNumber),
      telegramConfigured: Boolean(process.env.TELEGRAM_BOT_TOKEN)
    }
  });
});
async function analyzeKoreanBankReceiptWithGemini(imageBase64, mimeType) {
  const ai = getAiClient();
  if (!ai) {
    return {
      isValidReceipt: false,
      amountKrw: 0,
      bankName: "",
      recipientName: "",
      transferCompleted: false,
      reason: "GEMINI_API_KEY is not configured on the server for automated receipt inspection."
    };
  }
  const krBank = getKoreaBankPaymentInfo();
  const expectedHolder = krBank.accountHolder;
  const expectedAccountTail = krBank.accountNumber.replace(/\D/g, "").slice(-4);
  const prompt = `You are a Korean banking receipt verification specialist.
Inspect this uploaded screenshot of a South Korean bank transfer confirmation (e.g., KB \uAD6D\uBBFC\uC740\uD589, \uC2E0\uD55C\uC740\uD589, \uC6B0\uB9AC\uC740\uD589, \uD558\uB098\uC740\uD589, NH\uB18D\uD611, \uCE74\uCE74\uC624\uBC45\uD06C, \uD1A0\uC2A4\uBC45\uD06C, \uCF00\uC774\uBC45\uD06C, IBK\uAE30\uC5C5\uC740\uD589, \uC0C8\uB9C8\uC744\uAE08\uACE0, etc.).
Extract strictly what is visible in the image:
1. isBankTransferScreenshot: true ONLY if this is a genuine bank transfer / remittance confirmation screen.
2. transferCompleted: true ONLY if the transfer status clearly indicates completion (e.g., \uC774\uCCB4\uC644\uB8CC, \uC1A1\uAE08\uC644\uB8CC, \uCD9C\uAE08\uC644\uB8CC, \uC774\uCCB4 \uC131\uACF5, Completed, Sent).
3. amountKrw: numeric integer amount transferred in KRW (e.g., 35000). Return 0 if not clearly visible.
4. bankName: bank or app name (e.g., KakaoBank, Toss, KB Kookmin, Shinhan, NH, Woori, Hana).
5. recipientName: recipient name or account label visible on the receipt.
6. recipientAccountDigits: digits visible for the recipient account number (if any).
Return ONLY valid JSON matching the schema.`;
  const schema = {
    type: Type.OBJECT,
    properties: {
      isBankTransferScreenshot: { type: Type.BOOLEAN },
      transferCompleted: { type: Type.BOOLEAN },
      amountKrw: { type: Type.NUMBER },
      bankName: { type: Type.STRING },
      recipientName: { type: Type.STRING },
      recipientAccountDigits: { type: Type.STRING }
    }
  };
  for (const model of ["gemini-3.1-flash-lite", "gemini-4-hydrogen"]) {
    try {
      const response = await ai.models.generateContent({
        model,
        contents: {
          parts: [
            { inlineData: { mimeType, data: imageBase64 } },
            { text: prompt }
          ]
        },
        config: {
          responseMimeType: "application/json",
          responseSchema: schema
        }
      });
      const text = response.text;
      if (!text) continue;
      const parsed = JSON.parse(text.replace(/```json/gi, "").replace(/```/g, "").trim());
      const amountKrw = Math.round(Number(parsed.amountKrw) || 0);
      const isReceipt = Boolean(parsed.isBankTransferScreenshot);
      const completed = Boolean(parsed.transferCompleted);
      const bankName = String(parsed.bankName || "Korea Bank").slice(0, 60);
      const recipientName = String(parsed.recipientName || "").slice(0, 80);
      const accountDigits = String(parsed.recipientAccountDigits || "").replace(/\D/g, "");
      if (!isReceipt) {
        return {
          isValidReceipt: false,
          amountKrw,
          bankName,
          recipientName,
          transferCompleted: false,
          reason: "\u179A\u17BC\u1794\u1797\u17B6\u1796\u1793\u17C1\u17C7\u1798\u17B7\u1793\u1798\u17C2\u1793\u1787\u17B6\u179C\u17B7\u1780\u17D2\u1780\u1799\u1794\u178F\u17D2\u179A\u1795\u17D2\u1791\u17C1\u179A\u1794\u17D2\u179A\u17B6\u1780\u17CB\u1792\u1793\u17B6\u1782\u17B6\u179A\u1780\u17BC\u179A\u17C9\u17C1\u1791\u17C1\u17D4 \u179F\u17BC\u1798\u1795\u17D2\u1789\u17BE Screenshot \u179C\u17B7\u1780\u17D2\u1780\u1799\u1794\u178F\u17D2\u179A\u178A\u17C2\u179B\u1798\u17B6\u1793\u1796\u17B6\u1780\u17D2\u1799 \uC774\uCCB4\uC644\uB8CC / \uC1A1\uAE08\uC644\uB8CC\u17D4"
        };
      }
      if (!completed) {
        return {
          isValidReceipt: false,
          amountKrw,
          bankName,
          recipientName,
          transferCompleted: false,
          reason: "\u179C\u17B7\u1780\u17D2\u1780\u1799\u1794\u178F\u17D2\u179A\u1798\u17B7\u1793\u1791\u17B6\u1793\u17CB\u1794\u1784\u17D2\u17A0\u17B6\u1789\u179F\u17D2\u1790\u17B6\u1793\u1797\u17B6\u1796\u1795\u17D2\u1791\u17C1\u179A\u1794\u17D2\u179A\u17B6\u1780\u17CB\u1787\u17C4\u1782\u1787\u17D0\u1799 (\uC774\uCCB4\uC644\uB8CC / \uC1A1\uAE08\uC644\uB8CC) \u1791\u17C1\u17D4"
        };
      }
      if (amountKrw < 35e3) {
        return {
          isValidReceipt: false,
          amountKrw,
          bankName,
          recipientName,
          transferCompleted: true,
          reason: `\u1791\u17B9\u1780\u1794\u17D2\u179A\u17B6\u1780\u17CB\u179B\u17BE\u179C\u17B7\u1780\u17D2\u1780\u1799\u1794\u178F\u17D2\u179A (\u20A9${amountKrw.toLocaleString()}) \u178F\u17B7\u1785\u1787\u17B6\u1784\u178F\u1798\u17D2\u179B\u17C3\u179F\u17C1\u179C\u17B6 \u20A935,000\u17D4`
        };
      }
      if (expectedAccountTail && accountDigits && !accountDigits.endsWith(expectedAccountTail)) {
        return {
          isValidReceipt: false,
          amountKrw,
          bankName,
          recipientName,
          transferCompleted: true,
          reason: "\u179B\u17C1\u1781\u1782\u178E\u1793\u17B8\u17A2\u17D2\u1793\u1780\u1791\u1791\u17BD\u179B\u179B\u17BE\u179C\u17B7\u1780\u17D2\u1780\u1799\u1794\u178F\u17D2\u179A\u1798\u17B7\u1793\u178F\u17D2\u179A\u17BC\u179C\u1782\u17D2\u1793\u17B6\u1793\u17B9\u1784\u1782\u178E\u1793\u17B8\u1792\u1793\u17B6\u1782\u17B6\u179A\u1780\u17C6\u178E\u178F\u17CB\u1791\u17C1\u17D4"
        };
      }
      if (expectedHolder && recipientName && !recipientName.toLowerCase().includes(expectedHolder.toLowerCase().slice(0, 3))) {
        if (!expectedAccountTail || !accountDigits.endsWith(expectedAccountTail)) {
          return {
            isValidReceipt: false,
            amountKrw,
            bankName,
            recipientName,
            transferCompleted: true,
            reason: "\u1788\u17D2\u1798\u17C4\u17C7\u17A2\u17D2\u1793\u1780\u1791\u1791\u17BD\u179B\u179B\u17BE\u179C\u17B7\u1780\u17D2\u1780\u1799\u1794\u178F\u17D2\u179A\u1798\u17B7\u1793\u178F\u17D2\u179A\u17BC\u179C\u1782\u17D2\u1793\u17B6\u1791\u17C1\u17D4 \u179F\u17BC\u1798\u1796\u17B7\u1793\u17B7\u178F\u17D2\u1799\u1782\u178E\u1793\u17B8\u17A2\u17D2\u1793\u1780\u1791\u1791\u17BD\u179B\u1798\u17D2\u178F\u1784\u1791\u17C0\u178F\u17D4"
          };
        }
      }
      return {
        isValidReceipt: true,
        amountKrw,
        bankName,
        recipientName,
        transferCompleted: true,
        reason: "Verified"
      };
    } catch {
      continue;
    }
  }
  return {
    isValidReceipt: false,
    amountKrw: 0,
    bankName: "",
    recipientName: "",
    transferCompleted: false,
    reason: "\u1798\u17B7\u1793\u17A2\u17B6\u1785\u1795\u17D2\u1791\u17C0\u1784\u1795\u17D2\u1791\u17B6\u178F\u17CB\u179A\u17BC\u1794\u1797\u17B6\u1796\u179C\u17B7\u1780\u17D2\u1780\u1799\u1794\u178F\u17D2\u179A\u1794\u17B6\u1793\u1793\u17C5\u1796\u17C1\u179B\u1793\u17C1\u17C7\u1791\u17C1\u17D4 \u179F\u17BC\u1798\u1796\u17D2\u1799\u17B6\u1799\u17B6\u1798\u1798\u17D2\u178F\u1784\u1791\u17C0\u178F\u1787\u17B6\u1798\u17BD\u1799\u179A\u17BC\u1794\u1797\u17B6\u1796\u1785\u17D2\u1794\u17B6\u179F\u17CB\u17D4"
  };
}
async function sendTelegramMessage(chatId, text) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (!botToken || !chatId) return;
  try {
    await fetch(`https://api.telegram.org/bot${encodeURIComponent(botToken)}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text
      })
    });
  } catch {
  }
}
app.get("/api/payments/kr-config", (_req, res) => {
  const krBank = getKoreaBankPaymentInfo();
  return res.json({
    success: true,
    bankName: krBank.bankName,
    accountNumber: krBank.accountNumber,
    accountHolder: krBank.accountHolder,
    telegramBotUsername: (process.env.TELEGRAM_BOT_USERNAME || "").replace(/^@/, ""),
    amountKrw: 35e3,
    autoReceiptVerifyEnabled: Boolean(process.env.GEMINI_API_KEY),
    telegramBotEnabled: Boolean(process.env.TELEGRAM_BOT_TOKEN)
  });
});
app.post("/api/payments/verify-kr-receipt", paymentRateLimiter, async (req, res) => {
  try {
    const receiptImage = String(req.body?.receiptImage || "");
    const userEmail = String(req.body?.userEmail || "guest@kiip-portal.kr").slice(0, 254);
    const commaIdx = receiptImage.indexOf(",");
    if (!receiptImage.startsWith("data:image/") || commaIdx === -1) {
      return res.status(400).json({
        success: false,
        error: "\u179F\u17BC\u1798 Upload \u179A\u17BC\u1794\u1797\u17B6\u1796 Screenshot \u179C\u17B7\u1780\u17D2\u1780\u1799\u1794\u178F\u17D2\u179A\u1795\u17D2\u1791\u17C1\u179A\u1794\u17D2\u179A\u17B6\u1780\u17CB (PNG / JPG)!"
      });
    }
    const meta = receiptImage.substring(0, commaIdx);
    const base64Data = receiptImage.substring(commaIdx + 1).replace(/\s/g, "");
    const mimeType = meta.split(";")[0]?.replace("data:", "") || "image/jpeg";
    if (base64Data.length < 100 || base64Data.length > 14 * 1024 * 1024) {
      return res.status(400).json({
        success: false,
        error: "\u1791\u17C6\u17A0\u17C6\u179A\u17BC\u1794\u1797\u17B6\u1796\u1798\u17B7\u1793\u178F\u17D2\u179A\u17B9\u1798\u178F\u17D2\u179A\u17BC\u179C (\u17A2\u178F\u17B7\u1794\u179A\u1798\u17B6 10MB)\u17D4"
      });
    }
    const analysis = await analyzeKoreanBankReceiptWithGemini(base64Data, mimeType);
    if (!analysis.isValidReceipt) {
      return res.status(422).json({
        success: false,
        error: analysis.reason
      });
    }
    const reserved = reserveUnusedRedeemCode({
      source: "kr_receipt",
      assignedTo: userEmail,
      note: `Korea Bank (${analysis.bankName}) \u20A9${analysis.amountKrw.toLocaleString()}`,
      fallbackPrefix: "KIIP-KR"
    });
    const unlockCode = reserved.code;
    issuedUnlockCodes.set(unlockCode, {
      code: unlockCode,
      source: "kr_receipt",
      createdAt: Date.now(),
      used: false,
      verifiedAmount: analysis.amountKrw,
      bankName: analysis.bankName
    });
    serverPaymentsLog.unshift({
      id: `pay_kr_${Date.now()}`,
      userEmail,
      amount: analysis.amountKrw,
      currency: "KRW",
      method: `Korea Bank (${analysis.bankName})`,
      promoCodeUsed: unlockCode,
      createdAt: (/* @__PURE__ */ new Date()).toISOString()
    });
    if (process.env.TELEGRAM_ADMIN_CHAT_ID) {
      await sendTelegramMessage(
        process.env.TELEGRAM_ADMIN_CHAT_ID,
        `\u2705 Verified Korea Bank Transfer
Bank: ${analysis.bankName}
Amount: \u20A9${analysis.amountKrw.toLocaleString()}
User: ${userEmail}
Issued Code: ${unlockCode}`
      );
    }
    return res.json({
      success: true,
      unlockCode,
      verifiedAmount: analysis.amountKrw,
      bankName: analysis.bankName
    });
  } catch (err) {
    console.error("[KR Receipt] Verification failed:", err);
    return res.status(500).json({
      success: false,
      error: "\u1798\u17B6\u1793\u1794\u1789\u17D2\u17A0\u17B6\u1794\u1785\u17D2\u1785\u17C1\u1780\u1791\u17C1\u179F\u1780\u17D2\u1793\u17BB\u1784\u1780\u17B6\u179A\u1795\u17D2\u1791\u17C0\u1784\u1795\u17D2\u1791\u17B6\u178F\u17CB\u179C\u17B7\u1780\u17D2\u1780\u1799\u1794\u178F\u17D2\u179A\u17D4 \u179F\u17BC\u1798\u1796\u17D2\u1799\u17B6\u1799\u17B6\u1798\u1798\u17D2\u178F\u1784\u1791\u17C0\u178F\u17D4"
    });
  }
});
app.post("/api/telegram/webhook", async (req, res) => {
  const botToken = process.env.TELEGRAM_BOT_TOKEN?.trim();
  const expectedSecret = process.env.TELEGRAM_WEBHOOK_SECRET?.trim();
  if (!botToken || !expectedSecret) {
    return res.status(503).json({ success: false, error: "Telegram webhook not configured" });
  }
  const incomingSecret = String(req.headers["x-telegram-bot-api-secret-token"] || "");
  if (!safeEqualStrings(incomingSecret, expectedSecret)) {
    return res.status(403).json({ success: false, error: "Invalid webhook secret" });
  }
  try {
    const message = req.body?.message;
    const chatId = message?.chat?.id;
    if (!chatId) {
      return res.json({ ok: true });
    }
    const photos = Array.isArray(message?.photo) ? message.photo : [];
    if (photos.length === 0) {
      await sendTelegramMessage(
        chatId,
        "\u179F\u17BD\u179F\u17D2\u178F\u17B8! \u179F\u17BC\u1798\u1795\u17D2\u1789\u17BE\u179A\u17BC\u1794\u1797\u17B6\u1796 Screenshot \u179C\u17B7\u1780\u17D2\u1780\u1799\u1794\u178F\u17D2\u179A\u1795\u17D2\u1791\u17C1\u179A\u1794\u17D2\u179A\u17B6\u1780\u17CB (\u20A935,000) \u1798\u1780\u1791\u17B8\u1793\u17C1\u17C7 \u178A\u17BE\u1798\u17D2\u1794\u17B8\u1791\u1791\u17BD\u179B\u1794\u17B6\u1793\u179B\u17C1\u1781\u1780\u17BC\u178A\u178A\u17C4\u17C7\u179F\u17C4 KIIP-TOPIK PDF \u178A\u17C4\u1799\u179F\u17D2\u179C\u17D0\u1799\u1794\u17D2\u179A\u179C\u178F\u17D2\u178F\u17B7\u17D4"
      );
      return res.json({ ok: true });
    }
    const largestPhoto = photos[photos.length - 1];
    const fileId = String(largestPhoto?.file_id || "");
    if (!fileId) return res.json({ ok: true });
    const fileResp = await fetch(
      `https://api.telegram.org/bot${encodeURIComponent(botToken)}/getFile?file_id=${encodeURIComponent(fileId)}`
    );
    const fileJson = await fileResp.json();
    const filePath = String(fileJson?.result?.file_path || "");
    if (!filePath || filePath.includes("..") || !/^[a-zA-Z0-9/._-]+$/.test(filePath)) {
      await sendTelegramMessage(chatId, "\u274C \u1798\u17B7\u1793\u17A2\u17B6\u1785\u1791\u17B6\u1789\u1799\u1780\u179A\u17BC\u1794\u1797\u17B6\u1796\u1794\u17B6\u1793\u1791\u17C1\u17D4 \u179F\u17BC\u1798\u1795\u17D2\u1789\u17BE\u1798\u17D2\u178F\u1784\u1791\u17C0\u178F!");
      return res.json({ ok: true });
    }
    const imgResp = await fetch(
      `https://api.telegram.org/file/bot${encodeURIComponent(botToken)}/${filePath}`
    );
    const imgBuf = Buffer.from(await imgResp.arrayBuffer());
    const base64Img = imgBuf.toString("base64");
    const analysis = await analyzeKoreanBankReceiptWithGemini(base64Img, "image/jpeg");
    if (!analysis.isValidReceipt) {
      await sendTelegramMessage(chatId, `\u274C \u1795\u17D2\u1791\u17C0\u1784\u1795\u17D2\u1791\u17B6\u178F\u17CB\u1798\u17B7\u1793\u1787\u17C4\u1782\u1787\u17D0\u1799\u17D6 ${analysis.reason}`);
      return res.json({ ok: true });
    }
    const senderLabel = message?.from?.username ? `@${message.from.username}` : `tg_${chatId}`;
    const reserved = reserveUnusedRedeemCode({
      source: "telegram_bot",
      assignedTo: `${senderLabel}@telegram`,
      note: `Telegram Receipt (${analysis.bankName}) \u20A9${analysis.amountKrw.toLocaleString()}`,
      fallbackPrefix: "KIIP-TG"
    });
    const unlockCode = reserved.code;
    issuedUnlockCodes.set(unlockCode, {
      code: unlockCode,
      source: "telegram_bot",
      createdAt: Date.now(),
      used: false,
      verifiedAmount: analysis.amountKrw,
      bankName: analysis.bankName
    });
    serverPaymentsLog.unshift({
      id: `pay_tg_${Date.now()}`,
      userEmail: `${senderLabel}@telegram`,
      amount: analysis.amountKrw,
      currency: "KRW",
      method: `Telegram Receipt (${analysis.bankName})`,
      promoCodeUsed: unlockCode,
      createdAt: (/* @__PURE__ */ new Date()).toISOString()
    });
    await sendTelegramMessage(
      chatId,
      `\u2705 \u1795\u17D2\u1791\u17C0\u1784\u1795\u17D2\u1791\u17B6\u178F\u17CB\u179C\u17B7\u1780\u17D2\u1780\u1799\u1794\u178F\u17D2\u179A\u1787\u17C4\u1782\u1787\u17D0\u1799! (\u20A9${analysis.amountKrw.toLocaleString()} \xB7 ${analysis.bankName})

\u{1F511} \u179B\u17C1\u1781\u1780\u17BC\u178A\u178A\u17C4\u17C7\u179F\u17C4\u179A\u1794\u179F\u17CB\u17A2\u17D2\u1793\u1780 (Single-Use Unlock Code):
${unlockCode}

\u179F\u17BC\u1798\u1785\u1798\u17D2\u179B\u1784\u179B\u17C1\u1781\u1780\u17BC\u178A\u1793\u17C1\u17C7\u1799\u1780\u1791\u17C5\u1794\u1789\u17D2\u1785\u17BC\u179B\u1780\u17D2\u1793\u17BB\u1784\u1794\u17D2\u179A\u17A2\u1794\u17CB Promo / Redeem Code \u179B\u17BE\u1782\u17C1\u17A0\u1791\u17C6\u1796\u17D0\u179A\u178A\u17BE\u1798\u17D2\u1794\u17B8\u1791\u17B6\u1789\u1799\u1780\u17AF\u1780\u179F\u17B6\u179A Clean PDF \u1797\u17D2\u179B\u17B6\u1798\u17D7!`
    );
    if (process.env.TELEGRAM_ADMIN_CHAT_ID && String(process.env.TELEGRAM_ADMIN_CHAT_ID) !== String(chatId)) {
      await sendTelegramMessage(
        process.env.TELEGRAM_ADMIN_CHAT_ID,
        `\u{1F916} Telegram Auto-Unlock Issued
From: ${senderLabel}
Bank: ${analysis.bankName}
Amount: \u20A9${analysis.amountKrw.toLocaleString()}
Code: ${unlockCode}`
      );
    }
    return res.json({ ok: true });
  } catch (err) {
    console.error("[Telegram Webhook] Error:", err);
    return res.json({ ok: true });
  }
});
app.get("/api/admin/redeem-codes", requireAdminAuth, (req, res) => {
  try {
    const rawStatus = String(req.query?.status || "all");
    const filter = rawStatus === "Unused" || rawStatus === "Used" || rawStatus === "Revoked" ? rawStatus : "all";
    const search = String(req.query?.search || "").trim();
    const page = Math.max(1, Number(req.query?.page) || 1);
    const pageSize = Math.min(500, Math.max(10, Number(req.query?.pageSize) || 100));
    const result = queryRedeemCodes({
      statusFilter: filter,
      search,
      page,
      pageSize
    });
    const stats = getRedeemCodeStats();
    return res.json({
      success: true,
      stats,
      codes: result.codes,
      pagination: {
        page: result.page,
        pageSize: result.pageSize,
        totalMatched: result.totalMatched,
        totalPages: result.totalPages
      }
    });
  } catch (err) {
    console.error("[Admin RedeemDB] Read failed:", err);
    return res.status(500).json({ success: false, error: "Failed to read redeem codes database" });
  }
});
app.post("/api/admin/redeem-codes/generate", requireAdminAuth, (req, res) => {
  try {
    const count = Math.min(500, Math.max(1, Number(req.body?.count) || 10));
    const prefix = String(req.body?.prefix || "KIIP-26").trim();
    const note = String(req.body?.note || "Admin Generated Batch").trim();
    const created = generateUnusedRedeemCodes(count, prefix, note);
    const stats = getRedeemCodeStats();
    return res.json({
      success: true,
      createdCount: created.length,
      created,
      stats
    });
  } catch (err) {
    console.error("[Admin RedeemDB] Generate failed:", err);
    return res.status(500).json({ success: false, error: "Failed to generate redeem codes" });
  }
});
app.post("/api/admin/redeem-codes/add", requireAdminAuth, (req, res) => {
  try {
    const rawList = Array.isArray(req.body?.codes) ? req.body.codes.map((c) => String(c || "")) : String(req.body?.codesText || "").split(/[\n,;]+/).map((c) => c.trim()).filter(Boolean);
    if (rawList.length === 0) {
      return res.status(400).json({
        success: false,
        error: "\u179F\u17BC\u1798\u1794\u1789\u17D2\u1785\u17BC\u179B\u1799\u17C9\u17B6\u1784\u178F\u17B7\u1785 \u17E1 \u179B\u17C1\u1781\u1780\u17BC\u178A (\u1799\u17C9\u17B6\u1784\u178F\u17B7\u1785 \u17E4 \u178F\u17BD\u17A2\u1780\u17D2\u179F\u179A)\u17D4"
      });
    }
    const note = String(req.body?.note || "Manual Import").trim();
    const result = addCustomRedeemCodes(rawList, note, "admin");
    const stats = getRedeemCodeStats();
    return res.json({
      success: true,
      ...result,
      stats
    });
  } catch (err) {
    console.error("[Admin RedeemDB] Add failed:", err);
    return res.status(500).json({ success: false, error: "Failed to add redeem codes" });
  }
});
app.post("/api/admin/redeem-codes/sync-sheets", requireAdminAuth, async (req, res) => {
  try {
    const sheetId = String(req.body?.sheetId || "").trim() || void 0;
    const sheetName = String(req.body?.sheetName || "").trim() || void 0;
    const result = await syncRedeemCodesFromGoogleSheet({ sheetId, sheetName });
    const stats = getRedeemCodeStats();
    if (!result.success) {
      return res.status(400).json({ ...result, stats });
    }
    return res.json({ ...result, stats });
  } catch (err) {
    console.error("[Admin RedeemDB] Google Sheets sync failed:", err);
    return res.status(500).json({ success: false, error: "Google Sheets sync failed" });
  }
});
app.patch("/api/admin/redeem-codes/:code/status", requireAdminAuth, (req, res) => {
  try {
    const code = String(req.params.code || "");
    const status = String(req.body?.status || "");
    if (status !== "Unused" && status !== "Used" && status !== "Revoked") {
      return res.status(400).json({ success: false, error: "Invalid status. Must be Unused, Used, or Revoked." });
    }
    const updated = updateRedeemCodeStatus(code, status);
    if (!updated) {
      return res.status(404).json({ success: false, error: "Redeem code not found" });
    }
    return res.json({ success: true, stats: getRedeemCodeStats() });
  } catch (err) {
    console.error("[Admin RedeemDB] Update status failed:", err);
    return res.status(500).json({ success: false, error: "Failed to update status" });
  }
});
app.delete("/api/admin/redeem-codes/:code", requireAdminAuth, (req, res) => {
  try {
    const code = String(req.params.code || "");
    const deleted = deleteRedeemCode(code);
    if (!deleted) {
      return res.status(404).json({ success: false, error: "Redeem code not found" });
    }
    return res.json({ success: true, stats: getRedeemCodeStats() });
  } catch (err) {
    console.error("[Admin RedeemDB] Delete failed:", err);
    return res.status(500).json({ success: false, error: "Failed to delete redeem code" });
  }
});
app.post("/api/mail/send-receipt", aiApiRateLimiter, async (req, res) => {
  try {
    const { recipientEmail, officeEmail } = req.body || {};
    if (!recipientEmail && !officeEmail) {
      return res.status(400).json({ success: false, error: "Recipient email required" });
    }
    return res.json({
      success: true,
      simulated: true,
      message: "Please send the attached PDF directly using your preferred email client (Gmail / Naver / Daum / Mail app)."
    });
  } catch (err) {
    console.error("Mail endpoint error:", err);
    return res.status(500).json({ success: false, error: "Failed to process email request" });
  }
});
function buildWebsiteGuideSystemInstruction(ctx) {
  const missingSummary = ctx.missingItems.length > 0 ? ctx.missingItems.join(", ") : "None \u2014 all 6 mandatory Step 1 items are complete.";
  return [
    "You are the official Website Navigation & Help Assistant for the KIIP & TOPIK Linkage Application Portal (\uC0AC\uD68C\uD1B5\uD569\uD504\uB85C\uADF8\uB7A8 TOPIK \uC131\uC801 \uC5F0\uACC4 \uC2E0\uCCAD \uD3EC\uD138).",
    "Your role is to help visitors smoothly navigate this website, complete their TOPIK-to-KIIP linkage application step by step, troubleshoot upload/form/PDF/email questions, and jump directly to the right page or tool.",
    "",
    "LANGUAGE RULE:",
    `- The website interface is currently set to language code "${ctx.lang}".`,
    "- Always respond in the exact language the user writes in (Khmer, Korean, English, or any other language). If ambiguous, use the current website language.",
    "- Keep responses concise, structured, friendly, and directly actionable (short paragraphs or crisp bullet points).",
    "",
    "LIVE USER SESSION CONTEXT:",
    `- Current View: ${ctx.activeTab === "about" ? "About Me & Contact page" : ctx.activeTab === "guide" ? "TOPIK-to-KIIP Official Guide tab" : `Application Workflow \u2014 Step ${ctx.currentStep} of 5`}`,
    `- Step 1 Mandatory Checklist Ready: ${ctx.isStep1Ready ? "Yes (Steps 2\u20134 unlocked)" : "No"}`,
    `- Missing Step 1 Items: ${missingSummary}`,
    `- PDF/Step 5 Unlock Status: ${ctx.isPaid ? "Unlocked (Watermark removed & Step 5 enabled)" : "Locked (Requires Korea Bank transfer receipt, Telegram bot code, or Redeem/Promo code in Step 4)"}`,
    "",
    "ACCURATE WEBSITE MAP & WORKFLOW:",
    "1. Guide Tab (TOPIK \u2192 KIIP Linkage Guide): Explains eligibility, official TOPIK-to-KIIP level conversion (TOPIK Level 2 \u2192 KIIP Level 3, TOPIK Level 3 \u2192 KIIP Level 4, TOPIK Level 4 \u2192 KIIP Level 5 Basic, TOPIK Level 5\u20136 \u2192 KIIP Level 5 exam track), validity rules, and submission tips.",
    "2. Step 1 \u2014 Upload Documents & Info (Mandatory 6 items to unlock Steps 2\u20135):",
    "   (1) ARC Front & Back (\uC678\uAD6D\uC778\uB4F1\uB85D\uC99D \uC55E\xB7\uB4B7\uBA74) \u2014 supports automatic AI OCR extraction of Name, ARC number, Visa, Nationality, and Residence Address (\uCCB4\uB958\uC9C0).",
    "   (2) TOPIK Score Certificate (\uC131\uC801\uC99D\uBA85\uC11C) \u2014 supports automatic AI OCR extraction of Exam number, Exam date, Round (\uD68C), Validity date, Grade, and Verification number.",
    "   (3) Passport Copy (\uC5EC\uAD8C \uC0AC\uBCF8).",
    "   (4) Signature (\uC11C\uBA85) \u2014 draw directly on screen or upload photo with automatic background removal.",
    "   (5) Socinet Account ID & Password (\uC0AC\uD68C\uD1B5\uD569\uC815\uBCF4\uB9DD \uC544\uC774\uB514/\uBE44\uBC00\uBC88\uD638 \u2014 required by immigration officers to link your TOPIK score on socinet.go.kr; note: must already have a registered Socinet account).",
    "   (6) Korean Phone Number (\uC804\uD654\uBC88\uD638).",
    '   Tip: Users who just want to preview how the portal works can click "Load Sample" to populate demo documents in 1 click.',
    "3. Step 2 \u2014 Verify & Edit OCR Extracted Results: Lets users compare uploaded document previews side-by-side with all OCR-extracted text fields (ARC \uCCB4\uB958\uC9C0 address, TOPIK \uC2DC\uD5D8\uC77C/\uD68C/\uC131\uC801\uC720\uD6A8\uAE30\uAC04/\uB4F1\uAE09/\uC218\uD5D8\uBC88\uD638/\uBB38\uC11C\uD655\uC778\uBC88\uD638, Passport, and Identity) and edit or re-scan any field before confirming injection into the official form.",
    "4. Step 3 \u2014 Official Application Form & Signature Placement: Review/edit the Ministry of Justice KIIP-TOPIK linkage application form (\uC0AC\uD68C\uD1B5\uD569\uD504\uB85C\uADF8\uB7A8 \uC5F0\uACC4\uC2E0\uCCAD\uC11C) populated from Step 2 and drag/resize the signature inside the signature box.",
    "5. Step 4 \u2014 Merged PDF Preview & Unlock: Combines the filled application form + ARC + Passport + TOPIK certificate into one print-ready official PDF. To remove the watermark and unlock Step 5, users can:",
    "   - Transfer via Korea Bank and upload the transfer receipt screenshot for instant AI verification & auto-unlock,",
    "   - Use the Telegram bot auto-unlock receipt flow, or",
    "   - Enter a valid Redeem Code / Center Promo Code.",
    "6. Step 5 \u2014 Immigration Center Email Submission: Matches the applicant region/address to the jurisdiction Immigration / KIIP Operation Center email (\uCD9C\uC785\uAD6D\xB7\uC678\uAD6D\uC778\uCCAD / \uC0AC\uD68C\uD1B5\uD569\uC6B4\uC601\uAE30\uAD00) and prepares the email with ready-to-paste subject & body so the user can attach their merged PDF and send.",
    "7. About Me & Contact Page: Introduces the portal creator (Eang Veasna), explains the 1-minute private PDF workflow, and provides direct channels to send payment screenshots for fast Unlock / Redeem Code delivery: Facebook Page (https://www.facebook.com/eang.veasna.667/) and KakaoTalk ID: 9111veasna.",
    "8. Extra Portal Tools: 50+ Language Selector in the top bar, Socinet Account Notice popup, Background Wallpaper Settings, and automatic draft saving.",
    "",
    "INTERACTIVE NAVIGATION SHORTCUTS:",
    "When guiding the user to open a specific step or dialog on this website, you may append up to 2 action tags on a new line at the very end of your reply using ONLY these exact tokens:",
    "  [[NAV:step1]] \u2014 Jump to Step 1 (Upload Documents)",
    "  [[NAV:step2]] \u2014 Jump to Step 2 (Verify & Edit OCR Data)",
    "  [[NAV:step3]] \u2014 Jump to Step 3 (Official Application Form)",
    "  [[NAV:step4]] \u2014 Jump to Step 4 (PDF Preview & Download)",
    "  [[NAV:step5]] \u2014 Jump to Step 5 (Send Email to Immigration)",
    "  [[NAV:guide]] \u2014 Open TOPIK \u2192 KIIP Official Guide tab",
    "  [[NAV:about]] \u2014 Open About Me & Contact page (Facebook / KakaoTalk)",
    "  [[NAV:socinet]] \u2014 Open Socinet ID/Password Notice",
    "  [[NAV:payment]] \u2014 Open Unlock / Redeem Code dialog",
    "  [[NAV:language]] \u2014 Open 50+ Language Selector",
    "  [[NAV:sample]] \u2014 Load 1-Click Sample Documents for testing",
    "Only include navigation tags that genuinely help answer the user\u2019s request. Never invent any other tag names.",
    "",
    "SAFETY & ACCURACY RULES:",
    "- Never invent fake immigration center emails, fake redeem codes, or promise official Ministry of Justice approval.",
    "- Never ask for or discuss API keys, passwords to the admin dashboard, or internal server configuration."
  ].join("\n");
}
app.post("/api/chat-guide", aiApiRateLimiter, async (req, res) => {
  const ai = getAiClient();
  if (!ai) {
    return res.status(503).json({
      success: false,
      error: "AI Assistant is temporarily unavailable because GEMINI_API_KEY is not configured on the server."
    });
  }
  const rawMessages = Array.isArray(req.body?.messages) ? req.body.messages : [];
  if (rawMessages.length === 0) {
    return res.status(400).json({ success: false, error: "Please enter a message." });
  }
  const cleaned = [];
  for (const item of rawMessages.slice(-24)) {
    const role = item?.role === "model" ? "model" : item?.role === "user" ? "user" : null;
    const text = typeof item?.text === "string" ? item.text.trim().slice(0, 2e3) : "";
    if (!role || !text) continue;
    cleaned.push({ role, text });
  }
  if (cleaned.length === 0 || cleaned[cleaned.length - 1].role !== "user") {
    return res.status(400).json({ success: false, error: "The latest message must be from the user." });
  }
  const latestUserMessage = cleaned[cleaned.length - 1].text;
  const priorHistory = cleaned.slice(0, -1).map((m) => ({
    role: m.role,
    parts: [{ text: m.text }]
  }));
  const rawCtx = req.body?.context && typeof req.body.context === "object" ? req.body.context : {};
  const ctx = {
    lang: String(rawCtx.lang || "km").slice(0, 12),
    activeTab: rawCtx.activeTab === "about" ? "about" : rawCtx.activeTab === "guide" ? "guide" : "flow",
    currentStep: Math.min(4, Math.max(1, Number(rawCtx.currentStep) || 1)),
    isStep1Ready: Boolean(rawCtx.isStep1Ready),
    missingItems: Array.isArray(rawCtx.missingItems) ? rawCtx.missingItems.map((x) => String(x).slice(0, 60)).slice(0, 10) : [],
    isPaid: Boolean(rawCtx.isPaid)
  };
  const systemInstruction = buildWebsiteGuideSystemInstruction(ctx);
  let streamResponse = null;
  let lastError = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const chat = ai.chats.create({
        model: "gemini-4-hydrogen",
        history: priorHistory,
        config: {
          systemInstruction,
          thinkingConfig: {
            thinkingLevel: ThinkingLevel.LOW
          }
        }
      });
      streamResponse = await chat.sendMessageStream({ message: latestUserMessage });
      break;
    } catch (err) {
      lastError = err;
      if (attempt === 0 && isTransientError(err)) {
        await sleep(800);
        continue;
      }
      break;
    }
  }
  if (!streamResponse) {
    const errMsg = formatGeminiError(lastError);
    console.error("[ChatGuide] Gemini stream init failed:", errMsg);
    if (isAuthOrKeyError(lastError)) {
      return res.status(401).json({
        success: false,
        error: "Gemini API authentication failed. Please check the API key in Settings > Secrets."
      });
    }
    return res.status(502).json({
      success: false,
      error: "Unable to reach the assistant right now. Please try again in a moment."
    });
  }
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();
  let clientClosed = false;
  req.on("close", () => {
    clientClosed = true;
  });
  try {
    for await (const chunk of streamResponse) {
      if (clientClosed) break;
      const delta = chunk?.text;
      if (typeof delta === "string" && delta.length > 0) {
        res.write(`data: ${JSON.stringify({ delta })}

`);
      }
    }
    if (!clientClosed) {
      res.write(`data: ${JSON.stringify({ done: true })}

`);
      res.end();
    }
  } catch (err) {
    console.error("[ChatGuide] Stream interrupted:", formatGeminiError(err));
    if (!clientClosed) {
      res.write(
        `data: ${JSON.stringify({
          error: "The response stream was interrupted. Please try sending your question again."
        })}

`
      );
      res.end();
    }
  }
});
var USER_COOKIE_NAME = "kiip_user_session";
var USER_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1e3;
var OTP_TTL_MS = 10 * 60 * 1e3;
var pendingUserOtps = /* @__PURE__ */ new Map();
var revokedUserTokens = /* @__PURE__ */ new Set();
function isSmtpConfigured() {
  return Boolean(
    process.env.SMTP_HOST?.trim() && process.env.SMTP_USER?.trim() && process.env.SMTP_PASS?.trim()
  );
}
async function sendVerificationEmail(to, subject, textBody) {
  if (!isSmtpConfigured()) return false;
  try {
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST.trim(),
      port: parseInt(process.env.SMTP_PORT || "587", 10),
      secure: process.env.SMTP_SECURE === "true" || process.env.SMTP_PORT === "465",
      auth: {
        user: process.env.SMTP_USER.trim(),
        pass: process.env.SMTP_PASS.trim()
      }
    });
    await transporter.sendMail({
      from: (process.env.SMTP_FROM || process.env.SMTP_USER).trim(),
      to,
      subject,
      text: textBody
    });
    return true;
  } catch (err) {
    console.error("[SMTP] Failed to send email:", err);
    return false;
  }
}
function issueUserBearerToken(user) {
  const payload = Buffer.from(
    JSON.stringify({
      type: "public_user",
      uid: user.id,
      sub: user.email,
      name: user.name,
      phone: user.phone || "",
      provider: user.provider,
      iat: Date.now(),
      exp: Date.now() + USER_SESSION_TTL_MS,
      jti: crypto2.randomBytes(10).toString("hex")
    })
  ).toString("base64url");
  const sig = crypto2.createHmac("sha256", SESSION_SIGNING_SECRET).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}
function verifyUserBearerToken(token) {
  if (!token || revokedUserTokens.has(token)) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [payload, sig] = parts;
  const expectedSig = crypto2.createHmac("sha256", SESSION_SIGNING_SECRET).update(payload).digest("base64url");
  if (!safeEqualStrings(sig, expectedSig)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!parsed || parsed.type !== "public_user" || typeof parsed.exp !== "number" || Date.now() > parsed.exp) {
      return null;
    }
    return {
      uid: Number(parsed.uid) || 0,
      email: String(parsed.sub || ""),
      name: String(parsed.name || ""),
      phone: String(parsed.phone || ""),
      provider: parsed.provider === "otp" ? "otp" : parsed.provider === "google" ? "google" : "email"
    };
  } catch {
    return null;
  }
}
function extractUserTokenFromReq(req) {
  const authHeader = String(req.headers.authorization || "");
  if (authHeader.startsWith("Bearer ")) {
    const t = authHeader.slice(7).trim();
    if (t) return t;
  }
  const cookies = parseCookies(req);
  return String(cookies[USER_COOKIE_NAME] || "").trim();
}
app.post("/api/auth/register", userAuthRateLimiter, (req, res) => {
  try {
    const { email, name, phone, password } = req.body || {};
    const result = registerUserAccount({ email, name, phone, password });
    if (!result.ok || !result.user) {
      return res.status(400).json({ success: false, error: result.error || "Registration failed" });
    }
    const token = issueUserBearerToken(result.user);
    setHttpOnlyCookie(req, res, USER_COOKIE_NAME, token, Math.floor(USER_SESSION_TTL_MS / 1e3));
    return res.json({
      success: true,
      user: {
        isLoggedIn: true,
        name: result.user.name,
        email: result.user.email,
        phone: result.user.phone,
        avatar: "",
        provider: result.user.provider
      }
    });
  } catch (err) {
    console.error("[Auth] Register error:", err);
    return res.status(500).json({ success: false, error: "\u1794\u17D2\u179A\u1796\u17D0\u1793\u17D2\u1792\u1798\u17B6\u1793\u1794\u1789\u17D2\u17A0\u17B6\u1780\u17D2\u1793\u17BB\u1784\u1780\u17B6\u179A\u1785\u17BB\u17C7\u1788\u17D2\u1798\u17C4\u17C7!" });
  }
});
app.post("/api/auth/login", userAuthRateLimiter, (req, res) => {
  try {
    const { email, identifier, password } = req.body || {};
    const result = verifyUserLogin({
      identifier: String(identifier || email || ""),
      password: String(password || "")
    });
    if (!result.ok || !result.user) {
      return res.status(401).json({ success: false, error: result.error || "Invalid credentials" });
    }
    const token = issueUserBearerToken(result.user);
    setHttpOnlyCookie(req, res, USER_COOKIE_NAME, token, Math.floor(USER_SESSION_TTL_MS / 1e3));
    return res.json({
      success: true,
      user: {
        isLoggedIn: true,
        name: result.user.name,
        email: result.user.email,
        phone: result.user.phone,
        avatar: "",
        provider: result.user.provider
      }
    });
  } catch (err) {
    console.error("[Auth] Login error:", err);
    return res.status(500).json({ success: false, error: "\u1794\u17D2\u179A\u1796\u17D0\u1793\u17D2\u1792\u1798\u17B6\u1793\u1794\u1789\u17D2\u17A0\u17B6\u1780\u17D2\u1793\u17BB\u1784\u1780\u17B6\u179A\u1785\u17BC\u179B\u1782\u178E\u1793\u17B8!" });
  }
});
app.post("/api/auth/logout", (req, res) => {
  const token = extractUserTokenFromReq(req);
  if (token) {
    revokedUserTokens.add(token);
  }
  clearHttpOnlyCookie(req, res, USER_COOKIE_NAME);
  return res.json({ success: true });
});
app.get("/api/auth/me", (req, res) => {
  const token = extractUserTokenFromReq(req);
  const session = verifyUserBearerToken(token);
  if (!session) {
    return res.status(401).json({ success: false, error: "Session expired or invalid" });
  }
  const dbUser = session.email ? getUserAccountByEmail(session.email) : null;
  if (!dbUser) {
    return res.status(401).json({ success: false, error: "Account no longer exists" });
  }
  return res.json({
    success: true,
    user: {
      isLoggedIn: true,
      name: dbUser.name || session.name || session.email.split("@")[0],
      email: dbUser.email || session.email,
      phone: dbUser.phone || session.phone,
      avatar: "",
      provider: dbUser.provider || session.provider
    }
  });
});
app.post("/api/auth/change-password", userAuthRateLimiter, (req, res) => {
  const token = extractUserTokenFromReq(req);
  const session = verifyUserBearerToken(token);
  if (!session || !session.email) {
    return res.status(401).json({ success: false, error: "\u179F\u17BC\u1798\u1785\u17BC\u179B\u1782\u178E\u1793\u17B8\u1787\u17B6\u1798\u17BB\u1793\u179F\u17B7\u1793!" });
  }
  const currentPassword = String(req.body?.currentPassword || "");
  const newPassword = String(req.body?.newPassword || "");
  const result = changeUserAccountPassword({
    email: session.email,
    currentPassword,
    newPassword
  });
  if (!result.ok) {
    return res.status(400).json({ success: false, error: result.error || "Failed to change password" });
  }
  return res.json({ success: true });
});
app.post("/api/auth/otp/send", userAuthRateLimiter, async (req, res) => {
  const rawTarget = String(req.body?.target || "").trim().slice(0, 254);
  if (!rawTarget || rawTarget.length < 5 || !rawTarget.includes("@")) {
    return res.status(400).json({
      success: false,
      error: "\u179F\u17BC\u1798\u1794\u1789\u17D2\u1785\u17BC\u179B\u17A2\u17B6\u179F\u1799\u178A\u17D2\u178B\u17B6\u1793 Email \u17B1\u17D2\u1799\u1794\u17B6\u1793\u178F\u17D2\u179A\u17B9\u1798\u178F\u17D2\u179A\u17BC\u179C!"
    });
  }
  if (!isSmtpConfigured()) {
    return res.status(503).json({
      success: false,
      error: "\u179F\u17C1\u179C\u17B6\u1795\u17D2\u1789\u17BE\u1780\u17BC\u178A OTP \u178F\u17B6\u1798 Email \u1798\u17B7\u1793\u1791\u17B6\u1793\u17CB\u1794\u17B6\u1793\u1780\u17C6\u178E\u178F\u17CB\u1793\u17C5\u179B\u17BE Server \u1791\u17C1\u17D4 \u179F\u17BC\u1798\u1785\u17BB\u17C7\u1788\u17D2\u1798\u17C4\u17C7/\u1785\u17BC\u179B\u1782\u178E\u1793\u17B8\u178A\u17C4\u1799\u1794\u17D2\u179A\u17BE Email & Password \u17AC Continue with Google!"
    });
  }
  const key = `otp:${rawTarget.toLowerCase()}`;
  const code = String(crypto2.randomInt(1e5, 999999));
  pendingUserOtps.set(key, {
    code,
    expiresAt: Date.now() + OTP_TTL_MS,
    attempts: 0
  });
  for (const [k, v] of pendingUserOtps.entries()) {
    if (Date.now() > v.expiresAt) pendingUserOtps.delete(k);
  }
  const sent = await sendVerificationEmail(
    rawTarget,
    "KIIP & TOPIK Portal \u2014 Verification Code",
    `Your 6-digit verification code is: ${code}

This code expires in 10 minutes.`
  );
  if (!sent) {
    pendingUserOtps.delete(key);
    return res.status(502).json({
      success: false,
      error: "\u1798\u17B7\u1793\u17A2\u17B6\u1785\u1795\u17D2\u1789\u17BE Email \u1795\u17D2\u1791\u17C0\u1784\u1795\u17D2\u1791\u17B6\u178F\u17CB\u1794\u17B6\u1793\u1791\u17C1\u1793\u17C5\u1796\u17C1\u179B\u1793\u17C1\u17C7\u17D4 \u179F\u17BC\u1798\u1794\u17D2\u179A\u17BE Email & Password \u17AC Google Sign-In!"
    });
  }
  return res.json({
    success: true,
    target: rawTarget,
    expiresInSeconds: 600,
    delivery: "email"
  });
});
app.post("/api/auth/otp/verify", userAuthRateLimiter, (req, res) => {
  const rawTarget = String(req.body?.target || "").trim().slice(0, 254);
  const rawCode = String(req.body?.code || "").trim();
  const rawName = String(req.body?.name || "").trim().slice(0, 120);
  if (!rawTarget || !rawCode) {
    return res.status(400).json({
      success: false,
      error: "\u179F\u17BC\u1798\u1794\u1789\u17D2\u1785\u17BC\u179B Email \u1793\u17B7\u1784\u1780\u17BC\u178A OTP \u17E6 \u1781\u17D2\u1791\u1784\u17CB!"
    });
  }
  const key = `otp:${rawTarget.toLowerCase()}`;
  const entry = pendingUserOtps.get(key);
  if (!entry || Date.now() > entry.expiresAt) {
    pendingUserOtps.delete(key);
    return res.status(400).json({
      success: false,
      error: '\u1780\u17BC\u178A OTP \u1795\u17BB\u178F\u1780\u17C6\u178E\u178F\u17CB \u17AC\u1798\u17B7\u1793\u1791\u17B6\u1793\u17CB\u1794\u17B6\u1793\u1795\u17D2\u1789\u17BE! \u179F\u17BC\u1798\u1785\u17BB\u1785 "\u1795\u17D2\u1789\u17BE\u1780\u17BC\u178A OTP" \u1798\u17D2\u178F\u1784\u1791\u17C0\u178F\u17D4'
    });
  }
  if (entry.attempts >= 5) {
    pendingUserOtps.delete(key);
    return res.status(429).json({
      success: false,
      error: "\u1794\u1789\u17D2\u1785\u17BC\u179B\u1780\u17BC\u178A\u1781\u17BB\u179F\u1785\u17D2\u179A\u17BE\u1793\u178A\u1784\u1796\u17C1\u1780! \u179F\u17BC\u1798\u179F\u17D2\u1793\u17BE\u179F\u17BB\u17C6\u1780\u17BC\u178A OTP \u1790\u17D2\u1798\u17B8\u17D4"
    });
  }
  if (!safeEqualStrings(rawCode, entry.code)) {
    entry.attempts += 1;
    return res.status(400).json({
      success: false,
      error: "\u179B\u17C1\u1781\u1780\u17BC\u178A OTP \u1798\u17B7\u1793\u178F\u17D2\u179A\u17B9\u1798\u178F\u17D2\u179A\u17BC\u179C\u1791\u17C1! \u179F\u17BC\u1798\u1796\u17B7\u1793\u17B7\u178F\u17D2\u1799\u1798\u17D2\u178F\u1784\u1791\u17C0\u178F\u17D4"
    });
  }
  pendingUserOtps.delete(key);
  const otpResult = upsertOtpUserAccount({ target: rawTarget, name: rawName });
  if (!otpResult.ok || !otpResult.user) {
    return res.status(409).json({
      success: false,
      error: otpResult.error || "\u1782\u178E\u1793\u17B8\u1793\u17C1\u17C7\u178F\u17D2\u179A\u17BC\u179C\u1794\u17B6\u1793\u1780\u17B6\u179A\u1796\u17B6\u179A\u178A\u17C4\u1799\u1796\u17B6\u1780\u17D2\u1799\u179F\u1798\u17D2\u1784\u17B6\u178F\u17CB! \u179F\u17BC\u1798\u1785\u17BC\u179B\u178F\u17B6\u1798 Email & Password\u17D4"
    });
  }
  const token = issueUserBearerToken(otpResult.user);
  setHttpOnlyCookie(req, res, USER_COOKIE_NAME, token, Math.floor(USER_SESSION_TTL_MS / 1e3));
  return res.json({
    success: true,
    user: {
      isLoggedIn: true,
      name: otpResult.user.name,
      email: otpResult.user.email,
      phone: otpResult.user.phone,
      avatar: "",
      provider: "otp"
    }
  });
});
app.post("/api/auth/reset-password/request", userAuthRateLimiter, async (req, res) => {
  const email = String(req.body?.email || "").trim().toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ success: false, error: "\u179F\u17BC\u1798\u1794\u1789\u17D2\u1785\u17BC\u179B\u17A2\u17B6\u179F\u1799\u178A\u17D2\u178B\u17B6\u1793 Email \u17B1\u17D2\u1799\u1794\u17B6\u1793\u178F\u17D2\u179A\u17B9\u1798\u178F\u17D2\u179A\u17BC\u179C!" });
  }
  if (!isSmtpConfigured()) {
    return res.status(503).json({
      success: false,
      error: "\u1780\u17B6\u179A\u1795\u17D2\u1789\u17BE\u1780\u17BC\u178A\u1794\u17D2\u178A\u17BC\u179A\u1796\u17B6\u1780\u17D2\u1799\u179F\u1798\u17D2\u1784\u17B6\u178F\u17CB\u178F\u17B6\u1798 Email \u1798\u17B7\u1793\u1791\u17B6\u1793\u17CB\u1794\u17B6\u1793\u1780\u17C6\u178E\u178F\u17CB\u1793\u17C5\u179B\u17BE Server \u1791\u17C1\u17D4 \u179F\u17BC\u1798\u1785\u17BC\u179B\u178F\u17B6\u1798 Google \u17AC\u1791\u17B6\u1780\u17CB\u1791\u1784 Admin (Facebook/KakaoTalk: 9111veasna) \u178A\u17BE\u1798\u17D2\u1794\u17B8\u1787\u17BD\u1799\u179F\u17D2\u178F\u17B6\u179A\u1782\u178E\u1793\u17B8\u17D4"
    });
  }
  const existing = getUserAccountByEmail(email);
  if (existing) {
    const code = String(crypto2.randomInt(1e5, 999999));
    pendingUserOtps.set(`reset:${email}`, {
      code,
      expiresAt: Date.now() + OTP_TTL_MS,
      attempts: 0
    });
    await sendVerificationEmail(
      email,
      "KIIP & TOPIK Portal \u2014 Password Reset Code",
      `Your 6-digit password reset code is: ${code}

If you did not request this, ignore this email.`
    );
  }
  return res.json({
    success: true,
    message: "\u1794\u17D2\u179A\u179F\u17B7\u1793\u1794\u17BE Email \u1793\u17C1\u17C7\u1798\u17B6\u1793\u1780\u17D2\u1793\u17BB\u1784\u1794\u17D2\u179A\u1796\u17D0\u1793\u17D2\u1792 \u1780\u17BC\u178A\u1780\u17C6\u178E\u178F\u17CB\u1796\u17B6\u1780\u17D2\u1799\u179F\u1798\u17D2\u1784\u17B6\u178F\u17CB\u1790\u17D2\u1798\u17B8\u178F\u17D2\u179A\u17BC\u179C\u1794\u17B6\u1793\u1795\u17D2\u1789\u17BE\u1791\u17C5\u1794\u17D2\u179A\u17A2\u1794\u17CB\u179F\u17B6\u179A Email \u179A\u1794\u179F\u17CB\u17A2\u17D2\u1793\u1780\u17A0\u17BE\u1799\u17D4"
  });
});
app.post("/api/auth/reset-password/confirm", userAuthRateLimiter, (req, res) => {
  const email = String(req.body?.email || "").trim().toLowerCase();
  const code = String(req.body?.code || "").trim();
  const newPassword = String(req.body?.newPassword || "");
  const key = `reset:${email}`;
  const entry = pendingUserOtps.get(key);
  if (!entry || Date.now() > entry.expiresAt) {
    pendingUserOtps.delete(key);
    return res.status(400).json({
      success: false,
      error: "\u1780\u17BC\u178A\u1780\u17C6\u178E\u178F\u17CB\u1796\u17B6\u1780\u17D2\u1799\u179F\u1798\u17D2\u1784\u17B6\u178F\u17CB\u1795\u17BB\u178F\u1780\u17C6\u178E\u178F\u17CB\u17A0\u17BE\u1799! \u179F\u17BC\u1798\u179F\u17D2\u1793\u17BE\u179F\u17BB\u17C6\u1780\u17BC\u178A\u1790\u17D2\u1798\u17B8\u17D4"
    });
  }
  if (entry.attempts >= 5) {
    pendingUserOtps.delete(key);
    return res.status(429).json({ success: false, error: "\u1794\u1789\u17D2\u1785\u17BC\u179B\u1780\u17BC\u178A\u1781\u17BB\u179F\u1785\u17D2\u179A\u17BE\u1793\u178A\u1784\u1796\u17C1\u1780!" });
  }
  if (!safeEqualStrings(code, entry.code)) {
    entry.attempts += 1;
    return res.status(400).json({ success: false, error: "\u179B\u17C1\u1781\u1780\u17BC\u178A\u1780\u17C6\u178E\u178F\u17CB\u1796\u17B6\u1780\u17D2\u1799\u179F\u1798\u17D2\u1784\u17B6\u178F\u17CB\u1798\u17B7\u1793\u178F\u17D2\u179A\u17B9\u1798\u178F\u17D2\u179A\u17BC\u179C\u1791\u17C1!" });
  }
  const resetRes = resetUserAccountPassword({ email, newPassword });
  if (!resetRes.ok) {
    return res.status(400).json({ success: false, error: resetRes.error || "Password reset failed" });
  }
  pendingUserOtps.delete(key);
  return res.json({ success: true });
});
async function startServer() {
  const http = await import("http");
  const server = http.createServer(app);
  let viteInstance = null;
  if (process.env.NODE_ENV === "production") {
    app.use(express.static(path2.resolve(__dirname, "dist")));
    app.get("*", (req, res) => {
      res.sendFile(path2.resolve(__dirname, "dist", "index.html"));
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
