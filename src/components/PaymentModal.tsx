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
import { auth, recordPaymentTransaction, verifyAndRedeemFirestorePromo } from '../utils/firebase';

interface PaymentModalProps {
  isOpen: boolean;
  onClose: () => void;
  onPaymentSuccess: (options?: { autoDownloadPdf?: boolean; source?: 'promo' | 'redeem' | 'payment' }) => void;
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
  formData,
  userEmail,
}) => {
  const t = getTranslation(lang);
  const idCardName = (formData?.name || '').trim();
  const [activeTab, setActiveTab] = useState<'khqr' | 'krbank' | 'redeem'>('krbank');
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingStep, setProcessingStep] = useState<string>('');
  const [isSuccess, setIsSuccess] = useState(false);

  // Dedicated Redeem Code State (10,000 Google Sheet & Admin Dashboard Redeem DB)
  const [redeemCode, setRedeemCode] = useState('');
  const [redeemError, setRedeemError] = useState<string | null>(null);
  const [redeemSuccess, setRedeemSuccess] = useState(false);

  // Separate Promo Code State (Admin Dashboard Promo Codes + 10,000 Google Sheet Codes)
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

  // Korea Bank Screenshot Auto-Verify State (5-Step Automated Flow)
  const [receiptPreview, setReceiptPreview] = useState<string | null>(null);
  const [receiptSenderName, setReceiptSenderName] = useState<string>('');
  const [verifyingReceipt, setVerifyingReceipt] = useState(false);
  const [receiptError, setReceiptError] = useState<string | null>(null);
  const [receiptChecks, setReceiptChecks] = useState<{
    isReceipt: boolean;
    recipientMatched: boolean;
    amountMatched: boolean;
    statusSuccess: boolean;
    timeVerified: boolean;
  } | null>(null);
  const [receiptDetected, setReceiptDetected] = useState<{
    bankName?: string;
    recipientName?: string;
    amountKrw?: number;
    statusText?: string;
    transferTimestamp?: string;
  } | null>(null);
  const [issuedKrCode, setIssuedKrCode] = useState<{
    code: string;
    verdict: string;
    bankName: string;
    recipientName: string;
    verifiedAmount: number;
    statusText: string;
    transferTimestamp: string;
    checks: {
      isReceipt: boolean;
      recipientMatched: boolean;
      amountMatched: boolean;
      statusSuccess: boolean;
      timeVerified: boolean;
    };
  } | null>(null);

  const isKm = lang === 'km';
  const isKo = lang === 'ko';

  const [successSecondsLeft, setSuccessSecondsLeft] = useState<number>(30);

  const completeUnlock = useCallback(() => {
    setIsProcessing(false);
    setIsSuccess(true);
    setSuccessSecondsLeft(30);

    confetti({
      particleCount: 150,
      spread: 95,
      origin: { y: 0.5 },
    });
  }, []);

  // Reset transient states whenever modal opens fresh
  useEffect(() => {
    if (!isOpen) return;
    setIsProcessing(false);
    setProcessingStep('');
    setIsSuccess(false);
    setRedeemError(null);
    setPromoCodeError(null);
    setReceiptError(null);
    setReceiptChecks(null);
    setReceiptDetected(null);
  }, [isOpen]);

  // 30-second countdown timer for saving/downloading on mobile before auto-advancing
  useEffect(() => {
    if (!isOpen || !isSuccess) return;

    const timer = window.setInterval(() => {
      setSuccessSecondsLeft((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          onPaymentSuccess({ autoDownloadPdf: true, source: 'payment' });
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

  // Strict Separated Verification:
  // - source === 'redeem': ONLY unlocks PAID Redeem Codes (Google Sheet 10,000 / Korea Bank / Telegram / Admin Paid)
  // - source === 'promo': ONLY unlocks Admin Dashboard Promo Codes & Master Promo Codes (never bypasses unpaid Sheet codes)
  const verifyCodeAndUnlock = async (rawInput: string, source: 'promo' | 'redeem') => {
    const trimmed = rawInput.trim().toUpperCase();
    const setErr = source === 'promo' ? setPromoCodeError : setRedeemError;
    const setOk = source === 'promo' ? setPromoCodeSuccess : setRedeemSuccess;

    if (!trimmed) {
      setErr(
        isKm
          ? source === 'promo'
            ? 'សូមបញ្ចូលលេខកូដ Promo Code ពី Admin!'
            : 'សូមបញ្ចូលលេខកូដ Redeem Code ដែលទទួលបានក្រោយបង់ប្រាក់!'
          : isKo
          ? source === 'promo'
            ? '프로모션 코드를 입력해 주세요.'
            : '결제 후 발급받은 리딤 코드를 입력해 주세요.'
          : source === 'promo'
          ? 'Please enter an Admin Promo Code!'
          : 'Please enter your Paid Redeem Code!'
      );
      return;
    }

    setErr(null);
    setOk(false);
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
    // ONLY allow Firestore /promoCodes/{CODE} lookup inside the Promo Code box
    let shouldTryFirestore = source === 'promo';

    // 1. Server verification (strict mode separation enforced server-side; also verifies & mirrors Firestore promo codes)
    try {
      const firebaseIdToken = auth.currentUser
        ? await auth.currentUser.getIdToken().catch(() => '')
        : '';
      const resp = await fetch('/api/payments/verify-redeem', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: trimmed,
          userEmail: userEmail || '',
          applicantName: idCardName,
          mode: source,
          lang,
          firebaseIdToken: firebaseIdToken || undefined,
        }),
      });
      const data = await resp.json().catch(() => ({}));
      if (resp.ok && data?.success) {
        verified = true;
        if (data.centerId) matchedCenterId = String(data.centerId);
        if (data.type === 'telegram_bot' || data.type === 'telegram_receipt') matchedType = 'Telegram Auto-Unlock';
        else if (data.type === 'kr_receipt') matchedType = 'Korea Bank Receipt Code';
        else if (data.type === 'google_sheets') matchedType = 'Google Sheet Paid Redeem Code';
        else if (data.type === 'admin_promo') matchedType = 'Admin Promo Code';
        else if (data.type === 'database' || data.type === 'admin' || data.type === 'redeem') matchedType = 'Paid Redeem Code';
        else matchedType = 'Promo Code';
      } else {
        serverErrorMsg = data?.error || null;
        // Never mask definitive status/payment/wrong-box errors with a Firestore lookup
        if (
          data?.errorCode === 'PAYMENT_REQUIRED' ||
          data?.errorCode === 'WRONG_BOX_REDEEM' ||
          data?.errorCode === 'WRONG_BOX_PROMO' ||
          data?.errorCode === 'ALREADY_USED' ||
          data?.errorCode === 'REVOKED' ||
          data?.errorCode === 'EXPIRED' ||
          data?.errorCode === 'LIMIT_REACHED' ||
          data?.errorCode === 'INACTIVE'
        ) {
          shouldTryFirestore = false;
        }
      }
    } catch {
      // Fall through to Firestore check only when source === 'promo'
    }

    // 2. Fallback: Firestore Admin-managed Promo Code lookup by exact code ID (Promo box only)
    if (!verified && shouldTryFirestore && source === 'promo') {
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
      setOk(true);
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
          ? '✓ លេខកូដត្រឹមត្រូវ! កំពុងដោះសោ និងទាញយក Clean PDF...'
          : isKo
          ? '✓ 코드 확인 완료! Clean PDF 자동 저장 중...'
          : '✓ Code verified! Unlocking & downloading Clean PDF...'
      );
      confetti({
        particleCount: 150,
        spread: 95,
        origin: { y: 0.5 },
      });
      await new Promise((r) => setTimeout(r, 420));
      setIsProcessing(false);
      onPaymentSuccess({ autoDownloadPdf: true, source });
    } else {
      setIsProcessing(false);
      setErr(
        serverErrorMsg ||
          (isKm
            ? source === 'promo'
              ? 'រកមិនឃើញ Promo Code នេះ ឬផុតកំណត់ហើយ! សូមពិនិត្យលេខកូដ Promo ពី Admin ឡើងវិញ។'
              : 'រកមិនឃើញ Redeem Code នេះ មិនទាន់បង់ប្រាក់ ឬប្រើរួចហើយ! សូមបង់ប្រាក់ជាមុនដើម្បីទទួលកូដដោះសោ។'
            : isKo
            ? source === 'promo'
              ? '유효하지 않거나 만료된 프로모션 코드입니다.'
              : '유효하지 않거나 미결제/이미 사용된 리딤 코드입니다. 결제 후 발급받은 코드를 입력해 주세요.'
            : source === 'promo'
            ? 'Invalid or expired Promo Code! Please double-check your Admin Promo Code.'
            : 'Invalid, unpaid, or already used Redeem Code! Please complete payment first to unlock.')
      );
    }
  };

  // Handle Korean Bank Transfer Screenshot upload -> auto-compress to crisp JPEG (<500KB) -> AI auto-verifies
  const handleKrReceiptFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const allowedMime = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'];
    if (!allowedMime.includes(file.type.toLowerCase())) {
      setReceiptError(
        isKm
          ? 'សូមជ្រើសរើសរូបភាព Screenshot (PNG / JPG / WEBP) តែប៉ុណ្ណោះ!'
          : isKo
          ? '이체 확인증 이미지(PNG / JPG / WEBP)만 업로드할 수 있습니다.'
          : 'Please upload an image screenshot (PNG / JPG / WEBP).'
      );
      return;
    }
    if (file.size > 15 * 1024 * 1024) {
      setReceiptError(
        isKm
          ? 'ទំហំរូបភាពធំពេក (អតិបរមា 15MB)។ សូមជ្រើសរើសរូប Screenshot ដែលមានទំហំតូចជាងនេះ!'
          : isKo
          ? '이미지 용량이 너무 큽니다(최대 15MB). 더 작은 스크린샷을 선택해 주세요.'
          : 'Image file is too large (max 15MB). Please choose a smaller screenshot.'
      );
      return;
    }
    setReceiptError(null);
    setReceiptChecks(null);
    setReceiptDetected(null);
    setIssuedKrCode(null);

    const reader = new FileReader();
    reader.onload = () => {
      const rawDataUrl = typeof reader.result === 'string' ? reader.result : '';
      if (!rawDataUrl) return;

      // Resize/compress large mobile screenshots on canvas so they stay well under serverless body limits (4.5MB) while keeping Korean text razor-sharp
      const img = new Image();
      img.onload = () => {
        try {
          const maxDim = 1600;
          let targetW = img.naturalWidth || img.width;
          let targetH = img.naturalHeight || img.height;
          if (targetW > maxDim || targetH > maxDim) {
            const scale = Math.min(maxDim / targetW, maxDim / targetH);
            targetW = Math.max(1, Math.round(targetW * scale));
            targetH = Math.max(1, Math.round(targetH * scale));
          }
          const canvas = document.createElement('canvas');
          canvas.width = targetW;
          canvas.height = targetH;
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            setReceiptPreview(rawDataUrl);
            return;
          }
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, targetW, targetH);
          ctx.drawImage(img, 0, 0, targetW, targetH);
          const compressed = canvas.toDataURL('image/jpeg', 0.86);
          setReceiptPreview(compressed.length < rawDataUrl.length ? compressed : rawDataUrl);
        } catch {
          setReceiptPreview(rawDataUrl);
        }
      };
      img.onerror = () => {
        setReceiptPreview(rawDataUrl);
      };
      img.src = rawDataUrl;
    };
    reader.readAsDataURL(file);
  };

  const handleVerifyKrReceipt = async () => {
    if (!receiptPreview) {
      setReceiptError(
        isKm
          ? 'សូម Upload រូបភាព Screenshot វិក្កយបត្របាញ់ប្រាក់កូរ៉េជាមុនសិន!'
          : isKo
          ? '먼저 한국 계좌이체 완료 스크린샷을 업로드해 주세요.'
          : 'Please upload your Korean bank transfer screenshot first.'
      );
      return;
    }

    const cleanSenderInput = receiptSenderName.trim();
    if (cleanSenderInput.length < 2) {
      setReceiptError(
        isKm
          ? 'សូមបំពេញឈ្មោះអ្នកផ្ញើរប្រាក់ (ម្ចាស់គណនីធនាគារដែលបានផ្ទេរ) ជាមុនសិន ទើបអាចចុចផ្ទៀងផ្ទាត់បាន!'
          : isKo
          ? '먼저 송금인(보내는 분) 이름을 입력해 주세요.'
          : 'Please enter the Sender Name (bank transfer sender) before verifying.'
      );
      return;
    }

    setReceiptError(null);
    setReceiptChecks(null);
    setReceiptDetected(null);
    setIssuedKrCode(null);
    setVerifyingReceipt(true);
    try {
      const resp = await fetch('/api/payments/verify-kr-receipt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          receiptImage: receiptPreview,
          userEmail: userEmail || 'guest@kiip-portal.kr',
          applicantName: idCardName,
          senderNameInput: cleanSenderInput,
          lang,
        }),
      });
      const data = await resp.json().catch(() => ({}));
      if (data?.checks) {
        setReceiptChecks(data.checks);
      }
      if (data?.detected) {
        setReceiptDetected(data.detected);
      }

      if (!resp.ok || !data?.success || !data?.unlockCode) {
        const statusFallback =
          resp.status === 413
            ? isKm
              ? 'ទំហំរូបភាព Screenshot ធំពេកសម្រាប់ម៉ាស៊ីនមេ (HTTP 413)។ សូមជ្រើសរើសរូបភាពម្តងទៀត!'
              : 'Screenshot file size is too large (HTTP 413). Please re-select the image.'
            : resp.status === 404
            ? isKm
              ? 'រកមិនឃើញសេវាផ្ទៀងផ្ទាត់ AI លើម៉ាស៊ីនមេ (HTTP 404)។ សូម Deploy ម្តងទៀត ឬផ្ញើ Screenshot ទៅ Telegram Bot ខាងក្រោម!'
              : 'Auto-verify API endpoint not found on this deployment (HTTP 404). Please redeploy or send your screenshot below.'
            : isKm
            ? 'AI ឆ្លើយតប "មិនពិត" — មិនអាចផ្ទៀងផ្ទាត់វិក្កយបត្រស្វ័យប្រវត្តិបានទេ។ សូមពិនិត្យឈ្មោះអ្នកទទួល ទឹកប្រាក់ ₩35,000 ស្ថានភាពជោគជ័យ និងពេលវេលា ឬផ្ញើ Screenshot ទៅ Telegram Bot / Facebook Page ខាងក្រោម!'
            : isKo
            ? 'AI 검증 결과 "불일치" — 수취인, ₩35,000 금액, 이체완료 상태 및 이체 일시를 확인 후 다시 시도해 주세요.'
            : 'AI returned FALSE — Could not auto-verify receipt. Please check recipient name, ₩35,000 amount, completed status, and timestamp.';

        setReceiptError(data?.error || statusFallback);
        return;
      }

      const verifiedChecks = data.checks || {
        isReceipt: true,
        recipientMatched: true,
        amountMatched: true,
        statusSuccess: true,
        timeVerified: true,
      };
      setReceiptChecks(verifiedChecks);
      setIssuedKrCode({
        code: data.unlockCode,
        verdict: data.verdict || 'ពិត',
        bankName: data.bankName || krConfig.bankName || 'Korean Bank',
        recipientName: data.recipientName || krConfig.accountHolder || 'EANG VEASNA',
        verifiedAmount: Number(data.verifiedAmount) || krConfig.amountKrw || 35000,
        statusText: data.statusText || '이체완료',
        transferTimestamp: data.transferTimestamp || '',
        checks: verifiedChecks,
      });

      // Pre-fill the Redeem Code box so customer can also inspect or apply with 1 click
      setRedeemCode(data.unlockCode);
      setRedeemError(null);
      confetti({
        particleCount: 90,
        spread: 65,
        origin: { y: 0.65 },
        colors: ['#10b981', '#059669', '#fbbf24', '#3b82f6'],
      });
    } catch {
      setReceiptError(
        isKm
          ? 'មានបញ្ហាតភ្ជាប់ទៅប្រព័ន្ធ AI ផ្ទៀងផ្ទាត់។ សូមព្យាយាមម្តងទៀត ឬផ្ញើ Screenshot ទៅ Facebook Page / Telegram Bot ខាងក្រោម!'
          : isKo
          ? 'AI 검증 서버 연결 오류가 발생했습니다. 다시 시도하거나 아래 채널로 스크린샷을 보내 주세요.'
          : 'Network error while connecting to AI receipt verification. Please try again or contact support below.'
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
                onClick={() => onPaymentSuccess({ autoDownloadPdf: true, source: 'payment' })}
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

            {/* Strictly Separated Code Boxes at Payment:
                1. Paid Redeem Code Box (10,000 Google Sheet codes — requires payment first!)
                2. Separate Promo Code Box (Admin Dashboard Promo Codes — free unlock) */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {/* BOX 1: Paid Redeem Code (10,000 Google Sheet — Payment Required) */}
              <div className="p-3.5 bg-gradient-to-br from-indigo-50 via-blue-50 to-slate-50 border-2 border-indigo-300 rounded-2xl space-y-2 shadow-xs">
                <div className="flex items-start gap-2">
                  <span className="p-1.5 rounded-lg bg-indigo-600 text-white shadow-2xs shrink-0 mt-0.5">
                    <Ticket className="w-3.5 h-3.5" />
                  </span>
                  <div className="min-w-0">
                    <span className="text-xs font-black text-indigo-950 block leading-tight">
                      {isKm
                        ? 'ប្រអប់ Redeem Code (ក្រោយបង់ប្រាក់)'
                        : isKo
                        ? '리딤 코드 입력 (결제 완료 코드)'
                        : 'Paid Redeem Code (Google Sheet)'}
                    </span>
                    <span className="text-[10.5px] text-indigo-700 leading-snug block mt-0.5">
                      {isKm
                        ? 'សម្រាប់លេខកូដ Google Sheet (10,000 កូដ) ដែលទទួលបានក្រោយបង់ប្រាក់តាមធនាគារកូរ៉េ ឬ ABA'
                        : isKo
                        ? '결제 확인 후 발급받은 Google Sheet 리딤 코드를 입력하세요'
                        : 'Requires payment first — enter the paid Google Sheet code issued after payment'}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-1.5 pt-0.5">
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
                    placeholder={isKm ? 'កូដក្រោយបង់ប្រាក់...' : 'Paid Redeem Code...'}
                    className="w-full min-w-0 px-3 py-2 bg-white border border-indigo-300 rounded-xl text-xs font-mono font-bold tracking-wider uppercase text-indigo-950 focus:outline-none focus:ring-2 focus:ring-indigo-400 placeholder:font-sans placeholder:font-normal placeholder:text-slate-400"
                  />
                  <button
                    type="button"
                    disabled={isProcessing}
                    onClick={() => verifyCodeAndUnlock(redeemCode, 'redeem')}
                    className="px-3 py-2 bg-indigo-600 hover:bg-indigo-700 active:scale-95 text-white text-xs font-black rounded-xl shadow-sm flex items-center gap-1 cursor-pointer shrink-0 transition-transform disabled:opacity-50"
                  >
                    <Zap className="w-3.5 h-3.5 text-amber-300" />
                    <span>{isKm ? 'ដោះសោ' : isKo ? '해제' : 'Unlock'}</span>
                  </button>
                </div>

                {redeemError && (
                  <div className="p-2 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-[11px] flex items-start gap-1.5">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                    <span>{redeemError}</span>
                  </div>
                )}

                {redeemSuccess && (
                  <div className="p-2 rounded-xl bg-emerald-50 border border-emerald-300 text-emerald-800 text-[11px] flex items-center gap-1.5 font-bold">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                    <span>{isKm ? '✓ ដោះសោ Redeem Code ជោគជ័យ!' : '✓ Redeem Code unlocked!'}</span>
                  </div>
                )}
              </div>

              {/* BOX 2: Separate Promo Code Box (Admin Promo Codes Only — Free Unlock) */}
              <div className="p-3.5 bg-gradient-to-br from-purple-50 via-fuchsia-50 to-pink-50 border-2 border-purple-300 rounded-2xl space-y-2 shadow-xs">
                <div className="flex items-start gap-2">
                  <span className="p-1.5 rounded-lg bg-purple-600 text-white shadow-2xs shrink-0 mt-0.5">
                    <Gift className="w-3.5 h-3.5" />
                  </span>
                  <div className="min-w-0">
                    <span className="text-xs font-black text-purple-950 block leading-tight">
                      {isKm
                        ? 'ប្រអប់ Promo Code ផ្សេង (ប្រូម៉ូកូដ)'
                        : isKo
                        ? '프로모션 코드 전용 입력란 (Promo)'
                        : 'Separate Promo Code Box'}
                    </span>
                    <span className="text-[10.5px] text-purple-700 leading-snug block mt-0.5">
                      {isKm
                        ? 'សម្រាប់វាយបញ្ចូល Promo Code ពី Admin Dashboard / មជ្ឈមណ្ឌល ដោះសោឥតគិតថ្លៃ'
                        : isKo
                        ? '관리자 대시보드 / 지원센터에서 발급한 무료 프로모션 코드 전용'
                        : 'Exclusively for Admin Dashboard / Support Center Promo Codes (free unlock)'}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-1.5 pt-0.5">
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
                    placeholder={isKm ? 'ឧ. KIIP-PROMO...' : 'e.g. KIIP-PROMO...'}
                    className="w-full min-w-0 px-3 py-2 bg-white border border-purple-300 rounded-xl text-xs font-mono font-bold tracking-wider uppercase text-purple-950 focus:outline-none focus:ring-2 focus:ring-purple-400 placeholder:font-sans placeholder:font-normal placeholder:text-slate-400"
                  />
                  <button
                    type="button"
                    disabled={isProcessing}
                    onClick={() => verifyCodeAndUnlock(promoCodeInput, 'promo')}
                    className="px-3 py-2 bg-gradient-to-r from-purple-600 to-fuchsia-600 hover:from-purple-700 hover:to-fuchsia-700 active:scale-95 text-white text-xs font-black rounded-xl shadow-sm flex items-center gap-1 cursor-pointer shrink-0 transition-transform disabled:opacity-50"
                  >
                    <Gift className="w-3.5 h-3.5 text-amber-200" />
                    <span>{isKm ? 'ប្រើកូដ' : isKo ? '적용' : 'Apply'}</span>
                  </button>
                </div>

                {promoCodeError && (
                  <div className="p-2 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-[11px] flex items-start gap-1.5">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                    <span>{promoCodeError}</span>
                  </div>
                )}

                {promoCodeSuccess && (
                  <div className="p-2 rounded-xl bg-emerald-50 border border-emerald-300 text-emerald-800 text-[11px] flex items-center gap-1.5 font-bold">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                    <span>{isKm ? '✓ ដោះសោ Promo Code ជោគជ័យ!' : '✓ Promo Code unlocked!'}</span>
                  </div>
                )}
              </div>
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

            {/* TAB 1: 5-STEP AUTOMATED BANK TRANSFER & AI RECEIPT VERIFICATION */}
            {activeTab === 'krbank' && (() => {
              const activeAutoStep = issuedKrCode
                ? 5
                : verifyingReceipt
                ? 4
                : receiptPreview
                ? 3
                : 1;

              const autoFlowSteps = [
                { num: 1, label: isKm ? '១. ផ្ទេរ ₩35,000' : isKo ? '1. ₩35,000 이체' : '1. Transfer' },
                { num: 2, label: isKm ? '២. ថត Screenshot' : isKo ? '2. 스크린샷 촬영' : '2. Screenshot' },
                { num: 3, label: isKm ? '៣. Upload រូប' : isKo ? '3. 이미지 업로드' : '3. Upload' },
                { num: 4, label: isKm ? '៤. AI ផ្ទៀងផ្ទាត់' : isKo ? '4. AI 시간·정보 검증' : '4. AI Verify' },
                { num: 5, label: isKm ? '៥. ពិត · ចេញកូដ' : isKo ? '5. 확인 · 코드 발급' : '5. Redeem Code' },
              ];

              return (
                <div className="space-y-4 text-left">
                  {/* 5-Step Automated Process Indicator */}
                  <div className="p-3 rounded-2xl bg-slate-50 border border-slate-200">
                    <div className="grid grid-cols-5 gap-1.5">
                      {autoFlowSteps.map((st) => {
                        const done = st.num < activeAutoStep || (st.num === 5 && Boolean(issuedKrCode));
                        const current = st.num === activeAutoStep && !done;
                        return (
                          <div
                            key={st.num}
                            className={`px-1.5 py-2 rounded-xl text-center border transition-colors ${
                              done
                                ? 'bg-emerald-50 border-emerald-300 text-emerald-900'
                                : current
                                ? 'bg-blue-600 border-blue-600 text-white shadow-xs'
                                : 'bg-white border-slate-200 text-slate-500'
                            }`}
                          >
                            <div className="text-[10px] sm:text-[11px] font-bold leading-tight truncate">
                              {done ? '✓ ' : ''}
                              {st.label}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* STEP 1: Bank Transfer Account Card (₩35,000) */}
                  <div className="p-4 rounded-2xl bg-gradient-to-r from-emerald-50 via-teal-50 to-sky-50 border-2 border-emerald-300 space-y-3 shadow-xs">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2.5">
                        <span className="w-8 h-8 rounded-xl bg-emerald-600 text-white flex items-center justify-center font-black text-xs shrink-0 tabular-nums">
                          1
                        </span>
                        <div>
                          <h4 className="text-xs sm:text-sm font-black text-emerald-950">
                            {isKm
                              ? 'ជំហានទី១ · ផ្ទេរប្រាក់ ₩35,000 ចូលគណនីធនាគារខាងក្រោម'
                              : isKo
                              ? '1단계 · 아래 계좌로 ₩35,000 이체'
                              : 'Step 1 · Transfer ₩35,000 to the Bank Account Below'}
                          </h4>
                          <p className="text-[11px] text-emerald-800">
                            {isKm
                              ? 'បន្ទាប់ពីផ្ទេរប្រាក់ជោគជ័យ សូមថត Screenshot វិក្កយបត្រទុកជាភស្ដុតាង (ជំហានទី២)'
                              : isKo
                              ? '이체 완료 후 거래내역 화면을 스크린샷으로 저장하세요 (2단계)'
                              : 'After completing the transfer, take a screenshot of the confirmation screen (Step 2).'}
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
                        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-xs">
                          <span className="text-slate-500 font-semibold">
                            {isKm ? 'ធនាគារ:' : isKo ? '은행:' : 'Bank:'}
                          </span>
                          <span className="font-black text-slate-900">{krConfig.bankName}</span>
                        </div>
                        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-xs">
                          <span className="text-slate-500 font-semibold">
                            {isKm ? 'ឈ្មោះអ្នកទទួល:' : isKo ? '예금주:' : 'Recipient:'}
                          </span>
                          <span className="font-black text-slate-900">{krConfig.accountHolder}</span>
                        </div>
                        <div className="pt-0.5">
                          <span className="text-[10.5px] font-bold text-emerald-700 block">
                            {isKm ? 'លេខគណនី (Account Number):' : isKo ? '계좌번호:' : 'Account Number:'}
                          </span>
                          <p className="font-mono font-black text-lg sm:text-xl text-emerald-800 tracking-wider tabular-nums">
                            {krConfig.accountNumber}
                          </p>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => copyText(krConfig.accountNumber, setCopiedKrAccount)}
                        className="px-3.5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs flex items-center justify-center gap-1.5 cursor-pointer shadow-xs shrink-0 self-start sm:self-center whitespace-nowrap"
                      >
                        {copiedKrAccount ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                        <span>
                          {copiedKrAccount
                            ? isKm
                              ? 'បានចម្លងរួច!'
                              : isKo
                              ? '복사됨!'
                              : 'Copied!'
                            : isKm
                            ? 'ចម្លងលេខគណនី'
                            : isKo
                            ? '계좌번호 복사'
                            : 'Copy Account'}
                        </span>
                      </button>
                    </div>
                  </div>

                  {/* STEP 2 & STEP 3 & STEP 4: Screenshot Upload + AI Verification & Timestamp Check */}
                  <div className="p-4 rounded-2xl border-2 border-blue-200 bg-white space-y-3.5 shadow-xs">
                    <div className="flex items-start gap-2.5">
                      <span className="w-8 h-8 rounded-xl bg-blue-600 text-white flex items-center justify-center font-black text-xs shrink-0 tabular-nums">
                        2–4
                      </span>
                      <div className="min-w-0">
                        <h4 className="text-xs sm:text-sm font-black text-slate-900">
                          {isKm
                            ? 'ជំហានទី២–៤ · ថត & Upload ស្គ្រីនសត ដើម្បីឱ្យ AI ផ្ទៀងផ្ទាត់ស្វ័យប្រវត្តិ'
                            : isKo
                            ? '2~4단계 · 이체 스크린샷 업로드 & AI 자동 검증'
                            : 'Steps 2–4 · Upload Transfer Screenshot for Instant AI Verification'}
                        </h4>
                        <p className="text-[11px] text-slate-600 mt-0.5 leading-relaxed">
                          {isKm
                            ? `AI នឹងអានរូបភាពដោយស្វ័យប្រវត្តិ និងផ្ទៀងផ្ទាត់ ៤ ចំណុច៖ ឈ្មោះអ្នកទទួល (${krConfig.accountHolder}) · ចំនួនទឹកប្រាក់ ₩35,000 · ស្ថានភាពជោគជ័យ (이체완료) · និងកាលបរិច្ឆេទ/ពេលវេលាផ្ទេរប្រាក់។`
                            : isKo
                            ? `AI가 받는 분(${krConfig.accountHolder}), 금액(₩35,000), 이체완료 상태, 거래일시(시간)를 자동 검증한 뒤 리딤 코드를 즉시 발급합니다.`
                            : `AI automatically verifies recipient (${krConfig.accountHolder}), amount (₩35,000), transfer completion status, and transfer timestamp before issuing your Redeem Code.`}
                        </p>
                        {idCardName && (
                          <div className="mt-2 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-indigo-50 border border-indigo-200 text-[11px] font-bold text-indigo-900">
                            <ShieldCheck className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
                            <span>
                              {isKm
                                ? `ឈ្មោះលើ ID Card នឹងកត់ត្រា Mark Paid៖ ${idCardName}`
                                : isKo
                                ? `신분증(ARC) 이름 결제 기록: ${idCardName}`
                                : `ID Card Name recorded on Paid report: ${idCardName}`}
                            </span>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Upload Dropzone */}
                    <label className="block w-full p-4 bg-slate-50 hover:bg-blue-50/50 rounded-xl border-2 border-dashed border-slate-300 hover:border-blue-400 text-center cursor-pointer transition-colors">
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/webp,image/*"
                        onChange={handleKrReceiptFileChange}
                        className="hidden"
                      />
                      {receiptPreview ? (
                        <div className="space-y-2">
                          <img
                            src={receiptPreview}
                            alt="Transfer receipt preview"
                            className="max-h-52 mx-auto rounded-lg border border-slate-200 object-contain bg-white"
                          />
                          <p className="text-[11px] text-blue-700 font-bold">
                            {isKm
                              ? '✓ បានជ្រើសរើសរូប Screenshot រួចហើយ — ចុចទីនេះប្រសិនបើចង់ប្ដូររូបផ្សេង'
                              : isKo
                              ? '✓ 스크린샷이 선택되었습니다 — 클릭하여 다른 이미지 선택'
                              : '✓ Screenshot selected — click to replace'}
                          </p>
                        </div>
                      ) : (
                        <div className="py-4 flex flex-col items-center gap-1.5 text-slate-500">
                          <div className="w-10 h-10 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center">
                            <Upload className="w-5 h-5" />
                          </div>
                          <span className="text-xs sm:text-sm font-bold text-slate-800">
                            {isKm
                              ? 'ចុចទីនេះដើម្បី Upload រូបភាព Screenshot វិក្កយបត្រ (PNG / JPG)'
                              : isKo
                              ? '이체 확인 스크린샷 업로드 (PNG / JPG)'
                              : 'Click to Upload Transfer Screenshot (PNG / JPG)'}
                          </span>
                          <span className="text-[11px] text-slate-500">
                            {isKm
                              ? 'ត្រូវបង្ហាញច្បាស់៖ ឈ្មោះអ្នកទទួល · ₩35,000 · 이체완료 · ថ្ងៃខែម៉ោងផ្ទេរប្រាក់'
                              : isKo
                              ? '필수 표시: 받는 분 · ₩35,000 · 이체완료 · 거래일시'
                              : 'Must clearly show: Recipient · ₩35,000 · Completed · Date & Time'}
                          </span>
                        </div>
                      )}
                    </label>

                    {/* Required Sender Name Input (must be filled before Verify button activates) */}
                    <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <label
                          htmlFor="kr-receipt-sender-name"
                          className="text-xs font-black text-slate-900 flex items-center gap-1"
                        >
                          <span>
                            {isKm
                              ? 'ឈ្មោះអ្នកផ្ញើរប្រាក់ (Sender Name)'
                              : isKo
                              ? '송금인 이름 (보내는 분)'
                              : 'Sender Name (Bank Account Holder)'}
                          </span>
                          <span className="text-rose-600">*</span>
                        </label>
                        {idCardName && (
                          <button
                            type="button"
                            onClick={() => {
                              setReceiptSenderName(idCardName);
                              setReceiptError(null);
                            }}
                            className="px-2.5 py-1 rounded-lg bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 text-indigo-700 font-bold text-[11px] cursor-pointer transition-colors"
                          >
                            {isKm
                              ? `ប្រើឈ្មោះ ID Card (${idCardName})`
                              : isKo
                              ? `ID 이름 입력 (${idCardName})`
                              : `Use ID Card Name (${idCardName})`}
                          </button>
                        )}
                      </div>
                      <input
                        id="kr-receipt-sender-name"
                        type="text"
                        maxLength={100}
                        value={receiptSenderName}
                        onChange={(e) => {
                          setReceiptSenderName(e.target.value);
                          if (receiptError) setReceiptError(null);
                        }}
                        placeholder={
                          isKm
                            ? 'វាយឈ្មោះអ្នកផ្ញើរប្រាក់លើវិក្កយបត្រ (ឧ. SOK DARA ឬ ឈ្មោះម្ចាស់គណនីផ្ទេរ)...'
                            : isKo
                            ? '이체한 송금인 이름을 입력하세요 (예: SOK DARA)...'
                            : 'Enter the transfer sender name shown on your bank account...'
                        }
                        className={`w-full px-3 py-2.5 rounded-xl bg-white border text-xs sm:text-sm font-bold text-slate-900 focus:outline-none focus:ring-2 transition-colors ${
                          receiptSenderName.trim().length >= 2
                            ? 'border-emerald-400 focus:ring-emerald-400/30'
                            : 'border-slate-300 focus:ring-blue-400/30'
                        }`}
                      />
                      <p className="text-[11px] text-slate-500">
                        {isKm
                          ? 'ត្រូវបំពេញឈ្មោះអ្នកផ្ញើរប្រាក់ និង Upload រូបភាពវិក្កយបត្រជាមុនសិន ទើបប៊ូតុងផ្ទៀងផ្ទាត់ AI បើកដំណើរការ។'
                          : isKo
                          ? '영수증 업로드와 송금인 이름 입력을 모두 완료해야 AI 검증 버튼이 활성화됩니다.'
                          : 'Both the receipt screenshot and Sender Name are required to enable AI verification.'}
                      </p>
                    </div>

                    {/* Primary AI Verify Button */}
                    <button
                      type="button"
                      disabled={!receiptPreview || receiptSenderName.trim().length < 2 || verifyingReceipt}
                      onClick={handleVerifyKrReceipt}
                      className="w-full py-3.5 px-4 rounded-xl bg-gradient-to-r from-blue-600 to-emerald-600 hover:from-blue-700 hover:to-emerald-700 text-white font-black text-xs sm:text-sm shadow-md flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                    >
                      {verifyingReceipt ? (
                        <>
                          <RefreshCw className="w-4 h-4 animate-spin" />
                          <span>
                            {isKm
                              ? 'ជំហានទី៤ · AI កំពុងអានព័ត៌មាន និងផ្ទៀងផ្ទាត់ពេលវេលា...'
                              : isKo
                              ? '4단계 · AI가 영수증 정보 및 거래시간을 검증하는 중...'
                              : 'Step 4 · AI is verifying transfer details & timestamp...'}
                          </span>
                        </>
                      ) : (
                        <>
                          <ShieldCheck className="w-4 h-4" />
                          <span>
                            {isKm
                              ? 'បញ្ជូនទៅ AI ផ្ទៀងផ្ទាត់ & បញ្ចេញ Redeem Code ស្វ័យប្រវត្តិ'
                              : isKo
                              ? 'AI 자동 검증 및 리딤 코드 즉시 발급'
                              : 'Verify Screenshot with AI & Issue Redeem Code'}
                          </span>
                        </>
                      )}
                    </button>

                    {/* Failed Verification Breakdown ("មិនពិត") */}
                    {receiptError && (
                      <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-900 text-xs space-y-2.5">
                        <div className="flex items-start gap-2">
                          <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                          <div className="space-y-0.5">
                            <div className="font-black text-rose-800">
                              {isKm
                                ? 'លទ្ធផល AI៖ មិនពិត (មិនទាន់ឆ្លងកាត់ការផ្ទៀងផ្ទាត់)'
                                : isKo
                                ? 'AI 판정: 불일치 (검증 실패)'
                                : 'AI Verdict: Not Verified (Failed)'}
                            </div>
                            <p className="text-rose-700 leading-relaxed">{receiptError}</p>
                          </div>
                        </div>

                        {receiptChecks && (
                          <div className="grid grid-cols-2 gap-1.5 pt-1 border-t border-rose-200/80 text-[11px]">
                            {[
                              {
                                ok: receiptChecks.recipientMatched,
                                label: isKm ? 'ឈ្មោះអ្នកទទួល' : isKo ? '받는 분 일치' : 'Recipient',
                                val: receiptDetected?.recipientName || '',
                              },
                              {
                                ok: receiptChecks.amountMatched,
                                label: isKm ? 'ទឹកប្រាក់ ₩35,000' : isKo ? '금액 ₩35,000' : 'Amount ₩35,000',
                                val: receiptDetected?.amountKrw ? `₩${receiptDetected.amountKrw.toLocaleString()}` : '',
                              },
                              {
                                ok: receiptChecks.statusSuccess,
                                label: isKm ? 'ស្ថានភាពជោគជ័យ' : isKo ? '이체완료 상태' : 'Transfer Success',
                                val: receiptDetected?.statusText || '',
                              },
                              {
                                ok: receiptChecks.timeVerified,
                                label: isKm ? 'ពេលវេលាផ្ទេរប្រាក់' : isKo ? '거래 시간 검증' : 'Transfer Time',
                                val: receiptDetected?.transferTimestamp || '',
                              },
                            ].map((chk, i) => (
                              <div
                                key={i}
                                className={`px-2 py-1.5 rounded-lg border flex items-center gap-1.5 ${
                                  chk.ok
                                    ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                                    : 'bg-white border-rose-200 text-rose-800'
                                }`}
                              >
                                {chk.ok ? (
                                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                                ) : (
                                  <AlertCircle className="w-3.5 h-3.5 text-rose-600 shrink-0" />
                                )}
                                <span className="truncate font-semibold">
                                  {chk.label}
                                  {chk.val ? `: ${chk.val}` : ''}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    {/* STEP 5: AI Verdict "ពិត" & Automatically Issued Redeem Code */}
                    {issuedKrCode && (
                      <div className="p-4 rounded-2xl bg-emerald-50 border-2 border-emerald-400 text-emerald-950 space-y-3 shadow-sm">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
                            <div>
                              <div className="text-xs sm:text-sm font-black text-emerald-900">
                                {isKm
                                  ? `ជំហានទី៥ · លទ្ធផល AI៖ «${issuedKrCode.verdict}» — ផ្ទៀងផ្ទាត់ត្រឹមត្រូវទាំងអស់!`
                                  : isKo
                                  ? `5단계 · AI 판정: 확인 완료 (${issuedKrCode.verdict}) — 리딤 코드 자동 발급!`
                                  : `Step 5 · AI Verdict: "${issuedKrCode.verdict}" (TRUE) — Redeem Code Issued!`}
                              </div>
                            </div>
                          </div>
                          <span className="text-xs font-black text-emerald-800 tabular-nums">
                            {issuedKrCode.bankName} · ₩{issuedKrCode.verifiedAmount.toLocaleString()}
                          </span>
                        </div>

                        {/* 4 Verified Criteria Summary */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 text-[11px] bg-white/90 p-2.5 rounded-xl border border-emerald-200">
                          <div className="flex items-center gap-1.5 text-emerald-900">
                            <Check className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                            <span className="font-semibold">
                              {isKm ? 'អ្នកទទួល:' : isKo ? '받는 분:' : 'Recipient:'}{' '}
                              <strong>{issuedKrCode.recipientName}</strong>
                            </span>
                          </div>
                          <div className="flex items-center gap-1.5 text-emerald-900 tabular-nums">
                            <Check className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                            <span className="font-semibold">
                              {isKm ? 'ទឹកប្រាក់:' : isKo ? '금액:' : 'Amount:'}{' '}
                              <strong>₩{issuedKrCode.verifiedAmount.toLocaleString()}</strong>
                            </span>
                          </div>
                          <div className="flex items-center gap-1.5 text-emerald-900">
                            <Check className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                            <span className="font-semibold">
                              {isKm ? 'ស្ថានភាព:' : isKo ? '상태:' : 'Status:'}{' '}
                              <strong>{issuedKrCode.statusText}</strong>
                            </span>
                          </div>
                          <div className="flex items-center gap-1.5 text-emerald-900 tabular-nums">
                            <Clock className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                            <span className="font-semibold truncate">
                              {isKm ? 'ពេលវេលា:' : isKo ? '거래일시:' : 'Time:'}{' '}
                              <strong>{issuedKrCode.transferTimestamp || 'Verified'}</strong>
                            </span>
                          </div>
                        </div>

                        {/* Issued Redeem Code Display + Copy + 1-Click Apply & Download */}
                        <div className="p-3 bg-white rounded-xl border-2 border-emerald-300 space-y-2.5">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div>
                              <span className="text-[10.5px] font-bold uppercase tracking-wider text-emerald-700 block">
                                {isKm
                                  ? 'លេខកូដ Redeem Code ដែលប្រព័ន្ធបញ្ចេញដោយស្វ័យប្រវត្តិ៖'
                                  : isKo
                                  ? '자동 발급된 리딤 코드 (Redeem Code):'
                                  : 'Automatically Issued Redeem Code:'}
                              </span>
                              <span className="font-mono font-black text-base sm:text-lg text-slate-900 tracking-wider select-all">
                                {issuedKrCode.code}
                              </span>
                            </div>

                            <button
                              type="button"
                              onClick={() => copyText(issuedKrCode.code, setCopiedKrCode)}
                              className="px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold text-xs flex items-center gap-1.5 cursor-pointer transition-colors"
                            >
                              {copiedKrCode ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                              <span>{copiedKrCode ? (isKm ? 'បានចម្លង!' : 'Copied!') : (isKm ? 'ចម្លងកូដ' : 'Copy')}</span>
                            </button>
                          </div>

                          <button
                            type="button"
                            disabled={isProcessing}
                            onClick={() => verifyCodeAndUnlock(issuedKrCode.code, 'redeem')}
                            className="w-full py-3 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 active:scale-[0.99] text-white font-black text-xs sm:text-sm shadow-md flex items-center justify-center gap-2 cursor-pointer transition-all disabled:opacity-50"
                          >
                            <Zap className="w-4 h-4 text-amber-300" />
                            <span>
                              {isKm
                                ? 'ប្រើលេខកូដនេះ & ទាញយក Clean PDF ភ្លាមៗ'
                                : isKo
                                ? '이 코드로 즉시 잠금 해제 및 Clean PDF 다운로드'
                                : 'Apply Redeem Code & Download Clean PDF Now'}
                            </span>
                            <ArrowRight className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Secondary Fallback: Manual Support via Telegram / Facebook if needed */}
                  {renderScreenshotDeliveryBox('krbank')}
                </div>
              );
            })()}

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

            {/* TAB 3: PAID REDEEM CODE (10,000 GOOGLE SHEET) + SEPARATE PROMO CODE BOX */}
            {activeTab === 'redeem' && (
              <div className="space-y-4">
                <div className="p-3.5 bg-slate-50 rounded-2xl border border-slate-200 text-xs text-slate-700 leading-relaxed">
                  {isKm
                    ? '🔒 លេខកូដ Google Sheet (10,000 កូដ) តម្រូវឱ្យបង់ប្រាក់ជាមុនសិន ទើបអាចដោះសោបាននៅប្រអប់ Redeem Code ខាងឆ្វេង។ ប្រសិនបើអ្នកមាន Promo Code ពី Admin Dashboard សូមវាយបញ្ចូលក្នុងប្រអប់ Promo Code ផ្សេងខាងស្តាំ៖'
                    : isKo
                    ? '🔒 Google Sheet 10,000개 리딤 코드는 결제 완료 후 왼쪽 리딤 코드 입력란에서 잠금 해제할 수 있습니다. 관리자 프로모션 코드는 오른쪽 전용 입력란에 입력해 주세요.'
                    : '🔒 Google Sheet (10,000) Redeem Codes require payment first before unlocking in the Redeem Code box. If you have an Admin Promo Code, enter it in the separate Promo Code box:'}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                  {/* Card 1: Paid Redeem Code Box */}
                  <div className="p-4 rounded-2xl bg-indigo-50/70 border border-indigo-200 space-y-3">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-xl bg-indigo-600 text-white flex items-center justify-center shrink-0 shadow-xs">
                        <Ticket className="w-4 h-4" />
                      </div>
                      <div>
                        <h4 className="text-xs sm:text-sm font-black text-indigo-950">
                          {isKm ? '1. ប្រអប់ Redeem Code (ក្រោយបង់ប្រាក់)' : isKo ? '1. 리딤 코드 (결제 완료 후)' : '1. Paid Redeem Code'}
                        </h4>
                        <p className="text-[11px] text-indigo-700">
                          {isKm ? '10,000 កូដ Google Sheet (ត្រូវបង់ប្រាក់ជាមុន)' : 'Google Sheet 10,000 (Payment Required)'}
                        </p>
                      </div>
                    </div>

                    <div className="relative">
                      <Ticket className="w-4 h-4 text-indigo-500 absolute left-3 top-3" />
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
                        placeholder={isKm ? 'កូដក្រោយបង់ប្រាក់...' : 'Paid Redeem Code...'}
                        className="w-full pl-9 pr-14 py-2.5 rounded-xl bg-white border border-indigo-300 text-xs sm:text-sm font-mono tracking-wider font-bold uppercase focus:border-indigo-600 focus:ring-2 focus:ring-indigo-100 outline-none"
                      />
                      {redeemCode && (
                        <button
                          type="button"
                          onClick={() => setRedeemCode('')}
                          className="absolute right-2.5 top-2.5 text-[11px] text-slate-400 hover:text-slate-600 px-1.5 py-0.5 rounded cursor-pointer"
                        >
                          {t.clearBtn}
                        </button>
                      )}
                    </div>

                    {redeemError && (
                      <div className="p-2 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-start gap-2">
                        <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                        <span>{redeemError}</span>
                      </div>
                    )}

                    <button
                      type="button"
                      disabled={isProcessing}
                      onClick={() => verifyCodeAndUnlock(redeemCode, 'redeem')}
                      className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-black text-xs sm:text-sm rounded-xl shadow-md flex items-center justify-center gap-2 transition-all cursor-pointer disabled:opacity-60"
                    >
                      {isProcessing ? (
                        <>
                          <RefreshCw className="w-4 h-4 animate-spin text-white" />
                          <span>{processingStep}</span>
                        </>
                      ) : (
                        <>
                          <Ticket className="w-4 h-4 text-white" />
                          <span>{isKm ? 'ដោះសោដោយ Redeem Code' : isKo ? '리딤 코드로 잠금 해제' : 'Unlock with Redeem Code'}</span>
                        </>
                      )}
                    </button>
                  </div>

                  {/* Card 2: Separate Promo Code Box */}
                  <div className="p-4 rounded-2xl bg-purple-50/70 border border-purple-200 space-y-3">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-xl bg-purple-600 text-white flex items-center justify-center shrink-0 shadow-xs">
                        <Gift className="w-4 h-4" />
                      </div>
                      <div>
                        <h4 className="text-xs sm:text-sm font-black text-purple-950">
                          {isKm ? '2. ប្រអប់ Promo Code ផ្សេង' : isKo ? '2. 프로모션 코드 전용 (Promo)' : '2. Separate Promo Code Box'}
                        </h4>
                        <p className="text-[11px] text-purple-700">
                          {isKm ? 'Promo Code ពី Admin Dashboard (ដោះសោឥតគិតថ្លៃ)' : 'Admin Dashboard Promo Codes Only (Free)'}
                        </p>
                      </div>
                    </div>

                    <div className="relative">
                      <Gift className="w-4 h-4 text-purple-500 absolute left-3 top-3" />
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
                        placeholder={isKm ? 'ឧ. KIIP-PROMO...' : 'e.g. KIIP-PROMO...'}
                        className="w-full pl-9 pr-14 py-2.5 rounded-xl bg-white border border-purple-300 text-xs sm:text-sm font-mono tracking-wider font-bold uppercase focus:border-purple-600 focus:ring-2 focus:ring-purple-100 outline-none"
                      />
                      {promoCodeInput && (
                        <button
                          type="button"
                          onClick={() => setPromoCodeInput('')}
                          className="absolute right-2.5 top-2.5 text-[11px] text-slate-400 hover:text-slate-600 px-1.5 py-0.5 rounded cursor-pointer"
                        >
                          {t.clearBtn}
                        </button>
                      )}
                    </div>

                    {promoCodeError && (
                      <div className="p-2 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-start gap-2">
                        <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                        <span>{promoCodeError}</span>
                      </div>
                    )}

                    <button
                      type="button"
                      disabled={isProcessing}
                      onClick={() => verifyCodeAndUnlock(promoCodeInput, 'promo')}
                      className="w-full py-2.5 bg-gradient-to-r from-purple-600 to-fuchsia-600 hover:from-purple-700 hover:to-fuchsia-700 text-white font-black text-xs sm:text-sm rounded-xl shadow-md flex items-center justify-center gap-2 transition-all cursor-pointer disabled:opacity-60"
                    >
                      {isProcessing ? (
                        <>
                          <RefreshCw className="w-4 h-4 animate-spin text-white" />
                          <span>{processingStep}</span>
                        </>
                      ) : (
                        <>
                          <Gift className="w-4 h-4 text-white" />
                          <span>{isKm ? 'ដោះសោដោយ Promo Code' : isKo ? '프로모션 코드로 잠금 해제' : 'Unlock with Promo Code'}</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setActiveTab('krbank')}
                    className="px-4 py-2.5 rounded-xl bg-emerald-50 hover:bg-emerald-100 text-emerald-900 font-bold text-xs border border-emerald-200 cursor-pointer"
                  >
                    🇰🇷 {isKm ? 'បង់តាមធនាគារកូរ៉េ' : 'Korea Bank'}
                  </button>

                  <button
                    type="button"
                    onClick={() => setActiveTab('khqr')}
                    className="px-4 py-2.5 rounded-xl bg-sky-50 hover:bg-sky-100 text-[#004f80] font-bold text-xs border border-sky-200 cursor-pointer"
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
