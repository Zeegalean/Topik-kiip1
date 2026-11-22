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

export function listRedeemCodes(
  statusFilter: 'Unused' | 'Used' | 'Revoked' | 'all' = 'all',
  limit = 500
): RedeemCodeRecord[] {
  const db = getRedeemDb();
  const safeLimit = Math.min(1000, Math.max(1, Math.floor(limit)));

  if (statusFilter === 'Unused' || statusFilter === 'Used' || statusFilter === 'Revoked') {
    return db
      .prepare(
        `SELECT id, code, status, source, note, assigned_to, created_at, used_at
         FROM redeem_codes
         WHERE status = ?
         ORDER BY id DESC
         LIMIT ?`
      )
      .all(statusFilter, safeLimit) as unknown as RedeemCodeRecord[];
  }

  return db
    .prepare(
      `SELECT id, code, status, source, note, assigned_to, created_at, used_at
       FROM redeem_codes
       ORDER BY CASE status WHEN 'Unused' THEN 0 WHEN 'Used' THEN 1 ELSE 2 END, id DESC
       LIMIT ?`
    )
    .all(safeLimit) as unknown as RedeemCodeRecord[];
}

export function generateUnusedRedeemCodes(
  count: number,
  prefix = 'KIIP-26',
  note = 'Admin Generated'
): RedeemCodeRecord[] {
  const db = getRedeemDb();
  const safeCount = Math.min(100, Math.max(1, Math.floor(count)));
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
  while (created.length < safeCount && attempts < safeCount * 5) {
    attempts++;
    const code = generateSecureCode(prefix);
    const info = insertStmt.run(code, safeNote, nowIso);
    if (Number(info.changes) > 0) {
      const row = selectStmt.get(code) as unknown as RedeemCodeRecord | undefined;
      if (row) created.push(row);
    }
  }
  return created;
}

