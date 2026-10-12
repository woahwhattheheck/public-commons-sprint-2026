# Receive the whole laboratory application

The maintained driver uses the original paid-job compiler, sealed input store,
chunk protocol, job pinning and native worker. It runs the complete supplied
delivery families and retains each worker result, source-bound review, editable
table and independent received archive. Its browser continuation operates the
same completed reports and downloads.

## Select the exact original inputs

Copy `receiving.example.json` for the laboratory's two published CSV families
or `receiving.dts.example.json` for the original DTS XLSX workbook. The EQuIS
example already selects both complete bundled original ZIPs and their exact
acquisition hashes. Keep relative source and merchant paths relative to the
configuration file, or replace them with the actual absolute retained paths.
Fill in:

- Original source file paths and the observed source encoding.
- Optional whole-file `sourceSha256` and `sourceBytes` from their acquisition.
- Optional `baselineFile` in the same profile and `decisionsFile` from the
  source-bound review.
- The source-pinned `merchant.example.json` path.
- The existing Playwright module, Chromium executable, and actual host launch
  arguments for browser receiving.

Use a stable operation ID and keep that configuration unchanged while receiving
resumes. A new source or revised decision document is a new result edition; it
must use a distinct private operation directory. The original source files,
canonical source identity and configured profile are checked before a saved
operation continues.

The two published supplier files are linked from
[McCampbell's EDD page](https://www.mccampbell.com/edds.php).
The complete original acquisition is retained under `examples/mccampbell/`,
including its source receipt and actual full-model receiving outcome. Reuse this
same acquisition for the supplied example. The driver consumes those retained
files and performs no provider GET.

## Run the original worker and browser

```sh
starforge lab-edd-receive \
  --configuration /absolute/private/receiving.json \
  --directory /absolute/private/lab-receiving-01 \
  --scratch /absolute/private/lab-worker-temp
```

From a checkout:

```sh
node --expose-gc \
  stellar/scf-starforge-20261009/sf30-seller-sdk/lab-edd/receiving.mjs \
  --configuration /absolute/private/receiving.json \
  --directory /absolute/private/lab-receiving-01 \
  --scratch /absolute/private/lab-worker-temp
```

`--phase native` completes the original worker and full-file receiving first.
`--phase browser` continues its same completed family outputs when the existing
browser interval is available. The default `all` performs both. Repeating the
same command reopens retained outputs and verifies their identities before any
pending step continues.

Run the operation through the maintained native resource controller on shared
hosts. Account for the complete Node worker, Python workbook reader, receiver,
source expansion and Chromium when selecting its actual memory/disk declaration.
The merchant's worker heap allowance is 768 MiB; a full receiving operation needs
additional receiver and browser headroom. The driver uses the selected private
scratch for both `LAB_EDD_TEMP_ROOT` and the original broker's `SF30_JOB_TEMP`.
It supplies the required `LAB_EDD_PYTHON` worker value from the selected host
interpreter, defaulting to `python3`. Browser receiving uses the configured
`tempDirectory`.

## What the operation completes

For each actual family, the driver:

1. Reads every original source member with its selected profile and records the
   whole source identity. It preserves all rows, duplicate versions and original
   cell representations.
2. Produces a complete source-bound decision document. A supplied document is
   used exactly; otherwise the driver records one explicit Keep reason on an
   actual original row in each source section.
3. Exports and parses the full editable CSV and TSV representations, comparing
   every source-bound choice.
4. Seals the complete source, optional earlier delivery and selected decisions
   through the original chunked file-input store and canonical request compiler.
5. Executes the original native application for the initial and reviewed
   requests. It repeats the reviewed request with the same job/reference/input
   identity and compares the complete result bytes.
6. Reopens every archived member, every original input and each native receiving
   member. It compares the original model's full preview and native outputs,
   decodes every prepared file, and compares all original or explicitly selected
   field values. An unchanged file must retain its exact original bytes.
7. Reopens the original input from the result archive independently and checks
   the full decoded source rows and worksheet provenance.
8. Opens the original completed report in Chromium, downloads every visible
   native/source/review/table file, and compares the exact bytes with the
   retained manifest. It edits an actual Keep reason, downloads/reopens the
   complete JSON and CSV choices, returns to the immutable saved edition, and
   inspects desktop and mobile layouts.

An unresolved native format issue is received as its actual
`REVIEW_REQUIRED` preparation state, with its complete usable review and error
details. The driver does not turn an unresolved source issue into a successful
native import result.

## Retained continuation

`receiving.json` is the original private checkpoint, including file-store tokens.
Keep it in the private operation directory. `result.json` contains the complete
shareable operation result without those tokens.

Each family retains:

- Initial and reviewed whole result ZIPs.
- Complete received member trees and original worker manifests.
- Exact source-bound JSON, CSV and TSV decisions.
- Native source/field comparisons and same-job replay identities.
- Browser downloads and small desktop/mobile viewport screenshots.

The complete result ZIP itself is the delivery artifact. It includes the
original sources, computed profile review, every decision, native outputs and
offline operator editor; it can be moved independently of the authoring paths.

## Original dependencies

The application and direct receiver use the original Node source closure.
The paid-file worker retains its existing declared dependencies, including
`re2js` in the original job runtime. Reuse the selected installed distribution or
its maintained runtime; no separate job implementation or browser installation
is created by this driver.

DTS adds the same maintained
`dataset-refresh/workbook/reader.py` alongside
`workbook_bridge.py`. Both use Python 3.10+ standard library. The interpreter
can be selected with `LAB_EDD_PYTHON`. Original input/output encodings, ZIP
members, source epoch, worksheet identity and explicit literal choices remain
part of native receiving.

## Native workbook format receiving

`workbook-native-receiving.py` is the complete software-format receiving exercise
for the selected DTS XLSX bridge. It constructs all 150 original field headers
and exercises the original workbook reader/writer with source epoch 1904,
implicit cell coordinates, blank rows, namespace scopes, literal carriage returns,
Excel string escapes, typed field choices, shared-formula followers and recorded
literal replacement. It also checks unchanged original workbook bytes and
calculation-chain cleanup. These are explicitly generated format fixtures.

```sh
python3 stellar/scf-starforge-20261009/sf30-seller-sdk/lab-edd/workbook-native-receiving.py \
  /absolute/pinned/source/root
```

`LAB_EDD_RECEIVING_TMP` selects the existing writable private temporary location.
Run this same small native exercise in the original receiving operation alongside
the actual supplied source families. The original EQuIS source-model result and
its full data are in `examples/mccampbell/McCampbell_Complete_EDD_Model_20261012.zip`.
