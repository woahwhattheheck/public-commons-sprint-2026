# Complete original Flow comparisons

The existing Measurements → Flow → Compare original editions workflow now offers readable comparison HTML and a complete original ZIP beside the retained comparison JSON. Both exports use the exact pair shown in the completed comparison, not unsubmitted values in the earlier/later selectors.

## Source and deployment

Deploy both complete flow_editions.mjs mirrors with engine/flow_comparison.mjs and the matching existing Flow HTTP routes. This UI is part of the parent’s atomic comparison release; do not install it before its backend. It imports no new browser dependency and uses the existing flow_editions.css. Preserve the separately merged scientific load-contract editor4797 and current original-measurement/native handoff leaves.

Expected existing API calls:

- POST /flow/comparison-report with {before_id,after_id}. Response binds comparison_id, before_id, after_id, name, type:"text/html; charset=utf-8", content.
- POST /flow/comparison-bundle with the same exact pair. Response binds comparison_id, before_id, after_id, name, type:"application/zip", bytes, sha256, base64.

The browser rejects a mismatched pair, missing comparison identity, invalid filename/type or incomplete HTML before downloading. ZIP bytes and SHA use the existing checked download helper. If the host closes while preparation or asynchronous hashing finishes, this comparison action does not download into an abandoned view. There is no additional result save or source mutation.

## Scientist and recipient course

1. In the existing populated Measurements workspace, select two different saved original Flow studies and choose Compare studies. Retain their exact original source generations and date ranges.
2. Read the displayed earlier/later identities and complete counts. Inspect daily changes, approval/qualifier differences, calendar support and both sampling contexts. A later source edition does not automatically replace the earlier one.
3. Download the complete comparison JSON, readable HTML and complete ZIP. Selecting a different option above without comparing again leaves these downloads bound to the displayed pair. Execute Compare studies to replace the displayed comparison.
4. Extract the ZIP to an independent output directory and open report.html normally. The complete archive contains report.html, comparison.json, comparison.csv, comparison-selection.json, before/* and after/* complete seven-file study families, and its manifest. Follow original source, study, CSV and report links. The standalone HTML uses the same sibling paths; retain the extracted archive for working offline links.
5. Open every comparison CSV row and both original source families. Missing/ambiguous daily discharge remains missing/ambiguous, period volumes retain their quantified support, and a sampled date remains daily context rather than instantaneous discharge or an annual chemical load.
6. Use the original source-native comparison receiving/rebuild command in the complete parent release to reproduce the chosen pair from its full retained studies and compare exact outputs. Reopen the original portable Measurements workspace separately; no source record or study is overwritten.

## Existing receiving boundary

Continue original Measurements course1791912701.626469 and the current actual DE49/CLOUD13/WO46 recipient. Preserve that host’s existing workspace, processes, source boundaries and any pending native request. This is not a new browser or scientific simulation operation.

Current application AGENTS.md v2026-10-13.1 and CURRENT_OWNER_DIRECTION.md v2026-10-13.4 apply. Bryce’s original browser reservation is released; preserve active tabs. Personally operate and LOOK at the affected comparison controls/report at normal laptop and390px widths. Exercise loaded/empty/error and changed-selector behavior; actually open the downloaded HTML, both full original source families, CSV/JSON and ZIP, then independently reopen. Source/API checks do not claim physical browser or native acceptance. Return actual host/source/commands and the first concrete affected-product exception through the same course.
