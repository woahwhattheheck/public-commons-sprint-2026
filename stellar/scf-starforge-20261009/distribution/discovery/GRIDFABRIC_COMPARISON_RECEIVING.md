# Receive the GridFabric report comparison in the original browser

The comparison helps an operator judge whether a source correction changes a prepared telemetry report and which original intervals still need source. Run this course as part of the existing GridFabric customer receiving operation, using two actual saved captures and their original request UUIDs. Authored example inputs must be labelled as engineering examples.

## Existing owner and complete inputs

The running GridFabric application and its native workspace stay with their original owner. Build the exact selected source with the maintained producer. Open its **Customer procedures** page through the original private connection. Keep both complete capture directories and the two existing request UUIDs. If they arrived as archives, receive them through the original archive receiver first.

The course borrows the existing Playwright page. It opens and closes only a temporary page for the exact downloaded report, restores its own route and viewport changes, and leaves the existing context with its owner. All application requests from this page are GET or HEAD. The comparison changes its browser selection and downloads; no native report or operating request is dispatched.

```js
import {receiveGridFabricComparisonBrowser} from './source/stellar/scf-starforge-20261009/distribution/discovery/gridfabric-procedure-comparison-browser.mjs';

const received = await receiveGridFabricComparisonBrowser({
  page: originalProceduresPage,
  beforeDirectory: '/private/customer/before-capture',
  afterDirectory: '/private/customer/after-capture',
  beforeRequestId: 'ORIGINAL_BEFORE_REQUEST_UUID',
  afterRequestId: 'ORIGINAL_AFTER_REQUEST_UUID',
  beforeReportId: 'ORIGINAL_BEFORE_REPORT_ID',
  afterReportId: 'ORIGINAL_AFTER_REPORT_ID',
  outputDirectory: '/private/customer/new-comparison-receiving'
});
```

Use report IDs from the original captures, especially when each includes several prepared reports. The output directory is create-new. The original reader receives both whole captures before the browser course begins. An interrupted directory keeps its complete available files and receiving record; inspect that original outcome before selecting another output. The course does not acquire an application/database/browser owner or take over an existing interrupted native receiving operation.

## What the course receives

The course follows the actual comparison controls, downloads complete JSON and readable HTML, checks them against both full original captures, saves populated desktop and narrow screenshots, and opens the exact downloaded HTML in the same browser context. Both complete source archives are included through the maintained streaming archive exporter. Up to the existing 64 MiB browser buffer, the actual browser archive-download controls are also exercised and their full files must match. Larger archives remain complete through the native streaming path; inspect the original direct-picker streaming control with the actual browser owner.

Reloading the page verifies that its selected request pair survives while full comparison must await a fresh original read. The saved comparison JSON is then reopened and downloaded again in full. Its exact input selection, original quantities, source trace and plan histories must match.

## Required producer screen inspection

A successful automated receiving record still says **REQUIRES_PRODUCER_LOOK**. Look at the actual desktop and narrow screen/screenshot, including the exact downloaded HTML report. Check that the original quantities and units, source-gap result, mapping details, interval paging, selected-report controls and downloads are useful and readable. Check cold reopen and the distinction between prepared READY, native management state and adapter acknowledgement. Record the observed output filenames and concrete screen observations in the original receiving delivery. Fix any visible defect before describing the outgoing product as ready.

Keep `Comparison_Browser_Receiving.json`, complete comparison JSON/HTML, both original capture archives, all screenshots and the existing full source/native receiving package together. The receiving record identifies actual browser evidence and any incomplete closure. Source-level arithmetic examples are separate evidence and do not replace this rendered course.
