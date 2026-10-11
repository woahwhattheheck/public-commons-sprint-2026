# Bitquery Stellar data through the original merchant product

Turn a selected Bitquery Parquet delivery into three useful derived datasets, inspect them in the existing SF30 workspace, and serve selected query or complete-file products through the original Stellar merchant. The intake resolves source identities and exact amounts before the original dataset, buyer, payment, delivery and reporting components take over.

The provider-specific source is `prepare.py`. The small `merchant.mjs` bridge calls the original dataset loader, offer builder, payment-option normalizer and immutable-file adapter; `application.mjs` exports the original handler/admission interface. There is no additional query server, wallet, facilitator, SQL endpoint or billing engine.

## Prepare the actual source

Use Python 3.10+ with the pinned Parquet dependency and Node 22+ with the original repository. Native paid operation uses the original merchant's SDK installation and configured facilitator.

```sh
P=stellar/scf-starforge-20261009/partners/bitquery-stellar-pilot
python3 -m venv /private/bitquery-python
/private/bitquery-python/bin/pip install -r "$P/requirements.txt"
/private/bitquery-python/bin/python "$P/prepare.py" fetch-samples \
  --out /private/bitquery-samples
/private/bitquery-python/bin/python "$P/prepare.py" inspect \
  --source /private/bitquery-samples/source.json
/private/bitquery-python/bin/python "$P/prepare.py" build \
  --source /private/bitquery-samples/source.json --out /private/stellar-derived-001
/private/bitquery-python/bin/python "$P/prepare.py" verify \
  --release /private/stellar-derived-001
node "$P/merchant.mjs" inspect --release /private/stellar-derived-001
```

