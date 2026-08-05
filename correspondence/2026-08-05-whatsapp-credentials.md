# The WhatsApp credential problem, and the way out of it

**2026-08-05.** Written for Yuri, and for a session joining cold. Read
`AGENTS.md`, then `2026-07-28-phase-2-whatsapp.md`, then this.

**The code has never been the blocker and still isn't.** What follows is an
account problem with four independent routes around it, ranked by cost. Every
external fact below was checked against the provider's own documentation today,
and every claim about *our* system was measured against the live database and
the live deployment, not read off a doc.

---

## 1. Where this actually stands — measured 2026-08-05

| Question | How it was checked | Answer |
|---|---|---|
| Has a real WhatsApp message ever reached Switchboard? | `select … from messages join channels` | **Yes.** One inbound, `"Test 3"`, 2026-08-04 11:35:42 UTC |
| Did it come through the pipeline or was it seeded? | `raw_events.received_at` is 11:35:44, two seconds after `sent_at` | **Live webhook delivery.** Queued, worked, normalized, `status=done` |
| Is the webhook still configured in production? | `GET` with a wrong verify token → **403**; unsigned `POST` → **401** | **Yes.** Not 503, so a verify token *and* a signing scheme are both bound |
| Which upstream? | `channels.external_account_id = 851682941371819`, display `+55 11 4673 3492` | **360dialog's sandbox**, on the shared-token scheme |

**So Phase 2's done-condition is met.** A WhatsApp message and an email sit in
the same timeline, distinguished by channel. That is the screenshot for Ms.
Maria, and it exists today.

⚠ **It is met on a temporary instrument.** That is the honest reading, and §2 is
why it is not the finish line.

**One thing the first real payload settled.** `docs/03-RESOURCES.md` flagged as
undocumented whether the sandbox issues a dedicated `phone_number_id`. It issues
`851682941371819` against display number `551146733492` — which is 360dialog's
*single, shared* sandbox number, so that id is almost certainly the same one
every sandbox user in the world sees. Nothing leaks (a webhook URL is
per-account, so only our own traffic ever arrives) but it is **not** a durable
tenant key, and it must not be treated as one when a real number arrives.

The payload also carries `user_id` / `from_user_id` (`PH.…`) that Meta's own
fixtures do not. Ignored by `normalize`, harmless, worth knowing.

---

## 2. What the sandbox cannot do — and why this is not finished

Straight from 360dialog's own sandbox page:

- **One linked phone number.** *"Any message **you** send to +551146733492 will
  be forwarded to the webhook URL you set."* Yuri's number is the one linked, so
  **only Yuri's own messages ever reach Switchboard.** Ms. Maria messaging that
  number does not appear in the console — she gets her own sandbox key.
  ⚠ **This is the one that matters.** The product is "messages I *received*,
  from other people, in one view". A demo where the operator talks to himself
  demonstrates the pipeline and not the product.
- **No media.** Uploading and retrieving media by id is explicitly unsupported,
  so the Phase 3 attachment work cannot even be tested here.
- **200 messages max.** The wording is *"can be **sent**"*, and Switchboard only
  receives, so this probably never bites us — but it is undocumented for inbound,
  so treat it as a ceiling of unknown height rather than a non-issue.
- **A Brazilian display number**, and message bodies crossing a third party.
  Fine for dogfooding on Yuri's own number; squarely Q2 / RA 10173 for anyone
  else's mail.
- **The weakest auth scheme we support** — a shared token, which proves the
  caller holds a secret and nothing about the body. Acceptable on a sandbox,
  explicitly not a production posture.

---

## 3. The routes, cheapest first

| # | Route | Cost | Code change | Gets us |
|---|---|---|---|---|
| **A** | Re-confirm the number in Accounts Center, then register | ₱0, ~10 min | none | Free Meta test number, **5 senders**, media, HMAC |
| **B** | Verify the Facebook account with a card instead | ₱0 (not charged) | none | Same as A |
| **C** | Someone else's developer account | ₱0, a favour | none | Same as A, on borrowed ground |
| **D** | iOzera's Business Portfolio | ₱0 to us | none | **The production answer.** A real number, no dev account needed |
| — | Paid BSP with our own number | **€49+/month** | none | A real number, out of an intern's budget |
| — | 360dialog sandbox | ₱0 | none | What we have. §2 is its ceiling |
| ✖ | whatsapp-web.js / Baileys / UltraMsg / Whapi | "free" | large | A banned personal number. See §8 |

**Do A and D on the same day.** A is ten minutes and unblocks the demo; D is the
only one that ends with iOzera owning the thing, and it takes days because it
waits on other people. They do not conflict — a Meta test number and an iOzera
number are two rows in `channels`.

---

## 4. Route A — the one to try first, and why it is not "try the SMS again"

**The finding.** Meta's own registration doc says the verify step *"will send a
confirmation code to the phone number and email address that you provide"* — it
reads the contact points on your Facebook account. Several people on Meta's
forums report the same fix: **re-confirm the number inside Accounts Center
first, and the developer registration then skips its own check.**

