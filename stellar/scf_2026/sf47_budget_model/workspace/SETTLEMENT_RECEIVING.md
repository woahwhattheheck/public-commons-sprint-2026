# Original SCF settlement operating and receiving programme

This programme uses the existing Grant Operations workspace, the original merchant accountant reader, native Operations requests and original full case export/import. It receives the two retained original merchant source editions, applies explicit cash choices and corrections, then reopens the received editable case through the native client, command line and browser.

## Exact original input

Select the complete private original accountant source frame:

- Original source Git blob: dfe4f3f96a06c09d28d1fd1b1b5980025c5afe37 in woahwhattheheck/commons.
- UTF-8 bytes: 801,356.
- SHA-256: 90424a4c8de5652cc589bb42046efea3c564f47888da000fbc0eb928f93df217.
- Schema: commons.original-merchant-accountant-source.v1.
- Full decoded census: 67 original files, 328,467 bytes.

The programme validates every embedded member before constructing the first source-complete input. That first input is a deterministic plain TAR containing the exact nine original paid accountant packet members plus their seven original source members. It retains the original nine-member TAR separately with its unchanged SHA-256 a32b26a32a8d70b08025d22cfb3c0caf7203d4d93bb225813638dbdd48d1029b. The source-complete TAR has its own measured identity.

The second input is the unchanged original native-mcp-period-close.tar: 61,440 bytes, SHA-256 5a203656b68b8772cc04327674ef88da3c7e521727b42938fb1a0e66a35abc03. It describes the same original transfer, not another purchase.

## Completed workflow produced by one invocation

1. Seed the original Workspace from sf47_budget_model/sf10_current_candidate.json and select its actual original plan/revision.
2. Create the original OPERATIONS case through Operations.create.
3. Preview and receive the original paid source using explicit XLM, seven decimals, 50,000 stroops = 0.005 XLM, original recovery observation date 2026-10-11 and CUSTOMER classification.
4. Preview and receive the original complete paid-period source with LINK_CASH to the same existing cash.
5. Correct the first source's cash classification to OTHER. The original cash stays VOID and the replacement is OBSERVED.
6. Explicitly LINK_CASH-correct the second source to that same replacement, preserving the old selected cash ID and making no additional cash mutation.
7. Verify the two source lineages, four review editions, original transfer key, source hashes and one active transfer cash observation.
8. Export both selected corrected settlement reviews and the complete editable original Operations case.
9. Import the whole case into a receiving workspace. Repeat the same archive/name/actor/request to recover its accepted native receipt.
10. Read the received case through the original CLI and export the same selected review.
11. Use the original managed native client to reopen the restored case, repeat the same import request over HTTP, and download the selected review and unchanged original source.
12. Use the real native browser to open the four source/review editions, view the current corrected cash and old VOID history, download the selected review, then reopen the saved case.
13. Reopen the final current case through the original client, then close its owned service or release its borrowed connection and package the complete operating source, original archives, editable native exports, actual outputs and screenshots.

No new payment or external accounting import is issued. The source date is the original recovery observation. USD valuation remains absent.

## Source and runtime selection

Use the current complete GrantOps source, with the retained original Work Intake/calendar/financial changes and the final 22-file settlement feature. The source manifest is a UTF-8 JSON object:

    {
      "schema": "scf.grantops.settlement-source-selection.v1",
      "repository": "woahwhattheheck/tjlabs-stellar-merchant-workspace",
      "source_ref": "<full coherent source commit>",
      "files": [
        {"path": "stellar/scf_2026/sf47_budget_model/sf10_current_candidate.json",
         "bytes": 0, "sha256": "<actual SHA-256>"}
      ]
    }

The example member describes the shape only; populate the complete original source census with actual lengths and hashes. Include the entire current sf47 component and every original declared Node import needed by its managed launcher and merchant reader. The programme verifies every selected member before opening a workspace. Source and receiving drivers are separate selected files and are included in the resulting package.

Select Python 3.11 or later, installed Node 24 or later, an existing Playwright module and Chrome/Chromium executable. The programme uses the original SF47_SETTLEMENT_NODE and SF47_BUYER_NODE selections for the native source reader and managed client. It does not install another runtime.

Example invocation, with all paths selected from the actual source/runtime receiving receipt:

    python3 -B receiving/settlement_receiving.py \
      --source-root /absolute/path/to/current-checkout \
      --source-manifest /absolute/path/to/source-manifest.json \
      --input-frame /absolute/path/to/original-accountant-source.json \
      --directory /absolute/path/to/original-settlement-operation \
      --node /absolute/path/to/node \
      --playwright /absolute/path/to/playwright/index.mjs \
      --chromium /absolute/path/to/chrome-headless-shell \
      --browser-driver /absolute/path/to/receiving/settlement_browser.mjs

The original operation is SCF-GRANTOPS-SETTLEMENT-RECEIVING-20261012-F3BE. Use one persistent private output directory outside the source checkout, and retain that selection on continuation. Invoke through the existing native capacity/foreground owner where shared-host admission is required. Do not create a second copy of the programme because an execution response was lost.

## Recovery and completion

PROGRAMME.json pins the exact source manifest, input frame, drivers and executables. Each mutation retains its exact request body before calling the original native method. Each phase receipt is written after the original method returns. If execution is interrupted after native commit but before a phase receipt, the next invocation uses the same native request ID/body and recovers the original accepted result.

The full editable case import similarly retains the exact archive digest, name, actor and request ID. Its documented new case and plan IDs are accepted; original cash, source, review and event bodies must remain unchanged. The selected review exported from the received case carries that received case ID, so actual client/CLI/browser downloads are compared with the received selected-review export.

The native create/receive/correct/restore/export/CLI stage is committed before the browser opens its service. A browser continuation reuses that exact completed stage and verifies its exports; it reaches the original client without reopening a workspace held by that original service. Its last current-state verification also uses the original client.

The programme holds a nonblocking lock for its one output directory. Completed original phase receipts are reused. A completed client/browser receipt is checked against every actual artifact before continuation. Every accepted original archive, client/browser/CLI artifact and recorded phase is rechecked against its retained hash before the final source-bearing ZIP is written, including completed-result continuation. Each saved native export is independently reopened and verified before its producer is considered, preserving timestamped original whole-case bytes. The source is also rechecked. The offline CLI runs before the browser so a valid borrowed service is left with its original owner; the final current-state check uses the original native client.

A successful invocation writes RESULT.json, START_HERE.md, DELIVERY_MANIFEST.json, DELIVERY.json and SCF-Original-Settlement-Receiving.zip. RESULT.json must have passed=true; source publication or a prepared command is not a native completion receipt. START_HERE.md explains the actual original identities, screenshots, editable exports and original CLI/browser receiving commands.

Private runtime databases and access fragments remain in their original local workspaces. The complete selected native case exports, source and original artifact receipts are the reusable receiving deliverable.
