# Open and carry the completed field quality-control course

This course opens the existing simulated headwaters field programme through the maintained operator. It follows the original Implementation plan into field records, the initial and repeated quality-control reviews, corrective work, source evidence and complete report downloads. It then reopens the saved outputs in a fresh browser context.

The input is the actual completed `inspect_campaign` response from the original field operation. The course does not generate another terrain, start a native NDR/SDR model, create a replacement field plan, alter measurements or reassign field work. It reads the retained source and operates the existing interface and ordinary queued export actions. The original model, field and archive identities remain selected throughout.

Needs expert review before applying demonstration criteria to an actual monitoring programme.

Read [the complete field/laboratory chapter](SIMULATED_FIELDWORK.md) for the authored laboratory inputs, explicit project criteria and original native continuation. All collection dates, sample values, control relationships and review decisions in that chapter are demonstration inputs. The maintained application calculates the QC metrics and produces the saved scientific reports. Preserve that distinction in the presentation.

## What the operator will show

Open the completed plan in **Implementation & fieldwork**. The two original sampling rounds tell one useful story:

1. The initial CSV has five rows: western tributary, eastern tributary, its declared field duplicate, downstream trunk and a censored field blank.
2. The saved initial QC report uses the original relationship, total-phosphorus units, method and quantitation limits. The entered duplicate criterion is exceeded. The censored blank retains its original less-than result and separate interpretation.
3. The original follow-up decision is linked to a real saved quality-follow-up task and repeat-field evidence.
4. The repeat CSV adds two new observations. Its separate QC edition and closeout explain the revised decision while retaining the initial pair.
5. The original decisions, task/evidence history and complete report source packages can be downloaded and opened independently.

The course selects those actual saved native IDs. It does not substitute a newly evaluated report for an original result or treat a changed record as the same source edition. The teaching interpretation remains attached to the exact original project, plan, observations, QC reports and action reports.

For a discussion of precision, the entered initial pair is 0.120 and 0.200 mg/L as P; the repeated pair is 0.125 and 0.130 mg/L as P. The original project choice is an RPD limit of 20%, applicable only when both numeric values are at least five times their own quantitation limits. The maintained evaluator supplies the displayed metrics. These choices demonstrate QA review and follow-through; they do not establish a measured conservation effect. The original blank remains `<0.010`, with no numeric replacement.

## Receive the completed original operation

Use the application and Workspace already selected by the headwaters execution owner. Inspect its returned field operation after it reaches `closeout`:

~~~text
python -B -m model.simulated_fieldwork --workspace /absolute/original/workspace --inspect ACTUAL_RETURNED_OPERATION_ID
~~~

Save the complete JSON response as a private file. Supply this raw response to the browser course; do not copy a displayed summary or wrap it in another receipt. Its schema is `upstate.simulated-fieldwork/v1`. The original response binds:

| Native field | Role in the browser course |
| --- | --- |
| operation_id | The same original field continuation |
| original_project_id | The project already used by the headwaters case |
| plan_id | The retained Implementation plan |
| current_revision | The native revision carrying the completed course |
| phase | Must identify the original closeout result |
| qc_reports | The original initial and repeat QC report IDs |
| action_reports | The three retained quality-action report selections |
| corrective_tasks | The original assigned work and its completed follow-through |

Keep the complete response. Other original fields, source selections, report paths and scientific relationships are part of the retained operation even when they are not repeated in this table. The browser driver hashes the full input and retains its source IDs before proceeding. It compares the current native plan revision with the raw inspection response. If a human edited the plan before the first browser course, regenerate that same original operation's inspect_campaign response and use the resulting current revision. Preserve the original report identities. If an already-started browser course has different retained input bytes, keep that complete output and begin a separately identified receiving edition in a new directory; do not replace its request-state.json to force a resume.

