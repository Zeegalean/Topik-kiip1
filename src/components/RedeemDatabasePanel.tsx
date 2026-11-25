import React, { useState, useEffect, useCallback } from 'react';
import {
  Database,
  RefreshCw,
  Plus,
  Copy,
  Check,
  Trash2,
  FileSpreadsheet,
  CheckCircle2,
  AlertCircle,
  KeyRound,
  Ban,
  RotateCcw,
  Upload,
  Search,
  ChevronLeft,
  ChevronRight,
  X,
} from 'lucide-react';
import { Language } from '../types';

function parseCsvRowsClient(csvText: string): string[][] {
  // Detect delimiter from first non-empty line (comma, semicolon, or tab)
  const firstLine = csvText.split(/\r?\n/).find((l) => l.trim().length > 0) || '';
  const delimiter =
    firstLine.includes(',')
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

function extractCodesFromCsvText(rawText: string): string[] {
  const cleanText = rawText.replace(/^\uFEFF/, '');
  const parsedRows = parseCsvRowsClient(cleanText);
  if (parsedRows.length === 0) return [];

  const firstRowLower = parsedRows[0].map((c) => c.trim().toLowerCase());
  const isCodeHeader = (c: string) =>
    c.includes('code') ||
    c.includes('redeem') ||
    c.includes('voucher') ||
    c.includes('កូដ') ||
    c.includes('코드');
  const isNonCodeHeader = (c: string) =>
    c === 'no' ||
    c === 'no.' ||
    c === '#' ||
    c === 'id' ||
    c.includes('status') ||
    c.includes('note') ||
    c.includes('ស្ថានភាព') ||
    c.includes('ល.រ');

  const hasHeader = firstRowLower.some((c) => isCodeHeader(c) || isNonCodeHeader(c));
  let codeCol = 0;

  if (hasHeader) {
    const foundCode = firstRowLower.findIndex(isCodeHeader);
    if (foundCode >= 0) {
      codeCol = foundCode;
    } else if (parsedRows.length > 1 && parsedRows[1].length >= 2) {
      const c0 = (parsedRows[1][0] || '').replace(/[^A-Za-z0-9_-]/g, '');
      const c1 = (parsedRows[1][1] || '').replace(/[^A-Za-z0-9_-]/g, '');
      if ((c0.length < 4 || /^\d+$/.test(c0)) && c1.length >= 4) {
        codeCol = 1;
      }
    }
  } else if (parsedRows[0].length >= 2) {
    // Auto-detect if Col A is sequential row index (1, 2, 3...) and Col B holds the Redeem Codes
    const c0 = (parsedRows[0][0] || '').replace(/[^A-Za-z0-9_-]/g, '');
    const c1 = (parsedRows[0][1] || '').replace(/[^A-Za-z0-9_-]/g, '');
    if ((c0.length < 4 || /^\d+$/.test(c0)) && c1.length >= 4) {
      codeCol = 1;
    }
  }

  const dataRows = hasHeader ? parsedRows.slice(1) : parsedRows;
  const extracted: string[] = [];
  for (const r of dataRows) {
    const rawVal = (r[codeCol] || '').trim();
    const cleaned = rawVal.toUpperCase().replace(/[^A-Z0-9_-]/g, '');
    if (cleaned.length >= 4) {
      extracted.push(cleaned);
    }
  }
  return extracted;
}

interface RedeemCodeRow {
  id: number;
  code: string;
  status: 'Unused' | 'Used' | 'Revoked';
  source: string;
  note: string;
  assigned_to: string;
  created_at: string;
  used_at: string | null;
}

interface RedeemStats {
  total: number;
  unusedCount: number;
  usedCount: number;
  revokedCount: number;
  databasePath: string;
  googleSheetConfigured: boolean;
  googleSheetSource?: 'env' | 'saved' | 'none';
  savedSheetId?: string;
  savedSheetName?: string;
  lastSyncAt?: string | null;
  lastRowsRead?: number;
  lastSyncError?: string | null;
}

interface RedeemDatabasePanelProps {
  adminToken: string | null;
  lang?: Language;
}

export const RedeemDatabasePanel: React.FC<RedeemDatabasePanelProps> = ({
  adminToken,
  lang = 'km',
}) => {
  const isKm = lang === 'km';
  const [rows, setRows] = useState<RedeemCodeRow[]>([]);
  const [stats, setStats] = useState<RedeemStats>({
    total: 0,
    unusedCount: 0,
    usedCount: 0,
    revokedCount: 0,
    databasePath: 'data/redeem_codes.sqlite',
    googleSheetConfigured: false,
    googleSheetSource: 'none',
    savedSheetId: '',
    savedSheetName: '',
    lastSyncAt: null,
    lastRowsRead: 0,
    lastSyncError: null,
  });
  const [statusFilter, setStatusFilter] = useState<'all' | 'Unused' | 'Used' | 'Revoked'>('all');
  const [searchInput, setSearchInput] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(100);
  const [pagination, setPagination] = useState({
    page: 1,
    pageSize: 100,
    totalMatched: 0,
    totalPages: 1,
  });
  const [loading, setLoading] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  // Generate Batch Form
  const [genCount, setGenCount] = useState(10);
  const [genPrefix, setGenPrefix] = useState('KIIP-26');
  const [genNote, setGenNote] = useState('Pre-seeded Unused Pool');
  const [generating, setGenerating] = useState(false);

  // Manual Import Form
  const [manualText, setManualText] = useState('');
  const [addingManual, setAddingManual] = useState(false);

  // Google Sheets Sync Form (accepts full URL or Sheet ID; Tab Name is optional)
  const [sheetId, setSheetId] = useState('');
  const [sheetName, setSheetName] = useState('');
  const [syncingSheets, setSyncingSheets] = useState(false);

  // Read-only Code Diagnostic Checker (does not burn codes)
  const [testCodeInput, setTestCodeInput] = useState('');
  const [testingCode, setTestingCode] = useState(false);
  const [testCodeResult, setTestCodeResult] = useState<{
    found: boolean;
    normalizedInput: string;
    record?: RedeemCodeRow;
  } | null>(null);

  // Debounce search input
  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedSearch(searchInput.trim());
      setPage(1);
    }, 250);
    return () => clearTimeout(t);
  }, [searchInput]);

  const fetchRedeemDb = useCallback(async () => {
    if (!adminToken) return;
    setLoading(true);
    try {
      const qs = new URLSearchParams({
        status: statusFilter,
        page: String(page),
        pageSize: String(pageSize),
      });
      if (debouncedSearch) {
        qs.set('search', debouncedSearch);
      }
      const resp = await fetch(`/api/admin/redeem-codes?${qs.toString()}`, {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      const json = await resp.json();
      if (resp.ok && json?.success) {
        setRows(Array.isArray(json.codes) ? json.codes : []);
        if (json.stats) setStats(json.stats);
        if (json.pagination) {
          setPagination(json.pagination);
        }
      } else {
        setFeedback({ type: 'error', text: json?.error || 'Failed to load redeem database' });
      }
    } catch {
      setFeedback({ type: 'error', text: isKm ? 'មិនអាចតភ្ជាប់ទៅ Backend Database បានទេ។' : 'Unable to connect to Backend Database.' });
    } finally {
      setLoading(false);
    }
  }, [adminToken, statusFilter, page, pageSize, debouncedSearch, isKm]);

  useEffect(() => {
    fetchRedeemDb();
  }, [fetchRedeemDb]);

  const handleGenerateBatch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!adminToken) return;
    setGenerating(true);
    setFeedback(null);
    try {
      const resp = await fetch('/api/admin/redeem-codes/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({ count: genCount, prefix: genPrefix, note: genNote }),
      });
      const json = await resp.json();
      if (resp.ok && json?.success) {
        setFeedback({
          type: 'success',
          text: isKm
            ? `✓ បានបង្កើតលេខកូដថ្មី ${json.createdCount} កូដ (ស្ថានភាព 'Unused') ចូលក្នុង Database រួចរាល់!`
            : `✓ Generated ${json.createdCount} new 'Unused' redeem codes in the database.`,
        });
        await fetchRedeemDb();
      } else {
        setFeedback({ type: 'error', text: json?.error || 'Generation failed' });
      }
    } catch {
      setFeedback({ type: 'error', text: 'Network error while generating codes' });
    } finally {
      setGenerating(false);
    }
  };

  const handleManualAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!adminToken || !manualText.trim()) return;
    setAddingManual(true);
    setFeedback(null);
    try {
      const resp = await fetch('/api/admin/redeem-codes/add', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({ codesText: manualText, note: 'Manual Admin Entry' }),
      });
      const json = await resp.json();
      if (resp.ok && json?.success) {
        setManualText('');
        setFeedback({
          type: 'success',
          text: isKm
            ? `✓ បានបញ្ចូល ${json.added} កូដថ្មី (ស្ថានភាព 'Unused') · រំលងកូដជាន់គ្នា ${json.skipped}`
            : `✓ Added ${json.added} 'Unused' codes (skipped ${json.skipped} duplicates/invalid).`,
        });
        await fetchRedeemDb();
      } else {
        setFeedback({ type: 'error', text: json?.error || 'Failed to add codes' });
      }
    } catch {
      setFeedback({ type: 'error', text: 'Network error while adding codes' });
    } finally {
      setAddingManual(false);
    }
  };

  const handleSyncSheets = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!adminToken) return;
    setSyncingSheets(true);
    setFeedback(null);
    try {
      const resp = await fetch('/api/admin/redeem-codes/sync-sheets', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({
          sheetId: sheetId.trim() || undefined,
          sheetName: sheetName.trim() || undefined,
        }),
      });
      const json = await resp.json();
      if (resp.ok && json?.success) {
        const colInfo = json.detectedColumnLabel ? ` [${json.detectedColumnLabel}]` : '';
        const sampleInfo =
          Array.isArray(json.sampleCodes) && json.sampleCodes.length > 0
            ? ` · ឧទាហរណ៍: ${json.sampleCodes.slice(0, 3).join(', ')}`
            : '';
        setFeedback({
          type: 'success',
          text: isKm
            ? `✓ អានពី Google Sheets (${json.sheetName}${colInfo}) បាន ${Number(json.rowsRead || 0).toLocaleString()} ជួរ · បញ្ចូលថ្មី ${Number(json.imported || 0).toLocaleString()} កូដ · រំលង ${Number(json.skipped || 0).toLocaleString()}${sampleInfo}`
            : `✓ Read ${Number(json.rowsRead || 0).toLocaleString()} rows from Google Sheet "${json.sheetName}"${colInfo} · Imported ${Number(json.imported || 0).toLocaleString()} new codes (skipped ${Number(json.skipped || 0).toLocaleString()})${sampleInfo}`,
        });
        setPage(1);
        await fetchRedeemDb();
      } else {
        setFeedback({ type: 'error', text: json?.error || 'Google Sheets sync failed' });
      }
    } catch {
      setFeedback({ type: 'error', text: 'Network error while reading Google Sheets' });
    } finally {
      setSyncingSheets(false);
    }
  };

  const handleTestCheckCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!adminToken || !testCodeInput.trim()) return;
    setTestingCode(true);
    setTestCodeResult(null);
    try {
      const resp = await fetch(
        `/api/admin/redeem-codes/check?code=${encodeURIComponent(testCodeInput.trim())}`,
        { headers: { Authorization: `Bearer ${adminToken}` } }
      );
      const json = await resp.json();
      if (resp.ok && json?.success) {
        setTestCodeResult({
          found: Boolean(json.found),
          normalizedInput: String(json.normalizedInput || ''),
          record: json.record,
        });
      }
    } catch {
      // ignore
    } finally {
      setTestingCode(false);
    }
  };

  const handleImportCsvFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !adminToken) return;
    setSyncingSheets(true);
    setFeedback(null);
    try {
      const rawText = await file.text();
      const codes = extractCodesFromCsvText(rawText);

      if (codes.length === 0) {
        setFeedback({
          type: 'error',
          text: isKm
            ? 'មិនឃើញលេខកូដត្រឹមត្រូវក្នុងឯកសារ CSV ទេ (លេខកូដនីមួយៗត្រូវមានយ៉ាងតិច ៤ តួអក្សរ)។'
            : 'No valid codes found in the uploaded CSV file (each code must be at least 4 characters).',
        });
        return;
      }

      const resp = await fetch('/api/admin/redeem-codes/add', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({
          codes,
          note: `CSV: ${file.name.slice(0, 60)}`,
        }),
      });
      const json = await resp.json();
      if (resp.ok && json?.success) {
        const addedStr = Number(json.added || 0).toLocaleString();
        const skippedStr = Number(json.skipped || 0).toLocaleString();
        const parsedStr = codes.length.toLocaleString();
        setFeedback({
          type: 'success',
          text: isKm
            ? `✓ អានពី ${file.name} បាន ${parsedStr} ជួរ · បញ្ចូលថ្មី ${addedStr} កូដ (ស្ថានភាព 'Unused') · រំលងកូដជាន់គ្នា ${skippedStr}`
            : `✓ Read ${parsedStr} codes from ${file.name} · Imported ${addedStr} new 'Unused' codes (skipped ${skippedStr} duplicates).`,
        });
        setPage(1);
        await fetchRedeemDb();
      } else {
        setFeedback({ type: 'error', text: json?.error || 'CSV import failed' });
      }
    } catch {
      setFeedback({ type: 'error', text: isKm ? 'មិនអាចអានឯកសារ CSV បានទេ។' : 'Failed to read CSV file.' });
    } finally {
      setSyncingSheets(false);
    }
  };

  const handleUpdateStatus = async (code: string, status: 'Unused' | 'Used' | 'Revoked') => {
    if (!adminToken) return;
    try {
      const resp = await fetch(`/api/admin/redeem-codes/${encodeURIComponent(code)}/status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({ status }),
      });
      if (resp.ok) {
        await fetchRedeemDb();
      }
    } catch {
      // ignore
    }
  };

  const handleDelete = async (code: string) => {
    if (!adminToken) return;
    try {
      const resp = await fetch(`/api/admin/redeem-codes/${encodeURIComponent(code)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      if (resp.ok) {
        await fetchRedeemDb();
      }
    } catch {
      // ignore
    }
  };

  if (!adminToken) {
    return (
      <div className="p-6 bg-amber-50 border border-amber-200 rounded-2xl text-xs text-amber-900 font-semibold">
        {isKm
          ? 'សូមចូលប្រើដោយ Admin ID & Password ដើម្បីគ្រប់គ្រង Backend SQLite Database & Google Sheets Redeem Codes។'
          : 'Please log in with Admin ID & Password to manage the Backend SQLite Database & Google Sheets Redeem Codes.'}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Header Stats Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs">
          <p className="text-[11px] font-bold text-slate-500 uppercase">
            {isKm ? 'លេខកូដសរុប (Total DB)' : 'Total Codes'}
          </p>
          <p className="text-2xl font-black text-slate-900 mt-1 tabular-nums">{stats.total.toLocaleString()}</p>
          <p className="text-[10px] text-slate-400 font-mono mt-0.5 truncate">{stats.databasePath}</p>
        </div>

        <div className="bg-emerald-50 p-4 rounded-2xl border border-emerald-200 shadow-xs">
          <p className="text-[11px] font-bold text-emerald-700 uppercase">
            {isKm ? 'មិនទាន់ប្រើ (Unused)' : 'Unused (Available)'}
          </p>
          <p className="text-2xl font-black text-emerald-800 mt-1 tabular-nums">{stats.unusedCount.toLocaleString()}</p>
          <p className="text-[10px] text-emerald-600 mt-0.5">
            {isKm ? 'រួចរាល់សម្រាប់ចែកជូនអ្នកប្រើ' : 'Ready for auto-unlock / users'}
          </p>
        </div>

        <div className="bg-sky-50 p-4 rounded-2xl border border-sky-200 shadow-xs">
          <p className="text-[11px] font-bold text-sky-700 uppercase">
            {isKm ? 'ប្រើរួចហើយ (Used)' : 'Used (Redeemed)'}
          </p>
          <p className="text-2xl font-black text-sky-900 mt-1 tabular-nums">{stats.usedCount.toLocaleString()}</p>
          <p className="text-[10px] text-sky-600 mt-0.5">
            {isKm ? 'បានដោះសោ PDF រួចរាល់' : 'Claimed & burned'}
          </p>
        </div>

        <div className="bg-rose-50 p-4 rounded-2xl border border-rose-200 shadow-xs">
          <p className="text-[11px] font-bold text-rose-700 uppercase">
            {isKm ? 'បានផ្អាក (Revoked)' : 'Revoked'}
          </p>
          <p className="text-2xl font-black text-rose-800 mt-1 tabular-nums">{stats.revokedCount.toLocaleString()}</p>
          <p className="text-[10px] text-rose-600 mt-0.5">
            {stats.googleSheetConfigured ? 'Google Sheet Env: Active' : 'SQLite + CSV (Up to 50,000)'}
          </p>
        </div>
      </div>

      {feedback && (
        <div
          className={`p-3 rounded-2xl border text-xs font-bold flex items-center gap-2 ${
            feedback.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : 'bg-rose-50 border-rose-200 text-rose-800'
          }`}
        >
          {feedback.type === 'success' ? (
            <CheckCircle2 className="w-4 h-4 shrink-0" />
          ) : (
            <AlertCircle className="w-4 h-4 shrink-0" />
          )}
          <span>{feedback.text}</span>
        </div>
      )}

      {/* Action Forms: Generate Unused Batch + Google Sheets Reader */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Form 1: Generate New 'Unused' Codes */}
        <form onSubmit={handleGenerateBatch} className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs space-y-3">
          <div className="flex items-center gap-2">
            <KeyRound className="w-4 h-4 text-indigo-600" />
            <h4 className="text-xs sm:text-sm font-black text-slate-900">
              {isKm ? 'បង្កើតលេខកូដ Redeem Code ថ្មី (ស្ថានភាព Unused)' : "Generate New 'Unused' Redeem Codes"}
            </h4>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="text-[11px] font-bold text-slate-600 block mb-1">
                {isKm ? 'ចំនួន' : 'Count'}
              </label>
              <input
                type="number"
                min={1}
                max={500}
                value={genCount}
                onChange={(e) => setGenCount(Number(e.target.value) || 1)}
                className="w-full px-2.5 py-2 border border-slate-300 rounded-xl text-xs font-bold"
              />
            </div>
            <div>
              <label className="text-[11px] font-bold text-slate-600 block mb-1">Prefix</label>
              <input
                type="text"
                value={genPrefix}
                onChange={(e) => setGenPrefix(e.target.value.toUpperCase())}
                placeholder="KIIP-26"
                className="w-full px-2.5 py-2 border border-slate-300 rounded-xl text-xs font-mono font-bold uppercase"
              />
            </div>
            <div>
              <label className="text-[11px] font-bold text-slate-600 block mb-1">
                {isKm ? 'សម្គាល់ (Note)' : 'Note'}
              </label>
              <input
                type="text"
                value={genNote}
                onChange={(e) => setGenNote(e.target.value)}
                className="w-full px-2.5 py-2 border border-slate-300 rounded-xl text-xs"
              />
            </div>
          </div>
          <button
            type="submit"
            disabled={generating}
            className="w-full py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
          >
            {generating ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
            <span>{isKm ? `បង្កើត ${genCount} កូដ ('Unused')` : `Generate ${genCount} 'Unused' Codes`}</span>
          </button>
        </form>

        {/* Form 2: Connect & Read from Google Sheets */}
        <form onSubmit={handleSyncSheets} className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs space-y-3">
          <div className="flex items-center gap-2">
            <FileSpreadsheet className="w-4 h-4 text-emerald-600" />
            <h4 className="text-xs sm:text-sm font-black text-slate-900">
              {isKm ? 'តភ្ជាប់ និងអានកូដពី Google Sheets' : 'Connect & Read from Google Sheets'}
            </h4>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <div className="sm:col-span-2">
              <label className="text-[11px] font-bold text-slate-600 block mb-1">
                {isKm ? 'Link Google Sheet ឬ Sheet ID' : 'Google Sheet URL or ID'}{' '}
                {stats.googleSheetConfigured
                  ? stats.googleSheetSource === 'saved'
                    ? '(Saved · Auto-Sync Active)'
                    : '(Env Secret Active)'
                  : ''}
              </label>
              <input
                type="text"
                value={sheetId}
                onChange={(e) => setSheetId(e.target.value)}
                placeholder={
                  stats.savedSheetId
                    ? `Saved: ${stats.savedSheetId.slice(0, 46)}${stats.savedSheetId.length > 46 ? '...' : ''}`
                    : stats.googleSheetConfigured
                    ? 'Using GOOGLE_SHEET_ID secret...'
                    : 'https://docs.google.com/spreadsheets/d/... ឬ Sheet ID'
                }
                className="w-full px-2.5 py-2 border border-slate-300 rounded-xl text-xs font-mono"
              />
            </div>
            <div>
              <label className="text-[11px] font-bold text-slate-600 block mb-1">
                {isKm ? 'ឈ្មោះ Tab (មិនបាច់ដាក់ក៏បាន)' : 'Tab Name (Optional)'}
              </label>
              <input
                type="text"
                value={sheetName}
                onChange={(e) => setSheetName(e.target.value)}
                placeholder={stats.savedSheetName || (isKm ? 'ស្វ័យប្រវត្តិ (Tab 1)' : 'Auto (First Tab)')}
                className="w-full px-2.5 py-2 border border-slate-300 rounded-xl text-xs"
              />
            </div>
          </div>
          {stats.googleSheetConfigured ? (
            <p className="text-[10.5px] text-emerald-700 font-semibold">
              {isKm
                ? `✓ Google Sheet ភ្ជាប់រួចរាល់ (${stats.lastRowsRead ? `${stats.lastRowsRead.toLocaleString()} ជួរ` : 'Auto-Sync Active'}${stats.lastSyncAt ? ` · ${new Date(stats.lastSyncAt).toLocaleString()}` : ''}) — ប្រព័ន្ធនឹង Sync ដោយស្វ័យប្រវត្តិពេលផ្ទៀងផ្ទាត់កូដ។`
                : `✓ Connected Google Sheet (${stats.lastRowsRead ? `${stats.lastRowsRead.toLocaleString()} rows` : 'Auto-Sync Active'}${stats.lastSyncAt ? ` · ${new Date(stats.lastSyncAt).toLocaleString()}` : ''}) — auto-syncs on startup & code lookup.`}
            </p>
          ) : (
            <p className="text-[10.5px] text-slate-500">
              {isKm
                ? 'អាច Paste Link Google Sheet ទាំងមូល (រួមទាំង /u/0/) ឬ Sheet ID។ សូមបើក Share → "Anyone with the link (Viewer)"។ ទុក Tab ទទេដើម្បីអាន Tab ទី ១ ដោយស្វ័យប្រវត្តិ។'
                : 'Paste a full Google Sheet URL (including /u/0/), Published URL, or Sheet ID. Set Share → "Anyone with the link (Viewer)". Leave Tab blank to auto-read the first tab.'}
            </p>
          )}
          {stats.lastSyncError && (
            <p className="text-[10.5px] text-rose-700 font-semibold">{stats.lastSyncError}</p>
          )}
          <div className="flex flex-col sm:flex-row gap-2">
            <button
              type="submit"
              disabled={syncingSheets}
              className="flex-1 py-2.5 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
            >
              {syncingSheets ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <FileSpreadsheet className="w-3.5 h-3.5" />}
              <span>{isKm ? 'អាន & ទាញកូដពី Google Sheets' : 'Read & Import from Google Sheets'}</span>
            </button>
            <label className="py-2.5 px-3 rounded-xl bg-slate-100 hover:bg-slate-200 border border-slate-300 text-slate-800 font-bold text-xs flex items-center justify-center gap-1.5 cursor-pointer whitespace-nowrap">
              <Upload className="w-3.5 h-3.5 text-slate-600" />
              <span>{isKm ? 'Upload .CSV' : 'Upload .CSV'}</span>
              <input
                type="file"
                accept=".csv,.txt,text/csv"
                onChange={handleImportCsvFile}
                disabled={syncingSheets}
                className="hidden"
              />
            </label>
          </div>
        </form>
      </div>

      {/* Quick Bulk Manual Paste + Read-Only Code Diagnostic Test */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <form onSubmit={handleManualAdd} className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs flex flex-col sm:flex-row gap-2">
          <input
            type="text"
            value={manualText}
            onChange={(e) => setManualText(e.target.value)}
            placeholder={
              isKm
                ? 'បញ្ចូលកូដផ្ទាល់ខ្លួនបំបែកដោយសញ្ញាក្បៀស (ឧ. KIIP-VIP-001)...'
                : 'Paste custom codes separated by commas (e.g. KIIP-VIP-001)...'
            }
            className="flex-1 px-3 py-2 border border-slate-300 rounded-xl text-xs font-mono uppercase"
          />
          <button
            type="submit"
            disabled={addingManual || !manualText.trim()}
            className="px-4 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs cursor-pointer disabled:opacity-50 shrink-0 whitespace-nowrap"
          >
            {isKm ? "+ បន្ថែមជា 'Unused'" : "+ Add as 'Unused'"}
          </button>
        </form>

        <form onSubmit={handleTestCheckCode} className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs space-y-2">
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              type="text"
              value={testCodeInput}
              onChange={(e) => setTestCodeInput(e.target.value.toUpperCase())}
              placeholder={
                isKm
                  ? 'សាកល្បងពិនិត្យកូដ (មិនកាត់ប្រើ) ឧ. កូដពី Google Sheet...'
                  : 'Test-check any code from Sheet (does not burn)...'
              }
              className="flex-1 px-3 py-2 border border-slate-300 rounded-xl text-xs font-mono uppercase"
            />
            <button
              type="submit"
              disabled={testingCode || !testCodeInput.trim()}
              className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs cursor-pointer disabled:opacity-50 shrink-0 whitespace-nowrap"
            >
              {isKm ? 'ពិនិត្យកូដ (Test)' : 'Test Code'}
            </button>
          </div>
          {testCodeResult && (
            <div
              className={`text-[11px] font-semibold ${
                testCodeResult.found && testCodeResult.record?.status === 'Unused'
                  ? 'text-emerald-700'
                  : testCodeResult.found
                  ? 'text-amber-700'
                  : 'text-rose-700'
              }`}
            >
              {testCodeResult.found && testCodeResult.record
                ? isKm
                  ? `✓ រកឃើញកូដ ${testCodeResult.record.code} · ស្ថានភាព: ${testCodeResult.record.status} · ប្រភព: ${testCodeResult.record.source}`
                  : `✓ Found ${testCodeResult.record.code} · Status: ${testCodeResult.record.status} · Source: ${testCodeResult.record.source}`
                : isKm
                ? `✕ រកមិនឃើញ "${testCodeResult.normalizedInput}" ក្នុង Database ទេ — សូមចុច "អាន & ទាញកូដពី Google Sheets" ឬ Upload .CSV ជាមុនសិន។`
                : `✕ "${testCodeResult.normalizedInput}" not found in DB — click "Read & Import from Google Sheets" or Upload .CSV first.`}
            </div>
          )}
        </form>
      </div>

      {/* Redeem Codes Table */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="p-3.5 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2.5 bg-slate-50">
          <div className="flex items-center gap-2">
            <Database className="w-4 h-4 text-indigo-600" />
            <h4 className="text-xs sm:text-sm font-black text-slate-900">
              {isKm ? 'បញ្ជីលេខកូដ Redeem Codes ក្នុង Database' : 'Redeem Codes Database Table'}
            </h4>
            <span className="text-[11px] font-bold text-slate-500 tabular-nums">
              ({pagination.totalMatched.toLocaleString()})
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {/* Search Box */}
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder={isKm ? 'ស្វែងរកលេខកូដ...' : 'Search code / note...'}
                className="pl-8 pr-7 py-1.5 w-44 sm:w-52 rounded-lg bg-white border border-slate-200 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-400"
              />
              {searchInput && (
                <button
                  type="button"
                  onClick={() => setSearchInput('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 cursor-pointer"
                  title="Clear search"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            <div className="flex items-center gap-1">
              {(['all', 'Unused', 'Used', 'Revoked'] as const).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => {
                    setStatusFilter(tab);
                    setPage(1);
                  }}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-bold cursor-pointer transition-colors ${
                    statusFilter === tab
                      ? 'bg-indigo-600 text-white'
                      : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  {tab === 'all' ? (isKm ? 'ទាំងអស់' : 'All') : tab}
                </button>
              ))}
              <button
                type="button"
                onClick={fetchRedeemDb}
                disabled={loading}
                className="p-1.5 rounded-lg bg-white border border-slate-200 text-slate-600 hover:bg-slate-100 cursor-pointer"
                title="Refresh"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              </button>
            </div>
          </div>
        </div>

        <div className="overflow-x-auto max-h-[380px]">
          <table className="w-full text-left border-collapse text-xs">
            <thead className="sticky top-0 bg-slate-50 border-b border-slate-200 text-slate-500 font-bold">
              <tr>
                <th className="p-3">Redeem Code</th>
                <th className="p-3">Status</th>
                <th className="p-3">Source</th>
                <th className="p-3">Assigned / Note</th>
                <th className="p-3">Used At</th>
                <th className="p-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="p-6 text-center text-slate-400">
                    {loading
                      ? isKm
                        ? 'កំពុងអានទិន្នន័យពី Database...'
                        : 'Loading database...'
                      : isKm
                      ? 'មិនមានលេខកូដក្នុងតម្រងនេះទេ។'
                      : 'No codes found in this filter.'}
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr key={r.id} className="hover:bg-slate-50/80">
                    <td className="p-3 font-mono font-black text-slate-900 flex items-center gap-1.5">
                      <span>{r.code}</span>
                      <button
                        type="button"
                        onClick={() => {
                          navigator.clipboard.writeText(r.code);
                          setCopiedCode(r.code);
                          setTimeout(() => setCopiedCode(null), 1500);
                        }}
                        className="p-1 rounded hover:bg-slate-200 text-slate-400 hover:text-slate-800 cursor-pointer"
                        title="Copy Code"
                      >
                        {copiedCode === r.code ? (
                          <Check className="w-3.5 h-3.5 text-emerald-600" />
                        ) : (
                          <Copy className="w-3.5 h-3.5" />
                        )}
                      </button>
                    </td>
                    <td className="p-3">
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-black border ${
                          r.status === 'Unused'
                            ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                            : r.status === 'Used'
                            ? 'bg-sky-50 text-sky-700 border-sky-200'
                            : 'bg-rose-50 text-rose-700 border-rose-200'
                        }`}
                      >
                        {r.status}
                      </span>
                    </td>
                    <td className="p-3 text-slate-600 font-medium">{r.source}</td>
                    <td className="p-3 text-slate-600">
                      <div className="truncate max-w-[200px]" title={r.note}>
                        {r.assigned_to ? <span className="font-bold text-indigo-700 mr-1">{r.assigned_to} ·</span> : null}
                        {r.note || '-'}
                      </div>
                    </td>
                    <td className="p-3 text-slate-500 tabular-nums">
                      {r.used_at ? new Date(r.used_at).toLocaleString() : '-'}
                    </td>
                    <td className="p-3 text-right">
                      <div className="inline-flex items-center gap-1">
                        {r.status !== 'Unused' ? (
                          <button
                            type="button"
                            onClick={() => handleUpdateStatus(r.code, 'Unused')}
                            className="p-1 rounded hover:bg-emerald-50 text-emerald-600 cursor-pointer"
                            title="Reset to Unused"
                          >
                            <RotateCcw className="w-3.5 h-3.5" />
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => handleUpdateStatus(r.code, 'Revoked')}
                            className="p-1 rounded hover:bg-amber-50 text-amber-600 cursor-pointer"
                            title="Revoke Code"
                          >
                            <Ban className="w-3.5 h-3.5" />
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => handleDelete(r.code)}
                          className="p-1 rounded hover:bg-rose-50 text-rose-500 cursor-pointer"
                          title="Delete Code"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Footer Bar */}
        <div className="px-3.5 py-2.5 border-t border-slate-200 bg-slate-50 flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="text-slate-600 font-semibold tabular-nums">
            {pagination.totalMatched === 0 ? (
              isKm ? 'គ្មានទិន្នន័យ (0 កូដ)' : 'Showing 0 codes'
            ) : (
              <>
                {isKm ? 'បង្ហាញ' : 'Showing'}{' '}
                <span className="font-black text-slate-900">
                  {((pagination.page - 1) * pagination.pageSize + 1).toLocaleString()}–
                  {Math.min(pagination.page * pagination.pageSize, pagination.totalMatched).toLocaleString()}
                </span>{' '}
                {isKm ? 'នៃ' : 'of'}{' '}
                <span className="font-black text-slate-900">{pagination.totalMatched.toLocaleString()}</span>{' '}
                {isKm ? 'កូដ' : 'codes'}
              </>
            )}
          </div>

          <div className="flex items-center gap-2">
            <select
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value) || 100);
                setPage(1);
              }}
              className="px-2 py-1 rounded-lg bg-white border border-slate-200 text-[11px] font-bold text-slate-700 cursor-pointer"
              aria-label="Rows per page"
            >
              <option value={100}>100 / {isKm ? 'ទំព័រ' : 'page'}</option>
              <option value={250}>250 / {isKm ? 'ទំព័រ' : 'page'}</option>
              <option value={500}>500 / {isKm ? 'ទំព័រ' : 'page'}</option>
            </select>

            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={loading || pagination.page <= 1}
                className="px-2 py-1 rounded-lg bg-white border border-slate-200 text-slate-700 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer flex items-center gap-0.5 font-bold text-[11px]"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
                <span>{isKm ? 'មុន' : 'Prev'}</span>
              </button>
              <span className="px-2.5 py-1 text-[11px] font-black text-slate-700 tabular-nums">
                {isKm ? 'ទំព័រ' : 'Page'} {pagination.page.toLocaleString()} / {pagination.totalPages.toLocaleString()}
              </span>
              <button
                type="button"
                onClick={() => setPage((p) => Math.min(pagination.totalPages, p + 1))}
                disabled={loading || pagination.page >= pagination.totalPages}
                className="px-2 py-1 rounded-lg bg-white border border-slate-200 text-slate-700 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer flex items-center gap-0.5 font-bold text-[11px]"
              >
                <span>{isKm ? 'បន្ទាប់' : 'Next'}</span>
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
