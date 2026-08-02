import {
  ASSISTANT_SYSTEM_PROMPT,
  buildAssistantPrompt,
  createAssistantProvider,
  EMPTY_CORPUS_ANSWER,
  parseAnswer,
  selectContext,
  type RetrievedMessage,
} from '@switchboard/ai';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * The assistant turn (US-6, ADR-007, ADR-016).
 *
 * ── Why the embedding comes from the worker ──────────────────────────────────
 *
 * The model is 129 MB plus native ONNX binaries. That does not belong in a
 * serverless function — the cold start alone was measured at 35 seconds, and a
 * demo's first question is exactly a cold start. ADR-011 already puts the model
 * in the warm worker for this reason, so the console asks it for one vector.
 *
 * ⚠ **Retrieval deliberately stays here, not in the worker.** `match_chunks`
 * runs through the user's own session, so RLS decides whose messages are
 * searched. Moving retrieval into the worker would put it behind
 * `service_role`, where a wrong tenant id is a silent cross-tenant leak that no
 * policy catches. The worker gets text and returns numbers; it never learns who
 * asked.
 */

export interface Citation {
  /** Where the chip links: `/messages/<id>`. See ADR-017. */
  messageId: string;
  subject: string | null;
  senderName: string | null;
  sentAt: string;
  excerpt: string;
}

export interface AssistantAnswer {
  answer: string;
  citations: Citation[];
  refused: boolean;
  /** Set when the turn could not complete. The UI shows this, not `answer`. */
  error: string | null;
}

/** Ask the worker to embed the question. Never sends anything but the text. */
async function embedViaWorker(question: string): Promise<number[] | null> {
  const url = process.env.EMBED_API_URL;
  const secret = process.env.EMBED_API_SECRET;
  if (!url || !secret) return null;

  try {
    const response = await fetch(`${url.replace(/\/$/, '')}/embed`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${secret}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ text: question }),
      // The worker is warm, so this is a fast hop. A hung request must not hold
      // the user's page open.
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      console.error(`[assistant] embed failed: http ${response.status}`);
      return null;
    }

    const body = (await response.json()) as { embedding?: number[] };
    return Array.isArray(body.embedding) ? body.embedding : null;
  } catch (error) {
    console.error(
      '[assistant] embed request failed:',
      error instanceof Error ? error.message : 'unknown',
    );
    return null;
  }
}

/**
 * What to say when the provider refuses on quota.
 *
 * ── ⚠ Why this is not one sentence ───────────────────────────────────────────
 *
 * It used to be: *"The assistant is busy right now. Try again in a moment."*
 * That is correct for the per-minute window — 12,000 tokens/min, about three or
 * four questions, and it clears in seconds. It is **wrong for the daily
 * allowance**, which is the limit that actually binds this project: roughly
 * 30 questions a day at ~3,200 tokens each, and "in a moment" sends someone
 * clicking Ask at a wall for hours.
 *
 * The two are genuinely hard to tell apart from the outside, which is the whole
 * problem — a daily-token rejection arrives with a **full** per-minute budget
 * (`x-ratelimit-remaining-tokens: 12000`, observed twice on 2026-08-02),
 * so everything visible says the assistant should be fine. `packages/ai`
 * resolves it from the provider's own 429 and hands the answer down as
 * `limitScope`.
 *
 * ⚠ No claim is made about *when* a daily allowance returns. Groq's buckets
 * replenish continuously rather than resetting at midnight — measured from the
 * live headers, one request costs `reset-requests: 1m26.4s`, which is exactly
 * 86400/1000 — so "resets at midnight UTC" would be a confident falsehood. When
 * the provider states a wait, that number is used; otherwise the message says
 * plainly that it does not know.
 */
export function rateLimitMessage(
  scope: 'minute' | 'day' | 'unknown' | undefined,
  retryAfterMs: number | undefined,
): string {
  if (scope === 'day') {
    const wait = retryAfterMs ? ` It should recover in about ${humanWait(retryAfterMs)}.` : '';
    return (
      "The assistant's daily question allowance is used up, so it cannot answer " +
      `anything else today.${wait} Search, the timeline and summaries are ` +
      'unaffected — they have no such limit.'
    );
  }

  if (scope === 'minute') {
    const wait = retryAfterMs ? ` Try again in about ${humanWait(retryAfterMs)}.` : '';
    return `The assistant is answering too many questions at once.${wait}`;
  }

  // Either the provider did not say, or this is a transient failure that is not
  // a quota at all. Do not invent a horizon for it.
  return 'The assistant could not answer that just now. Try again shortly.';
}

