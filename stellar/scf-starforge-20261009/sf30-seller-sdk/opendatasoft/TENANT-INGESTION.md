# Huwise tenant ingestion

Operation family: HUWISE-TENANT-INGESTION-FD06-20261012.

The original Huwise workbench can now take a retained source edition through tenant configuration, upload, publication and complete receiving. Its existing workbench lease owns every change. The same plan is available in the browser, native CLI and shared merchant client.

## Connect the tenant

Use the maintained Node runtime with exact JSON support and Linux flock. The workbench and its parent directories are private. Create a private 0600 host connection file and supply each token through its declared environment variable:

```json
{
  "schema": "stellar-forge.opendatasoft-automation-connection.v1",
  "targets": {
    "delivery": {
      "label": "Delivery tenant",
      "origin": "https://tenant.example.com",
      "authTokenEnv": "HUWISE_DELIVERY_TOKEN",
      "timeoutMs": 30000,
      "maxResponseBytes": 67108864,
      "maxUploadBytes": 268435456
    }
  }
}
```

The origin and alias are recorded in each plan. Continued work uses that same named origin and the actual returned dataset UID. The connection file and token values stay on the host. API calls use the native Authorization: apikey header.

Open the existing browser with:

```sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/opendatasoft/cli.mjs serve \
  --project /srv/starforge/huwise-workbench \
  --automation-connection /srv/starforge/huwise-tenants.json
```

Choose Tenant ingestion from the workbench. The original capability link authenticates this page. Select a complete source edition, named tenant, dataset ID and explicit visibility. For an existing target, use Find this dataset and select its actual dataset UID. Select an original resource UID to replace that resource, or explicitly choose append.

Use the actual tenant metadata template name, such as default or asset. The native client also exposes listMetadataTemplates, getDomainMetadataTemplate, listMetadataTemplateFields and getMetadataTemplateField for complete template discovery. Additional metadata and extractor, field, processor, security and schedule configurations use native JSON objects.

## Prepare the complete plan

The following is an input shape; use the actual retained edition ID, capture hash, notes revision and target identifiers from the original workbench:

```json
{
  "editionId": "00000000-0000-0000-0000-000000000000",
  "captureSha256": "0000000000000000000000000000000000000000000000000000000000000000",
  "notesRevision": 0,
  "target": {
    "alias": "delivery",
    "datasetId": "reviewed-portals"
  },
  "dataset": {
    "dataset_id": "reviewed-portals",
    "is_restricted": true,
    "metadata": {
      "default": {
        "title": {
          "value": "Reviewed public data portals"
        },
        "language": {
          "value": "en"
        },
        "modified": {
          "value": "2026-10-12T00:00:00Z"
        }
      }
    }
  },
  "resource": {
    "type": "jsonfile",
    "title": "Complete retained source",
    "params": {}
  },
  "resourceMode": "replace-selected",
  "changes": {
    "fields": [],
    "processors": [],
    "users": [],
    "groups": [],
    "schedules": []
  },
  "publish": true,
  "acceptance": {
    "mode": "source-match",
    "expectedRows": 3763,
    "fieldMap": {},
    "allowAdditionalRows": false
  }
}
```

Each changes entry has a complete native body and optionally the actual original id. Omitted collections and entries are retained. A selected original entry is merged with its reviewed changes, and its complete writable preimage is compared before PUT. Field and processor order remains significant. Resources, permissions and schedules retain their actual native identifiers.

Metadata is a dictionary of templates, each containing a dictionary of field values. Creating a dataset includes metadata. Updating an existing dataset sends dataset_id, is_restricted and default_security to the configuration endpoint, then sends the full merged metadata dictionary to the dedicated metadata endpoint. This retains omitted templates and fields because native metadata PUT replaces omitted fields. Native read-only remote_value is retained in the received source and omitted from writable requests.

Complete native plan JSON in the browser and planJson in the shared client preserve original numeric literals. The CLI reads native plan files with the original lossless JSON parser. The browser's ordinary advanced fields reject values that its numeric representation would alter and direct the operator to complete plan JSON.

Preparing saves the full source capture and notes, their exact hashes, and a unique plan/source-derived upload filename. Inspect reads the actual dataset, metadata, resource, field, processor, user/group security, schedule, attachment and alternative-export configuration. All native pages are followed to completion and their total_count values are checked.

## Review, apply and receive

| Action | Result |
| --- | --- |
| Inspect tenant | Saves the complete tenant preimage and the native workflow. |
| Save this review | Binds the exact plan and inspected configuration hashes to one review ID. |
| Apply reviewed plan | Rechecks the preimage, applies each native step, verifies the complete uploaded file and checks the resulting configuration before publication. |
| Recover original operation | Adopts retained acknowledgments or matches actual native readback to the original step. |
| Read processing status | Reads native status, previous, next, since, publication state and record errors. |
| Receive full publication | Captures every published row through Explore and compares it with the reviewed source and configuration. |
| Prepare delivery | Freezes the plan, original responses, source, receiving results and guide in a complete immutable package. |

