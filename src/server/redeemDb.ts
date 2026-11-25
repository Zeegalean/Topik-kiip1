import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { DatabaseSync } from 'node:sqlite';

export type RedeemCodeStatus = 'Unused' | 'Used' | 'Revoked';

export interface RedeemCodeRecord {
  id: number;
  code: string;
  status: RedeemCodeStatus;
  is_paid: boolean;
  source: string;
  note: string;
  assigned_to: string;
  created_at: string;
  used_at: string | null;
}

export interface RedeemCodeStats {
  total: number;
  unusedCount: number;
  paidUnusedCount: number;
  unpaidUnusedCount: number;
  usedCount: number;
  revokedCount: number;
  databasePath: string;
  googleSheetConfigured: boolean;
  googleSheetSource: 'env' | 'saved' | 'none';
  savedSheetId: string;
  savedSheetName: string;
  lastSyncAt: string | null;
  lastRowsRead: number;
  lastSyncError: string | null;
}

const DATA_DIR = path.resolve(process.cwd(), 'data');
const DB_FILE_PATH = path.join(DATA_DIR, 'redeem_codes.sqlite');
const INITIAL_UNUSED_SEED_COUNT = 25;
export const MAX_BULK_IMPORT_CODES = 50000;

let dbInstance: DatabaseSync | null = null;
let inFlightSheetSync: Promise<GoogleSheetSyncResult> | null = null;
let lastAutoSyncAttemptMs = 0;

function ensureDataDir(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

export function normalizeCode(raw: string): string {
  return String(raw || '')
    .replace(/[\u200B-\u200D\uFEFF\u00A0]/g, '')
    .replace(/[\u2010-\u2015\u2212\uFE63\uFF0D]/g, '-')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, '')
    .slice(0, 64);
}

export function compactCode(raw: string): string {
  return normalizeCode(raw).replace(/[-_]/g, '');
}

function normalizeStatus(raw?: string): RedeemCodeStatus {
  const s = String(raw || '').trim().toLowerCase();
  if (
    s === 'used' ||
    s === 'claimed' ||
    s === 'redeemed' ||
    s === 'ប្រើរួច' ||
    s === 'បានប្រើ' ||
    s === '사용완료' ||
    s === '사용됨' ||
    s === '사용'
  ) {
    return 'Used';
  }
  if (
    s === 'revoked' ||
    s === 'disabled' ||
    s === 'expired' ||
    s === 'invalid' ||
    s === 'ផ្អាក' ||
    s === 'ផុតកំណត់' ||
    s === '취소' ||
    s === '만료'
  ) {
    return 'Revoked';
  }
  return 'Unused';
}

function generateSecureCode(prefix = 'KIIP-26'): string {
  const cleanPrefix = normalizeCode(prefix).slice(0, 16) || 'KIIP-26';
  const suffix = crypto.randomBytes(3).toString('hex').toUpperCase();
  return `${cleanPrefix}-${suffix}`;
}

function mapRedeemRow(r: any): RedeemCodeRecord {
  return {
    id: Number(r.id),
    code: String(r.code),
    status: r.status as RedeemCodeStatus,
    is_paid: Number(r.is_paid) === 1,
    source: String(r.source || 'database'),
    note: String(r.note || ''),
    assigned_to: String(r.assigned_to || ''),
    created_at: String(r.created_at || ''),
    used_at: r.used_at ? String(r.used_at) : null,
  };
}

function ensureRedeemSchemaMigrations(db: DatabaseSync): void {
  const cols = db.prepare('PRAGMA table_info(redeem_codes)').all() as Array<{ name: string }>;
  const hasCompact = cols.some((c) => c.name === 'code_compact');
  if (!hasCompact) {
    db.exec(`ALTER TABLE redeem_codes ADD COLUMN code_compact TEXT NOT NULL DEFAULT '';`);
  }
  const hasIsPaid = cols.some((c) => c.name === 'is_paid');
  if (!hasIsPaid) {
    db.exec(`ALTER TABLE redeem_codes ADD COLUMN is_paid INTEGER NOT NULL DEFAULT 0;`);
    // Mark codes already issued via verified payment receipts as Paid; keep Google Sheet & pool codes Unpaid until paid!
    db.exec(`
      UPDATE redeem_codes
      SET is_paid = 1
      WHERE source IN ('kr_receipt', 'telegram_bot', 'admin_paid')
         OR (assigned_to != '' AND status = 'Unused');
    `);
  }
  db.exec(`
    UPDATE redeem_codes
    SET code_compact = REPLACE(REPLACE(UPPER(code), '-', ''), '_', '')
    WHERE code_compact = '' OR code_compact IS NULL;
    CREATE INDEX IF NOT EXISTS idx_redeem_codes_compact ON redeem_codes(code_compact);
    CREATE INDEX IF NOT EXISTS idx_redeem_codes_paid ON redeem_codes(status, is_paid);
  `);
}

function getAppSetting(db: DatabaseSync, key: string): string {
  const row = db
    .prepare('SELECT value FROM app_settings WHERE key = ?')
    .get(key) as { value: string } | undefined;
  return row ? String(row.value || '') : '';
}

function setAppSetting(db: DatabaseSync, key: string, value: string): void {
  db.prepare(
    `INSERT INTO app_settings (key, value, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  ).run(key, String(value ?? ''), new Date().toISOString());
}

/**
 * Returns a stable HMAC signing secret for Admin Bearer tokens and unlock cookies.
 * Uses ADMIN_SESSION_SECRET env var if configured, otherwise persists a random 32-byte
 * secret in SQLite app_settings so restarts never invalidate active Admin sessions.
 */
export function getOrCreateSessionSigningSecret(): string {
  const envSecret = String(process.env.ADMIN_SESSION_SECRET || '').trim();
  if (envSecret.length >= 16) {
    return envSecret;
  }
  const db = getRedeemDb();
  const existing = getAppSetting(db, 'admin_session_secret').trim();
  if (existing.length >= 32) {
    return existing;
  }
  const generated = crypto.randomBytes(32).toString('hex');
  setAppSetting(db, 'admin_session_secret', generated);
  return generated;
}

export function getSavedGoogleSheetConfig(): {
  sheetId: string;
  sheetName: string;
  source: 'env' | 'saved' | 'none';
  lastSyncAt: string | null;
  lastRowsRead: number;
  lastImported: number;
  lastSyncError: string | null;
} {
  const db = getRedeemDb();
  const envId = String(process.env.GOOGLE_SHEET_ID || '').trim();
  const envTab = String(process.env.GOOGLE_SHEET_TAB || '').trim();
  const savedId = getAppSetting(db, 'google_sheet_id').trim();
  const savedTab = getAppSetting(db, 'google_sheet_tab').trim();
  const lastSyncAt = getAppSetting(db, 'google_sheet_last_sync_at').trim() || null;
  const lastRowsRead = Number(getAppSetting(db, 'google_sheet_last_rows_read')) || 0;
  const lastImported = Number(getAppSetting(db, 'google_sheet_last_imported')) || 0;
  const lastSyncError = getAppSetting(db, 'google_sheet_last_error').trim() || null;

  if (savedId) {
    return {
      sheetId: savedId,
      sheetName: savedTab,
      source: 'saved',
      lastSyncAt,
      lastRowsRead,
      lastImported,
      lastSyncError,
    };
  }
  if (envId) {
    return {
      sheetId: envId,
      sheetName: envTab,
      source: 'env',
      lastSyncAt,
      lastRowsRead,
      lastImported,
      lastSyncError,
    };
  }
  return {
    sheetId: '',
    sheetName: '',
    source: 'none',
    lastSyncAt,
    lastRowsRead,
    lastImported,
    lastSyncError,
  };
}

export function getRedeemDb(): DatabaseSync {
  if (dbInstance) return dbInstance;

  ensureDataDir();
  const db = new DatabaseSync(DB_FILE_PATH);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS redeem_codes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      code_compact TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'Unused' CHECK (status IN ('Unused', 'Used', 'Revoked')),
      is_paid INTEGER NOT NULL DEFAULT 0,
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

    CREATE TABLE IF NOT EXISTS promo_codes (
      code TEXT PRIMARY KEY,
      code_compact TEXT NOT NULL DEFAULT '',
      center_id TEXT NOT NULL DEFAULT 'general',
      month_label TEXT NOT NULL DEFAULT '',
      usage_limit INTEGER NOT NULL DEFAULT 50,
      usage_count INTEGER NOT NULL DEFAULT 0,
      expires_at TEXT NOT NULL DEFAULT '',
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_promo_codes_compact ON promo_codes(code_compact);

    CREATE TABLE IF NOT EXISTS verified_receipts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      image_sha256 TEXT NOT NULL UNIQUE,
      transfer_fingerprint TEXT NOT NULL DEFAULT '',
      redeem_code TEXT NOT NULL,
      bank_name TEXT NOT NULL DEFAULT '',
      recipient_name TEXT NOT NULL DEFAULT '',
      amount_krw INTEGER NOT NULL DEFAULT 0,
      transfer_timestamp TEXT NOT NULL DEFAULT '',
      user_email TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_verified_receipts_fp ON verified_receipts(transfer_fingerprint);

    CREATE TABLE IF NOT EXISTS ocr_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tx_id TEXT NOT NULL UNIQUE,
      session_hash TEXT NOT NULL DEFAULT '',
      tx_type TEXT NOT NULL DEFAULT 'document_ocr' CHECK (tx_type IN ('document_ocr', 'bank_receipt')),
      doc_types_json TEXT NOT NULL DEFAULT '[]',
      model_version TEXT NOT NULL DEFAULT 'unknown',
      confidence_score INTEGER NOT NULL DEFAULT 0,
      verification_status TEXT NOT NULL DEFAULT 'pending' CHECK (verification_status IN ('verified', 'needs_review', 'failed', 'false_positive', 'pending')),
      extracted_fields_json TEXT NOT NULL DEFAULT '[]',
      missing_fields_json TEXT NOT NULL DEFAULT '[]',
      field_confidence_json TEXT NOT NULL DEFAULT '{}',
      error_pattern TEXT NOT NULL DEFAULT 'NONE',
      fallback_used INTEGER NOT NULL DEFAULT 0,
      latency_ms INTEGER NOT NULL DEFAULT 0,
      admin_note TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_ocr_tx_created ON ocr_transactions(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_ocr_tx_status ON ocr_transactions(verification_status);
    CREATE INDEX IF NOT EXISTS idx_ocr_tx_model ON ocr_transactions(model_version);
    CREATE INDEX IF NOT EXISTS idx_ocr_tx_pattern ON ocr_transactions(error_pattern);
  `);

  ensureRedeemSchemaMigrations(db);
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
    `INSERT OR IGNORE INTO redeem_codes (code, code_compact, status, source, note, assigned_to, created_at)
     VALUES (?, ?, 'Unused', ?, ?, '', ?)`
  );

  // Import any env-provided REDEEM_CODES as 'Unused'
  const envCodes = (process.env.REDEEM_CODES || '')
    .split(',')
    .map((c) => normalizeCode(c))
    .filter((c) => c.length >= 4);

  for (const code of envCodes) {
    insertStmt.run(code, compactCode(code), 'env_seed', 'Imported from REDEEM_CODES', nowIso);
  }

  // Pre-seed 25 ready-to-use Redeem Codes with status = 'Unused' if DB was empty
  if (Number(countRow?.cnt || 0) === 0) {
    for (let i = 1; i <= INITIAL_UNUSED_SEED_COUNT; i++) {
      const batchLabel = `Pre-seeded Batch #${String(i).padStart(2, '0')}`;
      const code = generateSecureCode('KIIP-26');
      insertStmt.run(code, compactCode(code), 'database', batchLabel, nowIso);
    }
    console.log(
      `[RedeemDB] Initialized SQLite database with ${INITIAL_UNUSED_SEED_COUNT} pre-seeded 'Unused' redeem codes.`
    );
  }
}

