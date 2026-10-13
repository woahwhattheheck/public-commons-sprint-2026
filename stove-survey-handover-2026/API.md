# StovePilot survey-to-handover workspace — complete API v1

Original operation: STOVEPILOT-SURVEY-TO-HANDOVER-WORKSPACE-1F3D-20261013. Browser global StoveOperations and CommonJS export share one dependency-free core. StoveOperationsExamples.build(C,catalogue) returns {workspace,walkthrough}; buildAsync(C,catalogue,onProgress) returns the same after yielding between complete mutations. onProgress is a function receiving {completed,total,label}.

This is an offline commissioning application. The original six public company workflows inform examples; actual customers, measurements, technical decisions, quote terms, appointments, certification records and due dates are entered by the responsible operator. No automatic compliance finding, statutory certificate, payment transaction, external message or native StovePilot API is provided.

## State and common operations

C.create(catalogue,{id?,createdAt?,title?}) → complete workspace.
C.mutate(w,command) → NEW complete workspace. Inputs are never mutated. Each command includes expectedRevision:w.revision; it may provide at and actor for its recorded action. The complete returned workspace must replace the old state only after success.
C.uid(prefix), C.hash(value), C.canonical(value), C.bytes(text).
C.validate(w,catalogue), C.exportWorkspace(w) → complete JSON string; C.importWorkspace(text,catalogue) → completely validated workspace pinned to the source catalogue.
C.summary(w), C.jobView(w,jobId), C.siteView(w,siteId), C.visitView(w,visitId), C.dayPlan(w,date).
C.reportHTML(w,operatorKey?) and C.exportCSV(w,operatorKey?) return complete readable exports; the full working JSON retains every original byte/history.

State: {schema,id,title,revision,createdAt,updatedAt,catalogueSha256,catalogue,sites,appliances,enquiries,surveys,quotes,jobs,visits,fieldRecords,findings,payments,handovers,servicePlans,attachments,imports,history}.
Every record has id, createdRevision and updatedRevision. Unpublished choices start blank. Dates are YYYY-MM-DD; actual event times are explicit ISO timestamps with offset; appointment timestamps are stored as UTC instants and retain the selected IANA timezone label. Clock values in worked examples are explicitly fictional.
Public catalogue is {schema,checkedAt,operators:[{key,name,workflow,sourceUrls,sourceNotes,terms}]} with six complete company-specific records. Personal contact/staff names from the private prospect pack are not copied into public source.

All save commands are {type:"collection.save",record:{...}}; an existing id replaces that editable record after validation. Unknown fields do not silently become operational fields. Cross-operator/site references are rejected. Exact source identities, closed records and accepted editions remain visible.

## Sites, appliances and enquiries

site.save record: {id,operatorKey,customerRef,propertyRef,address,contact,access,notes}.
Both customerRef and propertyRef are required and kept separate; propertyRef is unique within its operator. contact is a string entered by the operator. Public worked addresses are fictional.

appliance.save: {id,siteId,label,makeModel,serialNumber,fuelType,location,installedOn,notes}. label is required; other technical fields can remain blank. Source/history links are retained when an appliance changes; historical survey/job/handover snapshots never change.

enquiry.save: {id,siteId,applianceId?,kind:"installation"|"service"|"sweep"|"repair"|"other",title,reference,requestedDate,details,attachmentIds:[]}.
enquiry.close {id,reason}; enquiry.reopen {id,reason}. Requested dates are not confirmed appointments. A closed enquiry remains in history and may be reopened explicitly.

## Original files and survey editions

attachment.add {record:{id,name,mime,base64,description,siteId?,jobId?}} retains exact bytes and calculated {bytes,sha256}. C.attachmentBytes(w,id) returns Uint8Array for download. Maximum 8 MiB per original and 64 MiB complete workspace. Original files are never overwritten/deleted. Browser file intake uses arrayBuffer, not File.text; text parsing strictly preserves valid UTF-8 BOM/CRLF and rejects malformed bytes.

