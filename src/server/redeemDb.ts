import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { DatabaseSync } from 'node:sqlite';

export type RedeemCodeStatus = 'Unused' | 'Used' | 'Revoked';

export interface RedeemCodeRecord {
  id: number;
  code: string;
  status: RedeemCodeStatus;
  source: string;
  note: string;
  assigned_to: string;
  created_at: string;
  used_at: string | null;
}

export interface RedeemCodeStats {
  total: number;
  unusedCount: number;
  usedCount: number;
  revokedCount: number;
  databasePath: string;
  googleSheetConfigured: boolean;
}

const DATA_DIR = path.resolve(process.cwd(), 'data');
const DB_FILE_PATH = path.join(DATA_DIR, 'redeem_codes.sqlite');
const INITIAL_UNUSED_SEED_COUNT = 25;
export const MAX_BULK_IMPORT_CODES = 50000;

let dbInstance: DatabaseSync | null = null;

function ensureDataDir(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

export function normalizeCode(raw: string): string {
  return String(raw || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, '')
    .slice(0, 64);
}

function normalizeStatus(raw?: string): RedeemCodeStatus {
  const s = String(raw || '').trim().toLowerCase();
  if (s === 'used' || s === 'claimed' || s === 'redeemed') return 'Used';
  if (s === 'revoked' || s === 'disabled' || s === 'expired') return 'Revoked';
  return 'Unused';
}

function generateSecureCode(prefix = 'KIIP-26'): string {
  const cleanPrefix = normalizeCode(prefix).slice(0, 16) || 'KIIP-26';
  const suffix = crypto.randomBytes(3).toString('hex').toUpperCase();
  return `${cleanPrefix}-${suffix}`;
}

export function getRedeemDb(): DatabaseSync {
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

/**
 * Seeds pre-generated Redeem Codes with status = 'Unused' when the database is initialized
 * (plus any codes listed in process.env.REDEEM_CODES).
 */
function seedInitialUnusedCodes(db: DatabaseSync): void {
  const countRow = db.prepare('SELECT COUNT(*) as cnt FROM redeem_codes').get() as { cnt: number };
  const nowIso = new Date().toISOString();
  const insertStmt = db.prepare(
    `INSERT OR IGNORE INTO redeem_codes (code, status, source, note, assigned_to, created_at)
     VALUES (?, 'Unused', ?, ?, '', ?)`
  );

  // Import any env-provided REDEEM_CODES as 'Unused'
  const envCodes = (process.env.REDEEM_CODES || '')
    .split(',')
    .map((c) => normalizeCode(c))
    .filter((c) => c.length >= 4);

  for (const code of envCodes) {
    insertStmt.run(code, 'env_seed', 'Imported from REDEEM_CODES', nowIso);
  }

  // Pre-seed 25 ready-to-use Redeem Codes with status = 'Unused' if DB was empty
  if (Number(countRow?.cnt || 0) === 0) {
    for (let i = 1; i <= INITIAL_UNUSED_SEED_COUNT; i++) {
      const batchLabel = `Pre-seeded Batch #${String(i).padStart(2, '0')}`;
      const code = generateSecureCode('KIIP-26');
      insertStmt.run(code, 'database', batchLabel, nowIso);
    }
    console.log(
      `[RedeemDB] Initialized SQLite database with ${INITIAL_UNUSED_SEED_COUNT} pre-seeded 'Unused' redeem codes.`
    );
  }
}

export function getRedeemCodeStats(): RedeemCodeStats {
  const db = getRedeemDb();
  const rows = db
    .prepare('SELECT status, COUNT(*) as cnt FROM redeem_codes GROUP BY status')
    .all() as Array<{ status: string; cnt: number }>;

  let unusedCount = 0;
  let usedCount = 0;
  let revokedCount = 0;

  for (const r of rows) {
    if (r.status === 'Unused') unusedCount = Number(r.cnt) || 0;
    else if (r.status === 'Used') usedCount = Number(r.cnt) || 0;
    else if (r.status === 'Revoked') revokedCount = Number(r.cnt) || 0;
  }

  return {
    total: unusedCount + usedCount + revokedCount,
    unusedCount,
    usedCount,
    revokedCount,
    databasePath: 'data/redeem_codes.sqlite',
    googleSheetConfigured: Boolean(process.env.GOOGLE_SHEET_ID?.trim()),
  };
}

export interface RedeemCodePageResult {
  codes: RedeemCodeRecord[];
  totalMatched: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export function queryRedeemCodes(params?: {
  statusFilter?: 'Unused' | 'Used' | 'Revoked' | 'all';
  search?: string;
  page?: number;
  pageSize?: number;
}): RedeemCodePageResult {
  const db = getRedeemDb();
  const statusFilter = params?.statusFilter || 'all';
  const safePageSize = Math.min(500, Math.max(10, Math.floor(params?.pageSize ?? 100)));
  const requestedPage = Math.max(1, Math.floor(params?.page ?? 1));
  const rawSearch = String(params?.search || '').trim().slice(0, 80);

  const conditions: string[] = [];
  const whereArgs: Array<string | number> = [];

  if (statusFilter === 'Unused' || statusFilter === 'Used' || statusFilter === 'Revoked') {
    conditions.push('status = ?');
    whereArgs.push(statusFilter);
  }

  if (rawSearch) {
    const escaped = rawSearch.replace(/[\\%_]/g, '\\$&');
    const likePattern = `%${escaped}%`;
    conditions.push(`(code LIKE ? ESCAPE '\\' OR note LIKE ? ESCAPE '\\' OR assigned_to LIKE ? ESCAPE '\\')`);
    whereArgs.push(likePattern, likePattern, likePattern);
  }

  const whereSql = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const countRow = db
    .prepare(`SELECT COUNT(*) as cnt FROM redeem_codes ${whereSql}`)
    .get(...whereArgs) as { cnt: number };
  const totalMatched = Number(countRow?.cnt || 0);
  const totalPages = Math.max(1, Math.ceil(totalMatched / safePageSize));
  const page = Math.min(requestedPage, totalPages);
  const offset = (page - 1) * safePageSize;

  const orderSql =
    statusFilter === 'Unused' || statusFilter === 'Used' || statusFilter === 'Revoked'
      ? 'id DESC'
      : "CASE status WHEN 'Unused' THEN 0 WHEN 'Used' THEN 1 ELSE 2 END, id DESC";

  const codes = db
    .prepare(
      `SELECT id, code, status, source, note, assigned_to, created_at, used_at
       FROM redeem_codes
       ${whereSql}
       ORDER BY ${orderSql}
       LIMIT ? OFFSET ?`
    )
    .all(...whereArgs, safePageSize, offset) as unknown as RedeemCodeRecord[];

  return {
    codes,
    totalMatched,
    page,
    pageSize: safePageSize,
    totalPages,
  };
}

export function listRedeemCodes(
  statusFilter: 'Unused' | 'Used' | 'Revoked' | 'all' = 'all',
  limit = 500
): RedeemCodeRecord[] {
  const safeLimit = Math.min(1000, Math.max(1, Math.floor(limit)));
  return queryRedeemCodes({ statusFilter, page: 1, pageSize: Math.min(500, safeLimit) }).codes;
}

export function generateUnusedRedeemCodes(
  count: number,
  prefix = 'KIIP-26',
  note = 'Admin Generated'
): RedeemCodeRecord[] {
  const db = getRedeemDb();
  const safeCount = Math.min(500, Math.max(1, Math.floor(count)));
  const safeNote = String(note || 'Admin Generated').trim().slice(0, 140);
  const nowIso = new Date().toISOString();

  const insertStmt = db.prepare(
    `INSERT OR IGNORE INTO redeem_codes (code, status, source, note, assigned_to, created_at)
     VALUES (?, 'Unused', 'admin', ?, '', ?)`
  );
  const selectStmt = db.prepare(
    `SELECT id, code, status, source, note, assigned_to, created_at, used_at
     FROM redeem_codes WHERE code = ?`
  );

  const created: RedeemCodeRecord[] = [];
  let attempts = 0;

  db.exec('BEGIN IMMEDIATE');
  try {
    while (created.length < safeCount && attempts < safeCount * 5) {
      attempts++;
      const code = generateSecureCode(prefix);
      const info = insertStmt.run(code, safeNote, nowIso);
      if (Number(info.changes) > 0) {
        const row = selectStmt.get(code) as unknown as RedeemCodeRecord | undefined;
        if (row) created.push(row);
      }
    }
    db.exec('COMMIT');
  } catch (err) {
    try {
      db.exec('ROLLBACK');
    } catch {
      // ignore rollback failure
    }
    throw err;
  }

  return created;
}

export function addCustomRedeemCodes(
  rawCodes: string[],
  note = 'Manual Import',
  source = 'admin'
): { added: number; skipped: number; totalReceived: number; truncated: boolean; codes: string[] } {
  const db = getRedeemDb();
  const safeNote = String(note || 'Manual Import').trim().slice(0, 140);
  const safeSource = String(source || 'admin').trim().slice(0, 32);
  const nowIso = new Date().toISOString();

  const insertStmt = db.prepare(
    `INSERT OR IGNORE INTO redeem_codes (code, status, source, note, assigned_to, created_at)
     VALUES (?, 'Unused', ?, ?, '', ?)`
  );

  const totalReceived = rawCodes.length;
  const truncated = totalReceived > MAX_BULK_IMPORT_CODES;
  const sliceToProcess = truncated ? rawCodes.slice(0, MAX_BULK_IMPORT_CODES) : rawCodes;

  let added = 0;
  let skipped = 0;
  const insertedSample: string[] = [];

  db.exec('BEGIN IMMEDIATE');
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
    db.exec('COMMIT');
  } catch (err) {
    try {
      db.exec('ROLLBACK');
    } catch {
      // ignore rollback failure
    }
    throw err;
  }

  return { added, skipped, totalReceived, truncated, codes: insertedSample };
}

/**
 * Atomically verifies a Redeem Code and marks it 'Used' if its status is 'Unused'.
 */
export function verifyAndBurnRedeemCode(
  rawCode: string,
  usedBy = ''
): { ok: boolean; statusCode: number; error?: string; record?: RedeemCodeRecord } {
  const code = normalizeCode(rawCode);
  if (!code || code.length < 4) {
    return {
      ok: false,
      statusCode: 400,
      error: 'សូមបញ្ចូលលេខកូដ Redeem Code ឱ្យបានត្រឹមត្រូវ!',
    };
  }

  const db = getRedeemDb();
  const safeUser = String(usedBy || '').trim().slice(0, 160);
  const nowIso = new Date().toISOString();

  db.exec('BEGIN IMMEDIATE');
  try {
    const existing = db
      .prepare(
        `SELECT id, code, status, source, note, assigned_to, created_at, used_at
         FROM redeem_codes WHERE code = ?`
      )
      .get(code) as unknown as RedeemCodeRecord | undefined;

    if (!existing) {
      db.exec('COMMIT');
      return {
        ok: false,
        statusCode: 404,
        error: 'រកមិនឃើញលេខកូដនេះក្នុងប្រព័ន្ធ Database ឡើយ!',
      };
    }

    if (existing.status === 'Used') {
      db.exec('COMMIT');
      return {
        ok: false,
        statusCode: 409,
        error: 'លេខកូដដោះសោនេះត្រូវបានប្រើប្រាស់រួចហើយ (Used)!',
      };
    }

    if (existing.status === 'Revoked') {
      db.exec('COMMIT');
      return {
        ok: false,
        statusCode: 403,
        error: 'លេខកូដនេះត្រូវបានផ្អាក ឬផុតសុពលភាព (Revoked)!',
      };
    }

    const assignee = existing.assigned_to || safeUser || 'web_user';
    db.prepare(
      `UPDATE redeem_codes
       SET status = 'Used', used_at = ?, assigned_to = ?
       WHERE id = ? AND status = 'Unused'`
    ).run(nowIso, assignee, existing.id);

    db.exec('COMMIT');
    return {
      ok: true,
      statusCode: 200,
      record: {
        ...existing,
        status: 'Used',
        used_at: nowIso,
        assigned_to: assignee,
      },
    };
  } catch (err) {
    try {
      db.exec('ROLLBACK');
    } catch {
      // ignore rollback failure
    }
    throw err;
  }
}

/**
 * Reserves the next unassigned 'Unused' code from the Database (e.g., for Korea Bank or Telegram Auto-Unlock).
 * If the pool of unassigned 'Unused' codes is empty, mints a fresh code into the Database automatically.
 */
export function reserveUnusedRedeemCode(params: {
  source: 'kr_receipt' | 'telegram_bot';
  assignedTo: string;
  note: string;
  fallbackPrefix?: string;
}): RedeemCodeRecord {
  const db = getRedeemDb();
  const safeAssignee = String(params.assignedTo || 'customer').trim().slice(0, 160);
  const safeNote = String(params.note || '').trim().slice(0, 160);
  const nowIso = new Date().toISOString();

  db.exec('BEGIN IMMEDIATE');
  try {
    const candidate = db
      .prepare(
        `SELECT id, code, status, source, note, assigned_to, created_at, used_at
         FROM redeem_codes
         WHERE status = 'Unused' AND (assigned_to IS NULL OR assigned_to = '')
         ORDER BY id ASC
         LIMIT 1`
      )
      .get() as unknown as RedeemCodeRecord | undefined;

    if (candidate) {
      db.prepare(
        `UPDATE redeem_codes
         SET assigned_to = ?, note = ?, source = ?
         WHERE id = ?`
      ).run(safeAssignee, safeNote || candidate.note, params.source, candidate.id);
      db.exec('COMMIT');
      return {
        ...candidate,
        assigned_to: safeAssignee,
        note: safeNote || candidate.note,
        source: params.source,
      };
    }

    // Pool empty -> mint a fresh code directly into the Database with status = 'Unused'
    const newCode = generateSecureCode(params.fallbackPrefix || (params.source === 'telegram_bot' ? 'KIIP-TG' : 'KIIP-KR'));
    db.prepare(
      `INSERT INTO redeem_codes (code, status, source, note, assigned_to, created_at)
       VALUES (?, 'Unused', ?, ?, ?, ?)`
    ).run(newCode, params.source, safeNote, safeAssignee, nowIso);

    const created = db
      .prepare(
        `SELECT id, code, status, source, note, assigned_to, created_at, used_at
         FROM redeem_codes WHERE code = ?`
      )
      .get(newCode) as unknown as RedeemCodeRecord;

    db.exec('COMMIT');
    return created;
  } catch (err) {
    try {
      db.exec('ROLLBACK');
    } catch {
      // ignore
    }
    throw err;
  }
}

export function updateRedeemCodeStatus(
  rawCode: string,
  newStatus: RedeemCodeStatus
): boolean {
  const code = normalizeCode(rawCode);
  if (!code) return false;
  const db = getRedeemDb();
  const usedAt = newStatus === 'Used' ? new Date().toISOString() : null;
  const info = db
    .prepare('UPDATE redeem_codes SET status = ?, used_at = ? WHERE code = ?')
    .run(newStatus, usedAt, code);
  return Number(info.changes) > 0;
}

export function deleteRedeemCode(rawCode: string): boolean {
  const code = normalizeCode(rawCode);
  if (!code) return false;
  const db = getRedeemDb();
  const info = db.prepare('DELETE FROM redeem_codes WHERE code = ?').run(code);
  return Number(info.changes) > 0;
}

/**
 * Simple RFC-4180 CSV line parser (handles quoted cells and commas inside quotes).
 */
function parseCsvRows(csvText: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
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
      } else if (ch === ',') {
        row.push(cell.trim());
        cell = '';
      } else if (ch === '\r' && next === '\n') {
        row.push(cell.trim());
        rows.push(row);
        row = [];
        cell = '';
        i++;
      } else if (ch === '\n' || ch === '\r') {
        row.push(cell.trim());
        rows.push(row);
        row = [];
        cell = '';
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

const SHEET_ID_REGEX = /^[a-zA-Z0-9_-]{10,120}$/;
const PUBLISHED_ID_REGEX = /^2PACX-[a-zA-Z0-9_-]{10,160}$/;
const GID_REGEX = /^[0-9]{1,20}$/;

interface ParsedSheetRef {
  sheetId?: string;
  publishedId?: string;
  gid?: string;
}

/**
 * Strictly extracts only validated Google Sheets identifiers (sheetId, publishedId, gid)
 * from either a raw ID or a full docs.google.com/spreadsheets URL.
 * Never returns or fetches user-supplied hostnames (SSRF-safe).
 */
export function parseGoogleSheetReference(rawInput: string): ParsedSheetRef | null {
  const input = String(rawInput || '').trim();
  if (!input) return null;

  // 1. Direct Published-to-Web ID (2PACX-...)
  if (PUBLISHED_ID_REGEX.test(input)) {
    return { publishedId: input };
  }

  // 2. Direct standard Sheet ID
  if (SHEET_ID_REGEX.test(input)) {
    return { sheetId: input };
  }

  // 3. Full Google Sheets URL (strictly allowlisted to docs.google.com)
  try {
    const candidate = input.startsWith('http://') || input.startsWith('https://') ? input : `https://${input}`;
    const parsedUrl = new URL(candidate);
    if (parsedUrl.hostname.toLowerCase() !== 'docs.google.com') {
      return null;
    }

    // Extract optional gid from query (?gid=...) or hash (#gid=...)
    let gid = parsedUrl.searchParams.get('gid') || undefined;
    if (!gid && parsedUrl.hash) {
      const hashMatch = parsedUrl.hash.match(/gid=([0-9]+)/i);
      if (hashMatch) gid = hashMatch[1];
    }
    if (gid && !GID_REGEX.test(gid)) {
      gid = undefined;
    }

    // Published-to-web URL: /spreadsheets/d/e/2PACX-.../pubhtml or /pub?output=csv
    const pubMatch = parsedUrl.pathname.match(/\/spreadsheets\/d\/e\/(2PACX-[a-zA-Z0-9_-]{10,160})/i);
    if (pubMatch && PUBLISHED_ID_REGEX.test(pubMatch[1])) {
      return { publishedId: pubMatch[1], gid };
    }

    // Standard URL: /spreadsheets/d/<SHEET_ID>/edit...
    const stdMatch = parsedUrl.pathname.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]{10,120})/i);
    if (stdMatch && SHEET_ID_REGEX.test(stdMatch[1])) {
      return { sheetId: stdMatch[1], gid };
    }
  } catch {
    return null;
  }

  return null;
}

