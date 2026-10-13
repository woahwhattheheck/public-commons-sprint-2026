# Receive the actual GIS edition-change report

Operation: **ES-20261013-GIS-REVIEW-GEOGRAPHY**. This command continues the
existing exported-working-edition comparison and its complete offline report.
It uses original managed GIS exports and received editions from the selected
scientific Workspace. The native comparator, its numerical definitions and
existing operator file transport remain the production implementation.

Read the complete current [owner direction](../CURRENT_OWNER_DIRECTION.md),
version **2026-10-13.3**, and [application instructions](../AGENTS.md).
The receiver copies both complete current files into its output's
`instructions/<original-SHA256>/` directories, alongside the executed source
map. Preserve the original source bank, current scientific runtime and active
receiving owner. Today's cutoff remains **2026-10-13 14:00 UTC**.

## Continue the actual retained case

Use the existing native Python with the application's GIS dependencies and the
existing browser-capable Node/Playwright installation. The browser module can
be selected explicitly from its installed path; the command does not install
packages or download a browser. Use `--browser-executable "$EXISTING_CHROMIUM"`
when the installed browser is outside Playwright's normal location; the browser
also honors `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`.

~~~sh
"$NATIVE_PYTHON" -B source_tools/receive_gis_edition_review.py \
  --application "$APPLICATION" \
  --workspace "$ACTUAL_WORKSPACE" \
  --output "$RECEIVING_OUTPUT" \
  --require-raster \
  --node "$BROWSER_NODE" \
  --playwright-module "$INSTALLED_PLAYWRIGHT_MODULE"
~~~

Run from the complete current application source root. `RECEIVING_OUTPUT`
is a separate sibling directory outside the scientific Workspace. Keep the
same output on interruption: it pins the actual selected pair and preserves
the report, source identities, previous elapsed intervals and browser artifacts.

The command reads the actual complete `gis-exports/*/export.json` and
`gis-received/*/receipt.json` records and their original project manifests.
Compatible candidate pairs share their actual request-bound selection identity
and complete source request. Automatic selection prefers a retained raster
pair, then more retained raster layers, then the full export/receipt IDs for a
stable tie-break. It never interprets a directory timestamp as a scientific
reference. The maintained comparator performs the complete inventory,
fingerprint, layer/source and native compatibility checks.

When the receiver already has the desired managed IDs, supply both explicitly:

~~~sh
"$NATIVE_PYTHON" -B source_tools/receive_gis_edition_review.py \
  --application "$APPLICATION" \
  --workspace "$ACTUAL_WORKSPACE" \
  --output "$RECEIVING_OUTPUT" \
  --export-id "$ACTUAL_64_CHARACTER_EXPORT_ID" \
  --receipt-id "$ACTUAL_64_CHARACTER_RECEIPT_ID" \
  --node "$BROWSER_NODE"
~~~

The explicit pair takes precedence over automatic selection. A subsequent
invocation with the same receiving output retains that exact pair. A changed
producer edition or changed original pair uses a separate receiving output,
while the original immutable reports and adopted source contexts remain usable.

`--require-raster` requires an actual raster layer in the retained pair.
A vector/table-only county case remains useful for its own original-source
decisions and working-edition comparison; it is not presented as a raster
course. A raster may legitimately be unpaired because its actual grid or
selected band changed. Only real retained `raster_view` records provide
geographic panels. The report preserves those unpaired explanations.

For a receiving owner locating an existing pair, `--inspect` writes
`pair-catalogue.json` with actual complete record counts, compatible pairs,
raster/vector membership and concrete malformed-record diagnostics. This is
a discovery mode; the same owner proceeds to the ordinary full command after
selecting the existing case. A missing compatible pair is reported with that
actual catalogue instead of creating a substitute scientific case.

## Continue a completed study that has no managed GIS pair yet

If the actual Workspace has completed sources, runs or a delivery but no
compatible GIS export/receipt, use the existing **Editable GIS projects**
selection for that same study. Save the real selection JSON and pass it:

~~~sh
"$NATIVE_PYTHON" -B source_tools/receive_gis_edition_review.py \
  --application "$APPLICATION" \
  --workspace "$ACTUAL_WORKSPACE" \
  --output "$RECEIVING_OUTPUT" \
  --gis-selection "$ACTUAL_GIS_SELECTION_JSON" \
  --require-raster \
  --node "$BROWSER_NODE"
~~~

The selection has the same complete shape used by the existing GIS desk and
`workspace-export` CLI: actual `delivery_id`, or retained source/grid/run/
comparison selections, with the chosen title and actual project CRS. Use the
completed record IDs from that Workspace; preserve its simulated or original
case label, actual native resolution and support. Clear unrelated default
sources for a delivery-only selection. No synthetic raster or fabricated
managed ID is introduced.

