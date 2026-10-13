# Receive complete Directory relationship results

The Human Services Directory operator, typed SDK and Merchant MCP expose the same retained foreign-key assessments. An operator can read the original child assertions, inspect every target candidate, follow all matches, reopen the complete source row and receive every original file. The full client programme then downloads the editable workspace, receives that exact packet into a separate private customer directory and reopens its indices and procedure histories.

The native interpretation is defined in [Declared relationships](CONFORMANCE_FOREIGN_KEYS.md). This guide describes the complete client and receiving workflow for implementation edition `stellar-forge.directory-conformance.hsds-foreign-keys.20261013`. Its source, SDK and browser use the installed native catalogue. An earlier assessment retains its original implementation and files.

## Review a saved assessment

Open the existing **Human Services Directory** application, choose **Conformance**, then **Assessments**. Find the original assessment by its ID and open it. A current HSDS assessment presents four relationship views:

| View | What remains complete |
| --- | --- |
| Outcomes | Every selected child row and original foreign-key declaration, with separate existence and identity-resolution results. |
| Candidates | Every original row interpreted for a target-field group, including invalid, null and non-tabular candidates. |
| Matches | Every exact outcome-to-candidate edge, with both original source references. |
| Coverage | Original standard and datapackage metadata, selected declarations, target groups, explicit table domains, row counts and interpretation policy. |

The **Original table domains** table includes documents outside the selected edition. Its selection and coverage columns distinguish those documents from selected target tables. A retained table with zero rows displays **0**. An absent or unselected table has different coverage; it does not become an empty received table.

Outcome rows show **Existence** and **Resolution** separately. An ambiguous result can pass the existence check while retaining several target identities. **Read every match** opens every edge for that outcome. **Inspect target group** shows the complete candidate group. A candidate's **Read every use** opens all related matches. The operator does not choose an ambiguous target automatically.

Open a complete outcome, candidate or match to inspect its original declaration, physical values, logical interpretation and full retained record. **Open original row** reopens the unchanged source JSON text and original row metadata. The original member name, digest, row identity and pointer remain visible. JSON numbers and CSV cells are preserved by the source engine; a displayed interpretation does not replace the original bytes.

### Filters and pages

All filters are exact native filters. The UI omits empty fields. The typed SDK and MCP catalogue derive these schemas from `directory-conformance-schema.json`.

| View | Optional identity and scope filters |
| --- | --- |
| Outcomes | `table`, `state`, `ruleId`, `sourceId`, `recordId` |
| Candidates | `table`, `state`, `groupId`, `sourceId`, `recordId` |
| Matches | `outcomeId`, `candidateId` |

Every page carries `assessmentId`, `rows`, `total`, `offset`, `limit`, `nextOffset`, `bytes` and `byteBudget`. Page size is 1–250, with the original 4 MiB response budget. Follow `nextOffset` until it is null. A page can contain fewer than the selected limit because of the byte budget. The total belongs to the exact selected filters.

The UI permits the native bounded state strings and suggests the current implementation's values. It does not narrow the source API to the suggestions. The original ordinal order is retained across pages. **Download current page** is explicitly a page; the complete-file controls below receive the whole original dataset.

## Receive complete files

The four additional assessment file kinds are:

| Native file kind | Format | Contents |
| --- | --- | --- |
| `foreignKeys` | JSONL | Complete original child/declaration outcomes. |
| `foreignKeyCandidates` | JSONL | Complete target candidates and their original interpretations. |
| `foreignKeyMatches` | JSONL | Every exact matching edge, including all ambiguous targets. |
| `foreignKeyCoverage` | JSON | Complete declarations, policy, target groups and original table domains. |

These supplement the seven original assessment files. Earlier HSDS assessments and current HSD assessments retain their applicable original files. The current UI does not invent relationship outputs for them.

