/**
 * Shared by the signUp server action and the password input's `minLength`, so
 * the client-side hint and the server-side rule cannot drift apart.
 *
 * Lives outside `auth-actions.ts` because a `'use server'` module may only
 * export async functions — a plain `const` there is a build error.
 */
export const MIN_PASSWORD_LENGTH = 8;
