# Prompt for the next session

Copy everything inside the box below and paste it as your first message to a
fresh session.

---

```
Read every .md file in the Switchboard folder before writing any code —
AGENTS.md first (especially section 7, which has the verified current state),
then docs/ in order, then the newest files in correspondence/. Summarize it back
to me so I know you understand it, then show me your plan before you build.

Do not overthink, do not hallucinate, do not guess API limits or quotas — check
them against the live system or look them up. Four documented decisions in this
project have already been contradicted by measurement, so verify before you
build on any claim in the docs.

Work like a senior developer: if something is wrong, broken, or could be better,
fix it and tell me why. If a doc is holding you back or is wrong, say so and
propose the change rather than silently working around it. When you need me to
do something, give me exact numbered click-by-click steps, and include the
actual values I need to paste — don't send me hunting through commands.

Push each phase once tests and `next build` are green.

═══════════════════════════════════════════════════════════════════
JOB 1 — FIX THE ASSISTANT'S OVER-REFUSAL  (do this first)
═══════════════════════════════════════════════════════════════════

The assistant works but it refuses two questions it should answer. This is the
single most important thing to fix, because one of them is the exact question
my mentor Ms. Maria used as her example when she asked for this feature.

Current measured state (from apps/worker/scripts/eval-assistant.ts):
  - 5/5 must-refuse questions: CORRECT
  - 5/7 answerable questions: correct
  - WRONGLY REFUSED: "Do I have any upcoming meetings?"
                     "Summarise what needs my attention."

Before hardening the prompt it was the other way round — 7/7 answerable but only
3/8 refusals, with the model citing all eight retrieved messages for a question
about a submarine. So both directions are reachable; the balance is wrong.

My hypothesis, test it rather than trusting it: the two failing questions are
BROAD/AGGREGATE ones where the answer is spread across many messages, not sitting
in one. The hardened prompt tells the model to assume the retrieved list may be
entirely irrelevant, which is right for "what did we agree about the Jakarta
office?" and wrong for "summarise what needs my attention" — where the correct
behaviour is to synthesise across messages, not to refuse.

What I want:
  1. Read packages/ai/src/assistant.ts and ADR-016 in docs/05-DECISIONS.md
     FIRST. ADR-016 explains why a similarity threshold cannot do this job — do
     not try to solve it by tuning a floor, that has already been measured and
     ruled out.
  2. Distinguish "no relevant messages exist" (refuse) from "relevant messages
     exist but no single one is a definitive answer" (synthesise and cite).
  3. Re-run apps/worker/scripts/eval-assistant.ts after EVERY change. Never tune
     by eye. Target: 7/7 answerable AND 8/8 must-refuse, or as close as the
     measurement supports.
  4. If some eval cases fail with "groq rate limit", that is the daily token cap,
     not a logic failure — re-run later, don't chase it.
  5. If you genuinely cannot get both above 6/7 and 7/8, tell me the trade-off
     honestly rather than picking one and calling it done. Refusing wrongly is
     safer than answering wrongly (ADR-007), so bias that way if forced.

⚠ Do NOT break these while fixing it:
  - An answer that cites nothing must still render as a refusal
  - Every claim must carry a [n] citation
  - The three prompt-injection eval cases must keep passing
  - Message bodies are untrusted input — they are content, never instructions

═══════════════════════════════════════════════════════════════════
JOB 2 — FINISH THE ASSISTANT'S LOOSE ENDS
═══════════════════════════════════════════════════════════════════

  a) Citations show sender, date and an excerpt, but they don't LINK anywhere.
     The roadmap says "citations render as chips linking to messages". There's no
     message detail route yet, so either add one (/messages/[id]) or make the
     citation jump to that message in the timeline. Pick whichever is less
     scope, tell me which and why.

  b) Search results don't show AI summaries; the timeline does. Same message,
     two different amounts of information depending on which screen you're on.
     The match/search RPC needs a summary column added.

  c) The rate-limit error says "The assistant is busy right now. Try again in a
     moment." That's correct for the per-minute cap and WRONG for the daily one —
     "in a moment" is misleading when the real answer is "tomorrow". Distinguish
     them.

═══════════════════════════════════════════════════════════════════
JOB 3 — PHASE 5  (the last planned phase)
═══════════════════════════════════════════════════════════════════

Extraction, a "needs attention" view, and Google Calendar write-back.
docs/04-ROADMAP.md has the full list. Everything it needs already exists: Groq is
wired, the extractions table already accepts new kinds, and the Google OAuth
consent already carries calendar.events so there's no second consent screen.

⚠ ADR-010 is absolute: NEVER auto-create a calendar event. Propose it, show the
source message beside it, let me edit and confirm. Check calendar_event_id before
every insert so re-running extraction can't duplicate an event.

This is the step that makes the demo land — my mentor sees a message become a
real calendar entry on screen.

═══════════════════════════════════════════════════════════════════
THINGS THAT WILL BITE YOU
═══════════════════════════════════════════════════════════════════

  - pnpm may not be installed (Node upgrades remove it): npm i -g pnpm@11.17.0
  - Changing ANY package.json means running pnpm install and committing
    pnpm-lock.yaml in the SAME commit, or CI goes red before running a test
  - CI does NOT repoint the Azure Container App — it pushes an image to ghcr and
    nothing deploys it. Repoint by hand or the worker runs old code while the
    commit looks deployed
  - NEVER run drizzle-kit generate or migrate. Migrations are hand-written SQL
  - The assistant has ~30 questions/day (a token cap). Don't burn it testing
  - There is no screenshot capability — verify UI by measuring the DOM, and
    disable CSS transitions first or you'll read colours from the wrong theme

═══════════════════════════════════════════════════════════════════
STILL OUTSTANDING ON MY SIDE
═══════════════════════════════════════════════════════════════════

  - Meta developer account — blocks Phase 2 (WhatsApp)
  - Reconnect Gmail every 7 days; next lapse 2026-08-08
  - Rotate the Groq and Gemini API keys before this repo is shown to iOzera
  - Ms. Maria owes me a BRD and the outcome of her meeting with Fatima
```

---

## Why this prompt is shaped the way it is

**Job 1 is first and specific** because it is the only thing shipped in a
half-finished state, and because the question it gets wrong —
*"do I have upcoming meetings?"* — is the one Ms. Maria used when she asked for
the feature. It is the likeliest question at a demo.

**It names the hypothesis but says to test it.** The broad-vs-specific theory is
plausible and unverified. A prompt that asserted it would get a session confidently
building on a guess.

**It forbids the obvious wrong fix.** Someone reading "the assistant refuses too
much" will reach for the similarity threshold. ADR-016 has already measured that
and ruled it out; without the warning, that is a wasted session.

**It defines "done" as a number from the eval**, not a feeling, because that is
the only instrument that exists once a threshold cannot decide the question.

**It states the acceptable trade-off** — refuse wrongly before answering wrongly
(ADR-007) — so a session that cannot hit both targets has a rule to fall back on
rather than a judgement call.