A newly created dataset's actual native defaults are retained before subsequent steps. Each returned writable configuration is compared with the reviewed intended values. The before/resume/publication/receiving checks preserve unrelated tenant configuration. The documented automatic modified-metadata flags allow their provider-derived timestamp while keeping the flags and other reviewed values bound.

An API publish acknowledgement starts publication. A published idle status with no queued next operation permits complete receiving. The workbench checks that the publication remains the same while reading, then compares the final native configuration. source-match checks every mapped row, including duplicate multiplicities, expected row count and mapped fields. reviewed-output checks the explicitly chosen transformed row count and fields. Native record errors remain visible and prevent acceptance.

An interrupted receiving capture continues in its same directory while the native publication is unchanged. A new publication receives into a new retained directory and preserves the earlier attempt. Capacity can be supplied as maxRows and maxBytes through the native CLI or shared client. The original capture implementation enforces its native response and file limits.

## Original CLI

Use the installed starforge huwise command or the source CLI shown above. Tenant commands are:

```text
tenant-targets  --project DIR --automation-connection FILE
tenant-prepare  --project DIR --automation-connection FILE --input plan.json
tenant-plan     --project DIR --id PLAN_ID
tenant-inspect  --project DIR --automation-connection FILE --id PLAN_ID
tenant-review   --project DIR --id PLAN_ID --input review.json
tenant-apply    --project DIR --automation-connection FILE --id PLAN_ID --review-id REVIEW_ID
tenant-recover  --project DIR --automation-connection FILE --id PLAN_ID [--input recovery.json]
tenant-status   --project DIR --automation-connection FILE --id PLAN_ID
tenant-receive  --project DIR --automation-connection FILE --id PLAN_ID [--input limits.json]
tenant-export   --project DIR --id PLAN_ID
tenant-delivery --project DIR --id EXPORT_ID
```

review.json contains planSha256 and configurationSha256 from tenant-plan, with an optional note. Mutation commands wait on the original native operation and return its actual result. The complete nativePlanJson, specificationJson and remoteJson strings preserve numeric tokens through ordinary JSON transports.

## Shared merchant client and complete customer files

Add automationConnection to the same named workspaces entry in the existing merchant Huwise connection. The path is private and resolved relative to that connection. Open the original alias through the existing merchant host.

```js
import { readFile } from 'node:fs/promises';
import { openOpendatasoftClient } from './stellar-forge/mcp-merchant-operator/opendatasoft-client.mjs';

const client = await openOpendatasoftClient({ url: process.env.MERCHANT_MCP_URL });
const prepared = await client.tenantPrepare({
  workspace: 'portals',
  planJson: await readFile('/srv/starforge/plan.json', 'utf8')
});
const completed = await client.awaitOperation({
  workspace: 'portals', operationId: prepared.operationId
});
if (completed.operation.state !== 'COMPLETE') throw new Error(completed.operation.error?.message);
const plan = await client.tenantPlan({ workspace: 'portals', planId: completed.operation.result.id });
```

The twelve added actions are tenant_targets, tenant_datasets, tenant_prepare, tenant_plan, tenant_inspect, tenant_review, tenant_apply, tenant_recover, tenant_status, tenant_receive, tenant_export and tenant_delivery. The typed client exposes the corresponding camelCase names; the shared CLI uses the same action names.

After tenantExport completes, pass its original tenantExportId to the existing analyst export action with the same edition, capture hash and notes revision. That immutable customer export includes tenant.tar.gz and TENANT-INGESTION.md alongside all four original analyst formats and any selected merchant/buyer files. The existing downloader resumes every file by original hash and reopens all files offline.

## Recovery and retained history

Every native call saves its request binding before dispatch and its complete response and receipt when received. Successful stored response bytes are adopted before another request. A lost upload response is looked up using its unique reviewed multipart filename. Only the actual returned file UID with a complete hash-matched download is adopted. An explicit fileUid can be supplied when the tenant identifies it differently.

Existing fields, processors, resources and permissions can be recovered with their native identifiers in stepIds. A lost publish acknowledgement is reconciled through native status and full Explore receiving. Earlier request, response and error files remain attached to the same plan; uncertainty never creates a second native mutation by itself.

The copied source and notes belong to the reviewed plan. Applying, recovery, receiving and historical export use those immutable bytes even after later analyst notes change in the source workbench. Each completed delivery has its own manifest and verifies every retained file on reopening.

## Native API reference

automation/API.md describes the complete 92-operation client, parameters, schemas, callback journal and streaming file transport. contract.mjs retains the official SDK/OpenAPI basis and current-reference.json records the present Huwise documentation corrections. upstream-openapi.json and UPSTREAM_LICENSE retain the original complete SDK source and license.

Official current reference: https://developer.huwise.com/apis/automation/v1.0/index.html