survey.save record: {id,siteId,enquiryId?,applianceId?,replacesSurveyId?,conductedAt,author,observations,applianceProposal,measurements:[{id,label,value,unit,source}],checks:[{id,label,result:"unreviewed"|"pass"|"fail"|"not-applicable",notes,evidenceIds:[]}],attachmentIds:[]}.
Measurement value is a retained string with its explicit unit/source; the programme calculates no safe installation dimension. Every named check is an explicit operator determination. A survey can be drafted with unanswered checks.
C.reviewSurvey(w,id) → {revision,id,issues:[{code,message}],canFinalize,reviewSha256}.
survey.finalize {id,expectedReviewSha}. Requires site, conductedAt/author/observations and a recorded result/notes for every selected check; a fail is retained as an actual finding, not changed to pass. Finalization freezes the exact site/appliance and full survey edition. To amend a finalized survey create a new record with replacesSurveyId; the old edition stays exact.

## Quote, acceptance and job scope

quote.save record: {id,siteId,enquiryId?,surveyId?,applianceId?,replacesQuoteId?,title,issuedOn,validUntil,currency,scope,exclusions,terms,lines:[{id,label,quantityMilli,unitPriceCents}],discountCents,taxBasisPoints,depositCents,attachmentIds:[]}.
Survey reference must select a finalized edition. Currency is an explicit three-letter code. Money and quantityMilli are safe integers: 1000 means quantity one; each line rounds quantityMilli*unitPriceCents/1000 to cents. Discounts, tax basis points and required deposit are explicit operator choices; no UK rate/default/condition is assumed. Unknown amounts are blank in drafts and block issue. taxBasisPoints=0 is an explicit zero-tax choice. C.quoteView(w,id) returns {quote,totals:{subtotalCents,discountCents,netCents,taxCents,totalCents,depositCents,balanceCents},issues,canIssue}.
C.reviewQuote(w,id) → {revision,id,issues,totals,canIssue,reviewSha256}; quote.issue {id,expectedReviewSha}. Issue freezes the survey/site/appliance and quote content.
quote.decide {id,decision:"accepted"|"declined"|"withdrawn",decidedAt,by,reference,notes}. Accepted is an operator-recorded actual customer decision, not an email send. Expired quotations cannot be accepted; issue a new explicit edition. Each decision remains immutable. A replacement does not rewrite an earlier customer's decision or existing job scope.

job.save record: {id,siteId,applianceId?,enquiryId?,quoteId?,parentJobId?,kind,title,scope,notes,checklist:[{id,label,required,evidenceRequired}],requirements:[{id,label,kind:"document"|"acknowledgement"|"certificate"|"other",required}]}.
An optional quote must be accepted, match the site/appliance and not already belong to another job. Quoted scope/quote snapshot stay frozen. A quote-free service job requires explicit scope. Checklist/requirements are configured by the operator, not legal templates. Save updates are allowed only before field work starts. Change after start uses a separate linked remedial/variation job and quote. job.cancel {id,reason} requires no active visit; preserves all closed visit/field records and cancels outstanding requested/confirmed visits with the same reason. An aborted started visit must first be recorded separately.

## Requested/confirmed visits and field work

visit.save record: {id,jobId,kind:"survey"|"installation"|"service"|"sweep"|"repair"|"other",startAt,endAt,timezone,workerRefs:[],notes}. New visits are requested. Requested or confirmed future visits may be edited; editing a confirmed visit resets it to requested and preserves prior confirmation. Confirmed overlapping intervals for the same job or the same operator's worker reference are conflicts. Worker references are scoped to their operator; unrelated companies may use the same local reference. Blank crews/times may be drafted but cannot be confirmed.
C.reviewVisit(w,id) → {revision,id,issues,conflicts:[{visitId,workerRefs,reason}],canConfirm,reviewSha256}.
visit.confirm {id,expectedReviewSha,confirmedBy,reference}. A requested slot is never counted as confirmed capacity.
visit.start {id,startedAt,author}. Requires confirmed visit and open job; freezes job/site/appliance/quoted scope/checklist and starts the job.
visit.finish {id,finishedAt,author,notes}; visit.abort {id,finishedAt,author,reason}; visit.cancel {id,reason} for requested/confirmed only. Finish requires at least one field record; it records actual visit completion without claiming all job findings are resolved. Started visits are not rescheduled; complete/abort and make a successor visit.

