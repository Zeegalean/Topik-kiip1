import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Building2,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Compass,
  Filter,
  MapPin,
  Phone,
  Search,
  Sparkles,
  Wrench,
  XCircle,
} from 'lucide-react';
import { ImmigrationOffice, Language } from '../types';
import { IMMIGRATION_OFFICES } from '../data/immigrationOffices';
import {
  COMMON_KOREAN_ADDRESSES,
  KoreanAddressItem,
  searchAddressByBunji,
} from '../data/koreanAddresses';
import { validateKoreanAddress } from '../utils/koreanAddressValidator';
import { DaumPostcodeModal } from './DaumPostcodeModal';

interface Step3AddressHelperProps {
  address: string;
  onChangeAddress: (next: string) => void;
  lang: Language;
}

type CategoryFilter = 'ALL' | NonNullable<KoreanAddressItem['category']>;

interface OfficeMapPoint {
  id: string;
  shortLabel: string;
  // Main Korea map coordinates (viewBox 0 0 360 420)
  x: number;
  y: number;
  // Optional Capital Area inset coordinates (top-left box x: 10..118, y: 12..126)
  insetX?: number;
  insetY?: number;
  searchHint: string;
}

const OFFICE_MAP_POINTS: Record<string, OfficeMapPoint> = {
  yangju: {
    id: 'yangju',
    shortLabel: '양주',
    x: 136,
    y: 66,
    insetX: 66,
    insetY: 28,
    searchHint: '양주',
  },
  seoul: {
    id: 'seoul',
    shortLabel: '서울',
    x: 128,
    y: 92,
    insetX: 70,
    insetY: 56,
    searchHint: '서울',
  },
  'seoul-south': {
    id: 'seoul-south',
    shortLabel: '서울남부',
    x: 122,
    y: 100,
    insetX: 55,
    insetY: 75,
    searchHint: '구로구',
  },
  incheon: {
    id: 'incheon',
    shortLabel: '인천',
    x: 104,
    y: 98,
    insetX: 12,
    insetY: 66,
    searchHint: '인천',
  },
  suwon: {
    id: 'suwon',
    shortLabel: '수원',
    x: 132,
    y: 118,
    insetX: 66,
    insetY: 104,
    searchHint: '안산',
  },
  chuncheon: {
    id: 'chuncheon',
    shortLabel: '춘천',
    x: 184,
    y: 68,
    searchHint: '춘천',
  },
  cheongju: {
    id: 'cheongju',
    shortLabel: '청주',
    x: 162,
    y: 164,
    searchHint: '청주',
  },
  daejeon: {
    id: 'daejeon',
    shortLabel: '대전',
    x: 150,
    y: 194,
    searchHint: '서산',
  },
  jeonju: {
    id: 'jeonju',
    shortLabel: '전주',
    x: 132,
    y: 236,
    searchHint: '전주',
  },
  gwangju: {
    id: 'gwangju',
    shortLabel: '광주',
    x: 110,
    y: 286,
    searchHint: '광주',
  },
  yeosu: {
    id: 'yeosu',
    shortLabel: '여수',
    x: 166,
    y: 318,
    searchHint: '여수',
  },
  daegu: {
    id: 'daegu',
    shortLabel: '대구',
    x: 244,
    y: 222,
    searchHint: '대구',
  },
  ulsan: {
    id: 'ulsan',
    shortLabel: '울산',
    x: 288,
    y: 252,
    searchHint: '울산',
  },
  busan: {
    id: 'busan',
    shortLabel: '부산',
    x: 274,
    y: 286,
    searchHint: '부산',
  },
  changwon: {
    id: 'changwon',
    shortLabel: '창원',
    x: 236,
    y: 284,
    searchHint: '창원',
  },
  jeju: {
    id: 'jeju',
    shortLabel: '제주',
    x: 92,
    y: 382,
    searchHint: '제주',
  },
};

