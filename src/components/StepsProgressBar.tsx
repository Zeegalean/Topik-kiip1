import React from 'react';
import { Language } from '../types';
import {
  Upload,
  ScanText,
  FileEdit,
  FileSearch,
  Send,
  Check,
  Lock,
} from 'lucide-react';

interface StepsProgressBarProps {
  currentStep: number;
  onSelectStep: (step: number) => void;
  isStep1Ready: boolean;
  isPaid: boolean;
  lang: Language;
}

interface StageDefinition {
  num: number;
  icon: React.ComponentType<{ className?: string }>;
  title: Record<'en' | 'ko' | 'km', string>;
  subtitle: Record<'en' | 'ko' | 'km', string>;
}

const STAGES: StageDefinition[] = [
  {
    num: 1,
    icon: Upload,
    title: {
      en: 'Upload',
      ko: '업로드',
      km: 'ផ្ទុកឯកសារ',
    },
    subtitle: {
      en: 'ID & TOPIK',
      ko: '신분증·성적표',
      km: 'អត្តសញ្ញាណប័ណ្ណ',
    },
  },
  {
    num: 2,
    icon: ScanText,
    title: {
      en: 'Review',
      ko: '검토',
      km: 'ពិនិត្យ OCR',
    },
    subtitle: {
      en: 'Verify OCR',
      ko: 'OCR 확인',
      km: 'ផ្ទៀងផ្ទាត់ទិន្នន័យ',
    },
  },
  {
    num: 3,
    icon: FileEdit,
    title: {
      en: 'Form',
      ko: '신청서',
      km: 'ទម្រង់ពាក្យ',
    },
    subtitle: {
      en: 'Edit Details',
      ko: '정보 입력',
      km: 'បំពេញព័ត៌មាន',
    },
  },
  {
    num: 4,
    icon: FileSearch,
    title: {
      en: 'Preview',
      ko: '미리보기',
      km: 'មើលជាមុន',
    },
    subtitle: {
      en: 'PDF Check',
      ko: 'PDF 확인',
      km: 'ពិនិត្យ PDF',
    },
  },
  {
    num: 5,
    icon: Send,
    title: {
      en: 'Send',
      ko: '전송',
      km: 'ផ្ញើពាក្យ',
    },
    subtitle: {
      en: 'Email Submit',
      ko: '이메일 접수',
      km: 'ផ្ញើអ៊ីមែល',
    },
  },
];

