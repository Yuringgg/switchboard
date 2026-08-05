# Switchboard — presentation script for Ms. Maria

**2026-08-05.** Read top to bottom. Everything in quotes is meant to be said out
loud; everything in brackets is something you do. Say it in whatever mix of
English and Tagalog you normally use with her — the words matter less than the
order.

**Every number in this script was measured on 2026-08-05, not estimated.** If
she asks where a figure comes from, the answer is in §8.

---

## 0. Before you start — 5 minutes of setup

- [ ] Open <https://switchboard-console-beryl.vercel.app> and sign in. Leave it
      on the timeline.
- [ ] Have your phone ready, with WhatsApp open.
- [ ] Have a second browser profile or incognito window ready but not signed in
      — that is for the last demo step.
- [ ] Send yourself one test email from another address **before** the meeting,
      so there is something recent at the top.
- [ ] Know your fallback: there is **one unconfirmed meeting proposal** already
      in the system. If the live one does not appear in time, open `/attention`
      and use that instead.

---

## 1. Opening — 30 seconds

> "Ma'am, ito yung Switchboard. Yung hiningi niyo noong July 25 — a live web app
> that shows WhatsApp messages in real time, with AI summarizing them, parang
> admin view. Ito po yung natapos."

> "Ang ginawa ko, hindi lang WhatsApp. Gmail and WhatsApp both go into one
> timeline, and on top of that there's an assistant you can ask questions to
> about your own messages. Everything it answers, it shows you which message it
> got it from."

> "Let me just show you first, then I'll explain how it's built."

**Show, then explain. Do not open with the architecture.**

---

## 2. The live demo — 5 minutes

This is the sequence. Do it in this order; each step sets up the next.

### Step 1 — a message arrives, live

> "This is the timeline. Every message from every channel I connected, in order."

[Send an email to your connected Gmail from your phone or another tab.]

> "Walang refresh. Watch."

[It appears within a few seconds.]

> "That's real. The email went to Gmail, Google pushed it to my server, my worker
> processed it, and the browser got it pushed live. No refresh, no polling."

### Step 2 — WhatsApp in the same timeline

[Send a WhatsApp message from your phone to the number you have connected.]

> "Same thing, different channel. WhatsApp message, same timeline, marked with a
> different color so you know where it came from."

⚠ **Be honest here if she asks to try it herself.** Say:

> "Right now the WhatsApp side is running on a temporary test connection, so it
> only accepts messages from my own number. That's the one thing I still need
> help with, and I'll explain it at the end."

Do not oversell this. §9 turns it into a request instead of a weakness.

### Step 3 — the AI summary

[Open a long message — one over 280 characters.]

> "Every message that's long enough gets a one-line summary written
> automatically when it arrives. Hindi mo na kailangan buksan lahat para malaman
> kung ano yung laman."

### Step 4 — search across both channels

[Search a word that appears in both an email and the WhatsApp message.]

> "One search, both channels. And it's not just keyword — it also searches by
> meaning, so kahit iba yung exact word na ginamit, makikita pa rin."

### Step 5 — the contact

[Open a contact with both an email address and a phone number.]

> "Same person. Sa Gmail siya email address, sa WhatsApp siya phone number.
> Switchboard links them into one person, and you see the whole history with
> them in one place."

### Step 6 — the assistant

[Ask: *"What have I been asked to do this week?"*]

> "Now the part you described. I ask it in plain language."

[Wait for the answer.]

> "See these chips? Every claim it makes is a link to the exact message it read.
> Kung wala siyang mahanap, hindi siya nag-i-imbento — it says it doesn't have
> anything about that. Yun yung rule: mas mabuti nang sabihin niyang wala, kaysa
> mag-guess."

**This is the most important sentence in the whole presentation.** Say it
slowly.

### Step 7 — the calendar

[Open `/attention`, find a meeting proposal.]

> "When it sees a meeting in a message, it doesn't add it to my calendar. It
> shows me a proposal, with the exact sentence it read it from, and I can edit
> it. Only when I press confirm does it become a real Google Calendar event."

[Confirm one. Show the real Google Calendar with the event on it.]

> "Yan po yung nasa totoong calendar ko ngayon."

