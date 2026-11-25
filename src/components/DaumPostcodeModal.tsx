import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  Building2,
  CheckCircle2,
  Loader2,
  MapPin,
  RefreshCw,
  RotateCcw,
  Search,
  X,
} from 'lucide-react';
import { Language } from '../types';
import {
  DaumPostcodeData,
  formatDaumAddressForImmigration,
  loadDaumPostcodeScript,
} from '../utils/daumPostcode';

interface DaumPostcodeModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectAddress: (fullAddress: string, meta: { zonecode: string; roadAddress: string; jibunAddress: string }) => void;
  initialQuery?: string;
  initialDetailUnit?: string;
  lang: Language;
}

function getModalCopy(lang: Language) {
  if (lang === 'km') {
    return {
      title: 'ស្វែងរកអាសយដ្ឋានកូរ៉េផ្លូវការ (Daum Postcode API)',
      subtitle:
        'ស្វែងរកអាសយដ្ឋានផ្លូវការ 도로명주소 តាមប្រព័ន្ធ Daum ដើម្បីធានាថាការិយាល័យអន្តោប្រវេសន៍ទទួលយកបាន ១០០%។',
      loading: 'កំពុងភ្ជាប់ប្រព័ន្ធស្វែងរកអាសយដ្ឋាន Daum Postcode...',
      loadError: 'មិនអាចផ្ទុកប្រព័ន្ធ Daum Postcode បានទេ។ សូមពិនិត្យអ៊ីនធឺណិត រួចសាកល្បងម្ដងទៀត។',
      retry: 'សាកល្បងម្ដងទៀត',
      selectedHeading: 'អាសយដ្ឋានផ្លូវការដែលបានជ្រើសរើស',
      postalCode: 'លេខប្រៃសណីយ៍',
      roadLabel: '도로명주소 (ផ្លូវការ)',
      jibunLabel: '지번주소',
      detailLabel: 'បន្ថែមអាសយដ្ឋានលម្អិត (동 · 호 · 층 / លេខបន្ទប់) — ជាជម្រើស',
      detailPlaceholder: 'ឧទាហរណ៍៖ 101동 202호 ឬ 3층 302호 ឬ 기숙사 204호',
      detailHint: 'បើមានលេខអគារ ឬលេខបន្ទប់លើកាត ARC សូមបញ្ចូលនៅទីនេះ មុនពេលចុចប្រើអាសយដ្ឋាន។',
      previewLabel: 'ទម្រង់អាសយដ្ឋាន 체류지 ដែលនឹងបញ្ចូលទៅក្នុងពាក្យសុំ',
      jurisdictionLabel: 'ការិយាល័យអន្តោប្រវេសន៍ទទួលបន្ទុក',
      scoreLabel: 'ពិន្ទុភាពត្រឹមត្រូវ',
      searchAgain: 'ស្វែងរកអាសយដ្ឋានផ្សេង',
      applyBtn: 'ប្រើអាសយដ្ឋាននេះក្នុងទម្រង់',
      closeLabel: 'បិទ',
    };
  }

  if (lang === 'ko') {
    return {
      title: '공식 도로명주소 검색 (Daum 우편번호 API)',
      subtitle:
        '출입국·외국인관서 체류지 표준 형식(정식 시·도 표기 및 도로명주소)으로 자동 변환하여 입력합니다.',
      loading: 'Daum 우편번호 검색 서비스를 불러오는 중...',
      loadError: 'Daum 우편번호 서비스를 불러오지 못했습니다. 네트워크 상태를 확인 후 다시 시도해 주세요.',
      retry: '다시 시도',
      selectedHeading: '선택된 공식 주소',
      postalCode: '우편번호',
      roadLabel: '도로명주소',
      jibunLabel: '지번주소',
      detailLabel: '상세주소 입력 (동 · 호 · 층 / 기숙사 등)',
      detailPlaceholder: '예: 101동 202호, 3층 301호, 기숙사 204호',
      detailHint: '외국인등록증 뒷면에 적힌 동·호수가 있다면 입력 후 적용 버튼을 눌러 주세요.',
      previewLabel: '신청서 체류지 최종 반영 형식',
      jurisdictionLabel: '자동 매칭 관할 출입국관서',
      scoreLabel: '형식 적합도',
      searchAgain: '다른 주소 검색',
      applyBtn: '이 주소 적용하기',
      closeLabel: '닫기',
    };
  }

  return {
    title: 'South Korean Address Search (Daum Postcode API)',
    subtitle:
      'Auto-completes official Korean Road Name Addresses (도로명주소) formatted for local immigration offices.',
    loading: 'Loading official Daum Postcode search...',
    loadError: 'Could not load the Daum Postcode service. Please check your connection and try again.',
    retry: 'Retry',
    selectedHeading: 'Selected Official Address',
    postalCode: 'Postal Code',
    roadLabel: 'Road Address (도로명)',
    jibunLabel: 'Jibun Reference (지번)',
    detailLabel: 'Detail Address (동 · 호 · 층 / Apartment or Room No.)',
    detailPlaceholder: 'e.g., 101동 202호, 3층 302호, 기숙사 204호',
    detailHint: 'Add building/room numbers shown on the back of your ARC before applying.',
    previewLabel: 'Final Immigration-Compliant 체류지 Preview',
    jurisdictionLabel: 'Assigned Immigration Office',
    scoreLabel: 'Format Score',
    searchAgain: 'Search Again',
    applyBtn: 'Apply Verified Address',
    closeLabel: 'Close',
  };
}