function getCopy(lang: Language) {
  if (lang === 'km') {
    return {
      title: 'ជំនួយការផ្ទៀងផ្ទាត់អាសយដ្ឋាន (체류지) និងផែនទីការិយាល័យអន្តោប្រវេសន៍',
      subtitle:
        'ពិនិត្យទម្រង់អាសយដ្ឋានកូរ៉េតាមខេត្ត/ស្រុក ស្វែងរកអាសយដ្ឋានត្រឹមត្រូវ និងផ្ទៀងផ្ទាត់ការិយាល័យទទួលពាក្យ ដើម្បីកាត់បន្ថយការបដិសេធឯកសារ។',
      toggleShow: 'បង្ហាញជំនួយការ',
      toggleHide: 'បង្រួម',
      statusLabels: {
        valid: 'ទម្រង់ត្រឹមត្រូវ (Ready)',
        'needs-review': 'ត្រូវការបំពេញបន្ថែម (Review)',
        invalid: 'ខ្វះទិន្នន័យសំខាន់ (Incomplete)',
        empty: 'មិនទាន់មានអាសយដ្ឋាន (Empty)',
      },
      readinessLabel: 'ពិន្ទុភាពត្រឹមត្រូវ',
      currentAddressLabel: 'អាសយដ្ឋានស្នាក់នៅបច្ចុប្បន្ន (체류지 - ភ្ជាប់ផ្ទាល់ជាមួយទម្រង់ខាងក្រោម)',
      currentAddressPlaceholder: 'ឧទាហរណ៍៖ 경기도 안산시 단원구 원곡공원로 35 101동 202호',
      normalizeBtn: 'កែសម្រួលទម្រង់ និងដកឃ្លាស្វ័យប្រវត្តិ',
      guPromptPrefix: 'ទីក្រុង',
      guPromptSuffix: 'តម្រូវឱ្យបញ្ជាក់ស្រុក (구) ដើម្បីកុំឱ្យការិយាល័យបដិសេធ៖',
      checklistTitle: 'ការត្រួតពិនិត្យតាមបទដ្ឋានតំបន់កូរ៉េ (District Convention Check)',
      autocompleteTitle: 'ស្វែងរកអាសយដ្ឋានកូរ៉េ (도로명주소 / លេខប្រៃសណីយ៍ / តំបន់ឧស្សាហកម្ម)',
      searchPlaceholder: 'វាយឈ្មោះទីក្រុង ផ្លូវ (로/길) លេខប្រៃសណីយ៍ (예: 31993) ឬឈ្មោះរោងចក្រ...',
      detailUnitLabel: 'បន្ថែមលេខបន្ទប់ / អគារ (동·호·층)',
      detailUnitPlaceholder: 'ឧ. 101동 202호',
      applyHint: 'ចុចជ្រើសរើសដើម្បីបញ្ចូលទៅក្នុងទម្រង់',
      noResults: 'រកមិនឃើញអាសយដ្ឋានដែលត្រូវគ្នាទេ។ សាកល្បងពាក្យគន្លឹះផ្សេង (ឧ. 서산, 안산, 화성, 천안)។',
      mapTitle: 'ផែនទីការិយាល័យអន្តោប្រវេសន៍កូរ៉េ (관할 출입국·외국인관서)',
      mapSubtitle: 'ភ្លឺដោយស្វ័យប្រវត្តិតាមអាសយដ្ឋាន체류지 ឬចុចលើទីតាំងដើម្បីមើលព័ត៌មាន',
      capitalInset: 'តំបន់រាជធានី (수도권)',
      matchedOfficeTag: 'ការិយាល័យទទួលបន្ទុកបច្ចុប្បន្ន',
      selectedOfficeTag: 'កំពុងមើលលើផែនទី',
      noOfficeMatched: 'មិនទាន់ផ្គូផ្គងការិយាល័យទេ — សូមបញ្ចូល 시/도 និង 시/군/구 ឬចុចលើផែនទី។',
      filterByRegionBtn: 'ស្វែងរកអាសយដ្ឋានក្នុងតំបន់នេះ',
      daumSearchBtn: 'ស្វែងរកតាម Daum Postcode',
      daumVerifiedTag: 'ផ្ទៀងផ្ទាត់ដោយ Daum Postcode',
      daumFallbackBtn: 'ស្វែងរកទូទាំងប្រទេសកូរ៉េតាម Daum Postcode API',
      categories: {
        ALL: 'ទាំងអស់',
        '공단/산업단지': 'តំបន់ឧស្សាហកម្ម',
        '아파트/주택': 'ផ្ទះល្វែង/អាផាតមិន',
        '공공/지원센터': 'មជ្ឈមណ្ឌលសាធារណៈ',
        '상가/빌딩': 'អគារពាណិជ្ជកម្ម',
      } as Record<CategoryFilter, string>,
    };
  }

  if (lang === 'ko') {
    return {
      title: '체류지 주소 자동완성 · 지역 표기 검증 및 관할 출입국 미니맵',
      subtitle:
        '반려 사유가 잦은 시·도 약칭, 대도시 행정구(구) 누락, 도로명·건물번호, 상세주소를 실시간 검증하고 관할 출입국관서를 확인합니다.',
      toggleShow: '주소 도우미 펼치기',
      toggleHide: '접기',
      statusLabels: {
        valid: '제출 적합 (Valid)',
        'needs-review': '보완 권장 (Review)',
        invalid: '필수 항목 누락 (Incomplete)',
        empty: '주소 미입력 (Empty)',
      },
      readinessLabel: '형식 적합도',
      currentAddressLabel: '현재 체류지 입력란 (아래 공식 서식과 실시간 동기화)',
      currentAddressPlaceholder: '예: 경기도 안산시 단원구 원곡공원로 35 101동 202호',
      normalizeBtn: '표준 띄어쓰기·시/도 자동 보정',
      guPromptPrefix: '',
      guPromptSuffix: '는 행정구(구) 표기가 필수입니다. 빠른 삽입:',
      checklistTitle: '대한민국 행정구역 표기 규칙 점검',
      autocompleteTitle: '도로명주소 · 우편번호 · 공단/아파트 빠른 자동완성',
      searchPlaceholder: '시/군/구, 도로명, 번지, 우편번호(예: 31993), 공단명 검색...',
      detailUnitLabel: '선택 시 붙일 상세주소 (동·호·층)',
      detailUnitPlaceholder: '예: 101동 202호',
      applyHint: '클릭하여 서식 체류지에 즉시 반영',
      noResults: '일치하는 추천 주소가 없습니다. 서산, 안산, 화성, 천안 등으로 검색해 보세요.',
      mapTitle: '관할 출입국·외국인관서 미니맵',
      mapSubtitle: '입력한 체류지에 따라 자동 선택되며, 핀을 클릭해 관할 정보를 볼 수 있습니다',
      capitalInset: '수도권 확대',
      matchedOfficeTag: '현재 자동 배정된 관할청',
      selectedOfficeTag: '선택한 관할청 정보',
      noOfficeMatched: '관할 관서가 아직 배정되지 않았습니다. 시/도와 시/군/구를 입력해 주세요.',
      filterByRegionBtn: '이 관할 지역 주소 검색하기',
      daumSearchBtn: 'Daum 도로명주소 검색',
      daumVerifiedTag: 'Daum 우편번호 공식 검증 완료',
      daumFallbackBtn: 'Daum 우편번호 API로 전국 도로명주소 검색',
      categories: {
        ALL: '전체',
        '공단/산업단지': '공단/산업단지',
        '아파트/주택': '아파트/주택',
        '공공/지원센터': '공공/지원센터',
        '상가/빌딩': '상가/빌딩',
      } as Record<CategoryFilter, string>,
    };
  }

  return {
    title: 'Korean Address Autocomplete, District Validator & Jurisdiction Mini-Map',
    subtitle:
      'Validate 체류지 formatting against local 시/도, administrative 구, and 도로명주소 rules to prevent immigration filing rejections.',
    toggleShow: 'Expand Helper',
    toggleHide: 'Collapse',
    statusLabels: {
      valid: 'Compliant (Ready)',
      'needs-review': 'Needs Review',
      invalid: 'Incomplete Format',
      empty: 'No Address Entered',
    },
    readinessLabel: 'Format Score',
    currentAddressLabel: 'Synced 체류지 (Live-linked to the official application form below)',
    currentAddressPlaceholder: 'e.g., 경기도 안산시 단원구 원곡공원로 35 101동 202호',
    normalizeBtn: 'Normalize Spacing & Province',
    guPromptPrefix: '',
    guPromptSuffix: 'requires an administrative district (구). Quick-insert:',
    checklistTitle: 'Local District Convention Checks',
    autocompleteTitle: 'Korean Road Address & Postal Autocomplete',
    searchPlaceholder: 'Search city, road name, building, industrial park, or 5-digit postal code...',
    detailUnitLabel: 'Optional Detail Unit (동·호·층)',
    detailUnitPlaceholder: 'e.g., 101동 202호',
    applyHint: 'Click any result to inject into form',
    noResults: 'No matching Korean addresses found. Try searching 서산, 안산, 화성, 천안, or a postal code.',
    mapTitle: 'Korea Immigration Jurisdiction Mini-Map',
    mapSubtitle: 'Highlights the assigned office live from 체류지 or click any pin to inspect',
    capitalInset: 'Capital Area',
    matchedOfficeTag: 'Auto-Assigned Jurisdiction',
    selectedOfficeTag: 'Map Selection',
    noOfficeMatched: 'No jurisdiction matched yet — enter 시/도 and 시/군/구 or select a pin.',
    filterByRegionBtn: 'Search addresses in this region',
    daumSearchBtn: 'Search Daum Postcode',
    daumVerifiedTag: 'Verified via Daum Postcode API',
    daumFallbackBtn: 'Search nationwide via Daum Postcode API',
    categories: {
      ALL: 'All',
      '공단/산업단지': 'Industrial',
      '아파트/주택': 'Residential',
      '공공/지원센터': 'Public Center',
      '상가/빌딩': 'Commercial',
    } as Record<CategoryFilter, string>,
  };
}

