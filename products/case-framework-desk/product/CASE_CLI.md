# Complete CASE package capture and command-line receiving

This is the original Node command-line course for the CASE edition desk. Use Node
22 or later with the five complete modules in the same product directory:
case-cli.mjs, case-http.mjs, case-source.mjs, case-report.mjs and source-json.mjs.
No package installation is needed. The renderer and semantic reader are the same
modules used by the browser desk.

## Capture selected original editions

Select the actual complete CASE 1.1 CFPackage and retain each edition separately.
The source limit is 1 MiB per package, shared with the browser and semantic reader.
The tool does not divide a large package or quietly omit its records.

    node product/case-cli.mjs capture --file framework-before.json --label "Publisher framework, before" --out capture-before
    node product/case-cli.mjs capture --file framework-after.json --label "Publisher framework, after" --out capture-after

Each output directory contains the original source.json bytes, original source
label/location, a complete source/graph inspection and a manifest binding every
saved member. File reads use an ordinary selected file, check the open file's
identity and metadata before/after reading, and close the descriptor. UTF-8 is
decoded strictly. Invalid UTF-8 and a JSON BOM are rejected instead of silently
rewriting original bytes.

For an explicitly selected provider package:

    node product/case-cli.mjs capture --url https://selected-provider.example/ims/case/v1p1/CFPackages/4b734fb0-450a-4f21-8b16-000000000001 --label "Selected provider edition" --out capture-provider

The host above is an example; use the actual selected provider and original UUID.
If the existing authorized provider requires an Authorization header, place its
complete header value in an environment variable by the account's normal credential
route, then add --authorization-env CASE_AUTHORIZATION. The value is never a CLI
argument, log field or saved source field. A capture records only whether a header
was supplied. URLs must have no credentials, query or fragment.

The reader makes one GET, accepts a complete HTTP 200 JSON entity, refuses redirects
and Content-Range, requests identity encoding, enforces the complete 1 MiB limit
while streaming, and checks any declared Content-Length. It retains the actual
selected/response URLs, capture time, source identity and selected original HTTP
metadata. It does not fetch referenced frameworks, follow publisher links or write
to a provider. An optional --timeout-ms value is 1,000–120,000; the default is 30,000.
The request controller, response reader and timer are closed on success or error.
The returned CFDocument identifier must equal the exact selected endpoint UUID.
A complete valid-UTF-8 HTTP response rejected by semantic inspection or that UUID
check is retained as source.json, capture-failure.json and a distinct failure
manifest in the selected output directory. This preserves the actual response for
review; readCASECapture rejects that directory as an accepted capture. Existing
output directories are rejected before a new provider GET is made.

A selected local HTTP acquisition exercise may use --allow-http-loopback with
localhost, 127.0.0.1 or [::1]. Production provider captures use HTTPS.

## Compare and review

Both captured packages must identify the same original CFDocument. A new review is
explicitly unreviewed; every source change remains open until authored decisions
are supplied:

    node product/case-cli.mjs compare --before capture-before --after capture-after --reviewer "Named reviewing operator" --out first-review

Open first-review/case-edition-report.html and the original source downloads.
Review all source findings, association directions and local/external reference
states. The captured source editions are never rewritten by an ACCEPT decision.

For a reviewed successor, use the complete review.json from that comparison.
Preserve its exact basisSha256 and author reviewer, notes and each selected
decision. The choices are ACCEPT, INVESTIGATE or DEFER. The full original row key
identifies each decision. A renamed or reidentified publisher object remains a
removal/addition; the operator does not infer equivalence through its label.

    node product/case-cli.mjs compare --before capture-before --after capture-after --review reviewed-decisions.json --out reviewed-successor

The previous review is retained in its original directory. This command rejects
review decisions that belong to another pair of source editions. No acceptance
is inferred from a missing decision or from a successful source inspection.

## Complete output and portable receiving

Every complete comparison contains:

- case-edition-delivery.json: complete original sources, reproduced comparison
  and the explicit supplied review.
- case-edition-report.html: the offline readable report and original-source
  downloads.
