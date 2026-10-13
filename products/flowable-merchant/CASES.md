# Adaptive case operations

Use the installed Flowable workspace to release original CMMN models, start
versioned cases, operate their stages and human work, and deliver complete
source and operating history to another operator. The **Cases** page, installed
SDK, command line and merchant MCP use the same saved records.

The adapter follows Flowable 8.0.0 at source revision
`0779d68e5a3385b74d8acb8bc37901ff54513249`. The
[case REST contract](../../stellar/scf-starforge-20261009/sf30-seller-sdk/flowable/CMMN_NATIVE_CONTRACT.md)
and [source map](../../stellar/scf-starforge-20261009/sf30-seller-sdk/flowable/CMMN_SOURCE_MAP.json)
identify the native controllers, accepted request bodies and response fields.

## Connect the case service

Add a named connection for the actual CMMN REST service. A standalone native
host configured with that context uses this address:

~~~json
{
  "id": "customer-cases",
  "label": "Customer case operations",
  "baseUrl": "http://127.0.0.1:8080/flowable-rest/cmmn-api",
  "usernameEnv": "FLOWABLE_USERNAME",
  "passwordEnv": "FLOWABLE_PASSWORD"
}
~~~

Select the complete URL supplied by the host. The process, case and decision
services have separate native endpoints. Existing credential environment
variables supply their values when the original transport sends a request.

Choose the case connection in **Engines**, open **Cases** and use **Refresh
cases**. A capture retains every page of all eleven native collections, original
definition resources and available binary variable data. The saved portfolio
remains available after the engine or installed application restarts.

## Release both editions of a case model

Prepare a deployment from one complete `.cmmn` or `.cmmn.xml` file, or from a
native ZIP/BAR containing the release resources. Preserve the original filename
and bytes. The engine recognizes the CMMN suffixes case sensitively; ZIP/BAR
suffixes are case insensitive.

Optional deployment name, key and tenant use the native query fields. When the
name is absent or empty, Flowable derives it from the filename before its first
dot. The workspace freezes the exact multipart request and the current native
definition state in the release review.

Review and deploy the saved release. Open the returned definition to inspect
its version, deployment and complete source. Deploy the second edition under
the same model key when its work is ready. Start by the actual
`caseDefinitionId` to choose one particular native version. Starting by
`caseDefinitionKey` lets the engine select the current matching definition;
the preparation retains that selected source.

The editable programme in
[case-catalog.json](../../stellar/scf-starforge-20261009/sf30-seller-sdk/flowable/fixtures/cases/case-catalog.json)
contains grant due diligence, vendor exceptions and onboarding investigations.
The catalog identifies each original edition, input cohort, case stages and
expected native progression.

## Start and operate a case

A case start retains its complete original JSON text:

~~~json
{
  "caseDefinitionKey": "YOUR_DEPLOYED_CASE_KEY",
  "businessKey": "customer-case-2026-001",
  "variables": [
    {"name": "applicant", "type": "string", "value": "Customer organization"},
    {"name": "documentsComplete", "type": "boolean", "value": false},
    {"name": "sourceSequence", "type": "long", "value": 9223372036854775806}
  ]
}
~~~

Use the variables authored for the selected model. The SDK selection carries
this entire document as `bodyText`, preserving its original numeric text.
The browser validates the JSON structure and sends the retained text. The
original engine responses also remain available as complete source bytes.

The case action form supports the following native operations:

| Selection action | Native request | Operator use |
| --- | --- | --- |
| `startCase` | POST the original case creation body | Start the chosen definition with business identity and typed variables. |
| `updateCase` | PUT `name` and/or `businessKey` with no action | Apply nonempty values to a live case. |
| `evaluateCaseCriteria` | PUT `{"action":"evaluateCriteria"}` | Ask the engine to reevaluate the current criteria. |
| `terminateCase` | DELETE the selected live case | Terminate the case while retaining its native history. |

Each action is prepared before dispatch. The review shows the complete native
request, current case, selected definition and source, and the resulting work
or history after execution. Open **Work and history** on a case to read its
related plan items, tasks, variables, milestones and historical records.

### Stages and plan items

Select a native plan item or stage and open its action form. The original JSON
action must match the selected workspace operation:

| Selection action | Original JSON |
| --- | --- |
| `startPlanItem` | `{"action":"start"}` |
| `triggerPlanItem` | `{"action":"trigger"}` |
| `enablePlanItem` | `{"action":"enable"}` |
| `disablePlanItem` | `{"action":"disable"}` |

**In this pinned Flowable release, the enable controller calls the native start
operation.** The browser labels that behavior directly. Choose the action
appropriate to the observed plan item state and read the complete native
review before dispatch.

The adapter resolves the owning case from the actual plan item response. An
optional `caseInstanceId` in the selection checks that the native item belongs
to the intended case.

### Human work

Use the original case task ID to claim, release a claim, delegate, resolve or
complete human work. These requests use the CMMN task endpoint. The engine
retains assignee, owner, delegation state and task history.

~~~json
{"action":"claim","assignee":"reviewer"}
~~~

~~~json
{"action":"claim","assignee":null}
~~~

~~~json
{
  "action": "complete",
  "variables": [
    {"name":"documentsComplete","type":"boolean","value":true}
  ]
}
~~~

The second body is selected as `unclaim` in the workspace. Delegation uses
`{"action":"delegate","assignee":"specialist"}`; resolution uses the original
`resolve` action and its complete variables. The adapter derives the owning
case from the task and checks an explicitly supplied case ID.

## Read the complete native portfolio

