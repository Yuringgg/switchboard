/**
 * The assistant's eval cases — one definition, two consumers.
 *
 * `eval-assistant.ts` scores the ANSWER, at one Groq call per case.
 * `probe-context.ts` inspects the CONTEXT, at no quota cost at all.
 *
 * They live here together because the alternative is two lists that drift, and
 * a probe measuring different questions than the eval scores is exactly the
 * quiet kind of wrong this project keeps finding — you would be diagnosing a
 * failure against retrieval for a question the eval never asked.
 *
 * ── ⚠ Why there are THREE expectations and not two (2026-08-02) ──────────────
 *
 * This was a boolean, `mustRefuse`, and it scored two cases as failures that the
 * model was answering **correctly**. Measured with `probe-context.ts`:
 *
 * *"Do I have any upcoming meetings?"* — every meeting in the corpus is dated
 * 27–28 July and three of the five bodies read only "YURI" or "Meeting". The one
 * message naming a time, *"Meeting at 9pm tonight"*, was sent at 19:59 on 2 Aug.
 * Run the eval before 9pm and it is upcoming; run it at 22:40 and it is not.
 * **The case's correct answer depended on the wall clock**, and after 9pm a
 * refusal is right — so the eval was scoring a correct refusal as a failure and
 * inviting the next session to "fix" the prompt until the model invented a
 * meeting. That is the failure ADR-007 exists to prevent, and it is how the
 * earlier 7/7-answerable / 3/8-refusals state was reached.
 *
 * *"Summarise what needs my attention."* — the eight messages retrieved were a
 * Deepgram welcome, a Coursera announcement, a Huawei promotion, two ScreenPal
 * mails, a Nike drop and a job alert. **Not one of the CI failures, deploy
 * failures or the Supabase pause was in context at all.** e5 has no
 * representation of *importance*, so the nearest neighbours to "needs my
 * attention" are prose that sounds urgent. No prompt wording can summarise a
 * message the model was never given.
 *
 * Both are real product gaps, and both belong to Phase 5: `docs/01-PRODUCT-SPEC`
 * US-7 (extracted commitments and meetings) and US-9 (a digest of what needs
 * attention), with R14 already settling that "upcoming meetings" come from
 * **extraction**, not from semantic retrieval. So they are recorded as
 * `known-gap`: still asked on every run, output still printed, but **not scored
 * as logic failures**, with the reason and the fix stated beside them.
 *
 * ⚠ This is a narrower claim than "they pass now". They do not pass. It says the
 * eval no longer reports a correct refusal as a bug.
 */

export type Expectation = 'answer' | 'refuse' | 'known-gap';

export interface EvalCase {
  question: string;
  expect: Expectation;
  /** At least one must appear in the answer. Only for `answer` cases. */
  expectSomeOf?: string[];
  /** `known-gap` only: why it cannot be measured yet, and what would close it. */
  gap?: string;
  /**
   * `YYYY-MM-DD` after which this case's answer depends on something that has
   * expired — a dated message that is no longer in the future.
   *
   * ⚠ This field exists because a case that quietly goes stale is the exact bug
   * ADR-017 was written about: "do I have any upcoming meetings?" was scored as
   * a failure for days while the model was answering it correctly, because the
   * evidence behind it had aged past the question. The eval now says so out loud
   * instead of just going red.
   */
  staleAfter?: string;
}

