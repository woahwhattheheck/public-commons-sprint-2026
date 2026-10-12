# Laboratory EDD operator

The laboratory desk connects the installed Lab EDD application to the original Merchant MCP, paid-job merchant and SF88 customer workspace. An agent can select complete original EDDs, inspect every physical row and correspondence candidate, prepare source-bound decisions, run the original checkout and receive the complete native result.

The installed command is `starforge lab-edd-agent`. The merchant provider is `laboratory-workspaces`; it advertises 42 `merchant_lab_*` tools. The existing Applications product is still `laboratory-edd`, and its original `paid-job-merchant` owner continues to run the merchant and worker.

## Install and connect the existing product

Use the source-pinned Merchant Workspace distribution containing the `lab-edd` contribution. It supplies the Lab source profiles, offline editors, CLI, native worker, operator provider and receiving command together.

Start or select the existing Laboratory EDD application in Applications. Use its original paid-job workspace connection, which identifies the merchant directory, source hashes and saved native launch or URL file. The merchant must expose the configured complete `laboratoryReview` function and its original public HTTPS intake.

Create two owned private customer directories if using the complete receiving command: one authoring customer and one independent receiver. Keep the existing buyer runtime, operator profile or operator workspace, and supported explicit CONNECT transport. The customer directory differs from the merchant directory. The source/runtime directories must be canonical existing paths; private state and profiles retain their original ownership and permissions.

Copy and configure these supplied files:

- [lab-edd-workspaces.example.json](lab-edd-workspaces.example.json): named original customer desks and their existing merchant alias.
- [lab-edd-setup.example.json](lab-edd-setup.example.json): the new MCP directory and the original two connection files.
- [lab-edd-receiving.example.json](lab-edd-receiving.example.json): the complete original McCampbell receiving operation.

The examples use the original disposable `jobs-merchant.example` checkout fixture and its exact testnet terms. For an operating merchant, select its actual origin, payment terms, runtime and profile. The configured proxy is the original explicit transport; it is bound to that same origin. Credentials remain in host environment variables or the original private operator store.

```bash
starforge merchant-mcp providers inspect laboratory-workspaces
starforge lab-edd-agent init --options /srv/starforge/lab-setup.json
starforge lab-edd-agent tools
starforge merchant-mcp serve --config /srv/starforge/lab-operator/laboratory-mcp.json --port 3211
```

The common provider initializer is also available:

```bash
starforge merchant-mcp init-provider laboratory-workspaces --options /srv/starforge/lab-setup.json
```

The initializer delegates to the original paid-job merchant initializer, then writes the complete `laboratory-mcp.json` configuration alongside the original merchant setup. Its two providers share the same original merchant alias. The Lab provider creates its retained files below the customer's existing `artifacts` root, which the original native input-file controller already allows.

Host settings include:

| Setting | Existing owner or behavior |
| --- | --- |
| `runtimeDirectory` | Original SF88 Node buyer runtime |
| `operatorProfile` or `operatorWorkspace` | One original operator selection |
| `approvalMode: "terminal"` | Original controlling-terminal review and approval |
| `approvalMode: "operator"` | Original SF62 browser approval broker, exposed through explicit MCP approval tools |
| `transport` | Original origin-bound explicit CONNECT transport |
| `intakeTokenEnv` | Existing intake access token variable, when required |
| `temporaryDirectory` | Existing private native-process scratch directory |
| `LAB_EDD_PYTHON` | Original Python executable for DTS workbook decoding and native rendering |
| `inputFileStorage` | Original `storageLimits()` policy; omitted values keep native defaults |

EQuIS CSV work runs in Node. The accepted DTS8D workbook profile uses Python 3.10+ and the existing standard-library workbook reader. Whole file operations use the original process broker and its guardian. Closing a Lab call stops and drains that original native process before its held files are released.

## Operate one complete request

`tools OPERATION` prints the exact current schema. The CLI accepts complete argument JSON files, so decision documents and native identities retain their exact fields and newlines.

