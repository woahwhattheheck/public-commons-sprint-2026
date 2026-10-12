# Study extraction and evidence publication

Study extraction keeps a research team's form, reported results, source locations, independent entries and decisions together in the original Research dossier. Every edit commits an immutable dossier revision. A complete portable export carries the original source bytes and the full history into a receiving workspace, where the team can continue editing.

The operator, CLI, Node client and Merchant/Python callers use the same store operations. An authenticated local workspace records the named actor supplied with each request. Reviewer names and assignments belong to the saved project form.

## Prepare the original question and study

Receive the actual documents or registry record through the existing Research source workflow. Select the intended retained source occurrences. A source-group ID can represent several editions; a result row names the exact occurrence IDs.

Use the existing eligibility study-link action to establish the study and its report relationships, including a locator and reason for each report. A result set binds that study's exact version. Revised study links remain in their original eligibility history and appear as extraction impacts.

Open the extraction occurrences and studies sections to inspect the available records. They work before the first result set exists. Choosing a form scopes them to the form's question.

## Author and version the form

A form defines its fields, named reviewers, extractor assignments, resolver assignments, minimum distinct submissions and disagreement procedure. Each field has an ID, label, data type, required flag, instructions and optional unit. Choice fields additionally define their permissible IDs and labels.

Types are text, decimal, integer, boolean, choice, multi-choice and JSON. A numerical answer carries the original tagged value with its numerical payload as a string. The form does not coerce reported values through JavaScript floating-point arithmetic.

Create a form with an explicit question and reason. Revising it names the previous form edition and explains the change. The saved question wording and previous field definitions remain available. Existing result sets keep their original form edition; a new result set can use the revised form and explicitly supersede the earlier set.

A typical definition is:

~~~js
const definition = {
  fields: [
    {id:'value',label:'Reported value',valueType:'decimal',required:true,
     instructions:'Preserve the source value and any non-estimable meaning.'},
    {id:'lower',label:'Lower confidence limit',valueType:'decimal',required:true},
    {id:'upper',label:'Upper confidence limit',valueType:'decimal',required:true},
    {id:'unit',label:'Reported unit',valueType:'text',required:true},
    {id:'denominators',label:'Reported denominator scopes',valueType:'json',required:true}
  ],
  reviewers: [{id:'extractor_a',name:'Extractor A'},
              {id:'extractor_b',name:'Extractor B'},
              {id:'resolver',name:'Resolver'}],
  extractorIds:['extractor_a','extractor_b'],
  resolverIds:['resolver'],
  minimumExtractions:2,
  disagreementProcedure:'Compare both complete submitted records and resolve each discrepancy against the retained source.'
};
~~~

## Define the result rows

Create a result set using the current form edition, study ID and study version. Its rows have stable authored row IDs, descriptive labels, exact retained occurrence selections and context.

Context can retain the outcome, comparison or group, measurement method, time point, category, design, denominator scope and precision information needed to understand the result. Fields can also collect those items individually when they require independent entry and comparison. Preserve different scopes separately: a subgroup denominator must retain its own locator and label.

The result set saves the source edition inventory present when it was created. Later source editions become visible changes for review. Creating a replacement result set makes the relationship explicit while retaining the earlier one.

## Inspect source values

The source-pointer reader uses the maintained ClinicalTrials document loader and Decimal representation. It validates the original content bytes and their hash before reading any JSON pointer. Repeated pointers in a form are combined, and larger forms are divided into successive complete helper batches.

~~~js
const source = await store.extractionSourceValues(dossierId, {
  revision,
  occurrenceId,
  pointers:[
    '/resultsSection/outcomeMeasuresModule/outcomeMeasures/0/paramType',
    '/resultsSection/outcomeMeasuresModule/outcomeMeasures/0/classes/0/categories/0/measurements/0/value'
  ]
});
~~~

JSON pointers use RFC 6901 escaping. The empty pointer selects the whole original document. A pointer to a present null returns a tagged null; an absent pointer returns found:false. A retained source-bundle member can be selected with fileName; its original file reader validates the member bytes.

The value tags are:

| Source kind | Representation |
| --- | --- |
| Number | ["number","1.20"] |
| String | ["str","NA"] |
| Boolean | ["bool",false] |
| Present null | ["NoneType",null] |
| Array | ["array",[typedValue,...]] |
| Object | ["object",[[key,typedValue],...]] |

