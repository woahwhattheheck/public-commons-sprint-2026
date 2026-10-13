# Water reconciliation — complete operator and receiving guide

This product adds meter/register, interval, recorded-consumption and water-charge analysis to the maintained complete CSV discovery engine. It retains the original source intake, field profiles, SQLite working store, exact record identities, keyed edition comparison and full handover/receiving. The original engine and its guide remain unchanged.

The operator receives the whole source case, reads the report in an ordinary browser, follows differences to the retained source records and edits the next selected interpretation as a new edition. TJLabs attribution and original source notices travel with the product.

## Start with the full source

Use Python 3.11 or later with standard-library SQLite and the selected IANA timezone data available. The calculator uses standard-library fractions, decimal parsing, offset-aware datetimes and ZoneInfo; it makes no network call or paid hosted computation request.

Keep these sibling files together: discovery_engine.py, discovery_cli.py, water_reconciliation.py, water_report.py, README.md, OPERATOR_GUIDE.md, WATER_RECONCILIATION.md and WATER_SELECTION_API.json. The complete source distribution also includes the original engine's examples/receiving source and the water examples plus receiving_water.py. Those examples are explicitly invented software commissioning inputs.

    python receiving_water.py --directory /private/water-commissioning

The course runs two whole source editions, keeps every selected original row, exercises a physical-meter replacement across a 25-hour calendar day, records an actual source gap and numerical variance in the first edition, runs the corrected later edition, and retains an unresolved negative billed adjustment. It packs the real native case, receives it into another directory and runs the actual received application against its original CSV snapshots. It compares the full reopened outcomes and ensures an edited derived member cannot be packed as the earlier edition.

The native course creates actual report.html, result.json, source files, comparison, ZIP and cold receiving outputs. Open those actual files in the equipped browser. Operate the report on desktop and a narrow screen, inspect complete period and issue detail, use its retained-source links, and print/export the actual report. View the captured pages and reopen all delivered files before reporting an operated customer journey. A source review or the presence of an HTML file does not establish that visual work.

## Receive a real authorized population

Follow the original OPERATOR_GUIDE.md for complete CSV intake. Source exports remain unchanged; the manifest maps their original columns and exact typed/null behavior. The four water roles identify existing source tables and columns. The reviewed selection names the actual account periods, accepted source quality values, unit ratios, comparison tolerances, offset interpretation and billing logic.

    python water_reconciliation.py run \
      --manifest /private/source/manifest.json \
      --selection /private/source/water-selection.json \
      --output /private/water/edition-001

Input-root rules are inherited from the original engine. Use --input-root only to choose an authorized source root. Each output directory is a new complete edition. An earlier edition is preserved when source values, field interpretation, sample membership or billing policy changes.

The selection file is read once. The exact original bytes and parsed selection are retained together. Each result identifies the full source run, every original input, the calculation and renderer source, and the actual selected interpretation.

## Read the complete case

Open water/report.html. The report is an offline industrial case inspector over the complete result. The original source report, retained CSV files and water/result.json remain adjacent in the delivered case. The JSON retains exact numerator/denominator quantities and amounts; the 12-decimal display is a readable rounding of those exact values.

The chain has four independent measurements:

1. Physical-register consumption from the exact boundary readings of each selected physical-meter segment.
2. AMI consumption from the full non-overlapping interval population for those physical meters and endpoints.
3. Separately recorded account consumption from its original source field.
4. Billed consumption and the separately identified water charge.

Missing recorded account consumption stays uncomputed. It is never copied from billed consumption. The report exposes every computed comparison and every missing or ambiguous source interpretation. Numerical differences outside the selected tolerance become actual review entries, so their counts, readable report and review-items.csv agree.

A period may have calculated billing arithmetic while an interval leg is uncomputed. Each quantity preserves its own availability. A complete arithmetic match applies only to the source values, selected rules and tolerances that were actually compared.

## Time, meter and interval interpretation

