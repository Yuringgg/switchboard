# 00 — Project Context

*Why this project exists, who wants it, and what constrains it.*

---

## 1. Origin

The project was proposed by **Ms. Maria**, Yuri's industry mentor at **iOzera**,
during a 1:1 meeting on or around **2026-07-25**. It emerged as the stronger of
two options discussed; Ms. Maria and Yuri both preferred it over the alternative
(a more limited, product-adjacent task where — in Ms. Maria's words — the scope
would have been constrained because it was company product work rather than
Yuri's own project).

The framing that matters: **this is Yuri's project, not iOzera's product.** Ms.
Maria was explicit that this gives room to be creative and experimental in a way
the other option didn't. It doubles as a genuine internal tool iOzera could use.

---

## 2. What Ms. Maria actually described

### 2a. The founding request, verbatim — added 2026-08-02

**Everything below this was reconstructed from a meeting transcript. This is the
original written ask**, from WhatsApp on 2026-07-25, recovered from the thread a
week later. Where the two differ, **this wins.**

> **00:16 — Ms. Maria:** *"Do you think you can make a live webapp that can view
> whatsapp messages real time and have ai summarize bebe? Parang admin view"*
>
> **00:16 — Ms. Maria:** *"we have this project in the loop and isa yan sa
> features"*
>
> **00:18 — Ms. Maria:** *"lmk if you need help ill try to compile a short brd or
> feats you can add. pero for now you can put it under the project name Aika as
> well"*

Five things in there that the reconstruction lost:

1. **"and have ai summarize"** — the AI summarizer is in the *founding sentence*,
   attached directly to viewing the messages. It is not a later addition and not
   a nice-to-have: it is half of what she asked for. It reached
   `docs/04-ROADMAP.md` only on 2026-08-02, as Phase 4A. See ADR-015.
2. **"real time"** — stated explicitly, first sentence. Supabase Realtime was
   treated as a Phase 3 enhancement and pulled forward on instinct in Phase 1
   (`docs/04-ROADMAP.md`). That instinct was right and it was answering a
   requirement, not adding polish.
3. **"Parang admin view"** — an operator looking at a board, not each end user
   connecting their own accounts. Consistent with WhatsApp being
   admin-provisioned (ADR-009), and worth holding onto when the multi-tenancy
   question comes up: isolated tenants, yes; *self-serve consumer product*, no.
4. **"we have this project in the loop and isa yan sa features"** — this is a
   **feature of a real iOzera project**, not a standalone exercise. It raises the
   stakes on scope confirmation (§7) and it is why she keeps checking in.
5. **The name is Switchboard. ⚠ Do not use "Aika" anywhere.** She suggested
   filing the work under that name on day one. **Yuri overruled it explicitly on
   2026-08-02: *"do not use aika. Switchboard is the final name."*** Naming is
   the product owner's call (R2), and this one is settled — repo, docs, console,
   demo, and anything shown to iOzera. Her suggestion is left in the quote above
   because it is a verbatim record, not because it is still live.

⚠ **She offered a BRD** — *"ill try to compile a short brd or feats you can
add"*. That was never delivered and it is very likely what she meant on
2026-08-01 by *"set aside the answers and recommendations"*. **Chase it** — Q6.

### 2b. The meeting, as reconstructed

Reconstructed from the meeting transcript, in her framing:

> Messages arrive via WhatsApp. They sync to a private server. The server logs
> them to a website. On the website you read the messages. What you get is an
> assistant — an online assistant — where you can ask things like *"from the
> messages I've received, do I have any upcoming meetings?"*

Her suggested building blocks:

- **Meta Cloud API** for WhatsApp
- **IMAP** for email
- **Calls: explicitly out of scope** — she said not to bother with call ingestion
- A **free API** for the AI/assistant layer
- Some **voice** experimentation, framed as optional/exploratory

Her guidance on approach: *"more of experimentation, and be as creative as you
want."*

---

## 3. Who the requirements come from

**Ms. Maria, and only Ms. Maria.** She proposed the project and she is the sole
person who has scoped it. Every requirement in these docs traces back to her.

Two things she asked for, both load-bearing:

**A complete, full-stack system** — not a front-end shell over fake data. This
rules out building only a dashboard and calling it done.

**Something that plausibly works as an internal tool for iOzera.** She also noted
that a more front-end/UI-heavy project would have been acceptable, citing another
intern's precedent (Jenny, whose work was light on back-end) — but she asked for
the full-stack version.

**Resolution:** build a real full-stack system, but invest disproportionately in
the console UI, because that's where the work is actually *seen*. See
`docs/01-PRODUCT-SPEC.md`.

---

## 4. Yuri's stated preferences

- **Specialization:** no strong front-end/back-end preference. Comfortable either
  side.
- **Languages/frameworks:** no fixed preference — *"depends on what makes sense
  to apply at that moment."* Flexible by choice, not by inexperience.
- **Motivation for picking this project:** it's outside the comfort zone, which
  is the point.

Because Yuri expressed no stack preference, the supervisor made the call. See
`docs/05-DECISIONS.md` ADR-002.

---

## 5. OJT / internship constraints

These are real scheduling constraints on the build, and they belong in the plan:

- **Start date:** 2026-06-11 (a late start relative to the cohort).
- **Hours logged as of the meeting:** ~108. Ms. Maria flagged this as low and
  said she'd look at editing/verifying the log.
- **Hours guidance from Ms. Maria:** distribute hours evenly rather than logging
  long days back to back — days consistently over 8 hours risk being flagged.
  The precedent she cited (another intern, Luis) was to shift surplus hours to
  lighter days, and to keep genuine personal-project time separate from
  company-logged hours rather than folding it into the timesheet.
- **Enrollment week** falls in the week following the meeting and will reduce
  available build time.
- Ms. Maria will **verify the hours** and follow up.

**Implication for the roadmap:** phases are sized so that a slipped week doesn't
cascade. Each phase ends at a demonstrable milestone, so there is always
something to show even if the next phase hasn't started.

---

## 6. Immediate action items from the meeting

| # | Item | Owner | Status |
|---|---|---|---|
| 1 | Research candidate tools/APIs for the build | Yuri | Covered by `docs/03-RESOURCES.md` |
| 2 | Write findings up in Notion | Yuri | **Pending** — Ms. Maria asked for this specifically |
| 3 | Follow-up meeting with Ms. Maria + Fatima to confirm project scope | Ms. Maria to schedule | **Pending** |
| 4 | Verify and correct OJT hours | Ms. Maria | In progress on her side |

> **Note for future sessions:** item 2 is a real deliverable to the mentor, not
> just internal bookkeeping. A Notion MCP connector is available; the contents of
> `docs/03-RESOURCES.md` and `docs/01-PRODUCT-SPEC.md` are the natural source.

---

## 7. Open scope risk

The follow-up meeting with Fatima had not happened when this plan was written.
**The project scope is not yet formally confirmed by iOzera.** Everything in
these docs is built on Ms. Maria's verbal description.

Treat `docs/01-PRODUCT-SPEC.md` as a strong draft, not a signed-off spec, until
that meeting happens. See `docs/06-OPEN-QUESTIONS.md`.

---

*Sources: meeting transcript and summary, 2026-07-25, provided by Yuri.*
