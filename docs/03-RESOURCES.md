# 03 — Resources, APIs, and Real Costs

> **Rule for agents:** every figure in this file was verified on the date shown,
> with a source. If you need a number that isn't here, **look it up and add it
> with a source link.** Do not guess quotas or prices — a wrong number here turns
> into a wrong architecture.

**Verification date: 2026-07-25.**

---

## 1. The Azure credit — and the surprise in it

Yuri has **US$100 in Azure for Students credit**, unspent, expiring
**2027-07-24**. Current spend: $0.00.

### The important finding

**Azure for Students subscriptions can no longer provision Azure OpenAI.**
Access to Azure OpenAI and Microsoft Foundry is gated by separate eligibility and
policy rules that a student subscription does not satisfy and cannot be
configured around. The standard advice is to upgrade to pay-as-you-go — which
would mean paying real money.

Related: some users report `RequestDisallowedByAzure` when creating **Azure AI
Speech** resources on student subscriptions too, and F0 free-tier availability
varies by region regardless.

**Consequence:** the obvious plan — *"use the Azure credit for the AI"* — does
not work. This is the single biggest constraint discovered during planning, and
it's why the architecture routes generation to Groq instead. See
`docs/05-DECISIONS.md` ADR-003.

### What the credit *is* good for

| Service | Free allowance | Our use | Verdict |
|---|---|---|---|
| **Container Apps** | 180,000 vCPU-s + 360,000 GiB-s + 2M requests **per month, per subscription** | the worker, `minReplicas: 1` | **Use this.** An always-on worker exceeds the free grant by roughly $10–15/month — the credit's real job (ADR-011). |
| **Blob Storage** | 5 GB LRS (student offer) | attachments | **Use this.** Comfortably sufficient. |
| **App Service** | 10 apps on free tier (student offer) | fallback host | Backup if Container Apps disappoints. |
| **Database for PostgreSQL** | B1ms ~$12–15/mo; a 12-month free trial exists for new accounts | — | **Skip.** Supabase free gives us pgvector + realtime + auth for $0. |
| **VMs** | 750 hrs B1s Windows (student offer) | — | Not needed. Would burn credit for no benefit. |
| **AI Speech** | F0: 5 audio hrs/mo STT, 0.5M chars/mo TTS | voice stretch goal | **Try, don't depend.** May be region-blocked or disallowed. |
| **Azure OpenAI** | — | — | **Unavailable.** See above. |

**Bottom line:** the credit's real job is the **always-on worker** (~$10–15/month,
ADR-011) — the one component that genuinely needs warm compute. Everything else
stays on free tiers, because spending credit to replace something free buys a
downgrade. Expect meaningful headroom left over, and treat that as insurance
rather than a budget to exhaust.

