# Simulated headwaters: field and laboratory follow-through

This chapter extends the existing simulated Piedmont headwaters case through the maintained **Implementation & fieldwork** application. It prepares a complete field plan, imports original simulated laboratory files, calculates quality-control reviews, assigns and completes corrective work, and adds the retained field reports to the existing mapped delivery and whole-project receiving journey.

**Needs expert review.** Every collection date, result, limit, control relationship and reviewer decision in this chapter is explicitly authored demonstration input. The maintained application computes the QC metrics and produces the original report editions. Instantaneous concentrations describe this teaching case; annual native NDR/SDR results keep their own units, time support and interpretation.

## What the customer can see

Open the returned plan in **Implementation & fieldwork → Field records**. The case contains three planned locations in the exact selected simulated headwaters terrain: a western tributary, an eastern tributary and the downstream trunk. It retains the original projected cell coordinates, transformed latitude/longitude and recipe hash. The field-site rule selects the lowest original DEM input cell in each upstream half at 40% of grid height and the lowest downstream cell at 85%. These are explicitly planned sampling sites; use the main demonstration's actual computed stream map to discuss the hydrologic setting.

The collection design declares the eastern initial pair as field duplicates and a separate reagent-water field blank. These roles come from the retained field design and custody references. Similar IDs do not imply a control relationship.

| Original input record | Result text | Type | Collection |
| --- | --- | --- | --- |
| sim-tp-left-01 | 0.055 | Numeric | Initial western tributary |
| sim-tp-right-01 | 0.120 | Numeric | Initial eastern tributary |
| sim-tp-right-dup-01 | 0.200 | Numeric | Initial eastern field duplicate |
| sim-tp-outlet-01 | 0.150 | Numeric | Initial downstream trunk |
| sim-tp-blank-01 | <0.010 | Censored | Initial field blank |
| sim-tp-right-02 | 0.125 | Numeric | Repeat eastern collection |
| sim-tp-right-dup-02 | 0.130 | Numeric | Repeat eastern field duplicate |

Every row declares **total phosphorus, mg/L as P**, the same whole-water collection definition, and the same simulated EPA Method 365.1 analytical definition. The original quantitation limit is 0.010 mg/L. The original blank value remains null with its exact less-than qualifier and result text.

The project criterion is an authored demonstration choice: duplicate RPD at most 20%, evaluated only when both numeric values are at least five times their own original quantitation limits. The source and applicability are saved in field-design.json and in each QC selection. This numerical criterion is not presented as an EPA acceptance limit.

## Four useful chapters in the existing interface

The native continuation supports four cumulative phases. The same operation can stop at each phase for a discussion, then resume with the exact original inputs. Default execution completes all four.

| Phase | Saved native result | What to open |
| --- | --- | --- |
| intake | Original seed plan, field-design attachment, five original laboratory rows, mapping and complete native audit | Field records; original laboratory source and saved observations |
| review | Initial duplicate and censored-blank QC review; explicit initial decisions; one assigned corrective task | Sample quality control; saved review; Review decisions and follow-up; Workplan |
| repeat | Repeat-visit evidence and completion; two additional original laboratory rows; separate repeat QC review | Original task/evidence; repeat visit; repeat saved QC report |
| closeout | Original task completion; retained original and repeat decisions; observation context and four QC/action scientific sources | Saved follow-up history; complete report ZIP; scientific/client report; original delivery |

### Intake: retain the complete laboratory source

Use the returned plan ID and revision to open the saved plan. In **Field records**, inspect the actual sample, activity, visit and site IDs. The initial source has five rows and the repeat source has two. Original CSV rows, headers, selected columns, mapping, original text, units and method survive intake.

The continuation uses the same native importer as **Import laboratory CSV → Open mapping JSON → Preview laboratory results → Import reviewed results in one native revision**. Its native preview and import receipts are retained. The repeat importer fills the explicitly permitted missing collection times on the original repeat sample activities.

For a manual replay on a separate intentionally prepared teaching edition, use the full CSV and lab-mapping.json rather than copying displayed values into a new table. The normal user interface can expose each original record and its source decisions.

### Review: explain precision and the censored blank

Open **Sample quality control** and select the saved initial review. Inspect its relationship basis, units, method strings, quantitation limits, exact criterion and actual returned metric. **Original record** exposes each complete observation with its original site, visit and activity.

The authored initial pair is chosen to exercise an exceeded precision criterion. The maintained evaluator computes RPD using the absolute difference divided by the pair mean. The continuation checks the native outcome before applying its scripted demonstration decision. If the native outcome differs, it retains that actual result and stops this scripted phase for review.

The blank stays **not_evaluated** for a numeric blank comparison. Its censored upper-bound text is displayed; no zero, half-limit concentration or blank subtraction is introduced.

