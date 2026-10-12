# Complete Human Services Directory receiving

The receiving programme carries a completed original Gravity workspace into the directory product, operates the complete directory workflow, receives the editable handoff, then exercises the browser, connected Merchant and installed Applications surfaces using that same directory identity.

## Original inputs

Use the original files from the completed native Gravity programme:

- `OPERATED_GRAVITY_REFERRAL.json`, containing the completed original native record IDs and selected source.
- The corresponding complete editable Gravity workspace ZIP.
- The original HL7 HSD examples archive when supplying a previously retained publisher download.

Keep each file whole and preserve its byte identity. The published source bundle and native catalogues included in this product identify the source versions used by the programme. The native directory result records its own original inputs and the concrete directory record IDs for the remaining surfaces.

## Native directory programme

```sh
python3 stellar/scf-starforge-20261009/sf30-seller-sdk/fhir_directory/operate_receiving.py \
  --workspace /absolute/private/directory-workspace \
  --output /absolute/private/directory-native \
  --gravity-receiving /absolute/original/OPERATED_GRAVITY_REFERRAL.json \
  --gravity-workspace /absolute/original/Gravity_Complete_Editable_Workspace.zip \
  --hsd-examples /absolute/original/HSD_STU1_Original_JSON_Examples.zip
```

The native driver accepts `--workspace`, `--output`, `--gravity-receiving` and `--gravity-workspace`; `--hsd-examples` selects the existing full publisher examples archive. Its result is `OPERATED_HUMAN_SERVICES_DIRECTORY.json`. That result becomes the original receiving input for the remaining drivers.

The directory operation retains the original Gravity UUID and explicit clinical bindings while producing directory sources, reviewed editions and mappings, service selections, joins and complete receiving. Its connected input section contains every selected original source file and exact accepted replay input. Follow the completed result's original paths and identities when resuming.

## Browser programme

```sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/fhir_directory/operate_browser.mjs \
  --receiving /absolute/private/directory-native/OPERATED_HUMAN_SERVICES_DIRECTORY.json \
  --workspace /absolute/private/directory-workspace \
  --output /absolute/private/directory-browser \
  --playwright /absolute/playwright/index.mjs \
  --chromium /absolute/chromium
```

Omit `--workspace` to use the original native receiving path. Supply it only when the complete original workspace has been received at another explicit location. The browser helper validates the original receiving JSON and workspace identity, follows complete saved record collections, operates the directory UI, retains browser observations and receives the full workspace packet.

The same helpers are used by the installed Applications driver: `originalDirectoryReceiving`, `originalDirectoryState`, `directoryBrowserReady` and `operateDirectoryBrowser`. The helper's complete-state read follows only declared remaining pages, keeping full original record arrays available for reopening comparisons.

## Connected Merchant programme

```sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/fhir_directory/connected/RECEIVING.mjs \
  --receiving /absolute/private/directory-native/OPERATED_HUMAN_SERVICES_DIRECTORY.json \
  --workspace /absolute/private/directory-workspace \
  --out /absolute/private/directory-connected
```

Optional `--credentials-file ABS` selects the existing private native authentication profiles. If the retained original source files moved, create a JSON object mapping their existing native source keys to the new absolute file paths and pass `--source-files ABS_JSON`. The programme verifies the original lengths and hashes at those paths before use.

The connected programme performs the complete operation through the maintained Merchant host:

1. Open or borrow the original native directory operator and record its actual instance.
2. Initialize the normal Merchant configuration and inspect the complete installed tool catalogue.
3. Save every original import profile and stream each selected original file through its content endpoint.
4. Replay the exact retained mapping, preview, apply, selection, join, handoff, receiving and export inputs.
5. Follow all source, edition, relationship-target, comparison, mapping-preview and candidate pages.
6. Download complete original sources, source-record JSON, indices, comparison JSONL, retained captures, handoffs and the latest full workspace.
7. Receive the complete handoff and workspace into separate receiving destinations and compare their original saved record IDs.
8. Reopen the Merchant connection while retaining the same original native operator, then reopen and verify the retained downloads.

It writes `OPERATED_CONNECTED_HUMAN_SERVICES_DIRECTORY.json`, `CONNECTED_JOURNEY.json`, complete per-call original responses, manifests and full downloaded files. Each returned operation descriptor is checkpointed before validation. Continue with the same output directory, original receiving JSON and source selections after an interruption.

## Installed Applications programme

Build and install the complete `human-services-directory` selection using [OPERATING.md](OPERATING.md). Once the original runtime inspect result is ready, run:

```sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/fhir_directory/operate_installed_applications.mjs \
  --runtime-directory /absolute/directory-runtime \
  --runtime-workspace /absolute/private/runtime-workspace \
  --receiving /absolute/private/directory-native/OPERATED_HUMAN_SERVICES_DIRECTORY.json \
  --workspace /absolute/private/directory-workspace \
  --out /absolute/private/directory-applications \
  --playwright /absolute/playwright/index.mjs \
  --chromium /absolute/chromium
```

The installed programme saves and starts the application in the actual runtime workspace UI, runs the complete directory browser journey, retains its full workspace download, stops the application, reopens the runtime host and starts the same saved application again. It verifies all original directory, Gravity and inherited record families through complete state reads. [APPLICATIONS.md](../../stellar/scf-starforge-20261009/sf30-seller-sdk/fhir_directory/APPLICATIONS.md) lists the optional launch inputs.

## Customer receiving from a complete archive

An operator can receive the selected full workspace directly:

```sh
starforge human-services-directory init --workspace /absolute/private/received-directory

starforge human-services-directory receive-workspace \
  --workspace /absolute/private/received-directory \
  --file /absolute/original/Human_Services_Directory_Editable_Workspace.zip

starforge human-services-directory serve \
  --workspace /absolute/private/received-directory --host 127.0.0.1 --port 0
```

For a selected handoff, use `receive-handoff` with its complete original archive. The native receiver records the archive SHA-256, original workspace UUID, handoff identity and reconstruction result. Inspect the saved original records and record the receiving disposition. The received workspace supports continuing the original editable work.

## Deliver the complete result

Keep the completed native receiving JSON, browser and installed application results, connected receiving result, original input index, full workspace ZIP, full handoff ZIP and complete files selected for the recipient. Their paths and byte identities remain in the corresponding receiving outputs. Use the repository's original product source commit and installed runtime transfer with the deliverable.

Native archives support 2 GiB; the connected transport keeps its inherited 512 MiB maximum. Choose native complete-file receiving for a larger original archive. Source, index and comparison downloads remain whole files, while interactive views are traversed with their returned page offsets.
