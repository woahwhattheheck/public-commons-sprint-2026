# Forms Workspace — complete Customer Installation handoff

## Purpose and original authorities

The Forms Workspace retains the original captured source, complete editable mapping drafts, every saved revision, and immutable calculated editions. The original Forms and discovery/migration engines own calculation, source custody and project archive verification. The existing Operations case and Customer Installation engine own operating plans, commercial source bindings, acceptance observations, payment and saved installation history.

`forms_installation.py` is the read-only bridge between those existing authorities. It selects one actual completed Workspace run, verifies its entire original project and complete source-bearing ZIP, creates a compact inspectable source selection, and prepares the existing native Installation preview. It does not create an Operations case, execute a tenant migration, save an Installation, issue a payment, mark checks accepted or attach a fictitious priced Workshare.

Keep the same original company case and existing owner. The installed Operations source and any qualified workshare, original customer authorization and actual source/host records remain authoritative. This generic source carries no customer correspondence, credentials or private commercial material.

## Complete source and runtime

The outer workspace software contains the unchanged 33-file Forms product plus its native workspace, authoring server/interface, API and operating guide, native/browser receiving courses, this adapter and this guide: 42 complete files. The original inner Forms project still carries its exact 26-member application selection. These two source inventories have distinct roles. Neither may be replaced by a shortened script list or by only this bridge.

The maintained source boundary used to implement this adapter is:

| Authority | Original complete source |
| --- | --- |
| Forms capture, mapping, calculation, archive | Original public Forms product PR4824, merge b32bbb8ff11067f41203194c6e2aa8fde06e18e9; tools/forms-migration-e258-20261013 |
| Workspace run and request identity | Selected `forms_workspace.py` and `FORMS_WORKSPACE_API.json` in this exact outer source |
| Installation seed, normalize, preview and original save | `stellar/scf_2026/sf47_budget_model/workspace/operations_installations.py`, observed Git blob31e25fb08cbde37c9e82be376a97a74419bd6e5f |
| Optional actual Workshare binding | Same directory `operations_workshare_installations.py`, blobdf8095b020fa51c355a7e32c5d6693a572528b2e |
| Original source attachment and case authority | Original `operations.py`, `Operations.source`, `Operations._snapshot`, `Operations.command` and existing `source.add` action |
| Current ordinary source-desk custody | Same directory `operations_installation_sources.py`, observed blob04e3d8d57817e57fae1a9ce80917e4169f04b083 |

The read-only observed public source commit for these Operations contracts was 528333fd82eb7cc4e63d9e9161fde0a4b3b8cf66. Later additive source may be used only through its actual compatible native contract; preserve the chosen complete implementation and all existing contribution owners.

Use the already-owned Workspace instance. It holds the original exclusive workspace lease, while adapter reads share its existing reentrant mutex. Do not start a second mutating CLI beside that server. Supply the installed original Operations instance through the maintained operator integration. Importing or selecting the adapter itself needs only the same Python runtime as the original workspace. Operations modules are imported lazily when preparing their native preview; use the exact selected Operations source/module path, not copied substitute models.

## Select an actual completed edition

The public read operation is:

```python
selection = forms_installation.inspect_workspace(workspace, run_id)
raw = forms_installation.source_bytes(selection)
```

The caller passes its original owned `Workspace` and the selected native `run_id`. It does not accept a browser-supplied filesystem path. The adapter calls the original Workspace reads for the workspace metadata, verified run, original request, exact historical draft revision and capture. It requires:

1. The native `run.create` request is COMPLETE and its exact retained result equals the selected run.
2. The selected run belongs to this workspace UUID and original completed-request workspace revision.
3. The historical draft's full original UTF-8 bytes hash to the project's identity, and its captured source matches the run.
4. The complete project ZIP has the exact saved byte count and SHA256.
5. Every project file and every selected inner application source is present in the archive with its exact length/hash.
6. The project and opened archive remain unchanged through the entire streamed verification.

An interrupted request is recovered through its original method, parameters and request ID. The bridge does not infer completion from an output directory or mint another request. A selected old run stays selectable after a later legitimate draft or run: its binding uses the actual immutable run and original completion revision, rather than pretending that the entire workspace has remained at its old latest revision.

