# Receive the complete Research RIS delivery

The package carries the complete Research engine, the original RIS input carrier, the saved operation, its customer reports and editable portable exports. Use the original native result and delivery manifest to locate each exact output. Use the supplied full source when reopening the dossier or running a new receiving operation.

## Locate the complete work

| Path | Contents |
| --- | --- |
| `run/RIS_NATIVE_COMPLETE.json` | Original operation, workspace, dossier, question, baseline and reviewed receipts, final revisions, browser/Merchant/cold receiving results and explicit file selection. |
| `run/original-inputs/` | Retained provider carrier and all three original RIS input entries selected by the native operation. |
| `run/native/` | Complete native reports and exports at the selected dossier revisions. |
| `run/browser/` | Complete browser draft/source/edition/report/comparison artifacts and the original journey record. |
| `run/merchant/` | Original Merchant operation receipts, replay/history observations and full exported files. |
| `run/cold/` | Fresh-process receiving reports and the continued editable portable. |
| `engine-source/` | Every file in the selected engine manifest, in the original repository layout, including licenses, Python components and browser assets. |
| `operation/ENGINE_SOURCE_MANIFEST.json` | Exact original source selection, file byte counts, SHA256 values, original modes and available source authority. |
| `operation/ORIGINAL_PROVIDER_RESPONSES.json` | Exact complete retained provider response carrier. |
| `operation/ORIGINAL_SELECTION.json` | The original operation's source/runtime/directory selection. |
| `RECEIVING_SELECTION.example.json` | Editable absolute-path selection for a new receiving operation. |
| `DELIVERY_MANIFEST.json` | Complete package membership, file hashes, installation modes and exact entrypoint paths. |

The native result's `files` array gives the precise filenames for this particular operation. Its `beforeRevision`, `reviewedRevision` and `currentRevision` identify the actual saved points in the original dossier. The cold receiving result records the separately reopened copies and their continued portable export.

## Read back the package

Use the delivered packager's standard-library verification command:

~~~sh
python3 "/ABSOLUTE/EXTRACTED/engine-source/PATH/TO/research-dossiers/ris-source/package.py" \
  --verify "/ABSOLUTE/Research_RIS_Operations_20261012.zip"
~~~

The command streams every member, checks its complete byte count and SHA256, checks the regular file mode and exact membership, and prints the package's own byte count and SHA256. Compare that package identity with the delivery receipt. The exact source manifest and operation result are retained as package members.

The ZIP preserves the source's original regular file modes separately from the private filesystem permissions used during the native operation. Use the complete `engine-source` directory when installing; the relative imports depend on that layout.

## Open the delivered editable dossier

Start the supplied Research server in a new private receiving directory as described in the operating guide. Keep that listener running. Select the desired original JSON or gzip portable from `run/RIS_NATIVE_COMPLETE.json` and its exact SHA256 from the corresponding native file row or delivery manifest.

~~~sh
"$RIS_NODE" "$RIS_ROOT/workspace-cli.mjs" reopen \
  --connection-file "$RIS_CONNECTION" --directory "$RIS_STORE" \
  --source-file "/ABSOLUTE/EXTRACTED/run/PATH/TO/selected-portable.json.gz" \
  --sha256 "$RIS_PORTABLE_SHA256"
~~~

Use the dossier identity returned by this reopen. Open it in the running Research browser and inspect its RIS sources, original records, review decisions and edition comparison. The supplied continued portable is the editable result of the cold receiving phase; the original historical exports remain separately available.

To export a later receiving edit from this listener:

~~~sh
"$RIS_NODE" "$RIS_ROOT/workspace-cli.mjs" export \
  --connection-file "$RIS_CONNECTION" --directory "$RIS_STORE" \
  --id "$RIS_RECEIVED_DOSSIER" --format json.gz \
  --out "$RIS_PRIVATE/continued-receiving-dossier.json.gz"
~~~

A receiving installation uses its own private connection file and browser profile. The portable export carries the selected dossier content and its retained RIS history.

## Run the complete receiving programme

The full programme uses the original Research server, the complete browser UI and the installed Merchant adapter. It then closes the original listener and starts the fresh Node receiving child. Prepare the installed runtimes before starting it: Node 24 or later, Python 3, an absolute path to the installed Playwright JavaScript module, and the corresponding Chromium executable.

