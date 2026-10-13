# Simulated headwaters: customer requests and engineering handback

This chapter continues the **same completed simulated field case** through the maintained Customer reviews application. It selects original field quality reports, records two explicitly authored teaching requests, assigns engineering work, maps actual closeout artifacts into a revised review, and produces complete native packages that reopen after whole-project receiving.

**Needs expert review.** Customer wording, engineer names, assignments and dispositions are labelled **SIMULATED TEACHING INPUT** in retained records and visible review titles. Scientific quantities, laboratory result text, source QA, control relationships, corrective tasks and report identities come from the completed original field chapter. The application computes those scientific results before this consumer selects their evidence.

## The complete customer journey

The exercise has three useful stopping points. Advance each during the demonstration or prepare the complete ready edition in one call.

| Phase | Existing application behaviour | Retained original records |
| --- | --- | --- |
| Request | Initial review selects the original QC and original open corrective-action reports. The simulated reviewer asks for follow-up evidence and original laboratory context. | Review selection, actual source collection IDs, complete artifact inventory, authored response and two source-pinned request IDs. |
| Planning | Each request has an assigned simulated engineer and explanation of the work to do. | Immutable planning handback tied to the original review/response; revised evidence remains unselected. |
| Ready | Revised review carries all five original field source editions. Engineering maps actual revised artifacts to each request. | Planning predecessor, revised review, ready engineering handback, original customer response and complete evidence bindings. |

The current worklist shows the most recent actual response and engineering edition. The teaching operation separately retains its original response and handback IDs. A later human response can change the live worklist without replacing the historical exercise.

The authored requests are:

1. Explain how the initial duplicate precision finding was handled, including the assigned corrective task, repeat collection, completed task evidence and intended-use decisions.
2. Show original sample IDs, laboratory result text, the censored blank and source QA beside the repeat review.

The ready engineering edition records that those requests are addressed by selected evidence. Customer acceptance remains a separate customer response in the maintained application.

## Preconditions and selected original sources

Use the application containing the completed [simulated field chapter](SIMULATED_FIELDWORK.md), Customer reviews workbench and native review-package receiver. Keep the existing case driver, original scientific Workspace and actual field operation ID.

The consumer requires the field chapter's **closeout** phase. This retains initial/repeat QC reports, original open and closed corrective-action reports, observations, completed task and registered scientific sources.

The initial review selects the existing initial QC source plus the original **open** corrective-action report, registered through the maintained quality-action scientific_source API.

The revised review selects exactly the five retained closeout sources:

- Original observation context.
- Initial QC report.
- Repeat QC report.
- Initial-result closeout action report.
- Repeat-result closeout action report.

Every selected collection retains its original manifest, body and companions. Collection IDs are native content identifiers; source IDs may be readable strings. The consumer validates original source bodies and companions before using the actual artifact IDs in the revised handback.

The ready explanation identifies original closeout action report IDs. Laboratory imports, observations, source QA, QC criteria, task evidence and original quality-action decisions remain the actual saved scientific records.

## Join the existing case driver

Call after the current driver completes its field operation. The workspace variable is its existing native Workspace. The field_result variable is the actual return from continue_campaign or inspect_campaign.

~~~python
from model.simulated_customer_review import (
    continue_review,
    export_review_case,
    inspect_review,
)

customer = continue_review(
    workspace,
    field_result["operation_id"],
    through="ready",
)
retained = inspect_review(workspace, customer["operation_id"])
packages = export_review_case(
    workspace,
    customer["operation_id"],
    output_root / "customer-review-case",
)
~~~

The complete return includes:

| Field | Meaning |
| --- | --- |
| operation_id | Stable continuation identity for the original field operation and project. |
| field_operation_id, plan_id, field_binding | Actual case and immutable QC/action report editions. |
| original_review_id, response_id | Original review and authored simulated customer request. |
| planning_handback_id | Assigned planning edition. |
| revised_review_id, handback_id | Actual revised evidence selection and ready engineering edition. |
| sources | Original and revised native source selections. |
| current_worklist | Complete current filtered native worklist and snapshot ID, including any later real response. |
| original_response | The authored response retained for this teaching operation. |
| engineering_handback | Native ready/planning packet with requests and replacement evidence. |
| open_review | Existing Customer reviews item kind and original review ID. |

The module uses the existing scientific Workspace supplied by the caller. A wrong project, incomplete field chapter or changed original report binding is an explicit error.

## Advance the phases

Run from the original application root. Replace paths and IDs with values returned by the current case driver. Output is complete JSON.

~~~sh
python -B -m model.simulated_customer_review \
  --workspace /path/to/original/workspace \
  continue --field-operation ORIGINAL_FIELD_OPERATION_ID --through request