function insertGuIntoCity(currentAddress: string, city: string, gu: string): string {
  const trimmed = currentAddress.trim();
  if (!trimmed) return `${city} ${gu}`;
  // Avoid duplicating if already present
  if (trimmed.includes(`${city} ${gu}`)) return trimmed;
  const escaped = city.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`(${escaped})(?:\\s+[가-힣]{1,5}구)?`);
  if (regex.test(trimmed)) {
    return trimmed.replace(regex, `$1 ${gu}`).replace(/\s+/g, ' ').trim();
  }
  return `${trimmed} ${gu}`.trim();
}

export const Step3AddressHelper: React.FC<Step3AddressHelperProps> = ({
  address,
  onChangeAddress,
  lang,
}) => {
  const copy = useMemo(() => getCopy(lang), [lang]);
  const validation = useMemo(() => validateKoreanAddress(address), [address]);

  const [isExpanded, setIsExpanded] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>('ALL');
  const [detailUnit, setDetailUnit] = useState('');
  const [manualOfficeId, setManualOfficeId] = useState<string | null>(null);
  const [isDaumModalOpen, setIsDaumModalOpen] = useState(false);
  const [daumInitialQuery, setDaumInitialQuery] = useState('');
  const [lastDaumMeta, setLastDaumMeta] = useState<{ zonecode: string; appliedAddress: string } | null>(null);

  const searchResults = useMemo(() => {
    const base = searchQuery.trim()
      ? searchAddressByBunji(searchQuery)
      : COMMON_KOREAN_ADDRESSES;
    const filtered =
      categoryFilter === 'ALL'
        ? base
        : base.filter((item) => item.category === categoryFilter);
    return filtered.slice(0, 12);
  }, [searchQuery, categoryFilter]);

  const activeOffice: ImmigrationOffice | null = useMemo(() => {
    if (manualOfficeId) {
      return IMMIGRATION_OFFICES.find((o) => o.id === manualOfficeId) || validation.matchedOffice;
    }
    return validation.matchedOffice;
  }, [manualOfficeId, validation.matchedOffice]);

  const isViewingAutoMatched =
    !!activeOffice && !!validation.matchedOffice && activeOffice.id === validation.matchedOffice.id;

  const statusMeta = useMemo(() => {
    switch (validation.status) {
      case 'valid':
        return {
          textClass: 'text-emerald-700',
          bgClass: 'bg-emerald-50 border-emerald-200',
          icon: <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />,
          label: copy.statusLabels.valid,
        };
      case 'needs-review':
        return {
          textClass: 'text-amber-700',
          bgClass: 'bg-amber-50 border-amber-200',
          icon: <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />,
          label: copy.statusLabels['needs-review'],
        };
      case 'invalid':
        return {
          textClass: 'text-rose-700',
          bgClass: 'bg-rose-50 border-rose-200',
          icon: <XCircle className="w-4 h-4 text-rose-600 shrink-0" />,
          label: copy.statusLabels.invalid,
        };
      default:
        return {
          textClass: 'text-slate-600',
          bgClass: 'bg-slate-50 border-slate-200',
          icon: <MapPin className="w-4 h-4 text-slate-500 shrink-0" />,
          label: copy.statusLabels.empty,
        };
    }
  }, [validation.status, copy.statusLabels]);

  const handleSelectAddress = (item: KoreanAddressItem) => {
    const cleanUnit = detailUnit.trim();
    const combined = cleanUnit ? `${item.roadAddress} ${cleanUnit}` : item.roadAddress;
    setManualOfficeId(null);
    onChangeAddress(combined);
  };

  const handlePinClick = (officeId: string) => {
    setManualOfficeId((prev) => (prev === officeId ? null : officeId));
  };

  const handleFilterRegionFromMap = (office: ImmigrationOffice) => {
    const point = OFFICE_MAP_POINTS[office.id];
    const hint = point?.searchHint || office.regionKeywords[0] || '';
    setSearchQuery(hint);
    setCategoryFilter('ALL');
  };

  const categories: CategoryFilter[] = [
    'ALL',
    '공단/산업단지',
    '아파트/주택',
    '공공/지원센터',
    '상가/빌딩',
  ];

  return (
    <section
      aria-label={copy.title}
      className="no-print bg-white rounded-3xl border border-slate-200 shadow-xs overflow-hidden"
    >
      {/* Header Bar */}
      <div className="px-5 py-4 sm:px-6 border-b border-slate-200 bg-slate-50/70 flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          <div className="w-9 h-9 rounded-xl bg-slate-900 text-white flex items-center justify-center shrink-0 mt-0.5">
            <Compass className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
              <h3 className="text-sm sm:text-base font-bold text-slate-900">
                {copy.title}
              </h3>
              <span className="text-slate-300 hidden sm:inline">·</span>
              <span className={`inline-flex items-center gap-1.5 text-xs font-semibold ${statusMeta.textClass}`}>
                {statusMeta.icon}
                <span>{statusMeta.label}</span>
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">
              {copy.subtitle}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3 shrink-0 self-end md:self-center">
          <div className="text-right">
            <div className="text-[11px] font-medium text-slate-500">{copy.readinessLabel}</div>
            <div className="text-sm font-bold text-slate-900 tabular-nums">
              {validation.score} / 100
              {validation.matchedOffice ? (
                <span className="text-xs font-semibold text-indigo-700 ml-2">
                  · {validation.matchedOffice.name}
                </span>
              ) : null}
            </div>
          </div>
          <button
            type="button"
            onClick={() => setIsExpanded((v) => !v)}
            className="px-3 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer transition-colors"
          >
            <span>{isExpanded ? copy.toggleHide : copy.toggleShow}</span>
            {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {isExpanded && (
        <div className="p-5 sm:p-6 grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* LEFT COLUMN: Synced Input, Validation Checklist, Autocomplete Search */}
          <div className="lg:col-span-7 space-y-5 min-w-0">
            {/* Live Synced Input + 1-Click Auto-Format */}
            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <label
                  htmlFor="step3-address-sync-input"
                  className="text-xs font-semibold text-slate-700"
                >
                  {copy.currentAddressLabel}
                </label>
                {validation.formattedAddress && (
                  <button
                    type="button"
                    onClick={() => {
                      setManualOfficeId(null);
                      onChangeAddress(validation.formattedAddress!);
                    }}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer transition-colors"
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>{copy.normalizeBtn}</span>
                  </button>
                )}
              </div>

              <div className="flex flex-col sm:flex-row gap-2">
                <div className="relative flex-1 min-w-0">
                  <MapPin className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    id="step3-address-sync-input"
                    type="text"
                    value={address}
                    onChange={(e) => {
                      setManualOfficeId(null);
                      onChangeAddress(e.target.value);
                    }}
                    placeholder={copy.currentAddressPlaceholder}
                    className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-300 bg-white text-sm font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setDaumInitialQuery(
                      address && !address.startsWith('00000') ? address : searchQuery
                    );
                    setIsDaumModalOpen(true);
                  }}
                  className="px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs sm:text-sm font-bold flex items-center justify-center gap-1.5 whitespace-nowrap shrink-0 shadow-xs cursor-pointer transition-colors"
                >
                  <Search className="w-4 h-4" />
                  <span>{copy.daumSearchBtn}</span>
                </button>
              </div>

              {lastDaumMeta && lastDaumMeta.appliedAddress === address && (
                <div className="flex items-center gap-2 text-xs text-emerald-700 font-medium">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                  <span>{copy.daumVerifiedTag}</span>
                  {lastDaumMeta.zonecode ? (
                    <>
                      <span className="text-slate-300">·</span>
                      <span className="font-mono tabular-nums font-semibold text-slate-700">
                        [{lastDaumMeta.zonecode}]
                      </span>
                    </>
                  ) : null}
                </div>
              )}

              {/* Subdivided City Quick-Insert 구 Helper */}
              {validation.guRequiredCity && validation.suggestedGus.length > 0 && (
                <div className="p-3 rounded-xl border border-amber-200 bg-amber-50/80 space-y-2">
                  <div className="flex items-start gap-2 text-xs font-semibold text-amber-900">
                    <Wrench className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                    <span>
                      {copy.guPromptPrefix ? `${copy.guPromptPrefix} ` : ''}
                      {validation.guRequiredCity} {copy.guPromptSuffix}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {validation.suggestedGus.map((gu) => (
                      <button
                        key={gu}
                        type="button"
                        onClick={() =>
                          onChangeAddress(
                            insertGuIntoCity(address, validation.guRequiredCity!, gu)
                          )
                        }
                        className="px-2.5 py-1 rounded-lg border border-amber-300 bg-white hover:bg-amber-100 text-xs font-semibold text-amber-900 whitespace-nowrap shrink-0 cursor-pointer transition-colors"
                      >
                        + {gu}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* 6-Point District Convention Checklist */}
            <div className="rounded-2xl border border-slate-200 overflow-hidden">
              <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
                <span className="text-xs font-bold text-slate-700">{copy.checklistTitle}</span>
                <span className="text-[11px] font-medium text-slate-500 tabular-nums">
                  {validation.checks.filter((c) => c.severity === 'pass').length}/
                  {validation.checks.length}
                </span>
              </div>
              <ul className="divide-y divide-slate-100">
                {validation.checks.map((chk) => (
                  <li
                    key={chk.id}
                    className="px-4 py-2.5 flex items-start gap-2.5 text-xs bg-white"
                  >
                    {chk.severity === 'pass' ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                    ) : chk.severity === 'warn' ? (
                      <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                    ) : (
                      <XCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                    )}
                    <div className="min-w-0 flex-1">
                      <span className="font-semibold text-slate-900">{chk.label}</span>
                      <span className="text-slate-300 mx-1.5">·</span>
                      <span
                        className={
                          chk.severity === 'pass'
                            ? 'text-slate-600'
                            : chk.severity === 'warn'
                            ? 'text-amber-800 font-medium'
                            : 'text-rose-700 font-medium'
                        }
                      >
                        {chk.message}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            </div>

            {/* Autocomplete Search & Detail Unit */}
            <div className="rounded-2xl border border-slate-200 overflow-hidden">
              <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs font-bold text-slate-800">
                    {copy.autocompleteTitle}
                  </span>
                  <span className="text-[11px] text-slate-500">{copy.applyHint}</span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5">
                  <div className="sm:col-span-7 relative">
                    <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder={copy.searchPlaceholder}
                      className="w-full pl-9 pr-3 py-2 rounded-lg border border-slate-300 bg-white text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>
                  <div className="sm:col-span-5">
                    <input
                      type="text"
                      value={detailUnit}
                      onChange={(e) => setDetailUnit(e.target.value)}
                      aria-label={copy.detailUnitLabel}
                      placeholder={copy.detailUnitPlaceholder}
                      className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-white text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>
                </div>

                {/* Category Filter Tabs */}
                <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
                  {categories.map((cat) => {
                    const active = categoryFilter === cat;
                    return (
                      <button
                        key={cat}
                        type="button"
                        onClick={() => setCategoryFilter(cat)}
                        className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
                          active
                            ? 'bg-slate-900 text-white'
                            : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-100'
                        }`}
                      >
                        {copy.categories[cat]}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Matching Results */}
              <div className="max-h-60 overflow-y-auto divide-y divide-slate-100 bg-white">
                {searchResults.length === 0 ? (
                  <div className="px-4 py-6 text-center space-y-3">
                    <p className="text-xs text-slate-500">{copy.noResults}</p>
                    <button
                      type="button"
                      onClick={() => {
                        setDaumInitialQuery(searchQuery);
                        setIsDaumModalOpen(true);
                      }}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold cursor-pointer transition-colors"
                    >
                      <Search className="w-3.5 h-3.5" />
                      <span>{copy.daumFallbackBtn}</span>
                    </button>
                  </div>
                ) : (
                  searchResults.map((item, idx) => {
                    const isCurrentlyApplied =
                      address.trim().startsWith(item.roadAddress) ||
                      address.trim() === item.jibunAddress;
                    return (
                      <button
                        key={`${item.zonecode}-${item.roadAddress}-${idx}`}
                        type="button"
                        onClick={() => handleSelectAddress(item)}
                        className={`w-full text-left px-4 py-2.5 hover:bg-indigo-50/70 transition-colors flex items-start justify-between gap-3 cursor-pointer ${
                          isCurrentlyApplied ? 'bg-indigo-50/60' : ''
                        }`}
                      >
                        <div className="min-w-0 space-y-0.5">
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                            <span className="font-mono text-[11px] font-semibold text-indigo-700 tabular-nums">
                              [{item.zonecode}]
                            </span>
                            <span className="text-xs font-bold text-slate-900 truncate">
                              {item.roadAddress}
                            </span>
                          </div>
                          <div className="text-[11px] text-slate-500 flex flex-wrap items-center gap-x-2">
                            <span>지번: {item.jibunAddress}</span>
                            {item.buildingName ? (
                              <>
                                <span className="text-slate-300">·</span>
                                <span className="font-medium text-slate-700">
                                  {item.buildingName}
                                </span>
                              </>
                            ) : null}
                          </div>
                        </div>
                        {item.category ? (
                          <span className="text-[10px] font-semibold text-slate-500 whitespace-nowrap shrink-0 mt-0.5">
                            {item.category}
                          </span>
                        ) : null}
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          </div>

          {/* RIGHT COLUMN: Interactive Korea Immigration Jurisdiction Mini-Map */}
          <div className="lg:col-span-5 rounded-2xl border border-slate-200 overflow-hidden bg-white">
            <div className="px-4 py-3 bg-slate-50 border-b border-slate-200">
              <div className="text-xs font-bold text-slate-900">{copy.mapTitle}</div>
              <div className="text-[11px] text-slate-500 mt-0.5">{copy.mapSubtitle}</div>
            </div>

            {/* Interactive SVG Map */}
            <div className="p-3 bg-slate-50/40 border-b border-slate-200">
              <svg
                viewBox="0 0 360 410"
                className="w-full h-auto max-h-[340px] select-none"
                role="img"
                aria-label={copy.mapTitle}
              >
                {/* Sea backdrop + subtle coordinate grid */}
                <rect x="0" y="0" width="360" height="410" rx="12" fill="#f1f5f9" />
                {[80, 160, 240, 320].map((y) => (
                  <line
                    key={`h-${y}`}
                    x1="0"
                    y1={y}
                    x2="360"
                    y2={y}
                    stroke="#e2e8f0"
                    strokeWidth="0.75"
                    strokeDasharray="3 3"
                  />
                ))}
                {[90, 180, 270].map((x) => (
                  <line
                    key={`v-${x}`}
                    x1={x}
                    y1="0"
                    x2={x}
                    y2="410"
                    stroke="#e2e8f0"
                    strokeWidth="0.75"
                    strokeDasharray="3 3"
                  />
                ))}

                {/* South Korea Mainland Peninsula Silhouette */}
                <path
                  d="M112 52 L145 40 L185 38 L224 44 L250 74 L274 128 L296 178 L302 224 L298 258 L278 292 L246 306 L212 316 L178 330 L132 342 L94 334 L82 302 L92 268 L96 232 L106 196 L94 168 L84 142 L98 118 L92 92 L104 66 Z"
                  fill="#ffffff"
                  stroke="#94a3b8"
                  strokeWidth="1.5"
                  strokeLinejoin="round"
                />

                {/* Jeju Island */}
                <ellipse
                  cx="96"
                  cy="382"
                  rx="30"
                  ry="14"
                  fill="#ffffff"
                  stroke="#94a3b8"
                  strokeWidth="1.5"
                />

                {/* Capital Area Zoom Box Connector */}
                <rect
                  x="96"
                  y="56"
                  width="50"
                  height="72"
                  rx="4"
                  fill="none"
                  stroke="#64748b"
                  strokeWidth="1"
                  strokeDasharray="2 2"
                />
                <line
                  x1="96"
                  y1="128"
                  x2="92"
                  y2="146"
                  stroke="#64748b"
                  strokeWidth="0.9"
                  strokeDasharray="2 2"
                />

                {/* Capital Area Inset Box (Top-Left) */}
                <g>
                  <rect
                    x="8"
                    y="146"
                    width="90"
                    height="96"
                    rx="8"
                    fill="#ffffff"
                    stroke="#94a3b8"
                    strokeWidth="1.2"
                  />
                  <text
                    x="14"
                    y="160"
                    fontSize="8.5"
                    fontWeight="700"
                    fill="#475569"
                  >
                    {copy.capitalInset}
                  </text>
                </g>

                {/* Non-Capital Regional Pins on Main Map */}
                {Object.values(OFFICE_MAP_POINTS)
                  .filter((pt) => pt.insetX === undefined)
                  .map((pt) => {
                    const isAutoMatched = validation.matchedOffice?.id === pt.id;
                    const isSelected = activeOffice?.id === pt.id;
                    const fill = isSelected
                      ? '#4f46e5'
                      : isAutoMatched
                      ? '#059669'
                      : '#475569';
                    const radius = isSelected ? 6.5 : isAutoMatched ? 5.5 : 4.2;

                    return (
                      <g
                        key={pt.id}
                        className="cursor-pointer"
                        onClick={() => handlePinClick(pt.id)}
                      >
                        {isSelected && (
                          <circle
                            cx={pt.x}
                            cy={pt.y}
                            r="11"
                            fill="#4f46e5"
                            fillOpacity="0.18"
                          />
                        )}
                        <circle
                          cx={pt.x}
                          cy={pt.y}
                          r={radius}
                          fill={fill}
                          stroke="#ffffff"
                          strokeWidth="1.5"
                        />
                        <text
                          x={pt.x}
                          y={pt.y - 8}
                          textAnchor="middle"
                          fontSize="9"
                          fontWeight={isSelected || isAutoMatched ? '700' : '600'}
                          fill={isSelected ? '#312e81' : '#1e293b'}
                        >
                          {pt.shortLabel}
                        </text>
                      </g>
                    );
                  })}

                {/* Capital Area Pins inside Inset Box (translated into 8..98, 146..242) */}
                {Object.values(OFFICE_MAP_POINTS)
                  .filter((pt) => pt.insetX !== undefined && pt.insetY !== undefined)
                  .map((pt) => {
                    const cx = 8 + (pt.insetX! / 110) * 86;
                    const cy = 158 + (pt.insetY! / 120) * 80;
                    const isAutoMatched = validation.matchedOffice?.id === pt.id;
                    const isSelected = activeOffice?.id === pt.id;
                    const fill = isSelected
                      ? '#4f46e5'
                      : isAutoMatched
                      ? '#059669'
                      : '#475569';

                    return (
                      <g
                        key={`inset-${pt.id}`}
                        className="cursor-pointer"
                        onClick={() => handlePinClick(pt.id)}
                      >
                        {isSelected && (
                          <circle
                            cx={cx}
                            cy={cy}
                            r="9"
                            fill="#4f46e5"
                            fillOpacity="0.18"
                          />
                        )}
                        <circle
                          cx={cx}
                          cy={cy}
                          r={isSelected ? 5.2 : 4}
                          fill={fill}
                          stroke="#ffffff"
                          strokeWidth="1.3"
                        />
                        <text
                          x={cx + 6}
                          y={cy + 3}
                          fontSize="8.2"
                          fontWeight={isSelected || isAutoMatched ? '700' : '600'}
                          fill={isSelected ? '#312e81' : '#1e293b'}
                        >
                          {pt.shortLabel}
                        </text>
                      </g>
                    );
                  })}
              </svg>
            </div>

            {/* Active Office Details Panel */}
            <div className="p-4 space-y-3">
              {activeOffice ? (
                <>
                  <div className="space-y-1">
                    <div className="text-[11px] font-semibold uppercase tracking-wide text-indigo-700">
                      {isViewingAutoMatched ? copy.matchedOfficeTag : copy.selectedOfficeTag}
                    </div>
                    <div className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
                      <Building2 className="w-4 h-4 text-slate-600 shrink-0" />
                      <span>{activeOffice.name}</span>
                    </div>
                  </div>

                  <div className="text-xs text-slate-600 space-y-1">
                    <div className="flex items-start gap-1.5">
                      <MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0 mt-0.5" />
                      <span>{activeOffice.address}</span>
                    </div>
                    <div className="flex items-center gap-1.5 tabular-nums">
                      <Phone className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                      <span>{activeOffice.phone}</span>
                      <span className="text-slate-300">·</span>
                      <span className="truncate">{activeOffice.email}</span>
                    </div>
                  </div>

                  <div className="text-[11px] text-slate-500 leading-relaxed">
                    {activeOffice.regionKeywords.slice(0, 8).join(', ')}
                    {activeOffice.regionKeywords.length > 8 ? ' ...' : ''}
                  </div>

                  <button
                    type="button"
                    onClick={() => handleFilterRegionFromMap(activeOffice)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100 text-xs font-semibold text-slate-800 flex items-center justify-center gap-1.5 cursor-pointer transition-colors"
                  >
                    <Filter className="w-3.5 h-3.5" />
                    <span>{copy.filterByRegionBtn}</span>
                  </button>
                </>
              ) : (
                <div className="text-xs text-slate-500 py-2 leading-relaxed">
                  {copy.noOfficeMatched}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <DaumPostcodeModal
        isOpen={isDaumModalOpen}
        onClose={() => setIsDaumModalOpen(false)}
        onSelectAddress={(fullAddress, meta) => {
          setManualOfficeId(null);
          setLastDaumMeta({
            zonecode: meta.zonecode,
            appliedAddress: fullAddress,
          });
          onChangeAddress(fullAddress);
        }}
        initialQuery={daumInitialQuery}
        initialDetailUnit={detailUnit}
        lang={lang}
      />
    </section>
  );
};
