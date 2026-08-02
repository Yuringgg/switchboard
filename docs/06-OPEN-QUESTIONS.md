# 06 — Open Questions & Blockers

*Live document. Resolve items here rather than guessing, and move resolved ones
to the bottom with their answer.*

---

## 🟡 Needs a decision, not blocking

### Q11 — The assistant's ~30 questions/day is shared by all tenants. Fair?
**Raised:** 2026-08-03 · **Relevant by:** the moment a second person at iOzera uses it

Measured and previously undocumented: **Groq's limits are per organization**, not
per user (its 429 names the org), and Switchboard holds one Groq key for the
whole deployment. So every tenant draws on the same ~30 questions/day, and
**there is no per-user throttle in the code** — `askAssistant` handles the
provider's limit but enforces nothing of its own.

One user can therefore exhaust the assistant for everyone before lunch, and the
others see *"the assistant's daily question allowance is used up"* having asked
nothing. The message is accurate but reads as a fault rather than a shared
budget.

**Not urgent today** — 2 accounts, one of which owns nothing. Three options when
it becomes real, in ascending cost:

- **Say it plainly in the UI.** A line on `/assistant` naming the shared daily
  budget and how much is left. Cheapest, honest, and it converts a confusing
  failure into an understood constraint. Needs a counter — a `usage` table, or
  reading Groq's own remaining-tokens header.
- **A per-user daily quota** (say 10/day) enforced in `askAssistant`. Fair, and
  it stops one tenant starving the rest — but it lowers the ceiling for a solo
  user from 30 to 10, which is the common case today.
- **A Groq key per tenant.** Genuinely isolates them and is the only option that
  actually multiplies the budget. Costs a credential per user and a place to
  store it — `channels.credentials` already has the encryption pattern.

*Leaning:* the first, and only when a second real user exists. It costs least and
it is the one that would have prevented the confusion that raised this question.
⚠ Whatever is chosen, **do not fix this by moving the assistant to the 8B model**
— it was measurably worse at refusing, which is the property the product is
judged on (Q10).

### Q10 — Raise the assistant's ~30 questions/day ceiling?
**Raised:** 2026-08-02 · **Relevant by:** if it becomes annoying in practice

Measured: ~3,200 tokens per question against Groq's ~100K tokens/day. Two levers,
both trade-offs rather than wins:

- **`MAX_CONTEXT_MESSAGES` 8 → 4** — roughly doubles the daily budget, costs
  answer quality on broad questions ("summarise what needs my attention").
- **Assistant on `llama-3.1-8b-instant`** — 14,400 req/day, but it was
  measurably worse at refusing, which is the property that matters most here.

*Leaning:* leave it. 30/day is ample for a demo, and both levers spend the thing
the product is judged on.

### Q2 — Where does the assistant's conversation history live?
**Relevant by:** Phase 4 · **Still open after 4B shipped**

Phase 4B shipped **single-turn**, as this leaned. Each question is answered from
retrieval alone with no memory of the previous one — so "what about next week?"
as a follow-up does not work. Multi-turn adds a table and context-window
management. *Leaning unchanged:* polish, not v1.

### Q3 — How aggressive should automatic contact merging be?
**Relevant by:** Phase 3

Same display name across channels is weak evidence — two different Marias exist.
Auto-merging wrong contacts corrupts data in a way that's tedious to unwind.
*Leaning:* manual merge only in v1, with the UI *suggesting* likely matches.

### Q4 — Retention policy?
**Relevant by:** Phase 5

Supabase free tier is 500 MB, so this is a practical question as well as a policy
one. Less urgent now that development is on Yuri's own accounts.

### Q5 — Notion write-up for Ms. Maria: how much?
**Relevant by:** whenever Yuri wants it

Ms. Maria asked for research findings in Notion. *Leaning:* a short mentor-facing
summary rather than mirroring the full docs — the Azure OpenAI finding and the
WhatsApp reality check are the two things she'll actually care about.

---

## ✅ Resolved

### R22 — Ms. Maria's BRD and the Fatima meeting *(closes Q6 and Q8)*
**Withdrawn by Yuri, 2026-08-03: neither is needed any more.** Q6 chased the
*"answers and recommendations"* she mentioned on 2026-08-01 and the short BRD she
offered on 2026-07-25; Q8 chased the outcome of her conversation with Fatima.
Both were checked exhaustively on 2026-08-02 and are not on GitHub.

**Stop chasing them.** The product owner has decided the project proceeds on the
scope already built, and that is their call to make (R2 set the same precedent on
naming).

⚠ **What this does NOT close, stated plainly so nobody assumes it did:**
`docs/00-CONTEXT.md` §7 records that **the scope has never been formally
confirmed by iOzera** — everything in these docs rests on Ms. Maria's verbal
description. That risk is now **accepted rather than resolved**. It is very
likely fine: the built system matches her founding message closely, including the
summarizer and "real time" (§2a). But a future session should not read the
absence of Q6/Q8 as evidence that scope was signed off.

