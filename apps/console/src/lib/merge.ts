import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Manual identity merge — *"this email address and this phone number are the
 * same person"* (`docs/04-ROADMAP.md` Phase 3, Q3).
 *
 * ── ⚠ Why this is MANUAL, and stays manual ───────────────────────────────────
 *
 * Q3 settled it: *"Same display name across channels is weak evidence — two
 * different Marias exist. Auto-merging wrong contacts corrupts data in a way
 * that's tedious to unwind. Leaning: manual merge only in v1, with the UI
 * suggesting likely matches."*
 *
 * That is the same asymmetry as ADR-007 and ADR-010, one table over: the system
 * may **propose** that two handles are one person, and it may not **assert**
 * it. Nothing in this file runs except from a form a person submitted, on a
 * screen showing them both sides.
 *
 * ── ⚠ What a merge actually costs if it is wrong ─────────────────────────────
 *
 * It moves `contact_identities.contact_id` and deletes the emptied contact.
 * That is not catastrophic — every identity and every message survives, and
 * splitting them again is another merge in reverse — but the *notes* on the
 * absorbed contact would be lost, so they are carried over rather than dropped.
 * `messages` is never touched: it references `contact_identities`, not
 * `contacts`, so a merge cannot lose or move a message.
 */

export interface MergeResult {
  ok: boolean;
  message: string;
}

