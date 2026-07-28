import { MIN_PASSWORD_LENGTH } from '@/lib/auth-constants';

const INPUT_CLASS =
  'focus-ring h-9 w-full rounded-md border border-input bg-background px-3 text-sm ' +
  'transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring';

const LABEL_CLASS = 'block text-note font-medium';

export function EmailField() {
  return (
    <div className="space-y-1.5">
      <label htmlFor="email" className={LABEL_CLASS}>
        Email
      </label>
      <input
        id="email"
        name="email"
        type="email"
        autoComplete="email"
        // An email is never a word. Left on, mobile keyboards underline the
        // address in red and offer to "correct" the domain.
        spellCheck={false}
        autoCapitalize="none"
        required
        className={INPUT_CLASS}
      />
    </div>
  );
}

/**
 * `mode` decides the autocomplete token, and it genuinely matters:
 *
 * - `current-password` tells a password manager to offer a SAVED password.
 * - `new-password` tells it to OFFER TO GENERATE one and prompt to save.
 *
 * Using `current-password` on a signup form — which the single combined form
 * used to do — means the manager suggests an existing password and never
 * offers to store the new one.
 */
export function PasswordField({ mode }: { mode: 'signin' | 'signup' }) {
  const isSignup = mode === 'signup';

  return (
    <div className="space-y-1.5">
      <label htmlFor="password" className={LABEL_CLASS}>
        Password
      </label>
      <input
        id="password"
        name="password"
        type="password"
        autoComplete={isSignup ? 'new-password' : 'current-password'}
        required
        {...(isSignup && {
          minLength: MIN_PASSWORD_LENGTH,
          'aria-describedby': 'password-hint',
        })}
        className={INPUT_CLASS}
      />
      {isSignup && (
        <p id="password-hint" className="text-note text-muted-foreground">
          At least {MIN_PASSWORD_LENGTH} characters.
        </p>
      )}
    </div>
  );
}
