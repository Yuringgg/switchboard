'use server';

import { revalidatePath } from 'next/cache';

import {
  ATTENTION_KINDS,
  isAttentionStatus,
  type AttentionStatus,
  type MoveResult,
} from '@/lib/attention';
import { createClient } from '@/lib/supabase/server';

/*
 * ⚠ `MoveResult` and `NO_MOVE_YET` live in `lib/attention.ts`, not here.
 *
 * A `'use server'` module may only export async functions — a plain `const`
 * in one is a build error, and the type travels with it so the two stay
 * together. `lib/auth-constants.ts` exists for exactly the same reason and
 * carries the same note.
 */

/**
 * Moving a card between the board's columns (Ms. Maria, 2026-08-05).
 *
 * ── ⚠ Everything in this file arrives from a form, so nothing in it is trusted
 *
 * Two values come off the wire — an extraction id and a destination column —
 * and each is checked in a different way, because they fail differently:
 *
 *   · **The status** is validated in TypeScript against `ATTENTION_STATUSES`
 *     *and* by migration 0012's CHECK constraint at the database. Belt and
 *     braces on purpose: the constraint is the real boundary, but a rejection
 *     there arrives as a Postgres error string, and this screen should not put
 *     one in front of a person for a value it could have refused itself.
 *   · **The id** is not validated at all, and deliberately so. It is used in an
 *     UPDATE under the caller's own session, and the `tenant_isolation` policy's
 *     USING clause decides whether that row is theirs. A forged id belonging to
 *     another account matches zero rows — indistinguishable from an id that does
 *     not exist, which is the same shape ADR-018 settled for `/messages/[id]`
 *     and for the same reason: confirming that a given id exists in someone
 *     else's mailbox is a leak even with no content attached.
 *
 * ⚠ There is no `owner_id` in this file. Passing a tenant key up from the
 * client is the one thing this system never does — the policy already knows who
 * is asking. Adding one would imply the policy might not be doing its job.
 *
 * ── ⚠ Why this is the ONLY writer of `status` ────────────────────────────────
 *
 * The worker writes proposals and stops. That is ADR-010's rule for calendar
 * events and it holds here for exactly the same reason: a pipeline that decides
 * on somebody's behalf that a commitment has been handled is a pipeline that
 * can quietly close work nobody did. Nothing in `apps/worker` touches this
 * column, and nothing should.
 */

/**
 * The form action. Bound to a `<form>` on each card, with the destination
 * carried by the submit button's own `value` so one form can offer both
 * directions without any client JavaScript.
 */
export async function moveAttentionItem(formData: FormData): Promise<MoveResult> {
  const id = String(formData.get('id') ?? '');
  const to = String(formData.get('to') ?? '');

  if (!id) return { ok: false, error: 'That card is missing an identifier.' };

  if (!isAttentionStatus(to)) {
    return { ok: false, error: 'That is not a column on this board.' };
  }

  const supabase = await createClient();

  /*
   * Checked here as well as in `proxy.ts`. A server action is a POST endpoint
   * with a stable id, reachable independently of the page that renders the
   * form — the route gate is not the only thing standing in front of it, and
   * this one writes.
   */
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { ok: false, error: 'Sign in again to move this card.' };

  const { data, error } = await supabase
    .from('extractions')
    .update({
      status: to satisfies AttentionStatus,
      // Recorded on every move, because the Done column is ordered by it —
      // see `groupForBoard`. `now()` on the server rather than the client's
      // clock: a laptop set eight hours fast would sort its own card to the
      // top of Done forever.
      status_changed_at: new Date().toISOString(),
    })
    .eq('id', id)
    /*
     * ⚠ A summary row must never be movable. `status` exists on every row in
     * this table because a column does, but only the four attention kinds mean
     * anything by it (migration 0012), and a crafted POST naming a summary's id
     * would otherwise set a value on a row no screen reads — harmless today,
     * and exactly the kind of "harmless" that stops being true when something
     * later starts reading it.
     */
    .in('kind', [...ATTENTION_KINDS])
    // Returns the affected rows, which is how "not yours / does not exist" is
    // detected — RLS makes both of those zero rows rather than an error.
    .select('id');

  if (error) {
    // ⚠ Never surface the raw message. This table holds quotes from real
    // message bodies and a constraint violation can name the value it rejected.
    // docs/02-ARCHITECTURE.md §6.
    return { ok: false, error: 'Could not move that card. Try again.' };
  }

  if (!data || data.length === 0) {
    return { ok: false, error: 'That card no longer exists.' };
  }

  // The board is a server component reading `extractions` directly, so this is
  // what puts the card in its new column. Nothing is updated optimistically:
  // the screen shows what the database says, which is the same rule
  // `confirmMeeting` follows for calendar events.
  revalidatePath('/attention');

  return { ok: true, error: null };
}

