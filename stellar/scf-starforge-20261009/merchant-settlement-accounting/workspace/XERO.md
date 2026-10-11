# Xero journals in the merchant accounting workspace

The original accounting workspace can now carry a frozen payment/refund handoff into a balanced Xero manual-journal plan, retain native draft creation and read responses, and apply the resulting bookkeeping return through the original accountant history.

Open **Xero journals** from the Accountant handoff panel, or open the running workspace's `/xero.html` page. The existing `merchant-accounting-workspace xero` command provides the same lifecycle. The original workspace directory, process lease, maintenance controller, backup, restore and reopen own the source and delivery state.

## Complete operator workflow

1. **Prepare the original accountant handoff.** Choose the retained reconciliation or period close in the existing accounting workspace. Its exact report, payment rows, frozen refund snapshot, review notes and source manifests accompany the Xero plan.
2. **Select the organization.** Read the native Organization and Accounts endpoints with the configured connection, or import their original JSON response files. Supply the Xero tenant UUID. The adapter verifies the returned organization ID, active state, base currency, demo flag, and unique account IDs/codes.
3. **Value each original component.** Every payment and every independently verified native refund appears separately. Choose an explicit journal date, a value in the organization's base currency, a debit account, a credit account, and the valuation source. Excluding a component requires a reason. Original atomic amounts and asset identities remain beside these choices. The adapter does not calculate fiat value from a token amount or a merchant quote.
4. **Review and save the plan.** Each component produces an equal debit and credit pair. Journals group up to 100 components by the chosen date, retain their exact native payloads, and use `DRAFT`, `NoTax` and an explicit cash-basis-report setting. The plan records the operator's valuation and tax-treatment explanation. Active plans reserve the same native payment or refund component within the selected tenant, including across later handoffs and imported context snapshots.
5. **Create drafts or use the retained native payloads.** The connection sends one original manual-journal request per retained journal. Its request and stable idempotency key are written before the native call. The operator can also download the exact native JSON payloads for an existing approved Xero integration.
6. **Read or import the returned journals.** Refresh uses the known native journal UUID, or searches the exact original narration through the terminal empty page. Import accepts original `ManualJournals` JSON response files. Comparison retains every source file and checks journal ID uniqueness, date, narration, tax/cash treatment, debit and credit values, account codes and IDs when returned, and exact descriptions. Warnings and validation errors remain visible.
7. **Preview and apply the original accountant return.** An exact active draft match proposes `REVIEWED`. Posted matches in a merchant-books plan propose `BOOKED`; demo plans remain `REVIEWED`. Payment references point to the native gross journal; separate refund journals are recorded in the note. Later manual accountant edits produce a displayed conflict instead of being overwritten. A later native refresh can advance an earlier Xero draft return to posted status through its recorded original return.
8. **Download and reopen.** The complete archive contains the saved plan, native payloads, original accounting companions, organization/accounts source, every native operation and comparison, linked original accountant returns, current delivery state, and a file manifest. Reopen the same original workspace to continue.

A demo plan requires the native Xero demo-company flag. A merchant-books plan requires a non-demo organization and original independently matched public-network payment/refund source. The selected purpose remains in the source and review.

## Native connection

Set `STARFORGE_XERO_ACCESS_TOKEN` in the original server process environment using the merchant's existing authorized Xero application. The browser and request files contain no access token. The same environment setting applies to direct `--workspace` CLI use.

Before creating drafts, the original operation reads and retains the current native organization and chart once more. The base currency, demo identity, and selected active account IDs/codes must still match the reviewed plan. This also binds imported account source to the selected live tenant before any draft write.

The adapter calls only `https://api.xero.com/api.xro/2.0/` and passes the selected `xero-tenant-id`. It reads `Organisation`, `Accounts`, and `ManualJournals`; draft creation uses **PUT ManualJournals** with `summarizeErrors=false` and the retained `Idempotency-Key`. The application needs the corresponding Xero accounting settings/read and transactions/read/write access for the chosen operations. Obtain and renew the token through that application's existing OAuth connection.

Source: Xero's maintained [Accounting OpenAPI schema](https://github.com/XeroAPI/Xero-OpenAPI/blob/master/xero_accounting.yaml), [Manual Journals API](https://developer.xero.com/documentation/api/accounting/manualjournals/), [Accounts API](https://developer.xero.com/documentation/api/accounting/accounts/), and [Organization API](https://developer.xero.com/documentation/api/accounting/organisation/).

Bank, receivable/payable control, and other native system accounts that cannot receive manual journals are excluded from the account selectors. Other active accounts retain their native account type and system-account identity. Choose the clearing/asset and income/expense accounts appropriate to the original event; the adapter supplies no automatic accounting classification. See Xero's [locked and system account guidance](https://central.xero.com/0/article/Locked-and-system-accounts-in-your-chart-of-accounts).

Only the original reviewed draft payload is created. Posting, editing or voiding a journal remains a native Xero operation. Refresh brings the resulting native state back into this workspace.

## Retained operation recovery

A process interruption marks the original in-flight operation `INTERRUPTED`; an uncertain sent draft remains an existing attempt. Refresh reads its original exact narration or UUID. The adapter never automatically resends an uncertain creation.

Explicit new creation operations can retry requests rejected before journal creation by the native authentication, routing or rate-limit response. They retain the same journal payload and idempotency key, with a new operation record containing the new response. Provider retry headers are kept with the original response for the operator.