Original timestamp strings remain in the retained CSVs. Calculation requires explicit UTC offsets. Ambiguous local-only timestamps are resolved from the actual system configuration or source logs before use. Calendar patterns use the selected IANA timezone and actual elapsed time; a fall-back day may have 25 hours.

A period is represented by complete contiguous physical-meter/endpoint segments. A replacement requires the actual removal/installation boundaries and both meters' own register readings. Register multipliers and units must remain consistent inside a segment. A rollover requires an explicit nonnegative integer count and the actual modulus. Negative changes without a source-supported explanation stay uncomputed.

Each interval keeps its original ID and source record. Duplicate IDs, invalid rows, unsupported quality values, overlaps, gaps, intervals crossing selected boundaries and unmatched meter/endpoint streams remain visible. Every interval overlapping the account period must map to exactly one selected segment. The engine never silently fills a missing interval or allocates a crossing interval by duration.

The recipe models one physical meter path at a time within each billing period. A billed account combining simultaneous meters requires a separately reviewed additive composition instead of declaring overlapping sequential segments. Backflow, credits, compound-register transitions and tariff rules outside this explicit contract also require a reviewed extension.

## Units and exact billing arithmetic

Unit conversion uses positive numerator/denominator ratios backed by the original source meaning. All quantity and monetary arithmetic uses exact fractions derived from finite base-ten strings. Currency rounding occurs only at the selected line or total stage. The record preserves the exact amount and rounding decision.

A tariff interpretation identifies original retained evidence rows, its effective application window, quantity unit, fixed water charge, complete increasing tiers, currency precision, quantity-rounding policy and currency-rounding mode. The selected bill carries its explicit tariff application timestamp and fixed-charge factor. Zero fixed charges and no quantity rounding are deliberate inputs.

The calculation compares the selected water charge. Taxes, arrears, penalties, unrelated service charges and credit policies are handled through their own actual interpretation. A combined total bill must not be mapped as a water-only charge. A date inside a tariff window does not by itself establish the correct ordinance policy: the reviewed application timestamp, effective-date method, proration and selected tiers remain part of the source interpretation.

## Describe observed usage without inventing causes

Optional pattern criteria specify the actual local timezone, selected night clock hours, a continuous-flow threshold and minimum elapsed duration. The report includes complete calendar-day quantities, observed night use, minimum/maximum interval flow, adjacent complete-day changes and complete runs above the selected threshold.

Daily quantities remain uncomputed when the selected window is only part of a day, a source interval crosses a calendar boundary or the day cannot be allocated completely. Night allocations preserve crossing-record exceptions. Continuous runs use exact elapsed time and break on gaps or flow below the chosen threshold. Average-flow daily/30-day equivalents are arithmetic projections, with their interpretation included in the result.

These are source observations and descriptive calculations. The prime combines them with actual property conditions, calibrated tests, contrary evidence and manufacturer/system knowledge when assigning an engineering conclusion. The selected account sample does not establish a whole-utility prevalence estimate.

## Correct and compare an edition

Correct the original source or create a later explicit selection. Run it into a new directory. Keep the initial source and its exceptions.

    python discovery_cli.py compare \
      --left /private/water/edition-001/report.json \
      --right /private/water/edition-002/report.json \
      --output /private/water/source-comparison.json

The maintained engine compares complete original keyed populations and preserves ambiguity. Review water/result.json in both editions for the selected interpretations and exact quantities. A different tolerance or tariff is a changed analytical decision, even if the source CSV is unchanged.

## Package and receive the complete usable case

    python water_reconciliation.py pack \
      --run /private/water/edition-002 \
      --output /private/water/Water_Case.zip

Packing checks the complete water delivery members, their exact bytes, original and normalized selection, result/source linkage and both selected calculator and renderer source files. The maintained original packer then verifies source snapshots and its own engine, writes the complete case and includes all required operator code and guides.

    python water_reconciliation.py receive \
      --archive /private/water/Water_Case.zip \
      --output /private/received-water

    python /private/received-water/workbench/water_reconciliation.py run \
      --manifest /private/received-water/manifest.receiving.json \
      --selection /private/received-water/water/selection.original.json \
      --output /private/reopened-water

