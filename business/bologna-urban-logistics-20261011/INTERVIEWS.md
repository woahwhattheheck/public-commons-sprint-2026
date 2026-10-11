# Bologna: municipal interview analysis and validation

This module completes the interview-note and municipal-validation work inside
the existing Bologna analyst workspace. It supports the supplier's analysis of
notes supplied by the Municipality, the structured findings used in D1–D3, and
up to two Italian public-meeting material sets. It uses the original
`workspace.json`, mutation lock, revision, publication and backup implementations.

## Start and complete the operator flow

Start the existing Python server and open `/interviews`. The top link returns to
the original baseline, street-plan, scenario and survey workspace.

1. **Sources.** Give each municipal note a stable code. Enter its source
   custodian, transmission reference, receipt date, known interview date,
   stakeholder group and street/scenario context. Attach the original file and
   supply the exact text to analyze. Text files can populate the text field
   directly; PDF/Word bytes and the supplied extraction remain separate.
2. **Preview, then import.** The preview displays original-byte and text hashes,
   the prior edition and whether the request is new, identical or a correction.
   Confirming a correction requires the current source ID. Earlier editions and
   their excerpts remain intact. One original file is limited to 250,000 bytes;
   its analysis text to 150,000 characters, within the original server body limit.
3. **Excerpts.** Select an exact passage in the retained text or paste it into
   the excerpt box. Repeated text uses an explicit occurrence number. Record
   the original page/section, analytical themes and a separate interpretation.
   The backend records code-point offsets and line numbers against that exact
   text edition; it does not approximate a passage match.
4. **Findings.** Write the Italian and English finding, distinguish observation,
   contradiction, unknown and proposal, then attach excerpts as supporting,
   challenging or contextual evidence. Select the original streets/scenarios.
   Editorial states are draft, ready and withdrawn. Changes retain prior versions.
5. **Validation.** Prepare an analyst response or record a municipal decision
   from an acquired note. A municipal record includes its decision source,
   date and precise reference. Each disposition remains tied to the finding
   version it assessed. Later finding edits show that the decision needs
   reconciliation; they do not silently rewrite the decision.
6. **Meeting materials.** Select one of two editable Italian material sets,
   adapt the purpose/audience/questions, choose findings and original scenarios,
   then download a standalone HTML presentation. The materials contain the
   source context, selected findings, alternatives, questions and decision log.
7. **Reports and continuation.** Download the IT/EN report, theme and finding
   CSVs, analysis JSON and saved meeting sets. Freeze a publication through the
   original publication action. Its historical report and archive reopen from
   that exact analysis even after source corrections. Original backup/restore
   retains all note bytes, text, excerpts, previous revisions and operations.

The operator retains an uncertain interview save in its browser session. Reload
reads the original operation ID; **Riprendi salvataggio** continues the unchanged
request against the existing operation record. Successful repeats resolve to
the original record. The host still advances its ordinary workspace revision.

## Reading the analysis correctly

The denominator in the theme table is the number of current, included **source
documents**. Several documents may concern one stakeholder; one document may
contain several participants. These counts describe the retained qualitative
corpus. They do not become unique-participant counts, survey responses,
population percentages, weights or scenario ratings.

Each theme counts a source document once even if it contains several coded
excerpts. Street membership can overlap; street rows are not a partition to
sum. A corrected source edition replaces the previous edition in current
coverage, while a finding that used the earlier edition keeps that precise
reference and displays a historical-evidence flag. An explicit source exclusion
records its reason and recorder without deleting the source or existing findings.

The report omits original note text and excerpts marked `INTERNAL` or `SUMMARY`.
The analyst's bilingual finding and exact source/version/line references remain
visible. `PUBLIC_QUOTE` is an explicit selection that includes the excerpt text
in the report. The private native backup contains the complete original corpus.

## Original scope and prepared analysis method

