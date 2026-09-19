/**
 * Server-Side Admin Authorization.
 *
 * Admin Dashboard and BYOK are accessible ONLY to admin emails configured server-side
 * through environment variables (ADMIN_EMAILS).
 *
 * Normalization rules:
 * - trim whitespace
 * - lowercase email
 * - exact comparison
 *
 * NEVER expose the allowlist to client bundles or use NEXT_PUBLIC_ variables.
 */

export function getAdminEmails(): string[] {
  const raw = process.env.ADMIN_EMAILS || '';
  return raw
    .split(',')
    .map((e) => e.trim().toLowerCase().replace(/^["']|["']$/g, '').trim())
    .filter(Boolean);
}

export function isUserAdmin(email: string | null | undefined): boolean {
  if (!email || typeof email !== 'string') return false;
  const normalized = email.trim().toLowerCase().replace(/^["']|["']$/g, '').trim();
  if (!normalized) return false;
  const allowlist = getAdminEmails();
  return allowlist.includes(normalized);
}

export function assertAdmin(email: string | null | undefined): void {
  if (!isUserAdmin(email)) {
    const err = new Error('Admin authorization required.');
    (err as unknown as { statusCode: number }).statusCode = 403;
    throw err;
  }
}
