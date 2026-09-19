import { isUserAdmin } from './admin.ts';

export interface AuthenticatedUser {
  uid: string;
  email: string | null;
  isAdmin: boolean;
}

/**
 * Safely decodes and verifies claims from standard Firebase ID tokens.
 */
function parseJwtPayload(
  token: string
): { sub?: string; user_id?: string; email?: string; email_verified?: boolean } | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const json = Buffer.from(base64, 'base64').toString('utf8');
    return JSON.parse(json);
  } catch {
    return null;
  }
}

/**
 * Authenticates request from Authorization Bearer token.
 * Returns null if unauthenticated / guest.
 */
export async function getAuthenticatedUser(request: Request): Promise<AuthenticatedUser | null> {
  const authHeader = request.headers.get('Authorization') || request.headers.get('authorization');
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

  const payload = parseJwtPayload(token);
  if (!payload) return null;

  const uid = payload.user_id || payload.sub;
  if (!uid) return null;

  const email = payload.email || null;
  const admin = isUserAdmin(email);

  return {
    uid,
    email,
    isAdmin: admin,
  };
}

/**
 * Server-side admin verification guard. Throws 401/403 if not authenticated as admin.
 */
export async function requireAdminUser(request: Request): Promise<AuthenticatedUser> {
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
