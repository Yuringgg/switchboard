# infra

Bicep templates and container definitions for the Azure side.

| Resource | For | Note |
|---|---|---|
| Container Apps environment + app | `apps/worker` | **`minReplicas: 1`** — it holds ONNX embedding weights in memory and must stay warm (ADR-011) |
| Blob Storage account + container | attachments | 5 GB student allowance |

Everything else is free-tier elsewhere and needs no infrastructure code: the
console and ingest deploy to Vercel from `apps/console`, and the database is
Supabase.

⚠ **Never provision paid resources without explicit approval from Yuri.** The
$100 Azure for Students credit expires 2027-07-24 and the warm worker is its
intended job — roughly $10–15/month beyond the free grant.

⚠ **Azure OpenAI cannot be provisioned on an Azure for Students subscription.**
This is a policy block with no workaround short of pay-as-you-go. It's why the AI
layer routes to Gemini and Groq instead (ADR-003). Don't rediscover this.

Lands in Phase 0 (`docs/04-ROADMAP.md`) — blocked on the Azure MCP, which is
currently timing out and likely needs `az login` on the host.
