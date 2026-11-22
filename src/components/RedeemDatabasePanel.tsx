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
} from 'lucide-react';
import { Language } from '../types';

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
  });
  const [statusFilter, setStatusFilter] = useState<'all' | 'Unused' | 'Used' | 'Revoked'>('all');
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

  // Google Sheets Sync Form
  const [sheetId, setSheetId] = useState('');
  const [sheetName, setSheetName] = useState('RedeemCodes');
  const [syncingSheets, setSyncingSheets] = useState(false);

  const fetchRedeemDb = useCallback(async () => {
    if (!adminToken) return;
    setLoading(true);
    try {
      const resp = await fetch(`/api/admin/redeem-codes?status=${encodeURIComponent(statusFilter)}`, {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      const json = await resp.json();
      if (resp.ok && json?.success) {
        setRows(Array.isArray(json.codes) ? json.codes : []);
        if (json.stats) setStats(json.stats);
      } else {
        setFeedback({ type: 'error', text: json?.error || 'Failed to load redeem database' });
      }
    } catch {
      setFeedback({ type: 'error', text: isKm ? 'មិនអាចតភ្ជាប់ទៅ Backend Database បានទេ។' : 'Unable to connect to Backend Database.' });
    } finally {
      setLoading(false);
    }
  }, [adminToken, statusFilter, isKm]);

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
          sheetName: sheetName.trim() || 'RedeemCodes',
        }),
      });
      const json = await resp.json();
      if (resp.ok && json?.success) {
        setFeedback({
          type: 'success',
          text: isKm
            ? `✓ អានពី Google Sheets (${json.sheetName}) បាន ${json.rowsRead} ជួរ · បញ្ចូលថ្មី ${json.imported} កូដ · រំលង ${json.skipped}`
            : `✓ Read ${json.rowsRead} rows from Google Sheet "${json.sheetName}" · Imported ${json.imported} new codes.`,
        });
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
          <p className="text-2xl font-black text-slate-900 mt-1 tabular-nums">{stats.total}</p>
          <p className="text-[10px] text-slate-400 font-mono mt-0.5 truncate">{stats.databasePath}</p>
        </div>

        <div className="bg-emerald-50 p-4 rounded-2xl border border-emerald-200 shadow-xs">
          <p className="text-[11px] font-bold text-emerald-700 uppercase">
            {isKm ? 'មិនទាន់ប្រើ (Unused)' : 'Unused (Available)'}
          </p>
          <p className="text-2xl font-black text-emerald-800 mt-1 tabular-nums">{stats.unusedCount}</p>
          <p className="text-[10px] text-emerald-600 mt-0.5">
            {isKm ? 'រួចរាល់សម្រាប់ចែកជូនអ្នកប្រើ' : 'Ready for auto-unlock / users'}
          </p>
        </div>

        <div className="bg-sky-50 p-4 rounded-2xl border border-sky-200 shadow-xs">
          <p className="text-[11px] font-bold text-sky-700 uppercase">
            {isKm ? 'ប្រើរួចហើយ (Used)' : 'Used (Redeemed)'}
          </p>
          <p className="text-2xl font-black text-sky-900 mt-1 tabular-nums">{stats.usedCount}</p>
          <p className="text-[10px] text-sky-600 mt-0.5">
            {isKm ? 'បានដោះសោ PDF រួចរាល់' : 'Claimed & burned'}
          </p>
        </div>

        <div className="bg-rose-50 p-4 rounded-2xl border border-rose-200 shadow-xs">
          <p className="text-[11px] font-bold text-rose-700 uppercase">
            {isKm ? 'បានផ្អាក (Revoked)' : 'Revoked'}
          </p>
          <p className="text-2xl font-black text-rose-800 mt-1 tabular-nums">{stats.revokedCount}</p>
          <p className="text-[10px] text-rose-600 mt-0.5">
            {stats.googleSheetConfigured ? 'Google Sheet Env: Active' : 'SQLite + Sheet Sync Ready'}
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
                max={100}
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
                Google Sheet ID {stats.googleSheetConfigured ? '(env ready)' : ''}
              </label>
              <input
                type="text"
                value={sheetId}
                onChange={(e) => setSheetId(e.target.value)}
                placeholder={stats.googleSheetConfigured ? 'Using GOOGLE_SHEET_ID secret...' : '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms'}
                className="w-full px-2.5 py-2 border border-slate-300 rounded-xl text-xs font-mono"
              />
            </div>
            <div>
              <label className="text-[11px] font-bold text-slate-600 block mb-1">Tab Name</label>
              <input
                type="text"
                value={sheetName}
                onChange={(e) => setSheetName(e.target.value)}
                placeholder="RedeemCodes"
                className="w-full px-2.5 py-2 border border-slate-300 rounded-xl text-xs"
              />
            </div>
          </div>
          <p className="text-[10.5px] text-slate-500">
            {isKm
              ? 'ទម្រង់តារាង Sheet៖ ជួរឈរ A = Code, B = Status (Unused), C = Note។ បើក Share → Anyone with link (Viewer) ឬដាក់ GOOGLE_SHEETS_API_KEY។'
              : 'Sheet columns: Col A = Code, Col B = Status (Unused), Col C = Note. Set Share → Anyone with link (Viewer) or set GOOGLE_SHEETS_API_KEY.'}
          </p>
          <button
            type="submit"
            disabled={syncingSheets}
            className="w-full py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
          >
            {syncingSheets ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <FileSpreadsheet className="w-3.5 h-3.5" />}
            <span>{isKm ? 'អាន & ទាញកូដពី Google Sheets' : 'Read & Import from Google Sheets'}</span>
          </button>
        </form>
      </div>

      {/* Quick Bulk Manual Paste */}
      <form onSubmit={handleManualAdd} className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs flex flex-col sm:flex-row gap-2">
        <input
          type="text"
          value={manualText}
          onChange={(e) => setManualText(e.target.value)}
          placeholder={
            isKm
              ? 'បញ្ចូលកូដផ្ទាល់ខ្លួនបំបែកដោយសញ្ញាក្បៀស (ឧ. KIIP-VIP-001, KIIP-VIP-002)...'
              : 'Paste custom codes separated by commas (e.g. KIIP-VIP-001, KIIP-VIP-002)...'
          }
          className="flex-1 px-3 py-2 border border-slate-300 rounded-xl text-xs font-mono uppercase"
        />
        <button
          type="submit"
          disabled={addingManual || !manualText.trim()}
          className="px-4 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs cursor-pointer disabled:opacity-50 shrink-0"
        >
          {isKm ? "+ បន្ថែមជា 'Unused'" : "+ Add as 'Unused'"}
        </button>
      </form>

      {/* Redeem Codes Table */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="p-3.5 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2 bg-slate-50">
          <div className="flex items-center gap-2">
            <Database className="w-4 h-4 text-indigo-600" />
            <h4 className="text-xs sm:text-sm font-black text-slate-900">
              {isKm ? 'បញ្ជីលេខកូដ Redeem Codes ក្នុង Database' : 'Redeem Codes Database Table'}
            </h4>
          </div>
          <div className="flex items-center gap-1.5">
            {(['all', 'Unused', 'Used', 'Revoked'] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setStatusFilter(tab)}
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
      </div>
    </div>
  );
};
