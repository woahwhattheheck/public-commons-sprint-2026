# Complete report editorial receiving on the existing Page

This module operates the installed Report Editorial Reviews application on a caller-owned Playwright Page. It receives the exact completed report selected by the existing case owner; it starts no browser, native workspace, HTTP listener, scientific job, or archive receiver.

Continue the case owner's existing World Bank/Analysis receiving operation. Its prepared managed runtime is an installation input; its original data/report course must first produce a real COMPLETE report. Copy that actual job ID and result hash from the original Reports history. A runtime archive or interrupted receiving checkpoint is not a completed report selection.

## Compose with the existing native and browser owner

Install the maintained Report Editorial Reviews feature, including the native definitive stale-preview rejection record and current pending-action UI. The native core selection reviewed for this course is 11590b0213570e0144eaee530d1b7913c18628b7; the original UI route is /report-reviews. Keep the current complete application source with the existing case. This receiving module is an additive callback, not a replacement controller.

Pass the same Page already opened through the original private numeric-loopback Analysis launch. The existing capability remains in that browser origin's sessionStorage and is never copied to case files or logs. Give the callback an absolute output directory inside the caller's retained case and an immutable operation intent. The caller retains its existing operation lock and serializes these callbacks; do not invoke the same course concurrently.

The Page must be permitted to open local file URLs. The callback uses the actual downloaded self-contained HTML in its normal browser context, then returns to the original Analysis origin. Do not replace local HTML viewing with setContent or a synthetic recipient.

~~~js
import {
  runEditorialReviewCourse,
  reopenEditorialReviewCourse,
  recordEditorialScreenReview,
} from './report_editorial_course.mjs';

const result = await runEditorialReviewCourse({
  page,                         // existing caller-owned Page
  outputDir: caseOutput,        // absolute directory under this original case
  intent: selectedIntent,       // retain once; do not change on retry
  inspectScreen: inspectActualScreen, // optional callback; see viewing below
});
// Existing owner exports, closes and receives the full native workspace.
// It opens the received workspace with the original native owner and launch.
const reopened = await reopenEditorialReviewCourse({
  page: receivedPage,
  outputDir: caseOutput,        // exact same original files and operation
  intent: selectedIntent,
  inspectScreen: inspectActualScreen,
});
~~~

Use a Page the caller has reserved for this original course. Preserve any unrelated unfinished browser work through its existing editor before handing the Page to the callback.

Neither callback closes the Page, context or browser. Both remove their own dialog and request handlers on return. The original controller must drain its native/browser children and preserve the complete case according to its existing lifecycle.

## Select the actual wording and original source

The immutable intent has these fields:

~~~json
{
  "operation_id": "CASE_OWNER_ORIGINAL_EDITORIAL_OPERATION",
  "workspace_id": "ORIGINAL_32_HEX_WORKSPACE",
  "job_id": "ORIGINAL_32_HEX_COMPLETE_REPORT_JOB",
  "result_sha256": "ORIGINAL_64_HEX_REPORT_RESULT",
  "recipient": "Named internal recipient",
  "instructions": "Actual review instructions for the selected report",
  "reviewer": "Named internal reviewer",
  "reviewer_notes": "The reviewer's actual explanation",
  "proposed": {
    "title": "The selected proposed title",
    "introduction": "The complete proposed introduction",
    "sections": [{"title": "Complete section title", "note": "Complete section note"}]
  },
  "author_before": {
    "title": "A distinct author title for the same original report",
    "introduction": "The selected author introduction",
    "sections": [{"title": "Complete section title", "note": "Complete section note"}]
  },
  "author_after": {
    "title": "The selected concurrent author title",
    "introduction": "The complete concurrent author introduction",
    "sections": [{"title": "Complete section title", "note": "Complete section note"}]
  },
  "decisions": {
    "title": {"choice": "returned"},
    "introduction": {"choice": "current"},
    "sections/0/title": {"choice": "current"},
    "sections/0/note": {"choice": "custom", "text": "The selected resolved wording"}
  },
  "author_note": "Why these actual changes were accepted or retained",
  "later_author_introduction": "The selected later author work that replay must preserve"
}
~~~

Replace every illustrative value with the existing case owner's selected real source and complete wording. Supply one section entry for every original section, up to the original report engine's twelve-section contract. Decisions use the actual field keys returned by the native comparison; inspect the original preview before selecting them. A reviewer-changed field requires an explicit decision. An unmapped section can only keep the current structure. The callback preserves all original query names/revisions, parameters and original data selections. It does not invent new SQL, drop tables or substitute a toy report.

Choose distinct reviewer and author report-title changes so the same actual report has a genuine overlapping editorial change. Select another recipient-only or author-only field where useful. The source schema, source bytes, job hash and complete typed tables remain the original objects.

This course follows the current complete section structure. Source-native ambiguous/reordered section mappings remain available in the installed UI, but this callback does not manufacture a query reorder solely to produce a mapping conflict.

## What the complete course does

