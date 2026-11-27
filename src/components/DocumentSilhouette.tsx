import React from 'react';

export type DocumentSilhouetteType = 'arc-front' | 'arc-back' | 'topik' | 'passport';

interface DocumentSilhouetteProps {
  type: DocumentSilhouetteType;
  className?: string;
}

const CornerGuides: React.FC<{ accentClass?: string }> = ({ accentClass = 'border-blue-400/60 group-hover:border-blue-600' }) => (
  <>
    <span className={`pointer-events-none absolute -top-1.5 -left-1.5 w-3.5 h-3.5 border-t-2 border-l-2 rounded-tl-sm transition-colors duration-200 ${accentClass}`} />
    <span className={`pointer-events-none absolute -top-1.5 -right-1.5 w-3.5 h-3.5 border-t-2 border-r-2 rounded-tr-sm transition-colors duration-200 ${accentClass}`} />
    <span className={`pointer-events-none absolute -bottom-1.5 -left-1.5 w-3.5 h-3.5 border-b-2 border-l-2 rounded-bl-sm transition-colors duration-200 ${accentClass}`} />
    <span className={`pointer-events-none absolute -bottom-1.5 -right-1.5 w-3.5 h-3.5 border-b-2 border-r-2 rounded-br-sm transition-colors duration-200 ${accentClass}`} />
  </>
);

