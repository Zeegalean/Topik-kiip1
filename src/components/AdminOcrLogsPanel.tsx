import React, { useState, useEffect, useCallback } from 'react';
import {
  RefreshCw,
  Download,
  Search,
  ChevronDown,
  ChevronRight,
  ChevronLeft,
  Trash2,
  Check,
  AlertCircle,
  X,
} from 'lucide-react';
import { Language } from '../types';

export type OcrVerificationStatus =
  | 'verified'
  | 'needs_review'
  | 'failed'
  | 'false_positive'
  | 'pending';

interface OcrTransactionItem {
  id: number;
  txId: string;
  sessionHash: string;
  txType: 'document_ocr' | 'bank_receipt';
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

interface OcrModelPerformanceRow {
  modelVersion: string;
  totalRuns: number;
  avgConfidence: number;
  avgLatencyMs: number;
  verifiedCount: number;
  failedCount: number;
  passRate: number;
}

interface OcrPatternStatRow {
  pattern: string;
  count: number;
  sharePct: number;
  avgConfidence: number;
}

interface OcrMissingFieldStatRow {
  field: string;
  count: number;
}

interface OcrAnalyticsSummary {
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

interface AdminOcrLogsPanelProps {
  adminToken: string | null;
  lang?: Language;
}

const DOC_TYPE_LABELS: Record<string, string> = {
  arcFront: 'ARC Front',
  arcBack: 'ARC Back',
  topikCert: 'TOPIK Cert',
  passport: 'Passport',
  pdfText: 'PDF Text',
  bankReceipt: 'Bank Receipt',
};

const PATTERN_LABELS: Record<string, string> = {
  NONE: 'Nominal extraction',
  MISSING_ARC_ADDRESS: 'Missing ARC back address',
  MISSING_ARC_IDENTITY: 'Missing ARC identity fields',
  MISSING_TOPIK_DATES: 'Missing TOPIK exam/valid dates',
  MISSING_TOPIK_VERIFY_NO: 'Missing TOPIK verification/exam no.',
  MISSING_PASSPORT_FIELDS: 'Missing passport fields',
  LOW_CONFIDENCE: 'Low visual confidence (<75%)',
  SERVER_FALLBACK_OCR: 'Fallback OCR engine used',
  ZERO_FIELDS_EXTRACTED: 'Zero fields extracted',
  GEMINI_AUTH_ERROR: 'Model API auth error',
  GEMINI_QUOTA_OR_TIMEOUT: 'Model quota or timeout',
  SERVER_OCR_EXCEPTION: 'Server OCR exception',
  UNEXPECTED_EXTRACTION_ERROR: 'Unexpected extraction error',
  RECEIPT_NOT_BANK_SCREENSHOT: 'Receipt: not a bank screenshot',
  RECEIPT_STATUS_INCOMPLETE: 'Receipt: transfer not completed',
  RECEIPT_RECIPIENT_MISMATCH: 'Receipt: recipient mismatch',
  RECEIPT_AMOUNT_LOW: 'Receipt: amount below 35,000 KRW',
  RECEIPT_TIME_INVALID: 'Receipt: timestamp missing or expired',
  RECEIPT_DUPLICATE_REPLAY: 'Receipt: duplicate replay blocked',
  RECEIPT_UNREADABLE: 'Receipt: unreadable image',
  RECEIPT_SERVER_EXCEPTION: 'Receipt: server exception',
};

const STATUS_META: Record<
  OcrVerificationStatus,
  { label: string; labelKm: string; textClass: string }
> = {
  verified: {
    label: 'Verified',
    labelKm: 'បានផ្ទៀងផ្ទាត់',
    textClass: 'text-emerald-700',
  },
  needs_review: {
    label: 'Needs Review',
    labelKm: 'ត្រូវពិនិត្យបន្ថែម',
    textClass: 'text-amber-700',
  },
  failed: {
    label: 'Failed',
    labelKm: 'បរាជ័យ',
    textClass: 'text-rose-700',
  },
  false_positive: {
    label: 'False Positive',
    labelKm: 'មិនត្រឹមត្រូវ / បន្លំ',
    textClass: 'text-rose-800',
  },
  pending: {
    label: 'Pending',
    labelKm: 'រង់ចាំពិនិត្យ',
    textClass: 'text-slate-600',
  },
};

function sanitizeCsvCell(raw: string | number | boolean): string {
  const str = String(raw ?? '');
  const safe = /^[=+\-@\t\r]/.test(str) ? `'${str}` : str;
  return `"${safe.replace(/"/g, '""')}"`;
}

function formatShortTimestamp(iso: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 16);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
}

function confidenceColorClass(score: number): string {
  if (score >= 85) return 'text-emerald-700';
  if (score >= 60) return 'text-amber-700';
  return 'text-rose-700';
}

function confidenceBarColorClass(score: number): string {
  if (score >= 85) return 'bg-emerald-600';
  if (score >= 60) return 'bg-amber-500';
  return 'bg-rose-600';
}

export const AdminOcrLogsPanel: React.FC<AdminOcrLogsPanelProps> = ({
  adminToken,
  lang = 'en',
}) => {
  const isKm = lang === 'km';

  const [items, setItems] = useState<OcrTransactionItem[]>([]);
  const [summary, setSummary] = useState<OcrAnalyticsSummary>({
    totalCount: 0,
    docOcrCount: 0,
    receiptOcrCount: 0,
    avgConfidence: 0,
    verifiedCount: 0,
    needsReviewCount: 0,
    failedCount: 0,
    falsePositiveCount: 0,
    pendingCount: 0,
    fallbackCount: 0,
    avgLatencyMs: 0,
    passRate: 0,
    modelBreakdown: [],
    failingPatterns: [],
    topMissingFields: [],
  });
  const [availableModels, setAvailableModels] = useState<string[]>([]);

  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalFiltered, setTotalFiltered] = useState(0);

  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [txTypeFilter, setTxTypeFilter] = useState<string>('all');
  const [modelFilter, setModelFilter] = useState<string>('all');
  const [patternFilter, setPatternFilter] = useState<string>('ALL');
  const [searchInput, setSearchInput] = useState<string>('');
  const [appliedSearch, setAppliedSearch] = useState<string>('');

  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const [expandedTxId, setExpandedTxId] = useState<string | null>(null);
  const [draftStatus, setDraftStatus] = useState<OcrVerificationStatus>('verified');
  const [draftNote, setDraftNote] = useState<string>('');
  const [savingTxId, setSavingTxId] = useState<string | null>(null);
  const [savedTxId, setSavedTxId] = useState<string | null>(null);

