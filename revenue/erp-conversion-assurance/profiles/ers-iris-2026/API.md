# IRIS domain interface

The profile uses the original retained reconciliation service and conversion
workspace. `iris.py` inspects original XML files and creates explicit CSV
projections. It writes JSON to stdout and a structured `{error:{code,message}}`
on failure. Failure messages contain field locations and native error codes;
taxpayer values remain in the private input files.

## Commands

```
python3 iris.py transmission --input /private/filing.xml
python3 iris.py extract --input /private/filing.xml --mapping /private/xml-map.json --output /private/projected.csv
python3 iris.py ack --input /private/ack.xml --utid UUID:IRIS:TCC::A
python3 iris.py failure --input /private/error.xml --utid UUID:IRIS:TCC::A --http-status 400 --operation intake
python3 iris.py plan --input /private/decision.json
```

`transmission` and `extract` also accept `--xsd /private/schema/entry.xsd`
and `--schema-root /private/schema`. These validate against the exact supplied
local XSD package using lxml. The result pins the consumed XSD files and their
hashes. XML DTDs/entities and remote schema resolution are refused. A current
5.0.7 transmission is required for tax years 2022–2026.

`ack` additionally accepts `--receipt-id ID` to bind a known receipt. It accepts
the original intake receipt or status/acknowledgment XML response. `SearchId`,
the returned transmission ID and any known receipt must describe the same
requested transmission. Native status strings stay unchanged.

### Transmission result

`schema: ers-iris.transmission.v1`, `source:{sha256,bytes}`, `namespace`,
`schemaValidation`, `manifest:{utid,type,schemaVersion,taxYears,originalReceiptId}`,
`recordCount`, and `submissions`.

Each submission has `submissionId`, `originalUniqueSubmissionId`, `recordCount`
and `records`. Each record has `recordId`, `form`, `corrected`,
`previousUniqueRecordId`, `otherIntakeSystem`, `hasPreviousTin`, and
`hasPreviousName`. These are IDs, flags and counts; recipient values are omitted.
Record IDs are unique within their submission. Submission IDs are unique within
the transmission. Each submission contains one form type, and the transmission
contains one tax year (Publication 5718 sections 2.1 and 3.3). The manifest is
retained once for the whole transmission.

### Explicit XML projection map

The map is `{schema:"ers-iris.xml-map.v1", recordTag:"Form1099RDetail",
submissionTag:"IRSubmission1Grp", fields:[...]}`. Each field is
`{name,scope,path,required}`; `scope` is `record`, `form`, `submission`, or `transmission`.
`form` selects the enclosing native Form detail when the chosen record grain is
a repeated state or local group inside that form.
`path` is a sequence of direct XML child element names separated by `/`.
Namespace-qualified names may use ElementTree's `{URI}local` form. An
unqualified name must resolve to exactly one child; repeated/ambiguous elements
require a different explicitly chosen record grain. `required` defaults true.
An optional absent field becomes an empty CSV value. A present empty element
remains empty. Text is preserved exactly for the original comparator.

The operator chooses actual element paths from the observed filing XML and
actual source headers from the upstream export. The public profile's logical
field names are configurable comparison names, not a prescribed ERS extract
layout. The extraction result is
`{schema:"ers-iris.projection.v1",source,mapping:{sha256,bytes},output:{sha256,bytes},
recordCount,columns,schemaValidation}`. The output is a new private CSV file;
an existing destination is never overwritten.

### Receipt and acknowledgment result

`{schema:"ers-iris.ack.v1",source,rootQName,namespace,kind,utid,receiptId,status,submissions,errors}`.
`kind` is `intake` or `acknowledgment`. An intake receipt records `Received`;
the subsequent acknowledgment reports exactly `Accepted`, `Rejected`,
`Processing`, `Partially Accepted`, `Accepted with Errors`, or `Not Found`.
Each submission result has `submissionId`, `status`, `records`, and `errors`.
Each record result, when explicitly returned, has `recordId`, `status`, `errors`.
Errors expose `{code,path}` from native `ErrorMessageCd` and `ElementPathTxt`.
The full original error response is retained privately alongside this projection.

## Decision input and result

```
{
  "action": "replace",
  "transmission": {"...": "the exact transmission result"},
  "ack": {"...": "the exact correlated acknowledgment result"},
  "history": [{"transmission": {}, "ack": {}}],
  "selection": [{"submissionId": "1", "recordId": "1"}]
}
```

Actions are `recover-receipt`, `resend`, `replace`, `refile-original`, `correct`,
`wrong-form`, and `legacy-correction`. `history` contains retained transmission/acknowledgment
pairs; the workbench verifies their original artifacts before calling the
domain function. `selection` is required for record corrections. For a
submission replacement, `submissionIds` may select exact rejected submissions;
omitting it selects all explicitly rejected submissions.

