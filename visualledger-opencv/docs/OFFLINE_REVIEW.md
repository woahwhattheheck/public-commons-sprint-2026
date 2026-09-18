# VisualLedger offline human review

A local, static review surface for the **canonical VisualLedger trace**. It shows
source pixels, the next workflow action, reasons, quality measurements, declared
policy, runtime truth and evidence identifiers. It does not perform OCR, approve
or reject invoices/expenses, authenticate documents, sign evidence, query AWS,
verify DynamoDB record HMACs, post accounting entries, move funds or contact anyone.

## Run

Install the existing VisualLedger requirements. The CLI requires a POSIX host
for no-symlink input traversal. The rendering API itself does not read files.

```sh
cd visualledger-opencv
python -m visualledger.review --manifest /secure/case/manifest.json \
  --output /secure/case/review.html
```

The default preserves the canonical OpenCV runtime requirement. A development
host running OpenCV 4 must explicitly add `--allow-opencv4-dev`; the generated
page labels that compatibility evidence, not OpenCV-5 competition proof. No new
workflow, server, tracking, browser script or deployment is introduced.

The manifest is UTF-8 JSON:

```json
{
  "schema": "visualledger-review-manifest/v1",
  "documents": [
    {"image": "source.png", "trace": "trace.json", "prior_fingerprints": []}
  ]
}
```

`trace.json` must be the complete result of `compile_trace`, not a DynamoDB
record or the historical standalone donor's report. Each item supplies **exactly
the prior fingerprint context used to compile its trace**. Context is neither
inferred from earlier cards nor silently filled from an external store. For a
trace compiled with priors, include its original list of
`{"evidence_id":"prior-1","fingerprint":"0123456789abcdef"}` objects.
Missing or different context that changes the replay rejects the whole export.

Input paths are relative to the explicitly selected manifest parent directory.
Their ASCII path components start with a letter, digit or underscore and may
otherwise contain letters, digits, underscores, dots and hyphens. Absolute paths,
URLs, dot components, backslashes, symlink files/directories, devices and FIFOs
are rejected. The caller selects the parent directory; child reads are anchored
to its open directory descriptor. Existing output files and symlinks are never
overwritten. Verification completes before an atomic create-only publication.

## What "REPLAY MATCHED" means

The renderer calls canonical `verify_trace` with the exact source bytes, supplied
prior context and current runtime. It reproduces perception, policy, routing,
authority flags and the trace receipt before displaying the result. The page
retains the declared policy; replay does not endorse that policy or establish
that the supplier/source/prior index is trustworthy.

An attacker able to replace all inputs can create a new internally consistent
review. This page does **not** authenticate the upstream store or its HMAC seal.
It cannot prove invoice validity, a duplicate payment, fraud, customer use, a
competition submission, an AWS deployment or revenue. The HTML itself is not
signed: preserve the manifest, image and trace and regenerate the page when
checking a received copy. A changed runtime may require re-generation and new
trace custody rather than accepting a semantic mismatch.

The image shown is a freshly re-encoded PNG of the original source, resized to at
most 1024 pixels on its longest edge. It is **not** the canonical perspective-
normalized image. The page labels and hashes those two objects separately; the
canonical normalized PNG digest is displayed directly from the replayed trace.

Everything remains **human review required**, including `REQUEST_FIELD_EXTRACTION`.
A visual-similarity candidate is not a conclusion about an expense or payment.

## Limits and privacy

There are at most 16 documents, 20 MiB per image, 80 MiB combined source bytes,
256 KiB per JSON input and 32 MiB per HTML output. Image decode and perception
retain the canonical engine's limits and behavior; this UI does not add a new
pre-decode image-format validator. Run untrusted image processing in an isolated,
resource-limited worker, not in a customer-facing privileged process.

The output uses no JavaScript or remote resources. A hash-bound content security
policy permits only the embedded stylesheet and PNG data images. All trace text
and attributes are escaped. The generated HTML embeds document pixels and trace
identifiers: **treat it as confidential and do not publish customer reviews in a
public repository, public demo or shared channel**. Test and demo inputs must be
synthetic or explicitly authorized.

## API and tests

```python
from visualledger.review import render_review
page = render_review([
    {"raw": image_bytes, "trace": canonical_trace, "prior_fingerprints": []}
])
```

```sh
python -m unittest discover -s tests -p test_review.py -v
python -O -m unittest discover -s tests -p test_review.py -v
```

The suite uses real canonical synthetic images, all four workflow routes,
explicit duplicate context, reminted semantic/authority failures, substituted
images, static/escaped HTML, PNG decode, determinism, path/symlink/FIFO rejection,
create-only output and an actual normal-versus-optimized subprocess CLI replay.
These tests establish local software behavior, not real-world routing accuracy.

## Origin and integration custody

Z-Cairn-Q6E9 / GPT-6 Astra Pro recovered the historical donor at local commit
`dc00c66ddc24fb2f9db1b19f10e27627a2f4a3da`. Its complete original package is retained
in the owner's persistent Library under
`/Commons/VisualLedger/Donor-Q6E9-dc00c66/`.
This module adapts the donor's offline-review capability to the existing #124/#125
canonical API; it does not introduce a second vision engine or overwrite the
active retained-record/HMAC implementation. Canonical product/source credit
remains with Z-Sol and the #125 contributors.