*Sources:* [Azure for Students + OpenAI (MS Q&A)](https://learn.microsoft.com/en-us/answers/questions/1459392/cant-azure-for-students-subscription-use-openai-se) · [Azure for Students offer](https://azure.microsoft.com/en-us/free/students) · [Container Apps billing](https://learn.microsoft.com/en-us/azure/container-apps/billing) · [Speech quotas & limits](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/speech-services-quotas-and-limits) · [Speech F0 on student subs (MS Q&A)](https://learn.microsoft.com/en-us/answers/questions/5538331/error-creating-speech-service-resource-with-azure) · [PostgreSQL Flexible Server pricing](https://azure.microsoft.com/en-us/pricing/details/postgresql/flexible-server/)

---

## 2. Channels

> **Scope:** two channels only — **Gmail** and **WhatsApp** (ADR-001).
> Telegram was cut. Calls are out of scope entirely (ADR-008) — see §7.

### Gmail — **v1 channel, build first**

- **Cost:** free. API quota is 1 billion units/day on free accounts — effectively
  unlimited for us. Pub/Sub costs apply only at volumes far above ours.
- **Auth:** OAuth2. Google has phased out app passwords / "less secure apps" for
  this purpose.
- **Mechanism:** call `users.watch` registering a Pub/Sub topic. Gmail publishes
  a notification containing the user's address and a `historyId`. You then call
  `users.history.list` from your stored `historyId` to get the delta, then fetch
  each message.
- **⚠ Trap:** **`watch` must be renewed at least every 7 days** or notifications
  stop silently. Handled in `docs/02-ARCHITECTURE.md` §5.

This is **genuine monitoring of a real existing inbox** — no recipient caps, no
approvals, and Yuri already has the account. That's why it's the first channel
despite needing more setup than WhatsApp: it's the one that actually demonstrates
the product thesis.

*Sources:* [Gmail push notifications](https://developers.google.com/workspace/gmail/api/guides/push) · [Gmail Pub/Sub & watch guide](https://www.unipile.com/gmail-api-push-notifications/)

### Google Calendar — **write-back target (ADR-010)**

Not a channel — the one place Switchboard writes outward.

- **Cost:** free.
- **Scope:** `https://www.googleapis.com/auth/calendar.events` (view and edit
  events). Google classifies calendar scopes as **sensitive**.
- **Combines with Gmail in a single consent screen** — same Google Cloud project,
  same OAuth flow. Request both scopes up front in Phase 1 rather than putting the
  user through a second consent in Phase 5.
- Request the narrowest scopes that work: broader scopes add consent-screen
  friction and lengthen any future Google review.

**⚠ OAuth mode is the real multi-tenancy ceiling.** Gmail's restricted scopes in
**production** trigger a Google CASA security assessment — expensive and slow. In
**testing mode** there's no assessment, but every user must be manually
allowlisted, capped at roughly **100 test users**. That's ample for iOzera and
avoids a months-long verification. *Verify the exact cap before relying on it.*

*Sources:* [Choose Calendar API scopes](https://developers.google.com/workspace/calendar/api/auth) · [OAuth 2.0 scopes for Google APIs](https://developers.google.com/identity/protocols/oauth2/scopes)

### WhatsApp Cloud API — **v1 channel, build second**

- **Platform access:** free. No subscription fee.
- **Message cost:** since 2025-07-01, Meta charges **per delivered template
  message**, priced by category and recipient country. Service messages inside
  the 24-hour customer-service window are free, and the **first 1,000 service
  conversations per month are free**.
- **What this means for us:** Switchboard is read-mostly. Inbound messages and
  in-window service replies cost nothing. We would only incur charges if we sent
  template messages, which is outside our scope.
- **Free test number:** Meta creates a test WhatsApp Business Account and a test
  business phone number that can exchange messages with **up to 5 verified
  recipients**, with **no business verification required**. Recipients confirm via
  a code sent in WhatsApp. This is enough to build and demo the whole adapter.
- **Production access** (unlimited recipients, real client traffic) is what needs
  the Meta Business account and verified business number, and that approval can
  take days or stall.
- **Verification:** `X-Hub-Signature-256` HMAC on every webhook.
- **⚠ Number limits shape multi-tenancy.** A WABA holds **2 business phone
  numbers initially, raised to 20** once business-verified. Each is verified
  separately with its own display name and quality rating — but **messaging
  limits are shared across the portfolio**, so one busy number can throttle every
  other number in the account.
- **Consequence:** WhatsApp channels are **admin-provisioned, not self-serve**.
  Numbers belong to the business, so a user cannot connect their own WhatsApp the
  way they connect their own Gmail. See ADR-009.

*Source:* [WhatsApp business phone numbers](https://developers.facebook.com/documentation/business-messaging/whatsapp/business-phone-numbers/phone-numbers)

### ⚠ The constraint that actually matters

**The Cloud API only receives messages sent *to a business number you control*.
It cannot read existing personal WhatsApp conversations.** Personal WhatsApp is
end-to-end encrypted and exposes no API. Libraries that claim to do this
(`whatsapp-web.js`, Baileys, and similar) work by impersonating WhatsApp Web —
they violate Meta's terms and get numbers banned. **Do not use them on this
project.**

Gmail is the exception — OAuth grants access to a genuine existing inbox. That
asymmetry between the two channels is worth understanding before writing the
demo narrative.

This is a product-framing issue, not just a technical one. Tracked as Q1 in
`docs/06-OPEN-QUESTIONS.md`.

**Decision:** build WhatsApp against the free test number, second, after Gmail.
Never let a milestone depend on Meta's production approval.

*Sources:* [WhatsApp Cloud API get started](https://developers.facebook.com/documentation/business-messaging/whatsapp/get-started) · [Cloud API webhooks setup](https://developers.facebook.com/docs/whatsapp/cloud-api/guides/set-up-webhooks/) · [WhatsApp API pricing 2026](https://www.authgear.com/post/whatsapp-api-pricing/)

---

## 3. Database — Supabase

Free tier, as of 2026-07:

| | Free tier |
|---|---|
| Database | 500 MB |
| File storage | 1 GB |
| Monthly active users | 50,000 |
| API requests | unlimited |
| Active projects | 2 |
| **Inactivity pause** | **after 7 days with no database activity** |

Included and directly useful: **pgvector** (semantic search), **Realtime**
(the live-updating timeline in the demo), **Auth** (identity — `auth.uid()` is
the tenant key), and **RLS** (the multi-tenancy security boundary, ADR-009).
Those last two are why paying Azure ~$13/month for plain Postgres would be a
downgrade, not an upgrade.

500 MB sounds small but text messages are tiny; the practical ceiling is the
embeddings. A 768-dim `float4` vector is ~3 KB, so ~100k messages of embeddings
is roughly 300 MB. Fine for this project, worth knowing.

**The inactivity pause is the dangerous one.** A project that sat idle over a
long weekend is offline when you open the demo. Mitigation is in Phase 0.

*Source:* [Supabase free tier limits 2026](https://www.itpathsolutions.com/supabase-free-tier-limits)

---

## 4. AI layer — three providers, matched to workload (ADR-003)

### 4a. Assistant Q&A — Gemini 2.5 Flash

| Model | Requests/min | Requests/day |
|---|---|---|
| Gemini 2.5 Pro | 5 | 100 |
| **Gemini 2.5 Flash** | **10** | **250** |
| Gemini 2.5 Flash-Lite | 15 | 1,000 |

Shared across all three: **250,000 tokens/min**, full **1M-token context window**.

**Why this and not Groq for the assistant — the numbers decide it.** RAG prompts
are large, so *tokens per minute is the binding constraint, not requests*. Groq's
70B model allows 12,000 TPM and 100,000 tokens/day; a retrieval prompt carrying
~20 messages runs 4,000–8,000 tokens, so Groq gives roughly **two questions per
minute and ~15 per day**. Gemini's 250K TPM is about **20× that headroom**, and
the 1M window makes retrieval tuning far less fragile.

**⚠ Two warnings.** Google cut free quotas 50–80% in December 2025 without
notice. And **enabling billing on a Gemini project permanently destroys its free
tier** — every call becomes billable from the first token. **Keep billing
disabled.**

*Sources:* [Gemini free tier limits 2026](https://harboratory.com/gemini-api-free-tier-limits-in-2026-explained/) · [Gemini billing / free-tier trap](https://usagebox.com/articles/gemini-api-billing-free-tier-confusion)

### 4b. Per-message extraction — Groq, running Llama

| | Free tier |
|---|---|
| General cap | 30 req/min · 6,000 tokens/min · **14,400 req/day** |
| `llama-3.3-70b-versatile` | 30 RPM · 1,000 RPD · 12,000 TPM · 100,000 TPD |

Extraction is the opposite shape from Q&A: **many small self-contained prompts**,
one per message. That's bounded by requests/day, where Groq's 14,400 is generous
and its latency is excellent. Limits are per-model, so extraction never competes
with anything else.

Splitting this way means each job sits on the provider with the better limit for
its shape — and if either free tier degrades, only half the system is affected.

*Sources:* [Groq free tier limits 2026](https://tokenmix.ai/blog/groq-free-tier-limits-2026) · [Groq API pricing](https://tokenmix.ai/blog/groq-api-pricing)

### 4c. Embeddings — local, in-process

**Groq has no embeddings endpoint.** Rather than add a third API, embeddings run
locally in the worker via **Transformers.js** (ONNX runtime, pure Node).

Why this is the better answer regardless: embedding is the high-volume operation
— every message, plus every re-index. Local means **free, unlimited, offline, and
impossible to exhaust mid-demo.** It also isolates failure: if Groq degrades,
search still works and only the assistant's answers are affected.

**⚠ Model choice — do not reach for the popular default.** The corpus will be
**Taglish**, and `all-MiniLM-L6-v2` is English-only; it degrades badly on
code-switched text. Use a **multilingual** model:

| Model | Dims | Notes |
|---|---|---|
| **`Xenova/multilingual-e5-small`** | 384 | **Chosen.** Multilingual, small, fast. |
| `Xenova/paraphrase-multilingual-MiniLM-L12-v2` | 384 | Solid alternative. |
| `BAAI/bge-m3` | 1024 | Best quality, much heavier. Overkill here. |

**⚠ e5 models require prefixes.** Prepend `"query: "` to searches and
`"passage: "` to stored text before embedding. Skipping this doesn't error — it
just quietly degrades retrieval quality, which is very hard to diagnose later.

**⚠ Token limit.** These models cap around 256–512 tokens. Chat messages fit
easily; **emails do not.** Long emails must be chunked, with each chunk embedded
separately and linked back to the parent message. See `docs/02-ARCHITECTURE.md` §4.

*Sources:* [Transformers.js semantic search](https://machinelearningmastery.com/building-semantic-search-with-transformers-js-and-sentence-embeddings/) · [Open source embedding models 2026](https://pristren.com/blog/open-source-embedding-models/)

---

## 5. Hosting

| Layer | Service | Cost |
|---|---|---|
| Console **+ ingest webhooks** | Vercel Hobby | Free |
| Worker (`minReplicas: 1`, stays warm) | Azure Container Apps | **~$10–15/mo** beyond the free grant — the credit's real job (ADR-011) |
| Database | Supabase | Free |
| Attachments | Azure Blob Storage | Free (5 GB student allowance) |

The worker is deliberately **not** scale-to-zero: it holds ONNX embedding weights
in memory, and reloading them on every cold start would blow the "visible in
under 10 seconds" target. Ingest is serverless precisely because it must never be
slow to respond — a cold-starting webhook endpoint gets retried and eventually
disabled by Meta and Google.

Vercel Hobby is non-commercial-use only. Fine for a student project; worth
flagging if iOzera ever wants to run this internally for real.

---

## 6. Credentials checklist

**Nothing on this list exists yet.** Phase 1 needs the ★ items.

**Phase 0 — foundation**
- [x] ★ Supabase project + URL + publishable key — in `apps/console/.env.local`.
      **service_role deliberately not fetched**: nothing needs it until the
      worker exists, and it bypasses RLS. Get it from the dashboard then.
- [x] ★ Supabase Auth enabled (identity + `auth.uid()` as the tenant key)
- [ ] ★ Encryption key for `channels.credentials` (generate, store in env, never commit)
- [ ] ★ Vercel project linked to the repo
- [ ] ★ Azure resource group + Container Apps environment
- [ ] Azure Blob Storage account + container

**Phase 1 — Gmail (+ Calendar scopes, requested now to avoid a second consent later)**
- [ ] ★ Google Cloud project; **Gmail API and Calendar API** both enabled
- [ ] ★ OAuth consent screen (**testing mode**, users manually allowlisted) + OAuth client
- [ ] ★ Scopes: Gmail read + `https://www.googleapis.com/auth/calendar.events`
- [ ] ★ Pub/Sub topic + push subscription, with publish rights granted to
      `gmail-api-push@system.gserviceaccount.com`

**Phase 2 — WhatsApp**
- [ ] Meta developer account + app with WhatsApp product added
- [ ] Test business number + up to 5 verified recipient numbers
- [ ] Phone number ID, access token, app secret (for `X-Hub-Signature-256`)
- [ ] Webhook verify token

**Phase 4 — assistant**
- [ ] Gemini API key — **billing left disabled** (assistant Q&A)
- [ ] Groq API key (per-message extraction)
- [ ] *(no key needed for embeddings — they run locally)*

**Storage rules:** local dev in `.env.local`, gitignored. Deployed secrets in
Vercel env vars and Azure Container Apps secrets. Never in the repo, never in a
doc, never in a chat message.

---

## 7. Calls — out of scope, and why it's worth knowing

Recorded here because "why not calls?" is the most likely question at a demo, and
the answer is a good one.

**Ms. Maria excluded them.** She said call integration isn't necessary and can be
skipped — in the meeting and in Yuri's written summary.

**No native recording exists.** WhatsApp's Business Calling API supports VoIP
calls (globally available since 2025, excluding sanctioned countries), but Meta
provides **no recording or transcription**. Solution providers build those on top
of a raw audio stream. That's real-time media handling — a different class of
engineering from the JSON webhooks everything else in this system uses.

**Recording calls in the Philippines is a criminal offence without all-party
consent.** RA 4200 (Anti-Wiretapping Act) is among the strictest such laws
anywhere. *Ramirez v. Court of Appeals* (1995) held that **even a participant who
records their own conversation without the other party's knowledge violates it.**
Penalty is imprisonment; Section 4 makes such recordings inadmissible regardless.

**If asked to add calls later:** metadata only — who, when, how long, no content.
That doesn't intercept a communication, so RA 4200 doesn't bite. Full recording
needs consent built into the call flow and legal review. See ADR-008.

*Sources:* [WhatsApp Cloud API calling](https://developers.facebook.com/documentation/business-messaging/whatsapp/calling) · [Philippines recording laws](https://www.recordinglaw.com/world-laws/world-recording-laws/philippines-recording-laws/) · [RA 4200 criminal liability](https://www.respicio.ph/commentaries/criminal-liability-for-wiretapping-and-recording-conversations-without-consent)

---

## 8. Connected MCP tooling — verified status

Tested by calling each one, 2026-07-25:

| MCP | Status | Use |
|---|---|---|
| **Supabase** | ✅ working — org `Yuringgg's Org` | create project, apply migrations, generate TS types, read logs |
| **Vercel** | ✅ working — team `Yuringgg` | deploy, read build logs, read runtime errors |
| **Azure** | ⚠️ **installed but timing out** | resource groups, Container Apps, storage, pricing |
| **Notion** | connected | write-up for Ms. Maria |
| **GitHub** *(via Claude Code)* | — | repo, branches, PRs |

**⚠ Azure MCP is not responding.** Two `subscription_list` calls timed out — not a
cold start. The server authenticates through the Azure CLI credential chain, so
the most likely fix is running **`az login`** on the host machine. Resolve this
before Phase 0's Container Apps work. Note the directory lists the same Microsoft
server under three entries; only one is needed, and the duplicates are not the
problem.

Prefer these over asking Yuri to click through portals — but **never** provision
paid resources without explicit approval first.

---

## 9. Environment state — read before Phase 0

**Supabase free tier allows 2 active projects, and both slots were in use.**
Discovered 2026-07-25 while verifying connectors.

| Project | Region | Status |
|---|---|---|
| `safehands` | `ap-southeast-1` (Singapore) | active — leave alone |
| `ageni-academy` | `ap-southeast-2` (Sydney) | **paused 2026-07-25** to free a slot for Switchboard. Data retained; resumable from the dashboard any time. |
| `switchboard` | `ap-southeast-1` (Singapore) | **created 2026-07-26**, ref `ytrkpcryztwgflmbhfdu`. Schema + RLS applied. |

Switchboard was created in `ap-southeast-1` (Singapore) — closest region to
Manila, and what `safehands` already uses. Region cannot be changed after
creation, so this is now fixed.

**The two active slots are both in use again** (`safehands`, `switchboard`).
`ageni-academy` stays paused. Anything needing a third project means pausing one
of these first.

⚠ **Do not create a third active project.** If a slot is needed later, pause
rather than delete.

---

*Verified 2026-07-25. Re-verify pricing and quota figures before relying on them
after roughly 2026-10.*