Use the complete-file buttons in the workbench, the native assessment file route, or the existing connected downloader. The native descriptor supplies the original byte count and SHA-256. The connected receiver retains the complete native payload, request metadata, manifest and resumed download receipt. A file called `original-artifact.json` is original transport metadata; the actual payload is the manifest's `source.payloadFile` when present, otherwise `original-response.json`.

The native relationship-file limit is 1 GiB, the connected complete-file limit is 512 MiB, and the native whole-workspace limit is 2 GiB. A larger native file remains available through the native complete-file route. The connected receiver rejects a selected file above its declared limit; it does not truncate it. Full source and index limits remain those declared in the original source catalogue.

## Typed SDK and Merchant MCP

The same methods work through a local client borrowing an open Applications operator or a client attached to the maintained Merchant host. Use the existing private connection configuration described in [Connected operator](connected/README.md).

The original export is `@tokenjunkielabs/starforge-merchant/merchant/human-services-directory`. A complete page iteration can be written as follows:

```js
import {
  openHumanServicesDirectoryLocalClient,
  iterateHumanServicesDirectoryForeignKeys
} from '@tokenjunkielabs/starforge-merchant/merchant/human-services-directory';

const client = await openHumanServicesDirectoryLocalClient({
  connection: '/absolute/private/directory-connection.json',
  exportsDirectory: '/absolute/private/native-exports'
});
try {
  for await (const {page, result} of iterateHumanServicesDirectoryForeignKeys({
    client,
    workspace: 'provider',
    assessmentId: selectedAssessmentId,
    kind: 'outcomes',
    filters: {state: 'ambiguous'},
    limit: 100
  })) {
    // page.rows is the complete current page in its original native order.
    // result identifies its retained full native response and manifest.
    await receiveOriginalPage(page, result);
  }
} finally {
  await client.close();
}
```

`receiveOriginalPage` in this example is the caller's chosen persistence function, not an SDK method. The supplied full operating driver below already receives these complete originals through the maintained downloader.

The helper accepts `kind: "outcomes"`, `"candidates"` or `"matches"`. Type overloads preserve the specific row type. The existing `iterateHumanServicesDirectoryConformance` helper also accepts `foreign_keys`, `foreign_key_candidates` and `foreign_key_matches`; its earlier findings and assessed-row forms retain their original types.

For a complete original file:

```js
import {
  downloadHumanServicesDirectoryExport
} from '@tokenjunkielabs/starforge-merchant/merchant/human-services-directory';

const result = await client.call('directory_conformance_file', {
  workspace: 'provider',
  collection: 'conformanceAssessments',
  recordId: selectedAssessmentId,
  fileKind: 'foreignKeyMatches'
});
const received = await downloadHumanServicesDirectoryExport({
  client,
  workspace: 'provider',
  exportId: result.exportId,
  expectedManifestSha256: result.manifestSha256,
  directory: '/absolute/private/complete-original-matches'
});
```

Preserve the full returned directory, manifest and receipt. Use `reopenHumanServicesDirectoryExport` to verify the completed local copy without reacquiring it. The full client driver checks that every native file's bytes and digest match the selected assessment descriptor.

The three callable actions are `directory_conformance_foreign_keys`, `directory_conformance_foreign_key_candidates` and `directory_conformance_foreign_key_matches`. The existing tool prefix remains `merchant_human_services_directory_`. Source acquisition, assessment creation, review, comparison and Operating Plans actions remain in the same provider.

### Connected command line

The existing CLI consumes the same exact input JSON and retains its original full response:

```sh
starforge merchant-human-services-directory call \
  --connection /absolute/private/directory-connection.json \
  --exports /absolute/private/native-exports \
  --action directory_conformance_foreign_keys \
  --args /absolute/private/selected-relationship-page.json
```

The input JSON supplies the selected `workspace` alias, `assessmentId`, and any native filters or page values. Use the returned export and manifest identities with the existing `value`, `download` and `reopen` commands. The native CLI's three paged row forms and four complete file kinds are documented in [the native guide](CONFORMANCE_FOREIGN_KEYS.md).

