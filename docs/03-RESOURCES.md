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
allowlisted. **Verified 2026-08-02: the cap is exactly 100 test users, and it is
hard** — the 101st gets an error, and the cap lifts only on successful
verification. Ample for iOzera.

### ⚠⚠ The one that will interrupt a demo — verified 2026-08-02

**With user type External and publishing status Testing, Google expires every
refresh token 7 days after consent.** Not 7 days after last use — **7 days from
the moment the user clicked Allow.** It is not configurable and it applies per
user.

What happens when it lapses: `refreshAccessToken` returns `invalid_grant`, the
worker's watch-renewal sweep catches it within 6 hours and sets
`channels.status='error'` with the reason, and `/channels` shows *"Needs
attention"*. **Mail stops arriving.** The guard works — this is not silent — but
nothing anywhere said to *expect* it, which is why it is written down here now.

**The fix is to reconnect**, which takes one click on `/channels` and mints a
fresh 7-day token. There is no way to extend it inside testing mode.

- **Before any demo to Ms. Maria, reconnect Gmail that morning.** A token that
  expires mid-presentation looks exactly like a broken pipeline.
- **Do not "solve" this by publishing the consent screen.** `gmail.readonly` is
  a restricted scope, so publishing triggers the CASA assessment this project
  chose testing mode specifically to avoid. The weekly reconnect is the price of
  that decision, and it is the cheaper side of the trade.
- Check when it will next lapse:
  `select display_name, status, last_error from channels;` — and the connect
  time is `channels.created_at`, unchanged by reconnects, so use the worker log
  or just reconnect on a schedule.

