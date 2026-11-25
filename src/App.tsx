import React, { useState, useRef, useEffect } from 'react';
import { 
  Language, 
  ApplicationFormData, 
  UploadedDocuments, 
  UserAccount,
  SignatureSettings
} from './types';
import { INITIAL_FORM_DATA, SAMPLE_FORM_DATA, generateSampleArcFront, generateSampleArcBack, generateSampleTopikCert, generateSampleSignature, generateSamplePassport } from './data/sampleData';
import { Navbar } from './components/Navbar';
import { StepsProgressBar } from './components/StepsProgressBar';
import { AuthModal } from './components/AuthModal';
import { TopikKiipGuide } from './components/TopikKiipGuide';
import { Step1Upload } from './components/Step1Upload';
import { Step2OcrReview } from './components/Step2OcrReview';
import { Step2FormTemplate } from './components/Step2FormTemplate';
import { Step3PdfPreview } from './components/Step3PdfPreview';
import { Step4EmailSender } from './components/Step4EmailSender';
import {
  ExtractedDocumentData,
  OcrFieldConfidenceMap,
  runFullDocumentOcrPipeline,
  mergeExtractedIntoFormData,
  formDataToExtractedDraft,
  evaluateDraftConfidence,
} from './utils/clientOcrEngine';
import { BackgroundSettingsModal } from './components/BackgroundSettingsModal';
import { PaymentModal } from './components/PaymentModal';
import { SocinetNoticeModal } from './components/SocinetNoticeModal';
import { LanguageSelectorModal } from './components/LanguageSelectorModal';
import { AdminAuthModal } from './components/AdminAuthModal';
import { AdminDashboard } from './components/AdminDashboard';
import { RightAdsAndStatsSidebar } from './components/RightAdsAndStatsSidebar';
import { WebsiteGuideChatbot, NavActionId } from './components/WebsiteGuideChatbot';
import { AboutMePage } from './components/AboutMePage';
import { getTranslation } from './utils/translations';
import { saveFormDraft, isFormDataWorthSaving } from './utils/draftStorage';
import { auth } from './utils/firebase';
import { signOut } from 'firebase/auth';
import { 
  BookOpen, 
  FileCheck2, 
  ShieldCheck, 
  Sparkles, 
  AlertCircle,
  HelpCircle,
  Award,
  Lock,
  Shield
} from 'lucide-react';

const DEFAULT_BG_URL = './study_background_v2.jpg';