Open **Review decisions and follow-up**. The original duplicate decision is **follow_up_required**, with an explicit intended use and reason. The native action creates one assigned **Quality follow-up** task to inspect handling and repeat collection. The censored blank has a separately documented restricted use and closed interpretation. The application's scientific calculation, reviewer decision and field-task progress are separate records.

### Repeat: add new evidence without changing the first pair

The repeat phase attaches repeat-field-record.md, completes the explicitly simulated repeat visit, imports its two new laboratory rows and saves a separate QC review. The new pair uses the same analytical and collection definitions.

Show both saved reviews. Their original result IDs and selected native revisions differ, and the initial exceeded review remains available. The repeated pair exercises a within-entered-criterion result calculated by the maintained evaluator. This demonstrates precision review and operational follow-through; it does not measure a conservation effect.

### Closeout: finish the actual task and retain the decisions

The original Workplan task is marked complete and linked to the retained repeat evidence. The original pair's decision is closed as **exclude_from_selected_use** for this explicitly stated teaching interpretation. The repeated pair has its own **use_as_reviewed** decision and closure note. Original laboratory values, qualifiers and QA fields remain unchanged.

Open the saved follow-up history and inspect both the created task and later closeout. **Complete report and sources ZIP** exports a report edition with its original sources. **Register with scientific reports** and **Prepare scientific/client report** use the existing source/report workflow. The continuation has already registered the exact final sources for composition into the original mapped delivery.

## Prepare the inputs from the final original recipe

Use the existing application and its scientific Python environment, which provides pyproj. The preparer consumes the actual final original recipe selected by the main demonstration owner. It does not contain a second terrain generator or a hardcoded restoration-cell count.

Run from the application directory:

~~~sh
python -B source_tools/prepare_simulated_fieldwork.py \
  --recipe /absolute/final-headwaters/input-recipe.json \
  --output /absolute/demo-output/field-inputs
~~~

The output directory contains eight complete members:

| Member | Purpose |
| --- | --- |
| original-model-input-recipe.json | Exact original recipe bytes, including the actual input arrays |
| field-design.json | Original recipe hash, planned-site derivation, coordinate operation, relationships, assumptions and criterion |
| seed-plan.json | Complete original native plan, sites, visits and sample activities before intake |
| initial-lab-results.csv | Five original initial laboratory rows |
| repeat-lab-results.csv | Two original repeat laboratory rows |
| lab-mapping.json | Explicit native source-column/type/collection-time mapping |
| repeat-field-record.md | Explicitly simulated collection and handling evidence |
| field-inputs.json | Full input member inventory with exact lengths and SHA256 identities |

Identical preparation into the same directory reuses the original bytes. A different existing input is preserved and reported as a conflict. Use the final chosen terrain recipe before preparing this field chapter; its exact hash binds the native plan and operation. A changed recipe produces a different input edition and plan ID.

## Run and resume in the existing demonstration Workspace

Use the same Workspace already admitted by the original headwaters demonstration. The field continuation does not create a Workspace, dispatch an NDR/SDR solve, start an operator server or manage the main scientific worker.

~~~sh
python -B -m model.simulated_fieldwork \
  --workspace /absolute/existing-demo/workspace \
  --inputs /absolute/demo-output/field-inputs \
  --through intake
~~~

Repeat the same command with **review**, **repeat** and **closeout** to advance the useful chapters. Omit --through to complete all chapters. The last JSON result contains the actual original operation_id, project ID, recipe hash, plan ID/current revision, record counts, native tasks, QC/action report IDs and files, scientific source selections and complete input inventory.

Use the exact returned operation ID for independent inspection:

~~~sh
python -B -m model.simulated_fieldwork \
  --workspace /absolute/existing-demo/workspace \
  --inspect ACTUAL_RETURNED_OPERATION_ID
~~~

The operation retains its exact prepared input bytes, original requests and completed native results beneath:

~~~text
implementation/simulated-fieldwork/<operation_id>/
~~~

Every new native mutation retains its complete request first. Laboratory and quality-action retries use the original old revision and original operation identity. An interrupted ordinary plan edit recovers only the exact following native revision with the expected predecessor and complete postimage. An unrelated concurrent change produces an explicit native revision conflict.

Before a new scripted request, the continuation compares each original imported observation and its original activity/site/visit context against the corresponding retained laboratory operation. Source changes require review in the ordinary editor. Unrelated new rows, source additions and task notes remain intact. Completed inspection and exact completed retries still reopen the original reports after later human edits.

A reported phase describes completed retained steps. On a partial interruption, the original request stays available and the next invocation resumes that exact operation. Native errors are surfaced with their original context; the continuation does not convert an unavailable metric or failed native result into a successful teaching outcome.