⚠ **The part that is specific to you:** that flow offers **SMS *or WhatsApp***
as the delivery channel. Your SMS path is the broken one — but WhatsApp on
`+63 993 655 7241` demonstrably works, because you sent `"Test 3"` through it
yesterday and it is sitting in the database. **Choose WhatsApp and the broken
component is not in the loop at all.**

Precisely:

1. Open <https://accountscenter.facebook.com> — logged in as the Facebook
   account you want the developer account on. (Meta renamed this "Meta Account"
   in April 2026; if the wording differs, it is the same screen.)
2. **Password and security** → **Two-factor authentication**.
3. Pick the Facebook profile if it asks which account.
4. Choose **WhatsApp** if offered. **SMS is the thing that is broken — do not
   pick it first.**
5. Press **Next**, then **Add phone number**, and enter `+63 993 655 7241`
   **even if the number is already listed.** Re-adding is the whole point: it
   forces a fresh confirmation.
6. The code arrives in WhatsApp. Enter it.
   ⚠ **Save the recovery codes it offers.** You are turning on 2FA for real, and
   losing this account later costs more than the SMS did.
7. Now go to <https://developers.facebook.com> → **Get Started** and run the
   registration. The verify step should pass on the already-confirmed number
   without sending anything.
8. If it *does* try to send a code and again sends nothing, **stop and go to
   §5.** Do not retry — Meta rate-limits repeated code requests, and one of the
   forum threads matching your symptoms exactly is someone who got locked out by
   retrying.

**What success looks like:** you land on the App Dashboard and *Create App* is
clickable. From there `docs/03-RESOURCES.md` §6 has the remaining twenty clicks,
already corrected twice.

---

## 5. Route B — verify the account with a card

Facebook's own help page, *"How do I verify my developer account on Facebook?"*,
lists **exactly two** ways: confirm your mobile number, **or add a credit card
to your account** — and states plainly that adding the card is not a charge.

⚠ **Honest caveat, because it changes what you should expect.** That page is
about the *account verification* gate — the one that blocks "create an app". The
*registration* doc describes a phone-and-email code. They are two different
gates, and I could not confirm from outside that a card satisfies the second
one. So: **it is documented by Meta, it is free, and it is worth ten minutes —
but it is second, not first.**

1. <https://www.facebook.com/settings?tab=payments> → add a payment method.
2. Use a **real bank debit or credit card** — BPI, BDO, UnionBank, Security
   Bank. GCash and Maya virtual cards work on some Meta surfaces and are
   rejected on others; if one is refused, that is the card, not you.
3. Expect a temporary authorization hold of about a dollar that reverses itself.
   If a card is charged and not refunded within a week, that is worth telling me.
4. Retry the developer registration.

---

## 6. Route C — borrowing someone's developer account

**You asked whether this is wise. Qualified yes, as a stopgap, and no as an
answer.** The reasoning, because the distinction is the useful part:

**Why it is safe enough.** Switchboard never talks to Meta's dashboard. It needs
four values, and *the dashboard does not have to be ours*. The App Secret you'd
receive is scoped to **one app** — it does not touch their Facebook account,
their profile, their friends, or any other app they own. On a **test** number
there is no billing to abuse and no business identity attached. Nothing about
this requires their password, and you should never ask for it.

**Why it is not the answer.** The app is theirs. They can delete it, their
account can get restricted, and the day either happens the demo dies with no
warning and nothing you can do. And a third party's app sitting in the middle of
iOzera's client messages is the exact shape of thing Q2 / RA 10173 exists for.
**Test number and dogfooding: fine. Real client traffic: no.**

**Two rules.** Ask a person you know — a classmate, a colleague, Ms. Maria,
Fatima. **Never buy or rent an account from a seller.** Bought accounts are
against Meta's Platform Terms, they get banned in waves, and the ban takes the
number and the app with it.

**Send them exactly this** — it is the whole job, and it is about ten minutes:

