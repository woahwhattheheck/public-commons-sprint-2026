# Research risk-of-bias domain API

Operation: RESEARCH-STUDY-OUTCOME-REVIEW-20261012. This domain extends the existing Research dossier and its eligibility/extraction study registry. The original exclusive revision writer, source blobs, request replay, portable export and receiving controller remain authoritative.

## State and store integration

The additive state member is riskOfBiasEvents. Every mutation appends one immutable operation in the same dossier revision. No separate persistence is created.

The index.mjs exports are RISK_OF_BIAS_ACTIONS, RISK_OF_BIAS_SECTIONS, RISK_OF_BIAS_SCHEMA, RISK_OF_BIAS_OPERATION_SCHEMA, RISK_OF_BIAS_REPORT_SCHEMA, RISK_OF_BIAS_DESIGNS, riskOfBiasInput, riskOfBiasDigest, riskOfBiasProtocol, riskOfBiasModel, recordRiskOfBiasOperation, riskOfBiasPage, riskOfBiasReport, riskOfBiasExport, riskOfBiasMarkdown, riskOfBiasHtml, riskOfBiasCsv, validateRiskOfBiasState, and validateRiskOfBiasTransition. The input/digest/section contracts are also exported directly from contracts.mjs for the typed facade without importing the model.

Signatures:

    riskOfBiasModel(state, projected, registry = {})
    await recordRiskOfBiasOperation(state, projected, request, createdAt, registry = {}, extractionOptions = {})
    riskOfBiasPage(state, model, options = {})
    riskOfBiasReport(state, model, options = {})
    riskOfBiasExport(state, model, options = {})
    validateRiskOfBiasState(state, editions, knownOccurrences)
    await validateRiskOfBiasTransition(previous, state, projected, registry = {}, extractionOptions = {})
    riskOfBiasMarkdown(report) -> string[]
    riskOfBiasHtml(report) -> HTML fragment
    riskOfBiasCsv(report) -> string

The host supplies its original retained-source projections, plus the original extraction registry projection when result-level targets exist. Existing study records come from eligibilityModel.studyHistory/studies. registry.results contains:

    {id, studyId, questionId, version, occurrenceIds, name, record,
     editionId?, current?, status?}

The original registry adapter uses extractionPublicationContext(state, studyExtractionModel(state, projected)).results. It maps id from resultId and version from the immutable record.revision, the original dossier event revision. occurrenceIds come from the original sourceBindings. It preserves editionId and current, including retained historical records; no version counter is invented. record is the complete original immutable extraction-result record. The read model returns selectors already computed from that exact record; clients copy those selectors unchanged. It does not create study or extraction records.

Host methods:

    riskOfBias(id, options)
    reviewRiskOfBias(id, {projection: "metadata", ...request})
    exportRiskOfBias(id, options)

The host checks an existing original request before expectedRevision. Same-ID changed content fails. A committed reply recovered after a later dossier edit returns its original immutable operation. The host's original exclusive writer handles concurrent revision contention and rereads the original request after a collision.

Mutation response:

    {dossier, operation, duplicate}

operation includes schema, id, dossierId, requestId, requestSha256, request, reviewId, action, actor, createdAt, originalRevision, revision, originalRevisionSha256, result and sha256. Derived IDs use the original dossier/request identity. Portable receiving verifies event hashes, source bindings, append-only history and an exact replay of the original operation against the preceding complete dossier state.

## Request and actions

Every mutation uses:

    {requestId, expectedRevision, actor:{id,name}, action, reviewId?, data}

Actor IDs/names are exact local-workspace reviewer identities selected in the protocol. reviewId is absent only for create-review.

| Action | data | operation.result |
|---|---|---|
| create-review | {questionId,eligibilityReviewId,name,description,protocol} | review, protocol |
| revise-protocol | {protocol,reason} | protocol |
| create-assessment | {name,protocolId,target,reason} | assessment |
| revise-assessment | {assessmentId,assessmentEditionId,name,protocolId,target,reason} | assessment |
| save-draft | {assessmentId,assessmentEditionId,answers,judgments,overall,supersedes,reason} | draft |
| submit-review | {assessmentId,assessmentEditionId,draftId,supersedes,reason} | submission |
| adjudicate | {assessmentId,assessmentEditionId,submissionIds,expectedComparisonSha256,answers,judgments,overall,supersedes,reason} | adjudication |
| review-impact | {impactId,fingerprint,disposition,reason} | impactReview |

