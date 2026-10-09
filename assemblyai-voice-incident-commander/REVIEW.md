# Portable transcript review and evidence handoff

The standalone review page now retains its complete replay-verifiable JSON packet, supports a filtered Markdown handoff, and reveals linked turns even when an earlier filter hid them. The page uses embedded assets and browser-local downloads; it does not contact AssemblyAI or another service.

## Create a review from an existing packet

Run from `assemblyai-voice-incident-commander/` with Python 3:

```python
from pathlib import Path
from incident_core import strict_json_loads
from review import render_review

packet = strict_json_loads(Path("incident.json").read_text(encoding="utf-8"))
Path("review.html").write_text(render_review(packet), encoding="utf-8")
```

Open `review.html` in a browser. Rendering rejects packets that do not pass the existing replay verifier. No API key or network access is needed to review an already-created packet.

## Download the full JSON packet

**Download full JSON packet** saves the entire receipt-bearing packet, including turns hidden by filters. Parsing this download reconstructs the same verified packet and preserves its receipt; the original input file's whitespace or byte serialization is not preserved. The download remains available for an empty packet or a filter with no matching turns.

Retain this JSON for `verify_packet` or the existing replay workflow. A source packet receipt is not a hash of the HTML page or a signature proving who spoke. Review-page generation does not establish live provider execution, statement accuracy, competition submission, or payment.

## Export a filtered Markdown handoff

Choose a speaker, event type, and/or transcript search, then select **Export filtered Markdown**. The handoff contains only the currently visible turns, in their original order, plus:

- The full source packet receipt and the selected/total turn count.
- The applied filters, original transcript and speaker, event type, transcript hash, and event hash.
- An explicit distinction between recorded proposals or decisions and authorized execution.

The export is a **derived view**, not a replay-verifiable packet or a new independently verified source. Keep the complete JSON when verification is needed. No-match views disable the Markdown button. Transcript, speaker, and filter text are fenced as literal evidence, including text containing backticks, HTML, or Markdown syntax.

## Share a turn link

Append `#turn-0`, `#turn-1`, etc. to the review file's location. Opening a valid turn link focuses and scrolls to that turn. If current filters hide it, those filters are reset first. Links to already-visible turns preserve the filters; malformed or missing turn identifiers do nothing.

## Privacy and limits

Filters are **not redaction**. Every turn remains inside the HTML and its full JSON download. Share either only with readers authorized to see the complete transcript. A Markdown handoff contains the selected transcript text and filter values; inspect it before sharing too.

Actions remain evidence for human review: neither export approves or executes a command, sends a page, or changes a deployment. The browser generates Blob downloads locally and releases their object URLs after starting the download. Browser or enterprise file-download policies may still require permission.

## Focused verification

```bash
python -m unittest discover -s tests -p test_review_exports.py -v
```

Five focused cases cover inert JSON embedding and replay, tampered-packet rejection, selected Markdown versus full JSON download, initial/filtered deep links, and empty packets. Browser-script checks execute the actual page script under Node's standard-library VM with a narrow DOM double; install-free Node is required for those three cases, otherwise they are explicitly skipped. These checks do not assert real-browser rendering, a live AssemblyAI session, or hosted CI success.
