import { isUserAdmin } from './admin.ts';
import { getFirebaseAdminAuth } from '../firebase-admin.ts';

export interface AuthenticatedUser {
  uid: string;
  email: string | null;
  displayName?: string | null;
  isAdmin: boolean;
}

/**
 * Authenticates request from Authorization Bearer token.
 * Returns null if unauthenticated / guest.
 */
export async function getAuthenticatedUser(
  request: Request,
): Promise<AuthenticatedUser | null> {
  const authHeader =
    request.headers.get('Authorization') ||
    request.headers.get('authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }

  const token = authHeader.slice('Bearer '.length).trim();
  if (!token) return null;

  // Development/mock token format support: "mock_uid:email"
  if (token.startsWith('mock_')) {
    const parts = token.slice('mock_'.length).split(':');
    const uid = parts[0] || 'mock-user';
    const email = parts[1] || null;
    const admin = isUserAdmin(email);
    return { uid, email, isAdmin: admin };
  }

  try {
    const payload = await getFirebaseAdminAuth().verifyIdToken(token);
    const email = payload.email || null;
    return {
      uid: payload.uid,
      email,
      displayName: payload.name || null,
      isAdmin: isUserAdmin(email),
    };
  } catch {
    return null;
  }
}

/**
 * Server-side admin verification guard. Throws 401/403 if not authenticated as admin.
 */
export async function requireAdminUser(
  request: Request,
): Promise<AuthenticatedUser> {
  const user = await getAuthenticatedUser(request);
  if (!user) {
    const err = new Error('Authentication required.');
    (err as unknown as { statusCode: number }).statusCode = 401;
    throw err;
  }

  if (!user.isAdmin) {
    const err = new Error('Admin authorization required. Access denied.');
    (err as unknown as { statusCode: number }).statusCode = 403;
    throw err;
  }

  return user;
}