~~~

In **Customer reviews**, find **SIMULATED TEACHING INPUT — initial field quality review** by its returned ID. Inspect its complete selected artifacts and original response.

Open the existing **Worklist**, filter to this review, and inspect both complete requests. The customer's requested assignee and current engineering owner are separate fields.

~~~sh
python -B -m model.simulated_customer_review \
  --workspace /path/to/original/workspace \
  continue --field-operation ORIGINAL_FIELD_OPERATION_ID --through planning
~~~

Open the original review's **Handbacks** tab. The saved planning edition shows assigned simulated engineers and original request IDs. Its history preserves the distinction between customer wording and engineering explanation.

~~~sh
python -B -m model.simulated_customer_review \
  --workspace /path/to/original/workspace \
  continue --field-operation ORIGINAL_FIELD_OPERATION_ID --through ready
~~~

Open **SIMULATED TEACHING INPUT — revised field evidence and engineering closeout**. Inspect source artifacts and the ready handback's exact replacement mappings. Each requirement maps actual artifacts from the five retained field source editions.

Calling an earlier phase after ready reopens the completed operation; it does not undo later editions. Before a new phase, newer human responses or engineering predecessors cause the consumer to direct work back to the native application.

## Inspect and export the complete case

Inspect reads the original operation and current actual worklist separately:

~~~sh
python -B -m model.simulated_customer_review \
  --workspace /path/to/original/workspace \
  inspect --operation CUSTOMER_REVIEW_OPERATION_ID
~~~

Export to a new ordinary directory outside the original Workspace and application:

~~~sh
python -B -m model.simulated_customer_review \
  --workspace /path/to/original/workspace \
  export --operation CUSTOMER_REVIEW_OPERATION_ID \
  --output /path/to/delivery/customer-review-case
~~~

| Member | Purpose |
| --- | --- |
| original-review/ and original-review.zip | Complete native review desk, actual artifacts, response template and exact historical simulated response. |
| engineering-handback/ and engineering-handback.zip | Complete ready handback desk, engineering history and linked original/revised review generations. |
| current-worklist.json and current-worklist.csv | Every matching request at the captured snapshot, including complete wording, owners, dispositions, source IDs and replacement evidence. |
| selection.json | Exact original project, field operation, report bindings, review, response and handback identities. |
| case-manifest.json | Complete companion byte/SHA inventory and both native package identities. |
| operation.json and README.md | Destination ownership and offline operating instructions. |

Both native desk directories contain index.html. Their ZIPs can be received individually through existing Customer reviews and Handbacks. Keep the complete case directory for the combined receive command below.

The original review export is pinned to the authored response ID. Later customer replies cannot silently change it. The engineering package retains its selected original/revised generations and history. The worklist explicitly identifies its separate **current** snapshot time and ID.

An interrupted export resumes in its original directory. Published desks are fully inspected and reused. Native archives are created in operation-owned attempt directories: the ordinary review archiver's fixed pending filename therefore cannot prevent a subsequent retry. Complete abandoned candidates are verified before create-only publication. Only matching owned partial attempts are recovered; changed published bytes remain errors.

## Receive on another computer

First use the existing whole-project portable workflow to export and receive the completed scientific project. Create that archive **after this customer continuation reaches ready**. Include operation_id, original_review_id, response_id, planning_handback_id, revised_review_id and handback_id in the current driver's archive_selection identity, so an earlier pre-customer archive is not reused. Require the original operation member named by directory + '/06-ready-handback.result.json' in the complete native inventory. It carries the field plan, scientific sources, reviews, handbacks and original teaching requests/results.

Keep the complete customer-review-case directory separately available. Open the received scientific Workspace, then:

~~~python
from model.simulated_customer_review import receive_review_case

reopened = receive_review_case(
    received_workspace,
    delivered_case_directory,
    independent_output_root / "received-customer-review",
)
~~~

Equivalent CLI:

~~~sh
python -B -m model.simulated_customer_review \
  --workspace /path/to/received/workspace \
  receive --source /path/to/delivered/customer-review-case \
  --output /path/to/independent/received-customer-review
~~~

Receiving verifies both complete native archives/desks and all companion hashes. It checks the original project and retained teaching operation against the restored Workspace.

The maintained review_receiving.receive API retains the original review ZIP. Its receipt binds the actual filename/SHA, incoming response generation and stable receiving operation. The local viewer is materialized from the maintained review renderer and actual original sources. Presentation paths are returned as JSON strings.

The native handback receiver joins the same response/engineering history and opens its full desk. Compatible newer local responses remain visible in the separately returned current worklist. Repeating the command with the same destination reuses the original receiving identity and verifies local desks.