The full input files, source interpretation, original reports, private readable output and authoring selection remain in the received case. The SQLite working store is rebuilt by the original engine. The native receiving course checks every reopened calculation against the earlier complete result.

## Data handling and approval

The complete case may contain account identifiers, bills and property evidence. It is a private working product. A public report or executive summary is separately selected and reviewed from the actual accepted findings. Retain authorized source access, original provenance and required project ownership notices.

Bryce personally reads and signs contracts and confidentiality agreements. Normal account creation and standard service terms remain subject to his standing authorization. Favorable human commercial replies route to his direct involvement for further exact messages and attachments. These relationship rules do not change the technical source or calculation contract.


## Rendered product inspection — owner instruction, 2026-10-13

This applies to every current, future, resumed and delegated worker, across providers and local or cloud runtimes. Bryce's standing rule is: “that includes all attachments and this does not become review theatre or test theatre you need to literally observe the actual thing the way a user would see and use it”.

Before presenting a client/prospect-facing application, website, dashboard, demo, report, presentation, export or any attachment, the producing peer must open/run/render the exact outgoing version, LOOK at it and normally use it as the recipient would. View the actual screenshots you capture. Inspect the actual presentation/screenshare width and relevant narrow/mobile width, important user controls, populated/empty/loading/error states, downloads and reopened exports. Open the usable contents of ZIPs/projects and every applicable report/PDF page. Source review, schemas, HTTP 200, DOM counts, tests, checklists and another worker's approval cannot substitute for observing and using the actual product.

Fix broken, unstyled, cramped, clipped, overflowing or unreadable output within the authorized work before presenting it. Use plain industrial software design: readable tables, clear hierarchy, consistent typography and spacing, restrained controls, useful labels and responsive layouts. Preserve real workflows, source data and computations. Inspection must lead directly to repairs and continued delivery; it must not replace implementation/integration or become repeated checking. Keep validation focused on the actual remaining risk. Do not run broad test sweeps, repeat accepted checks, build a verification product or create review bureaucracy or an approval queue.

For video and audio, Bryce directs: “also add that if u make a video use voice gen tts not robot voices, use generative stuff we have models, use them”. Use available high-quality generative voice/TTS and useful generative media, with natural professional delivery. Actually watch/listen to the final outgoing export, including pacing, pronunciation, timing and audio alignment. Preserve existing spending, voice and attribution controls.

Include this complete instruction in delegated assignments and the active owner-controlled provider/project/cloud policy, boot, build and receiving guidance those workers actually read. Reuse already updated copies and return exact updated paths/version in the original policy thread with the next substantive result. Delivery of source does not establish that every runtime loaded it. Preserve all other owner controls and original operation identities; leave historical records and third-party/vendor policies intact. This instruction creates no restarts, watchers, credential gate or new release permission and does not revive owner-stopped work. When a runtime is unavailable, join the existing equipped receiver with the complete exact version and opening steps, review its actual rendered result, and continue independent implementation while it runs.

Owner instruction and coordinated propagation: https://tokenjunkielabs.slack.com/archives/C0BU51F1PL3/p1791881496221999
Canonical attachment/media clarification: https://tokenjunkielabs.slack.com/archives/C0BU51F1PL3/p1791885532614949

## Offline water case inspector

Open `water/report.html` inside the completed case, or its downloaded `Water_Case_Inspector.html`. This is a self-contained application for the **saved selected result**, source report and original canonical manifest. It needs no server, network, account or browser extension. TokenJunkieLabs (TJLabs) attribution remains in the report and all downloaded report copies.