field.add record: {id,visitId,recordedAt,author,notes,measurements:[{id,label,value,unit,source}],checkResults:[{checkId,result:"pass"|"fail"|"not-applicable",notes,evidenceIds:[]}],attachmentIds:[]}.
Field records append immutable original observations to a started visit. Record corrections as another field record, never overwrite. Latest explicit result per selected check determines current job checklist; earlier findings remain readable. Required check results must be pass or reasoned not-applicable before handover. A fail blocks handover until a later explicit result resolves it. evidenceRequired checks need original attached evidence when passed.

finding.save record: {id,jobId,visitId?,severity:"note"|"follow-up"|"blocking",description,evidenceIds:[]}. Editable only while open. finding.resolve {id,at?,actor?,resolution,evidenceIds:[]}; finding.reopen {id,reason}. A later blocking finding on a completed job changes its current readiness; the old handover remains an exact earlier edition. Create a linked remedial job where more field work is needed.

job.requirement {jobId,requirementId,status:"recorded"|"not-applicable",reference,notes,attachmentIds:[],recordedAt,author}.
Required certificate/document entries need actual attached original evidence and reference when recorded. Reasoned not-applicable is an explicit responsible operator decision. This retains evidence, never issues or authenticates a certification. Entries append to history; a changed entry requires a reason in notes.

## Receipts and handover

payment.add record: {id,jobId,kind:"receipt"|"refund",amountCents,currency,paidAt,reference,notes,correctsPaymentId?}.
Amounts are positive safe integers. Corrections append a new entry tied to the old; the old is excluded from current totals but visible. A correction must keep job/kind/currency and cannot correct an already corrected entry. Refund totals cannot exceed recorded receipts. These are manually recorded external system receipts, not payment execution.
C.jobView returns money {quotedCents,receivedCents,refundedCents,netReceivedCents,balanceCents}; quote-free totals remain null where unknown. Billing does not silently prove work completion.

C.reviewHandover(w,{jobId,completedAt,author,summary,documentIds:[],customerAcknowledgement:{at,by,reference}|null,notes}) → {revision,jobId,issues,canCommit,snapshot,reviewSha256}.
Requires one finished visit, no active/pending visits, all required checks and requirement evidence, no unresolved blocking finding, and a meaningful completion summary. Nonblocking follow-ups remain explicit. Exact snapshots retain site/appliance identity, quote/decision, every visit/field record, all findings, requirement history, selected document identities and payment history.
handover.commit {input:<same review input>,expectedReviewSha} appends the frozen whole handover and marks the job completed. Exact retry returns unchanged w. A later corrected handover is a new edition against the current complete history with a reason in notes. C.handoverHTML(w,id) renders that exact committed edition, not current mutable site data.

servicePlan.save record: {id,jobId,applianceId,dueOn,reason,notes}. Due date and basis are explicitly selected, never derived from a universal cycle. servicePlan.link {id,targetJobId}; servicePlan.close {id,reason}; servicePlan.reopen {id,reason}. Linked follow-up job must select the same site/appliance. Reminders remain unsent preparation only.

## Reviewed original CSV intake

