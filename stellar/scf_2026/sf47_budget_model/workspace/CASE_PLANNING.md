# Edit an existing case from its complete workbook and saved plan

The case planning workspace joins the original planner, source-table and workbook readers, native saved revisions, and the existing Delivery Operations amendment workflow. A lead can open an operating case, receive a returned workbook, review the complete change, save a native revision and bring that exact revision back to the same case.

The case header shows its selected baseline revision separately from the planner's working revision. Each operating case keeps its original identity and history. The existing amendment save, review and apply transaction selects a revised baseline for that case.

## Open the existing case

Sign in through the normal Planning & Operations application as its owner or an assigned lead. Open **Delivery operations**, select the retained case and choose **Edit plan and workbook for this case**. The **Plan amendments** section also provides **Edit plan and workbook**.

The planning desk opens the latest saved revision of that case's original plan. If an unsaved draft for that same plan is already open, it keeps those complete entered inputs. A draft of another plan remains in the original planner until it is saved.

The case planning header retains:

- Original case ID, name, version and selected baseline.
- Original plan ID and complete native working revision.
- Complete scenario, planning inputs, calculation and workbook/source project.
- Revision note, selected section and comparison date.
- Exact saved candidate revision and content hash.
- Any native save awaiting its original response.
- The returned amendment selection and its retained local draft ID.

Opening from Plan amendments uses that draft's comparison date. Opening from the case header uses the case's retained Delivery calendar date, or today's date when none was selected. The comparison date travels separately from individual delivery event dates.

## Receive and review the complete workbook

In **Source tables**, use the existing complete-source controls:

1. Open the retained source project or create source tables from the selected native saved plan.
2. Receive the original XLSX bytes. Inspect its worksheets, select the actual sheet and header/data rows, and choose the columns that supply each planning field.
3. Retain the complete workbook edition and explicit projection. Review included and excluded rows with their original sheet and cell locations.
4. Review work packages, milestones, contributors and assignments. Each role retains its own selected source edition and mapping.
5. Choose the decimal, date and other source-reader settings used by the original workbook.
6. Prepare the native preview, review the whole result and changes, record a source-import review note, and choose **Apply reviewed changes to working plan**.
7. Review the ordinary planning sections and enter a revision note. **Save revision** uses the original native calculator and transaction.

The original source-table controls retain source bytes and mappings when their corresponding operation completes. Text fields commit their source choice on change. A file selected for inspection becomes part of the source project when it is received.

**Rebase on saved plan** explicitly changes the source project's comparison baseline and keeps its workbook editions, mappings and earlier reviews. Use it when the source project still refers to an earlier saved revision. The native reader and calculation enforce the existing complete-source checks.

[Source tables](SOURCE_TABLES.md), [editable workbook handover](WORKBOOK_HANDOVER.md) and the [Merchant agent workflow](SOURCE_TABLES_AGENT.md) describe those original controls, CLI commands and typed client operations.

## Resume the complete working draft

The case planning desk retains its complete working record in the browser's existing origin, under the signed-in staff identity. The status line reports when that write finishes. Refreshing the page or signing back in with the same identity reopens the retained record and checks access to its original case and saved native revision.

**Saved case planning work** lists that identity's retained drafts. **Download complete working draft** saves the full JSON file, including original workbook bytes, source choices, reviewed working inputs, notes and any pending original save. **Open case planning draft** receives that complete file after checking the original case and plan on the running server.

A received file with different retained content becomes a separate local draft. Reopening an identical existing file keeps its existing draft identity. A pending original save stays with its original signed-in operator.

The current working fields remain available if browser storage fails or another tab updates the same local draft. **Download work and reopen saved local draft** downloads those current fields first, then opens the last complete retained edition. The local sequence check makes an overlapping write explicit.

**Leave case planning** keeps the complete local record in Saved case planning work. It returns the ordinary planner to its existing controls.

## Receive an interrupted native save

Before sending a save, the desk retains its complete original request: plan ID, expected native revision, scenario patch, full planning/source project, note, request ID and signed-in operator.

If the original response is lost, choose **Receive original save**. The desk sends the same body and request ID to the original native transaction journal. A completed save returns its saved revision; an uncompleted request runs through the ordinary native save. The desk records the returned exact revision and hash before clearing the pending request.

A confirmed native rejection remains visible with the complete entered draft. **Keep draft and resolve rejected save** records that rejection and releases the request for an explicit revision. If another operator saved a newer native plan, **Use current saved revision as write basis** selects the latest native write revision while retaining all entered scenario and planning inputs. Review those complete inputs against the newer saved plan and the original source-table baseline before calculating and saving again.

The save result opens the actual returned revision. A later save by another operator remains available in Saved versions; it does not replace this returned selection.

## Return the exact saved revision to the case

Choose **Review saved revision in this case** after the complete working plan is saved.

The original case opens in **Plan amendments** with the exact plan ID, saved revision, content hash, comparison date and revision note. Repeating that return reopens its same retained amendment draft. Earlier amendment drafts remain in Local work.

If another amendment has an unresolved original request, the returned workbook revision remains ready in its own panel. Receive that existing request, then choose **Open returned planning revision**. The original transaction and draft stay available throughout.