/** "45 seconds" · "3 minutes" · "2 hours" — never a bare millisecond count. */
function humanWait(ms: number): string {
  const seconds = Math.ceil(ms / 1000);
  if (seconds < 90) return `${seconds} second${seconds === 1 ? '' : 's'}`;

  const minutes = Math.round(seconds / 60);
  if (minutes < 90) return `${minutes} minute${minutes === 1 ? '' : 's'}`;

  const hours = Math.round(minutes / 60);
  return `${hours} hour${hours === 1 ? '' : 's'}`;
}

interface MatchRow {
  message_id: string;
  chunk_index: number;
  content: string;
  similarity: number;
  subject: string | null;
  body_text: string;
  sent_at: string;
  direction: string;
  channel_id: string;
  sender_name: string | null;
  sender_ref: string | null;
}

/**
 * Answer one question.
 *
 * Returns rather than throws on every path — this is called from a server
 * action and a thrown error there is an unhandled rejection in a React
 * transition, which surfaces as a blank screen rather than a message.
 */
export async function askAssistant(
  supabase: SupabaseClient,
  question: string,
  channelLabels: Map<string, string>,
): Promise<AssistantAnswer> {
  const trimmed = question.trim().slice(0, 500);

  if (!trimmed) {
    return { answer: '', citations: [], refused: false, error: 'Ask a question first.' };
  }

  // Groq by default — Gemini's free tier is 20 requests/DAY, measured
  // 2026-08-02. See packages/ai/src/assistant-provider.ts.
  const chosen = createAssistantProvider({
    groqApiKey: process.env.GROQ_API_KEY,
    geminiApiKey: process.env.GEMINI_API_KEY,
    preferred: process.env.ASSISTANT_PROVIDER,
  });

  if (!chosen.ok) {
    return {
      answer: '',
      citations: [],
      refused: false,
      error: `The assistant is not configured on this deployment (${chosen.reason}).`,
    };
  }

  const embedding = await embedViaWorker(trimmed);
  if (!embedding) {
    return {
      answer: '',
      citations: [],
      refused: false,
      error:
        'Could not reach the embedding service, so the assistant cannot search your messages right now.',
    };
  }

  // RLS scopes this to the signed-in user — `match_chunks` is SECURITY INVOKER
  // and takes no owner argument. See migration 0009.
  const { data, error } = await supabase.rpc('match_chunks', {
    query_embedding: `[${embedding.join(',')}]`,
    match_count: 20,
    min_similarity: 0,
    channel_ids: null,
  });

  if (error) {
    console.error(`[assistant] retrieval failed: ${error.message}`);
    return { answer: '', citations: [], refused: false, error: 'Could not search your messages.' };
  }

  const retrieved: RetrievedMessage[] = ((data ?? []) as MatchRow[]).map((row) => ({
    messageId: row.message_id,
    similarity: row.similarity,
    subject: row.subject,
    content: row.content,
    bodyText: row.body_text,
    sentAt: row.sent_at,
    direction: row.direction,
    senderName: row.sender_name,
    senderRef: row.sender_ref,
    channelLabel: channelLabels.get(row.channel_id) ?? null,
  }));

  const context = selectContext(retrieved);

  /*
   * Nothing retrieved at all — an empty corpus, or nothing embedded yet.
   *
   * ⚠ This is NOT the refusal path. ADR-016: the absolute floor cannot tell an
   * irrelevant question from a relevant one, because e5's similarities sit in a
   * band where the unanswerable outscores the answerable. This branch catches
   * "there is nothing here to search", and the model handles "there is nothing
   * here about *that*".
   */
  if (context.length === 0) {
    return { answer: EMPTY_CORPUS_ANSWER, citations: [], refused: true, error: null };
  }

  const completion = await chosen.provider.complete(
    ASSISTANT_SYSTEM_PROMPT,
    buildAssistantPrompt(trimmed, context),
  );

  if (!completion.ok) {
    console.error(`[assistant] completion failed: ${completion.reason}`);
    return {
      answer: '',
      citations: [],
      refused: false,
      error: completion.retryable
        ? rateLimitMessage(completion.limitScope, completion.retryAfterMs)
        : 'The assistant could not answer that.',
    };
  }

  const parsed = parseAnswer(completion.text, context);

  // Only the messages actually cited, in the order the model cited them, so the
  // chips below the answer match the numbers inside it.
  const byId = new Map(context.map((message) => [message.messageId, message]));
  const citations: Citation[] = parsed.citedMessageIds.flatMap((id) => {
    const message = byId.get(id);
    if (!message) return [];
    return [
      {
        messageId: id,
        subject: message.subject,
        senderName: message.senderName ?? message.senderRef,
        sentAt: message.sentAt,
        // The retrieved CHUNK, not the body: it is the part that actually
        // matched, so the excerpt shows why this message was cited rather than
        // whatever the message happens to open with.
        excerpt: message.content.slice(0, 180),
      },
    ];
  });

  return { answer: parsed.text, citations, refused: parsed.refused, error: null };
}
