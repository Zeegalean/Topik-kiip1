import React, { useState } from 'react';
import {
  ArrowRight,
  Clock,
  ShieldCheck,
  Wallet,
  ExternalLink,
  Copy,
  Check,
  MessageCircle,
  KeyRound,
  User,
} from 'lucide-react';
import { Language } from '../types';

interface AboutMePageProps {
  lang: Language;
  onStartApplication: () => void;
  onOpenPayment?: () => void;
}

const PROFILE_IMAGE_PATH = '/assets/aistudio/b315a395-5f7a-45e1-8f72-2e787ca251fb_12dc3517.jfif';
const FACEBOOK_URL = 'https://www.facebook.com/eang.veasna.667/';
const KAKAOTALK_ID = '9111veasna';

export const AboutMePage: React.FC<AboutMePageProps> = ({
  lang,
  onStartApplication,
  onOpenPayment,
}) => {
  const isKm = lang === 'km';
  const isKo = lang === 'ko';
  const [copiedKakao, setCopiedKakao] = useState(false);
  const [imgError, setImgError] = useState(false);

  const handleCopyKakao = async () => {
    try {
      await navigator.clipboard.writeText(KAKAOTALK_ID);
      setCopiedKakao(true);
      setTimeout(() => setCopiedKakao(false), 2000);
    } catch {
      // Fallback copy
      const el = document.createElement('textarea');
      el.value = KAKAOTALK_ID;
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
      setCopiedKakao(true);
      setTimeout(() => setCopiedKakao(false), 2000);
    }
  };

  return (
    <article className="space-y-8 pb-8 animate-in fade-in duration-300">
      {/* Main Editorial Split Card */}
      <section className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="grid grid-cols-1 lg:grid-cols-12 items-stretch">
          {/* Left Column: Portrait Frame */}
          <div className="lg:col-span-5 bg-slate-900 text-white p-6 sm:p-8 flex flex-col justify-between gap-6">
            <div className="space-y-1">
              <p className="text-xs font-medium text-slate-400">
                {isKm ? 'អំពីខ្ញុំ · អ្នកបង្កើតគេហទំព័រ' : isKo ? '소개 · 포털 운영자' : 'About Me · Portal Creator'}
              </p>
              <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-white">
                Eang Veasna
              </h1>
              <p className="text-xs text-slate-300">
                KIIP · TOPIK Linkage Portal · South Korea
              </p>
            </div>

            {/* Clean Portrait Image */}
            <div className="relative mx-auto w-full max-w-[280px] aspect-[4/5] rounded-xl overflow-hidden bg-slate-800 border border-white/15 shadow-lg">
              {!imgError ? (
                <img
                  src={PROFILE_IMAGE_PATH}
                  alt="Eang Veasna — Founder of KIIP & TOPIK Linkage Portal"
                  referrerPolicy="no-referrer"
                  onError={() => setImgError(true)}
                  className="w-full h-full object-cover object-top"
                />
              ) : (
                <div className="w-full h-full flex flex-col items-center justify-center gap-2 bg-slate-800 text-slate-300 p-4 text-center">
                  <User className="w-12 h-12 text-slate-400" />
                  <span className="text-sm font-semibold">Eang Veasna</span>
                </div>
              )}
            </div>

            {/* Quiet Unboxed Footer Metadata */}
            <div className="pt-4 border-t border-white/10 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-300">
              <span>Facebook · eang.veasna.667</span>
              <span className="font-mono tabular-nums text-amber-300">KakaoTalk: {KAKAOTALK_ID}</span>
            </div>
          </div>

          {/* Right Column: Official Welcome Script & Primary Actions */}
          <div className="lg:col-span-7 p-6 sm:p-10 flex flex-col justify-between gap-8">
            <div className="space-y-5">
              <div className="space-y-2">
                <p className="text-xs font-semibold text-indigo-600">
                  {isKm
                    ? 'សារស្វាគមន៍ពីស្ថាបនិក'
                    : isKo
                    ? '운영자 인사말 · TOPIK → KIIP'
                    : 'Welcome Message · About This Portal'}
                </p>
                <h2 className="text-2xl sm:text-[28px] font-bold text-slate-900 tracking-tight leading-snug text-balance">
                  សូមស្វាគមន៍មកកាន់គេហទំព័ររបស់យើង!
                </h2>
              </div>

              {/* Exact Requested Khmer Script — Structured for Effortless Reading */}
              <div className="space-y-4 text-[15px] text-slate-700 leading-[1.95]">
                <p>
                  សូមស្វាគមន៍មកកាន់គេហទំព័ររបស់យើង! បង្កើតឡើងក្នុងគោលបំណងសម្រួលដល់កិច្ចការរដ្ឋបាលរបស់សាសនុសិស្ស ឬ ពលរក ឬ បុគ្គលដែលចង់ផ្លាស់ប្តូរពិន្ទុ{' '}
                  <strong className="font-semibold text-slate-900">Topik ទៅ KIIP 사회통합프로그램</strong>{' '}
                  ឬ ដើម្បីឯកសារសម្រាប់ការចុះឈ្មោះចូលរៀន។
                </p>

                <p>
                  លោកអ្នកអាចបង្កើតឯកសារជាទម្រង់{' '}
                  <strong className="font-semibold text-slate-900">PDF បានយ៉ាងឆាប់រហ័ស ត្រឹមតែ ១ នាទីប៉ុណ្ណោះ</strong>{' '}
                  ដែលជួយសន្សំសំចៃពេលវេលា និងធានាបាននូវសុវត្ថិភាពព័ត៌មានផ្ទាល់ខ្លួន មិនឱ្យបែកធ្លាយទៅកាន់ភាគីទីបីឡើយ។ ជាពិសេស បញ្ចៀសការចំណាយ និងហានិភ័យ ក្នុងការជួលសេវាកម្មខាងក្រៅ។
                </p>

                <p>
                  បន្ទាប់ពីការទូទាត់ប្រាក់ សូមផ្ញើរូបភាពអេក្រង់នៃការទូទាត់មកកាន់ ហ្វេសប៊ុកផេករបស់យើង{' '}
                  <a
                    href={FACEBOOK_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-semibold text-indigo-600 hover:text-indigo-800 underline underline-offset-4 break-all"
                  >
                    https://www.facebook.com/eang.veasna.667/
                  </a>{' '}
                  ឬ{' '}
                  <strong className="font-semibold text-slate-900 font-mono">
                    Kakaotalk ID: 9111veasna
                  </strong>{' '}
                  ដើម្បីទទួលបានលេខកូដដោះ សោឯកសារត្រឡប់ទៅវិញ យ៉ាងរហ័ស និងមានសុវត្ថិភាព។
                </p>
              </div>
            </div>

            {/* Primary & Secondary Action Bar */}
            <div className="pt-6 border-t border-slate-100 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={onStartApplication}
                className="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold transition-colors inline-flex items-center gap-2 cursor-pointer whitespace-nowrap shrink-0 shadow-xs"
              >
                <span>
                  {isKm
                    ? 'ចាប់ផ្តើមបង្កើតឯកសារ PDF'
                    : isKo
                    ? 'PDF 신청서 작성 시작'
                    : 'Start Creating PDF'}
                </span>
                <ArrowRight className="w-4 h-4 shrink-0" />
              </button>

              {onOpenPayment && (
                <button
                  type="button"
                  onClick={onOpenPayment}
                  className="px-4 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 text-sm font-semibold transition-colors inline-flex items-center gap-2 cursor-pointer whitespace-nowrap shrink-0"
                >
                  <KeyRound className="w-4 h-4 text-slate-600 shrink-0" />
                  <span>
                    {isKm
                      ? 'បញ្ចូលលេខកូដដោះសោ'
                      : isKo
                      ? '잠금해제 코드 입력'
                      : 'Enter Unlock Code'}
                  </span>
                </button>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* 3 Key Benefits Row (Flat, Single Elevation, Clean Dividers) */}
      <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-2">
          <div className="w-9 h-9 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center">
            <Clock className="w-4 h-4" />
          </div>
          <h3 className="text-base font-bold text-slate-900">
            {isKm ? '01. រហ័សត្រឹម ១ នាទី' : isKo ? '01. 단 1분 만에 PDF 완성' : '01. Ready in 1 Minute'}
          </h3>
          <p className="text-xs sm:text-sm text-slate-600 leading-relaxed">
            {isKm
              ? 'បំពេញទម្រង់ និងបញ្ចូលឯកសារជា PDF ស្តង់ដារដោយស្វ័យប្រវត្តិ សន្សំសំចៃពេលវេលាច្រើនបំផុត។'
              : isKo
              ? '신청서와 증빙 서류를 자동으로 하나의 PDF로 병합하여 시간을 절약합니다.'
              : 'Automatically assemble your official TOPIK-to-KIIP form and attachments into a single print-ready PDF.'}
          </p>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-2">
          <div className="w-9 h-9 rounded-lg bg-emerald-50 text-emerald-700 flex items-center justify-center">
            <ShieldCheck className="w-4 h-4" />
          </div>
          <h3 className="text-base font-bold text-slate-900">
            {isKm ? '02. សុវត្ថិភាពព័ត៌មានផ្ទាល់ខ្លួន' : isKo ? '02. 개인정보 안전 보호' : '02. Private & Secure'}
          </h3>
          <p className="text-xs sm:text-sm text-slate-600 leading-relaxed">
            {isKm
              ? 'ធានាបាននូវសុវត្ថិភាពព័ត៌មានផ្ទាល់ខ្លួន មិនឱ្យបែកធ្លាយទៅកាន់ភាគីទីបីឡើយ។'
              : isKo
              ? '개인 신분증 및 서류 정보가 제3자에게 유출되지 않도록 안전하게 보호합니다.'
              : 'Your personal identity documents remain under your direct control with zero leakage to third-party brokers.'}
          </p>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-2">
          <div className="w-9 h-9 rounded-lg bg-amber-50 text-amber-700 flex items-center justify-center">
            <Wallet className="w-4 h-4" />
          </div>
          <h3 className="text-base font-bold text-slate-900">
            {isKm ? '03. កាត់បន្ថយចំណាយ & ហានិភ័យ' : isKo ? '03. 비용 절감 및 위험 예방' : '03. Avoid Agency Fees'}
          </h3>
          <p className="text-xs sm:text-sm text-slate-600 leading-relaxed">
            {isKm
              ? 'បញ្ចៀសការចំណាយខ្ពស់ និងហានិភ័យក្នុងការជួលសេវាកម្មរៀបចំឯកសារខាងក្រៅ។'
              : isKo
              ? '외부 대행 서비스 이용 시 발생하는 높은 비용과 개인정보 노출 위험을 줄입니다.'
              : 'Prepare and verify your own application documents without expensive external service fees.'}
          </p>
        </div>
      </section>

      {/* Direct Contact & Fast Unlock Code Verification */}
      <section className="bg-white rounded-2xl border border-slate-200 p-6 sm:p-8 space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-2 pb-4 border-b border-slate-100">
          <div>
            <p className="text-xs font-medium text-slate-500">
              {isKm ? 'ទំនាក់ទំនងផ្ទាល់ · ទទួលលេខកូដដោះសោរហ័ស' : isKo ? '직접 문의 · 빠른 잠금해제 코드 발급' : 'Direct Support · Fast Unlock Code Delivery'}
            </p>
            <h3 className="text-lg sm:text-xl font-bold text-slate-900 mt-0.5">
              {isKm
                ? 'ផ្ញើរូបភាពអេក្រង់នៃការទូទាត់ដើម្បីទទួលលេខកូដដោះសោ'
                : isKo
                ? '결제 스크린샷 전송 및 잠금해제 코드 받기'
                : 'Send Payment Screenshot for Your Unlock Code'}
            </h3>
          </div>
          <span className="text-xs text-slate-500">
            {isKm ? 'ឆ្លើយតបរហ័ស និងមានសុវត្ថិភាព' : isKo ? '신속하고 안전한 응대' : 'Fast & secure verification'}
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Facebook Page Channel */}
          <div className="rounded-xl border border-slate-200 p-5 flex flex-col justify-between gap-4 bg-slate-50/50">
            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-blue-700">Facebook Page</span>
                <span className="text-xs text-slate-400">Messenger</span>
              </div>
              <p className="text-base font-bold text-slate-900">Eang Veasna</p>
              <p className="text-xs text-slate-600 break-all font-mono">{FACEBOOK_URL}</p>
            </div>
            <a
              href={FACEBOOK_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="w-full py-2.5 px-4 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs sm:text-sm font-semibold transition-colors inline-flex items-center justify-center gap-2 whitespace-nowrap"
            >
              <MessageCircle className="w-4 h-4 shrink-0" />
              <span>{isKm ? 'បើកហ្វេសប៊ុកផេក (ផ្ញើសារ)' : isKo ? '페이스북 페이지 열기' : 'Open Facebook Page'}</span>
              <ExternalLink className="w-3.5 h-3.5 shrink-0" />
            </a>
          </div>

          {/* KakaoTalk ID Channel */}
          <div className="rounded-xl border border-slate-200 p-5 flex flex-col justify-between gap-4 bg-slate-50/50">
            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-amber-800">KakaoTalk ID</span>
                <span className="text-xs text-slate-400">Korea Instant Support</span>
              </div>
              <p className="text-lg font-bold text-slate-900 font-mono tracking-tight select-all">
                {KAKAOTALK_ID}
              </p>
              <p className="text-xs text-slate-600">
                {isKm
                  ? 'ចម្លង ID នេះទៅស្វែងរកក្នុង KakaoTalk ដើម្បីផ្ញើរូបភាពបង្កាន់ដៃទូទាត់ប្រាក់។'
                  : isKo
                  ? '카카오톡에서 아이디를 추가한 뒤 결제 스크린샷을 보내주세요.'
                  : 'Add this ID on KakaoTalk and send your payment confirmation screenshot.'}
              </p>
            </div>
            <button
              type="button"
              onClick={handleCopyKakao}
              className={`w-full py-2.5 px-4 rounded-xl text-xs sm:text-sm font-semibold transition-colors inline-flex items-center justify-center gap-2 cursor-pointer whitespace-nowrap ${
                copiedKakao
                  ? 'bg-emerald-600 text-white'
                  : 'bg-amber-400 hover:bg-amber-500 text-slate-950'
              }`}
            >
              {copiedKakao ? (
                <>
                  <Check className="w-4 h-4 shrink-0" />
                  <span>{isKm ? 'បានចម្លង KakaoTalk ID រួចរាល់!' : isKo ? 'ID가 복사되었습니다!' : 'Copied KakaoTalk ID!'}</span>
                </>
              ) : (
                <>
                  <Copy className="w-4 h-4 shrink-0" />
                  <span>{isKm ? 'ចម្លង KakaoTalk ID (9111veasna)' : isKo ? '카카오톡 ID 복사 (9111veasna)' : 'Copy KakaoTalk ID (9111veasna)'}</span>
                </>
              )}
            </button>
          </div>
        </div>
      </section>
    </article>
  );
};