- case-edition-changes.csv: all observed record states and review choices.
- comparison.json and review.json: the complete report and authored review.
- framework-before.json and framework-after.json: exact original publisher text.
- selected-delivery.json: the exact original delivery selected for this operation.
- source-edition.json: byte identities of all five actually selected tool modules.
- operation.json: immutable source/delivery pins for this receiving operation.
- manifest.json: every saved member and its exact byte identity.

The JSON envelope reader rejects duplicate keys. Each complete control/generated
member is limited to 32 MiB; the two original source packages retain their 1 MiB
limits. The full output is prepared and inspected before a new directory is owned.
Files are created exclusively with private permissions and synchronized; the
completion manifest is written last. A completed operation is read back and its
full JSON, CSV and HTML are independently regenerated from the original sources.

Use the delivery downloaded from the browser desk or a prior CLI result:

    node product/case-cli.mjs receive --delivery case-edition-delivery.json --out received-review
    node product/case-cli.mjs reproduce --case received-review

The receiving command verifies the actual supplied delivery through the same
semantic engine and writes a separate complete handover. Reproduce compares every
saved member and regenerates every derived output without changing the directory.
A modified source, review, renderer or reader is surfaced as a different edition.
Use the original five modules listed in source-edition.json to reopen an older
saved result; do not replace historical hashes to make a newer tool pass.

The offline report's JSON and source downloads should be reopened independently.
The original producing owner must open/use/LOOK at the desktop and narrow desk,
all relevant review states and controls, the generated report and its downloads.
Retain actual screenshots and original receiving outputs with the existing company
operation. Source parsing and code review are recorded separately from those actual
native and rendered results.

## Recover interrupted materialization

An interrupted output remains in its own directory. Once operation.json,
source-edition.json and selected-delivery.json have been completely retained, the
same original inputs can be materialized into a new directory:

    node product/case-cli.mjs recover --case interrupted-review --out recovered-review
    node product/case-cli.mjs reproduce --case recovered-review

Recovery checks the three complete original inputs and current tool edition, then
recreates the full deliverable. It never deletes, edits or overwrites the interrupted
directory. If an interruption occurred before all three inputs were retained,
select the earlier complete original delivery or captures again into a new directory.
A partial provider capture is retained for inspection; repeat the selected GET only
as an explicitly new acquisition with its actual later capture time.

Output parent directories must already exist. Existing output directories are
never replaced. Completed captures/results have an exact known member set, so
additional files are kept beside the directory rather than added inside it.

## Integration API

Import from product/case-cli.mjs. All operations are asynchronous.

    const captured = await captureCASESource({
      file: actualPath, label: actualLabel, out: newCaptureDirectory
    });
    const result = await compareCASECaptures({
      before: originalBeforeCapture, after: originalAfterCapture,
      review: completeAuthoredReview, out: newReviewDirectory
    });
    const received = await receiveCASEDelivery({
      deliveryText: originalDownloadedDelivery, out: newReceivingDirectory
    });
    const verified = await reproduceCASEResult(received.directory);

captureCASESource selects exactly one file or url and returns directory, manifest
and the complete capture. For URL inputs it accepts authorizationEnv, timeoutMs
and allowHttpLoopback. compareCASECaptures accepts complete original capture
objects or their saved directory paths; choose review or reviewer, not both.
receiveCASEDelivery accepts a delivery object or its original deliveryText, not
both. recoverCASEResult accepts {directory,out}. The lower-level original
captureCASEFile/captureCASEHTTP functions are exported by case-http.mjs.

The company commissioner should call these APIs directly for each selected
framework and review round, keeping its complete customer selection/configuration,
source captures and explicit decisions. A future corrected publisher edition is
another selected input; it does not prevent materializing the current first round.

## Runtime and source references

Node's original file, stream, fetch, URL, crypto and AbortController implementations
provide the native mechanisms:
https://nodejs.org/api/fs.html
https://nodejs.org/api/globals.html#fetch
https://nodejs.org/api/crypto.html

The shared semantic engine follows the selected CASE 1.1 source and preserves
original publisher extensions. This operating course does not claim 1EdTech
certification. Preserve SOURCE_MAP.json and the original specification references
with the complete product. Retain current account/browser ownership, source
selection and the original receiving operation; no hosted Actions execution is used.
