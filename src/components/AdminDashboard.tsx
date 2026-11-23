import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Shield,
  Users,
  FileText,
  DollarSign,
  Ticket,
  Building2,
  BarChart3,
  Plus,
  Trash2,
  X,
  LogOut,
  Lock,
  Radio,
  RefreshCw,
  AlertCircle,
  CheckCircle2,
  Database,
  Send,
  KeyRound,
} from 'lucide-react';
import { Language } from '../types';
import {
  auth,
  googleProvider,
  db,
  OperationType,
  handleFirestoreError,
} from '../utils/firebase';
import { signInWithPopup, signOut, onAuthStateChanged, User as FirebaseUser } from 'firebase/auth';
import {
  collection,
  getDocs,
  doc,
  setDoc,
  deleteDoc,
  serverTimestamp,
  Timestamp,
} from 'firebase/firestore';
import { LiveVisitorsMarquee, LiveVisitorsPayload } from './LiveVisitorsMarquee';
import { RedeemDatabasePanel } from './RedeemDatabasePanel';
import { AdminAccountsPanel } from './AdminAccountsPanel';

interface AdminDashboardProps {
  isOpen: boolean;
  onClose: () => void;
  lang?: Language;
  adminToken?: string | null;
  adminUsername?: string | null;
  onAdminSessionLogout?: () => void;
}

interface PromoCodeItem {
  id: string;
  code: string;
  centerId: string;
  monthLabel?: string;
  usageLimit: number;
  usageCount: number;
  expiresAt: string;
  isActive: boolean;
  createdAt: string;
}

interface CenterItem {
  id: string;
  centerName: string;
  region: string;
  contactPhone: string;
  managerEmail: string;
  createdAt: string;
}

interface PaymentItem {
  id: string;
  userEmail: string;
  amount: number;
  currency: string;
  method: string;
  status: string;
  createdAt: string;
  promoCodeUsed: string;
  centerId?: string;
}

interface DocumentItem {
  id: string;
  applicantName: string;
  pageCount: number;
  isPaid: boolean;
  centerId?: string;
  createdAt: string;
}

interface IssuedUnlockItem {
  code: string;
  source: 'kr_receipt' | 'telegram_bot';
  createdAt: number;
  used: boolean;
  verifiedAmount?: number;
  bankName?: string;
}

function formatFirestoreDate(val: any): string {
  if (!val) return '';
  if (val instanceof Timestamp) return val.toDate().toISOString();
  if (typeof val?.toDate === 'function') return val.toDate().toISOString();
  if (typeof val === 'string') return val;
  if (typeof val === 'number') return new Date(val).toISOString();
  return '';
}

function sanitizeId(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64) || `id_${Date.now()}`;
}