Use receipt_id in **Customer reviews → Received packages**. Inspect the incoming generation beside the current local response. Open the retained package or native local viewer. Open the ready handback by its returned original ID and follow the revised evidence.

A host that permits self-contained HTML but restricts local server navigation can still present these complete offline desks. Record actual application navigation separately from native API/package receiving.

## Interruption and concurrent human work

The original operation is stored under:

~~~text
implementation/simulated-customer-reviews/OPERATION_ID/
~~~

Its identity contains the original project, field operation, schema and teaching edition. Every action retains the complete request before native mutation and its result afterward. Review creation reuses the original creation time; response imports and engineering saves use existing native history/idempotence checks.

A crash after native mutation but before its result is recorded replays the exact saved request. It recovers the original review, response or handback. Completed records are verified when reopened.

Before authoring a new phase, the consumer checks the current customer response and engineering predecessor. If real human work has advanced that history, continue through the native application. Saved exact requests retain their original retry semantics.

The worklist is a fresh view. Historical teaching IDs stay available after the current customer response changes. Native locks and content checks remain in place; the consumer adds an operation lock and independent export/receive destination ownership. Destination files are separate from the scientific Workspace.

## Operate and inspect the exact outgoing edition

Before describing a customer-facing application, review desk, report, presentation or export as ready, the producing author must open or run the exact outgoing version, look at its rendered screen or real screenshots, and operate the important controls. This applies to current and future local and cloud workers across providers. Inspect the actual screenshare width and a narrow/mobile width where relevant, populated and empty/loading/error states, downloads, exports and independent reopening. Capturing screenshots without looking at them is insufficient. Source review, DOM counts, HTTP success, unit checks and another author's approval do not replace seeing the actual product.

Use plain industrial design: readable tables, clear hierarchy, consistent typography and spacing, restrained controls, useful labels and responsive layouts. Repair clipped, overflowing, cramped, unstyled, unreadable or broken output in the current authorized source before presenting it. Preserve the real workflow, computation and source records. Inspect the affected controls again after a repair; keep focused validation within the existing product course instead of creating a separate review application or broad test suite.

Every delegation of this receiving course carries this instruction. Keep it in the active owner-controlled policy, instruction and receiving-guide surfaces that the workers actually read, preserving existing owner controls and historical records. Continue through the existing source, native and browser owners, respect the active project cutoff, and keep customer records bound to their original project and edition.

For this simulated case, use the original field and customer IDs returned in the retained case receipt. Open the initial review, the two complete customer requests, the assigned planning handback, the actual revised source artifacts and the ready engineering handback. Confirm on screen that original customer wording, current engineering disposition and a separate customer acceptance remain distinguishable. Inspect long source labels, full request wording, original laboratory context and the replacement-evidence links at both useful widths.

Operate the retained review and worklist filters, full detail, history, package downloads, response/handback receiving and local-desk reopening through their existing controls. Save and reopen an unfinished response or engineering draft without losing its wording. Perform any authored teaching mutation only in this explicitly simulated case, retaining the original predecessor and operation IDs. Open the actual downloaded HTML and received package, follow its original/revised evidence, and inspect the complete exported CSV/JSON beyond the visible page. Record the exact application source, saved case IDs, output file identities and viewed screenshots in the same receiving operation so a source defect can be repaired directly.

## Integration, source and validation

The additive fragment defines the simulated-customer-review component and requires the existing eco13 and implementation families. It carries this module and guide while preserving the shared catalogue, original review UI, field engine and case driver. The cumulative installer reads fragments through its maintained loader.

Primary source contracts:

- [Field chapter PR3546](https://github.com/woahwhattheheck/public-commons-sprint-2026/pull/3546): laboratory/QC/corrective-task report production and exact five-source closeout.
- [Customer review family](https://github.com/woahwhattheheck/public-commons-sprint-2026/tree/6416217132d59b2bf8d92320577cb18349f32dae/opportunities/upstate_forever_2026/model): original response, worklist, handback and receiving APIs.
- [Workspace source intake](https://github.com/woahwhattheheck/public-commons-sprint-2026/blob/main/opportunities/upstate_forever_2026/model/workspace.py): manifests, retained bodies, companion paths and collection/source IDs.
- [Component selection](https://github.com/woahwhattheheck/public-commons-sprint-2026/blob/main/opportunities/upstate_forever_2026/source_tools/application_components.py): original source closure and fragment composition.

The implementation was checked against these actual API bodies and independently reviewed for source bindings, response/engineering retry, native archive publication and restored-project receiving. The existing case owner runs the full application journey with its saved native case. This chapter adds no model execution.

The repository's existing licence terms apply to this additive source and guide.
