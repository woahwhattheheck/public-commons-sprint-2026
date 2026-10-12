# Original Unstructured document receiving operation

This packet runs the actual pinned self-hosted Partition API through the original StellarForge merchant, browser-approved native buyer and research receiving workspace. It belongs to the existing operation `SCF-UNSTRUCTURED-DOCUMENT-RECEIVING-20261012-B9D2`.

## Selected source

- Application source: `woahwhattheheck/public-commons-sprint-2026@e64c671b9089badd2094277062df85dd911097ed`. The complete checkout includes the Unstructured merchant/customer product and the original SF81 browser approval integration.
- Provider: `Unstructured-IO/unstructured-api@448352104eefd2e5b8fa2dc32282fc1cd3db31ae`, with its original `uv.lock`, core `unstructured==0.22.18` and `unstructured-inference==1.6.11`.
- `native-source.json` pins all 43 selected changed source files. `provider-source.json` pins all 97 original provider files, including the actual input corpus. Each complete file is checked against its Git blob ID before execution.
- The merchant receives actual output from `prepline_general.api.app:app`, `POST /general/v0/general`. Original fixed profiles, multipart validation and processor parameters remain unchanged.

Use one equipped existing Linux host for this original operation. A selected receiver should acknowledge it in `#sim-data`, parent `1791731390.807399`, before launching. Check for the same saved output and coordinator process first; the original output directory is the continuation identity.

## Runtime and source preparation

Use Python 3.12 with the provider's original dependency closure. Its repository's published Dockerfile and frozen `uv.lock` provide the installation and model initialization instructions. The coordinator reads actual installed package versions and retains them with all source hashes in `provider-runtime.json`. It requires the original core and inference versions and keeps the API's default 2 GiB free-memory threshold.

The host also needs the existing Node 22+ native SDK dependency closure, Playwright, Chromium, OpenSSL, and the document tools required by the original provider. Preserve the shared Node dependency directory. The complete private application checkout must already resolve its native SDK imports through that same directory; a new private checkout may use a normal `node_modules` symlink to the existing dependency directory.

The full processing model set and the original memory guard require more than a 2 GiB machine. Keep provider temporary/model caches on the equipped worker. The original Dockerfile's model preparation is available through `--warm-models`; it initializes the same spaCy, layout and table models before opening the native merchant. Existing initialized model caches can be reused.

A public application checkout can be prepared with the normal Git workflow:

```sh
git worktree add --detach /private/unstructured-native/source e64c671b9089badd2094277062df85dd911097ed
git -C /existing/unstructured-api worktree add --detach /private/unstructured-native/provider 448352104eefd2e5b8fa2dc32282fc1cd3db31ae
```

Select actual absolute paths to the existing runtimes in the following command. The packet directory may be separate from the selected source checkout.

```sh
python3 -B /private/unstructured-native/packet/run-native.py \
  --source /private/unstructured-native/source \
  --provider-source /private/unstructured-native/provider \
  --provider-python /existing/unstructured-python/bin/python \
  --python /existing/operator-python/bin/python3 \
  --node /existing/node/bin/node \
  --node-modules /existing/native-sdk/node_modules \
  --playwright /existing/playwright/index.mjs \
  --browser /existing/chromium \
  --temporary-parent /private/native-temporary \
  --output /private/unstructured-native/original-output \
  --warm-models
```

The original output directory is private. The coordinator holds one kernel lease and retains its original operator keys in `private-native-environment.json`. Copy the complete original private directory when preserving or handing off this operation. Keep that private state outside source publication.

## Joined operation

The receiver selects the original corpus and performs these three declared requests:

| Profile | Original file | Original parameters |
|---|---|---|
| fast | layout-parser-paper-fast.pdf | strategy=fast; pdf_infer_table_structure=false |
| auto | embedded-images-tables.pdf | strategy=auto; languages=eng |
| layout-tables | embedded-images-tables.pdf | strategy=hi_res; languages=eng; pdf_infer_table_structure=true |

The original merchant and customer preparation write the saved SF66 session and its exact `document-source.json` inbox binding. The browser reviews each original request body digest, maximum amount and native authorization terms, then approves that same native request through the existing SF81 broker. RPC/Horizon use the retained SDK fixture; signing, verification, settlement, buyer execution, response saving and financial ownership use the original application modules. The provider itself is the running pinned API.

A transparent local capture forwards each complete original multipart request to the API and returns its untouched response bytes. The receiver verifies that those bytes reach the same saved buyer response and that native settlement follows generation. Every request, document and complete response remains retained.

The original research browser creates a research question, reviews the three saved document purchases, retains their editions and downloads their original documents and provider JSON. A real committed receiving reply is dropped; the server then restarts with a fresh token. The still-open browser receives a real 401, signs in through its existing session dialog, and recovers the same decision without another edition. The workflow then saves evidence notes, selection and a finding, exports its HTML report and portable dossier, and reopens the complete dossier in a separate original workspace with the merchant stopped. Desktop and mobile receiving views and every cold-restored document/response are retained.

## Continuation and results

A completed coordinator returns its existing completion when invoked again. After all three purchases are saved, use the same command and directory with `--receive-only` to finish receiving; that path preserves the original private operator keys and the three paid records. If an earlier purchase stage is interrupted, retain the coordinator, native result, original session and logs for the existing buyer recovery before dispatching any further request.

The output contains:

- `coordinator-result.json` and `native-receiving-result.json`;
- `provider-runtime.json`, original server/model logs and the native console log;
- complete `provider-captures/` request and response bytes;
- the original merchant, customer session, inbox and private research workspace;
- all three original buyer envelopes, received and cold-restored document/JSON files;
- `unstructured-document-dossier.json`, `unstructured-document-report.html`, and desktop/mobile images.

Return the actual receiver, process/job identity, source and runtime hashes, current coordinator/native state, complete request/response/result manifests and artifact locations to the same simulation thread. The existing original customer case is `sf49-unstructured-document-workshare`; its relationship sender remains with root B9D2.
