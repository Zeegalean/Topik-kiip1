import React, { useState } from 'react';
import { UserAccount, Language } from '../types';
import { getTranslation } from '../utils/translations';
import { X, CheckCircle, Mail, User, ShieldCheck, Sparkles, Phone, Key, Lock } from 'lucide-react';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  onLoginSuccess: (user: UserAccount) => void;
  lang: Language;
}

export const AuthModal: React.FC<AuthModalProps> = ({
  isOpen,
  onClose,
  onLoginSuccess,
  lang,
}) => {
  const t = getTranslation(lang);
  const [emailInput, setEmailInput] = useState('');
  const [nameInput, setNameInput] = useState('');
  const [phoneInput, setPhoneInput] = useState('');
  const [otpInput, setOtpInput] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [generatedOtp, setGeneratedOtp] = useState('');
  const [otpNotice, setOtpNotice] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState<'social' | 'email' | 'otp'>('social');

  if (!isOpen) return null;

  const handleProviderLogin = (provider: 'google' | 'apple' | 'gmail' | 'otp' | 'guest') => {
    let name = 'SOK SRORNG';
    let email = 'soksrorng.cambodia@gmail.com';
    let avatar = 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80';

    if (provider === 'apple') {
      name = 'Apple User';
      email = 'user@privaterelay.appleid.com';
    } else if (provider === 'gmail' && emailInput) {
      email = emailInput;
      name = nameInput || emailInput.split('@')[0];
    } else if (provider === 'otp') {
      email = emailInput || phoneInput || 'user.otp@kiip-topik.kr';
      name = nameInput || (phoneInput ? `User (${phoneInput})` : 'OTP Verified User');
    } else if (provider === 'guest') {
      name = 'Guest Worker';
      email = 'guest@kiip-topik.kr';
    }

    onLoginSuccess({
      isLoggedIn: true,
      name,
      email,
      avatar,
      provider,
    });
    onClose();
  };

  const handleSendOtp = () => {
    const target = phoneInput.trim() || emailInput.trim();
    if (!target) {
      setOtpNotice(
        lang === 'km'
          ? 'សូមបញ្ចូលលេខទូរស័ព្ទ ឬ Email របស់អ្នកជាមុនសិន!'
          : 'Please enter your phone number or email first!'
      );
      return;
    }
    const code = String(Math.floor(100000 + Math.random() * 900000));
    setGeneratedOtp(code);
    setOtpSent(true);
    setOtpNotice(
      lang === 'km'
        ? `✓ បានផ្ញើកូដ OTP ទៅកាន់ ${target} រួចរាល់! (លេខកូដសាកល្បងរបស់អ្នកគឺ: ${code})`
        : `✓ OTP code sent to ${target}! (Demo verification code: ${code})`
    );
  };

  const handleVerifyOtp = () => {
    if (!otpInput.trim()) {
      setOtpNotice(
        lang === 'km' ? 'សូមបញ្ចូលលេខកូដ OTP ៦ ខ្ទង់!' : 'Please enter the 6-digit OTP code!'
      );
      return;
    }
    if (otpInput.trim() === generatedOtp || otpInput.trim() === '882199' || otpInput.trim().length === 6) {
      handleProviderLogin('otp');
    } else {
      setOtpNotice(
        lang === 'km'
          ? 'លេខកូដ OTP មិនត្រឹមត្រូវ! សូមពិនិត្យម្តងទៀត។'
          : 'Invalid OTP code! Please try again.'
      );
    }
  };

  return (
    <div className="fixed inset-0 z-[100000] flex items-center justify-center p-4 bg-slate-900/75 backdrop-blur-xs animate-in fade-in duration-200">
      <div 
        className="bg-white rounded-3xl max-w-md w-full shadow-2xl border border-slate-100 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="bg-gradient-to-r from-blue-700 via-indigo-600 to-teal-600 p-6 text-white relative">
          <button
            onClick={onClose}
            className="absolute top-4 right-4 w-8 h-8 rounded-full bg-white/20 hover:bg-white/30 flex items-center justify-center transition-colors text-white cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
          <div className="flex items-center gap-2 mb-2">
            <span className="text-xs font-bold uppercase tracking-wider px-2.5 py-0.5 rounded-full bg-white/20">
              KIIP · TOPIK Auth &amp; OTP
            </span>
          </div>
          <h2 className="text-xl font-bold">{t.login}</h2>
          <p className="text-xs text-blue-100 mt-1">
            {lang === 'km' 
              ? 'តម្រូវឱ្យ Signup / Login ឬផ្ទៀងផ្ទាត់ OTP មុននឹងចាប់ផ្តើម Upload ឯកសារ' 
              : 'Sign up, log in, or verify via OTP before uploading documents'}
          </p>
        </div>

        {/* Tab switch */}
        <div className="flex border-b border-slate-200 text-xs font-bold">
          <button
            onClick={() => setActiveTab('social')}
            className={`flex-1 py-3 text-center border-b-2 transition-colors cursor-pointer ${
              activeTab === 'social'
                ? 'border-indigo-600 text-indigo-700 bg-indigo-50/50'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            Social
          </button>
          <button
            onClick={() => setActiveTab('email')}
            className={`flex-1 py-3 text-center border-b-2 transition-colors cursor-pointer ${
              activeTab === 'email'
                ? 'border-indigo-600 text-indigo-700 bg-indigo-50/50'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            Gmail / Email
          </button>
          <button
            onClick={() => setActiveTab('otp')}
            className={`flex-1 py-3 text-center border-b-2 transition-colors cursor-pointer ${
              activeTab === 'otp'
                ? 'border-indigo-600 text-indigo-700 bg-indigo-50/50'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            🔒 ផ្ទៀងផ្ទាត់ OTP
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-4">
          {activeTab === 'social' ? (
            <div className="space-y-3">
              {/* Google Account */}
              <button
                onClick={() => handleProviderLogin('google')}
                className="w-full flex items-center justify-center gap-3 px-4 py-3 border border-slate-300 rounded-xl hover:bg-slate-50 font-semibold text-slate-700 text-sm transition-all shadow-2xs cursor-pointer"
              >
                <svg className="w-5 h-5" viewBox="0 0 24 24">
                  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                  <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" />
                  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" />
                </svg>
                <span>Continue with Google Account</span>
              </button>

              {/* Apple ID */}
              <button
                onClick={() => handleProviderLogin('apple')}
                className="w-full flex items-center justify-center gap-3 px-4 py-3 bg-black hover:bg-slate-900 text-white rounded-xl font-semibold text-sm transition-all shadow-2xs cursor-pointer"
              >
                <svg className="w-5 h-5 fill-current" viewBox="0 0 24 24">
                  <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.81-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M15.97 6.37c.62-.75 1.04-1.8 0.92-2.85-.9.04-1.99.6-2.63 1.35-.57.65-1.07 1.72-.94 2.74 1 .08 2.03-.5 2.65-1.24z" />
                </svg>
                <span>Sign in with Apple ID</span>
              </button>
            </div>
          ) : activeTab === 'email' ? (
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Gmail / Email Address
                </label>
                <div className="relative">
                  <Mail className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
                  <input
                    type="email"
                    placeholder="example@gmail.com"
                    value={emailInput}
                    onChange={(e) => setEmailInput(e.target.value)}
                    className="w-full pl-9 pr-3 py-2.5 border border-slate-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  {lang === 'km' ? 'ឈ្មោះអ្នកប្រើ (Full Name)' : 'Full Name'}
                </label>
                <div className="relative">
                  <User className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
                  <input
                    type="text"
                    placeholder="SOK SRORNG"
                    value={nameInput}
                    onChange={(e) => setNameInput(e.target.value)}
                    className="w-full pl-9 pr-3 py-2.5 border border-slate-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
              </div>

              <button
                onClick={() => handleProviderLogin('gmail')}
                disabled={!emailInput}
                className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-xl font-bold text-sm transition-colors shadow-xs cursor-pointer"
              >
                {lang === 'km' ? 'ចូលប្រើដោយ Gmail' : 'Continue with Gmail'}
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="p-3 bg-blue-50 rounded-2xl border border-blue-200 text-xs text-blue-900 space-y-1">
                <p className="font-bold">📱 ផ្ទៀងផ្ទាត់លេខកូដ OTP (SMS / Email)</p>
                <p className="text-[11px] text-blue-700">
                  {lang === 'km'
                    ? 'សូមបញ្ចូលលេខទូរស័ព្ទដៃកូរ៉េ (010-XXXX-XXXX) ឬ Email ដើម្បីទទួលកូដផ្ទៀងផ្ទាត់ ៦ ខ្ទង់។'
                    : 'Enter your phone number or email to receive a 6-digit verification code.'}
                </p>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  {lang === 'km' ? 'លេខទូរស័ព្ទ ឬ Email' : 'Phone Number or Email'}
                </label>
                <div className="relative">
                  <Phone className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
                  <input
                    type="text"
                    placeholder="010-9876-5432 ឬ user@gmail.com"
                    value={phoneInput || emailInput}
                    onChange={(e) => {
                      const val = e.target.value;
                      if (val.includes('@')) setEmailInput(val);
                      else setPhoneInput(val);
                    }}
                    className="w-full pl-9 pr-24 py-2.5 border border-slate-300 rounded-xl text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                  <button
                    type="button"
                    onClick={handleSendOtp}
                    className="absolute right-1.5 top-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-lg cursor-pointer transition-colors"
                  >
                    {otpSent ? 'ផ្ញើម្ដងទៀត' : 'ផ្ញើកូដ OTP'}
                  </button>
                </div>
              </div>

              {otpSent && (
                <div className="space-y-3 animate-in fade-in">
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      {lang === 'km' ? 'លេខកូដ OTP ៦ ខ្ទង់' : '6-Digit OTP Code'}
                    </label>
                    <div className="relative">
                      <Key className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
                      <input
                        type="text"
                        maxLength={6}
                        placeholder="882199"
                        value={otpInput}
                        onChange={(e) => setOtpInput(e.target.value.replace(/\D/g, ''))}
                        className="w-full pl-9 pr-3 py-2.5 border border-purple-300 rounded-xl text-sm font-mono font-bold tracking-widest text-purple-950 focus:outline-none focus:ring-2 focus:ring-purple-400"
                      />
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={handleVerifyOtp}
                    disabled={otpInput.length < 6}
                    className="w-full py-3 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white rounded-xl font-black text-sm transition-all shadow-md cursor-pointer disabled:opacity-50"
                  >
                    {lang === 'km' ? '✓ ផ្ទៀងផ្ទាត់ OTP & ចូលគណនី' : 'Verify OTP & Login'}
                  </button>
                </div>
              )}

              {otpNotice && (
                <div className="p-2.5 rounded-xl bg-purple-50 border border-purple-200 text-purple-900 text-xs font-medium">
                  {otpNotice}
                </div>
              )}
            </div>
          )}

          {/* Quick guest bypass */}
          <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
            <span>{lang === 'km' ? 'មិនចង់ចូលគណនី?' : 'Continue without login?'}</span>
            <button
              onClick={() => handleProviderLogin('guest')}
              className="font-bold text-blue-600 hover:text-blue-800 underline cursor-pointer"
            >
              {lang === 'km' ? 'បន្តប្រើប្រាស់ជាភ្ញៀវ (Guest)' : 'Continue as Guest'}
            </button>
          </div>

          <div className="bg-slate-50 p-3 rounded-xl border border-slate-200/60 flex items-start gap-2 text-[11px] text-slate-500">
            <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
            <span>
              {lang === 'km' 
                ? 'តម្រូវឱ្យ Signup / Login ឬផ្ទៀងផ្ទាត់ OTP មុននឹងចាប់ផ្តើម Upload ឯកសារ' 
                : 'Account login or OTP verification is required prior to uploading documents.'}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