async function fetchCsvFromGoogleUrl(
  url: string
): Promise<{ ok: boolean; status: number; isHtmlLogin: boolean; rows: string[][]; errorText?: string }> {
  const resp = await fetch(url, {
    redirect: 'follow',
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; KIIP-Portal-SheetSync/1.0)',
      Accept: 'text/csv, text/plain, */*',
    },
    signal: AbortSignal.timeout(12000),
  });

  if (!resp.ok) {
    return { ok: false, status: resp.status, isHtmlLogin: false, rows: [], errorText: `HTTP ${resp.status}` };
  }

  const rawText = await resp.text();
  const cleanText = rawText.replace(/^\uFEFF/, '').trim();
  if (!cleanText) {
    return { ok: true, status: resp.status, isHtmlLogin: false, rows: [] };
  }

  const lowerHead = cleanText.slice(0, 300).toLowerCase();
  if (
    lowerHead.startsWith('<!doctype html') ||
    lowerHead.startsWith('<html') ||
    lowerHead.includes('accounts.google.com') ||
    lowerHead.includes('servicelogin')
  ) {
    return { ok: false, status: resp.status, isHtmlLogin: true, rows: [] };
  }

  return { ok: true, status: resp.status, isHtmlLogin: false, rows: parseCsvRows(cleanText) };
}

