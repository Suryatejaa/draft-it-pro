import { getApp, getApps, initializeApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
} from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';
// Only public Firebase web-app configuration belongs in VITE_ variables.
const config = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};
export const firebaseConfigured = Object.values(config).every(
  (v) => typeof v === 'string' && v.trim() && !v.startsWith('your-'),
);
export function firebaseClient() {
  if (!firebaseConfigured)
    throw Error(
      'Add the Firebase web app settings to .env, then restart the app.',
    );
  const app = getApps().length ? getApp() : initializeApp(config);
  return {
    auth: getAuth(app),
    db: getFirestore(app),
    storage: getStorage(app),
  };
}
export async function googleSignIn() {
  const { auth } = firebaseClient();
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  await signInWithPopup(auth, provider);
}
export async function googleSignOut() {
  await signOut(firebaseClient().auth);
}
export function firebaseError(error: unknown) {
  const code = (error as { code?: string })?.code;
  const context = (
    error as { storageContext?: { operation: string; bucket: string } }
  )?.storageContext;
  if (code === 'storage/unauthorized' && context)
    return `Firebase denied ${context.operation} in ${context.bucket}. Your local changes are safe. Sign out and sign back in to refresh the session, then retry sync. If it persists, check Storage rules and App Check enforcement for that bucket.`;
  const errors: Record<string, string> = {
    'auth/popup-closed-by-user':
      'Sign-in was cancelled. Your work remains saved locally.',
    'auth/popup-blocked': 'Allow sign-in popups for this site, then try again.',
    'auth/unauthorized-domain':
      'Add this site’s hostname to Firebase Authentication’s authorized domains.',
    'auth/operation-not-allowed':
      'Enable Google in Firebase Authentication’s sign-in providers.',
    'auth/invalid-api-key':
      'Check the Firebase API key in .env and restart the app.',
    'permission-denied':
      'Firebase access was denied. Deploy the supplied Firestore rules to your Firebase project.',
    'storage/unauthorized':
      'Firebase denied a Storage request. Your local work is safe. Check the signed-in account, bucket rules, and App Check enforcement.',
    'storage/unknown':
      'Storage could not be reached. Check the bucket, CORS settings, and internet connection.',
    unavailable:
      'Cloud sync is temporarily unavailable. Local changes will retry automatically.',
    'auth/network-request-failed':
      'Could not reach Google sign-in. Check your connection and try again.',
  };
  return (
    errors[code ?? ''] ??
    (error instanceof Error
      ? error.message
      : 'Firebase could not complete this action.')
  );
}