### Step 8 — the proof that it's a real system

[Open the incognito window. Sign in as a second account, or just show the login.]

> "Last one. This is a different user. Empty. Wala siyang makikita sa mga message
> ko, kahit anong gawin niya — hindi lang siya naka-hide sa screen, hindi talaga
> siya kayang kunin sa database. That's enforced in the database itself, not in
> my code."

---

## 3. How it is built — 2 minutes

> "Buong system, TypeScript, plus hand-written SQL for the database."

Read this out as a list. Keep it flat and quick.

- **Front end and web app** — Next.js 16 with React, Tailwind and shadcn/ui for
  the interface, hosted on **Vercel**.
- **Background worker** — Node and TypeScript, running in a container on
  **Azure Container Apps**. It stays awake all the time because it holds the AI
  model in memory.
- **Database** — **Supabase**, which is Postgres. Plus **pgvector** for the
  semantic search, Supabase **Realtime** for the live updates, and Supabase
  **Auth** for the login.
- **AI** — **Groq**, running two different Llama models. The big one,
  `llama-3.3-70b-versatile`, answers questions. The fast one,
  `llama-3.1-8b-instant`, writes the summaries and does the extraction.
- **Embeddings for search** — a small multilingual model that runs **locally
  inside my worker**, using Transformers.js. Free, unlimited, and it works
  offline.
- **Calendar** — the Google Calendar API, write access, confirmed by the user
  only.
- **Testing** — Vitest. **527 tests, all passing.**

> "Two channels lang ngayon — Gmail and WhatsApp — pero pareho silang sumusunod
> sa iisang interface na tinatawag kong ChannelAdapter. So kung gusto niyo
> madagdagan, halimbawa Messenger, one file lang yun, hindi kailangang baguhin
> yung buong system."

**Why two Llama models, if she asks:** the rate limits are per model. Heavy use
of the assistant can never stop your mail from being summarized, because they
are drawing from separate budgets.

---

## 4. How a message actually gets in — the webhook part

She asked for this specifically. Keep it to four sentences.

> "A webhook is just this: instead of me asking Gmail every minute 'may bago ba?',
> Gmail calls *my* server the moment something arrives. Ako yung tinatawagan,
> hindi ako yung tumatawag."

> "So Gmail pushes through Google Pub/Sub to my endpoint at `/api/webhooks/gmail`,
> and WhatsApp posts to `/api/webhooks/whatsapp`."

> "Pagdating doon, tatlong bagay lang ang ginagawa niya: check kung totoo ba
> talaga yung nagpadala, isulat yung raw message sa isang queue table, then
> answer 200 OK agad — milliseconds. Wala nang iba."

> "Kasi kapag mabagal kang sumagot, uulit-ulitin nila, and eventually
> ipa-disable nila yung webhook mo. So lahat ng mabigat na trabaho — yung
> normalize, yung AI, yung search index — nasa hiwalay na worker na kumukuha sa
> queue."

**If she asks how you know the caller is really Meta:**

> "Signature check po. Meta signs every request with a secret only the two of us
> know — HMAC-SHA256 over the exact bytes they sent. Kung hindi tugma, 401, and
> hindi ko na binabasa yung laman. Kung walang naka-configure na secret, hindi
> siya nagpapapasok — 503 siya. Hindi siya pwedeng maging 'skip na lang natin
> yung check'."

---

## 5. The features, one line each

Read straight down if she asks "ano lahat ng kaya niya?"

1. **One timeline** — every message from every channel, newest first, channel
   marked.
2. **Real time** — new messages appear without refreshing, in under 10 seconds.
3. **AI summary per message** — automatic, for anything over 280 characters.
4. **Search** — keyword and by meaning, across all channels at once, with the
   matched words highlighted.
5. **Filters** — by channel, by contact, by date range.
6. **Contacts** — one person, however many email addresses and numbers they
   have, with their full cross-channel history.
7. **Manual merge** — if it doesn't realise two handles are the same person, you
   can join them yourself.
8. **The assistant** — plain-language questions, answers cited back to real
   messages, refuses instead of guessing.
9. **Extraction** — pulls meetings, commitments, requests and questions out of
   message text automatically.
