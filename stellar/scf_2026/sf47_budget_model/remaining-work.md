# Original SF10 cost rows reconciled with shipped source

Source review: original 14-row `sf10_70000_candidate.json`, public source through `ab76ec64d5c8b11d92f3b2dce0232a5ac903b378`, plus the original SF36 finalizer in this change. The current priced plan is `sf10_current_candidate.json`. This table does not reclassify past programming as new delivery.

| Historical cost row | Original USD | Disposition and remaining delivery |
| --- | ---: | --- |
| `T1-integrated-catalog-85h` | $8,075 | Existing seller/catalog/OpenAPI/buyer integration is delivered. Price merchant-specific installation and missing deployment integration only. |
| `T1-seller-optin-55h` | $5,225 | Admission/withdrawal and private recovery already exist. Price actual merchant role/authority handover and onboarding repairs. |
| `T1-quote-audit-40h` | $3,800 | Remove standalone audit line. Quote parity and rejection belong inside the actual merchant installation outcome. |
| `T1-new-staging-capacity` | $900 | Remove unquoted $900 reserve. Use existing capacity; price actual incremental deployment units if needed. |
| `T2-canonical-ledger-100h` | $9,500 | Original ledger, native buyer/signer and privileged finalizer are pre-award source. Price deployment/connection to actual providers and merchant systems only. |
| `T2-provider-interop-55h` | $5,225 | Existing comparator is delivered. Price actual participating-provider API/cursor/auth/version integration. |
| `T2-threat-monitor-55h` | $5,225 | Existing controls/metrics are delivered. Price deployed alert delivery, custody, operator response and the required threat-model implementation. |
| `T2-failure-recovery-20h` | $1,900 | Remove duplicate generic failure line. Include actual settlement/merchant-notice exception recovery in deployed integration. |
| `T2-new-rpc-metrics` | $1,150 | Remove unquoted $1,150 reserve. Add real attributable provider/retention units only if the deployment requires them. |
| `T3-mainnet-release-105h` | $9,975 | Native SDK/terms/account-readiness source is delivered. Price actual protected mainnet merchant deployment and controlled rollout. |
| `T3-portable-ops-70h` | $6,650 | Remove generic new backup/CLI build. Integrate existing encrypted recovery and outbox continuity into real supervision, retention and cutover. |
| `T3-prod-monitor-docs-75h` | $7,125 | Operator consoles, economics, receiver and adapters are delivered. Price concrete production onboarding/support handover and actual incident operation. |
| `T3-security-release-40h` | $3,800 | Remove generic testing reserve. Remediate actual material deployment findings within the production release package. |
| `T3-new-mainnet-hosting` | $1,450 | Remove unquoted $1,450 reserve. Price a named real incremental service only when workload requires it. |

## Delivered source used as the baseline

- Original seller and actual resource adapters: `sf30-seller-sdk/`, `sf61-openapi-seller-import/`, `sf82-seller-pilot/`, `sf102-cube-paid-query-adapter/`, `sf104-woocommerce-merchant-bridge/`.
- Original catalog identity and recovery: `sf60-durable-catalog-transaction/`, `sf73-pinned-seller-admission/`, `sf95-signed-seller-withdrawal/`, `sf63-catalog-backup/`, `sf102-seller-recovery/`.
- Original buyer and accounting: `sf31-buyer-client/`, `sf36-spend-governor/`, `sf62-human-approval-cli/`, `sf81-buyer-operator-bridge/`, `sf82-chain-transfer-reconcile/`, `sf82-checkout-evidence/`, `sf86-rpc-transfer-reconcile/`, `sf88-operator-buyer-cli/`, `sf103-native-buyer-signer/`.
- Original merchant operation: `sf30-seller-sdk/operations/`, `sf93-seller-support-bundle/`, `sf96-seller-pilot-ops/`, `sf97-merchant-revenue-ops/`, `sf98-merchant-delivery/`, `sf101-merchant-receiver/`, `sf101-merchant-recovery/`, `sf101-merchant-outbox-continuity/`.

All paths above are under `stellar/scf-starforge-20261009/`. Implementation presence does not establish a customer deployment or sale. New work packages require actual independent merchant outcomes, not another test/report wrapper around these modules. Programming completed before an award remains excluded, including later additions to this baseline.
