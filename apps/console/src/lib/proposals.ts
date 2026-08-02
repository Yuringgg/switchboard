import type { SupabaseClient } from '@supabase/supabase-js';

import {
  accessTokenForChannel,
  eventIdFor,
  insertCalendarEvent,
} from '@/lib/google/calendar';
import { manilaInputToRfc3339 } from '@/lib/manila';

/**
 * Confirming a meeting proposal onto a real calendar (US-7b, ADR-010).
 *
 * ⚠⚠ **ADR-010 IS ABSOLUTE: NEVER AUTO-CREATE.** Nothing in this module runs
 * except from a form a person submitted, on a screen showing them the message
 * the proposal came from. The extraction pass writes rows and stops; this is
 * the only path from a row to an event.
 *
 * The order of operations is the whole design, and every step is load-bearing:
 *
 *   1. Re-read the row **under the caller's own session**. RLS decides whether
 *      it is theirs; a row that is not returns "not found", indistinguishable
 *      from one that does not exist.
 *   2. **`calendar_event_id` is checked before every insert.** If it is set,
 *      stop. This is the documented idempotency guard.
 *   3. Mint an access token from the stored refresh token.
 *   4. Insert, with a **deterministic event id** so a crash between the insert
 *      and the database write cannot produce a second event.
 *   5. Only then record `calendar_event_id` and `confirmed_at`.
 *
 * A failure at any point leaves the proposal unconfirmed and the row untouched.
 * **Never mark confirmed optimistically** — `docs/02-ARCHITECTURE.md` §4b.
 */

export interface ConfirmInput {
  extractionId: string;
  title: string;
  /** `YYYY-MM-DDTHH:mm`, from a `datetime-local` input. Manila. */
  startsAtLocal: string;
  endsAtLocal: string;
  location: string;
}

export interface ConfirmResult {
  ok: boolean;
  /** Shown to the user. Success or failure, always something to read. */
  message: string;
  /** Set on success, so the UI can offer a link to the event. */
  htmlLink?: string | null;
}

interface ProposalRow {
  id: string;
  kind: string;
  payload: { title?: string; quote?: string; participants?: string[] } | null;
  calendar_event_id: string | null;
  message_id: string;
}

