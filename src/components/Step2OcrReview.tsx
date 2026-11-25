import React, { useState, useEffect, useMemo, useRef } from 'react';
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
  RotateCw,
  FileText,
  ZoomIn,
  ZoomOut,
  ScanText,
  MapPin,
  Award,
  UserCheck,
  BookOpenCheck,
  ShieldCheck,
  Search,
  Copy,
  Check,
  Columns2,
  Image as ImageIcon,
  Undo2,
  Maximize2,
  Calendar,
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
  isStep1Ready?: boolean;
  missingStep1Count?: number;
  onRescanOcr: () => Promise<void> | void;
  onBack: () => void;
  onConfirmInject: (confirmedDraft: ExtractedDocumentData) => void;
}

type DocTabId = 'arcFront' | 'arcBack' | 'topik' | 'passport';
type FieldFilterMode = 'all' | 'review' | 'edited';
type LeftPaneMode = 'split' | 'image' | 'text';

const ALL_CONFIDENCE_KEYS: OcrConfidenceKey[] = [
  'name',
  'regNumber',
  'entryDate',
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
        : 'Verified'
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
      : 'Empty';

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
      ? 'Manual Verification'
      : 'Not Extracted';

  const barColor =
    tier === 'manual'
      ? 'bg-blue-600'
      : tier === 'high'
      ? 'bg-emerald-600'
      : tier === 'medium'
      ? 'bg-amber-500'
      : tier === 'low'
      ? 'bg-rose-600'
      : 'bg-slate-300';

  const textColor =
    tier === 'manual'
      ? 'text-blue-700'
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
        className="w-10 h-1.5 bg-slate-200 rounded-xs overflow-hidden inline-block shrink-0"
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
  isStep1Ready = true,
  missingStep1Count = 0,
  onRescanOcr,
  onBack,
  onConfirmInject,
}) => {
  const isKm = lang === 'km';
  const isKo = lang === 'ko';

  // Track which fields the user has manually edited in the Verification Step
  const [editedKeys, setEditedKeys] = useState<Set<OcrConfidenceKey>>(() => new Set());
  const [fieldFilter, setFieldFilter] = useState<FieldFilterMode>('all');
  const [leftPaneMode, setLeftPaneMode] = useState<LeftPaneMode>('split');
  const [activeFieldLabel, setActiveFieldLabel] = useState<string>('');
  const [isDaumModalOpen, setIsDaumModalOpen] = useState(false);
  const [copiedRaw, setCopiedRaw] = useState(false);

  // Refs for quick jump & focus from the readiness strip
  const fieldRefs = useRef<Partial<Record<OcrConfidenceKey, HTMLElement | null>>>({});

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

  const clearEdited = (key: OcrConfidenceKey) => {
    setEditedKeys((prev) => {
      if (!prev.has(key)) return prev;
      const next = new Set(prev);
      next.delete(key);
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
      editedCount: editedKeys.size,
    };
  }, [liveConfidence, editedKeys.size]);

  const shouldShowField = (key: OcrConfidenceKey): boolean => {
    if (fieldFilter === 'all') return true;
    if (fieldFilter === 'edited') return editedKeys.has(key);
    const tier = getConfidenceTier(liveConfidence[key]);
    return tier === 'medium' || tier === 'low' || tier === 'missing';
  };

  const getFieldSurfaceClass = (key: OcrConfidenceKey, focusColor: string = 'focus:ring-blue-500'): string => {
    const tier = getConfidenceTier(liveConfidence[key]);
    if (tier === 'low' || tier === 'missing') {
      return 'border-rose-300 bg-rose-50/35 focus:ring-rose-500 focus:border-rose-500';
    }
    if (tier === 'medium') {
      return 'border-amber-300 bg-amber-50/35 focus:ring-amber-500 focus:border-amber-500';
    }
    if (tier === 'manual') {
      return `border-blue-300 bg-blue-50/20 ${focusColor}`;
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

  const [selectedDocTab, setSelectedDocTab] = useState<DocTabId>('arcFront');
  const [previewZoom, setPreviewZoom] = useState<number>(1);
  const [previewRotation, setPreviewRotation] = useState<number>(0);
  const [pdfPreviewCache, setPdfPreviewCache] = useState<Record<string, string>>({});
  const [isRenderingPdf, setIsRenderingPdf] = useState<boolean>(false);

  useEffect(() => {
    if (availableDocs.length === 0) return;
    if (!availableDocs.some((d) => d.id === selectedDocTab)) {
      setSelectedDocTab(availableDocs[0].id);
    }
  }, [availableDocs, selectedDocTab]);

  // Smoothly link focused form fields to the matching original document image
  const focusSourceDoc = (preferredTab: DocTabId, fieldLabel: string, fallbackTab?: DocTabId) => {
    setActiveFieldLabel(fieldLabel);
    if (availableDocs.some((d) => d.id === preferredTab)) {
      if (selectedDocTab !== preferredTab) {
        setSelectedDocTab(preferredTab);
        setPreviewZoom(1);
        setPreviewRotation(0);
      }
    } else if (fallbackTab && availableDocs.some((d) => d.id === fallbackTab)) {
      if (selectedDocTab !== fallbackTab) {
        setSelectedDocTab(fallbackTab);
        setPreviewZoom(1);
        setPreviewRotation(0);
      }
    }
  };

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

  // Build readable structured OCR text summary fallback when raw OCR text is empty (e.g., Gemini structured JSON or SVG)
  const effectiveExtractedText = useMemo(() => {
    if (rawTextPreview && rawTextPreview.trim().length > 0) {
      return rawTextPreview.trim();
    }
    const lines: string[] = [];
    if (draft.name) lines.push(`Name (성명): ${draft.name}`);
    if (draft.regNumber1 || draft.regNumber2) {
      lines.push(`ARC Number (외국인등록번호): ${draft.regNumber1 || '______'}-${draft.regNumber2 || '_______'}`);
    }
    if (draft.entryDate) lines.push(`Entry Date (입국일): ${draft.entryDate}`);
    if (draft.gender) lines.push(`Gender (성별): ${draft.gender}`);
    if (draft.nationality) lines.push(`Nationality (국적): ${draft.nationality}`);
    if (draft.visaStatus) lines.push(`Visa Status (체류자격): ${draft.visaStatus}`);
    if (draft.address) lines.push(`Residence Address (체류지): ${draft.address}`);
    if (draft.passportNo) lines.push(`Passport No (여권번호): ${draft.passportNo}`);
    if (draft.passportExpiry) lines.push(`Passport Expiry (여권 유효기간): ${draft.passportExpiry}`);
    if (draft.round) lines.push(`TOPIK Round (회차): ${draft.round}회`);
    if (draft.examNumber) lines.push(`TOPIK Exam No (수험번호): ${draft.examNumber}`);
    if (draft.examDate) lines.push(`TOPIK Exam Date (시험일): ${draft.examDate}`);
    if (draft.validUntil) lines.push(`TOPIK Valid Until (성적유효기간): ${draft.validUntil}`);
    if (draft.grade) lines.push(`TOPIK Grade (등급): ${draft.grade}`);
    if (Array.isArray(draft.docVerificationNo) && draft.docVerificationNo.some(Boolean)) {
      lines.push(`Document Verification No (문서확인번호): ${draft.docVerificationNo.join('-')}`);
    }
    return lines.join('\n');
  }, [rawTextPreview, draft]);

  const handleCopyExtractedText = async () => {
    if (!effectiveExtractedText) return;
    try {
      await navigator.clipboard.writeText(effectiveExtractedText);
      setCopiedRaw(true);
      setTimeout(() => setCopiedRaw(false), 1800);
    } catch {
      // ignore clipboard errors
    }
  };

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

  const renderFieldRevertBtn = (
    key: OcrConfidenceKey,
    originalVal: string | undefined | null,
    onRevert: () => void
  ) => {
    if (!editedKeys.has(key) || !initialSnapshot) return null;
    const origDisplay = originalVal && originalVal.trim() ? originalVal : (isKm ? 'ទទេ' : isKo ? '비어 있음' : 'empty');
    return (
      <button
        type="button"
        onClick={() => {
          onRevert();
          clearEdited(key);
        }}
        title={`${isKm ? 'ត្រឡប់ទៅ OCR ដើម' : isKo ? 'OCR 원문으로 복원' : 'Revert to OCR value'}: ${origDisplay}`}
        className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-500 hover:text-slate-900 transition-colors cursor-pointer whitespace-nowrap shrink-0"
      >
        <Undo2 className="w-3 h-3" />
        <span>{isKm ? 'ដើម' : isKo ? '복원' : 'Revert'}</span>
      </button>
    );
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
      label: isKm ? 'ឈ្មោះ (Name)' : isKo ? '성명 (Name)' : 'Name',
      ok: Boolean(draft.name && draft.name.trim().length >= 2),
      tab: 'arcFront',
    },
    {
      key: 'arc',
      confKey: 'regNumber',
      label: isKm ? 'លេខ ARC' : isKo ? '등록번호' : 'ARC Number',
      ok: Boolean((draft.regNumber1 || '').length === 6 && (draft.regNumber2 || '').length === 7),
      tab: 'arcFront',
    },
    {
      key: 'entryDate',
      confKey: 'entryDate',
      label: isKm ? 'ថ្ងៃចូលកូរ៉េ (Entry)' : isKo ? '입국일' : 'Entry Date',
      ok: Boolean(draft.entryDate && /^\d{4}-\d{2}-\d{2}$/.test(draft.entryDate)),
      tab: 'arcFront',
    },
    {
      key: 'address',
      confKey: 'address',
      label: isKm ? '체류지 (អាសយដ្ឋាន)' : isKo ? '체류지' : 'Address',
      ok: Boolean(draft.address && draft.address.trim().length >= 5),
      tab: 'arcBack',
    },
    {
      key: 'examDate',
      confKey: 'examDate',
      label: isKm ? 'ថ្ងៃប្រឡង TOPIK' : isKo ? '시험일' : 'Exam Date',
      ok: Boolean(draft.examDate && /^\d{4}-\d{2}-\d{2}$/.test(draft.examDate)),
      tab: 'topik',
    },
    {
      key: 'validUntil',
      confKey: 'validUntil',
      label: isKm ? 'សុពលភាព TOPIK' : isKo ? '성적유효기간' : 'Valid Until',
      ok: Boolean(draft.validUntil && /^\d{4}-\d{2}-\d{2}$/.test(draft.validUntil)),
      tab: 'topik',
    },
    {
      key: 'round',
      confKey: 'round',
      label: isKm ? 'លើកទី (회)' : isKo ? '회차' : 'Round',
      ok: Boolean(draft.round && /^\d{1,3}$/.test(String(draft.round).trim())),
      tab: 'topik',
    },
  ];

  const readyCount = criticalChecks.filter((c) => c.ok).length;

  const handleJumpToCheck = (item: (typeof criticalChecks)[number]) => {
    setFieldFilter('all');
    focusSourceDoc(item.tab, item.label, item.confKey === 'entryDate' ? 'passport' : undefined);
    window.setTimeout(() => {
      const target = fieldRefs.current[item.confKey];
      if (target) {
        target.scrollIntoView({ behavior: 'smooth', block: 'center' });
        if ('focus' in target && typeof target.focus === 'function') {
          target.focus();
        }
      }
    }, 30);
  };

  const copy = {
    stepTag: isKm
      ? 'ជំហ៊ានទី ២ · ផ្ទៀងផ្ទាត់ OCR'
      : isKo
      ? '2단계 · OCR 검증'
      : 'Step 2 · Verification Step',
    title: isKm
      ? 'ផ្ទៀងផ្ទាត់ទិន្នន័យ OCR ទល់មុខឯកសារដើម'
      : isKo
      ? '원본 서류와 OCR 추출 텍스트 나란히 비교·검증'
      : 'Side-by-Side Document & OCR Verification',
    subtitle: isKm
      ? 'ផ្ទៀងផ្ទាត់រូបភាពឯកសារដើម និងអក្សរដែល OCR ស្កេនបាននៅខាងឆ្វេង រួចកែសម្រួលឈ្មោះ លេខ ARC ថ្ងៃចូលកូរ៉េ និងព័ត៌មានផ្សេងៗដោយផ្ទាល់នៅខាងស្តាំ មុនបញ្ចូលទៅក្នុងទម្រង់ផ្លូវការ ដើម្បីធានាភាពត្រឹមត្រូវ ១០០%។'
      : isKo
      ? '왼쪽에서 원본 서류 이미지와 추출된 텍스트를 확인하고, 오른쪽에서 성명·외국인등록번호·입국일 등 항목을 직접 수정한 뒤 공식 신청서에 100% 정확하게 반영하세요.'
      : 'Compare your original document image and extracted OCR text on the left against the editable fields on the right. Edit Name, ARC Number, Entry Date, and other details directly before injecting them into the official application form.',
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
      ? 'ត្រឡប់ទៅ OCR ដើម'
      : isKo
      ? 'OCR 원문 복원'
      : 'Reset to OCR',
    backBtn: isKm ? 'ត្រឡប់ទៅជំហ៊ានទី ១' : isKo ? '1단계 서류 업로드' : 'Back to Upload',
    confirmBtn: isKm
      ? 'បន្តទៅជំហាន 2.5: ពិនិត្យ និងកែតម្រូវ'
      : isKo
      ? '2.5단계(검토 및 수정)로 이동'
      : 'Continue to Step 2.5: Review & Correct',
    viewerTitle: isKm
      ? 'ឯកសារដើម & អក្សរ OCR'
      : isKo
      ? '원본 이미지 및 추출 텍스트'
      : 'Original Document & Extracted Text',
    rawTextHeading: isKm
      ? 'អក្សរដែល OCR ចាប់បាន (Extracted Text)'
      : isKo
      ? '추출된 OCR 텍스트 (Extracted Text)'
      : 'Extracted OCR Text',
  };

  const showGroup1 =
    shouldShowField('name') ||
    shouldShowField('regNumber') ||
    shouldShowField('entryDate') ||
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

  const noFilteredResults = !showGroup1 && !showGroup2 && !showGroup3 && !showGroup4;

  return (
    <div className="space-y-5 pb-14">
      {/* Header Surface (Single Elevation, Flat Hairline Border) */}
      <div className="bg-white rounded-xl border border-slate-200 p-5 sm:p-6 space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
          <div className="space-y-1.5 min-w-0">
            <div className="flex flex-wrap items-center gap-2 text-xs font-medium text-slate-500">
              <span className="font-semibold text-blue-700">{copy.stepTag}</span>
              <span aria-hidden="true" className="text-slate-300">·</span>
              <span className="font-mono text-slate-700 tabular-nums">
                {readyCount}/{criticalChecks.length} {isKm ? 'ចំណុចសំខាន់រួចរាល់' : isKo ? '핵심 항목 완료' : 'key fields ready'}
              </span>
              <span aria-hidden="true" className="text-slate-300">·</span>
              <span className="font-mono text-slate-700 tabular-nums">
                {isKm ? 'ទំនុកចិត្តមធ្យម' : isKo ? '평균 신뢰도' : 'Avg confidence'} {confidenceStats.avg}%
              </span>
              {confidenceStats.editedCount > 0 && (
                <>
                  <span aria-hidden="true" className="text-slate-300">·</span>
                  <span className="font-mono text-blue-700 font-semibold tabular-nums">
                    {confidenceStats.editedCount} {isKm ? 'បានកែដោយដៃ' : isKo ? '수동 수정됨' : 'edited'}
                  </span>
                </>
              )}
            </div>
            <h2 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight text-balance">
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
              className="px-4 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 disabled:opacity-60 text-white text-xs font-semibold inline-flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isScanning ? 'animate-spin' : ''}`} />
              <span>{copy.rescanBtn}</span>
            </button>

            {initialSnapshot && (
              <button
                type="button"
                onClick={() => {
                  setDraft(initialSnapshot);
                  setEditedKeys(new Set());
                }}
                className="px-3.5 py-2 rounded-lg bg-white hover:bg-slate-50 text-slate-700 border border-slate-300 text-xs font-semibold inline-flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap shrink-0"
              >
                <RotateCcw className="w-3.5 h-3.5 text-slate-500" />
                <span>{copy.resetBtn}</span>
              </button>
            )}
          </div>
        </div>

        {/* Confidence Summary & Filter Controls */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-3 border-t border-slate-200/80">
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
              {confidenceStats.lowOrMissing} {isKm ? 'ទាប / ទទេ (<60%)' : isKo ? '낮음·누락 (<60%)' : 'Low / Empty (<60%)'}
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
                ? `ទាំងអស់ (${ALL_CONFIDENCE_KEYS.length})`
                : isKo
                ? `전체 (${ALL_CONFIDENCE_KEYS.length})`
                : `All (${ALL_CONFIDENCE_KEYS.length})`}
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
                ? `គួរពិនិត្យ (${confidenceStats.needsAttention})`
                : isKo
                ? `확인 필요 (${confidenceStats.needsAttention})`
                : `Needs Review (${confidenceStats.needsAttention})`}
            </button>
            <button
              type="button"
              onClick={() => setFieldFilter('edited')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0 tabular-nums ${
                fieldFilter === 'edited'
                  ? 'bg-white text-slate-900 shadow-2xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {isKm
                ? `បានកែ (${confidenceStats.editedCount})`
                : isKo
                ? `수정됨 (${confidenceStats.editedCount})`
                : `Edited (${confidenceStats.editedCount})`}
            </button>
          </div>
        </div>

        {/* Interactive Key-Field Quick-Jump Strip */}
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2 pt-3 border-t border-slate-100">
          {criticalChecks.map((item) => {
            const confScore = liveConfidence[item.confKey]?.score ?? 0;
            const tier = getConfidenceTier(liveConfidence[item.confKey]);
            const isHealthy = item.ok && (tier === 'high' || tier === 'manual');
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => handleJumpToCheck(item)}
                className={`px-2.5 py-2 rounded-lg border text-left text-xs transition-colors flex items-center justify-between gap-1.5 cursor-pointer ${
                  isHealthy
                    ? 'bg-emerald-50/60 border-emerald-200 text-emerald-950 hover:bg-emerald-50'
                    : tier === 'medium' && item.ok
                    ? 'bg-amber-50/70 border-amber-200 text-amber-950 hover:bg-amber-100/70'
                    : 'bg-rose-50/60 border-rose-200 text-rose-950 hover:bg-rose-100/60'
                }`}
              >
                <div className="min-w-0">
                  <div className="font-semibold truncate text-[11px]">{item.label}</div>
                  <div className="text-[10px] font-mono tabular-nums opacity-75">{confScore}%</div>
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
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        {/* LEFT PANE: Original Document Image + Extracted OCR Text */}
        <div className="lg:col-span-5 lg:sticky lg:top-24 bg-white rounded-xl border border-slate-200 overflow-hidden flex flex-col">
          {/* Viewer Toolbar */}
          <div className="px-4 py-3 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2 bg-slate-50/80">
            <div className="flex items-center gap-2 min-w-0">
              <FileText className="w-4 h-4 text-blue-600 shrink-0" />
              <div className="min-w-0">
                <h3 className="text-xs font-bold text-slate-900 truncate">{copy.viewerTitle}</h3>
                {activeFieldLabel && (
                  <p className="text-[11px] text-slate-500 truncate">
                    {isKm ? 'កំពុងផ្ទៀងផ្ទាត់៖' : isKo ? '비교 중인 항목:' : 'Checking:'} {activeFieldLabel}
                  </p>
                )}
              </div>
            </div>

            {/* Segmented Mode Switch: Split / Image / Text */}
            <div className="inline-flex items-center gap-0.5 p-0.5 bg-slate-200/70 rounded-lg shrink-0">
              <button
                type="button"
                onClick={() => setLeftPaneMode('split')}
                className={`px-2 py-1 rounded-md text-[11px] font-semibold inline-flex items-center gap-1 transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                  leftPaneMode === 'split' ? 'bg-white text-slate-900 shadow-2xs' : 'text-slate-600 hover:text-slate-900'
                }`}
                title={isKm ? 'បង្ហាញទាំងរូប និងអក្សរ OCR' : 'Show both document image and extracted text'}
              >
                <Columns2 className="w-3 h-3" />
                <span>{isKm ? 'ទាំងពីរ' : isKo ? '분할' : 'Split'}</span>
              </button>
              <button
                type="button"
                onClick={() => setLeftPaneMode('image')}
                className={`px-2 py-1 rounded-md text-[11px] font-semibold inline-flex items-center gap-1 transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                  leftPaneMode === 'image' ? 'bg-white text-slate-900 shadow-2xs' : 'text-slate-600 hover:text-slate-900'
                }`}
                title={isKm ? 'មើលតែរូបភាពឯកសារដើម' : 'Original document image only'}
              >
                <ImageIcon className="w-3 h-3" />
                <span>{isKm ? 'រូបភាព' : isKo ? '이미지' : 'Image'}</span>
              </button>
              <button
                type="button"
                onClick={() => setLeftPaneMode('text')}
                className={`px-2 py-1 rounded-md text-[11px] font-semibold inline-flex items-center gap-1 transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                  leftPaneMode === 'text' ? 'bg-white text-slate-900 shadow-2xs' : 'text-slate-600 hover:text-slate-900'
                }`}
                title={isKm ? 'មើលតែអក្សរ OCR' : 'Extracted OCR text only'}
              >
                <ScanText className="w-3 h-3" />
                <span>{isKm ? 'អក្សរ OCR' : isKo ? '텍스트' : 'Text'}</span>
              </button>
            </div>
          </div>

          {/* Document Switcher & Image Controls */}
          {leftPaneMode !== 'text' && (
            <div className="px-3 py-2 border-b border-slate-200 bg-white flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap gap-1">
                {availableDocs.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      setSelectedDocTab(item.id);
                      setPreviewZoom(1);
                      setPreviewRotation(0);
                    }}
                    className={`px-2.5 py-1 rounded-md text-[11px] font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                      selectedDocTab === item.id
                        ? 'bg-slate-900 text-white'
                        : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>

              <div className="flex items-center gap-1 shrink-0">
                <button
                  type="button"
                  onClick={() => setPreviewZoom((z) => Math.max(0.75, Number((z - 0.25).toFixed(2))))}
                  disabled={previewZoom <= 0.75}
                  className="p-1 rounded-md border border-slate-200 bg-white hover:bg-slate-100 disabled:opacity-40 text-slate-600 cursor-pointer"
                  title="Zoom Out"
                  aria-label="Zoom Out"
                >
                  <ZoomOut className="w-3.5 h-3.5" />
                </button>
                <span className="text-[11px] font-mono font-semibold text-slate-600 w-9 text-center tabular-nums">
                  {Math.round(previewZoom * 100)}%
                </span>
                <button
                  type="button"
                  onClick={() => setPreviewZoom((z) => Math.min(3, Number((z + 0.25).toFixed(2))))}
                  disabled={previewZoom >= 3}
                  className="p-1 rounded-md border border-slate-200 bg-white hover:bg-slate-100 disabled:opacity-40 text-slate-600 cursor-pointer"
                  title="Zoom In"
                  aria-label="Zoom In"
                >
                  <ZoomIn className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => setPreviewRotation((r) => (r + 90) % 360)}
                  className="p-1 rounded-md border border-slate-200 bg-white hover:bg-slate-100 text-slate-600 cursor-pointer"
                  title="Rotate 90°"
                  aria-label="Rotate 90 degrees"
                >
                  <RotateCw className="w-3.5 h-3.5" />
                </button>
                {(previewZoom !== 1 || previewRotation !== 0) && (
                  <button
                    type="button"
                    onClick={() => {
                      setPreviewZoom(1);
                      setPreviewRotation(0);
                    }}
                    className="p-1 rounded-md border border-slate-200 bg-white hover:bg-slate-100 text-slate-600 cursor-pointer"
                    title="Reset View"
                    aria-label="Reset View"
                  >
                    <Maximize2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Original Document Image Viewport */}
          {leftPaneMode !== 'text' && (
            <div
              className={`p-3 bg-slate-100/90 overflow-auto flex items-center justify-center ${
                leftPaneMode === 'image' ? 'min-h-[380px] max-h-[580px]' : 'min-h-[250px] max-h-[340px]'
              }`}
            >
              {activeDoc ? (
                isRenderingPdf ? (
                  <div className="flex flex-col items-center gap-2 text-xs text-slate-500 py-10">
                    <RefreshCw className="w-5 h-5 animate-spin text-blue-600" />
                    <span>{isKm ? 'កំពុងបង្ហាញទំព័រ PDF...' : 'Rendering PDF preview...'}</span>
                  </div>
                ) : resolvedPreviewSrc ? (
                  <img
                    src={resolvedPreviewSrc}
                    alt={activeDoc.label}
                    referrerPolicy="no-referrer"
                    style={{
                      transform: `scale(${previewZoom}) rotate(${previewRotation}deg)`,
                      transformOrigin: 'center center',
                    }}
                    className="max-w-full rounded-lg border border-slate-300 bg-white shadow-2xs transition-transform duration-150"
                  />
                ) : (
                  <div className="text-xs text-slate-500 py-8 text-center">
                    {activeDoc.fileName || activeDoc.label}
                  </div>
                )
              ) : (
                <div className="text-xs text-slate-500 py-12 text-center space-y-2">
                  <p>{isKm ? 'មិនទាន់មានឯកសារត្រូវបានបង្ហោះនៅឡើយទេ' : 'No documents uploaded yet.'}</p>
                  <button
                    type="button"
                    onClick={onBack}
                    className="px-3 py-1.5 rounded-lg bg-slate-900 text-white text-xs font-semibold cursor-pointer"
                  >
                    {copy.backBtn}
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Extracted OCR Text Panel (Visible by Default in Split & Text modes) */}
          {leftPaneMode !== 'image' && (
            <div className="border-t border-slate-200 bg-white flex flex-col">
              <div className="px-4 py-2.5 flex items-center justify-between gap-2 bg-slate-50/70 border-b border-slate-100">
                <div className="flex items-center gap-2 min-w-0">
                  <ScanText className="w-3.5 h-3.5 text-slate-600 shrink-0" />
                  <span className="text-xs font-bold text-slate-800 truncate">{copy.rawTextHeading}</span>
                </div>
                {effectiveExtractedText && (
                  <button
                    type="button"
                    onClick={handleCopyExtractedText}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-semibold text-slate-600 hover:text-slate-900 hover:bg-slate-200/70 transition-colors cursor-pointer whitespace-nowrap shrink-0"
                  >
                    {copiedRaw ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3" />}
                    <span>{copiedRaw ? (isKm ? 'បានចម្លង' : isKo ? '복사됨' : 'Copied') : (isKm ? 'ចម្លង' : isKo ? '복사' : 'Copy')}</span>
                  </button>
                )}
              </div>

              <div className="p-3">
                <pre
                  className={`text-[11px] leading-relaxed font-mono text-slate-700 bg-slate-50 border border-slate-200 rounded-lg p-3 overflow-auto whitespace-pre-wrap break-words ${
                    leftPaneMode === 'text' ? 'max-h-[520px]' : 'max-h-[200px]'
                  }`}
                >
                  {effectiveExtractedText && effectiveExtractedText.length > 0
                    ? effectiveExtractedText
                    : isKm
                    ? 'មិនទាន់មានអក្សរ OCR ត្រូវបានកត់ត្រាទេ — ចុច "ស្កេន OCR ម្តងទៀត" ឬបំពេញដោយផ្ទាល់នៅខាងស្តាំ។'
                    : isKo
                    ? '추출된 OCR 텍스트가 없습니다. "OCR 다시 스캔"을 누르거나 오른쪽에서 직접 입력하세요.'
                    : 'No extracted OCR text captured yet. Click Re-scan OCR or enter fields directly on the right.'}
                </pre>
              </div>
            </div>
          )}
        </div>

        {/* RIGHT PANE: Editable Verified Fields */}
        <div className="lg:col-span-7 bg-white rounded-xl border border-slate-200 divide-y divide-slate-200">
          {noFilteredResults && (
            <div className="p-8 text-center space-y-3">
              <div className="w-10 h-10 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-600 flex items-center justify-center mx-auto">
                <ShieldCheck className="w-5 h-5" />
              </div>
              <div className="space-y-1">
                <h3 className="text-sm font-bold text-slate-900">
                  {fieldFilter === 'edited'
                    ? isKm
                      ? 'មិនទាន់មានប្រអប់ណាត្រូវបានកែសម្រួលដោយដៃទេ'
                      : isKo
                      ? '아직 직접 수정한 항목이 없습니다'
                      : 'No manually edited fields yet'
                    : isKm
                    ? 'គ្រប់ប្រអប់ទិន្នន័យសុទ្ធតែមានកម្រិតទំនុកចិត្តខ្ពស់!'
                    : isKo
                    ? '모든 추출 항목의 신뢰도가 높습니다!'
                    : 'All extracted fields have high confidence!'}
                </h3>
                <p className="text-xs text-slate-600">
                  {fieldFilter === 'edited'
                    ? isKm
                      ? 'អ្នកអាចប្តូរទៅមើលគ្រប់ប្រអប់ទាំងអស់ ដើម្បីពិនិត្យ ឬកែតម្រូវដោយផ្ទាល់។'
                      : isKo
                      ? '전체 항목으로 전환하여 추출된 값을 확인하거나 수정할 수 있습니다.'
                      : 'Switch back to All fields to review or edit any extracted value.'
                    : isKm
                    ? 'មិនមានទិន្នន័យកម្រិតទាប ឬខ្វះចន្លោះត្រូវការកែសម្រួលបន្ថែមទេ។'
                    : isKo
                    ? '수동 확인이 필요한 저신뢰·누락 항목이 없습니다.'
                    : 'No low-confidence or missing fields require attention.'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setFieldFilter('all')}
                className="px-4 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold transition-colors cursor-pointer"
              >
                {isKm ? 'បង្ហាញគ្រប់ប្រអប់ទាំងអស់' : isKo ? '전체 항목 보기' : 'Show All Fields'}
              </button>
            </div>
          )}

          {/* Section 1: Core Identity & Entry Verification (Name, ARC Number, Entry Date, Gender, Nationality, Visa) */}
          {showGroup1 && (
            <section className="p-5 sm:p-6 space-y-4">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                  <UserCheck className="w-4 h-4 text-blue-600 shrink-0" />
                  <span>
                    {isKm
                      ? '01. ព័ត៌មានស្នូលលើកាត ARC & ថ្ងៃចូលកូរ៉េ (Name · ARC · Entry Date)'
                      : isKo
                      ? '01. 핵심 인적사항 및 입국 정보 (성명 · 등록번호 · 입국일)'
                      : '01. Core Identity & Entry Verification'}
                  </span>
                </h3>
                <button
                  type="button"
                  onClick={() => focusSourceDoc('arcFront', isKm ? 'កាត ARC ខាងមុខ' : 'ARC Front')}
                  className="text-xs font-semibold text-blue-600 hover:text-blue-800 hover:underline cursor-pointer whitespace-nowrap shrink-0"
                >
                  {isKm ? 'មើលរូប ARC មុខ' : isKo ? '앞면 보기' : 'View ARC Front'}
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* Full Name */}
                {shouldShowField('name') && (
                  <div className="sm:col-span-2 space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <label htmlFor="verify-field-name" className="block text-xs font-semibold text-slate-800">
                        {isKm ? 'ឈ្មោះពេញ (Name / 성명)' : isKo ? '성명 (Name)' : 'Name (성명)'}
                      </label>
                      <div className="flex items-center gap-2.5">
                        {renderFieldRevertBtn('name', initialSnapshot?.name, () =>
                          setDraft((p) => ({ ...p, name: initialSnapshot?.name || '' }))
                        )}
                        <ConfidenceInlineMeter confidence={liveConfidence.name} lang={lang} />
                      </div>
                    </div>
                    <input
                      id="verify-field-name"
                      ref={(el) => {
                        fieldRefs.current.name = el;
                      }}
                      type="text"
                      value={draft.name || ''}
                      placeholder="SOK SRORNG"
                      onFocus={() => focusSourceDoc('arcFront', isKm ? 'ឈ្មោះ (Name)' : isKo ? '성명 (Name)' : 'Name', 'passport')}
                      onChange={(e) => {
                        markEdited('name');
                        setDraft((p) => ({ ...p, name: e.target.value.toUpperCase() }));
                      }}
                      className={`w-full px-3 py-2.5 rounded-lg border text-sm font-semibold text-slate-900 uppercase focus:outline-hidden focus:ring-2 ${getFieldSurfaceClass('name')}`}
                    />
                    {renderFieldReasonHint('name')}
                  </div>
                )}

                {/* ARC Number */}
                {shouldShowField('regNumber') && (
                  <div className="space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <label htmlFor="verify-field-arc1" className="block text-xs font-semibold text-slate-800">
                        {isKm ? 'លេខកាត ARC (외국인등록번호)' : isKo ? '외국인등록번호 (ARC)' : 'ARC Number (외국인등록번호)'}
                      </label>
                      <div className="flex items-center gap-2">
                        {renderFieldRevertBtn(
                          'regNumber',
                          initialSnapshot?.regNumber1 || initialSnapshot?.regNumber2
                            ? `${initialSnapshot?.regNumber1 || ''}-${initialSnapshot?.regNumber2 || ''}`
                            : '',
                          () =>
                            setDraft((p) => ({
                              ...p,
                              regNumber1: initialSnapshot?.regNumber1 || '',
                              regNumber2: initialSnapshot?.regNumber2 || '',
                            }))
                        )}
                        <ConfidenceInlineMeter confidence={liveConfidence.regNumber} lang={lang} />
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <input
                        id="verify-field-arc1"
                        ref={(el) => {
                          fieldRefs.current.regNumber = el;
                        }}
                        type="text"
                        inputMode="numeric"
                        maxLength={6}
                        value={draft.regNumber1 || ''}
                        placeholder="YYMMDD"
                        onFocus={() => focusSourceDoc('arcFront', isKm ? 'លេខកាត ARC' : isKo ? '외국인등록번호' : 'ARC Number')}
                        onChange={(e) => {
                          markEdited('regNumber');
                          setDraft((p) => ({ ...p, regNumber1: e.target.value.replace(/[^0-9]/g, '').slice(0, 6) }));
                        }}
                        className={`w-full px-2.5 py-2.5 rounded-lg border text-sm font-mono font-semibold text-center tabular-nums text-slate-900 focus:outline-hidden focus:ring-2 ${getFieldSurfaceClass('regNumber')}`}
                      />
                      <span className="text-slate-400 font-bold select-none">-</span>
                      <input
                        aria-label="ARC Number last 7 digits"
                        type="text"
                        inputMode="numeric"
                        maxLength={7}
                        value={draft.regNumber2 || ''}
                        placeholder="5XXXXXX"
                        onFocus={() => focusSourceDoc('arcFront', isKm ? 'លេខកាត ARC' : isKo ? '외국인등록번호' : 'ARC Number')}
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
                        className={`w-full px-2.5 py-2.5 rounded-lg border text-sm font-mono font-semibold text-center tabular-nums text-slate-900 focus:outline-hidden focus:ring-2 ${getFieldSurfaceClass('regNumber')}`}
                      />
                    </div>
                    {renderFieldReasonHint('regNumber')}
                  </div>
                )}

                {/* Entry Date (입국일 / Entry Date) */}
                {shouldShowField('entryDate') && (
                  <div className="space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <label htmlFor="verify-field-entryDate" className="text-xs font-semibold text-slate-800 inline-flex items-center gap-1">
                        <Calendar className="w-3.5 h-3.5 text-slate-500 shrink-0" aria-hidden="true" />
                        <span>{isKm ? 'ថ្ងៃចូលប្រទេសកូរ៉េ (Entry Date / 입국일)' : isKo ? '입국일 (Entry Date)' : 'Entry Date (입국일)'}</span>
                      </label>
                      <div className="flex items-center gap-2">
                        {renderFieldRevertBtn('entryDate', initialSnapshot?.entryDate, () =>
                          setDraft((p) => ({ ...p, entryDate: initialSnapshot?.entryDate || '' }))
                        )}
                        <ConfidenceInlineMeter confidence={liveConfidence.entryDate} lang={lang} />
                      </div>
                    </div>
                    <input
                      id="verify-field-entryDate"
                      ref={(el) => {
                        fieldRefs.current.entryDate = el;
                      }}
                      type="date"
                      value={draft.entryDate || ''}
                      onFocus={() =>
                        focusSourceDoc(
                          'arcFront',
                          isKm ? 'ថ្ងៃចូលកូរ៉េ (Entry Date)' : isKo ? '입국일 (Entry Date)' : 'Entry Date',
                          'passport'
                        )
                      }
                      onChange={(e) => {
                        markEdited('entryDate');
                        setDraft((p) => ({ ...p, entryDate: e.target.value }));
                      }}
                      className={`w-full px-3 py-2.5 rounded-lg border font-mono text-sm font-semibold tabular-nums text-slate-900 focus:outline-hidden focus:ring-2 ${getFieldSurfaceClass('entryDate')}`}
                    />
                    {renderFieldReasonHint('entryDate')}
                  </div>
                )}

                {/* Gender */}
                {shouldShowField('gender') && (
                  <div className="space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <label htmlFor="verify-field-gender" className="block text-xs font-semibold text-slate-700">
                        {isKm ? 'ភេទ (성별)' : isKo ? '성별' : 'Gender (성별)'}
                      </label>
                      <div className="flex items-center gap-2">
                        {renderFieldRevertBtn('gender', initialSnapshot?.gender, () =>
                          setDraft((p) => ({ ...p, gender: (initialSnapshot?.gender || '') as '남' | '여' | '' }))
                        )}
                        <ConfidenceInlineMeter confidence={liveConfidence.gender} lang={lang} />
                      </div>
                    </div>
                    <select
                      id="verify-field-gender"
                      value={draft.gender || ''}
                      onFocus={() => focusSourceDoc('arcFront', isKm ? 'ភេទ' : 'Gender')}
                      onChange={(e) => {
                        markEdited('gender');
                        setDraft((p) => ({ ...p, gender: e.target.value as '남' | '여' | '' }));
                      }}
                      className={`w-full px-3 py-2.5 rounded-lg border text-sm font-semibold text-slate-900 focus:outline-hidden focus:ring-2 cursor-pointer ${getFieldSurfaceClass('gender')}`}
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
                      <label htmlFor="verify-field-nationality" className="block text-xs font-semibold text-slate-700">
                        {isKm ? 'សញ្ជាតិ (국적)' : isKo ? '국적' : 'Nationality (국적)'}
                      </label>
                      <div className="flex items-center gap-2">
                        {renderFieldRevertBtn('nationality', initialSnapshot?.nationality, () =>
                          setDraft((p) => ({ ...p, nationality: initialSnapshot?.nationality || '' }))
                        )}
                        <ConfidenceInlineMeter confidence={liveConfidence.nationality} lang={lang} />
                      </div>
                    </div>
                    <input
                      id="verify-field-nationality"
                      type="text"
                      value={draft.nationality || ''}
                      placeholder="Cambodia"
                      onFocus={() => focusSourceDoc('arcFront', isKm ? 'សញ្ជាតិ' : 'Nationality', 'passport')}
                      onChange={(e) => {
                        markEdited('nationality');
                        setDraft((p) => ({ ...p, nationality: e.target.value }));
                      }}
                      className={`w-full px-3 py-2.5 rounded-lg border text-sm font-semibold text-slate-900 focus:outline-hidden focus:ring-2 ${getFieldSurfaceClass('nationality')}`}
                    />
                    {renderFieldReasonHint('nationality')}
                  </div>
                )}

                {/* Visa Status */}
                {shouldShowField('visaStatus') && (
                  <div className="sm:col-span-2 space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <label htmlFor="verify-field-visa" className="block text-xs font-semibold text-slate-700">
                        {isKm ? 'វីសា (체류자격)' : isKo ? '체류자격' : 'Visa Status (체류자격)'}
                      </label>
                      <div className="flex items-center gap-2">
                        {renderFieldRevertBtn('visaStatus', initialSnapshot?.visaStatus, () =>
                          setDraft((p) => ({ ...p, visaStatus: initialSnapshot?.visaStatus || '' }))
                        )}
                        <ConfidenceInlineMeter confidence={liveConfidence.visaStatus} lang={lang} />
                      </div>
                    </div>
                    <select
                      id="verify-field-visa"
                      value={draft.visaStatus || ''}
                      onFocus={() => focusSourceDoc('arcFront', isKm ? 'វីសា' : 'Visa Status')}
                      onChange={(e) => {
                        markEdited('visaStatus');
                        setDraft((p) => ({ ...p, visaStatus: e.target.value }));
                      }}
                      className={`w-full px-3 py-2.5 rounded-lg border text-sm font-semibold text-slate-900 focus:outline-hidden focus:ring-2 cursor-pointer ${getFieldSurfaceClass('visaStatus')}`}
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

          {/* Section 2: ARC Back / 체류지 */}
          {showGroup2 && (
            <section className="p-5 sm:p-6 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                  <MapPin className="w-4 h-4 text-blue-600 shrink-0" />
                  <span>
                    {isKm
                      ? '02. អាសយដ្ឋានស្នាក់នៅលើកាត ARC ខាងក្រោយ (체류지)'
                      : isKo
                      ? '02. 외국인등록증 뒷면 체류지 (최신 신고일 기준)'
                      : '02. Residence Address from ARC Back (체류지)'}
                  </span>
                </h3>
                <button
                  type="button"
                  onClick={() => focusSourceDoc('arcBack', isKm ? 'អាសយដ្ឋាន (체류지)' : 'Residence Address')}
                  className="text-xs font-semibold text-blue-600 hover:text-blue-800 hover:underline cursor-pointer whitespace-nowrap shrink-0"
                >
                  {isKm ? 'មើលរូប ARC ក្រោយ' : isKo ? '뒷면 보기' : 'View ARC Back'}
                </button>
              </div>

              <div className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <label htmlFor="verify-field-address" className="block text-xs font-semibold text-slate-700">
                    체류지 ({isKm ? 'អាសយដ្ឋានពេញលេញជាភាសាកូរ៉េ — ជួរចុងក្រោយថ្មីបំផុត' : isKo ? '최신 체류지 도로명 주소' : 'Full Korean Residence Address'})
                  </label>
                  <div className="flex items-center gap-2.5">
                    {renderFieldRevertBtn('address', initialSnapshot?.address, () =>
                      setDraft((p) => ({ ...p, address: initialSnapshot?.address || '' }))
                    )}
                    <ConfidenceInlineMeter confidence={liveConfidence.address} lang={lang} />
                    <button
                      type="button"
                      onClick={() => setIsDaumModalOpen(true)}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-slate-900 hover:bg-slate-800 text-white text-[11px] font-semibold whitespace-nowrap shrink-0 cursor-pointer transition-colors"
                    >
                      <Search className="w-3 h-3" />
                      <span>{isKm ? 'ស្វែងរកតាម Daum' : isKo ? 'Daum 주소검색' : 'Daum Postcode'}</span>
                    </button>
                  </div>
                </div>
                <textarea
                  id="verify-field-address"
                  ref={(el) => {
                    fieldRefs.current.address = el;
                  }}
                  rows={2}
                  value={draft.address || ''}
                  placeholder="예: 경기도 안산시 단원구 원곡로 12, 101호"
                  onFocus={() => focusSourceDoc('arcBack', isKm ? 'អាសយដ្ឋាន (체류지)' : 'Residence Address')}
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
                        : 'If 체류지 is missing or incomplete, inspect ARC Back on the left and enter it directly.'}
                    </span>
                  </p>
                )}
              </div>
            </section>
          )}

          {/* Section 3: TOPIK Score Certificate */}
          {showGroup3 && (
            <section className="p-5 sm:p-6 space-y-4">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                  <Award className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span>
                    {isKm
                      ? '03. ព័ត៌មានសញ្ញាបត្រ TOPIK (시험일 · 성적유효기간 · 회)'
                      : isKo
                      ? '03. TOPIK 성적증명서 정보 (시험일 · 유효기간 · 회차)'
                      : '03. TOPIK Certificate Details'}
                  </span>
                </h3>
                <button
                  type="button"
                  onClick={() => focusSourceDoc('topik', 'TOPIK Score Certificate')}
                  className="text-xs font-semibold text-emerald-700 hover:underline cursor-pointer whitespace-nowrap shrink-0"
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
                      <div className="flex items-center gap-2">
                        {renderFieldRevertBtn(
                          'docVerificationNo',
                          Array.isArray(initialSnapshot?.docVerificationNo)
                            ? initialSnapshot.docVerificationNo.join('-')
                            : String(initialSnapshot?.docVerificationNo || ''),
                          () =>
                            setDraft((p) => ({
                              ...p,
                              docVerificationNo: initialSnapshot?.docVerificationNo || ['', '', '', ''],
                            }))
                        )}
                        <ConfidenceInlineMeter confidence={liveConfidence.docVerificationNo} lang={lang} />
                      </div>
                    </div>
                    <div className="grid grid-cols-4 gap-2">
                      {[0, 1, 2, 3].map((idx) => (
                        <input
                          key={idx}
                          type="text"
                          inputMode="numeric"
                          maxLength={idx === 0 ? 16 : 4}
                          value={docParts[idx]}
                          placeholder="0000"
                          onFocus={() => focusSourceDoc('topik', '문서확인번호')}
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
                      <label htmlFor="verify-field-examNo" className="block text-xs font-semibold text-slate-700">
                        수험번호 ({isKm ? 'លេខប្រឡង' : isKo ? '수험번호' : 'Exam No.'})
                      </label>
                      <div className="flex items-center gap-2">
                        {renderFieldRevertBtn('examNumber', initialSnapshot?.examNumber, () =>
                          setDraft((p) => ({ ...p, examNumber: initialSnapshot?.examNumber || '' }))
                        )}
                        <ConfidenceInlineMeter confidence={liveConfidence.examNumber} lang={lang} />
                      </div>
                    </div>
                    <input
                      id="verify-field-examNo"
                      type="text"
                      inputMode="numeric"
                      value={draft.examNumber || ''}
                      placeholder="0010197000017"
                      onFocus={() => focusSourceDoc('topik', '수험번호')}
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
                      <label htmlFor="verify-field-round" className="block text-xs font-semibold text-slate-700">
                        회 / 회차 ({isKm ? 'លើកទី' : isKo ? '회차' : 'Round'})
                      </label>
                      <div className="flex items-center gap-2">
                        {renderFieldRevertBtn('round', initialSnapshot?.round, () =>
                          setDraft((p) => ({ ...p, round: initialSnapshot?.round || '' }))
                        )}
                        <ConfidenceInlineMeter confidence={liveConfidence.round} lang={lang} />
                      </div>
                    </div>
                    <div className="relative flex items-center">
                      <input
                        id="verify-field-round"
                        ref={(el) => {
                          fieldRefs.current.round = el;
                        }}
                        type="text"
                        inputMode="numeric"
                        maxLength={3}
                        value={draft.round || ''}
                        placeholder="107"
                        onFocus={() => focusSourceDoc('topik', 'TOPIK Round (회)')}
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
                      <label htmlFor="verify-field-examDate" className="block text-xs font-semibold text-slate-700">
                        시험일 ({isKm ? 'ថ្ងៃប្រឡង' : isKo ? '시험일' : 'Exam Date'})
                      </label>
                      <div className="flex items-center gap-2">
                        {renderFieldRevertBtn('examDate', initialSnapshot?.examDate, () =>
                          setDraft((p) => ({ ...p, examDate: initialSnapshot?.examDate || '' }))
                        )}
                        <ConfidenceInlineMeter confidence={liveConfidence.examDate} lang={lang} />
                      </div>
                    </div>
                    <input
                      id="verify-field-examDate"
                      ref={(el) => {
                        fieldRefs.current.examDate = el;
                      }}
                      type="date"
                      value={draft.examDate || ''}
                      onFocus={() => focusSourceDoc('topik', 'Exam Date (시험일)')}
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
                      <label htmlFor="verify-field-validUntil" className="block text-xs font-semibold text-slate-700">
                        성적유효기간 ({isKm ? 'សុពលភាព' : isKo ? '유효기간' : 'Valid Until'})
                      </label>
                      <div className="flex items-center gap-2">
                        {renderFieldRevertBtn('validUntil', initialSnapshot?.validUntil, () =>
                          setDraft((p) => ({ ...p, validUntil: initialSnapshot?.validUntil || '' }))
                        )}
                        <ConfidenceInlineMeter confidence={liveConfidence.validUntil} lang={lang} />
                      </div>
                    </div>
                    <input
                      id="verify-field-validUntil"
                      ref={(el) => {
                        fieldRefs.current.validUntil = el;
                      }}
                      type="date"
                      value={draft.validUntil || ''}
                      onFocus={() => focusSourceDoc('topik', 'Valid Until (성적유효기간)')}
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
                  <div className="sm:col-span-2 space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <label htmlFor="verify-field-grade" className="block text-xs font-semibold text-slate-700">
                        등급 ({isKm ? 'កម្រិត' : isKo ? '등급' : 'Grade'})
                      </label>
                      <div className="flex items-center gap-2">
                        {renderFieldRevertBtn('grade', initialSnapshot?.grade, () =>
                          setDraft((p) => ({ ...p, grade: initialSnapshot?.grade || '' }))
                        )}
                        <ConfidenceInlineMeter confidence={liveConfidence.grade} lang={lang} />
                      </div>
                    </div>
                    <select
                      id="verify-field-grade"
                      value={draft.grade || ''}
                      onFocus={() => focusSourceDoc('topik', 'TOPIK Grade (등급)')}
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

          {/* Section 4: Passport */}
          {showGroup4 && (
            <section className="p-5 sm:p-6 space-y-4">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                  <BookOpenCheck className="w-4 h-4 text-slate-700 shrink-0" />
                  <span>
                    {isKm
                      ? '04. លិខិតឆ្លងដែន (여권번호 · 유효기간)'
                      : isKo
                      ? '04. 여권 정보'
                      : '04. Passport Details'}
                  </span>
                </h3>
                <button
                  type="button"
                  onClick={() => focusSourceDoc('passport', isKm ? 'លិខិតឆ្លងដែន' : 'Passport')}
                  className="text-xs font-semibold text-slate-600 hover:text-slate-900 hover:underline cursor-pointer whitespace-nowrap shrink-0"
                >
                  {isKm ? 'មើលរូបលិខិតឆ្លងដែន' : isKo ? '여권 보기' : 'View Passport'}
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {shouldShowField('passportNo') && (
                  <div className="space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <label htmlFor="verify-field-passportNo" className="block text-xs font-semibold text-slate-700">
                        여권번호 ({isKm ? 'លេខលិខិតឆ្លងដែន' : isKo ? '여권번호' : 'Passport No.'})
                      </label>
                      <div className="flex items-center gap-2">
                        {renderFieldRevertBtn('passportNo', initialSnapshot?.passportNo, () =>
                          setDraft((p) => ({ ...p, passportNo: initialSnapshot?.passportNo || '' }))
                        )}
                        <ConfidenceInlineMeter confidence={liveConfidence.passportNo} lang={lang} />
                      </div>
                    </div>
                    <input
                      id="verify-field-passportNo"
                      type="text"
                      value={draft.passportNo || ''}
                      placeholder="N01847291"
                      onFocus={() => focusSourceDoc('passport', 'Passport No.')}
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
                      <label htmlFor="verify-field-passportExp" className="block text-xs font-semibold text-slate-700">
                        여권 유효기간 ({isKm ? 'ថ្ងៃផុតកំណត់' : isKo ? '유효기간' : 'Expiry Date'})
                      </label>
                      <div className="flex items-center gap-2">
                        {renderFieldRevertBtn('passportExpiry', initialSnapshot?.passportExpiry, () =>
                          setDraft((p) => ({ ...p, passportExpiry: initialSnapshot?.passportExpiry || '' }))
                        )}
                        <ConfidenceInlineMeter confidence={liveConfidence.passportExpiry} lang={lang} />
                      </div>
                    </div>
                    <input
                      id="verify-field-passportExp"
                      type="date"
                      value={draft.passportExpiry || ''}
                      onFocus={() => focusSourceDoc('passport', 'Passport Expiry')}
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

      {/* Bottom Pre-Injection Summary & Primary Action Bar */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 sm:p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="space-y-0.5 text-xs text-slate-600 min-w-0">
          <div className="font-semibold text-slate-900 flex flex-wrap items-center gap-2">
            <span>
              {isKm
                ? 'រួចរាល់សម្រាប់បញ្ចូលទិន្នន័យទៅក្នុងទម្រង់ផ្លូវការ'
                : isKo
                ? '공식 신청서 반영 준비 완료'
                : 'Ready to inject verified fields into the official form'}
            </span>
            <span aria-hidden="true" className="text-slate-300">·</span>
            <span className="font-mono text-slate-700 tabular-nums">
              {readyCount}/{criticalChecks.length} {isKm ? 'ចំណុចសំខាន់' : isKo ? '핵심 항목' : 'key checks'}
            </span>
            {confidenceStats.editedCount > 0 && (
              <>
                <span aria-hidden="true" className="text-slate-300">·</span>
                <span className="font-mono text-blue-700 tabular-nums">
                  {confidenceStats.editedCount} {isKm ? 'បានកែដោយដៃ' : isKo ? '직접 수정' : 'manually edited'}
                </span>
              </>
            )}
          </div>
          {!isStep1Ready && missingStep1Count > 0 && (
            <p className="text-amber-700 font-medium">
              {isKm
                ? `ចំណាំ៖ ទិន្នន័យ OCR នឹងត្រូវរក្សាទុកជាស្រេច រួចត្រឡប់ទៅជំហ៊ានទី ១ ដើម្បីបំពេញឯកសារ/ព័ត៌មាននៅខ្វះ ${missingStep1Count} ចំណុចទៀត។`
                : isKo
                ? `참고: 검증된 데이터가 저장되며, 남은 1단계 필수 항목(${missingStep1Count}개)을 마저 입력하기 위해 1단계로 이동합니다.`
                : `Note: Verified fields will be saved and injected, then you will return to Step 1 to finish ${missingStep1Count} remaining required item(s).`}
            </p>
          )}
        </div>

        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 shrink-0">
          <button
            type="button"
            onClick={onBack}
            className="px-4 py-2.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 text-xs sm:text-sm font-semibold inline-flex items-center justify-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap shrink-0"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>{copy.backBtn}</span>
          </button>

          <button
            type="button"
            onClick={() => onConfirmInject(draft)}
            className="px-6 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-700 active:scale-[0.99] text-white text-xs sm:text-sm font-semibold inline-flex items-center justify-center gap-2 transition-all cursor-pointer whitespace-nowrap shrink-0"
          >
            <span>{copy.confirmBtn}</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
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
