# Merchant workspace

Keep a merchant case queue, diagnose each route, inspect its runtime and delivery outcomes, review repairs, and prepare internal workorders in one local workspace. The same original captures move through each stage. The optional case desk retains multiple merchant drafts, follow-up ownership and dates, original runtime support files, search, work status and saved versions across restarts.

## Open the workspace

From the repository root, with Node 22 or newer:

```sh
node stellar/scf-starforge-20261009/sf74-merchant-support-console/server.mjs
```

For a durable merchant queue, add `--cases-dir "$HOME/.local/share/stellar-forge/merchant-cases" --port 8784`. Open the printed `http://127.0.0.1:<port>/` address. No package installation, account, database or hosted service is required. Nothing is probed on page load. [Case desk operations](CASE_DESK.md) covers the complete save, reopen, follow-up, concurrent-tab and version-recovery flow.

## Diagnose → review → prepare

1. **Diagnose a route.** Enter the actual seller resource, facilitator catalog, buyer origin, Stellar network, public payment recipient and advertised buyer method. Set the credentialed-browser option to match the intended buyer, confirm authorization, then choose **Run diagnosis**. Review the findings and captured scope.
2. **Check browser access when needed.** A POST capture offers a separate **Check browser access** action. Review the displayed seller, origin and credential mode, then authorize its OPTIONS-only check. The original eligibility gate may decline an unsuitable capture without making a request. It never sends a POST.
3. **Keep the before capture.** Choose **Use as before**. Its exact diagnosis bytes and any displayed browser check remain selected in the tab. After the separately agreed repair, run the same diagnosis and optional browser check, then choose **Use as after**. Selected captures survive the next diagnosis. **Save before**, **Save after** and **Save browser check** preserve these original files whenever you need them.
4. **Review changes.** Choose **Compare changes**. The result explains remaining, new and no-longer-observed findings, including incomplete coverage and unconfirmed credential policy. Original CLI captures can instead be opened in the same file slots. Optional POST browser checks must be supplied as a pair, each bound to its unchanged diagnosis.
5. **Prepare workorder.** The selected captures are already available here. Enter the actual workorder reference, seller and relationship owner. Record existing seller permission and owner-approved economics only when you have their records. Safe defaults leave permission unrecorded and price withheld. A before capture alone is sufficient; select **Use only the before diagnosis** to deliberately omit an available repair comparison.
6. **Create and save.** Choose **Create workorder**, then download the readable HTML workorder, Markdown handoff checklist and JSON. Open the HTML locally for review. Nothing is sent. Use **Reuse saved owner terms** to import or save the form as JSON for another session.

The three stages also work with existing files: you can open a before capture and prepare a workorder without running a diagnosis or comparison first. A workorder with an after capture computes its review through the original comparator automatically.

Changing a selected capture clears any comparison and workorder made from it. Replacing a diagnosis also clears that side’s browser check. Changing owner terms, selecting an import, or changing baseline-only mode clears prior workorder downloads; failed imports leave the existing form values intact and require a fresh workorder. Late responses cannot restore outdated results.

This is an unpaid diagnostic and internal workorder workflow. Seller acceptance, delivery approval, commercial contact, invoices and payments remain separate owner decisions. No consent, price or acceptance is inferred from a technical result.

## Save the source files

With `--cases-dir`, **Save case** explicitly stores the original workspace plus case metadata. Reopening resets transient probe authorization and regenerates derived comparison/workorder views from the retained inputs. Without that option, state lives in the current tab and process. Portable workspace files remain available in either mode. There is no localStorage, telemetry or automatic saving.

Current captures use **Save diagnosis** and **Save browser check**. Retained selections have their own save buttons, so an earlier capture remains downloadable after a new diagnosis. These exact bytes also feed comparison and workorder generation. Do not reformat a diagnosis after generating its browser check: that check contains the SHA-256 of the original file.

Human result titles appear in the workspace; original schema names, states, hashes, nested observations and limits remain in expandable **Source details** and downloaded JSON. A file hash identifies bytes; it does not independently authenticate an observation or establish seller permission.

