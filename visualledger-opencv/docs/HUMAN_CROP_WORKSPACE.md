# VisualLedger human-crop workspace

The existing vision agent can request `REQUEST_HUMAN_CROP`. This local workspace
completes that step: the operator chooses a rectangle, the original pixels remain
intact, and the **unchanged canonical vision policy** runs on the selected region.
It adds no second vision engine and does not change the static review or AWS path.

## Start locally

From `visualledger-opencv`, use the existing project dependencies:

```sh
python -m visualledger.workspace --port 8769
```

Open the loopback address printed by the command. On a development-only OpenCV 4
host, explicitly use `--allow-opencv4-dev`. The page and both traces retain the
actual runtime version and compatibility flag. This does not establish OpenCV 5
execution or an AWS deployment. Installed-package entry points are
`visualledger-workspace` and `visualledger-crop-replay`.

The server binds **127.0.0.1 only**. It is a single-user local tool, not a hosted
customer service. It checks the Host and browser Origin, uses a per-process
same-origin request token, sends no CORS allowance, and reads only fixed bundled
UI assets. It makes no outbound requests. Concurrent processing returns 429
rather than running parallel image jobs; static assets remain responsive.

## Complete the crop workflow

1. Load the two-document synthetic example, or select an authorized image.
   Optional prior fingerprints must be selected **before loading the image**;
   reload the image after changing that file. The UI reports the exact count
   applied. No file means `[]`, not a searched or verified duplicate history.
2. Inspect the original action and measurements. Only `REQUEST_HUMAN_CROP`
   allows a crop. A recapture or duplicate-review route cannot be bypassed by
   cropping in this tool.
3. Drag a rectangle or enter the four pixel edges using the keyboard. Include
   the complete document and a small surrounding border. Add a reason and
   confirm the selection. For the bundled two-document fixture, use
   `left=40, top=90, right=800, bottom=1140` to select the left document.
4. Apply the crop. OpenCV decodes the original bytes and copies exactly that
   rectangle to a PNG without resizing, enhancement or padding. The source
   trace is replayed first. The child uses the same policy and exact supplied
   prior fingerprint context, with a distinct deterministic evidence ID.
5. Review the newly computed action and export the evidence ZIP. Export replays
   the source/crop relationship again before returning the archive.

Coordinates use the image as decoded by OpenCV, including its image-orientation
handling: the top-left pixel is `(0,0)`, and right/bottom edges are exclusive.
The PNG preview is re-encoded and resized for display; the browser maps its
coordinates to the original width/height. The actual crop is never cut from
that lower-resolution preview or the perspective-normalized image.

All edges must be integers inside the source. The crop must satisfy the
original policy's minimum dimensions. No clipping, hidden padding, silent
policy relaxation, or forced passing action occurs. A new source invalidates
old case IDs; a changed crop invalidates the export receipt.

## Portable evidence and offline review

The ZIP contains only these fixed members:

- `source.img` and `source.trace.json`: unchanged original bytes and canonical trace;
- `crop.png` and `crop.trace.json`: selected pixels and canonical child trace;
- `crop.receipt.json`: source/child hashes, rectangle, human reason, route transition;
- `prior_fingerprints.json`: the exact context used for both analyses;
- `manifest.json`: compatible with the existing static offline review exporter.

Replay a received ZIP directly, without extracting paths:

```sh
python -m visualledger.crop visualledger-crop-evidence.zip --allow-opencv4-dev
```

Omit the development switch on the final OpenCV 5 runtime. A successful command
returns `REPLAY_MATCHED` and a receipt hash. Failure returns exit code 2. The
reader bounds archive and member sizes and rejects unexpected/duplicate members.
JSON inputs reject repeated keys and nonfinite numeric values.

After extracting a locally generated archive into an empty private directory,
the existing static review command accepts `manifest.json`. That path still
replays both canonical traces and preserves all its original restrictions.

## What this does not prove

A human confirmation is a recorded operator assertion, **not** identity
verification or evidence that every line of a document was included. The hashes
and deterministic replays are integrity checks, not signatures or authentication
of the original issuer, prior index, or AWS retained-record HMAC.

`REQUEST_FIELD_EXTRACTION` still requires human verification. The workspace does
not perform OCR or approve/reject invoices or expenses. It cannot post accounting,
move funds, contact an external party, make tax/legal conclusions, or recognize
revenue. **Needs expert review.**

Images and exports may contain sensitive information. No customer document is
suitable for a public demo without explicit authorization. The server keeps one
case in memory and forgets it when stopped; downloaded exports persist on the
operator's machine. This is not secure memory erasure. Do not expose the service
through a public host or tunnel. Image decoding inherits the canonical engine's
20 MiB/24-million-pixel bounds and pre-decode limitations; isolate untrusted image
processing in a resource-limited environment.

## Focused verification

```sh
python -m unittest discover -s tests -p test_crop_workspace.py -v
node --check visualledger/workspace.js
```

Three focused tests cover the genuine synthetic route transition, unchanged
policy/authority/source bytes, archive replay, invalid geometry/provenance/context,
recapture preservation, and real HTTP load/crop/export/stale-case/origin behavior.
They establish local software behavior, not real-world document accuracy.

The implementation runtime used Python 3.13.5, NumPy 2.3.5 and OpenCV 4.13.0 with
explicit development compatibility. A Chromium capture attempt in that runner
returned `net::ERR_BLOCKED_BY_ADMINISTRATOR` for loopback navigation. No administrator
policy was changed. Browser interaction, a judge-facing video, OpenCV 5 execution,
AWS deployment, official submission and prizes are **not established** by that run.
