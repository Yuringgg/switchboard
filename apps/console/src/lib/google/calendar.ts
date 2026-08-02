/**
 * Google Calendar write-back (US-7b, ADR-010).
 *
 * ⚠⚠ **THE ONLY PLACE SWITCHBOARD WRITES TO THE OUTSIDE WORLD.** Everything
 * else in this system reads. That asymmetry is why ADR-010 exists and why this
 * file is more careful than an integration of its size would normally warrant.
 *
 * > *"An LLM misreading 'maybe we should meet sometime next week' as a Thursday
 * > 3pm commitment, and silently putting it on someone's real calendar, is the
 * > kind of failure that gets a tool uninstalled after one incident."*
 *
 * **Never auto-create.** Nothing in this file is reachable except from a server
 * action a person triggered by clicking Confirm, on a screen showing them the
 * source message. The worker's extraction pass writes proposals and stops.
 */

import { refreshAccessToken } from '@switchboard/adapter-gmail/watch';
import { decryptSecret } from '@switchboard/core';

const EVENTS_ENDPOINT =
  'https://www.googleapis.com/calendar/v3/calendars/primary/events';

export interface CalendarEvent {
  summary: string;
  description?: string;
  location?: string | null;
  /** RFC3339 with an offset. */
  start: string;
  end: string;
  attendees?: string[];
}

export type CalendarResult =
  | { ok: true; eventId: string; htmlLink: string | null; alreadyExisted: boolean }
  | { ok: false; reason: string };

/**
 * A deterministic event id derived from the extraction row.
 *
 * ── ⚠ Why not let Google generate one ───────────────────────────────────────
 *
 * `calendar_event_id` on the extraction row is the documented idempotency guard
 * (ADR-010, `docs/02-ARCHITECTURE.md` §4b) and it is checked before every
 * insert. It has one gap, and it is the gap that actually happens: the window
 * **between a successful `events.insert` and the database write that records
 * its id.** A crash, a timeout or a lost connection in that window leaves a
 * real event on a real calendar with nothing in Switchboard pointing at it — so
 * the next Confirm sees a null `calendar_event_id`, believes nothing exists,
 * and creates a **second** event.
 *
 * A client-supplied id closes it. Google's rules, read from the API reference
 * rather than assumed: the characters allowed are those of **base32hex — the
 * lowercase letters a-v and the digits 0-9** — and the length must be between
 * **5 and 1024**. A UUID with its dashes removed is 32 hex characters, all of
 * which are inside that set; the `sb` prefix keeps it clearly ours and stays in
 * range (s and b are both ≤ v).
 *
 * A duplicate then returns **HTTP 409 with reason `duplicate`** — *"The
 * requested identifier already exists"* — which {@link insertCalendarEvent}
 * treats as "it is already there", adopting the id instead of creating a twin.
 *
 * ⚠ This is a SECOND line of defence, not the first. Google's own reference
 * notes it cannot guarantee collision detection in every case, so
 * `calendar_event_id` remains the primary guard and is still checked first.
 */
export function eventIdFor(extractionId: string): string {
  return `sb${extractionId.replace(/-/g, '').toLowerCase()}`;
}

/**
 * Mint an access token for a channel's stored credentials.
 *
 * ⚠ Only the refresh token is persisted (see the OAuth callback), so this is
 * the step that turns a stored credential into something usable. It runs in the
 * console rather than the worker because **this is a user-initiated action on
 * the user's own channel**, read through their own session under RLS — the
 * worker's `service_role` is not needed and would be a wider boundary than the
 * job requires (ADR-013).
 */
export type TokenResult = { ok: true; accessToken: string } | { ok: false; reason: string };

