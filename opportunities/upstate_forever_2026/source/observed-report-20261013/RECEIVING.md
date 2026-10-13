# Operate and receive saved scientific reports

The two commands in this directory continue the existing scientific report operation through the original operator. They use retained source manifests or exact saved source choices and produce a complete report edition, its readable files, an editable Workspace archive and independent receiving records.

## Native operation

Run from the complete application on the existing scientific receiver. The interpreter needs the application's retained dependencies, including ReportLab. This course formats original saved studies through the original queue.

Select the original Workspace, a separate receiving directory and one or more original typed-report manifests, in reading order:

~~~sh
python -B source/observed-report-20261013/receive_operator.py \
  --workspace /path/to/original-workspace \
  --output /path/to/report-receiving \
  --manifest /path/to/original-study/sources.json \
  --manifest /path/to/second-original-study/sources.json \
  --title "Upper Savannah scientific studies" \
  --selected-study
~~~

Each manifest must contain exactly one document marked **upstate.observed-report/v1**. Its original import brings the complete related source collection. Add **--create-workspace** for a new observed-science Workspace. Existing completed calibration, diagnostic, Monitoring and other study sources can be selected directly with **--selection /path/to/selection.json**:

~~~json
{
  "sources": [
    {
      "source_collection_id": "FULL_ORIGINAL_COLLECTION_ID",
      "source_id": "ORIGINAL_REPORT_SOURCE_ID"
    }
  ],
  "title": "Upper Savannah scientific studies",
  "contact": {
    "name": "Original report preparer",
    "organization": "Original project team",
    "email": ""
  }
}
~~~

Use the exact IDs from **Sources** or the original completed producer. The selection accepts sources, optional title and optional contact. The source order determines the report order. **--contact-json** can provide the same contact object separately.

The command performs the full maintained operation:

1. Import original manifests through source.import, or reopen the selected saved sources.
2. Preview the exact ordered scientific sources and queue source-reports.render.
3. Reopen the original completed operation and saved report edition.
4. Download PDF, HTML, Markdown and structured report data through their original file tickets.
5. Prepare and download the complete report ZIP, then read all original members.
6. Queue the complete Workspace backup, upload that archive through the original receiving interface, restore it independently and reopen the same report in Sources.
7. With **--selected-study**, preview and export that saved report through Study transfer, receive its original selected archive, and reopen the same edition with its retained editable dependencies.

The selected-study option uses the current scientific-report Study transfer family. The complete Workspace operation remains available independently. The existing producer resolvers determine the original editable history carried with each selected report source.

### Resume the original operation

Repeat the same command with **--resume**. Keep the original Workspace, output directory, source manifests or selection, title, contact and selected-study choice. The command uses stable queue request IDs and reopens completed operations and downloads. Interrupted or failed original tasks resume through the operator's retained task record. Its progress and original selection live beside the result.

The original preview is saved before its render request is submitted. On resume, the receiver verifies that saved preview against the same ordered sources, title, contact and Workspace, then submits the identical original task payload. It does not request a new renderer-derived preview for this retained operation. A completed task reopens its original edition directly.

If execution stopped after the original renderer published its complete operation but before the edition or queue completion was saved, the same render action verifies those original output files and publishes the missing edition record. A later formatter version does not rerender that completed output. An operation that has not yet completed rendering still uses the original installed-source check; changing its renderer does not silently replace its selected edition.

The selected-study export likewise reuses its saved preview token and original request. Complete downloads use streaming byte and checksum verification. The original report identity retains its authoring Workspace path after receiving. Subsequent report editions use their own newly reviewed preview and retain this completed edition.

**--timeout** sets the allowance for each original queued operation and receiving phase, default 1,800 seconds. The same command runs each report in one owned native process. Its supervisor follows that process's original progress record and gives startup, each queue operation, shutdown and the optional browser course their own deadline. An expired native thread cannot keep the course waiting indefinitely inside executor shutdown.

