# Original source, semantics and provenance

## Official source contract

- [DBnomics web API](https://docs.db.nomics.world/web-api/) documents the v22 API, exact series paths, observations and period alignment.
- [DBnomics data model](https://docs.db.nomics.world/data-model/) explains the provider/dataset/series/observation model and preservation of original source values.
- [Current toolbox period model](https://dbnomics-toolbox.readthedocs.io/data-model/#periods) defines the normalized calendar period formats.
- [DBnomics legal terms](https://docs.db.nomics.world/legal-terms/) identify the aggregate database license and original provider terms.
- [INSEE reuse conditions](https://www.insee.fr/fr/information/2008466) document Open Licence 2.0, source attribution, known update date and preserving the meaning of the information.

These source links were reviewed on 2026-10-12. The integration uses the actual v22 JSON response, not a converted SDK dataframe. Original response bytes remain the source authority.

## Included original INSEE population

Provider `INSEE`, dataset `IPC-2015`, area `FE` (France), all households, overall **including imputed rents**, base 2015, unadjusted. Use the complete original series names in the retained metadata.

| Original series | Frequency and extent | Observations |
| --- | --- | ---: |
| `A.IPC.SO.00.00.INDICE.ENSEMBLE.FE.SO.BRUT.2015.FALSE` | Annual, 1990–2025 | 36 |
| `M.IPC.SO.00.00.INDICE.ENSEMBLE.FE.SO.BRUT.2015.FALSE` | Monthly, 1990-01–2025-12 | 432 |

Exact requests:

- https://api.db.nomics.world/v22/series/INSEE/IPC-2015/A.IPC.SO.00.00.INDICE.ENSEMBLE.FE.SO.BRUT.2015.FALSE?observations=1&align_periods=0
- https://api.db.nomics.world/v22/series/INSEE/IPC-2015/M.IPC.SO.00.00.INDICE.ENSEMBLE.FE.SO.BRUT.2015.FALSE?observations=1&align_periods=0

The two original response files have these bindings:

| Member | Bytes | SHA256 |
| --- | ---: | --- |
| `insee-ipc-annual.response.json` | 166662 | `71603292efe149a08cd025231722a0809f25917a6e39dc676b21123c50638c31` |
| `insee-ipc-monthly.response.json` | 178349 | `031a92e135b398bf41f0fa3cf2d5325107d792dd13e630a4791b1d4302cd4ca8` |

The public attachment importer completed at 2026-10-12T10:21:09.338Z and 2026-10-12T10:21:43.945Z. The complete response-import manifest retains the original import tool, uploaded file identities, content lengths, source URLs and returned body hashes. This transport did not expose a numeric HTTP status; its receipt therefore records `status:null` and `sourceMode:IMPORTED_PUBLIC_ATTACHMENT`. Native direct HTTP acquisition records its actual status, headers, request/reception/completion times and redirect chain.

The original response reports API version 22.1.17, dataset `updated_at:2026-01-29`, dataset index time 2026-01-29T11:21:30.569Z and provider index time 2026-10-07T10:18:03.972Z. These are different clocks. The source series has no separate `updated_at` field, so the displayed known source update uses its actual dataset update. All three clocks and complete metadata remain in the original response.

Both retained series have complete period/value arrays. Their observation attributes are scalar pairs: `OBS_QUAL=DEF`, `OBS_STATUS=A`, `OBS_TYPE=A`. The parser supports both these original scalar attributes and provider attributes aligned per observation.

## Source preservation

The capture retains every selected series and every original observation. Exact identity is `provider/dataset/series + original period`; its observation handle is a SHA256 over those original identity fields. A row can be annotated without inventing aliases or replacing original provider IDs.

Node 24's JSON reviver source text supplies the original number lexeme. Values such as `1.2300` and exponent notation remain recoverable exactly. The captured response is never reconstructed with `JSON.stringify`. The native customer CSV stores original numeric values as text so binary floating-point parsing cannot silently change the published original value.

Original `NA` and `null` retain distinct missing reasons. Empty series remain empty. Missing calendar periods are not manufactured. `align_periods=0` keeps each actual series population.

A provider error, wrong returned series, repeated period, incomplete selected series set, misaligned attributes or an oversized response returns a concrete error. The source operation retains its original input and completed provider return before assembling the capture, so recovery reuses those exact bytes.

## Calendar and analysis

The current DBnomics normalized period formats are:

| Frequency | Original format | Calendar lag unit |
| --- | --- | --- |
| Annual | `YYYY` | Year |
| Semiannual | `YYYY-S1` through `YYYY-S2` | Six months |
| Quarterly | `YYYY-Q1` through `YYYY-Q4` | Quarter |
| Bimonthly | `YYYY-B1` through `YYYY-B6` | Two months |
| Monthly | `YYYY-MM` | Month |
| Weekly | `YYYY-Www` | ISO week |
| Daily | `YYYY-MM-DD` | Calendar day |

The original frequency and period remain separately retained. Calendar arithmetic is available only when the period format and frequency agree. A conflicting provider period start is retained and flagged; it is not used to invent a different lag. Unsupported periods remain usable as original level observations and carry an explicit calendar issue.

Derived calculations use IEEE-754 arithmetic. Reports name that precision and retain the original numeric token, calculation, base period, base observation identity and reason when a result is unavailable. A monthly twelve-period comparison is distinct from an annual one-period comparison. No statistical aggregation, seasonal adjustment, exchange-rate conversion, interpolation or cross-series arithmetic is implicit.

## Source editions and reuse

Every capture ID binds its exact selection, terms, complete original bytes and actual receipts. Refresh therefore creates a new retrieval edition even when all observations are unchanged. Comparison matches original identities, reports additions/removals, value and attribute revisions, frequency/dimension changes and original metadata changes. Source decimal deltas use the existing exact difference function.

DBnomics' aggregate database is made available under ODbL 1.0; underlying provider conditions continue to apply. The included INSEE source uses Open Licence 2.0. Source files, reports and merchant provenance carry `Source: Insee`, the known update date and the original source URLs. Keep those together with the database attribution when delivering a derived database or customer report.

For another provider, use its published terms in `rights.providers` and the reviewed customer selection. A successful API response establishes retrieval; the retained terms and source review describe the intended reuse.