/**
 * Connects to Google Sheets (strictly allowlisted to Google domains to prevent SSRF),
 * accepts a full Google Sheets URL, Published-to-Web URL, or raw Sheet ID,
 * reads rows of Redeem Codes (Columns: Code, Status, Note), and syncs them into SQLite.
 */
export async function syncRedeemCodesFromGoogleSheet(params?: {
  sheetId?: string;
  sheetName?: string;
}): Promise<{
  success: boolean;
  sheetId: string;
  sheetName: string;
  rowsRead: number;
  imported: number;
  skipped: number;
  error?: string;
}> {
  const rawSheetInput = String(params?.sheetId || process.env.GOOGLE_SHEET_ID || '').trim();
  const requestedSheetName = String(params?.sheetName ?? process.env.GOOGLE_SHEET_TAB ?? '')
    .trim()
    .slice(0, 80);

  const parsedRef = parseGoogleSheetReference(rawSheetInput);
  if (!parsedRef) {
    return {
      success: false,
      sheetId: rawSheetInput,
      sheetName: requestedSheetName || 'Sheet1',
      rowsRead: 0,
      imported: 0,
      skipped: 0,
      error:
        'សូមបញ្ចូល Link Google Sheet ទាំងមូល (https://docs.google.com/spreadsheets/d/...) ឬ Google Sheet ID ឱ្យបានត្រឹមត្រូវ!',
    };
  }

  const resolvedId = parsedRef.sheetId || parsedRef.publishedId || rawSheetInput;
  let effectiveSheetName = requestedSheetName || (parsedRef.gid ? `gid:${parsedRef.gid}` : 'Tab 1');
  let parsedRows: string[][] = [];
  let sawHtmlLogin = false;
  let lastHttpStatus = 0;

  const apiKey = process.env.GOOGLE_SHEETS_API_KEY?.trim();

  try {
    if (parsedRef.publishedId) {
      // Published to web (File → Share → Publish to web)
      const pubUrl = parsedRef.gid
        ? `https://docs.google.com/spreadsheets/d/e/${encodeURIComponent(parsedRef.publishedId)}/pub?gid=${encodeURIComponent(parsedRef.gid)}&single=true&output=csv`
        : `https://docs.google.com/spreadsheets/d/e/${encodeURIComponent(parsedRef.publishedId)}/pub?output=csv`;
      const r = await fetchCsvFromGoogleUrl(pubUrl);
      if (r.ok) {
        parsedRows = r.rows;
      } else {
        sawHtmlLogin = r.isHtmlLogin;
        lastHttpStatus = r.status;
      }
    } else if (parsedRef.sheetId) {
      let fetched = false;

      // Strategy 1: Official Google Sheets API v4 (if GOOGLE_SHEETS_API_KEY is configured)
      if (apiKey) {
        let targetTab = requestedSheetName;
        if (!targetTab) {
          const metaResp = await fetch(
            `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(parsedRef.sheetId)}?fields=sheets.properties.title&key=${encodeURIComponent(apiKey)}`,
            { signal: AbortSignal.timeout(10000) }
          );
          if (metaResp.ok) {
            const metaJson = (await metaResp.json()) as { sheets?: Array<{ properties?: { title?: string } }> };
            targetTab = metaJson?.sheets?.[0]?.properties?.title || 'Sheet1';
            effectiveSheetName = targetTab;
          }
        }
        const range = encodeURIComponent(targetTab ? `${targetTab}!A1:E50000` : 'A1:E50000');
        const apiUrl = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(parsedRef.sheetId)}/values/${range}?key=${encodeURIComponent(apiKey)}`;
        const apiResp = await fetch(apiUrl, { signal: AbortSignal.timeout(10000) });
        if (apiResp.ok) {
          const json = (await apiResp.json()) as { values?: string[][] };
          parsedRows = Array.isArray(json.values) ? json.values : [];
          fetched = true;
        } else {
          lastHttpStatus = apiResp.status;
        }
      }

      // Strategy 2: Named tab via gviz CSV (only when user explicitly entered a tab name)
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

      // Strategy 3: Direct CSV Export (works regardless of tab name; honors ?gid=... from pasted URL!)
      if (!fetched) {
        const exportUrl = parsedRef.gid
          ? `https://docs.google.com/spreadsheets/d/${encodeURIComponent(parsedRef.sheetId)}/export?format=csv&gid=${encodeURIComponent(parsedRef.gid)}`
          : `https://docs.google.com/spreadsheets/d/${encodeURIComponent(parsedRef.sheetId)}/export?format=csv`;
        const r = await fetchCsvFromGoogleUrl(exportUrl);
        if (r.ok) {
          parsedRows = r.rows;
          fetched = true;
          if (!requestedSheetName) {
            effectiveSheetName = parsedRef.gid ? `gid:${parsedRef.gid}` : 'Tab 1';
          }
        } else {
          if (r.isHtmlLogin) sawHtmlLogin = true;
          if (r.status) lastHttpStatus = r.status;
        }
      }

      // Strategy 4: Fallback gviz CSV for first tab (without &sheet= parameter)
      if (!fetched) {
        const gvizFirst = `https://docs.google.com/spreadsheets/d/${encodeURIComponent(parsedRef.sheetId)}/gviz/tq?tqx=out:csv`;
        const r = await fetchCsvFromGoogleUrl(gvizFirst);
        if (r.ok) {
          parsedRows = r.rows;
          fetched = true;
          effectiveSheetName = 'Tab 1';
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
            error:
              'Google Sheet នេះជាប់សិទ្ធិ Private! សូមបើក Google Sheet → ចុច "Share" → ប្តូរ General access ទៅជា "Anyone with the link (Viewer)" រួចសាកល្បងម្តងទៀត (ឬ Export ជា .CSV ហើយ Upload ផ្ទាល់)។',
          };
        }
        return {
          success: false,
          sheetId: resolvedId,
          sheetName: effectiveSheetName,
          rowsRead: 0,
          imported: 0,
          skipped: 0,
          error: `មិនអាចអាន Google Sheet បានទេ (HTTP ${lastHttpStatus || 'Error'})។ សូមពិនិត្យថា Link/ID ត្រឹមត្រូវ ហើយ Sheet បើកសិទ្ធិ "Anyone with the link (Viewer)"។`,
        };
      }
    }
  } catch (err: any) {
    return {
      success: false,
      sheetId: resolvedId,
      sheetName: effectiveSheetName,
      rowsRead: 0,
      imported: 0,
      skipped: 0,
      error: `បរាជ័យក្នុងការតភ្ជាប់ Google Sheets: ${err?.message || 'Network timeout'}`,
    };
  }

  if (parsedRows.length === 0) {
    return {
      success: true,
      sheetId: resolvedId,
      sheetName: effectiveSheetName,
      rowsRead: 0,
      imported: 0,
      skipped: 0,
    };
  }

  // Detect header columns flexibly across English / Khmer / Korean
  const firstRowLower = parsedRows[0].map((c) => c.replace(/^\uFEFF/, '').trim().toLowerCase());
  const isCodeHeader = (c: string) =>
    c.includes('code') ||
    c.includes('redeem') ||
    c.includes('voucher') ||
    c.includes('កូដ') ||
    c.includes('코드');
  const isStatusHeader = (c: string) =>
    c.includes('status') || c.includes('ស្ថានភាព') || c.includes('상태');
  const isNoteHeader = (c: string) =>
    c.includes('note') ||
    c.includes('desc') ||
    c.includes('center') ||
    c.includes('សម្គាល់') ||
    c.includes('비고');

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
    // Auto-detect if Col A is just row index (1, 2, 3...) and Col B holds the Redeem Codes
    const col0 = normalizeCode(parsedRows[0][0] || '');
    const col1 = normalizeCode(parsedRows[0][1] || '');
    if (col0.length < 4 && col1.length >= 4) {
      codeCol = 1;
      statusCol = 2;
      noteCol = 3;
    }
  }

  const dataRows = hasHeader ? parsedRows.slice(1) : parsedRows;
  const db = getRedeemDb();
  const nowIso = new Date().toISOString();
  const insertStmt = db.prepare(
    `INSERT OR IGNORE INTO redeem_codes (code, status, source, note, assigned_to, created_at)
     VALUES (?, ?, 'google_sheets', ?, '', ?)`
  );

  let imported = 0;
  let skipped = 0;

  db.exec('BEGIN IMMEDIATE');
  try {
    for (const r of dataRows.slice(0, MAX_BULK_IMPORT_CODES)) {
      const code = normalizeCode(r[codeCol] || '');
      if (code.length < 4) {
        skipped++;
        continue;
      }
      const status = normalizeStatus(r[statusCol] || 'Unused');
      const note = String(r[noteCol] || `Sheet: ${effectiveSheetName}`).trim().slice(0, 140);
      const info = insertStmt.run(code, status, note, nowIso);
      if (Number(info.changes) > 0) {
        imported++;
      } else {
        skipped++;
      }
    }
    db.exec('COMMIT');
  } catch (err) {
    try {
      db.exec('ROLLBACK');
    } catch {
      // ignore rollback failure
    }
    throw err;
  }

  return {
    success: true,
    sheetId: resolvedId,
    sheetName: effectiveSheetName,
    rowsRead: dataRows.length,
    imported,
    skipped,
  };
}

