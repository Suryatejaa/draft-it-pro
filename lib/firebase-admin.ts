import { getApps, initializeApp, cert, type App } from 'firebase-admin/app';
import { getAuth, type Auth } from 'firebase-admin/auth';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import type { EnumerableAuthUser } from './entitlements/types';

let adminApp: App | null = null;
let adminAuth: Auth | null = null;
let adminDb: Firestore | null = null;

/**
 * Initializes and returns the Firebase Admin Auth instance.
 * Supports:
 * - Ambient Google Application Default Credentials
 * - FIREBASE_SERVICE_ACCOUNT_KEY env var (JSON string or file path)
 * - Fallback to projectId for local/emulated setups
 */
export function getFirebaseAdminAuth(): Auth {
  if (adminAuth) return adminAuth;

  try {
    const apps = getApps();
    if (apps.length > 0) {
      adminApp = apps[0];
    } else {
      const projectId =
        process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ||
        process.env.FIREBASE_PROJECT_ID ||
        'draft-it-pro';

      const serviceAccountKey = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
      if (serviceAccountKey) {
        try {
          const creds =
            typeof serviceAccountKey === 'string' && serviceAccountKey.trim().startsWith('{')
              ? JSON.parse(serviceAccountKey)
              : require(serviceAccountKey);
          adminApp = initializeApp({
            credential: cert(creds),
            projectId,
          });
        } catch (error) {
          throw new Error('Firebase Admin service account configuration is invalid.', { cause: error });
        }
      } else {
        adminApp = initializeApp({ projectId });
      }
    }

    adminAuth = getAuth(adminApp);
    return adminAuth;
  } catch (error) {
    throw error instanceof Error
      ? error
      : new Error('Firebase Admin initialization failed.');
  }
}

export function getFirebaseAdminDb(): Firestore {
  if (adminDb) return adminDb;
  const auth = getFirebaseAdminAuth();
  void auth;
  if (!adminApp) throw new Error('Firebase Admin app is not initialized.');
  adminDb = getFirestore(adminApp);
  return adminDb;
}

/**
 * Enumerates registered Firebase Authentication users via the Firebase Admin SDK.
 * Firebase Auth is authoritative for admin user enumeration. Errors are surfaced
 * so infrastructure failure cannot be interpreted as an empty user population.
 */
export async function listFirebaseUsers(maxResults = 1000): Promise<EnumerableAuthUser[]> {
  const auth = getFirebaseAdminAuth();
  const listResult = await auth.listUsers(maxResults);
  return listResult.users.map((u) => ({
    uid: u.uid,
    email: u.email || null,
    displayName: u.displayName || null,
    photoURL: u.photoURL || null,
    disabled: u.disabled || false,
    creationTime: u.metadata?.creationTime || null,
    lastSignInTime: u.metadata?.lastSignInTime || null,
  }));
}
