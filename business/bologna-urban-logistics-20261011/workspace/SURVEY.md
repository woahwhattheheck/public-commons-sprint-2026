# Survey analyst workspace

Open the **original Bologna assessment server**, then choose **Survey analyst** (`/survey`). The survey application uses the same `workspace.json`, revision admission, exclusive mutation lock, immutable publications, export manifest and backup/restore as the street and delivery workspaces. It requires only the Python standard library and a browser.

## Operating sequence

1. **Questionnaire.** Edit the Italian introduction, fixed-schema question wording, organization-provided privacy notice and source/municipal review references. Save a new questionnaire version. Its ID and cohort stay attached to every imported response. Open the printable instrument and download the blank CSV and data dictionary from the same screen.
2. **Import.** Select the actual UTF-8 CSV. Preview shows each row, its physical ending line, normalized proposed response, current record, validation problems and NEW / SAME / CORRECTION / INVALID status. Select valid additions with the explicit button; review corrections individually. Every row requires `add`, `replace` or `skip`. Supply a reviewer, reason and the non-identifying-source review before committing. The preview binds exact file bytes, current response hashes and workspace revision. Any intervening write requires a new preview.
3. **Response review.** Search and page retained responses, open their exact source and correction history, include/exclude with a recorded reason, maintain bilingual theme codes and code original observations. Select evidence records to retain bilingual findings with the original scenario and decision IDs. Corrections preserve previous records and mark dependent coding/findings for review.
4. **Analysis.** Choose a cohort, street and role. Read the answered denominator and missing count for every question. Download Italian/English report inserts and a CSV/JSON/HTML package. Publish the full assessment through the same application's publication control; select that publication to reopen the exact frozen survey analysis after later corrections.
5. **Collection record.** Record the stakeholder population, source/municipal reference, collection dates and the single Municipality-coordinated reminder round. This is an operational record; the software does not send invitations or reminders.

Unsaved form edits remain on screen when changing tabs. A failed mutation leaves the input intact. Refreshing saved state warns before discarding unsaved edits. The server should remain on its original loopback/private operator interface; this is an analyst workspace rather than a publicly exposed questionnaire endpoint.

## Cohorts and the procurement target

The current campaign starts with cohort `current`. Each retained questionnaire declares its own `cohortId`; imported rows inherit it, and optionally retain `collectedOn` as `YYYY-MM-DD`. The **30–50 completion target counts included, completed responses in the selected campaign cohort**, independent of the analysis filters. Historical responses do not automatically contribute to that target. The all-cohort analytical view is an explicit selection and is labelled as combined.

Bologna's official 27 July 2026 announcement describes an earlier merchant questionnaire covering Indipendenza, Ugo Bassi, San Felice, Lame **and Riva Reno**, under Shift2Zero. Retain a prior instrument under a separate cohort such as `shift2zero-2026` when its actual questionnaire and results are supplied. Its mapped answers, collection dates and source references remain distinct from the new study. Use cohort-prefixed pseudonyms if two cohorts use the same source respondent code: an ID already assigned to a different cohort cannot be silently replaced. Reconciliation or reuse is an inception decision recorded with the Municipality.

The proposed instrument is an editable working draft. The existing July questionnaire's actual wording and completed responses are not bundled. The source announcement describes its subject and cohort, not the contents of any individual response.

## CSV contract

The data dictionary is generated from `survey.schema()` and exposed at `/api/survey/schema`. The same source generates the template, import validation, questionnaire choices and browser labels. Required headers are `respondentId,questionnaireId,language,consent,complete,role`; optional typed columns are `streets,deliveriesPerWeek,vehicleTypes,timeWindows,constraints,preferredMeasures,note,collectedOn`.

- IDs are pseudonyms using letters, digits, `_`, `.`, `:`, `-`; never names or email addresses. IDs identify one current response. Repeated source imports are recognized, and unchanged rows can only be skipped. Unknown headers, including accidentally supplied contact columns, are rejected. Operators also review free text before retaining the file.
- `language` is `it` or `en`; booleans accept `true/false` or `1/0`. Consent is required by the original workspace. A complete response requires a role and at least one declared street. Incomplete responses can retain missing fields without contributing to the completion target.
- Multi-select fields use a pipe between declared codes inside a normal quoted CSV cell. Codes are deduplicated per response. `none` and `not_applicable` are mutually exclusive with substantive answers in the same question.
- Delivery frequency accepts an integer from 0 to 10,000, or an empty cell. Empty is missing; zero is an observed zero. The quantity is reported typical-week deliveries made or received by that respondent, and may overlap another respondent's count.
- CSV is UTF-8, including optional BOM, with comma delimiter and standard quoting. A reviewed import accepts up to 512 KiB / 1,000 rows; further batches use the same workspace. Original bytes, hashes, physical line references and the selected row decisions are retained inside the existing backup. Correction and inclusion history remains private operator material.