export async function accessTokenForChannel(
  credentials: Buffer | Uint8Array | string,
): Promise<TokenResult> {
  const key = process.env.CHANNEL_CREDENTIALS_KEY;
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

  if (!key || !clientId || !clientSecret) {
    // Named, because "could not add to calendar" with no cause sends someone
    // debugging Google when the deployment is simply missing a variable.
    return {
      ok: false,
      reason:
        'This deployment is missing the Google credentials needed to write to a calendar.',
    };
  }

  let refreshToken: string;
  try {
    /*
     * ⚠ PostgREST returns `bytea` as a `\x…` hex STRING, while the worker's
     * Drizzle client returns a Buffer. Both shapes reach this function, and
     * handing a string to `decryptSecret` fails inside AES with an error that
     * reads as a corrupted credential rather than a type mismatch.
     */
    const bytes =
      typeof credentials === 'string'
        ? Buffer.from(credentials.replace(/^\\x/, ''), 'hex')
        : Buffer.from(credentials);

    const decoded = JSON.parse(decryptSecret(bytes, key)) as { refresh_token?: string };
    if (!decoded.refresh_token) {
      return { ok: false, reason: 'The stored credential has no refresh token. Reconnect Gmail.' };
    }
    refreshToken = decoded.refresh_token;
  } catch {
    // ⚠ Never surface the cause: it can echo ciphertext or the key's length.
    return { ok: false, reason: 'The stored credential could not be read. Reconnect Gmail.' };
  }

  const minted = await refreshAccessToken(refreshToken, clientId, clientSecret);
  if (!minted.ok) {
    /*
     * ⚠ The 7-day expiry, arriving here. With the consent screen External +
     * Testing, Google expires every refresh token seven days after consent, and
     * `refreshAccessToken` reports that as terminal. The message has to say what
     * to do, because the cause is invisible from this screen.
     * docs/03-RESOURCES.md §2.
     */
    return { ok: false, reason: minted.reason };
  }

  return { ok: true, accessToken: minted.accessToken };
}

/**
 * Create one event.
 *
 * Returns rather than throws on every path — the caller is a server action, and
 * a throw there surfaces as a blank screen rather than a message.
 *
 * ⚠ **A failure must leave the proposal unconfirmed.** `docs/02-ARCHITECTURE.md`
 * §4b: *"If `events.insert` fails, the extraction row stays unconfirmed and the
 * proposal stays in the UI. Never mark confirmed optimistically."*
 */
export async function insertCalendarEvent(
  accessToken: string,
  eventId: string,
  event: CalendarEvent,
): Promise<CalendarResult> {
  const body = {
    id: eventId,
    summary: event.summary,
    ...(event.description ? { description: event.description } : {}),
    ...(event.location ? { location: event.location } : {}),
    start: { dateTime: event.start, timeZone: 'Asia/Manila' },
    end: { dateTime: event.end, timeZone: 'Asia/Manila' },
    /*
     * ⚠ Attendees are deliberately NOT sent.
     *
     * Adding an attendee makes Google email an invitation to that address, from
     * the user, without the user having asked for that. ADR-010's whole
     * principle is that the system may propose but may not assert — and mailing
     * a client an invitation off the back of an LLM reading their message is a
     * far louder assertion than a calendar entry. The participants the model
     * found go in the description, where they inform and nothing is sent.
     */
  };

  let response: Response;
  try {
    response = await fetch(EVENTS_ENDPOINT, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${accessToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    return { ok: false, reason: 'Could not reach Google Calendar. Nothing was created.' };
  }

  /*
   * ── 409 `duplicate` means it is ALREADY THERE ────────────────────────────
   *
   * Not an error. This is the deterministic id doing its job: a previous
   * confirmation created the event and failed to record its id. Adopting the id
   * is what closes the loop, and it is strictly better than the alternative,
   * which is a second identical event on a real calendar.
   */
  if (response.status === 409) {
    return { ok: true, eventId, htmlLink: null, alreadyExisted: true };
  }

  if (!response.ok) {
    /*
     * ⚠ Status only — never the body. A Calendar error body can echo the event
     * summary and description, and both are built from a private message.
     * docs/02-ARCHITECTURE.md §6.
     */
    const hint =
      response.status === 401 || response.status === 403
        ? ' Reconnect Gmail on /channels — the calendar permission may have lapsed.'
        : response.status === 400
          ? ' Google rejected the times; check the start is before the end.'
          : '';
    return {
      ok: false,
      reason: `Google Calendar refused the event (HTTP ${response.status}).${hint}`,
    };
  }

  const created = (await response.json().catch(() => null)) as {
    id?: string;
    htmlLink?: string;
  } | null;

  if (!created?.id) {
    /*
     * A 200 with no id. Reported as a failure so the proposal stays
     * unconfirmed — but note honestly that an event may exist: the
     * deterministic id means the retry will 409 and adopt it rather than
     * duplicating, which is exactly the case that guard was added for.
     */
    return { ok: false, reason: 'Google Calendar did not return an event id.' };
  }

  return {
    ok: true,
    eventId: created.id,
    htmlLink: created.htmlLink ?? null,
    alreadyExisted: false,
  };
}
