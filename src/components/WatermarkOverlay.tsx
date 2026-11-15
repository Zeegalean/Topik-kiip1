import React from 'react';
import { ShieldAlert, AlertTriangle, Stamp, Unlock } from 'lucide-react';
import { Language } from '../types';
import { getTranslation } from '../utils/translations';

interface WatermarkOverlayProps {
  show?: boolean;
  text?: string;
  subText?: string;
  showRepeatedBackground?: boolean;
  variant?: 'form' | 'card';
  lang?: Language;
  onSealUnlock?: () => void;
}

export const WatermarkOverlay: React.FC<WatermarkOverlayProps> = ({
  show = true,
  text = 'REJECTION',
  subText,
  showRepeatedBackground = true,
  variant = 'form',
  lang = 'km',
  onSealUnlock,
}) => {
  if (!show) return null;
  const t = getTranslation(lang);
  const displaySubText = subText || (lang === 'km' 
    ? '반려본 / 심사용 미결제본 • គំរូមិនទាន់ទូទាត់ប្រាក់ (UNPAID COPY)' 
    : lang === 'ko' 
    ? '반려본 / 심사용 미결제본 (UNPAID COPY)' 
    : 'OFFICIAL REJECTION SAMPLE • UNPAID COPY');

  if (variant === 'card') {
    return (
      <div className="absolute inset-0 z-20 pointer-events-none flex flex-col items-center justify-center overflow-hidden bg-rose-950/15 backdrop-blur-[0.5px]">
        {/* Diagonal Warning Ribbon */}
        <div className="transform -rotate-25 bg-red-600/90 text-white font-black text-[11px] sm:text-[13px] px-8 py-1 shadow-lg border-y-2 border-white/80 uppercase tracking-widest text-center whitespace-nowrap">
          {text} • UNPAID
        </div>
        <div className="mt-1 transform -rotate-25 text-[8px] sm:text-[9px] font-bold text-red-700 bg-white/95 px-2 py-0.5 rounded shadow-xs">
          {t.watermarkRibbonText}
        </div>
      </div>
    );
  }

  return (
    <div
      className="wm-form-root"
      style={{ userSelect: 'none' }}
    >
      {/* 1. Subtle Repeated Diagonal Watermark Background Grid */}
      {showRepeatedBackground && (
        <div className="wm-grid">
          {Array.from({ length: 8 }).map((_, rowIdx) => (
            <div key={rowIdx} className="wm-grid-row">
              {Array.from({ length: 4 }).map((_, colIdx) => (
                <span key={colIdx} className="wm-grid-text">
                  {t.watermarkUnpaidGrid}
                </span>
              ))}
            </div>
          ))}
        </div>
      )}

      {/* 2. Top-Right Official Seal / Watermark Badge */}
      <div className="wm-badge">
        <div className="wm-badge-header">
          <ShieldAlert style={{ width: '16px', height: '16px', color: '#dc2626', flexShrink: 0 }} />
          <span>REJECTION COPY</span>
        </div>
        <p className="wm-badge-ko">
          출입국 제출불가 (심사용 미결제본)
        </p>
        <p className="wm-badge-sub">
          {t.watermarkBadgeSub}
        </p>
      </div>

      {/* 3. Center Huge Diagonal Official REJECTION Stamp */}
      <div className="wm-center-wrap">
        <div className="wm-center-tilt">
          <div className="wm-center-box">
            {/* Header Stamp text */}
            <div className="wm-center-kicker">
              <AlertTriangle style={{ width: '18px', height: '18px', color: '#dc2626', flexShrink: 0 }} />
              <span>OFFICIAL SAMPLE DOCUMENT</span>
              <AlertTriangle style={{ width: '18px', height: '18px', color: '#dc2626', flexShrink: 0 }} />
            </div>

            {/* Giant Rejection Title */}
            <h1 className="wm-center-title">
              {text}
            </h1>

            {/* Subtitle Description */}
            <div className="wm-center-sub">
              <p className="wm-center-sub-main">
                {displaySubText}
              </p>
              <p className="wm-center-sub-en">
                NOT VALID FOR SUBMISSION • UNLOCK CLEAN COPY VIA PAYMENT
              </p>
            </div>

            {/* Security Code Line */}
            <div className="wm-center-meta">
              <span>SECURITY ID: REJ-7492-UNPAID</span>
              <span>{t.watermarkCleanPriceText}</span>
            </div>

            {/* Interactive Seal Unlock Button */}
            {onSealUnlock && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onSealUnlock();
                }}
                className="mt-3.5 px-6 py-2.5 rounded-2xl bg-gradient-to-r from-amber-500 via-orange-500 to-red-600 hover:from-amber-600 hover:to-red-700 text-white font-black text-xs sm:text-sm shadow-xl hover:shadow-2xl flex items-center gap-2 transform hover:scale-105 transition-all cursor-pointer border-2 border-amber-300 pointer-events-auto animate-bounce"
                title="ដោះសោការបិទបាំងលើ Form ភ្លាមៗ"
              >
                <Unlock className="w-4 h-4 text-amber-200" />
                <span>
                  {lang === "km"
                    ? "🔓 ចុចត្រង់នេះដើម្បីដោះសោត្រាផ្លូវការ (Seal Unlock Form)"
                    : lang === "ko"
                    ? "🔓 직인 날인 및 반려본 잠금 해제 (Seal Unlock)"
                    : "🔓 Click to Apply Official Seal Unlock"}
                </span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* 4. Bottom Prominent Security Warning Strip */}
      <div className="wm-bottom-strip">
        <p className="wm-bottom-text">
          {t.watermarkBanner}
        </p>
      </div>
    </div>
  );
};