export const DocumentSilhouette: React.FC<DocumentSilhouetteProps> = ({ type, className = '' }) => {
  if (type === 'arc-front') {
    return (
      <div className={`relative w-52 sm:w-56 aspect-[1.586/1] mx-auto select-none transition-transform duration-200 group-hover:scale-[1.02] ${className}`}>
        <CornerGuides accentClass="border-blue-400/60 group-hover:border-blue-600" />
        <svg
          viewBox="0 0 260 164"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className="w-full h-full drop-shadow-[0_6px_14px_rgba(30,58,138,0.10)]"
          aria-hidden="true"
        >
          {/* Card body */}
          <rect x="2" y="2" width="256" height="160" rx="12" fill="url(#arcFrontBg)" stroke="#CBD5E1" strokeWidth="1.5" />
          {/* Top official stripe */}
          <path d="M2 14C2 7.37258 7.37258 2 14 2H246C252.627 2 258 7.37258 258 14V34H2V14Z" fill="#E2E8F0" fillOpacity="0.65" />
          {/* Subtle Taegeuk / Emblem circle */}
          <circle cx="22" cy="18" r="8" fill="#93C5FD" fillOpacity="0.55" />
          <path d="M18 18C18 15.8 19.8 14 22 14C24.2 14 26 15.8 26 18C26 19.1 25.1 20 24 20C22.9 20 22 19.1 22 18C22 16.9 21.1 16 20 16C18.9 16 18 16.9 18 18Z" fill="#3B82F6" fillOpacity="0.45" />
          <text x="37" y="17" fill="#475569" fontSize="9.5" fontWeight="700" fontFamily="sans-serif" opacity="0.8">외국인등록증</text>
          <text x="37" y="27" fill="#64748B" fontSize="6.5" fontWeight="600" letterSpacing="0.8" fontFamily="sans-serif" opacity="0.7">RESIDENCE CARD · FRONT</text>
          {/* Hologram chip */}
          <rect x="220" y="10" width="24" height="16" rx="3" fill="#CBD5E1" fillOpacity="0.6" stroke="#94A3B8" strokeWidth="0.8" />

          {/* Portrait photo silhouette */}
          <rect x="14" y="44" width="66" height="84" rx="7" fill="#E2E8F0" fillOpacity="0.75" stroke="#CBD5E1" strokeWidth="1" />
          <circle cx="47" cy="74" r="14" fill="#94A3B8" fillOpacity="0.55" />
          <path d="M23 122C24.5 103 34 94 47 94C60 94 69.5 103 71 122H23Z" fill="#94A3B8" fillOpacity="0.5" />

          {/* ARC Text Field Silhouettes */}
          <text x="92" y="54" fill="#64748B" fontSize="6.5" fontWeight="600" fontFamily="sans-serif" opacity="0.75">등록번호 ARC NO.</text>
          <rect x="92" y="58" width="128" height="10" rx="3" fill="#94A3B8" fillOpacity="0.4" />

          <text x="92" y="80" fill="#64748B" fontSize="6.5" fontWeight="600" fontFamily="sans-serif" opacity="0.75">성명 NAME</text>
          <rect x="92" y="84" width="144" height="10" rx="3" fill="#64748B" fillOpacity="0.38" />

          <text x="92" y="106" fill="#64748B" fontSize="6.5" fontWeight="600" fontFamily="sans-serif" opacity="0.75">국가 / 체류자격</text>
          <rect x="92" y="110" width="76" height="8" rx="3" fill="#94A3B8" fillOpacity="0.35" />
          <rect x="174" y="110" width="52" height="8" rx="3" fill="#60A5FA" fillOpacity="0.35" />

          {/* Issue date & Ministry footer */}
          <rect x="14" y="138" width="66" height="7" rx="2.5" fill="#CBD5E1" fillOpacity="0.7" />
          <rect x="92" y="138" width="96" height="7" rx="2.5" fill="#CBD5E1" fillOpacity="0.65" />
          <circle cx="236" cy="141" r="9" stroke="#94A3B8" strokeWidth="1" strokeDasharray="2 2" opacity="0.6" />

          <defs>
            <linearGradient id="arcFrontBg" x1="0" y1="0" x2="260" y2="164" gradientUnits="userSpaceOnUse">
              <stop stopColor="#FFFFFF" />
              <stop offset="0.55" stopColor="#F8FAFC" />
              <stop offset="1" stopColor="#EFF6FF" />
            </linearGradient>
          </defs>
        </svg>
      </div>
    );
  }

  if (type === 'arc-back') {
    return (
      <div className={`relative w-52 sm:w-56 aspect-[1.586/1] mx-auto select-none transition-transform duration-200 group-hover:scale-[1.02] ${className}`}>
        <CornerGuides accentClass="border-indigo-400/60 group-hover:border-indigo-600" />
        <svg
          viewBox="0 0 260 164"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className="w-full h-full drop-shadow-[0_6px_14px_rgba(30,58,138,0.10)]"
          aria-hidden="true"
        >
          {/* Card body */}
          <rect x="2" y="2" width="256" height="160" rx="12" fill="url(#arcBackBg)" stroke="#CBD5E1" strokeWidth="1.5" />
          {/* Header */}
          <text x="16" y="21" fill="#475569" fontSize="8" fontWeight="700" fontFamily="sans-serif" opacity="0.78">체류기간 · 체류지 변경사항</text>
          <text x="16" y="30" fill="#64748B" fontSize="6" fontWeight="600" letterSpacing="0.6" fontFamily="sans-serif" opacity="0.65">BACK SIDE · ADDRESS &amp; PERMIT</text>
          {/* QR / Serial Square */}
          <rect x="218" y="10" width="26" height="24" rx="3" fill="#E2E8F0" stroke="#CBD5E1" strokeWidth="1" />
          <rect x="222" y="14" width="6" height="6" rx="1" fill="#94A3B8" fillOpacity="0.65" />
          <rect x="234" y="14" width="6" height="6" rx="1" fill="#94A3B8" fillOpacity="0.65" />
          <rect x="222" y="24" width="6" height="6" rx="1" fill="#94A3B8" fillOpacity="0.65" />
          <rect x="232" y="24" width="8" height="6" rx="1" fill="#94A3B8" fillOpacity="0.45" />

          {/* Permit Period Table Silhouette */}
          <rect x="14" y="39" width="232" height="44" rx="5" fill="#F8FAFC" stroke="#CBD5E1" strokeWidth="1" />
          <line x1="14" y1="53" x2="246" y2="53" stroke="#CBD5E1" strokeWidth="1" />
          <line x1="14" y1="68" x2="246" y2="68" stroke="#E2E8F0" strokeWidth="1" />
          <line x1="92" y1="39" x2="92" y2="83" stroke="#CBD5E1" strokeWidth="1" />
          <line x1="178" y1="39" x2="178" y2="83" stroke="#CBD5E1" strokeWidth="1" />
          <rect x="24" y="44" width="52" height="5" rx="2" fill="#94A3B8" fillOpacity="0.45" />
          <rect x="104" y="44" width="56" height="5" rx="2" fill="#94A3B8" fillOpacity="0.45" />
          <rect x="192" y="44" width="38" height="5" rx="2" fill="#94A3B8" fillOpacity="0.45" />
          <rect x="24" y="58" width="56" height="5" rx="2" fill="#CBD5E1" fillOpacity="0.7" />
          <rect x="104" y="58" width="58" height="5" rx="2" fill="#CBD5E1" fillOpacity="0.7" />
          <rect x="196" y="58" width="30" height="5" rx="2" fill="#CBD5E1" fillOpacity="0.7" />

          {/* Address Change Box Silhouette */}
          <rect x="14" y="90" width="232" height="42" rx="5" fill="#EFF6FF" fillOpacity="0.55" stroke="#BFDBFE" strokeWidth="1" />
          <text x="22" y="102" fill="#3B82F6" fontSize="6.5" fontWeight="700" fontFamily="sans-serif" opacity="0.8">체류지 (អាសយដ្ឋាន)</text>
          <rect x="22" y="108" width="186" height="7" rx="2.5" fill="#64748B" fillOpacity="0.35" />
          <rect x="22" y="119" width="138" height="6.5" rx="2.5" fill="#94A3B8" fillOpacity="0.35" />

          {/* Bottom Barcode / Serial Strip */}
          <g opacity="0.45" fill="#64748B">
            <rect x="18" y="140" width="3" height="12" rx="0.5" />
            <rect x="24" y="140" width="1.5" height="12" rx="0.5" />
            <rect x="28" y="140" width="4" height="12" rx="0.5" />
            <rect x="35" y="140" width="2" height="12" rx="0.5" />
            <rect x="40" y="140" width="3" height="12" rx="0.5" />
            <rect x="46" y="140" width="1.5" height="12" rx="0.5" />
            <rect x="51" y="140" width="4" height="12" rx="0.5" />
            <rect x="58" y="140" width="2" height="12" rx="0.5" />
            <rect x="63" y="140" width="3" height="12" rx="0.5" />
          </g>
          <rect x="164" y="143" width="80" height="6.5" rx="2.5" fill="#94A3B8" fillOpacity="0.4" />

          <defs>
            <linearGradient id="arcBackBg" x1="0" y1="0" x2="260" y2="164" gradientUnits="userSpaceOnUse">
              <stop stopColor="#FFFFFF" />
              <stop offset="1" stopColor="#F1F5F9" />
            </linearGradient>
          </defs>
        </svg>
      </div>
    );
  }

  if (type === 'topik') {
    return (
      <div className={`relative w-36 sm:w-40 aspect-[3/4] mx-auto select-none transition-transform duration-200 group-hover:scale-[1.02] ${className}`}>
        <CornerGuides accentClass="border-indigo-400/60 group-hover:border-indigo-600" />
        <svg
          viewBox="0 0 180 240"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className="w-full h-full drop-shadow-[0_8px_16px_rgba(30,41,59,0.10)]"
          aria-hidden="true"
        >
          {/* A4 Paper Sheet */}
          <rect x="3" y="3" width="174" height="234" rx="8" fill="url(#topikBg)" stroke="#CBD5E1" strokeWidth="1.5" />
          {/* Inner Certificate Border */}
          <rect x="11" y="11" width="158" height="218" rx="4" stroke="#94A3B8" strokeWidth="1" strokeDasharray="3 2" opacity="0.55" />

          {/* 16-digit Verification No. top bar */}
          <rect x="20" y="18" width="88" height="6" rx="2" fill="#60A5FA" fillOpacity="0.4" />
          <text x="20" y="34" fill="#334155" fontSize="10" fontWeight="800" fontFamily="sans-serif" opacity="0.82">TOPIK 성적증명서</text>
          <text x="20" y="44" fill="#64748B" fontSize="6" fontWeight="600" fontFamily="sans-serif" opacity="0.7">SCORE REPORT CERTIFICATE</text>

          {/* Small candidate photo silhouette */}
          <rect x="128" y="20" width="32" height="40" rx="4" fill="#E2E8F0" stroke="#CBD5E1" strokeWidth="1" />
          <circle cx="144" cy="34" r="6.5" fill="#94A3B8" fillOpacity="0.55" />
          <path d="M133 56C134 47 138 43 144 43C150 43 154 47 155 56H133Z" fill="#94A3B8" fillOpacity="0.45" />

          {/* Candidate Info Lines */}
          <rect x="20" y="54" width="96" height="6.5" rx="2" fill="#94A3B8" fillOpacity="0.4" />
          <rect x="20" y="65" width="80" height="6" rx="2" fill="#CBD5E1" fillOpacity="0.7" />

          {/* Score Table Silhouette */}
          <rect x="20" y="82" width="140" height="58" rx="5" fill="#FFFFFF" stroke="#CBD5E1" strokeWidth="1" />
          <rect x="20" y="82" width="140" height="16" rx="4" fill="#EFF6FF" />
          <line x1="20" y1="98" x2="160" y2="98" stroke="#CBD5E1" strokeWidth="1" />
          <line x1="66" y1="82" x2="66" y2="140" stroke="#E2E8F0" strokeWidth="1" />
          <line x1="112" y1="82" x2="112" y2="140" stroke="#E2E8F0" strokeWidth="1" />

          {/* Score headers & bars */}
          <rect x="29" y="87" width="28" height="5" rx="2" fill="#94A3B8" fillOpacity="0.55" />
          <rect x="75" y="87" width="28" height="5" rx="2" fill="#94A3B8" fillOpacity="0.55" />
          <rect x="121" y="87" width="28" height="5" rx="2" fill="#60A5FA" fillOpacity="0.6" />

          <rect x="33" y="110" width="20" height="10" rx="2.5" fill="#CBD5E1" fillOpacity="0.8" />
          <rect x="79" y="110" width="20" height="10" rx="2.5" fill="#CBD5E1" fillOpacity="0.8" />
          {/* Highlighted Grade Box */}
          <rect x="120" y="106" width="32" height="20" rx="4" fill="#DBEAFE" stroke="#93C5FD" strokeWidth="1" />
          <text x="136" y="119" textAnchor="middle" fill="#2563EB" fontSize="9" fontWeight="800" fontFamily="sans-serif" opacity="0.85">급</text>

          {/* Validity & Exam Date lines */}
          <rect x="20" y="152" width="104" height="6" rx="2" fill="#94A3B8" fillOpacity="0.38" />
          <rect x="20" y="164" width="84" height="6" rx="2" fill="#CBD5E1" fillOpacity="0.7" />

          {/* Official Seal Stamp Silhouette */}
          <circle cx="138" cy="186" r="18" fill="#FEE2E2" fillOpacity="0.55" stroke="#FCA5A5" strokeWidth="1.2" strokeDasharray="3 2" />
          <rect x="128" y="182" width="20" height="8" rx="2" fill="#F87171" fillOpacity="0.45" />

          {/* Bottom Verification Barcode */}
          <rect x="20" y="206" width="90" height="10" rx="2" fill="#E2E8F0" />
          <rect x="24" y="209" width="16" height="4" rx="1" fill="#64748B" fillOpacity="0.45" />
          <rect x="44" y="209" width="16" height="4" rx="1" fill="#64748B" fillOpacity="0.45" />
          <rect x="64" y="209" width="16" height="4" rx="1" fill="#64748B" fillOpacity="0.45" />
          <rect x="84" y="209" width="20" height="4" rx="1" fill="#64748B" fillOpacity="0.45" />

          <defs>
            <linearGradient id="topikBg" x1="0" y1="0" x2="180" y2="240" gradientUnits="userSpaceOnUse">
              <stop stopColor="#FFFFFF" />
              <stop offset="1" stopColor="#F8FAFC" />
            </linearGradient>
          </defs>
        </svg>
      </div>
    );
  }

  // Passport Bio-data Page Silhouette
  return (
    <div className={`relative w-52 sm:w-56 aspect-[1.45/1] mx-auto select-none transition-transform duration-200 group-hover:scale-[1.02] ${className}`}>
      <CornerGuides accentClass="border-rose-400/60 group-hover:border-blue-600" />
      <svg
        viewBox="0 0 260 180"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="w-full h-full drop-shadow-[0_6px_14px_rgba(30,58,138,0.10)]"
        aria-hidden="true"
      >
        {/* Outer Passport Page */}
        <rect x="2" y="2" width="256" height="176" rx="10" fill="url(#passportBg)" stroke="#CBD5E1" strokeWidth="1.5" />
        {/* Top Passport Header Banner */}
        <path d="M2 12C2 6.47715 6.47715 2 12 2H248C253.523 2 258 6.47715 258 12V31H2V12Z" fill="#1E3A8A" fillOpacity="0.10" />
        <text x="16" y="19" fill="#1E3A8A" fontSize="9.5" fontWeight="800" letterSpacing="1.2" fontFamily="sans-serif" opacity="0.78">PASSPORT · 여권</text>
        {/* Biometric e-Passport Symbol */}
        <g transform="translate(222, 10)" opacity="0.65">
          <rect x="0" y="0" width="22" height="13" rx="2" stroke="#1E40AF" strokeWidth="1.2" />
          <line x1="0" y1="6.5" x2="7.5" y2="6.5" stroke="#1E40AF" strokeWidth="1.2" />
          <line x1="14.5" y1="6.5" x2="22" y2="6.5" stroke="#1E40AF" strokeWidth="1.2" />
          <circle cx="11" cy="6.5" r="3" stroke="#1E40AF" strokeWidth="1.2" />
        </g>

        {/* Portrait Photo Silhouette */}
        <rect x="14" y="40" width="66" height="86" rx="6" fill="#E2E8F0" fillOpacity="0.8" stroke="#CBD5E1" strokeWidth="1" />
        <circle cx="47" cy="70" r="14" fill="#94A3B8" fillOpacity="0.55" />
        <path d="M23 119C24.5 100 34 91 47 91C60 91 69.5 100 71 119H23Z" fill="#94A3B8" fillOpacity="0.5" />

        {/* Bio-data Grid Lines */}
        <text x="92" y="48" fill="#64748B" fontSize="6" fontWeight="700" fontFamily="sans-serif" opacity="0.75">TYPE / CODE / PASSPORT NO.</text>
        <rect x="92" y="52" width="20" height="8" rx="2" fill="#94A3B8" fillOpacity="0.4" />
        <rect x="118" y="52" width="32" height="8" rx="2" fill="#94A3B8" fillOpacity="0.4" />
        <rect x="156" y="52" width="84" height="8" rx="2" fill="#3B82F6" fillOpacity="0.35" />

        <text x="92" y="72" fill="#64748B" fontSize="6" fontWeight="700" fontFamily="sans-serif" opacity="0.75">SURNAME / GIVEN NAMES</text>
        <rect x="92" y="76" width="136" height="9" rx="2.5" fill="#64748B" fillOpacity="0.38" />

        <text x="92" y="97" fill="#64748B" fontSize="6" fontWeight="700" fontFamily="sans-serif" opacity="0.75">NATIONALITY / DATE OF BIRTH</text>
        <rect x="92" y="101" width="66" height="7.5" rx="2" fill="#94A3B8" fillOpacity="0.38" />
        <rect x="164" y="101" width="68" height="7.5" rx="2" fill="#94A3B8" fillOpacity="0.38" />

        <rect x="92" y="116" width="96" height="7" rx="2" fill="#CBD5E1" fillOpacity="0.75" />

        {/* Iconic Machine Readable Zone (MRZ) */}
        <rect x="10" y="136" width="240" height="32" rx="5" fill="#F1F5F9" stroke="#E2E8F0" strokeWidth="1" />
        <text x="18" y="150" fill="#64748B" fontSize="7.8" fontWeight="700" fontFamily="monospace" letterSpacing="0.8" opacity="0.72">
          P&lt;KHM&lt;&lt;SURNAME&lt;&lt;GIVEN&lt;NAME&lt;&lt;&lt;&lt;&lt;&lt;
        </text>
        <text x="18" y="161" fill="#64748B" fontSize="7.8" fontWeight="700" fontFamily="monospace" letterSpacing="0.8" opacity="0.72">
          N01234567&lt;KHM9501011M3001015&lt;&lt;&lt;&lt;
        </text>

        <defs>
          <linearGradient id="passportBg" x1="0" y1="0" x2="260" y2="180" gradientUnits="userSpaceOnUse">
            <stop stopColor="#FFFFFF" />
            <stop offset="0.6" stopColor="#F8FAFC" />
            <stop offset="1" stopColor="#EEF2FF" />
          </linearGradient>
        </defs>
      </svg>
    </div>
  );
};