export const AdminDashboard: React.FC<AdminDashboardProps> = ({
  isOpen,
  onClose,
  lang = 'km',
  adminToken = null,
  adminUsername = null,
  onAdminSessionLogout,
}) => {
  const isKm = lang === 'km';
  const [firebaseUser, setFirebaseUser] = useState<FirebaseUser | null>(null);
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'overview' | 'live' | 'redeemdb' | 'accounts' | 'promos' | 'centers' | 'payments'>('overview');

  // Real Data State (initialized strictly empty / 0 — zero fake or mock data)
  const [loadingData, setLoadingData] = useState(false);
  const [firestoreConnected, setFirestoreConnected] = useState(false);
  const [dataError, setDataError] = useState<string | null>(null);

  const [registeredUsersCount, setRegisteredUsersCount] = useState<number>(0);
  const [documentsList, setDocumentsList] = useState<DocumentItem[]>([]);
  const [paymentsList, setPaymentsList] = useState<PaymentItem[]>([]);
  const [promoCodes, setPromoCodes] = useState<PromoCodeItem[]>([]);
  const [centers, setCenters] = useState<CenterItem[]>([]);
  const [issuedUnlockCodes, setIssuedUnlockCodes] = useState<IssuedUnlockItem[]>([]);
  const [integrations, setIntegrations] = useState({
    krBankConfigured: false,
    telegramConfigured: false,
  });
  const [liveVisitorSummary, setLiveVisitorSummary] = useState<LiveVisitorsPayload>({
    liveCount: 0,
    totalVisits: 0,
    visitors: [],
    cityBreakdown: [],
  });

  // New Promo Code Form State
  const defaultMonth = new Date().toISOString().slice(0, 7);
  const defaultExpiry = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0)
    .toISOString()
    .slice(0, 10);
  const [newCode, setNewCode] = useState('');
  const [newCenterId, setNewCenterId] = useState('');
  const [newMonthLabel, setNewMonthLabel] = useState(defaultMonth);
  const [newLimit, setNewLimit] = useState(50);
  const [newExpiresAt, setNewExpiresAt] = useState(defaultExpiry);
  const [promoFeedback, setPromoFeedback] = useState<string | null>(null);

  // New Support Center Form State
  const [newCenterName, setNewCenterName] = useState('');
  const [newCenterRegion, setNewCenterRegion] = useState('');
  const [newCenterPhone, setNewCenterPhone] = useState('');
  const [newCenterEmail, setNewCenterEmail] = useState('');
  const [centerFeedback, setCenterFeedback] = useState<string | null>(null);

  const isFirebaseRootAdmin = Boolean(
    firebaseUser &&
      firebaseUser.emailVerified &&
      firebaseUser.email?.toLowerCase() === 'zeekhmerads@gmail.com'
  );
  const isAuthorizedAdmin = Boolean(adminToken || isFirebaseRootAdmin);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      setFirebaseUser(user);
    });
    return () => unsub();
  }, []);

  const loadAllRealData = useCallback(async () => {
    if (!isAuthorizedAdmin) return;
    setLoadingData(true);
    setDataError(null);

    const docsById = new Map<string, DocumentItem>();
    const paysById = new Map<string, PaymentItem>();

    // 1. Fetch real server-side analytics (when authenticated with server Admin Bearer token)
    if (adminToken) {
      try {
        const resp = await fetch('/api/admin/analytics', {
          headers: { Authorization: `Bearer ${adminToken}` },
        });
        if (resp.ok) {
          const json = await resp.json();
          if (json?.success) {
            if (Array.isArray(json.documents)) {
              for (const d of json.documents) {
                docsById.set(d.id, {
                  id: d.id,
                  applicantName: d.applicantName || 'Applicant',
                  pageCount: Number(d.pageCount) || 1,
                  isPaid: Boolean(d.isPaid),
                  centerId: d.centerId,
                  createdAt: d.createdAt || '',
                });
              }
            }
            if (Array.isArray(json.payments)) {
              for (const p of json.payments) {
                paysById.set(p.id, {
                  id: p.id,
                  userEmail: p.userEmail || 'guest@kiip-portal.kr',
                  amount: Number(p.amount) || 0,
                  currency: p.currency || 'KRW',
                  method: p.method || 'Payment',
                  status: 'completed',
                  createdAt: p.createdAt || '',
                  promoCodeUsed: p.promoCodeUsed || '-',
                  centerId: p.centerId,
                });
              }
            }
            if (Array.isArray(json.issuedUnlockCodes)) {
              setIssuedUnlockCodes(json.issuedUnlockCodes);
            }
            if (json.integrations) {
              setIntegrations(json.integrations);
            }
          }
        }
      } catch {
        // Non-blocking
      }
    }

    // 2. Fetch real Cloud Firestore collections (when signed in as authorized Firebase Admin)
    if (isFirebaseRootAdmin) {
      try {
        let usersCount = 0;
        try {
          const usersSnap = await getDocs(collection(db, 'users'));
          usersCount = usersSnap.size;
        } catch (err) {
          handleFirestoreError(err, OperationType.LIST, 'users');
        }
        setRegisteredUsersCount(usersCount);

        try {
          const docsSnap = await getDocs(collection(db, 'documents'));
          docsSnap.forEach((d) => {
            const data = d.data();
            docsById.set(d.id, {
              id: d.id,
              applicantName: String(data.applicantName || 'Applicant'),
              pageCount: Number(data.pageCount) || 1,
              isPaid: Boolean(data.isPaid),
              centerId: data.centerId ? String(data.centerId) : undefined,
              createdAt: formatFirestoreDate(data.createdAt),
            });
          });
        } catch (err) {
          handleFirestoreError(err, OperationType.LIST, 'documents');
        }

        try {
          const paymentsSnap = await getDocs(collection(db, 'payments'));
          paymentsSnap.forEach((d) => {
            const data = d.data();
            paysById.set(d.id, {
              id: d.id,
              userEmail: String(data.userEmail || 'user@kiip.kr'),
              amount: Number(data.amount) || 0,
              currency: String(data.currency || 'KRW'),
              method: String(data.method || 'ABA PayWay QR'),
              status: String(data.status || 'completed'),
              createdAt: formatFirestoreDate(data.createdAt),
              promoCodeUsed: String(data.promoCodeUsed || '-'),
              centerId: data.centerId ? String(data.centerId) : undefined,
            });
          });
        } catch (err) {
          handleFirestoreError(err, OperationType.LIST, 'payments');
        }

        try {
          const promosSnap = await getDocs(collection(db, 'promoCodes'));
          const pList: PromoCodeItem[] = [];
          promosSnap.forEach((d) => {
            const data = d.data();
            pList.push({
              id: d.id,
              code: String(data.code || d.id),
              centerId: String(data.centerId || ''),
              monthLabel: data.monthLabel ? String(data.monthLabel) : undefined,
              usageLimit: Number(data.usageLimit) || 50,
              usageCount: Number(data.usageCount) || 0,
              expiresAt: String(data.expiresAt || ''),
              isActive: data.isActive !== false,
              createdAt: formatFirestoreDate(data.createdAt),
            });
          });
          pList.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
          setPromoCodes(pList);
        } catch (err) {
          handleFirestoreError(err, OperationType.LIST, 'promoCodes');
        }

        try {
          const centersSnap = await getDocs(collection(db, 'centers'));
          const cList: CenterItem[] = [];
          centersSnap.forEach((d) => {
            const data = d.data();
            cList.push({
              id: d.id,
              centerName: String(data.centerName || d.id),
              region: String(data.region || ''),
              contactPhone: String(data.contactPhone || ''),
              managerEmail: String(data.managerEmail || ''),
              createdAt: formatFirestoreDate(data.createdAt),
            });
          });
          cList.sort((a, b) => a.centerName.localeCompare(b.centerName));
          setCenters(cList);
          if (cList.length > 0 && !newCenterId) {
            setNewCenterId(cList[0].id);
          }
        } catch (err) {
          handleFirestoreError(err, OperationType.LIST, 'centers');
        }

        setFirestoreConnected(true);
      } catch (err: any) {
        setFirestoreConnected(false);
        setDataError(
          isKm
            ? 'មិនអាចទាញទិន្នន័យពី Cloud Firestore បានទេ។ សូមផ្ទៀងផ្ទាត់គណនី Google Admin (zeekhmerads@gmail.com)។'
            : `Firestore sync error: ${err?.message || 'Permission denied'}`
        );
      }
    } else {
      setFirestoreConnected(false);
    }

    const sortedDocs = Array.from(docsById.values()).sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt)
    );
    const sortedPays = Array.from(paysById.values()).sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt)
    );
    setDocumentsList(sortedDocs);
    setPaymentsList(sortedPays);
    setLoadingData(false);
  }, [isAuthorizedAdmin, adminToken, isFirebaseRootAdmin, isKm, newCenterId]);

  useEffect(() => {
    if (isOpen && isAuthorizedAdmin) {
      loadAllRealData();
    }
  }, [isOpen, isAuthorizedAdmin, loadAllRealData]);

  const handleAdminGoogleLogin = async () => {
    setAuthLoading(true);
    setAuthError(null);
    try {
      const res = await signInWithPopup(auth, googleProvider);
      if (res.user.email?.toLowerCase() !== 'zeekhmerads@gmail.com') {
        await signOut(auth);
        setAuthError(
          isKm
            ? `គណនី ${res.user.email} មិនមានសិទ្ធិ Admin ក្នុង Firestore ទេ! សូមប្រើគណនី zeekhmerads@gmail.com។`
            : `Account ${res.user.email} is not authorized as Firestore Admin.`
        );
      } else {
        setFirebaseUser(res.user);
      }
    } catch (err: any) {
      setAuthError(
        err?.message ||
          (isKm ? 'ការចូល Google Admin មិនជោគជ័យ។ សូមព្យាយាមម្តងទៀត។' : 'Google Admin sign-in failed.')
      );
    } finally {
      setAuthLoading(false);
    }
  };

  const handleAdminLogout = async () => {
    try {
      await signOut(auth);
    } catch {
      // ignore
    }
    if (adminToken) {
      try {
        await fetch('/api/admin/logout', {
          method: 'POST',
          headers: { Authorization: `Bearer ${adminToken}` },
        });
      } catch {
        // ignore
      }
    }
    setFirebaseUser(null);
    onAdminSessionLogout?.();
  };

  // Real Daily & Monthly Computed Metrics (zero fake values)
  const analytics = useMemo(() => {
    const todayStr = new Date().toISOString().slice(0, 10);
    const monthStr = new Date().toISOString().slice(0, 7);

    const todayDocs = documentsList.filter((d) => d.createdAt.startsWith(todayStr)).length;
    const monthDocs = documentsList.filter((d) => d.createdAt.startsWith(monthStr)).length;

    const completedPayments = paymentsList.filter((p) => p.status !== 'failed' && p.status !== 'refunded');
    const totalRevenueKrw = completedPayments.reduce((acc, p) => {
      const krw = p.currency === 'USD' ? Math.round(p.amount * 1340) : p.amount;
      return acc + krw;
    }, 0);

    const todayRevenueKrw = completedPayments
      .filter((p) => p.createdAt.startsWith(todayStr))
      .reduce((acc, p) => acc + (p.currency === 'USD' ? Math.round(p.amount * 1340) : p.amount), 0);

    const monthRevenueKrw = completedPayments
      .filter((p) => p.createdAt.startsWith(monthStr))
      .reduce((acc, p) => acc + (p.currency === 'USD' ? Math.round(p.amount * 1340) : p.amount), 0);

    const promoOrdersCount = completedPayments.filter(
      (p) => p.method.toLowerCase().includes('promo') || (p.promoCodeUsed && p.promoCodeUsed !== '-' && p.amount === 0)
    ).length;
    const paidOrdersCount = completedPayments.length - promoOrdersCount;

    // Real Center Usage Map
    const centerUsageMap: Record<string, { redemptions: number; promosCount: number }> = {};
    for (const c of centers) {
      centerUsageMap[c.id] = { redemptions: 0, promosCount: 0 };
    }
    for (const p of promoCodes) {
      if (!centerUsageMap[p.centerId]) {
        centerUsageMap[p.centerId] = { redemptions: 0, promosCount: 0 };
      }
      centerUsageMap[p.centerId].promosCount += 1;
      centerUsageMap[p.centerId].redemptions += p.usageCount;
    }

    return {
      todayDocs,
      monthDocs,
      totalRevenueKrw,
      todayRevenueKrw,
      monthRevenueKrw,
      paidOrdersCount,
      promoOrdersCount,
      centerUsageMap,
    };
  }, [documentsList, paymentsList, centers, promoCodes]);

  const handleCreatePromoCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setPromoFeedback(null);

    if (!isFirebaseRootAdmin) {
      setPromoFeedback(
        isKm
          ? 'សូមចុច "ភ្ជាប់ Cloud Firestore (Google Admin)" ជាមុនសិនដើម្បីរក្សាទុក Promo Code ចូល Database។'
          : 'Please sign in with Google Admin to save promo codes to Cloud Firestore.'
      );
      return;
    }

    const codeStr = newCode.trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '');
    if (codeStr.length < 3 || codeStr.length > 64) {
      setPromoFeedback(isKm ? 'លេខកូដត្រូវមានចន្លោះ ៣ ដល់ ៦៤ តួអក្សរ (A-Z, 0-9, -, _)។' : 'Code must be 3-64 uppercase alphanumeric characters.');
      return;
    }

    const chosenCenter = sanitizeId(newCenterId || centers[0]?.id || 'general');
    const safeLimit = Math.max(1, Math.min(100000, Number(newLimit) || 50));

    try {
      await setDoc(doc(db, 'promoCodes', codeStr), {
        id: codeStr,
        code: codeStr,
        centerId: chosenCenter,
        monthLabel: newMonthLabel.slice(0, 32),
        usageLimit: safeLimit,
        usageCount: 0,
        expiresAt: newExpiresAt.slice(0, 32),
        isActive: true,
        createdAt: serverTimestamp(),
      });
      setNewCode('');
      setPromoFeedback(isKm ? `✓ បានបង្កើត Promo Code "${codeStr}" ចូល Firestore ជោគជ័យ!` : `✓ Created promo code "${codeStr}" in Firestore.`);
      await loadAllRealData();
    } catch (err) {
      try {
        handleFirestoreError(err, OperationType.CREATE, `promoCodes/${codeStr}`);
      } catch (wrapped: any) {
        setPromoFeedback(wrapped?.message || 'Failed to save promo code.');
      }
    }
  };

  const handleDeletePromo = async (id: string) => {
    if (!isFirebaseRootAdmin) return;
    try {
      await deleteDoc(doc(db, 'promoCodes', id));
      setPromoCodes((prev) => prev.filter((p) => p.id !== id));
    } catch (err) {
      try {
        handleFirestoreError(err, OperationType.DELETE, `promoCodes/${id}`);
      } catch {
        // Logged via handleFirestoreError
      }
    }
  };

  const handleCreateCenter = async (e: React.FormEvent) => {
    e.preventDefault();
    setCenterFeedback(null);

    if (!isFirebaseRootAdmin) {
      setCenterFeedback(
        isKm
          ? 'សូមភ្ជាប់គណនី Google Admin ជាមុនសិនដើម្បីបន្ថែមមជ្ឈមណ្ឌល។'
          : 'Please sign in with Google Admin to register centers in Firestore.'
      );
      return;
    }

    const name = newCenterName.trim().slice(0, 120);
    const region = newCenterRegion.trim().slice(0, 80);
    if (name.length < 2 || region.length < 2) {
      setCenterFeedback(isKm ? 'សូមបំពេញឈ្មោះមជ្ឈមណ្ឌល និងតំបន់។' : 'Please enter center name and region.');
      return;
    }

    const centerId = sanitizeId(
      `${region.toLowerCase().replace(/\s+/g, '_')}_${Date.now().toString(36)}`
    );

    try {
      await setDoc(doc(db, 'centers', centerId), {
        id: centerId,
        centerName: name,
        region,
        contactPhone: newCenterPhone.trim().slice(0, 32),
        managerEmail: newCenterEmail.trim().slice(0, 254),
        createdAt: serverTimestamp(),
      });
      setNewCenterName('');
      setNewCenterRegion('');
      setNewCenterPhone('');
      setNewCenterEmail('');
      setCenterFeedback(isKm ? `✓ បានបន្ថែមមជ្ឈមណ្ឌល "${name}" ជោគជ័យ!` : `✓ Registered "${name}".`);
      await loadAllRealData();
    } catch (err) {
      try {
        handleFirestoreError(err, OperationType.CREATE, `centers/${centerId}`);
      } catch (wrapped: any) {
        setCenterFeedback(wrapped?.message || 'Failed to add center.');
      }
    }
  };

  const handleDeleteCenter = async (id: string) => {
    if (!isFirebaseRootAdmin) return;
    try {
      await deleteDoc(doc(db, 'centers', id));
      setCenters((prev) => prev.filter((c) => c.id !== id));
    } catch (err) {
      try {
        handleFirestoreError(err, OperationType.DELETE, `centers/${id}`);
      } catch {
        // Logged
      }
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100000] bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-2 sm:p-4">
      <div className="bg-white rounded-3xl max-w-6xl w-full max-h-[94vh] flex flex-col shadow-2xl border border-slate-200 overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="bg-gradient-to-r from-slate-900 via-indigo-950 to-blue-950 text-white p-4 sm:p-5 flex items-center justify-between shrink-0 relative">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-2xl bg-indigo-600 flex items-center justify-center text-white shadow-md shrink-0">
              <Shield className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-base sm:text-xl font-extrabold tracking-tight truncate">
                  {isKm ? 'ប្រព័ន្ធគ្រប់គ្រងរដ្ឋបាល (Real-Time Admin)' : 'KIIP Secure Admin Dashboard'}
                </h3>
                <span className="bg-emerald-500/20 text-emerald-300 border border-emerald-400/30 text-[10px] font-black px-2 py-0.5 rounded-full uppercase">
                  100% Real Data
                </span>
              </div>
              <p className="text-[11px] sm:text-xs text-indigo-200 mt-0.5 truncate">
                {isKm
                  ? 'ទិន្នន័យពិតពី Cloud Firestore · IP-to-City Live Visitors · Promo Codes & មជ្ឈមណ្ឌល'
                  : 'Real Firestore metrics, IP-to-City live visitors, promo codes & revenue'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {isAuthorizedAdmin && (
              <button
                type="button"
                onClick={loadAllRealData}
                disabled={loadingData}
                className="p-2 bg-white/10 hover:bg-white/20 rounded-xl text-white/90 transition-colors cursor-pointer disabled:opacity-50"
                title="Refresh real data"
              >
                <RefreshCw className={`w-4 h-4 ${loadingData ? 'animate-spin' : ''}`} />
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="p-2 bg-white/10 hover:bg-white/20 rounded-xl text-white/80 hover:text-white transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {!isAuthorizedAdmin ? (
          /* Admin Authentication Gate */
          <div className="p-8 sm:p-14 text-center space-y-5 my-auto">
            <div className="w-20 h-20 rounded-3xl bg-indigo-50 text-indigo-600 flex items-center justify-center mx-auto shadow-inner border border-indigo-100">
              <Lock className="w-10 h-10" />
            </div>
            <div className="space-y-2 max-w-md mx-auto">
              <h4 className="text-2xl font-black text-slate-900">
                {isKm ? 'តម្រូវឱ្យផ្ទៀងផ្ទាត់សិទ្ធិ Admin' : 'Admin Authentication Required'}
              </h4>
              <p className="text-xs sm:text-sm text-slate-600 leading-relaxed">
                {isKm
                  ? 'សូមចូលគណនី Google Admin (zeekhmerads@gmail.com) ដើម្បីចូលមើលទិន្នន័យពិតពី Cloud Firestore និងគ្រប់គ្រងប្រព័ន្ធ។'
                  : 'Sign in with your authorized Google Admin account (zeekhmerads@gmail.com) to access Cloud Firestore analytics.'}
              </p>
            </div>

            {authError && (
              <div className="max-w-md mx-auto p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-semibold flex items-center gap-2 text-left">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{authError}</span>
              </div>
            )}

            <button
              type="button"
              disabled={authLoading}
              onClick={handleAdminGoogleLogin}
              className="px-6 py-3.5 rounded-2xl bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold text-sm shadow-lg shadow-indigo-600/25 inline-flex items-center gap-2.5 transition-all hover:scale-105 cursor-pointer disabled:opacity-50"
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24">
                <path fill="#fff" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                <path fill="#fff" fillOpacity=".9" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
              </svg>
              <span>{isKm ? 'ចូលគណនី Google Admin' : 'Sign in with Google Admin'}</span>
            </button>
          </div>
        ) : (
          /* Authenticated Dashboard Layout + Bottom Live Visitors Marquee */
          <>
            <div className="flex flex-col md:flex-row flex-1 overflow-hidden min-h-0">
              {/* Sidebar Navigation */}
              <div className="w-full md:w-64 bg-slate-50 border-b md:border-b-0 md:border-r border-slate-200 p-3 sm:p-4 shrink-0 flex flex-row md:flex-col justify-between overflow-x-auto md:overflow-y-auto gap-2">
                <div className="flex flex-row md:flex-col gap-1 w-full">
                  <button
                    type="button"
                    onClick={() => setActiveTab('overview')}
                    className={`flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl text-xs sm:text-sm font-bold transition-all text-left cursor-pointer whitespace-nowrap ${
                      activeTab === 'overview' ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-600 hover:bg-slate-200/60'
                    }`}
                  >
                    <BarChart3 className="w-4 h-4 shrink-0" />
                    <span>{isKm ? 'ទិដ្ឋភាពទូទៅ & ស្ថិតិពិត' : 'Overview & Analytics'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setActiveTab('live')}
                    className={`flex items-center justify-between gap-2 px-3.5 py-2.5 rounded-xl text-xs sm:text-sm font-bold transition-all text-left cursor-pointer whitespace-nowrap ${
                      activeTab === 'live' ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-600 hover:bg-slate-200/60'
                    }`}
                  >
                    <span className="flex items-center gap-2.5">
                      <Radio className="w-4 h-4 shrink-0" />
                      <span>{isKm ? 'អ្នកមើលផ្ទាល់ (IP-City)' : 'Live Visitors'}</span>
                    </span>
                    <span
                      className={`text-[10px] font-black px-1.5 py-0.5 rounded-full tabular-nums ${
                        activeTab === 'live'
                          ? 'bg-white/20 text-white'
                          : 'bg-emerald-100 text-emerald-800'
                      }`}
                    >
                      {liveVisitorSummary.liveCount}
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setActiveTab('redeemdb')}
                    className={`flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl text-xs sm:text-sm font-bold transition-all text-left cursor-pointer whitespace-nowrap ${
                      activeTab === 'redeemdb' ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-600 hover:bg-slate-200/60'
                    }`}
                  >
                    <Database className="w-4 h-4 shrink-0" />
                    <span>{isKm ? 'Redeem DB & Sheets' : 'Redeem DB & Sheets'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setActiveTab('accounts')}
                    className={`flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl text-xs sm:text-sm font-bold transition-all text-left cursor-pointer whitespace-nowrap ${
                      activeTab === 'accounts' ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-600 hover:bg-slate-200/60'
                    }`}
                  >
                    <KeyRound className="w-4 h-4 shrink-0" />
                    <span>{isKm ? 'គណនី Admin & បុគ្គលិក' : 'Admin & Staff'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setActiveTab('promos')}
                    className={`flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl text-xs sm:text-sm font-bold transition-all text-left cursor-pointer whitespace-nowrap ${
                      activeTab === 'promos' ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-600 hover:bg-slate-200/60'
                    }`}
                  >
                    <Ticket className="w-4 h-4 shrink-0" />
                    <span>{isKm ? 'គ្រប់គ្រង Promo Codes' : 'Promo Codes'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setActiveTab('centers')}
                    className={`flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl text-xs sm:text-sm font-bold transition-all text-left cursor-pointer whitespace-nowrap ${
                      activeTab === 'centers' ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-600 hover:bg-slate-200/60'
                    }`}
                  >
                    <Building2 className="w-4 h-4 shrink-0" />
                    <span>{isKm ? 'មជ្ឈមណ្ឌលគាំទ្រជនបរទេស' : 'Support Centers'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setActiveTab('payments')}
                    className={`flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl text-xs sm:text-sm font-bold transition-all text-left cursor-pointer whitespace-nowrap ${
                      activeTab === 'payments' ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-600 hover:bg-slate-200/60'
                    }`}
                  >
                    <DollarSign className="w-4 h-4 shrink-0" />
                    <span>{isKm ? 'ប្រវត្តិបង់ប្រាក់ & ចំណូល' : 'Revenue & Payments'}</span>
                  </button>
                </div>

                {/* Admin Profile & Firestore Connection Footer */}
                <div className="hidden md:flex flex-col gap-2 mt-auto pt-3 border-t border-slate-200">
                  {!isFirebaseRootAdmin && (
                    <button
                      type="button"
                      onClick={handleAdminGoogleLogin}
                      disabled={authLoading}
                      className="w-full px-3 py-2 rounded-xl bg-amber-50 hover:bg-amber-100 border border-amber-300 text-amber-900 text-[11px] font-bold flex items-center justify-center gap-1.5 cursor-pointer transition-colors"
                    >
                      <Database className="w-3.5 h-3.5 text-amber-600" />
                      <span>{isKm ? 'ភ្ជាប់ Cloud Firestore' : 'Connect Cloud Firestore'}</span>
                    </button>
                  )}

                  <div className="flex items-center justify-between p-3 bg-white rounded-2xl border border-slate-200">
                    <div className="truncate pr-2">
                      <p className="text-xs font-bold text-slate-900 truncate">
                        {firebaseUser?.displayName || adminUsername || 'Admin'}
                      </p>
                      <p className="text-[10px] text-slate-500 truncate">
                        {firebaseUser?.email || (adminUsername ? `ID: ${adminUsername}` : 'Authorized')}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={handleAdminLogout}
                      title="Logout"
                      className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer shrink-0"
                    >
                      <LogOut className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>

              {/* Main Content Area */}
              <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-5 bg-slate-100/50">
                {/* Firestore Connection Prompt Banner (when logged in with ID/Password only) */}
                {!isFirebaseRootAdmin && (
                  <div className="p-3.5 rounded-2xl bg-amber-50 border border-amber-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="flex items-start gap-2.5 text-xs text-amber-900">
                      <Database className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                      <span>
                        {isKm
                          ? 'អ្នកកំពុងចូលដោយ Admin ID/Password។ ចុចភ្ជាប់ Google Admin (zeekhmerads@gmail.com) ដើម្បីទាញ និងរក្សាទុកទិន្នន័យពិតពី Cloud Firestore (Users, Promo Codes, Centers)។'
                          : 'Signed in via Admin ID/Password. Connect Google Admin (zeekhmerads@gmail.com) to sync full Cloud Firestore collections.'}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={handleAdminGoogleLogin}
                      disabled={authLoading}
                      className="px-3.5 py-2 rounded-xl bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs shrink-0 cursor-pointer transition-colors"
                    >
                      {isKm ? 'ភ្ជាប់ Google Admin' : 'Connect Google Admin'}
                    </button>
                  </div>
                )}

                {(dataError || authError) && (
                  <div className="p-3.5 rounded-2xl bg-rose-50 border border-rose-200 text-rose-800 text-xs font-semibold flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    <span>{dataError || authError}</span>
                  </div>
                )}

                {/* TAB 1: OVERVIEW & REAL ANALYTICS */}
                {activeTab === 'overview' && (
                  <div className="space-y-6 animate-in fade-in duration-200">
                    {/* Summary Metric Cards (100% Real Counts) */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                      <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs space-y-2">
                        <div className="flex items-center justify-between text-slate-500">
                          <span className="text-xs font-bold uppercase tracking-wider">
                            {isKm ? 'អ្នកប្រើប្រាស់ចុះឈ្មោះ' : 'Registered Users'}
                          </span>
                          <Users className="w-5 h-5 text-blue-600" />
                        </div>
                        <div className="flex items-baseline gap-2">
                          <span className="text-2xl font-black text-slate-900 tabular-nums">
                            {registeredUsersCount}
                          </span>
                          <span className="text-[11px] text-slate-500 font-semibold">
                            {firestoreConnected ? 'Firestore' : 'Connect DB'}
                          </span>
                        </div>
                      </div>

                      <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs space-y-2">
                        <div className="flex items-center justify-between text-slate-500">
                          <span className="text-xs font-bold uppercase tracking-wider">
                            {isKm ? 'ឯកសារ PDF បានបង្កើត' : 'Generated PDFs'}
                          </span>
                          <FileText className="w-5 h-5 text-teal-600" />
                        </div>
                        <div className="flex items-baseline gap-2">
                          <span className="text-2xl font-black text-slate-900 tabular-nums">
                            {documentsList.length}
                          </span>
                          <span className="text-[11px] text-emerald-600 font-bold tabular-nums">
                            +{analytics.todayDocs} {isKm ? 'ថ្ងៃនេះ' : 'today'}
                          </span>
                        </div>
                      </div>

                      <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs space-y-2">
                        <div className="flex items-center justify-between text-slate-500">
                          <span className="text-xs font-bold uppercase tracking-wider">
                            {isKm ? 'ចំណូលពិតសរុប' : 'Real Revenue'}
                          </span>
                          <DollarSign className="w-5 h-5 text-emerald-600" />
                        </div>
                        <div className="flex items-baseline gap-2">
                          <span className="text-2xl font-black text-blue-700 tabular-nums">
                            ₩{analytics.totalRevenueKrw.toLocaleString()}
                          </span>
                        </div>
                      </div>

                      <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs space-y-2">
                        <div className="flex items-center justify-between text-slate-500">
                          <span className="text-xs font-bold uppercase tracking-wider">
                            {isKm ? 'Promo Codes សកម្ម' : 'Active Promos'}
                          </span>
                          <Ticket className="w-5 h-5 text-purple-600" />
                        </div>
                        <div className="flex items-baseline gap-2">
                          <span className="text-2xl font-black text-slate-900 tabular-nums">
                            {promoCodes.filter((p) => p.isActive).length}
                          </span>
                          <span className="text-[11px] text-purple-600 font-bold tabular-nums">
                            {centers.length} {isKm ? 'មជ្ឈមណ្ឌល' : 'centers'}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Daily & Monthly Real Analytics */}
                    <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-xs space-y-4">
                      <h4 className="font-extrabold text-slate-900 text-sm sm:text-base flex items-center gap-2">
                        <BarChart3 className="w-5 h-5 text-indigo-600" />
                        <span>
                          {isKm
                            ? 'ស្ថិតិពិតប្រចាំថ្ងៃ និងប្រចាំខែ (Daily & Monthly Analytics)'
                            : 'Real Daily & Monthly Analytics'}
                        </span>
                      </h4>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 space-y-2.5">
                          <span className="text-xs font-bold text-slate-500 uppercase">
                            {isKm ? `ស្ថិតិប្រចាំថ្ងៃ (${new Date().toISOString().slice(0, 10)})` : `TODAY (${new Date().toISOString().slice(0, 10)})`}
                          </span>
                          <div className="flex justify-between items-center text-xs font-bold">
                            <span>{isKm ? 'PDF បានបង្កើតថ្ងៃនេះ:' : 'PDFs Generated Today:'}</span>
                            <span className="text-blue-700 tabular-nums">{analytics.todayDocs} PDFs</span>
                          </div>
                          <div className="flex justify-between items-center text-xs font-bold">
                            <span>{isKm ? 'ចំណូលថ្ងៃនេះ:' : 'Revenue Today:'}</span>
                            <span className="text-emerald-700 tabular-nums">
                              ₩{analytics.todayRevenueKrw.toLocaleString()}
                            </span>
                          </div>
                          <div className="flex justify-between items-center text-xs font-bold">
                            <span>{isKm ? 'អ្នកកំពុងមើលផ្ទាល់ (Live):' : 'Live Active Visitors:'}</span>
                            <span className="text-indigo-700 tabular-nums">{liveVisitorSummary.liveCount}</span>
                          </div>
                        </div>

                        <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 space-y-2.5">
                          <span className="text-xs font-bold text-slate-500 uppercase">
                            {isKm ? `ស្ថិតិប្រចាំខែ (${defaultMonth})` : `THIS MONTH (${defaultMonth})`}
                          </span>
                          <div className="flex justify-between items-center text-xs font-bold">
                            <span>{isKm ? 'PDF ប្រចាំខែ:' : 'Monthly PDFs:'}</span>
                            <span className="text-blue-700 tabular-nums">{analytics.monthDocs} PDFs</span>
                          </div>
                          <div className="flex justify-between items-center text-xs font-bold">
                            <span>{isKm ? 'ចំណូលប្រចាំខែ:' : 'Monthly Revenue:'}</span>
                            <span className="text-emerald-700 tabular-nums">
                              ₩{analytics.monthRevenueKrw.toLocaleString()}
                            </span>
                          </div>
                          <div className="flex justify-between items-center text-xs font-bold">
                            <span>{isKm ? 'បង់ប្រាក់ / Promo Codes:' : 'Paid / Promo Unlocks:'}</span>
                            <span className="text-purple-700 tabular-nums">
                              {analytics.paidOrdersCount} / {analytics.promoOrdersCount}
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Korea Bank / Telegram Auto-Unlock Integration Status */}
                    <div className="bg-white p-5 rounded-3xl border border-slate-200 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                      <div className="space-y-1">
                        <h4 className="font-extrabold text-slate-900 text-sm flex items-center gap-2">
                          <Send className="w-4 h-4 text-sky-600" />
                          <span>
                            {isKm
                              ? 'ប្រព័ន្ធផ្ទៀងផ្ទាត់វិក្កយបត្រធនាគារកូរ៉េ & Telegram Auto-Unlock'
                              : 'Korea Bank Receipt & Telegram Bot Auto-Unlock'}
                          </span>
                        </h4>
                        <p className="text-xs text-slate-500">
                          {isKm
                            ? 'Webhook URL សម្រាប់ Telegram Bot: POST /api/telegram/webhook · កូដចេញស្វ័យប្រវត្តិសរុប: '
                            : 'Telegram Webhook Endpoint: POST /api/telegram/webhook · Auto-issued codes: '}
                          <strong className="text-slate-800">{issuedUnlockCodes.length}</strong>
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2 text-[11px] font-bold">
                        <span
                          className={`px-2.5 py-1 rounded-lg border ${
                            integrations.krBankConfigured
                              ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                              : 'bg-slate-50 text-slate-500 border-slate-200'
                          }`}
                        >
                          KR Bank: {integrations.krBankConfigured ? 'Ready' : 'Env Pending'}
                        </span>
                        <span
                          className={`px-2.5 py-1 rounded-lg border ${
                            integrations.telegramConfigured
                              ? 'bg-sky-50 text-sky-800 border-sky-200'
                              : 'bg-slate-50 text-slate-500 border-slate-200'
                          }`}
                        >
                          Telegram Bot: {integrations.telegramConfigured ? 'Active' : 'Env Pending'}
                        </span>
                      </div>
                    </div>
                  </div>
                )}

                {/* TAB 2: LIVE VISITORS (IP-TO-CITY WITH MASKED IPs) */}
                {activeTab === 'live' && (
                  <LiveVisitorsMarquee
                    adminToken={adminToken}
                    lang={lang}
                    mode="panel"
                    onStatsUpdate={setLiveVisitorSummary}
                  />
                )}

                {/* TAB 3: PROMOTION CODE MANAGEMENT */}
                {activeTab === 'promos' && (
                  <div className="space-y-6 animate-in fade-in duration-200">
                    {/* Create Monthly Promo Code Card */}
                    <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-xs space-y-4">
                      <h4 className="font-extrabold text-slate-900 text-sm sm:text-base flex items-center gap-2">
                        <Plus className="w-5 h-5 text-purple-600" />
                        <span>
                          {isKm
                            ? 'បង្កើត Monthly Promo Code សម្រាប់មជ្ឈមណ្ឌលនីមួយៗ'
                            : 'Create Monthly Support Center Promo Code'}
                        </span>
                      </h4>

                      <form onSubmit={handleCreatePromoCode} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
                        <div>
                          <label className="block text-xs font-bold text-slate-700 mb-1">
                            {isKm ? 'លេខកូដ Promo' : 'Promo Code'}
                          </label>
                          <input
                            type="text"
                            value={newCode}
                            onChange={(e) => setNewCode(e.target.value)}
                            placeholder="KIIP-ANSAN-202611"
                            className="w-full px-3 py-2.5 border border-slate-300 rounded-xl text-xs font-mono uppercase font-bold"
                            required
                          />
                        </div>

                        <div>
                          <label className="block text-xs font-bold text-slate-700 mb-1">
                            {isKm ? 'មជ្ឈមណ្ឌលគាំទ្រ' : 'Support Center'}
                          </label>
                          <select
                            value={newCenterId}
                            onChange={(e) => setNewCenterId(e.target.value)}
                            className="w-full px-3 py-2.5 border border-slate-300 rounded-xl text-xs font-bold bg-white"
                          >
                            {centers.length === 0 ? (
                              <option value="general">{isKm ? 'ទូទៅ (បន្ថែមមជ្ឈមណ្ឌលជាមុន)' : 'General (Add center first)'}</option>
                            ) : (
                              centers.map((c) => (
                                <option key={c.id} value={c.id}>
                                  {c.centerName}
                                </option>
                              ))
                            )}
                          </select>
                        </div>

                        <div>
                          <label className="block text-xs font-bold text-slate-700 mb-1">
                            {isKm ? 'ចំនួនកំណត់ (Limit)' : 'Usage Limit'}
                          </label>
                          <input
                            type="number"
                            value={newLimit}
                            onChange={(e) => setNewLimit(Number(e.target.value))}
                            className="w-full px-3 py-2.5 border border-slate-300 rounded-xl text-xs font-bold"
                            min={1}
                            max={100000}
                            required
                          />
                        </div>

                        <div>
                          <label className="block text-xs font-bold text-slate-700 mb-1">
                            {isKm ? 'ថ្ងៃផុតកំណត់' : 'Expiration Date'}
                          </label>
                          <input
                            type="date"
                            value={newExpiresAt}
                            onChange={(e) => {
                              setNewExpiresAt(e.target.value);
                              if (e.target.value.length >= 7) {
                                setNewMonthLabel(e.target.value.slice(0, 7));
                              }
                            }}
                            className="w-full px-3 py-2.5 border border-slate-300 rounded-xl text-xs font-bold"
                            required
                          />
                        </div>

                        <div className="flex items-end">
                          <button
                            type="submit"
                            className="w-full py-2.5 bg-purple-600 hover:bg-purple-700 text-white font-extrabold text-xs rounded-xl shadow-md cursor-pointer transition-colors"
                          >
                            {isKm ? '+ បង្កើត Promo Code' : 'Generate Code'}
                          </button>
                        </div>
                      </form>

                      {promoFeedback && (
                        <div className="p-2.5 rounded-xl bg-indigo-50 border border-indigo-200 text-indigo-900 text-xs font-semibold flex items-center gap-2">
                          <CheckCircle2 className="w-4 h-4 text-indigo-600 shrink-0" />
                          <span>{promoFeedback}</span>
                        </div>
                      )}
                    </div>

                    {/* Promo Codes List Table */}
                    <div className="bg-white rounded-3xl border border-slate-200 shadow-xs overflow-hidden">
                      <div className="p-5 border-b border-slate-200 flex items-center justify-between">
                        <h4 className="font-extrabold text-slate-900 text-sm">
                          {isKm ? 'បញ្ជី Promo Codes ក្នុង Cloud Firestore' : 'Active Firestore Promotion Codes'}
                        </h4>
                        <span className="text-xs text-slate-500 tabular-nums">{promoCodes.length} codes</span>
                      </div>

                      {promoCodes.length === 0 ? (
                        <div className="p-10 text-center text-xs text-slate-500">
                          {isKm
                            ? 'មិនទាន់មាន Promo Code ក្នុង Firestore ទេ។ សូមបង្កើត Promo Code ថ្មីខាងលើ!'
                            : 'No promotion codes created in Firestore yet.'}
                        </div>
                      ) : (
                        <div className="overflow-x-auto">
                          <table className="w-full text-left border-collapse">
                            <thead>
                              <tr className="bg-slate-50 border-b border-slate-200 text-xs text-slate-500 font-bold">
                                <th className="p-4">Promo Code</th>
                                <th className="p-4">{isKm ? 'មជ្ឈមណ្ឌល' : 'Support Center'}</th>
                                <th className="p-4">{isKm ? 'ការប្រើប្រាស់ (Used / Limit)' : 'Usage'}</th>
                                <th className="p-4">{isKm ? 'ថ្ងៃផុតកំណត់' : 'Expires At'}</th>
                                <th className="p-4 text-right">Actions</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100 text-xs font-semibold text-slate-800">
                              {promoCodes.map((p) => {
                                const centerObj = centers.find((c) => c.id === p.centerId);
                                return (
                                  <tr key={p.id} className="hover:bg-slate-50/80">
                                    <td className="p-4 font-mono font-bold text-purple-900">{p.code}</td>
                                    <td className="p-4">{centerObj ? centerObj.centerName : p.centerId}</td>
                                    <td className="p-4">
                                      <div className="flex items-center gap-2">
                                        <span className="font-bold tabular-nums">
                                          {p.usageCount} / {p.usageLimit}
                                        </span>
                                        <div className="w-20 bg-slate-200 h-2 rounded-full overflow-hidden">
                                          <div
                                            className="bg-purple-600 h-full rounded-full"
                                            style={{
                                              width: `${Math.min(100, (p.usageCount / Math.max(1, p.usageLimit)) * 100)}%`,
                                            }}
                                          />
                                        </div>
                                      </div>
                                    </td>
                                    <td className="p-4 tabular-nums text-slate-600">{p.expiresAt}</td>
                                    <td className="p-4 text-right">
                                      <button
                                        type="button"
                                        onClick={() => handleDeletePromo(p.id)}
                                        className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer"
                                        title="Delete Promo"
                                      >
                                        <Trash2 className="w-4 h-4" />
                                      </button>
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* TAB 4: CENTER MANAGEMENT & STATISTICS */}
                {activeTab === 'centers' && (
                  <div className="space-y-6 animate-in fade-in duration-200">
                    {/* Add Support Center Form */}
                    <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-xs space-y-4">
                      <h4 className="font-extrabold text-slate-900 text-sm sm:text-base flex items-center gap-2">
                        <Plus className="w-5 h-5 text-blue-600" />
                        <span>{isKm ? 'បន្ថែមមជ្ឈមណ្ឌលគាំទ្រជនបរទេសថ្មី' : 'Register Foreigner Support Center'}</span>
                      </h4>
                      <form onSubmit={handleCreateCenter} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
                        <input
                          type="text"
                          value={newCenterName}
                          onChange={(e) => setNewCenterName(e.target.value)}
                          placeholder={isKm ? 'ឈ្មោះមជ្ឈមណ្ឌល (ឧ. 안산외국인센터)' : 'Center Name'}
                          className="px-3 py-2.5 border border-slate-300 rounded-xl text-xs font-bold"
                          required
                        />
                        <input
                          type="text"
                          value={newCenterRegion}
                          onChange={(e) => setNewCenterRegion(e.target.value)}
                          placeholder={isKm ? 'តំបន់ (ឧ. Gyeonggi Ansan)' : 'Region / City'}
                          className="px-3 py-2.5 border border-slate-300 rounded-xl text-xs font-bold"
                          required
                        />
                        <input
                          type="text"
                          value={newCenterPhone}
                          onChange={(e) => setNewCenterPhone(e.target.value)}
                          placeholder={isKm ? 'លេខទូរស័ព្ទ (031-...)' : 'Phone'}
                          className="px-3 py-2.5 border border-slate-300 rounded-xl text-xs font-bold"
                        />
                        <input
                          type="email"
                          value={newCenterEmail}
                          onChange={(e) => setNewCenterEmail(e.target.value)}
                          placeholder="manager@center.kr"
                          className="px-3 py-2.5 border border-slate-300 rounded-xl text-xs font-bold"
                        />
                        <button
                          type="submit"
                          className="py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-extrabold text-xs rounded-xl shadow-md cursor-pointer transition-colors"
                        >
                          {isKm ? '+ បន្ថែមមជ្ឈមណ្ឌល' : 'Add Center'}
                        </button>
                      </form>
                      {centerFeedback && (
                        <div className="p-2.5 rounded-xl bg-blue-50 border border-blue-200 text-blue-900 text-xs font-semibold">
                          {centerFeedback}
                        </div>
                      )}
                    </div>

                    {/* Registered Centers List */}
                    <div className="bg-white rounded-3xl border border-slate-200 shadow-xs overflow-hidden">
                      <div className="p-5 border-b border-slate-200 flex items-center justify-between">
                        <h4 className="font-extrabold text-slate-900 text-sm">
                          {isKm ? 'មជ្ឈមណ្ឌលគាំទ្រជនបរទេស (Foreigner Support Centers)' : 'Registered Support Centers'}
                        </h4>
                        <span className="text-xs text-slate-500 tabular-nums">{centers.length} centers</span>
                      </div>

                      {centers.length === 0 ? (
                        <div className="p-10 text-center text-xs text-slate-500">
                          {isKm
                            ? 'មិនទាន់មានមជ្ឈមណ្ឌលចុះបញ្ជីក្នុង Firestore ទេ។ សូមបន្ថែមមជ្ឈមណ្ឌលខាងលើ។'
                            : 'No support centers registered in Firestore yet.'}
                        </div>
                      ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-5">
                          {centers.map((c) => {
                            const stats = analytics.centerUsageMap[c.id] || { redemptions: 0, promosCount: 0 };
                            return (
                              <div key={c.id} className="p-4 rounded-2xl border border-slate-200 bg-slate-50/50 space-y-2">
                                <div className="flex items-center justify-between gap-2">
                                  <span className="font-bold text-slate-900 text-sm flex items-center gap-1.5">
                                    <Building2 className="w-4 h-4 text-blue-600 shrink-0" />
                                    {c.centerName}
                                  </span>
                                  <div className="flex items-center gap-1.5">
                                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-100 text-blue-800">
                                      {c.region}
                                    </span>
                                    <button
                                      type="button"
                                      onClick={() => handleDeleteCenter(c.id)}
                                      className="p-1 text-slate-400 hover:text-rose-600 cursor-pointer"
                                      title="Delete Center"
                                    >
                                      <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                  </div>
                                </div>
                                <div className="text-xs text-slate-600 space-y-1 pt-1">
                                  {c.contactPhone && <p>Phone: <span className="font-semibold text-slate-800">{c.contactPhone}</span></p>}
                                  {c.managerEmail && <p>Email: <span className="font-semibold text-slate-800">{c.managerEmail}</span></p>}
                                  <div className="pt-1.5 flex items-center gap-3 text-[11px] font-bold text-indigo-700 tabular-nums">
                                    <span>Promos: {stats.promosCount}</span>
                                    <span>•</span>
                                    <span>Redemptions: {stats.redemptions}</span>
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* TAB 5: REAL REVENUE & PAYMENT HISTORY */}
                {activeTab === 'payments' && (
                  <div className="space-y-6 animate-in fade-in duration-200">
                    <div className="bg-white rounded-3xl border border-slate-200 shadow-xs overflow-hidden">
                      <div className="p-5 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2">
                        <h4 className="font-extrabold text-slate-900 text-sm">
                          {isKm ? 'ប្រវត្តិបង់ប្រាក់ពិត និងចំណូលសរុប (Real Payments)' : 'Real Payment History & Revenue'}
                        </h4>
                        <span className="text-xs font-bold text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-lg border border-emerald-200 tabular-nums">
                          Total Revenue: ₩{analytics.totalRevenueKrw.toLocaleString()}
                        </span>
                      </div>

                      {paymentsList.length === 0 ? (
                        <div className="p-10 text-center text-xs text-slate-500">
                          {isKm
                            ? 'មិនទាន់មានប្រតិបត្តិការបង់ប្រាក់ពិតត្រូវបានកត់ត្រាទេ។ រាល់ការបង់ប្រាក់ ABA PayWay, Korea Bank, ឬ Promo Code នឹងបង្ហាញនៅទីនេះដោយស្វ័យប្រវត្តិ។'
                            : 'No real payment transactions recorded yet.'}
                        </div>
                      ) : (
                        <div className="overflow-x-auto">
                          <table className="w-full text-left border-collapse">
                            <thead>
                              <tr className="bg-slate-50 border-b border-slate-200 text-xs text-slate-500 font-bold">
                                <th className="p-4">Transaction ID</th>
                                <th className="p-4">User Account</th>
                                <th className="p-4">Amount</th>
                                <th className="p-4">Method</th>
                                <th className="p-4">Code Used</th>
                                <th className="p-4">Timestamp</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100 text-xs font-semibold text-slate-800">
                              {paymentsList.map((pay) => (
                                <tr key={pay.id} className="hover:bg-slate-50/80">
                                  <td className="p-4 font-mono font-bold text-slate-600">{pay.id}</td>
                                  <td className="p-4">{pay.userEmail}</td>
                                  <td className="p-4 font-bold text-blue-700 tabular-nums">
                                    {pay.currency === 'USD' ? `$${pay.amount}` : `₩${pay.amount.toLocaleString()}`}
                                  </td>
                                  <td className="p-4">
                                    <span className="px-2 py-0.5 rounded bg-sky-50 text-sky-800 border border-sky-200 text-[11px]">
                                      {pay.method}
                                    </span>
                                  </td>
                                  <td className="p-4 font-mono text-purple-700">{pay.promoCodeUsed}</td>
                                  <td className="p-4 tabular-nums text-slate-500">
                                    {pay.createdAt ? new Date(pay.createdAt).toLocaleString() : '-'}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  </div>
                )}
                {/* TAB: REDEEM CODE DATABASE & GOOGLE SHEETS */}
                {activeTab === 'redeemdb' && (
                  <RedeemDatabasePanel adminToken={adminToken} lang={lang} />
                )}

                {/* TAB: ADMIN & STAFF ACCOUNTS (ROOT ADMIN ONLY) */}
                {activeTab === 'accounts' && (
                  <AdminAccountsPanel adminToken={adminToken} lang={lang} />
                )}
              </div>
            </div>

            {/* Pinned Bottom Live Visitors Scrolling City Marquee (Masked IPs for Privacy) */}
            <LiveVisitorsMarquee
              adminToken={adminToken}
              lang={lang}
              mode="marquee"
              onStatsUpdate={setLiveVisitorSummary}
            />
          </>
        )}
      </div>
    </div>
  );
};
