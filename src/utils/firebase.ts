import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import {
  getFirestore,
  initializeFirestore,
  doc,
  getDoc,
  getDocFromServer,
  setDoc,
  updateDoc,
  serverTimestamp,
  increment,
  type Firestore,
} from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';

const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
const databaseId = (firebaseConfig as { firestoreDatabaseId?: string }).firestoreDatabaseId;

function createFirestoreClient(): Firestore {
  try {
    // Force long-polling in browser environments so proxies/iframes/mobile networks
    // never buffer WebChannel streaming responses and trigger 10-second timeouts.
    return initializeFirestore(
      app,
      {
        experimentalForceLongPolling: true,
        ignoreUndefinedProperties: true,
      },
      databaseId
    );
  } catch {
    return databaseId ? getFirestore(app, databaseId) : getFirestore(app);
  }
}

export const db = createFirestoreClient();
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export async function testConnection(): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return false;
  }
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
    return true;
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      // Retry once after a brief delay in case the browser network stack was waking up
      await new Promise((resolve) => setTimeout(resolve, 1500));
      try {
        await getDocFromServer(doc(db, 'test', 'connection'));
        return true;
      } catch (retryError) {
        if (retryError instanceof Error && retryError.message.includes('the client is offline')) {
          console.warn('Firestore backend temporarily unreachable; operating in offline fallback mode.');
          return false;
        }
        return true;
      }
    }
    return true;
  }
}

// Run startup connectivity validation in browser environments
if (typeof window !== 'undefined') {
  testConnection();
}

function sanitizeDocId(raw: string): string {
  const cleaned = raw.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 120);
  return cleaned || `id_${Date.now()}`;
}

/**
 * Syncs a verified Firebase-authenticated user into Firestore /users/{uid}.
 * Never assigns admin role from client.
 */
export async function syncFirebaseUserProfile(): Promise<void> {
  const currentUser = auth.currentUser;
  if (!currentUser || !currentUser.emailVerified || !currentUser.email) return;

  const uid = sanitizeDocId(currentUser.uid);
  const path = `users/${uid}`;
  const userRef = doc(db, 'users', uid);

  try {
    const existingSnap = await getDoc(userRef);
    const displayName = (currentUser.displayName || currentUser.email.split('@')[0] || 'User').slice(0, 120);

    if (existingSnap.exists()) {
      await updateDoc(userRef, {
        displayName,
        lastLoginAt: serverTimestamp(),
      });
    } else {
      await setDoc(userRef, {
        uid,
        email: currentUser.email.slice(0, 254),
        displayName,
        role: 'user',
        provider: (currentUser.providerData?.[0]?.providerId || 'google').slice(0, 32),
        createdAt: serverTimestamp(),
        lastLoginAt: serverTimestamp(),
      });
    }
  } catch (err) {
    console.warn(`[Firestore] Skipped user profile sync (${path}):`, err);
  }
}

/**
 * Records a real PDF generation event in Firestore /documents/{docId} and server analytics.
 * Strictly stores ONLY non-sensitive metadata (NEVER Socinet passwords or passport/ARC images).
 */
export async function recordGeneratedDocument(params: {
  applicantName: string;
  pageCount: number;
  isPaid: boolean;
  centerId?: string;
}): Promise<void> {
  const docId = sanitizeDocId(`doc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`);
  const safeName = (params.applicantName || 'Applicant').trim().slice(0, 120) || 'Applicant';
  const safePages = Math.min(50, Math.max(1, Math.round(params.pageCount || 1)));
  const safeCenter = (params.centerId || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);

  // Notify server real-time analytics store
  try {
    await fetch('/api/analytics/event', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'document_generated',
        id: docId,
        applicantName: safeName,
        pageCount: safePages,
        isPaid: Boolean(params.isPaid),
        centerId: safeCenter || undefined,
      }),
    });
  } catch {
    // Non-blocking
  }

  // Persist to Firestore if authenticated with verified Firebase Auth
  const currentUser = auth.currentUser;
  if (!currentUser || !currentUser.emailVerified) return;

  const payload: Record<string, any> = {
    id: docId,
    userId: sanitizeDocId(currentUser.uid),
    applicantName: safeName,
    pageCount: safePages,
    isPaid: Boolean(params.isPaid),
    createdAt: serverTimestamp(),
  };
  if (safeCenter) payload.centerId = safeCenter;

  try {
    await setDoc(doc(db, 'documents', docId), payload);
  } catch (err) {
    console.warn('[Firestore] Failed to record generated document:', err);
  }
}