## Complete original client programme

The maintained `operate_foreign_key_clients.mjs` is a whole receiving operation. It requires the actual completed native `OPERATED_DIRECTORY_FOREIGN_KEYS.json` and its original workspace, already present or received through the native full-workspace receiver. It never constructs another set of assessments.

Its stable operation is `SCF-DIRECTORY-CONFORMANCE-FOREIGN-KEYS-CLIENTS-450E-20261013`. The input must be the completed native operation `SCF-DIRECTORY-CONFORMANCE-FOREIGN-KEYS-450E-20261013`, with the original UUID, all eight case selections, actual observations and successful native restoration.

```sh
node /absolute/source/stellar/scf-starforge-20261009/sf30-seller-sdk/fhir_directory/operate_foreign_key_clients.mjs \
  --receiving /absolute/original/OPERATED_DIRECTORY_FOREIGN_KEYS.json \
  --workspace /absolute/private/received-original-fk-workspace \
  --out /absolute/private/foreign-key-client-receiving \
  --chromium /absolute/existing/chrome-headless-shell \
  --playwright /absolute/existing/playwright/index.mjs
```

The Playwright module flag is optional when the maintained primary runtime exposes its installed module. Chromium is an explicit existing executable. Use the actual interpreter/runtime configuration already supporting the native Directory application. No browser or toolchain installation is part of this programme.

The workspace flag explicitly selects the received private location. The original native result is copied unchanged into the output's `originals` directory. Its original path fields remain historical source evidence; they are not rewritten to pretend that the original native run occurred on the receiving host.

### Full sequence

1. Verify the completed native input, original UUID, selected eight-case IDs, source-file identities and operation journal. Open the original Directory through its maintained connection owner.
2. Open Merchant and compare its complete installed action catalogue with the original native schemas. Read every immutable Directory record through its complete source-defined response bytes, including every retained Operating Plans record.
3. Receive every selected original source file and source/edition index, every selected assessment and review file, and the complete comparison files. Read all outcome, candidate and match pages for all eight cases. Preserve their original payloads and manifests.
4. Reopen the actual original ambiguous result, all matching edges and target candidates. Read the selected null, missing-target and explicitly empty-table observations. Compare the complete coverage files with the native summaries.
5. Operate the browser's three page views, full coverage and original-row/detail drilldowns for all eight cases. Receive all four complete relationship files through the browser. Record desktop and phone layouts and screenshots.
6. Close and reopen Merchant while the separately owned original Directory process remains active. Verify the same operator identity, complete records and relationship totals. Reopen retained historical assessments and Operating Plans when they exist.
7. Download the complete editable workspace through the browser and receive a separate full export through Merchant. Recheck the source workspace's complete immutable record inventory, then close its owned processes.
8. Receive the exact browser packet into the separate private `received-workspace` destination through the unchanged native workspace-import operation. Require its actual completed receiver-local receipt, original UUID, and complete immutable record equality.
9. Reopen every relationship index and the four relationship files from the received customer workspace. Reopen complete original procedure histories. Observe the customer browser and export its complete editable workspace.
10. Retain the final result, journal, native originals, full manifests, downloads, screenshots and customer workspace in the output directory.

The browser phase permits only native GET and HEAD requests. It neither creates a new assessment nor changes a finding, source, service selection or procedure. The customer import is a separate explicit native receiving operation. Its `receives` record is local custody evidence; acquisitions retain their original mutable semantics. Neither is compared as if it were an immutable assessment.

### Original cases

The programme consumes the eight case keys supplied by the native result: original CSV, the explicitly authored description successor, original tabular JSON, original nested JSON, the two-original-editions assessment, the service-only edition, selected service assertions with original context, and the explicitly authored empty organization table.