Successful responses from a partially completed native operation remain usable. Its comparison records the exact operation and the journals actually observed; a missing response does not become proof that a native journal is absent.

Accountant application first retains the exact original import request and preview. If the process stops between preparing, applying and linking that original return, **Complete retained accountant return** reuses the same request and original return UUID. The original accountant importer performs the idempotent application.

Unused plans can be cancelled with a recorded reason and confirmation that their downloaded payloads were never imported externally. The original source remains available for review.

## CLI

Use the existing distribution command or the original source entrypoint:

```sh
merchant-accounting-workspace xero status --url http://127.0.0.1:8446

node stellar/scf-starforge-20261009/merchant-settlement-accounting/workspace/server.mjs \
  xero --help
```

Use `--url` for a running original workspace. Use `--workspace /private/accounting-workspace` to reopen a stopped one through its original owner. Output files use mode 0600 and must be new.

### Organization source request

`import-context --input context.json` accepts:

```json
{
  "id": "OPERATION_UUID",
  "revision": 12,
  "name": "Merchant organization",
  "actor": "Operator name",
  "tenantId": "NATIVE_ORGANIZATION_UUID",
  "organizationBase64": "BASE64_OF_ORIGINAL_ORGANISATION_RESPONSE",
  "accountsBase64": "BASE64_OF_ORIGINAL_ACCOUNTS_RESPONSE"
}
```

`capture-context` uses the same request without the two file fields. It reads both original native endpoints using the process connection. Use the current workspace revision from `status`.

### Journal request and review

Read `source --handoff HANDOFF_ID --context CONTEXT_ID` to obtain exact component IDs and the current accountant baseline revision. The preview request contains:

```json
{
  "id": "PLAN_UUID",
  "name": "Merchant period journal",
  "actor": "Operator name",
  "handoffId": "ORIGINAL_HANDOFF_UUID",
  "contextId": "RETAINED_CONTEXT_UUID",
  "accountantRevisionId": "initial",
  "purpose": "demo",
  "valuationBasis": "Operator-selected valuation source and NoTax treatment",
  "showOnCashBasisReports": false,
  "entries": [
    {
      "componentId": "EXACT_COMPONENT_SHA256",
      "decision": "include",
      "date": "2026-10-11",
      "amount": "12.34",
      "debitAccountCode": "OPERATOR_SELECTED_CODE",
      "creditAccountCode": "OPERATOR_SELECTED_CODE",
      "valuationNote": "Original rate or valuation reference",
      "description": "Original merchant payment"
    },
    {
      "componentId": "ANOTHER_EXACT_COMPONENT_SHA256",
      "decision": "exclude",
      "reason": "Operator's explicit exclusion reason"
    }
  ]
}
```

Use the returned accountant revision UUID instead of `initial` when selecting an existing returned baseline. The decimal amount is text with at most two fractional digits. Values are converted with integer cents, checked for exact native JSON representation, and paired to an exact zero balance.

```sh
merchant-accounting-workspace xero preview --url http://127.0.0.1:8446 \
  --input /private/journal-request.json --out /private/journal-preview.json
merchant-accounting-workspace xero save --url http://127.0.0.1:8446 \
  --preview /private/journal-preview.json
```

The saved preview contains the stable request, original plan hash and workspace revision. A changed workspace revision requires a fresh preview.

### Native operation

`operate --plan PLAN_ID --input operation.json` accepts `id`, current workspace `revision`, `actor`, `action` (`create-drafts` or `refresh`), and the exact saved `planSha256`. It waits for the retained native operation and prints its result. `operation --plan PLAN_ID --operation OPERATION_ID` reopens that original result.

For original response-file import, `import-response --plan PLAN_ID --input responses.json` accepts:

```json
{
  "id": "CAPTURE_UUID",
  "revision": 17,
  "actor": "Operator name",
  "files": [
    {"name": "native-manual-journals.json", "base64": "BASE64_OF_ORIGINAL_RESPONSE"}
  ]
}
```

### Accountant return and complete archive

The return request contains `id`, `name`, `actor`, and optionally a stable `createdAt` or the expected current `expectedParentId`.

```sh
merchant-accounting-workspace xero preview-return --url http://127.0.0.1:8446 \
  --plan PLAN_ID --capture CAPTURE_ID --input /private/return-request.json \
  --out /private/return-preview.json
merchant-accounting-workspace xero apply-return --url http://127.0.0.1:8446 \
  --plan PLAN_ID --capture CAPTURE_ID --preview /private/return-preview.json
merchant-accounting-workspace xero download --url http://127.0.0.1:8446 \
  --plan PLAN_ID --file xero-handoff.tar --out /private/merchant-xero-handoff.tar
```

All protected accountant source columns come from the original rendered handoff. The original importer still determines the applied return, retains its source CSV, and writes the original return archive.

## Source and packaging

The implementation adds no package dependency:

- `accountant/xero.mjs`: native source model, exact-valued draft journals, native comparison and original accountant return preparation.
- `accountant/xero-http.mjs`: fixed-origin native Xero transport.
- `workspace/xero-workspace.mjs`: original workspace-owned source custody, operations, recovery, return application and downloads.
- `workspace/xero-cli.mjs`: the same original owner and routes through the existing distribution command.
- `workspace/public/xero.*`: the loopback operator interface.

The existing merchant-accounting-workspace distribution component already includes this original subtree and server entrypoint. Native Xero state is inside the original accounting workspace directory, so the existing encrypted backup and restore includes it with the same maintained owner.
