# World Bank indicator workspace

A complete source-to-merchant workflow for World Bank Indicators API V2 data. An operator chooses a source database, countries or aggregates, indicators and a period; captures the original responses; reviews the edition; and hands the resulting dataset to the maintained Starforge publisher, release manager and customer acquisition tools.

The browser is a plain, grayscale operations interface. The same actions are available from the installed CLI and from the Node operator, so a source acquisition from another authorized machine can be received into the same workflow.

## Start

Requirements: the existing Starforge Node runtime and Python 3.10 or newer with its standard library, on Linux or macOS. The source engine uses POSIX file locking for retained workspace operations.

~~~sh
starforge worldbank workspace --directory /absolute/worldbank-work
~~~

Open the printed private local URL. From a source checkout:

~~~sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/worldbank/cli.mjs workspace \
  --directory /absolute/worldbank-work
~~~

The command owns its local source jobs and running seller. Its session URL can also be used by another CLI invocation through --url. [NATIVE.md](NATIVE.md) documents each action and the existing publisher payloads.

## Operator workflow

| Workspace | Operation | Retained result |
| --- | --- | --- |
| Selections | Search complete country, source and indicator catalogues; save source, codes and period | A named selection revision |
| Captures | Follow every source page, resume the same capture after interruption, or receive original responses from a collaborator | Original response bodies, request/response metadata, page chains and exact observation rows |
| Edition review | Compare two captures, inspect observations, exclude identities and resolve repeated source rows | A review revision tied to its original capture |
| Exports | Create a CSV and native dataset configuration; download or reopen a portable handover | An immutable edition with source files and review choices |
| Merchant | Prepare a native publisher draft, inspect/stage/select/start a release, publish another edition and preview queries | The maintained dataset version and release stores |
| Customer handover | Review the running seller's actual offer, prepare a customer request, acquire pages in the existing buyer workspace and export delivery | The original buyer request, acquisition and customer outputs |

A selection edit applies to future captures. An existing capture continues its retained criteria and page size. A completed capture is the basis for any number of review editions.

### Example: GDP and population in North America

The included [selection.example.json](selection.example.json) selects World Development Indicators, Canada, Mexico and the United States, GDP in current US dollars and population, for 2018–2024. Its page size of 20 makes the original multi-page data acquisition visible.

~~~sh
starforge worldbank action save-selection --directory /absolute/worldbank-work \
  --input stellar/scf-starforge-20261009/sf30-seller-sdk/worldbank/selection.example.json

starforge worldbank action capture --directory /absolute/worldbank-work \
  --json '{"id":"north-america-original","selectionId":"wdi-north-america"}'

starforge worldbank action observations --directory /absolute/worldbank-work \
  --json '{"captureId":"north-america-original","search":"CAN","limit":100}'
~~~

Review and export the complete edition:

~~~sh
starforge worldbank action review --directory /absolute/worldbank-work \
  --json '{"id":"north-america-review","captureId":"north-america-original","title":"North America GDP and population","note":"World Development Indicators; original values, periods, source status and missing observations retained.","excludedKeys":[],"choices":{},"expectedRevision":0}'

starforge worldbank action export --directory /absolute/worldbank-work \
  --json '{"id":"north-america-edition","reviewId":"north-america-review","expectedRevision":1}'
~~~

The result supplies the exact export directory. Merchant preparation loads that directory with the original loadDatasetConfig and buildDatasetSellerConfig, then calls the maintained publisher's prepare operation. The public origin and payment terms are the operator's actual merchant configuration; see [NATIVE.md](NATIVE.md#prepare-an-original-dataset-merchant).

## Source semantics

The source engine uses the HTTPS V2 endpoint. It retains source database metadata, country/aggregate metadata, individual indicator metadata and every selected observation page. The data endpoint supports semicolon-separated indicators with an explicit source database. Indicator metadata is acquired individually because the original combined metadata request can return an empty collection even when the combined data request succeeds.

Original source values pass through the workflow with the following semantics:

- JSON number tokens remain exact strings, including their decimal and exponent representation. They never pass through binary floating point.
- A source null remains nullable. The exported value_state field distinguishes missing from present; missing values are not zero.
- Country/WB identifiers and ISO labels are separate fields. Metadata identifies regional and other aggregate observations.
- Original period labels, units, observation statuses, decimal metadata and footnotes remain available.
- Source, country, indicator and period identify an observation. Repeated identities require an explicit original-row choice or exclusion before export.
- Comparisons identify added, absent, changed and unchanged observation identities. The interface shows whether the two selections cover the same source population.

The native dataset exposes exact value strings and typed aggregate/source-row fields. Equality filters are available for source, country, indicator, value state, aggregate and observation status; period ranges and country/indicator/period sorts use the existing dataset engine. Numeric analysis can consume the retained value strings with the receiver's chosen exact-decimal arithmetic.

The merchant query uses the original dataset parameter names. For example, where_country_iso3=CAN&limit=20 selects Canada's observations; where_indicator_id=SP.POP.TOTL&gte_period=2020&lte_period=2024&sort=-period selects population observations for 2020–2024, most recent first. The fields parameter selects a comma-separated set of retained columns.

## Retention and receiving

SQLite stores each source page descriptor once, plus normalized observations. Selection and review history are retained separately. Large captures therefore do not accumulate a full copy of the page history on every page.

A source request stores its original and final URL, HTTP status, response headers, acquisition time, SHA-256 and byte count beside the unchanged response body. Equivalent query ordering is accepted during receiving; the actual original URL is retained.

The native capture resumes the next unfinished page of its original request group. A source cooldown carries its retry time forward. Cancellation stops the source job owned by the current operator and preserves completed pages.

The handover ZIP includes:

- dataset.csv and the original native dataset.json configuration;
- selection.json and the exact review revision;
- source.json with attribution, source collection summaries and sourceFiles descriptors;
- original/capture.json and every retained original response;
- package-manifest.json with each member's path, size and digest.

The maintained SF30 publisher and SF82 release include declared sourceFiles in their original package closure. This keeps source pages and review choices with the same dataset release that serves customer queries. ZIP entries use stable metadata, so interrupted export continuation produces the same retained package bytes.

To receive a handover in the browser, select Exports → Open a portable handover. The original response bodies are parsed again and the review is reconstructed under the chosen receiving identities. To receive an acquisition from another machine, use Captures → Receive original source pages or the import-pages CLI action with complete original Base64 bodies and receipts. Preserve per-indicator request-group fields from the original page payload.

## Files

| File | Role |
| --- | --- |
| source.py | Original API URLs, parsing, pagination, selection and observation semantics |
| core.py | Retained selections, captures, comparisons, review and portable datasets |
| native.mjs | Local HTTP operator and bridge to the original publisher, SF82 and SF88 |
| cli.mjs | Installed and source-checkout commands |
| ui/ | Browser interface |
| selection.example.json | Reproducible public-source selection |

The code uses Python's standard library for acquisition and storage. It uses the existing Starforge SDK and peer dependencies for dataset, release and buyer operations.

## World Bank documentation

- [Indicators API introduction](https://datahelpdesk.worldbank.org/knowledgebase/articles/889392-about-the-indicators-api-documentation)
- [Request structure, periods and multiple indicators](https://datahelpdesk.worldbank.org/knowledgebase/articles/898581-api-basic-call-structures)
- [Indicator metadata and source databases](https://datahelpdesk.worldbank.org/knowledgebase/articles/898599-indicator-api-queries)
- [Country and aggregate metadata](https://datahelpdesk.worldbank.org/knowledgebase/articles/898590-country-api-queries)
