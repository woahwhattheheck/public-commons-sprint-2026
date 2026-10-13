# Food-security source and production guide

This source arm extends the existing OACAA report-data workspace. It adds complete current child food-insecurity observations for all 88 Ohio counties, statewide overall and child observations, the received nine-county historical series, and a same-year correction comparison with the original report. The original programme, report revisions and saved member proofs remain in the same workspace.

## Source periods and population meaning

The current primary source is Feeding America's Map the Meal Gap 2026 release, using 2024 data. Each county page is selected explicitly for 2024 and the child population. Child means under age 18. The statewide overall row includes children and adults, so it overlaps the child row.

The source reports child counts and rates independently. Preserve both and do not infer an exact child-population denominator by dividing rounded values. County estimates are separate from the statewide estimate.

The child income categories show shares of food-insecure children above or at/below 185% of the federal poverty level. The original report's Table 10 contains another percentage whose denominator is all children. They are different variables. Neither measure establishes actual programme enrollment or all eligibility requirements.

The Ohio overall page displays a 130% SNAP income threshold and publishes 60% above and 41% below it. Keep those published rounded values. Their sum is 101%; changing either would alter the source.

Average meal cost and annual food-budget shortfall belong to the entire selected geography and overall population, even when displayed on a child page. They are not child-only costs or SNAP benefit amounts.

## Original-report corrections

The original report Table 13 has a 2024 heading, a 2022 source footer, and prose comparing 2021 with 2023. Its Ohio values—517,450 children and 20.1%—match the 2023 source. The concordance preserves that original observation with its resolved year. The current working chapter uses the received 2024 values.

Feeding America's 2026 technical brief says the prior 2023 county estimates used 2022 unemployment data. County overall, child and income-eligibility estimates were revised. Statewide and congressional results were unaffected. The correction dataset compares the original OACAA Table 10 with the current received 2023 redistribution for nine Northeast Ohio counties; it is not a 2023-to-2024 trend.

The original SNAP participation percentage is labeled 2025 and cites monthly Ohio JFS statistics without identifying the month. It is retained in the original-source concordance. It is not converted into a 2024 food-insecurity estimate or a current monthly participation rate.

## Exact source and rebuild

sources/FOOD_ORIGINALS.json retains the selected statistical observations, original URLs, whole-reader-response byte counts and SHA-256 identities, the selected original-report rows and the complete HCI historical CSV. The full original reader responses remain retained in the source working archive. The public package excludes repeated website navigation and explanatory prose. FOOD_SOURCE_MANIFEST.json distinguishes the original-response identity from each extracted observation and records its exact source locator. A reader response is identified as such, rather than called original HTML.

food_reporting.cjs extracts complete reader inputs by their selected year/geography summary and excludes loading placeholders. It also accepts the clearly labeled statistical observations shipped here, checks their selected identity, population, numeric fields and original-response hash, requires all 88 distinct county identities, and compares the nine overlapping 2024 counties with the independently received CSV. It retains all 108 historical records and blank count cells.

From this production directory:

    node food_reporting.cjs sources/FOOD_ORIGINALS.json datasets
    node food_plan.cjs .

The first command rebuilds all four exact dataset JSON files, their CSV companions and FOOD_SOURCE_CONCORDANCE.json from the retained inputs. food_plan.cjs creates the report-data plan, exact source manifest and source lock from those actual dataset and source bytes. It also exposes buildPlan, buildSourceManifest and buildLock for the existing source assembly. CSV companions use the declared column keys and preserve empty unavailable values. Text cells that could be interpreted as spreadsheet formulas receive a leading apostrophe; the dataset JSON retains the exact source text. The saved food-source-lock.json identifies the shipped sources and dataset exports. For a new release, prepare a new reviewed plan/lock identity; do not silently replace a completed plan's inputs.

The source rebuild above runs independently with Node.js and the retained files; it does not need the installed publisher. To use this cohort in that publisher, run the original commissioning command as documented in its WORKING_EDITION.md. It calls acs_working.extend with food-working-plan.json, food-source-lock.json and food-working-edition.json, then creates the source-bound member programme through the existing member_programme function. Original completed commands replay with their retained identities.

## Staff corrections in the installed workspace

Open the existing Report data desk and choose the selected food dataset. Inspect the original source metadata, geography, period, column definition and exact cell before editing. Save the new dataset revision with a clear correction note.

Use the original mapping preview to compare the changed table or chart with the currently saved report block. Choose preserve or replace for explicitly identified staff changes and apply the reviewed result. The saved source revision and mapping are frozen into the report's supplemental sources.

For member graphics, open the dataset's related member bindings. Preview the selected source cell against the current post and its originally managed fields. Keep or replace each changed staff field explicitly. The update changes only the selected post's managed source reference; other posts keep their own retained source revisions. Existing proof and approval history remains visible, while the actual native fingerprint determines whether a new proof is required. Nothing is published or scheduled automatically.

Member captions name the population and 2024 measurement year. A county card uses its own county row and URL. Selecting another county is an explicit mapping change, not a side effect of editing a statewide source.

## Receive and inspect the actual deliverable

Use the same original OACAA native operation and current complete source capsule. The original commissioning command imports the cohorts, creates their report mappings, renders the actual member PNG/SVG proofs and digital/print report editions, exports the complete installed workspace, and reopens it through Store.import_handoff.

Open and view every outgoing PDF page and member graphic. Check actual desktop and narrow-width Report data and report editor screens. Operate dataset save, mapping preview, explicit apply, member keep/replace, proof, edition download and export/reopen controls on the actual saved workspace. Confirm that a restored edition retains its original bytes and source references. Record findings and fix the same source before presenting the product.

The complete handover retains the original source representations, all editable datasets, transformation source, report plan, source lock, source-bound member programme, saved history, actual PDFs/graphics and the installed workspace archive.
