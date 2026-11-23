import React, { useState, useEffect, useCallback } from 'react';
import {
  CreditCard,
  ShieldCheck,
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
  Upload,
  Send,
  Landmark,
  Camera,
  MessageCircle,
  Ban,
} from 'lucide-react';
import confetti from 'canvas-confetti';
import { ApplicationFormData, Language } from '../types';
import { getTranslation } from '../utils/translations';
import { recordPaymentTransaction, verifyAndRedeemFirestorePromo } from '../utils/firebase';

interface PaymentModalProps {
  isOpen: boolean;
  onClose: () => void;
  onPaymentSuccess: () => void;
  lang?: Language;
  formData?: ApplicationFormData;
  userEmail?: string;
}

export type PaymentMethod = 'khqr' | 'krbank' | 'redeem' | 'card' | 'playstore' | 'appstore' | 'paypal';

const ABA_QR_IMAGE_PATH = '/assets/aistudio/0449fea2-443c-4ed7-85cb-ecef094a216e_17842712.jfif';
const ABA_ACCOUNT_HOLDER = 'EANG VEASNA';
const ABA_ACCOUNT_NUMBER = '000 375 987';
const ABA_ACCOUNT_RAW = '000375987';
const ABA_MID = '121092113090045';
const FACEBOOK_PAGE_URL = 'https://www.facebook.com/eang.veasna.667/';
const KAKAOTALK_ID = '9111veasna';

const DEFAULT_KR_CONFIG = {
  bankName: 'KOOKMIN BANK (KB 국민은행)',
  accountNumber: '893801-00-097236',
  accountHolder: 'EANG VEASNA',
  telegramBotUsername: '',
  amountKrw: 35000,
  autoReceiptVerifyEnabled: true,
  telegramBotEnabled: false,
};

