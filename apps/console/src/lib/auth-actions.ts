'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { MIN_PASSWORD_LENGTH } from '@/lib/auth-constants';
import { createClient } from '@/lib/supabase/server';

/** Keep the redirect target internal — an open redirect is a phishing primitive. */
function safeNext(value: FormDataEntryValue | null): string {
  const next = typeof value === 'string' ? value : '/';
  return next.startsWith('/') && !next.startsWith('//') ? next : '/';
}

function back(route: '/login' | '/signup', message: string, next: string): never {
  redirect(`${route}?next=${encodeURIComponent(next)}&error=${encodeURIComponent(message)}`);
}

function credentials(formData: FormData) {
  return {
    email: String(formData.get('email') ?? '').trim(),
    password: String(formData.get('password') ?? ''),
    next: safeNext(formData.get('next')),
  };
}

export async function signIn(formData: FormData) {
  const { email, password, next } = credentials(formData);

  if (!email || !password) back('/login', 'Email and password are both required.', next);

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  // Deliberately not distinguishing "no such account" from "wrong password":
  // that difference tells an attacker which addresses are registered.
  if (error) back('/login', 'Those credentials did not work.', next);

  revalidatePath('/', 'layout');
  redirect(next);
}

export async function signUp(formData: FormData) {
  const { email, password, next } = credentials(formData);

  if (!email || !password) back('/signup', 'Email and password are both required.', next);
  if (password.length < MIN_PASSWORD_LENGTH) {
    back('/signup', `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`, next);
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({ email, password });

  if (error) back('/signup', error.message, next);

  // With email confirmation on (Supabase's default), signUp returns a user but
  // no session — nothing is signed in until the link is clicked. Say so, rather
  // than redirecting to a console that will bounce straight back to /login.
  if (!data.session) {
    redirect(
      `/login?notice=${encodeURIComponent('Check your email to confirm the account, then sign in.')}`,
    );
  }

  revalidatePath('/', 'layout');
  redirect(next);
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  revalidatePath('/', 'layout');
  redirect('/login');
}
