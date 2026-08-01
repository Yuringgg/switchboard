# 06 — Open Questions & Blockers

*Live document. Resolve items here rather than guessing, and move resolved ones
to the bottom with their answer.*

---

## 🔴 Outstanding input from the mentor

### Q8 — What came out of Ms. Maria's meeting with Fatima?
**Raised:** 2026-08-02 · **Relevant by:** now — it may close the biggest open risk

In the same WhatsApp thread she mentioned *"nakausap ko palang sila fati now"* —
she had just spoken with Fatima. `docs/00-CONTEXT.md` §6 item 3 lists exactly
that meeting as pending, and §7 records the standing risk that **the project
scope has never been formally confirmed by iOzera** — everything in these docs
rests on her verbal description.

That conversation may be where her *"answers and recommendations"* (Q6) came
from. **Ask about both together.** If scope was confirmed, §7's open-scope risk
can finally be closed.

### Q6 — Where are Ms. Maria's recommendations?
**Raised:** 2026-08-01 · **Blocking:** nothing yet, but it is real input we do not have

She wrote: *"i checked your systems and querries and set aside the answers snd
recommendations"*. **They have not arrived.**

**This is very likely the BRD she offered on day one** — *"lmk if you need help
ill try to compile a short brd or feats you can add"* (`docs/00-CONTEXT.md`
§2a). A business requirements document from the sole source of requirements is
the single most valuable outstanding input to this project, and it would settle
scope questions that are currently guesses. **Name it when you ask her:** *"Ms,
yung short BRD/feats mo — saan mo po sinend?"* Checked exhaustively on 2026-08-02
— they are **not on GitHub**: no issues, no pull requests, no comments, no
branches besides `main`, no forks, and every event on the repo is Yuri's own
push. She is not a collaborator on it.

**Action: Yuri asks her where she put them.** Likeliest places are WhatsApp,
email, or a Notion page — note that Q5 already records her asking for a Notion
write-up, so a shared Notion space may be where she expects this to live.

Ask about **consent and retention in the same conversation** — Phase 4A sends
message bodies to a third-party LLM for the first time (ADR-015), which makes
the Q2/RA 10173 question in `docs/02-ARCHITECTURE.md` §6 concrete rather than
theoretical.

---

## 🟡 Needs a decision, not blocking

### Q2 — Where does the assistant's conversation history live?
**Relevant by:** Phase 4

Multi-turn memory is a better experience but adds a table and context-window
management. *Leaning:* single-turn for v1, multi-turn as polish.

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

*Last updated: 2026-07-25 · Planning session 1*