| Collection | Contents |
| --- | --- |
| `deployments` | Native CMMN deployments and their identity. |
| `definitions` | Case keys, versions and original source resources. |
| `cases` | Current native case instances. |
| `planItems` | Current stages and plan item instances. |
| `tasks` | Complete original task collection and its native scope identifiers. |
| `variables` | Current variable instances and their owning case or work item. |
| `historicCases` | Case start, end and native lifecycle history. |
| `historicPlanItems` | Original plan item lifecycle records. |
| `historicTasks` | Complete original task history and its native scope identifiers. |
| `historicVariables` | Original historical variable instances. |
| `milestones` | Native historic milestone instances. |

Case variable responses keep their native envelope: `id`,
`caseInstanceId`, related task or plan item IDs, and a nested
`variable:{name,type,value,...}`. Binary values retain their original data
resources. **Complete captured case collections** pages the retained rows.
Opening a case gathers its original definition resources and related work.

The case task list shows work with native CMMN ownership. Flowable's shared
task services can return records from other scopes; the complete collection
explorer retains those original rows and shows their scope. Case links and
case task actions use the actual case identity, including the original
`scopeType:cmmn` and `scopeId` fields when present.

Capture again to read current engine state. Retain the original portfolio ID
and revision when comparing an earlier edition or an earlier stage of the case.
The browser reuses collections from the selected saved revision during ordinary
navigation and review. Selecting another capture or revision loads that original
collection again; a failed read remains available for retry.
Every API page returns its complete status, retained/native totals, source
pages and next offset.

## Use the installed SDK and command line

From the installed package root:

~~~js
import {FlowableProductClient} from './source/products/flowable-merchant/client.mjs';

const client = new FlowableProductClient({directory: '/srv/private/case-operations'});
try {
  const status = await client.view();
  const connection = status.connections.find(item => item.connection.id === 'customer-cases');
  if (!connection) throw new Error('Save the original customer case connection.');

  const capture = await client.captureCasePortfolio({
    requestId: crypto.randomUUID(),
    connectionId: connection.id,
    label: 'Complete customer case portfolio'
  });
  const page = await client.readCasePortfolio({
    id: capture.id, revision: capture.revision, collection: 'cases', offset: 0, limit: 50
  });
  console.log(page);
} finally {
  await client.close();
}
~~~

Use the package name recorded in the installed package when importing its
`./products/flowable-merchant/client` export. The
[TypeScript declarations](client.d.mts) describe every original selection and
result. In a programme, retain each write request UUID and its exact arguments
before sending it; the same request resumes the saved operation.

~~~sh
starforge flowable-product capture-cases --dir /srv/private/case-operations \
  --request ORIGINAL-REQUEST-UUID --connection SAVED-CONNECTION-RECORD-ID

starforge flowable-product case-portfolio --dir /srv/private/case-operations \
  --id PORTFOLIO-ID --collection cases --offset 0 --limit 50

starforge flowable-product case-definition --dir /srv/private/case-operations \
  --portfolio PORTFOLIO-ID --definition ORIGINAL-CASE-DEFINITION-ID

starforge flowable-product case-instance --dir /srv/private/case-operations \
  --portfolio PORTFOLIO-ID --case ORIGINAL-CASE-ID
~~~

Prepare any of the four case operation kinds with its complete selection file:

~~~sh
starforge flowable-product prepare --dir /srv/private/case-operations \
  --kind caseInstance --request ORIGINAL-PREPARATION-UUID \
  --connection SAVED-CONNECTION-RECORD-ID --selection /srv/private/start-case-selection.json

starforge flowable-product review-operation --dir /srv/private/case-operations \
  --kind caseInstance --id PREPARED-RECORD-ID

starforge flowable-product dispatch --dir /srv/private/case-operations \
  --kind caseInstance --request ORIGINAL-DISPATCH-UUID --id PREPARED-RECORD-ID \
  --revision PREPARED-REVISION --plan-sha256 PREPARED-PLAN-SHA256
~~~

The other kinds are `caseRelease`, `casePlanItem` and `caseTask`.
`actions --name prepareCaseInstance` shows the installed action contract.
`call --method ORIGINAL_METHOD --input PRIVATE_JSON --out PRIVATE_JSON`
retains a complete original reply when it is too large for terminal output.

## Agent operations and complete customer receiving

The merchant connection exposes twelve case methods:

| Agent tool | Workspace method |
| --- | --- |
| `merchant_flowable_case_portfolio` | `readCasePortfolio` |
| `merchant_flowable_case_definition` | `readCaseDefinition` |
| `merchant_flowable_case_instance` | `readCaseInstance` |
| `merchant_flowable_capture_cases` | `captureCasePortfolio` |
| `merchant_flowable_prepare_case_release` | `prepareCaseRelease` |
| `merchant_flowable_dispatch_case_release` | `dispatchCaseRelease` |
| `merchant_flowable_prepare_case_instance` | `prepareCaseInstance` |
| `merchant_flowable_dispatch_case_instance` | `dispatchCaseInstance` |
| `merchant_flowable_prepare_case_plan_item` | `prepareCasePlanItem` |
| `merchant_flowable_dispatch_case_plan_item` | `dispatchCasePlanItem` |
| `merchant_flowable_prepare_case_task` | `prepareCaseTask` |
| `merchant_flowable_dispatch_case_task` | `dispatchCaseTask` |

Use the existing named workspace declaration and shared source/file delivery
tools. Saved record and review methods accept the case kinds. The common
reconciliation action reads the original native outcome after an interrupted
dispatch; it continues the saved request and retained response.

Export the complete workspace after the programme. Its NDJSON handover
contains the case portfolios and all operation revisions alongside existing
process and decision records, original CMMN and binary resources, full native
exchanges, journals and receiving lineage. Download the complete file, inspect
it in the receiving workspace, adopt its reviewed manifest and cold reopen
the installed application. The [receiving guide](RECEIVING.md) provides the
same complete file workflow for all three engine services.