The returned source has schema `tjlabs.forms-workspace.installation-source.v1`. It contains the full selected-run binding, original capture selection, complete outer software identities, project result/delivery identities, exact inner application inventory, six class states, asset/attachment/finding counts, source-run/migration identities and full project ZIP identity. Availability, declared content state, original coverage and comparison findings retain their distinct meanings.

This small selection is a source-bound description, not a copy of the original dataset. It explicitly says that the complete originals, outputs and program remain in the separately retained project archive. Do not label the JSON as the complete customer handover.

### Stable selected-run binding

`selection.workspace` has schema `tjlabs.forms-workspace.selected-run.v1` and these fields:

- `workspace_id`, `run_id`, `draft_id`, `draft_revision`, `capture_id`;
- `capture_selection_sha256`, `original_request_id`, `original_workspace_revision`;
- `project_identity`, `source_run_identity`;
- `project_archive:{bytes,sha256}`;
- `workspace_source_files`, the complete original outer software identities.

These values come from the retained native records. The bridge does not guess them from a name, current form, file location or a separately supplied browser object.

## Attach the exact selection to the original Operations case

Save the returned UTF-8 `raw` bytes as an ordinary private JSON file or hand them directly to the installed original source action. Use the existing case and `source.add` command with a stable original request ID, actual actor, note, expected case version and source metadata as required by that maintained API.

Retain the native source receipt and actual source ID. The source SHA is SHA256 of the complete exact saved bytes, including their original JSON formatting. After a lost response, reconcile the same native request and source before issuing another write. Attaching a source advances the native case version; read the resulting actual version before preparing an Installation.

No attachment is silently truncated. The bridge's complete selection limit is 8MiB; the current ordinary case source budget is separate. The original Forms project/workspace archives may be much larger and use the original Forms custody rather than the small Operations attachment path. Keep every original file and application body available in the authorized complete handover. If an entire archive is to be attached through another existing native route, its actual declared limits and original authorization govern; this bridge does not raise limits or switch storage destinations.

## Prepare the full original Installation document

```python
prepared = forms_installation.prepare_operations(
    operations,
    case_id,
    {
        "expectedVersion": actual_case_version,
        "sourceId": actual_source_id,
        "expectedSourceSha256": sha256_of_exact_attached_json,
        "installationId": selected_installation_id_or_none,
        "expectedRevision": actual_installation_revision_or_zero,
        # Optional: "document": complete_current_native_working_document
    },
    workspace=workspace,
    run_id=selected_native_run_id,
)
```

This function holds the original Workspace mutex and takes the original Operations snapshot. It independently recomputes the selection, reads the actual attached source bytes and metadata, and requires complete equality. A source with the same filename or a matching count is insufficient.

For a new Installation it uses the original native `seed(context)`. For an existing Installation it reads its actual current revision; if the caller supplies a complete working document, it is normalized by the original native engine. Original native preview still validates current case version, Installation revision, source membership, optional Workshare/commercial/recurring-work/commissioning bindings and their transition rules.

The bridge adds the actual Forms selection to the native source and receiving lists. Existing reference, population and interpretation text are preserved; the exact Forms selection is appended once. An existing LIVE source becomes MIXED when adding this fixed snapshot. Existing MIXED remains MIXED. Existing commercial terms, price, currency, milestone amounts, payment/deployment selection, source authorities and named operators are retained. Empty task/recovery fields receive concrete complete-handover guidance.

Four required OPEN checks join the source:

| Check | Actual operator evidence needed |
| --- | --- |
| Complete selected source and scope | Every selected original, six class dispositions, availability/content states and unexamined assets |
| Original mapping and source interpretation | Exact selected table keys/types/crosswalks/fields and real attachment-parent references |
| Complete native comparison findings | Full comparison and attachment populations, unresolved records and original owner dispositions |
| Independent complete receiving | Actual archive opening, full original source/program verification, rendered output viewing and cold history/request recovery |

Their IDs bind the complete selected source, including its actual ZIP. Repeating the same selection preserves original observations. A later distinct selection gets separate required OPEN checks; prior checks and full history remain. No successful calculation, zero finding count, renderer capture or archive verification automatically marks a human acceptance check ACCEPTED.