## Existing modules and boundaries

SF74 is the local UI and HTTP adapter. It imports the existing engines without copying their decision logic:

| Operation | Original implementation |
| --- | --- |
| Route diagnosis | SF70 `parseArgs` / `capture`, using SF52 and SF68 |
| POST browser check | SF72 `evaluate` and its original eligibility gate |
| Before/after comparison | SF76 `compare` |
| Workorder, HTML and checklist | SF77 `buildPacket`, `renderHtml`, `renderChecklist` |

`server.mjs` serves the static native HTML/CSS/ES modules and same-origin API. `console.mjs` owns transient selections, cancellation and explicit downloads. `terms-editor.mjs` owns only the form fields; the original SF77 builder remains authoritative for terms, economics and acceptance.

`case-desk.mjs` adds the original page's merchant queue and case lifecycle. `case-store.mjs` persists byte-exact v1 workspaces and compact workflow metadata under a process-selected private directory. It uses revision checks and atomic head selection to preserve concurrent edits; the original diagnostics remain unchanged.

- The server binds to literal 127.0.0.1 and rejects unexpected Host or Origin. CSP blocks external page content. No third-party JavaScript, credentials, wallet or database is used.
- Only **Run diagnosis** and the separately authorized browser check invoke diagnostic network operations. The network gate permits one intake or preflight at a time.
- The credentialed-browser option checks the stricter policy without sending cookies or authorization. Before and after must retain the same mode. Unknown legacy mode remains unconfirmed and cannot establish the technical milestone or cleared findings.
- Comparison and workorder generation are offline and in memory. Each uploaded source or terms file is limited to 2,000,000 bytes. Exact file bytes are transported as base64, decoded and hashed before parsing; no server filesystem path is accepted.
- `POST /api/workorder` takes `before`, `terms`, optional `after`, and optional paired `postBefore` / `postAfter` original file bytes. It returns the original `packet`, `html` and `checklist`. HTML is downloaded as a document, never inserted into the workspace DOM. A precomputed comparison verdict cannot substitute for source captures.
- Workorders preserve the original HTTPS scope requirement. `--allow-loopback` exists only for explicit local diagnostic fixtures; HTTP fixture captures are not commercial workorder inputs.
- Use public recipient addresses and authorized endpoints. Do not enter private keys or tokens.

For the original seller-side operation workflow, see [seller pilot](../sf82-seller-pilot/README.md). Commercial ownership and account submission remain with their existing owners.

## Continue a live merchant support case

The **Runtime** stage imports the existing SF93 four-file support packet into this same case. Select its actual route and attach a baseline or follow-up capture. Optional original SF97 reports and copied SF98 journals run through the original native reconciler, retaining the report's own observation window and payment-option assignments. [Runtime support operations](RUNTIME_SUPPORT.md) covers collection, intake, comparison, saved versions, recovery and complete handoff.

**Save case** retains runtime source bytes under the same revision as the route, diagnosis and owner notes. **Prepare support handoff** produces a readable offline report and an importable complete case containing the original files. The original portable `.merchant-workspace.json` format continues to transfer diagnostics and unfinished terms; use `.merchant-support.json` when transferring runtime files and follow-up metadata too.

## Focused checks

The workorder adapter has a focused composition check:

```sh
node --test stellar/scf-starforge-20261009/sf74-merchant-support-console/test/workorder.test.mjs
```

It exercises the actual local HTTP API and original source modules with explicitly illustrative HTTPS observations: baseline export, GET repair review, paired POST preflight binding, legacy uncertainty, escaped HTML, original renderers, missing approvals and prohibited path input. It makes no merchant request and is not evidence of a live seller repair.

Existing `comparison.test.mjs`, `credentialed.test.mjs` and `post-preflight.test.mjs` cover the earlier native loopback diagnostic integrations. They are separate from this offline export check. Rendered browser click/download QA was not run in the delivery environment because its browser executable was unavailable.