`samples.json` pins the twelve public sample URLs and SHA-256 values observed on 11 October 2026. The [provider dataset page](https://bitquery.io/datastore/datasets/stellar) is the original source of those links. The downloader requests only that explicit free sample set. Source rows and generated products are kept in the private directories, outside this repository.

For an existing authorized delivery, create the same input manifest with local filenames and its actual hashes:

```json
{
  "schema": "stellar-forge.bitquery-source.v1",
  "files": [
    {"table": "blocks", "file": "blocks/actual-file.parquet", "sha256": "ACTUAL_SHA256"}
  ]
}
```

The abbreviated example shows one manifest entry. A build requires the matching `blocks`, `transactions`, `operations_tx`, `effects_tx`, `payments_tx` and `balance_effects_tx` files. Include every corresponding shard for the selected ledger range. Additional provider tables are catalogued with their actual Parquet types and row counts. Multiple files per table are supported; duplicate identities, missing parents, missing payment/balance children, inconsistent operation counts and changed source bytes stop an incomplete generation. Existing completed releases stay intact.

Files are read in batches. SQLite holds the temporary relationship indexes and aggregates on disk; it is removed after export. No database service is needed. The final manifest records source hashes, observed schemas, coverage, discrepancy resolution counts and the output identities. Output directories are create-only and private. A manifest is written only after the products are complete.

## Products and amount semantics

| Dataset | Granularity | Useful fields |
| --- | --- | --- |
| `ledger_activity` | One supplied ledger | Close time, protocol, transaction/operation counts, successful and failed payments, exact charged fees |
| `payment_flows` | UTC date, operation and complete from/to asset pair | Attempt/success/failure counts and successful amount totals, with each issuer retained |
| `balance_changes` | UTC date and complete asset identity | Credit/debit effect counts, gross credited/debited amounts and net change |

Exact fractions and stroops are strings in the original dataset schema. Derived decimal strings are emitted without rounding. A nonterminating fraction retains its numerator and denominator and has an empty decimal field. Money fields do not offer numeric sort/range through the CSV engine; those would be lexical comparisons. Date, ledger and count fields provide the appropriate query capabilities. Preserve declared string columns when importing a downloaded CSV into other software.

Simple-payment asset identity and amount come from the matching original operation's structured details. Path-payment sides retain the provider's exact rational strings and complete asset identities. Failed attempts are counted but excluded from amount totals. Balance values use signed integer stroops and are checked against the matching original credit/debit effect. Issued assets with the same code remain separate by issuer. Transfers' floating-point amounts and trade-effect values are not added to payment totals.

Actual logical Parquet dates/timestamps are handled directly; the documented integer epoch representations are also supported. Ledger date and close time must agree. Transaction and payment success must agree with Stellar's [atomic transaction behavior](https://developers.stellar.org/docs/learn/fundamentals/transactions/operations-and-transactions). A selected file set is not relabelled as a full day or full history: the manifest lists its exact ledger range/count and any gaps.

### Finding in the pinned public sample

The twelve inspected files contain **293,160 rows** over ledgers **55,080,300–55,080,349** on **1 January 2025**. Their core records produce **50 ledger rows, 138 payment-flow groups and 96 balance groups**. All 12,785 expected payment operations and 12,984 account credit/debit effects have matching children in this selection.

In **2,523 simple-payment rows**, the payment enrichment has missing asset metadata/zero decimals and an amount 10,000,000 times the corresponding operation detail amount. **2,158 of these rows are successful.** The derived product uses the directly joined operation asset and decimal amount for every simple payment, records all disagreements, and includes those resolved successful rows. It does not apply a guessed scaling rule or quietly discard them. All 12,984 signed balance values independently agree with their original effect amounts. This finding describes these pinned samples, not every provider delivery.

The original [Bitquery cloud documentation](https://docs.bitquery.io/docs/cloud/stellar/) and dataset schema are useful starting references; the manifest records the file types actually encountered. For example, the samples use logical dates and microsecond timestamps rather than the integer type descriptions shown on the marketing schema page.

## Inspect in the existing operator workspace

```sh
S=stellar/scf-starforge-20261009/sf30-seller-sdk
node "$S/dataset-workspace.mjs" \
  --dataset /private/stellar-derived-001/payment_flows.json \
  --resource https://your-provider.example/stellar/payments
```

Use its printed private URL to select fields, asset/issuer filters, date range, sort, pagination and export. This is the existing neutral desktop/mobile interface. The preview uses the same dataset engine as the merchant. Opening it does not request the public resource or pay a provider.

## Configure original query and file delivery

Copy `merchant.example.json` to a private operator path, set the actual HTTPS origin and approved public payment terms, and select the products to expose. The placeholders intentionally cannot compile. Keep only the desired routes. Each product can override the shared `payment` or ordered `paymentOptions`; the original seller retains every complete alternative including `extra`. No wallet secret belongs in this file.

```sh
node "$P/merchant.mjs" configure --release /private/stellar-derived-001 \
  --merchant /private/bitquery-merchant.json --out /private/bitquery-seller.json
export SF30_BITQUERY_RELEASE=/private/stellar-derived-001
node "$S/serve.mjs" --config /private/bitquery-seller.json \
  --handlers "$(pwd)/$P/application.mjs" --port 8423
```

This starts the original challenge-only seller. Its existing `/_seller/docs`, `/_seller/openapi.json`, `/_seller/health` and `/_seller/offers` expose the actual configured products. Add the deployment's existing `--facilitator HTTPS_URL` to use its original native payment path and approved buyer signer. The existing reverse proxy handles public HTTPS. Buyer calls never fetch Parquet, run SQL or receive provider credentials.

A query pays for one original dataset page and keeps exact field types. A download uses the original digest-pinned `responseAsset` with its CSV MIME type and filename; it delivers the complete derived file. The original file limits, admission, selected-recipient outbox and settlement accounting remain applicable. There is no automatic free HEAD alias or range/retry purchase.

For a later data generation, build a new private release. Review its original workspace and configure/restart the existing merchant with that release. For a continuously refreshed query product, use the original [dataset version service](../../sf30-seller-sdk/dataset-refresh/README.md) with the selected generated dataset JSON; it retains active page snapshots while promoting new data. Existing downloaded files remain immutable. SF102's JSON-only recovery format does not package application handlers or CSV products; retain the original release plus merchant application through the existing whole-merchant deployment/recovery path.

## Provider use and paid integration

The [provider data license](https://bitquery.io/datastore/legal/data-license) distinguishes derived analytics from raw-data redistribution. The intended paid engagement runs in a provider/customer-controlled environment with the agreed data and output rights. The published implementation contains original code and sample metadata, not the downloaded provider rows. A raw-data resale feed is not the proposed product.

The completed engineering journey used the real pinned source files, the original SDK **2.28.0**, five actual local buyer requests across query/pagination and exact CSV download, all four configured product routes/eight alternative choices, and original native callback/recipient reporting. Its facilitator responses were controlled local fixtures; no blockchain payment, account connectivity or customer acceptance is asserted. The full operation remains in the maintained SDK rather than a companion payment implementation.

[WORKSHARE.md](./WORKSHARE.md) contains the proposed customer-specific deployment, acceptance and commercial scope.