export const PaymentModal: React.FC<PaymentModalProps> = ({
  isOpen,
  onClose,
  onPaymentSuccess,
  lang = 'km',
  userEmail,
}) => {
  const t = getTranslation(lang);
  const [activeTab, setActiveTab] = useState<'khqr' | 'krbank' | 'redeem'>('krbank');
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingStep, setProcessingStep] = useState<string>('');
  const [isSuccess, setIsSuccess] = useState(false);

  // Dedicated Redeem / Promo Code State
  const [redeemPlatform, setRedeemPlatform] = useState<'voucher' | 'promo'>('voucher');
  const [redeemCode, setRedeemCode] = useState('');
  const [redeemError, setRedeemError] = useState<string | null>(null);

  // Quick Redeem / Promo Code State (top bar)
  const [promoCodeInput, setPromoCodeInput] = useState('');
  const [promoCodeError, setPromoCodeError] = useState<string | null>(null);
  const [promoCodeSuccess, setPromoCodeSuccess] = useState(false);

  // Copy states
  const [copiedAbaAccount, setCopiedAbaAccount] = useState(false);
  const [copiedKrAccount, setCopiedKrAccount] = useState(false);
  const [copiedKakao, setCopiedKakao] = useState(false);
  const [copiedKrCode, setCopiedKrCode] = useState(false);

  // Korea Bank Transfer & Telegram Bot Config (always pre-populated with user's Kookmin Bank account)
  const [krConfig, setKrConfig] = useState(DEFAULT_KR_CONFIG);
  const [krConfigLoaded, setKrConfigLoaded] = useState(false);

  // Korea Bank Screenshot Auto-Verify State
  const [receiptPreview, setReceiptPreview] = useState<string | null>(null);
  const [verifyingReceipt, setVerifyingReceipt] = useState(false);
  const [receiptError, setReceiptError] = useState<string | null>(null);
  const [issuedKrCode, setIssuedKrCode] = useState<{
    code: string;
    bankName: string;
    verifiedAmount: number;
  } | null>(null);

  const isKm = lang === 'km';
  const isKo = lang === 'ko';

  const [successSecondsLeft, setSuccessSecondsLeft] = useState<number>(30);

  const completeUnlock = useCallback(() => {
    try {
      localStorage.setItem('kiip_doc_paid_v3', 'true');
    } catch {
      // ignore
    }
    setIsProcessing(false);
    setIsSuccess(true);
    setSuccessSecondsLeft(30);

    confetti({
      particleCount: 150,
      spread: 95,
      origin: { y: 0.5 },
    });
  }, []);

  // 30-second countdown timer for saving/downloading on mobile before auto-advancing to Step 4
  useEffect(() => {
    if (!isOpen || !isSuccess) return;

    const timer = window.setInterval(() => {
      setSuccessSecondsLeft((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          onPaymentSuccess();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => window.clearInterval(timer);
  }, [isOpen, isSuccess, onPaymentSuccess]);

  // Fetch server Korea Bank & Telegram Bot configuration (merges cleanly over defaults)
  useEffect(() => {
    if (!isOpen || krConfigLoaded) return;
    let mounted = true;
    fetch('/api/payments/kr-config')
      .then((r) => r.json())
      .then((data) => {
        if (mounted && data?.success) {
          setKrConfig({
            bankName: String(data.bankName || DEFAULT_KR_CONFIG.bankName),
            accountNumber: String(data.accountNumber || DEFAULT_KR_CONFIG.accountNumber),
            accountHolder: String(data.accountHolder || DEFAULT_KR_CONFIG.accountHolder),
            telegramBotUsername: String(data.telegramBotUsername || ''),
            amountKrw: Number(data.amountKrw) || 35000,
            autoReceiptVerifyEnabled: Boolean(data.autoReceiptVerifyEnabled),
            telegramBotEnabled: Boolean(data.telegramBotEnabled),
          });
          setKrConfigLoaded(true);
        }
      })
      .catch(() => {
        if (mounted) setKrConfigLoaded(true);
      });
    return () => {
      mounted = false;
    };
  }, [isOpen, krConfigLoaded]);

  if (!isOpen) return null;

  const copyText = (text: string, setter: (v: boolean) => void) => {
    try {
      navigator.clipboard.writeText(text);
      setter(true);
      setTimeout(() => setter(false), 2000);
    } catch {
      // ignore clipboard errors
    }
  };

  // Strict Promo / Redeem Code verification (Server SQLite DB + Firestore /promoCodes/{CODE})
  const verifyCodeAndUnlock = async (rawInput: string, source: 'promo' | 'redeem') => {
    const trimmed = rawInput.trim().toUpperCase();
    const setErr = source === 'promo' ? setPromoCodeError : setRedeemError;

    if (!trimmed) {
      setErr(
        isKm
          ? 'សូមបញ្ចូលលេខកូដ Redeem Code / Promo Code!'
          : isKo
          ? '리딤 코드를 입력해 주세요.'
          : 'Please enter a valid Redeem / Promo Code!'
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
    let matchedCenterId: string | undefined;
    let matchedType = source === 'promo' ? 'Promo Code' : 'Redeem Code';
    let serverErrorMsg: string | null = null;

    // 1. Strict server verification (SQLite Redeem DB, Master Promo, Korea Bank/Telegram codes)
    try {
      const resp = await fetch('/api/payments/verify-redeem', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: trimmed }),
      });
      const data = await resp.json().catch(() => ({}));
      if (resp.ok && data?.success) {
        verified = true;
        if (data.type === 'telegram_receipt') matchedType = 'Telegram Auto-Unlock';
        else if (data.type === 'kr_receipt') matchedType = 'Korea Bank Receipt Code';
        else if (data.type === 'redeem') matchedType = 'Single-Use Voucher';
        else matchedType = 'Promo Code';
      } else {
        serverErrorMsg = data?.error || null;
      }
    } catch {
      // Fall through to Firestore check
    }

    // 2. Firestore Admin-managed Promo Code lookup by exact code ID
    if (!verified) {
      const fsCheck = await verifyAndRedeemFirestorePromo(trimmed);
      if (fsCheck.valid) {
        verified = true;
        matchedCenterId = fsCheck.centerId;
        matchedType = 'Admin Promo Code';
      } else if (fsCheck.reason) {
        serverErrorMsg = fsCheck.reason;
      }
    }

    if (verified) {
      if (source === 'promo') {
        setPromoCodeSuccess(true);
      }
      recordPaymentTransaction({
        userEmail: userEmail || '',
        amount: 0,
        currency: 'KRW',
        method: matchedType,
        promoCodeUsed: trimmed,
        centerId: matchedCenterId,
      }).catch(() => {});

      setProcessingStep(
        isKm
          ? '✓ លេខកូដត្រឹមត្រូវ! កំពុងដោះសោ Clean PDF...'
          : isKo
          ? '✓ 코드 확인 완료! Clean PDF 잠금 해제 중...'
          : '✓ Code verified! Unlocking Clean PDF...'
      );
      await new Promise((r) => setTimeout(r, 450));
      completeUnlock();
    } else {
      setIsProcessing(false);
      setErr(
        serverErrorMsg ||
          (isKm
            ? 'លេខកូដមិនត្រឹមត្រូវ ឬត្រូវបានប្រើរួចហើយ! សូមពិនិត្យម្តងទៀត ឬផ្ញើ Screenshot ការបង់ប្រាក់ទៅ Facebook / Telegram Bot។'
            : isKo
            ? '유효하지 않거나 이미 사용된 코드입니다. 다시 확인하거나 결제 후 코드를 발급받아 주세요.'
            : 'Invalid or already used code! Please check your code or send your payment screenshot to Telegram Bot / Facebook.')
      );
    }
  };

  // Handle Korean Bank Transfer Screenshot upload -> AI auto-verifies -> issues single-use unlock code
  const handleKrReceiptFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setReceiptError(
        isKm
          ? 'សូមជ្រើសរើសរូបភាព Screenshot (PNG / JPG) តែប៉ុណ្ណោះ!'
          : 'Please upload an image screenshot (PNG / JPG).'
      );
      return;
    }
    setReceiptError(null);
    setIssuedKrCode(null);
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setReceiptPreview(reader.result);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleVerifyKrReceipt = async () => {
    if (!receiptPreview) {
      setReceiptError(
        isKm
          ? 'សូម Upload រូបភាព Screenshot វិក្កយបត្របាញ់ប្រាក់កូរ៉េជាមុនសិន!'
          : 'Please upload your Korean bank transfer screenshot first.'
      );
      return;
    }

    setReceiptError(null);
    setVerifyingReceipt(true);
    try {
      const resp = await fetch('/api/payments/verify-kr-receipt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          receiptImage: receiptPreview,
          userEmail: userEmail || 'guest@kiip-portal.kr',
        }),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok || !data?.success || !data?.unlockCode) {
        setReceiptError(
          data?.error ||
            (isKm
              ? 'មិនអាចផ្ទៀងផ្ទាត់វិក្កយបត្រស្វ័យប្រវត្តិបានទេ។ សូមផ្ញើរូប Screenshot ទៅ Facebook Page ឬ Telegram Bot ខាងក្រោមដើម្បីទទួលលេខកូដដោះសោ!'
              : 'Could not auto-verify receipt. Please send your screenshot to Facebook Page or Telegram Bot below to get your unlock code.')
        );
        return;
      }

      setIssuedKrCode({
        code: data.unlockCode,
        bankName: data.bankName || 'Korean Bank',
        verifiedAmount: Number(data.verifiedAmount) || 35000,
      });

      // Automatically burn the single-use code and unlock Clean PDF
      await fetch('/api/payments/verify-redeem', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: data.unlockCode }),
      }).catch(() => {});

      setTimeout(() => {
        completeUnlock();
      }, 1200);
    } catch {
      setReceiptError(
        isKm
          ? 'មានបញ្ហាតភ្ជាប់ទៅប្រព័ន្ធផ្ទៀងផ្ទាត់។ សូមផ្ញើ Screenshot ទៅ Facebook Page ឬ Telegram Bot ខាងក្រោម!'
          : 'Network error while verifying receipt. Please send your screenshot to Facebook or Telegram Bot below.'
      );
    } finally {
      setVerifyingReceipt(false);
    }
  };

  const renderScreenshotDeliveryBox = (variant: 'krbank' | 'khqr') => (
    <div className="p-4 rounded-2xl bg-gradient-to-br from-sky-50 via-blue-50 to-indigo-50 border border-sky-200 space-y-3 text-left">
      <div className="space-y-0.5">
        <p className="text-xs sm:text-sm font-black text-slate-900 flex items-center gap-1.5">
          <Send className="w-4 h-4 text-sky-600 shrink-0" />
          <span>
            {isKm
              ? 'ផ្ញើរូបភាព Screenshot ការបង់ប្រាក់ ដើម្បីទទួលលេខកូដដោះសោ (Redeem Code)'
              : isKo
              ? '결제 스크린샷을 보내고 잠금 해제 코드(Redeem Code) 받기'
              : 'Send Payment Screenshot to Receive Your Unlock Code'}
          </span>
        </p>
        <p className="text-[11px] text-slate-600 leading-relaxed">
          {variant === 'krbank'
            ? isKm
              ? 'បន្ទាប់ពីផ្ទេរប្រាក់ ₩35,000 ចូលធនាគារកូរ៉េរួច អ្នកអាចផ្ញើ Screenshot ទៅ Telegram Bot ឬ Facebook Page របស់យើង ដើម្បីទទួលបានលេខកូដដោះសោឯកសារត្រឡប់ទៅវិញយ៉ាងរហ័ស និងមានសុវត្ថិភាព!'
              : 'After transferring ₩35,000 to our Korean bank account, send your screenshot via Telegram Bot or our Facebook Page to receive your single-use Redeem Code.'
            : isKm
            ? 'បន្ទាប់ពីស្កេនបង់ប្រាក់តាម ABA PAY / KHQR ($25.00 / ₩35,000) រួច សូមផ្ញើរូបភាព Screenshot ទៅ Facebook Page ឬ Telegram Bot ដើម្បីទទួលបានលេខកូដដោះសោ (Redeem Code) ត្រឡប់ទៅវិញភ្លាមៗ!'
            : 'After scanning and paying via ABA PAY / KHQR ($25.00 / ₩35,000), send your screenshot via Facebook Page or Telegram Bot to receive your Redeem Code.'}
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
        {/* Option 1: Telegram Bot */}
        {krConfig.telegramBotUsername ? (
          <a
            href={`https://t.me/${encodeURIComponent(krConfig.telegramBotUsername)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="py-2.5 px-3.5 rounded-xl bg-sky-600 hover:bg-sky-700 text-white font-bold text-xs flex items-center justify-center gap-2 shadow-xs transition-colors"
          >
            <Send className="w-4 h-4 shrink-0" />
            <span>
              {isKm ? `ផ្ញើតាម Telegram Bot (@${krConfig.telegramBotUsername})` : `Telegram Bot (@${krConfig.telegramBotUsername})`}
            </span>
            <ExternalLink className="w-3.5 h-3.5 shrink-0 opacity-80" />
          </a>
        ) : (
          <button
            type="button"
            onClick={() => setActiveTab('redeem')}
            className="py-2.5 px-3.5 rounded-xl bg-sky-600 hover:bg-sky-700 text-white font-bold text-xs flex items-center justify-center gap-2 shadow-xs transition-colors cursor-pointer"
          >
            <Send className="w-4 h-4 shrink-0" />
            <span>
              {isKm ? 'ផ្ញើតាម Telegram Bot → វាយកូដដោះសោ' : 'Telegram Bot → Enter Redeem Code'}
            </span>
          </button>
        )}

        {/* Option 2: Facebook Page */}
        <a
          href={FACEBOOK_PAGE_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="py-2.5 px-3.5 rounded-xl bg-[#1877F2] hover:bg-[#1464cc] text-white font-bold text-xs flex items-center justify-center gap-2 shadow-xs transition-colors"
        >
          <MessageCircle className="w-4 h-4 shrink-0" />
          <span>{isKm ? 'ផ្ញើ Screenshot តាម Facebook Page' : 'Send Screenshot via Facebook'}</span>
          <ExternalLink className="w-3.5 h-3.5 shrink-0 opacity-80" />
        </a>
      </div>

      {/* KakaoTalk ID + Quick Jump to Redeem Tab */}
      <div className="pt-1 flex flex-wrap items-center justify-between gap-2 border-t border-sky-200/70">
        <div className="flex items-center gap-2 text-[11px] text-slate-700">
          <span className="font-bold text-amber-900 bg-amber-100 border border-amber-200 px-2 py-0.5 rounded-md">
            KakaoTalk ID: <span className="font-mono font-black">{KAKAOTALK_ID}</span>
          </span>
          <button
            type="button"
            onClick={() => copyText(KAKAOTALK_ID, setCopiedKakao)}
            className="px-2 py-0.5 rounded-md bg-white border border-slate-200 hover:bg-slate-100 text-slate-700 font-bold text-[10.5px] inline-flex items-center gap-1 cursor-pointer"
          >
            {copiedKakao ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3" />}
            <span>{copiedKakao ? (isKm ? 'បានចម្លង' : 'Copied') : (isKm ? 'ចម្លង' : 'Copy')}</span>
          </button>
        </div>

        <button
          type="button"
          onClick={() => setActiveTab('redeem')}
          className="text-[11px] font-black text-purple-700 hover:text-purple-900 inline-flex items-center gap-1 cursor-pointer"
        >
          <Ticket className="w-3.5 h-3.5" />
          <span>{isKm ? 'ទទួលបានកូដហើយ? ចុចវាយ Redeem Code' : 'Got your code? Enter Redeem Code'}</span>
          <ArrowRight className="w-3 h-3" />
        </button>
      </div>
    </div>
  );

  return (
    <div className="fixed inset-0 z-[100000] bg-slate-950/75 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4">
      <div className="bg-white rounded-3xl max-w-2xl w-full max-h-[92vh] flex flex-col shadow-2xl border border-slate-200 overflow-hidden my-auto animate-in fade-in zoom-in-95 duration-200">
        {/* Modal Header */}
        <div className="shrink-0 bg-gradient-to-r from-slate-900 via-indigo-950 to-blue-950 text-white p-5 sm:p-6 relative">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-2 pr-8">
            <span className="bg-amber-400/20 text-amber-300 border border-amber-400/40 text-[11px] font-black px-2.5 py-0.5 rounded-full inline-flex items-center gap-1">
              <Sparkles className="w-3 h-3 text-amber-300" />
              <span>OFFICIAL UNLOCK · ₩35,000 (~$25.00)</span>
            </span>
            <span className="text-emerald-300 text-[11px] font-medium flex items-center gap-1">
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>Korea Bank · ABA PAY · Redeem Code</span>
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
          /* Success Screen with 30s Download & Save Countdown for Mobile */
          <div className="p-8 sm:p-10 text-center space-y-4">
            <div className="w-16 h-16 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center mx-auto shadow-lg shadow-emerald-200 animate-bounce">
              <CheckCircle2 className="w-9 h-9" />
            </div>
            <h4 className="text-2xl font-black text-slate-900">
              {isKm ? 'ដោះសោឯកសារជោគជ័យ 100%!' : t.successTitle}
            </h4>
            <p className="text-sm text-slate-600 max-w-md mx-auto leading-relaxed">
              {isKm
                ? `ឯកសារត្រូវបានដោះសោររួចរាល់។ សូមទាញយក និងរក្សាទុកឯកសាររបស់អ្នក (ប្រព័ន្ធនឹងរក្សាទុកជូនរយៈពេល ${successSecondsLeft} វិនាទីសិន មុននឹងលោតទៅជំហានទី៤)...`
                : `Documents unlocked successfully. Please save and download your files (holding for ${successSecondsLeft}s for mobile saving before Step 4)...`}
            </p>

            <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-900 font-bold inline-flex items-center gap-2 tabular-nums">
              <Clock className="w-4 h-4 text-amber-600 shrink-0" />
              <span>{isKm ? `⏱️ រយៈពេលរក្សាទុកទូរសព្ទ: ${successSecondsLeft} វិនាទី` : `⏱️ Mobile Save Window: ${successSecondsLeft}s`}</span>
            </div>

            <div className="pt-2 flex flex-col sm:flex-row items-center justify-center gap-3">
              <button
                type="button"
                onClick={onPaymentSuccess}
                className="w-full sm:w-auto px-6 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-sm shadow-lg shadow-emerald-900/20 inline-flex items-center justify-center gap-2 transition-all hover:scale-105 cursor-pointer"
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
                <span className="text-2xl font-black text-blue-700">₩35,000</span>
                <span className="text-[10px] font-bold text-slate-500">(~ $25.00)</span>
              </div>
            </div>

            {/* Quick Redeem / Promo Code Unlock Box (Always Ready!) */}
            <div className="p-4 bg-gradient-to-r from-purple-50 via-indigo-50 to-pink-50 border-2 border-purple-300 rounded-2xl space-y-2.5 shadow-xs">
              <div className="flex items-center gap-2">
                <span className="p-1.5 rounded-lg bg-purple-600 text-white shadow-2xs">
                  <Ticket className="w-4 h-4" />
                </span>
                <div>
                  <span className="text-xs font-black text-purple-950 block">
                    {isKm
                      ? 'មានលេខកូដដោះសោ (Redeem Code) ហើយមែនទេ? វាយបញ្ចូលទីនេះ!'
                      : isKo
                      ? '발급받은 리딤 코드(Redeem Code) 입력하여 즉시 잠금 해제'
                      : 'Have a Redeem Code? Enter it below to unlock immediately'}
                  </span>
                  <span className="text-[10.5px] text-purple-700">
                    {isKm
                      ? 'ប្រើលេខកូដដែលទទួលបានពី Telegram Bot, Facebook Page ឬ Admin ដើម្បីដោះសោ PDF ភ្លាមៗ'
                      : isKo
                      ? '텔레그램 봇 또는 페이스북에서 받은 코드를 입력해 Clean PDF를 다운로드하세요'
                      : 'Enter the unlock code received from Telegram Bot, Facebook Page, or Admin'}
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-2 pt-1">
                <div className="relative flex-1">
                  <Ticket className="w-4 h-4 text-purple-500 absolute left-3 top-3" />
                  <input
                    type="text"
                    autoComplete="off"
                    value={promoCodeInput}
                    onChange={(e) => {
                      setPromoCodeInput(e.target.value.toUpperCase());
                      setPromoCodeError(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        verifyCodeAndUnlock(promoCodeInput, 'promo');
                      }
                    }}
                    placeholder={isKm ? 'ឧ. KIIP-26-XXXXXX' : 'e.g. KIIP-26-XXXXXX'}
                    className="w-full pl-9 pr-3 py-2.5 bg-white border border-purple-300 rounded-xl text-xs sm:text-sm font-mono font-bold tracking-wider uppercase text-purple-950 focus:outline-none focus:ring-2 focus:ring-purple-400 placeholder:font-sans placeholder:font-normal placeholder:text-slate-400"
                  />
                </div>
                <button
                  type="button"
                  disabled={isProcessing}
                  onClick={() => verifyCodeAndUnlock(promoCodeInput, 'promo')}
                  className="px-4 py-2.5 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 active:scale-95 text-white text-xs font-black rounded-xl shadow-md flex items-center gap-1.5 cursor-pointer shrink-0 transition-transform disabled:opacity-50"
                >
                  <Zap className="w-3.5 h-3.5 text-amber-300" />
                  <span>{isKm ? 'ដោះសោភ្លាមៗ' : isKo ? '잠금 해제' : 'Unlock Now'}</span>
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
                  <span>✓ លេខកូដត្រឹមត្រូវ! កំពុងដោះសោ Clean PDF...</span>
                </div>
              )}
            </div>

            {/* Payment Method Selector: ONLY 2 Active Payment Methods + Redeem Code; All Others Unavailable */}
            <div className="space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <label className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                  {isKm ? 'ជ្រើសរើសវិធីបង់ប្រាក់ (មាន ២ វិធី + Redeem Code)' : 'Select Payment Method (2 Active + Redeem Code)'}
                </label>
              </div>

              {/* Active Row: 2 Payment Methods + Redeem Code */}
              <div className="grid grid-cols-3 gap-2">
                {/* 1. Korea Bank Transfer (Active) */}
                <button
                  type="button"
                  onClick={() => setActiveTab('krbank')}
                  className={`p-3 rounded-2xl border text-center transition-all cursor-pointer flex flex-col items-center justify-center gap-1 relative ${
                    activeTab === 'krbank'
                      ? 'border-emerald-600 bg-emerald-50 text-emerald-950 ring-2 ring-emerald-500/25 font-bold shadow-xs'
                      : 'border-slate-200 bg-white hover:bg-slate-50 text-slate-700'
                  }`}
                >
                  <Landmark className="w-5 h-5 text-emerald-600" />
                  <span className="text-[11px] sm:text-xs font-black">🇰🇷 ធនាគារកូរ៉េ</span>
                  <span className="text-[9.5px] text-emerald-700 font-bold">KOOKMIN BANK</span>
                </button>

                {/* 2. ABA PayWay / KHQR (Active) */}
                <button
                  type="button"
                  onClick={() => setActiveTab('khqr')}
                  className={`p-3 rounded-2xl border text-center transition-all cursor-pointer flex flex-col items-center justify-center gap-1 relative ${
                    activeTab === 'khqr'
                      ? 'border-[#004f80] bg-sky-50 text-[#004f80] ring-2 ring-[#004f80]/25 font-bold shadow-xs'
                      : 'border-slate-200 bg-white hover:bg-slate-50 text-slate-700'
                  }`}
                >
                  <QrCode className="w-5 h-5 text-[#004f80]" />
                  <span className="text-[11px] sm:text-xs font-black">ABA PayWay</span>
                  <span className="text-[9.5px] text-[#004f80] font-bold">ABA PAY · KHQR</span>
                </button>

                {/* 3. Redeem Code (Active) */}
                <button
                  type="button"
                  onClick={() => setActiveTab('redeem')}
                  className={`p-3 rounded-2xl border text-center transition-all cursor-pointer flex flex-col items-center justify-center gap-1 relative ${
                    activeTab === 'redeem'
                      ? 'border-purple-600 bg-purple-50 text-purple-950 ring-2 ring-purple-500/25 font-bold shadow-xs'
                      : 'border-slate-200 bg-white hover:bg-slate-50 text-slate-700'
                  }`}
                >
                  <Ticket className="w-5 h-5 text-purple-600" />
                  <span className="text-[11px] sm:text-xs font-black">Redeem Code</span>
                  <span className="text-[9.5px] text-purple-700 font-bold">
                    {isKm ? 'វាយលេខកូដដោះសោ' : 'Voucher Code'}
                  </span>
                </button>
              </div>

              {/* Unavailable Methods Row (Clearly Disabled & Marked Unavailable) */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-0.5">
                {[
                  {
                    id: 'card',
                    label: 'Card (Visa/Master)',
                    icon: <CreditCard className="w-4 h-4 text-slate-400" />,
                  },
                  {
                    id: 'playstore',
                    label: 'Play Store',
                    icon: <Ban className="w-4 h-4 text-slate-400" />,
                  },
                  {
                    id: 'appstore',
                    label: 'App Store',
                    icon: <Ban className="w-4 h-4 text-slate-400" />,
                  },
                  {
                    id: 'paypal',
                    label: 'PayPal',
                    icon: <Ban className="w-4 h-4 text-slate-400" />,
                  },
                ].map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    disabled
                    aria-disabled="true"
                    className="p-2 rounded-xl border border-slate-200 bg-slate-100/80 text-slate-400 cursor-not-allowed flex flex-col items-center justify-center gap-0.5 opacity-75 select-none"
                  >
                    <div className="flex items-center gap-1">
                      {item.icon}
                      <span className="text-[10.5px] font-bold line-through">{item.label}</span>
                    </div>
                    <span className="text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded bg-slate-200 text-slate-500">
                      Unavailable
                    </span>
                  </button>
                ))}
              </div>
            </div>

            {/* TAB 1: KOREA BANK TRANSFER (KOOKMIN BANK) + TELEGRAM BOT & FACEBOOK SCREENSHOT */}
            {activeTab === 'krbank' && (
              <div className="space-y-4 text-left">
                {/* Always-Visible Korean Bank Account Card */}
                <div className="p-4 rounded-2xl bg-gradient-to-r from-emerald-50 via-teal-50 to-sky-50 border-2 border-emerald-300 space-y-3 shadow-xs">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2.5">
                      <span className="p-2 rounded-xl bg-emerald-600 text-white shrink-0">
                        <Landmark className="w-4 h-4" />
                      </span>
                      <div>
                        <h4 className="text-xs sm:text-sm font-black text-emerald-950">
                          {isKm
                            ? '🇰🇷 បង់ប្រាក់តាមធនាគារកូរ៉េ (សម្រាប់អ្នកនៅកូរ៉េ)'
                            : isKo
                            ? '🇰🇷 한국 계좌이체 안내'
                            : '🇰🇷 Korea Bank Transfer (For Users in Korea)'}
                        </h4>
                        <p className="text-[11px] text-emerald-800">
                          {isKm
                            ? 'ផ្ទេរប្រាក់ ₩35,000 ចូលលេខគណនីខាងក្រោម រួចផ្ញើរូប Screenshot'
                            : 'Transfer ₩35,000 to the account below, then send your screenshot.'}
                        </p>
                      </div>
                    </div>
                    <span className="text-base font-black text-emerald-800 tabular-nums shrink-0 bg-white px-2.5 py-1 rounded-xl border border-emerald-200">
                      ₩{krConfig.amountKrw.toLocaleString()}
                    </span>
                  </div>

                  {/* Bank Details Display */}
                  <div className="p-3.5 bg-white rounded-xl border border-emerald-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs">
                        <span className="text-slate-500 font-semibold">
                          {isKm ? 'ធនាគារ:' : 'Bank:'}
                        </span>
                        <span className="font-black text-slate-900">{krConfig.bankName}</span>
                      </div>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs">
                        <span className="text-slate-500 font-semibold">
                          {isKm ? 'ឈ្មោះគណនី:' : 'Holder:'}
                        </span>
                        <span className="font-black text-slate-900">{krConfig.accountHolder}</span>
                      </div>
                      <div className="pt-0.5">
                        <span className="text-[10.5px] font-bold text-emerald-700 block">
                          {isKm ? 'លេខគណនី (Account Number):' : 'Account Number:'}
                        </span>
                        <p className="font-mono font-black text-lg sm:text-xl text-emerald-800 tracking-wider tabular-nums">
                          {krConfig.accountNumber}
                        </p>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => copyText(krConfig.accountNumber, setCopiedKrAccount)}
                      className="px-3.5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs flex items-center justify-center gap-1.5 cursor-pointer shadow-xs shrink-0 self-start sm:self-center"
                    >
                      {copiedKrAccount ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                      <span>
                        {copiedKrAccount
                          ? isKm
                            ? 'បានចម្លងរួច!'
                            : 'Copied!'
                          : isKm
                          ? 'ចម្លងលេខគណនី'
                          : 'Copy Account'}
                      </span>
                    </button>
                  </div>
                </div>

                {/* Screenshot Delivery via Telegram Bot OR Facebook Page */}
                {renderScreenshotDeliveryBox('krbank')}

                {/* Optional Direct In-Website Auto-Verify Receipt Upload */}
                <div className="p-4 rounded-2xl border-2 border-dashed border-slate-300 bg-slate-50/70 space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                      <Camera className="w-4 h-4 text-emerald-600 shrink-0" />
                      {isKm
                        ? 'ឬ Upload Screenshot ផ្ទាល់លើវេបសាយដើម្បីផ្ទៀងផ្ទាត់ស្វ័យប្រវត្តិ (Auto-Unlock)'
                        : 'Or Upload Screenshot Here for Instant Auto-Verification'}
                    </span>
                  </div>

                  <label className="block w-full p-4 bg-white hover:bg-emerald-50/40 rounded-xl border border-slate-200 text-center cursor-pointer transition-colors">
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handleKrReceiptFileChange}
                      className="hidden"
                    />
                    {receiptPreview ? (
                      <div className="space-y-2">
                        <img
                          src={receiptPreview}
                          alt="Transfer receipt preview"
                          className="max-h-48 mx-auto rounded-lg border border-slate-200 object-contain"
                        />
                        <p className="text-[11px] text-emerald-700 font-bold">
                          {isKm ? 'ចុចដើម្បីប្ដូររូប Screenshot ផ្សេង' : 'Click to replace screenshot'}
                        </p>
                      </div>
                    ) : (
                      <div className="py-3 flex flex-col items-center gap-1.5 text-slate-500">
                        <Upload className="w-5 h-5 text-emerald-600" />
                        <span className="text-xs font-bold text-slate-700">
                          {isKm ? 'ចុចជ្រើសរើសរូប Screenshot វិក្កយបត្រ (PNG / JPG)' : 'Click to select receipt screenshot (PNG / JPG)'}
                        </span>
                        <span className="text-[10px] text-slate-400">
                          {isKm ? 'រូបភាពត្រូវបានផ្ទៀងផ្ទាត់ភ្លាមៗក្នុង Memory ហើយមិនរក្សាទុកក្នុង Server ឡើយ' : 'Verified in-memory only — image is never stored on disk'}
                        </span>
                      </div>
                    )}
                  </label>

                  {receiptError && (
                    <div className="p-2.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-start gap-2">
                      <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                      <span>{receiptError}</span>
                    </div>
                  )}

                  {issuedKrCode && (
                    <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-300 text-emerald-900 text-xs space-y-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-black flex items-center gap-1.5">
                          <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                          {isKm
                            ? `ផ្ទៀងផ្ទាត់ជោគជ័យ (${issuedKrCode.bankName} · ₩${issuedKrCode.verifiedAmount.toLocaleString()})!`
                            : `Verified (${issuedKrCode.bankName} · ₩${issuedKrCode.verifiedAmount.toLocaleString()})!`}
                        </span>
                        <button
                          type="button"
                          onClick={() => copyText(issuedKrCode.code, setCopiedKrCode)}
                          className="px-2 py-0.5 rounded bg-emerald-200 text-emerald-950 font-mono font-bold text-[11px] flex items-center gap-1 cursor-pointer"
                        >
                          <span>{issuedKrCode.code}</span>
                          {copiedKrCode ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                        </button>
                      </div>
                      <p className="text-[11px] text-emerald-800">
                        {isKm ? 'កំពុងដោះសោ Clean PDF ជូនអ្នកដោយស្វ័យប្រវត្តិ...' : 'Automatically unlocking your Clean PDF...'}
                      </p>
                    </div>
                  )}

                  <button
                    type="button"
                    disabled={!receiptPreview || verifyingReceipt}
                    onClick={handleVerifyKrReceipt}
                    className="w-full py-3 px-4 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white font-black text-xs sm:text-sm shadow-md flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
                  >
                    {verifyingReceipt ? (
                      <>
                        <RefreshCw className="w-4 h-4 animate-spin" />
                        <span>{isKm ? 'កំពុងផ្ទៀងផ្ទាត់វិក្កយបត្រស្វ័យប្រវត្តិ...' : 'Verifying transfer receipt...'}</span>
                      </>
                    ) : (
                      <>
                        <ShieldCheck className="w-4 h-4" />
                        <span>{isKm ? 'ផ្ទៀងផ្ទាត់វិក្កយបត្រ & ដោះសោស្វ័យប្រវត្តិ' : 'Verify Receipt & Auto-Unlock'}</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            )}

            {/* TAB 2: ABA PAYWAY / KHQR (USER'S OFFICIAL ABA QR IMAGE) */}
            {activeTab === 'khqr' && (
              <div className="space-y-4 text-center">
                {/* Header Info Banner */}
                <div className="p-3.5 bg-gradient-to-r from-sky-50 via-blue-50 to-indigo-50 rounded-2xl border border-sky-200 text-left flex flex-col sm:flex-row sm:items-center justify-between gap-2 shadow-2xs">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="bg-[#004f80] text-white text-[10px] font-black px-2 py-0.5 rounded-md tracking-wider">
                        ABA PAY · KHQR
                      </span>
                      <span className="text-xs text-[#003d63] font-black">
                        {isKm
                          ? 'ស្កេន QR Code បង់ផ្ទាល់ចូល ABA Bank'
                          : isKo
                          ? 'ABA Bank 공식 KHQR 결제'
                          : 'Scan Official ABA PAY / KHQR Code'}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-600 mt-1">
                      {isKm
                        ? 'គាំទ្រ ABA Mobile និងកម្មវិធីធនាគារ KHQR ទាំងអស់ ($25.00 / ₩35,000)។ បន្ទាប់ពីបង់រួច សូមផ្ញើ Screenshot ទៅ Facebook ឬ Telegram Bot ដើម្បីទទួលលេខកូដដោះសោ។'
                        : 'Supports ABA Mobile & all KHQR banking apps ($25.00 / ₩35,000). After paying, send your screenshot via Facebook or Telegram Bot to receive your Redeem Code.'}
                    </p>
                  </div>
                  <span className="text-sm font-black text-[#004f80] tabular-nums shrink-0 bg-white px-2.5 py-1 rounded-xl border border-sky-200 self-start sm:self-center">
                    $25.00 / ₩35,000
                  </span>
                </div>

                {/* User's Official Uploaded ABA PAY QR Code Card */}
                <div className="max-w-[340px] mx-auto bg-white rounded-3xl border-2 border-[#004f80]/30 shadow-xl overflow-hidden">
                  <img
                    src={ABA_QR_IMAGE_PATH}
                    alt="ABA PAY KHQR - EANG VEASNA (000 375 987)"
                    className="w-full h-auto object-contain block"
                  />

                  {/* Copyable Account Info Strip */}
                  <div className="p-3.5 bg-slate-50 border-t border-slate-200 text-left space-y-1.5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-slate-500 font-semibold">
                        {isKm ? 'ឈ្មោះគណនី:' : 'Account Name:'}
                      </span>
                      <span className="font-black text-slate-900">{ABA_ACCOUNT_HOLDER}</span>
                    </div>
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-slate-500 font-semibold">
                        {isKm ? 'លេខគណនី ABA:' : 'ABA Account:'}
                      </span>
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono font-black text-[#004f80] text-sm tabular-nums">
                          {ABA_ACCOUNT_NUMBER}
                        </span>
                        <button
                          type="button"
                          onClick={() => copyText(ABA_ACCOUNT_RAW, setCopiedAbaAccount)}
                          className="px-2 py-0.5 rounded-md bg-sky-100 hover:bg-sky-200 text-[#004f80] font-bold text-[10.5px] inline-flex items-center gap-1 cursor-pointer"
                          title="Copy ABA Account"
                        >
                          {copiedAbaAccount ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3" />}
                          <span>{copiedAbaAccount ? (isKm ? 'បានចម្លង' : 'Copied') : (isKm ? 'ចម្លង' : 'Copy')}</span>
                        </button>
                      </div>
                    </div>
                    <div className="flex items-center justify-between text-[11px] text-slate-500">
                      <span>MID:</span>
                      <span className="font-mono font-bold text-slate-700">{ABA_MID}</span>
                    </div>
                  </div>
                </div>

                {/* Screenshot Delivery via Facebook / Telegram Bot */}
                {renderScreenshotDeliveryBox('khqr')}

                {/* Compact Korea Bank Account Reminder Strip */}
                <div className="p-3 rounded-2xl bg-emerald-50 border border-emerald-200 flex flex-wrap items-center justify-between gap-2 text-left text-xs">
                  <div>
                    <span className="font-black text-emerald-950 block">
                      🇰🇷 {isKm ? 'នៅកូរ៉េ? បង់តាមធនាគារកូរ៉េ:' : 'In Korea? Pay via Korean Bank:'}
                    </span>
                    <span className="text-[11px] text-emerald-800 font-mono font-bold">
                      {krConfig.bankName} · {krConfig.accountNumber} ({krConfig.accountHolder})
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setActiveTab('krbank')}
                    className="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-[11px] cursor-pointer shrink-0"
                  >
                    {isKm ? 'បើកផ្ទាំងធនាគារកូរ៉េ' : 'Open Korea Bank'}
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
                        {isKm ? 'លេខកូដដោះសោឯកសារ (Redeem / Voucher Code)' : 'Redeem / Voucher Code'}
                      </h4>
                      <p className="text-[11px] text-purple-700">
                        {isKm
                          ? 'បញ្ចូលលេខកូដដែលទទួលបានពី Telegram Bot, Facebook Page ឬ Admin បន្ទាប់ពីបង់ប្រាក់តាមធនាគារកូរ៉េ ឬ ABA PAY'
                          : isKo
                          ? '계좌이체 또는 ABA 결제 후 텔레그램 봇/페이스북에서 받은 일회용 코드를 입력하세요'
                          : 'Enter the single-use code received from Telegram Bot, Facebook Page, or Admin'}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Type selector */}
                <div className="grid grid-cols-2 gap-2">
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
                    <span>1-Time Redeem Code</span>
                  </button>

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
                </div>

                <div>
                  <label className="text-xs font-bold text-slate-700 block mb-1">
                    {isKm ? 'វាយបញ្ចូលលេខកូដដោះសោ៖' : isKo ? '코드 입력:' : 'Enter Code:'}
                  </label>
                  <div className="relative">
                    <Ticket className="w-4 h-4 text-purple-500 absolute left-3 top-3.5" />
                    <input
                      type="text"
                      autoComplete="off"
                      value={redeemCode}
                      onChange={(e) => {
                        setRedeemCode(e.target.value.toUpperCase());
                        setRedeemError(null);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          verifyCodeAndUnlock(redeemCode, 'redeem');
                        }
                      }}
                      placeholder={isKm ? 'ឧ. KIIP-26-XXXXXX' : 'e.g. KIIP-26-XXXXXX'}
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
                    onClick={() => setActiveTab('krbank')}
                    className="px-4 py-3.5 rounded-2xl bg-emerald-50 hover:bg-emerald-100 text-emerald-900 font-bold text-xs border border-emerald-200 cursor-pointer"
                  >
                    🇰🇷 {isKm ? 'បង់តាមធនាគារកូរ៉េ' : 'Korea Bank'}
                  </button>

                  <button
                    type="button"
                    onClick={() => setActiveTab('khqr')}
                    className="px-4 py-3.5 rounded-2xl bg-sky-50 hover:bg-sky-100 text-[#004f80] font-bold text-xs border border-sky-200 cursor-pointer"
                  >
                    {isKm ? 'បង់តាម ABA QR' : 'ABA QR'}
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