## Compose the same driver, mapped delivery and receiving course

The active demonstration driver already owns its Workspace, final recipe, native runs, phase reporting, mapped delivery and whole-project archive. It can append this field chapter directly.

After its final recipe is pinned and its original Workspace exists, and before its first mapped delivery/archive:

~~~python
from source_tools.prepare_simulated_fieldwork import prepare
from model.simulated_fieldwork import (
    continue_campaign, attach_to_delivery, inspect_campaign,
)

prepared_field = prepare(args.recipe, output / "field-inputs")
fieldwork = phase(
    "field_followthrough",
    lambda: continue_campaign(ws, prepared_field["directory"]),
)
save(fieldwork=fieldwork)
~~~

After the driver's existing native-process/scenario source attachments have built delivery_selection:

~~~python
delivery_selection = attach_to_delivery(
    ws, fieldwork["operation_id"], delivery_selection
)
~~~

attach_to_delivery deep-copies the existing selection, preserves its original primary source and ordered report list, and appends these five exact original source documents:

1. Complete original field observation context.
2. Initial saved QC review.
3. Repeat saved QC review.
4. Original-review corrective-work closeout, including its retained decision history.
5. Repeat-review closeout.

It keeps the existing model/run selections, maps, overlays, contact fields and other report roles. The maintained observed_context binder verifies all selected source bodies and companions before the existing delivery builder computes the next ordinary delivery edition.

Add this field completion member to the driver's existing required archive members:

~~~python
required_members.append(
    "workspace/" + fieldwork["directory"] + "/completed.json"
)
~~~

The ordinary full Workspace archive includes original recipes/CSVs/mapping, every saved plan revision, attachments, native laboratory audit, retained QC/action reports, original source collections and the field operation. The installed complete application contains both additive Python modules, this guide and its component fragment.

After the same original portable restore has produced reopened:

~~~python
received_fieldwork = inspect_campaign(reopened, fieldwork["operation_id"])
save(reopened_fieldwork=received_fieldwork)
~~~

Inspect the returned actual project/plan IDs, original seven observations, native task and report identities. Open the retained report HTML and original sources from the received Workspace. Use the original independent operator receiving course to open the same plan through its maintained interface. Existing shared driver edits, the model runtime and its sole native worker remain with their current owner.

## Source contracts and validation

The continuation was reviewed against the maintained source contracts, including:

- model/implementation.py, Git blob53bf6c150870744fe59e48f50cc0500714aaf16a: immutable native revisions, source attachments and ordinary save recovery.
- model/implementation_lab_results.py, Git blob225557686ab5c2f125844965bf473eb740157759: complete original CSV/audit, explicit mapping and exact interrupted-operation recovery.
- model/implementation_observations.py, Git blobea8563d75a849c09d1cdf4ca4b53eb3333f0525f: original field observation context and typed scientific report source.
- model/observed_context.py, Git blobba888ada9dc35ae6466dc1ecd50ff5755da5fbda: ordered original report choices and complete retained-source binding.
- The maintained QC and quality-action modules described in [IMPLEMENTATION_QC.md](../model/IMPLEMENTATION_QC.md), including censored-result applicability, exact original control groups, native tasks/history and portable report verification.
- model/portable.py, Git blob151b4a9e013bb05449d751c4a5913cd2be02ca8f: full application/Workspace capture with exact source membership and native Implementation verification.

Independent source review covered complete laboratory intake/receipts, initial and repeat QC applicability, censored-blank behavior, original task/evidence decisions, retained requests across interruption, edited-source protection, scientific-source registration and ordered delivery composition. The maintained native demonstration operation supplies the actual execution, calculated result and receiving outcome; retain its returned JSON and first concrete exception alongside the original case.

### Primary scientific references

- [EPA Method 365.1, Revision 2.0, August 1993](https://www.epa.gov/sites/default/files/2015-08/documents/method_365-1_1993.pdf): original analytical definitions for phosphorus forms and method scope.
- [EPA New England Environmental Data Review Supplement, April 2013, section 2.8](https://www.epa.gov/sites/production/files/2016-04/documents/epa-ne-edr-supplement.pdf): field duplicate and replicate precision in the context of stated project requirements.
- [EPA National Functional Guidelines for Inorganic Superfund Methods Data Review, January 2017](https://www.epa.gov/sites/default/files/2017-01/documents/national_functional_guidelines_for_inorganic_superfund_methods_data_review_01302017.pdf): duplicate RPD and method-specific quantitation/application conditions.

The 20% and five-quantitation-limit choices remain explicitly authored criteria for this teaching case. Preserve the full original method, source limits and applicability when adapting the workflow to actual project samples.