The result has schema `tjlabs.forms-workspace.installation-preparation.v1`:

```json
{
  "schema": "tjlabs.forms-workspace.installation-preparation.v1",
  "forms": "complete verified selection",
  "source": "actual native source metadata",
  "nativePreview": "full original source/snapshot/document/report/changes/previewSha256",
  "save": {
    "action": "installation.save",
    "expectedVersion": "actual reviewed native case version",
    "data": {
      "installationId": "selected ID or null",
      "expectedRevision": "actual current revision or zero",
      "document": "complete normalized original Installation document",
      "expectedPreviewSha256": "original native preview identity"
    }
  }
}
```

The displayed schema example uses explanatory strings for values whose actual runtime types are defined by the native API. Pass the returned real object unchanged, not this example.

## Explicit save and original request recovery

Review the complete `nativePreview`, source, differences and every open check. Any later save is the original `Operations.command` with its established actor/requestId/note and the exact `prepared.save` action, expectedVersion and data. Retain that full original request before dispatch. The bridge does not execute it.

A changed native case or Installation revision requires a fresh preview from the original latest state. An uncertain write uses the original request/result reconciliation, not a new ID that might duplicate the Installation. An actual completed save and its observed edition—not this preparation object—are the evidence of persistence.

An unpriced project retains the native unbound commercial draft. Do not invent a zero fee, currency, paid hours, payment trigger or accepted Workshare to make a priced intake pass. If an actual priced workshare already exists, the original Workshare source and native `verify_document` remain authoritative. Keep delivery preparation, real acceptance, invoice and cash receipt as distinct records.

## Complete export, recipient opening and later editions

Use `Workspace.export` on the same owned workspace after its original pending requests are reconciled. Preserve the complete outer archive receipt, actual byte length/hash, all captures, raw drafts and revisions, native request histories, computed projects, project ZIPs, independently received projects and exact 42-file software. Use the original `receive_workspace` into a new private recipient directory, then operate its actually received software against that same workspace identity.

Separately use the original Operations whole-case export/receive to preserve the selected source attachment, full Installation editions, original commercial sources and actual command history. Neither export is a substitute for the other: one retains the complete Forms data/working history, and one retains the operating case and its observations. The selected-run JSON links the original immutable project and workspace to the Installation. The whole-workspace archive receipt is maintained in the actual handover, not invented or self-referenced inside an archive being built.

Recipient steps are concrete:

1. Receive the exact full Forms workspace and project archives and the complete Operations case through their original supported routes.
2. Verify all original members and source; confirm the Installation selection names the actual workspace/run/draft/capture, project and full project ZIP.
3. Open the selected original report and full source/target findings; navigate all paged populations and download the complete streams.
4. Reopen a historical raw mapping draft and the actual selected native request. Then create a deliberately named later draft or explicitly rebind a later complete capture using the original Workspace API.
5. Run the unchanged native engines for that new edition and preserve the prior immutable run.
6. Prepare a new native Installation preview from that new exact selection, keeping earlier checks/history and leaving new decisions OPEN until actual review.
7. Reopen downloaded files through their applications and review the complete recipient archive independently.

OPEN, LOOK at and USE every outgoing file, attachment and rendered interface. Personally inspect actual desktop and narrow-width images and every PDF page. A successful source review, a screenshot path or another worker's message does not replace actual viewing. Preserve original customer/issuer scope and each existing sender's exact approval rule; this generic adapter authorizes no correspondence, provider call, form publication, live historical import, workflow replay or production transition.

## Practical limits

The original inner project archive receiver defaults to a complete expanded 20GiB limit; this adapter uses that same declared contract. It streams all archive members for verification. The selection metadata limit is 8MiB and the native Installation document is subject to its existing 128KiB limit. Full outer software and original project source identities are retained; no file is silently omitted to fit a compact attachment.

Existing check limits and source/text limits remain native. If a long history reaches a declared native limit, retain the full original case and use an explicitly reviewed supported native continuation. Do not discard earlier acceptance evidence, overwrite another case or silently waive the original source rule.