A partial native operation should continue through the existing field implementation and its original saved requests. The browser course consumes the finished result; it does not manufacture missing source IDs or advance the scientific operation itself. If the native response has a concrete error, return that exact exception to its current source owner and continue the same operation after repair.

## Start the existing operator and browser

Use the original operator's actual URL and Workspace key. The key is the operator's selected Workspace identifier, not an invented path or replacement Workspace. Put the complete current operator URL in a private UTF-8 file. If the URL carries an access token or other private session information, keep it out of command-line arguments, logs, screenshots of terminal output and shared messages.

The browser course uses Node 22 or later, Playwright and Linux `flock`. Reuse the equipped host's installed browser and dependencies. The optional browser settings select an existing channel or executable; they do not install or provision a second machine.

From the application directory:

~~~text
node source/implementation/run_sample_qc_browser.mjs --url-file /private/operator-url.txt --workspace ORIGINAL_WORKSPACE_KEY --fieldwork /private/fieldwork-inspect.json --output /private/field-browser-course
~~~

Optional flags are:

| Flag | Use |
| --- | --- |
| --resume | Reopen the same output directory and continue its retained exact operation |
| --headed | Show the actual browser while the course runs |
| --browser-channel NAME | Select the existing installed browser channel |
| --browser-executable PATH | Select the existing installed browser executable instead of a channel |
| --task-timeout-seconds 900 | Set the ordinary queued-export wait interval for this invocation |

Choose either a browser channel or an executable path. The first output directory must be new. Keep the current receiving owner and original native operation; do not launch competing browser writers against the same output directory.

The course uses the existing operator's authenticated session route. Do not replace the private URL with a guessed unauthenticated endpoint. A missing or expired original session should be restored through that operator's current owner/session rather than changing application access controls.

## Walk the actual saved programme

The browser opens the original Implementation plan and follows the actual Field records and Sample quality control controls. At each stage, inspect the displayed project, plan and saved source context.

**Field records.** Open the original laboratory rows and their record details. Check that the initial and repeated results are still separate, the sample/activity/visit/site identities are retained, and the original result text, units, method and limits remain readable. The censored field blank must still show its qualifier. Download the original records through the maintained control.

**Initial quality review.** Open the saved initial QC report, its original control relationship and applicability. Read the displayed result rather than inferring it from a later review. Open the original record details and retained review JSON. The saved decision supplies the intended use and the follow-up rationale.

**Corrective work and evidence.** Follow the existing task and evidence controls. Inspect the original assigned work, repeat-field attachment, completion and decision history. The course does not create another corrective task or change the actual task status. Source record content and operational completion are separate views of the same retained programme.

**Repeat review and closeout.** Select the actual saved repeat QC edition and its quality-action report. Open the final history while retaining access to the initial review and the separate blank interpretation. The later acceptable duplicate precision does not erase the original exceeded result. Download the complete original report/source ZIPs through the ordinary queue.

**Local interaction states.** The course exercises an empty filter result, local draft/error states and the existing source-view controls, then returns to the useful saved record. These visible states should explain what the operator can do next without concealing the original source. Measurements, QA fields and native field-task records remain unchanged by this browser course.

The browser uses a 1440 × 1000 desktop viewport and a 390 × 844 narrow viewport. Long source text and tables should remain readable without losing the important labels, controls or original values. Inspect the actual resulting screens before presenting them.

## Receive the complete operated outputs

The original output directory contains the source and durable continuation records:

| File or directory | Content |
| --- | --- |
| native-input.json | The complete original field closeout input retained by this course |
| request-state.json | Exact input identity, operator-origin/Workspace binding, source IDs and retained original queued exports |
| journey.json | The actual completed or interrupted browser course result |
| attempt-001/, attempt-002/, … | Each invocation's original plan/report/source-edition JSON, actual screenshots and downloaded source/report files |

The retained export state records completed export identities before moving to the next step. If the process loses its response after an export, the next invocation reuses the original stored request and result. It does not create a replacement operation because the earlier browser session disappeared.

