import { NextResponse } from 'next/server';

import { createClient } from '@/lib/supabase/server';
import {
  BOT_SESSION_TTL_MS,
  isPlausibleBotId,
  recallApiBase,
  RECALL_REGION,
} from '@/lib/meetings/bot-session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Send a bot into a meeting (Phase 7A).
 *
 * ── The other half of the tenant boundary ───────────────────────────────────
 *
 * **This is the only route that writes `meeting_bot_sessions`**, and it does so
 * the one moment the answer is known for certain: while a real signed-in
 * session is on the request. Everything downstream — the webhook, and the
 * polling path — reads that row rather than trusting anything Recall sends.
 *
 * Same shape and the same reasoning as `/api/voice/call-session`. ADR-026.
 *
 * ── ⚠ Why the RLS client, not the service client ────────────────────────────
 *
 * `owner_id` is taken from `auth.getUser()` and the insert goes through the
 * user's own session, so migration 0002's `WITH CHECK` applies: the database
 * itself refuses a row claiming somebody else's `owner_id`. Using the service
 * client here would work and would move that guarantee from Postgres into this
 * file, where it would depend on nobody ever editing it carelessly.
 *
 * That is also why this sits under `/api/meetings/` rather than
 * `/api/webhooks/` — it has a session, so it must not touch the service
 * client, and `service-client-boundary.test.ts` holds that line.
 *
 * ── ⚠⚠ RA 4200 — THIS ROUTE IS THE ONE THAT STARTS A RECORDING ─────────────
 *
 * Recording a private communication without the consent of every party is a
 * criminal offence in the Philippines — the same law behind ADR-008 excluding
 * calls. `botName` is REQUIRED and defaults to something that says what it is,
 * because a recorder nobody can see in the participant list is precisely what
 * that law is about.
 *
 * The bot being visible is a mitigation, not consent. Consent is obtained by a
 * person, before this route is called, and that is a product rule rather than
 * something this file can enforce.
 */

interface RecallBot {
  id?: unknown;
}

/** What a caller may ask for. Everything else about the bot is ours to decide. */
interface BotRequest {
  meetingUrl?: unknown;
  botName?: unknown;
}