These tags describe the original parser's representation. Original lexical bytes remain in the retained source. The Decimal reader can normalize the exponent notation of a numerical token while preserving its exact value and decimal precision; the source byte hash and original download retain the original spelling.

## Save independent drafts

Each extractor saves a complete draft snapshot for a result set. A correction names the extractor's latest draft as supersedes and records its reason. Earlier drafts remain available.

An answer names a row ID, field ID, status, tagged value, bases, context and note. A JSON basis identifies an original occurrence and exact pointer. A passage basis retains the occurrence, page/section locator and authored quotation; text quotations are checked when the original text representation is available.

The original source value and the operator's entry are saved separately. A different entry remains visible in sourceDifferences. This supports genuine independent extraction, correction and adjudication: the software does not overwrite an operator's entry with the source value.

Available statuses are reported, derived, not-estimable, not-reported, not-applicable and uncertain. Explanatory notes accompany non-estimable, missing, inapplicable and uncertain values. A submitted reported or non-estimable value has a retained source basis. A draft can remain incomplete while an extractor works.

Derived values keep a written method, input field IDs, optional expression and reference. The author enters the derived tagged value explicitly. The engine retains the derivation and its inputs; it performs no implicit statistical conversion.

~~~js
await store.reviewExtraction(dossierId, {
  requestId:'extractor_a_draft_0001',
  expectedRevision:revision,
  actor:{id:'extractor_a',name:'Extractor A'},
  action:'save-extraction',
  data:{
    resultSetId,
    reason:'Independent entry from the retained registry edition.',
    answers:[{
      rowId:'pfs_bicr_group_0',fieldId:'value',status:'not-estimable',
      value:['str','NA'],
      bases:[{occurrenceId,kind:'json-pointer',
        pointer:'/resultsSection/outcomeMeasuresModule/outcomeMeasures/0/classes/0/categories/0/measurements/0/value'}],
      context:{measure:'MEDIAN',unit:'months',timeFrame:'Up to 33 months (data cut-off)'},
      note:'The registry reports the median as not estimable because of insufficient events.'
    }]
  },
  projection:'metadata'
});
~~~

This example shows one answer in a draft. Submission requires every required field for every result row. The complete receiving programme supplies all fourteen original measurement rows and their full context.

## Submit and compare

Submitting an extraction identifies its latest draft and records a reason. The submitting actor must be the draft's assigned extractor. The submission references the exact draft and its hash.

The result view compares the current submission from every extractor who has submitted. It shows missing answers, incomplete comparisons, agreement, disagreement and differences in source selections. Original typed strings remain distinct; a change from "77.0" to "77" remains visible.

Result states are NOT_EXTRACTED, NEEDS_REVIEW, DISAGREEMENT, READY_FOR_RESOLUTION, RESOLVED and STALE_RESOLUTION. The configured number of distinct submissions determines when a result is ready for a decision.

Saving a new draft preserves the previous submitted record. Submitting the correction advances the current submission set. A resolution referring to the previous submission set becomes stale.

## Resolve and correct results

A resolver supplies the complete current submission ID set for the result row. Consensus requires the submitted answers to agree. Adjudication records an explicit decision for each required field, choosing a submitted answer or entering a new source-bound answer with a reason.

An adjudicated selection has one of these forms:

~~~js
{fieldId:'value',submissionId:chosenSubmissionId}

{fieldId:'value',answer:{
  status:'reported',value:['str','79.7'],
  bases:[{occurrenceId,kind:'json-pointer',pointer:originalValuePointer}],
  context:{unit:'Percentage of Participants'},
  note:'Corrected against the original reported field.'
}}
~~~

A corrected resolution names the previous resolution as supersedes. All previous decisions, their actors, both independent submissions and the exact source bases remain in history.

The engine creates a stable resultId for each result-set row and a distinct editionId whenever its submitted or resolved state advances. Historical editions are reconstructed at their original event. Later forms, report links and drafts never rewrite those editions.

## Publish an evidence table

The companion publication subsystem defines authored tables with explicit questions and columns. Column pointers select values from the complete result record. Choose exact resultId, editionId and fingerprint values returned by the publication view.