// ============================================================================
// PERSISTENT ADMIN & STAFF ACCOUNTS (scrypt-hashed in SQLite)
// ============================================================================
export type AdminAccountRole = 'root_admin' | 'manager';

export interface AdminAccountPublic {
  id: number;
  username: string;
  display_name: string;
  role: AdminAccountRole;
  is_active: boolean;
  created_by: string;
  created_at: string;
  last_login_at: string | null;
}

interface AdminAccountRow {
  id: number;
  username: string;
  display_name: string;
  role: AdminAccountRole;
  salt: string;
  password_hash: string;
  is_active: number;
  created_by: string;
  created_at: string;
  last_login_at: string | null;
}

function hashAdminPassword(password: string, salt: string): string {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}

function timingSafeHexEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

export function listAdminAccounts(): AdminAccountPublic[] {
  const db = getRedeemDb();
  const rows = db
    .prepare(
      `SELECT id, username, display_name, role, is_active, created_by, created_at, last_login_at
       FROM admin_accounts
       ORDER BY id DESC`
    )
    .all() as unknown as Array<Omit<AdminAccountRow, 'salt' | 'password_hash'>>;

  return rows.map((r) => ({
    id: Number(r.id),
    username: String(r.username),
    display_name: String(r.display_name || ''),
    role: r.role === 'root_admin' ? 'root_admin' : 'manager',
    is_active: Boolean(r.is_active),
    created_by: String(r.created_by || ''),
    created_at: String(r.created_at || ''),
    last_login_at: r.last_login_at ? String(r.last_login_at) : null,
  }));
}