export function getRedeemCodeStats(): RedeemCodeStats {
  const db = getRedeemDb();
  const rows = db
    .prepare('SELECT status, is_paid, COUNT(*) as cnt FROM redeem_codes GROUP BY status, is_paid')
    .all() as Array<{ status: string; is_paid: number; cnt: number }>;

  let unusedCount = 0;
  let paidUnusedCount = 0;
  let unpaidUnusedCount = 0;
  let usedCount = 0;
  let revokedCount = 0;

  for (const r of rows) {
    const cnt = Number(r.cnt) || 0;
    if (r.status === 'Unused') {
      unusedCount += cnt;
      if (Number(r.is_paid) === 1) paidUnusedCount += cnt;
      else unpaidUnusedCount += cnt;
    } else if (r.status === 'Used') {
      usedCount += cnt;
    } else if (r.status === 'Revoked') {
      revokedCount += cnt;
    }
  }

  const sheetCfg = getSavedGoogleSheetConfig();

  return {
    total: unusedCount + usedCount + revokedCount,
    unusedCount,
    paidUnusedCount,
    unpaidUnusedCount,
    usedCount,
    revokedCount,
    databasePath: 'data/redeem_codes.sqlite',
    googleSheetConfigured: sheetCfg.source !== 'none',
    googleSheetSource: sheetCfg.source,
    savedSheetId: sheetCfg.sheetId,
    savedSheetName: sheetCfg.sheetName,
    lastSyncAt: sheetCfg.lastSyncAt,
    lastRowsRead: sheetCfg.lastRowsRead,
    lastSyncError: sheetCfg.lastSyncError,
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
  statusFilter?: 'Unused' | 'Used' | 'Revoked' | 'Paid' | 'Unpaid' | 'all';
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
  } else if (statusFilter === 'Paid') {
    conditions.push(`status = 'Unused' AND is_paid = 1`);
  } else if (statusFilter === 'Unpaid') {
    conditions.push(`status = 'Unused' AND is_paid = 0`);
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
    statusFilter === 'Unused' || statusFilter === 'Used' || statusFilter === 'Revoked' || statusFilter === 'Paid' || statusFilter === 'Unpaid'
      ? 'is_paid DESC, id DESC'
      : "CASE status WHEN 'Unused' THEN 0 WHEN 'Used' THEN 1 ELSE 2 END, is_paid DESC, id DESC";

  const rawRows = db
    .prepare(
      `SELECT id, code, status, is_paid, source, note, assigned_to, created_at, used_at
       FROM redeem_codes
       ${whereSql}
       ORDER BY ${orderSql}
       LIMIT ? OFFSET ?`
    )
    .all(...whereArgs, safePageSize, offset) as unknown as any[];

  return {
    codes: rawRows.map(mapRedeemRow),
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
    `INSERT OR IGNORE INTO redeem_codes (code, code_compact, status, source, note, assigned_to, created_at)
     VALUES (?, ?, 'Unused', 'admin', ?, '', ?)`
  );
  const selectStmt = db.prepare(
    `SELECT id, code, status, is_paid, source, note, assigned_to, created_at, used_at
     FROM redeem_codes WHERE code = ?`
  );

  const created: RedeemCodeRecord[] = [];
  let attempts = 0;

  db.exec('BEGIN IMMEDIATE');
  try {
    while (created.length < safeCount && attempts < safeCount * 5) {
      attempts++;
      const code = generateSecureCode(prefix);
      const info = insertStmt.run(code, compactCode(code), safeNote, nowIso);
      if (Number(info.changes) > 0) {
        const row = selectStmt.get(code) as any;
        if (row) created.push(mapRedeemRow(row));
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
    `INSERT OR IGNORE INTO redeem_codes (code, code_compact, status, source, note, assigned_to, created_at)
     VALUES (?, ?, 'Unused', ?, ?, '', ?)`
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
      const info = insertStmt.run(code, compactCode(code), safeSource, safeNote, nowIso);
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
 * Read-only diagnostic lookup for Admin testing without burning a code.
 */
export function checkRedeemCodeStatus(rawCode: string): {
  found: boolean;
  normalizedInput: string;
  record?: RedeemCodeRecord;
} {
  const code = normalizeCode(rawCode);
  const compact = compactCode(rawCode);
  if (!code || code.length < 4) {
    return { found: false, normalizedInput: code };
  }
  const db = getRedeemDb();
  let existing = db
    .prepare(
      `SELECT id, code, status, is_paid, source, note, assigned_to, created_at, used_at
       FROM redeem_codes WHERE code = ?`
    )
    .get(code) as any;

  if (!existing && compact.length >= 4) {
    existing = db
      .prepare(
        `SELECT id, code, status, is_paid, source, note, assigned_to, created_at, used_at
         FROM redeem_codes WHERE code_compact = ?
         ORDER BY CASE status WHEN 'Unused' THEN 0 ELSE 1 END, is_paid DESC, id ASC
         LIMIT 1`
      )
      .get(compact) as any;
  }

  return existing
    ? { found: true, normalizedInput: code, record: mapRedeemRow(existing) }
    : { found: false, normalizedInput: code };
}

/**
 * Atomically verifies a Redeem Code and marks it 'Used' ONLY if status is 'Unused' AND is_paid = 1.
 * Unpaid Google Sheet (10,000) / pool codes require verified payment first (returns 402 PAYMENT_REQUIRED).
 */
export type RedeemErrorCode = 'EMPTY' | 'NOT_FOUND' | 'ALREADY_USED' | 'REVOKED' | 'PAYMENT_REQUIRED';

export function verifyAndBurnRedeemCode(
  rawCode: string,
  usedBy = ''
): { ok: boolean; statusCode: number; errorCode?: RedeemErrorCode; error?: string; record?: RedeemCodeRecord } {
  const code = normalizeCode(rawCode);
  const compact = compactCode(rawCode);
  if (!code || code.length < 4) {
    return {
      ok: false,
      statusCode: 400,
      errorCode: 'EMPTY',
      error: 'សូមបញ្ចូលលេខកូដ Redeem Code ឱ្យបានត្រឹមត្រូវ!',
    };
  }

  const db = getRedeemDb();
  const safeUser = String(usedBy || '').trim().slice(0, 160);
  const nowIso = new Date().toISOString();

  db.exec('BEGIN IMMEDIATE');
  try {
    let existing = db
      .prepare(
        `SELECT id, code, status, is_paid, source, note, assigned_to, created_at, used_at
         FROM redeem_codes WHERE code = ?`
      )
      .get(code) as any;

    if (!existing && compact.length >= 4) {
      existing = db
        .prepare(
          `SELECT id, code, status, is_paid, source, note, assigned_to, created_at, used_at
           FROM redeem_codes WHERE code_compact = ?
           ORDER BY CASE status WHEN 'Unused' THEN 0 ELSE 1 END, is_paid DESC, id ASC
           LIMIT 1`
        )
        .get(compact) as any;
    }

    if (!existing) {
      db.exec('COMMIT');
      return {
        ok: false,
        statusCode: 404,
        errorCode: 'NOT_FOUND',
        error: 'រកមិនឃើញលេខកូដនេះក្នុងប្រព័ន្ធ Database ឡើយ!',
      };
    }

    if (existing.status === 'Used') {
      db.exec('COMMIT');
      return {
        ok: false,
        statusCode: 409,
        errorCode: 'ALREADY_USED',
        error: 'លេខកូដដោះសោនេះត្រូវបានប្រើប្រាស់រួចហើយ (Used)!',
      };
    }

    if (existing.status === 'Revoked') {
      db.exec('COMMIT');
      return {
        ok: false,
        statusCode: 403,
        errorCode: 'REVOKED',
        error: 'លេខកូដនេះត្រូវបានផ្អាក ឬផុតសុពលភាព (Revoked)!',
      };
    }

    if (Number(existing.is_paid) !== 1) {
      db.exec('COMMIT');
      return {
        ok: false,
        statusCode: 402,
        errorCode: 'PAYMENT_REQUIRED',
        error:
          'លេខកូដ Redeem Code (Google Sheet) នេះមិនទាន់បានបង់ប្រាក់ទេ! សូមបង់ប្រាក់តាមធនាគារកូរ៉េ ឬ ABA PayWay ជាមុនសិន ទើបអាចដោះសោបាន។',
      };
    }

    const assignee = existing.assigned_to || safeUser || 'web_user';
    db.prepare(
      `UPDATE redeem_codes
       SET status = 'Used', used_at = ?, assigned_to = ?
       WHERE id = ? AND status = 'Unused' AND is_paid = 1`
    ).run(nowIso, assignee, existing.id);

    db.exec('COMMIT');
    return {
      ok: true,
      statusCode: 200,
      record: mapRedeemRow({
        ...existing,
        status: 'Used',
        used_at: nowIso,
        assigned_to: assignee,
      }),
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
 * Reserves the next unpaid 'Unused' code from the Database (prioritizing the 10,000 Google Sheet codes!)
 * and marks it is_paid = 1 upon verified payment (Korea Bank receipt, Telegram Bot, or Admin payment confirmation).
 * If the pool is empty, mints a fresh paid code directly into the Database.
 */
export function reserveUnusedRedeemCode(params: {
  source: 'kr_receipt' | 'telegram_bot' | 'admin_paid';
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
        `SELECT id, code, status, is_paid, source, note, assigned_to, created_at, used_at
         FROM redeem_codes
         WHERE status = 'Unused' AND is_paid = 0 AND (assigned_to IS NULL OR assigned_to = '')
         ORDER BY CASE source WHEN 'google_sheets' THEN 0 ELSE 1 END, id ASC
         LIMIT 1`
      )
      .get() as any;

    if (candidate) {
      const nextSource = candidate.source === 'google_sheets' ? 'google_sheets' : params.source;
      const nextNote = safeNote || candidate.note || 'Paid';
      db.prepare(
        `UPDATE redeem_codes
         SET is_paid = 1, assigned_to = ?, note = ?, source = ?
         WHERE id = ?`
      ).run(safeAssignee, nextNote, nextSource, candidate.id);
      db.exec('COMMIT');
      return mapRedeemRow({
        ...candidate,
        is_paid: 1,
        assigned_to: safeAssignee,
        note: nextNote,
        source: nextSource,
      });
    }

    // Pool empty -> mint a fresh paid code directly into the Database with status = 'Unused' & is_paid = 1
    const newCode = generateSecureCode(
      params.fallbackPrefix || (params.source === 'telegram_bot' ? 'KIIP-TG' : params.source === 'admin_paid' ? 'KIIP-PAID' : 'KIIP-KR')
    );
    db.prepare(
      `INSERT INTO redeem_codes (code, code_compact, status, is_paid, source, note, assigned_to, created_at)
       VALUES (?, ?, 'Unused', 1, ?, ?, ?, ?)`
    ).run(newCode, compactCode(newCode), params.source, safeNote, safeAssignee, nowIso);

    const created = db
      .prepare(
        `SELECT id, code, status, is_paid, source, note, assigned_to, created_at, used_at
         FROM redeem_codes WHERE code = ?`
      )
      .get(newCode) as any;

    db.exec('COMMIT');
    return mapRedeemRow(created);
  } catch (err) {
    try {
      db.exec('ROLLBACK');
    } catch {
      // ignore
    }
    throw err;
  }
}

export interface VerifiedReceiptReservationResult {
  ok: boolean;
  duplicate?: boolean;
  existingCode?: string;
  record?: RedeemCodeRecord;
}

/**
 * Atomically checks for duplicate receipt replays (by image SHA-256 or transfer timestamp+amount fingerprint),
 * reserves the next unpaid 'Unused' Redeem Code (prioritizing the 10,000 Google Sheet codes), marks it Paid,
 * and records the verified receipt inside one SQLite transaction.
 */
export function recordVerifiedReceiptAndReserveCode(params: {
  imageSha256: string;
  transferFingerprint: string;
  source: 'kr_receipt' | 'telegram_bot';
  assignedTo: string;
  note: string;
  bankName: string;
  recipientName: string;
  amountKrw: number;
  transferTimestamp: string;
  fallbackPrefix?: string;
}): VerifiedReceiptReservationResult {
  const db = getRedeemDb();
  const safeHash = String(params.imageSha256 || '').trim().toLowerCase().slice(0, 128);
  const safeFp = String(params.transferFingerprint || '').trim().slice(0, 180);
  const safeAssignee = String(params.assignedTo || 'customer').trim().slice(0, 160);
  const safeNote = String(params.note || '').trim().slice(0, 160);
  const safeBank = String(params.bankName || '').trim().slice(0, 80);
  const safeRecipient = String(params.recipientName || '').trim().slice(0, 100);
  const safeAmount = Math.max(0, Math.round(Number(params.amountKrw) || 0));
  const safeTs = String(params.transferTimestamp || '').trim().slice(0, 80);
  const nowIso = new Date().toISOString();

  db.exec('BEGIN IMMEDIATE');
  try {
    if (safeHash) {
      const existingByHash = db
        .prepare('SELECT redeem_code FROM verified_receipts WHERE image_sha256 = ? LIMIT 1')
        .get(safeHash) as { redeem_code: string } | undefined;
      if (existingByHash) {
        db.exec('COMMIT');
        return { ok: false, duplicate: true, existingCode: existingByHash.redeem_code };
      }
    }

    if (safeFp) {
      const existingByFp = db
        .prepare(
          `SELECT redeem_code FROM verified_receipts
           WHERE transfer_fingerprint != '' AND transfer_fingerprint = ?
           LIMIT 1`
        )
        .get(safeFp) as { redeem_code: string } | undefined;
      if (existingByFp) {
        db.exec('COMMIT');
        return { ok: false, duplicate: true, existingCode: existingByFp.redeem_code };
      }
    }

    const candidate = db
      .prepare(
        `SELECT id, code, status, is_paid, source, note, assigned_to, created_at, used_at
         FROM redeem_codes
         WHERE status = 'Unused' AND is_paid = 0 AND (assigned_to IS NULL OR assigned_to = '')
         ORDER BY CASE source WHEN 'google_sheets' THEN 0 ELSE 1 END, id ASC
         LIMIT 1`
      )
      .get() as any;

    let reservedRecord: RedeemCodeRecord;

    if (candidate) {
      const nextSource = candidate.source === 'google_sheets' ? 'google_sheets' : params.source;
      const nextNote = safeNote || candidate.note || 'Paid';
      db.prepare(
        `UPDATE redeem_codes
         SET is_paid = 1, assigned_to = ?, note = ?, source = ?
         WHERE id = ?`
      ).run(safeAssignee, nextNote, nextSource, candidate.id);
      reservedRecord = mapRedeemRow({
        ...candidate,
        is_paid: 1,
        assigned_to: safeAssignee,
        note: nextNote,
        source: nextSource,
      });
    } else {
      const newCode = generateSecureCode(
        params.fallbackPrefix || (params.source === 'telegram_bot' ? 'KIIP-TG' : 'KIIP-KR')
      );
      db.prepare(
        `INSERT INTO redeem_codes (code, code_compact, status, is_paid, source, note, assigned_to, created_at)
         VALUES (?, ?, 'Unused', 1, ?, ?, ?, ?)`
      ).run(newCode, compactCode(newCode), params.source, safeNote, safeAssignee, nowIso);

      const created = db
        .prepare(
          `SELECT id, code, status, is_paid, source, note, assigned_to, created_at, used_at
           FROM redeem_codes WHERE code = ?`
        )
        .get(newCode) as any;
      reservedRecord = mapRedeemRow(created);
    }

    db.prepare(
      `INSERT INTO verified_receipts
        (image_sha256, transfer_fingerprint, redeem_code, bank_name, recipient_name, amount_krw, transfer_timestamp, user_email, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      safeHash || crypto.randomBytes(16).toString('hex'),
      safeFp,
      reservedRecord.code,
      safeBank,
      safeRecipient,
      safeAmount,
      safeTs,
      safeAssignee,
      nowIso
    );

    db.exec('COMMIT');
    return { ok: true, record: reservedRecord };
  } catch (err) {
    try {
      db.exec('ROLLBACK');
    } catch {
      // ignore
    }
    throw err;
  }
}

export function setRedeemCodePaid(
  rawCode: string,
  isPaid: boolean,
  assignedTo?: string,
  note?: string
): RedeemCodeRecord | null {
  const code = normalizeCode(rawCode);
  if (!code) return null;
  const db = getRedeemDb();
  const existing = db
    .prepare(
      `SELECT id, code, status, is_paid, source, note, assigned_to, created_at, used_at
       FROM redeem_codes WHERE code = ?`
    )
    .get(code) as any;
  if (!existing) return null;

  const nextPaid = isPaid ? 1 : 0;
  const nextAssignee = isPaid
    ? String(assignedTo || existing.assigned_to || 'admin_paid').trim().slice(0, 160)
    : '';
  const nextNote = note !== undefined && note.trim()
    ? String(note).trim().slice(0, 160)
    : existing.note;

  db.prepare(
    `UPDATE redeem_codes SET is_paid = ?, assigned_to = ?, note = ? WHERE id = ?`
  ).run(nextPaid, nextAssignee, nextNote, existing.id);

  const updated = db
    .prepare(
      `SELECT id, code, status, is_paid, source, note, assigned_to, created_at, used_at
       FROM redeem_codes WHERE id = ?`
    )
    .get(existing.id) as any;
  return updated ? mapRedeemRow(updated) : null;
}

export function issueNextPaidRedeemCode(params?: {
  assignedTo?: string;
  note?: string;
}): RedeemCodeRecord {
  return reserveUnusedRedeemCode({
    source: 'admin_paid',
    assignedTo: String(params?.assignedTo || 'paid_customer').trim().slice(0, 160),
    note: String(params?.note || 'Admin Payment Confirmed (ABA / Bank)').trim().slice(0, 160),
    fallbackPrefix: 'KIIP-PAID',
  });
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
 * Simple RFC-4180 CSV/TSV/semicolon parser (handles quoted cells and commas inside quotes).
 */
function parseCsvRows(csvText: string): string[][] {
  const firstLine = csvText.split(/\r?\n/).find((l) => l.trim().length > 0) || '';
  const delimiter = firstLine.includes(',')
    ? ','
    : firstLine.includes('\t')
    ? '\t'
    : firstLine.includes(';')
    ? ';'
    : ',';

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
      } else if (ch === delimiter) {
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

export interface GoogleSheetSyncResult {
  success: boolean;
  sheetId: string;
  sheetName: string;
  rowsRead: number;
  imported: number;
  skipped: number;
  detectedColumnLabel?: string;
  sampleCodes?: string[];
  error?: string;
}

/**
 * Strictly extracts only validated Google Sheets identifiers (sheetId, publishedId, gid)
 * from either a raw ID or a full docs.google.com/spreadsheets URL (including /u/0/ multi-account URLs).
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

    // Published-to-web URL: /spreadsheets/(u/0/)?d/e/2PACX-.../pubhtml or /pub?output=csv
    const pubMatch = parsedUrl.pathname.match(/\/spreadsheets\/(?:u\/\d+\/)?d\/e\/(2PACX-[a-zA-Z0-9_-]{10,160})/i);
    if (pubMatch && PUBLISHED_ID_REGEX.test(pubMatch[1])) {
      return { publishedId: pubMatch[1], gid };
    }

    // Standard URL: /spreadsheets/(u/0/)?d/<SHEET_ID>/edit...
    const stdMatch = parsedUrl.pathname.match(/\/spreadsheets\/(?:u\/\d+\/)?d\/([a-zA-Z0-9_-]{10,120})/i);
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
      'User-Agent': 'Mozilla/5.0 (compatible; KIIP-Portal-SheetSync/1.1)',
      Accept: 'text/csv, text/plain, */*',
    },
    signal: AbortSignal.timeout(25000),
  });

  if (!resp.ok) {
    return { ok: false, status: resp.status, isHtmlLogin: false, rows: [], errorText: `HTTP ${resp.status}` };
  }

  const rawText = await resp.text();
  const cleanText = rawText.replace(/^\uFEFF/, '').trim();
  if (!cleanText) {
    return { ok: true, status: resp.status, isHtmlLogin: false, rows: [] };
  }

  const lowerHead = cleanText.slice(0, 400).toLowerCase();
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

function columnIndexToLetter(idx: number): string {
  let n = idx + 1;
  let label = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    label = String.fromCharCode(65 + rem) + label;
    n = Math.floor((n - 1) / 26);
  }
  return label || 'A';
}

const STATUS_VALUE_WORDS = new Set([
  'unused',
  'used',
  'revoked',
  'available',
  'active',
  'claimed',
  'redeemed',
  'expired',
  'disabled',
  'ប្រើរួច',
  'មិនទាន់ប្រើ',
  'បានប្រើ',
  'ផ្អាក',
  '사용완료',
  '미사용',
  '사용됨',
  '만료',
]);

/**
 * Intelligently detects header row, redeem-code column, optional status column, and optional note column
 * across 1-column or multi-column sheets (even when Col A is sequential row numbers 1..10000).
 */
export function detectSheetColumns(parsedRows: string[][]): {
  hasHeader: boolean;
  codeCol: number;
  statusCol: number;
  noteCol: number;
} {
  const firstRowLower = parsedRows[0].map((c) => c.replace(/^\uFEFF/, '').trim().toLowerCase());

  const isCodeHeader = (c: string) =>
    c.includes('code') ||
    c.includes('redeem') ||
    c.includes('voucher') ||
    c.includes('coupon') ||
    c.includes('serial') ||
    c === 'key' ||
    c.includes('pin') ||
    c.includes('token') ||
    c.includes('កូដ') ||
    c.includes('លេខកូដ') ||
    c.includes('코드') ||
    c.includes('쿠폰');

  const isStatusHeader = (c: string) =>
    c.includes('status') || c.includes('state') || c.includes('ស្ថានភាព') || c.includes('상태');

  const isNoteHeader = (c: string) =>
    c.includes('note') ||
    c.includes('desc') ||
    c.includes('memo') ||
    c.includes('center') ||
    c.includes('remark') ||
    c.includes('សម្គាល់') ||
    c.includes('비고');

  const isIndexHeader = (c: string) =>
    c === 'no' ||
    c === 'no.' ||
    c === '#' ||
    c === 'id' ||
    c === 'idx' ||
    c === 'index' ||
    c === 'seq' ||
    c === 'ល.រ' ||
    c === '번호';

  const hasHeader = firstRowLower.some(
    (c) => isCodeHeader(c) || isStatusHeader(c) || isNoteHeader(c) || isIndexHeader(c)
  );

  const sampleRows = (hasHeader ? parsedRows.slice(1) : parsedRows).slice(0, 30);
  const maxCols = Math.max(
    parsedRows[0].length,
    ...sampleRows.map((r) => r.length)
  );

  let codeCol = hasHeader ? firstRowLower.findIndex(isCodeHeader) : -1;
  let statusCol = hasHeader ? firstRowLower.findIndex(isStatusHeader) : -1;
  let noteCol = hasHeader ? firstRowLower.findIndex(isNoteHeader) : -1;

  // If no explicit code header was found, score every column across sample rows
  if (codeCol < 0 && sampleRows.length > 0) {
    let bestCol = 0;
    let bestScore = -1e9;

    for (let col = 0; col < maxCols; col++) {
      if (col === statusCol || col === noteCol) continue;
      if (hasHeader && isIndexHeader(firstRowLower[col] || '')) continue;

      const values = sampleRows.map((r) => String(r[col] || '').trim()).filter(Boolean);
      if (values.length === 0) continue;

      const normalized = values.map((v) => normalizeCode(v));
      const validTokens = normalized.filter((v) => v.length >= 4);
      const uniqueCount = new Set(validTokens).size;

      // Detect sequential integer column (1, 2, 3... or 0001, 0002, 0003...)
      const intNums = values.map((v) => (/^\d+$/.test(v) ? Number(v) : NaN));
      let sequentialSteps = 0;
      for (let i = 1; i < intNums.length; i++) {
        if (!Number.isNaN(intNums[i]) && !Number.isNaN(intNums[i - 1]) && intNums[i] - intNums[i - 1] === 1) {
          sequentialSteps++;
        }
      }
      const isSequentialIndex =
        values.length >= 3 && sequentialSteps >= Math.floor(values.length * 0.7);

      // Detect status-only column
      const statusMatches = values.filter((v) => STATUS_VALUE_WORDS.has(v.toLowerCase())).length;
      const isMostlyStatus = statusMatches >= Math.ceil(values.length * 0.6);

      // Detect alphanumeric/hyphenated redeem code pattern
      const alphaNumMatches = validTokens.filter((v) => /[A-Z]/.test(v) && /[0-9]/.test(v)).length;
      const hyphenMatches = validTokens.filter((v) => v.includes('-') || v.includes('_')).length;
      const longNumericMatches = validTokens.filter((v) => /^\d{6,}$/.test(v)).length;

      let score = validTokens.length * 4 + uniqueCount * 3 + alphaNumMatches * 6 + hyphenMatches * 4 + longNumericMatches * 2;
      if (isSequentialIndex) score -= 500;
      if (isMostlyStatus) score -= 400;

      if (score > bestScore) {
        bestScore = score;
        bestCol = col;
      }
    }
    codeCol = bestCol;
  }

  if (codeCol < 0) codeCol = 0;

  // Auto-detect status column if not named in header (only if a column actually holds status keywords)
  if (statusCol < 0 && sampleRows.length > 0) {
    for (let col = 0; col < maxCols; col++) {
      if (col === codeCol || col === noteCol) continue;
      const values = sampleRows.map((r) => String(r[col] || '').trim().toLowerCase()).filter(Boolean);
      if (values.length === 0) continue;
      const hits = values.filter((v) => STATUS_VALUE_WORDS.has(v)).length;
      if (hits >= Math.max(1, Math.ceil(values.length * 0.5))) {
        statusCol = col;
        break;
      }
    }
  }

  return { hasHeader, codeCol, statusCol, noteCol };
}

/**
 * Connects to Google Sheets (strictly allowlisted to Google domains to prevent SSRF),
 * accepts a full Google Sheets URL (including /u/0/), Published-to-Web URL, or raw Sheet ID,
 * reads up to 50,000 rows of Redeem Codes, saves the Sheet reference in SQLite app_settings,
 * and syncs them into SQLite.
 */
export async function syncRedeemCodesFromGoogleSheet(params?: {
  sheetId?: string;
  sheetName?: string;
}): Promise<GoogleSheetSyncResult> {
  const db = getRedeemDb();
  const savedCfg = getSavedGoogleSheetConfig();
  const rawSheetInput = String(
    params?.sheetId || savedCfg.sheetId || process.env.GOOGLE_SHEET_ID || ''
  ).trim();
  const hasExplicitTab = params?.sheetName !== undefined && params.sheetName.trim().length > 0;
  const requestedSheetName = String(
    hasExplicitTab
      ? params?.sheetName
      : params?.sheetId
      ? ''
      : savedCfg.sheetName || ''
  )
    .trim()
    .slice(0, 80);

  const parsedRef = parseGoogleSheetReference(rawSheetInput);
  if (!parsedRef) {
    return {
      success: false,
      sheetId: rawSheetInput,
      sheetName: requestedSheetName || 'Tab 1',
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
            { signal: AbortSignal.timeout(15000) }
          );
          if (metaResp.ok) {
            const metaJson = (await metaResp.json()) as { sheets?: Array<{ properties?: { title?: string } }> };
            targetTab = metaJson?.sheets?.[0]?.properties?.title || 'Sheet1';
            effectiveSheetName = targetTab;
          }
        }
        const range = encodeURIComponent(targetTab ? `${targetTab}!A1:F50000` : 'A1:F50000');
        const apiUrl = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(parsedRef.sheetId)}/values/${range}?key=${encodeURIComponent(apiKey)}`;
        const apiResp = await fetch(apiUrl, { signal: AbortSignal.timeout(25000) });
        if (apiResp.ok) {
          const json = (await apiResp.json()) as { values?: string[][] };
          parsedRows = Array.isArray(json.values) ? json.values : [];
          fetched = parsedRows.length > 0;
        } else {
          lastHttpStatus = apiResp.status;
        }
      }

      // Strategy 2: Direct CSV Export FIRST when no explicit tab name was given (or when gid is in URL).
      // Unlike gviz/tq, /export?format=csv NEVER drops mixed numeric+text cells in the same column!
      if (!fetched && (!requestedSheetName || parsedRef.gid)) {
        const exportUrl = parsedRef.gid
          ? `https://docs.google.com/spreadsheets/d/${encodeURIComponent(parsedRef.sheetId)}/export?format=csv&gid=${encodeURIComponent(parsedRef.gid)}`
          : `https://docs.google.com/spreadsheets/d/${encodeURIComponent(parsedRef.sheetId)}/export?format=csv`;
        const r = await fetchCsvFromGoogleUrl(exportUrl);
        if (r.ok && r.rows.length > 0) {
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

      // Strategy 3: Named tab via gviz CSV (when user explicitly entered a tab name)
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

      // Strategy 4: Fallback to Direct CSV Export for first tab if named tab failed
      if (!fetched) {
        const exportFirst = `https://docs.google.com/spreadsheets/d/${encodeURIComponent(parsedRef.sheetId)}/export?format=csv`;
        const r = await fetchCsvFromGoogleUrl(exportFirst);
        if (r.ok) {
          parsedRows = r.rows;
          fetched = true;
          effectiveSheetName = 'Tab 1';
        } else {
          if (r.isHtmlLogin) sawHtmlLogin = true;
          if (r.status) lastHttpStatus = r.status;
        }
      }

      // Strategy 5: Final fallback gviz CSV for first tab
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
        const errMsg =
          sawHtmlLogin || lastHttpStatus === 401 || lastHttpStatus === 403
            ? 'Google Sheet នេះជាប់សិទ្ធិ Private! សូមបើក Google Sheet → ចុច "Share" → ប្តូរ General access ទៅជា "Anyone with the link (Viewer)" រួចសាកល្បងម្តងទៀត (ឬ Export ជា .CSV ហើយ Upload ផ្ទាល់)។'
            : `មិនអាចអាន Google Sheet បានទេ (HTTP ${lastHttpStatus || 'Error'})។ សូមពិនិត្យថា Link/ID ត្រឹមត្រូវ ហើយ Sheet បើកសិទ្ធិ "Anyone with the link (Viewer)"។`;
        setAppSetting(db, 'google_sheet_last_error', errMsg);
        return {
          success: false,
          sheetId: resolvedId,
          sheetName: effectiveSheetName,
          rowsRead: 0,
          imported: 0,
          skipped: 0,
          error: errMsg,
        };
      }
    }
  } catch (err: any) {
    const errMsg = `បរាជ័យក្នុងការតភ្ជាប់ Google Sheets: ${err?.message || 'Network timeout'}`;
    setAppSetting(db, 'google_sheet_last_error', errMsg);
    return {
      success: false,
      sheetId: resolvedId,
      sheetName: effectiveSheetName,
      rowsRead: 0,
      imported: 0,
      skipped: 0,
      error: errMsg,
    };
  }

  // Persist the working Google Sheet reference so restarts & on-demand verify-redeem remember it!
  setAppSetting(db, 'google_sheet_id', rawSheetInput);
  setAppSetting(db, 'google_sheet_tab', requestedSheetName);
  setAppSetting(db, 'google_sheet_last_error', '');

  if (parsedRows.length === 0) {
    setAppSetting(db, 'google_sheet_last_sync_at', new Date().toISOString());
    setAppSetting(db, 'google_sheet_last_rows_read', '0');
    setAppSetting(db, 'google_sheet_last_imported', '0');
    return {
      success: true,
      sheetId: resolvedId,
      sheetName: effectiveSheetName,
      rowsRead: 0,
      imported: 0,
      skipped: 0,
    };
  }

  const { hasHeader, codeCol, statusCol, noteCol } = detectSheetColumns(parsedRows);
  const detectedColumnLabel = `Col ${columnIndexToLetter(codeCol)}${hasHeader && parsedRows[0][codeCol] ? ` (${parsedRows[0][codeCol].slice(0, 24)})` : ''}`;

  const dataRows = hasHeader ? parsedRows.slice(1) : parsedRows;
  const nowIso = new Date().toISOString();
  const insertStmt = db.prepare(
    `INSERT OR IGNORE INTO redeem_codes (code, code_compact, status, source, note, assigned_to, created_at)
     VALUES (?, ?, ?, 'google_sheets', ?, '', ?)`
  );

  let imported = 0;
  let skipped = 0;
  const sampleCodes: string[] = [];

  db.exec('BEGIN IMMEDIATE');
  try {
    for (const r of dataRows.slice(0, MAX_BULK_IMPORT_CODES)) {
      const code = normalizeCode(r[codeCol] || '');
      if (code.length < 4) {
        skipped++;
        continue;
      }
      const status = statusCol >= 0 ? normalizeStatus(r[statusCol] || 'Unused') : 'Unused';
      const note =
        noteCol >= 0 && r[noteCol]
          ? String(r[noteCol]).trim().slice(0, 140)
          : `Sheet: ${effectiveSheetName}`;
      const info = insertStmt.run(code, compactCode(code), status, note, nowIso);
      if (Number(info.changes) > 0) {
        imported++;
      } else {
        skipped++;
      }
      if (sampleCodes.length < 5) {
        sampleCodes.push(code);
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

  setAppSetting(db, 'google_sheet_last_sync_at', nowIso);
  setAppSetting(db, 'google_sheet_last_rows_read', String(dataRows.length));
  setAppSetting(db, 'google_sheet_last_imported', String(imported));

  return {
    success: true,
    sheetId: resolvedId,
    sheetName: effectiveSheetName,
    rowsRead: dataRows.length,
    imported,
    skipped,
    detectedColumnLabel,
    sampleCodes,
  };
}

/**
 * Deduplicated, throttled Google Sheet auto-sync used on server startup and
 * on-demand when /api/payments/verify-redeem receives a code not yet in SQLite.
 */
export async function ensureGoogleSheetSynced(options?: {
  force?: boolean;
  cooldownMs?: number;
}): Promise<GoogleSheetSyncResult | null> {
  const cfg = getSavedGoogleSheetConfig();
  if (cfg.source === 'none' || !cfg.sheetId) {
    return null;
  }

  const cooldownMs = Math.max(5000, options?.cooldownMs ?? 30000);
  const now = Date.now();
  if (!options?.force && now - lastAutoSyncAttemptMs < cooldownMs) {
    return null;
  }

  if (inFlightSheetSync) {
    return inFlightSheetSync;
  }

  lastAutoSyncAttemptMs = now;
  inFlightSheetSync = syncRedeemCodesFromGoogleSheet({
    sheetId: cfg.sheetId,
    sheetName: cfg.sheetName || undefined,
  })
    .then((res) => {
      if (res.success) {
        console.log(
          `[RedeemDB] Auto-synced Google Sheet (${res.sheetName}): read ${res.rowsRead} rows, imported ${res.imported} new codes.`
        );
      } else {
        console.warn(`[RedeemDB] Auto-sync Google Sheet warning: ${res.error}`);
      }
      return res;
    })
    .finally(() => {
      inFlightSheetSync = null;
    });

  return inFlightSheetSync;
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
}): { ok: boolean; user?: PublicUserRecord; error?: string } {
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
    if (existing.provider === 'email') {
      return {
        ok: false,
        error: 'គណនី Email នេះត្រូវបានការពារដោយពាក្យសម្ងាត់! សូមចូលតាម Email និង Password ជំនួសវិញ។',
      };
    }
    const nextName = String(params.name || '').trim() || existing.name || normalizedEmail.split('@')[0];
    db.prepare('UPDATE user_accounts SET last_login_at = ?, name = ? WHERE id = ?').run(
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
        provider: 'otp',
        createdAt: String(existing.created_at),
        lastLoginAt: nowIso,
      },
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
    ok: true,
    user: {
      id: Number(info.lastInsertRowid),
      email: normalizedEmail,
      name: displayName,
      phone: normalizedPhone,
      provider: 'otp',
      createdAt: nowIso,
      lastLoginAt: nowIso,
    },
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

export function changeUserAccountPassword(params: {
  email: string;
  currentPassword: string;
  newPassword: string;
}): { ok: boolean; error?: string } {
  const email = String(params.email || '').trim().toLowerCase();
  const currentPassword = String(params.currentPassword || '');
  const newPassword = String(params.newPassword || '');
  if (!email) return { ok: false, error: 'សូមបញ្ចូល Email!' };
  if (!currentPassword) return { ok: false, error: 'សូមបញ្ចូលពាក្យសម្ងាត់បច្ចុប្បន្ន!' };
  if (newPassword.length < 6 || newPassword.length > 128) {
    return { ok: false, error: 'ពាក្យសម្ងាត់ថ្មីត្រូវមានយ៉ាងតិច ៦ តួអក្សរ!' };
  }

  const db = getRedeemDb();
  ensureUserAccountsTable(db);
  const row = db
    .prepare('SELECT id, salt, password_hash FROM user_accounts WHERE email = ? LIMIT 1')
    .get(email) as { id: number; salt: string; password_hash: string } | undefined;
  if (!row) {
    return { ok: false, error: 'រកមិនឃើញគណនីដែលប្រើ Email នេះទេ!' };
  }
  if (!verifyUserPasswordHash(currentPassword, row.salt, row.password_hash)) {
    return { ok: false, error: 'ពាក្យសម្ងាត់បច្ចុប្បន្នមិនត្រឹមត្រូវទេ!' };
  }

  const salt = crypto.randomBytes(16).toString('hex');
  const passwordHash = hashUserPassword(newPassword, salt);
  db.prepare('UPDATE user_accounts SET salt = ?, password_hash = ? WHERE id = ?').run(
    salt,
    passwordHash,
    row.id
  );
  return { ok: true };
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

// ============================================================================
// SERVER-SIDE ADMIN PROMO CODES (Works for ALL users without requiring Google Sign-In)
// ============================================================================
export interface ServerPromoCodeRecord {
  id: string;
  code: string;
  centerId: string;
  monthLabel: string;
  usageLimit: number;
  usageCount: number;
  expiresAt: string;
  isActive: boolean;
  createdAt: string;
}

export type PromoErrorCode = 'EMPTY' | 'NOT_FOUND' | 'INACTIVE' | 'EXPIRED' | 'LIMIT_REACHED';

interface PromoCodeDbRow {
  code: string;
  code_compact: string;
  center_id: string;
  month_label: string;
  usage_limit: number;
  usage_count: number;
  expires_at: string;
  is_active: number;
  created_at: string;
}

function mapPromoRow(r: PromoCodeDbRow): ServerPromoCodeRecord {
  return {
    id: String(r.code),
    code: String(r.code),
    centerId: String(r.center_id || 'general'),
    monthLabel: String(r.month_label || ''),
    usageLimit: Math.max(1, Number(r.usage_limit) || 50),
    usageCount: Math.max(0, Number(r.usage_count) || 0),
    expiresAt: String(r.expires_at || ''),
    isActive: Number(r.is_active) !== 0,
    createdAt: String(r.created_at || ''),
  };
}

export function listServerPromoCodes(): ServerPromoCodeRecord[] {
  const db = getRedeemDb();
  const rows = db
    .prepare(
      `SELECT code, code_compact, center_id, month_label, usage_limit, usage_count, expires_at, is_active, created_at
       FROM promo_codes
       ORDER BY created_at DESC`
    )
    .all() as unknown as PromoCodeDbRow[];
  return rows.map(mapPromoRow);
}

export function upsertServerPromoCode(params: {
  code: string;
  centerId?: string;
  monthLabel?: string;
  usageLimit?: number;
  usageCount?: number;
  expiresAt?: string;
  isActive?: boolean;
  createdAt?: string;
  preserveUsageCount?: boolean;
}): { ok: boolean; error?: string; promo?: ServerPromoCodeRecord } {
  const code = normalizeCode(params.code);
  const compact = compactCode(params.code);
  if (code.length < 3 || code.length > 64) {
    return {
      ok: false,
      error: 'លេខកូដ Promo Code ត្រូវមានចន្លោះ ៣ ដល់ ៦៤ តួអក្សរ (A-Z, 0-9, -, _)។',
    };
  }

  const centerId = String(params.centerId || 'general')
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, '')
    .slice(0, 64) || 'general';
  const monthLabel = String(params.monthLabel || '').trim().slice(0, 32);
  const usageLimit = Math.max(1, Math.min(100000, Math.floor(Number(params.usageLimit) || 50)));
  const incomingUsageCount = Math.max(0, Math.floor(Number(params.usageCount) || 0));
  const expiresAt = String(params.expiresAt || '').trim().slice(0, 32);
  const isActive = params.isActive === false ? 0 : 1;
  const createdAt = String(params.createdAt || '').trim() || new Date().toISOString();

  const db = getRedeemDb();
  if (params.preserveUsageCount) {
    db.prepare(
      `INSERT INTO promo_codes (code, code_compact, center_id, month_label, usage_limit, usage_count, expires_at, is_active, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(code) DO UPDATE SET
         code_compact = excluded.code_compact,
         center_id = excluded.center_id,
         month_label = CASE WHEN excluded.month_label != '' THEN excluded.month_label ELSE promo_codes.month_label END,
         usage_limit = excluded.usage_limit,
         usage_count = MAX(promo_codes.usage_count, excluded.usage_count),
         expires_at = excluded.expires_at,
         is_active = excluded.is_active`
    ).run(code, compact, centerId, monthLabel, usageLimit, incomingUsageCount, expiresAt, isActive, createdAt);
  } else {
    db.prepare(
      `INSERT INTO promo_codes (code, code_compact, center_id, month_label, usage_limit, usage_count, expires_at, is_active, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(code) DO UPDATE SET
         code_compact = excluded.code_compact,
         center_id = excluded.center_id,
         month_label = excluded.month_label,
         usage_limit = excluded.usage_limit,
         expires_at = excluded.expires_at,
         is_active = excluded.is_active`
    ).run(code, compact, centerId, monthLabel, usageLimit, incomingUsageCount, expiresAt, isActive, createdAt);
  }

  const row = db
    .prepare(
      `SELECT code, code_compact, center_id, month_label, usage_limit, usage_count, expires_at, is_active, created_at
       FROM promo_codes WHERE code = ?`
    )
    .get(code) as unknown as PromoCodeDbRow | undefined;

  return row ? { ok: true, promo: mapPromoRow(row) } : { ok: false, error: 'Failed to save promo code' };
}

export function deleteServerPromoCode(rawCode: string): boolean {
  const code = normalizeCode(rawCode);
  if (!code) return false;
  const db = getRedeemDb();
  const info = db.prepare('DELETE FROM promo_codes WHERE code = ?').run(code);
  return Number(info.changes) > 0;
}

function isPromoExpired(expiresAt: string): boolean {
  const trimmed = String(expiresAt || '').trim();
  if (!trimmed) return false;
  // Support YYYY-MM-DD (valid through end of that day in KST +09:00) or ISO timestamp
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(trimmed)
    ? new Date(`${trimmed}T23:59:59+09:00`)
    : new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return false;
  return Date.now() > parsed.getTime();
}

export function verifyAndIncrementServerPromoCode(rawCode: string): {
  ok: boolean;
  statusCode: number;
  errorCode?: PromoErrorCode;
  error?: string;
  promo?: ServerPromoCodeRecord;
} {
  const code = normalizeCode(rawCode);
  const compact = compactCode(rawCode);
  if (!code || code.length < 3) {
    return {
      ok: false,
      statusCode: 400,
      errorCode: 'EMPTY',
      error: 'សូមបញ្ចូលលេខកូដ Promo Code ឱ្យបានត្រឹមត្រូវ!',
    };
  }

  const db = getRedeemDb();
  db.exec('BEGIN IMMEDIATE');
  try {
    let row = db
      .prepare(
        `SELECT code, code_compact, center_id, month_label, usage_limit, usage_count, expires_at, is_active, created_at
         FROM promo_codes WHERE code = ?`
      )
      .get(code) as unknown as PromoCodeDbRow | undefined;

    if (!row && compact.length >= 3) {
      row = db
        .prepare(
          `SELECT code, code_compact, center_id, month_label, usage_limit, usage_count, expires_at, is_active, created_at
           FROM promo_codes WHERE code_compact = ?
           ORDER BY is_active DESC, created_at DESC
           LIMIT 1`
        )
        .get(compact) as unknown as PromoCodeDbRow | undefined;
    }

    if (!row) {
      db.exec('COMMIT');
      return {
        ok: false,
        statusCode: 404,
        errorCode: 'NOT_FOUND',
      };
    }

    if (Number(row.is_active) === 0) {
      db.exec('COMMIT');
      return {
        ok: false,
        statusCode: 403,
        errorCode: 'INACTIVE',
        error: 'លេខកូដ Promo Code នេះត្រូវបានផ្អាកដំណើរការ!',
      };
    }

    if (isPromoExpired(row.expires_at)) {
      db.exec('COMMIT');
      return {
        ok: false,
        statusCode: 403,
        errorCode: 'EXPIRED',
        error: 'លេខកូដ Promo Code នេះបានផុតកំណត់ហើយ!',
      };
    }

    const currentCount = Math.max(0, Number(row.usage_count) || 0);
    const limit = Math.max(1, Number(row.usage_limit) || 50);
    if (currentCount >= limit) {
      db.exec('COMMIT');
      return {
        ok: false,
        statusCode: 409,
        errorCode: 'LIMIT_REACHED',
        error: 'លេខកូដ Promo Code នេះត្រូវបានប្រើអស់ចំនួនកំណត់ហើយ!',
      };
    }

    db.prepare(
      `UPDATE promo_codes
       SET usage_count = usage_count + 1
       WHERE code = ? AND is_active = 1 AND usage_count < usage_limit`
    ).run(row.code);

    db.exec('COMMIT');
    return {
      ok: true,
      statusCode: 200,
      promo: mapPromoRow({ ...row, usage_count: currentCount + 1 }),
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

export function checkServerPromoCodeExists(rawCode: string): boolean {
  const code = normalizeCode(rawCode);
  const compact = compactCode(rawCode);
  if (!code || code.length < 3) return false;
  const db = getRedeemDb();
  const row = db
    .prepare(`SELECT code FROM promo_codes WHERE code = ? OR code_compact = ? LIMIT 1`)
    .get(code, compact) as { code: string } | undefined;
  return Boolean(row);
}

// ============================================================================
// ANONYMIZED OCR TRANSACTION AUDIT LOGS (ZERO PII STORED)
// ============================================================================

export type OcrTransactionType = 'document_ocr' | 'bank_receipt';
export type OcrVerificationStatus = 'verified' | 'needs_review' | 'failed' | 'false_positive' | 'pending';

export interface OcrTransactionRecord {
  id: number;
  txId: string;
  sessionHash: string;
  txType: OcrTransactionType;
  docTypes: string[];
  modelVersion: string;
  confidenceScore: number;
  verificationStatus: OcrVerificationStatus;
  extractedFields: string[];
  missingFields: string[];
  fieldConfidence: Record<string, number>;
  errorPattern: string;
  fallbackUsed: boolean;
  latencyMs: number;
  adminNote: string;
  createdAt: string;
  updatedAt: string;
}

export interface OcrModelPerformanceRow {
  modelVersion: string;
  totalRuns: number;
  avgConfidence: number;
  avgLatencyMs: number;
  verifiedCount: number;
  failedCount: number;
  passRate: number;
}

export interface OcrPatternStatRow {
  pattern: string;
  count: number;
  sharePct: number;
  avgConfidence: number;
}

export interface OcrMissingFieldStatRow {
  field: string;
  count: number;
}

export interface OcrAnalyticsSummary {
  totalCount: number;
  docOcrCount: number;
  receiptOcrCount: number;
  avgConfidence: number;
  verifiedCount: number;
  needsReviewCount: number;
  failedCount: number;
  falsePositiveCount: number;
  pendingCount: number;
  fallbackCount: number;
  avgLatencyMs: number;
  passRate: number;
  modelBreakdown: OcrModelPerformanceRow[];
  failingPatterns: OcrPatternStatRow[];
  topMissingFields: OcrMissingFieldStatRow[];
}

const ALLOWED_OCR_DOC_TYPES = new Set([
  'arcFront',
  'arcBack',
  'topikCert',
  'passport',
  'pdfText',
  'bankReceipt',
]);

const ALLOWED_OCR_FIELD_KEYS = new Set([
  'name',
  'regNumber1',
  'regNumber2',
  'regNumber',
  'gender',
  'nationality',
  'visaStatus',
  'address',
  'docVerificationNo',
  'examNumber',
  'examDate',
  'round',
  'validUntil',
  'grade',
  'passportNo',
  'passportExpiry',
  'isReceipt',
  'recipientMatched',
  'amountMatched',
  'statusSuccess',
  'timeVerified',
]);

const ALLOWED_VERIFICATION_STATUSES = new Set<OcrVerificationStatus>([
  'verified',
  'needs_review',
  'failed',
  'false_positive',
  'pending',
]);

function sanitizeAllowedList(values: string[] | undefined, allowlist: Set<string>): string[] {
  if (!Array.isArray(values)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values) {
    const clean = String(raw || '').trim();
    if (allowlist.has(clean) && !seen.has(clean)) {
      seen.add(clean);
      out.push(clean);
    }
  }
  return out;
}

function sanitizeFieldConfidenceMap(raw: Record<string, number> | undefined): Record<string, number> {
  if (!raw || typeof raw !== 'object') return {};
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (!ALLOWED_OCR_FIELD_KEYS.has(k)) continue;
    const num = Number(v);
    if (Number.isFinite(num)) {
      out[k] = Math.max(0, Math.min(100, Math.round(num)));
    }
  }
  return out;
}

function sanitizeErrorPattern(raw: string | undefined): string {
  const clean = String(raw || 'NONE')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .slice(0, 64);
  return clean || 'NONE';
}

function safeJsonParseArray(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw || '[]');
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function safeJsonParseConfidence(raw: string): Record<string, number> {
  try {
    const parsed = JSON.parse(raw || '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(parsed)) {
      const n = Number(v);
      if (Number.isFinite(n)) out[k] = Math.max(0, Math.min(100, Math.round(n)));
    }
    return out;
  } catch {
    return {};
  }
}

function mapOcrTxRow(r: any): OcrTransactionRecord {
  return {
    id: Number(r.id),
    txId: String(r.tx_id || ''),
    sessionHash: String(r.session_hash || ''),
    txType: r.tx_type === 'bank_receipt' ? 'bank_receipt' : 'document_ocr',
    docTypes: safeJsonParseArray(r.doc_types_json),
    modelVersion: String(r.model_version || 'unknown'),
    confidenceScore: Math.max(0, Math.min(100, Math.round(Number(r.confidence_score) || 0))),
    verificationStatus: ALLOWED_VERIFICATION_STATUSES.has(r.verification_status)
      ? (r.verification_status as OcrVerificationStatus)
      : 'pending',
    extractedFields: safeJsonParseArray(r.extracted_fields_json),
    missingFields: safeJsonParseArray(r.missing_fields_json),
    fieldConfidence: safeJsonParseConfidence(r.field_confidence_json),
    errorPattern: String(r.error_pattern || 'NONE'),
    fallbackUsed: Number(r.fallback_used) === 1,
    latencyMs: Math.max(0, Math.round(Number(r.latency_ms) || 0)),
    adminNote: String(r.admin_note || ''),
    createdAt: String(r.created_at || ''),
    updatedAt: String(r.updated_at || ''),
  };
}

export function recordOcrTransaction(input: {
  sessionHash: string;
  txType: OcrTransactionType;
  docTypes: string[];
  modelVersion: string;
  confidenceScore: number;
  verificationStatus: OcrVerificationStatus;
  extractedFields: string[];
  missingFields: string[];
  fieldConfidence?: Record<string, number>;
  errorPattern?: string;
  fallbackUsed?: boolean;
  latencyMs?: number;
}): OcrTransactionRecord {
  const db = getRedeemDb();
  const nowIso = new Date().toISOString();
  const prefix = input.txType === 'bank_receipt' ? 'RCP' : 'OCR';
  const txId = `${prefix}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
  const sessionHash = String(input.sessionHash || 'anon')
    .replace(/[^a-fA-F0-9a-z_-]/g, '')
    .slice(0, 16) || 'anon';
  const txType: OcrTransactionType = input.txType === 'bank_receipt' ? 'bank_receipt' : 'document_ocr';
  const docTypes = sanitizeAllowedList(input.docTypes, ALLOWED_OCR_DOC_TYPES);
  const modelVersion = String(input.modelVersion || 'unknown')
    .trim()
    .replace(/[^a-zA-Z0-9._:/ -]/g, '')
    .slice(0, 64) || 'unknown';
  const confidenceScore = Math.max(0, Math.min(100, Math.round(Number(input.confidenceScore) || 0)));
  const verificationStatus: OcrVerificationStatus = ALLOWED_VERIFICATION_STATUSES.has(input.verificationStatus)
    ? input.verificationStatus
    : 'pending';
  const extractedFields = sanitizeAllowedList(input.extractedFields, ALLOWED_OCR_FIELD_KEYS);
  const missingFields = sanitizeAllowedList(input.missingFields, ALLOWED_OCR_FIELD_KEYS);
  const fieldConfidence = sanitizeFieldConfidenceMap(input.fieldConfidence);
  const errorPattern = sanitizeErrorPattern(input.errorPattern);
  const fallbackUsed = input.fallbackUsed ? 1 : 0;
  const latencyMs = Math.max(0, Math.min(300000, Math.round(Number(input.latencyMs) || 0)));

  db.prepare(
    `INSERT INTO ocr_transactions (
      tx_id, session_hash, tx_type, doc_types_json, model_version,
      confidence_score, verification_status, extracted_fields_json, missing_fields_json,
      field_confidence_json, error_pattern, fallback_used, latency_ms, admin_note,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', ?, ?)`
  ).run(
    txId,
    sessionHash,
    txType,
    JSON.stringify(docTypes),
    modelVersion,
    confidenceScore,
    verificationStatus,
    JSON.stringify(extractedFields),
    JSON.stringify(missingFields),
    JSON.stringify(fieldConfidence),
    errorPattern,
    fallbackUsed,
    latencyMs,
    nowIso,
    nowIso
  );

  const inserted = db
    .prepare('SELECT * FROM ocr_transactions WHERE tx_id = ?')
    .get(txId);
  return mapOcrTxRow(inserted);
}

export function queryOcrTransactions(params?: {
  page?: number;
  limit?: number;
  status?: string;
  model?: string;
  txType?: string;
  errorPattern?: string;
  search?: string;
}): {
  items: OcrTransactionRecord[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  availableModels: string[];
  summary: OcrAnalyticsSummary;
} {
  const db = getRedeemDb();
  const page = Math.max(1, Math.floor(Number(params?.page) || 1));
  const limit = Math.max(1, Math.min(100, Math.floor(Number(params?.limit) || 25)));
  const offset = (page - 1) * limit;

  const whereClauses: string[] = [];
  const bindValues: any[] = [];

  const statusFilter = String(params?.status || '').trim().toLowerCase();
  if (statusFilter && statusFilter !== 'all' && ALLOWED_VERIFICATION_STATUSES.has(statusFilter as OcrVerificationStatus)) {
    whereClauses.push('verification_status = ?');
    bindValues.push(statusFilter);
  }

  const txTypeFilter = String(params?.txType || '').trim().toLowerCase();
  if (txTypeFilter === 'document_ocr' || txTypeFilter === 'bank_receipt') {
    whereClauses.push('tx_type = ?');
    bindValues.push(txTypeFilter);
  }

  const modelFilter = String(params?.model || '').trim();
  if (modelFilter && modelFilter !== 'all') {
    whereClauses.push('model_version = ?');
    bindValues.push(modelFilter.slice(0, 64));
  }

  const patternFilter = String(params?.errorPattern || '').trim().toUpperCase();
  if (patternFilter && patternFilter !== 'ALL') {
    whereClauses.push('error_pattern = ?');
    bindValues.push(patternFilter.slice(0, 64));
  }

  const searchFilter = String(params?.search || '').trim();
  if (searchFilter) {
    const likePattern = `%${searchFilter.slice(0, 64)}%`;
    whereClauses.push(
      '(tx_id LIKE ? OR session_hash LIKE ? OR model_version LIKE ? OR error_pattern LIKE ? OR missing_fields_json LIKE ? OR admin_note LIKE ?)'
    );
    bindValues.push(likePattern, likePattern, likePattern, likePattern, likePattern, likePattern);
  }

  const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

  const totalRow = db
    .prepare(`SELECT COUNT(*) as cnt FROM ocr_transactions ${whereSql}`)
    .get(...bindValues) as { cnt: number };
  const total = Number(totalRow?.cnt || 0);

  const rows = db
    .prepare(
      `SELECT * FROM ocr_transactions ${whereSql} ORDER BY id DESC LIMIT ? OFFSET ?`
    )
    .all(...bindValues, limit, offset);

  const items = rows.map(mapOcrTxRow);

  // Global analytics summary across all logged OCR transactions
  const aggRow = db
    .prepare(
      `SELECT
         COUNT(*) as total_count,
         SUM(CASE WHEN tx_type = 'document_ocr' THEN 1 ELSE 0 END) as doc_count,
         SUM(CASE WHEN tx_type = 'bank_receipt' THEN 1 ELSE 0 END) as receipt_count,
         AVG(confidence_score) as avg_conf,
         AVG(latency_ms) as avg_latency,
         SUM(CASE WHEN verification_status = 'verified' THEN 1 ELSE 0 END) as verified_count,
         SUM(CASE WHEN verification_status = 'needs_review' THEN 1 ELSE 0 END) as review_count,
         SUM(CASE WHEN verification_status = 'failed' THEN 1 ELSE 0 END) as failed_count,
         SUM(CASE WHEN verification_status = 'false_positive' THEN 1 ELSE 0 END) as fp_count,
         SUM(CASE WHEN verification_status = 'pending' THEN 1 ELSE 0 END) as pending_count,
         SUM(CASE WHEN fallback_used = 1 THEN 1 ELSE 0 END) as fallback_count
       FROM ocr_transactions`
    )
    .get() as any;

  const totalCount = Number(aggRow?.total_count || 0);
  const verifiedCount = Number(aggRow?.verified_count || 0);

  const modelRows = db
    .prepare(
      `SELECT
         model_version,
         COUNT(*) as total_runs,
         AVG(confidence_score) as avg_conf,
         AVG(latency_ms) as avg_latency,
         SUM(CASE WHEN verification_status = 'verified' THEN 1 ELSE 0 END) as verified_cnt,
         SUM(CASE WHEN verification_status IN ('failed', 'false_positive') THEN 1 ELSE 0 END) as failed_cnt
       FROM ocr_transactions
       GROUP BY model_version
       ORDER BY total_runs DESC`
    )
    .all() as any[];

  const modelBreakdown: OcrModelPerformanceRow[] = modelRows.map((m) => {
    const runs = Number(m.total_runs || 0);
    const vCnt = Number(m.verified_cnt || 0);
    return {
      modelVersion: String(m.model_version || 'unknown'),
      totalRuns: runs,
      avgConfidence: Math.round(Number(m.avg_conf || 0)),
      avgLatencyMs: Math.round(Number(m.avg_latency || 0)),
      verifiedCount: vCnt,
      failedCount: Number(m.failed_cnt || 0),
      passRate: runs > 0 ? Math.round((vCnt / runs) * 100) : 0,
    };
  });

  const patternRows = db
    .prepare(
      `SELECT
         error_pattern,
         COUNT(*) as cnt,
         AVG(confidence_score) as avg_conf
       FROM ocr_transactions
       WHERE error_pattern != 'NONE'
       GROUP BY error_pattern
       ORDER BY cnt DESC
       LIMIT 10`
    )
    .all() as any[];

  const totalPatternErrors = patternRows.reduce((acc, r) => acc + Number(r.cnt || 0), 0);
  const failingPatterns: OcrPatternStatRow[] = patternRows.map((p) => {
    const cnt = Number(p.cnt || 0);
    return {
      pattern: String(p.error_pattern || 'UNKNOWN'),
      count: cnt,
      sharePct: totalPatternErrors > 0 ? Math.round((cnt / totalPatternErrors) * 100) : 0,
      avgConfidence: Math.round(Number(p.avg_conf || 0)),
    };
  });

  // Aggregate top missing field keys across recent 1,000 transactions (zero PII, field keys only)
  const missingRows = db
    .prepare(
      `SELECT missing_fields_json FROM ocr_transactions
       WHERE missing_fields_json != '[]'
       ORDER BY id DESC
       LIMIT 1000`
    )
    .all() as Array<{ missing_fields_json: string }>;

  const missingFreq = new Map<string, number>();
  for (const r of missingRows) {
    for (const fieldKey of safeJsonParseArray(r.missing_fields_json)) {
      missingFreq.set(fieldKey, (missingFreq.get(fieldKey) || 0) + 1);
    }
  }
  const topMissingFields: OcrMissingFieldStatRow[] = Array.from(missingFreq.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([field, count]) => ({ field, count }));

  return {
    items,
    total,
    page,
    limit,
    totalPages: Math.max(1, Math.ceil(total / limit)),
    availableModels: modelBreakdown.map((m) => m.modelVersion),
    summary: {
      totalCount,
      docOcrCount: Number(aggRow?.doc_count || 0),
      receiptOcrCount: Number(aggRow?.receipt_count || 0),
      avgConfidence: Math.round(Number(aggRow?.avg_conf || 0)),
      verifiedCount,
      needsReviewCount: Number(aggRow?.review_count || 0),
      failedCount: Number(aggRow?.failed_count || 0),
      falsePositiveCount: Number(aggRow?.fp_count || 0),
      pendingCount: Number(aggRow?.pending_count || 0),
      fallbackCount: Number(aggRow?.fallback_count || 0),
      avgLatencyMs: Math.round(Number(aggRow?.avg_latency || 0)),
      passRate: totalCount > 0 ? Math.round((verifiedCount / totalCount) * 100) : 0,
      modelBreakdown,
      failingPatterns,
      topMissingFields,
    },
  };
}

export function updateOcrTransactionVerification(
  txId: string,
  verificationStatus: OcrVerificationStatus,
  adminNote?: string
): OcrTransactionRecord | null {
  const cleanTxId = String(txId || '').trim().toUpperCase().slice(0, 32);
  if (!cleanTxId || !ALLOWED_VERIFICATION_STATUSES.has(verificationStatus)) {
    return null;
  }
  const db = getRedeemDb();
  const existing = db
    .prepare('SELECT * FROM ocr_transactions WHERE tx_id = ?')
    .get(cleanTxId) as any;
  if (!existing) return null;

  const cleanNote =
    typeof adminNote === 'string'
      ? adminNote.trim().slice(0, 280)
      : String(existing.admin_note || '');
  const nowIso = new Date().toISOString();

  db.prepare(
    `UPDATE ocr_transactions
     SET verification_status = ?, admin_note = ?, updated_at = ?
     WHERE tx_id = ?`
  ).run(verificationStatus, cleanNote, nowIso, cleanTxId);

  const updated = db
    .prepare('SELECT * FROM ocr_transactions WHERE tx_id = ?')
    .get(cleanTxId);
  return updated ? mapOcrTxRow(updated) : null;
}

export function deleteOcrTransaction(txId: string): boolean {
  const cleanTxId = String(txId || '').trim().toUpperCase().slice(0, 32);
  if (!cleanTxId) return false;
  const db = getRedeemDb();
  const result = db.prepare('DELETE FROM ocr_transactions WHERE tx_id = ?').run(cleanTxId);
  return Number(result.changes || 0) > 0;
}