Publishing freezes the full selected result records, source bindings, form/reviewer/resolution context, rationale and narrative. Selected unresolved rows keep their actual states. The saved review fingerprint detects an intervening change to the context displayed to the operator.

Tables can be revised and republished. Earlier editions remain available for comparison. Withdrawal preserves the publication and its stated reason. Impact review records the disposition of a specific observed change.

The full publication guide and typed declarations describe table actions and all JSON, CSV, Markdown and HTML exports. CSV contains readable selected columns together with the complete original result/source/review JSON. A portable dossier carries the editable project and all publication history.

## Review later evidence

The impact view identifies a revised form, changed question wording, revised study/report link, later source editions and an explicitly replaced result set. An impact fingerprint identifies the complete observed change. Its recorded disposition remains associated with that observation.

Use retain to document continued use of the original set, revise to record needed work, or replaced to link a created replacement result set. The replacement must explicitly supersede the affected set. Subsequent source changes produce a new observation to review.

## Store and transport contract

All mutations use the original dossier commit:

~~~js
const response = await store.reviewExtraction(dossierId, {
  requestId,expectedRevision,actor,action,data,projection:'metadata'
});
// response = {dossier,operation,duplicate}
~~~

Persist the exact request before dispatch. If a response is interrupted, repeat that same request. It returns the original saved operation with duplicate:true, even when the current dossier has advanced. Reusing its ID with changed input is rejected. An unrelated revision conflict requires a new read and a newly prepared request.

Read APIs:

~~~js
await store.extraction(dossierId,{revision,formId,resultSetId,section:'results',offset:0,limit:30});
await store.extractionSourceValues(dossierId,{revision,occurrenceId,pointers});
await store.exportExtraction(dossierId,{revision,formId,resultSetId,format:'json'});
await store.extractionPublications(dossierId,{revision,tableId,publicationId,section:'rows',offset:0,limit:30});
await store.exportExtractionPublication(dossierId,{revision,publicationId,format:'html',againstPublicationId});
~~~

Sections include overview, forms, formEditions, resultSets, extractions, submissions, results, resolutions, impact, operations, occurrences and studies. Later pages require the original read revision. Page limits follow the existing Research workspace contract; full exports include every selected record.

An original dossier store can configure the maintained Python interpreter with:

~~~js
const store = await openDossierStore(directory, {
  providers,
  extractionOptions:{python:'/absolute/path/to/python3',timeoutMs:120000}
});
~~~

## Complete portable receiving

Both original JSON and streamed/gzip portable readers validate the full immutable history before publishing any received dossier revision. They validate operation and request hashes, preserve event prefixes and replay each extraction/publication mutation against its actual previous state and retained source.

Receive into a fresh original workspace, inspect the source and all earlier result/table editions, recover a saved request and make the next edit using the receiving workspace's current revision. Export and reopen that received copy again. Other questions, occurrence selections, findings, citations and eligibility decisions share the original history throughout.

## Retained ClinicalTrials programme

The complete receiving programme uses the original NCT03529110 record:

- Record: 99,951 bytes; SHA-256 1e8f401843a30673b2d653ceb2682ad8f6d038af268a185c3333028d339d14c1.
- Original capture: capture-fb551338-f35d-46b3-b257-1138ba449c28, API 2.0.5, source data timestamp 2026-10-09T09:00:05.
- Five outcome measures, seven measurement groups and fourteen measurement cells.
- Outcome-level denominators 261/263 remain distinct from DoR BICR class denominators 208/90 and investigator class denominators 201/97.
- MEDIAN, source NA values, confidence bounds, units, time points and non-estimable comments remain source-bound.
- The original outcome objects contain no between-group analysis field. Any later derived estimate requires its explicit method and inputs.

The programme enters two independent versions, resolves an explicitly authored discrepancy, retains a second form edition, publishes the complete result table, exports all formats and continues after fresh portable receiving. The source record and locator come from the existing capture.

Methods context: [Cochrane Handbook chapter 5](https://www.cochrane.org/authors/handbooks-and-manuals/handbook/current/chapter-05), retrieved 12 October 2026, supports explicit study/report linkage, planned collection forms, independent extraction and documented discrepancy resolution. The project supplies its actual methods and field definitions.