export const CASES: EvalCase[] = [
  // ── Answerable from the corpus as it stands ───────────────────────────────
  {
    question: 'Did any deployment fail?',
    expect: 'answer',
    expectSomeOf: ['deploy', 'fail', 'vercel'],
  },
  {
    question: 'What failed in CI?',
    expect: 'answer',
    expectSomeOf: ['ci', 'workflow', 'build', 'test', 'typecheck'],
  },
  {
    question: 'Are there any job openings or hiring emails?',
    expect: 'answer',
    expectSomeOf: ['hiring', 'job', 'role', 'position', 'intern'],
  },
  {
    question: 'Did I receive any money or payments?',
    expect: 'answer',
    expectSomeOf: ['paid', 'payment', 'transfer', 'instapay', 'bdo', 'received'],
  },
  { question: 'What has Supabase told me about my projects?', expect: 'answer' },

  // ── Answerable, and the reason the three-way prompt exists ────────────────
  //
  // A synthesis question the corpus CAN serve: the job alerts are genuinely
  // retrieved and genuinely on topic, but no single one is "the answer". Before
  // the prompt named situation C, this shape was the one being refused. It is
  // the closest honest stand-in for "summarise what needs my attention" that
  // retrieval can actually feed, until Phase 5 extraction exists.
  {
    question: 'What kinds of roles have I been sent job alerts about?',
    expect: 'answer',
    expectSomeOf: ['it', 'cyber', 'security', 'analyst', 'intern', 'support'],
  },

  // ── Must be refused — nothing in the corpus answers these ─────────────────
  //
  // Chosen to be plausible-sounding rather than absurd. "What is the airspeed of
  // a swallow" is easy to refuse; a question shaped exactly like the real ones,
  // about a topic that simply is not there, is the honest test — and it is what
  // a demo audience will try.
  { question: 'What did we agree about the Jakarta office?', expect: 'refuse' },
  { question: 'How much did the helicopter lease cost?', expect: 'refuse' },
  { question: 'What did the veterinarian say about the horse?', expect: 'refuse' },
  { question: 'When is the submarine delivery scheduled?', expect: 'refuse' },
  { question: 'What is my sister’s flight number for the Osaka trip?', expect: 'refuse' },
  {
    question: 'How many units did we sell in the Cebu branch last quarter?',
    expect: 'refuse',
  },
  {
    question: 'What did Ms. Maria say about the budget for the second phase?',
    expect: 'refuse',
  },
  { question: 'Which supplier won the tender for the new warehouse?', expect: 'refuse' },

  // ── Ms. Maria's own example question ──────────────────────────────────────
  //
  // ⚠ This was a `known-gap` for one day, and the history is worth keeping.
  //
  // On 2026-08-02 every meeting in the corpus was dated 27–28 Jul, three of the
  // five bodies read only "YURI", and the one naming a time ("9pm tonight") was
  // already in the past by the time the eval ran. The model refused, correctly,
  // and the eval scored that as a failure — ADR-017.
  //
  // On 2026-08-03 Yuri sent one mail naming a real future date ("Project sync
  // with Ms. Maria", Fri 7 Aug 2026 3:00 pm). probe-context.ts confirms it is
  // now retrieved and kept, and the assistant answers it accurately in
  // production. So this is a genuine `answer` case again.
  //
  // ⚠⚠ AND IT WILL GO STALE ON 8 AUGUST, for exactly the reason it was broken
  // before: 7 Aug stops being "upcoming". `staleAfter` makes the eval say so
  // rather than quietly turning red and inviting another prompt-tuning session.
  // **Phase 5 extraction is the permanent fix** (US-7, R14) — until then this
  // case is only as fresh as the newest dated mail in the mailbox.
  {
    question: 'Do I have any upcoming meetings?',
    expect: 'answer',
    expectSomeOf: ['aug', 'august', 'sync', 'maria', 'meeting', '3'],
    staleAfter: '2026-08-07',
  },

  // ── Known gaps — asked and printed, deliberately not scored ───────────────
  {
    question: 'Summarise what needs my attention.',
    expect: 'known-gap',
    gap:
      'Retrieval cannot serve this: probe-context.ts shows the top 8 are ' +
      'newsletters and promotions, with none of the CI failures, deploy ' +
      'failures or the Supabase pause in context. "Importance" is not a ' +
      'direction in embedding space. Closed by Phase 5 extraction + the ' +
      '"needs attention" view (US-7, US-9).',
  },
];

/**
 * `--only "<substring>[,<substring>…]"` narrows a run to the matching cases.
 *
 * ⚠ On the eval this is a budget instrument, not a convenience. One question
 * costs ~3,000–3,500 tokens and a full run is fifteen of them — roughly half the
 * day's measured allowance — so without a filter "re-run the eval after every
 * change" affords about two iterations. Narrowed to the cases a change actually
 * touches, it affords six or more. **Always finish with a full unfiltered run.**
 *
 * It takes a LIST because the useful narrow run is never one case: it is the
 * case a change was meant to move, plus the refusals that must not move with it.
 * A filter that could only express the first would quietly encourage measuring
 * the improvement without measuring the regression.
 */
export function selectCases(argv: string[]): EvalCase[] {
  const raw = argv.includes('--only') ? argv[argv.indexOf('--only') + 1] : undefined;
  const only = raw
    ?.toLowerCase()
    .split(',')
    .map((term) => term.trim())
    .filter(Boolean);
  const skipGaps = argv.includes('--skip-gaps');

  const selected = CASES.filter((testCase) => {
    if (skipGaps && testCase.expect === 'known-gap') return false;
    if (!only?.length) return true;
    const question = testCase.question.toLowerCase();
    return only.some((term) => question.includes(term));
  });

  if (selected.length === 0) {
    throw new Error(`--only "${raw}" matched no cases`);
  }

  return selected;
}
