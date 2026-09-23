'use client';

import { Loader2, Video } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { Callout } from '@/components/callout';
import { displayMeetingUrl, type BotSessionRow } from '@/lib/meetings/sessions';
import { buttonClass, LABEL } from '@/lib/ui';
import { cn } from '@/lib/utils';

/**
 * Sending a notetaker into a meeting, and watching what it does (Phase 7A).
 *
 * ── ⚠⚠ RA 4200 — WHY THERE IS A CHECKBOX AND WHY IT IS NOT DECORATION ──────
 *
 * Recording a private communication without the consent of **every** party is a
 * **criminal offence** in the Philippines. It is the same law behind ADR-008
 * excluding calls, and `docs/04-ROADMAP.md` lists it as the highest-severity
 * risk on this project.
 *
 * Until this screen existed, the only way to send a bot was a `fetch` typed
 * into DevTools. That was not a safeguard, but it *was* friction, and it meant
 * nobody sent a bot without knowing exactly what they were doing. **A button
 * removes that friction completely.** So the button carries the gate the
 * friction used to provide.
 *
 * The box is unchecked on every render — never remembered, never defaulted on.
 * Consent is obtained per meeting, from the people in it, and a preference
 * stored in a browser cannot represent that.
 *
 * ⚠ This is a product rule, not a technical one, and the server cannot enforce
 * it — `/api/meetings/bot` has no way to know what was said in a room. Do not
 * "simplify" this into a one-click send. The bot being named and visible in the
 * participant list is a *mitigation*; this is the closest thing to consent the
 * software can hold.
 *
 * ── ⚠ Why the meeting link is never rendered back ───────────────────────────
 *
 * A Zoom link carries its password in `?pwd=…`. `displayMeetingUrl` strips the
 * query string, so a live meeting password never reaches the screen, a
 * screenshot, or a recording of a demo. The route redacts the same value out of
 * its error logs.
 *
 * ── Why it polls ────────────────────────────────────────────────────────────
 *
 * Recall's webhooks cannot be created on this account, so nothing tells the
 * console when a bot joins or finishes. It asks instead, every 10 seconds,
 * only for bots not yet in a terminal state, and stops entirely once they all
 * are. See `api/meetings/bot/[id]/route.ts`.
 */

interface BotStatus {
  botId: string;
  code: string;
  finished: boolean;
  recordings: number;
}

const POLL_MS = 10_000;

/**
 * Recall's status codes, said in words.
 *
 * ⚠ An unrecognised code renders as itself rather than as "unknown". Recall
 * adds codes, and showing their word for it is more useful than hiding it
 * behind ours.
 */
const STATUS_WORDS: Record<string, string> = {
  ready: 'Getting ready',
  joining_call: 'Joining',
  in_waiting_room: 'Waiting to be let in',
  in_call_not_recording: 'In the meeting',
  in_call_recording: 'Recording',
  recording_permission_allowed: 'Recording',
  recording_permission_denied: 'Refused permission to record',
  call_ended: 'Meeting ended',
  done: 'Finished',
  fatal: 'Failed',
  media_expired: 'Recording expired',
};

function statusWord(code: string): string {
  return STATUS_WORDS[code] ?? code.replace(/_/g, ' ');
}

