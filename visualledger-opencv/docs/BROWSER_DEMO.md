# Repeatable synthetic browser demonstration

`tools/capture_workspace_demo.py` drives the real local workspace in a fresh
Playwright Chromium context. It starts the existing server on an ephemeral
loopback port, uses only the existing synthetic fixtures, and records:

- actual pointer selection on the resized canvas, checked against original-pixel edges;
- exact keyboard-edge entry, human reason/confirmation and canonical crop re-evaluation;
- browser ZIP download and independent canonical replay in a separate Python process;
- blurred-input recapture with crop and stale export disabled.

The browser context rejects page requests outside the local server origin. The
script checks JavaScript errors, nonempty screenshots/video/ZIP and the replay
result before writing a `status: PASS` receipt. Failed runs may retain partial
artifacts for debugging; a video file alone is not acceptance. Output directories
must be empty to prevent a stale successful receipt from surviving a later failure.

## Run

From the package root in a browser-permitted environment:

```sh
python -m pip install -r tools/browser-requirements.txt
python -m playwright install --with-deps chromium
python tools/capture_workspace_demo.py --out /path/to/new-empty-demo --allow-opencv4-dev
```

The pinned browser requirements intentionally use OpenCV 4 development
compatibility. This does not relax the project's production OpenCV 5 dependency.
On a separately installed real OpenCV 5 runtime, omit the development switch.
The receipt records actual OpenCV/browser/Playwright versions, the checked-out
Git commit, image/archive/video hashes, replay result and JavaScript errors.

## Shared artifacts and limits

The path-scoped `VisualLedger browser demonstration` PR workflow runs this one
synthetic walkthrough with read-only repository permissions and no AWS credentials.
Its artifact includes `workspace-demo.webm`, three screenshots, `browser-export.zip`
and `browser-proof.json`. There is no schedule or recurring task. No owner computer
or private/customer image is needed. No administrator browser policy is modified.

The earlier local container's `ERR_BLOCKED_BY_ADMINISTRATOR` remains a truthful
historical result. A later successful normal CI run can establish browser-flow
acceptance in that separate runner, not that the local policy was changed.

This walkthrough is development evidence, not a final narrated competition video,
a cloud/AWS execution proof, a real-world document-accuracy study, an official
submission or a prize/payment receipt. The original pixels and both canonical
traces remain in the downloaded ZIP; real-document exports are confidential.