⚠ **The consent conversation is a separate question and is still open.** Q6 used
to carry it along, so it needs saying on its own: Phase 4A sends message bodies
to a third-party LLM, and `docs/02-ARCHITECTURE.md` §6 gates **real iOzera client
data** on an RA 10173 consent discussion. Dogfooding on Yuri's own accounts —
which is all that has ever happened — remains fine and unaffected. *2026-08-03*

### R1 — Can we use the Azure credit for the LLM?
**No.** Azure for Students cannot provision Azure OpenAI. → Groq/Llama instead
(ADR-003); Azure used for Container Apps + Blob only (ADR-004). *2026-07-25*

### R2 — Project name?
**Switchboard. Final.** Chosen by Yuri from four candidates, *2026-07-25*.

**Reaffirmed 2026-08-02 against an alternative.** Ms. Maria suggested filing the
work under the name **Aika** in her founding message (`docs/00-CONTEXT.md` §2a).
Yuri's ruling: *"do not use aika. Switchboard is the final name."* ⚠ **Do not
reintroduce it** — not in the repo, not in the console, not in the demo, and not
when talking to iOzera. Naming is the product owner's call and this one is
closed.

### R3 — Which channels in v1?
*Superseded by R9 below.* *2026-07-25*

### R4 — Language and stack?
**TypeScript monorepo** (ADR-002). Supervisor's call given no stated preference;
open to being overruled. *2026-07-25*

### R5 — Is the project scope confirmed?
**Yes — confirmed by Yuri, 2026-07-25.** The cross-channel monitoring tool is the
agreed project. Q1 above is a refinement of *what* it monitors, not whether it's
happening.

### R6 — Does iOzera claim IP / can the repo be public?
**Not a priority.** Yuri's position: the goal is a working system; ownership is
not a concern worth spending time on. Proceed without treating it as a gate.
*2026-07-25*

### R7 — Real client data or test accounts?
**Yuri's own accounts first**, explicitly to evaluate how accurate the assistant
is against real personal message volume before considering anything else. This
also resolves the data-privacy gate for now — no third-party client data enters
the system. *2026-07-25*

### R13 — Single-user or multi-user?
**Multi-tenant: multiple people, each with their own channels, seeing only their
own data.** Decided by Yuri, 2026-07-25. Reverses the original single-user
non-goal. Lands in Phase 0 because retrofitting `owner_id` and RLS across nine
tables later is a rewrite. **Team features — sharing, invites, roles, admin —
remain out of scope.** Multi-tenant means isolated, not collaborative. ADR-009.

### R14 — Where do "upcoming meetings" come from?
**Detected in message text, then written to Google Calendar on explicit user
confirmation.** ADR-010. Calendar scopes are requested in the same OAuth consent
as Gmail in Phase 1, so Phase 5 doesn't need a second consent screen.

### R15 — Gmail-specific or generic IMAP?
**Gmail now, generic IMAP later if iOzera needs it.** Gmail API gives OAuth and
Pub/Sub push, which is cleaner and real-time. A generic IMAP adapter would need a
persistent IDLE connection per account — a poor fit for scale-to-zero containers,
and a decision worth deferring until there's a real Outlook or company-mail
requirement. *2026-07-25*

### R16 — What did Ms. Maria mean by "voice" and "experimentation"?
**Nothing to design around.** Per Yuri: voice was an offhand example, and
"experimentation" describes the developmental nature of the project itself, not a
feature. Voice-note transcription stays as a low-priority stretch item.
*2026-07-25*

### R12 — What exactly does the tool monitor?
**Inbound messages received from people.** Ms. Maria: *"via WhatsApp magsi-sink
yung messages to a private server... doon siya magla-log sa website"*, and the
assistant answers over *"yung mga messages na nakuha ko"* — the messages I
received. Yuri's summary says the same: *"see what messages have been received."*

This was briefly raised as an open question about whether she meant existing
personal chat history. **She didn't, and it was never ambiguous** — she described
an integration syncing received messages into a server, which is precisely what
the WhatsApp Cloud API and Gmail API do. Question withdrawn.

**Build note, not a question:** development uses Meta's free test number; a
production deployment would point at iOzera's real business number. Same adapter,
different credentials. *2026-07-25*

### R9 — Which channels are in scope?
**Gmail and WhatsApp only.** Yuri cut Telegram and confirmed the priority as
WhatsApp and email. Messenger, Viber, Slack, Discord are out unless iOzera says
its clients use them — Messenger is the cheapest to add later, since it shares
Meta's app infrastructure with WhatsApp. Build order is **Gmail first** (real
inbox, no recipient cap), WhatsApp second. See ADR-001. *2026-07-25*

### R10 — Are calls in scope?
**No — excluded entirely.** Three independent reasons: Ms. Maria said to skip
them; WhatsApp provides no native call recording, only a raw audio stream; and
**RA 4200 makes recording a private communication without all-party consent a
criminal offence in the Philippines**, including when done by a participant
(*Ramirez v. CA*, 1995). See ADR-008. *2026-07-25*

