# Original BLS publisher and customer receiving operation

This operation carries one retained BLS capture through the existing source-dataset publisher, the original SF88 dataset acquisition, the original SF100 delivery exporter, and the original Vitality source importer. It exercises the data path that a customer needs: publish the complete source inventory, retain the acquired pages, reconstruct the original source files, import their native envelopes, and reopen the same customer workspace.

The application and native dependency pin is **b4696a15f790d7a6c1653b90117a6ba8e63eb002** in this repository. The operator adds no dataset engine or payment ledger. It uses the APIs already exposed by the publisher, SF88/SF100, and the BLS consumer module.

## Inputs and runtime

Use an existing Node runtime and Python runtime, the original repository source, an existing immutable BLS capture, and an authorized checkout of the original Vitality application. All paths passed to the operator must be absolute and canonical, including the resolved interpreter path.

The source capture is produced by the maintained BLS capture importer. Its source.json identifies _bls/capture-manifest.json and its exact SHA-256. That manifest retains every public raw file and adjacent HTTP receipt. This operation consumes the existing capture; it does not collect another copy.

For the original three-county source edition, the receiving keys are laus, qcew-50005, qcew-50009 and qcew-50019. They are loaded from the original Vitality source catalog and mappings. The receiving checkout stays on the authorized local or private surface. Its implementation and customer workspace are not included in this public operator.

The source-index.json file records the original Git blob identities needed to bind a materialized checkout to the selected application version. Before execution the operator checks every indexed file that is present and requires its native entrypoints. This supports reuse of an existing dependency closure when a whole repository checkout is unnecessary. Resolve a missing original import from this exact application pin before continuing.

Reuse installed SDK dependencies that satisfy the original application lockfiles. The publisher's ordinary developer-portal assets and the SF88 Python dataset bridge are part of its runtime closure, even though this operation has no browser UI.

## Run the complete operation

Choose one private run directory with enough space for the original saved plan, extracted dataset, versioned publication, acquired pages, SF100 exports, reconstructed source capture and customer workspace.

Example, with the actual canonical paths filled in:

    node --max-old-space-size=512 --expose-gc \
      operations/bls-labor-native-20261012-4bf5/native-journey.mjs \
      --checkout /absolute/original-checkout \
      --source-file /absolute/bls/source.json \
      --capture-id ORIGINAL_MANIFEST_SHA256 \
      --run /absolute/private-bls-operation \
      --python /absolute/resolved-python \
      --vitality-source /absolute/original-vitality

The retained operation identity is BLS-LABOR-NATIVE-4BF5-20261011. Coordinate ownership before dispatching that operation on another host. The execution directory, source capture, original source pin and interpreters become part of its saved binding.

The command calls these maintained interfaces in order:

1. readBlsSource verifies the immutable capture and its source receipts.
2. openBlsPublisher saves or reuses an original source_files plan, extracts it, reviews it and publishes it through the original dataset version store.
3. The original versioned seller exposes the real compiled offer. buyerOffer and prepareBuyer retain that offer, its selected snapshot and the original SF88 buyer configuration.
4. createDatasetSession and runDatasetSession retain real HTTP page responses through X402BuyerClient, the original response-file writer and executeWithEvidence.
5. The operator stops after the first retained page, resumes the same session to completion, and verifies that a completed-session call issues no additional page request.
6. It moves one original page result aside, then calls recoverDatasetSession. The native reader reconciles the existing response and original evidence without requesting that page again.
7. The original seller, version store and publisher close before receiving begins.
8. DatasetAcquisition.deliver builds the original SF100 data room. The production BLS receiver verifies its delivered JSONL rows, chunk hashes, file hashes and complete manifest inventory, then restores the raw source capture.
9. The original Vitality catalog produces each native source envelope. Workspace.import_source imports it and retains the original source/definition bytes. Closing and reopening that same workspace yields the same source identifiers and reused imports.
10. Reopening the already received capture verifies its original inventory again.

The operator prints progress as each original phase completes. A successful final record has status PASS. Full receiving details, original source IDs, series and observation counts, status distributions, frequency distinctions and retained source identities are in receiving-result.json and native-operation.json.

## Native HTTP and payment behavior

The seller uses public test terms solely to produce its original compiled offer. The acquired data pages use the native buyer's supported free-response execution interface against an actual loopback HTTP endpoint backed by the same original version-store admission and query handlers.

Those pages have native payment status NO_PAYMENT_REQUIRED. The code rejects an unexpected payment challenge or signing request. It preserves that status in SF82 evidence, the SF88 session and the SF100 delivery. This operation exercises the complete source and customer receiving path; paid network settlement is a separate existing buyer workflow.

## Resume and inspect

Keep the same run directory and its original native files. The operator reuses its saved publication run, original plan and SF88 session. It validates the saved source/interpreter/path binding before resuming. A completed operation returns its retained result.

The original session contains absolute paths. Restore an archived operation to its original canonical location before resuming it. Do not repair a binding by editing session.json, a page configuration, an offer hash, source metadata or an original evidence record.

The native publisher owns extraction and publication recovery. If its retained state requires recovery, inspect it through its original APIs before continuing. The operator never makes a second publication run merely to skip an unresolved one.

SF88 recovery reads retained native files. A response/evidence reconciliation failure remains visible in the original session. The original SF88 inspect and recover commands, and DatasetAcquisition.inspect/recover, provide the authoritative state.

## Source semantics received by Vitality

The source_files projection is lossless. The customer receives the complete retained raw sources and dictionaries; it can run the original mappings across their retained history.

The BLS typed observation projections have their own captured selection. Their selected period range does not silently trim the raw source edition sent to the customer importer. The original Vitality mappings choose the relevant geography and measures from that full edition.

The native source envelopes preserve the difference between residence-based LAUS measures and workplace-based QCEW measures. Monthly LAUS observations and M13 annual observations retain their original frequency and period meaning. Suppression, missing values, disclosure fields and source footnotes remain part of the original source and normalized native envelope.

## Cloud execution and retention

Use the existing Commons native command operator for a long cloud run. Inspect the original operation record first and reuse its job identity. Its retained request, stdout log, process identity, capacity declarations and selected artifacts make a dropped execution connection diagnosable.

Budget process memory and tmpfs output together. This data path intentionally retains several native representations: the original plan capture, publication files, acquired pages, data-room exports and customer source bytes. A filesystem with free tmpfs capacity still consumes the same cgroup memory.

The established BLS receiving record declares 640 MiB for processes and 648 MiB of additional tmpfs output, plus the native control-plane reserve. Its declaration is an initial execution budget, not an observed peak. Read the actual retained usage and output sizes before revising it through the original amendment interface.

When the native operator is waiting on capacity, continue the existing job through its maintained status/resume mechanism. A new worker or a second operation ID would separate the original source and effects.

Preserve the completed run directory and its exact file inventory through the existing artifact route. An invocation-private directory needs an in-process save before its environment ends. Keep the original SF88 pages and evidence, reconstructed source files, customer workspace, native result and source bindings together.