export async function POST(request: Request) {
  const apiKey = process.env.RECALL_API_KEY;

  if (!apiKey) {
    /*
     * ⚠ 404, not 500 or "coming soon". Unset config means the feature is
     * DISABLED, the same rule `VAPI_WEBHOOK_SECRET` and `EMBED_API_SECRET`
     * follow. A half-configured route that advertises itself is one somebody
     * eventually makes work by accident.
     */
    console.warn('[recall] rejected: RECALL_API_KEY is not set');
    return new NextResponse('Not found', { status: 404 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return new NextResponse('Unauthorized', { status: 401 });

  let body: BotRequest;
  try {
    body = (await request.json()) as BotRequest;
  } catch {
    return NextResponse.json({ error: 'Could not read the request.' }, { status: 400 });
  }

  const meetingUrl = typeof body.meetingUrl === 'string' ? body.meetingUrl.trim() : '';

  /*
   * ⚠ Bounded and scheme-checked before it is forwarded.
   *
   * This string goes to a third party who will send a bot to it, and it is
   * stored. `https` only: an `http` link would have the bot join over a
   * cleartext channel, and a `javascript:` or `data:` URL has no business
   * reaching either Recall or our own database.
   */
  let parsed: URL;
  try {
    parsed = new URL(meetingUrl);
  } catch {
    return NextResponse.json({ error: 'That is not a valid meeting link.' }, { status: 400 });
  }

  if (parsed.protocol !== 'https:' || meetingUrl.length > 2048) {
    return NextResponse.json({ error: 'That is not a valid meeting link.' }, { status: 400 });
  }

  /*
   * ⚠ A NAME THAT SAYS WHAT IT IS. See the RA 4200 note above.
   *
   * A caller may customise it — "iOzera Notetaker" reads better than a default
   * — but it can never be blank, and it is length-capped because it is
   * displayed to everybody in the meeting.
   */
  const requested = typeof body.botName === 'string' ? body.botName.trim() : '';
  const botName = (requested || 'Switchboard Notetaker').slice(0, 100);

  /*
   * The `meeting` channel for this tenant, created on first use.
   *
   * ⚠ Through the user's own session, so RLS decides what this can see and
   * write. The webhook needs `channel_id` on the session row, and resolving it
   * HERE — where a session exists — is what stops that route from ever having
   * to look one up for itself.
   */
  const { data: existing } = await supabase
    .from('channels')
    .select('id')
    .eq('type', 'meeting')
    .limit(1)
    .maybeSingle();

  let channelId = (existing as { id: string } | null)?.id;

  if (!channelId) {
    const { data: created, error: channelError } = await supabase
      .from('channels')
      .insert({
        owner_id: user.id,
        type: 'meeting',
        display_name: 'Meetings',
        status: 'active',
      })
      .select('id')
      .single();

    if (channelError || !created) {
      console.error('[recall] could not create the meeting channel');
      return NextResponse.json({ error: 'Could not set up meetings.' }, { status: 500 });
    }

    channelId = (created as { id: string }).id;
  }

  /*
   * ⚠ `Authorization: <key>`, with NO `Bearer` prefix.
   *
   * Recall's own curl examples read `--header "Authorization: RECALLAI_API_KEY"`.
   * Adding `Bearer` is the reflex and it produces a 401 that reads exactly like
   * a wrong key — an easy hour to lose.
   */
  let bot: RecallBot;
  try {
    const response = await fetch(`${recallApiBase()}/bot/`, {
      method: 'POST',
      headers: {
        authorization: apiKey,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        meeting_url: meetingUrl,
        bot_name: botName,
        /*
         * Ask for a transcript up front rather than calling
         * `create_transcript` after `recording.done`. One fewer round trip and
         * one fewer place the flow can stall.
         *
         * ⚠ `recording_config` is v1.11 — the only schema this workspace
         * supports (`supported_bot_schema_versions: ["v1.11"]`, read from the
         * live account 2026-09-18).
         */
        recording_config: {
          transcript: { provider: { recallai_async: { language_code: 'auto' } } },
        },
      }),
    });

    if (!response.ok) {
      // ⚠ Status only, never the body. An error body from a third party can
      // echo the request back, and the request contains a meeting link.
      console.error('[recall] bot creation failed', { status: response.status });
      return NextResponse.json(
        { error: 'Could not send the notetaker to that meeting.' },
        { status: 502 },
      );
    }

    bot = (await response.json()) as RecallBot;
  } catch {
    console.error('[recall] bot creation did not complete');
    return NextResponse.json(
      { error: 'Could not reach the meeting service.' },
      { status: 502 },
    );
  }

  const botId = typeof bot.id === 'string' ? bot.id : '';

  if (!isPlausibleBotId(botId)) {
    /*
     * ⚠⚠ A bot is now RUNNING that we cannot link to a tenant.
     *
     * This is the one failure here with a real consequence: it is in a meeting,
     * recording, and nothing in our database says whose it is. Left alone it
     * would bill and produce a recording nobody can claim.
     *
     * There is no safe recovery from this side — we do not have an id to stop
     * it with. Logged loudly so it is visible in the dashboard rather than
     * silent.
     */
    console.error('[recall] bot created but returned no usable id — it cannot be linked');
    return NextResponse.json(
      { error: 'The notetaker started but could not be linked to your account.' },
      { status: 502 },
    );
  }

  const now = Date.now();
  const { error: sessionError } = await supabase.from('meeting_bot_sessions').insert({
    recall_bot_id: botId,
    owner_id: user.id,
    channel_id: channelId,
    meeting_url: meetingUrl,
    expires_at: new Date(now + BOT_SESSION_TTL_MS).toISOString(),
  });

  if (sessionError) {
    /*
     * ⚠ Same situation as above and it fails the same way: the bot exists and
     * is unlinked. It is logged rather than swallowed, and the caller is told
     * plainly instead of being shown a success they cannot act on.
     */
    console.error('[recall] bot created but the session row failed');
    return NextResponse.json(
      { error: 'The notetaker started but could not be linked to your account.' },
      { status: 500 },
    );
  }

  return NextResponse.json({ botId, region: RECALL_REGION }, { status: 201 });
}