## Interpretation and export

Every categorical table contains eligible, answered and missing counts. Percentages use respondents answering that question, not the count of selected options. Empty denominators produce `null` in JSON and blank/“—” output rather than a fabricated zero. Multiple selections and overlapping street populations are non-additive. Legacy original single-entry responses remain readable as complete in their original questionnaire; absent added questions remain missing.

Delivery statistics report the number answering, missingness, mean, median and range of supplied frequencies. They do not estimate unique trips or traffic demand. Theme percentages use currently coded, eligible responses; a code attached to an earlier response version is excluded until reviewed again. Findings retain their own explicit evidence selection and do not become street-filtered claims simply because the table view changes.

The frozen report includes aggregate tables, questionnaire/source identities and analyst-authored findings. It omits raw CSV, respondent IDs and unreviewed response notes. Publication is an internal report snapshot; inspect it before external sharing, especially small groups and analyst-authored text. CSV exports neutralize formula-like text cells for spreadsheet opening. Exact original text and CSV bytes remain in the private source records.

Downloads:

- `survey-analysis.json` and six question tables;
- delivery-frequency and theme tables;
- reviewed findings with scenario/decision references;
- Italian and English HTML inserts;
- a manifest with exact bytes and SHA-256 for every exported member.

The original full assessment export also includes these files. A selected earlier publication is verified against its original report digest before export. Older publications created before survey analysis was installed remain intact and report that they have no survey snapshot.

## Command line

Run from the original `workspace` directory. Replace private paths and source selections with the actual retained files.

```sh
python survey_cli.py schema --out /private/survey-schema.json
python survey_cli.py template --out /private/survey-template.csv
python survey_cli.py --state /private/bologna questionnaire --out /private/questionnaire.html
python survey_cli.py --state /private/bologna preview \
  --source /private/received.csv --out /private/review.json
```

Review every row and prepare a decision object keyed by preview row number, for example `{"1":"add","2":"skip","3":"replace"}` only when those actions match the actual preview. Then:

```sh
python survey_cli.py --state /private/bologna import \
  --source /private/received.csv --review /private/review.json \
  --choices /private/decisions.json --reviewer 'Assigned reviewer' \
  --reason 'Reviewed actual incoming source and selected corrections' \
  --non-identifying-reviewed
python survey_cli.py --state /private/bologna analyze \
  --cohort current --out /private/survey-analysis.json
python survey_cli.py --state /private/bologna export \
  --cohort current --out /private/survey-report
python server.py backup --state /private/bologna --out /private/bologna-backup.zip
python server.py restore --archive /private/bologna-backup.zip --state /private/bologna-restored
```

Use `export --publication ORIGINAL_ID` for a retained publication, or `source --id ORIGINAL_IMPORT_ID --out /private/exact.csv` for the original bytes. `action --json /private/action.json` accepts an explicit `survey.*` action with the original `expectedRevision`, reviewer and action fields; the same `model.apply_action` performs admission and persistence.

## Integration surface

`survey.apply(state,payload)` executes inside the existing `model.mutate`, returning the original event result. `analyze` is a pure read; `export_tables` accepts that analysis snapshot, and `render_report` formats it in IT/EN. `view`, `preview_import`, `source_bytes` and `publication_analysis` serve the operator. `survey_http` attaches to the original handler, keeps its JSON response helpers and does not start another server. `survey_cli` calls the same model.

`report_payload` adds the aggregate snapshot at `report.survey.analysis`. Original publication and backup paths therefore retain questionnaires, raw captures, corrections, coded evidence and the exact report without a second state engine. `survey.responses` is the sole current-response list; the module's other records live under the same `survey` object. There are no extra background workers, hosted workflows, accounts or external dependencies.

## Source references

- NetZeroCities / Climate-KIC RfP SGA3-MCCC-029, original pp. 12–13 and 18–19, published October 2026: https://netzerocities.eu/wp-content/uploads/2026/10/NZC-CESF-Procurement-RFP-SGA3-MCCC-029-Bologna-Urban-Logistic.pdf
- Municipality of Bologna, “Tram, un questionario per la gestione delle merci in centro”, published 27 July 2026: https://www.comune.bologna.it/novita/comunicati-stampa/tram-un-questionario-la-gestione-delle-merci-centro
- Existing product and source custody: original PR1198/1199 and the canonical Bologna workshare thread in #sales, parent `1791748335.881659`.