export function addCustomRedeemCodes(
  rawCodes: string[],
  note = 'Manual Import',
  source = 'admin'
): { added: number; skipped: number; codes: string[] } {
  const db = getRedeemDb();
  const safeNote = String(note || 'Manual Import').trim().slice(0, 140);
  const safeSource = String(source || 'admin').trim().slice(0, 32);
  const nowIso = new Date().toISOString();

  const insertStmt = db.prepare(
    `INSERT OR IGNORE INTO redeem_codes (code, status, source, note, assigned_to, created_at)
     VALUES (?, 'Unused', ?, ?, '', ?)`
  );

  let added = 0;
  let skipped = 0;
  const insertedCodes: string[] = [];

  for (const raw of rawCodes.slice(0, 500)) {
    const code = normalizeCode(raw);
    if (code.length < 4) {
      skipped++;
      continue;
    }
    const info = insertStmt.run(code, safeSource, safeNote, nowIso);
    if (Number(info.changes) > 0) {
      added++;
      insertedCodes.push(code);
    } else {
      skipped++;
    }
  }

  return { added, skipped, codes: insertedCodes };
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

/**
 * Connects to Google Sheets (strictly allowlisted to Google domains to prevent SSRF),
 * reads rows of Redeem Codes (Columns: Code, Status, Note), and syncs them into SQLite.
 * Supports either GOOGLE_SHEETS_API_KEY (Sheets API v4) or public/link-readable CSV export.
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
  const sheetId = String(params?.sheetId || process.env.GOOGLE_SHEET_ID || '').trim();
  const sheetName = String(params?.sheetName || process.env.GOOGLE_SHEET_TAB || 'RedeemCodes')
    .trim()
    .slice(0, 80);

  if (!sheetId || !SHEET_ID_REGEX.test(sheetId)) {
    return {
      success: false,
      sheetId,
      sheetName,
      rowsRead: 0,
      imported: 0,
      skipped: 0,
      error:
        'សូមបញ្ចូល Google Sheet ID ឱ្យបានត្រឹមត្រូវ (ឬកំណត់ GOOGLE_SHEET_ID ក្នុង Settings → Secrets)។',
    };
  }

  let parsedRows: string[][] = [];
  const apiKey = process.env.GOOGLE_SHEETS_API_KEY?.trim();

  try {
    if (apiKey) {
      const range = encodeURIComponent(`${sheetName}!A1:D1000`);
      const apiUrl = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheetId)}/values/${range}?key=${encodeURIComponent(apiKey)}`;
      const resp = await fetch(apiUrl, { signal: AbortSignal.timeout(10000) });
      if (!resp.ok) {
        return {
          success: false,
          sheetId,
          sheetName,
          rowsRead: 0,
          imported: 0,
          skipped: 0,
          error: `Google Sheets API error (HTTP ${resp.status}). សូមពិនិត្យ Sheet ID, ឈ្មោះ Tab និងសិទ្ធិអាន។`,
        };
      }
      const json = (await resp.json()) as { values?: string[][] };
      parsedRows = Array.isArray(json.values) ? json.values : [];
    } else {
      // Strictly allowlisted Google Sheets gviz CSV endpoint (works when Sheet is "Anyone with link can view")
      const csvUrl = `https://docs.google.com/spreadsheets/d/${encodeURIComponent(sheetId)}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(sheetName)}`;
      const resp = await fetch(csvUrl, { signal: AbortSignal.timeout(10000) });
      if (!resp.ok) {
        return {
          success: false,
          sheetId,
          sheetName,
          rowsRead: 0,
          imported: 0,
          skipped: 0,
          error: `មិនអាចអាន Google Sheet បានទេ (HTTP ${resp.status})។ សូមប្រាកដថា Sheet បើកសិទ្ធិ "Anyone with the link can view" ឬបន្ថែម GOOGLE_SHEETS_API_KEY។`,
        };
      }
      const text = await resp.text();
      if (text.trim().startsWith('<!DOCTYPE html') || text.trim().startsWith('<html')) {
        return {
          success: false,
          sheetId,
          sheetName,
          rowsRead: 0,
          imported: 0,
          skipped: 0,
          error:
            'Google Sheet នេះជាប់សិទ្ធិ Private! សូមប្តូរ Share → "Anyone with the link (Viewer)" ឬកំណត់ GOOGLE_SHEETS_API_KEY។',
        };
      }
      parsedRows = parseCsvRows(text);
    }
  } catch (err: any) {
    return {
      success: false,
      sheetId,
      sheetName,
      rowsRead: 0,
      imported: 0,
      skipped: 0,
      error: `បរាជ័យក្នុងការតភ្ជាប់ Google Sheets: ${err?.message || 'Network timeout'}`,
    };
  }

  if (parsedRows.length === 0) {
    return {
      success: true,
      sheetId,
      sheetName,
      rowsRead: 0,
      imported: 0,
      skipped: 0,
    };
  }

  // Detect header columns flexibly (supports Code / Redeem Code / Status / Note)
  const firstRowLower = parsedRows[0].map((c) => c.toLowerCase());
  const hasHeader = firstRowLower.some(
    (c) => c.includes('code') || c.includes('status') || c.includes('redeem')
  );
  let codeCol = 0;
  let statusCol = 1;
  let noteCol = 2;

  if (hasHeader) {
    const foundCode = firstRowLower.findIndex((c) => c.includes('code') || c.includes('redeem'));
    const foundStatus = firstRowLower.findIndex((c) => c.includes('status'));
    const foundNote = firstRowLower.findIndex((c) => c.includes('note') || c.includes('desc') || c.includes('center'));
    if (foundCode >= 0) codeCol = foundCode;
    if (foundStatus >= 0) statusCol = foundStatus;
    if (foundNote >= 0) noteCol = foundNote;
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

  for (const r of dataRows.slice(0, 1000)) {
    const code = normalizeCode(r[codeCol] || '');
    if (code.length < 4) {
      skipped++;
      continue;
    }
    const status = normalizeStatus(r[statusCol] || 'Unused');
    const note = String(r[noteCol] || `Sheet: ${sheetName}`).trim().slice(0, 140);
    const info = insertStmt.run(code, status, note, nowIso);
    if (Number(info.changes) > 0) {
      imported++;
    } else {
      skipped++;
    }
  }

  return {
    success: true,
    sheetId,
    sheetName,
    rowsRead: dataRows.length,
    imported,
    skipped,
  };
}