export async function confirmMeeting(
  supabase: SupabaseClient,
  input: ConfirmInput,
): Promise<ConfirmResult> {
  const title = input.title.trim().slice(0, 200);
  if (!title) return { ok: false, message: 'Give the event a title before confirming.' };

  const start = manilaInputToRfc3339(input.startsAtLocal);
  const end = manilaInputToRfc3339(input.endsAtLocal);

  if (!start || !end) {
    return { ok: false, message: 'Set both a start and an end time before confirming.' };
  }
  if (new Date(end) <= new Date(start)) {
    // Google rejects this with a 400 whose message is unhelpful. Saying it here
    // costs a round trip nobody needs to make.
    return { ok: false, message: 'The end time has to be after the start time.' };
  }

  /*
   * ── 1. Re-read under the caller's session ─────────────────────────────────
   *
   * ⚠ The id arrives from a form, so it is user input. Nothing here trusts it:
   * RLS scopes the read, so a row belonging to someone else simply is not
   * found — the same `notFound()` shape ADR-018 settled for `/messages/[id]`,
   * and for the same reason. Confirming which ids exist in another tenant's
   * data is a leak even without the content.
   */
  const { data, error } = await supabase
    .from('extractions')
    .select('id, kind, payload, calendar_event_id, message_id')
    .eq('id', input.extractionId)
    .maybeSingle();

  if (error) return { ok: false, message: 'Could not read that proposal.' };

  const proposal = data as ProposalRow | null;
  if (!proposal) return { ok: false, message: 'That proposal no longer exists.' };
  if (proposal.kind !== 'meeting') {
    return { ok: false, message: 'Only a meeting can be added to a calendar.' };
  }

  /*
   * ── 2. The idempotency guard, checked BEFORE every insert ─────────────────
   *
   * `docs/02-ARCHITECTURE.md` §4b and ADR-010 both state this outright:
   * re-running extraction over a message must never create a second event.
   */
  if (proposal.calendar_event_id) {
    return { ok: true, message: 'That meeting is already on your calendar.' };
  }

  /*
   * ── 3. Credentials ────────────────────────────────────────────────────────
   *
   * Google Calendar is reached through the user's *Gmail* channel, whatever
   * channel the message arrived on — the OAuth consent that connected Gmail
   * carries `calendar.events` too (ADR-010), which is exactly why Phase 1
   * requested both scopes in one screen.
   *
   * ⚠ `credentials` is selected ONLY here, in a server action. `fetchChannels`
   * deliberately does not select it, so it never travels to any page that
   * renders. It is encrypted at rest either way; the point is that ciphertext
   * nobody needs should not be in a payload nobody reads.
   */
  const { data: channelRows, error: channelError } = await supabase
    .from('channels')
    .select('id, credentials, status')
    .eq('type', 'gmail')
    .order('created_at', { ascending: true });

  if (channelError) return { ok: false, message: 'Could not read your Google connection.' };

  const channel = (channelRows ?? [])[0] as
    | { id: string; credentials: string | Buffer; status: string }
    | undefined;

  if (!channel) {
    return {
      ok: false,
      message:
        'No Google account is connected, so there is no calendar to add this to. Connect Gmail on Channels.',
    };
  }

  const token = await accessTokenForChannel(channel.credentials);
  if (!token.ok) return { ok: false, message: token.reason };

  /*
   * ── 4. Insert ─────────────────────────────────────────────────────────────
   *
   * The description carries the quote and a link back to the source message, so
   * the event is auditable from inside Google Calendar — six weeks later,
   * "why is this in my calendar?" is answerable without opening Switchboard.
   */
  const quote = proposal.payload?.quote;
  const participants = proposal.payload?.participants ?? [];

  const description = [
    'Added from Switchboard, from this message:',
    quote ? `\n"${quote}"` : '',
    participants.length > 0 ? `\nMentioned: ${participants.join(', ')}` : '',
    `\nSource: /messages/${proposal.message_id}`,
  ]
    .filter(Boolean)
    .join('\n');

  const created = await insertCalendarEvent(token.accessToken, eventIdFor(proposal.id), {
    summary: title,
    description,
    location: input.location.trim() || null,
    start,
    end,
  });

  if (!created.ok) {
    // ⚠ The row is untouched, so the proposal stays in the UI and can be
    // retried. Never mark confirmed optimistically.
    return { ok: false, message: created.reason };
  }

  /*
   * ── 5. Record it ──────────────────────────────────────────────────────────
   *
   * ⚠ If THIS fails, a real event exists with nothing pointing at it. That is
   * the window the deterministic event id closes: the next attempt gets a 409
   * `duplicate`, adopts the same id, and lands here again rather than creating
   * a twin. Reported honestly rather than swallowed, because the user needs to
   * know the event is there even though the console has not recorded it.
   */
  const { error: updateError } = await supabase
    .from('extractions')
    .update({
      calendar_event_id: created.eventId,
      confirmed_at: new Date().toISOString(),
      payload: {
        ...(proposal.payload ?? {}),
        title,
        starts_at: start,
        ends_at: end,
        location: input.location.trim() || null,
      },
    })
    .eq('id', proposal.id);

  if (updateError) {
    return {
      ok: false,
      message:
        'The event was created on your calendar, but Switchboard could not record it. ' +
        'Confirming again will not create a second one.',
    };
  }

  return {
    ok: true,
    message: created.alreadyExisted
      ? 'That meeting was already on your calendar; Switchboard has recorded it.'
      : 'Added to your Google Calendar.',
    htmlLink: created.htmlLink,
  };
}
