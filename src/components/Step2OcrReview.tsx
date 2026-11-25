import React, { useState, useEffect, useMemo } from 'react';
import { Language, UploadedDocuments } from '../types';
import {
  ExtractedDocumentData,
  OcrConfidenceKey,
  OcrFieldConfidence,
  OcrFieldConfidenceMap,
  evaluateDraftConfidence,
} from '../utils/clientOcrEngine';
import { findOfficeByAddress } from '../data/immigrationOffices';
import { KOREAN_VISA_GROUPS, ALL_VISA_CODES } from '../data/visaOptions';
import { extractPdfTextAndImageFromDataUrl, isPdfDataUrl } from '../utils/pdfOcrUtils';
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  RotateCcw,
  FileText,
  ZoomIn,
  ZoomOut,
  ChevronDown,
  ChevronUp,
  ScanText,
  MapPin,
  Award,
  UserCheck,
  BookOpenCheck,
  ShieldCheck,
  Search,
} from 'lucide-react';
import { DaumPostcodeModal } from './DaumPostcodeModal';

interface Step2OcrReviewProps {
  lang: Language;
  docs: UploadedDocuments;
  draft: ExtractedDocumentData;
  setDraft: React.Dispatch<React.SetStateAction<ExtractedDocumentData>>;
  initialSnapshot: ExtractedDocumentData | null;
  confidenceMap?: OcrFieldConfidenceMap;
  initialConfidenceSnapshot?: OcrFieldConfidenceMap | null;
  rawTextPreview: string;
  ocrModel: string;
  isScanning: boolean;
  onRescanOcr: () => Promise<void> | void;
  onBack: () => void;
  onConfirmInject: (confirmedDraft: ExtractedDocumentData) => void;
}

type DocTabId = 'arcBack' | 'topik' | 'arcFront' | 'passport';
type FieldFilterMode = 'all' | 'review';

const ALL_CONFIDENCE_KEYS: OcrConfidenceKey[] = [
  'name',
  'regNumber',
  'gender',
  'nationality',
  'visaStatus',
  'address',
  'docVerificationNo',
  'examNumber',
  'round',
  'examDate',
  'validUntil',
  'grade',
  'passportNo',
  'passportExpiry',
];

function getConfidenceTier(conf?: OcrFieldConfidence): 'manual' | 'high' | 'medium' | 'low' | 'missing' {
  if (!conf || conf.source === 'missing' || conf.score <= 0) return 'missing';
  if (conf.source === 'manual' && conf.score >= 85) return 'manual';
  if (conf.score >= 85) return 'high';
  if (conf.score >= 60) return 'medium';
  return 'low';
}

const ConfidenceInlineMeter: React.FC<{
  confidence?: OcrFieldConfidence;
  lang: Language;
}> = ({ confidence, lang }) => {
  const isKm = lang === 'km';
  const isKo = lang === 'ko';
  const score = confidence?.score ?? 0;
  const tier = getConfidenceTier(confidence);

  const tierText =
    tier === 'manual'
      ? isKm
        ? 'បានកែ·ផ្ទៀងផ្ទាត់'
        : isKo
        ? '직접 수정됨'
        : 'Edited'
      : tier === 'high'
      ? isKm
        ? 'ច្បាស់'
        : isKo
        ? '높음'
        : 'High'
      : tier === 'medium'
      ? isKm
        ? 'គួរពិនិត្យ'
        : isKo
        ? '확인 필요'
        : 'Review'
      : tier === 'low'
      ? isKm
        ? 'ទាប'
        : isKo
        ? '낮음'
        : 'Low'
      : isKm
      ? 'ទទេ'
      : isKo
      ? '미추출'
      : 'Missing';

  const sourceLabel =
    confidence?.source === 'ai-vision'
      ? 'AI Vision OCR'
      : confidence?.source === 'pdf-digital'
      ? 'PDF Digital Text'
      : confidence?.source === 'tesseract'
      ? 'Browser OCR'
      : confidence?.source === 'svg-preset'
      ? 'Sample / Vector'
      : confidence?.source === 'manual'
      ? 'Manual Edit'
      : 'Not Extracted';

  const barColor =
    tier === 'manual'
      ? 'bg-indigo-600'
      : tier === 'high'
      ? 'bg-emerald-600'
      : tier === 'medium'
      ? 'bg-amber-500'
      : tier === 'low'
      ? 'bg-rose-600'
      : 'bg-slate-300';

  const textColor =
    tier === 'manual'
      ? 'text-indigo-700'
      : tier === 'high'
      ? 'text-emerald-700'
      : tier === 'medium'
      ? 'text-amber-700'
      : tier === 'low'
      ? 'text-rose-700'
      : 'text-slate-500';

  const tooltip = `${sourceLabel} (${score}%)${confidence?.reason ? ` — ${confidence.reason}` : ''}`;

  return (
    <span
      title={tooltip}
      className={`inline-flex items-center gap-1.5 text-[11px] font-semibold shrink-0 whitespace-nowrap ${textColor}`}
    >
      <span
        aria-hidden="true"
        className="w-11 h-1.5 bg-slate-200 rounded-xs overflow-hidden inline-block shrink-0"
      >
        <span
          className={`block h-full transition-all duration-200 ${barColor}`}
          style={{ width: `${Math.max(tier === 'missing' ? 0 : 8, Math.min(100, score))}%` }}
        />
      </span>
      <span className="font-mono tabular-nums">{score}%</span>
      <span aria-hidden="true" className="text-slate-300">
        ·
      </span>
      {tier === 'manual' || tier === 'high' ? (
        <CheckCircle2 className="w-3 h-3 shrink-0" aria-hidden="true" />
      ) : (
        <AlertTriangle className="w-3 h-3 shrink-0" aria-hidden="true" />
      )}
      <span>{tierText}</span>
    </span>
  );
};