  const buildHeaders = useCallback((): HeadersInit => {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Requested-With': 'XMLHttpRequest',
    };
    if (adminToken) {
      headers.Authorization = `Bearer ${adminToken}`;
    }
    return headers;
  }, [adminToken]);

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({
        page: String(page),
        limit: '25',
        status: statusFilter,
        txType: txTypeFilter,
        model: modelFilter,
        errorPattern: patternFilter,
        search: appliedSearch,
      });
      const resp = await fetch(`/api/admin/ocr-logs?${qs.toString()}`, {
        method: 'GET',
        credentials: 'include',
        headers: buildHeaders(),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok || !data?.success) {
        throw new Error(data?.error || `Failed to load OCR logs (HTTP ${resp.status})`);
      }
      setItems(Array.isArray(data.items) ? data.items : []);
      setTotalFiltered(Number(data.total) || 0);
      setTotalPages(Math.max(1, Number(data.totalPages) || 1));
      setAvailableModels(Array.isArray(data.availableModels) ? data.availableModels : []);
      if (data.summary) {
        setSummary(data.summary);
      }
    } catch (err: any) {
      setError(err?.message || 'Unable to load OCR transaction logs.');
    } finally {
      setLoading(false);
    }
  }, [page, statusFilter, txTypeFilter, modelFilter, patternFilter, appliedSearch, buildHeaders]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  const handleToggleExpand = (item: OcrTransactionItem) => {
    if (expandedTxId === item.txId) {
      setExpandedTxId(null);
      return;
    }
    setExpandedTxId(item.txId);
    setDraftStatus(item.verificationStatus);
    setDraftNote(item.adminNote || '');
    setSavedTxId(null);
  };

  const handleSaveVerification = async (txId: string, nextStatus: OcrVerificationStatus, note?: string) => {
    setSavingTxId(txId);
    setError(null);
    try {
      const resp = await fetch(`/api/admin/ocr-logs/${encodeURIComponent(txId)}/verification`, {
        method: 'PATCH',
        credentials: 'include',
        headers: buildHeaders(),
        body: JSON.stringify({
          verificationStatus: nextStatus,
          ...(typeof note === 'string' ? { adminNote: note } : {}),
        }),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok || !data?.success) {
        throw new Error(data?.error || 'Could not update verification status.');
      }
      setSavedTxId(txId);
      setTimeout(() => {
        setSavedTxId((cur) => (cur === txId ? null : cur));
      }, 2000);
      await fetchLogs();
    } catch (err: any) {
      setError(err?.message || 'Could not update verification status.');
    } finally {
      setSavingTxId(null);
    }
  };

  const handleDeleteRow = async (txId: string) => {
    setSavingTxId(txId);
    setError(null);
    try {
      const resp = await fetch(`/api/admin/ocr-logs/${encodeURIComponent(txId)}`, {
        method: 'DELETE',
        credentials: 'include',
        headers: buildHeaders(),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok || !data?.success) {
        throw new Error(data?.error || 'Could not delete OCR log entry.');
      }
      if (expandedTxId === txId) setExpandedTxId(null);
      await fetchLogs();
    } catch (err: any) {
      setError(err?.message || 'Could not delete OCR log entry.');
    } finally {
      setSavingTxId(null);
    }
  };

  const handleExportCsv = () => {
    const header = [
      'tx_id',
      'created_at',
      'session_hash',
      'tx_type',
      'doc_types',
      'model_version',
      'confidence_score',
      'verification_status',
      'error_pattern',
      'extracted_field_keys',
      'missing_field_keys',
      'fallback_used',
      'latency_ms',
      'admin_note',
    ];
    const rows = items.map((r) => [
      r.txId,
      r.createdAt,
      r.sessionHash,
      r.txType,
      r.docTypes.join('|'),
      r.modelVersion,
      r.confidenceScore,
      r.verificationStatus,
      r.errorPattern,
      r.extractedFields.join('|'),
      r.missingFields.join('|'),
      r.fallbackUsed ? 'true' : 'false',
      r.latencyMs,
      r.adminNote,
    ]);
    const csvContent = [
      header.map(sanitizeCsvCell).join(','),
      ...rows.map((row) => row.map(sanitizeCsvCell).join(',')),
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ocr-audit-anonymized-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
    setAppliedSearch(searchInput.trim());
  };

  const resetAllFilters = () => {
    setStatusFilter('all');
    setTxTypeFilter('all');
    setModelFilter('all');
    setPatternFilter('ALL');
    setSearchInput('');
    setAppliedSearch('');
    setPage(1);
  };

  const hasActiveFilters =
    statusFilter !== 'all' ||
    txTypeFilter !== 'all' ||
    modelFilter !== 'all' ||
    patternFilter !== 'ALL' ||
    appliedSearch !== '';

  const failingReviewTotal =
    summary.failedCount + summary.needsReviewCount + summary.falsePositiveCount;
  const fallbackRate =
    summary.totalCount > 0 ? Math.round((summary.fallbackCount / summary.totalCount) * 100) : 0;

  return (
    <div className="space-y-5">
      {/* Top Bar: Breadcrumb & Primary Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-200">
        <div>
          <p className="text-xs text-slate-500">
            Admin <span aria-hidden="true">/</span>{' '}
            {isKm ? 'កំណត់ត្រា OCR និងគុណភាពទិន្នន័យ' : 'OCR Quality & Extraction Audit'}
          </p>
          <h2 className="text-lg font-bold text-slate-900 mt-0.5">
            {isKm
              ? 'កំណត់ត្រាប្រតិបត្តិការ OCR (គ្មានទិន្នន័យផ្ទាល់ខ្លួន)'
              : 'Anonymized OCR Transaction Log'}
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            {isKm
              ? 'កត់ត្រាតែលេខកូដអនាមិក ពិន្ទុទំនុកចិត្ត កំណែម៉ូដែល ស្ថានភាពផ្ទៀងផ្ទាត់ និងឈ្មោះវាលដែលបាត់បង់ប៉ុណ្ណោះ (មិនរក្សាទុកឈ្មោះ លេខ ARC ឬអាសយដ្ឋានទេ)។'
              : 'Stores anonymized session hashes, confidence scores, model versions, verification status, and field keys only — zero PII values stored.'}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={fetchLogs}
            disabled={loading}
            className="px-3.5 py-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold inline-flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap shrink-0 disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>{isKm ? 'ផ្ទុកឡើងវិញ' : 'Refresh'}</span>
          </button>
          <button
            type="button"
            onClick={handleExportCsv}
            disabled={items.length === 0}
            className="px-3.5 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold inline-flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap shrink-0 disabled:opacity-40"
          >
            <Download className="w-3.5 h-3.5" />
            <span>{isKm ? 'ទាញយក CSV' : 'Export CSV'}</span>
          </button>
        </div>
      </div>

      {/* Error State */}
      {error && (
        <div className="p-3.5 rounded-lg bg-rose-50 border border-rose-200 flex items-center justify-between gap-3 text-xs text-rose-800">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
            <span>{error}</span>
          </div>
          <button
            type="button"
            onClick={fetchLogs}
            className="px-2.5 py-1 rounded-md bg-white border border-rose-200 text-rose-700 font-semibold hover:bg-rose-100 cursor-pointer whitespace-nowrap shrink-0"
          >
            {isKm ? 'សាកល្បងម្តងទៀត' : 'Retry'}
          </button>
        </div>
      )}

      {/* 4-Column Single-Elevation KPI Strip */}
      <div className="bg-white border border-slate-200 rounded-xl grid grid-cols-2 lg:grid-cols-4 divide-y lg:divide-y-0 lg:divide-x divide-slate-200">
        <div className="p-4">
          <p className="text-xs font-medium text-slate-500">
            {isKm ? 'ប្រតិបត្តិការ OCR សរុប' : 'Total OCR Transactions'}
          </p>
          <p className="text-2xl font-bold text-slate-900 font-mono tabular-nums mt-1">
            {summary.totalCount.toLocaleString()}
          </p>
          <p className="text-xs text-slate-500 mt-1 font-mono tabular-nums">
            {summary.docOcrCount} docs · {summary.receiptOcrCount} receipts
          </p>
        </div>

        <div className="p-4">
          <p className="text-xs font-medium text-slate-500">
            {isKm ? 'ពិន្ទុទំនុកចិត្តមធ្យម' : 'Mean Confidence Score'}
          </p>
          <div className="flex items-baseline gap-2 mt-1">
            <p
              className={`text-2xl font-bold font-mono tabular-nums ${confidenceColorClass(
                summary.avgConfidence
              )}`}
            >
              {summary.avgConfidence}%
            </p>
            <span className="text-xs text-slate-500 font-mono tabular-nums">
              avg {summary.avgLatencyMs.toLocaleString()} ms
            </span>
          </div>
          <div className="w-full h-1.5 bg-slate-100 rounded-full mt-2 overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${confidenceBarColorClass(
                summary.avgConfidence
              )}`}
              style={{ width: `${Math.min(100, Math.max(0, summary.avgConfidence))}%` }}
            />
          </div>
        </div>

        <div className="p-4">
          <p className="text-xs font-medium text-slate-500">
            {isKm ? 'អត្រាផ្ទៀងផ្ទាត់ជោគជ័យ' : 'Verification Pass Rate'}
          </p>
          <p className="text-2xl font-bold text-emerald-700 font-mono tabular-nums mt-1">
            {summary.passRate}%
          </p>
          <p className="text-xs text-slate-500 mt-1 font-mono tabular-nums">
            {summary.verifiedCount.toLocaleString()} verified · {summary.pendingCount} pending
          </p>
        </div>

        <div className="p-4">
          <p className="text-xs font-medium text-slate-500">
            {isKm ? 'បរាជ័យ និងត្រូវពិនិត្យ' : 'Flagged / Failing Runs'}
          </p>
          <p className="text-2xl font-bold text-rose-700 font-mono tabular-nums mt-1">
            {failingReviewTotal.toLocaleString()}
          </p>
          <p className="text-xs text-slate-500 mt-1 font-mono tabular-nums">
            {summary.failedCount} failed · {summary.needsReviewCount} review · {fallbackRate}% fallback
          </p>
        </div>
      </div>

      {/* Diagnostic Split: Model Version Breakdown & Failing Extraction Patterns */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Model Version Performance */}
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-900">
              {isKm ? 'ប្រសិទ្ធភាពតាមកំណែម៉ូដែល (Model Versions)' : 'Performance by Model Version'}
            </h3>
            <span className="text-xs text-slate-500 font-mono tabular-nums">
              {summary.modelBreakdown.length} models
            </span>
          </div>
          {summary.modelBreakdown.length === 0 ? (
            <div className="p-6 text-center text-xs text-slate-500">
              {isKm
                ? 'មិនទាន់មានទិន្នន័យម៉ូដែលនៅឡើយទេ។'
                : 'No model performance metrics recorded yet.'}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-slate-500">
                    <th className="text-left font-medium px-4 py-2">Model Version</th>
                    <th className="text-right font-medium px-3 py-2">Runs</th>
                    <th className="text-right font-medium px-3 py-2">Avg Conf.</th>
                    <th className="text-right font-medium px-3 py-2">Latency</th>
                    <th className="text-right font-medium px-4 py-2">Pass Rate</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {summary.modelBreakdown.map((m) => (
                    <tr
                      key={m.modelVersion}
                      onClick={() => {
                        setModelFilter((prev) => (prev === m.modelVersion ? 'all' : m.modelVersion));
                        setPage(1);
                      }}
                      className={`cursor-pointer transition-colors ${
                        modelFilter === m.modelVersion ? 'bg-slate-100' : 'hover:bg-slate-50'
                      }`}
                    >
                      <td className="px-4 py-2.5 font-mono text-slate-900 font-medium">
                        {m.modelVersion}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono tabular-nums text-slate-700">
                        {m.totalRuns}
                      </td>
                      <td
                        className={`px-3 py-2.5 text-right font-mono tabular-nums font-semibold ${confidenceColorClass(
                          m.avgConfidence
                        )}`}
                      >
                        {m.avgConfidence}%
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono tabular-nums text-slate-600">
                        {m.avgLatencyMs.toLocaleString()} ms
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono tabular-nums text-slate-800 font-semibold">
                        {m.passRate}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Failing Extraction Patterns & Most Frequently Missing Fields */}
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden flex flex-col">
          <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-900">
              {isKm ? 'លំនាំកំហុសដែលកើតញឹកញាប់ (Failing Patterns)' : 'Failing Extraction Patterns'}
            </h3>
            {patternFilter !== 'ALL' && (
              <button
                type="button"
                onClick={() => {
                  setPatternFilter('ALL');
                  setPage(1);
                }}
                className="text-xs text-slate-600 hover:text-slate-900 inline-flex items-center gap-1 cursor-pointer"
              >
                <X className="w-3 h-3" />
                <span>Clear pattern filter</span>
              </button>
            )}
          </div>

          <div className="p-4 flex-1 space-y-4">
            {summary.failingPatterns.length === 0 ? (
              <p className="text-xs text-slate-500 py-4 text-center">
                {isKm
                  ? 'មិនទាន់មានលំនាំកំហុស OCR ត្រូវបានកត់ត្រាទេ។'
                  : 'No failing extraction patterns detected yet.'}
              </p>
            ) : (
              <div className="space-y-2.5">
                {summary.failingPatterns.slice(0, 6).map((p) => {
                  const isSelected = patternFilter === p.pattern;
                  return (
                    <button
                      key={p.pattern}
                      type="button"
                      onClick={() => {
                        setPatternFilter(isSelected ? 'ALL' : p.pattern);
                        setPage(1);
                      }}
                      className={`w-full text-left p-2 rounded-lg transition-colors cursor-pointer ${
                        isSelected ? 'bg-slate-100' : 'hover:bg-slate-50'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2 text-xs">
                        <span className="font-medium text-slate-800 truncate">
                          {PATTERN_LABELS[p.pattern] || p.pattern}
                        </span>
                        <span className="font-mono tabular-nums text-slate-600 shrink-0">
                          {p.count} ({p.sharePct}%) · {p.avgConfidence}% avg
                        </span>
                      </div>
                      <div className="w-full h-1.5 bg-slate-100 rounded-full mt-1.5 overflow-hidden">
                        <div
                          className="h-full bg-rose-500 rounded-full"
                          style={{ width: `${Math.max(4, p.sharePct)}%` }}
                        />
                      </div>
                    </button>
                  );
                })}
              </div>
            )}

            {summary.topMissingFields.length > 0 && (
              <div className="pt-3 border-t border-slate-100">
                <p className="text-xs font-medium text-slate-500 mb-1.5">
                  {isKm ? 'វាលដែលបាត់ញឹកញាប់បំផុត' : 'Most Frequently Missing Field Keys'}
                </p>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs font-mono text-slate-700">
                  {summary.topMissingFields.map((mf, idx) => (
                    <span key={mf.field} className="tabular-nums">
                      {idx > 0 && <span className="text-slate-300 mr-3">·</span>}
                      <span className="font-semibold text-slate-900">{mf.field}</span>{' '}
                      <span className="text-slate-500">({mf.count})</span>
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Filter Toolbar + High-Density Transaction Log Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        {/* Toolbar */}
        <div className="p-3.5 border-b border-slate-200 flex flex-col xl:flex-row xl:items-center justify-between gap-3">
          {/* Segmented Verification Status Filter */}
          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg overflow-x-auto">
            {(
              [
                { id: 'all', label: isKm ? 'ទាំងអស់' : 'All' },
                { id: 'verified', label: isKm ? 'បានផ្ទៀងផ្ទាត់' : 'Verified' },
                { id: 'needs_review', label: isKm ? 'ត្រូវពិនិត្យ' : 'Needs Review' },
                { id: 'failed', label: isKm ? 'បរាជ័យ' : 'Failed' },
                { id: 'false_positive', label: isKm ? 'មិនត្រឹមត្រូវ' : 'False Positive' },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => {
                  setStatusFilter(tab.id);
                  setPage(1);
                }}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  statusFilter === tab.id
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Right Controls: Type, Model, Search */}
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={txTypeFilter}
              onChange={(e) => {
                setTxTypeFilter(e.target.value);
                setPage(1);
              }}
              aria-label="Filter by transaction type"
              className="px-2.5 py-1.5 text-xs rounded-lg border border-slate-300 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-slate-900/15"
            >
              <option value="all">{isKm ? 'គ្រប់ប្រភេទ OCR' : 'All OCR Types'}</option>
              <option value="document_ocr">{isKm ? 'ឯកសារ (ARC/TOPIK)' : 'Document OCR'}</option>
              <option value="bank_receipt">{isKm ? 'វិក្កយបត្រធនាគារ' : 'Bank Receipt OCR'}</option>
            </select>

            <select
              value={modelFilter}
              onChange={(e) => {
                setModelFilter(e.target.value);
                setPage(1);
              }}
              aria-label="Filter by model version"
              className="px-2.5 py-1.5 text-xs rounded-lg border border-slate-300 bg-white text-slate-700 font-mono focus:outline-none focus:ring-2 focus:ring-slate-900/15"
            >
              <option value="all">{isKm ? 'គ្រប់ម៉ូដែល' : 'All Models'}</option>
              {availableModels.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>

            <form onSubmit={handleSearchSubmit} className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder={isKm ? 'ស្វែងរក TX ID / លំនាំកំហុស...' : 'Search TX ID, pattern, field...'}
                className="pl-8 pr-3 py-1.5 text-xs rounded-lg border border-slate-300 bg-white text-slate-900 placeholder:text-slate-400 w-48 sm:w-56 focus:outline-none focus:ring-2 focus:ring-slate-900/15"
              />
            </form>

            {hasActiveFilters && (
              <button
                type="button"
                onClick={resetAllFilters}
                className="px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:text-slate-900 cursor-pointer whitespace-nowrap shrink-0"
              >
                {isKm ? 'សម្អាតតម្រង' : 'Reset'}
              </button>
            )}
          </div>
        </div>

        {/* Table Body */}
        {loading && items.length === 0 ? (
          <div className="divide-y divide-slate-100">
            {Array.from({ length: 6 }).map((_, idx) => (
              <div key={idx} className="px-4 py-3 flex items-center gap-4 animate-pulse">
                <div className="h-3.5 w-28 bg-slate-200 rounded" />
                <div className="h-3.5 w-24 bg-slate-200 rounded" />
                <div className="h-3.5 w-36 bg-slate-100 rounded flex-1" />
                <div className="h-3.5 w-28 bg-slate-200 rounded" />
                <div className="h-3.5 w-14 bg-slate-200 rounded" />
              </div>
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="p-10 text-center space-y-2">
            <p className="text-sm font-semibold text-slate-800">
              {hasActiveFilters
                ? isKm
                  ? 'រកមិនឃើញកំណត់ត្រា OCR ដែលត្រូវនឹងតម្រងទេ'
                  : 'No OCR transactions match the active filters'
                : isKm
                ? 'មិនទាន់មានកំណត់ត្រា OCR នៅឡើយទេ'
                : 'No OCR transactions logged yet'}
            </p>
            <p className="text-xs text-slate-500 max-w-md mx-auto">
              {hasActiveFilters
                ? isKm
                  ? 'សាកល្បងសម្អាតតម្រងដើម្បីមើលប្រតិបត្តិការទាំងអស់។'
                  : 'Clear one or more filters to view all recorded transactions.'
                : isKm
                ? 'រាល់ការស្កេនឯកសារ ARC/TOPIK/Passport និងការផ្ទៀងផ្ទាត់វិក្កយបត្រធនាគារ នឹងត្រូវបានកត់ត្រាដោយអនាមិកនៅទីនេះដោយស្វ័យប្រវត្តិ។'
                : 'Every document OCR scan (ARC, TOPIK, Passport) and bank receipt verification is automatically recorded here in anonymized form.'}
            </p>
            {hasActiveFilters && (
              <button
                type="button"
                onClick={resetAllFilters}
                className="mt-2 px-3.5 py-2 rounded-lg bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800 cursor-pointer"
              >
                {isKm ? 'បង្ហាញទាំងអស់' : 'Reset Filters'}
              </button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-slate-500">
                  <th className="w-8 px-3 py-2.5" aria-label="Expand row" />
                  <th className="text-left font-medium px-3 py-2.5 whitespace-nowrap">Timestamp</th>
                  <th className="text-left font-medium px-3 py-2.5 whitespace-nowrap">Anon TX / Session</th>
                  <th className="text-left font-medium px-3 py-2.5 whitespace-nowrap">Scope & Docs</th>
                  <th className="text-left font-medium px-3 py-2.5 whitespace-nowrap">Model Version</th>
                  <th className="text-right font-medium px-3 py-2.5 whitespace-nowrap">Confidence</th>
                  <th className="text-right font-medium px-3 py-2.5 whitespace-nowrap">Latency</th>
                  <th className="text-left font-medium px-3 py-2.5 whitespace-nowrap">Verification</th>
                  <th className="text-left font-medium px-3 py-2.5 whitespace-nowrap">Pattern / Gaps</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {items.map((item) => {
                  const isExpanded = expandedTxId === item.txId;
                  const statusMeta = STATUS_META[item.verificationStatus] || STATUS_META.pending;
                  const docSummary =
                    item.docTypes.length > 0
                      ? item.docTypes.map((d) => DOC_TYPE_LABELS[d] || d).join(', ')
                      : 'Unspecified';

                  return (
                    <React.Fragment key={item.txId}>
                      <tr
                        onClick={() => handleToggleExpand(item)}
                        className={`cursor-pointer transition-colors ${
                          isExpanded ? 'bg-slate-50' : 'hover:bg-slate-50/70'
                        }`}
                      >
                        <td className="px-3 py-2.5 text-slate-400">
                          {isExpanded ? (
                            <ChevronDown className="w-3.5 h-3.5" />
                          ) : (
                            <ChevronRight className="w-3.5 h-3.5" />
                          )}
                        </td>
                        <td className="px-3 py-2.5 font-mono tabular-nums text-slate-600 whitespace-nowrap">
                          {formatShortTimestamp(item.createdAt)}
                        </td>
                        <td className="px-3 py-2.5 font-mono whitespace-nowrap">
                          <span className="font-semibold text-slate-900">{item.txId}</span>
                          <span className="text-slate-400 ml-1.5">#{item.sessionHash.slice(0, 6)}</span>
                        </td>
                        <td className="px-3 py-2.5 text-slate-700 whitespace-nowrap">
                          <span className="font-medium text-slate-900">
                            {item.txType === 'bank_receipt' ? 'Bank Receipt' : 'Document OCR'}
                          </span>
                          <span className="text-slate-400 mx-1.5" aria-hidden="true">
                            ·
                          </span>
                          <span className="text-slate-500">{docSummary}</span>
                        </td>
                        <td className="px-3 py-2.5 font-mono text-slate-700 whitespace-nowrap">
                          {item.modelVersion}
                          {item.fallbackUsed && (
                            <span className="text-amber-700 ml-1.5">(fallback)</span>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono tabular-nums whitespace-nowrap">
                          <div className="inline-flex items-center justify-end gap-2">
                            <span
                              className={`font-semibold ${confidenceColorClass(
                                item.confidenceScore
                              )}`}
                            >
                              {item.confidenceScore}%
                            </span>
                            <span className="w-10 h-1.5 bg-slate-100 rounded-full overflow-hidden inline-block">
                              <span
                                className={`block h-full ${confidenceBarColorClass(
                                  item.confidenceScore
                                )}`}
                                style={{ width: `${item.confidenceScore}%` }}
                              />
                            </span>
                          </div>
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono tabular-nums text-slate-600 whitespace-nowrap">
                          {item.latencyMs.toLocaleString()} ms
                        </td>
                        <td className="px-3 py-2.5 whitespace-nowrap">
                          <span className={`font-semibold ${statusMeta.textClass}`}>
                            {isKm ? statusMeta.labelKm : statusMeta.label}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-slate-600 max-w-[240px] truncate">
                          {item.errorPattern !== 'NONE' ? (
                            <span className="text-rose-700 font-medium">
                              {PATTERN_LABELS[item.errorPattern] || item.errorPattern}
                            </span>
                          ) : item.missingFields.length > 0 ? (
                            <span className="text-amber-700 font-mono">
                              Missing: {item.missingFields.join(', ')}
                            </span>
                          ) : (
                            <span className="text-slate-400">
                              {item.extractedFields.length} fields ok
                            </span>
                          )}
                        </td>
                      </tr>

                      {isExpanded && (
                        <tr className="bg-slate-50/80">
                          <td colSpan={9} className="px-6 py-4 border-t border-slate-200/80">
                            <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
                              {/* Extracted & Missing Field Keys (Zero PII) */}
                              <div className="space-y-2.5">
                                <p className="text-xs font-semibold text-slate-900">
                                  Anonymized Field Coverage
                                </p>
                                <div className="text-xs space-y-1.5">
                                  <div>
                                    <span className="text-slate-500">Extracted keys ({item.extractedFields.length}): </span>
                                    <span className="font-mono text-slate-800">
                                      {item.extractedFields.length > 0
                                        ? item.extractedFields.join(', ')
                                        : 'None'}
                                    </span>
                                  </div>
                                  <div>
                                    <span className="text-slate-500">Missing keys ({item.missingFields.length}): </span>
                                    <span className="font-mono text-rose-700">
                                      {item.missingFields.length > 0
                                        ? item.missingFields.join(', ')
                                        : 'None'}
                                    </span>
                                  </div>
                                  <div>
                                    <span className="text-slate-500">Failure pattern code: </span>
                                    <span className="font-mono text-slate-900">{item.errorPattern}</span>
                                  </div>
                                  <div>
                                    <span className="text-slate-500">Session hash: </span>
                                    <span className="font-mono text-slate-700">{item.sessionHash}</span>
                                  </div>
                                </div>
                              </div>

                              {/* Per-Field Confidence Breakdown */}
                              <div className="space-y-2">
                                <p className="text-xs font-semibold text-slate-900">
                                  Per-Field Visual Confidence
                                </p>
                                {Object.keys(item.fieldConfidence).length === 0 ? (
                                  <p className="text-xs text-slate-500">
                                    Aggregate coverage score applied ({item.confidenceScore}%).
                                  </p>
                                ) : (
                                  <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs font-mono tabular-nums">
                                    {Object.entries(item.fieldConfidence).map(([k, v]) => (
                                      <div key={k} className="flex items-center justify-between">
                                        <span className="text-slate-600 truncate pr-2">{k}</span>
                                        <span className={`font-semibold ${confidenceColorClass(v)}`}>
                                          {v}%
                                        </span>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>

                              {/* Admin QA Verification Status & Note Controls */}
                              <div className="space-y-2.5">
                                <p className="text-xs font-semibold text-slate-900">
                                  QA Verification Override
                                </p>
                                <div className="flex items-center gap-2">
                                  <select
                                    value={draftStatus}
                                    onChange={(e) =>
                                      setDraftStatus(e.target.value as OcrVerificationStatus)
                                    }
                                    className="flex-1 px-2.5 py-1.5 text-xs rounded-lg border border-slate-300 bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900/15"
                                  >
                                    <option value="verified">Verified</option>
                                    <option value="needs_review">Needs Review</option>
                                    <option value="failed">Failed</option>
                                    <option value="false_positive">False Positive</option>
                                    <option value="pending">Pending</option>
                                  </select>
                                  <button
                                    type="button"
                                    disabled={savingTxId === item.txId}
                                    onClick={() =>
                                      handleSaveVerification(item.txId, draftStatus, draftNote)
                                    }
                                    className="px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold inline-flex items-center gap-1 cursor-pointer whitespace-nowrap shrink-0 disabled:opacity-50"
                                  >
                                    {savedTxId === item.txId ? (
                                      <>
                                        <Check className="w-3.5 h-3.5" />
                                        <span>Saved</span>
                                      </>
                                    ) : (
                                      <span>{savingTxId === item.txId ? 'Saving...' : 'Save QA'}</span>
                                    )}
                                  </button>
                                </div>
                                <input
                                  type="text"
                                  value={draftNote}
                                  onChange={(e) => setDraftNote(e.target.value)}
                                  maxLength={280}
                                  placeholder="Internal pattern note (no PII, e.g. 'Blurry ARC hologram glare')"
                                  className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-slate-300 bg-white text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-900/15"
                                />
                                <div className="flex items-center justify-between pt-1">
                                  <span className="text-[11px] text-slate-400 font-mono tabular-nums">
                                    Updated {formatShortTimestamp(item.updatedAt)}
                                  </span>
                                  <button
                                    type="button"
                                    disabled={savingTxId === item.txId}
                                    onClick={() => handleDeleteRow(item.txId)}
                                    className="text-xs text-rose-600 hover:text-rose-800 inline-flex items-center gap-1 cursor-pointer"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                    <span>Delete entry</span>
                                  </button>
                                </div>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination Footer */}
        <div className="px-4 py-3 border-t border-slate-200 flex items-center justify-between text-xs text-slate-600">
          <span className="font-mono tabular-nums">
            Showing {items.length} of {totalFiltered.toLocaleString()} records · Page {page} /{' '}
            {totalPages}
          </span>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              disabled={page <= 1 || loading}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 font-medium inline-flex items-center gap-1 disabled:opacity-40 cursor-pointer"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
              <span>Prev</span>
            </button>
            <button
              type="button"
              disabled={page >= totalPages || loading}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              className="px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 font-medium inline-flex items-center gap-1 disabled:opacity-40 cursor-pointer"
            >
              <span>Next</span>
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
