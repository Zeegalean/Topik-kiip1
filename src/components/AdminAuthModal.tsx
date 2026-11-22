import React, { useState, useEffect } from "react";
import { Shield, Lock, User, X, AlertCircle, CheckCircle2, RefreshCw } from "lucide-react";
import { Language } from "../types";

interface AdminAuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (session: { token: string; username: string }) => void;
  lang?: Language;
}

export const AdminAuthModal: React.FC<AdminAuthModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  lang = "km",
}) => {
  const isKm = lang === "km";
  const [username, setUsername] = useState("Admin");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [needsSetup, setNeedsSetup] = useState<boolean>(false);
  const [checkingStatus, setCheckingStatus] = useState<boolean>(false);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    let mounted = true;
    setErrorMsg(null);
    setCheckingStatus(true);
    fetch("/api/admin/auth-status")
      .then((r) => r.json())
      .then((data) => {
        if (mounted && data?.success) {
          setNeedsSetup(Boolean(data.needsSetup));
        }
      })
      .catch(() => {
        if (mounted) setNeedsSetup(false);
      })
      .finally(() => {
        if (mounted) setCheckingStatus(false);
      });
    return () => {
      mounted = false;
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    const trimmedUser = username.trim();
    if (!trimmedUser || !password) {
      setErrorMsg(isKm ? "សូមបញ្ចូល Admin ID និង Password!" : "Please enter Admin ID and password.");
      return;
    }

    if (needsSetup) {
      if (password.length < 8) {
        setErrorMsg(isKm ? "ពាក្យសម្ងាត់ត្រូវមានយ៉ាងតិច ៨ តួអក្សរ!" : "Password must be at least 8 characters.");
        return;
      }
      if (password !== confirmPassword) {
        setErrorMsg(isKm ? "ការបញ្ជាក់ពាក្យសម្ងាត់មិនត្រូវគ្នាទេ!" : "Passwords do not match.");
        return;
      }
    }

    setSubmitting(true);
    try {
      const endpoint = needsSetup ? "/api/admin/bootstrap" : "/api/admin/login";
      const resp = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: trimmedUser, password }),
      });
      const data = await resp.json().catch(() => ({}));

      if (resp.ok && data?.success && data?.token) {
        setPassword("");
        setConfirmPassword("");
        onSuccess({ token: data.token, username: data.username || trimmedUser });
        onClose();
      } else {
        if (data?.needsSetup) {
          setNeedsSetup(true);
        }
        setErrorMsg(
          data?.error ||
            (isKm ? "Admin ID ឬ ពាក្យសម្ងាត់មិនត្រឹមត្រូវ!" : "Invalid Admin ID or password.")
        );
      }
    } catch {
      setErrorMsg(isKm ? "មិនអាចភ្ជាប់ទៅម៉ាស៊ីនមេផ្ទៀងផ្ទាត់បានទេ។" : "Cannot connect to authentication server.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[100003] bg-slate-900/80 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-3xl max-w-sm w-full shadow-2xl border border-slate-200 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 p-5 text-white flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-indigo-600/40 border border-indigo-400/40 flex items-center justify-center text-indigo-300">
              <Shield className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-bold text-sm">
                {needsSetup
                  ? isKm
                    ? "កំណត់គណនី Admin លើកដំបូង"
                    : "First-Run Admin Setup"
                  : isKm
                  ? "ចូលប្រព័ន្ធ Admin Dashboard"
                  : "Admin Login"}
              </h3>
              <p className="text-[10px] text-slate-400">
                {isKm ? "ផ្ទៀងផ្ទាត់ដោយសុវត្ថិភាពលើ Server" : "Server-verified admin session"}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {checkingStatus ? (
            <div className="py-6 flex items-center justify-center gap-2 text-xs text-slate-500">
              <RefreshCw className="w-4 h-4 animate-spin text-indigo-600" />
              <span>{isKm ? "កំពុងពិនិត្យសុវត្ថិភាព..." : "Checking server security status..."}</span>
            </div>
          ) : (
            <>
              {needsSetup && (
                <div className="p-3 rounded-xl bg-indigo-50 border border-indigo-200 text-indigo-900 text-[11px] leading-relaxed flex items-start gap-2">
                  <CheckCircle2 className="w-4 h-4 text-indigo-600 shrink-0 mt-0.5" />
                  <span>
                    {isKm
                      ? "សូមកំណត់ Admin ID (ឧ. Admin) និងពាក្យសម្ងាត់ផ្ទាល់ខ្លួនរបស់អ្នកសម្រាប់ការចូលលើកដំបូង។ ឬកំណត់ ADMIN_USERNAME / ADMIN_PASSWORD ក្នុង Secrets។"
                      : "Set your Admin ID and password for initial setup, or configure ADMIN_USERNAME & ADMIN_PASSWORD in Settings > Secrets."}
                  </span>
                </div>
              )}

              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-700 block">
                  {isKm ? "Admin ID (ឈ្មោះគណនី)" : "Admin ID"}
                </label>
                <div className="relative">
                  <User className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={username}
                    onChange={(e) => {
                      setUsername(e.target.value);
                      setErrorMsg(null);
                    }}
                    placeholder="Admin"
                    autoComplete="username"
                    required
                    className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-hidden focus:ring-2 focus:ring-indigo-500 font-semibold"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-700 block">
                  {isKm ? "ពាក្យសម្ងាត់ Admin (Password)" : "Admin Password"}
                </label>
                <div className="relative">
                  <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => {
                      setPassword(e.target.value);
                      setErrorMsg(null);
                    }}
                    placeholder="••••••••••••"
                    autoComplete={needsSetup ? "new-password" : "current-password"}
                    autoFocus
                    required
                    className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-hidden focus:ring-2 focus:ring-indigo-500 font-mono"
                  />
                </div>
              </div>

              {needsSetup && (
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-700 block">
                    {isKm ? "បញ្ជាក់ពាក្យសម្ងាត់ម្តងទៀត" : "Confirm Password"}
                  </label>
                  <div className="relative">
                    <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="password"
                      value={confirmPassword}
                      onChange={(e) => {
                        setConfirmPassword(e.target.value);
                        setErrorMsg(null);
                      }}
                      placeholder="••••••••••••"
                      autoComplete="new-password"
                      required
                      className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-hidden focus:ring-2 focus:ring-indigo-500 font-mono"
                    />
                  </div>
                </div>
              )}

              {errorMsg && (
                <p className="text-xs text-rose-600 flex items-start gap-1.5 font-medium pt-1">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{errorMsg}</span>
                </p>
              )}

              <div className="pt-2 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-100 transition-colors cursor-pointer"
                >
                  {isKm ? "បោះបង់" : "Cancel"}
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold shadow-md transition-all cursor-pointer disabled:opacity-50 inline-flex items-center gap-1.5"
                >
                  {submitting && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                  <span>
                    {needsSetup
                      ? isKm
                        ? "រក្សាទុក & ចូល Admin"
                        : "Claim & Sign In"
                      : isKm
                      ? "ចូល Admin Dashboard"
                      : "Sign In"}
                  </span>
                </button>
              </div>
            </>
          )}
        </form>
      </div>
    </div>
  );
};
