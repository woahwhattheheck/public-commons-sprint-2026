# Native handovers to institution reports

Use an authorized complete BankRegData review handover from the existing analyst and an approved report selection. This adapter reads the full archive, binds original source/view/analysis/review records, and produces the exact input consumed by `compile_report.mjs`. It retains the complete ZIPs beside that input.

## Inspect and select

Use Python 3.10+ for this standard-library adapter. The original analyst course and the Node reporting command use the selected Linux/POSIX receiving environment. On Windows, the adapter's directory sync is skipped while every output file is flushed; the operator must select a private folder with appropriate account ACLs.

~~~sh
python3 -B native_handover_input.py inspect --handover /PRIVATE/period-review.zip
~~~

The output lists complete source records and original view IDs. Input archive basenames are shown for inspection; retained provenance uses the stable SHA256-named ZIP so relocating or renaming a received file does not change the report input. Choose actual saved IDs, not preview rows. To include an additional predecessor period, publish a handover whose selected/supporting mapped views include that original, or select a second authorized complete handover.

Create a JSON selection with the compiler's input schema, title, periods, institutions, subjectIds, cohorts, measures, sourceSelections and review. Leave out originals, views and nativeHandoverProvenance; add selectedViewIds containing actual IDs from inspection. All other fields, including additional firm-defined configuration, remain in the assembled input. The complete original selection text is retained too.

For each reported or quarter-from-YTD measure, set sourceDefinitionGroup. Each metric/period sourceSelections entry needs sourceSha256, tableId, definitionId and compatibility:{group,approvedBy,approvedAt,note}. These are actual reviewed choices. A shared label does not establish compatibility. The compiler withholds a value if its approved group does not match the measure.

The native source uses zero-based column and row indexes, actual table IDs such as table-1, and zero policies reported, threshold_possible or unknown. The adapter preserves native documents unchanged; it does not fabricate a mapping or normalize their source references.

## Build, compile and receive

~~~sh
python3 -B native_handover_input.py build \
  --handover /PRIVATE/period-review.zip \
  --handover /PRIVATE/predecessor-review.zip \
  --selection /PRIVATE/report-selection.json \
  --output /PRIVATE/native-report-input

node operate_report.mjs \
  --input /PRIVATE/native-report-input/input.json \
  --output /PRIVATE/report-delivery
~~~

The adapter publishes:

- selection.json: the exact selected input file.
- input.json: complete original UTF-8 sources, exact native view-object documents, definition/cohort selections, exact original selection text and full native handover manifests.
- original-handovers/<sha256>.zip: each entire unchanged incoming ZIP, including all retained histories and replay source.
- manifest.json: every published product's byte length and SHA256.

The compiler's separate delivery directory contains the full input, report JSON, readable HTML, selected-row CSV and completion manifest. Retain both directories together. Open the HTML for institution results, peer/period comparisons and source coverage/review; use JSON for the complete source trace and exact fractions.

Repeat either command with the same inputs and output directory to finish missing identical products after interruption. Different existing files are preserved and cause rejection. To accept changed definitions or a later handover, use a new selection and new output directories; retain the earlier edition.

An independent receiver can run inspect against the retained ZIPs, rebuild with the retained selection.json in a new private directory, and compare every adapter manifest member. Then re-run the reporting command and compare the report manifest. This exercises the complete input-to-report path with actual permitted source.

## Actual admission boundaries

One to sixteen complete handovers are accepted. Combined ZIP bytes and combined expanded members each have a 128 MiB limit; each archive has at most 4,096 members. The selection file is at most 2 MiB; assembled input at most 128 MiB. At most 64 complete selected view objects and 32 complete original sources feed the compiler. Each original source is at most 32 MiB. JSON input rejects duplicate keys and non-finite numbers.

Every manifest member and object hash is checked. The saved comparison, original source copies, exact mapped-view text, supporting selections and reviewer history must agree with the native records. Selected IDs with conflicting saved metadata across archives reject. Archives are read without extraction; linked, encrypted, duplicate, case-colliding or unsafe member names reject.

Selected source files must be exact UTF-8. The original analyst can also retain Windows-1252 and ISO-8859-1 reports; this compiler bridge deliberately reports those as requiring an agreed UTF-8 source edition. It never silently changes the original bytes. Unselected material remains inside the retained full ZIP.

The adapter validates native custody and the selected object closure. It does not run Python embedded in received archives. The existing trusted analyst remains responsible for producing/replaying mapped values. The compiler validates calculation/definition/cohort semantics and reports unavailable values explicitly. Archive identities and definitions do not independently certify a financial conclusion.

## Source and execution record

This is newly authored adapter source, reviewed against the current maintained native handover publisher and validator at Commons commit 089929b9831a01f06ebbc566fd8069c3133325d1, revenue/sec-facts-vintage/analyst/bankregdata_sources.py, blob d687e07fecbef07e1eac87d9ba8f6fbff64e5199. It does not redistribute the earlier complete application archives.

The supplied compiler reference has executed through its production factories in Functions V8. The Python adapter is supplied for actual native receiving; the package's execution record distinguishes source review from a completed Python run. Record the actual selected runtime, command, retained input hashes and result when the receiving engineer operates it.

## One complete equipped receiving course

Run the supplied course against the already authorized complete analyst installation and installed runtimes. It imports the actual maintained native source, creates five authored source editions, maps them through the native engine, publishes an original review handover, builds the compiler input, compiles the report and independently receives/rebuilds it. It also restores the complete authored native backup and checks that exact repeated input remains unchanged. It uses the same original source contract and no customer observations.

~~~sh
python3 -B receive_native_report.py \
  --analyst-directory /AUTHORIZED/sec-facts-vintage/analyst \
  --node /EXISTING/node \
  --playwright-module /EXISTING/playwright/index.mjs \
  --chromium /EXISTING/chromium \
  --output /PRIVATE/new-institution-receiving
~~~

The directory must be new and empty. An interrupted course leaves its actual workspace and outputs for inspection; choose a new course directory for a fresh full run. The individual adapter/compiler commands retain their exact retry behavior.

The course renders the exact generated report at wide and narrow sizes, exercises the readable report's downloads, checks those bytes, and cold-opens the downloaded report beside its companion files. It preserves actual screenshots and source/receiving results. Inspect those screenshots or the actual browser screen and record the observed layout and useful content before calling the report ready for a recipient. A scripted navigation result alone is not the visual inspection. The complete report remains internal until this actual rendering/inspection is done.