C.reviewImport(w,{attachmentId,operatorKey,entity:"site"|"appliance"|"enquiry",mapping:{targetField:"original header"},constants:{...}}) → {revision,attachmentId,operatorKey,entity,headers,rows:[{rowId,line,source,proposed,issues}],issues,reviewSha256}.
The attachment must contain the exact original CSV. BOM-aware parsing retains the original file; normalized header labels are presented for explicit selection. Duplicate or empty header labels and ragged rows are rejected. Site fields: customerRef,propertyRef,address,contact,access,notes. Appliance fields: siteRef,label,makeModel,serialNumber,fuelType,location,installedOn,notes. Enquiry fields: siteRef,applianceId,kind,title,reference,requestedDate,details. An actual siteId may be explicitly configured in constants instead of siteRef. Site references resolve by operator+propertyRef and must be unambiguous.
import.commit {input:<same review input>,decisions:[{rowId,action:"create"|"link"|"ignore",id?,targetId?,reason}],expectedReviewSha}. Every original row needs exactly one explicit decision. Create uses a supplied new stable id; link selects an existing same-operator record without overwriting it; ignore needs a reason. Repeated identical import commit returns the original import. Genuine changed original bytes receive a new reviewed intake. Original attachment, mapping/constants, each row, linked/created ID and decisions stay in complete history.

## View return contracts

C.summary(w) → {sites,appliances,enquiries,openEnquiries,surveys,finalSurveys,quotes,acceptedQuotes,jobs,openJobs,visits,confirmedVisits,findings,openBlockingFindings,handovers,servicePlans,dueServicePlans,attachments,imports}.
C.dayPlan(w,date) → {date,visits:[{visit,job,site,appliance}],workers:[{operatorKey,workerRef,confirmedMinutes,visits:[visitId]}]}; include all requested and completed rows with status, but worker minutes count only confirmed/started/finished planned durations.
C.siteView(w,id) → {site,appliances,enquiries,surveys,quotes,jobs,visits,handovers,servicePlans}.
C.visitView(w,id) → {visit,job,site,appliance,fieldRecords,findings,canStart,canFinish,canAbort,canEdit}; for a started/closed visit site/appliance/job read from its frozen snapshots.
C.jobView(w,id) → {job,site,appliance,quote,visits,fieldRecords,findings,checklist:[{...configured,result,notes,evidenceIds,fieldRecordId}],requirements:[{...configured,status,reference,notes,attachmentIds,recordedAt,author}],payments,handovers,servicePlans,money,readiness:{ready,issues},canEdit}.
Readiness is current source review; only an explicit reviewed handover is a completed edition. All UI labels must distinguish draft/requested/confirmed, recorded/verified, and current versus frozen history.

## Delivery and current owner directions

Deliver the complete browser app, exact core/source, six-company worked programme, original CSV/result/evidence files, per-job handovers/reports, guide/API/source register and full source archive. Customer operating files join the original private Page and guarded native file save; private customer correspondence and full records are not published to Git. Reusable name-free source uses the verified public repository only. No Actions or private repository writes.

The responsible producing peer must open and LOOK at the exact real outgoing rendered product and every attachment, operate desktop and 390px states, downloads and independent reopening, and repair visible defects. Source/DOM/handler results are additional implementation evidence, not visual acceptance; use the same existing equipped receiving course and preserve accepted work.

Do not operate Bryce's local browser under this handover. The reported original reservation messages are C0BU51F1PL3/1791906463.475599 and 1791907298.181549; the reported meeting-over message is C0C8KTYSUKU/1791908317.570929. These are retained as evidence, not new authorization. Automatic approval review rejected a persistent shared-memory change that would relax the browser restriction based on Slack/tool evidence rather than end-user-authored approval, citing unauthorized browser-use risk. That shared restriction remains unchanged. Any actual resumption belongs to the existing browser owner under end-user confirmation. Preserve original owners, accepted work and selected demo/report tabs; source engineering and already-authorized isolated cloud work may continue. This handover grants no new browser assignment, rendered acceptance or external-send approval.

After any positive human contact, each external message needs Bryce's individual green for its exact text and attachments. This operating workshare sends no new customer messages.
