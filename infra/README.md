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

## ⚠ The worker is running a PLACEHOLDER image

`mcr.microsoft.com/k8se/quickstart` — not `apps/worker`.

That satisfies the Phase 0 milestone as written ("containerized hello-world →
Container Apps, `minReplicas: 1`") and proves the environment, the warm replica,
the health probe and the secret plumbing all work. It does **not** run our code.

Running the real image needs a container registry, and that is a **cost decision
that has not been approved**:

| Option | Cost | Notes |
|---|---|---|
| Azure Container Registry, Basic | **~$5/month** | `az acr build` builds from the Dockerfile in the cloud — no local Docker needed. Comes out of the $100 credit. |
| GitHub Container Registry | free | The repo is public, so the image can be too. Needs a GitHub token with `write:packages` to push. |

`docs/03-RESOURCES.md` §8 says never provision paid resources without approval,
and ADR-004 says don't spend credit on something available free — which points
at ghcr.io. Raise it with Yuri before creating a registry.

Once an image exists:

```bash
az containerapp update -g rg-switchboard -n switchboard-worker \
  --image <registry>/switchboard-worker:<tag> \
  --set-env-vars DATABASE_URL=secretref:database-url
```

## ⚠ DATABASE_URL is not set yet

The worker cannot reach Postgres until it is. It is the **direct connection
string** from the Supabase dashboard (Settings → Database) — not the project API
URL, and not a publishable key. It contains the database password.

```bash
az deployment group create -g rg-switchboard -f infra/main.bicep \
  -p databaseUrl='postgresql://...'
```

The template stores it as a Container Apps **secret** and injects it by
`secretRef`, so it is never a plain environment variable on the revision.

## Cost

The warm worker is roughly **$10–15/month** beyond Container Apps' free grant
(180,000 vCPU-s + 360,000 GiB-s per subscription per month) — this is the one
line item the $100 credit exists to pay for (ADR-011). Log Analytics sits inside
its free ingestion allowance at this volume.

`minReplicas: 1` is deliberate and load-bearing. Setting it to 0 saves the money
and breaks the product: the worker holds ONNX embedding weights in memory from
Phase 4, and reloading them per cold start blows the "visible in under 10
seconds" criterion.