interface ContactRow {
  id: string;
  display_name: string;
  notes: string | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Fold `sourceId` into `targetId`.
 *
 * Returns rather than throws on every path — the caller is a server action, and
 * a throw there is an unhandled rejection and a blank screen.
 */
export async function mergeContacts(
  supabase: SupabaseClient,
  { sourceId, targetId }: { sourceId: string; targetId: string },
): Promise<MergeResult> {
  if (!UUID.test(sourceId) || !UUID.test(targetId)) {
    return { ok: false, message: 'Pick a contact to merge with.' };
  }
  if (sourceId === targetId) {
    return { ok: false, message: 'That is the same contact.' };
  }

  /*
   * ⚠ Both read under the caller's own session, so RLS decides whether either
   * is theirs. The ids arrive from a form and nothing here trusts them: a
   * contact belonging to someone else is simply not found — the same shape
   * ADR-018 settled for `/messages/[id]`.
   */
  const { data, error } = await supabase
    .from('contacts')
    .select('id, display_name, notes')
    .in('id', [sourceId, targetId]);

  if (error) return { ok: false, message: 'Could not read those contacts.' };

  const rows = (data ?? []) as ContactRow[];
  const source = rows.find((r) => r.id === sourceId);
  const target = rows.find((r) => r.id === targetId);

  if (!source || !target) {
    return { ok: false, message: 'One of those contacts no longer exists.' };
  }

  /*
   * ── 1. Move the identities ────────────────────────────────────────────────
   *
   * This is the whole merge. `messages.sender_identity` points at
   * `contact_identities`, not at `contacts`, so every message follows its
   * identity automatically and none is touched.
   *
   * ⚠ Done FIRST. If the delete below fails, the result is two contacts where
   * one has all the identities and the other has none — untidy, and correct.
   * The reverse order would orphan identities on a deleted contact, which is a
   * state nothing in the console renders.
   */
  const { error: moveError } = await supabase
    .from('contact_identities')
    .update({ contact_id: targetId })
    .eq('contact_id', sourceId);

  if (moveError) {
    return { ok: false, message: 'Could not move the handles. Nothing was changed.' };
  }

  /*
   * ── 2. Carry the notes over ───────────────────────────────────────────────
   *
   * The only thing on a contact row that is not recoverable from its
   * identities. Appended rather than overwritten: losing a note to a merge is
   * exactly the "tedious to unwind" cost Q3 is about.
   */
  if (source.notes?.trim()) {
    const merged = [target.notes?.trim(), `From ${source.display_name}: ${source.notes.trim()}`]
      .filter(Boolean)
      .join('\n\n');

    const { error: noteError } = await supabase
      .from('contacts')
      .update({ notes: merged })
      .eq('id', targetId);

    // Not fatal: the handles are already merged, which is what was asked for.
    // Reported so a lost note is never silent.
    if (noteError) {
      return {
        ok: true,
        message: `Merged into ${target.display_name}, but the notes could not be carried over.`,
      };
    }
  }

  /*
   * ── 3. Remove the emptied contact ─────────────────────────────────────────
   *
   * It now has no identities and therefore no messages. Leaving it would put a
   * permanently empty row in a list whose whole job is to be a list of people.
   *
   * ⚠ `contact_identities.contact_id` is `on delete set null`, so if step 1
   * had silently failed this delete would DETACH the identities rather than
   * error — they would still exist, still carry their messages, and simply
   * belong to nobody. That is why the update above is checked before reaching
   * here rather than relying on this statement to fail.
   */
  const { error: deleteError } = await supabase.from('contacts').delete().eq('id', sourceId);

  if (deleteError) {
    return {
      ok: true,
      message: `Merged into ${target.display_name}. The old contact row could not be removed.`,
    };
  }

  return {
    ok: true,
    message: `${source.display_name} is now part of ${target.display_name}.`,
  };
}

/**
 * Contacts worth suggesting as the same person.
 *
 * ⚠ **A suggestion, never a decision.** Q3: same display name across channels
 * is weak evidence — two different Marias exist. This ranks, the person
 * chooses, and nothing merges without a click.
 *
 * Pure, so the heuristic is testable without a database and can be argued with
 * on its merits rather than through a query plan.
 */
export function suggestMerges(
  subject: { id: string; displayName: string },
  others: { id: string; displayName: string }[],
): { id: string; displayName: string; reason: string }[] {
  const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');
  const subjectName = norm(subject.displayName);

  // A handle rather than a name: matching on these is meaningless, because
  // "+63 917 000 0001" and "+63 917 000 0002" share nothing that identifies a
  // person, and two addresses at the same company share a domain and not a
  // human.
  const isHandle = (s: string) => /[@+]/.test(s) || !/[a-z]/i.test(s);

  const scored: { id: string; displayName: string; reason: string; rank: number }[] = [];

  for (const other of others) {
    if (other.id === subject.id) continue;
    const name = norm(other.displayName);

    if (isHandle(subjectName) || isHandle(name)) continue;

    if (name === subjectName) {
      scored.push({ ...other, reason: 'same name', rank: 0 });
      continue;
    }

    /*
     * First name plus a shared initial. "Maria Santos" and "Maria S." are worth
     * offering; "Maria Santos" and "Maria dela Cruz" are not, which is the
     * exact pair Q3 names.
     */
    const a = subjectName.split(' ');
    const b = name.split(' ');
    if (a[0] && a[0] === b[0] && a.length > 1 && b.length > 1) {
      /*
       * ⚠ Punctuation stripped before comparing.
       *
       * An abbreviated surname is written "S." far more often than "S", and
       * with the period left in, `'santos'.startsWith('s.')` is false and the
       * one shape this rule exists to catch never matches. Found by the test
       * below, which is why it is a test rather than an assumption.
       */
      const letters = (s: string) => s.replace(/[^a-z]/g, '');
      const lastA = letters(a.at(-1)!);
      const lastB = letters(b.at(-1)!);

      if (
        lastA.length > 0 &&
        lastB.length > 0 &&
        (lastA.startsWith(lastB) || lastB.startsWith(lastA))
      ) {
        scored.push({ ...other, reason: 'same first name, matching surname', rank: 1 });
      }
    }
  }

  return scored
    .sort((x, y) => x.rank - y.rank || x.displayName.localeCompare(y.displayName))
    .slice(0, 5)
    .map(({ id, displayName, reason }) => ({ id, displayName, reason }));
}
