import { PWAInstallButton } from './PWAInstallButton';
import React, { useState } from 'react';
import { Language, UserAccount } from '../types';
import { SUPPORTED_LANGUAGES } from '../data/languages';
import { getTranslation } from '../utils/translations';
import {
  AlertCircle,
  FileText,
  Upload,
  CheckSquare,
  Download,
  Mail,
  Globe,
  BookOpen,
  LogIn,
  LogOut,
  User,
  Lock,
  CheckCircle,
  ScanText,
  Menu,
  X,
  Check,
  FileCheck2,
} from 'lucide-react';

interface NavbarProps {
  currentStep: number;
  setCurrentStep: (step: number) => void;
  lang: Language;
  setLang: (lang: Language) => void;
  user: UserAccount;
  onOpenAuth: () => void;
  onLogout: () => void;
  onLoadSample: () => void;
  onTestDownload?: () => void;
  onOpenBgSettings?: () => void;
  activeTab: 'flow' | 'guide' | 'about';
  setActiveTab: (tab: 'flow' | 'guide' | 'about') => void;
  isPaid?: boolean;
  onOpenPayment?: () => void;
  onOpenSocinetNotice?: () => void;
  onOpenLangModal?: () => void;
  isStep1Ready?: boolean;
  canOpenVerification?: boolean;
  isAdmin?: boolean;
}