Each attempt retains native-plan.json, native-reports.json and rendered-source-edition.json alongside the displayed source. Downloads include original records and their matching CSV, QC JSON and group history, every locally available original evidence attachment, and the native HTML/CSV/ZIP outputs. The driver uses the actual native buttons for two QC reports and three action reports, and exercises the original attachment download controls. It does not create a new scientific-report composition or edit evidence. Preserve those full files with their actual names and identity records. A fresh browser selects the same original reports/tasks and opens the native downloaded HTML at both widths, so receiving does not depend on the previous page's in-memory state. A failed invocation also attempts to retain interruption.png beside its actual exception.

The exact outgoing artifact identity and the actual browser result belong together in the existing receiving record. A completed result sets `journey.status` to `course_complete` and leaves `visual_review.status` as `producer_inspection_required`. The first field means the programmed course actions finished; the second explicitly retains the producing peer's obligation to look at the actual output. Record that producer's real inspection and concrete repairs in the original receiving record.

## Look at the rendered product and repair it

The producing peer must open the exact outgoing version and **look at its real screen or actual screenshots**. Read the saved PNGs from both desktop and narrow views. Capturing images without viewing them is insufficient. Source review, DOM counts, HTTP success, unit checks and another peer's approval do not replace seeing the product.

Operate the important user controls and inspect their outcomes: original record opening, saved review and decision selection, local draft/error behavior, downloads and independent reopening. Inspect populated and empty states and any loading/error state the actual course encounters. The actual export/reopen files and screenshots must come from this original operation.

Use plain industrial design: readable tables, clear hierarchy, consistent typography and spacing, restrained controls, useful labels and responsive layouts. Repair clipped or unreadable values, overlapping controls, broken downloads or unstyled output directly in the maintained application. Preserve the real computation, source data and history. Rerun the affected original course after the source fix; avoid broad unrelated suites or a separate review product.

Keep this rendered-product instruction in the build/receiving guidance consumed by the same local or cloud worker. Preserve existing owner instructions and project cutoffs. No restart, watcher or new review admission is required to use the course.

## Resume the same receiving operation

Use the same input file, Workspace key, operator origin and output directory, with `--resume`:

~~~text
node source/implementation/run_sample_qc_browser.mjs --url-file /private/operator-url.txt --workspace ORIGINAL_WORKSPACE_KEY --fieldwork /private/fieldwork-inspect.json --output /private/field-browser-course --resume
~~~

The driver compares the exact input hash and original bindings. A changed input or different Workspace needs its own correctly identified receiving edition; it must not overwrite the existing state. Preserve the original directory and all completed files.

If a queued export is still running, the same stored task remains authoritative. Continue that request and retain the actual returned status. If the current operation returns a concrete browser, source, queue or download exception, preserve `request-state.json`, `journey.json` and its current `attempt-N/` outputs before applying the source correction. Report the first useful exception with the actual application/source version, original project/plan/report IDs and issued command. Keep session-bearing URLs private.

A desktop action that completed before a narrow-view interruption remains part of the original course. Resume the retained operation; do not edit measurements or recreate report sources to make a screen appear populated. A freshly received Workspace should use its own original operator key and current private URL while retaining the same project and field IDs from the portable archive.

## Hand the useful result to the current case owner

Return the actual application and interpreter/browser versions, complete input identity, original project/plan/QC/action/task IDs, the completed or interrupted course result, full downloads and real viewed screenshots through the original receiving operation. Include any concrete repaired source and its immutable version.

The original headwaters case already owns its native model run, field continuation, mapped scientific delivery and whole-project archive. This browser course is the operator-facing continuation of those same saved records. The customer handback and independent portable receiving retain their original source owners and current requests. Use the completed guide and evidence to rehearse the actual programme, preserving the explicitly simulated input basis and the maintained application's calculated results.
