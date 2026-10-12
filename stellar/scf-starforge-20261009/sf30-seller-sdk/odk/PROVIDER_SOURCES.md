# Original provider and integration sources

ODK Central Field Data follows the released Central API and the existing native seller, source dictionary and release implementations. The pins below are the actual source read while implementing this complete product.

## Central release

| Source | Original revision |
| --- | --- |
| Central release | v2026.3.1 |
| Central repository | [getodk/central](https://github.com/getodk/central/tree/7d6de621955c5bb6a68e098ca10c9cbb92285cdf) |
| Central backend | [de0d2a07fd7c9ff698cbc312e550dd40ff058340](https://github.com/getodk/central-backend/tree/de0d2a07fd7c9ff698cbc312e550dd40ff058340) |
| API schema | [docs/api.yaml](https://github.com/getodk/central-backend/blob/de0d2a07fd7c9ff698cbc312e550dd40ff058340/docs/api.yaml), Git blob `89be3aa5c8a89debb18eb9547c96b4117b541e6f` |
| Native CSDL producer | [lib/formats/odata.js](https://github.com/getodk/central-backend/blob/de0d2a07fd7c9ff698cbc312e550dd40ff058340/lib/formats/odata.js), Git blob `9092d22cdb96c5b0ce0adb0f64dc775c0bd3e19b` |
| Original CSDL cases | [test/unit/formats/odata.js](https://github.com/getodk/central-backend/blob/de0d2a07fd7c9ff698cbc312e550dd40ff058340/test/unit/formats/odata.js), Git blob `efbac18f7c4d258ba7237b68065ba80c3e20142f` |
| Original XML form inputs | [test/data/xml.js](https://github.com/getodk/central-backend/blob/de0d2a07fd7c9ff698cbc312e550dd40ff058340/test/data/xml.js), Git blob `e21ee6964421f30dbe32e93cf476735430358a1e` |

The public API documentation is [docs.getodk.org/central-api](https://docs.getodk.org/central-api/). Published routes, existing user permissions, actual project/form IDs, native OData filters and continuation links, original form generation tokens and submission version/media endpoints determine receiving behavior.

## Native interoperability

Central emits dotted entity/type names such as `Submissions.children.child` and native parent fields such as `__Submissions-id`. Its entity container uses the raw XML form ID while its namespace is normalized. The existing SF30 CSDL parser accepts this provider vocabulary only through the explicit `odk-central` identifier dialect.

The original provider scenarios cover repeated forms, nested repeats and groups, source field aliases, blank versions, source form changes and original attachment metadata. Actual provider receiving uses the original released server and source forms through [native/receive.mjs](./native/receive.mjs).

## Existing project integrations

- [OData source and CSDL parsing](../odata/): original metadata, rows, IEEE754-compatible representation, source receipts and field semantics.
- [Dataset handler](../dataset-handler.mjs): actual typed dataset configuration and query behavior.
- [OData publisher](../odata/publisher.mjs): selected original dataset package through SF82 stage, activate and rollback.
- [SF82 release lifecycle](../../sf82-seller-pilot/releases.mjs): the existing release store and seller process.
- [SF82 lifetime lease](../../sf82-seller-pilot/release-process.mjs): the original kernel-owned workspace lock.
- [Node SQLite](https://nodejs.org/api/sqlite.html): original indexed database and native online backup.
- Python standard library [tarfile](https://docs.python.org/3/library/tarfile.html), [sqlite3](https://docs.python.org/3/library/sqlite3.html) and [hashlib](https://docs.python.org/3/library/hashlib.html): streaming portable receiving with complete file inventory and original hashes.

The native receiving guide records the selected host, provider revision, real source identities and original operation inputs for an executed receive. The reusable source pins remain separate from each customer's private credentials and data.