export const Step2OcrReview: React.FC<Step2OcrReviewProps> = ({
  lang,
  docs,
  draft,
  setDraft,
  initialSnapshot,
  confidenceMap,
  initialConfidenceSnapshot,
  rawTextPreview,
  ocrModel,
  isScanning,
  onRescanOcr,
  onBack,
  onConfirmInject,
}) => {
  const isKm = lang === 'km';
  const isKo = lang === 'ko';

  // Track which fields the user has manually edited in Step 2
  const [editedKeys, setEditedKeys] = useState<Set<OcrConfidenceKey>>(() => new Set());
  const [fieldFilter, setFieldFilter] = useState<FieldFilterMode>('all');
  const [isDaumModalOpen, setIsDaumModalOpen] = useState(false);

  // Clear manual edit flags when a fresh OCR rescan updates initialConfidenceSnapshot
  useEffect(() => {
    setEditedKeys(new Set());
  }, [initialConfidenceSnapshot]);

  const markEdited = (key: OcrConfidenceKey) => {
    setEditedKeys((prev) => {
      if (prev.has(key)) return prev;
      const next = new Set(prev);
      next.add(key);
      return next;
    });
  };

  // Live calibrated confidence map combining initial OCR confidence, structural validation, and user edits
  const liveConfidence = useMemo<OcrFieldConfidenceMap>(() => {
    const presetSource =
      ocrModel === 'sample-preset' || ocrModel === 'svg-fallback' ? 'svg-preset' : 'tesseract';
    return evaluateDraftConfidence(draft, confidenceMap, editedKeys, presetSource);
  }, [draft, confidenceMap, editedKeys, ocrModel]);

  const confidenceStats = useMemo(() => {
    let sum = 0;
    let high = 0;
    let review = 0;
    let lowOrMissing = 0;
    for (const key of ALL_CONFIDENCE_KEYS) {
      const c = liveConfidence[key];
      const s = c?.score ?? 0;
      sum += s;
      const tier = getConfidenceTier(c);
      if (tier === 'high' || tier === 'manual') high++;
      else if (tier === 'medium') review++;
      else lowOrMissing++;
    }
    const avg = Math.round(sum / ALL_CONFIDENCE_KEYS.length);
    return {
      avg,
      high,
      review,
      lowOrMissing,
      needsAttention: review + lowOrMissing,
    };
  }, [liveConfidence]);

  const shouldShowField = (key: OcrConfidenceKey): boolean => {
    if (fieldFilter === 'all') return true;
    const tier = getConfidenceTier(liveConfidence[key]);
    return tier === 'medium' || tier === 'low' || tier === 'missing';
  };

  const getFieldSurfaceClass = (key: OcrConfidenceKey, focusColor: string = 'focus:ring-indigo-500'): string => {
    const tier = getConfidenceTier(liveConfidence[key]);
    if (tier === 'low' || tier === 'missing') {
      return 'border-rose-400 bg-rose-50/40 focus:ring-rose-500 focus:border-rose-500';
    }
    if (tier === 'medium') {
      return 'border-amber-400 bg-amber-50/40 focus:ring-amber-500 focus:border-amber-500';
    }
    if (tier === 'manual') {
      return `border-indigo-300 bg-indigo-50/20 ${focusColor}`;
    }
    return `border-slate-300 bg-white ${focusColor}`;
  };

  const renderFieldReasonHint = (key: OcrConfidenceKey) => {
    const c = liveConfidence[key];
    const tier = getConfidenceTier(c);
    if (tier === 'high' || tier === 'manual' || !c?.reason) return null;
    const colorClass = tier === 'medium' ? 'text-amber-700' : 'text-rose-700';
    return (
      <p className={`text-[11px] font-medium flex items-center gap-1 pt-0.5 ${colorClass}`}>
        <AlertTriangle className="w-3 h-3 shrink-0" aria-hidden="true" />
        <span>{c.reason}</span>
      </p>
    );
  };

  // Build available document tabs
  const availableDocs = useMemo(() => {
    const items: Array<{ id: DocTabId; label: string; url: string; fileName?: string }> = [];
    if (docs.arcFront) {
      items.push({
        id: 'arcFront',
        label: isKm ? 'ARC ខាងមុខ' : isKo ? '등록증 앞면' : 'ARC Front',
        url: docs.arcFront,
        fileName: docs.arcFrontName,
      });
    }
    if (docs.arcBack) {
      items.push({
        id: 'arcBack',
        label: isKm ? 'ARC ខាងក្រោយ (체류지)' : isKo ? '등록증 뒷면 (체류지)' : 'ARC Back',
        url: docs.arcBack,
        fileName: docs.arcBackName,
      });
    }
    if (docs.topikCertList && docs.topikCertList.length > 0) {
      items.push({
        id: 'topik',
        label: isKm ? 'សញ្ញាបត្រ TOPIK' : isKo ? 'TOPIK 성적증명서' : 'TOPIK Score',
        url: docs.topikCertList[0].dataUrl,
        fileName: docs.topikCertList[0].name,
      });
    }
    if (docs.passportList && docs.passportList.length > 0) {
      items.push({
        id: 'passport',
        label: isKm ? 'លិខិតឆ្លងដែន' : isKo ? '여권 사본' : 'Passport',
        url: docs.passportList[0].dataUrl,
        fileName: docs.passportList[0].name,
      });
    }
    return items;
  }, [docs, isKm, isKo]);

  const [selectedDocTab, setSelectedDocTab] = useState<DocTabId>('topik');
  const [previewZoom, setPreviewZoom] = useState<number>(1);
  const [showRawText, setShowRawText] = useState<boolean>(false);
  const [pdfPreviewCache, setPdfPreviewCache] = useState<Record<string, string>>({});
  const [isRenderingPdf, setIsRenderingPdf] = useState<boolean>(false);

  useEffect(() => {
    if (availableDocs.length === 0) return;
    if (!availableDocs.some((d) => d.id === selectedDocTab)) {
      setSelectedDocTab(availableDocs[0].id);
    }
  }, [availableDocs, selectedDocTab]);

  const activeDoc = availableDocs.find((d) => d.id === selectedDocTab) || availableDocs[0] || null;
  const activeUrl = activeDoc?.url || '';
  const activeIsPdf = isPdfDataUrl(activeUrl);
  const resolvedPreviewSrc = activeIsPdf ? pdfPreviewCache[activeUrl] || '' : activeUrl;

  useEffect(() => {
    if (!activeUrl || !activeIsPdf || pdfPreviewCache[activeUrl]) return;
    let cancelled = false;
    setIsRenderingPdf(true);
    extractPdfTextAndImageFromDataUrl(activeUrl, 1600)
      .then((res) => {
        if (!cancelled && res.imageUrl) {
          setPdfPreviewCache((prev) => ({ ...prev, [activeUrl]: res.imageUrl as string }));
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setIsRenderingPdf(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeUrl, activeIsPdf, pdfPreviewCache]);

  const docParts: string[] = useMemo(() => {
    if (Array.isArray(draft.docVerificationNo)) {
      return [0, 1, 2, 3].map((i) => draft.docVerificationNo?.[i] || '');
    }
    if (typeof draft.docVerificationNo === 'string') {
      const d = draft.docVerificationNo.replace(/[^0-9]/g, '');
      return [d.slice(0, 4), d.slice(4, 8), d.slice(8, 12), d.slice(12, 16)];
    }
    return ['', '', '', ''];
  }, [draft.docVerificationNo]);

  const handleDocPartInput = (index: number, rawVal: string) => {
    markEdited('docVerificationNo');
    const digits = rawVal.replace(/[^0-9]/g, '');
    if (digits.length === 16 && index === 0) {
      setDraft((prev) => ({
        ...prev,
        docVerificationNo: [
          digits.slice(0, 4),
          digits.slice(4, 8),
          digits.slice(8, 12),
          digits.slice(12, 16),
        ],
      }));
      return;
    }
    const next = [...docParts];
    next[index] = digits.slice(0, 4);
    setDraft((prev) => ({ ...prev, docVerificationNo: next }));
  };

  const matchedOffice = useMemo(() => findOfficeByAddress(draft.address || ''), [draft.address]);

  const criticalChecks: Array<{
    key: string;
    confKey: OcrConfidenceKey;
    label: string;
    ok: boolean;
    tab: DocTabId;
  }> = [
    {
      key: 'name',
      confKey: 'name',
      label: isKm ? 'ឈ្មោះ (성명)' : isKo ? '성명' : 'Name',
      ok: Boolean(draft.name && draft.name.trim().length >= 2),
      tab: 'arcFront',
    },
    {
      key: 'arc',
      confKey: 'regNumber',
      label: isKm ? 'លេខ ARC' : isKo ? '등록번호' : 'ARC No.',
      ok: Boolean((draft.regNumber1 || '').length === 6 && (draft.regNumber2 || '').length === 7),
      tab: 'arcFront',
    },
    {
      key: 'address',
      confKey: 'address',
      label: isKm ? '체류지 (អាសយដ្ឋាន)' : isKo ? '체류지' : 'Address (체류지)',
      ok: Boolean(draft.address && draft.address.trim().length >= 5),
      tab: 'arcBack',
    },
    {
      key: 'examDate',
      confKey: 'examDate',
      label: isKm ? '시험일 (ថ្ងៃប្រឡង)' : isKo ? '시험일' : 'Exam Date',
      ok: Boolean(draft.examDate && /^\d{4}-\d{2}-\d{2}$/.test(draft.examDate)),
      tab: 'topik',
    },
    {
      key: 'validUntil',
      confKey: 'validUntil',
      label: isKm ? '성적유효기간 (សុពលភាព)' : isKo ? '성적유효기간' : 'Valid Until',
      ok: Boolean(draft.validUntil && /^\d{4}-\d{2}-\d{2}$/.test(draft.validUntil)),
      tab: 'topik',
    },
    {
      key: 'round',
      confKey: 'round',
      label: isKm ? '회 (លើកទី)' : isKo ? '회차' : 'Round (회)',
      ok: Boolean(draft.round && /^\d{1,3}$/.test(String(draft.round).trim())),
      tab: 'topik',
    },
  ];

  const readyCount = criticalChecks.filter((c) => c.ok).length;

  const copy = {
    stepTag: isKm
      ? 'ជំហ៊ានទី ២ (Step 2)'
      : isKo
      ? '2단계 (Step 2)'
      : 'Step 2',
    title: isKm
      ? 'ផ្ទៀងផ្ទាត់ និងកែសម្រួលលទ្ធផល OCR មុនបញ្ចូលទម្រង់ផ្លូវការ'
      : isKo
      ? 'OCR 추출 데이터 확인 및 수동 편집'
      : 'Verify & Edit Extracted OCR Data Before Form Injection',
    subtitle: isKm
      ? 'ពិនិត្យកម្រិតទំនុកចិត្ត OCR (Confidence Score) នៅជាប់ប្រអប់ទិន្នន័យនីមួយៗ រួចកែសម្រួលចំណុចដែលមានពណ៌លឿង ឬក្រហម ធៀបនឹងរូបភាពឯកសារដើម។'
      : isKo
      ? '각 항목 옆의 OCR 신뢰도 점수(Confidence Score)를 확인하고, 주황색·붉은색으로 표시된 부분을 원본 서류와 비교해 수정하세요.'
      : 'Inspect the OCR Confidence Score next to each extracted field, correct any amber or rose highlighted entries against your document preview, and confirm injection.',
    rescanBtn: isScanning
      ? isKm
        ? 'កំពុងស្កេន OCR...'
        : isKo
        ? 'OCR 재스캔 중...'
        : 'Scanning OCR...'
      : isKm
      ? 'ស្កេន OCR ម្តងទៀត'
      : isKo
      ? 'OCR 다시 스캔'
      : 'Re-scan OCR',
    resetBtn: isKm
      ? 'ត្រឡប់ទៅលទ្ធផល OCR ដើម'
      : isKo
      ? '추출 원문으로 되돌리기'
      : 'Reset to OCR Scan',
    backBtn: isKm ? '← ត្រឡប់ទៅជំហ៊ានទី ១' : isKo ? '← 1단계 서류 업로드' : '← Back to Upload',
    confirmBtn: isKm
      ? 'បញ្ជាក់ & បញ្ចូលទៅក្នុងទម្រង់ពាក្យសុំ →'
      : isKo
      ? '확인 및 공식 신청서에 반영 →'
      : 'Confirm & Inject into Application Form →',
    viewerTitle: isKm
      ? 'មើលឯកសារដើមសម្រាប់ផ្ទៀងផ្ទាត់'
      : isKo
      ? '원본 서류 미리보기'
      : 'Uploaded Document Preview',
    rawTextBtn: isKm
      ? 'មើលអក្សរ Raw OCR ដែលចាប់បាន'
      : isKo
      ? '원본 OCR 추출 텍스트 보기'
      : 'Inspect Raw OCR Text',
  };

  const showGroup1 =
    shouldShowField('name') ||
    shouldShowField('regNumber') ||
    shouldShowField('gender') ||
    shouldShowField('nationality') ||
    shouldShowField('visaStatus');
  const showGroup2 = shouldShowField('address');
  const showGroup3 =
    shouldShowField('docVerificationNo') ||
    shouldShowField('examNumber') ||
    shouldShowField('round') ||
    shouldShowField('examDate') ||
    shouldShowField('validUntil') ||
    shouldShowField('grade');
  const showGroup4 = shouldShowField('passportNo') || shouldShowField('passportExpiry');

  return (
    <div className="space-y-6 pb-14">
      {/* Header Bar */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5 sm:p-6 shadow-xs space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-indigo-700">
              <span>{copy.stepTag}</span>
              <span aria-hidden="true" className="text-slate-300">·</span>
              <span className="font-mono text-[11px] text-slate-600 tabular-nums">
                {readyCount}/{criticalChecks.length} {isKm ? 'ចំណុចសំខាន់រួចរាល់' : isKo ? '핵심 항목 확인' : 'key fields ready'}
              </span>
              <span aria-hidden="true" className="text-slate-300">·</span>
              <span className="font-mono text-[11px] text-slate-700 tabular-nums">
                {isKm ? 'ទំនុកចិត្ត OCR មធ្យម' : isKo ? '평균 OCR 신뢰도' : 'Avg OCR Confidence'}: {confidenceStats.avg}%
              </span>
            </div>
            <h2 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">
              {copy.title}
            </h2>
            <p className="text-xs sm:text-sm text-slate-600 leading-relaxed max-w-3xl">
              {copy.subtitle}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={onRescanOcr}
              disabled={isScanning}
              className="px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 disabled:opacity-60 text-white border border-emerald-700 shadow-xs text-xs font-semibold inline-flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              <RefreshCw className={`w-3.5 h-3.5 text-white ${isScanning ? 'animate-spin' : ''}`} />
              <span>{copy.rescanBtn}</span>
            </button>

            {initialSnapshot && (
              <button
                type="button"
                onClick={() => {
                  setDraft(initialSnapshot);
                  setEditedKeys(new Set());
                }}
                className="px-3.5 py-2 rounded-xl bg-white hover:bg-slate-50 text-slate-700 border border-slate-300 text-xs font-semibold inline-flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap shrink-0"
              >
                <RotateCcw className="w-3.5 h-3.5 text-slate-500" />
                <span>{copy.resetBtn}</span>
              </button>
            )}
          </div>
        </div>

        {/* Confidence Summary & Filter Bar */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-3 border-t border-slate-100">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-600">
            <span className="inline-flex items-center gap-1.5 font-medium text-emerald-700 tabular-nums">
              <CheckCircle2 className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
              {confidenceStats.high} {isKm ? 'ច្បាស់ (≥85%)' : isKo ? '높음 (≥85%)' : 'High (≥85%)'}
            </span>
            <span aria-hidden="true" className="text-slate-300">·</span>
            <span className="inline-flex items-center gap-1.5 font-medium text-amber-700 tabular-nums">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
              {confidenceStats.review} {isKm ? 'គួរពិនិត្យ (60–84%)' : isKo ? '확인 권장 (60–84%)' : 'Review (60–84%)'}
            </span>
            <span aria-hidden="true" className="text-slate-300">·</span>
            <span className="inline-flex items-center gap-1.5 font-medium text-rose-700 tabular-nums">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
              {confidenceStats.lowOrMissing} {isKm ? 'ទាប / ទទេ (<60%)' : isKo ? '낮음·누락 (<60%)' : 'Low / Missing (<60%)'}
            </span>
          </div>

          <div className="inline-flex items-center gap-1 p-1 bg-slate-100 rounded-lg self-start sm:self-auto">
            <button
              type="button"
              onClick={() => setFieldFilter('all')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0 tabular-nums ${
                fieldFilter === 'all'
                  ? 'bg-white text-slate-900 shadow-2xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {isKm
                ? `គ្រប់ប្រអប់ (${ALL_CONFIDENCE_KEYS.length})`
                : isKo
                ? `전체 항목 (${ALL_CONFIDENCE_KEYS.length})`
                : `All Fields (${ALL_CONFIDENCE_KEYS.length})`}
            </button>
            <button
              type="button"
              onClick={() => setFieldFilter('review')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0 tabular-nums ${
                fieldFilter === 'review'
                  ? 'bg-white text-slate-900 shadow-2xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {isKm
                ? `ត្រូវការពិនិត្យ (${confidenceStats.needsAttention})`
                : isKo
                ? `수정·확인 필요 (${confidenceStats.needsAttention})`
                : `Needs Review (${confidenceStats.needsAttention})`}
            </button>
          </div>
        </div>

        {/* Interactive Readiness Strip */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 pt-2 border-t border-slate-100">
          {criticalChecks.map((item) => {
            const confScore = liveConfidence[item.confKey]?.score ?? 0;
            const tier = getConfidenceTier(liveConfidence[item.confKey]);
            const isHealthy = item.ok && (tier === 'high' || tier === 'manual');
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => setSelectedDocTab(item.tab)}
                className={`px-3 py-2 rounded-lg border text-left text-xs transition-colors flex items-center justify-between gap-2 cursor-pointer ${
                  isHealthy
                    ? 'bg-emerald-50/70 border-emerald-200 text-emerald-950 hover:bg-emerald-50'
                    : tier === 'medium' && item.ok
                    ? 'bg-amber-50 border-amber-300 text-amber-950 hover:bg-amber-100/70'
                    : 'bg-rose-50/70 border-rose-300 text-rose-950 hover:bg-rose-100/60'
                }`}
              >
                <div className="min-w-0">
                  <div className="font-semibold truncate">{item.label}</div>
                  <div className="text-[10px] font-mono tabular-nums opacity-80">{confScore}%</div>
                </div>
                {isHealthy ? (
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                ) : (
                  <AlertTriangle
                    className={`w-3.5 h-3.5 shrink-0 ${tier === 'medium' && item.ok ? 'text-amber-600' : 'text-rose-600'}`}
                  />
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Side-by-Side Verification Workbench */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Column: Document Viewer + Raw Text Inspector */}
        <div className="lg:col-span-5 lg:sticky lg:top-28 bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between gap-2 bg-slate-50/80">
            <div className="flex items-center gap-2 min-w-0">
              <FileText className="w-4 h-4 text-indigo-600 shrink-0" />
              <h3 className="text-xs font-bold text-slate-800 truncate">{copy.viewerTitle}</h3>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <button
                type="button"
                onClick={() => setPreviewZoom((z) => Math.max(1, Number((z - 0.25).toFixed(2))))}
                disabled={previewZoom <= 1}
                className="p-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-100 disabled:opacity-40 text-slate-600 cursor-pointer"
                title="Zoom Out"
              >
                <ZoomOut className="w-3.5 h-3.5" />
              </button>
              <span className="text-[11px] font-mono font-semibold text-slate-600 w-10 text-center tabular-nums">
                {Math.round(previewZoom * 100)}%
              </span>
              <button
                type="button"
                onClick={() => setPreviewZoom((z) => Math.min(2.5, Number((z + 0.25).toFixed(2))))}
                disabled={previewZoom >= 2.5}
                className="p-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-100 disabled:opacity-40 text-slate-600 cursor-pointer"
                title="Zoom In"
              >
                <ZoomIn className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Document Switcher Tabs */}
          {availableDocs.length > 0 && (
            <div className="px-3 py-2 border-b border-slate-200 bg-white flex flex-wrap gap-1.5">
              {availableDocs.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    setSelectedDocTab(item.id);
                    setPreviewZoom(1);
                  }}
                  className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    selectedDocTab === item.id
                      ? 'bg-slate-900 text-white'
                      : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>
          )}

          {/* Document Viewport */}
          <div className="p-3 bg-slate-100/80 min-h-[300px] max-h-[460px] overflow-auto flex items-center justify-center">
            {activeDoc ? (
              isRenderingPdf ? (
                <div className="flex flex-col items-center gap-2 text-xs text-slate-500 py-10">
                  <RefreshCw className="w-5 h-5 animate-spin text-indigo-600" />
                  <span>{isKm ? 'កំពុងបង្ហាញទំព័រ PDF...' : 'Rendering PDF preview...'}</span>
                </div>
              ) : resolvedPreviewSrc ? (
                <img
                  src={resolvedPreviewSrc}
                  alt={activeDoc.label}
                  style={{
                    transform: `scale(${previewZoom})`,
                    transformOrigin: 'top center',
                  }}
                  className="max-w-full rounded-lg border border-slate-300 bg-white shadow-2xs transition-transform duration-150"
                />
              ) : (
                <div className="text-xs text-slate-500 py-8 text-center">
                  {activeDoc.fileName || activeDoc.label}
                </div>
              )
            ) : (
              <div className="text-xs text-slate-500 py-12 text-center">
                {isKm ? 'មិនទាន់មានឯកសារត្រូវបានបង្ហោះនៅឡើយទេ' : 'No documents uploaded yet.'}
              </div>
            )}
          </div>

          {/* Collapsible Raw OCR Output Inspector */}
          <div className="border-t border-slate-200 bg-white">
            <button
              type="button"
              onClick={() => setShowRawText((s) => !s)}
              className="w-full px-4 py-2.5 flex items-center justify-between text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors cursor-pointer"
            >
              <span className="flex items-center gap-1.5">
                <ScanText className="w-3.5 h-3.5 text-slate-500" />
                <span>{copy.rawTextBtn}</span>
              </span>
              {showRawText ? (
                <ChevronUp className="w-4 h-4 text-slate-400" />
              ) : (
                <ChevronDown className="w-4 h-4 text-slate-400" />
              )}
            </button>

            {showRawText && (
              <div className="px-4 pb-4 pt-1 border-t border-slate-100">
                <pre className="text-[11px] leading-relaxed font-mono text-slate-700 bg-slate-50 border border-slate-200 rounded-lg p-3 max-h-56 overflow-auto whitespace-pre-wrap break-words">
                  {rawTextPreview && rawTextPreview.trim().length > 0
                    ? rawTextPreview
                    : isKm
                    ? 'មិនមានអក្សរ Raw OCR ត្រូវបានកត់ត្រាទេ (អ្នកអាចចុច Re-scan OCR ឬកែដោយដៃខាងស្តាំ)។'
                    : 'No raw OCR text captured yet. Click Re-scan OCR or edit fields manually on the right.'}
                </pre>
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Editable Verified Fields with Confidence Scores */}
        <div className="lg:col-span-7 bg-white rounded-2xl border border-slate-200 shadow-xs divide-y divide-slate-200">
          {fieldFilter === 'review' && confidenceStats.needsAttention === 0 && (
            <div className="p-8 text-center space-y-3">
              <div className="w-10 h-10 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-600 flex items-center justify-center mx-auto">
                <ShieldCheck className="w-5 h-5" />
              </div>
              <div className="space-y-1">
                <h3 className="text-sm font-bold text-slate-900">
                  {isKm
                    ? 'គ្រប់ប្រអប់ទិន្នន័យសុទ្ធតែមានកម្រិតទំនុកចិត្តខ្ពស់!'
                    : isKo
                    ? '모든 추출 항목의 신뢰도가 높습니다!'
                    : 'All extracted fields have high confidence!'}
                </h3>
                <p className="text-xs text-slate-600">
                  {isKm
                    ? 'មិនមានទិន្នន័យកម្រិតទាប ឬខ្វះចន្លោះត្រូវការកែសម្រួលបន្ថែមទេ។'
                    : isKo
                    ? '수동 확인이 필요한 저신뢰·누락 항목이 없습니다.'
                    : 'No low-confidence or missing fields require attention.'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setFieldFilter('all')}
                className="px-4 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold transition-colors cursor-pointer"
              >
                {isKm ? 'បង្ហាញគ្រប់ប្រអប់ទាំងអស់' : isKo ? '전체 항목 보기' : 'Show All Fields'}
              </button>
            </div>
          )}

          {/* Group 1: ARC Front / Applicant Identity */}
          {showGroup1 && (
            <section className="p-5 sm:p-6 space-y-4">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                  <UserCheck className="w-4 h-4 text-indigo-600 shrink-0" />
                  <span>
                    {isKm
                      ? '១. ព័ត៌មានផ្ទាល់ខ្លួន & កាត ARC ខាងមុខ (성명 / 외국인등록번호)'
                      : isKo
                      ? '1. 인적사항 및 외국인등록증 앞면'
                      : '1. Identity & ARC Front Information'}
                  </span>
                </h3>
                <button
                  type="button"
                  onClick={() => setSelectedDocTab('arcFront')}
                  className="text-[11px] font-semibold text-indigo-600 hover:underline cursor-pointer whitespace-nowrap"
                >
                  {isKm ? 'មើលរូប ARC មុខ' : isKo ? '앞면 보기' : 'View ARC Front'}
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* Full Name */}
                {shouldShowField('name') && (
                  <div className="sm:col-span-2 space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <label className="block text-xs font-semibold text-slate-700">
                        {isKm ? 'ឈ្មោះពេញជាអក្សរឡាតាំង (성명)' : isKo ? '성명 (영문 대문자)' : 'Full Name (성명)'}
                      </label>
                      <ConfidenceInlineMeter confidence={liveConfidence.name} lang={lang} />
                    </div>
                    <input
                      type="text"
                      value={draft.name || ''}
                      placeholder="EANG VEASNA"
                      onChange={(e) => {
                        markEdited('name');
                        setDraft((p) => ({ ...p, name: e.target.value.toUpperCase() }));
                      }}
                      className={`w-full px-3 py-2 rounded-lg border text-sm font-semibold text-slate-900 uppercase focus:outline-hidden focus:ring-2 ${getFieldSurfaceClass('name')}`}
                    />
                    {renderFieldReasonHint('name')}
                  </div>
                )}

                {/* ARC Number */}
                {shouldShowField('regNumber') && (
                  <div className="space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <label className="block text-xs font-semibold text-slate-700">
                        {isKm ? 'លេខកាត ARC (외국인등록번호)' : isKo ? '외국인등록번호' : 'ARC Reg. No.'}
                      </label>
                      <ConfidenceInlineMeter confidence={liveConfidence.regNumber} lang={lang} />
                    </div>
                    <div className="flex items-center gap-1.5">
                      <input
                        type="text"
                        maxLength={6}
                        value={draft.regNumber1 || ''}
                        placeholder="YYMMDD"
                        onChange={(e) => {
                          markEdited('regNumber');
                          setDraft((p) => ({ ...p, regNumber1: e.target.value.replace(/[^0-9]/g, '').slice(0, 6) }));
                        }}
                        className={`w-full px-2.5 py-2 rounded-lg border text-sm font-mono font-semibold text-center tabular-nums text-slate-900 focus:outline-hidden focus:ring-2 ${getFieldSurfaceClass('regNumber')}`}
                      />
                      <span className="text-slate-400 font-bold">-</span>
                      <input
                        type="text"
                        maxLength={7}
                        value={draft.regNumber2 || ''}
                        placeholder="5XXXXXX"
                        onChange={(e) => {
                          markEdited('regNumber');
                          const val = e.target.value.replace(/[^0-9]/g, '').slice(0, 7);
                          const d = val.charAt(0);
                          const inferredGender = ['2', '4', '6', '8'].includes(d)
                            ? '여'
                            : ['1', '3', '5', '7'].includes(d)
                            ? '남'
                            : draft.gender;
                          setDraft((p) => ({ ...p, regNumber2: val, gender: inferredGender }));
                        }}
                        className={`w-full px-2.5 py-2 rounded-lg border text-sm font-mono font-semibold text-center tabular-nums text-slate-900 focus:outline-hidden focus:ring-2 ${getFieldSurfaceClass('regNumber')}`}
                      />
                    </div>
                    {renderFieldReasonHint('regNumber')}
                  </div>
                )}

                {/* Gender */}
                {shouldShowField('gender') && (
                  <div className="space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <label className="block text-xs font-semibold text-slate-700">
                        {isKm ? 'ភេទ (성별)' : isKo ? '성별' : 'Gender (성별)'}
                      </label>
                      <ConfidenceInlineMeter confidence={liveConfidence.gender} lang={lang} />
                    </div>
                    <select
                      value={draft.gender || ''}
                      onChange={(e) => {
                        markEdited('gender');
                        setDraft((p) => ({ ...p, gender: e.target.value as '남' | '여' | '' }));
                      }}
                      className={`w-full px-3 py-2 rounded-lg border text-sm font-semibold text-slate-900 focus:outline-hidden focus:ring-2 cursor-pointer ${getFieldSurfaceClass('gender')}`}
                    >
                      <option value="">-- {isKm ? 'ជ្រើសរើស' : isKo ? '선택' : 'Select'} --</option>
                      <option value="남">남 (Male / ប្រុស)</option>
                      <option value="여">여 (Female / ស្រី)</option>
                    </select>
                    {renderFieldReasonHint('gender')}
                  </div>
                )}

                {/* Nationality */}
                {shouldShowField('nationality') && (
                  <div className="space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <label className="block text-xs font-semibold text-slate-700">
                        {isKm ? 'សញ្ជាតិ (국적)' : isKo ? '국적' : 'Nationality (국적)'}
                      </label>
                      <ConfidenceInlineMeter confidence={liveConfidence.nationality} lang={lang} />
                    </div>
                    <input
                      type="text"
                      value={draft.nationality || ''}
                      placeholder="Cambodia"
                      onChange={(e) => {
                        markEdited('nationality');
                        setDraft((p) => ({ ...p, nationality: e.target.value }));
                      }}
                      className={`w-full px-3 py-2 rounded-lg border text-sm font-semibold text-slate-900 focus:outline-hidden focus:ring-2 ${getFieldSurfaceClass('nationality')}`}
                    />
                    {renderFieldReasonHint('nationality')}
                  </div>
                )}

                {/* Visa Status */}
                {shouldShowField('visaStatus') && (
                  <div className="space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <label className="block text-xs font-semibold text-slate-700">
                        {isKm ? 'វីសា (체류자격)' : isKo ? '체류자격' : 'Visa Status'}
                      </label>
                      <ConfidenceInlineMeter confidence={liveConfidence.visaStatus} lang={lang} />
                    </div>
                    <select
                      value={draft.visaStatus || ''}
                      onChange={(e) => {
                        markEdited('visaStatus');
                        setDraft((p) => ({ ...p, visaStatus: e.target.value }));
                      }}
                      className={`w-full px-3 py-2 rounded-lg border text-sm font-semibold text-slate-900 focus:outline-hidden focus:ring-2 cursor-pointer ${getFieldSurfaceClass('visaStatus')}`}
                    >
                      <option value="">-- {isKm ? 'ជ្រើសរើសវីសា' : isKo ? '체류자격 선택' : 'Select Visa'} --</option>
                      {draft.visaStatus && !ALL_VISA_CODES.includes(draft.visaStatus) && (
                        <option value={draft.visaStatus}>{draft.visaStatus}</option>
                      )}
                      {KOREAN_VISA_GROUPS.map((group) => (
                        <optgroup key={group.groupName} label={group.groupNameKo}>
                          {group.items.map((item) => (
                            <option key={item.code} value={item.code}>
                              {item.labelKo}
                            </option>
                          ))}
                        </optgroup>
                      ))}
                    </select>
                    {renderFieldReasonHint('visaStatus')}
                  </div>
                )}
              </div>
            </section>
          )}

          {/* Group 2: ARC Back / 체류지 */}
          {showGroup2 && (
            <section className="p-5 sm:p-6 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                  <MapPin className="w-4 h-4 text-blue-600 shrink-0" />
                  <span>
                    {isKm
                      ? '២. អាសយដ្ឋានស្នាក់នៅលើកាត ARC ខាងក្រោយ (체류지)'
                      : isKo
                      ? '2. 외국인등록증 뒷면 체류지 (최신 신고일 기준)'
                      : '2. Residence Address from ARC Back (체류지)'}
                  </span>
                </h3>
                <button
                  type="button"
                  onClick={() => setSelectedDocTab('arcBack')}
                  className="text-[11px] font-semibold text-blue-600 hover:underline cursor-pointer whitespace-nowrap"
                >
                  {isKm ? 'មើលរូប ARC ក្រោយ' : isKo ? '뒷면 보기' : 'View ARC Back'}
                </button>
              </div>

              <div className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <label className="block text-xs font-semibold text-slate-700">
                    체류지 ({isKm ? 'អាសយដ្ឋានពេញលេញជាភាសាកូរ៉េ — ជួរចុងក្រោយថ្មីបំផុត' : isKo ? '최신 체류지 도로명 주소' : 'Full Korean Residence Address'})
                  </label>
                  <div className="flex items-center gap-2.5">
                    <ConfidenceInlineMeter confidence={liveConfidence.address} lang={lang} />
                    <button
                      type="button"
                      onClick={() => setIsDaumModalOpen(true)}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-[11px] font-semibold whitespace-nowrap shrink-0 cursor-pointer transition-colors"
                    >
                      <Search className="w-3 h-3" />
                      <span>
                        {isKm
                          ? 'ស្វែងរកតាម Daum'
                          : isKo
                            ? 'Daum 주소검색'
                            : 'Daum Postcode'}
                      </span>
                    </button>
                  </div>
                </div>
                <textarea
                  rows={2}
                  value={draft.address || ''}
                  placeholder="예: 경기도 안산시 단원구 원곡로 12, 101호"
                  onChange={(e) => {
                    markEdited('address');
                    setDraft((p) => ({ ...p, address: e.target.value }));
                  }}
                  className={`w-full px-3 py-2 rounded-lg border text-sm font-semibold text-slate-900 focus:outline-hidden focus:ring-2 ${getFieldSurfaceClass('address', 'focus:ring-blue-500')}`}
                />
                {renderFieldReasonHint('address')}

                {matchedOffice ? (
                  <p className="text-xs text-emerald-700 font-medium flex items-center gap-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                    <span>
                      {isKm ? 'ការិយាល័យទទួលបន្ទុក៖' : isKo ? '관할 출입국관서:' : 'Jurisdiction:'}{' '}
                      <strong className="font-semibold">{matchedOffice.name}</strong> ({matchedOffice.email})
                    </span>
                  </p>
                ) : (
                  <p className="text-xs text-amber-700 font-medium flex items-center gap-1.5">
                    <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                    <span>
                      {isKm
                        ? 'បើប្រអប់ 체류지 ទទេ ឬខុសអក្សរ សូមមើលរូបកាត ARC ខាងក្រោយនៅខាងឆ្វេង រួចវាយកែតម្រូវដោយផ្ទាល់។'
                        : isKo
                        ? '체류지가 비어 있거나 오인식된 경우 왼쪽 등록증 뒷면 이미지를 보고 직접 수정해 주세요.'
                        : 'If 체류지 is missing or incomplete, check the ARC Back preview on the left and enter it directly.'}
                    </span>
                  </p>
                )}
              </div>
            </section>
          )}

          {/* Group 3: TOPIK Score Certificate */}
          {showGroup3 && (
            <section className="p-5 sm:p-6 space-y-4">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                  <Award className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span>
                    {isKm
                      ? '៣. ព័ត៌មានសញ្ញាបត្រ TOPIK (시험일 · 성적유효기간 · 회)'
                      : isKo
                      ? '3. TOPIK 성적증명서 정보 (시험일 · 유효기간 · 회차)'
                      : '3. TOPIK Certificate Details (시험일 · 성적유효기간 · 회)'}
                  </span>
                </h3>
                <button
                  type="button"
                  onClick={() => setSelectedDocTab('topik')}
                  className="text-[11px] font-semibold text-emerald-700 hover:underline cursor-pointer whitespace-nowrap"
                >
                  {isKm ? 'មើលរូប TOPIK' : isKo ? '성적증명서 보기' : 'View TOPIK Cert'}
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* Document Verification No (16 digits) */}
                {shouldShowField('docVerificationNo') && (
                  <div className="sm:col-span-2 space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <label className="block text-xs font-semibold text-slate-700">
                        문서확인번호 ({isKm ? 'លេខផ្ទៀងផ្ទាត់ ១៦ ខ្ទង់' : isKo ? '16자리 문서확인번호' : '16-Digit Verification No.'})
                      </label>
                      <ConfidenceInlineMeter confidence={liveConfidence.docVerificationNo} lang={lang} />
                    </div>
                    <div className="grid grid-cols-4 gap-2">
                      {[0, 1, 2, 3].map((idx) => (
                        <input
                          key={idx}
                          type="text"
                          maxLength={idx === 0 ? 16 : 4}
                          value={docParts[idx]}
                          placeholder="0000"
                          onChange={(e) => handleDocPartInput(idx, e.target.value)}
                          className={`w-full px-2 py-2 rounded-lg border text-center font-mono text-sm font-semibold tabular-nums text-slate-900 focus:outline-hidden focus:ring-2 ${getFieldSurfaceClass('docVerificationNo', 'focus:ring-emerald-500')}`}
                        />
                      ))}
                    </div>
                    {renderFieldReasonHint('docVerificationNo')}
                  </div>
                )}

                {/* Exam Number */}
                {shouldShowField('examNumber') && (
                  <div className="space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <label className="block text-xs font-semibold text-slate-700">
                        수험번호 ({isKm ? 'លេខប្រឡង' : isKo ? '수험번호' : 'Exam No.'})
                      </label>
                      <ConfidenceInlineMeter confidence={liveConfidence.examNumber} lang={lang} />
                    </div>
                    <input
                      type="text"
                      value={draft.examNumber || ''}
                      placeholder="0010197000017"
                      onChange={(e) => {
                        markEdited('examNumber');
                        setDraft((p) => ({ ...p, examNumber: e.target.value.replace(/[^0-9]/g, '') }));
                      }}
                      className={`w-full px-3 py-2 rounded-lg border font-mono text-sm font-semibold tabular-nums text-slate-900 focus:outline-hidden focus:ring-2 ${getFieldSurfaceClass('examNumber', 'focus:ring-emerald-500')}`}
                    />
                    {renderFieldReasonHint('examNumber')}
                  </div>
                )}

                {/* Round (회) */}
                {shouldShowField('round') && (
                  <div className="space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <label className="block text-xs font-semibold text-slate-700">
                        회 / 회차 ({isKm ? 'លើកទី' : isKo ? '회차' : 'Round'})
                      </label>
                      <ConfidenceInlineMeter confidence={liveConfidence.round} lang={lang} />
                    </div>
                    <div className="relative flex items-center">
                      <input
                        type="text"
                        inputMode="numeric"
                        maxLength={3}
                        value={draft.round || ''}
                        placeholder="96"
                        onChange={(e) => {
                          markEdited('round');
                          setDraft((p) => ({ ...p, round: e.target.value.replace(/[^0-9]/g, '').slice(0, 3) }));
                        }}
                        className={`w-full pl-3 pr-10 py-2 rounded-lg border font-mono text-sm font-semibold tabular-nums text-slate-900 focus:outline-hidden focus:ring-2 ${getFieldSurfaceClass('round', 'focus:ring-emerald-500')}`}
                      />
                      <span className="absolute right-3 text-xs font-bold text-slate-500 pointer-events-none">회</span>
                    </div>
                    {renderFieldReasonHint('round')}
                  </div>
                )}

                {/* Exam Date (시험일) */}
                {shouldShowField('examDate') && (
                  <div className="space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <label className="block text-xs font-semibold text-slate-700">
                        시험일 ({isKm ? 'ថ្ងៃប្រឡង' : isKo ? '시험일' : 'Exam Date'})
                      </label>
                      <ConfidenceInlineMeter confidence={liveConfidence.examDate} lang={lang} />
                    </div>
                    <input
                      type="date"
                      value={draft.examDate || ''}
                      onChange={(e) => {
                        markEdited('examDate');
                        setDraft((p) => ({ ...p, examDate: e.target.value }));
                      }}
                      className={`w-full px-3 py-2 rounded-lg border font-mono text-sm font-semibold tabular-nums text-slate-900 focus:outline-hidden focus:ring-2 ${getFieldSurfaceClass('examDate', 'focus:ring-emerald-500')}`}
                    />
                    {renderFieldReasonHint('examDate')}
                  </div>
                )}

                {/* Valid Until (성적유효기간) */}
                {shouldShowField('validUntil') && (
                  <div className="space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <label className="block text-xs font-semibold text-slate-700">
                        성적유효기간 ({isKm ? 'សុពលភាព' : isKo ? '유효기간' : 'Valid Until'})
                      </label>
                      <ConfidenceInlineMeter confidence={liveConfidence.validUntil} lang={lang} />
                    </div>
                    <input
                      type="date"
                      value={draft.validUntil || ''}
                      onChange={(e) => {
                        markEdited('validUntil');
                        setDraft((p) => ({ ...p, validUntil: e.target.value }));
                      }}
                      className={`w-full px-3 py-2 rounded-lg border font-mono text-sm font-semibold tabular-nums text-rose-700 focus:outline-hidden focus:ring-2 ${getFieldSurfaceClass('validUntil', 'focus:ring-emerald-500')}`}
                    />
                    {renderFieldReasonHint('validUntil')}
                  </div>
                )}

                {/* Grade (등급) */}
                {shouldShowField('grade') && (
                  <div className="space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <label className="block text-xs font-semibold text-slate-700">
                        등급 ({isKm ? 'កម្រិត' : isKo ? '등급' : 'Grade'})
                      </label>
                      <ConfidenceInlineMeter confidence={liveConfidence.grade} lang={lang} />
                    </div>
                    <select
                      value={draft.grade || ''}
                      onChange={(e) => {
                        markEdited('grade');
                        setDraft((p) => ({ ...p, grade: e.target.value }));
                      }}
                      className={`w-full px-3 py-2 rounded-lg border text-sm font-semibold text-slate-900 focus:outline-hidden focus:ring-2 cursor-pointer ${getFieldSurfaceClass('grade', 'focus:ring-emerald-500')}`}
                    >
                      <option value="">-- {isKm ? 'ជ្រើសរើសកម្រិត' : isKo ? '등급 선택' : 'Select Grade'} --</option>
                      <option value="1급">1급 (Level 1)</option>
                      <option value="2급">2급 (Level 2)</option>
                      <option value="3급">3급 (Level 3)</option>
                      <option value="4급">4급 (Level 4)</option>
                      <option value="5급">5급 (Level 5)</option>
                      <option value="6급">6급 (Level 6)</option>
                    </select>
                    {renderFieldReasonHint('grade')}
                  </div>
                )}
              </div>
            </section>
          )}

          {/* Group 4: Passport */}
          {showGroup4 && (
            <section className="p-5 sm:p-6 space-y-4">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                  <BookOpenCheck className="w-4 h-4 text-slate-700 shrink-0" />
                  <span>
                    {isKm
                      ? '៤. លិខិតឆ្លងដែន (여권번호 / 유효기간)'
                      : isKo
                      ? '4. 여권 정보'
                      : '4. Passport Details'}
                  </span>
                </h3>
                <button
                  type="button"
                  onClick={() => setSelectedDocTab('passport')}
                  className="text-[11px] font-semibold text-slate-600 hover:underline cursor-pointer whitespace-nowrap"
                >
                  {isKm ? 'មើលរូបលិខិតឆ្លងដែន' : isKo ? '여권 보기' : 'View Passport'}
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {shouldShowField('passportNo') && (
                  <div className="space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <label className="block text-xs font-semibold text-slate-700">
                        여권번호 ({isKm ? 'លេខលិខិតឆ្លងដែន' : isKo ? '여권번호' : 'Passport No.'})
                      </label>
                      <ConfidenceInlineMeter confidence={liveConfidence.passportNo} lang={lang} />
                    </div>
                    <input
                      type="text"
                      value={draft.passportNo || ''}
                      placeholder="N01847291"
                      onChange={(e) => {
                        markEdited('passportNo');
                        setDraft((p) => ({
                          ...p,
                          passportNo: e.target.value.replace(/[^A-Za-z0-9]/g, '').toUpperCase(),
                        }));
                      }}
                      className={`w-full px-3 py-2 rounded-lg border font-mono text-sm font-semibold tabular-nums uppercase text-slate-900 focus:outline-hidden focus:ring-2 ${getFieldSurfaceClass('passportNo')}`}
                    />
                    {renderFieldReasonHint('passportNo')}
                  </div>
                )}

                {shouldShowField('passportExpiry') && (
                  <div className="space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <label className="block text-xs font-semibold text-slate-700">
                        여권 유효기간 ({isKm ? 'ថ្ងៃផុតកំណត់' : isKo ? '유효기간' : 'Expiry Date'})
                      </label>
                      <ConfidenceInlineMeter confidence={liveConfidence.passportExpiry} lang={lang} />
                    </div>
                    <input
                      type="date"
                      value={draft.passportExpiry || ''}
                      onChange={(e) => {
                        markEdited('passportExpiry');
                        setDraft((p) => ({ ...p, passportExpiry: e.target.value }));
                      }}
                      className={`w-full px-3 py-2 rounded-lg border font-mono text-sm font-semibold tabular-nums text-slate-900 focus:outline-hidden focus:ring-2 ${getFieldSurfaceClass('passportExpiry')}`}
                    />
                    {renderFieldReasonHint('passportExpiry')}
                  </div>
                )}
              </div>
            </section>
          )}
        </div>
      </div>

      {/* Bottom Navigation & Confirm Injection CTA */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 pt-2">
        <button
          type="button"
          onClick={onBack}
          className="px-5 py-3 rounded-xl border border-slate-300 bg-white hover:bg-slate-100 text-slate-700 text-sm font-semibold inline-flex items-center justify-center gap-2 transition-colors cursor-pointer whitespace-nowrap shrink-0"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>{copy.backBtn}</span>
        </button>

        <button
          type="button"
          onClick={() => onConfirmInject(draft)}
          className="px-7 py-3.5 rounded-xl bg-blue-600 hover:bg-blue-700 active:scale-[0.99] text-white text-sm font-bold shadow-md inline-flex items-center justify-center gap-2 transition-all cursor-pointer whitespace-nowrap shrink-0"
        >
          <span>{copy.confirmBtn}</span>
          <ArrowRight className="w-4 h-4" />
        </button>
      </div>

      <DaumPostcodeModal
        isOpen={isDaumModalOpen}
        onClose={() => setIsDaumModalOpen(false)}
        onSelectAddress={(fullAddress) => {
          markEdited('address');
          setDraft((p) => ({ ...p, address: fullAddress }));
        }}
        initialQuery={
          draft.address && !draft.address.startsWith('00000')
            ? draft.address
            : ''
        }
        lang={lang}
      />
    </div>
  );
};