supersedes is null for a first record, otherwise the exact latest original actor draft/submission or current adjudication ID. Each correction records its reason. A new assessment edition is an explicit source/protocol change on the same assessment family, preserving all earlier editions and reviewer work.

Impact disposition is reviewed, needs_review, or out_of_scope. A recorded impact review preserves the underlying changed basis and its evidence.

## Protocol and form

    {
      name, description,
      instrument:{
        id, title, version,
        origin:"published"|"reviewer_authored",
        sourceUrls:[],
        applicableDesigns:[],
        scope:"study"|"result",
        rights:{basis,statement,url}
      },
      form:{
        title, version,
        origin:"reviewer_authored"|"licensed_reproduction",
        sourceUrls:[],
        rights:{basis,statement,url},
        domains:[{
          id,title,description,requiresEvidence,
          fields:[{
            id,label,type:"text"|"choice"|"multi",
            choices:[{id,label}],
            required,requiresEvidence,help
          }]
        }],
        judgments:[{id,label,description}],
        requireDomainJudgments:true,
        requireOverall:true
      },
      reviewers:[{id,name}],
      resolverIds:[],
      minimumReviewers:2,
      disagreementProcedure
    }

rights.basis is original, license, permission, public_domain or reference_only. The statement retains the actual declared source/rights basis. Published instrument metadata and reproduced forms include their source URLs. Empty sourceUrls is allowed for original authored material. Official instrument titles, dates, design applicability and links can be stored without reproducing their questions or algorithms.

A reviewer-authored form uses its own title, version, instructions, fields and judgments. The native example is a project-specific appraisal form. The engine does not calculate an official instrument score or infer a final judgment.

Design values are randomized-parallel, randomized-cluster, randomized-crossover, nonrandomized-intervention, cohort, case-control, cross-sectional, diagnostic-accuracy, prognostic, systematic-review, or other. Each target explicitly supplies design and rationale, and its design/scope must match the selected instrument declaration.

Protocol record:

    {id,reviewId,edition,question:{id,text},definition,
     supersedes,reason,createdAt,actor,originalRevision,revision}

definition is the complete protocol object above. Form and instrument are always accessed through that immutable protocol edition.

## Exact assessment target

    {
      studyId, studyVersion, studySha256,
      design, designRationale,
      scope:"study"|"result",
      resultId:null|id,
      resultVersion:null|integer,
      resultSha256:null|hash,
      occurrenceIds:[exact original linked retained report IDs],
      designBasis:[passages]
    }

A study-level target has null result fields. A result-level target pins the exact original result record and includes that result's retained source occurrences. The engine saves the original study/result/source bindings alongside this target. Changing a study, result, protocol, research question or relevant source edition produces an explicit impact.

Study picker rows expose studyId, studyVersion, studySha256, name, questionId, occurrenceIds and record. Result picker rows expose resultId, resultVersion, resultSha256, studyId, questionId, occurrenceIds, name and record. The full original record is retained separately from its selector projection.

Assessment record:

    {id,editionId,version,reviewId,questionId,name,protocolId,protocolSha256,target,
     supersedes,reason,createdAt,actor,originalRevision,revision}

id identifies its family. editionId identifies an immutable version with exact protocolId and source/result basis. Superseded editions remain available.

## Source passage

    {occurrenceId,fileName?:"exact original filename",locator,quote:"",jsonPointer:"",note:""}

Every passage belongs to one selected original retained occurrence. locator records the human-readable location. An optional quote must occur literally in that retained record: a supplied JSON pointer selects a string leaf, or the engine finds the exact matching string leaf and records the pointer/range. Saved evidence includes original edition/raw SHA/content digest and quote match metadata. A locator-only passage remains labeled accordingly.

For a named source-bundle file, fileName selects the exact original file through sourceBundleFileBytes. JSON pointers and literal JSON string leaves use the original async extractionSourcePointers resolver with extractionOptions; numeric values remain in its exact typed representation. The original NCT receiving filename is NCT03529110_Original_Registry_Study.json. The resolver must receive the original named file and source bytes. A quote saves its original string pointer, UTF-16 range, UTF-8 range and complete string SHA-256. A pointer-only passage saves the exact selected value digest and typed value where supplied by the native resolver. Quote limits are 100,000 characters; JSON pointers retain the original 4,096-character limit.

