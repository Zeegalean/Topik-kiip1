import React, { useState, useEffect, useMemo } from 'react';
import { ApplicationFormData, Language, UploadedDocuments } from '../types';
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
import { DaumPostcodeModal } from './DaumPostcodeModal';
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  RotateCcw,
  RotateCw,
  ZoomIn,
  ZoomOut,
  Maximize2,
  X,
  Undo2,
  Search,
  MapPin,
  FileText,
  ChevronLeft,
  ChevronRight,
  Copy,
  Check,
  Upload,
  Link2,
} from 'lucide-react';

export interface ReviewAndCorrectProps {
  lang: Language;
  docs: UploadedDocuments;
  formData: ApplicationFormData;
  draft: ExtractedDocumentData;
  initialSnapshot: ExtractedDocumentData | null;
  confidenceMap?: OcrFieldConfidenceMap;
  rawTextPreview: string;
  isScanning: boolean;
  isStep1Ready: boolean;
  missingStep1Count: number;
  onRescanOcr: () => Promise<void> | void;
  onBackToStep2: () => void;
  onGoToStep1Upload: () => void;
  onFinalizeForPdfForm: (
    updatedFormFields: Partial<ApplicationFormData>,
    updatedDraft: ExtractedDocumentData
  ) => void;
}

type DocTabId = 'arcFront' | 'arcBack' | 'topik' | 'passport';
type FilterTab = 'all' | 'attention' | 'edited';

type EditableFieldKey =
  | 'name'
  | 'regNumber'
  | 'entryDate'
  | 'gender'
  | 'nationality'
  | 'visaStatus'
  | 'address'
  | 'docVerificationNo'
  | 'examNumber'
  | 'round'
  | 'examDate'
  | 'validUntil'
  | 'grade'
  | 'passportNo'
  | 'passportExpiry'
  | 'phone'
  | 'mobile';

interface WorkingFields {
  name: string;
  regNumber1: string;
  regNumber2: string;
  entryDate: string;
  gender: '남' | '여' | '';
  nationality: string;
  visaStatus: string;
  address: string;
  docVerificationNo: string;
  examNumber: string;
  round: string;
  examDate: string;
  validUntil: string;
  grade: string;
  passportNo: string;
  passportExpiry: string;
  phone: string;
  mobile: string;
}

const FIELD_TO_DOC_TAB: Record<EditableFieldKey, DocTabId> = {
  name: 'arcFront',
  regNumber: 'arcFront',
  entryDate: 'arcFront',
  gender: 'arcFront',
  nationality: 'arcFront',
  visaStatus: 'arcFront',
  address: 'arcBack',
  docVerificationNo: 'topik',
  examNumber: 'topik',
  round: 'topik',
  examDate: 'topik',
  validUntil: 'topik',
  grade: 'topik',
  passportNo: 'passport',
  passportExpiry: 'passport',
  phone: 'arcFront',
  mobile: 'arcFront',
};

function formatDocVerToString(val?: string | string[] | null): string {
  if (!val) return '';
  if (Array.isArray(val)) {
    const cleaned = val.map((p) => (p || '').trim()).filter(Boolean);
    return cleaned.join('-');
  }
  return String(val).trim();
}

function splitDocVerToArray(val: string): string[] {
  const digits = val.replace(/[^0-9A-Za-z]/g, '');
  if (!digits) return ['', '', '', ''];
  return [
    digits.slice(0, 4),
    digits.slice(4, 8),
    digits.slice(8, 12),
    digits.slice(12, 16),
  ];
}

function normalizeGender(val?: string | null): '남' | '여' | '' {
  const v = (val || '').trim().toUpperCase();
  if (v === '남' || v === 'M' || v === 'MALE') return '남';
  if (v === '여' || v === 'F' || v === 'FEMALE') return '여';
  return '';
}

function buildWorkingFields(
  formData: ApplicationFormData,
  draft: ExtractedDocumentData
): WorkingFields {
  const draftDocVer = formatDocVerToString(draft.docVerificationNo);
  const formDocVer = formatDocVerToString(formData.docVerificationNo);
  return {
    name: draft.name || formData.name || '',
    regNumber1: draft.regNumber1 || formData.regNumber1 || '',
    regNumber2: draft.regNumber2 || formData.regNumber2 || '',
    entryDate: draft.entryDate || formData.entryDate || '',
    gender: normalizeGender(draft.gender || formData.gender),
    nationality: draft.nationality || formData.nationality || '',
    visaStatus: draft.visaStatus || formData.visaStatus || '',
    address: draft.address || formData.address || '',
    docVerificationNo: draftDocVer || formDocVer,
    examNumber: draft.examNumber || formData.examNumber || '',
    round: draft.round || formData.round || '',
    examDate: draft.examDate || formData.examDate || '',
    validUntil: draft.validUntil || formData.validUntil || '',
    grade: draft.grade || formData.grade || '',
    passportNo: draft.passportNo || formData.passportNo || '',
    passportExpiry: draft.passportExpiry || formData.passportExpiry || '',
    phone: formData.phone || '',
    mobile: formData.mobile || '',
  };
}

function getFieldValueString(fields: WorkingFields, key: EditableFieldKey): string {
  if (key === 'regNumber') {
    const r1 = fields.regNumber1.trim();
    const r2 = fields.regNumber2.trim();
    if (!r1 && !r2) return '';
    return `${r1}-${r2}`;
  }
  return String(fields[key] ?? '').trim();
}

function getBaselineValueString(
  baseline: WorkingFields,
  snapshot: ExtractedDocumentData | null,
  key: EditableFieldKey
): string {
  if (snapshot) {
    if (key === 'regNumber') {
      const r1 = (snapshot.regNumber1 || '').trim();
      const r2 = (snapshot.regNumber2 || '').trim();
      if (r1 || r2) return `${r1}-${r2}`;
    } else if (key === 'docVerificationNo') {
      const s = formatDocVerToString(snapshot.docVerificationNo);
      if (s) return s;
    } else if (key !== 'phone' && key !== 'mobile') {
      const snapVal = snapshot[key as keyof ExtractedDocumentData];
      if (typeof snapVal === 'string' && snapVal.trim()) return snapVal.trim();
    }
  }
  return getFieldValueString(baseline, key);
}

function mapGradeToKiipStage(grade: string): string {
  const clean = (grade || '').replace(/[^0-9]/g, '');
  if (clean === '3') return '4단계 (Level 4)';
  if (clean === '4') return '5단계 기본 (Level 5 Basic)';
  if (clean === '5' || clean === '6') return '5단계 심화 / 종합평가 (Level 5 Advanced)';
  return '—';
}

function getConfidenceTier(
  conf?: OcrFieldConfidence
): 'manual' | 'high' | 'medium' | 'low' | 'missing' {
  if (!conf || conf.source === 'missing' || conf.score <= 0) return 'missing';
  if (conf.source === 'manual' && conf.score >= 85) return 'manual';
  if (conf.score >= 85) return 'high';
  if (conf.score >= 60) return 'medium';
  return 'low';
}

const ConfidenceBar: React.FC<{
  confidence?: OcrFieldConfidence;
  isEdited: boolean;
  lang: Language;
}> = ({ confidence, isEdited, lang }) => {
  const isKo = lang === 'ko';
  const isKm = lang === 'km';
  const effectiveConf: OcrFieldConfidence | undefined = isEdited
    ? { score: 100, source: 'manual', reason: 'Manually corrected in Step 2.5' }
    : confidence;

  const score = effectiveConf?.score ?? 0;
  const tier = getConfidenceTier(effectiveConf);

  const label =
    tier === 'manual'
      ? isKo
        ? '수정됨'
        : isKm
        ? 'បានកែតម្រូវ'
        : 'Corrected'
      : tier === 'high'
      ? isKo
        ? '높음'
        : isKm
        ? 'ច្បាស់'
        : 'High'
      : tier === 'medium'
      ? isKo
        ? '확인 필요'
        : isKm
        ? 'គួរពិនិត្យ'
        : 'Review'
      : tier === 'low'
      ? isKo
        ? '낮음'
        : isKm
        ? 'ទាប'
        : 'Low'
      : isKo
      ? '미입력'
      : isKm
      ? 'ទទេ'
      : 'Empty';

  const barClass =
    tier === 'manual'
      ? 'bg-blue-600'
      : tier === 'high'
      ? 'bg-emerald-600'
      : tier === 'medium'
      ? 'bg-amber-500'
      : tier === 'low'
      ? 'bg-rose-600'
      : 'bg-slate-300';

  const textClass =
    tier === 'manual'
      ? 'text-blue-700'
      : tier === 'high'
      ? 'text-emerald-700'
      : tier === 'medium'
      ? 'text-amber-700'
      : tier === 'low'
      ? 'text-rose-700'
      : 'text-slate-500';

  return (
    <span className={`inline-flex items-center gap-1.5 text-[11px] font-semibold whitespace-nowrap shrink-0 ${textClass}`}>
      <span aria-hidden="true" className="w-9 h-1.5 bg-slate-200 rounded-xs overflow-hidden inline-block">
        <span
          className={`block h-full transition-all duration-150 ${barClass}`}
          style={{ width: `${tier === 'missing' ? 0 : Math.max(10, Math.min(100, score))}%` }}
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
      <span>{label}</span>
    </span>
  );
};