For this explicit selection, the receiver first reuses an existing compatible
pair for the installed builder's exact request, preferring an already edited
received edition. If absent, it invokes maintained `gis_workspace.export`
and `gis_workspace.receive` on that actual export's checked original archive.
The true returned IDs are pinned before the ordinary edition review. These are
the same APIs behind `workspace-export` and `workspace-receive`; scientific
model calculations remain untouched. The input selection, source hash and
actual export/receive elapsed history are retained in `gis-intake.json`.

Receiving an unchanged original archive legitimately produces zero data
changes. This still exercises the actual full native raster/support/report
handover. Existing edited pairs remain available and are never modified.
Explicit export/receipt flags select the original pair directly; do not combine
those flags with a new GIS selection file.

## Native review, complete package and original operator

The command invokes the installed
`model.gis_edition_review.review` with the exact pair and current producer
version. It uses the original per-review execution lock and layer checkpoints.
It does not launch an InVEST model, change a GIS edition, seal desktop edits,
or alter an adopted source selection. Only the explicitly supplied
`--gis-selection` continuation uses the existing export/receive APIs described
above.

The completed native state supplies every original report file. The receiver
verifies the complete ZIP's member names, lengths and SHA-256 values while
streaming it into an independent reopening directory. It checks the reopened
report selection and every extracted member, then reopens the original managed
report through a fresh Workspace object. Native failure preserves the actual
exception and receiving history; already completed native output is retained
before the browser stage begins.

The browser uses the ordinary offline `REVIEW.html`, independently extracted
copy and current operator preview. By default, the receiver starts the normal
loopback operator with its own receiving state solely for this course, then
closes that temporary server when the browser returns. It never stops another
operator or scientific process.

To use an already running local operator, put its existing private login URL
in a local file and pass:

~~~sh
  --operator-url-file "$PRIVATE_LOCAL_OPERATOR_URL_FILE"
~~~

That operator must already contain the selected original Workspace. The private
login fragment stays in a mode-0600 transient browser request and is removed
after the browser returns. Shared results contain public context labels and
relative artifact identities. The browser process log is private as well;
never post an operator capability or an unredacted local login URL.

`--native-only` supports the existing split-runtime arrangement when native
Python and the accepting browser worker are on different machines. It leaves
the complete native report/reopening/source map in place. The same receiving
owner then operates the browser course on those exact retained files, or reruns
the full command using that completed receiving output. Native completion alone
does not describe the outgoing product as visually accepted.

## Operate and look at the delivered report

The maintained browser caller operates the actual report at **1440 px desktop**
and **390 px narrow** widths, selects actual raster layers and available modes,
uses geographic controls and selected-bin readouts, opens the complete
downloaded files and checks independent reopening. It also opens the report in
the real operator context through the existing authenticated file route.

Read the geographic units as recorded in the report. A displayed region is an
aggregate native-grid bin: the report supplies zero-based inclusive native row
and column ranges, exact support counts, full affine coordinate corners and
finite received-minus-exported ranges where physical arithmetic is applicable.
Categories, differing units and unpaired grids retain their explicit original
explanations. Original native TIFFs are authoritative; preview bins are not
invented single-cell measurements.

**The producing worker must actually open, see and use the outgoing result.**
Look at the actual populated desktop and narrow screenshots, including the
operator's embedded context; operate the report and open its complete ZIP,
JSON, CSV, support/value TIFFs and other included attachments as a recipient
would. Capturing images or returning a successful browser process is not
substitute for looking. Fix concrete unreadable, clipped, broken or confusing
output in the existing owned source, repeat the affected interaction and keep
the complete source and scientific identities. Use focused product operation,
without a new approval controller, broad test suite or verification product.

The output's `result.json` identifies the exact Workspace/project, original
export/receipt/edition identities and fingerprints, current review ID,
executed source hashes, original report files, extracted reopening directory,
real elapsed intervals and browser result/artifact paths. Browser artifacts
contain actual screenshots and downloads for the producing worker's inspection.
A machine result does not claim human/customer acceptance.

## Preserve the current Upper Savannah scientific direction

The owner has prioritized the actual Upper Savannah RFP geography with the
**30 m** GIS selection. Keep the upstream contributing model domain distinct
from the South Carolina reporting mask and the four retained utility focus
anchors. Preserve editable baseline, realistic riparian restoration and
matched-control assumptions, actual native progress and completed annual
nitrogen/phosphorus **kg/year** and sediment **tonnes/year** delivered to
streams. These modeled loads are not intake concentrations.

The already completed square 5156 case retains its own scientific identity.
The current exact-geography successor and its executing owner remain a
separate retained case. This GIS receiving course reads whichever original
managed pair is explicitly selected; it does not rename or substitute one
case for the other, rerun a model, or interrupt active compute.

The desired recipient workflow remains choose, run, inspect, revise and
handover: inspect actual source selections, compare native results on their
declared support, edit the useful scientific choices and receive the editable
GIS and complete cold-reopenable scientific package. Carry the complete owner
brief with the current source and receiving result. Explain delivery speed
with the recorded start/finish/elapsed history; retain the actual original
run and package histories for scientific stages outside this command.