Copy `RECEIVING_SELECTION.example.json` to a private selection file. Replace every absolute-path placeholder with the actual installed location. Keep the exact provider-response and engine-manifest byte counts and SHA256 values from the example. Choose a new operation ID and a new owned private run directory for this new receiving operation. Preserve the original selection and IDs when continuing the original operation.

~~~sh
"$RIS_NODE" "$RIS_ROOT/ris-source/native.mjs" \
  --selection "/ABSOLUTE/PRIVATE/RIS_SELECTION.json"
~~~

The programme's completed result is `RIS_NATIVE_COMPLETE.json` in the selected run directory. It includes the saved baseline and reviewed receipts, all three relevant revisions, the exact source/runtime selection, browser operations, Merchant exports and fresh-process receiving results. Its explicit file rows select the complete customer handover.

The browser phase reviews the original retained files, saves and reloads a complete draft, uses the complete recovery-file route, receives a real concurrent-revision rejection, rebases the same reviewed request, and recovers a saved receipt after the browser's response is lost. Its customer artifacts include both editions' full source and reports plus complete before/after comparisons.

The fresh Node receiving phase operates the supplied JSON and gzip portables, retains the full receiving reports and produces a further editable portable. Read the `cold` result for this operation's exact receive/continue and changed-input outcomes.

## Preserve the original input provenance

The supplied source carrier is the complete retained 6,578-byte JSON response packet with SHA256:

`a468739354d5b543712b583226f934dc63bbba29769d2c327df4c54876174413`

It contains the original retrieval information and full response bytes for these source documents:

| Original file | Bytes | SHA256 |
| --- | ---: | --- |
| `crossref-gkad1085.ris` | 818 | `303a2af8a2c0ebf550e31642d4e9705bce08eb0037e4b62f0a59219ad1a75a71` |
| `crossref-gkad1088.ris` | 803 | `0b23b1517129ae3261ec222f78a83f2abce1412eb8464c3ee8680350d51841cc` |
| `crossref-gkad1085-local-copy.ris` | 818 | `303a2af8a2c0ebf550e31642d4e9705bce08eb0037e4b62f0a59219ad1a75a71` |

The third entry is labelled as a byte-identical local copy of the first source. Both original provider responses were HTTP 200 retrievals retained on 2026-10-12. Their original URLs are:

- https://api.crossref.org/works/10.1093/nar/gkad1085/transform/application/x-research-info-systems
- https://api.crossref.org/works/10.1093/nar/gkad1088/transform/application/x-research-info-systems

The native programme reads the retained carrier and original response bytes. The later review operates those same files and preserves the explicit duplicate relationship.

## Package the complete completed operation

After the original programme has written its complete result, create the full ZIP from the same selection:

~~~sh
python3 "$RIS_ROOT/ris-source/package.py" \
  --selection "/ABSOLUTE/PRIVATE/RIS_SELECTION.json" \
  --output "/ABSOLUTE/PRIVATE/Research_RIS_Operations_20261012.zip"
~~~

The packager reads every complete selected native file and every complete engine source file. It also includes the exact native result, source manifest, original selection, provider carrier, both guides and a receiving selection example. It verifies the finished ZIP before publishing it and returns its full byte count, SHA256 and entry count.

If the same selected ZIP already exists, the command reads back its complete membership and reuses it. If the destination belongs to another selection, choose the correct original destination for that operation. Archive publication leaves the original files addressable by their saved identities.

The native operation's private working stores, browser profile and inspection images remain in its private working directory. The editable receiving outputs are delivered as the explicitly selected complete portables.

## Resume an interrupted operation

Retain the original selection, operation ID, run directory, saved request IDs and full request bodies. Read the original native and browser records before continuing. If the native result is already complete, proceed to the package command for that completed result. If a browser receiving response was lost, the original pending request and receipt lookup recover the saved operation.

A dossier revision conflict requires review of the actual current revision before rebasing the same request. The source bytes, review and request ID stay bound to that operation. Keep the completed package and its actual transfer receipt with the customer delivery so another operator can reopen the same work.

The source implementations for these steps are `ris-source/native.mjs`, `reopen.mjs`, `browser-journey.mjs`, `package.py`, the existing Research workspace client/CLI/server, and the complete engine source manifest.