The native amendment lifecycle remains:

1. Review the full proposal inputs, original decision basis, source attachments and any explicit package attribution.
2. **Preview complete amendment** compares the case's current baseline and the selected complete saved revision.
3. Inspect the full changes, recorded work and invoice exposure, payment clocks and before/proposed calendar.
4. **Save proposal**, then record the review of that exact amendment edition.
5. Review and select **Apply reviewed baseline**.

The case planning header records the actual applied case version when the original case selects the returned revision. Applying uses the existing original case version, amendment edition and content hashes.

[Plan amendments](AMENDMENTS.md) covers original decision sources, package mappings, proposal revisions, reviews, application and receiving. [Amendment calendar comparison](AMENDMENT_CALENDAR.md) covers the complete before/proposed calendar and source links.

## Continue the calendar and Completion workflow

The saved or previewed amendment exposes complete before and proposed calendars, including their full JSON, CSV and ICS exports. Each calendar retains its native source identities and comparison date.

Follow the original event link to the selected case record. Tranche Completion receives the original receipt, cost, review and tranche selections along with the comparison date. The event's own delivery date remains a separate field.

After applying the amendment, continue the same case's work, invoices, cash, assignments, delivery and Completion records through their original controls. The original exports retain the previous plan and amendment history alongside the new selected baseline.

## Deliver the complete operated work

Keep these complementary original artifacts together:

| Artifact | Purpose |
| --- | --- |
| Complete working-draft JSON | Reopens the full local scenario, source project, note, pending request and case return selection. |
| Exact selected planning ZIP | Retains the selected native revision and its consecutive earlier history, source bytes and calculation. |
| Editable workbook handover | Carries the complete selected workbook, source project, native plan and workbook export manifest. |
| Complete case ZIP | Carries the operated case, selected native plan, original records, attachments, amendment history and saved reports. |
| Whole installation backup | Retains the original case/plan identities, database and complete runnable source when moving the same working installation. |

While case planning is open, the ordinary planning ZIP, scenario JSON and daily CSV download controls select the exact displayed native revision. The corresponding HTTP exports accept one positive `revision` value, for example:

```text
GET /api/plans/<original-plan-id>/export.zip?revision=3
GET /api/plans/<original-plan-id>/scenario.json?revision=3
GET /api/plans/<original-plan-id>/daily.csv?revision=3
GET /api/plans/<original-plan-id>/costs.csv?revision=3
```

Use the actual selected revision from the operating desk. The native plan content and calculated rows supply every export.

A complete case import can establish new receiving case and plan IDs. An unresolved save still belongs to its original installation and identities. To resume that original pending request on another host, restore the original whole installation and sign in as the same staff identity. [Installation recovery](STAFF_INSTALLATION.md) describes the complete backup and access reissue.

## Operate the retained customer workflow

The included native programme accepts an existing complete calendar/customer handover or operated workspace, preserves that source and opens its original database in a separate receiving directory. It runs the normal HTTP application and real desktop and phone browsers.

```sh
python3 case_planning_receiving.py \
  --archive /absolute/path/to/SCF_Grant_Calendar_Customer_Handover.zip \
  --directory /absolute/private/case-workbook-receiving \
  --node /absolute/path/to/node
```

Set `SF47_PLAYWRIGHT_MODULE` and `SF47_CHROMIUM` to the already installed Playwright module and Chromium executable when their locations differ from the receiving host's runtime. The programme uses the original case and source selection; it records the actual plan/case IDs and dates in the complete output.

The receiving directory keeps the original input, installed source, working browser draft, exact native save and amendment results, complete source project, selected planning downloads, paired calendars, case export, desktop and phone views, and the cold reopened case. Its continuation file retains the original operation so an interrupted browser resumes that same operated case.

## Continue the selected cases in Delivery agenda

The original **Delivery agenda** tab keeps the current case planning work attached to its own case. An agenda entry opens the selected original payment, tranche or calendar at the agenda's review date. Returning to planning or to the saved amendment uses the working draft's original case and exact selected plan revision. Opening another case from the agenda does not retarget that working draft.

A saved case planning draft can retain the agenda tab across reload. The agenda itself keeps its own explicit case selection, display filters and review date. The complete download still contains every selected original row while display filters are active.

The complete receiving programme operates the original calendar handover's retained case and its operated walkthrough together. It checks each agenda collection against the complete native per-case calendar, receives ICS/CSV/JSON while the view is filtered, follows the original payment and Completion receipt, opens the case calendar, and reopens the same selection after reload. Desktop and phone review uses the current grouped Operations navigation, including collapsed section groups. The cold restored installation repeats this same multi-case route with the original working draft.

After the original browser service closes, `case_planning_agenda_receiving.mjs` opens that same operated workspace through its managed launcher. The typed client and Merchant MCP read the complete selected agenda with its exact case versions; MCP export bytes are received through the original retained-file chunk reader. The service then releases its workspace lock and the original CLI reads and exports the same selection. The programme compares complete native rows, CSV row identities and original iCalendar properties, retaining every resulting file in the complete delivery.
