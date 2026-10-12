# Operate an original Research case through the client and merchant attachment

`original-client-operation.mjs` carries one existing research case through its authenticated listener, saved question analysis, complete delivery, and portable receiving. It uses the same generic client, CLI and merchant family shipped with the application.

Run it from a complete source checkout using Node.js 22 or later:

```sh
node stellar/scf-starforge-20261009/sf88-operator-buyer-cli/research-dossiers/examples/original-client-operation.mjs /private/original-operation.json
```

The private input uses schema `sf88.research-client.original-native-operation.v1`. Required fields are `operationId` (stable across continuation), `sourceRoot`, `directory` (the original saved Research store), `outputDirectory` (this operation's private retained outputs), `sourceMerge` (the verified checkout commit), `dossierId`, and `questionId`. All three directories are absolute.

For an already running Applications workspace, supply its original `connectionFile`; the operation borrows its listener. Otherwise it starts the original server against the selected saved directory and writes its private connection record inside the operation directory. Optional `serverArguments` are the existing server's host-selected source flags, such as `--crossref-state` and its original retained source directory. The operation closes the child it starts.

Optional `expectedOriginalRevision`, `expectedEditionCount`, `expectedFindingCount`, and `questionText` bind the receiving input to its actual current record. A newer compatible revision is read afresh. `analystNote` is appended to the existing question notes using the current revision; `noteSources` records its original source references. The same text is recognized after an interrupted response.

When the original Crossref source is configured, the operation selects its existing imported plan for this question and replays prepare, reviewed DOI paging, start, stop, and receive using the saved plan/edition identities. Supply `crossrefOperationId` to require the particular original plan. Its retained response count and the saved dossier revision must remain unchanged during that completed-operation replay.

The operation reads the original sections in revision-pinned pages and invokes the actual client CLI. It retains the complete report, portable gzip, original raw Crossref edition and revision comparison through merchant exports and verified chunk reads, then reopens the original portable record. A separate receiving copy also exercises exact UTF-8 byte retention using an explicitly labeled BOM encoding derivative of the retained aggregate edition. That receiving copy has its own output directory; the original case receives the analyst note.

`native-report.json` records each completed stage, source commit, current revision and exact output identities. Complete exports survive attachment detach/return. The driver retains partial progress at each stage, reuses completed receiving artifacts, and recognizes the same operation on continuation. Preserve the entire private output directory and the original saved source configuration with the result. A complete report can be returned without rerunning the operation.