export const ReviewAndCorrect: React.FC<ReviewAndCorrectProps> = ({
  lang,
  docs,
  formData,
  draft,
  initialSnapshot,
  confidenceMap,
  rawTextPreview,
  isScanning,
  isStep1Ready,
  missingStep1Count,
  onRescanOcr,
  onBackToStep2,
  onGoToStep1Upload,
  onFinalizeForPdfForm,
}) => {
  const isKo = lang === 'ko';
  const isKm = lang === 'km';

  // Local editable state initialized from current draft + formData
  const [fields, setFields] = useState<WorkingFields>(() =>
    buildWorkingFields(formData, draft)
  );
  const [baseline, setBaseline] = useState<WorkingFields>(() =>
    buildWorkingFields(formData, initialSnapshot || draft)
  );

  // Sync if user re-scans OCR from within Step 2.5
  const [lastRescanStamp, setLastRescanStamp] = useState<number>(0);
  useEffect(() => {
    if (lastRescanStamp === 0) return;
    const refreshed = buildWorkingFields(formData, draft);
    setFields(refreshed);
    setBaseline(buildWorkingFields(formData, initialSnapshot || draft));
  }, [lastRescanStamp, draft, formData, initialSnapshot]);

  // Document viewer state
  const [activeDocTab, setActiveDocTab] = useState<DocTabId>(() => {
    if (docs.arcFront) return 'arcFront';
    if (docs.arcBack) return 'arcBack';
    if (docs.topikCertList.length > 0) return 'topik';
    if (docs.passportList.length > 0) return 'passport';
    return 'arcFront';
  });
  const [topikPageIdx, setTopikPageIdx] = useState(0);
  const [passportPageIdx, setPassportPageIdx] = useState(0);
  const [zoom, setZoom] = useState(100);
  const [rotation, setRotation] = useState(0);
  const [autoSyncDoc, setAutoSyncDoc] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showRawOcr, setShowRawOcr] = useState(false);
  const [copiedRaw, setCopiedRaw] = useState(false);
  const [pdfRenderedCache, setPdfRenderedCache] = useState<Record<string, string>>({});
  const [pdfRendering, setPdfRendering] = useState(false);

  // Right pane filter & focus state
  const [filterTab, setFilterTab] = useState<FilterTab>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [activeField, setActiveField] = useState<EditableFieldKey>('name');
  const [isDaumOpen, setIsDaumOpen] = useState(false);

  // Compute current active document URL & filename
  const activeDocInfo = useMemo(() => {
    if (activeDocTab === 'arcFront') {
      return {
        label: isKo ? '외국인등록증 앞면' : isKm ? 'កាត ARC មុខ' : 'ARC Front',
        dataUrl: docs.arcFront,
        name: docs.arcFrontName || 'arc_front',
        pageCount: docs.arcFront ? 1 : 0,
        pageIndex: 0,
      };
    }
    if (activeDocTab === 'arcBack') {
      return {
        label: isKo ? '외국인등록증 뒷면' : isKm ? 'កាត ARC ក្រោយ' : 'ARC Back',
        dataUrl: docs.arcBack,
        name: docs.arcBackName || 'arc_back',
        pageCount: docs.arcBack ? 1 : 0,
        pageIndex: 0,
      };
    }
    if (activeDocTab === 'topik') {
      const safeIdx = Math.min(topikPageIdx, Math.max(0, docs.topikCertList.length - 1));
      const item = docs.topikCertList[safeIdx];
      return {
        label: isKo ? 'TOPIK 성적증명서' : isKm ? 'សញ្ញាបត្រ TOPIK' : 'TOPIK Score',
        dataUrl: item?.dataUrl || null,
        name: item?.name || 'topik_certificate',
        pageCount: docs.topikCertList.length,
        pageIndex: safeIdx,
      };
    }
    const safeIdx = Math.min(passportPageIdx, Math.max(0, docs.passportList.length - 1));
    const item = docs.passportList[safeIdx];
    return {
      label: isKo ? '여권 사본' : isKm ? 'លិខិតឆ្លងដែន' : 'Passport',
      dataUrl: item?.dataUrl || null,
      name: item?.name || 'passport',
      pageCount: docs.passportList.length,
      pageIndex: safeIdx,
    };
  }, [activeDocTab, docs, topikPageIdx, passportPageIdx, isKo, isKm]);

  // Render PDF documents to image previews when selected
  useEffect(() => {
    const src = activeDocInfo.dataUrl;
    if (!src || !isPdfDataUrl(src)) return;
    const cacheKey = `${activeDocTab}_${activeDocInfo.pageIndex}_${src.slice(0, 48)}`;
    if (pdfRenderedCache[cacheKey]) return;

    let cancelled = false;
    setPdfRendering(true);
    extractPdfTextAndImageFromDataUrl(src)
      .then((result) => {
        if (!cancelled && result?.imageUrl) {
          setPdfRenderedCache((prev) => ({ ...prev, [cacheKey]: result.imageUrl! }));
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setPdfRendering(false);
      });

    return () => {
      cancelled = true;
    };
  }, [activeDocInfo.dataUrl, activeDocInfo.pageIndex, activeDocTab, pdfRenderedCache]);

  const displayImageUrl = useMemo(() => {
    const src = activeDocInfo.dataUrl;
    if (!src) return null;
    if (!isPdfDataUrl(src)) return src;
    const cacheKey = `${activeDocTab}_${activeDocInfo.pageIndex}_${src.slice(0, 48)}`;
    return pdfRenderedCache[cacheKey] || null;
  }, [activeDocInfo.dataUrl, activeDocInfo.pageIndex, activeDocTab, pdfRenderedCache]);

  // Dynamic confidence map merged with live edits
  const liveDraft: ExtractedDocumentData = useMemo(
    () => ({
      name: fields.name,
      regNumber1: fields.regNumber1,
      regNumber2: fields.regNumber2,
      entryDate: fields.entryDate,
      gender: fields.gender,
      nationality: fields.nationality,
      visaStatus: fields.visaStatus,
      address: fields.address,
      docVerificationNo: fields.docVerificationNo
        ? splitDocVerToArray(fields.docVerificationNo)
        : undefined,
      examNumber: fields.examNumber,
      round: fields.round,
      examDate: fields.examDate,
      validUntil: fields.validUntil,
      grade: fields.grade,
      passportNo: fields.passportNo,
      passportExpiry: fields.passportExpiry,
    }),
    [fields]
  );

  const effectiveConfidence = useMemo(() => {
    return evaluateDraftConfidence(liveDraft, confidenceMap, undefined, 'manual');
  }, [liveDraft, confidenceMap]);

  const isFieldEdited = (key: EditableFieldKey): boolean => {
    const curr = getFieldValueString(fields, key);
    const orig = getBaselineValueString(baseline, initialSnapshot, key);
    return curr !== orig;
  };

  const isFieldNeedsAttention = (key: EditableFieldKey): boolean => {
    if (key === 'regNumber') {
      if (fields.regNumber1.length !== 6 || fields.regNumber2.length !== 7) return true;
    }
    if (key === 'phone' || key === 'mobile') {
      return key === 'phone' ? !fields.phone.trim() : false;
    }
    if (isFieldEdited(key)) return false;
    const conf = effectiveConfidence[key as OcrConfidenceKey];
    const tier = getConfidenceTier(conf);
    return tier === 'missing' || tier === 'low' || tier === 'medium';
  };

  const handleFieldFocus = (key: EditableFieldKey) => {
    setActiveField(key);
    if (autoSyncDoc) {
      const targetTab = FIELD_TO_DOC_TAB[key];
      const hasTarget =
        (targetTab === 'arcFront' && Boolean(docs.arcFront)) ||
        (targetTab === 'arcBack' && Boolean(docs.arcBack)) ||
        (targetTab === 'topik' && docs.topikCertList.length > 0) ||
        (targetTab === 'passport' && docs.passportList.length > 0);
      if (hasTarget && targetTab !== activeDocTab) {
        setActiveDocTab(targetTab);
        setZoom(100);
        setRotation(0);
      }
    }
  };

  const revertField = (key: EditableFieldKey) => {
    if (key === 'regNumber') {
      const r1 = initialSnapshot?.regNumber1 ?? baseline.regNumber1;
      const r2 = initialSnapshot?.regNumber2 ?? baseline.regNumber2;
      setFields((prev) => ({ ...prev, regNumber1: r1, regNumber2: r2 }));
      return;
    }
    if (key === 'gender') {
      const g = normalizeGender(initialSnapshot?.gender || baseline.gender);
      setFields((prev) => ({ ...prev, gender: g }));
      return;
    }
    if (key === 'docVerificationNo') {
      const orig =
        formatDocVerToString(initialSnapshot?.docVerificationNo) ||
        baseline.docVerificationNo;
      setFields((prev) => ({ ...prev, docVerificationNo: orig }));
      return;
    }
    if (key === 'phone' || key === 'mobile') {
      setFields((prev) => ({ ...prev, [key]: baseline[key] }));
      return;
    }
    const snapVal = initialSnapshot?.[key as keyof ExtractedDocumentData];
    const orig = typeof snapVal === 'string' ? snapVal : baseline[key];
    setFields((prev) => ({ ...prev, [key]: orig }));
  };

  const revertAllEdits = () => {
    setFields({ ...baseline });
  };

  const ALL_KEYS: EditableFieldKey[] = [
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
    'phone',
    'mobile',
  ];

  const stats = useMemo(() => {
    let populated = 0;
    let edited = 0;
    let attention = 0;
    for (const k of ALL_KEYS) {
      if (getFieldValueString(fields, k).length > 0) populated++;
      if (isFieldEdited(k)) edited++;
      if (isFieldNeedsAttention(k)) attention++;
    }
    const coreMissing = (
      [
        ['name', fields.name.trim().length > 0],
        ['regNumber', fields.regNumber1.length === 6 && fields.regNumber2.length === 7],
        ['address', fields.address.trim().length > 0],
        ['grade', fields.grade.trim().length > 0],
        ['examDate', fields.examDate.trim().length > 0],
        ['validUntil', fields.validUntil.trim().length > 0],
      ] as [string, boolean][]
    ).filter(([, ok]) => !ok).length;

    return {
      total: ALL_KEYS.length,
      populated,
      edited,
      attention,
      coreMissing,
    };
  }, [fields, baseline, initialSnapshot, effectiveConfidence]);

  const matchedOffice = useMemo(() => {
    if (!fields.address.trim()) return null;
    return findOfficeByAddress(fields.address);
  }, [fields.address]);

  const shouldShowField = (key: EditableFieldKey, searchTerms: string): boolean => {
    if (filterTab === 'edited' && !isFieldEdited(key)) return false;
    if (filterTab === 'attention' && !isFieldNeedsAttention(key)) return false;
    const q = searchQuery.trim().toLowerCase();
    if (!q) return true;
    const val = getFieldValueString(fields, key).toLowerCase();
    return searchTerms.toLowerCase().includes(q) || val.includes(q);
  };

  const handleCopyRaw = async () => {
    const content = rawTextPreview.trim() || JSON.stringify(liveDraft, null, 2);
    try {
      await navigator.clipboard.writeText(content);
      setCopiedRaw(true);
      window.setTimeout(() => setCopiedRaw(false), 1800);
    } catch {
      // ignore clipboard denial
    }
  };

  const handleTriggerRescan = async () => {
    await onRescanOcr();
    setLastRescanStamp(Date.now());
  };

  const handleFinalize = () => {
    const cleanVisa = fields.visaStatus.trim().toUpperCase();
    const docVerArr = splitDocVerToArray(fields.docVerificationNo);
    const updatedForm: Partial<ApplicationFormData> = {
      name: fields.name.trim().toUpperCase(),
      applicantName: fields.name.trim().toUpperCase(),
      regNumber1: fields.regNumber1.replace(/[^0-9]/g, '').slice(0, 6),
      regNumber2: fields.regNumber2.replace(/[^0-9]/g, '').slice(0, 7),
      entryDate: fields.entryDate.trim(),
      gender: fields.gender,
      nationality: fields.nationality.trim().toUpperCase(),
      visaStatus: cleanVisa,
      address: fields.address.trim(),
      docVerificationNo: docVerArr,
      examNumber: fields.examNumber.trim(),
      round: fields.round.trim(),
      examDate: fields.examDate.trim(),
      validUntil: fields.validUntil.trim(),
      grade: fields.grade.trim(),
      passportNo: fields.passportNo.trim().toUpperCase(),
      passportExpiry: fields.passportExpiry.trim(),
      phone: fields.phone.trim(),
      mobile: fields.mobile.trim(),
    };
    const updatedDraft: ExtractedDocumentData = {
      name: updatedForm.name,
      regNumber1: updatedForm.regNumber1,
      regNumber2: updatedForm.regNumber2,
      entryDate: updatedForm.entryDate,
      gender: updatedForm.gender,
      nationality: updatedForm.nationality,
      visaStatus: updatedForm.visaStatus,
      address: updatedForm.address,
      docVerificationNo: docVerArr,
      examNumber: updatedForm.examNumber,
      round: updatedForm.round,
      examDate: updatedForm.examDate,
      validUntil: updatedForm.validUntil,
      grade: updatedForm.grade,
      passportNo: updatedForm.passportNo,
      passportExpiry: updatedForm.passportExpiry,
    };
    onFinalizeForPdfForm(updatedForm, updatedDraft);
  };

  const docTabs: { id: DocTabId; label: string; count: number }[] = [
    {
      id: 'arcFront',
      label: isKo ? 'ARC 앞면' : isKm ? 'ARC មុខ' : 'ARC Front',
      count: docs.arcFront ? 1 : 0,
    },
    {
      id: 'arcBack',
      label: isKo ? 'ARC 뒷면' : isKm ? 'ARC ក្រោយ' : 'ARC Back',
      count: docs.arcBack ? 1 : 0,
    },
    {
      id: 'topik',
      label: isKo ? 'TOPIK 성적표' : isKm ? 'TOPIK' : 'TOPIK',
      count: docs.topikCertList.length,
    },
    {
      id: 'passport',
      label: isKo ? '여권' : isKm ? 'លិខិតឆ្លងដែន' : 'Passport',
      count: docs.passportList.length,
    },
  ];

  const activeFieldLabelMap: Record<EditableFieldKey, string> = {
    name: isKo ? '성명 (Name)' : isKm ? 'ឈ្មោះ (Name)' : 'Full Name (성명)',
    regNumber: isKo ? '외국인등록번호 (ARC)' : isKm ? 'លេខកាត ARC' : 'ARC Number (외국인등록번호)',
    entryDate: isKo ? '입국일 (Entry Date)' : isKm ? 'ថ្ងៃចូលកូរ៉េ (Entry Date)' : 'Entry Date (입국일)',
    gender: isKo ? '성별 (Gender)' : isKm ? 'ភេទ (Gender)' : 'Gender (성별)',
    nationality: isKo ? '국적 (Nationality)' : isKm ? 'សញ្ជាតិ (Nationality)' : 'Nationality (국적)',
    visaStatus: isKo ? '체류자격 (Visa)' : isKm ? 'ប្រភេទវីសា (Visa)' : 'Visa Status (체류자격)',
    address: isKo ? '체류지 주소 (Address)' : isKm ? 'អាសយដ្ឋាន (Address)' : 'Residence Address (체류지)',
    docVerificationNo: isKo ? '문서확인번호' : isKm ? 'លេខផ្ទៀងផ្ទាត់ឯកសារ' : 'Document Verification No.',
    examNumber: isKo ? '수험번호' : isKm ? 'លេខសម្គាល់ប្រឡង' : 'Exam Registration No.',
    round: isKo ? '시험 회차' : isKm ? 'លើកប្រឡង' : 'Test Round (회차)',
    examDate: isKo ? '시험일' : isKm ? 'ថ្ងៃប្រឡង' : 'Exam Date (시험일)',
    validUntil: isKo ? '유효기간' : isKm ? 'សុពលភាពដល់' : 'Valid Until (유효기간)',
    grade: isKo ? '취득 등급' : isKm ? 'កម្រិត TOPIK' : 'TOPIK Grade (등급)',
    passportNo: isKo ? '여권번호' : isKm ? 'លេខលិខិតឆ្លងដែន' : 'Passport No.',
    passportExpiry: isKo ? '여권 만료일' : isKm ? 'ថ្ងៃផុតកំណត់លិខិតឆ្លងដែន' : 'Passport Expiry',
    phone: isKo ? '전화번호' : isKm ? 'លេខទូរស័ព្ទ' : 'Phone Number',
    mobile: isKo ? '휴대전화' : isKm ? 'លេខទូរស័ព្ទដៃ' : 'Mobile Phone',
  };

  const renderRevertMeta = (key: EditableFieldKey) => {
    if (!isFieldEdited(key)) return null;
    const orig = getBaselineValueString(baseline, initialSnapshot, key);
    return (
      <div className="mt-1 flex items-center justify-between gap-2 text-[11px] text-slate-500">
        <span className="truncate font-mono">
          {isKo ? '원본 OCR:' : isKm ? 'OCR ដើម:' : 'OCR:'}{' '}
          <span className="text-slate-700">{orig || '—'}</span>
        </span>
        <button
          type="button"
          onClick={() => revertField(key)}
          className="inline-flex items-center gap-1 text-blue-700 hover:text-blue-900 font-semibold whitespace-nowrap shrink-0 cursor-pointer"
        >
          <Undo2 className="w-3 h-3" aria-hidden="true" />
          <span>{isKo ? '되돌리기' : isKm ? 'ត្រឡប់វិញ' : 'Undo'}</span>
        </button>
      </div>
    );
  };

  const isKnownVisa = ALL_VISA_CODES.includes(fields.visaStatus.toUpperCase());

  const showIdentitySection =
    shouldShowField('name', 'name full name 성명 ឈ្មោះ') ||
    shouldShowField('regNumber', 'arc reg registration number 외국인등록번호 លេខកាត') ||
    shouldShowField('entryDate', 'entry date 입국일 ថ្ងៃចូល') ||
    shouldShowField('gender', 'gender sex 성별 ភេទ') ||
    shouldShowField('nationality', 'nationality country 국적 សញ្ជាតិ') ||
    shouldShowField('visaStatus', 'visa status sojourn 체류자격 វីសា');

  const showAddressSection = shouldShowField(
    'address',
    'address residence 체류지 주소 อាសយដ្ឋាន immigration office'
  );

  const showTopikSection =
    shouldShowField('docVerificationNo', 'document verification 문서확인번호 ផ្ទៀងផ្ទាត់') ||
    shouldShowField('examNumber', 'exam number registration 수험번호 លេខប្រឡង') ||
    shouldShowField('round', 'round 회차 លើក') ||
    shouldShowField('examDate', 'exam date 시험일 ថ្ងៃប្រឡង') ||
    shouldShowField('validUntil', 'valid until expiry 유효기간 សុពលភាព') ||
    shouldShowField('grade', 'grade level topik 등급 កម្រិត kiip');

  const showPassportContactSection =
    shouldShowField('passportNo', 'passport number 여권번호 លិខិតឆ្លងដែន') ||
    shouldShowField('passportExpiry', 'passport expiry 만료일 ផុតកំណត់') ||
    shouldShowField('phone', 'phone contact 전화번호 연락처 ទូរស័ព្ទ') ||
    shouldShowField('mobile', 'mobile cell 휴대전화 ទូរស័ព្ទដៃ');

  const hasAnyVisibleField =
    showIdentitySection ||
    showAddressSection ||
    showTopikSection ||
    showPassportContactSection;

  return (
    <section
      aria-label="Step 2.5 Review and Correct"
      className="space-y-5"
    >
      {/* Clean Single-Elevation Header Strip */}
      <div className="bg-white border border-slate-200 rounded-xl px-5 py-4 sm:px-6 sm:py-5">
        <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-slate-500">
              <span className="text-blue-700 font-mono tabular-nums">Step 2.5</span>
              <span aria-hidden="true" className="text-slate-300">
                ·
              </span>
              <span>
                {isKo
                  ? '검토 및 오류 수정'
                  : isKm
                  ? 'ពិនិត្យ និងកែតម្រូវទិន្នន័យ OCR'
                  : 'Review and Correct'}
              </span>
              <span aria-hidden="true" className="text-slate-300">
                ·
              </span>
              <span className="tabular-nums">
                {stats.populated}/{stats.total}{' '}
                {isKo ? '입력됨' : isKm ? 'បានបំពេញ' : 'populated'}
              </span>
              {stats.edited > 0 && (
                <>
                  <span aria-hidden="true" className="text-slate-300">
                    ·
                  </span>
                  <span className="text-blue-700 tabular-nums">
                    {stats.edited} {isKo ? '수정됨' : isKm ? 'បានកែតម្រូវ' : 'corrected'}
                  </span>
                </>
              )}
              {stats.attention > 0 && (
                <>
                  <span aria-hidden="true" className="text-slate-300">
                    ·
                  </span>
                  <span className="text-amber-700 tabular-nums">
                    {stats.attention}{' '}
                    {isKo ? '확인 권장' : isKm ? 'គួរពិនិត្យ' : 'needs review'}
                  </span>
                </>
              )}
            </div>

            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900 [text-wrap:balance]">
              {isKo
                ? '원본 서류와 대조하여 OCR 오류를 최종 수정하세요'
                : isKm
                ? 'ផ្ទៀងផ្ទាត់ឯកសារដើម និងកែតម្រូវកំហុស OCR មុនបង្កើត PDF'
                : 'Review and Correct Extracted Fields Before PDF Form'}
            </h1>
            <p className="text-xs sm:text-sm text-slate-600 max-w-2xl leading-relaxed">
              {isKo
                ? '왼쪽의 원본 서류를 보면서 오른쪽의 추출 필드를 직접 수정한 뒤 공식 PDF 신청서에 최종 반영합니다.'
                : isKm
                ? 'មើលឯកសារដើមនៅខាងឆ្វេង ហើយកែសម្រួលអក្សរដែល OCR ចាប់បាននៅខាងស្តាំឱ្យត្រឹមត្រូវ ១០០% មុនពេលបញ្ចូលទៅទម្រង់ PDF ផ្លូវការ។'
                : 'Inspect your original uploaded document on the left and correct any OCR misreads on the right before finalizing values for the official PDF form.'}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={handleTriggerRescan}
              disabled={isScanning}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 transition-colors cursor-pointer disabled:opacity-50 whitespace-nowrap shrink-0"
            >
              <RefreshCw
                className={`w-3.5 h-3.5 ${isScanning ? 'animate-spin' : ''}`}
                aria-hidden="true"
              />
              <span>
                {isScanning
                  ? isKo
                    ? '재스캔 중...'
                    : isKm
                    ? 'កំពុងស្កេន...'
                    : 'Re-scanning...'
                  : isKo
                  ? 'OCR 재스캔'
                  : isKm
                  ? 'ស្កេន OCR ម្តងទៀត'
                  : 'Re-scan OCR'}
              </span>
            </button>

            {stats.edited > 0 && (
              <button
                type="button"
                onClick={revertAllEdits}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 transition-colors cursor-pointer whitespace-nowrap shrink-0"
              >
                <Undo2 className="w-3.5 h-3.5" aria-hidden="true" />
                <span>
                  {isKo
                    ? `수정 초기화 (${stats.edited})`
                    : isKm
                    ? `ត្រឡប់ការកែ (${stats.edited})`
                    : `Undo All (${stats.edited})`}
                </span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Side-by-Side Split Workbench: Original Document (Left) | Editable Extracted Fields (Right) */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-5 items-start">
        {/* LEFT PANE: Original Uploaded Document Viewer */}
        <div className="xl:col-span-6 xl:sticky xl:top-24 bg-white border border-slate-200 rounded-xl overflow-hidden flex flex-col">
          {/* Document Selector Tabs */}
          <div className="px-4 py-3 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2 bg-slate-50/70">
            <div
              role="tablist"
              aria-label="Uploaded Documents"
              className="flex items-center gap-1 p-1 bg-slate-200/70 rounded-lg overflow-x-auto max-w-full"
            >
              {docTabs.map((tab) => {
                const isSelected = activeDocTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    role="tab"
                    aria-selected={isSelected}
                    onClick={() => {
                      setActiveDocTab(tab.id);
                      setZoom(100);
                      setRotation(0);
                    }}
                    className={`px-2.5 py-1.5 rounded-md text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                      isSelected
                        ? 'bg-white text-slate-900 shadow-2xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    <span>{tab.label}</span>
                    {tab.count > 0 && (
                      <span className="ml-1 text-[10px] font-mono tabular-nums text-slate-400">
                        ({tab.count})
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            <button
              type="button"
              onClick={() => setAutoSyncDoc((v) => !v)}
              title={
                isKo
                  ? '오른쪽 입력 칸을 선택할 때 해당 원본 서류로 자동 전환'
                  : isKm
                  ? 'ប្តូរឯកសារដោយស្វ័យប្រវត្តិតាមប្រអប់ដែលអ្នកចុច'
                  : 'Automatically switch document when focusing a field'
              }
              className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[11px] font-semibold border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                autoSyncDoc
                  ? 'bg-blue-50 text-blue-800 border-blue-200'
                  : 'bg-white text-slate-600 border-slate-200 hover:text-slate-900'
              }`}
            >
              <Link2 className="w-3.5 h-3.5" aria-hidden="true" />
              <span>
                {isKo ? '필드 연동' : isKm ? 'ភ្ជាប់ស្វ័យប្រវត្តិ' : 'Auto-sync'}
              </span>
            </button>
          </div>

          {/* Image Inspection Controls */}
          <div className="px-4 py-2 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2 text-xs bg-white">
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="font-semibold text-slate-800 truncate">
                {activeDocInfo.label}
              </span>
              {activeDocInfo.pageCount > 1 && (
                <div className="inline-flex items-center gap-1 ml-1">
                  <button
                    type="button"
                    aria-label="Previous page"
                    onClick={() => {
                      if (activeDocTab === 'topik') {
                        setTopikPageIdx((i) => Math.max(0, i - 1));
                      } else if (activeDocTab === 'passport') {
                        setPassportPageIdx((i) => Math.max(0, i - 1));
                      }
                    }}
                    disabled={activeDocInfo.pageIndex === 0}
                    className="p-1 rounded border border-slate-200 text-slate-600 hover:bg-slate-100 disabled:opacity-40 cursor-pointer"
                  >
                    <ChevronLeft className="w-3.5 h-3.5" />
                  </button>
                  <span className="font-mono tabular-nums text-[11px] text-slate-600 px-1">
                    {activeDocInfo.pageIndex + 1}/{activeDocInfo.pageCount}
                  </span>
                  <button
                    type="button"
                    aria-label="Next page"
                    onClick={() => {
                      if (activeDocTab === 'topik') {
                        setTopikPageIdx((i) => Math.min(docs.topikCertList.length - 1, i + 1));
                      } else if (activeDocTab === 'passport') {
                        setPassportPageIdx((i) => Math.min(docs.passportList.length - 1, i + 1));
                      }
                    }}
                    disabled={activeDocInfo.pageIndex >= activeDocInfo.pageCount - 1}
                    className="p-1 rounded border border-slate-200 text-slate-600 hover:bg-slate-100 disabled:opacity-40 cursor-pointer"
                  >
                    <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
            </div>

            <div className="flex items-center gap-1 shrink-0">
              <button
                type="button"
                aria-label="Zoom out"
                onClick={() => setZoom((z) => Math.max(50, z - 25))}
                className="p-1.5 rounded-md border border-slate-200 text-slate-600 hover:bg-slate-100 cursor-pointer"
              >
                <ZoomOut className="w-3.5 h-3.5" />
              </button>
              <span className="w-11 text-center font-mono tabular-nums text-[11px] font-semibold text-slate-700">
                {zoom}%
              </span>
              <button
                type="button"
                aria-label="Zoom in"
                onClick={() => setZoom((z) => Math.min(300, z + 25))}
                className="p-1.5 rounded-md border border-slate-200 text-slate-600 hover:bg-slate-100 cursor-pointer"
              >
                <ZoomIn className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                aria-label="Rotate counterclockwise"
                onClick={() => setRotation((r) => (r - 90 + 360) % 360)}
                className="p-1.5 rounded-md border border-slate-200 text-slate-600 hover:bg-slate-100 cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                aria-label="Rotate clockwise"
                onClick={() => setRotation((r) => (r + 90) % 360)}
                className="p-1.5 rounded-md border border-slate-200 text-slate-600 hover:bg-slate-100 cursor-pointer"
              >
                <RotateCw className="w-3.5 h-3.5" />
              </button>
              {(zoom !== 100 || rotation !== 0) && (
                <button
                  type="button"
                  onClick={() => {
                    setZoom(100);
                    setRotation(0);
                  }}
                  className="px-2 py-1 rounded-md border border-slate-200 text-[11px] font-semibold text-slate-600 hover:bg-slate-100 cursor-pointer whitespace-nowrap"
                >
                  {isKo ? '초기화' : isKm ? 'ដើមវិញ' : 'Reset'}
                </button>
              )}
              {displayImageUrl && (
                <button
                  type="button"
                  aria-label="Fullscreen preview"
                  onClick={() => setIsFullscreen(true)}
                  className="p-1.5 rounded-md border border-slate-200 text-slate-600 hover:bg-slate-100 cursor-pointer"
                >
                  <Maximize2 className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>

          {/* Document Viewport */}
          <div className="relative bg-slate-900 min-h-[340px] sm:min-h-[440px] max-h-[560px] overflow-auto flex items-center justify-center p-4">
            {pdfRendering ? (
              <div className="text-center text-slate-300 space-y-2 py-12">
                <RefreshCw className="w-6 h-6 mx-auto animate-spin text-blue-400" />
                <p className="text-xs font-medium">
                  {isKo
                    ? 'PDF 원본 페이지를 불러오는 중...'
                    : isKm
                    ? 'កំពុងបើកមើលទំព័រ PDF ដើម...'
                    : 'Rendering uploaded PDF page...'}
                </p>
              </div>
            ) : displayImageUrl ? (
              <div
                className="transition-transform duration-150 ease-out origin-center"
                style={{
                  transform: `scale(${zoom / 100}) rotate(${rotation}deg)`,
                }}
              >
                <img
                  src={displayImageUrl}
                  alt={activeDocInfo.label}
                  referrerPolicy="no-referrer"
                  className="max-w-full max-h-[480px] object-contain rounded shadow-md select-none"
                />
              </div>
            ) : (
              <div className="text-center max-w-xs space-y-3 py-10 px-4">
                <FileText className="w-9 h-9 mx-auto text-slate-500" aria-hidden="true" />
                <div className="space-y-1">
                  <p className="text-sm font-semibold text-slate-200">
                    {isKo
                      ? `${activeDocInfo.label} 파일이 아직 없습니다`
                      : isKm
                      ? `មិនទាន់មានឯកសារ ${activeDocInfo.label} នៅឡើយទេ`
                      : `No ${activeDocInfo.label} Uploaded`}
                  </p>
                  <p className="text-xs text-slate-400">
                    {isKo
                      ? '1단계에서 해당 서류를 업로드하면 여기서 원본과 대조할 수 있습니다.'
                      : isKm
                      ? 'សូមបង្ហោះឯកសារនេះក្នុងជំហានទី ១ ដើម្បីផ្ទៀងផ្ទាត់ទល់មុខគ្នានៅទីនេះ។'
                      : 'Upload this document in Step 1 to inspect it side-by-side here.'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={onGoToStep1Upload}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold bg-white text-slate-900 hover:bg-slate-100 transition-colors cursor-pointer"
                >
                  <Upload className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>
                    {isKo ? '1단계에서 업로드' : isKm ? 'ទៅបង្ហោះក្នុងជំហានទី ១' : 'Upload in Step 1'}
                  </span>
                </button>
              </div>
            )}
          </div>

          {/* Active Field Focus Reference & Raw OCR Toggle */}
          <div className="px-4 py-2.5 border-t border-slate-200 bg-slate-50/70 flex flex-wrap items-center justify-between gap-2 text-xs">
            <div className="flex items-center gap-1.5 min-w-0 text-slate-600">
              <span className="text-slate-400">
                {isKo ? '현재 확인 중:' : isKm ? 'កំពុងពិនិត្យ:' : 'Inspecting:'}
              </span>
              <span className="font-semibold text-slate-900 truncate">
                {activeFieldLabelMap[activeField]}
              </span>
            </div>

            <button
              type="button"
              onClick={() => setShowRawOcr((v) => !v)}
              className="text-xs font-semibold text-blue-700 hover:text-blue-900 whitespace-nowrap shrink-0 cursor-pointer"
            >
              {showRawOcr
                ? isKo
                  ? '원본 OCR 텍스트 숨기기'
                  : isKm
                  ? 'លាក់អក្សរ OCR ឆៅ'
                  : 'Hide Raw OCR Text'
                : isKo
                ? '원본 OCR 텍스트 보기'
                : isKm
                ? 'មើលអក្សរ OCR ឆៅ'
                : 'View Raw OCR Text'}
            </button>
          </div>

          {showRawOcr && (
            <div className="border-t border-slate-200 bg-white px-4 py-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-semibold text-slate-600">
                  {isKo
                    ? '추출된 원문 텍스트'
                    : isKm
                    ? 'អក្សរឆៅដែលចាប់បានពី OCR'
                    : 'Raw Extracted OCR Text'}
                </span>
                <button
                  type="button"
                  onClick={handleCopyRaw}
                  className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-600 hover:text-slate-900 cursor-pointer"
                >
                  {copiedRaw ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-600" />
                      <span className="text-emerald-700">
                        {isKo ? '복사됨' : isKm ? 'បានចម្លង' : 'Copied'}
                      </span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" />
                      <span>{isKo ? '복사' : isKm ? 'ចម្លង' : 'Copy'}</span>
                    </>
                  )}
                </button>
              </div>
              <pre className="text-[11px] font-mono text-slate-700 bg-slate-50 border border-slate-200 rounded-lg p-3 max-h-40 overflow-auto whitespace-pre-wrap break-words leading-relaxed">
                {rawTextPreview.trim() ||
                  [
                    `Name: ${fields.name || '—'}`,
                    `ARC: ${fields.regNumber1 || '______'}-${fields.regNumber2 || '_______'}`,
                    `Entry Date: ${fields.entryDate || '—'}`,
                    `Nationality: ${fields.nationality || '—'}`,
                    `Visa: ${fields.visaStatus || '—'}`,
                    `Address: ${fields.address || '—'}`,
                    `TOPIK Round / Grade: ${fields.round || '—'} / ${fields.grade || '—'}`,
                    `Exam Date / Valid Until: ${fields.examDate || '—'} / ${fields.validUntil || '—'}`,
                    `Passport: ${fields.passportNo || '—'} (Exp: ${fields.passportExpiry || '—'})`,
                  ].join('\n')}
              </pre>
            </div>
          )}
        </div>

        {/* RIGHT PANE: Editable Extracted Text Fields */}
        <div className="xl:col-span-6 bg-white border border-slate-200 rounded-xl overflow-hidden flex flex-col">
          {/* Filter Tabs & Search */}
          <div className="px-4 py-3 border-b border-slate-200 bg-slate-50/70 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
            <div className="flex items-center gap-1 p-1 bg-slate-200/70 rounded-lg self-start">
              {(
                [
                  {
                    id: 'all',
                    label: isKo ? '전체' : isKm ? 'ទាំងអស់' : 'All',
                    count: stats.total,
                  },
                  {
                    id: 'attention',
                    label: isKo ? '확인 필요' : isKm ? 'គួរពិនិត្យ' : 'Needs Review',
                    count: stats.attention,
                  },
                  {
                    id: 'edited',
                    label: isKo ? '수정됨' : isKm ? 'បានកែ' : 'Corrected',
                    count: stats.edited,
                  },
                ] as { id: FilterTab; label: string; count: number }[]
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setFilterTab(tab.id)}
                  className={`px-2.5 py-1.5 rounded-md text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    filterTab === tab.id
                      ? 'bg-white text-slate-900 shadow-2xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <span>{tab.label}</span>
                  <span className="ml-1 font-mono tabular-nums text-[11px] text-slate-400">
                    {tab.count}
                  </span>
                </button>
              ))}
            </div>

            <div className="relative flex-1 sm:max-w-[220px]">
              <Search
                className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none"
                aria-hidden="true"
              />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={
                  isKo ? '필드 검색...' : isKm ? 'ស្វែងរកប្រអប់...' : 'Filter fields...'
                }
                className="w-full pl-8 pr-7 py-1.5 text-xs bg-white border border-slate-300 rounded-lg text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              {searchQuery && (
                <button
                  type="button"
                  aria-label="Clear search"
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>

          {/* Editable Field Groups */}
          <div className="divide-y divide-slate-200">
            {!hasAnyVisibleField && (
              <div className="px-6 py-12 text-center space-y-2">
                <p className="text-sm font-semibold text-slate-800">
                  {isKo
                    ? '조건에 맞는 항목이 없습니다'
                    : isKm
                    ? 'គ្មានប្រអប់ណាត្រូវនឹងតម្រងនេះទេ'
                    : 'No fields match this filter'}
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setFilterTab('all');
                    setSearchQuery('');
                  }}
                  className="text-xs font-semibold text-blue-700 hover:underline cursor-pointer"
                >
                  {isKo ? '전체 필드 보기' : isKm ? 'បង្ហាញប្រអប់ទាំងអស់' : 'Show all fields'}
                </button>
              </div>
            )}

            {/* 01. Identity & ARC Details */}
            {showIdentitySection && (
              <div className="p-4 sm:p-5 space-y-4">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="text-sm font-bold text-slate-900">
                    {isKo
                      ? '01. 신원 및 외국인등록증 (ARC 앞면)'
                      : isKm
                      ? '01. អត្តសញ្ញាណ និងកាត ARC (ផ្នែកខាងមុខ)'
                      : '01. Identity & ARC Details'}
                  </h2>
                  <button
                    type="button"
                    onClick={() => setActiveDocTab('arcFront')}
                    className="text-[11px] font-semibold text-slate-500 hover:text-blue-700 whitespace-nowrap cursor-pointer"
                  >
                    {isKo ? 'ARC 앞면 보기' : isKm ? 'មើល ARC មុខ' : 'View ARC Front'}
                  </button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {/* Name */}
                  {shouldShowField('name', 'name full name 성명 ឈ្មោះ') && (
                    <div className="sm:col-span-2">
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <label
                          htmlFor="rc-name"
                          className="text-xs font-semibold text-slate-700"
                        >
                          {isKo ? '성명 (Name)' : isKm ? 'ឈ្មោះពេញ (Name / 성명)' : 'Full Name (성명)'}
                        </label>
                        <ConfidenceBar
                          confidence={effectiveConfidence.name}
                          isEdited={isFieldEdited('name')}
                          lang={lang}
                        />
                      </div>
                      <input
                        id="rc-name"
                        type="text"
                        value={fields.name}
                        onFocus={() => handleFieldFocus('name')}
                        onChange={(e) =>
                          setFields((p) => ({ ...p, name: e.target.value.toUpperCase() }))
                        }
                        placeholder="SOK SRORNG"
                        className="w-full px-3 py-2 text-sm font-semibold uppercase text-slate-900 bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-blue-600"
                      />
                      {renderRevertMeta('name')}
                    </div>
                  )}

                  {/* ARC Number */}
                  {shouldShowField('regNumber', 'arc reg registration number 외국인등록번호 លេខកាត') && (
                    <div className="sm:col-span-2">
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <label
                          htmlFor="rc-reg1"
                          className="text-xs font-semibold text-slate-700"
                        >
                          {isKo
                            ? '외국인등록번호 (ARC Number)'
                            : isKm
                            ? 'លេខកាត ARC (외국인등록번호)'
                            : 'ARC Number (외국인등록번호)'}
                        </label>
                        <ConfidenceBar
                          confidence={effectiveConfidence.regNumber}
                          isEdited={isFieldEdited('regNumber')}
                          lang={lang}
                        />
                      </div>
                      <div className="flex items-center gap-2">
                        <input
                          id="rc-reg1"
                          type="text"
                          inputMode="numeric"
                          maxLength={6}
                          value={fields.regNumber1}
                          onFocus={() => handleFieldFocus('regNumber')}
                          onChange={(e) =>
                            setFields((p) => ({
                              ...p,
                              regNumber1: e.target.value.replace(/[^0-9]/g, '').slice(0, 6),
                            }))
                          }
                          placeholder="YYMMDD (6 digits)"
                          className="w-full px-3 py-2 text-sm font-mono font-semibold tabular-nums text-center text-slate-900 bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
                        />
                        <span className="text-slate-400 font-bold select-none">-</span>
                        <input
                          id="rc-reg2"
                          type="text"
                          inputMode="numeric"
                          maxLength={7}
                          value={fields.regNumber2}
                          onFocus={() => handleFieldFocus('regNumber')}
                          onChange={(e) =>
                            setFields((p) => ({
                              ...p,
                              regNumber2: e.target.value.replace(/[^0-9]/g, '').slice(0, 7),
                            }))
                          }
                          placeholder="5XXXXXX (7 digits)"
                          className="w-full px-3 py-2 text-sm font-mono font-semibold tabular-nums text-center text-slate-900 bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
                        />
                      </div>
                      {(fields.regNumber1.length > 0 || fields.regNumber2.length > 0) &&
                        (fields.regNumber1.length !== 6 || fields.regNumber2.length !== 7) && (
                          <p className="mt-1 text-[11px] font-medium text-amber-700 font-mono tabular-nums">
                            {isKo
                              ? `앞 6자리(${fields.regNumber1.length}/6) - 뒤 7자리(${fields.regNumber2.length}/7) 확인 필요`
                              : isKm
                              ? `ត្រូវមាន ៦ខ្ទង់ (${fields.regNumber1.length}/6) - ៧ខ្ទង់ (${fields.regNumber2.length}/7)`
                              : `Expected 6 digits (${fields.regNumber1.length}/6) - 7 digits (${fields.regNumber2.length}/7)`}
                          </p>
                        )}
                      {renderRevertMeta('regNumber')}
                    </div>
                  )}

                  {/* Entry Date */}
                  {shouldShowField('entryDate', 'entry date 입국일 ថ្ងៃចូល') && (
                    <div>
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <label
                          htmlFor="rc-entryDate"
                          className="text-xs font-semibold text-slate-700"
                        >
                          {isKo
                            ? '입국일 (Entry Date)'
                            : isKm
                            ? 'ថ្ងៃចូលកូរ៉េ (Entry Date)'
                            : 'Entry Date (입국일)'}
                        </label>
                        <ConfidenceBar
                          confidence={effectiveConfidence.entryDate}
                          isEdited={isFieldEdited('entryDate')}
                          lang={lang}
                        />
                      </div>
                      <input
                        id="rc-entryDate"
                        type="date"
                        value={fields.entryDate}
                        onFocus={() => handleFieldFocus('entryDate')}
                        onChange={(e) =>
                          setFields((p) => ({ ...p, entryDate: e.target.value }))
                        }
                        className="w-full px-3 py-2 text-sm font-mono font-semibold tabular-nums text-slate-900 bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
                      />
                      {renderRevertMeta('entryDate')}
                    </div>
                  )}

                  {/* Gender */}
                  {shouldShowField('gender', 'gender sex 성별 ភេទ') && (
                    <div>
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <span className="text-xs font-semibold text-slate-700">
                          {isKo ? '성별 (Gender)' : isKm ? 'ភេទ (Gender)' : 'Gender (성별)'}
                        </span>
                        <ConfidenceBar
                          confidence={effectiveConfidence.gender}
                          isEdited={isFieldEdited('gender')}
                          lang={lang}
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-1.5 p-1 bg-slate-100 rounded-lg">
                        <button
                          type="button"
                          onClick={() => {
                            handleFieldFocus('gender');
                            setFields((p) => ({ ...p, gender: '남' }));
                          }}
                          className={`py-1.5 rounded-md text-xs font-semibold transition-colors cursor-pointer ${
                            fields.gender === '남'
                              ? 'bg-white text-slate-900 shadow-2xs'
                              : 'text-slate-600 hover:text-slate-900'
                          }`}
                        >
                          {isKo ? '남 (Male)' : isKm ? 'ប្រុស (남)' : 'Male (남)'}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            handleFieldFocus('gender');
                            setFields((p) => ({ ...p, gender: '여' }));
                          }}
                          className={`py-1.5 rounded-md text-xs font-semibold transition-colors cursor-pointer ${
                            fields.gender === '여'
                              ? 'bg-white text-slate-900 shadow-2xs'
                              : 'text-slate-600 hover:text-slate-900'
                          }`}
                        >
                          {isKo ? '여 (Female)' : isKm ? 'ស្រី (여)' : 'Female (여)'}
                        </button>
                      </div>
                      {renderRevertMeta('gender')}
                    </div>
                  )}

                  {/* Nationality */}
                  {shouldShowField('nationality', 'nationality country 국적 សញ្ជាតិ') && (
                    <div>
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <label
                          htmlFor="rc-nationality"
                          className="text-xs font-semibold text-slate-700"
                        >
                          {isKo ? '국적 (Nationality)' : isKm ? 'សញ្ជាតិ (Nationality)' : 'Nationality (국적)'}
                        </label>
                        <ConfidenceBar
                          confidence={effectiveConfidence.nationality}
                          isEdited={isFieldEdited('nationality')}
                          lang={lang}
                        />
                      </div>
                      <input
                        id="rc-nationality"
                        type="text"
                        value={fields.nationality}
                        onFocus={() => handleFieldFocus('nationality')}
                        onChange={(e) =>
                          setFields((p) => ({
                            ...p,
                            nationality: e.target.value.toUpperCase(),
                          }))
                        }
                        placeholder="CAMBODIA"
                        className="w-full px-3 py-2 text-sm font-semibold uppercase text-slate-900 bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
                      />
                      {renderRevertMeta('nationality')}
                    </div>
                  )}

                  {/* Visa Status */}
                  {shouldShowField('visaStatus', 'visa status sojourn 체류자격 វីសា') && (
                    <div>
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <label
                          htmlFor="rc-visa"
                          className="text-xs font-semibold text-slate-700"
                        >
                          {isKo
                            ? '체류자격 (Visa Status)'
                            : isKm
                            ? 'ប្រភេទវីសា (Visa Status)'
                            : 'Visa Status (체류자격)'}
                        </label>
                        <ConfidenceBar
                          confidence={effectiveConfidence.visaStatus}
                          isEdited={isFieldEdited('visaStatus')}
                          lang={lang}
                        />
                      </div>
                      <select
                        id="rc-visa"
                        value={isKnownVisa ? fields.visaStatus.toUpperCase() : '__custom__'}
                        onFocus={() => handleFieldFocus('visaStatus')}
                        onChange={(e) => {
                          if (e.target.value !== '__custom__') {
                            setFields((p) => ({ ...p, visaStatus: e.target.value }));
                          }
                        }}
                        className="w-full px-3 py-2 text-sm font-semibold text-slate-900 bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
                      >
                        <option value="">
                          {isKo ? '-- 체류자격 선택 --' : isKm ? '-- ជ្រើសរើសវីសា --' : '-- Select Visa --'}
                        </option>
                        {!isKnownVisa && fields.visaStatus && (
                          <option value="__custom__">{fields.visaStatus}</option>
                        )}
                        {KOREAN_VISA_GROUPS.map((group) => (
                          <optgroup
                            key={group.groupName}
                            label={isKo ? group.groupNameKo : isKm ? group.groupNameKm : group.groupName}
                          >
                            {group.items.map((opt) => (
                              <option key={opt.code} value={opt.code}>
                                {opt.labelKo}
                              </option>
                            ))}
                          </optgroup>
                        ))}
                      </select>
                      {renderRevertMeta('visaStatus')}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* 02. Residence Address (ARC Back) */}
            {showAddressSection && (
              <div className="p-4 sm:p-5 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="text-sm font-bold text-slate-900">
                    {isKo
                      ? '02. 체류지 주소 (ARC 뒷면)'
                      : isKm
                      ? '02. អាសយដ្ឋានស្នាក់នៅ (កាត ARC ក្រោយ)'
                      : '02. Residence Address (ARC Back)'}
                  </h2>
                  <button
                    type="button"
                    onClick={() => setActiveDocTab('arcBack')}
                    className="text-[11px] font-semibold text-slate-500 hover:text-blue-700 whitespace-nowrap cursor-pointer"
                  >
                    {isKo ? 'ARC 뒷면 보기' : isKm ? 'មើល ARC ក្រោយ' : 'View ARC Back'}
                  </button>
                </div>

                <div>
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <label
                      htmlFor="rc-address"
                      className="text-xs font-semibold text-slate-700"
                    >
                      {isKo ? '체류지 주소 (Address)' : isKm ? 'អាសយដ្ឋាន (Address)' : 'Korean Address (체류지)'}
                    </label>
                    <ConfidenceBar
                      confidence={effectiveConfidence.address}
                      isEdited={isFieldEdited('address')}
                      lang={lang}
                    />
                  </div>
                  <div className="flex gap-2">
                    <input
                      id="rc-address"
                      type="text"
                      value={fields.address}
                      onFocus={() => handleFieldFocus('address')}
                      onChange={(e) =>
                        setFields((p) => ({ ...p, address: e.target.value }))
                      }
                      placeholder={
                        isKo
                          ? '경기도 화성시 봉담읍 ...'
                          : isKm
                          ? 'បញ្ចូលអាសយដ្ឋានជាភាសាកូរ៉េ...'
                          : 'Enter Korean residence address...'
                      }
                      className="flex-1 min-w-0 px-3 py-2 text-sm font-medium text-slate-900 bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        handleFieldFocus('address');
                        setIsDaumOpen(true);
                      }}
                      className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 border border-slate-300 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      <MapPin className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>{isKo ? '주소 검색' : isKm ? 'ស្វែងរកអាសយដ្ឋាន' : 'Lookup'}</span>
                    </button>
                  </div>

                  {matchedOffice && (
                    <p className="mt-1.5 text-[11px] text-slate-600">
                      <span className="font-semibold text-emerald-700">
                        {matchedOffice.name}
                      </span>
                      <span aria-hidden="true" className="mx-1.5 text-slate-300">
                        ·
                      </span>
                      <span className="font-mono text-slate-500">{matchedOffice.email}</span>
                    </p>
                  )}
                  {renderRevertMeta('address')}
                </div>
              </div>
            )}

            {/* 03. TOPIK Score Certificate */}
            {showTopikSection && (
              <div className="p-4 sm:p-5 space-y-4">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="text-sm font-bold text-slate-900">
                    {isKo
                      ? '03. TOPIK 성적증명서 정보'
                      : isKm
                      ? '03. ព័ត៌មានសញ្ញាបត្រ TOPIK'
                      : '03. TOPIK Score Certificate'}
                  </h2>
                  <button
                    type="button"
                    onClick={() => setActiveDocTab('topik')}
                    className="text-[11px] font-semibold text-slate-500 hover:text-blue-700 whitespace-nowrap cursor-pointer"
                  >
                    {isKo ? 'TOPIK 서류 보기' : isKm ? 'មើលសញ្ញាបត្រ TOPIK' : 'View TOPIK'}
                  </button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {/* Doc Verification No */}
                  {shouldShowField('docVerificationNo', 'document verification 문서확인번호 ផ្ទៀងផ្ទាត់') && (
                    <div className="sm:col-span-2">
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <label
                          htmlFor="rc-docVer"
                          className="text-xs font-semibold text-slate-700"
                        >
                          {isKo
                            ? '문서확인번호 (Verification No.)'
                            : isKm
                            ? 'លេខផ្ទៀងផ្ទាត់ឯកសារ (문서확인번호)'
                            : 'Document Verification No. (문서확인번호)'}
                        </label>
                        <ConfidenceBar
                          confidence={effectiveConfidence.docVerificationNo}
                          isEdited={isFieldEdited('docVerificationNo')}
                          lang={lang}
                        />
                      </div>
                      <input
                        id="rc-docVer"
                        type="text"
                        value={fields.docVerificationNo}
                        onFocus={() => handleFieldFocus('docVerificationNo')}
                        onChange={(e) =>
                          setFields((p) => ({ ...p, docVerificationNo: e.target.value }))
                        }
                        placeholder="0000-0000-0000-0000"
                        className="w-full px-3 py-2 text-sm font-mono font-semibold tabular-nums text-slate-900 bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
                      />
                      {renderRevertMeta('docVerificationNo')}
                    </div>
                  )}

                  {/* Exam Registration No */}
                  {shouldShowField('examNumber', 'exam number registration 수험번호 លេខប្រឡង') && (
                    <div>
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <label
                          htmlFor="rc-examNo"
                          className="text-xs font-semibold text-slate-700"
                        >
                          {isKo ? '수험번호 (Exam No.)' : isKm ? 'លេខសម្គាល់ប្រឡង (수험번호)' : 'Exam No. (수험번호)'}
                        </label>
                        <ConfidenceBar
                          confidence={effectiveConfidence.examNumber}
                          isEdited={isFieldEdited('examNumber')}
                          lang={lang}
                        />
                      </div>
                      <input
                        id="rc-examNo"
                        type="text"
                        value={fields.examNumber}
                        onFocus={() => handleFieldFocus('examNumber')}
                        onChange={(e) =>
                          setFields((p) => ({ ...p, examNumber: e.target.value }))
                        }
                        placeholder="107000123"
                        className="w-full px-3 py-2 text-sm font-mono font-semibold tabular-nums text-slate-900 bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
                      />
                      {renderRevertMeta('examNumber')}
                    </div>
                  )}

                  {/* Test Round */}
                  {shouldShowField('round', 'round 회차 លើក') && (
                    <div>
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <label
                          htmlFor="rc-round"
                          className="text-xs font-semibold text-slate-700"
                        >
                          {isKo ? '시험 회차 (Round)' : isKm ? 'លើកប្រឡង (회차)' : 'Test Round (회차)'}
                        </label>
                        <ConfidenceBar
                          confidence={effectiveConfidence.round}
                          isEdited={isFieldEdited('round')}
                          lang={lang}
                        />
                      </div>
                      <input
                        id="rc-round"
                        type="text"
                        value={fields.round}
                        onFocus={() => handleFieldFocus('round')}
                        onChange={(e) =>
                          setFields((p) => ({ ...p, round: e.target.value }))
                        }
                        placeholder="제107회"
                        className="w-full px-3 py-2 text-sm font-semibold tabular-nums text-slate-900 bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
                      />
                      {renderRevertMeta('round')}
                    </div>
                  )}

                  {/* Exam Date */}
                  {shouldShowField('examDate', 'exam date 시험일 ថ្ងៃប្រឡង') && (
                    <div>
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <label
                          htmlFor="rc-examDate"
                          className="text-xs font-semibold text-slate-700"
                        >
                          {isKo ? '시험일 (Exam Date)' : isKm ? 'ថ្ងៃប្រឡង (시험일)' : 'Exam Date (시험일)'}
                        </label>
                        <ConfidenceBar
                          confidence={effectiveConfidence.examDate}
                          isEdited={isFieldEdited('examDate')}
                          lang={lang}
                        />
                      </div>
                      <input
                        id="rc-examDate"
                        type="date"
                        value={fields.examDate}
                        onFocus={() => handleFieldFocus('examDate')}
                        onChange={(e) =>
                          setFields((p) => ({ ...p, examDate: e.target.value }))
                        }
                        className="w-full px-3 py-2 text-sm font-mono font-semibold tabular-nums text-slate-900 bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
                      />
                      {renderRevertMeta('examDate')}
                    </div>
                  )}

                  {/* Valid Until */}
                  {shouldShowField('validUntil', 'valid until expiry 유효기간 សុពលភាព') && (
                    <div>
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <label
                          htmlFor="rc-validUntil"
                          className="text-xs font-semibold text-slate-700"
                        >
                          {isKo ? '유효기간 (Valid Until)' : isKm ? 'សុពលភាពដល់ (유효기간)' : 'Valid Until (유효기간)'}
                        </label>
                        <ConfidenceBar
                          confidence={effectiveConfidence.validUntil}
                          isEdited={isFieldEdited('validUntil')}
                          lang={lang}
                        />
                      </div>
                      <input
                        id="rc-validUntil"
                        type="date"
                        value={fields.validUntil}
                        onFocus={() => handleFieldFocus('validUntil')}
                        onChange={(e) =>
                          setFields((p) => ({ ...p, validUntil: e.target.value }))
                        }
                        className="w-full px-3 py-2 text-sm font-mono font-semibold tabular-nums text-slate-900 bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
                      />
                      {renderRevertMeta('validUntil')}
                    </div>
                  )}

                  {/* Grade */}
                  {shouldShowField('grade', 'grade level topik 등급 កម្រិត kiip') && (
                    <div className="sm:col-span-2">
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <label
                          htmlFor="rc-grade"
                          className="text-xs font-semibold text-slate-700"
                        >
                          {isKo ? '취득 등급 (TOPIK Grade)' : isKm ? 'កម្រិត TOPIK (등급)' : 'TOPIK Grade (등급)'}
                        </label>
                        <ConfidenceBar
                          confidence={effectiveConfidence.grade}
                          isEdited={isFieldEdited('grade')}
                          lang={lang}
                        />
                      </div>
                      <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                        <select
                          id="rc-grade"
                          value={fields.grade}
                          onFocus={() => handleFieldFocus('grade')}
                          onChange={(e) =>
                            setFields((p) => ({ ...p, grade: e.target.value }))
                          }
                          className="sm:w-44 px-3 py-2 text-sm font-semibold text-slate-900 bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
                        >
                          <option value="">
                            {isKo ? '-- 등급 선택 --' : isKm ? '-- ជ្រើសកម្រិត --' : '-- Select Grade --'}
                          </option>
                          <option value="3급">3급 (TOPIK Level 3)</option>
                          <option value="4급">4급 (TOPIK Level 4)</option>
                          <option value="5급">5급 (TOPIK Level 5)</option>
                          <option value="6급">6급 (TOPIK Level 6)</option>
                        </select>
                        <span className="text-xs text-slate-600">
                          {isKo ? 'KIIP 배정 단계:' : isKm ? 'កម្រិត KIIP ទទួលបាន:' : 'KIIP Placement:'}{' '}
                          <strong className="text-slate-900">
                            {mapGradeToKiipStage(fields.grade)}
                          </strong>
                        </span>
                      </div>
                      {renderRevertMeta('grade')}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* 04. Passport & Contact Details */}
            {showPassportContactSection && (
              <div className="p-4 sm:p-5 space-y-4">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="text-sm font-bold text-slate-900">
                    {isKo
                      ? '04. 여권 및 연락처 정보'
                      : isKm
                      ? '04. លិខិតឆ្លងដែន និងព័ត៌មានទំនាក់ទំនង'
                      : '04. Passport & Contact'}
                  </h2>
                  <button
                    type="button"
                    onClick={() => setActiveDocTab('passport')}
                    className="text-[11px] font-semibold text-slate-500 hover:text-blue-700 whitespace-nowrap cursor-pointer"
                  >
                    {isKo ? '여권 보기' : isKm ? 'មើលលិខិតឆ្លងដែន' : 'View Passport'}
                  </button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {/* Passport No */}
                  {shouldShowField('passportNo', 'passport number 여권번호 លិខិតឆ្លងដែន') && (
                    <div>
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <label
                          htmlFor="rc-passportNo"
                          className="text-xs font-semibold text-slate-700"
                        >
                          {isKo ? '여권번호 (Passport No.)' : isKm ? 'លេខលិខិតឆ្លងដែន (여권번호)' : 'Passport No. (여권번호)'}
                        </label>
                        <ConfidenceBar
                          confidence={effectiveConfidence.passportNo}
                          isEdited={isFieldEdited('passportNo')}
                          lang={lang}
                        />
                      </div>
                      <input
                        id="rc-passportNo"
                        type="text"
                        value={fields.passportNo}
                        onFocus={() => handleFieldFocus('passportNo')}
                        onChange={(e) =>
                          setFields((p) => ({
                            ...p,
                            passportNo: e.target.value.toUpperCase(),
                          }))
                        }
                        placeholder="N01234567"
                        className="w-full px-3 py-2 text-sm font-mono font-semibold uppercase tabular-nums text-slate-900 bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
                      />
                      {renderRevertMeta('passportNo')}
                    </div>
                  )}

                  {/* Passport Expiry */}
                  {shouldShowField('passportExpiry', 'passport expiry 만료일 ផុតកំណត់') && (
                    <div>
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <label
                          htmlFor="rc-passportExp"
                          className="text-xs font-semibold text-slate-700"
                        >
                          {isKo ? '여권 만료일 (Expiry)' : isKm ? 'ថ្ងៃផុតកំណត់លិខិតឆ្លងដែន' : 'Passport Expiry'}
                        </label>
                        <ConfidenceBar
                          confidence={effectiveConfidence.passportExpiry}
                          isEdited={isFieldEdited('passportExpiry')}
                          lang={lang}
                        />
                      </div>
                      <input
                        id="rc-passportExp"
                        type="date"
                        value={fields.passportExpiry}
                        onFocus={() => handleFieldFocus('passportExpiry')}
                        onChange={(e) =>
                          setFields((p) => ({ ...p, passportExpiry: e.target.value }))
                        }
                        className="w-full px-3 py-2 text-sm font-mono font-semibold tabular-nums text-slate-900 bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
                      />
                      {renderRevertMeta('passportExpiry')}
                    </div>
                  )}

                  {/* Phone */}
                  {shouldShowField('phone', 'phone mobile contact 전화번호 연락처 ទូរស័ព្ទ') && (
                    <div>
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <label
                          htmlFor="rc-phone"
                          className="text-xs font-semibold text-slate-700"
                        >
                          {isKo ? '연락처 (Phone)' : isKm ? 'លេខទូរស័ព្ទ (Phone)' : 'Phone Number (연락처)'}
                        </label>
                      </div>
                      <input
                        id="rc-phone"
                        type="tel"
                        value={fields.phone}
                        onFocus={() => handleFieldFocus('phone')}
                        onChange={(e) =>
                          setFields((p) => ({ ...p, phone: e.target.value }))
                        }
                        placeholder="010-0000-0000"
                        className="w-full px-3 py-2 text-sm font-mono font-semibold tabular-nums text-slate-900 bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
                      />
                      {renderRevertMeta('phone')}
                    </div>
                  )}

                  {/* Mobile */}
                  {shouldShowField('mobile', 'mobile cell 휴대전화 ទូរស័ព្ទដៃ') && (
                    <div>
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <label
                          htmlFor="rc-mobile"
                          className="text-xs font-semibold text-slate-700"
                        >
                          {isKo ? '휴대전화 (Mobile)' : isKm ? 'លេខទូរស័ព្ទដៃ (Mobile)' : 'Mobile Phone (휴대전화)'}
                        </label>
                      </div>
                      <input
                        id="rc-mobile"
                        type="tel"
                        value={fields.mobile}
                        onFocus={() => handleFieldFocus('mobile')}
                        onChange={(e) =>
                          setFields((p) => ({ ...p, mobile: e.target.value }))
                        }
                        placeholder="010-0000-0000"
                        className="w-full px-3 py-2 text-sm font-mono font-semibold tabular-nums text-slate-900 bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
                      />
                      {renderRevertMeta('mobile')}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Bottom Finalization Action Bar */}
      <div className="bg-white border border-slate-200 rounded-xl px-5 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="space-y-0.5 text-xs">
          <div className="flex items-center gap-2 font-semibold text-slate-900">
            {stats.coreMissing === 0 ? (
              <>
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" aria-hidden="true" />
                <span>
                  {isKo
                    ? 'PDF 신청서 핵심 항목 6개가 모두 준비되었습니다.'
                    : isKm
                    ? 'ព័ត៌មានស្នូលទាំង ៦ សម្រាប់ទម្រង់ PDF រួចរាល់ហើយ។'
                    : 'All 6 core PDF form fields are populated and ready.'}
                </span>
              </>
            ) : (
              <>
                <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" aria-hidden="true" />
                <span>
                  {isKo
                    ? `핵심 PDF 항목 중 ${stats.coreMissing}개가 비어 있습니다 (지금 수정하거나 3단계에서 입력 가능).`
                    : isKm
                    ? `មានប្រអប់ស្នូល ${stats.coreMissing} នៅទទេ (អាចកែនៅទីនេះ ឬក្នុងជំហានទី ៣)។`
                    : `${stats.coreMissing} core PDF fields still empty — correct above or finish in Step 3.`}
                </span>
              </>
            )}
          </div>

          {!isStep1Ready && (
            <p className="text-slate-500 pl-6">
              {isKo
                ? `참고: 1단계 필수 준비 항목 ${missingStep1Count}개(서명·사회통합망 계정 등)를 완료하면 3단계 PDF 신청서가 열립니다.`
                : isKm
                ? `ចំណាំ៖ នៅខ្វះ ${missingStep1Count} ចំណុចក្នុងជំហានទី ១ (ហត្ថលេខា ឬ Socinet) ទើបអាចបើកទម្រង់ជំហានទី ៣ បាន។`
                : `Note: ${missingStep1Count} Step 1 items (such as Signature or Socinet ID/PW) remain before Step 3 opens.`}
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2.5 shrink-0">
          <button
            type="button"
            onClick={onBackToStep2}
            className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-lg text-xs sm:text-sm font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <ArrowLeft className="w-4 h-4" aria-hidden="true" />
            <span>
              {isKo ? '2단계로' : isKm ? 'ត្រឡប់ជំហាន ២' : 'Back to Step 2'}
            </span>
          </button>

          <button
            type="button"
            onClick={handleFinalize}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-xs sm:text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <span>
              {isStep1Ready
                ? isKo
                  ? '수정 확정 및 PDF 신청서(3단계)로 이동'
                  : isKm
                  ? 'បញ្ជាក់ការកែតម្រូវ និងទៅទម្រង់ PDF (ជំហាន ៣)'
                  : 'Finalize & Open PDF Form (Step 3)'
                : isKo
                ? '수정 저장 후 1단계 마무리하기'
                : isKm
                ? 'រក្សាទុកការកែ និងបញ្ចប់ជំហាន ១'
                : 'Save Corrections & Finish Step 1'}
            </span>
            <ArrowRight className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>
      </div>

      {/* Fullscreen Document Lightbox */}
      {isFullscreen && displayImageUrl && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={activeDocInfo.label}
          className="fixed inset-0 z-50 bg-slate-950/90 flex flex-col"
        >
          <div className="px-5 py-3 border-b border-slate-800 flex items-center justify-between text-white">
            <span className="text-sm font-semibold">
              {activeDocInfo.label} — {activeDocInfo.name}
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setZoom((z) => Math.max(50, z - 25))}
                className="p-1.5 rounded bg-slate-800 hover:bg-slate-700 cursor-pointer"
                aria-label="Zoom out"
              >
                <ZoomOut className="w-4 h-4" />
              </button>
              <span className="font-mono tabular-nums text-xs w-12 text-center">
                {zoom}%
              </span>
              <button
                type="button"
                onClick={() => setZoom((z) => Math.min(300, z + 25))}
                className="p-1.5 rounded bg-slate-800 hover:bg-slate-700 cursor-pointer"
                aria-label="Zoom in"
              >
                <ZoomIn className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => setRotation((r) => (r + 90) % 360)}
                className="p-1.5 rounded bg-slate-800 hover:bg-slate-700 cursor-pointer"
                aria-label="Rotate"
              >
                <RotateCw className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => setIsFullscreen(false)}
                className="p-1.5 rounded bg-slate-800 hover:bg-slate-700 cursor-pointer"
                aria-label="Close fullscreen"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
          <div
            className="flex-1 overflow-auto flex items-center justify-center p-6"
            onClick={() => setIsFullscreen(false)}
          >
            <img
              src={displayImageUrl}
              alt={activeDocInfo.label}
              referrerPolicy="no-referrer"
              onClick={(e) => e.stopPropagation()}
              style={{ transform: `scale(${zoom / 100}) rotate(${rotation}deg)` }}
              className="max-w-full max-h-full object-contain rounded transition-transform duration-150"
            />
          </div>
        </div>
      )}

      {/* Daum Korean Address Lookup Modal */}
      <DaumPostcodeModal
        isOpen={isDaumOpen}
        onClose={() => setIsDaumOpen(false)}
        lang={lang}
        onSelectAddress={(addr) => {
          setFields((p) => ({ ...p, address: addr }));
          setIsDaumOpen(false);
        }}
      />
    </section>
  );
};