### R11 — Which AI provider?
**Three, matched to workload** (ADR-003). Ms. Maria's Llama suggestion was
confirmed by Yuri as a *suggestion, not a requirement*, so the choice was made on
merit:

- **Gemini 2.5 Flash** → assistant Q&A. Groq's 12K tokens/min would allow only
  ~2 questions/min and ~15/day on RAG-sized prompts; Gemini gives 250K TPM and a
  1M context window.
- **Groq / Llama** → per-message extraction. Many small prompts, 14.4K req/day.
- **Local Transformers.js** → embeddings. Free, unlimited, cannot fail mid-demo.
  **Must be multilingual** — the corpus is Taglish. *2026-07-25*

### R17 — Full stack, chosen on merit?
**Yes — Yuri delegated all technology choices.** Everything is now picked for the
project rather than inherited from a suggestion. Library-level decisions (Drizzle
vs Prisma, Zod, Vitest, mailparser, date-fns) are pinned in
`docs/02-ARCHITECTURE.md` §8, and deployment topology in ADR-011. *2026-07-25*

### R8 — Do we need iOzera's WhatsApp Business account?
**No.** Meta provides a **free test business number** that exchanges messages
with up to 5 verified recipients, with no business verification required. That's
sufficient to build and demo the entire WhatsApp adapter. A real business number
would only matter for monitoring genuine client traffic in production.
*2026-07-25* — see ADR-001 amendment.

---

### R18 — Which AI provider answers assistant questions?
**Groq `llama-3.3-70b-versatile`, not Gemini.** ADR-003 chose Gemini 2.5 Flash on
250 requests/day; measured 2026-08-02 that free tier is **20 per day**
(`"quotaValue": "20"`, read off the quota error). One eval run needs 15. Groq
gives 1,000/day, and summaries stay on a *different* Groq model so the two cannot
exhaust each other. `ASSISTANT_PROVIDER=gemini` reverts it in one variable.
*2026-08-02*

### R19 — How does the assistant refuse?
**The model refuses from context; a similarity threshold cannot.** ADR-007
specified an absolute floor. Measured over the real corpus, the lowest
*answerable* score (0.8487) sits **below** the highest *unanswerable* one
(0.8563) — e5's embeddings occupy a narrow band where absolute distance barely
signals relevance, though **ranking** is excellent. A relative floor replaces the
absolute one, which survives only as an empty-corpus backstop. **ADR-016**.
*2026-08-02*

### R9b — Should the assistant's prompt be tuned to stop over-refusing? *(was Q9)*
**The premise was wrong — it was not over-refusing.** Q9 recorded the assistant
as wrongly refusing *"do I have upcoming meetings?"* and *"summarise what needs my
attention"*, and prescribed softening the prompt. Measured before acting, with
`apps/worker/scripts/probe-context.ts` (zero quota cost):

- *"needs my attention"* retrieves **eight newsletters and promotions** — none of
  the CI failures, deploy failures or the Supabase pause reach the model at all.
- Every meeting in the corpus is **27–28 July**; the only one naming a time was
  "9pm tonight" sent at 19:59 on 2 Aug, and the eval ran at 22:40. **The refusal
  was correct**, and the case's verdict depended on the hour of the day.

Both are Phase 5 asks (US-7, US-9; R14 already routes meetings through
extraction) and are now recorded as `known-gap` — printed every run, not scored.
Softening the prompt to reach 7/7 would have been **fabrication with a passing
score**; the earlier prompt already showed the destination at 7/7 answerable and
3/8 refusals. What did change is that the prompt's decision became **three-way**,
so genuine synthesis questions are answered rather than refused. **ADR-017.**
*2026-08-02*

### R21 — Where does a citation link to?
**`/messages/[id]`, not a position in the timeline.** `docs/02-ARCHITECTURE.md`
§4 step 6 specified a timeline jump; the timeline is capped at the newest 50, so
a citation to anything older would silently resolve to nothing — which reads as
an invented source, the failure ADR-007 exists to prevent. A route resolves any
message, survives being shared or opened in a tab, and gives Phase 5 the
source-message view ADR-010 requires beside every meeting proposal. **ADR-018.**
*2026-08-02*

### R20 — Can the console run the embedding model itself?
**No — the worker serves it over one authenticated route.** 129 MB plus native
ONNX binaries in a serverless function measured a ~35 s cold start, and a demo's
first question *is* a cold start. The worker holds the model warm (ADR-011), so
its ingress became external carrying exactly `POST /embed`: it takes text,
returns numbers, never touches the database, and has no notion of a user.
Retrieval deliberately stays in the console on the user's own session, so **RLS**
decides whose messages are searched. *2026-08-02*

---

*Last updated: 2026-08-02 (late) · Q9 resolved as R9b — its premise was
disproved by measurement, which is the fifth time on this project. Q10 still
open. R21 records where a citation links. Q2 answered in practice (single-turn
shipped); R18–R20 resolved by measurement.*
