/**
 * The bot-to-tenant link, shared by the two routes that use it.
 *
 * ⚠ Its own module rather than a constant exported from a route. Route modules
 * importing each other is how `/api/meetings/bot` — which has a session and
 * must never touch the service client — ends up loading it transitively from
 * `/api/webhooks/recall`, which does. The boundary test greps for the import
 * string, so that would have passed the test and still been wrong.
 *
 * Same shape and the same reasoning as `lib/voice/call-session.ts`. See
 * ADR-026.
 */

/**
 * How long a registered Recall bot stays valid.
 *
 * ⚠ Much longer than a voice call's hour, and the difference is not slack.
 *
 * A voice call is over in minutes and every webhook arrives DURING it. A
 * meeting bot is different in both directions: the meeting itself can run for
 * hours, and the delivery that carries the thing we actually want — the
 * transcript — arrives only once the recording has finished processing, some
 * time AFTER everyone has hung up.
 *
 * An hour here would refuse the one event worth receiving, and it would do so
 * silently, looking exactly like Recall never sent it.
 *
 * Twelve hours: comfortably past any meeting plus processing, still bounded, so
 * a leaked bot id is not a permanent grant.
 *
 * ⚠ A SCHEDULED bot (`join_at` in the future) must derive its expiry from the
 * join time, not from now(). Phase 7A sends ad-hoc bots only, and the route
 * that sends them is the place to enforce that when scheduling arrives.
 */
export const BOT_SESSION_TTL_MS = 12 * 60 * 60 * 1000;

/**
 * Is this something we are willing to store as a primary key?
 *
 * ⚠ Recall's bot ids are uuids, and unlike Vapi's call ids that shape IS
 * documented — so this is stricter than `isPlausibleCallId`, which had to
 * settle for a length cap and a character class.
 *
 * Strict is right here: the value becomes a primary key and is the sole subject
 * of the tenant lookup. A malformed id should be rejected at the edge, where
 * the error is readable, rather than by Postgres halfway through a webhook.
 *
 * ⚠ This validates the FORMAT, never the AUTHORITY. A well-formed id that
 * matches no row still resolves to nothing and the event is still refused —
 * passing this check grants exactly nothing.
 */
export function isPlausibleBotId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
  );
}

/**
 * Recall is region-partitioned, and the region is part of the hostname.
 *
 * Read off the welcome email on 2026-09-18: us-west-2, us-east-1, eu-central-1,
 * ap-northeast-1. This workspace is **ap-northeast-1** (Tokyo) — nearest to
 * Manila, and chosen because an account, its keys and its recordings all live
 * in one region and cannot be moved later.
 *
 * ⚠ Calling the wrong region's host with a valid key returns an auth error, not
 * a redirect. That reads as a bad API key and is a genuinely confusing hour.
 */
export const RECALL_REGION = process.env.RECALL_REGION ?? 'ap-northeast-1';

export function recallApiBase(): string {
  return `https://${RECALL_REGION}.recall.ai/api/v1`;
}