/**
 * Records a real verified payment or promo code redemption in Firestore /payments/{payId} and server analytics.
 */
export async function recordPaymentTransaction(params: {
  userEmail: string;
  amount: number;
  currency: 'KRW' | 'USD';
  method: string;
  promoCodeUsed?: string;
  centerId?: string;
}): Promise<void> {
  const payId = sanitizeDocId(`pay_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`);
  const safeEmail = (params.userEmail || auth.currentUser?.email || 'guest@kiip-portal.kr').slice(0, 254);
  const safeAmount = Math.max(0, Math.min(10000000, Number(params.amount) || 0));
  const safeMethod = (params.method || 'ABA PayWay QR').slice(0, 64);
  const safePromo = (params.promoCodeUsed || '').replace(/[^A-Z0-9_-]/gi, '').toUpperCase().slice(0, 64);
  const safeCenter = (params.centerId || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);

  try {
    await fetch('/api/analytics/event', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'payment_completed',
        id: payId,
        userEmail: safeEmail,
        amount: safeAmount,
        currency: params.currency,
        method: safeMethod,
        promoCodeUsed: safePromo || '-',
        centerId: safeCenter || undefined,
      }),
    });
  } catch {
    // Non-blocking
  }

  const currentUser = auth.currentUser;
  if (!currentUser || !currentUser.emailVerified) return;

  const payload: Record<string, any> = {
    id: payId,
    userId: sanitizeDocId(currentUser.uid),
    userEmail: safeEmail,
    amount: safeAmount,
    currency: params.currency,
    method: safeMethod,
    status: 'completed',
    createdAt: serverTimestamp(),
  };
  if (safePromo) payload.promoCodeUsed = safePromo;
  if (safeCenter) payload.centerId = safeCenter;

  try {
    await setDoc(doc(db, 'payments', payId), payload);
  } catch (err) {
    console.warn('[Firestore] Failed to record payment transaction:', err);
  }
}

/**
 * Verifies a Firestore promo code by exact code ID (preventing collection listing) and atomically increments usageCount.
 */
export async function verifyAndRedeemFirestorePromo(
  rawCode: string
): Promise<{ valid: boolean; centerId?: string; reason?: string }> {
  const normalized = rawCode.trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '');
  if (!normalized || normalized.length < 3 || normalized.length > 64) {
    return { valid: false, reason: 'Invalid code format' };
  }

  try {
    const promoRef = doc(db, 'promoCodes', normalized);
    const snap = await getDoc(promoRef);
    if (!snap.exists()) {
      return { valid: false };
    }
    const data = snap.data();
    if (!data.isActive) {
      return { valid: false, reason: 'Promo code is inactive' };
    }
    const today = new Date().toISOString().slice(0, 10);
    if (data.expiresAt && String(data.expiresAt) < today) {
      return { valid: false, reason: 'Promo code has expired' };
    }
    const usageCount = Number(data.usageCount) || 0;
    const usageLimit = Number(data.usageLimit) || 0;
    if (usageLimit > 0 && usageCount >= usageLimit) {
      return { valid: false, reason: 'Promo code usage limit reached' };
    }

    if (auth.currentUser?.emailVerified) {
      await updateDoc(promoRef, {
        usageCount: increment(1),
      }).catch(() => {});
    }

    return { valid: true, centerId: String(data.centerId || '') };
  } catch (err) {
    console.warn('[Firestore] Promo lookup/redeem error:', err);
    return { valid: false };
  }
}
