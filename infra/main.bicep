// Switchboard worker — Azure Container Apps.
//
// Deploy:
//   az deployment group create -g rg-switchboard -f infra/main.bicep \
//      -p databaseUrl='<direct postgres connection string>'
//
// See infra/README.md for the cost rationale and the ADR-011 reasoning behind
// minReplicas: 1.

@description('Azure region. Southeast Asia is the closest Container Apps region to Manila.')
param location string = 'southeastasia'

@description('Prefix for resource names.')
param namePrefix string = 'switchboard'

@description('Container image for the worker. Defaults to a public placeholder so the environment can be stood up before a registry exists.')
param workerImage string = 'mcr.microsoft.com/k8se/quickstart:latest'

@description('Direct Postgres connection string. Stored as a Container Apps secret, never as a plain env var.')
@secure()
param databaseUrl string = ''

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
      secrets: empty(databaseUrl) ? [] : [
        {
          name: 'database-url'
          value: databaseUrl
        }
      ]
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
          env: empty(databaseUrl) ? [] : [
            {
              name: 'DATABASE_URL'
              secretRef: 'database-url'
            }
          ]
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
