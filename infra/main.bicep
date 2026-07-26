// Switchboard worker — Azure Container Apps.
//
// Deploy:
//   az deployment group create -g rg-switchboard -f infra/main.bicep \
//      -p databaseUrl='<direct postgres connection string>'
//
// See infra/README.md for the cost rationale and the ADR-011 reasoning behind
// minReplicas: 1.

/*
  ⚠ REGION IS CONSTRAINED BY POLICY, not by preference.

  The Azure for Students subscription carries an "Allowed resource deployment
  regions" policy limiting deployments to exactly:

      japaneast · malaysiawest · indonesiacentral · centralindia · koreacentral

  `southeastasia` — the obvious choice for Manila, and where Supabase lives — is
  NOT on that list. Deploying there fails with RequestDisallowedByAzure, which
  reads like a quota or permissions problem and is neither.

  malaysiawest (Kuala Lumpur) is the pick: closest allowed region to Manila, and
  ~300km from Supabase's ap-southeast-1 in Singapore. That second point is the
  one that matters — the worker queries the database continuously, so
  worker-to-database latency is the number to minimise, not worker-to-user.

  Check the policy before changing this:
    az policy assignment list --disable-scope-strict-match
*/
@description('Azure region. Constrained by subscription policy — see the note above.')
@allowed([
  'malaysiawest'
  'indonesiacentral'
  'japaneast'
  'koreacentral'
  'centralindia'
])
param location string = 'malaysiawest'

@description('Prefix for resource names.')
param namePrefix string = 'switchboard'

@description('Container image for the worker. Defaults to a public placeholder so the environment can be stood up before a registry exists.')
param workerImage string = 'mcr.microsoft.com/k8se/quickstart:latest'

@description('Postgres connection string (Supavisor SESSION mode, port 5432). Stored as a Container Apps secret, never a plain env var.')
@secure()
param databaseUrl string = ''

@description('AES-256-GCM key for channels.credentials. MUST match the console byte for byte, or stored credentials cannot be decrypted.')
@secure()
param channelCredentialsKey string = ''

@description('Google OAuth client secret, used to mint access tokens from stored refresh tokens.')
@secure()
param googleClientSecret string = ''

@description('Google OAuth client id. Not secret, but pointless without the secret.')
param googleClientId string = ''

@description('Full Pub/Sub topic name: projects/<project>/topics/<topic>.')
param googlePubsubTopic string = ''

var logAnalyticsName = '${namePrefix}-logs'
var environmentName = '${namePrefix}-env'
var workerAppName = '${namePrefix}-worker'

// Container Apps requires a Log Analytics workspace for its logs.
// PerGB2018 includes a free ingestion allowance; 30 days is the shortest
// retention that costs nothing extra.
resource logAnalytics 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: logAnalyticsName
  location: location
  properties: {
    sku: {
      name: 'PerGB2018'
    }
    retentionInDays: 30
    features: {
      searchVersion: 1
    }
  }
}

resource environment 'Microsoft.App/managedEnvironments@2024-03-01' = {
  name: environmentName
  location: location
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: logAnalytics.properties.customerId
        sharedKey: logAnalytics.listKeys().primarySharedKey
      }
    }
  }
}

resource worker 'Microsoft.App/containerApps@2024-03-01' = {
  name: workerAppName
  location: location
  properties: {
    environmentId: environment.id
    configuration: {
      // Internal only. The worker pulls from a queue and is never called from
      // the internet — the ingress exists so Container Apps can health-check
      // it. Exposing it externally would be surface area for nothing.
      ingress: {
        external: false
        targetPort: 8080
        transport: 'http'
        allowInsecure: false
      }
      // Secrets are injected by reference, so no value appears on the revision
      // or in `az containerapp show`. Empty parameters are omitted rather than
      // stored blank — the worker's own checks then report them as missing.
      secrets: concat(
        empty(databaseUrl) ? [] : [{ name: 'database-url', value: databaseUrl }],
        empty(channelCredentialsKey) ? [] : [{ name: 'channel-credentials-key', value: channelCredentialsKey }],
        empty(googleClientSecret) ? [] : [{ name: 'google-client-secret', value: googleClientSecret }]
      )
    }
    template: {
      containers: [
        {
          name: 'worker'
          image: workerImage
          resources: {
            // Container Apps only permits specific cpu/memory pairs; 0.25/0.5Gi
            // is the smallest. Raise this in Phase 4 — ONNX embedding weights
            // will not fit comfortably in 0.5 GiB.
            cpu: json('0.25')
            memory: '0.5Gi'
          }
          env: concat(
            empty(databaseUrl) ? [] : [{ name: 'DATABASE_URL', secretRef: 'database-url' }],
            // Needed for Gmail watch renewal. Without all four the worker logs
            // that renewal is disabled and every watch dies after 7 days,
            // stopping ingestion with no other signal.
            empty(channelCredentialsKey) ? [] : [{ name: 'CHANNEL_CREDENTIALS_KEY', secretRef: 'channel-credentials-key' }],
            empty(googleClientSecret) ? [] : [{ name: 'GOOGLE_CLIENT_SECRET', secretRef: 'google-client-secret' }],
            empty(googleClientId) ? [] : [{ name: 'GOOGLE_CLIENT_ID', value: googleClientId }],
            empty(googlePubsubTopic) ? [] : [{ name: 'GOOGLE_PUBSUB_TOPIC', value: googlePubsubTopic }]
          )
          probes: [
            {
              type: 'Liveness'
              httpGet: {
                path: '/health'
                port: 8080
              }
              initialDelaySeconds: 10
              periodSeconds: 30
            }
          ]
        }
      ]
      scale: {
        // ⚠ minReplicas: 1 is the whole point and it is NOT a default.
        //
        // ADR-011: the worker holds ONNX embedding model weights in memory, and
        // reloading them on every cold start blows the "message visible in under
        // 10 seconds" success criterion. This is also the single line item the
        // $100 Azure credit exists to pay for (~$10-15/month).
        //
        // Setting this to 0 would save the money and break the product.
        minReplicas: 1
        maxReplicas: 1
      }
    }
  }
}

output environmentId string = environment.id
output workerFqdn string = worker.properties.configuration.ingress.fqdn
output workerName string = worker.name