export function createOrUpdateAdminAccount(params: {
  username: string;
  password: string;
  displayName?: string;
  role?: AdminAccountRole;
  createdBy: string;
}): { ok: boolean; error?: string; account?: AdminAccountPublic } {
  const username = String(params.username || '').trim();
  const password = String(params.password || '');
  const displayName = String(params.displayName || username).trim().slice(0, 80);
  const role: AdminAccountRole = params.role === 'root_admin' ? 'root_admin' : 'manager';
  const createdBy = String(params.createdBy || 'root_admin').trim().slice(0, 120);

  if (username.length < 3 || username.length > 64 || !/^[a-zA-Z0-9._@-]+$/.test(username)) {
    return { ok: false, error: 'Admin ID ត្រូវមាន 3–64 តួអក្សរ (អក្សរ លេខ . _ @ -)!' };
  }
  if (password.length < 6 || password.length > 128) {
    return { ok: false, error: 'ពាក្យសម្ងាត់ត្រូវមានយ៉ាងតិច 6 តួអក្សរ!' };
  }

  const db = getRedeemDb();
  const salt = crypto.randomBytes(16).toString('hex');
  const passwordHash = hashAdminPassword(password, salt);
  const nowIso = new Date().toISOString();

  const existing = db
    .prepare('SELECT id FROM admin_accounts WHERE username = ? COLLATE NOCASE')
    .get(username) as { id: number } | undefined;

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

  const row = db
    .prepare(
      `SELECT id, username, display_name, role, is_active, created_by, created_at, last_login_at
       FROM admin_accounts WHERE username = ? COLLATE NOCASE`
    )
    .get(username) as unknown as Omit<AdminAccountRow, 'salt' | 'password_hash'>;

  return {
    ok: true,
    account: {
      id: Number(row.id),
      username: String(row.username),
      display_name: String(row.display_name || ''),
      role: row.role === 'root_admin' ? 'root_admin' : 'manager',
      is_active: Boolean(row.is_active),
      created_by: String(row.created_by || ''),
      created_at: String(row.created_at || ''),
      last_login_at: row.last_login_at ? String(row.last_login_at) : null,
    },
  };
}

