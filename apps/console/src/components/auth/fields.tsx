import { BoxReveal } from '@/components/ui/box-reveal';
import { PasswordInput, SpotlightField } from '@/components/ui/spotlight-field';
import { MIN_PASSWORD_LENGTH } from '@/lib/auth-constants';

/**
 * The auth inputs.
 *
 * ⚠ These stay uncontrolled server-rendered inputs inside a `<form action={…}>`
 * that posts to a server action. The component this styling was adapted from
 * held every value in `useState` and validated in the browser; the visual
 * treatment has been taken and that architecture has not, because it would move
 * this project's authentication into the client. See the note on `AuthCard`.
 *
 * `bg-background` rather than the snippet's `bg-gray-50` / `dark:bg-zinc-800`:
 * the field sits on `--panel` here, and a hardcoded neutral would be the one
 * element on the screen that does not follow the theme.
 */

const INPUT_CLASS =
  'focus-ring h-10 w-full rounded-md border-none bg-background px-3 text-sm ' +
  'outline-none placeholder:text-muted-foreground';

const LABEL_CLASS = 'block text-note font-medium';

export function EmailField({ delay = 0.2 }: { delay?: number }) {
  return (
    <BoxReveal delay={delay}>
      <div className="space-y-1.5">
        <label htmlFor="email" className={LABEL_CLASS}>
          Email
        </label>
        <SpotlightField>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            placeholder="you@example.com"
            // An email is never a word. Left on, mobile keyboards underline the
            // address in red and offer to "correct" the domain.
            spellCheck={false}
            autoCapitalize="none"
            required
            className={INPUT_CLASS}
          />
        </SpotlightField>
      </div>
    </BoxReveal>
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
export function PasswordField({
  mode,
  delay = 0.26,
}: {
  mode: 'signin' | 'signup';
  delay?: number;
}) {
  const isSignup = mode === 'signup';

  return (
    <BoxReveal delay={delay}>
      <div className="space-y-1.5">
        <label htmlFor="password" className={LABEL_CLASS}>
          Password
        </label>
        <SpotlightField>
          <PasswordInput
            id="password"
            name="password"
            autoComplete={isSignup ? 'new-password' : 'current-password'}
            required
            {...(isSignup && {
              minLength: MIN_PASSWORD_LENGTH,
              'aria-describedby': 'password-hint',
            })}
            className={INPUT_CLASS}
          />
        </SpotlightField>
        {isSignup && (
          <p id="password-hint" className="text-note text-muted-foreground">
            At least {MIN_PASSWORD_LENGTH} characters.
          </p>
        )}
      </div>
    </BoxReveal>
  );
}