```bash
starforge lab-edd-agent tools request_create
starforge lab-edd-agent call discover --url http://127.0.0.1:3211 --workspace laboratory --out /srv/starforge/operation/catalogue.json
starforge lab-edd-agent call request_create --url http://127.0.0.1:3211 --workspace laboratory --input /srv/starforge/operation/request.json --out /srv/starforge/operation/request-created.json
```

Create arguments select the returned `catalogRef` and `expectedCatalogSha256`, a stable `reference`, and actual Lab `parameters`. Parameters use the original schema: `profile`, `reviewName`, optional `baselineProfile`, scientific source hashes, encoding and selected decision formats. The operator adds file descriptors through their original native slots afterward.

The same reference reopens the same original request when its original catalogue, function, parameters and label match. Keep that request ID throughout review, native checkout, job execution and recovery.

Upload the exact original archives or accepted workbook:

```bash
starforge lab-edd-agent upload --url http://127.0.0.1:3211 --workspace laboratory \
  --path /srv/starforge/inputs/Equis4_CSV.zip --input-id mccampbell-current \
  --name Equis4_CSV.zip --content-type application/zip \
  --sha256 a57c18f4bf8054503155e1c8ccdb0bf7b736e4cc5eefef5e8d4c61a145ed2879 \
  --out /srv/starforge/operation/current-upload.json
```

Then call `select` with the returned `inputRef`, original request ID, current `expectedRevision`, exact file SHA and one of:

| Slot | Full input | Native size allowance |
| --- | --- | --- |
| `source` | Original current EDD archive or accepted worksheet | 16 MiB |
| `baseline` | Original baseline EDD | 16 MiB |
| `decisions` | Current-field decision document | 4 MiB |
| `baseline_decisions` | Separate baseline-field document for different-profile comparison | 4 MiB |
| `reconciliation` | Complete source-bound correspondence decisions | 16 MiB |

These are the installed laboratory function's policies; the current merchant catalogue is authoritative. The operator reads source bytes from the original sealed input store through held file handles. An interrupted `select` or saved-review application continues the same upload until its native state is `SEALED`.

## Inspect the whole source and correspondence

Call `inspect` for the complete retained source review and `binding.bindingSha256`. Keep that binding on subsequent rows, issues, groups, table and preview calls.

`rows`, `issues` and `groups` page 1–200 full records. Follow `nextOffset` until null, preserving the returned source binding. Row IDs use the original `row-…` identity; correspondence groups use `group-…`. The operator retains original filenames, physical row identities, native keys, exact strings, blank values, qualifiers, units, every reported limit and worksheet provenance.

Different-profile comparison retains every ambiguous candidate. It does not assume that two different supplier exports contain the same one-to-one observations. Current-field, baseline-field and correspondence decisions remain separate source-bound documents.

Large source and comparison responses are returned as `COMPLETE_FILE` descriptors. The descriptor identifies the entire original response, and the typed client or CLI receives it in complete verified chunks:

```bash
starforge lab-edd-agent receive-reply --url http://127.0.0.1:3211 --workspace laboratory \
  --input /srv/starforge/operation/groups-reply.json --out /srv/starforge/operation/groups-complete
```

## Review, edit and save a complete native choice set

Use `preview` with either complete `documents` or `documentRefs` for `current`, `baseline` and `correspondence`. A family takes one document or one retained file reference. The original model normalizes the choices and returns the exact preview hash, source identities, native review identities and complete retained preview.

`table` exports CSV or TSV. Field tables support `scope: "all"` and `scope: "issues"`; correspondence exports retain the entire source catalogue and explicit cross-group links. Download the file, edit the existing action/value/reason or correspondence columns, upload the whole edited file and call `table_import`. The returned normalized `documentRef` can feed the next preview.

`review_save` requires a new immutable `reviewId` and `expectedPreviewSha256`. It saves both editable formats, all normalized documents, the current and baseline reports, the full correspondence editor, the full preview, and exact job-ready decision inputs.

```bash
starforge lab-edd-agent download-review --url http://127.0.0.1:3211 --workspace laboratory \
  --review-id YOUR_SAVED_REVIEW --sha256 YOUR_SAVED_REVIEW_SHA \
  --out /srv/starforge/operation/offline-review
```

