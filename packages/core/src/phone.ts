/**
 * Phone number comparison.
 *
 * ── Why this is not `a === b` ────────────────────────────────────────────────
 *
 * WhatsApp reports the same number two ways in a single webhook payload:
 * `metadata.display_phone_number` is a formatted string for humans, while
 * `messages[].from` and `contacts[].wa_id` are bare digits in international
 * format with no `+`. Meta's own examples show `15550783881` in both places,
 * but formatted variants (`+1 555-078-3881`) are documented for the display
 * field and have been observed from the Business Manager.
 *
 * The one place this comparison matters is deciding a message's DIRECTION —
 * is this from the business number, or to it. Getting it wrong marks every
 * inbound client message `outbound`, which renders the whole timeline as "You"
 * and makes the product's central claim — *these are the messages you have
 * received* — false on every row.
 *
 * Digits-only is deliberately crude. It is not a phone number library and it is
 * not trying to be: both sides come from the same provider, describing numbers
 * in the same E.164 space, so the only difference to erase is punctuation.
 * Normalizing further (stripping a leading `0`, guessing a country code) would
 * start making claims about numbering plans that this system has no basis for.
 */

/** Everything that is not a digit, removed. `+63 917 000` → `63917000`. */
export function digitsOnly(value: string | null | undefined): string {
  return (value ?? '').replace(/\D/g, '');
}

/**
 * True when two numbers are the same once punctuation is discounted.
 *
 * Empty is never equal to anything, including another empty — an absent
 * `display_phone_number` must not make an arbitrary sender look like the
 * business itself.
 */
export function samePhoneNumber(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  const left = digitsOnly(a);
  const right = digitsOnly(b);
  return left.length > 0 && left === right;
}