/**
 * The same action in the shape `useActionState` wants.
 *
 * ── ⚠ Why the move controls are a client component at all ────────────────────
 *
 * A bare `<form action={moveAttentionItem}>` works, needs no JavaScript, and
 * throws the return value away — so a card that fails to move just… does not
 * move. "It worked and there was nothing to change" and "it failed" would look
 * identical, which is the one thing this console's design notes say twice must
 * never be allowed to happen. `useActionState` is what puts the reason on the
 * screen.
 *
 * The previous state is ignored on purpose: each attempt is independent, and
 * carrying a stale error forward would leave a failure message under a card
 * that has since moved successfully.
 */
export async function moveAttentionItemAction(
  _previous: MoveResult,
  formData: FormData,
): Promise<MoveResult> {
  return moveAttentionItem(formData);
}

/**
 * Taking a card off the board, and putting it back (Ms. Maria, 2026-08-09).
 *
 * ⚠⚠ **THIS IS NOT A DELETE, AND IT MUST NOT BECOME ONE.** Migration 0013 has
 * the full reasoning; the short version is that migration 0011 records per
 * message that extraction has already run, so a deleted row is never
 * re-extracted. Deleting a card here destroys it permanently. `archived_at` is
 * a timestamp and nothing in this file issues a DELETE.
 *
 * `status` is deliberately untouched — that is what lets restore return a card
 * to the column it was in rather than dumping everything into "Not started".
 */
export async function setArchived(formData: FormData): Promise<MoveResult> {
  const id = String(formData.get('id') ?? '');
  // Absent means archive; `restore` means put it back. A missing value must
  // never be read as "restore" — the destructive-looking direction is the one
  // that has to be asked for explicitly.
  const restore = String(formData.get('restore') ?? '') === 'true';

  if (!id) return { ok: false, error: 'That card is missing an identifier.' };

  const supabase = await createClient();

  // A server action is a POST endpoint with a stable id, reachable
  // independently of the page that renders the form. This one writes.
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Sign in again to change this card.' };

  const { data, error } = await supabase
    .from('extractions')
    .update({ archived_at: restore ? null : new Date().toISOString() })
    .eq('id', id)
    // A summary row must never be archivable — `archived_at` exists on every
    // row because a column does, but only the four attention kinds mean
    // anything by it.
    .in('kind', [...ATTENTION_KINDS])
    // RLS makes "not yours" and "does not exist" both zero rows rather than an
    // error, which is the same shape ADR-018 settled for `/messages/[id]`.
    .select('id');

  if (error) {
    // ⚠ Never surface the raw message: these rows quote real message bodies.
    return { ok: false, error: 'Could not update that card. Try again.' };
  }
  if (!data || data.length === 0) {
    return { ok: false, error: 'That card no longer exists.' };
  }

  revalidatePath('/attention');
  return { ok: true, error: null };
}

/**
 * Clear the whole Done column in one go.
 *
 * ── Why this exists at all ───────────────────────────────────────────────────
 *
 * Done is the column that accumulates — it is the only one nothing ever leaves,
 * and it is most of what made the board read as a pile. Archiving finished work
 * one card at a time is the interaction somebody stops doing after a week.
 *
 * ⚠ Scoped to `status = 'done'` in the WHERE clause rather than by handing up a
 * list of ids from the client. A client-supplied list is a list somebody can
 * edit; deriving the set on the server means this action cannot be persuaded to
 * archive anything that is not finished, whatever arrives in the request.
 *
 * ⚠ Bounded to what is already archivable — no `limit`, because RLS scopes it
 * to one owner and "clear my done column" has no sensible partial answer. It is
 * still reversible: every row keeps `status = 'done'`, so Restore puts each one
 * back in Done.
 */
export async function archiveAllDone(): Promise<MoveResult> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Sign in again to clear the column.' };

  const { data, error } = await supabase
    .from('extractions')
    .update({ archived_at: new Date().toISOString() })
    .eq('status', 'done')
    .is('archived_at', null)
    .in('kind', [...ATTENTION_KINDS])
    .select('id');

  if (error) return { ok: false, error: 'Could not clear the column. Try again.' };

  revalidatePath('/attention');

  return {
    ok: true,
    error: null,
    // Reported back, because "nothing happened" and "there was nothing to do"
    // look identical otherwise — the collapse this console keeps guarding
    // against.
    archived: data?.length ?? 0,
  };
}

/** `useActionState` shape for the card-level archive control. */
export async function setArchivedAction(
  _previous: MoveResult,
  formData: FormData,
): Promise<MoveResult> {
  return setArchived(formData);
}

/** `useActionState` shape for the column-level clear. */
export async function archiveAllDoneAction(
  _previous: MoveResult,
): Promise<MoveResult> {
  return archiveAllDone();
}