export default function App() {
  // Language detection with persistence
  const [lang, setLangState] = useState<Language>(() => {
    try {
      const saved = localStorage.getItem('app_user_lang') as Language;
      if (saved) return saved;
    } catch {}
    const navLang = navigator.language.toLowerCase();
    if (navLang.includes('km')) return 'km';
    if (navLang.includes('ko')) return 'ko';
    return 'km'; // Default to Khmer
  });

  const setLang = (newLang: Language) => {
    setLangState(newLang);
    try {
      localStorage.setItem('app_user_lang', newLang);
    } catch {}
  };

  const t = getTranslation(lang);

  // Sync html lang and Khmer font styling
  useEffect(() => {
    document.documentElement.lang = lang;
    document.body.dataset.lang = lang;
    if (lang === 'km') {
      document.body.classList.add('lang-khmer');
    } else {
      document.body.classList.remove('lang-khmer');
    }
  }, [lang]);

  // 50 Languages Selector Modal
  const [isLangModalOpen, setIsLangModalOpen] = useState<boolean>(false);

  // Socinet ID & Password Requirement Notice Popup
  const [isSocinetNoticeOpen, setIsSocinetNoticeOpen] = useState<boolean>(() => {
    try {
      return localStorage.getItem('socinet_notice_dismissed') !== 'true';
    } catch {
      return true;
    }
  });

  // Admin Mode (Stored strictly in React memory — never in localStorage or URL query params)
  const [adminToken, setAdminToken] = useState<string | null>(null);
  const [adminUsername, setAdminUsername] = useState<string | null>(null);
  const isAdmin = Boolean(adminToken);
  const [isAdminAuthOpen, setIsAdminAuthOpen] = useState<boolean>(false);
  const [isAdminDashboardOpen, setIsAdminDashboardOpen] = useState<boolean>(false);

  // Clean up any legacy localStorage admin or permanent paid flags from prior versions
  useEffect(() => {
    try {
      localStorage.removeItem('kiip_admin_mode');
      localStorage.removeItem('kiip_doc_paid_v3');
      localStorage.removeItem('kiip_doc_paid');
    } catch {}
  }, []);

  const handleAdminLogout = async () => {
    const tokenToRevoke = adminToken;
    setAdminToken(null);
    setAdminUsername(null);
    setIsAdminDashboardOpen(false);
    if (tokenToRevoke) {
      try {
        await fetch('/api/admin/logout', {
          method: 'POST',
          headers: { Authorization: `Bearer ${tokenToRevoke}` },
        });
      } catch {
        // ignore network errors on logout
      }
    }
  };

  // Workflow navigation
  const [currentStep, setCurrentStep] = useState<number>(1);
  const [activeTab, setActiveTab] = useState<'flow' | 'guide' | 'about'>('flow');

  // Background Wallpaper State (Always defaults to the user's provided background image)
  const [bgImage, setBgImage] = useState<string | null>(DEFAULT_BG_URL);
  const [bgOpacity, setBgOpacity] = useState<number>(0.26);
  const [isBgModalOpen, setIsBgModalOpen] = useState<boolean>(false);

  // Form State
  const [formData, setFormData] = useState<ApplicationFormData>(INITIAL_FORM_DATA);

  // Document Uploads State
  const [docs, setDocs] = useState<UploadedDocuments>({
    arcFront: null,
    arcBack: null,
    passportList: [],
    topikCertList: [],
    signature: null,
    signatureRaw: null,
  });

  // Global Signature Settings State (Move & Resize by hand)
  const [sigSettings, setSigSettings] = useState<SignatureSettings>({
    x: 0,
    y: 0,
    scale: 1.0,
    removeBg: true,
    bgMode: 'transparent',
    inkColor: 'black',
    threshold: 55,
  });

  // User Auth State
  const [user, setUser] = useState<UserAccount>({
    isLoggedIn: false,
    name: '0000 0000',
    email: 'user0000@gmail.com',
    avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80',
    provider: 'guest',
  });
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);

  // Staged OCR Draft & Verification state (between Step 1 Upload and Step 3 Form)
  const [extractedOcrDraft, setExtractedOcrDraft] = useState<ExtractedDocumentData>({});
  const [ocrInitialSnapshot, setOcrInitialSnapshot] = useState<ExtractedDocumentData | null>(null);
  const [ocrConfidenceMap, setOcrConfidenceMap] = useState<OcrFieldConfidenceMap>({});
  const [ocrInitialConfidenceSnapshot, setOcrInitialConfidenceSnapshot] = useState<OcrFieldConfidenceMap | null>(null);
  const [ocrRawText, setOcrRawText] = useState<string>('');
  const [ocrModel, setOcrModel] = useState<string>('');
  const [isRescanningOcr, setIsRescanningOcr] = useState<boolean>(false);
  const [hasConfirmedOcrReview, setHasConfirmedOcrReview] = useState<boolean>(false);

  // Payment & Watermark Unlock State (Strictly in-memory per session — never persisted in localStorage)
  const [isPaid, setIsPaid] = useState<boolean>(false);
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
  const [pendingStepAfterPayment, setPendingStepAfterPayment] = useState<number | null>(null);
  const [autoDownloadPdfTrigger, setAutoDownloadPdfTrigger] = useState<number>(0);

  // Form element ref for high-resolution canvas snapshot
  const formRef = useRef<HTMLDivElement | null>(null);

  // Auto-save form progress to localStorage periodically
  useEffect(() => {
    if (!isFormDataWorthSaving(formData)) return;
    const timer = setTimeout(() => {
      saveFormDraft(formData);
    }, 1500);
    return () => clearTimeout(timer);
  }, [formData]);

  // Periodic interval save every 8 seconds as background safety net
  useEffect(() => {
    const interval = setInterval(() => {
      if (isFormDataWorthSaving(formData)) {
        saveFormDraft(formData);
      }
    }, 8000);
    return () => clearInterval(interval);
  }, [formData]);

  // Load sample documents in 1-click
  const handleLoadSample = () => {
    const sampleArcFront = generateSampleArcFront();
    const sampleArcBack = generateSampleArcBack();
    const sampleTopik = generateSampleTopikCert();
    const samplePassport = generateSamplePassport();
    const sampleSig = generateSampleSignature();

    setDocs({
      arcFront: sampleArcFront,
      arcFrontName: 'sample_arc_front.png',
      arcBack: sampleArcBack,
      arcBackName: 'sample_arc_back.png',
      passportList: [
        {
          id: 'sample-passport-1',
          dataUrl: samplePassport,
          name: '여권_SOK_SRORNG.png',
        },
      ],
      topikCertList: [
        {
          id: 'sample-topik-1',
          dataUrl: sampleTopik,
          name: '107회_한국어능력시험_성적증명서.png',
        },
      ],
      signature: sampleSig,
      signatureRaw: sampleSig,
    });

    setFormData(SAMPLE_FORM_DATA);
    const sampleDraft = formDataToExtractedDraft(SAMPLE_FORM_DATA);
    const sampleConfidence = evaluateDraftConfidence(sampleDraft, undefined, undefined, 'svg-preset');
    setExtractedOcrDraft(sampleDraft);
    setOcrInitialSnapshot(sampleDraft);
    setOcrConfidenceMap(sampleConfidence);
    setOcrInitialConfidenceSnapshot(sampleConfidence);
    setOcrModel('sample-preset');
    setOcrRawText('');
    setHasConfirmedOcrReview(false);
    setIsPaid(false);
    setActiveTab('flow');
  };

  // Immediate 1-click Test Download handler
  const handleTestDownload = () => {
    // If user has not loaded any documents yet, load sample zeroed documents automatically
    if (!docs.arcFront && !docs.topikCertList.length) {
      handleLoadSample();
    }
    setActiveTab('flow');
    setCurrentStep(4);
  };

  const handleOcrCompleted = (
    data: ExtractedDocumentData,
    rawTextPreview: string,
    model: string,
    confidenceMap?: OcrFieldConfidenceMap
  ) => {
    setExtractedOcrDraft((prev) => ({ ...prev, ...data }));
    setOcrInitialSnapshot((prev) => ({ ...(prev || {}), ...data }));
    if (confidenceMap) {
      setOcrConfidenceMap((prev) => ({ ...prev, ...confidenceMap }));
      setOcrInitialConfidenceSnapshot((prev) => ({ ...(prev || {}), ...confidenceMap }));
    }
    if (rawTextPreview) setOcrRawText(rawTextPreview);
    if (model) setOcrModel(model);
    setHasConfirmedOcrReview(false);
  };

  const handleRescanOcrFromReview = async () => {
    setIsRescanningOcr(true);
    try {
      const res = await runFullDocumentOcrPipeline({
        arcFront: docs.arcFront,
        arcBack: docs.arcBack,
        topikCert: docs.topikCertList[0]?.dataUrl || null,
        passport: docs.passportList[0]?.dataUrl || null,
      });
      setExtractedOcrDraft((prev) => ({ ...prev, ...res.data }));
      setOcrInitialSnapshot((prev) => ({ ...(prev || {}), ...res.data }));
      setOcrConfidenceMap((prev) => ({ ...prev, ...res.confidence }));
      setOcrInitialConfidenceSnapshot((prev) => ({ ...(prev || {}), ...res.confidence }));
      if (res.rawTextPreview) setOcrRawText(res.rawTextPreview);
      if (res.model) setOcrModel(res.model);
    } finally {
      setIsRescanningOcr(false);
    }
  };

  const handleConfirmOcrInjection = (confirmedDraft: ExtractedDocumentData) => {
    setExtractedOcrDraft(confirmedDraft);
    setFormData((prev) => mergeExtractedIntoFormData(prev, confirmedDraft, true));
    setHasConfirmedOcrReview(true);
    setCurrentStep(3);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleReset = () => {
    if (confirm(t.resetConfirm)) {
      setDocs({
        arcFront: null,
        arcBack: null,
        passportList: [],
        topikCertList: [],
        signature: null,
        signatureRaw: null,
      });
      setSigSettings({
        x: 0,
        y: 0,
        scale: 1.0,
        removeBg: true,
        bgMode: 'transparent',
        inkColor: 'black',
        threshold: 55,
      });
      setFormData(INITIAL_FORM_DATA);
      setExtractedOcrDraft({});
      setOcrInitialSnapshot(null);
      setOcrConfidenceMap({});
      setOcrInitialConfidenceSnapshot(null);
      setOcrRawText('');
      setOcrModel('');
      setHasConfirmedOcrReview(false);
      setCurrentStep(1);
    }
  };

  // Check if all 6 mandatory items in Step 1 are ready:
  // 1. ARC front & back (외국인등록증 앞·뒷면)
  // 2. TOPIK cert (성적증명서)
  // 3. Passport copy (여권 사본)
  // 4. Signature (서명)
  // 5. Socinet Account (ID & Password)
  // 6. Phone (전화번호)
  // (Korean address search, building/mailbox, and official address can be skipped per user requirement)
  const missingStep1Items: string[] = [];
  if (!docs.arcFront) missingStep1Items.push('ARC Front (외국인등록증 앞면)');
  if (!docs.arcBack) missingStep1Items.push('ARC Back (외국인등록증 뒷면)');
  if (!docs.topikCertList || docs.topikCertList.length === 0) missingStep1Items.push('TOPIK Score Certificate (성적증명서)');
  if (!docs.passportList || docs.passportList.length === 0) missingStep1Items.push('Passport Copy (여권 사본)');
  if (!docs.signature) missingStep1Items.push('Signature (서명)');
  if (!formData.phone || !formData.phone.trim()) missingStep1Items.push('Phone Number (전화번호)');
  if (!formData.socinetId || !formData.socinetId.trim()) missingStep1Items.push('Socinet ID (사회통합정보망 아이디)');
  if (!formData.socinetPw || !formData.socinetPw.trim()) missingStep1Items.push('Socinet Password (사회통합정보망 비밀번호)');

  const isStep1Ready = missingStep1Items.length === 0;

  const handleGuideNavAction = (action: NavActionId) => {
    switch (action) {
      case 'about':
        setActiveTab('about');
        window.scrollTo({ top: 0, behavior: 'smooth' });
        break;
      case 'guide':
        setActiveTab('guide');
        window.scrollTo({ top: 0, behavior: 'smooth' });
        break;
      case 'step1':
        setActiveTab('flow');
        setCurrentStep(1);
        window.scrollTo({ top: 0, behavior: 'smooth' });
        break;
      case 'step2':
        setActiveTab('flow');
        setCurrentStep(isStep1Ready ? 2 : 1);
        window.scrollTo({ top: 0, behavior: 'smooth' });
        break;
    case 'step3':
        if (isStep1Ready) {
          if (currentStep === 2 || (!hasConfirmedOcrReview && Object.keys(extractedOcrDraft).length > 0)) {
            setFormData((prev) => mergeExtractedIntoFormData(prev, extractedOcrDraft, true));
            setHasConfirmedOcrReview(true);
          }
          setActiveTab('flow');
          setCurrentStep(3);
        } else {
          setActiveTab('flow');
          setCurrentStep(1);
        }
        window.scrollTo({ top: 0, behavior: 'smooth' });
        break;
      case 'step4':
        if (isStep1Ready) {
          if (currentStep === 2 || (!hasConfirmedOcrReview && Object.keys(extractedOcrDraft).length > 0)) {
            setFormData((prev) => mergeExtractedIntoFormData(prev, extractedOcrDraft, true));
            setHasConfirmedOcrReview(true);
          }
          setActiveTab('flow');
          setCurrentStep(4);
        } else {
          setActiveTab('flow');
          setCurrentStep(1);
        }
        window.scrollTo({ top: 0, behavior: 'smooth' });
        break;
      case 'step5':
        if (!isStep1Ready) {
          setActiveTab('flow');
          setCurrentStep(1);
        } else {
          if (currentStep === 2 || (!hasConfirmedOcrReview && Object.keys(extractedOcrDraft).length > 0)) {
            setFormData((prev) => mergeExtractedIntoFormData(prev, extractedOcrDraft, true));
            setHasConfirmedOcrReview(true);
          }
          if (!isPaid) {
            setPendingStepAfterPayment(5);
            setIsPaymentModalOpen(true);
          } else {
            setActiveTab('flow');
            setCurrentStep(5);
          }
        }
        window.scrollTo({ top: 0, behavior: 'smooth' });
        break;
      case 'socinet':
        setIsSocinetNoticeOpen(true);
        break;
      case 'payment':
        setIsPaymentModalOpen(true);
        break;
      case 'language':
        setIsLangModalOpen(true);
        break;
      case 'sample':
        handleLoadSample();
        window.scrollTo({ top: 0, behavior: 'smooth' });
        break;
    }
  };

  const handleNavigateStep = (s: number) => {
    if (s > 1 && !isStep1Ready) {
      return;
    }
    if (s >= 3 && (currentStep === 2 || (!hasConfirmedOcrReview && Object.keys(extractedOcrDraft).length > 0))) {
      setFormData((prev) => mergeExtractedIntoFormData(prev, extractedOcrDraft, true));
      setHasConfirmedOcrReview(true);
    }
    if (s === 5 && !isPaid) {
      setPendingStepAfterPayment(5);
      setIsPaymentModalOpen(true);
      return;
    }
    setActiveTab('flow');
    setCurrentStep(s);
  };

  return (
    <div className="min-h-dvh bg-slate-50 flex flex-col font-sans relative print-root-container">
      {/* Background Wallpaper Container */}
      {bgImage && (
        <div 
          className="fixed inset-0 pointer-events-none z-0 transition-opacity duration-500 ease-out no-print"
          style={{
            backgroundImage: `url(${bgImage})`,
            backgroundSize: 'cover',
            backgroundPosition: 'center top',
            backgroundRepeat: 'no-repeat',
            opacity: bgOpacity,
          }}
        />
      )}

      {/* Navigation Bar */}
      <div className="relative z-20 no-print">
        <Navbar
          currentStep={currentStep}
          setCurrentStep={handleNavigateStep}
          isStep1Ready={isStep1Ready}
          isAdmin={isAdmin}
          lang={lang}
          setLang={setLang}
          user={user}
          onOpenAuth={() => setIsAuthModalOpen(true)}
          onLogout={() => {
            signOut(auth).catch(() => {});
            setUser({
              isLoggedIn: false,
              name: '',
              email: '',
              avatar: '',
              provider: 'guest',
            });
          }}
          onLoadSample={handleLoadSample}
          onTestDownload={handleTestDownload}
          onOpenBgSettings={() => setIsBgModalOpen(true)}
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          isPaid={isPaid}
          onOpenPayment={() => setIsPaymentModalOpen(true)}
          onOpenSocinetNotice={() => setIsSocinetNoticeOpen(true)}
          onOpenLangModal={() => setIsLangModalOpen(true)}
        />
      </div>

      {/* Main Container + Right Sidebar (Live Viewer Stats + Total Visited + 300x250 Ads) */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-3 sm:px-6 py-4 sm:py-6 relative z-10 print-main-container">
        {activeTab === 'flow' && (
          <StepsProgressBar
            currentStep={currentStep}
            onSelectStep={handleNavigateStep}
            isStep1Ready={isStep1Ready}
            isPaid={isPaid}
            lang={lang}
          />
        )}
        <div className="flex flex-col lg:flex-row items-start justify-center gap-6">
          {/* Primary Content Column */}
          <div className="flex-1 min-w-0 w-full max-w-4xl">
            {activeTab === 'about' ? (
              <AboutMePage
                lang={lang}
                onStartApplication={() => {
                  setActiveTab('flow');
                  setCurrentStep(1);
                }}
                onOpenPayment={() => setIsPaymentModalOpen(true)}
              />
            ) : activeTab === 'guide' ? (
              <TopikKiipGuide
                lang={lang}
                onStartApplication={() => {
                  setActiveTab('flow');
                  setCurrentStep(1);
                }}
              />
            ) : (
              <div>
                {currentStep === 1 && (
                  <Step1Upload
                    docs={docs}
                    setDocs={setDocs}
                    formData={formData}
                    setFormData={setFormData}
                    extractedDraft={extractedOcrDraft}
                    setExtractedDraft={setExtractedOcrDraft}
                    onOcrCompleted={handleOcrCompleted}
                    lang={lang}
                    onNext={() => setCurrentStep(2)}
                    onOpenSocinetNotice={() => setIsSocinetNoticeOpen(true)}
                    isLoggedIn={user.isLoggedIn}
                    onOpenAuth={() => setIsAuthModalOpen(true)}
                  />
                )}

                {currentStep === 2 && (
                  <Step2OcrReview
                    lang={lang}
                    docs={docs}
                    draft={extractedOcrDraft}
                    setDraft={setExtractedOcrDraft}
                    initialSnapshot={ocrInitialSnapshot}
                    confidenceMap={ocrConfidenceMap}
                    initialConfidenceSnapshot={ocrInitialConfidenceSnapshot}
                    rawTextPreview={ocrRawText}
                    ocrModel={ocrModel}
                    isScanning={isRescanningOcr}
                    onRescanOcr={handleRescanOcrFromReview}
                    onBack={() => setCurrentStep(1)}
                    onConfirmInject={handleConfirmOcrInjection}
                  />
                )}

                {currentStep === 3 && (
                  <Step2FormTemplate
                    formData={formData}
                    setFormData={setFormData}
                    docs={docs}
                    setDocs={setDocs}
                    sigSettings={sigSettings}
                    setSigSettings={setSigSettings}
                    lang={lang}
                    onNext={() => setCurrentStep(4)}
                    onPrev={() => setCurrentStep(2)}
                    formRef={formRef}
                    isPaid={isPaid}
                    setIsPaid={setIsPaid}
                    onOpenPayment={() => setIsPaymentModalOpen(true)}
                    hasConfirmedOcrReview={hasConfirmedOcrReview}
                  />
                )}

                {currentStep === 4 && (
                  <Step3PdfPreview
                    formData={formData}
                    setFormData={setFormData}
                    docs={docs}
                    setDocs={setDocs}
                    sigSettings={sigSettings}
                    setSigSettings={setSigSettings}
                    lang={lang}
                    onNext={() => {
                      if (!isPaid) {
                        setPendingStepAfterPayment(5);
                        setIsPaymentModalOpen(true);
                      } else {
                        setCurrentStep(5);
                      }
                    }}
                    onPrev={() => setCurrentStep(3)}
                    formRef={formRef}
                    isPaid={isPaid}
                    setIsPaid={setIsPaid}
                    onOpenPayment={() => {
                      setPendingStepAfterPayment(null);
                      setIsPaymentModalOpen(true);
                    }}
                    autoDownloadTrigger={autoDownloadPdfTrigger}
                  />
                )}

                {currentStep === 5 && (
                  <Step4EmailSender
                    formData={formData}
                    lang={lang}
                    onPrev={() => setCurrentStep(4)}
                    onRestart={() => {
                      setIsPaid(false);
                      setCurrentStep(1);
                    }}
                  />
                )}
              </div>
            )}
          </div>

          {/* Right Sidebar: Live Viewer Stats, Total Visited Counter & 300x250 Ad Slot */}
          <RightAdsAndStatsSidebar lang={lang} />
        </div>
      </main>

      {/* Payment Checkout Modal (Non-closable & Non-skippable until paid) */}
      <PaymentModal
        isOpen={isPaymentModalOpen}
        onClose={() => {
          if (isPaid) {
            setIsPaymentModalOpen(false);
          }
        }}
        onPaymentSuccess={(options) => {
          setIsPaid(true);
          setIsPaymentModalOpen(false);
          if (options?.autoDownloadPdf) {
            setActiveTab('flow');
            setCurrentStep(4);
            setPendingStepAfterPayment(null);
            setAutoDownloadPdfTrigger((n) => n + 1);
            window.scrollTo({ top: 0, behavior: 'smooth' });
            return;
          }
          if (pendingStepAfterPayment === 5) {
            setCurrentStep(5);
            setPendingStepAfterPayment(null);
          }
        }}
        lang={lang}
        formData={formData}
        userEmail={user.isLoggedIn ? user.email : undefined}
      />

      {/* Auth Modal */}
      <AuthModal
        isOpen={isAuthModalOpen}
        onClose={() => setIsAuthModalOpen(false)}
        onLoginSuccess={(u) => setUser(u)}
        lang={lang}
      />

      {/* Background Settings Modal */}
      <BackgroundSettingsModal
        isOpen={isBgModalOpen}
        onClose={() => setIsBgModalOpen(false)}
        bgImage={bgImage}
        setBgImage={setBgImage}
        bgOpacity={bgOpacity}
        setBgOpacity={setBgOpacity}
        defaultBgUrl={DEFAULT_BG_URL}
        lang={lang}
      />

      {/* Socinet ID & Password Requirement Notice Modal */}
      <SocinetNoticeModal
        isOpen={isSocinetNoticeOpen}
        onClose={() => setIsSocinetNoticeOpen(false)}
        lang={lang}
      />

      {/* 50 Languages Search & Selector Modal */}
      <LanguageSelectorModal
        isOpen={isLangModalOpen}
        onClose={() => setIsLangModalOpen(false)}
        currentLang={lang}
        onSelectLang={(newLang) => setLang(newLang)}
      />

      {/* Admin Auth Modal */}
      <AdminAuthModal
        isOpen={isAdminAuthOpen}
        onClose={() => setIsAdminAuthOpen(false)}
        onSuccess={({ token, username }) => {
          setAdminToken(token);
          setAdminUsername(username);
          setIsAdminAuthOpen(false);
          setIsAdminDashboardOpen(true);
        }}
        lang={lang}
      />

      {/* Admin Dashboard Modal */}
      <AdminDashboard
        isOpen={isAdminDashboardOpen}
        onClose={() => setIsAdminDashboardOpen(false)}
        lang={lang}
        adminToken={adminToken}
        adminUsername={adminUsername}
        onAdminTokenRefreshed={(token, username) => {
          setAdminToken(token);
          if (username) setAdminUsername(username);
        }}
        onAdminSessionLogout={handleAdminLogout}
      />

      {/* Footer */}
      <footer className="bg-white/90 backdrop-blur-xs border-t border-slate-200 py-6 text-xs text-slate-500 relative z-10 no-print">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            <div className="flex items-center gap-2">
              <span className="font-bold text-slate-800">
                {t.footerTitle}
              </span>
              <span>·</span>
              <span>
                {t.footerSubtitle}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-3 text-slate-400 text-[11px]">
            <button
              type="button"
              onClick={() => {
                setActiveTab('about');
                window.scrollTo({ top: 0, behavior: 'smooth' });
              }}
              className="text-slate-600 hover:text-indigo-600 font-medium transition-colors cursor-pointer"
            >
              {lang === 'km' ? 'អំពីខ្ញុំ (About Me)' : lang === 'ko' ? '소개 (About Me)' : 'About Me'}
            </button>
            <span>·</span>
            <span>{t.footerIntegration}</span>
            <span>·</span>
            <span>{t.footerSupport}</span>
            <span>·</span>
            {isAdmin ? (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setIsAdminDashboardOpen(true)}
                  className="px-3 py-1 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl shadow-xs flex items-center gap-1.5 cursor-pointer transition-colors"
                >
                  <Shield className="w-3.5 h-3.5 text-amber-300" />
                  <span>⚙️ Admin Dashboard</span>
                </button>
                <button
                  type="button"
                  onClick={handleAdminLogout}
                  className="text-slate-400 hover:text-red-600 underline cursor-pointer text-[10px]"
                  title="Logout Admin"
                >
                  Logout
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setIsAdminAuthOpen(true)}
                className="text-slate-400 hover:text-slate-600 transition-colors flex items-center gap-1 cursor-pointer"
                title="Admin Access"
              >
                <Lock className="w-3 h-3" />
                <span>Admin</span>
              </button>
            )}
          </div>
        </div>
      </footer>
      {/* Floating Multi-Turn Website Navigation & Help Chatbot */}
      <WebsiteGuideChatbot
        lang={lang}
        activeTab={activeTab}
        currentStep={currentStep}
        isStep1Ready={isStep1Ready}
        missingStep1Items={missingStep1Items}
        isPaid={isPaid}
        onNavigateAction={handleGuideNavAction}
      />
    </div>
  );
}