> Hi — I need a Meta *test* WhatsApp app for a school project. Meta's signup SMS
> is broken for my number (documented bug, their own forums). Nothing here
> touches your account or costs anything, and you can delete it any time.
>
> 1. <https://developers.facebook.com> → **My Apps** → **Create App** → type
>    **Business**. Name it anything.
> 2. In the app, add the **WhatsApp** product. A free **test number** and a
>    **Phone number ID** appear on the *API Setup* page. Send me the **Phone
>    number ID** (a long number, not a phone number).
> 3. On that same page, under **To**, open **Manage phone number list** and add
>    **+63 993 655 7241**. I'll confirm the code that arrives in my WhatsApp.
> 4. **App settings → Basic → App Secret** → *Show*. Send me that.
>    (Not the access token — a different value.)
> 5. **WhatsApp → Configuration → Webhook → Edit**:
>    - Callback URL: `https://switchboard-console-beryl.vercel.app/api/webhooks/whatsapp`
>    - Verify token: *(I'll send you a long random string — paste it exactly)*
>    - Save. It should verify immediately.
> 6. Still on Configuration, press **Manage** and tick the **`messages`** field.
>    ⚠ **This step is the one everyone misses.** Without it the dashboard looks
>    perfectly configured and Meta simply never sends anything.
> 7. Send me the **temporary access token** from *API Setup*. It expires in 24
>    hours, which is fine — I only need it once.
>
> That's everything. Thank you.

⚠ **The App Secret is a password.** It arrives over chat, so rotate it in *App
settings → Basic* the moment the demo is over, or ask them to delete the app.

---

## 7. Route D — iOzera, and the fact that this needs no developer account at all

**The thing worth knowing:** a developer account is only needed to *create an
app*. If iOzera already has a Meta Business Portfolio with a WhatsApp Business
Account, an admin there can create a **System User**, grant it
`whatsapp_business_messaging`, and issue a **permanent token** — and you never
register as a developer at all. The blocker is routed around entirely by
somebody else's existing setup.

This was asked of Ms. Maria and Fatima on 2026-08-04 with no reply yet. When you
follow up, **ask for the specific thing**, not for help:

> Following up on the WhatsApp integration — does iOzera have a Meta Business
> Portfolio with a WhatsApp Business Account already? If so I don't need a
> developer account at all: an admin can add me to the portfolio, or create a
> System User token with `whatsapp_business_messaging` and send me the token,
> the App Secret and the Phone number ID. That's a five-minute job on your side
> and it's the version that ends with iOzera owning the integration rather than
> me. If there's no portfolio yet, I'll keep running on the test number.

It also settles §7 of `docs/00-CONTEXT.md` in passing: asking for a real WABA
*is* the scope conversation, in a form that has a concrete answer.

---

## 8. Two things not to do

**Do not register your personal number on Cloud API.** Meta's docs:
*"Numbers already in use with WhatsApp cannot be registered unless they are
deleted first."* Deleting is permanent — the chats on that phone go with it, and
the number stops working in the WhatsApp app because a Cloud API number cannot
also be a consumer account. ⚠ **The free test number exists precisely so you
never have to do this.** If you eventually want a real number, buy a fresh SIM;
do not feed it the number your family messages you on.

**Do not use whatsapp-web.js, Baileys, UltraMsg, Whapi, Wassenger or Green
API.** They drive the WhatsApp Web protocol with your personal account. Meta
bans numbers for it, the ban is on *your* number, and it is the one category of
solution these docs have banned since Phase 0. It would also be a strange thing
to hand iOzera as an internal tool. The BSP route is different in kind, not
degree: 360dialog is an official Meta Business Solution Provider, and using one
is the sanctioned route to the Business API.

---

## 9. The cutover, when a Meta app finally exists

Two variables, then a redeploy. Nothing else changes — `resolveSigningScheme`
picks the strongest configured scheme, and Meta is first.

1. **Vercel → switchboard-console → Settings → Environment Variables**, for
   **Production and Preview**, pasted **unquoted**:
   - `WHATSAPP_APP_SECRET` — the App Secret from *App settings → Basic*
   - `WHATSAPP_WEBHOOK_VERIFY_TOKEN` — the string you invented, byte-identical
     to what went in Meta's dashboard
2. **Redeploy.** Vercel binds variables when a deployment is *created*; a
   variable added afterwards does nothing until the next build.
3. Register the webhook and **subscribe `messages`** (§6 step 6 above).
4. Provision the number, from the repository root, with `WHATSAPP_ACCESS_TOKEN`
   in the environment:
   ```
   pnpm --filter @switchboard/db provision-whatsapp -- \
     --owner <uuid> --phone-number-id <id> --display "+1 555 …"
   ```
5. Message the test number from a verified recipient. It should appear in the
   timeline within seconds.

⚠⚠ **Setting `WHATSAPP_APP_SECRET` kills the sandbox the moment it deploys.**
Strongest-first means exactly one scheme is live, so the shared-token path stops
verifying and every 360dialog delivery 401s. That is correct behaviour and it is
also a way to lose a working demo an hour before you need it. **Cut over
deliberately, prove the new path with a real message, and never do it on the day
you are presenting.** The sandbox channel row and its message stay in the
database either way — history is not lost, only the live path changes.

---

## 10. What is still unfinished in WhatsApp, credentials aside

Worth stating plainly, since "WhatsApp is done" is not quite true even after a
number arrives:

- **Media/attachments** — deferred to Phase 3 with Gmail's.
  `attachments.blob_url` is `not null`, the Blob container does not exist, and
  every reference survives in `messages.payload_raw`, so it is a backfill.
  ⚠ **Not indefinitely for WhatsApp**: media ids exchange for a *short-lived*
  URL, so anything not downloaded near arrival is gone.
- **The fixtures are still written from documentation, not recorded from
  traffic** — the weak point flagged in the Phase 2 handoff. There is now **one
  real payload** in `raw_events` to check them against. Re-record `text.json`
  from it and note the provenance in `fixtures/whatsapp/README.md`.
- **The hex/base64 branch in `verifySignature` is still a documentation guess.**
  It can only be narrowed by observing a real *360dialog HMAC* delivery, and the
  sandbox issues no signing secret — so it stays until a paid 360dialog account
  exists, or gets deleted along with the BSP path if Meta comes through first.