export const DaumPostcodeModal: React.FC<DaumPostcodeModalProps> = ({
  isOpen,
  onClose,
  onSelectAddress,
  initialQuery = '',
  initialDetailUnit = '',
  lang,
}) => {
  const copy = useMemo(() => getModalCopy(lang), [lang]);
  const embedContainerRef = useRef<HTMLDivElement | null>(null);
  const detailInputRef = useRef<HTMLInputElement | null>(null);

  const [loadState, setLoadState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [selectedRaw, setSelectedRaw] = useState<DaumPostcodeData | null>(null);
  const [detailAddress, setDetailAddress] = useState(initialDetailUnit);
  const [embedVersion, setEmbedVersion] = useState(0);

  // Sync initial detail unit and reset selection whenever modal opens
  useEffect(() => {
    if (isOpen) {
      setSelectedRaw(null);
      setDetailAddress(initialDetailUnit);
      setErrorMessage(null);
    }
  }, [isOpen, initialDetailUnit]);

  // Close on Escape key
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Load Daum Postcode SDK and embed inside the modal container (iframe-safe, zero window.open)
  useEffect(() => {
    if (!isOpen || selectedRaw !== null) return;

    let cancelled = false;
    setLoadState('loading');
    setErrorMessage(null);

    loadDaumPostcodeScript()
      .then(() => {
        if (cancelled) return;
        const container = embedContainerRef.current;
        if (!container || !window.daum?.Postcode) {
          setLoadState('error');
          setErrorMessage(copy.loadError);
          return;
        }

        container.innerHTML = '';

        const postcode = new window.daum.Postcode({
          oncomplete: (data: DaumPostcodeData) => {
            if (cancelled) return;
            setSelectedRaw(data);
          },
          width: '100%',
          height: '100%',
          shorthand: false, // Request full 시/도 names from Daum whenever available
          hideMapBtn: true,
        });

        const cleanQuery = initialQuery
          .trim()
          .replace(/^\(\d{5}\)\s*/, '')
          .replace(/\([^)]*\)/g, '')
          .trim();

        postcode.embed(container, {
          q: cleanQuery && cleanQuery.length <= 40 ? cleanQuery : undefined,
          autoClose: false,
        });

        setLoadState('ready');
      })
      .catch((err) => {
        if (cancelled) return;
        console.error('Daum Postcode load error:', err);
        setLoadState('error');
        setErrorMessage(copy.loadError);
      });

    return () => {
      cancelled = true;
    };
  }, [isOpen, selectedRaw, embedVersion, initialQuery, copy.loadError]);

  // Focus detail input when transitioning to confirmation phase
  useEffect(() => {
    if (selectedRaw && detailInputRef.current) {
      const id = window.setTimeout(() => detailInputRef.current?.focus(), 60);
      return () => window.clearTimeout(id);
    }
  }, [selectedRaw]);

  const formatted = useMemo(() => {
    if (!selectedRaw) return null;
    return formatDaumAddressForImmigration(selectedRaw, detailAddress);
  }, [selectedRaw, detailAddress]);

  const handleApply = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!formatted) return;
    onSelectAddress(formatted.fullAddress, {
      zonecode: formatted.zonecode,
      roadAddress: formatted.baseRoadAddress,
      jibunAddress: formatted.jibunAddress,
    });
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center p-3 sm:p-5 bg-slate-900/60 backdrop-blur-xs no-print"
      role="dialog"
      aria-modal="true"
      aria-labelledby="daum-postcode-modal-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-xl bg-white rounded-2xl border border-slate-200 shadow-2xl overflow-hidden flex flex-col max-h-[92dvh]">
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-200 bg-slate-50 flex items-start justify-between gap-3">
          <div className="flex items-start gap-3 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-blue-600 text-white flex items-center justify-center shrink-0 mt-0.5">
              <Search className="w-4.5 h-4.5" />
            </div>
            <div className="min-w-0">
              <h3
                id="daum-postcode-modal-title"
                className="text-sm sm:text-base font-bold text-slate-900 leading-snug"
              >
                {copy.title}
              </h3>
              <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">
                {copy.subtitle}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label={copy.closeLabel}
            className="w-9 h-9 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-200/70 flex items-center justify-center shrink-0 cursor-pointer transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        {!selectedRaw ? (
          <div className="relative flex-1 min-h-[430px] sm:min-h-[470px] bg-white">
            {loadState === 'loading' && (
              <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-white/95 p-6 text-center">
                <Loader2 className="w-7 h-7 text-blue-600 animate-spin" />
                <p className="text-xs sm:text-sm font-medium text-slate-600">
                  {copy.loading}
                </p>
              </div>
            )}

            {loadState === 'error' && (
              <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-4 bg-white p-6 text-center">
                <div className="w-12 h-12 rounded-full bg-rose-50 text-rose-600 flex items-center justify-center">
                  <AlertCircle className="w-6 h-6" />
                </div>
                <p className="text-sm font-medium text-slate-700 max-w-sm leading-relaxed">
                  {errorMessage || copy.loadError}
                </p>
                <button
                  type="button"
                  onClick={() => setEmbedVersion((v) => v + 1)}
                  className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs sm:text-sm font-semibold flex items-center gap-2 cursor-pointer transition-colors"
                >
                  <RefreshCw className="w-4 h-4" />
                  <span>{copy.retry}</span>
                </button>
              </div>
            )}

            {/* Embedded Daum Postcode Container */}
            <div
              ref={embedContainerRef}
              className="w-full h-[430px] sm:h-[470px]"
            />
          </div>
        ) : formatted ? (
          <form onSubmit={handleApply} className="p-5 sm:p-6 space-y-5 overflow-y-auto">
            {/* Selected Road & Jibun Summary */}
            <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-4 space-y-2.5">
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="font-bold text-slate-800 flex items-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span>{copy.selectedHeading}</span>
                </span>
                {formatted.zonecode && (
                  <span className="font-mono font-bold text-blue-700 tabular-nums">
                    {copy.postalCode}: {formatted.zonecode}
                  </span>
                )}
              </div>

              <div className="space-y-1 text-xs sm:text-sm">
                <div className="flex items-start gap-2">
                  <span className="text-[11px] font-semibold text-slate-500 w-24 shrink-0 pt-0.5">
                    {copy.roadLabel}
                  </span>
                  <span className="font-bold text-slate-900 leading-snug">
                    {formatted.baseRoadAddress}
                    {formatted.extraRef ? ` ${formatted.extraRef}` : ''}
                  </span>
                </div>
                {formatted.jibunAddress && (
                  <div className="flex items-start gap-2 text-xs text-slate-600">
                    <span className="text-[11px] font-medium text-slate-500 w-24 shrink-0 pt-0.5">
                      {copy.jibunLabel}
                    </span>
                    <span>{formatted.jibunAddress}</span>
                  </div>
                )}
              </div>
            </div>

            {/* Detail Address Input (동·호·층) */}
            <div className="space-y-1.5">
              <label
                htmlFor="daum-detail-address-input"
                className="block text-xs font-bold text-slate-800"
              >
                {copy.detailLabel}
              </label>
              <input
                ref={detailInputRef}
                id="daum-detail-address-input"
                type="text"
                value={detailAddress}
                onChange={(e) => setDetailAddress(e.target.value)}
                placeholder={copy.detailPlaceholder}
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 bg-white text-sm font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-blue-600"
              />
              <p className="text-[11px] text-slate-500 leading-relaxed">
                {copy.detailHint}
              </p>
            </div>

            {/* Final Immigration-Ready Preview + Matched Office */}
            <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 p-4 space-y-2">
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="font-semibold text-emerald-900 flex items-center gap-1.5">
                  <MapPin className="w-3.5 h-3.5 text-emerald-700 shrink-0" />
                  <span>{copy.previewLabel}</span>
                </span>
                <span className="font-bold text-emerald-800 tabular-nums whitespace-nowrap">
                  {copy.scoreLabel}: {formatted.validation.score} / 100
                </span>
              </div>

              <div className="text-sm font-bold text-slate-900 bg-white border border-emerald-200/80 rounded-lg px-3 py-2 break-keep">
                {formatted.fullAddress}
              </div>

              {formatted.validation.matchedOffice && (
                <div className="flex items-center gap-1.5 text-xs text-emerald-900 pt-0.5">
                  <Building2 className="w-3.5 h-3.5 text-emerald-700 shrink-0" />
                  <span className="text-emerald-800">{copy.jurisdictionLabel}:</span>
                  <strong className="font-bold">
                    {formatted.validation.matchedOffice.name}
                  </strong>
                </div>
              )}
            </div>

            {/* Actions */}
            <div className="flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-between gap-2.5 pt-1">
              <button
                type="button"
                onClick={() => {
                  setSelectedRaw(null);
                  setEmbedVersion((v) => v + 1);
                }}
                className="px-4 py-2.5 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-xs sm:text-sm font-semibold text-slate-700 flex items-center justify-center gap-1.5 cursor-pointer transition-colors whitespace-nowrap"
              >
                <RotateCcw className="w-4 h-4" />
                <span>{copy.searchAgain}</span>
              </button>

              <button
                type="submit"
                className="px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs sm:text-sm font-bold flex items-center justify-center gap-2 shadow-sm cursor-pointer transition-colors whitespace-nowrap"
              >
                <CheckCircle2 className="w-4 h-4" />
                <span>{copy.applyBtn}</span>
              </button>
            </div>
          </form>
        ) : null}
      </div>
    </div>
  );
};
