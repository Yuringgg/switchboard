import { NextResponse } from 'next/server';

import { createClient } from '@/lib/supabase/server';
import { CALL_SESSION_TTL_MS, isPlausibleCallId } from '@/lib/voice/call-session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Link a Vapi call to the person who started it (voice V2).
 *
 * ── The other half of the tenant boundary ───────────────────────────────────
 *
 * `/api/webhooks/vapi` arrives with no session and must not take an owner from
 * its payload, so it reads `voice_call_sessions` instead. **This is the only
 * route that writes those rows**, and it does so the one moment the answer is
 * known for certain: while a real signed-in session is on the request.
 *
 * The client calls this immediately after `vapi.start()` hands back a call id.
 *
 * ── ⚠ Why the RLS client, not the service client ────────────────────────────
 *
 * `owner_id` is taken from `auth.getUser()` and the insert goes through the
 * user's own session, so migration 0002's `WITH CHECK` applies: the database
 * itself refuses a row claiming somebody else's `owner_id`. Using the service
 * client here would work and would move that guarantee from Postgres into this
 * file, where it would depend on nobody ever editing it carelessly.
 *
 * That is also why this route sits under `/api/voice/` rather than
 * `/api/webhooks/` — it has a session, so it must not touch the service client,
 * and `service-client-boundary.test.ts` holds that line.
 *
 * ── ⚠ A race worth naming ───────────────────────────────────────────────────
 *
 * The call exists at Vapi before this row exists here. If the agent invokes a
 * tool in that window the webhook finds no session and refuses — the caller
 * hears "I can't reach your messages right now" and a retry works.
 *
 * That fails in the safe direction, which is why it is acceptable for now. The
 * clean fix is to create the call server-side through Vapi's REST API and write
 * this row before handing it to the browser, so the row always exists first.
 * Worth doing before a demo; not worth blocking the first working call on.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return new NextResponse('Unauthorized', { status: 401 });

  let vapiCallId: string;
  try {
    const body = (await request.json()) as { vapiCallId?: unknown };
    vapiCallId = typeof body.vapiCallId === 'string' ? body.vapiCallId.trim() : '';
  } catch {
    return NextResponse.json({ error: 'Could not read the request.' }, { status: 400 });
  }

  // Bounded and character-checked before it becomes a primary key. See
  // `isPlausibleCallId` for why an opaque id still gets a format check.
  if (!isPlausibleCallId(vapiCallId)) {
    return NextResponse.json({ error: 'Invalid call id.' }, { status: 400 });
  }

  const expiresAt = new Date(Date.now() + CALL_SESSION_TTL_MS).toISOString();

  /*
   * Upsert, because the client may retry. A second registration of the same
   * call by the same user is a no-op that refreshes the expiry.
   *
   * ⚠ It cannot be used to steal a call: `owner_id` is set from the session,
   * and 0002's `WITH CHECK` rejects an update whose existing row belongs to
   * somebody else — the policy is evaluated against the row already there.
   */
  const { error } = await supabase.from('voice_call_sessions').upsert(
    {
      vapi_call_id: vapiCallId,
      owner_id: user.id,
      expires_at: expiresAt,
    },
    { onConflict: 'vapi_call_id' },
  );

  if (error) {
    // The id is logged, the message is not returned — a Postgres error can name
    // a column and a value.
    console.error(`[vapi] could not register call ${vapiCallId}: ${error.message}`);
    return NextResponse.json({ error: 'Could not start the call.' }, { status: 500 });
  }

  return NextResponse.json({ ok: true, expiresAt });
}
