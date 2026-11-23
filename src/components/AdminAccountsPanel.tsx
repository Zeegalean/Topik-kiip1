import React, { useState, useEffect, useCallback } from 'react';
import {
  UserPlus,
  KeyRound,
  Shield,
  Users,
  Trash2,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  Ban,
  RotateCcw,
  Lock,
} from 'lucide-react';
import { Language } from '../types';

interface AdminAccountItem {
  id: number;
  username: string;
  display_name: string;
  role: 'root_admin' | 'manager';
  is_active: boolean;
  created_by: string;
  created_at: string;
  last_login_at: string | null;
}

interface AdminAccountsPanelProps {
  adminToken: string | null;
  lang?: Language;
}

export const AdminAccountsPanel: React.FC<AdminAccountsPanelProps> = ({
  adminToken,
  lang = 'km',
}) => {
  const isKm = lang === 'km';
  const [accounts, setAccounts] = useState<AdminAccountItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [forbidden, setForbidden] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Create / Reset Admin or Staff Form
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<'manager' | 'root_admin'>('manager');
  const [saving, setSaving] = useState(false);

  // Inline password reset
  const [resetTargetId, setResetTargetId] = useState<number | null>(null);
  const [resetPassword, setResetPassword] = useState('');

  const loadAccounts = useCallback(async () => {
    if (!adminToken) return;
    setLoading(true);
    setForbidden(false);
    try {
      const resp = await fetch('/api/admin/accounts', {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      if (resp.status === 403) {
        setForbidden(true);
        return;
      }
      const json = await resp.json();
      if (resp.ok && json?.success) {
        setAccounts(Array.isArray(json.accounts) ? json.accounts : []);
      }
    } catch {
      setFeedback({
        type: 'error',
        text: isKm ? 'មិនអាចទាញបញ្ជីគណនី Admin បានទេ។' : 'Unable to fetch admin accounts.',
      });
    } finally {
      setLoading(false);
    }
  }, [adminToken, isKm]);

  useEffect(() => {
    loadAccounts();
  }, [loadAccounts]);

  const handleSaveAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!adminToken) return;
    setFeedback(null);
    setSaving(true);
    try {
      const resp = await fetch('/api/admin/accounts', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({
          username: username.trim(),
          displayName: displayName.trim() || username.trim(),
          password,
          role,
        }),
      });
      const json = await resp.json().catch(() => ({}));
      if (resp.ok && json?.success) {
        setFeedback({
          type: 'success',
          text: isKm
            ? `✓ បានរក្សាទុកគណនី "${json.account?.username}" រួចរាល់! ឥឡូវអាចប្រើ ID និង Password នេះចូលមើលទិន្នន័យ និងបង្កើត Redeem Code បានភ្លាម។`
            : `✓ Saved account "${json.account?.username}". They can now sign in with ID & password to view data and generate redeem codes.`,
        });
        setUsername('');
        setDisplayName('');
        setPassword('');
        await loadAccounts();
      } else {
        setFeedback({ type: 'error', text: json?.error || 'Failed to save account' });
      }
    } catch {
      setFeedback({ type: 'error', text: 'Network error while saving account.' });
    } finally {
      setSaving(false);
    }
  };

  const handleToggleActive = async (acc: AdminAccountItem) => {
    if (!adminToken) return;
    try {
      const resp = await fetch(`/api/admin/accounts/${acc.id}/status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({ isActive: !acc.is_active }),
      });
      if (resp.ok) await loadAccounts();
    } catch {
      // ignore
    }
  };

  const handleResetPassword = async (id: number) => {
    if (!adminToken || resetPassword.length < 6) return;
    setFeedback(null);
    try {
      const resp = await fetch(`/api/admin/accounts/${id}/password`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({ password: resetPassword }),
      });
      const json = await resp.json().catch(() => ({}));
      if (resp.ok && json?.success) {
        setResetTargetId(null);
        setResetPassword('');
        setFeedback({
          type: 'success',
          text: isKm ? '✓ បានប្តូរពាក្យសម្ងាត់ថ្មីដោយជោគជ័យ!' : '✓ Password updated successfully!',
        });
      } else {
        setFeedback({ type: 'error', text: json?.error || 'Failed to update password' });
      }
    } catch {
      setFeedback({ type: 'error', text: 'Network error updating password.' });
    }
  };

  const handleDeleteAccount = async (id: number) => {
    if (!adminToken) return;
    try {
      const resp = await fetch(`/api/admin/accounts/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      if (resp.ok) await loadAccounts();
    } catch {
      // ignore
    }
  };

  if (forbidden) {
    return (
      <div className="p-5 bg-amber-50 border border-amber-200 rounded-2xl text-xs text-amber-900 flex items-start gap-2.5">
        <Lock className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
        <div>
          <p className="font-black">
            {isKm ? 'ផ្ទាំងនេះសម្រាប់តែ Root Admin ប៉ុណ្ណោះ' : 'Root Admin Access Required'}
          </p>
          <p className="mt-0.5">
            {isKm
              ? 'អ្នកកំពុងចូលជាគណនី Manager/Staff (អាចមើលទិន្នន័យ Live Visitors និងបង្កើត Redeem Code បានធម្មតា)។ មានតែ Root Admin (zeekhmerads@gmail.com) ប៉ុណ្ណោះដែលអាចបង្កើត ឬលុបគណនីអ្នកគ្រប់គ្រងផ្សេងទៀតបាន។'
              : 'You are signed in as a Manager/Staff account (you can view analytics, Live Visitors, and generate Redeem Codes). Only the Root Admin can create or remove admin/staff accounts.'}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Explanation Banner */}
      <div className="p-4 rounded-2xl bg-indigo-50 border border-indigo-200 text-xs text-indigo-950 space-y-1">
        <p className="font-black flex items-center gap-1.5">
          <Shield className="w-4 h-4 text-indigo-600" />
          {isKm
            ? 'គ្រប់គ្រងគណនី Admin & អ្នកជួយគ្រប់គ្រង (Admin ID + Password)'
            : 'Manage Admin & Delegated Staff Accounts (ID + Password)'}
        </p>
        <p className="text-[11px] text-indigo-800 leading-relaxed">
          {isKm
            ? 'អ្នកអាចកំណត់ពាក្យសម្ងាត់ថ្មីសម្រាប់គណនី Admin ឬបង្កើតគណនីឱ្យបុគ្គលិក/អ្នកជួយគ្រប់គ្រងផ្សេងទៀត (Role: Manager) ដើម្បីឱ្យពួកគេចូលមើលទិន្នន័យ Live Visitors, ប្រវត្តិបង់ប្រាក់ និងបង្កើត Redeem Code ថ្មីបាន (ដោយមិនចាំបាច់ប្រើគណនី Google របស់អ្នកឡើយ)។'
            : 'Create or reset ID + Password logins for yourself or delegated staff (Manager role). Managers can view analytics, Live Visitors, and generate/manage Redeem Codes without needing your personal Google account.'}
        </p>
      </div>

      {feedback && (
        <div
          className={`p-3 rounded-2xl border text-xs font-bold flex items-center gap-2 ${
            feedback.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : 'bg-rose-50 border-rose-200 text-rose-800'
          }`}
        >
          {feedback.type === 'success' ? (
            <CheckCircle2 className="w-4 h-4 shrink-0" />
          ) : (
            <AlertCircle className="w-4 h-4 shrink-0" />
          )}
          <span>{feedback.text}</span>
        </div>
      )}

      {/* Create / Reset Account Form */}
      <form
        onSubmit={handleSaveAccount}
        className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs space-y-4"
      >
        <div className="flex items-center gap-2">
          <UserPlus className="w-4 h-4 text-indigo-600" />
          <h4 className="text-sm font-black text-slate-900">
            {isKm ? 'បង្កើតគណនីថ្មី ឬ ប្តូរពាក្យសម្ងាត់ Admin / Staff' : 'Create Account or Reset Password'}
          </h4>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div>
            <label className="text-[11px] font-bold text-slate-600 block mb-1">
              {isKm ? 'Admin / Staff ID *' : 'Login ID *'}
            </label>
            <input
              type="text"
              required
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Admin ឬ staff01"
              className="w-full px-3 py-2 border border-slate-300 rounded-xl text-xs font-bold"
            />
          </div>

          <div>
            <label className="text-[11px] font-bold text-slate-600 block mb-1">
              {isKm ? 'ឈ្មោះបង្ហាញ (Display Name)' : 'Display Name'}
            </label>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder={isKm ? 'ឧ. អ្នកជួយគ្រប់គ្រង ១' : 'e.g. Support Manager'}
              className="w-full px-3 py-2 border border-slate-300 rounded-xl text-xs"
            />
          </div>

          <div>
            <label className="text-[11px] font-bold text-slate-600 block mb-1">
              {isKm ? 'ពាក្យសម្ងាត់ថ្មី (យ៉ាងតិច ៦ ខ្ទង់) *' : 'New Password (min 6 chars) *'}
            </label>
            <input
              type="password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full px-3 py-2 border border-slate-300 rounded-xl text-xs font-mono"
            />
          </div>

          <div>
            <label className="text-[11px] font-bold text-slate-600 block mb-1">
              {isKm ? 'សិទ្ធិគ្រប់គ្រង (Role)' : 'Access Role'}
            </label>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value === 'root_admin' ? 'root_admin' : 'manager')}
              className="w-full px-3 py-2 border border-slate-300 rounded-xl text-xs font-bold bg-white"
            >
              <option value="manager">
                {isKm ? 'Staff / Manager (មើលទិន្នន័យ + បង្កើត Redeem)' : 'Manager (View Data + Redeem Codes)'}
              </option>
              <option value="root_admin">
                {isKm ? 'Root Admin (សិទ្ធិពេញលេញទាំងអស់)' : 'Root Admin (Full Access)'}
              </option>
            </select>
          </div>
        </div>

        <button
          type="submit"
          disabled={saving}
          className="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs flex items-center gap-2 cursor-pointer disabled:opacity-50"
        >
          {saving ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <KeyRound className="w-3.5 h-3.5" />}
          <span>{isKm ? 'រក្សាទុកគណនី & ពាក្យសម្ងាត់' : 'Save Account & Password'}</span>
        </button>
      </form>

      {/* Accounts Table */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="p-3.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Users className="w-4 h-4 text-indigo-600" />
            <h4 className="text-xs sm:text-sm font-black text-slate-900">
              {isKm ? 'បញ្ជីគណនី Admin & អ្នកជួយគ្រប់គ្រង (SQLite)' : 'Saved Admin & Staff Accounts'}
            </h4>
          </div>
          <button
            type="button"
            onClick={loadAccounts}
            disabled={loading}
            className="p-1.5 rounded-lg bg-white border border-slate-200 text-slate-600 hover:bg-slate-100 cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 font-bold">
                <th className="p-3">Login ID</th>
                <th className="p-3">Name</th>
                <th className="p-3">Role</th>
                <th className="p-3">Status</th>
                <th className="p-3">Last Login</th>
                <th className="p-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {accounts.length === 0 ? (
                <tr>
                  <td colSpan={6} className="p-6 text-center text-slate-400">
                    {isKm
                      ? 'មិនទាន់មានគណនីបន្ថែមទេ។ សូមបង្កើតគណនី Admin ឬ Staff ខាងលើ (ឧ. ID: Admin)។'
                      : 'No custom accounts saved yet. Create an Admin or Staff login above.'}
                  </td>
                </tr>
              ) : (
                accounts.map((acc) => (
                  <tr key={acc.id} className="hover:bg-slate-50/70">
                    <td className="p-3 font-mono font-black text-slate-900">{acc.username}</td>
                    <td className="p-3 font-semibold text-slate-700">{acc.display_name || '-'}</td>
                    <td className="p-3">
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-black border ${
                          acc.role === 'root_admin'
                            ? 'bg-indigo-50 text-indigo-700 border-indigo-200'
                            : 'bg-teal-50 text-teal-700 border-teal-200'
                        }`}
                      >
                        {acc.role === 'root_admin' ? 'Root Admin' : 'Manager / Staff'}
                      </span>
                    </td>
                    <td className="p-3">
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-black border ${
                          acc.is_active
                            ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                            : 'bg-rose-50 text-rose-700 border-rose-200'
                        }`}
                      >
                        {acc.is_active ? 'Active' : 'Disabled'}
                      </span>
                    </td>
                    <td className="p-3 text-slate-500 tabular-nums">
                      {acc.last_login_at ? new Date(acc.last_login_at).toLocaleString() : '-'}
                    </td>
                    <td className="p-3 text-right">
                      {resetTargetId === acc.id ? (
                        <div className="inline-flex items-center gap-1.5">
                          <input
                            type="password"
                            value={resetPassword}
                            onChange={(e) => setResetPassword(e.target.value)}
                            placeholder="New pass (6+)"
                            className="w-28 px-2 py-1 border border-indigo-300 rounded-lg text-[11px] font-mono"
                          />
                          <button
                            type="button"
                            onClick={() => handleResetPassword(acc.id)}
                            className="px-2 py-1 rounded-lg bg-indigo-600 text-white text-[10px] font-bold cursor-pointer"
                          >
                            Save
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setResetTargetId(null);
                              setResetPassword('');
                            }}
                            className="px-2 py-1 rounded-lg bg-slate-200 text-slate-700 text-[10px] font-bold cursor-pointer"
                          >
                            ✕
                          </button>
                        </div>
                      ) : (
                        <div className="inline-flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => {
                              setResetTargetId(acc.id);
                              setResetPassword('');
                            }}
                            className="p-1.5 rounded-lg hover:bg-indigo-50 text-indigo-600 cursor-pointer"
                            title="Reset Password"
                          >
                            <KeyRound className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleToggleActive(acc)}
                            className={`p-1.5 rounded-lg cursor-pointer ${
                              acc.is_active
                                ? 'hover:bg-amber-50 text-amber-600'
                                : 'hover:bg-emerald-50 text-emerald-600'
                            }`}
                            title={acc.is_active ? 'Disable Account' : 'Enable Account'}
                          >
                            {acc.is_active ? (
                              <Ban className="w-3.5 h-3.5" />
                            ) : (
                              <RotateCcw className="w-3.5 h-3.5" />
                            )}
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteAccount(acc.id)}
                            className="p-1.5 rounded-lg hover:bg-rose-50 text-rose-500 cursor-pointer"
                            title="Delete Account"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