export const StepsProgressBar: React.FC<StepsProgressBarProps> = ({
  currentStep,
  onSelectStep,
  isStep1Ready,
  isPaid,
  lang,
}) => {
  const locale: 'en' | 'ko' | 'km' =
    lang === 'ko' || lang === 'km' ? lang : 'en';

  const clampedStep = Math.min(Math.max(currentStep, 1), STAGES.length);
  const activeStage = STAGES[clampedStep - 1];
  const trackRatio = (clampedStep - 1) / (STAGES.length - 1);
  const percentComplete = Math.round((clampedStep / STAGES.length) * 100);

  const stepCounterLabel =
    locale === 'ko'
      ? `${clampedStep} / ${STAGES.length} 단계`
      : locale === 'km'
        ? `ជំហាន ${clampedStep} ក្នុងចំណោម ${STAGES.length}`
        : `Step ${clampedStep} of ${STAGES.length}`;

  const progressAriaLabel =
    locale === 'ko'
      ? '신청 진행 단계'
      : locale === 'km'
        ? 'វឌ្ឍនភាពនៃដំណើរការដាក់ពាក្យ'
        : 'Application progress';

  const lockedHintUpload =
    locale === 'ko'
      ? '1단계 필수 서류를 먼저 업로드해 주세요'
      : locale === 'km'
        ? 'សូមផ្ទុកឯកសារជំហានទី១ជាមុនសិន'
        : 'Upload required documents in Step 1 first';

  const lockedHintPayment =
    locale === 'ko'
      ? '결제 또는 코드 인증 후 이용 가능합니다'
      : locale === 'km'
        ? 'ត្រូវបង់ប្រាក់ ឬបញ្ចូលកូដជាមុនសិន'
        : 'Unlock with payment or promo/redeem code';

  return (
    <nav
      aria-label={progressAriaLabel}
      className="no-print mb-4 sm:mb-5 bg-white/95 backdrop-blur-sm border border-slate-200 rounded-xl shadow-xs px-3.5 py-3.5 sm:px-6 sm:py-4"
    >
      {/* Clean unboxed progress summary header */}
      <div className="flex items-center justify-between gap-3 mb-3.5 sm:mb-4">
        <div className="flex items-center gap-2 min-w-0 text-xs sm:text-sm">
          <span className="font-semibold text-slate-500 tabular-nums whitespace-nowrap">
            {stepCounterLabel}
          </span>
          <span className="text-slate-300 select-none" aria-hidden="true">
            ·
          </span>
          <span className="font-bold text-slate-900 truncate">
            {activeStage.title[locale]}
          </span>
          <span className="hidden sm:inline text-slate-400 truncate">
            — {activeStage.subtitle[locale]}
          </span>
        </div>

        <span
          className="text-xs sm:text-sm font-semibold text-blue-700 tabular-nums whitespace-nowrap shrink-0"
          aria-live="polite"
        >
          {percentComplete}%
        </span>
      </div>

      {/* 5-stage horizontal progress track */}
      <div className="relative">
        {/* Background rail connecting node 1 center to node 5 center */}
        <div
          className="pointer-events-none absolute top-[18px] sm:top-[20px] left-[10%] right-[10%] h-0.5 bg-slate-200 rounded-full overflow-hidden"
          aria-hidden="true"
        >
          <div
            className="h-full w-full bg-blue-600 origin-left transition-transform duration-300 ease-out"
            style={{ transform: `scaleX(${trackRatio})` }}
          />
        </div>

        <ol className="relative grid grid-cols-5 gap-1 sm:gap-2">
          {STAGES.map((stage) => {
            const Icon = stage.icon;
            const isCompleted = stage.num < clampedStep;
            const isActive = stage.num === clampedStep;
            const isLockedByUpload = stage.num > 1 && !isStep1Ready;
            const isLockedByPayment = stage.num === 5 && !isPaid && isStep1Ready;
            const isDisabled = isLockedByUpload;

            const titleText = isLockedByUpload
              ? lockedHintUpload
              : isLockedByPayment
                ? lockedHintPayment
                : `${stage.num}. ${stage.title[locale]} — ${stage.subtitle[locale]}`;

            return (
              <li key={stage.num} className="flex flex-col items-center min-w-0">
                <button
                  type="button"
                  disabled={isDisabled}
                  onClick={() => {
                    if (!isDisabled) {
                      onSelectStep(stage.num);
                    }
                  }}
                  title={titleText}
                  aria-current={isActive ? 'step' : undefined}
                  aria-disabled={isDisabled || undefined}
                  className={`group w-full min-h-[44px] flex flex-col items-center px-1 py-0.5 rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 ${
                    isDisabled
                      ? 'cursor-not-allowed'
                      : 'cursor-pointer'
                  }`}
                >
                  {/* Step Node */}
                  <span
                    className={`relative z-10 flex items-center justify-center w-9 h-9 sm:w-10 sm:h-10 rounded-full border-2 transition-all duration-200 ${
                      isCompleted
                        ? 'bg-emerald-600 border-emerald-600 text-white shadow-xs group-hover:bg-emerald-700 group-hover:border-emerald-700'
                        : isActive
                          ? 'bg-blue-600 border-blue-600 text-white ring-4 ring-blue-100 shadow-sm'
                          : isLockedByPayment
                            ? 'bg-amber-50 border-amber-300 text-amber-700 group-hover:border-amber-400 group-hover:bg-amber-100'
                            : isLockedByUpload
                              ? 'bg-slate-50 border-slate-200 text-slate-400'
                              : 'bg-white border-slate-300 text-slate-600 group-hover:border-blue-500 group-hover:text-blue-600'
                    }`}
                  >
                    {isCompleted ? (
                      <Check className="w-4 h-4 sm:w-4.5 sm:h-4.5 stroke-[2.5]" aria-hidden="true" />
                    ) : isActive ? (
                      <Icon className="w-4 h-4 sm:w-4.5 sm:h-4.5" aria-hidden="true" />
                    ) : isLockedByUpload || isLockedByPayment ? (
                      <Lock className="w-3.5 h-3.5 sm:w-4 sm:h-4" aria-hidden="true" />
                    ) : (
                      <span className="text-xs sm:text-sm font-bold tabular-nums">
                        {stage.num}
                      </span>
                    )}
                  </span>

                  {/* Stage Label */}
                  <span
                    className={`mt-1.5 sm:mt-2 text-[11px] sm:text-xs md:text-sm leading-tight whitespace-nowrap truncate max-w-full transition-colors ${
                      isActive
                        ? 'font-bold text-blue-700'
                        : isCompleted
                          ? 'font-semibold text-slate-800 group-hover:text-emerald-700'
                          : isLockedByPayment
                            ? 'font-medium text-amber-800'
                            : isLockedByUpload
                              ? 'font-medium text-slate-400'
                              : 'font-medium text-slate-600 group-hover:text-slate-900'
                    }`}
                  >
                    {stage.title[locale]}
                  </span>

                  {/* Subtle Stage Subtitle on desktop */}
                  <span
                    className={`hidden md:block mt-0.5 text-[11px] leading-tight whitespace-nowrap truncate max-w-full ${
                      isActive
                        ? 'text-blue-600/80 font-medium'
                        : isCompleted
                          ? 'text-slate-500'
                          : 'text-slate-400'
                    }`}
                  >
                    {stage.subtitle[locale]}
                  </span>

                  {/* Active indicator underline */}
                  <span
                    aria-hidden="true"
                    className={`mt-1.5 h-0.5 w-8 sm:w-10 rounded-full transition-opacity duration-200 ${
                      isActive ? 'bg-blue-600 opacity-100' : 'bg-transparent opacity-0'
                    }`}
                  />
                </button>
              </li>
            );
          })}
        </ol>
      </div>
    </nav>
  );
};
