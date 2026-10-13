# Saved Chemistry analysis in Scientific Reports

A completed Chemistry scientific report can be used directly in the existing
ordered Scientific Reports composer. This publishes a verified source document,
its full original report and editable project, readable result tables, and the
original numeric figure specifications. The composer provides the combined HTML,
PDF, saved edition and delivery archive.

## Existing desk workflow

1. Open the original completed run in **Reach chemistry** and prepare its
   scientific report. The saved report retains the original run and case.
2. Open that saved report and choose **Prepare report source**.
3. Open the returned retained source and choose **Open scientific report**.
   The maintained Sources desk adds that exact source collection/document to its
   ordered selection. Existing selected studies, report title and contact remain
   in that form.
4. Preview and save the scientific report with the existing composer. Use its
   original export and reopening controls.

Each completed mode has its own scientific source. Simulation, calibration,
uncertainty and local chemical monitoring remain separate original analyses.
A combined report can include them in an explicitly chosen order.

## Scientific content and interpretation

The source begins with the actual project provenance, species bases, original
duration, mode, producing engine, source references and exact request/result
checksums. It retains original elapsed solver time when present. A project whose
provenance says it is an authored reference keeps that text beside the result
identity.

Physical concentration is expressed in milligrams of the species' **declared
conserved basis** per litre. For a nitrogen-basis species this means elemental
nitrogen mass, rather than the molecular mass of ammonium or nitrate. Initial
stocks and integrated transport/reaction quantities remain kilograms of that
declared basis. Input loads remain kilograms per day, flows cubic metres per day,
and reaction coefficients inverse days. Model time retains the original project
origin and duration.

**Simulation and source attribution.** Full-duration budgets retain initial,
added, stored, exported and untracked-sink masses and original conservation
residuals. These integrated masses are not converted to annual loads. Original
final states, every saved sampled state, boundary exports and reaction transfers
remain available as complete tables. Concentration figures group original
sampled states by species and reach, with the same physical scale across the
reach panels. Lines connect retained output times for reading and add no
calculated states. Source attribution retains the original source-superposition
closure.

**Parameter fitting.** The source retains original convergence, termination,
loss, cost, evaluation count, parameter bounds, active bounds and identifiability.
Fit and held-out roles are unchanged. Original RMSE and mean modeled-minus-
reference bias use exact-valued records only, matching the original engine.
Below-limit references remain in the full table with their qualifier, original
limit, assumed error scale, objective residual and provenance. The original
one-sided exceedance penalty remains explicit; the report substitutes no fraction
of a detection limit.

The figure uses one point per exact-valued reference record, filled fit circles
and open held-out squares, with identical reference/prediction axis ranges for
that species. The equality line has no fabricated endpoint observation markers.
Held-out means excluded from fitting; the original source and sampling design
determine empirical independence. The retained noise-free REACT12 recovery
reference continues to identify its authored origin.

**Local sensitivity and chemical monitoring.** Forward-tangent derivatives,
original parameter units and elasticities remain those in the saved result.
The chemical monitoring section retains each selected candidate's reach, species,
day, assumed error scale, prediction and information gain. Prior and resulting
linearized precision matrices use the original parameter order; each entry has
units equal to inverse products of the corresponding parameter units. This local
coefficient-information design is distinct from the regional Monitoring desk's
budget, visits and fieldwork programme.

**Parameter-prior uncertainty.** Completed draw count, random seed, parameter
bounds, complete original distribution declarations and latent Gaussian
correlation remain visible. The correlation specification is in latent space;
transformed physical parameters can have another Pearson correlation.
Pointwise figures retain the original 5th/50th/95th percentile at each requested
reach, species and model day. Vertical segments show the central 90% range of the
supplied parameter draws and diamonds show their median. These are pointwise
parameter-prior summaries, not a simultaneous band or an interval for measurement
error. Uncertain quantities absent from the original request are outside them.

Every table shown in the combined report has an accompanying complete CSV.
The readable report shows up to twenty rows per table and states the full row
count. CSV numeric values retain their numeric values; formula-like text fields
are protected for spreadsheet opening. Exact original values and provenance also
remain in the unchanged JSON artifacts.