The inspector is a view of the engine's result. It does not rerun water calculations, change the selected source, approve a field finding, edit a bill or make a refund decision. A blank calculation is displayed as **Uncomputed**; a calculated zero remains zero. Every volume/charge value uses the original exact rational and its engine-supplied twelve-place decimal display. Enable **Show full exact fractions** to inspect the numerator/denominator beside each value. Chart coordinates alone use approximate browser numbers.

### Review the complete selected case

The four cards always describe the complete case. Search and account/status filters select the visible periods; the visible count identifies both the filtered and full populations. Filtered overview CSV is explicitly a presentation export, with formula-leading cells escaped. Complete JSON and HTML downloads retain every period regardless of filters.

- **Period overview:** select a period and inspect the separate register → AMI → recorded account consumption → billed quantities. Open every coverage/exception item, exact period source record, physical-meter segment, boundary register and complete interval reference list. Source references are paged in groups of forty; no records are dropped. Period lists are paged in groups of forty.
- **Exact comparisons:** inspect the native saved tolerance decisions, including missing/uncomputed comparisons. A second pair selector compares any two visible periods using their original quantities, exact boundaries and rational right-minus-left subtraction. It applies no duration normalization and makes no new tolerance or field decision.
- **Water charge review:** inspect the selected tariff, fixed factor, each tier quantity/rate, exact component amount, line-versus-total rounding, original billed water charge and the native saved difference/decision. Water-charge scope does not silently include taxes, arrears, penalties or unrelated charges.
- **Daily & flow patterns:** select the original period, local dates and chart quantity. All filtered days are plotted; the table is paged in groups of thirty-one. Actual 23/24/25-hour days, incomplete daily allocation, night-crossing records, adjacent-complete-day differences and continuous runs retain their original meanings. The continuous-run table can show all runs or only runs meeting the selected duration; all original runs remain embedded. Patterns may be COMPLETE, NOT_SELECTED or UNCOMPUTED. No synthetic zero, interpolation or leak conclusion is introduced.
- **Sources & definitions:** inspect the complete original table definitions/profiles, full source report, original manifest, interpretation/recipe identities and all source links. Open the original water selection to inspect its complete quality/tolerance/unit/tariff interpretation.

A missing or ambiguous selected period can have no known account, timestamp or source row. It remains a visible review item with uncomputed quantities. Do not interpret the known-account count as including unresolved account identities.

### Read exact retained source records

The report is stored at `case/water/report.html`. A source link points to the existing `../inputs/<table>.csv`; original/canonical/receiving manifests and the source report remain in the parent case. Retain this directory layout when sharing the **complete case**. A separately downloaded HTML embeds all calculations and provenance, but cannot carry CSV bytes that were never passed to the renderer.

Click a table/record button to open its original identity. Record numbers count CSV data records after the header, not physical lines; a quoted multiline record is one record. Choose the retained CSV in the source dialog to read raw values. The inspector checks the complete file byte count and SHA256, then checks decoded headers and record count against the original profile before showing values. The file stays in browser memory and is not uploaded or included in a subsequent report download.

Browser drilldown supports exact UTF-8/UTF-8-with-signature, ASCII and Latin-1 source decoding. Other encodings, unsupported CSV dialects or a browser without SHA256 support remain available through the original native case reader and direct original-file link. An unverified or differently decoded source is never displayed as the original. Record numbers outside the actual retained population are explicitly absent.

### Complete downloads, reopening and keyboard use

**Download complete offline report** saves the entire embedded case plus current view settings. Open that downloaded file in a new browser page: the view is rebuilt from the original embedded inputs. No localStorage, IndexedDB or server state is needed. Source-file selections are intentionally transient; select the exact original CSV again after reopening.

**Download embedded case JSON** contains three complete JSON-text documents under `result_json`, `source_report_json` and `original_manifest_json`, with schema `tjlabs.water-reconciliation.offline-report.v1`. The JSON texts preserve exact numeric strings and integer tokens without JavaScript reserialization. Individual complete result/report/canonical-manifest downloads are also available. The byte-exact original manifest and selected interpretation are linked separately from the full case. This JSON is an inspection export, not a substitute for the engine's complete handover ZIP.

