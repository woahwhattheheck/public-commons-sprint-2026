# ClinicalTrials PRS source workflow

This component joins the existing ClinicalTrials source workspace with genuine Protocol/Results XSD validation, explicit review of NLM's thirteen deprecated tag names, source-aware upload composition, and typed public-registry reconciliation. It keeps original XML, API JSON, review plans, candidate content and native field identities connected through their exact source hashes.

The full direct and command-line contract is in [API.md](API.md). The original three source contracts are retained under [schemas/](schemas/source-contracts.json). [SOURCES.md](SOURCES.md) identifies the original published XML examples, licensing, schema versions and current notice.

## Operator workflow

1. Import the sponsor's original PRS Protocol or Results XML into the existing workspace. Inspect the full XSD errors, organization/protocol identifiers, deprecated occurrences and results ID/IDREF relationships.
2. Compare the retained sponsor edition with the appropriate full study from the existing ClinicalTrials.gov capture. Select the organization/protocol-to-NCT link explicitly. Review complete fields, original source dates and exact result-record/group identities.
3. Prepare the source-specific modernization decisions. Review each existing supported value and the generated candidate's complete change report. Apply the frozen plan to the exact original input.
4. For an intended partial update, compose it against the retained previous edition. Review whole-list replacement, deletion and omitted-field effects before using the existing PRS account workflow.
5. Retain the candidate, plan, complete inspection/reconciliation and original source metadata in the existing dataset/customer packet. Receiving reopens the same source and re-executes the same API.

The source-owning 1FB3 ClinicalTrials workspace already supplies capture, original full study JSON, current revisions/request IDs, authenticated operator, native SF30 dataset/query and customer publisher. This directory is its additive Python leaf; it creates no competing database or capture.

## What the source makes consequential

The current Protocol schema uses a qualified study_collection root with unqualified clinical_study descendants. RRS uses a qualified result element with unqualified local descendants. A parser that drops namespace identity can accept the wrong record family or change unrelated same-name contact fields.

NLM's 22 September 2026 notice names thirteen deprecated fields. They are currently accepted but ignored by PRS. Modernization is scoped to those exact locations, including only the responsible-party phone/email fields; ordinary study and results contact information remains source content.

Protocol partial_upload and Results partialUpload have different spelling and documented units. A repeated list is replaced as a complete list. Empty protocol partial values are retained unless an otherwise empty delete=true tag requests deletion. Results outcomeMeasures is a required included container even when it has no outcome children.

The schemas and source comments describe different levels of validity. RRS declares many numerically meaningful values as strings, and some documented partial delete forms conflict with required complex children. The product reports schema validation, intended update effect, typed comparison and operator review independently, so a usable candidate remains concrete and inspectable.

## Run the original published XML

The included examples are the eudract package authors' published test-study files. They exercise full Protocol, standalone partial Results and combined Protocol/Results XML under the actual original schemas. Their original GPL-2 attribution is retained beside them.

~~~bash
python -m prs inspect prs/examples/eudract_pkg/1234.xml --schema protocol
python -m prs inspect prs/examples/eudract_pkg/ct_safety_upload.xml --schema results
python -m prs inspect prs/examples/eudract_pkg/study_file.xml --schema protocol
~~~

All three original inputs passed the complete selected XSD closure in the native installed lxml 6.1.1/libxml 2.14.6 operation. Both original Protocol files contain ten actual deprecated occurrences; their unaffected result references resolve. The source byte sizes and hashes are retained in SOURCES.md and the example manifest.

## Native field coverage

The selected profile contains 97 protocol and 88 results routes. It covers study identity, dates/status, sponsors/responsible party, current oversight flags, design/masking/phase, enrollment, outcomes, eligibility, arms/interventions, sharing, sites/references, flow/baseline, agreements, contacts, adverse events and measured outcomes/analyses.

The report carries every unmapped XML and API leaf for each explicitly linked study. It preserves untouched native quantities and source descriptions. Unknown pick-list spellings, unlinked collection rows and unbound group identities appear as actionable source findings. An equality has an explicit typed and occurrence basis.

For customer implementation, map source-specific CTMS inputs into the existing retained source engine, have the disclosure team select its actual study/record links and review rules, and deliver the resulting full operator package through the existing TrialAssure workshare and sender. The maintained grant/demo can use this same installed capability and native receiving record.
