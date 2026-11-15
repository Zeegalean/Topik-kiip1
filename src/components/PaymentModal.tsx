import React, { useState, useEffect, useCallback } from 'react';
import QRCode from 'qrcode';
import {
  CreditCard,
  ShieldCheck,
  Lock,
  CheckCircle2,
  Sparkles,
  X,
  RefreshCw,
  QrCode,
  Zap,
  AlertCircle,
  Ticket,
  Gift,
  Check,
  Copy,
  ExternalLink,
  Clock,
  ArrowRight,
  Info,
} from 'lucide-react';
import confetti from 'canvas-confetti';
import { ApplicationFormData, Language } from '../types';
import { getTranslation } from '../utils/translations';

interface PaymentModalProps {
  isOpen: boolean;
  onClose: () => void;
  onPaymentSuccess: () => void;
  lang?: Language;
  formData?: ApplicationFormData;
}

export type PaymentMethod = 'khqr' | 'redeem' | 'card' | 'playstore' | 'appstore' | 'paypal';

const DEFAULT_PAYWAY_URL = 'https://link.payway.com.kh/ABAPAYzz552103m';
const QR_TTL_SECONDS = 15 * 60; // 15 minutes

function formatCountdown(totalSeconds: number): string {
  const clamped = Math.max(0, Math.floor(totalSeconds));
  const mins = Math.floor(clamped / 60);
  const secs = clamped % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export const PaymentModal: React.FC<PaymentModalProps> = ({
  isOpen,
  onClose,
  onPaymentSuccess,
  lang = 'km',
}) => {
  const t = getTranslation(lang);
  const [activeTab, setActiveTab] = useState<PaymentMethod>('khqr');
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingStep, setProcessingStep] = useState<string>('');
  const [isSuccess, setIsSuccess] = useState(false);

  // Dedicated Redeem / Promo Code State
  const [redeemPlatform, setRedeemPlatform] = useState<'promo' | 'voucher'>('promo');
  const [redeemCode, setRedeemCode] = useState('');
  const [redeemError, setRedeemError] = useState<string | null>(null);

  // Quick VIP Promo Code State
  const [promoCodeInput, setPromoCodeInput] = useState('');
  const [promoCodeError, setPromoCodeError] = useState<string | null>(null);
  const [promoCodeSuccess, setPromoCodeSuccess] = useState(false);

  // Dynamic ABA PayWay 15-Minute KHQR State
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState<string>('');
  const [transactionId, setTransactionId] = useState<string>('');
  const [paywayUrl, setPaywayUrl] = useState<string>(DEFAULT_PAYWAY_URL);
  const [qrGeneratedAt, setQrGeneratedAt] = useState<Date>(new Date());
  const [qrExpiresAt, setQrExpiresAt] = useState<number>(0);
  const [qrSecondsLeft, setQrSecondsLeft] = useState<number>(QR_TTL_SECONDS);
  const [abaHasMerchantApi, setAbaHasMerchantApi] = useState<boolean>(false);
  const [abaReferenceNote, setAbaReferenceNote] = useState<string>('');
  const [abaConfirmError, setAbaConfirmError] = useState<string | null>(null);
  const [isGeneratingQr, setIsGeneratingQr] = useState<boolean>(false);
  const [copiedTxId, setCopiedTxId] = useState(false);
  const [qrPayCount, setQrPayCount] = useState<number>(0);

  const isKm = lang === 'km';
  const isKo = lang === 'ko';

  const completeUnlock = useCallback(() => {
    try {
      localStorage.setItem('kiip_doc_paid_v3', 'true');
    } catch {
      // ignore
    }
    setIsProcessing(false);
    setIsSuccess(true);

    confetti({
      particleCount: 150,
      spread: 95,
      origin: { y: 0.5 },
    });

    setTimeout(() => {
      onPaymentSuccess();
    }, 1300);
  }, [onPaymentSuccess]);

  // Create fresh 15-minute ABA PayWay QR session
  const generateNewKhqr = useCallback(async () => {
    setIsGeneratingQr(true);
    setAbaConfirmError(null);

    const now = Date.now();
    let nextTxId = `KIIP-${String(now).slice(-5)}-${Math.random().toString(36).substring(2, 7).toUpperCase()}`;
    let nextExpiresAt = now + QR_TTL_SECONDS * 1000;
    let nextUrl = DEFAULT_PAYWAY_URL;
    let merchantApiEnabled = false;

    try {
      const resp = await fetch('/api/payments/aba-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      if (resp.ok) {
        const data = await resp.json();
        if (data?.success && data.txId) {
          nextTxId = data.txId;
          nextExpiresAt = Number(data.expiresAt) || nextExpiresAt;
          nextUrl = data.paywayUrl || DEFAULT_PAYWAY_URL;
          merchantApiEnabled = Boolean(data.hasMerchantApi);
        }
      }
    } catch {
      // Graceful fallback when running without backend server
    }

    try {
      const dataUrl = await QRCode.toDataURL(nextUrl, {
        width: 340,
        margin: 1,
        color: {
          dark: '#004f80',
          light: '#ffffff',
        },
        errorCorrectionLevel: 'M',
      });
      setQrCodeDataUrl(dataUrl);
      setTransactionId(nextTxId);
      setPaywayUrl(nextUrl);
      setQrGeneratedAt(new Date(now));
      setQrExpiresAt(nextExpiresAt);
      setQrSecondsLeft(Math.max(0, Math.ceil((nextExpiresAt - Date.now()) / 1000)));
      setAbaHasMerchantApi(merchantApiEnabled);
    } catch (err) {
      console.error('Failed to generate ABA PayWay QR:', err);
    } finally {
      setIsGeneratingQr(false);
    }
  }, []);

  // Generate QR on open when KHQR tab is active and no QR exists yet
  useEffect(() => {
    if (isOpen && activeTab === 'khqr' && !qrCodeDataUrl) {
      generateNewKhqr();
    }
  }, [isOpen, activeTab, qrCodeDataUrl, generateNewKhqr]);

  // Live 1-second countdown timer for the 15-minute ABA QR window
  useEffect(() => {
    if (!isOpen || !qrExpiresAt) return;

    const updateTimer = () => {
      const remaining = Math.max(0, Math.ceil((qrExpiresAt - Date.now()) / 1000));
      setQrSecondsLeft(remaining);
    };

    updateTimer();
    const timer = window.setInterval(updateTimer, 1000);
    return () => window.clearInterval(timer);
  }, [isOpen, qrExpiresAt]);

  // Auto-poll server status when ABA PayWay Merchant API + Webhook is enabled
  useEffect(() => {
    if (!isOpen || activeTab !== 'khqr' || !abaHasMerchantApi || !transactionId || qrSecondsLeft <= 0 || isSuccess) {
      return;
    }

    const poller = window.setInterval(async () => {
      try {
        const resp = await fetch(`/api/payments/aba-status/${encodeURIComponent(transactionId)}`);
        if (!resp.ok) return;
        const data = await resp.json();
        if (data?.status === 'paid') {
          setQrPayCount((prev) => prev + 1);
          completeUnlock();
        }
      } catch {
        // ignore transient polling error
      }
    }, 5000);

    return () => window.clearInterval(poller);
  }, [isOpen, activeTab, abaHasMerchantApi, transactionId, qrSecondsLeft, isSuccess, completeUnlock]);

  if (!isOpen) return null;

  const isQrExpired = qrExpiresAt > 0 && qrSecondsLeft <= 0;
  const isQrWarning = qrSecondsLeft > 0 && qrSecondsLeft <= 180;

  // Strict Promo / Redeem Code verification
  const verifyCodeAndUnlock = async (rawInput: string, source: 'promo' | 'redeem') => {
    const trimmed = rawInput.trim().toUpperCase();
    const setErr = source === 'promo' ? setPromoCodeError : setRedeemError;

    if (!trimmed) {
      setErr(
        isKm
          ? 'សូមបញ្ចូលលេខកូដ Promo / Redeem Code!'
          : isKo
          ? '코드를 입력해 주세요.'
          : 'Please enter a valid code!'
      );
      return;
    }

    setErr(null);
    setIsProcessing(true);
    setProcessingStep(
      isKm
        ? 'កំពុងផ្ទៀងផ្ទាត់លេខកូដជាមួយប្រព័ន្ធ...'
        : isKo
        ? '코드 유효성 확인 중...'
        : 'Verifying code...'
    );

    let verified = false;
    let serverErrorMsg: string | null = null;

    try {
      const resp = await fetch('/api/payments/verify-redeem', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: trimmed }),
      });
      const data = await resp.json().catch(() => ({}));
      if (resp.ok && data?.success) {
        verified = true;
      } else {
        serverErrorMsg = data?.error || null;
      }
    } catch {
      // Fallback for static/offline builds: strictly match known master promo codes only
      if (trimmed === '199621147' || trimmed === 'KIIP-199621147' || trimmed === 'PROMO-199621147') {
        verified = true;
      }
    }

    if (verified) {
      if (source === 'promo') {
        setPromoCodeSuccess(true);
        try {
          localStorage.setItem('kiip_promo_199621147', 'true');
        } catch {
          // ignore
        }
      }
      setProcessingStep(
        isKm
          ? '✓ លេខកូដត្រឹមត្រូវ! កំពុងដោះសោ Clean PDF...'
          : isKo
          ? '✓ 코드 확인 완료! Clean PDF 잠금 해제 중...'
          : '✓ Code verified! Unlocking Clean PDF...'
      );
      await new Promise((r) => setTimeout(r, 500));
      completeUnlock();
    } else {
      setIsProcessing(false);
      setErr(
        serverErrorMsg ||
          (isKm
            ? 'លេខកូដមិនត្រឹមត្រូវ! សូមពិនិត្យម្តងទៀត ឬបង់ប្រាក់តាម ABA PayWay។'
            : isKo
            ? '유효하지 않은 코드입니다. 다시 확인하거나 ABA PayWay로 결제해 주세요.'
            : 'Invalid code! Please check your code or pay via ABA PayWay.')
      );
    }
  };

  // Handle ABA PayWay confirmation inside the 15-minute QR window
  const handleConfirmAbaPayment = async () => {
    if (isQrExpired) {
      setAbaConfirmError(
        isKm
          ? 'QR Code ផុតសុពលភាព ១៥ នាទីហើយ! សូមចុច "🔄 បង្កើត QR ថ្មី" មុនពេលបង់ប្រាក់។'
          : isKo
          ? 'QR 코드 유효시간(15분)이 만료되었습니다. 새 QR을 생성해 주세요.'
          : 'This QR code expired after 15 minutes. Please generate a new QR code.'
      );
      return;
    }

    const ref = abaReferenceNote.trim();
    if (!abaHasMerchantApi && ref.length < 3) {
      setAbaConfirmError(
        isKm
          ? 'សូមបញ្ចូលឈ្មោះគណនីដែលបានបាញ់ប្រាក់ ឬលេខយោងវិក្កយបត្រ ABA (យ៉ាងតិច ៣ តួអក្សរ) មុននឹងចុចបញ្ជាក់។'
          : isKo
          ? '송금자명 또는 ABA 거래 참조번호(3자 이상)를 입력해 주세요.'
          : 'Please enter your ABA sender name or transfer reference (min 3 characters).'
      );
      return;
    }

    setAbaConfirmError(null);
    setIsProcessing(true);
    setProcessingStep(
      isKm
        ? `កំពុងផ្ទៀងផ្ទាត់ប្រតិបត្តិការ #${transactionId}...`
        : isKo
        ? `결제 세션 확인 중 (#${transactionId})...`
        : `Verifying transaction #${transactionId}...`
    );

    try {
      const resp = await fetch('/api/payments/aba-confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          txId: transactionId,
          referenceNote: ref,
        }),
      });
      const data = await resp.json().catch(() => ({}));

      if (!resp.ok || !data?.success) {
        if (data?.code === 'QR_EXPIRED') {
          setQrSecondsLeft(0);
          setQrExpiresAt(Date.now() - 1000);
        }
        setIsProcessing(false);
        setAbaConfirmError(
          data?.error ||
            (isKm
              ? 'មិនទាន់អាចបញ្ជាក់ការបង់ប្រាក់បានទេ។ សូមពិនិត្យម្តងទៀត!'
              : 'Unable to confirm payment yet. Please try again.')
        );
        return;
      }
    } catch {
      // Static fallback still enforces non-expired 15-min timer & reference note
      if (Date.now() >= qrExpiresAt) {
        setIsProcessing(false);
        setQrSecondsLeft(0);
        setAbaConfirmError(
          isKm
            ? 'QR Code ផុតសុពលភាព ១៥ នាទីហើយ! សូមចុច "🔄 បង្កើត QR ថ្មី"។'
            : 'QR code expired after 15 minutes.'
        );
        return;
      }
    }

    setProcessingStep(
      isKm
        ? '✓ បានបញ្ជាក់ការបង់ប្រាក់ ABA PayWay! កំពុងដោះសោ Clean PDF...'
        : isKo
        ? '✓ ABA 결제 확인 완료! Clean PDF 잠금 해제 중...'
        : '✓ Payment confirmed! Unlocking Clean PDF...'
    );
    await new Promise((r) => setTimeout(r, 600));
    setQrPayCount((prev) => prev + 1);
    completeUnlock();
  };

  return (
    <div className="fixed inset-0 z-[100000] bg-slate-950/75 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4">
      <div className="bg-white rounded-3xl max-w-2xl w-full max-h-[92vh] flex flex-col shadow-2xl border border-slate-200 overflow-hidden my-auto animate-in fade-in zoom-in-95 duration-200">
        {/* Modal Header */}
        <div className="shrink-0 bg-gradient-to-r from-slate-900 via-indigo-950 to-blue-950 text-white p-5 sm:p-6 relative">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-2 pr-8">
            <span className="bg-amber-400/20 text-amber-300 border border-amber-400/40 text-[11px] font-black px-2.5 py-0.5 rounded-full inline-flex items-center gap-1">
              <Sparkles className="w-3 h-3 text-amber-300" />
              <span>OFFICIAL UNLOCK · ₩15,000 (~$11.20)</span>
            </span>
            <span className="text-emerald-300 text-[11px] font-medium flex items-center gap-1">
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>ABA PayWay · Redeem Code</span>
            </span>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="absolute top-4 right-4 p-2 bg-white/10 hover:bg-white/20 rounded-xl text-white/80 hover:text-white transition-colors cursor-pointer"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>

          <h3 className="text-lg sm:text-2xl font-extrabold tracking-tight">
            {t.paymentModalTitle}
          </h3>
          <p className="text-xs sm:text-sm text-indigo-200 mt-1">
            {t.paymentModalSubtitle}
          </p>
        </div>

        {isSuccess ? (
          /* Success Screen */
          <div className="p-8 sm:p-10 text-center space-y-4">
            <div className="w-16 h-16 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center mx-auto shadow-lg shadow-emerald-200 animate-bounce">
              <CheckCircle2 className="w-9 h-9" />
            </div>
            <h4 className="text-2xl font-black text-slate-900">
              {t.successTitle}
            </h4>
            <p className="text-sm text-slate-600 max-w-md mx-auto leading-relaxed">
              {t.successDesc}
            </p>
            <div className="pt-2">
              <button
                type="button"
                onClick={onClose}
                className="px-6 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-sm shadow-lg shadow-emerald-900/20 inline-flex items-center gap-2 transition-all hover:scale-105 cursor-pointer"
              >
                <span>{t.downloadCleanNow}</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        ) : (
          <div className="p-5 sm:p-6 space-y-5 overflow-y-auto flex-1">
            {/* Order Summary Bar */}
            <div className="p-3.5 bg-slate-50 rounded-2xl border border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div className="space-y-0.5">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-slate-800">
                    {isKm
                      ? 'កញ្ចប់ឯកសារពេញលេញ (Full Merged PDF Packet)'
                      : isKo
                      ? '공식 서류 통합 패키지 (Full Merged PDF)'
                      : 'Full Official Merged PDF Package'}
                  </span>
                </div>
                <p className="text-[11px] text-slate-500">
                  {isKm
                    ? 'ពាក្យសុំផ្លូវការ + TOPIK 성적표 + កាត ARC មុខក្រោយ + Passport (Clean 100%)'
                    : isKo
                    ? '공식 신청서 + TOPIK 성적표 + 외국인등록증 앞뒤 + 여권'
                    : 'Official Form + TOPIK Report + ARC Front/Back + Passport'}
                </p>
              </div>

              <div className="flex items-baseline gap-2 sm:text-right shrink-0 tabular-nums">
                <span className="text-xs text-slate-400 line-through">₩30,000</span>
                <span className="text-2xl font-black text-blue-700">₩15,000</span>
                <span className="text-[10px] font-bold text-slate-500">(~ $11.20)</span>
              </div>
            </div>

            {/* VIP Promo Code Direct Unlock Section (Masked Password Field) */}
            <div className="p-4 bg-gradient-to-r from-purple-50 via-indigo-50 to-pink-50 border-2 border-purple-300 rounded-2xl space-y-2.5 shadow-xs">
              <div className="flex items-center gap-2">
                <span className="p-1.5 rounded-lg bg-purple-600 text-white shadow-2xs">
                  <Gift className="w-4 h-4" />
                </span>
                <div>
                  <span className="text-xs font-black text-purple-950 block">
                    {isKm
                      ? 'បញ្ចូល Promo Code ដើម្បីទាញយកដោយមិនបាច់បាញ់លុយ (100% Free)'
                      : isKo
                      ? '프로모션 코드로 100% 무료 잠금 해제'
                      : 'Enter Promo Code for 100% Free Download'}
                  </span>
                  <span className="text-[10.5px] text-purple-700">
                    {isKm
                      ? 'ប្រសិនបើមានលេខកូដ Promo Code សូមវាយបញ្ចូលខាងក្រោមដើម្បីដោះសោភ្លាមៗ'
                      : isKo
                      ? '보유하신 프로모션 코드를 입력하여 즉시 잠금 해제하세요'
                      : 'Enter your VIP promo code to unlock clean PDF'}
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-2 pt-1">
                <div className="relative flex-1">
                  <Ticket className="w-4 h-4 text-purple-500 absolute left-3 top-3" />
                  <input
                    type="password"
                    autoComplete="off"
                    value={promoCodeInput}
                    onChange={(e) => {
                      setPromoCodeInput(e.target.value);
                      setPromoCodeError(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        verifyCodeAndUnlock(promoCodeInput, 'promo');
                      }
                    }}
                    placeholder={isKm ? 'បញ្ចូលលេខកូដ Promo Code...' : 'Enter Promo Code...'}
                    className="w-full pl-9 pr-3 py-2.5 bg-white border border-purple-300 rounded-xl text-xs sm:text-sm font-mono font-bold tracking-wider text-purple-950 focus:outline-none focus:ring-2 focus:ring-purple-400 placeholder:font-sans placeholder:font-normal placeholder:text-slate-400"
                  />
                </div>
                <button
                  type="button"
                  disabled={isProcessing}
                  onClick={() => verifyCodeAndUnlock(promoCodeInput, 'promo')}
                  className="px-4 py-2.5 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 active:scale-95 text-white text-xs font-black rounded-xl shadow-md flex items-center gap-1.5 cursor-pointer shrink-0 transition-transform disabled:opacity-50"
                >
                  <Zap className="w-3.5 h-3.5 text-amber-300" />
                  <span>{isKm ? 'ដោះសោឥតគិតថ្លៃ' : isKo ? '무료 해제' : 'Apply Free'}</span>
                </button>
              </div>

              {promoCodeError && (
                <div className="p-2 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{promoCodeError}</span>
                </div>
              )}

              {promoCodeSuccess && (
                <div className="p-2 rounded-xl bg-emerald-50 border border-emerald-300 text-emerald-800 text-xs flex items-center gap-2 font-bold">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span>✓ កូដ Promo Code ត្រឹមត្រូវ! កំពុងដោះសោ Clean PDF...</span>
                </div>
              )}
            </div>

            {/* Payment Method Selector Tabs */}
            <div>
              <label className="text-xs font-bold text-slate-700 uppercase tracking-wider block mb-2.5">
                {t.paymentModalSubtitle}
              </label>
              <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                {/* 1. ABA PayWay (KHQR 15-min & Cards) */}
                <button
                  type="button"
                  onClick={() => setActiveTab('khqr')}
                  className={`p-2.5 rounded-2xl border text-center transition-all cursor-pointer flex flex-col items-center justify-center gap-1 relative ${
                    activeTab === 'khqr'
                      ? 'border-[#004f80] bg-sky-50 text-[#004f80] ring-2 ring-[#004f80]/20 font-bold shadow-xs'
                      : 'border-slate-200 bg-white hover:bg-slate-50 text-slate-700'
                  }`}
                >
                  <QrCode className="w-5 h-5 text-[#004f80]" />
                  <span className="text-[11px] font-bold">ABA PayWay</span>
                  <span className="text-[9px] text-[#004f80] font-bold">KHQR · 15m</span>
                </button>

                {/* 2. Credit Card (Visa / Master via ABA PayWay) */}
                <button
                  type="button"
                  onClick={() => setActiveTab('card')}
                  className={`p-2.5 rounded-2xl border text-center transition-all cursor-pointer flex flex-col items-center justify-center gap-1 ${
                    activeTab === 'card'
                      ? 'border-blue-600 bg-blue-50/80 text-blue-900 ring-2 ring-blue-500/20 font-bold shadow-xs'
                      : 'border-slate-200 bg-white hover:bg-slate-50 text-slate-700'
                  }`}
                >
                  <CreditCard className="w-5 h-5 text-blue-600" />
                  <span className="text-[11px] font-bold">Card</span>
                  <span className="text-[9px] text-slate-500">Visa · Master</span>
                </button>

                {/* 3. Redeem Code */}
                <button
                  type="button"
                  onClick={() => setActiveTab('redeem')}
                  className={`p-2.5 rounded-2xl border text-center transition-all cursor-pointer flex flex-col items-center justify-center gap-1 ${
                    activeTab === 'redeem'
                      ? 'border-purple-600 bg-purple-50 text-purple-900 ring-2 ring-purple-500/20 font-bold shadow-xs'
                      : 'border-slate-200 bg-white hover:bg-slate-50 text-slate-700'
                  }`}
                >
                  <Ticket className="w-5 h-5 text-purple-600" />
                  <span className="text-[11px] font-bold">Redeem</span>
                  <span className="text-[9px] text-purple-600 font-medium">Voucher Code</span>
                </button>

                {/* 4. Google Play Store */}
                <button
                  type="button"
                  onClick={() => setActiveTab('playstore')}
                  className={`p-2.5 rounded-2xl border text-center transition-all cursor-pointer flex flex-col items-center justify-center gap-1 ${
                    activeTab === 'playstore'
                      ? 'border-emerald-600 bg-emerald-50/80 text-emerald-950 ring-2 ring-emerald-500/20 font-bold shadow-xs'
                      : 'border-slate-200 bg-white hover:bg-slate-50 text-slate-700'
                  }`}
                >
                  <svg className="w-5 h-5 shrink-0" viewBox="0 0 24 24">
                    <path fill="#4285F4" d="M3.6 1.4L13.8 11.6 3.6 21.8C3.2 21.4 3 20.7 3 20V3.2C3 2.5 3.2 1.8 3.6 1.4z" />
                    <path fill="#34A853" d="M17.3 8.1L13.8 11.6 3.6 1.4C4.1 1.1 4.7 1.1 5.3 1.5l12 6.6z" />
                    <path fill="#EA4335" d="M17.3 15.1L5.3 21.7C4.7 22.1 4.1 22.1 3.6 21.8l10.2-10.2 3.5 3.5z" />
                    <path fill="#FBBC04" d="M21.2 10.3l-3.9-2.2-3.5 3.5 3.5 3.5 3.9-2.2c1.1-.6 1.1-1.6 0-2.6z" />
                  </svg>
                  <span className="text-[11px] font-bold">Play Store</span>
                  <span className="text-[9px] text-emerald-700 font-medium">Android App</span>
                </button>

                {/* 5. Apple App Store */}
                <button
                  type="button"
                  onClick={() => setActiveTab('appstore')}
                  className={`p-2.5 rounded-2xl border text-center transition-all cursor-pointer flex flex-col items-center justify-center gap-1 ${
                    activeTab === 'appstore'
                      ? 'border-slate-900 bg-slate-900 text-white ring-2 ring-slate-900/20 font-bold shadow-xs'
                      : 'border-slate-200 bg-white hover:bg-slate-50 text-slate-700'
                  }`}
                >
                  <svg className="w-5 h-5 shrink-0 fill-current" viewBox="0 0 24 24">
                    <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.81-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M15.97 6.37c.61-.75 1.04-1.8 0.92-2.87-.9.04-2 .6-2.64 1.35-.57.65-1.06 1.73-.93 2.76 1.02.08 2.04-.49 2.65-1.24z" />
                  </svg>
                  <span className="text-[11px] font-bold">App Store</span>
                  <span className={`text-[9px] ${activeTab === 'appstore' ? 'text-slate-300' : 'text-slate-500'}`}>iOS App</span>
                </button>

                {/* 6. PayPal / Direct Bank */}
                <button
                  type="button"
                  onClick={() => setActiveTab('paypal')}
                  className={`p-2.5 rounded-2xl border text-center transition-all cursor-pointer flex flex-col items-center justify-center gap-1 ${
                    activeTab === 'paypal'
                      ? 'border-indigo-600 bg-indigo-50/80 text-indigo-900 ring-2 ring-indigo-500/20 font-bold shadow-xs'
                      : 'border-slate-200 bg-white hover:bg-slate-50 text-slate-700'
                  }`}
                >
                  <div className="w-5 h-5 rounded-full bg-amber-500 flex items-center justify-center text-[10px] font-black text-white">
                    P
                  </div>
                  <span className="text-[11px] font-bold">PayPal</span>
                  <span className="text-[9px] text-slate-500">International</span>
                </button>
              </div>
            </div>

            {/* TAB 1: ABA PAYWAY MERCHANT & 15-MINUTE DYNAMIC QR */}
            {activeTab === 'khqr' && (
              <div className="space-y-4 text-center">
                {/* Header Info Banner with Live 15-Minute Countdown */}
                <div className="p-3.5 bg-gradient-to-r from-sky-50 via-blue-50 to-indigo-50 rounded-2xl border border-sky-200 text-left flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-2xs">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="bg-[#004f80] text-white text-[10px] font-black px-2 py-0.5 rounded-md tracking-wider">
                        ABA PayWay
                      </span>
                      <span className="text-xs text-[#003d63] font-bold">
                        {isKm
                          ? 'បង់ផ្ទាល់ចូល ABA Bank (សុពលភាព ១៥ នាទី)'
                          : isKo
                          ? 'ABA Bank 직접 결제 (유효시간 15분)'
                          : 'Direct ABA Bank Payment (15-Min Session)'}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-600 mt-1">
                      {isKm
                        ? 'គាំទ្រ ABA PAY, KHQR គ្រប់ធនាគារ និងកាត Visa, MasterCard, JCB, UnionPay ($11.20 / ~₩15,000)។'
                        : isKo
                        ? 'ABA PAY, KHQR 및 해외 카드(Visa, Master, UnionPay, JCB) 지원.'
                        : 'Supports ABA PAY, KHQR, Visa, MasterCard, JCB, UnionPay.'}
                    </p>
                  </div>

                  {/* Live 15:00 Countdown Pill */}
                  <div
                    className={`px-3 py-2 rounded-xl border shrink-0 flex items-center gap-2 tabular-nums ${
                      isQrExpired
                        ? 'bg-rose-50 border-rose-300 text-rose-800'
                        : isQrWarning
                        ? 'bg-amber-50 border-amber-300 text-amber-900'
                        : 'bg-white border-sky-300 text-[#004f80]'
                    }`}
                  >
                    <Clock className="w-4 h-4 shrink-0" />
                    <div className="text-left">
                      <span className="text-[10px] font-bold block leading-none opacity-80">
                        {isQrExpired
                          ? isKm
                            ? 'ផុតសុពលភាព'
                            : 'Expired'
                          : isKm
                          ? 'សុពលភាព QR'
                          : isKo
                          ? '남은 시간'
                          : 'Expires in'}
                      </span>
                      <span className="font-mono font-black text-sm leading-tight">
                        {formatCountdown(qrSecondsLeft)}
                      </span>
                    </div>
                  </div>
                </div>

                {/* 1-Click Direct Online Payment Link */}
                <a
                  href={paywayUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full py-3.5 px-4 rounded-2xl bg-gradient-to-r from-[#004f80] via-[#005f99] to-[#0074b7] hover:from-[#003d63] hover:to-[#005f99] text-white font-extrabold text-sm shadow-lg shadow-sky-900/25 flex items-center justify-center gap-2.5 transition-all hover:scale-[1.01] border border-sky-400/30 cursor-pointer"
                >
                  <CreditCard className="w-4 h-4 text-sky-200 shrink-0" />
                  <span>
                    {isKm
                      ? 'ចុចបង់ប្រាក់តាម ABA PayWay (បើកផ្ទាំងបង់ប្រាក់ផ្ទាល់)'
                      : isKo
                      ? 'ABA PayWay 온라인 결제 페이지 열기'
                      : 'Open ABA PayWay Checkout'}
                  </span>
                  <ExternalLink className="w-4 h-4 text-sky-200 shrink-0" />
                </a>

                {/* Dynamic QR Card Frame with 15-Min Expiry Overlay */}
                <div className="max-w-[300px] mx-auto bg-white p-4 rounded-3xl border-2 border-[#004f80]/40 shadow-xl relative overflow-hidden">
                  <div className="bg-[#004f80] -mx-4 -mt-4 py-2 px-4 text-white flex items-center justify-between mb-3 shadow-xs">
                    <span className="font-black text-xs tracking-wider">ABA PayWay</span>
                    <span className="text-[10px] font-mono font-bold bg-white/20 px-2 py-0.5 rounded-full tabular-nums">
                      $11.20 · {formatCountdown(qrSecondsLeft)}
                    </span>
                  </div>

                  {/* QR Image Container */}
                  <div className="relative p-2 bg-white rounded-2xl border border-slate-200 flex items-center justify-center overflow-hidden">
                    {isGeneratingQr ? (
                      <div className="w-52 h-52 flex flex-col items-center justify-center gap-2 text-slate-400">
                        <RefreshCw className="w-8 h-8 animate-spin text-[#004f80]" />
                        <span className="text-xs font-bold text-slate-600">
                          {isKm ? 'កំពុងបង្កើត QR ថ្មី...' : 'Generating QR...'}
                        </span>
                      </div>
                    ) : qrCodeDataUrl ? (
                      <div className="relative">
                        <img
                          src={qrCodeDataUrl}
                          alt="ABA PayWay Dynamic QR Code"
                          className={`w-52 h-52 object-contain mx-auto transition-all ${
                            isQrExpired ? 'blur-md opacity-30 grayscale' : ''
                          }`}
                        />
                        {!isQrExpired && (
                          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                            <div className="w-9 h-9 rounded-full bg-[#004f80] shadow-md border-2 border-white flex items-center justify-center">
                              <span className="text-[10px] font-black text-white">ABA</span>
                            </div>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="w-52 h-52 flex items-center justify-center">
                        <QrCode className="w-32 h-32 text-slate-300" />
                      </div>
                    )}

                    {/* Expired 15-min Overlay Lock */}
                    {isQrExpired && !isGeneratingQr && (
                      <div className="absolute inset-0 bg-slate-900/70 backdrop-blur-[2px] flex flex-col items-center justify-center p-4 text-white gap-2.5">
                        <Clock className="w-8 h-8 text-rose-400" />
                        <p className="text-xs font-black text-center leading-snug">
                          {isKm
                            ? 'QR ផុតសុពលភាពហើយ (ហួស ១៥ នាទី)'
                            : isKo
                            ? 'QR 코드가 만료되었습니다 (15분 초과)'
                            : 'QR Code Expired (15 Minutes)'}
                        </p>
                        <button
                          type="button"
                          onClick={() => generateNewKhqr()}
                          className="px-3.5 py-2 rounded-xl bg-white text-[#004f80] font-black text-xs flex items-center gap-1.5 shadow-md hover:bg-sky-50 cursor-pointer"
                        >
                          <RefreshCw className="w-3.5 h-3.5" />
                          <span>{isKm ? 'បង្កើត QR ថ្មី (15:00)' : 'New QR (15:00)'}</span>
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Merchant & Transaction Details */}
                  <div className="mt-3 pt-2 border-t border-dashed border-slate-200 text-left space-y-1">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-slate-500">អ្នកទទួល (Merchant):</span>
                      <span className="font-black text-slate-900 tracking-wide">Delivery by V.EANG</span>
                    </div>
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-slate-500">ធនាគារ (Bank):</span>
                      <span className="font-extrabold text-[#004f80] tabular-nums">ABA Bank (000 375 987)</span>
                    </div>
                    <div className="flex items-center justify-between text-[11px] pt-0.5">
                      <span className="text-slate-500">លេខវិក្កយបត្រ (Tx ID):</span>
                      <div className="flex items-center gap-1 font-mono font-bold text-[#004f80] text-[10.5px]">
                        <span>{transactionId || 'KIIP-PENDING'}</span>
                        <button
                          type="button"
                          onClick={() => {
                            navigator.clipboard.writeText(transactionId);
                            setCopiedTxId(true);
                            setTimeout(() => setCopiedTxId(false), 2000);
                          }}
                          className="p-0.5 rounded text-slate-400 hover:text-slate-700 cursor-pointer"
                          title="Copy Transaction ID"
                        >
                          {copiedTxId ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3" />}
                        </button>
                      </div>
                    </div>
                    <div className="flex items-center justify-between text-[10px] text-slate-400 pt-0.5 tabular-nums">
                      <span>បង្កើតម៉ោង: {qrGeneratedAt.toLocaleTimeString()}</span>
                      <span className={`font-bold ${isQrExpired ? 'text-rose-600' : 'text-emerald-600'}`}>
                        {isQrExpired ? '● ផុតកំណត់' : `● Active #${qrPayCount + 1}`}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Receipt Reference / Sender Name Input (required in Link mode within 15-min window) */}
                {!abaHasMerchantApi && (
                  <div className="max-w-md mx-auto text-left space-y-1.5">
                    <label className="text-xs font-bold text-slate-700 block">
                      {isKm
                        ? 'ឈ្មោះគណនីដែលបានបាញ់ប្រាក់ ឬ លេខយោង ABA Slip (Ref):'
                        : isKo
                        ? '송금자명 또는 ABA 이체 참조번호:'
                        : 'ABA Sender Name or Transfer Ref:'}
                    </label>
                    <input
                      type="text"
                      value={abaReferenceNote}
                      onChange={(e) => {
                        setAbaReferenceNote(e.target.value);
                        setAbaConfirmError(null);
                      }}
                      placeholder={
                        isKm
                          ? 'ឧ. SOK SRORNG ឬ លេខយោងវិក្កយបត្រ ABA...'
                          : 'e.g. Sender name or ABA receipt number...'
                      }
                      className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-xs sm:text-sm font-semibold text-slate-900 focus:border-[#004f80] focus:ring-2 focus:ring-sky-100 outline-none"
                    />
                  </div>
                )}

                {abaConfirmError && (
                  <div className="max-w-md mx-auto p-2.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-center gap-2 text-left">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    <span>{abaConfirmError}</span>
                  </div>
                )}

                {/* Quick Action Buttons */}
                <div className="flex items-center justify-center gap-2 max-w-md mx-auto">
                  <button
                    type="button"
                    onClick={() => generateNewKhqr()}
                    disabled={isGeneratingQr || isProcessing}
                    className="px-3.5 py-3 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs flex items-center gap-1.5 transition-all cursor-pointer border border-slate-300 shadow-2xs disabled:opacity-50 shrink-0"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 text-blue-600 ${isGeneratingQr ? 'animate-spin' : ''}`} />
                    <span>{isKm ? 'បង្កើត QR ថ្មី' : 'New QR'}</span>
                  </button>

                  <button
                    type="button"
                    disabled={isProcessing || isQrExpired}
                    onClick={handleConfirmAbaPayment}
                    className="flex-1 py-3 px-4 bg-gradient-to-r from-[#004f80] to-[#0074b7] hover:from-[#003d63] hover:to-[#005f99] text-white font-extrabold text-xs sm:text-sm rounded-xl shadow-md shadow-sky-900/20 flex items-center justify-center gap-2 transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isProcessing ? (
                      <>
                        <RefreshCw className="w-4 h-4 animate-spin" />
                        <span className="truncate">{processingStep}</span>
                      </>
                    ) : (
                      <>
                        <CheckCircle2 className="w-4 h-4 text-emerald-300 shrink-0" />
                        <span>
                          {abaHasMerchantApi
                            ? isKm
                              ? 'ពិនិត្យស្ថានភាពបង់ប្រាក់ ABA'
                              : 'Verify ABA Payment'
                            : isKm
                            ? '✓ ខ្ញុំបានបង់ប្រាក់រួចហើយ'
                            : isKo
                            ? '결제 완료 및 잠금 해제'
                            : 'I Have Completed Payment'}
                        </span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            )}

            {/* TAB 2: CREDIT CARD (VIA ABA PAYWAY INTERNATIONAL CARDS) */}
            {activeTab === 'card' && (
              <div className="space-y-4">
                <div className="p-4 rounded-2xl bg-slate-900 text-white space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-sky-300 uppercase tracking-wider">
                      ABA PayWay Card Gateway
                    </span>
                    <span className="text-xs font-bold text-white/80">Visa · Master · JCB · UnionPay</span>
                  </div>
                  <p className="text-xs text-slate-300 leading-relaxed">
                    {isKm
                      ? 'ការបង់ប្រាក់តាមកាតធនាគារអន្តរជាតិ (Visa, MasterCard, UnionPay, JCB) ទាំងអស់ត្រូវបានដំណើរការដោយសុវត្ថិភាពតាមរយៈប្រព័ន្ធផ្លូវការ ABA PayWay ហើយប្រាក់នឹងចូលគណនី ABA Bank (Delivery by V.EANG) ដោយផ្ទាល់។'
                      : isKo
                      ? '해외 카드(Visa, MasterCard, JCB, UnionPay) 결제는 ABA PayWay 공식 보안 게이트웨이를 통해 안전하게 처리됩니다.'
                      : 'International Visa, MasterCard, JCB, and UnionPay payments are processed securely through ABA PayWay directly to Delivery by V.EANG.'}
                  </p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <a
                    href={paywayUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="py-3.5 px-4 rounded-2xl bg-gradient-to-r from-[#004f80] to-[#0074b7] hover:from-[#003d63] hover:to-[#005f99] text-white font-extrabold text-xs sm:text-sm shadow-lg flex items-center justify-center gap-2 transition-all"
                  >
                    <CreditCard className="w-4 h-4 shrink-0" />
                    <span>{isKm ? 'បង់តាមកាតលើ ABA PayWay' : 'Pay by Card on ABA PayWay'}</span>
                    <ExternalLink className="w-3.5 h-3.5 shrink-0" />
                  </a>

                  <button
                    type="button"
                    onClick={() => setActiveTab('khqr')}
                    className="py-3.5 px-4 rounded-2xl bg-slate-100 hover:bg-slate-200 text-slate-900 font-bold text-xs sm:text-sm border border-slate-300 flex items-center justify-center gap-2 cursor-pointer transition-colors"
                  >
                    <QrCode className="w-4 h-4 text-[#004f80]" />
                    <span>{isKm ? 'បញ្ជាក់ការបង់ប្រាក់ & QR ១៥ នាទី' : 'Go to ABA Confirm & 15m QR'}</span>
                  </button>
                </div>
              </div>
            )}

            {/* TAB 3: STRICT REDEEM / VOUCHER CODE */}
            {activeTab === 'redeem' && (
              <div className="space-y-4">
                <div className="p-4 bg-gradient-to-r from-purple-50 via-indigo-50 to-pink-50 rounded-2xl border border-purple-200 space-y-2">
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-xl bg-purple-600 text-white flex items-center justify-center shrink-0 shadow-xs">
                      <Ticket className="w-4 h-4" />
                    </div>
                    <div>
                      <h4 className="text-xs sm:text-sm font-black text-purple-950">
                        {isKm ? 'លេខកូដដោះសោ (Redeem / Voucher Code)' : 'Redeem / Voucher Code'}
                      </h4>
                      <p className="text-[11px] text-purple-700">
                        {isKm
                          ? 'សម្រាប់អតិថិជនដែលបានបាញ់ប្រាក់ជូន Admin (ABA / KakaoBank / ផ្ទាល់) ឬមានលេខកូដ VIP Promo'
                          : isKo
                          ? '관리자에게 직접 결제 후 발급받은 일회용 코드 또는 프로모션 코드를 입력하세요'
                          : 'Enter an admin-issued single-use voucher or VIP promo code'}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Type selector */}
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setRedeemPlatform('promo');
                      setRedeemError(null);
                    }}
                    className={`p-2.5 rounded-xl border text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                      redeemPlatform === 'promo'
                        ? 'border-purple-600 bg-purple-50 text-purple-900 ring-2 ring-purple-500/20'
                        : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    <Gift className="w-4 h-4 text-purple-600 shrink-0" />
                    <span>VIP Promo Code</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setRedeemPlatform('voucher');
                      setRedeemError(null);
                    }}
                    className={`p-2.5 rounded-xl border text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                      redeemPlatform === 'voucher'
                        ? 'border-indigo-600 bg-indigo-50 text-indigo-900 ring-2 ring-indigo-500/20'
                        : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    <Ticket className="w-4 h-4 text-indigo-600 shrink-0" />
                    <span>1-Time Voucher</span>
                  </button>
                </div>

                <div>
                  <label className="text-xs font-bold text-slate-700 block mb-1">
                    {isKm ? 'វាយបញ្ចូលលេខកូដដោះសោ៖' : isKo ? '코드 입력:' : 'Enter Code:'}
                  </label>
                  <div className="relative">
                    <Ticket className="w-4 h-4 text-purple-500 absolute left-3 top-3.5" />
                    <input
                      type="password"
                      autoComplete="off"
                      value={redeemCode}
                      onChange={(e) => {
                        setRedeemCode(e.target.value.toUpperCase());
                        setRedeemError(null);
                      }}
                      placeholder="••••••••"
                      className="w-full pl-9 pr-20 py-3 rounded-xl border border-slate-300 text-sm font-mono tracking-wider font-bold uppercase focus:border-purple-600 focus:ring-2 focus:ring-purple-100 outline-none"
                    />
                    {redeemCode && (
                      <button
                        type="button"
                        onClick={() => setRedeemCode('')}
                        className="absolute right-3 top-3 text-xs text-slate-400 hover:text-slate-600 px-2 py-0.5 rounded cursor-pointer"
                      >
                        {t.clearBtn}
                      </button>
                    )}
                  </div>

                  {redeemError && (
                    <div className="mt-2 p-2.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-center gap-2">
                      <AlertCircle className="w-4 h-4 shrink-0" />
                      <span>{redeemError}</span>
                    </div>
                  )}
                </div>

                <div className="flex flex-col sm:flex-row gap-2.5">
                  <button
                    type="button"
                    disabled={isProcessing}
                    onClick={() => verifyCodeAndUnlock(redeemCode, 'redeem')}
                    className="flex-1 py-3.5 bg-gradient-to-r from-purple-600 via-indigo-600 to-purple-700 hover:from-purple-700 hover:to-indigo-700 text-white font-black text-sm rounded-2xl shadow-lg flex items-center justify-center gap-2 transition-all cursor-pointer disabled:opacity-60"
                  >
                    {isProcessing ? (
                      <>
                        <RefreshCw className="w-4 h-4 animate-spin text-white" />
                        <span>{processingStep}</span>
                      </>
                    ) : (
                      <>
                        <Ticket className="w-4 h-4 text-white" />
                        <span>{isKm ? 'ផ្ទៀងផ្ទាត់លេខកូដ & ដោះសោ' : 'Verify & Unlock'}</span>
                      </>
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={() => setActiveTab('khqr')}
                    className="px-4 py-3.5 rounded-2xl bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold text-xs border border-slate-300 cursor-pointer"
                  >
                    {isKm ? 'គ្មានកូដ? បង់តាម ABA' : 'Pay via ABA'}
                  </button>
                </div>
              </div>
            )}

            {/* TAB 4 & 5: GOOGLE PLAY STORE / APPLE APP STORE NOTICE */}
            {(activeTab === 'playstore' || activeTab === 'appstore') && (
              <div className="space-y-4">
                <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 space-y-2.5 text-left">
                  <div className="flex items-start gap-2.5">
                    <Info className="w-5 h-5 text-blue-600 shrink-0 mt-0.5" />
                    <div className="space-y-1.5 text-xs text-slate-700 leading-relaxed">
                      <p className="font-bold text-slate-900 text-sm">
                        {activeTab === 'playstore'
                          ? isKm
                            ? 'ការទូទាត់តាម Google Play Store (សម្រាប់ Android App)'
                            : 'Google Play Store In-App Billing'
                          : isKm
                          ? 'ការទូទាត់តាម Apple App Store (សម្រាប់ iOS App)'
                          : 'Apple App Store In-App Purchase'}
                      </p>
                      <p>
                        {activeTab === 'playstore'
                          ? isKm
                            ? 'ការទូទាត់តាម Google Play Store និង Google Play Gift Card ដំណើរការតែនៅក្នុងកម្មវិធី Android App ដែលបានបង្ហោះលើ Google Play Console ប៉ុណ្ណោះ (លុយនឹងផ្ទេរចូលគណនីធនាគារដែលភ្ជាប់ក្នុង Google Play Console)។ នៅលើ Website បច្ចុប្បន្ន សូមប្រើ ABA PayWay ឬលេខកូដ Redeem Code។'
                            : 'Google Play In-App Billing & Gift Cards only process inside an Android app published via Google Play Console. On web, please use ABA PayWay or an issued Redeem Code.'
                          : isKm
                          ? 'ការទូទាត់តាម Apple App Store (Apple In-App Purchase) ដំណើរការតែនៅក្នុងកម្មវិធី iOS App ដែលបានបង្ហោះលើ App Store Connect ប៉ុណ្ណោះ (លុយនឹងផ្ទេរចូលគណនីធនាគារក្នុង App Store Connect)។ នៅលើ Website បច្ចុប្បន្ន សូមប្រើ ABA PayWay (គាំទ្រ Visa/MasterCard) ឬលេខកូដ Redeem Code។'
                          : 'Apple App Store In-App Purchase only processes inside an iOS app published on App Store Connect. On web, please pay via ABA PayWay or Redeem Code.'}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setActiveTab('khqr')}
                    className="py-3.5 px-4 rounded-2xl bg-gradient-to-r from-[#004f80] to-[#0074b7] hover:from-[#003d63] hover:to-[#005f99] text-white font-extrabold text-xs sm:text-sm shadow-md flex items-center justify-center gap-2 cursor-pointer"
                  >
                    <QrCode className="w-4 h-4" />
                    <span>{isKm ? 'បង់តាម ABA PayWay (១៥ នាទី)' : 'Pay via ABA PayWay (15m)'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setActiveTab('redeem')}
                    className="py-3.5 px-4 rounded-2xl bg-purple-50 hover:bg-purple-100 text-purple-900 font-bold text-xs sm:text-sm border border-purple-200 flex items-center justify-center gap-2 cursor-pointer"
                  >
                    <Ticket className="w-4 h-4 text-purple-600" />
                    <span>{isKm ? 'បញ្ចូល Redeem / Promo Code' : 'Enter Redeem / Promo Code'}</span>
                  </button>
                </div>
              </div>
            )}

            {/* TAB 6: PAYPAL / INTERNATIONAL */}
            {activeTab === 'paypal' && (
              <div className="space-y-4">
                <div className="p-4 rounded-2xl bg-amber-50 border border-amber-200 space-y-2 text-left">
                  <div className="flex items-center gap-2">
                    <span className="w-6 h-6 rounded-full bg-amber-500 text-white font-black text-xs flex items-center justify-center">
                      P
                    </span>
                    <span className="text-xs font-bold text-amber-950">
                      International Cards &amp; ABA PayWay ($11.20 USD)
                    </span>
                  </div>
                  <p className="text-xs text-amber-900 leading-relaxed">
                    {isKm
                      ? 'សម្រាប់ការទូទាត់អន្តរជាតិ (ក្រៅប្រទេសឬនៅកូរ៉េ) អ្នកអាចបង់ជាប្រាក់ដុល្លារ ($11.20) តាមរយៈ ABA PayWay ដែលទទួលស្គាល់កាត Visa, MasterCard, JCB, UnionPay គ្រប់ប្រទេស ដោយលុយចូលគណនី ABA Bank របស់ម្ចាស់កម្មវិធីផ្ទាល់។'
                      : 'International payments ($11.20 USD) are supported directly via ABA PayWay with Visa, MasterCard, JCB, and UnionPay.'}
                  </p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <a
                    href={paywayUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="py-3.5 px-4 rounded-2xl bg-[#004f80] hover:bg-[#003d63] text-white font-extrabold text-xs sm:text-sm shadow-md flex items-center justify-center gap-2"
                  >
                    <CreditCard className="w-4 h-4" />
                    <span>{isKm ? 'បើក ABA PayWay ($11.20)' : 'Open ABA PayWay ($11.20)'}</span>
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>

                  <button
                    type="button"
                    onClick={() => setActiveTab('khqr')}
                    className="py-3.5 px-4 rounded-2xl bg-slate-100 hover:bg-slate-200 text-slate-900 font-bold text-xs sm:text-sm border border-slate-300 flex items-center justify-center gap-2 cursor-pointer"
                  >
                    <QrCode className="w-4 h-4 text-[#004f80]" />
                    <span>{isKm ? 'ស្កេន ABA QR (សុពលភាព ១៥ នាទី)' : 'Scan 15m ABA QR'}</span>
                  </button>
                </div>
              </div>
            )}

            {/* Guarantees & Features */}
            <div className="pt-2 border-t border-slate-100 grid grid-cols-2 sm:grid-cols-3 gap-2 text-[10px] sm:text-[11px] text-slate-600 font-medium">
              <div className="flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                <span>{t.instantUnlock}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                <span>{t.safeGuaranteed}</span>
              </div>
              <div className="flex items-center gap-1.5 col-span-2 sm:col-span-1">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                <span>
                  {isKm
                    ? 'អាចទាញយកឡើងវិញបានគ្រប់ពេល'
                    : isKo
                    ? '언제든 재다운로드 가능'
                    : 'Can re-download anytime'}
                </span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
