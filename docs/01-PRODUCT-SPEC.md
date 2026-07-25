# 01 — Product Spec

*What Switchboard is, who it's for, and — importantly — what it is not.*

---

## 1. The problem

Professional communication is scattered. A single client relationship lives
across WhatsApp threads, email chains, and whatever else the client prefers.
Three consequences:

1. **Nothing is searchable in one place.** Finding "what did they say about the
   deadline" means remembering *which app* it was said in first.
2. **Commitments evaporate.** *"I'll send it Monday"*, *"let's meet Thursday
   3pm"* — these are said in passing and buried by the next fifty messages.
3. **There's no cross-channel picture of a person.** The same client is a phone
   number in one app and an email address in another, with no link between them.

## 2. The product

Switchboard is a **private, self-hosted communication console.** It ingests
messages from every channel you connect, normalizes them into one format, and
gives you:

- **One timeline** — every message from every channel, in order, in one view
- **Cross-channel search** — keyword *and* semantic, over the whole corpus
- **Unified contacts** — one person, however many handles they have
- **An assistant** — natural-language questions answered from your own messages

The assistant is the differentiator, and it's the thing Ms. Maria described
first. Everything else is the substrate that makes it possible.

---

## 3. Primary user

**The account/project manager at a small agency** who is the human router between
clients and the delivery team. They live in four apps and they are the single
point of failure for anything a client mentioned in passing.

Yuri is a valid stand-in for this user during development, using their own
Gmail and a WhatsApp test number. That matters: **it means we can dogfood from
Phase 1 without waiting on iOzera to hand over client data.**

---

## 4. User stories

Ordered by build priority. Each maps to a roadmap phase.

### Must have (v1)

- **US-0** — As a user, I sign in and see **only my own** messages, contacts, and
  channels. Another user's data is never visible to me under any circumstance.
- **US-1** — As a user, I connect a Gmail account so its mail flows into
  Switchboard automatically.
- **US-2** — As a user, I connect a WhatsApp business number so its messages flow
  in the same way.
- **US-3** — As a user, I see all messages from all connected channels in a
  single chronological timeline, with the channel clearly marked.
- **US-4** — As a user, I search across every channel at once and get results
  ranked by relevance, not just recency.
- **US-5** — As a user, I open a contact and see every conversation I've had with
  that person, across all channels, merged.
- **US-6** — As a user, I ask the assistant a question in plain language
  (*"do I have upcoming meetings?"*) and get an answer **with citations back to
  the specific messages it used**.

### Should have (v1 if time allows)

- **US-7** — As a user, I see automatically extracted **commitments and meetings**
  pulled out of message text, in a dedicated view.
- **US-7b** — As a user, when a meeting is detected I'm shown a **proposal** with
  the source message beside it, and on my confirmation it becomes a real Google
  Calendar event. **Nothing is ever added to my calendar without my say-so.**
- **US-8** — As a user, I filter the timeline by channel, contact, and date range.
- **US-9** — As a user, I get a **daily digest** of what needs my attention.

### Could have (stretch / post-v1)

- **US-10** — Facebook Messenger as a third channel, if iOzera's clients use it.
- **US-11** — Voice notes transcribed and made searchable alongside text.
- **US-12** — Reply outbound to a message from inside Switchboard.

---

## 5. Non-goals

**This list is load-bearing. Scope creep is the top risk to this project.**

| Not building | Why |
|---|---|
| **Call ingestion or recording, in any form** | Three reasons, any one sufficient: Ms. Maria ruled it out; WhatsApp provides no native recording, only a raw audio stream; and **RA 4200 makes recording a private communication without all-party consent a criminal offence in the Philippines** — including by a participant. See ADR-008. |
| **Team features** — sharing, invites, roles, admin console, cross-user visibility | The system *is* multi-tenant (ADR-009): multiple people, each with their own channels, isolated by RLS. But multi-tenant means **isolated, not collaborative**. Nobody asked for sharing, and it's the part that would actually blow up the timeline. |
| **Being a WhatsApp/email *client*** | Switchboard is read-and-understand, not send-and-manage. Outbound is US-12, a stretch goal, and deliberately last. |
| **Real-time chat UI** | It's a console over a message store, not a chat app. No typing indicators, no read receipts. |
| **Mobile app** | Responsive web is enough. A native app is a separate project. |
| **Training or fine-tuning a model** | We call an existing LLM API. Nothing about this problem needs custom weights. |
| **Handling real iOzera client data before consent** | See `docs/02-ARCHITECTURE.md` §Security. Dogfood on Yuri's own accounts. |

---

## 6. What "done" looks like for the demo

The demo that satisfies what Ms. Maria asked for is a single unbroken sequence:

1. Send an email to the connected Gmail account, live.
2. It appears in the Switchboard timeline within seconds, without a refresh.
3. Send a WhatsApp message to the connected number. It appears in the *same* timeline.
4. Search a term that appears in both. Both hit.
5. Open the contact. Both channels are merged under one person.
6. Ask the assistant *"what have I been asked to do this week?"* It answers,
   citing the two messages just sent.
7. One of those messages proposed a meeting. Switchboard shows it as a proposal
   beside its source message. Confirm it — **and it appears on the real Google
   Calendar**, on screen.
8. Sign in as a second user. The console is empty. None of the first user's
   messages are visible.

Step 7 is the moment that lands. Step 8 is the one that proves it's a real system
rather than a demo.

If that sequence works end to end, the project is a success. Everything in
`docs/04-ROADMAP.md` is ordered to make that sequence possible as early as
possible, then make it good.

---

## 7. Success criteria

| Dimension | Target |
|---|---|
| Channels working end to end | 2 (Gmail, WhatsApp) |
| Cross-tenant data leakage | **Zero.** Verified by an explicit isolation test |
| Calendar events created without confirmation | **Zero** |
| Time from message sent → visible in console | < 10 seconds |
| Assistant answers grounded in real messages | 100% — every answer cites sources |
| Assistant answers with no citation | Must refuse rather than guess |
| Deployed and reachable at a public URL | Yes — not localhost-only at demo time |
| Documentation a stranger could build from | This `docs/` tree |

The "must refuse rather than guess" line is deliberate. A monitoring tool that
hallucinates a meeting is worse than one that says *"I don't see anything about
that."* Build the refusal path early.

---

*Status: draft — not yet confirmed with iOzera. See `docs/00-CONTEXT.md` §7.*
