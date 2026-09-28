# Telling apart people who share a name — Ms. Maria's research task 4

*Written 2026-09-28. Newer than everything in `docs/`.*

Ms. Maria's research list, task 4: *"Per-Person Personalization: design logic to
differentiate individuals with identical names based on project context."*

## What was there already, and what was missing

Already built: contacts never merge on a name alone (R23, 2026-08-03), every
contact has a brief (ADR-028, 2026-09-24), and Uriel's `resolve_person` returned
every match and the prompt said *ask which one*.

Missing: **what to ask with.** `resolve_person` gave each match only its channel
and a last-heard date, so two Marias on Gmail were "the one from Tuesday or the
one from last month". The prompt's own example — *"the one on the tech team, or
in sales?"* — asked for data no tool ever returned. And the contact list showed
four identical "Anthropic" rows with nothing but a random no-reply address
between them.

## What was built

**One clue per person: the most reliable thing true of them and of nobody else
with that name** (`apps/console/src/lib/tell-apart.ts`, ADR-029). Checked in
this order:

1. their full name, when that alone differs
2. **the reader's own note** on the contact — typed by a person, so it beats
   everything inferred
3. company (and role), from the brief — only when the extraction names them
4. the work domain they email from (free mail skipped; `tm.openai.com` and
   `email.openai.com` are one company)
5. the subject of the newest message they sent
6. a channel only they use
7. the day they last wrote

When nothing differs the answer is **"cannot be told apart"**, never a guess —
and the fix it names is a note.

It works for any number of people, not two. Uriel reads out up to three; at
four or more it says how many and asks for a detail.

**Where it shows:**

| | |
|---|---|
| Uriel (`resolve_person`) | each match carries `tellApart`, and the summary says it: *"two people match that name: Google, last wrote about …; Google, last wrote about …"*. New optional `hint`: whatever the caller says back ("Acme", "the website quote") narrows the group on what is known about each person **and on words in their conversations** — project context works even with no company extracted |
| `/contacts` | under a shared name: *"1 of 4 named Maria Santos · at Acme Logistics"* |
| `/contacts/[id]` | **"Add a note — who is this?"** — stored in `contacts.notes` (column since 0001, never shown until now; merges already carry it). No migration |

`resolve_person` also got faster: six reads at most, none per person. It used to
make two per match, one after another — ten Marias was 21 round trips.

**Not done:** the typed assistant does not resolve people at all (it retrieves
message chunks), so there was nothing there to change.

## Verified

- 747 tests passing (was 712): `test/tell-apart.test.ts` (new) and five new
  `resolvePerson` cases. The owner-filter test is **negative-controlled** —
  deleting the filter from the hint search makes it fail.
- **Run read-only against the live database** (temporary script, deleted):
  `OpenAI` → "four people … too many to read out, ask for …" (two "OpenAI" +
  two "OpenAI OpCo, LLC"); `Google` / `Vercel` → told apart by subject;
  `Anthropic` → one by subject, **two honestly "cannot be told apart"** (random
  no-reply addresses, same subject, same day — for those two, merge is the real
  fix). 0.5–2 s per lookup.
- The list's `fetchContacts` run on live data: 17 of 19 same-name contacts get a
  clue, 2 are the Anthropic pair above.
- Screenshots, dark and light: `/preview?screen=contacts&state=samename`,
  `/preview?screen=contact&state=note`, `/preview?screen=contact`.

## ⚠ Vapi — the dashboard must be edited by hand, AFTER the deploy

Nothing in this repo deploys to Vapi (`docs/03-RESOURCES.md` §4d). Until these
are pasted, the live agent never sends `hint` and never reads `tellApart` —
though the new summary sentence reaches it either way.

**1. Tools → `resolve_person` → Description:**

```
Turn a spoken name into a specific person. Call this first whenever the user says someone's name. It returns every person with that name, and for each one "tellApart": what makes them different from the others (a note the user wrote, their company, the domain they email from, what they last wrote about, or a channel). If several match, ask which one using those differences. Never pick one yourself. If the user answers with a detail, call this again with the same name and that detail as "hint".
```

**2. Tools → `resolve_person` → Parameters → Add Property:**

| Field | Value |
|---|---|
| Name | `hint` |
| Type | string |
| Required | **no** |
| Description | `Something the user said that tells people with this name apart: a company, a project or topic, an email domain, or when they last wrote. For example "Acme" or "the website quote". Leave it out the first time.` |

**3. Assistants → Uriel → System prompt:** replace the whole `# Handling people`
block with the one in `correspondence/2026-09-10-vapi-agent-prompt.md` §2.

Then publish, and test with a call: *"What did Google send me?"*

## For more users (asked the same day)

Only Yuri's Gmail can connect because the Google OAuth app is in **testing
mode** with one allowlisted user (`docs/03-RESOURCES.md` §2). To add people:
<https://console.cloud.google.com/auth/audience?project=switchboard-503613> →
*Test users* → *Add users* (up to 100). **Never press Publish** — Gmail's
restricted scope in production means a paid CASA assessment. Each person then
signs up at `/signup` and connects Gmail on `/channels`, clicks through
Google's "unverified app" screen, and reconnects every 7 days.
