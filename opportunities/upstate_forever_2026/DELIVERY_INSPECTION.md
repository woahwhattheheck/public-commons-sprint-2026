# Reopened scientific delivery and original companion files

This operator addition joins the existing delivery detail, saved scenario analysis, receiving-water plans and original map atlas. It reads the delivery that the model already retained. It does not run another scientific or economic calculation.

## Operator journey

1. Open an existing delivery in the original workspace. The detail shows the retained audit state, scientific HTML/PDF/Markdown/data, complete delivery ZIP and editable workspace archive.
2. Open the linked scientific report or retained economic desk. The preview can follow relative companion links to exact files listed in this delivery. Back returns to the previous preview. Download original HTML always returns the recorded bytes; the preview alone has an added navigation script.
3. Open the attached saved scenario analysis, source watershed report, receiving-water analysis or prepared plan. Original source collections and native runs have direct selectors. These actions use the existing desks and item readers. The exact original IDs remain visible.
4. Search the complete retained file inventory by path, title, field name or SHA256, and filter by file group. A page displays 25, 50, 100 or 250 rows. The displayed count and byte total refer to all matching files; pagination does not omit assets from the delivery or archive.
5. Reopen the delivery after changing workspaces. Old previews and pending detail requests cannot switch the new workspace to an old retained record. A queued dialog-close event invalidates only the request that actually rendered that dialog, preserving a newer source/run open already in flight.

A prepared source-area plan and a completed receiving-water analysis remain distinct identities. Source-area results retain their original polygon/reporting intersection. Overlapping receptor polygons remain individual areas; combined receiving-water quantities come from the retained native family union.

## Files and current integration

- operator/delivery_inspection.py: declared-member inventory, original file tickets and isolated linked previews.
- operator/extensions/delivery-inspection.json: one authenticated inspection route and two typed file-route families.
- operator/web/delivery_inspection.mjs: original detail rendering, full-inventory search/pagination, exact source navigation and preview link handling.
- operator/web/app.mjs: narrow original openItem/dispatch/lifecycle hooks, preserving current portfolio detail mounting and all existing delivery-form metadata.
- operator/web/scenario_analysis_bridge.mjs: public open(id, {workspace_key}) using the original analysis-open action and host navigation.
- DELIVERY_INSPECTION.md: this guide.

The current economic_desk.mjs already contains Prepare client report from a completed edition (37,113 bytes, SHA256 e1d3f9d9e3102c4ac1bbf4fddc74dbaa661ae8bf1af8d21e4e7ecec7d23334b9). This addition consumes that existing path and the original economic HTML; it does not replace either.