10. **`/attention`** — one screen of what actually needs you, ordered by urgency
    rather than by what arrived last.
11. **Calendar write-back** — detected meetings become proposals; only your
    confirmation creates the real event.
12. **Multi-tenant** — every user sees only their own data, enforced by the
    database.

**Not built, and on purpose** — say this plainly if it comes up, it reads as
discipline rather than as a gap:

- **No call recording, in any form.** Three reasons: you said skip it, WhatsApp
  gives no recording anyway, and **RA 4200 makes recording a private
  conversation without everyone's consent a criminal offence here** — even if
  you're part of the conversation.
- **No replying from inside Switchboard yet.** It reads and understands; it is
  not a WhatsApp client. That's the next thing, not a missing thing.
- **No team sharing.** Multi-tenant means isolated, not collaborative.
- **Attachments** are not downloaded yet — the references are all stored, so it
  is a backfill later, not a rebuild.

---

## 6. Security and privacy — say this before she asks

> "Since binabasa nito yung totoong messages, seryoso ko pong tinrato yung
> security."

- **Row Level Security is on for all 11 tables**, from the very first migration.
  There is a **test in CI that fails and names the table** if anyone ever turns
  it off.
- **Channel credentials are encrypted before they touch the database** —
  AES-256-GCM. The column is `bytea`, not text, so storing plaintext looks
  obviously wrong.
- **Every webhook is signature-verified** before the body is even parsed.
- **Message bodies are never written to logs.** Only message IDs. When I need to
  read content for debugging, I read it from the database.
- **A pre-commit scanner** blocks a commit if anything secret-shaped is about to
  be committed.

> "And ma'am, importante po ito: **wala pa pong totoong client data dito.** Sarili
> kong Gmail at sarili kong number lang. Under RA 10173, kailangan muna nating
> pag-usapan yung consent, retention, at sino yung pwedeng maka-access bago
> pumasok yung totoong messages ng clients. Naka-tala po yun as an open question
> — hindi ko po basta-basta gagawin."

That paragraph does more for you than any feature. It shows you know the law
applies to this.

---

## 7. Where each phase stands

> "Anim na phase po. Lima tapos, isa yung natitira."

| Phase | What it is | Status |
|---|---|---|
| 0 | Foundation, login, database, security | ✅ Done |
| 1 | Gmail end to end | ✅ Done — live, real mail |
| 2 | WhatsApp | 🟡 Working, on a temporary connection |
| 3 | The console — search, filters, contacts, merge | ✅ Done except attachments |
| 4A | AI summaries per message | ✅ Done |
| 4B | The assistant with citations | ✅ Done |
| 5 | Extraction, `/attention`, calendar write-back | ✅ Done |

> "Ang natitira po: yung permanent WhatsApp number, attachments, at yung final
> polish bago yung demo."

---

## 8. The numbers, if she wants proof

All measured 2026-08-05.

- **527 automated tests**, 33 test files, all passing.
- **161 TypeScript files** across the app, worker and shared packages.
- **11 database tables**, **11 hand-written SQL migrations**.
- **116 real messages** in the live system — 115 Gmail, 1 WhatsApp.
- **34 contacts** built automatically from those messages.
- **106 AI extraction rows** — 100 summaries, 4 action items, 2 meetings, and
  **1 of those meetings is confirmed and sitting on a real Google Calendar.**
- **2 channels**, one shared adapter interface.
- Deployed and reachable on the public internet, not on my laptop.

---

## 9. The WhatsApp situation — and the one thing to ask her for

Save this for last. Frame it as a request, not a complaint. Keep it short.

> "Ma'am, isa lang po yung natitirang problema, at hindi po siya code."

> "Para sa WhatsApp Cloud API, kailangan ng Meta developer account. Yung sign-up
> nila, nagpapadala ng SMS code — at hindi po talaga siya dumarating sa number
> ko. Dalawang carrier na po yung tinry ko, dalawang Facebook account, mahigit
> 12 hours. May bug po sila — may apat na thread sa sarili nilang forums na
> pareho ng problema ko."

