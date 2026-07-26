# infra

Bicep for the Azure side. `main.bicep` is the whole thing.

## Deployed

| Resource | Name | Region |
|---|---|---|
| Resource group | `rg-switchboard` | Malaysia West |
| Log Analytics | `switchboard-logs` | Malaysia West |
| Container Apps env | `switchboard-env` | Malaysia West |
| Container App | `switchboard-worker` | Malaysia West |

Subscription: **Azure for Students**, Mapúa tenant.
Status: **Running**, `minReplicas: 1`, one replica, internal ingress only.

```bash
az deployment group create -g rg-switchboard -f infra/main.bicep
```

## ⚠ The region is not a preference — it is policy

The student subscription carries an **"Allowed resource deployment regions"**
policy permitting exactly:

```
japaneast · malaysiawest · indonesiacentral · centralindia · koreacentral
```

`southeastasia` — the obvious choice for Manila, and where Supabase lives — is
**not** on that list. Deploying there fails with `RequestDisallowedByAzure`,
which reads like a quota or permission problem and is neither. This is the same
class of block `docs/03-RESOURCES.md` §1 flags for Azure Speech F0.

**malaysiawest** was chosen because it is ~300 km from Supabase's
`ap-southeast-1` in Singapore. The worker polls the database continuously, so
worker-to-database latency is the number that matters, not worker-to-user.

Verify the policy before changing regions:

```bash
az policy assignment list --disable-scope-strict-match
```

## The image

`ghcr.io/yuringgg/switchboard-worker`, built by
`.github/workflows/worker-image.yml` on every push that touches the worker or
its workspace dependencies. Free, and the package inherited public visibility
from the repo via `org.opencontainers.image.source`, so Container Apps pulls it
anonymously — no registry credentials, and no ACR to pay for.

**Deployed by digest, not by tag.** `:latest` is mutable, which makes "which
code is running?" unanswerable, and Container Apps will not re-pull an unchanged
tag — so a `:latest` deploy can silently keep running old code.

```bash
az deployment group create -g rg-switchboard -f infra/main.bicep \
  -p workerImage='ghcr.io/yuringgg/switchboard-worker@sha256:<digest>' \
     databaseUrl='<connection string>'
```

Get the digest of the newest build:

```bash
TOKEN=$(curl -s "https://ghcr.io/token?scope=repository:yuringgg/switchboard-worker:pull&service=ghcr.io" | jq -r .token)
curl -sI -H "Authorization: Bearer $TOKEN" \
  -H "Accept: application/vnd.oci.image.index.v1+json" \
  https://ghcr.io/v2/yuringgg/switchboard-worker/manifests/latest | grep -i docker-content-digest
```

## DATABASE_URL

Passed as a template parameter and stored as a Container Apps **secret**,
injected by `secretRef` — never a plain environment variable on the revision.

It must be the **Supavisor shared pooler in session mode (port 5432)**. Not the
direct connection: that is IPv6-only, and Container Apps egresses IPv4, so the
worker cannot reach it at all. Not transaction mode (6543) either: session mode
keeps postgres.js prepared statements working.

## Verified end to end, 2026-07-26

A `raw_events` row inserted into Supabase in Singapore was claimed and marked
`done` by the container running in Malaysia West — so the image, the pooler
connection, the secret injection and the queue loop all work in production.

## Cost

The warm worker is roughly **$10–15/month** beyond Container Apps' free grant
(180,000 vCPU-s + 360,000 GiB-s per subscription per month) — this is the one
line item the $100 credit exists to pay for (ADR-011). Log Analytics sits inside
its free ingestion allowance at this volume.

`minReplicas: 1` is deliberate and load-bearing. Setting it to 0 saves the money
and breaks the product: the worker holds ONNX embedding weights in memory from
Phase 4, and reloading them per cold start blows the "visible in under 10
seconds" criterion.