Install these complete source files in the current application, composing the provided exact app edits against any newer app source. The current shared extension registry discovers operator/extensions/*.json on operator startup and admits the descriptor's browser asset. The host installer must already be installed; this packet does not replace server.py, extension_registry.py, extension_host.mjs or any model/report/receiving module. Restart the local operator after receiving the descriptor/backend.

## API contract

GET /api/delivery-inspection?workspace=KEY&delivery_id=ID returns upstate.delivery-inspection/v1 with workspace_key, delivery_id, files, file_count, total_bytes, links and compact detail. The original delivery branch loads this endpoint exactly once, bypassing /api/item and its unrelated workspace overview/eager file-ticket expansion. detail carries exact original schema/id/state, title, map count, audit status, error and priority fields; the full original record remains a declared lazy download. Only an explicit HTTP404 ROUTE_MISSING falls back to the original item API on an older operator. Authorization errors and malformed/mismatched responses are surfaced directly. Each files entry contains original path, bytes, SHA256, retained field keys, title, original url and preview_url.

GET /api/file/delivery-view/KEY/ID/MEMBER returns an exact original member through the existing ticket transport. Add ?download=1 for a download.

GET /api/file/delivery-preview/KEY/ID/MEMBER returns a derived HTML preview for an HTML member, or the original ticket for another type. HTML is read only after original file size/hash validation. The preview is stored under the operator's previews/delivery-html directory by its derived body SHA256. The original immutable delivery is unchanged.

Allowed members are precisely the complete descriptors in delivery-state.json files/maps, plus delivery-state.json itself. Duplicate paths must agree in size/hash. There is no arbitrary workspace path route and no directory listing. Typed-route member validation, workspace containment, existing authorization, verified file tickets, range handling and original byte/hash checks remain in force.

The inventory cache holds at most four deliveries and invalidates on the original record's device/inode/size/mtime/ctime signature. Opening the file reuses the original transport's actual hash verification. Inventory reads do not issue thousands of unused download tickets.

## Linked preview isolation

The original operator's download cookie is HttpOnly, SameSite=Strict and limited to /api/file/. Opaque sandboxed HTML should not depend on its own cross-site child requests inheriting that cookie. The parent operator therefore performs declared companion navigation.

HTML keeps an opaque sandbox with scripts, downloads, modals and popups. PDF retains the original unsandboxed browser PDF viewer. It does not receive a bearer token, and allow-same-origin is absent. A small script handles anchor clicks:
- same-document #fragment anchors remain in the report;
- generated blob/data downloads retain the original economic desk behavior;
- original relative companions send a message to the parent;
- external HTTP/HTTPS public-source links are opened by the parent with noopener/noreferrer; a visible parent link also supports browsers that block a popup.

For a retained HTML document with its own Content-Security-Policy meta element, the derived preview admits the exact SHA256 of the navigation bridge in that document's effective script policy. Existing script hashes/nonces and all other resource directives remain intact. A policy that already permits unqualified inline scripts is preserved, because adding a hash would otherwise disable its original economic controls. Each actual policy meta element is handled independently; quoted text inside a report's script or narrative is untouched. The byte-exact original download is unchanged.

The parent accepts messages only from the currently displayed iframe, in the current workspace, with the expected message type. Relative file navigation must match the exact current delivery-preview prefix and exact retained inventory member. It cannot navigate an operator route or request another delivery. Public-source navigation rejects credentials and non-HTTP/HTTPS schemes. Other original download types use the parent context and original file route. No same-origin privilege is added to the child.

The standards relevant to this choice are WHATWG's iframe sandbox rules (https://html.spec.whatwg.org/dev/iframe-embed-object.html) and Chromium's explanation of opaque sandbox cookie behavior (https://github.com/explainers-by-googlers/csp-sandbox-allow-same-site-none-cookies/blob/main/README.md).

## Focused receiving check

Source evaluation exercised the actual client with 25,001 retained-file descriptors: complete-inventory normalization took 157 ms in this V8 session; the actual table emitted 50 data rows. A search matched the last retained file and clamped an out-of-range page correctly. The same check exercised derived-preview/original-download separation, the opaque sandbox, original scenario-analysis navigation and rejection after a workspace change. It used minimal DOM adapters. The direct-load check also confirmed one inspection request, preservation of the original map count, no fallback for authentication/malformed responses, and the explicit missing-route-only legacy fallback. Extracted actual detail/close code preserved a newer request against a queued close event and preserved an already reopened dialog. Actual Python and browser receiving are the remaining environmental checks.

On the current complete native application, open an existing retained delivery with an attached scenario analysis and economic edition. Confirm:
- the original HTML report opens; its economic index/selection/source-report links navigate or download through the parent and Back returns;
- an original public source opens as a separate public page and its fallback parent link is usable;
- economic controls and generated local exports still work;
- original PDF/HTML/CSV/ZIP downloads match the retained bytes/SHA256;
- open saved analysis and prepared plan uses the original completed record;
- changing workspace closes the old preview and a stale message cannot open another workspace's files;
- a URL for a file absent from the original inventory is rejected.

Use the original native receiving host for this browser pass. Gura engine acceptance remains on its original geography; the four South Carolina source areas require an overlapping Upper Savannah regional grid.