export const Navbar: React.FC<NavbarProps> = ({
  currentStep,
  setCurrentStep,
  lang,
  setLang,
  user,
  onOpenAuth,
  onLogout,
  activeTab,
  setActiveTab,
  isPaid = false,
  onOpenPayment,
  onOpenSocinetNotice,
  onOpenLangModal,
  isStep1Ready = false,
  canOpenVerification,
  isAdmin = false,
}) => {
  const t = getTranslation(lang);
  const [aboutAvatarError, setAboutAvatarError] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const isKm = lang === 'km';
  const isKo = lang === 'ko';

  const formatOtherLangLabel = (rawLabel: string, stepNum: number) => {
    if (lang === 'km' || lang === 'ko' || lang === 'en') return rawLabel;
    const stripped = rawLabel.replace(/^[^\s:]+\s*\d+\s*[:：]\s*/, '').trim();
    return `${stepNum}. ${stripped || rawLabel}`;
  };

  const steps = [
    { num: 1, label: t.step1Tab, icon: Upload },
    {
      num: 2,
      label:
        lang === 'km' || lang === 'ko' || lang === 'en'
          ? t.step2OcrTab || 'Step 2: Verify OCR Data'
          : '2. OCR Verification',
      icon: ScanText,
    },
    { num: 3, label: formatOtherLangLabel(t.step2Tab, 3), icon: CheckSquare },
    { num: 4, label: formatOtherLangLabel(t.step3Tab, 4), icon: Download },
    { num: 5, label: formatOtherLangLabel(t.step4Tab, 5), icon: Mail },
  ];

  const handleSelectTab = (tab: 'flow' | 'guide' | 'about') => {
    setActiveTab(tab);
    setMobileMenuOpen(false);
  };

  return (
    <header className="sticky top-0 z-50 bg-white/92 backdrop-blur-xl border-b border-slate-200/85 shadow-[0_2px_16px_rgba(15,23,42,0.04)]">
      {/* Subtle Top Brand Accent Line */}
      <div className="h-[2.5px] w-full bg-gradient-to-r from-blue-600 via-indigo-600 to-teal-500" aria-hidden="true" />

      {/* Main Navigation Row */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between gap-4 h-16">
          {/* Zone 1: Brand Wordmark */}
          <button
            type="button"
            onClick={() => handleSelectTab('flow')}
            className="flex items-center gap-2.5 cursor-pointer group whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 rounded-xl pr-1"
          >
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-slate-900 via-blue-900 to-indigo-700 flex items-center justify-center text-white shadow-sm group-hover:scale-[1.03] transition-transform duration-200 shrink-0">
              <FileText className="w-4.5 h-4.5" />
            </div>
            <span className="font-extrabold text-slate-900 tracking-tight text-base sm:text-[17px]">
              KIIP · TOPIK
            </span>
          </button>

          {/* Zone 2: Center Primary Navigation Links (Desktop) */}
          <nav
            aria-label="Primary Navigation"
            className="hidden lg:flex items-center gap-1 bg-slate-100/80 p-1 rounded-xl border border-slate-200/75"
          >
            <button
              type="button"
              onClick={() => handleSelectTab('flow')}
              className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all duration-150 cursor-pointer whitespace-nowrap shrink-0 ${
                activeTab === 'flow'
                  ? 'bg-white text-blue-700 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-white/60'
              }`}
            >
              <FileCheck2 className="w-3.5 h-3.5" />
              <span>{isKm ? 'ដាក់ពាក្យ TOPIK→KIIP' : isKo ? '연계 신청' : 'Application'}</span>
            </button>

            <button
              type="button"
              onClick={() => handleSelectTab(activeTab === 'guide' ? 'flow' : 'guide')}
              className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all duration-150 cursor-pointer whitespace-nowrap shrink-0 ${
                activeTab === 'guide'
                  ? 'bg-white text-amber-800 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-white/60'
              }`}
            >
              <BookOpen className="w-3.5 h-3.5 text-amber-600" />
              <span>{t.topikKiipGuide}</span>
            </button>

            <button
              type="button"
              onClick={() => handleSelectTab(activeTab === 'about' ? 'flow' : 'about')}
              className={`flex items-center gap-2 pl-2 pr-3.5 py-1 rounded-lg text-xs font-bold transition-all duration-150 cursor-pointer whitespace-nowrap shrink-0 ${
                activeTab === 'about'
                  ? 'bg-white text-indigo-800 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-white/60'
              }`}
            >
              {!aboutAvatarError ? (
                <img
                  src="/assets/aistudio/b315a395-5f7a-45e1-8f72-2e787ca251fb_12dc3517.jfif"
                  alt="Eang Veasna"
                  referrerPolicy="no-referrer"
                  onError={() => setAboutAvatarError(true)}
                  className="w-5 h-5 rounded-full object-cover object-top border border-indigo-200 shrink-0"
                />
              ) : (
                <User className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
              )}
              <span>{isKm ? 'អំពីខ្ញុំ' : isKo ? '소개' : 'About Me'}</span>
            </button>

            {onOpenSocinetNotice && (
              <button
                type="button"
                onClick={onOpenSocinetNotice}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold text-amber-800 hover:bg-amber-50 transition-colors duration-150 cursor-pointer whitespace-nowrap shrink-0"
                title={t.socinetNoticeAlert}
              >
                <AlertCircle className="w-3.5 h-3.5 text-amber-600" />
                <span>Socinet</span>
              </button>
            )}
          </nav>

          {/* Zone 3: Right Utility Controls & Primary Action */}
          <div className="flex items-center gap-2 shrink-0">
            {/* Unlock Clean PDF / Paid status */}
            {!isPaid && onOpenPayment ? (
              <button
                type="button"
                onClick={onOpenPayment}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200/90 transition-colors cursor-pointer whitespace-nowrap shrink-0"
                title={t.unlockCleanPdf}
              >
                <Lock className="w-3.5 h-3.5 text-rose-600 shrink-0" />
                <span className="hidden sm:inline">{t.unlockCleanPdf}</span>
                <span className="sm:hidden tabular-nums">₩35,000</span>
              </button>
            ) : isPaid ? (
              <span className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 whitespace-nowrap shrink-0">
                <CheckCircle className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                <span>{t.unlockedBadge}</span>
              </span>
            ) : null}

            {/* PC Desktop App Install Button */}
            <div className="hidden xl:flex">
              <PWAInstallButton lang={lang} isAdmin={isAdmin} />
            </div>

            {/* Unified Language Selector */}
            <div className="relative flex items-center bg-slate-100/90 hover:bg-slate-200/70 rounded-xl px-1.5 py-0.5 border border-slate-200/90 transition-colors shrink-0">
              {onOpenLangModal ? (
                <button
                  type="button"
                  onClick={onOpenLangModal}
                  className="p-1 text-slate-600 hover:text-blue-600 rounded-lg transition-colors cursor-pointer"
                  title="បើកផ្ទាំងជ្រើសរើស ៥០ ភាសា (Open 50 Languages Picker)"
                >
                  <Globe className="w-3.5 h-3.5" />
                </button>
              ) : (
                <Globe className="w-3.5 h-3.5 text-slate-500 ml-1 shrink-0" />
              )}
              <select
                value={lang}
                onChange={(e) => setLang(e.target.value as Language)}
                aria-label="Language (50 languages supported)"
                className="bg-transparent text-xs font-semibold text-slate-800 py-1 pl-0.5 pr-1.5 rounded focus:outline-none cursor-pointer max-w-[95px] sm:max-w-[130px]"
              >
                <optgroup label="អាស៊ីអាគ្នេយ៍ / Southeast Asia">
                  {SUPPORTED_LANGUAGES.filter((l) => l.region === 'Southeast Asia').map((l) => (
                    <option key={l.code} value={l.code}>
                      {l.flag} {l.name}
                    </option>
                  ))}
                </optgroup>
                <optgroup label="អាស៊ីបូព៌ា / East Asia">
                  {SUPPORTED_LANGUAGES.filter((l) => l.region === 'East Asia').map((l) => (
                    <option key={l.code} value={l.code}>
                      {l.flag} {l.name}
                    </option>
                  ))}
                </optgroup>
                <optgroup label="អាស៊ីខាងត្បូង / South Asia">
                  {SUPPORTED_LANGUAGES.filter((l) => l.region === 'South Asia').map((l) => (
                    <option key={l.code} value={l.code}>
                      {l.flag} {l.name}
                    </option>
                  ))}
                </optgroup>
                <optgroup label="អាស៊ីកណ្តាល & CIS / Central Asia">
                  {SUPPORTED_LANGUAGES.filter((l) => l.region === 'Central Asia & CIS').map((l) => (
                    <option key={l.code} value={l.code}>
                      {l.flag} {l.name}
                    </option>
                  ))}
                </optgroup>
                <optgroup label="មជ្ឈិមបូព៌ា / Middle East">
                  {SUPPORTED_LANGUAGES.filter((l) => l.region === 'Middle East').map((l) => (
                    <option key={l.code} value={l.code}>
                      {l.flag} {l.name}
                    </option>
                  ))}
                </optgroup>
                <optgroup label="អឺរ៉ុប & អាមេរិក / Europe & Americas">
                  {SUPPORTED_LANGUAGES.filter((l) => l.region === 'Europe & Americas').map((l) => (
                    <option key={l.code} value={l.code}>
                      {l.flag} {l.name}
                    </option>
                  ))}
                </optgroup>
                <optgroup label="អាហ្វ្រិក / Africa">
                  {SUPPORTED_LANGUAGES.filter((l) => l.region === 'Africa').map((l) => (
                    <option key={l.code} value={l.code}>
                      {l.flag} {l.name}
                    </option>
                  ))}
                </optgroup>
              </select>
            </div>

            {/* Auth Button */}
            {user.isLoggedIn ? (
              <div className="flex items-center gap-1.5 pl-0.5 shrink-0">
                <div className="w-8 h-8 rounded-full overflow-hidden border-2 border-blue-500/40 bg-blue-50 flex items-center justify-center text-xs font-bold text-blue-700">
                  {user.avatar ? (
                    <img src={user.avatar} alt={user.name} referrerPolicy="no-referrer" className="w-full h-full object-cover" />
                  ) : (
                    user.name.charAt(0)
                  )}
                </div>
                <button
                  type="button"
                  onClick={onLogout}
                  title={t.logout}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer"
                >
                  <LogOut className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={onOpenAuth}
                className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold bg-slate-900 text-white hover:bg-blue-700 transition-colors shadow-xs cursor-pointer whitespace-nowrap shrink-0"
              >
                <LogIn className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">{t.login}</span>
                <span className="sm:hidden">Login</span>
              </button>
            )}

            {/* Mobile Drawer Toggle Button */}
            <button
              type="button"
              onClick={() => setMobileMenuOpen((v) => !v)}
              aria-label="Toggle Menu"
              aria-expanded={mobileMenuOpen}
              className="lg:hidden p-2 rounded-xl text-slate-600 hover:text-slate-900 hover:bg-slate-100 border border-slate-200/80 transition-colors cursor-pointer shrink-0"
            >
              {mobileMenuOpen ? <X className="w-4.5 h-4.5" /> : <Menu className="w-4.5 h-4.5" />}
            </button>
          </div>
        </div>
      </div>

      {/* Mobile Clean Navigation Drawer */}
      {mobileMenuOpen && (
        <div className="lg:hidden border-t border-slate-200/80 bg-white/98 px-4 py-3 space-y-2 shadow-lg">
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => handleSelectTab('flow')}
              className={`flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl text-xs font-bold border transition-colors cursor-pointer ${
                activeTab === 'flow'
                  ? 'bg-blue-50 text-blue-800 border-blue-200'
                  : 'bg-slate-50 text-slate-700 border-slate-200'
              }`}
            >
              <FileCheck2 className="w-4 h-4" />
              <span>{isKm ? 'ដាក់ពាក្យ TOPIK→KIIP' : isKo ? '연계 신청' : 'Application'}</span>
            </button>

            <button
              type="button"
              onClick={() => handleSelectTab('guide')}
              className={`flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl text-xs font-bold border transition-colors cursor-pointer ${
                activeTab === 'guide'
                  ? 'bg-amber-50 text-amber-900 border-amber-200'
                  : 'bg-slate-50 text-slate-700 border-slate-200'
              }`}
            >
              <BookOpen className="w-4 h-4 text-amber-600" />
              <span>{t.topikKiipGuide}</span>
            </button>

            <button
              type="button"
              onClick={() => handleSelectTab('about')}
              className={`flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl text-xs font-bold border transition-colors cursor-pointer ${
                activeTab === 'about'
                  ? 'bg-indigo-50 text-indigo-900 border-indigo-200'
                  : 'bg-slate-50 text-slate-700 border-slate-200'
              }`}
            >
              <User className="w-4 h-4 text-indigo-600" />
              <span>{isKm ? 'អំពីខ្ញុំ' : isKo ? '소개' : 'About Me'}</span>
            </button>

            {onOpenSocinetNotice && (
              <button
                type="button"
                onClick={() => {
                  setMobileMenuOpen(false);
                  onOpenSocinetNotice();
                }}
                className="flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl text-xs font-bold bg-amber-50/70 text-amber-900 border border-amber-200 cursor-pointer"
              >
                <AlertCircle className="w-4 h-4 text-amber-600" />
                <span>Socinet Guide</span>
              </button>
            )}
          </div>

          <div className="flex items-center justify-between pt-1.5 border-t border-slate-100">
            <PWAInstallButton lang={lang} isAdmin={isAdmin} />
            {onOpenLangModal && (
              <button
                type="button"
                onClick={() => {
                  setMobileMenuOpen(false);
                  onOpenLangModal();
                }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold text-blue-700 bg-blue-50 border border-blue-200 cursor-pointer"
              >
                <Globe className="w-3.5 h-3.5" />
                <span>50 Languages</span>
              </button>
            )}
          </div>
        </div>
      )}

      {/* Sleek Desktop Step Progress Strip (Flow Mode) */}
      {activeTab === 'flow' && (
        <div className="hidden md:block bg-slate-50/85 border-t border-slate-200/75">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="grid grid-cols-5">
              {steps.map((s) => {
                const isActive = currentStep === s.num;
                const isCompleted = currentStep > s.num;
                const isLocked =
                  s.num === 2
                    ? !(canOpenVerification ?? isStep1Ready)
                    : s.num > 2 && !isStep1Ready;
                const isPayLocked = s.num === 5 && !isPaid;

                return (
                  <button
                    key={s.num}
                    type="button"
                    disabled={isLocked}
                    onClick={() => {
                      if (isLocked) return;
                      setCurrentStep(s.num);
                    }}
                    title={
                      isLocked
                        ? t.stepLockedAlert || 'សូមបំពេញឯកសារចាំបាច់ទាំងអស់ក្នុងជំហានទី ១ ជាមុនសិន'
                        : isPayLocked
                        ? 'តម្រូវឱ្យបង់ប្រាក់ជាមុនសិន ទើបអាចបន្តទៅជំហានទី ៥ បាន'
                        : undefined
                    }
                    className={`relative flex items-center justify-center gap-2 px-3 py-2.5 text-xs font-semibold transition-colors border-b-2 ${
                      isActive
                        ? 'border-blue-600 text-blue-700 bg-white/80'
                        : isCompleted
                        ? 'border-emerald-500/70 text-emerald-800 hover:bg-emerald-50/50 cursor-pointer'
                        : isLocked
                        ? 'border-transparent text-slate-400 cursor-not-allowed'
                        : 'border-transparent text-slate-600 hover:text-slate-900 hover:bg-white/60 cursor-pointer'
                    }`}
                  >
                    <span
                      className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold tabular-nums shrink-0 transition-colors ${
                        isActive
                          ? 'bg-blue-600 text-white'
                          : isCompleted
                          ? 'bg-emerald-600 text-white'
                          : isLocked
                          ? 'bg-slate-200/80 text-slate-400'
                          : isPayLocked
                          ? 'bg-amber-100 text-amber-700'
                          : 'bg-slate-200 text-slate-700'
                      }`}
                    >
                      {isCompleted ? (
                        <Check className="w-3 h-3 stroke-[2.75]" />
                      ) : isLocked || isPayLocked ? (
                        <Lock className="w-2.5 h-2.5" />
                      ) : (
                        s.num
                      )}
                    </span>
                    <span className="truncate">{s.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </header>
  );
};