Use Tab/Shift+Tab for controls, Left/Right or Home/End within the section tabs, Enter/Space for buttons and disclosure sections, and Escape to close a source dialog. Focus returns to the source-reference button. At narrow widths, controls and quantity cards stack; wide exact tables retain horizontal scrolling. Print exports the **current view**, labelled accordingly; complete HTML/JSON and case ZIP preserve the entire selected population.

### Renderer interface and receiving

`render_html(result, source_report, original_manifest) -> str` accepts the actual loaded JSON objects and returns UTF-8-compatible HTML text. It validates the water/source run binding, original data class, complete source inventory and original canonical manifest identity. It serializes caller input without editing it, embeds it with HTML-significant characters escaped, and applies a restrictive inline-script/style content security policy. No arbitrary source URL becomes an executable or external link.

The original atomic water course calls this function and retains the exact `water_report.py` byte hash in `result.recipe_files`. Keep that selected renderer beside the original calculator when packing. For an additional inspection copy, the same source also supports:

```bash
python water_report.py \
  --result /absolute/case/water/result.json \
  --source-report /absolute/case/report.json \
  --manifest /absolute/case/manifest.json \
  --output /absolute/new-inspection.html
```

The output must be a new filename. A separately placed report still displays its entire embedded case; source links resolve correctly when it is kept in the original `water/` directory. Do not overwrite the engine-bound `report.html` after the delivery manifest is written; make a new inspection copy or a new complete engine edition.

The existing receiving owner should open the actual generated report at desktop and narrow widths, operate every main view and the source dialog, inspect actual rendered screenshots, download the complete HTML/JSON/filtered CSV, and cold reopen the downloaded HTML. Verify that incomplete/missing periods remain visible, exact source references survive, and filters do not truncate complete downloads. Source/syntax review is separate from this actual rendered receiving outcome. Use the original coordinated receiving queue, preserving selected user tabs and current owner browser instructions.

### Operate the actual generated reports with the existing browser receiver

The adjacent `receiving_water_browser.mjs` consumes the original native course's completed `receiving.json`. It does not create another dataset or rerun a water calculation. Use the receiver's actual installed Node, Playwright module and Chromium paths:

```bash
/actual/node receiving_water_browser.mjs \
  --receiving /absolute/original-water-receiving/receiving.json \
  --output /absolute/original-water-browser \
  --playwright /actual/installed/playwright/index.mjs \
  --chromium /actual/installed/chromium
```

The Playwright module must expose `chromium`; the existing Python Playwright installation's actual `driver/package/index.mjs` may be used if that installed module is present and the selected Node can import it. This helper performs no dependency installation. Keep its output outside the immutable `a/`, `b/` and `cold/` case directories.

An interrupted browser course resumes with the **same arguments and output directory plus `--resume`**. Its exact original receiving/report/helper/runtime selection must match. It preserves incomplete attempt directories and retires a prior lock only when that lock is from the same host and its original PID is observably absent; an active/foreign owner stays authoritative. Mutable progress and completion receipts publish atomically. A completed course is reused only after every saved artifact's full bytes and SHA256 is checked.

The helper operates filters, all five views, verified original CSV record loading, keyboard section selection, desktop and 390-pixel layouts, complete HTML/JSON and filtered CSV downloads, downloaded-HTML cold reopening, current-view PDF printing, and the already-generated later/native-cold report files. It saves full screenshots and exact artifact identities. `BROWSER_COURSE_COMPLETE` records those functional actions; `visual_review` remains `PENDING_ACTUAL_SCREENSHOT_AND_EXPORT_VIEWING` until the receiving owner actually opens/views all PNG/PDF/exported files under `VIEWING.md`. Carry the actual viewed result into the same original receiving thread, not a second operation.
