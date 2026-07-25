# Project Update for Ms. Maria

**From:** Yuri · **Re:** Cross-channel monitoring tool (**Switchboard**) · **2026-07-25**

---

Hi Ms. Maria,

Research is done and the technical plan is finished. Here's where it landed —
no questions blocking me, just letting you know what I found and decided.

---

## What it does

Messages from **WhatsApp and email** sync into a private server, which logs them
to a website where you can read everything in one timeline, search across both,
and ask an assistant questions about them — *"do I have upcoming meetings?"*

When the assistant spots a meeting in a message, it shows it to you as a
suggestion next to the original message. If you confirm, it creates the event in
Google Calendar. It never adds anything to your calendar on its own — an AI
misreading *"maybe we should meet sometime"* as a real appointment is the kind of
mistake that would make people stop trusting the tool.

Multiple people can use it, each connecting their own accounts and seeing only
their own messages.

---

## Three findings worth telling you about

**Calls are out, and there were two more reasons beyond yours.** You said to skip
them, and I looked into it anyway to be sure. WhatsApp's calling API gives no
recording or transcription — only a raw audio stream you'd have to build on top
of. And RA 4200, our anti-wiretapping law, makes recording a private conversation
without everyone's consent a criminal offence, even when you're one of the people
on the call. So that's firmly settled.

**Using Llama, as you suggested.** I'll run it through Groq, which serves Llama
models on a free tier. One adjustment: Groq doesn't do embeddings, which is what
powers the semantic search, so I'm running a small embedding model locally on the
server instead. That makes search free and unlimited, and it keeps working even
if the AI service goes down.

**Azure can't be used for the AI.** I have $100 in Azure student credit, but
Azure for Students can't provision Azure OpenAI at all — Microsoft blocks it by
policy, and the only way around it is paying for an upgrade. The credit goes to
the server infrastructure instead, which it covers comfortably.

---

## Build order

Email first, then WhatsApp. Email needs more setup, but it reads a real existing
inbox with no limits, so it's the better first channel to prove the system works.
WhatsApp has a free test number I can build against right after, without waiting
on business verification.

I'm developing on my own accounts first so I can check how accurate the assistant
actually is before anything else.

I'll have something working to show you at our next meeting.

Thank you!

— Yuri
