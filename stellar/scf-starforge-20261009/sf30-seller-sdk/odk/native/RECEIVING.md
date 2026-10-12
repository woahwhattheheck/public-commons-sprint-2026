# Receive an original ODK Central field workspace

This receiver carries one selected Central cohort through the existing store, source review, dataset exports, report, full archive and reopened workspace. It uses the original product APIs in `workspace.mjs` and `archive.mjs`. The same request and directories resume the same connection, plan, capture, prepared review, exports and archive after interruption.

Run it on the existing authorized host with Node 24 and Python 3. The receiving host needs the complete maintained SF30 source and its installed dependencies. Central remains on its existing host. The environment variable named by `connection.authEnv` holds the complete Authorization header; the request carries only that variable name.

## Host binding

The original receiving operation is `SCF-ODK-CENTRAL-FIELD-WORKSPACE-CB57-20261012`. Its host request and original project/form selection are coordinated in the [ODK source thread](https://tokenjunkielabs.slack.com/archives/C0BTB4SUCP9/p1791796787153989). The host supplies the actual base URL, authorization environment reference and selected Central project/form IDs before receiving.

The maintained source contract is [ODK Central v2026.3.1](https://github.com/getodk/central/releases/tag/v2026.3.1), whose backend is [de0d2a07fd7c9ff698cbc312e550dd40ff058340](https://github.com/getodk/central-backend/tree/de0d2a07fd7c9ff698cbc312e550dd40ff058340). Source-native practice inputs come from its original [XML fixture registry](https://github.com/getodk/central-backend/blob/de0d2a07fd7c9ff698cbc312e550dd40ff058340/test/data/xml.js); the original [OData format expectations](https://github.com/getodk/central-backend/blob/de0d2a07fd7c9ff698cbc312e550dd40ff058340/test/unit/formats/odata.js) define the service, metadata and repeat identities. The receiver consumes actual responses from the selected Central server.

For a practice project, retain the exact form and instance input bytes used by the original host operation. The released `doubleRepeat` input covers one root, three child and eight nested toy rows. Its native table names are `Submissions`, `Submissions.children.child` and `Submissions.children.child.toys.toy`. The released `withrepeat` inputs cover three root and three child rows. A page size of one exercises continuation. The host can include a later published form generation, a later submission version, original form media and both present and expected-but-missing submission media in this same practice project. Record those actual source identities and expected counts in the request.

## Original request

Use a private JSON file. This abbreviated example shows the fields; replace the host/project/form selection with the original operation's actual values. The complete Authorization header stays in the host environment.

~~~json
{
  "operationId": "SCF-ODK-CENTRAL-FIELD-WORKSPACE-CB57-20261012",
  "connection": {
    "name": "Selected Central host",
    "url": "https://central.example.org/v1/",
    "authEnv": "CENTRAL_AUTHORIZATION",
    "allowLoopback": false
  },
  "plan": {
    "name": "Original field-team receiving cohort",
    "forms": [{"projectId": "1", "formId": "doubleRepeat"}],
    "scope": {"pageSize": 1}
  },
  "capture": {"label": "Original published forms and submission history"},
  "review": {
    "reviewer": "Named receiving operator",
    "note": "The retained root and repeat cohort, original version history and source coverage were reviewed for this selected delivery.",
    "acceptedIssueCodes": [],
    "findings": [
      {"title": "Source scope", "text": "Describe the actual selected project, reporting window and interpretation."}
    ],
    "indicators": [
      {"selector": {"projectId": "1", "formId": "doubleRepeat", "table": "Submissions"}, "operation": "rows", "name": "Root submissions"}
    ]
  },
  "datasets": [
    {"selector": {"projectId": "1", "formId": "doubleRepeat", "table": "Submissions"}, "name": "Root cohort", "fields": ["__id"]},
    {"selector": {"projectId": "1", "formId": "doubleRepeat", "table": "Submissions.children.child"}, "name": "Child cohort", "fields": ["__id"]}
  ],
  "report": {
    "title": "Field-team source and receiving report",
    "narrative": "Describe this actual receiving operation and its reporting purpose."
  },
  "expected": {
    "tables": [
      {"projectId": "1", "formId": "doubleRepeat", "table": "Submissions", "rows": 1, "minimumPages": 1},
      {"projectId": "1", "formId": "doubleRepeat", "table": "Submissions.children.child", "rows": 3, "minimumPages": 3},
      {"projectId": "1", "formId": "doubleRepeat", "table": "Submissions.children.child.toys.toy", "rows": 8, "minimumPages": 8}
    ]
  }
}
~~~

Select useful captured fields in the actual request. The dataset engine adds the original row and repeat-parent keys and retains per-field value/null/missing state plus the native field semantics. It accepts up to 32 selected fields including the keys.

`scope` also accepts `submittedFrom`, `submittedBefore` and `updatedSince` using the original Central cohort rules. An omitted upper boundary freezes at the original capture's start. The receiver never turns page size into a total row cap.

Every report indicator carries a `selector` containing the original project ID, form ID and native table name. Supported operations are `rows`, `nonempty`, `sum`, `mean`, `minimum`, `maximum`, `distinct` and `frequency`; field-based definitions also carry `field`, and an exact equality filter can carry `equals`. A report can supply its own `indicators` and an existing same-server `baselineId`.

`expected.history` and `expected.formHistory` may contain exact expected native coverage counters. These compare with the original engine's quality projection, including versions, XML and expected/present/missing attachments. `review.acceptedIssueCodes` records the source conditions explicitly covered by the authored interpretation. Unexpected source issues are saved in `receiving.json` before the receiver returns for correction. Preserve the request once dispatched; a materially different selection or review is a new receiving operation.

## Run and resume

Use separate sibling directories for the original workspace, receiving output and restored workspace. They must have sufficient capacity for the retained source and full reopened copy.

~~~sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/odk/native/receive.mjs \
  --request /private/odk/receiving-request.json \
  --directory /private/odk/workspace \
  --output /private/odk/receiving \
  --restore-directory /private/odk/reopened
~~~

The same command resumes the same original request. There is one native capture and one writer for its workspace. The receiver first writes the exact request hash and deterministic IDs. A completed capture remains completed. A prepared review records its original capture revision and decision position before mutation; a retry reconciles that exact saved decision. Dataset, report and archive calls use fixed IDs and their original engines' replay behavior. Once `result.json` is published, an interrupted final journal write is recovered from that complete result.

Programmatic callers can use:

~~~js
import { receiveCentralWorkspace } from './native/receive.mjs';

const result = await receiveCentralWorkspace({
  specification,
  directory,
  outputDirectory,
  restoreDirectory,
  onStage: async ({ stage, operationId, ids }) => {
    // Join these actual stage identities to the existing native operation.
  }
});
~~~

## Retained outputs

`receiving.json` contains the exact input identity, native stage progression, original capture/review/export/archive identities and any returned source issue. `result.json` is written after the full archive has reopened and the original content has been compared.

The receiving result retains:

- Actual table row/page counts and a streaming digest of every retained row.
- Complete root-submission history counts and a digest of each original history object.
- Original resource-index identity and verified retained source-body hashes and sizes.
- Full source coverage and the authored review ID.
- Exact dataset/report file names, byte counts and SHA-256 values.
- The original full archive path, byte count and SHA-256.
- Reopened workspace identity, matching rows/history/resources and matching original dataset/report bytes.

The source bodies, form generations, submission XML versions, available media, authored findings, datasets and reports remain in the complete original workspace archive. The receiver adds a small operation journal and result, while the original product owns all stored research content.

## Existing workspace receiving and interruption

Keep this receiver attached to the original admitted host operation. After a network interruption, the same capture continues its retained resource/page cursors. After a process loss, the original workspace's writer lease and capture recovery decide whether the previous owner has ended.

Archive restore uses the original archive identity and its recorded receiving marker. A retry reuses that restore; it preserves later edits in the restored workspace. The receiver then verifies the source edition and original exported file bytes that belong to this operation. A later different source review is surfaced without replacing its decision.
