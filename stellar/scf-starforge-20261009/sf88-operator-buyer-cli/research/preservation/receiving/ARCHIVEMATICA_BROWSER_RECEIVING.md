# Archivematica browser receiving

This program opens the same completed 169-record Archivematica receiving operation
in Chromium, uses the original application's operator interface and receives its
complete exports into a separate editable workspace.

The provider receiving runner must first finish
`ARCHIVEMATICA-RESEARCH-RECEIVING-6BA15-20261012`. Its actual completed report
supplies the original workspace, prepared package, transfer, SIP and AIP
identifiers. The browser continuation keeps that provider operation and source
package selected throughout the handover.

## Operator journey

1. Open the original research edition and its completed Archivematica destination.
   The installed RODA, Preservica and LIBNOVA destinations are also present.
2. Page and search the original records, open their metadata editor, save an
   operator review note and restore the original review content in a subsequent
   saved revision. The original receiving destination retains its frozen review.
3. Download the original BagIt ZIP, source review, complete receiving JSON and
   HTML report through Delivery. Open the downloaded report in Chromium.
4. Export the selected Archivematica operation through its browser control,
   download the complete provider archive and receive it into another directory.
5. Export the complete research workspace through Delivery, download it and
   receive its application, original edition, reviews, destinations and history.
6. Stop the original workbench process, start the received application and open
   the original destination and editable records at desktop and narrower widths.

The provider archive and whole-workspace receiver use the selected application's
original implementations. The receiving comparison follows the saved proof,
original prepared-file inventory, record count, settings, source and operation
identifiers. The browser source does not implement a substitute repository.

## Inputs

The complete receiving carrier supplies the current application and a source
manifest with this structure:

~~~json
{
  "operationId": "ARCHIVEMATICA-RESEARCH-RECEIVING-6BA15-20261012",
  "files": {
    "research/preservation/archivematica.py": {
      "bytes": 42821,
      "sha256": "<exact SHA-256 of the supplied source>"
    }
  }
}
~~~

The actual manifest contains every supplied application member. All five
Archivematica provider files are mandatory, together with the original
preservation and workbench source. The selected files are compared to this
complete manifest before the browser starts.

The provider report must contain its actual successful receiving fields:
`status: PASS`, `recordCount: 169`, `nativeState: VERIFIED`, `operationId`,
`workbenchWorkspace`, `preparedWorkspace`, `transferUuid`, `sipUuid`,
`aipUuid` and `packageId`. The browser compares these values against the
original application and saved receiving proof.

## Run the complete continuation

Use the same environment and source supplied for the provider receiving.
Select the actual installed Python, Node, Playwright module and Chromium
executable in that environment:

~~~sh
node receiving/run-archivematica-browser.mjs \
  --application /absolute/complete-source/application \
  --workspace /absolute/receiving/foundation/workspace \
  --operation-id ARCHIVEMATICA-RESEARCH-RECEIVING-6BA15-20261012 \
  --source-manifest /absolute/receiving/application-source-manifest.json \
  --receiving-result /absolute/receiving/receiving-result.json \
  --output /absolute/receiving/browser \
  --python /absolute/selected/python3 \
  --playwright-module /absolute/installed/playwright/index.mjs \
  --browser /absolute/installed/chromium
~~~

Place `archivematica_browser_support.py` alongside the browser runner. Playwright
can also be resolved from the installed primary-runtime modules; Chromium can be
selected from the installed Playwright browser. Explicit paths take precedence.

The workbench opens a local ephemeral port for each original/received process
and records its announced address. The browser uses the real application routes,
controls and downloads. The optional provider-fixture reopening mode is useful
when inspecting the original repository state separately; this completed
browser continuation reads the saved provider operation.

## Output and continuation

The output directory contains `browser-result.json` with the actual runtime,
source identities, original provider identifiers, completed phases, final review
revision, every deliverable identity and the separately received workspace path.
A complete result has `status: PASS`.

`ARCHIVEMATICA_BROWSER_RECEIVING.html` joins seven screenshots with the downloaded
source, receiving results and two complete delivery archives. Open that HTML
beside its `screenshots/` and `downloads/` directories.

The provider receiving result, baseline, phase records, actual application
requests and local server shutdowns accompany the report. Review edits create
normal retained revisions; the final review content matches the original.
The prepared provider-file inventory remains byte-identical through the browser
handover and both receiving paths.

Run again with the same inputs and output directory to reuse completed phases
and verify a completed result. An interrupted local export is reconciled from
the workbench's original saved job and artifact. Runtime failures preserve their
actual error and completed phases for continuation.

## Source and receiving references

- [Archivematica operator guide](../application/research/preservation/ARCHIVEMATICA.md)
- [Released provider contract](../application/research/preservation/ARCHIVEMATICA_PROVIDER_CONTRACT.md)
- [Research workbench guide](../application/research/preservation/WORKBENCH.md)

## Continue after an interrupted handover

Rerun the same command with the same input and output paths. Each screenshot retains its original capture selection, layout and file identity before final publication. Completed server shutdowns keep their own instance records; a reopened instance adds its shutdown without replacing the earlier one. The programme retains one completion candidate containing the network record, HTML and artifact inventory after the original servers drain, and finishes that same candidate on reopen.

If a local export published its ZIP before its final job status was saved, the browser opens Activity and uses **Recover completed export** for the saved original job. The application verifies that archive and restores the original download. It retains the same export job and original package selection.