export function verifyDbAdminLogin(
  username: string,
  password: string
): { ok: boolean; username?: string; role?: AdminAccountRole } {
  const cleanUser = String(username || '').trim();
  const cleanPass = String(password || '');
  if (!cleanUser || !cleanPass) return { ok: false };

  const db = getRedeemDb();
  const row = db
    .prepare(
      `SELECT id, username, display_name, role, salt, password_hash, is_active
       FROM admin_accounts WHERE username = ? COLLATE NOCASE`
    )
    .get(cleanUser) as unknown as AdminAccountRow | undefined;

  if (!row || !row.is_active) return { ok: false };

  const candidateHash = hashAdminPassword(cleanPass, row.salt);
  if (!timingSafeHexEqual(candidateHash, row.password_hash)) {
    return { ok: false };
  }

  db.prepare('UPDATE admin_accounts SET last_login_at = ? WHERE id = ?').run(
    new Date().toISOString(),
    row.id
  );

  return {
    ok: true,
    username: row.username,
    role: row.role === 'root_admin' ? 'root_admin' : 'manager',
  };
}

export function setAdminAccountActive(id: number, isActive: boolean): boolean {
  const db = getRedeemDb();
  const info = db
    .prepare('UPDATE admin_accounts SET is_active = ? WHERE id = ?')
    .run(isActive ? 1 : 0, Math.floor(id));
  return Number(info.changes) > 0;
}