*Sources:* [Choose Calendar API scopes](https://developers.google.com/workspace/calendar/api/auth) · [OAuth 2.0 scopes for Google APIs](https://developers.google.com/identity/protocols/oauth2/scopes) · [Refresh token 7-day expiry in Testing](https://www.unipile.com/google-oauth-refresh-token/) · [The 100 test-user cap](https://www.unipile.com/google-oauth-100-user-limit/) · [Manage app audience](https://support.google.com/cloud/answer/15549945?hl=en)

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

### 4a. Assistant Q&A — ⚠ **NO LONGER GEMINI.** See ADR-003's amendment.

> ## 🔴 THE NUMBER IN THIS SECTION WAS WRONG BY 12×
>
> **Measured against the live API on 2026-08-02, from the quota error itself:**
>
> ```json
> "quotaId": "GenerateRequestsPerDayPerProjectPerModel-FreeTier",
> "quotaValue": "20",
> "model": "gemini-2.5-flash"
> ```
>
> **Twenty requests per day.** Not 250. Google cut it again — this file already
> warned they cut free quotas 50–80% in December 2025 without notice, and they
> have now done it a second time.
>
> Twenty questions a day cannot support a demo, let alone development against
> it: this project's own 15-case assistant eval consumes **75% of a day's
> allowance in a single run**, which is exactly how it was discovered.
>
> **The assistant now runs on Groq `llama-3.3-70b-versatile` — 1,000
> requests/day**, fifty times the allowance. `packages/ai/src/assistant-provider.ts`
> carries the reasoning; `ASSISTANT_PROVIDER=gemini` switches back in one
> variable if Google ever restores a usable tier.
>
> ⚠ **Re-verify any figure below before relying on it.** They were correct when
> recorded and one of them silently stopped being correct.

The historical table, kept because the *reasoning* it drove is still sound —
tokens/min binds RAG prompts, not requests/min:

| Model | Requests/min | Requests/day (**as recorded 2026-07-25**) |
|---|---|---|
| Gemini 2.5 Pro | 5 | 100 |
| **Gemini 2.5 Flash** | 10 | ~~250~~ → **20, measured 2026-08-02** |
| Gemini 2.5 Flash-Lite | 15 | 1,000 |

Shared across all three: **250,000 tokens/min**, full **1M-token context window**.

ADR-003's arithmetic also assumed a retrieval prompt of 4,000–8,000 tokens
carrying ~20 messages. The built design sends at most **8** messages, one chunk
each — around 2,000–3,000 tokens — so Groq's 12,000 TPM is roughly four
questions a minute rather than the two ADR-003 calculated.

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

### 4a-bis. What the assistant ACTUALLY runs on — Groq, measured 2026-08-02

Both AI workloads are Groq now, on **two different models on purpose**: Groq's
limits are per-model, so heavy assistant use can never stop mail being
summarised. That is ADR-003's failure-isolation argument, satisfied inside one
vendor rather than across two.

| Workload | Model | Measured from live headers |
|---|---|---|
| **Assistant** (Phase 4B) | `llama-3.3-70b-versatile` | 1,000 req/day · **12,000 tokens/min** |
| **Summaries** (Phase 4A) | `llama-3.1-8b-instant` | 14,400 req/day · 6,000 tokens/min |

**⚠ The real ceiling is ~30 assistant questions per day, and it is a TOKEN cap.**
One question sends the system prompt plus 8 retrieved messages — **3,000–3,500
tokens**. Against a documented ~100,000 tokens/day that is roughly 30 questions;
the 1,000 requests/day never binds. Observed directly, twice: a request rejected
with `x-ratelimit-remaining-tokens: 12000` — a *full* per-minute budget, refused,
which is only possible if the daily token cap is what ran out.

### ⚠⚠ The daily token cap is INVISIBLE in headers — measured 2026-08-02

Read straight off a live 200 for `llama-3.3-70b-versatile`:

```
x-ratelimit-limit-requests: 1000       ← per DAY
x-ratelimit-limit-tokens:  12000       ← per MINUTE
x-ratelimit-reset-requests: 1m26.4s    ← 86400/1000: a leaky bucket, not a reset
x-ratelimit-reset-tokens:   185ms
```

**There is no tokens-per-day header.** The ~100,000/day figure above comes from
observed 429s, not from anything Groq publishes, so it cannot be checked from
headers — and note the reset fields show **continuous replenishment**, so
*"the quota resets at midnight UTC"* would be a confident falsehood. Do not write
that in UI copy.

The limit type is named **only in the 429 body**. Recorded by provoking a real
one on the *summaries* model, so the assistant's budget was untouched:

```
retry-after: 2
x-ratelimit-limit-requests: 14400
x-ratelimit-remaining-requests: 14370      ← 99.8% unused
(no token headers at all on this response)
{"error":{"message":"Rate limit reached for model `llama-3.1-8b-instant` …
  on requests per minute (RPM): Limit 30, Used 30, Requested 1. Please try
  again in 2s…","type":"requests","code":"rate_limit_exceeded"}}
```

Three things that settles, all of which had a plausible wrong answer:

- The discriminator is the **`(RPM)`/`(RPD)`/`(TPM)`/`(TPD)` code in the message**.
  `type: "requests"` separates requests from tokens but never minute from day,
  which is the axis a human cares about.
- **When the request limit trips, the token headers vanish entirely.** So
  "is `remaining-tokens` low?" is not a usable test either — sometimes the header
  is absent, and on a daily-token rejection it reads a *full* 12,000.
- **Groq's free-tier RPM for these models is 30**, which no documentation page
  here had recorded.

`packages/ai/src/groq.ts` parses that code — and only that code, only on a 429 —
into a `limitScope`, so the console can say *"the daily allowance is used up"*
rather than *"try again in a moment"*. See `docs/02-ARCHITECTURE.md` §6 for why
that narrow body read is a permitted exception to the never-log-content rule.

Per minute: 12,000 ÷ ~3,200 ≈ **3–4 questions**.

**Nothing else is capped.** Search is Postgres. Embeddings are local — free,
unlimited, offline, and the reason semantic search keeps working even if every
provider is down. Ingest and the timeline have no AI in the path.

If the ceiling ever needs raising, the two levers are: cut `MAX_CONTEXT_MESSAGES`
from 8 to 4 (roughly doubles the daily questions, costs answer quality on broad
questions), or move the assistant to `llama-3.1-8b-instant` (14,400/day, but it
was measurably worse at refusing, which is the property that matters most).

### 4b. Per-message extraction — Groq, running Llama

| | Free tier |
|---|---|
| General cap | 30 req/min · 6,000 tokens/min · **14,400 req/day** |
| **`llama-3.1-8b-instant`** ⭐ **chosen** | **14,400 req/day** · 6,000 TPM |
| `llama-3.3-70b-versatile` | 30 RPM · **1,000 RPD** · 12,000 TPM · 100,000 TPD |

**⚠ Verified 2026-08-02 from the live API's own rate-limit headers**, not from a
docs page — send any request and read `x-ratelimit-limit-requests`. The two
numbers differ by **14×**, and Phase 4A picks `llama-3.1-8b-instant` for exactly
that reason: one backfill over a real mailbox would eat a large slice of the
70B's 1,000/day, and then live summarisation — the thing that has to keep
working — would silently stop until midnight UTC. `packages/ai/src/groq.ts`
pins the choice with the numbers beside it.

Summarising one short message is not a task that needs a 70B model. If quality
ever proves otherwise, the answer is a better prompt before a bigger model.

### ⚠⚠ The limit that actually bites is TOKENS per minute — found 2026-08-02

**6,000 TPM, not 14,400 requests/day.** A backfill 429'd on its fifth message
while the daily request allowance was **99.97% unused**:

```
x-ratelimit-remaining-requests: 14399     ← looks completely fine
x-ratelimit-remaining-tokens:    4825     ← this is what ran out
x-ratelimit-reset-tokens:       11.75s
```

Four ~7,000-character newsletters — roughly 1,750 tokens each — exhaust the
window inside a minute. **Anyone reading only the request counter concludes the
quota is healthy and goes looking for a bug that is not there.**

This is the *same finding as ADR-003*, one layer down: for large prompts, tokens
per minute is the binding constraint, not requests per minute. ADR-003 used it
to route the assistant to Gemini; it turns out to apply to per-message summaries
too, at a tenth of the prompt size.

Two fixes, both shipped: the body sent to the model is capped at **4,000
characters** (`SUMMARY_INPUT_LIMIT` — a message's substance is at the top; past
that is quoted chains and footers), and the backfill reads Groq's `retry-after`
and waits rather than abandoning the run. ⚠ **`retry-after` can be fractional
("11.75") — `parseFloat`, not `parseInt`,** or an 11.75s wait becomes 11s and
429s again immediately.

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

**✅ Built and measured 2026-08-02.** 73 messages → **394 chunks** in 128s, all
local, no quota. On disk the quantised model is **129 MB**; loaded once it
embeds in **~22 ms**. The multilingual choice paid off immediately — against the
query *"do I have any meetings coming up?"*:

| Passage | Similarity |
|---|---|
| Tagalog — *"Nasa office ka ba bukas? Dadaan sana ako around 10."* | **0.8544** |
| English — *"Can we do 3pm Thursday to go through both?"* | 0.8243 |
| Unrelated — *"The container left port on Tuesday…"* | 0.7715 |

The Tagalog message out-scored the English one. `all-MiniLM-L6-v2` would have
ranked it near the bottom, and the symptom would have looked like a ranking bug.

⚠ **But note the narrow band — 0.77 to 0.85.** That compression is why an
absolute similarity floor cannot decide relevance here, and why the refusal path
had to move onto the model. **ADR-016** has the measurements.

| Model | Dims | Notes |
|---|---|---|
| **`Xenova/multilingual-e5-small`** | 384 | **Chosen and shipped.** Multilingual, small, fast. |
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

*Updated 2026-07-28. **Everything Phase 0 and Phase 1 need exists.** The only
outstanding credentials in the whole project are Phase 2's Meta items and
Phase 4's AI keys.*

- [x] ★ **`SUPABASE_SERVICE_ROLE_KEY` in the Vercel project** (Production **and**
      Preview), same value as `apps/worker/.env`. A Pub/Sub push has no user
      session, so the webhook writes `raw_events` with the service role
      (ADR-013).
      *This carried a 🔴 "outstanding" flag until 2026-07-28. It was stale — the
      key had been set since 2026-07-27. Confirmed against the live database
      rather than by reading: **13 `raw_events` rows, all `status='done'`, none
      pending, none failed**, which is only possible with the key present.
      Checking a claim against the database beats re-reading the doc that made
      it; see §8.*
      **⚠ Never prefix it with `NEXT_PUBLIC_`.** That inlines a key which
      bypasses every RLS policy into browser JavaScript. There is a test that
      fails if anyone does.

**Phase 0 — foundation**
- [x] ★ Supabase project + URL + publishable key — in `apps/console/.env.local`
- [x] ★ `DATABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` — in `apps/worker/.env`.
      **Use the Supavisor shared pooler in SESSION mode (port 5432)**, not
      transaction mode (6543) and not the direct connection: direct is IPv6-only
      and Azure Container Apps egresses IPv4, so the worker cannot reach it.
      Session mode also keeps postgres.js prepared statements working.
      *An earlier service_role key was exposed and revoked; the current one is
      its replacement. Neither has ever been in this repo or its history.*
- [x] ★ Supabase Auth enabled (identity + `auth.uid()` as the tenant key)
- [x] ★ `CHANNEL_CREDENTIALS_KEY` for `channels.credentials` — AES-256-GCM,
      32 bytes base64. Set in Vercel and in the Azure worker. `/api/health/config`
      reports a wrong decoded byte count, which is the failure a bad paste causes.
- [x] ★ Vercel project linked to the repo — `switchboard-console`, root directory
      `apps/console`
- [x] ★ Azure resource group + Container Apps environment — `rg-switchboard`,
      **malaysiawest** (see the region policy below)
- [ ] Azure Blob Storage account + container — **not needed until Phase 3**;
      attachments were moved there 2026-07-27 (`docs/04-ROADMAP.md`).
      Yuri approved provisioning it on 2026-08-02; not done yet.
- [x] ★ **Worker resized to 0.5 vCPU / 1.0 GiB** (2026-08-02). It crashlooped at
      the original 0.25 / 0.5 with **exit code 137 — OOM** — a 129 MB quantised
      ONNX model needs far more than its own size once the runtime and Node's
      heap are counted. ⚠ **Running cost roughly doubles to ~$20–30/month**, so
      §1's "expect meaningful headroom left over" is now spent. ADR-011 amended.
- [x] ★ **`EMBED_API_SECRET`** — an Azure Container Apps *secret*
      (`embed-api-secret`), referenced by env var, and the same value on Vercel.
      Gates `POST /embed`, the only public route on the worker. Verified from the
      open internet: no token → 401, wrong token → 401, correct → 384 dims.
      ⚠ **Unset disables the route rather than opening it.**
- [x] ★ **Worker ingress is now EXTERNAL** (was internal). Required because the
      console cannot hold a 129 MB model in a serverless function. FQDN:
      `switchboard-worker.jollyriver-9d68797d.malaysiawest.azurecontainerapps.io`.
      ADR-011 amended with why the surface is one identity-free route.

**Phase 1 — Gmail (+ Calendar scopes, requested now to avoid a second consent later)**
- [x] ★ Google Cloud project; **Gmail API and Calendar API** both enabled —
      `switchboard-503613`, number `468794256088`
- [x] ★ OAuth consent screen (**External, testing mode**, `leiruychua@gmail.com`
      allowlisted) + OAuth client. **Never publish it** — Gmail restricted scopes
      trigger a CASA assessment.
- [x] ★ Scopes: `gmail.readonly` + `https://www.googleapis.com/auth/calendar.events`
- [x] ★ Pub/Sub topic `gmail-push` + push subscription `gmail-push-sub` →
      `/api/webhooks/gmail`, OIDC-authenticated as
      `gmail-push-invoker@switchboard-503613.iam.gserviceaccount.com` with the
      endpoint URL as audience, backoff 10/600, ack 30s. Publish rights granted
      to Gmail.
- [x] ★ **A registered `users.watch`** — the piece that is easy to forget and
      fails silently. Registered in the OAuth callback; expires **2026-08-02**,
      renewed by the worker at T-2 days.

**Phase 2 — WhatsApp**

*The code is complete and tested; this list is all that stands between it and a
real message. Every item needs the Meta dashboard, so none of it can be done
from tooling.*

- [ ] ★ Meta developer account (<https://developers.facebook.com>) + an app of
      type **Business**, with the **WhatsApp** product added
- [ ] ★ Test business number (created automatically with the product) + up to
      **5 verified recipient numbers**. Each recipient confirms with a code sent
      in WhatsApp; **the number that will send test messages must be one of
      them.** No business verification required.
- [ ] ★ From *WhatsApp → API Setup*: **`phone_number_id`** and the temporary
      **access token** (24 h — fine for a first message; swap for a permanent
      System User token before a demo)
- [ ] ★ From *App settings → Basic*: the **App Secret**. This is what
      `X-Hub-Signature-256` is verified against, and it is **not** the access
      token. Wrong value here = every webhook 401s, which reads as Meta being
      broken.
- [ ] ★ A **webhook verify token** — any long random string you invent. It is
      compared against `WHATSAPP_WEBHOOK_VERIFY_TOKEN`; the two must match
      exactly or the subscription handshake 403s.
- [ ] ★ Webhook registered at
      `https://switchboard-console-beryl.vercel.app/api/webhooks/whatsapp`,
      with the **`messages` field subscribed**. Registering the URL without
      subscribing the field is the quiet failure: the handshake succeeds, the
      dashboard looks configured, and nothing is ever delivered.
- [ ] ★ All four `WHATSAPP_*` variables on **Vercel (Production and Preview)**.
      ⚠ **Vercel binds environment variables when a deployment is created** — a
      variable added afterwards does nothing until the next build. Redeploy.
      ⚠ **Paste values unquoted.** Vercel stores the field verbatim, so a value
      pasted with its surrounding quotes fails auth in a way that reads as a bad
      secret. `apps/worker/.env` quotes some values and dotenv strips them;
      Vercel does not.
- [ ] ★ Provision the number against an owner:
      `node --env-file=apps/worker/.env packages/db/scripts/provision-whatsapp.ts
      --owner <uuid> --phone-number-id <id> --display "+1 555 078 3881"`
      with `WHATSAPP_ACCESS_TOKEN` in the environment. Until a `channels` row
      exists with that `external_account_id`, the webhook verifies the signature,
      finds no channel, logs `unknownNumber` and returns 200 — deliberately, so
      Meta does not disable the endpoint, but nothing is stored.

**Phase 4 — summaries and assistant**
- [x] ★ **Groq API key** — in `apps/worker/.env`, and on Azure Container Apps as
      a **secret** (`groq-api-key`) referenced by `GROQ_API_KEY`, not as a plain
      env value: `az containerapp show` prints plain values in full, and that
      output lands in shell history and CI logs. Verified 2026-08-02: the key
      works and the app reports only a `secretRef`.
- [x] ★ **Gemini API key** — in `apps/worker/.env`. Verified working against
      `models.list`; `gemini-2.5-flash` is available.
      Note it lives in its own Cloud project (`231090633304`, "Default Gemini
      Project"), **not** `switchboard-503613`. That is a happy accident worth
      keeping: enabling billing on one can no longer destroy the free tier of
      the other. ⚠ **KEEP BILLING DISABLED** — it is irreversible.
      Not yet needed on Vercel; Phase 4B will need it there.
- [x] *(no key needed for embeddings — they run locally)*

⚠ **Both keys were pasted into a chat transcript on 2026-08-02.** Nothing was
committed and `.env` is gitignored, but **rotate both before this repo or these
sessions are shown to iOzera.** Rotating is ~30 seconds each: delete in the
dashboard, create a new one, update `.env` and the Azure secret.

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
| **Supabase** | ✅ working — org `Yuringgg's Org` | create project, apply migrations, generate TS types, read logs. **The most useful tool on this project** — see the note below. |
| **Vercel** | ⚠️ **cannot see `switchboard-console`** — corrected 2026-07-27 | of limited use; see below |
| **Azure MCP** | ⚠️ **still times out — do not use** | superseded by the `az` CLI |
| **`az` CLI** | ✅ working — `Azure for Students`, Mapúa tenant | resource groups, Container Apps, policy, deployment |
| **Notion** | connected | write-up for Ms. Maria |
| **GitHub** *(via Claude Code)* | — | repo, branches, PRs |

**⚠ The Vercel MCP cannot reach the Switchboard project** (corrected 2026-07-27).
It authenticates to team **`Yuringgg`** (`team_KUQXesLs2KU5zFVJ4rRBODbe`), whose
only project is `ageni-academy`. **`switchboard-console` lives on the personal
Hobby scope**, which the MCP does not enumerate — `list_projects` does not
return it and `get_deployment` on the production hostname returns 404. So build
logs, runtime logs and deployment status are **not readable from tooling**;
they have to be read in the dashboard, or the failure reproduced locally with
`pnpm --filter console build`.

This is not cosmetic. It cost two days: the deploy-status question that the BOM
incident turned on could only be answered by inference from behaviour, which is
exactly the situation `/api/health/config`'s `deployment.commit` field was added
to end. It is also why "did the env vars land on `switchboard-console` or
`ageni-academy`?" was a live question at all — both projects exist under the same
login. **Don't try the MCP again expecting it to work; check the dashboard.**

**⚠ The Azure MCP still times out even after `az login`** (2026-07-26), so
`az login` was not the fix. **Use the `az` CLI directly instead** — it works, and
all of Phase 0's Azure work was done with it. Don't spend more time on the MCP.

**The Supabase MCP is the highest-value verification tool here**, and it earned
that on 2026-07-27: querying the live database directly is what established that
the Gmail watch *was* registered when the build session had concluded it wasn't,
and what caught `raw_events` shipping with no unique constraint while `messages`
and `conversations` both had theirs. **Prefer checking a claim against the
database over reading the code that makes it.**

`az` is not on `PATH` in this environment; it lives at
`C:\Program Files\Microsoft SDKs\Azure\CLI2\wbin\az.cmd`.

**⚠ Region policy discovered 2026-07-26.** The student subscription enforces an
**"Allowed resource deployment regions"** policy limiting deployments to
`japaneast`, `malaysiawest`, `indonesiacentral`, `centralindia`, `koreacentral`.
**`southeastasia` is blocked**, and the failure is `RequestDisallowedByAzure`,
which reads like a quota problem. Switchboard's Azure resources are in
**malaysiawest** — closest allowed region to both Manila and Supabase's
Singapore instance. See `infra/README.md`.

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

*Pricing and quota figures verified 2026-07-25 — re-verify before relying on them
after roughly 2026-10. §6 (credentials) and §8 (MCP tooling) corrected 2026-07-27
against the live system.*