The retained original is [NetZeroCities RfP SGA3-MCCC-029](https://netzerocities.eu/wp-content/uploads/2026/10/NZC-CESF-Procurement-RFP-SGA3-MCCC-029-Bologna-Urban-Logistic.pdf),
published 7 October 2026. Its actual requirements were read from the retained
29-page PDF in the original source packet `F0C8G8THNL9`.

| Original task | What the module supplies |
| --- | --- |
| §3.4.1, 1.2, p.12 | Source-linked analysis of notes the municipal team shares; contrasts, gaps and assumptions feeding the baseline. |
| §3.4.3, 3.4(i), p.13 | Structured feedback from interviews into original findings and scenario/street references. |
| §3.4.3, 3.4(iii), p.13 | Up to two editable Italian sets of nontechnical public-meeting material for the Municipality. |
| §3.4.3, 3.4(iv), p.13 | Proposed responses, documented municipal dispositions and versioned follow-through for final validation. |

Use these questions when reviewing a supplied note:

- Which delivery operation, street, period and time window is described?
- Is the statement an observation, stakeholder account, estimate or analyst assumption?
- Which original source supports the loading-space, permit, vehicle or access statement?
- Does an apparent disagreement concern different dates or groups, or genuinely conflicting accounts?
- Which operating condition affects a scenario: service, time, space, consolidation, vehicles or responsibility?
- What source or municipal decision would resolve the uncertainty?

The Italian guide and corresponding prompts are part of the operator. They are
an authored analytical method. Real interview text enters through the source
intake. The survey owner retains the questionnaire, cohorts, responses and
survey-analysis module. The D3–D5 owners retain the original street/roadmap,
learning-note, factsheet and CESF products. Commercial owner **5403** retains the
FIT Consulting relationship, proposal and original sender.

## Composition contract

`workspace/interviews.py` exposes:

| Function | Original-host use |
| --- | --- |
| `apply_interview_action(state, payload)` | Dispatch `interviews.*` inside the existing `model.mutate` operation. Mutates that draft and returns the original event/result shape. |
| `prepare_source(state, payload)` | Read-only POST preview, before the normal mutation. |
| `analyze(state)` | Snapshot saved as `report_payload(state)["interviews"]`. |
| `export_files(state)` | Mapping of exact filename to bytes, merged into the original export manifest. |
| `get_resource(state, path)` | Narrow original-server GET handler returning `(content_type, bytes)`. |
| `schema(state)` | Current codes, limits and source task references. |

Routes on the same server:

- `/interviews` serves `public/interviews.html`; the JS/CSS are additive assets.
- `POST /api/interviews/preview` calls `prepare_source` without advancing state.
- `POST /api/action` retains the host's `expectedRevision` handling and dispatches
  the `interviews.*` action to the module.
- `GET /api/interviews` returns the schema and current analysis.
- `/api/interviews/report`, `/api/interviews/export` return current report/ZIP.
- `/api/interviews/meeting/1` and `/2` return the saved Italian material sets.
- `/api/interviews/source/<source-id>` returns the checksum-verified original bytes.
- `/api/interviews/publication/<publication-id>/report` and `/export` return the
  original frozen analysis and material set, using that publication's scenarios.

Every interview write requires an `operationId` and an `actor`. Record edits
also require `expectedVersion`; source corrections require `expectedSourceId`.
The module stores operation fingerprints in the same state and rejects reuse
of an operation ID for a changed payload. The original workspace revision check
still owns concurrency. The additive route handler neither replaces the
original application server nor adds an external survey/messaging facility.

For the CLI, the original `server.py export` includes the module files. The
standalone report exporter is also available:

```sh
python3 workspace/interviews.py --state /private/bologna-assessment --out /private/interview-report
```

## Delivery and retained native operation

The additive source is `workspace/interviews.py`, `workspace/public/interviews.html`,
`workspace/public/interviews.js`, `workspace/public/interviews.css` and this guide.
`INTEGRATION.patch` contains the minimal original model/server/navigation joins
prepared against DCE4's merged PR1216 current model82116808/server3b37bc5c.
Those joins are included in this release; use the patch as the integration
reference while adding S17's survey workflow to the same cumulative files.

The retained native operation uses the original 264-point/570-space municipal
source and explicitly fictional operator notes. It completed exact note intake,
excerpt coding, finding, proposed validation, both meeting sets, frozen report,
source correction, original-operation recovery and exact native backup/restore.
The frozen archive remains byte-identical across canonical state reload; CSV
evidence references use deterministic key ordering. Original source correction
keeps the historical finding reference and removes its old edition from current
theme counts. The separate native-browser continuation and current complete
handoff retain the actual operator result.

Begin a customer study with the original initialized workspace and its municipal
sources. The separately labeled example workspace provides an internal operating
walkthrough without creating project observations in that new study.

## Retained browser continuation

The same original workspace continued through browser import preview, saved
decision-note linkage, edited/downloaded Italian material, frozen ZIP download
and reopen at revision13. Desktop and390px operator layouts rendered without
body overflow. Direct original HTTP returned the current bilingual report.
The complete original backup restored byte-identical after those saved actions.

The current release composes DCE4 PR1216 directly. A retained revision14
publication contains both the original D3–D5 outputs and interview report,
tables and Italian meeting materials in one package. Its interview
analysis uses the publication revision, and the earlier frozen interview
archive remains byte-identical. The joined original backup restored exactly.