export function MeetingsPanel({ sessions }: { sessions: BotSessionRow[] }) {
  const [meetingUrl, setMeetingUrl] = useState('');
  const [botName, setBotName] = useState('Switchboard Notetaker');
  const [consented, setConsented] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<BotSessionRow[]>([]);
  const [statuses, setStatuses] = useState<Record<string, BotStatus>>({});

  // Optimistically prepended rows sit above whatever the server handed us, so a
  // bot appears the instant it is accepted rather than after a round trip.
  const rows = useMemo(() => [...sent, ...sessions], [sent, sessions]);

  /*
   * ⚠ Only bots we have not yet seen finish. A terminal state never changes, so
   * polling one again is a request that can only return what we already have.
   */
  const pending = useMemo(
    () => rows.filter((row) => !statuses[row.recall_bot_id]?.finished).map((r) => r.recall_bot_id),
    [rows, statuses],
  );

  const poll = useCallback(async (ids: string[]) => {
    const results = await Promise.all(
      ids.map(async (id) => {
        try {
          const response = await fetch(`/api/meetings/bot/${id}`, { cache: 'no-store' });
          if (!response.ok) return null;
          return (await response.json()) as BotStatus;
        } catch {
          // A failed poll is not a failed bot. Leave the last known state alone
          // rather than rendering a transient network error as a status.
          return null;
        }
      }),
    );

    setStatuses((current) => {
      const next = { ...current };
      for (const status of results) if (status) next[status.botId] = status;
      return next;
    });
  }, []);

  useEffect(() => {
    if (pending.length === 0) return;

    // Once immediately, so a freshly loaded page is not blank for ten seconds.
    void poll(pending);
    const timer = setInterval(() => void poll(pending), POLL_MS);
    return () => clearInterval(timer);
    // `pending` is derived and stable by value; joining it keeps the effect
    // from restarting on every unrelated render.
  }, [pending.join(','), poll]);

  async function send(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    const url = meetingUrl.trim();

    /*
     * ⚠ Checked here AND on the server. This one is a courtesy — it puts the
     * message next to the field instead of after a round trip — and the one in
     * the route is the one that matters. A client check is not a control.
     */
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      setError('That does not look like a meeting link. Paste the full link, starting with https.');
      return;
    }

    if (parsed.protocol !== 'https:') {
      setError('The link has to start with https.');
      return;
    }

    setSending(true);
    try {
      const response = await fetch('/api/meetings/bot', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ meetingUrl: url, botName: botName.trim() }),
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        setError(body?.error ?? 'Could not send the notetaker to that meeting.');
        return;
      }

      const { botId } = (await response.json()) as { botId: string };
      const now = new Date().toISOString();

      setSent((current) => [
        {
          recall_bot_id: botId,
          meeting_url: url,
          created_at: now,
          // Matches BOT_SESSION_TTL_MS. Display only — the row the server wrote
          // is the one that counts.
          expires_at: new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString(),
          last_event_at: null,
          last_event_type: null,
        },
        ...current,
      ]);

      setMeetingUrl('');
      // ⚠ Consent is re-obtained per meeting. Never carried to the next one.
      setConsented(false);
    } catch {
      setError('Could not reach the server. Try again in a moment.');
    } finally {
      setSending(false);
    }
  }

  const canSend = consented && meetingUrl.trim().length > 0 && !sending;

  return (
    <div className="space-y-8">
      <form onSubmit={send} className="rounded-xl border border-border bg-panel p-5">
        <h2 className={cn(LABEL, 'text-foreground')}>Send a notetaker</h2>

        <div className="mt-4 space-y-4">
          <div>
            <label htmlFor="meeting-url" className="text-note font-medium">
              Meeting link
            </label>
            <input
              id="meeting-url"
              type="url"
              inputMode="url"
              autoComplete="off"
              value={meetingUrl}
              onChange={(event) => setMeetingUrl(event.target.value)}
              placeholder="https://us05web.zoom.us/j/..."
              className="focus-ring mt-1.5 h-9 w-full rounded-md border border-border bg-background px-3 text-sm"
            />
            <p className="mt-1.5 text-meta text-muted-foreground">
              Zoom, Google Meet or Microsoft Teams.
            </p>
          </div>

          <div>
            <label htmlFor="bot-name" className="text-note font-medium">
              Name shown in the meeting
            </label>
            <input
              id="bot-name"
              type="text"
              maxLength={100}
              value={botName}
              onChange={(event) => setBotName(event.target.value)}
              className="focus-ring mt-1.5 h-9 w-full rounded-md border border-border bg-background px-3 text-sm"
            />
            {/*
              ⚠ Not a cosmetic field. Everyone in the room sees this name in the
              participant list, and a recorder nobody can see is precisely what
              RA 4200 is about. The route refuses a blank one.
            */}
            <p className="mt-1.5 text-meta text-muted-foreground">
              Everyone in the meeting sees this. It has to say what it is.
            </p>
          </div>
        </div>

        {/*
          ── ⚠⚠ THE GATE. Read the note at the top of this file before changing
          anything below. ────────────────────────────────────────────────────
        */}
        <label className="mt-5 flex cursor-pointer items-start gap-3 rounded-lg border border-border bg-background p-3.5">
          <input
            type="checkbox"
            checked={consented}
            onChange={(event) => setConsented(event.target.checked)}
            className="focus-ring mt-0.5 size-4 shrink-0 accent-primary"
          />
          <span className="text-note text-pretty">
            <span className="font-medium text-foreground">
              Everyone in this meeting has agreed to being recorded.
            </span>{' '}
            <span className="text-muted-foreground">
              Recording a private conversation without the consent of every
              person in it is a criminal offence in the Philippines under RA
              4200. Ask first, out loud, before you send this.
            </span>
          </span>
        </label>

        {error && (
          <Callout tone="error" role="alert" className="mt-4">
            {error}
          </Callout>
        )}

        <button type="submit" disabled={!canSend} className={buttonClass({ className: 'mt-5' })}>
          {sending ? (
            <>
              <Loader2 className="size-4 animate-spin" aria-hidden />
              Sending
            </>
          ) : (
            <>
              <Video className="size-4" aria-hidden />
              Send the notetaker
            </>
          )}
        </button>
      </form>

      <section>
        <h2 className={cn(LABEL, 'text-foreground')}>Notetakers sent</h2>

        {rows.length === 0 ? (
          <p className="mt-3 rounded-lg border border-dashed border-border px-3 py-8 text-center text-note text-muted-foreground">
            None yet. A notetaker you send appears here with what it is doing.
          </p>
        ) : (
          <ul className="mt-3 space-y-2">
            {rows.map((row) => {
              const status = statuses[row.recall_bot_id];
              const expired = new Date(row.expires_at).getTime() < Date.now();

              return (
                <li
                  key={row.recall_bot_id}
                  className="flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-lg border border-border bg-panel px-4 py-3"
                >
                  <span className="min-w-0 flex-1 truncate text-note font-medium">
                    {displayMeetingUrl(row.meeting_url)}
                  </span>

                  <span className={cn(LABEL, 'shrink-0')}>
                    {status ? statusWord(status.code) : 'Checking'}
                  </span>

                  {status && status.recordings > 0 && (
                    <span className={cn(LABEL, 'shrink-0 text-foreground')}>
                      {status.recordings === 1 ? '1 recording' : `${status.recordings} recordings`}
                    </span>
                  )}

                  {/*
                    ⚠ Said out loud rather than hidden. An expired row can no
                    longer accept a delivery, and a person who remembers sending
                    it deserves to know that rather than watch it sit there
                    looking live.
                  */}
                  {expired && !status?.finished && (
                    <span className={cn(LABEL, 'shrink-0')}>Session expired</span>
                  )}

                  <time
                    dateTime={row.created_at}
                    className="shrink-0 font-mono text-meta text-muted-foreground"
                  >
                    {new Date(row.created_at).toLocaleString('en-PH', {
                      timeZone: 'Asia/Manila',
                      month: 'short',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </time>
                </li>
              );
            })}
          </ul>
        )}

        {/*
          ⚠ Said plainly rather than left as a gap somebody has to discover.
          Nothing maps a transcript into `messages` yet, deliberately — see
          `lib/meetings/payload.ts`. A page that implies otherwise would send
          somebody hunting the timeline for a meeting that was never written.
        */}
        <p className="mt-4 text-meta text-muted-foreground text-pretty">
          A finished recording does not reach the timeline yet. Reading the
          transcript back into your messages is the next piece of this.
        </p>
      </section>
    </div>
  );
}
