# Join the complete Nord sources to the existing BDNB receiving programme

`prepare_receiving.py` turns the original Nord acquisition's complete file identities and explicit edition interpretations into the maintained `bdnb.import` descriptors. It can also bind those imports into the original producer/customer/return receiving input. The existing Analysis importer, action APIs and ten-stage programme execute the resulting input.

The original case is [DSCEB3 / 2769](https://tokenjunkielabs.slack.com/archives/C0BTTA66TK3/p1791871336425939). Acquisition retains operation `BDNB-NORD-SOURCES-2769-20261013`; the original receiving and Analysis operation IDs remain those selected by 2769. Keep the same receiving owner and full source root when advancing this case.

## Required originals

First receive the complete source operation described in [ACQUISITION.md](ACQUISITION.md). Select its actual `complete.json` with state `COMPLETE_SOURCE_RECEIVING`, both whole departmental archives, both original dictionaries, publisher metadata, all extracted tables and all profile/inventory sidecars. A complete root may move to the accepting host: relative file members resolve against the selected manifest's current parent, and the original recorded root remains unchanged in custody.

Keep both whole archives. Their publisher assertions are 1,069,529,107 bytes / `c7f494a200bdfcccdabbe8b2d1c40eb1b40b1ecf4f9e454035c7f2782c805ebc` and 1,115,251,835 bytes / `ba1f110df1d8c70eb8412cd0eae483b86634dc0393a8a05cf2ebccbd52017520`. This join streams whole-file hashes and the actual CSV rows; memory usage does not grow with the archives. Reserve ordinary disk for the 2,184,780,942 compressed bytes, all selected CSVs and the resulting workspaces.

Select the complete application checkout and its full current source roster. The original 150-file feature source carrier is Commons Git `e8d48c1cdc89f11b6473f16ea2b31589490a70ff`, 2,772,612 UTF-8 bytes / SHA-256 `96ad309ed6a0ba563eb091fff382bc91a29d64ac306500657a6c7428a365d6e4`, merged originally at canonical `346b79faa5bf8bf4a71c1d6be19a1463c359399b`. The feature carrier accompanies the complete canonical application checkout; it does not contain every existing Analysis support module. Keep that base checkout and include its actual loaded local dependencies (including existing dataset, research, synthesis, lineage, native delivery and archive support) in the complete selected roster. Include this join's complete current source in the selected roster. Preserve later adopted product source rather than restoring an older carrier over it.

## Exact input contract

Create a complete JSON input with schema `commons.bdnb-acquisition-receiving-join.v1/input`. Duplicate JSON keys and non-finite values are rejected. All file paths are canonical absolute paths; selected files must be regular original files.

| Field | Value |
| --- | --- |
| `schema` | `commons.bdnb-acquisition-receiving-join.v1/input` |
| `acquisition_complete` | Absolute path to the completed original acquisition's `complete.json` |
| `checkout` | Absolute complete selected application root |
| `source_files` | Full list of `{path, bytes, sha256}`, with paths relative to checkout |
| `editions` | Exactly the two edition bindings described below |
| `receiving` | The existing complete receiving input, omitting only checkout/source_files, or JSON `null` while preparing import descriptors |

Each edition binding is exactly `{directory, request_id, edition_id, dictionary, table_semantics}`. Directories are `2025-07-a` and `2026-02-a`, bound to the original `2025-07.a / v0.7.10` and `2026-02.a / v0.7.11` selections. Import request IDs and edition IDs are the retained 32-character lowercase hexadecimal IDs. Each edition ID is unique across the selected editions and each request ID across the original action course; an edition may retain an ID equal to its own import request ID.

### Edition dictionary

`dictionary` is exactly:

| Field | Value |
| --- | --- |
| `path` | Absolute path to the complete normalized dictionary JSON |
| `bytes`, `sha256` | Whole normalized file identity |
| `workbook_sha256` | Whole original matching XLSX identity from this edition's completed acquisition |
| `provenance` | Full nonempty object retaining original workbook/source references and the actual mapping decisions |

The normalized JSON uses `stellar-forge.bdnb-dictionary.v1`, as consumed by the existing `bdnb_source.source_dictionary` API. Retain all five table definitions, original primary keys, full field descriptions and constraints, correct publisher structure/version and original source URLs. A table can be absent from the actual departmental archive while remaining defined by the publisher dictionary.

The complete original workbook representation is in each edition's `dictionary-members.json`: original workbook identity, all workbook members, every worksheet, original row and cell references, values, cell types and formula text. Retained XML remains beside it. Use those complete originals when preparing the edition-specific normalized dictionary. Keep the original workbook and normalized mapping as separate complete files, bound by the workbook hash and mapping provenance.

The bundled default dictionary describes v0.7.11. Its label cannot establish v0.7.10 semantics. The source owner derives the predecessor mapping from its actual original workbook; the join then runs the original dictionary validator against that edition's structure, fields and keys. The exact index, inventory and profile identities must also match their original complete acquisition saving/retention receipts. Whole XLSX identity, matching full index, normalized file identity and mapping provenance are retained in the resulting source custody.

### Table semantics

`table_semantics` maps each actual selected table name to exactly `{null_values, geometry_encoding, extra_fields, provenance}`.

- `null_values` is the original explicitly selected list of null spellings. Empty text has its original meaning unless that mapping explicitly selects it as null.
- `geometry_encoding` is one of the existing importer values: `wkt`, `ewkb-hex`, `geojson-text` or `opaque`.
- `extra_fields` uses the existing complete field shape `{name, type, nullable, description, unit}`. Preserve actual unknown columns and explicitly authored types.
- `provenance` retains the original dictionary cells/source references and interpretation decisions. It must be a nonempty object.

Select semantics for every actual extracted table; absent optional tables remain explicit in the original inventory. The original importer preserves raw cell strings alongside typed projections and findings.

The acquisition parses the publisher CSV using its observed dialect; the existing importer accepts a delimiter with the standard CSV quote behavior. The join streams both parsers over every original row and requires identical complete cell arrays. It also matches the original header, dialect fields, record count and stable file identity. This admits harmless dialect differences only when all actual cells remain identical. A mismatch reports the actual record and file, leaving its original bytes and profiles intact for an explicit source-format correction.

## Bind the existing complete receiving input

The `receiving` object follows [RECEIVING.md](RECEIVING.md), with only `checkout` and `source_files` omitted because the join binds those once. Keep its original `operation_id`, `analysis_operation_id`, Node command, three workspace paths, output path, publication/pack/receive IDs and complete producer/customer action lists.

For each of the two selected imports, retain exactly the original action `request_id`, `action: "bdnb.import"` and `body: {edition_id}`. The join replaces that import body with the complete verified descriptor. Each selected import appears once across the original action lists. All other action bodies remain unchanged.

The joined input then passes through the maintained `bdnb_receiving.validate_input` API: exact schema/source identities, disjoint workspace paths, unique original requests, comparison, real authored customer review, and the selected final publications/packs. Customer review item IDs, evidence hashes and decisions come from the actual comparison and original domain operation.

When those later course decisions are still being produced, use `receiving: null` to receive the complete descriptors and import actions now. Feed them to the existing action/workflow interface with the original request IDs. Once the original complete course is available, prepare a successor input in its own output directory with the same source selections and full actual receiving plan; existing importer/action replay reconciles those original requests.

## Execute on the original receiving host

Use the complete selected checkout's Python 3.10+ environment and the original Analysis/native dependency closure. The new source is invoked from that same checkout. Set the shell variables below to the actual retained local paths before running the command.

~~~sh
python3 "$BDNB_CHECKOUT/products/ntico/bdnb-territory/prepare_receiving.py" \
  --input "$BDNB_JOIN_INPUT" \
  --output "$BDNB_JOIN_OUTPUT"
~~~

The join verifies the selected executable/source roster, original acquisition, entire archives/dictionaries/tables, profile/index binding and selected source semantics before publishing output. It reuses the original source module's create-only durable publication function. Existing equal outputs are adopted; a changed input or output receives its own directory. Interrupted writes resume by re-running the same command and exact input.

The complete outputs are:

| File | Contents |
| --- | --- |
| `join-input.json` | Full selected preparation input |
| `descriptors.json` | Both complete validated edition descriptors |
| `import-actions.json` | Both complete original import requests |
| `receiving-input.json` | Full original ten-stage input when supplied |
| `source-custody.json` | Complete input/source/archive/workbook/table/provenance binding and all verified file identities |

`source-custody.json` is published last, after the selected descriptors/actions and optional receiving input. The command emits `COMPLETE_INPUT_PREPARATION` and exact output identities. Carry this entire output directory with the source root and dictionaries through the accepting host's existing durable artifact route.

When the complete receiving input was selected, execute its existing entry:

~~~sh
python3 "$BDNB_CHECKOUT/products/ntico/bdnb-territory/receiving.py" \
  --input "$BDNB_JOIN_OUTPUT/receiving-input.json"
~~~

Use the original receiving guide's retained `--resume` handling for an existing journal. That programme owns producer imports/comparison, full native reports/workbooks/annexes, complete customer archive receiving, authored customer continuation, returned archive, independent receiving and original request replay. Retain its native result and the actual rendered outputs in the original case.

# Rendered product inspection policy

## Standing lab rule: inspect the rendered product before presenting it

Bryce's direct owner instruction, October 13, 2026. This applies to every current and future lab peer, provider, model, harness, local session, cloud session, and delegated or child worker.

Before calling a client/prospect-facing app, site, dashboard, demo, report, presentation, or export ready, or putting it before a client/prospect, the responsible producing peer MUST open/run/render the exact outgoing version and visually LOOK at the actual result. Inspect at the actual screenshare/presentation width and at narrow/mobile widths where relevant. Operate critical controls; inspect applicable loaded, empty, loading, and error states; exercise downloads/exports and reopen the delivered files. Capture real screenshots or rendered page images and actually VIEW them. Capturing without viewing does not satisfy this rule.

This includes ALL attachments. Literally observe the actual thing the way a user or recipient would see and use it: open and view downloaded HTML, every relevant PDF/report page, slides, spreadsheets, maps, images, video/audio, archives and project attachments in their normal recipient-facing viewer or application; play audiovisual media and inspect the usable contents of archives/projects. Metadata, schemas, source text, and a browser link do not substitute for opening the attachment and using the delivered result normally.

Fix ugly, cramped, broken, unstyled, clipped, overflowing, or unreadable results within the authorized task before presenting them. Favor simple industrial/plain presentation, consistent spacing and typography, readable tables, and working controls. Do not add decorative template slop. Source review, unit tests, HTTP 200, DOM counts, a reviewer/model approval, or an evidence form do not substitute for looking at and operating the real outgoing product.

This is focused internal product validation, never permission to build or submit a proof, test, or verification product, run broad suites, or repeatedly recheck an unchanged accepted version. Building and integrating the actual deliverable remains the main work; do not substitute endless reviews for delivery. Retain an exact-version visual receipt in the handoff: source/head or artifact hash, URL/file, viewport sizes, screenshots actually viewed, controls/states/export files exercised, fixes, and any precise unresolved gap. A changed outgoing version needs inspection of the affected result.

Bryce explicitly clarified: "that includes all attachments and this does not become review theatre or test theatre you need to literally observe the actual thing the way a user would see and use it". A checklist, screenshot folder, receipt, passing test, or parallel review bureaucracy is not the requirement or a substitute for actual observation and normal use. Perform focused fixes and keep shipping the main work; create no review or approval gate.

Bryce also instructed: "also add that if u make a video use voice gen tts not robot voices, use generative stuff we have models, use them". For video/media narration, use available high-quality generative voice/TTS and applicable generative visual/media capabilities when helpful, with natural professional delivery instead of robotic default voices. Actually play/listen/watch the final exported attachment and inspect clarity, pronunciation, pacing, timing, and audio alignment. Reviewing a text script does not substitute for experiencing the final video/audio. This adds no paid-service purchase or real-person voice-cloning authorization; preserve lab attribution and third-party copyright/license controls.

Pass this rule to child/delegated workers and persist it in owner-controlled provider/project/cloud instruction copies. Record delivery and readback coverage; never claim every running session loaded it without evidence. This rule creates no hooks, watchers, restarts, approval queue, credential restrictions, or new publication authority. Preserve all existing owner rules, including no llama.cpp, no private GitHub repositories or Actions, focused validation, attribution, incident communication, personal meeting approval, contact holds, demo pauses, bounty restrictions, and owner cutoffs.

Canonical local policy: `C:/Users/lucys/.commons/rendered-product-inspection-policy.md` and `.json`. Portable repository copy: `docs/policies/rendered-product-inspection-policy.md` and `.json` when present. Only Bryce can change this standing rule.