After expiry the supervisor stops that operation's process group, including its own native descendants, with a five-second termination grace before forced stop if needed. It preserves the child's exact failure record. If the supervisor detected the expiry first, it records the interrupted phase after the child releases the original operation lock; a newly resumed successor is never overwritten. **--resume** reopens the same output, task IDs, original preview and original source selection. Each independent ready course item can then continue in its own native process.

The native `scientific-report-receiving.json` is written after the report and both requested receiving paths complete. The progress file records `closing` while the operator drains, `browser` while the selected browser course runs, and `complete` after those phases finish. A native complete receipt remains available when a later browser phase needs to resume.

**--upload-limit-gib** sets the original receiver's archive capacity, default 4 GiB. Use the capacity appropriate to the retained project.

## Open the result

The output directory contains:

| File | Purpose |
| --- | --- |
| report.pdf | Complete print report |
| report.html | Readable report with retained scientific figures |
| report.md | Editable report text |
| report-data.json | Original structured report sections and source choices |
| scientific-report.zip | Report files, original inputs, figures, selection and edition |
| scientific-report-workspace.zip | Complete editable Workspace and application |
| selected-scientific-report-study.zip | Selected report and editable study dependencies when requested |
| scientific-report-receiving.json | Actual report, source, queue, archive and restored Workspace identities |
| receiving-progress.json | Retained operation progress and any actual exception |

The receiving record gives the original and restored Workspace paths and the operator-state directory. Start the original server with the recorded original Workspace and operator state to reopen its registered restored projects. Keep the private operator URL in a local file for the browser continuation.

## Existing browser continuation

On the authorized browser receiver, open the same registered operator with Playwright/Chromium:

~~~sh
node source/observed-report-20261013/receive_browser.mjs \
  --url-file /path/to/private-operator-url \
  --receiving-receipt /path/to/report-receiving/scientific-report-receiving.json \
  --output /path/to/report-browser \
  --video
~~~

The browser selects the actual restored Workspace, opens the saved report and its live report frame, and downloads the original PDF, HTML, Markdown, data and complete ZIP. It then reuses the saved ordered studies, checks reorder previews, reloads the browser draft and reopens the report at desktop and phone widths. When the native record contains a selected-study restore, that independent Workspace is opened too.

The browser journal includes the original edition, completed downloads, screenshots, optional video and any actual interface error. Its default course reopens saved scientific work and prepares previews; it should produce no new queue submission.

If both native and browser execution are available on the same authorized host, pass **--browser-node /absolute/path/to/node** and optionally **--video** to the native command. It opens the original server over loopback, creates a private URL file with owner-only permissions, runs the adjacent browser continuation, and closes that server when finished. The private URL is omitted from the published journal.

For the completed original assessment preparation, also pass **--assessment-preparation /path/to/assessment-preparation** with **--browser-node**. This joins the existing [assessment browser chapter](ASSESSMENT_BROWSER.md) in the same page and browser context before the saved Sources report course. Use the retained output from `prepare_assessment.py`; the chapter opens the original studies and saved contexts and uses their existing queued report preparation and exact composer handoff. The option belongs to one original report continuation, so use its completed report receipt rather than adding it to a multi-report **--course** invocation.

The existing ASTRA13 operation0669 owns the native source/render/receiving course. Its original browser owner can run the browser continuation against the completed native record. Source preparation, model studies and their original report producers continue in their existing project operations.

## Continue several accepted report operations

Use **--course regional-report-course.example.json** to run an explicit ordered group of original report selections through this same receiver. Each item retains its original output, queue tasks, report edition and complete receiving record. Missing source inputs or a failed item are recorded while independent ready items continue. Resume the same course with **--resume**. The complete three-operation native example, original source preparations and identity behavior are in [RECEIVING_COURSE.md](RECEIVING_COURSE.md).
