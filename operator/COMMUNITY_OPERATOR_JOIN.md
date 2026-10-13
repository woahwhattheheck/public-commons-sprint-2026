# Communities operator integration

The two browser files are complete source additions. The callable browser receiving program uses the same original server, forms, task queue and portable workspace. The existing app owns authentication, selected workspace, original operation IDs, dialogs, the task queue, original file tickets, backup and restore.

## Existing app hooks

1. Import attachCommunity from ./community.mjs.
2. Add communities: 'Communities' to viewLabels.
3. Add action labels for community.table.import (Import community table), community.plan.save (Save intervention plan), and community.report.build (Build community report).
4. After the existing const endpoint declaration, initialize:

~~~javascript
const community = attachCommunity({
  getState: () => state, api, endpoint,
  openForm, submitAction, detail, fileList, sourceForm, toast, openItem
});
~~~

All referenced ordinary function declarations are hoisted. The endpoint const must already be initialized.

5. In render(), assign html = community.render() when view === 'communities'. After the existing $('#content').innerHTML = html, call community.mount($('#content')) in that view and community.detach() otherwise.
6. Near the top of existing dispatch(button), after reading its action, route:

~~~javascript
if (action.startsWith('community-')) return community.dispatch(button);
~~~

7. Add the existing navigation-shaped <button data-view="communities">Communities</button> and <link rel="stylesheet" href="/web/community.css"> to operator/web/index.html.
8. In original Handler.do_GET static selected allowlist, add community.mjs and community.css beside the existing index.html/app.mjs/style.css entries. Existing extension-to-MIME selection already accepts both.

## Original native contract

State lists are data.community_tables, data.community_plans and data.community_reports. Exact item kinds use those names. The module loads original detailed tables/plans from the existing authenticated /api/item. Reports request fresh original file tickets.

The three native actions use the agreed original task queue. Plan notes are nonempty lines; intervention notes are a string. Costs remain null or a nonnegative decimal string. Empty filter arrays use the complete source selection. Utility and watershed filters match the same original membership. Population and poverty totals count unique geographies; the UI displays individual original median household incomes.

A report preview uses the generated original HTML file ticket inside a sandboxed iframe. The normal original file list downloads the full editable report assets. Its table input, original GIS context and proposed interventions remain separate factual layers.

All source files under operator/ are included automatically by the existing scientific workspace portable archive.

## Actual backend join

The original joined backend packet is Git blob b69242a185e5005f6629173dccbb047c813effa9 in woahwhattheheck/commons, over current application base d56e5cf959bf57cd52bbc94a2974b9a026c018a5. Its source manifest at source/communities-rfp-20261012/source-manifest.json registers the complete seventeen-row original edition. Backend/server changes remain with that whole application integration.

The public selectors use the exact same utility-and-watershed membership as the backend. Filtering retains the selected memberships and the complete original memberships; utility or watershed rollups cannot introduce a membership from a different selection. Redrawing selected GEOIDs retains keyboard focus on that same original checkbox.

Generated HTML file tickets open inline when download is false. The original file server must apply its HTML-only policy: default-src 'none'; style-src 'unsafe-inline'; sandbox. Explicit downloads and byte verification retain the ordinary file-ticket behavior. Other media keep their original policies.

## One complete browser continuation

Run operator/community_receiving.mjs while the original Python server is alive, in the same foreground producing process. Root starts it with start_server(..., create=True, source_manifests=[APP/source/communities-rfp-20261012/source-manifest.json]) and preserves the actual returned operator_url and workspace_key.

~~~sh
node APP/operator/community_receiving.mjs \
  --url ORIGINAL_OPERATOR_URL \
  --workspace ORIGINAL_WORKSPACE_KEY \
  --output PRIVATE_BROWSER_DIRECTORY \
  --node-modules ORIGINAL_NODE_MODULES \
  --chromium ORIGINAL_CHROMIUM \
  --python ORIGINAL_PYTHON
~~~

A private --control JSON can supply operator_url, workspace_key, output, node_modules, chromium and python instead. The capability-bearing URL remains a private input. UPSTATE_COMMUNITY_URL, UPSTATE_COMMUNITY_WORKSPACE and UPSTATE_COMMUNITY_OUTPUT are also accepted. Use the installed Playwright browser/runtime paths; absent --chromium, Playwright selects its installed Chromium. The code resolves Playwright through the supplied node_modules or the normal installed module resolution.

The operate segment carries the original registered source preview/import, community table import, both utility comparisons, selected-GEOID keyboard comparison, complete two-intervention plan and immutable revision, full report, all twelve report downloads, exact ZIP-member readback, native workspace backup, original archive restore, original records readback and browser reload. Original census totals and source hashes are checked against the retained RFP edition. Planning work and blank cost estimates are entered through the ordinary operator form.

Every original /api/actions request is written to community-browser-progress.json before dispatch. A retry over the same output directory receives the same operation and task IDs. An interrupted task continues through the original resume action; after a concrete source repair, --resume-failed-tasks explicitly resumes that same failed task. The original workspace, input selections and output directories remain bound.

Complete output is community-browser-result.json. It contains source/table/initial_plan/revised_plan/report IDs, task IDs, report downloads, workspace_archive and received {application, workspace, workspace_key}. Original source records, report files, screenshots and full progress remain in the same private output directory.

Then close the original server and start the actual received application on received.workspace. Invoke the same program against that server's current URL and workspace key with --mode reopened and the SAME output directory:

~~~sh
node RECEIVED_APPLICATION/operator/community_receiving.mjs \
  --mode reopened \
  --url REOPENED_OPERATOR_URL \
  --workspace RECEIVED_WORKSPACE_KEY \
  --output SAME_PRIVATE_BROWSER_DIRECTORY \
  --node-modules ORIGINAL_NODE_MODULES \
  --chromium ORIGINAL_CHROMIUM \
  --python ORIGINAL_PYTHON
~~~

The reopen segment reads the same source, table, initial plan, revised plan and report, follows the prior revision in the interface, reopens the report preview and receives its exact downloaded members from the restored application. This is the continuation of the original receiving operation. --mode reopen is an equivalent spelling.

Optional --source-collection, --source-id, --source-sha256 and --registered-source select a known original source precisely. A --context JSON may select existing source_collection_ids, grid_id, baseline_run_id, scenario_run_ids and delivery_id; the ordinary form and original backend validate those selections. The program only operates on existing scientific results.