Unavailable or unreported information remains an explicit authored answer or judgment outcome, with rationale. It is not changed to a numeric zero or an invented passage.

## Draft, submission and adjudication content

Answer:

    {fieldId,
     status:"answered"|"not_reported"|"unavailable"|"not_applicable"|"unanswered",
     value:null|string|string[],
     rationale:"",
     basis:[passages]}

Only answered uses a value. Multi-choice values are choice IDs. Partial drafts may omit fields or retain unanswered. Submit requires every configured required field and the stated rationale/evidence for its selected status.

Domain judgment:

    {domainId,judgmentId,
     basisStatus:"supported"|"not_reported"|"unavailable"|"not_applicable",
     rationale,basis:[passages]}

Overall judgment is the same object without domainId, or null in a partial draft. judgmentId is an explicit configured choice. Unchosen domain judgments are omitted; no choice is synthesized for a partial draft. Selected judgments retain incomplete authored rationale/basis during drafting. Submission enforces configured required domains and overall judgment.

Drafts are separate per actor and assessment edition. Submission freezes one exact draft and preserves all earlier submissions. Adjudication pins the supplied complete latest submission set and exact comparison hash. It records explicit chosen answers, judgments and rationale, plus its correction history.

## Read projections and paging

Read options:

    {revision,reviewId,assessmentId,assessmentEditionId,
     section,actorId,offset:0,limit:30}

Schema: sf88-research-risk-of-bias-view/v1.

Sections: overview, reviews, protocols, studies, results, assessments, drafts, submissions, comparisons, adjudications, impact, operations, sources.

Response:

    {schema,dossierId,revision,section,reviewId,assessmentId,
     items,total,offset,limit,nextOffset,overview,
     review,protocol,assessment,comparison,actorDraft,actorSubmission}

Later pages require the selected dossier revision. actorId scopes draft reads. Draft/submission projections include current:true on the latest record for that actor and exact assessment edition; actorDraft and actorSubmission return those selected records directly. Their immutable operation records remain unchanged.

Comparison includes sha256, submissionIds, status, per-field/domain/overall rows, valueDisagreement, rationaleVariation, adjudication and adjudicationCurrent. Each row preserves separate reviewer values. New submissions change the comparison basis; an earlier adjudication remains available with its previous basis.

Comparison list items expose reviewId, assessmentId and assessmentEditionId directly. Each row has {key,kind,fieldId,domainId,label,values:[{submissionId,actor,answer,judgment}],valueDisagreement,rationaleVariation}. The browser uses the returned whole submission set and sha256 unchanged.

Impact rows include id, fingerprint, kind, title, reviewId, assessmentId, assessmentEditionId, before, after, lastReview and status. The overview section returns review summary rows with their original id; top-level overview contains explicitly named counts and units. Current actor draft/submission projections are scoped to the selected immutable assessment edition.

## Export and receiving

Export options use the same selected review/assessment and exact dossier revision, with format json, csv, md or html. The native response is:

    {filename,revision,contentType,body}

Reports preserve instrument/form editions, explicit design/result targets, source passages, independent reviewer content, differences, corrections, adjudication and impact. CSV keeps stated row types and identities. Markdown and industrial grayscale HTML escape authored content and keep source links explicit.

The existing complete dossier export includes every riskOfBiasEvents record and original source blob. Its existing receiving path validates the whole history and replays every appended risk operation against the preceding original state before installing the received dossier.

## Complete report projections

riskOfBiasReport returns schema sf88-research-risk-of-bias-report/v1, dossierId/title/revision/timestamps, explicit selection, overview, every selected reviews/protocols/assessments/drafts/submissions/comparisons/adjudications/impact/impactReviews/studies/results/sources/operations record, method declarations and sha256. The digest covers the complete report before its sha256 member. An actor filter scopes draft/submission record pages; comparative reviewer records remain visible together for adjudication.

JSON preserves the full report. CSV is a long-form export with explicit record_kind, review/assessment/protocol/actor/source identities and complete record_json. Markdown includes full readable questions, form definitions, authored reviewer evidence and judgments, comparison rows and retained records. HTML is an escaped standalone industrial grayscale report; riskOfBiasHtml(report) returns only the reusable fragment for the original dossier renderer, and riskOfBiasMarkdown(report) returns lines for the original Markdown renderer. Selection hashes keep filenames within the ordinary filesystem component limit.