The result is `{schema:"ers-iris.decision.v1",action,fromUtid,transmissionType,
originalReceiptId,submissions,records,requirements}` with fields relevant to the
requested action. A correction follows the chain to the most recent accepted
record, requiring each accepted successor to have transmission type `C` and
`CorrectedInd=1`. Each selected correction includes `latestAcceptedSource`
with its UTID, submission/record ID, original XML hash and form. Load that complete
latest record before making the next change. A rejected replacement follows
back to the earliest rejected original.
An accepted replacement cannot be replaced again. Whole-transmission replacement
keeps all original records. Partial replacement selects only rejected
submissions and omits `OriginalReceiptId`. A rejected correction remains `C`,
and a partially accepted correction selects only its rejected submissions.
An overall native `Rejected` status takes precedence over any child status.

`refile-original` is an explicit alternative for rejected `O`/`R` submissions.
It returns type `O`, removes replacement references and reports
`filingDateTreatment:"new-original"`. The new filing receives its own filing date;
the replacement's 60-day original-date treatment does not apply. The operator
selects this action deliberately. It is never substituted silently for `replace`.
This also supplies a documented route for rejected submissions after a whole
replacement becomes partially accepted. A new whole replacement would include
already accepted work and is rejected by the planner. The native rejected
submissions and their retained parent decision define the new original's scope.

For pre-receipt/schema resends, provide `reason` as `pre-receipt` or
`xml-schema` plus `failure`, the captured `ers-iris.failure.v1` projection.
`failure` reads the actual native XML or JSON response and its captured HTTP
status/operation, retaining the raw response hash. It recognizes the documented
`XML Schema Validation Error` separately. A generic intake HTTP 400 requires a
same-UTID `Not Found` acknowledgment before a pre-receipt resend; this also
prevents treating a duplicate-UTID rejection as permission to file twice.
Transport/server ambiguity is followed through acknowledgment lookup. Returned
failure fields are `source`, `utid`, `httpStatus`, `operation`, `receiptId`,
`classification`, `errors`, and `lookupRequired`.
`recover-receipt` returns an acknowledgment lookup by the same UTID. It is the
appropriate first operation after an uncertain intake response.

`legacy-correction` inspects a prepared `C` transmission whose selected records
carry `OtherIntakeSystemInd` and `OtherIntakeSystemNm` of `FIRE` or `Third Party`.
Previous TIN and recipient-name presence are retained as flags; their conditional
requirements follow the selected current schema and business-rule package.
Supply `legacyEvidenceSha256` identifying
the privately retained original-system evidence. Its linkage follows the IRS
August 2026 transition contract rather than manufacturing an IRIS record ID.

### Prepared child validation

Supply `preparedTransmission` with the exact native projection of the prepared
child XML. The domain checks its new UTID, type, tax year, whole/submission
references, complete selected record and form membership, correction flags and
latest accepted record links. For submission-based operations it preserves one
complete source submission per child submission. The result's
`preparedValidation` lists the checks actually performed and carries the child's
XML hash, record count and `schemaValidation`. Data values are reconciled through
the original comparison job; selected XSD validation verifies filing structure.

When an operator renumbers replacement/resend records, provide
`preparedRecordMap:[{submissionId,recordId,sourceSubmission,sourceRecordId}]`.
`sourceSubmission` is the original unique submission reference for a submission
replacement, otherwise the source submission ID. Unchanged IDs need no map.
Every selected source record appears once, and submissions cannot be split or
combined through renumbering. The retained workbench owns this mapping and the
parent decision, including new-original children whose XML has no IRS
replacement reference. Native plan inputs can contain up to 128 MiB of retained
operational metadata.

## Retained workbench composition

Store the original filing XML, exact projection map, projected CSV, schema
identity, native receipt/acknowledgment bytes and any legacy evidence as private
content-addressed artifacts. A profile record binds those digests to the original
bundle/job/report and its correction parent. The sole comparison job, review,
recovery and replay service stays `service/service.mjs`. Domain artifacts extend
the private handoff beside the original service's replay package.

The browser panel shows transmission/receipt identity, exact native status,
submission and record errors, and the concrete correction/replacement selection.
Use the existing source/map/run/review controls and trusted profile extension;
retain `spec.workspace.iris` through ordinary correction/reopen operations.

## Source precedence

IRS [current IRIS notice](https://www.irs.gov/filing/e-file-information-returns-with-iris)
requires 5.0.7 from October 7, 2026. [Publication 5718](https://www.irs.gov/pub/irs-pdf/p5718.pdf)
supplies native identity/status and replacement rules (sections 2.2, 3.1, 5, 6).
The [August 12 working group](https://www.irs.gov/pub/irs-efile/iris-working-group-meeting-08122026.pdf)
updates the prior-system correction branch. The selected current schema and
business-rule package determines exact filing fields and their validation.
The [May 14, 2025 working-group Q&A](https://www.irs.gov/pub/irs-efile/iris-working-group-meeting-qa-05142025.pdf),
page 5 question 10, documents the explicit new-original option for rejected
submissions and its filing-date distinction.