> "So pansamantala, nag-connect po ako sa isang official Meta Business Solution
> Provider para may WhatsApp pa rin akong mapakita. Gumagana po siya — totoong
> message yung nakita niyo kanina. Pero isang number lang po yung kaya niyang
> tanggapin, yung akin."

**Then the ask — this is the whole point of bringing it up:**

> "Ang pinakamabilis pong solusyon: kung may Meta Business Portfolio na po yung
> iOzera na may WhatsApp Business Account, hindi ko na po kailangan ng developer
> account. Kaya po ng admin doon na gumawa ng System User token, tapos ipasa
> lang po sa akin yung token, yung App Secret, at yung Phone Number ID. Limang
> minuto lang po yun sa side niyo, at yun din po yung version na iOzera na
> talaga yung may-ari ng integration, hindi ako."

> "Kung wala pa pong ganon, okay lang po — tuloy lang ako sa test connection.
> Pero kung meron, matatapos po yung Phase 2 ngayong linggo."

**If she asks what exactly she needs to send you, the three values are:**

1. The **Phone Number ID** (a long number, not a phone number)
2. The **App Secret** — from App settings → Basic
3. A **System User access token** with `whatsapp_business_messaging` permission

And one thing she does on her side: register the webhook URL
`https://switchboard-console-beryl.vercel.app/api/webhooks/whatsapp` and **tick
the `messages` field**. ⚠ That last tick is the step everyone forgets — without
it everything looks configured and Meta simply never sends anything.

---

## 10. Questions she might ask, and short answers

**"Magkano yung gastos?"**
> "Wala pa po akong nagagastos. Free tiers lahat — Vercel, Supabase, Groq. Yung
> Azure worker lang po yung may bayad, mga $20 to $30 a month, at nasa student
> credit ko po yun."

**"Bakit hindi mo na lang ginamit yung normal na WhatsApp?"**
> "May mga library po na kaya kunin yung WhatsApp Web ng personal account — pero
> bawal po yun sa Meta at nababa-ban yung number. Hindi po pwedeng ganon kung
> gagamitin ito ng iOzera. Yung ginamit ko po, official Meta partner."

**"Kaya ba niyang mag-reply?"**
> "Hindi pa po. Read-and-understand muna. Yung outbound, naka-plano na po, pero
> sinadya kong huli — kasi yung mali sa pag-basa, nakikita mo lang; yung mali sa
> pag-send, napunta na sa client."

**"Paano kung mag-imbento yung AI?"**
> "Kailangan po niyang mag-cite. Kapag walang na-retrieve na message na sapat
> yung similarity, hindi siya sumasagot — sinasabi niyang wala siyang alam
> tungkol doon. Test po yun, hindi lang settings."

**"Ilang tao yung kaya nito?"**
> "Multi-tenant po siya. Kanya-kanyang channel, kanya-kanyang data, hiwalay sa
> database level. Pero hindi po siya team tool — walang sharing, walang roles.
> Sinadya po yun."

**"Taglish ba yung kaya ng search?"**
> "Opo. Multilingual po yung embedding model na ginamit ko, kasi alam kong
> Taglish yung magiging laman. Yung English-only na defaults, bumabagsak po sa
> code-switched na text."

**"Kailan matatapos?"**
> "Gumagana na po siya ngayon. Yung natitira: permanent WhatsApp number,
> attachments, at rehearsal ng demo. Depende po sa WhatsApp account, isang linggo
> pong trabaho."

---

## 11. If something breaks on screen

Do not debug in front of her. Say one line and move on:

> "Ay, nag-rate limit yata yung AI provider — free tier po kasi. Tuloy muna
> tayo, babalikan natin."

Then continue to the next demo step. The timeline, search and contacts do not
depend on the AI provider, so those keep working even if Groq is throttling.

**Order of what still works if something fails:** timeline → search → contacts →
summaries → assistant → calendar. Fall back leftward.

---

## 12. Closing — 20 seconds

> "So yun po, ma'am. Yung hiningi niyo, gumagana na — real-time messages, AI
> summaries, admin view. Nasa deployed URL na po siya, hindi lang sa laptop ko."

> "Yung kailangan ko lang po sa inyo: yung WhatsApp access, kung meron po ang
> iOzera. Yun na lang po yung natitira."

**Then stop talking.** Let her respond.