The downloaded directory contains the complete reports and editors with their related files. An operator can keep editing the exported tables and create a new immutable review. Original source values and all prior reviews remain addressable.

`review_apply` stages the saved review into the same original request. Its arguments are `requestId`, stable `applyId`, `reviewId`, exact `expectedReviewSha256` and the revision selected when this application was first started. After interruption, repeat those exact arguments. The retained intent accepts only the original before-state or the desired saved descriptors, resumes each missing native upload and verifies all targets are sealed.

## Execute and receive the original native job

The operating sequence remains the original customer and merchant flow:

| Work | Tools | Retained identity |
| --- | --- | --- |
| Prepare sealed originals and import native ticket | `intake` with `prepare` or `import` | Request ID, revision, original claim and checkout ID |
| Inspect and review purchase | `checkout`, `checkout_action` with `review` | Original SF88 intent and exact accepted terms |
| Record actual operator decision | `approval`, `approval_decide` | Intent, approval ID, request hash and current native task ID |
| Execute or recover | `checkout_action` with `execute` or `recover` | Original buyer attempt and accepted customer entry |
| Run or drain computation | `worker`, `merchant_job`, `job_action` | Original paid job, current job revision and worker |
| Follow and fetch result | `customer`, `customer_action` with `watch` / `fetch` | Same accepted buyer entry and original resource library |
| Verify and receive complete delivery | `result_open`, `result`, `download` | Entire original ZIP, native source/result graph and member hashes |

Read the original revision before a mutating action. A previous checkout attempt uses `recover`. The existing SF88 operator approval remains the purchase authority.

For Stop or wait, pass the actual `taskId` when continuing a previously observed task. The original intake, checkout and customer controllers verify that task inside their own operation boundary. A Lab wait observes cancellation and requests Stop for that captured task before draining it. Provider shutdown then closes the scientific desk, retained files and original customer lease in that order. The borrowed merchant continues under its original Applications owner.

`result_open` accepts either the original customer `resourceId` or one uploaded complete result `inputRef`, plus its expected SHA. It calls the original Lab result reader, verifies both source families and their native outputs and retains the entire immutable result. `result` pages the manifest or returns an exact full member. Receiving the ZIP in a second configured customer desk and calling `result_open` provides independent reopening.

A result graph is validated once per exact ZIP while its full archive is read and hashed on subsequent member requests. This keeps all original verification while avoiding a complete scientific reparse for every member download.

## SDK use

```js
import {
  openLaboratoryWorkspaceClient,
  uploadLaboratoryInput,
  downloadLaboratoryFile,
  receiveLaboratoryReply,
  downloadLaboratoryReview,
} from '@tokenjunkielabs/starforge-merchant/lab-edd/operator/client';

const client = await openLaboratoryWorkspaceClient({
  url: 'http://127.0.0.1:3211',
  workspace: 'laboratory',
  tokenEnv: 'MCP_ACCESS_TOKEN',
});
try {
  const catalogue = await client.discover();
  const prepared = await client.requestCreate({
    catalogRef: catalogue.catalogRef,
    expectedCatalogSha256: catalogue.catalogSha256,
    reference: 'laboratory-project-2026-10',
    parameters: { profile: 'equis-lab-4', reviewName: 'october-receiving' },
  });
  // Continue with actual returned source descriptors and native IDs.
  const selected = await client.request({ requestId: prepared.request.id });
  console.log(selected.id, selected.revision);
} finally {
  client.close();
}
```

The client preserves the original complete-file transfer implementation, including range/read IDs, exact offset continuation, source SHA checks and explicit reader release. Closing the client ends its own calls; native Stop and recovery retain their original explicit operations.

Pure source models are available as `@tokenjunkielabs/starforge-merchant/seller/lab-edd/operator/model`; the original in-process customer desk is `…/seller/lab-edd/operator`. The full MCP provider, connection, setup and receiver are exported below `…/lab-edd/operator`.

## Complete original receiving

Run the single maintained operation with the supplied receiving configuration after selecting the actual configured native merchant and buyer:

```bash
starforge lab-edd-agent receive \
  --configuration /srv/starforge/lab-receiving.json \
  --directory /srv/starforge/lab-mcp-receiving
```