1. It opens the installed author UI and pages actual completed run history until the selected original job is found. The issue POST is retained before network dispatch, including its exact browser-generated ID and full pending author working file.
2. It downloads the complete source package and recipient HTML through the real UI. It verifies the original source/issue hashes and every complete table's presence.
3. It opens the exact recipient HTML at 1440 and 390 pixels. It makes the selected editorial changes, deliberately leaves an unfinished title, downloads both editable HTML and working JSON, and reopens both through their original controls.
4. It completes the selected wording, retains an edition and downloads the full attributed return. It saves and reopens that exact original return and edition chain, confirming the reopened recipient returns the same ID and wording. The complete original typed report is also downloaded unchanged.
5. It saves the selected author changes through the original reports.save HTTP route in the existing native workspace. It receives the actual return using the UI and captures the native full returned record.
6. It opens the actual comparison and freezes the UI's exact pending application, full preview and working file as one immutable dispatch intent. Before forwarding that application it saves another selected author edition through the same existing native owner. A retry restores that same original preview/request before replaying the concurrent save; it cannot silently refresh the comparison. The stale UI application must create the original native NEEDS_REVIEW record. The course reopens its full retained pending author working file and uses the real reconcile control to review current source again.
7. It chooses the explicit decisions and applies them. At this one selected response boundary it lets the original native POST finish, retains its complete status/body, then aborts only the browser reply. The shared server, workspace and other jobs keep running.
8. It saves the selected later author introduction. The original pending browser action is reopened and continued. Its native receipt must still name the first accepted revision while the later author head remains unchanged.
9. The received-workspace callback opens original issue and application history after the existing case owner's cold restore. It downloads the complete original package and HTML again, compares every original byte/value, and continues the exact original accepted action once more. It also opens the received recipient HTML at phone width.

All original UI mutation requests are retained before dispatch as one complete immutable intent containing the route, exact request bytes, parsed request and full pending browser working file. Missing derived request/working files are recovered from that single intent before dispatch or continuation. Native saves first retain the full original definition and exact request as one immutable intent, then derive the separate before/request files. They reuse the original request ID and expected revision on retry. The reopened callback compares the actual received head immediately before and after original-action replay; later legitimate author history and publication metadata remain preserved. Downloaded files use private temporary targets and are published only after the full download, validation and fsync. Existing complete originals are verified before reuse. Incomplete temporary files remain distinguishable from selected final files.

A retry uses the exact same output directory and intent. A corrected callback source is retained as a new full hash-named edition alongside all earlier bodies, with selected and actually operated source identities recorded separately; it does not replace or silently relabel earlier results. It resumes the original issue, return and applications from retained source and request records. Changed source or wording requires a deliberate separate operation selection; do not reuse a request ID for changed payloads. The original editable return includes its entire edition history. Before publishing the selected return download, the course also downloads the browser's actual complete working JSON through its original control, preserving working-copy branches as well as the complete edition chain. If a browser is lost, that actual working file is reopened before repeating the same return download.

The original rejected comparison and its author decision are retained alongside the accepted one. A failed or unknown response never causes a fresh replacement ID to be silently dispatched.

## Preserve the complete delivery

The output directory retains:

- immutable operation intent and every complete callback source edition, retained by exact content hash;
- full original issue/source package, every typed table, recipient HTML and unchanged original report JSON;
- unfinished and completed editable HTML/JSON, full attributed return and reopened return;
- every exact native issue/application request, complete pending browser working file, raw status/body and native outcome;
- original author definitions before and after review, exact saved query/parameter selections and later-author continuation;
- complete application/returned histories observed by the course;
- actual desktop and narrow screenshots, producing-worker viewing notes and an accurate mutable course status.

Include this entire directory in the existing original-case archive together with the complete current maintained application and full native workspace backup. The original WorkspaceArchives receiver carries the issue/return/application SQLite history. The callback does not make an additional archive, alter the original saved workspace or claim a provider save; the caller's existing source/case preservation owns that step.

If a step fails, course.json records that exact error and remains incomplete. Existing immutable files and requests remain available for continuation. operatedComplete records the original browser/native operation; receiving.operatedComplete records the separate cold receiving callback. visualReviewComplete requires actual producing-worker image observations. Overall complete becomes true only when all three are complete. The original operation can therefore finish and proceed to cold receiving while image inspection is still outstanding, with each state stated accurately.

## Actually view the rendered outgoing product

Before calling the outgoing product ready, the producing worker must personally look at the exact screenshots or open pages, including every table section, the actual downloaded editable HTML/JSON, rejected-current state, complete decisions and reopened history. Check both desktop and narrow widths for clipped controls, lost wording, unreadable tables and incorrect source labels. Open all outgoing attachments in their normal viewer.

An optional inspectScreen callback receives {path, name, width, page, operation_id}. It can record actual viewing as {viewed:true, findings:[...]}; omit it until a real producing-worker observation exists. Without that observation, the course explicitly records the screenshots as awaiting personal inspection. A producing worker who opens the images after the browser finishes can call recordEditorialScreenReview with the exact operation_id and observations containing each file, its selected sha256, viewed:true and the actual findings. That function checks every supplied image against the retained bytes before updating visualReviewComplete; it starts no browser and changes no native report. A successful DOM assertion, screenshot capture or source review is not that visual observation.

Respect Bryce's current in-app browser meeting hold. This course uses only an existing permitted isolated cloud browser selected by the original owner. It does not send recipient files or customer messages. Any later relationship send follows Bryce's per-message and per-attachment approval after positive human contact.