Counts, IDs, file digests and actual observations come from that native result. These are original-source exercises and selected authored successors. The client programme does not infer a current provider deployment, live capacity, production conformance, a customer acceptance or an executed service referral from them.

## Interruption and repeat receiving

Keep the complete private output directory, exact native JSON, selected workspace and same source edition. Run the same command again after an interrupted response. The journal binds the source files, original input digest, workspace, output location and stable operation. A conflicting input is rejected before the existing journal is updated.

Each selected read and file request has its own retained entry. Completed downloads and page exports reopen their existing manifests and verify full local bytes. Failed file observations remain in the journal before a read is retried. Browser attempts retain their own screenshots, original HTTP responses, errors and observed resource counters. A completed browser phase reuses its saved results.

The fresh customer import uses the same selected browser packet and native receiving row on every in-place continuation. The original receiver resumes an incomplete matching import and recognizes a completed one. Completion is checked in the full `receives` row: exact archive digest, `kind: "workspace"`, original workspace UUID and `state: "complete"`. The import response's `state` field is the complete workspace state object.

A completed whole client result reopens its retained complete-file manifests and verifies the final editable packet before returning the same result. Preserve the journal with its selected output paths when moving an interrupted operation; this driver deliberately does not silently rewrite operation bindings or old absolute paths. A new receiving host can receive the published complete workspace through the native receiver and choose an explicit private workspace for a separately recorded client observation.

The original source and customer workspaces remain distinct. The original received browser archive and the final customer editable archive are separate files and can have different hashes. Send a selected completed result together with the exact `workspacePacket` described by that result.

## Complete handoff

The final result is `OPERATED_DIRECTORY_FOREIGN_KEYS_CLIENTS.json`, with schema `stellar-forge.directory-foreign-keys-clients-operated.v1`. Its `workspace` identifies the received customer workspace and its `workspacePacket` identifies that workspace's complete editable export. `browserWorkspacePacket` retains the earlier full browser download separately. The unchanged native result and its original packet descriptor remain attached as source evidence.

Deliver the following together:

- The final client result and `FOREIGN_KEYS_CLIENTS_JOURNEY.json`.
- The unchanged native `OPERATED_DIRECTORY_FOREIGN_KEYS.json` and its original operation/source provenance.
- The exact final `workspacePacket` archive, with its full byte count and SHA-256.
- The complete `downloads` and `page-exports` directories, including original payloads, manifests and receiving receipts.
- Browser original-response records, full downloaded relationship files, screenshots and the complete customer receiving record.
- The maintained native, UI, SDK and receiving source with the exact edition selected for the run.

Save the complete output before releasing a private runtime. A source publication or a successful syntax check is not a completed operating result; only the returned native/client records and verified artifacts establish the corresponding completed phases.

## Source composition

The native relationship implementation is published in Public [PR2697](https://github.com/woahwhattheheck/public-commons-sprint-2026/pull/2697) and Merchant [PR911](https://github.com/woahwhattheheck/tjlabs-stellar-merchant-workspace/pull/911). Its complete native source capsule is `d20ce33bd105e2eab0f02422320305311215e7fb`, 244,206 bytes, SHA-256 `99c0d0611cb3bcc31107f4fd2cd7aedc90f767b24fef1870f9009cb6f8269856`.

The client companion is an additive successor to the complete Operating Plans source published in Public [PR2679](https://github.com/woahwhattheheck/public-commons-sprint-2026/pull/2679) and Merchant [PR895](https://github.com/woahwhattheheck/tjlabs-stellar-merchant-workspace/pull/895). It preserves the original model, saved histories, all prior conformance actions and their complete-file receiving.

The selected product retains `CONFORMANCE_NATIVE.md` and `operate_conformance_clients.mjs` explicitly, together with the native relationship engine, its original operating driver, this guide, the relationship workbench and `operate_foreign_key_clients.mjs`. The same selected distribution serves the private application, native CLI, typed client and Merchant tools.