The command starts the original authenticated merchant MCP host on a retained local port, opens two original customer desks and uses the existing merchant. It performs these complete joins:

1. Verifies the original source files and scientific identities, uploads them through the native input store and reopens the same request.
2. Pages every original physical row, source issue and correspondence group, including exact row/group selections.
3. Exports both complete editable formats for every family, verifies exact bytes against the original models and imports each normalized document.
4. Saves the complete review, downloads its offline working directory, cold-reopens the MCP/customer owners and applies every saved native decision into the same request.
5. Runs original prepare, SF88 review, explicit approval and execute/recover; receives the real accepted customer entry and original job result.
6. In a declared dedicated merchant fixture, holds the worker while a real customer watch/wait is active, closes the MCP owner, verifies that same task drained and starts the original worker.
7. Interrupts and resumes the same complete result transfer through the same endpoint; downloads every original result member with exact byte/hash verification.
8. Receives the complete original ZIP into the independent customer desk, cold-reopens both owners and verifies the same source/result and original payment identity.

The supplied McCampbell configuration binds its actual public EQuIS3/EQuIS4 source pair: 500 result rows in each file family, 571 baseline and 614 current physical rows, and 599 correspondence groups. The retained example records 29 explicit ambiguous deferrals, one reviewed pair and one explicit cross-group link. Its field decisions keep the original `mg/l` and `mg/L` tokens with reasons. The complete source and scientific derivation are in [the McCampbell cross-profile guide](../../stellar/scf-starforge-20261009/sf30-seller-sdk/lab-edd/examples/mccampbell/CROSS_PROFILE.md).

The existing SF88 [native checkout continuation](../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/job-workspace/checkout/README.md) supplies the full original disposable signer/facilitator, explicit CONNECT/TLS, operator policy, SF36 SQLite reservation and exact approval fixture. Its `native-continuation.py` and `native-continuation.mjs` remain the maintained protocol reference. The receiving API accepts trusted startup options and the original explicit approval callback for that native host.

Keep the same output directory and configuration after interruption. `checkpoint.json` retains the original request, review, apply, checkout, buyer and result identities. Completed payment attempts reopen or recover. `result.json` is written only after the full native result and independent reopen complete.

For capacity planning, the complete cross-profile result expands to more than 120 MiB and retains both full comparisons and native source graphs. Use the existing equipped-worker route for the full native/MCP/browser operation; select adequate memory and disk for the complete files and two retained customer desks. The source/profile examples, original worker/browser receiving and this operator receiving remain one reusable application distribution.

## Complete original-source example

The operator's original source models reopened both complete public McCampbell archives on 12 October 2026. The current and baseline families retain 500 results each, 614 and 571 physical records, 599 correspondence groups and all 29 ambiguous groups. All ten scientific source, field-review, correspondence and resulting-comparison hashes matched the previously received complete result.

Every full editable catalogue was exported and parsed back into the exact saved decision document:

| Family | Format | Catalogue rows | Bytes |
| --- | --- | ---: | ---: |
| current | CSV | 20,983 | 3,590,916 |
| current | TSV | 20,983 | 3,590,714 |
| baseline | CSV | 35,168 | 6,237,293 |
| baseline | TSV | 35,168 | 6,237,091 |
| correspondence | CSV | 600 | 407,348 |
| correspondence | TSV | 600 | 407,344 |

The complete [source execution result](../../stellar/scf-starforge-20261009/sf30-seller-sdk/lab-edd/examples/mccampbell/operator-source-result.json) retains original archive identities, exact table hashes, source module pins and execution context. This execution used the original source functions in connected V8 with the retained archive bytes and exact UTF-8, SHA256 and DEFLATE bindings.

The full baseline table exceeds the original 4 MiB native field-decision slot. The operator receives that complete table through its file transport, parses it into the source-bound decision document and stages the resulting compact JSON through the original slot. Every table row and original field remains in the exported review; native file policy continues to govern the actual job input.

The complete native receiving command retains its original request, checkout, worker and transfer checkpoints and writes its actual `result.json` after full result receiving and independent reopening. Keep those records with the selected source and runtime tuple.