export function updateAdminAccountPassword(id: number, newPassword: string): { ok: boolean; error?: string } {
  if (newPassword.length < 6 || newPassword.length > 128) {
    return { ok: false, error: 'ពាក្យសម្ងាត់ថ្មីត្រូវមានយ៉ាងតិច 6 តួអក្សរ!' };
  }
  const db = getRedeemDb();
  const salt = crypto.randomBytes(16).toString('hex');
  const passwordHash = hashAdminPassword(newPassword, salt);
  const info = db
    .prepare('UPDATE admin_accounts SET salt = ?, password_hash = ? WHERE id = ?')
    .run(salt, passwordHash, Math.floor(id));
  if (Number(info.changes) === 0) {
    return { ok: false, error: 'រកមិនឃើញគណនី Admin នេះទេ!' };
  }
  return { ok: true };
}

export function deleteAdminAccount(id: number): boolean {
  const db = getRedeemDb();
  const info = db.prepare('DELETE FROM admin_accounts WHERE id = ?').run(Math.floor(id));
  return Number(info.changes) > 0;
}

// ============================================================================
// PERSISTENT VISITOR COUNTER (Real deduplicated sessions in SQLite)
// ============================================================================
function ensureVisitorSessionsTable(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS visitor_sessions (
      session_id TEXT PRIMARY KEY,
      first_seen TEXT NOT NULL
    );
  `);
}

export function recordUniqueVisitSession(sessionId: string): number {
  const cleanId = String(sessionId || '').trim().slice(0, 64);
  const db = getRedeemDb();
  ensureVisitorSessionsTable(db);
  if (cleanId) {
    db.prepare(
      `INSERT OR IGNORE INTO visitor_sessions (session_id, first_seen) VALUES (?, ?)`
    ).run(cleanId, new Date().toISOString());
  }
  const row = db.prepare('SELECT COUNT(*) as cnt FROM visitor_sessions').get() as { cnt: number };
  return Math.max(1, Number(row?.cnt || 0));
}

export function getTotalRecordedVisits(): number {
  const db = getRedeemDb();
  ensureVisitorSessionsTable(db);
  const row = db.prepare('SELECT COUNT(*) as cnt FROM visitor_sessions').get() as { cnt: number };
  return Math.max(1, Number(row?.cnt || 0));
}

// ============================================================================
// PUBLIC USER ACCOUNTS (Sign Up / Sign In / Password Reset in SQLite)
// ============================================================================
export interface PublicUserRecord {
  id: number;
  email: string;
  name: string;
  phone: string;
  provider: 'email' | 'otp' | 'google';
  createdAt: string;
  lastLoginAt: string | null;
}

function ensureUserAccountsTable(db: DatabaseSync): void {
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

function hashUserPassword(password: string, salt: string): string {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}

function verifyUserPasswordHash(password: string, salt: string, storedHash: string): boolean {
  const candidate = hashUserPassword(password, salt);
  const a = Buffer.from(candidate, 'utf8');
  const b = Buffer.from(storedHash, 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export function registerUserAccount(params: {
  email: string;
  name: string;
  phone?: string;
  password: string;
}): { ok: boolean; user?: PublicUserRecord; error?: string } {
  const email = String(params.email || '').trim().toLowerCase().slice(0, 254);
  const name = String(params.name || '').trim().slice(0, 120);
  const phone = String(params.phone || '').trim().slice(0, 40);
  const password = String(params.password || '');

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, error: 'សូមបញ្ចូលអាសយដ្ឋាន Email ឱ្យបានត្រឹមត្រូវ!' };
  }
  if (password.length < 6 || password.length > 128) {
    return { ok: false, error: 'ពាក្យសម្ងាត់ត្រូវមានយ៉ាងតិច ៦ តួអក្សរ!' };
  }

  const db = getRedeemDb();
  ensureUserAccountsTable(db);

  const existing = db
    .prepare('SELECT id FROM user_accounts WHERE email = ?')
    .get(email) as { id: number } | undefined;
  if (existing) {
    return {
      ok: false,
      error: 'Email នេះត្រូវបានចុះឈ្មោះរួចហើយ! សូមជ្រើសរើស "ចូលគណនី (Sign In)" ជំនួសវិញ។',
    };
  }

  const displayName = name || email.split('@')[0];
  const salt = crypto.randomBytes(16).toString('hex');
  const passwordHash = hashUserPassword(password, salt);
  const nowIso = new Date().toISOString();

  const info = db
    .prepare(
      `INSERT INTO user_accounts (email, name, phone, provider, salt, password_hash, created_at, last_login_at)
       VALUES (?, ?, ?, 'email', ?, ?, ?, ?)`
    )
    .run(email, displayName, phone, salt, passwordHash, nowIso, nowIso);

  return {
    ok: true,
    user: {
      id: Number(info.lastInsertRowid),
      email,
      name: displayName,
      phone,
      provider: 'email',
      createdAt: nowIso,
      lastLoginAt: nowIso,
    },
  };
}

export function verifyUserLogin(params: {
  identifier: string;
  password: string;
}): { ok: boolean; user?: PublicUserRecord; error?: string } {
  const identifier = String(params.identifier || '').trim();
  const password = String(params.password || '');

  if (!identifier || !password) {
    return { ok: false, error: 'សូមបញ្ចូល Email និងពាក្យសម្ងាត់!' };
  }

  const db = getRedeemDb();
  ensureUserAccountsTable(db);

  const lower = identifier.toLowerCase();
  const cleanPhone = identifier.replace(/[^0-9+]/g, '');
  const row = db
    .prepare(
      `SELECT id, email, name, phone, provider, salt, password_hash, created_at, last_login_at
       FROM user_accounts
       WHERE email = ? OR (phone != '' AND phone = ?)
       LIMIT 1`
    )
    .get(lower, cleanPhone || '__no_phone__') as
    | {
        id: number;
        email: string;
        name: string;
        phone: string;
        provider: string;
        salt: string;
        password_hash: string;
        created_at: string;
        last_login_at: string | null;
      }
    | undefined;

  if (!row) {
    return {
      ok: false,
      error: 'រកមិនឃើញគណនីនេះទេ! សូមពិនិត្យ Email ឬចុច "ចុះឈ្មោះ (Sign Up)" ជាមុនសិន។',
    };
  }

  if (!verifyUserPasswordHash(password, row.salt, row.password_hash)) {
    return {
      ok: false,
      error: 'ពាក្យសម្ងាត់មិនត្រឹមត្រូវទេ! សូមព្យាយាមម្តងទៀត ឬចុចភ្លេចពាក្យសម្ងាត់។',
    };
  }

  const nowIso = new Date().toISOString();
  db.prepare('UPDATE user_accounts SET last_login_at = ? WHERE id = ?').run(nowIso, row.id);

  return {
    ok: true,
    user: {
      id: Number(row.id),
      email: String(row.email),
      name: String(row.name || row.email.split('@')[0]),
      phone: String(row.phone || ''),
      provider: (row.provider === 'otp' ? 'otp' : 'email') as 'email' | 'otp',
      createdAt: String(row.created_at),
      lastLoginAt: nowIso,
    },
  };
}

export function upsertOtpUserAccount(params: {
  target: string;
  name?: string;
}): PublicUserRecord {
  const rawTarget = String(params.target || '').trim().slice(0, 254);
  const isEmail = rawTarget.includes('@');
  const normalizedPhone = isEmail ? '' : rawTarget.replace(/[^0-9+]/g, '') || rawTarget;
  const normalizedEmail = isEmail
    ? rawTarget.toLowerCase()
    : `${normalizedPhone.replace(/[^a-zA-Z0-9]/g, '') || 'user'}@otp.kiip-portal.kr`;

  const db = getRedeemDb();
  ensureUserAccountsTable(db);

  const existing = db
    .prepare(
      `SELECT id, email, name, phone, provider, created_at
       FROM user_accounts
       WHERE email = ? OR (phone != '' AND phone = ?)
       LIMIT 1`
    )
    .get(normalizedEmail, normalizedPhone || '__no_phone__') as
    | {
        id: number;
        email: string;
        name: string;
        phone: string;
        provider: string;
        created_at: string;
      }
    | undefined;

  const nowIso = new Date().toISOString();
  if (existing) {
    const nextName = String(params.name || '').trim() || existing.name || normalizedEmail.split('@')[0];
    db.prepare('UPDATE user_accounts SET last_login_at = ?, name = ? WHERE id = ?').run(
      nowIso,
      nextName,
      existing.id
    );
    return {
      id: Number(existing.id),
      email: String(existing.email),
      name: nextName,
      phone: String(existing.phone || normalizedPhone),
      provider: 'otp',
      createdAt: String(existing.created_at),
      lastLoginAt: nowIso,
    };
  }

  const displayName =
    String(params.name || '').trim() ||
    (isEmail ? normalizedEmail.split('@')[0] : `User (${rawTarget})`);
  const salt = crypto.randomBytes(16).toString('hex');
  const randomHash = hashUserPassword(crypto.randomBytes(24).toString('hex'), salt);

  const info = db
    .prepare(
      `INSERT INTO user_accounts (email, name, phone, provider, salt, password_hash, created_at, last_login_at)
       VALUES (?, ?, ?, 'otp', ?, ?, ?, ?)`
    )
    .run(normalizedEmail, displayName, normalizedPhone, salt, randomHash, nowIso, nowIso);

  return {
    id: Number(info.lastInsertRowid),
    email: normalizedEmail,
    name: displayName,
    phone: normalizedPhone,
    provider: 'otp',
    createdAt: nowIso,
    lastLoginAt: nowIso,
  };
}

export function getUserAccountByEmail(email: string): PublicUserRecord | null {
  const cleanEmail = String(email || '').trim().toLowerCase();
  if (!cleanEmail) return null;
  const db = getRedeemDb();
  ensureUserAccountsTable(db);
  const row = db
    .prepare(
      `SELECT id, email, name, phone, provider, created_at, last_login_at
       FROM user_accounts
       WHERE email = ?
       LIMIT 1`
    )
    .get(cleanEmail) as
    | {
        id: number;
        email: string;
        name: string;
        phone: string;
        provider: string;
        created_at: string;
        last_login_at: string | null;
      }
    | undefined;
  if (!row) return null;
  return {
    id: Number(row.id),
    email: String(row.email),
    name: String(row.name || row.email.split('@')[0]),
    phone: String(row.phone || ''),
    provider: row.provider === 'otp' ? 'otp' : 'email',
    createdAt: String(row.created_at),
    lastLoginAt: row.last_login_at ? String(row.last_login_at) : null,
  };
}

export function resetUserAccountPassword(params: {
  email: string;
  newPassword: string;
}): { ok: boolean; error?: string } {
  const email = String(params.email || '').trim().toLowerCase();
  const newPassword = String(params.newPassword || '');
  if (!email) return { ok: false, error: 'សូមបញ្ចូល Email!' };
  if (newPassword.length < 6 || newPassword.length > 128) {
    return { ok: false, error: 'ពាក្យសម្ងាត់ថ្មីត្រូវមានយ៉ាងតិច ៦ តួអក្សរ!' };
  }

  const db = getRedeemDb();
  ensureUserAccountsTable(db);
  const salt = crypto.randomBytes(16).toString('hex');
  const passwordHash = hashUserPassword(newPassword, salt);
  const info = db
    .prepare('UPDATE user_accounts SET salt = ?, password_hash = ? WHERE email = ?')
    .run(salt, passwordHash, email);
  if (Number(info.changes) === 0) {
    return { ok: false, error: 'រកមិនឃើញគណនីដែលប្រើ Email នេះទេ!' };
  }
  return { ok: true };
}