## Original schema and API

The source module is:

    model/chemistry_report_source.py

Its public API is:

    prepare(workspace, report_id)
    inspect(workspace, source_record_id)
    list_saved(workspace, report_id=None)
    verify_workspace(workspace)

The input is an already completed record from model.chemistry_reports. Preparing
the source calls the original report verifier, copies original verified artifacts,
writes readable tables and figures, and imports the maintained upstate.sources/v1
document/companion manifest. It neither invokes the numerical model nor changes
the original run, request, result, source report or parameter selection.

The native saved collection is chemistry-report-sources, with the Workspace
schema upstate.chemistry-report-sources/v1. Record fields include id, edition,
state, title, mode, report_id, run_id, case_id, source_collection_id, source_id,
figure_count, companion_count, selection, source_stamp, directory, files and
manifest. The files mapping and manifest descriptor are relative to directory.

The source document is upstate.observed-report/v1, role OBSERVED_CONTEXT,
metadata.report_schema upstate.observed-report/v1. Its original source selector
is exactly:

    {"source_collection_id": RECORD.source_collection_id,
     "source_id": RECORD.source_id}

The existing composer consumes that selector through its ordered sources field.
The source producer retains native_chemistry_report with the exact original
run/case/report, producer identity and original source stamp. The retained figure
specification uses upstate.scientific-figure-spec/v1 and the maintained
scientific_figures line/scatter/marker conventions. The same numeric specification
drives the portable SVG and existing PDF vector renderer.

The unchanged native dispatcher exposes:

- chemistry.report.source.prepare with {"report_id": ACTUAL_SAVED_REPORT_ID};
- chemistry.report.source.get with {"source_record_id": ACTUAL_SOURCE_RECORD_ID};
- chemistry.report.source.list with {} or {"report_id": ACTUAL_SAVED_REPORT_ID}.

Use the existing queued action course in the desk. The original standalone
source module is also callable from the installed application:

    python -B -m model.chemistry_report_source --workspace ACTUAL_WORKSPACE \
      prepare --report ACTUAL_SAVED_REPORT_ID

    python -B -m model.chemistry_report_source --workspace ACTUAL_WORKSPACE \
      inspect --id ACTUAL_SOURCE_RECORD_ID

    python -B -m model.chemistry_report_source --workspace ACTUAL_WORKSPACE list

## Complete retention and reopening

The source output is under:

    Workspace/chemistry-report-source-exports/SELECTION_ID/

It contains the original saved report tree beneath dossier/, including
report.html, scientific-summary.json, manifest.json, scientific-report.zip,
editable-chemistry.zip, the saved report record and every original case/run/result
artifact. Tables and original numeric figure specifications are separate members.
The document observed-report.json declares every exact input with byte length
and SHA256. sources.json imports that document and every companion together.

The immutable selection binds the Workspace, original saved report ID and record
hash, source stamp, producer edition and producer source hash. Repeating the same
operation reopens its verified retained source. A changed producer receives a
distinct selection identity. Inspection verifies the original report again and
compares the imported document and every original companion against the retained
file inventory. Existing saved editions retain their own source identities.

The regular Workspace archive includes the source-output directory and native
saved collection. The Chemistry restore verifier checks these records through
verify_workspace. The regular Scientific Reports exporter retains the full
typed source and companions for a self-contained combined report. The nested
editable Chemistry ZIP remains available for the original Chemistry
receive/import workflow.

## Existing regional receiving course

Continue the original completed DD6B/640a regional Workspace. First prepare and
inspect each of its four already-completed Chemistry scientific reports using
model.chemistry_reports. Then publish a source from each returned real report ID.
Return those exact source selectors to the existing ordered Scientific Reports
composer, retain the saved combined HTML/PDF and archive, and reopen the same
source/Workspace through the existing transfer course.

Record original result checksums before and after this presentation operation,
the actual saved report/source/composer IDs, elapsed rendering time and original
source provenance. A rendering or source-binding exception belongs to the same
active native receiving operation and is repaired against its concrete output.
