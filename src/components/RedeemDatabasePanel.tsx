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
  Lock,
  Unlock,
  BadgeCheck,
  Cloud,
} from 'lucide-react';
import { doc, setDoc, deleteDoc, serverTimestamp } from 'firebase/firestore';
import { db, OperationType, handleFirestoreError } from '../utils/firebase';
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
  is_paid: boolean;
  source: string;
  note: string;
  assigned_to: string;
  created_at: string;
  used_at: string | null;
}

interface RedeemStats {
  total: number;
  unusedCount: number;
  paidUnusedCount: number;
  unpaidUnusedCount: number;
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
  isFirebaseRootAdmin?: boolean;
  lang?: Language;
}

const VALID_FIRESTORE_CODE_RE = /^[A-Z0-9_-]{4,64}$/;

export const RedeemDatabasePanel: React.FC<RedeemDatabasePanelProps> = ({
  adminToken,
  isFirebaseRootAdmin = false,
  lang = 'km',
}) => {
  const isKm = lang === 'km';
  const [rows, setRows] = useState<RedeemCodeRow[]>([]);
  const [stats, setStats] = useState<RedeemStats>({
    total: 0,
    unusedCount: 0,
    paidUnusedCount: 0,
    unpaidUnusedCount: 0,
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
  const [statusFilter, setStatusFilter] = useState<'all' | 'Unused' | 'Paid' | 'Unpaid' | 'Used' | 'Revoked'>('all');
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

  // Issue 1 Paid Code from Google Sheet Form
  const [issueCustomer, setIssueCustomer] = useState('');
  const [issueNote, setIssueNote] = useState('ABA / Korea Bank Confirmed');
  const [issuingPaid, setIssuingPaid] = useState(false);
  const [lastIssuedPaid, setLastIssuedPaid] = useState<RedeemCodeRow | null>(null);

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

  const mirrorRedeemCodeToFirestore = useCallback(
    async (item: {
      code: string;
      status: 'Unused' | 'Used' | 'Revoked';
      is_paid: boolean;
      source?: string;
      note?: string;
      assigned_to?: string;
    }) => {
      if (!isFirebaseRootAdmin) return;
      const codeId = String(item.code || '').trim().toUpperCase();
      if (!VALID_FIRESTORE_CODE_RE.test(codeId)) return;
      try {
        await setDoc(doc(db, 'redeemCodes', codeId), {
          id: codeId,
          code: codeId,
          status: item.status,
          isPaid: Boolean(item.is_paid),
          source: String(item.source || 'admin').slice(0, 32) || 'admin',
          note: String(item.note || '').slice(0, 200),
          assignedTo: String(item.assigned_to || '').slice(0, 120),
          updatedAt: serverTimestamp(),
        });
      } catch (err) {
        try {
          handleFirestoreError(err, OperationType.WRITE, `redeemCodes/${codeId}`);
        } catch {
          // Non-blocking audit log
        }
      }
    },
    [isFirebaseRootAdmin]
  );

  const deleteRedeemCodeFromFirestore = useCallback(
    async (code: string) => {
      if (!isFirebaseRootAdmin) return;
      const codeId = String(code || '').trim().toUpperCase();
      if (!VALID_FIRESTORE_CODE_RE.test(codeId)) return;
      try {
        await deleteDoc(doc(db, 'redeemCodes', codeId));
      } catch (err) {
        try {
          handleFirestoreError(err, OperationType.DELETE, `redeemCodes/${codeId}`);
        } catch {
          // Non-blocking audit log
        }
      }
    },
    [isFirebaseRootAdmin]
  );

  const handleIssueNextPaidCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!adminToken) return;
    setIssuingPaid(true);
    setFeedback(null);
    try {
      const resp = await fetch('/api/admin/redeem-codes/issue-paid', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({
          assignedTo: issueCustomer.trim() || 'paid_customer',
          note: issueNote.trim() || 'Admin Payment Confirmed',
        }),
      });
      const json = await resp.json();
      if (resp.ok && json?.success && json.record) {
        const rec: RedeemCodeRow = json.record;
        setLastIssuedPaid(rec);
        setIssueCustomer('');
        await mirrorRedeemCodeToFirestore(rec);
        try {
          navigator.clipboard.writeText(rec.code);
          setCopiedCode(rec.code);
          setTimeout(() => setCopiedCode(null), 2500);
        } catch {}
        setFeedback({
          type: 'success',
          text: isKm
            ? `✓ បានបញ្ជាក់បង់ប្រាក់ & ដកកូដ ${rec.code} (${rec.source}) រួចរាល់ (បានចម្លងរួច)! អាចផ្ញើឱ្យអតិថិជនដោះសោបានភ្លាមៗ។`
            : `✓ Issued & marked Paid: ${rec.code} (${rec.source}) — copied to clipboard! Ready for customer unlock.`,
        });
        await fetchRedeemDb();
      } else {
        setFeedback({ type: 'error', text: json?.error || 'Failed to issue paid code' });
      }
    } catch {
      setFeedback({ type: 'error', text: 'Network error while issuing paid code' });
    } finally {
      setIssuingPaid(false);
    }
  };

  const handleTogglePaid = async (row: RedeemCodeRow) => {
    if (!adminToken) return;
    const nextPaid = !row.is_paid;
    try {
      const resp = await fetch(`/api/admin/redeem-codes/${encodeURIComponent(row.code)}/paid`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({
          isPaid: nextPaid,
          assignedTo: nextPaid ? row.assigned_to || 'admin_confirmed' : '',
          note: nextPaid ? row.note || 'Admin Payment Confirmed' : row.note,
        }),
      });
      const json = await resp.json().catch(() => ({}));
      if (resp.ok && json?.success) {
        await mirrorRedeemCodeToFirestore(
          json.record || {
            code: row.code,
            status: row.status,
            is_paid: nextPaid,
            source: row.source,
            note: row.note,
            assigned_to: nextPaid ? row.assigned_to || 'admin_confirmed' : '',
          }
        );
        setFeedback({
          type: 'success',
          text: nextPaid
            ? isKm
              ? `✓ បានបើកសិទ្ធិ Paid សម្រាប់កូដ ${row.code} — អតិថិជនអាចប្រើដោះសោបានហើយ!`
              : `✓ Marked ${row.code} as Paid — ready for customer unlock!`
            : isKm
            ? `🔒 បានប្តូរកូដ ${row.code} ទៅ Unpaid (ចាក់សោតម្រូវឱ្យបង់ប្រាក់)`
            : `🔒 Marked ${row.code} as Unpaid (locked until payment).`,
        });
        await fetchRedeemDb();
      }
    } catch {
      // ignore
    }
  };

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
        if (isFirebaseRootAdmin && Array.isArray(json.created)) {
          await Promise.all(
            json.created.slice(0, 50).map((item: RedeemCodeRow) => mirrorRedeemCodeToFirestore(item))
          );
        }
        setFeedback({
          type: 'success',
          text: isKm
            ? `✓ បានបង្កើតលេខកូដថ្មី ${json.createdCount} កូដ (ស្ថានភាព 'Unused · Unpaid') ចូលក្នុង Server DB${isFirebaseRootAdmin ? ' + Cloud Firestore' : ''} រួចរាល់!`
            : `✓ Generated ${json.createdCount} new 'Unused (Unpaid)' redeem codes in Server DB${isFirebaseRootAdmin ? ' + Cloud Firestore' : ''}.`,
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
      const rawCodes = manualText
        .split(/[\n,;]+/)
        .map((c) => c.trim().toUpperCase().replace(/[^A-Z0-9_-]/g, ''))
        .filter((c) => c.length >= 4);

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
        if (isFirebaseRootAdmin && rawCodes.length > 0) {
          await Promise.all(
            rawCodes.slice(0, 50).map((code) =>
              mirrorRedeemCodeToFirestore({
                code,
                status: 'Unused',
                is_paid: false,
                source: 'admin',
                note: 'Manual Admin Entry',
                assigned_to: '',
              })
            )
          );
        }
        setManualText('');
        setFeedback({
          type: 'success',
          text: isKm
            ? `✓ បានបញ្ចូល ${json.added} កូដថ្មី (Unused · Unpaid) ក្នុង Server DB${isFirebaseRootAdmin ? ' + Cloud Firestore' : ''} · រំលងកូដជាន់គ្នា ${json.skipped}`
            : `✓ Added ${json.added} 'Unused (Unpaid)' codes (skipped ${json.skipped} duplicates/invalid).`,
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

  const handleUpdateStatus = async (row: RedeemCodeRow, status: 'Unused' | 'Used' | 'Revoked') => {
    if (!adminToken) return;
    try {
      const resp = await fetch(`/api/admin/redeem-codes/${encodeURIComponent(row.code)}/status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({ status }),
      });
      if (resp.ok) {
        await mirrorRedeemCodeToFirestore({
          code: row.code,
          status,
          is_paid: row.is_paid,
          source: row.source,
          note: row.note,
          assigned_to: row.assigned_to,
        });
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
        await deleteRedeemCodeFromFirestore(code);
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
      {/* Payment-Gated Architecture Banner + Dual Sync Status */}
      <div className="p-3.5 rounded-2xl bg-gradient-to-r from-indigo-50 via-sky-50 to-emerald-50 border border-indigo-200 flex flex-wrap items-center justify-between gap-2 text-xs">
        <div className="flex items-start gap-2 text-slate-800">
          <Lock className="w-4 h-4 text-indigo-600 shrink-0 mt-0.5" />
          <span>
            {isKm
              ? 'រាល់ 10,000 កូដពី Google Sheet ត្រូវបានចាក់សោតម្រូវឱ្យបង់ប្រាក់ជាមុន (Unpaid)។ នៅពេលអតិថិជនបង់ប្រាក់តាមធនាគារកូរ៉េ / ABA / Telegram Bot ឬ Admin ចុច "បញ្ជាក់បង់ប្រាក់ & ដក ១ កូដ" កូដនឹងប្តូរទៅ Paid ហើយដោះសោ Clean PDF បានភ្លាមៗ!'
              : 'All 10,000 Google Sheet codes are payment-gated (Unpaid by default). Codes unlock Clean PDF only after payment is verified (Korea Bank, Telegram Bot, or Admin "Issue 1 Paid Code" / Mark Paid).'}
          </span>
        </div>
        <span
          className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10.5px] font-black border shrink-0 ${
            isFirebaseRootAdmin
              ? 'bg-emerald-100 text-emerald-800 border-emerald-300'
              : 'bg-amber-100 text-amber-800 border-amber-300'
          }`}
        >
          <Cloud className="w-3.5 h-3.5" />
          <span>
            {isFirebaseRootAdmin
              ? 'Server DB + Cloud Firestore Auto-Sync'
              : isKm
              ? 'Server DB (ភ្ជាប់ Google Admin ដើម្បី Sync Firestore)'
              : 'Server DB (Connect Google Admin for Firestore Sync)'}
          </span>
        </span>
      </div>

      {/* Header Stats Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs">
          <p className="text-[11px] font-bold text-slate-500 uppercase">
            {isKm ? 'លេខកូដសរុប (Total)' : 'Total Codes'}
          </p>
          <p className="text-2xl font-black text-slate-900 mt-1 tabular-nums">{stats.total.toLocaleString()}</p>
          <p className="text-[10px] text-slate-400 font-mono mt-0.5 truncate">{stats.databasePath}</p>
        </div>

        <div className="bg-amber-50 p-4 rounded-2xl border border-amber-200 shadow-xs">
          <p className="text-[11px] font-bold text-amber-800 uppercase">
            {isKm ? '🔒 មិនទាន់បង់ (Unpaid)' : '🔒 Unpaid Pool'}
          </p>
          <p className="text-2xl font-black text-amber-900 mt-1 tabular-nums">{(stats.unpaidUnusedCount ?? stats.unusedCount).toLocaleString()}</p>
          <p className="text-[10px] text-amber-700 mt-0.5">
            {isKm ? 'ត្រូវបង់ប្រាក់ទើបដោះសោបាន' : 'Locked until paid'}
          </p>
        </div>

        <div className="bg-emerald-50 p-4 rounded-2xl border border-emerald-200 shadow-xs">
          <p className="text-[11px] font-bold text-emerald-700 uppercase">
            {isKm ? '✓ បង់រួច (Paid Ready)' : '✓ Paid (Ready)'}
          </p>
          <p className="text-2xl font-black text-emerald-800 mt-1 tabular-nums">{(stats.paidUnusedCount ?? 0).toLocaleString()}</p>
          <p className="text-[10px] text-emerald-600 mt-0.5">
            {isKm ? 'រួចរាល់សម្រាប់អតិថិជនដោះសោ' : 'Ready to redeem now'}
          </p>
        </div>

        <div className="bg-sky-50 p-4 rounded-2xl border border-sky-200 shadow-xs">
          <p className="text-[11px] font-bold text-sky-700 uppercase">
            {isKm ? 'ប្រើរួចហើយ (Used)' : 'Used (Burned)'}
          </p>
          <p className="text-2xl font-black text-sky-900 mt-1 tabular-nums">{stats.usedCount.toLocaleString()}</p>
          <p className="text-[10px] text-sky-600 mt-0.5">
            {isKm ? 'បានដោះសោ PDF រួចរាល់' : 'Claimed & burned'}
          </p>
        </div>

        <div className="bg-rose-50 p-4 rounded-2xl border border-rose-200 shadow-xs col-span-2 lg:col-span-1">
          <p className="text-[11px] font-bold text-rose-700 uppercase">
            {isKm ? 'បានផ្អាក (Revoked)' : 'Revoked'}
          </p>
          <p className="text-2xl font-black text-rose-800 mt-1 tabular-nums">{stats.revokedCount.toLocaleString()}</p>
          <p className="text-[10px] text-rose-600 mt-0.5">
            {stats.googleSheetConfigured ? 'Google Sheet: Active' : 'SQLite + CSV Pool'}
          </p>
        </div>
      </div>

      {/* Quick Admin Action: Issue 1 Paid Code from Google Sheet Pool */}
      <form
        onSubmit={handleIssueNextPaidCode}
        className="bg-gradient-to-r from-emerald-50 via-teal-50 to-white p-4 rounded-2xl border-2 border-emerald-300 shadow-xs space-y-3"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <BadgeCheck className="w-5 h-5 text-emerald-600 shrink-0" />
            <div>
              <h4 className="text-xs sm:text-sm font-black text-emerald-950">
                {isKm
                  ? 'បញ្ជាក់អតិថិជនបង់ប្រាក់រួច & ដក ១ កូដពី Google Sheet (Issue Paid Redeem Code)'
                  : 'Confirm Customer Payment & Issue 1 Paid Code from Google Sheet'}
              </h4>
              <p className="text-[11px] text-emerald-800">
                {isKm
                  ? 'ពេលអតិថិជនផ្ញើ Screenshot បង់ប្រាក់តាម ABA / ធនាគារកូរ៉េមក Facebook/KakaoTalk ចុចប៊ូតុងនេះដើម្បីដក ១ កូដ Paid ហើយផ្ញើជូនគាត់!'
                  : 'When a customer sends an ABA or Korea Bank receipt, click here to mark & copy the next Google Sheet code as Paid.'}
              </p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <input
            type="text"
            value={issueCustomer}
            onChange={(e) => setIssueCustomer(e.target.value)}
            placeholder={isKm ? 'ឈ្មោះអតិថិជន / Telegram / FB (មិនបាច់ដាក់ក៏បាន)' : 'Customer name / Telegram / FB (optional)'}
            className="px-3 py-2 bg-white border border-emerald-300 rounded-xl text-xs"
          />
          <input
            type="text"
            value={issueNote}
            onChange={(e) => setIssueNote(e.target.value)}
            placeholder={isKm ? 'សម្គាល់ការបង់ប្រាក់ (ឧ. ABA $25)' : 'Payment note (e.g. ABA $25)'}
            className="px-3 py-2 bg-white border border-emerald-300 rounded-xl text-xs"
          />
          <button
            type="submit"
            disabled={issuingPaid}
            className="py-2 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs flex items-center justify-center gap-1.5 cursor-pointer shadow-xs disabled:opacity-50"
          >
            {issuingPaid ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Unlock className="w-4 h-4" />}
            <span>
              {isKm ? 'បញ្ជាក់បង់ប្រាក់ & ដក ១ កូដ Paid' : 'Issue 1 Paid Code'}
            </span>
          </button>
        </div>

        {lastIssuedPaid && (
          <div className="p-3 rounded-xl bg-white border border-emerald-300 flex flex-wrap items-center justify-between gap-2 text-xs">
            <div className="flex items-center gap-2">
              <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 font-black text-[10px]">
                PAID READY
              </span>
              <span className="font-mono font-black text-base text-slate-900">{lastIssuedPaid.code}</span>
              <span className="text-[11px] text-slate-500">({lastIssuedPaid.source})</span>
            </div>
            <button
              type="button"
              onClick={() => {
                navigator.clipboard.writeText(lastIssuedPaid.code);
                setCopiedCode(lastIssuedPaid.code);
                setTimeout(() => setCopiedCode(null), 1800);
              }}
              className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-[11px] inline-flex items-center gap-1 cursor-pointer"
            >
              {copiedCode === lastIssuedPaid.code ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copiedCode === lastIssuedPaid.code ? (isKm ? 'បានចម្លង!' : 'Copied!') : (isKm ? 'ចម្លងកូដផ្ញើអតិថិជន' : 'Copy Code')}</span>
            </button>
          </div>
        )}
      </form>

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
                  ? `✓ រកឃើញកូដ ${testCodeResult.record.code} · ស្ថានភាព: ${testCodeResult.record.status} · ការបង់ប្រាក់: ${testCodeResult.record.is_paid ? 'Paid (អាចដោះសោបាន)' : 'Unpaid (ត្រូវបង់ប្រាក់ជាមុន)'} · ប្រភព: ${testCodeResult.record.source}`
                  : `✓ Found ${testCodeResult.record.code} · Status: ${testCodeResult.record.status} · Payment: ${testCodeResult.record.is_paid ? 'Paid (Unlock Ready)' : 'Unpaid (Payment Required)'} · Source: ${testCodeResult.record.source}`
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

            <div className="flex flex-wrap items-center gap-1">
              {(['all', 'Paid', 'Unpaid', 'Unused', 'Used', 'Revoked'] as const).map((tab) => (
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
                  {tab === 'all'
                    ? isKm
                      ? 'ទាំងអស់'
                      : 'All'
                    : tab === 'Paid'
                    ? isKm
                      ? '✓ Paid'
                      : '✓ Paid'
                    : tab === 'Unpaid'
                    ? isKm
                      ? '🔒 Unpaid'
                      : '🔒 Unpaid'
                    : tab}
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
                <th className="p-3">{isKm ? 'ការបង់ប្រាក់' : 'Payment'}</th>
                <th className="p-3">Source</th>
                <th className="p-3">Assigned / Note</th>
                <th className="p-3">Used At</th>
                <th className="p-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="p-6 text-center text-slate-400">
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
                    <td className="p-3">
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-black border inline-flex items-center gap-1 ${
                          r.is_paid
                            ? 'bg-emerald-50 text-emerald-800 border-emerald-300'
                            : 'bg-amber-50 text-amber-800 border-amber-300'
                        }`}
                      >
                        {r.is_paid ? (
                          <>
                            <Unlock className="w-2.5 h-2.5" />
                            <span>{isKm ? 'Paid (បង់រួច)' : 'Paid'}</span>
                          </>
                        ) : (
                          <>
                            <Lock className="w-2.5 h-2.5" />
                            <span>{isKm ? 'Unpaid (ជាប់សោ)' : 'Unpaid'}</span>
                          </>
                        )}
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
                        {r.status === 'Unused' && (
                          <button
                            type="button"
                            onClick={() => handleTogglePaid(r)}
                            className={`px-2 py-1 rounded-lg text-[10px] font-black border cursor-pointer transition-colors ${
                              r.is_paid
                                ? 'bg-amber-50 hover:bg-amber-100 text-amber-800 border-amber-200'
                                : 'bg-emerald-600 hover:bg-emerald-700 text-white border-emerald-600'
                            }`}
                            title={
                              r.is_paid
                                ? isKm
                                  ? 'ប្តូរទៅ Unpaid (ចាក់សោវិញ)'
                                  : 'Mark Unpaid'
                                : isKm
                                ? 'បញ្ជាក់បង់ប្រាក់រួច (Mark Paid)'
                                : 'Confirm Paid'
                            }
                          >
                            {r.is_paid ? (isKm ? 'ចាក់សោ' : 'Unpaid') : isKm ? 'បង់រួច' : 'Mark Paid'}
                          </button>
                        )}
                        {r.status !== 'Unused' ? (
                          <button
                            type="button"
                            onClick={() => handleUpdateStatus(r, 'Unused')}
                            className="p-1 rounded hover:bg-emerald-50 text-emerald-600 cursor-pointer"
                            title="Reset to Unused"
                          >
                            <RotateCcw className="w-3.5 h-3.5" />
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => handleUpdateStatus(r, 'Revoked')}
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
