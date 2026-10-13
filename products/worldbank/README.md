# World Bank economic workspace

Receive an official economic edition, review its exact observations, operate a
dataset service, and deliver reports and a customer workspace that reopens with
its original sources and saved analysis.

The product joins the maintained World Bank source engine and browser, managed
Applications lifecycle, merchant MCP host, native dataset publisher and buyer,
and Python Analysis reports, workbooks and portable workspace. Original country
and indicator metadata, response pages, null values, numeric tokens, review
revisions and source hashes travel with the edition.

## Start working

Build the committed product with --selection worldbank, install its original
runtime, and open the workspace:

~~~sh
starforge worldbank-product workspace --directory /srv/starforge/worldbank
~~~

The command prints the private browser URL. Choose source, countries,
indicators and dates; capture the complete original pages; compare an earlier
capture; review observations; and export the accepted edition. The
[operating guide](OPERATING.md) follows the complete customer workflow.

Use the [customer commissioning and acceptance guide](CUSTOMER_DELIVERY.md) to
agree the source population, interpretation, reporting and workbook definitions,
recurrence, receiving and support before preparing a customer delivery. It connects
the same original source application, Analysis workspace and Merchant programme.
The selected package also retains the complete [grant customer chapter](../../stellar-forge/developer-site/grant-chapters/worldbank-customer-programmes.md)
and its [sixteen-source declaration](../../stellar-forge/developer-site/grant-products/worldbank-customer-programmes.json).
Those measured source references retain their original Merchant repository and
immutable editions; the public installation manifest identifies this package's
actual source. The existing cumulative application publisher selects the chapter
through its normal source-edition workflow.

Continue an original reviewed handover into Analysis:

~~~sh
starforge worldbank-product analysis prepare \
  --handover /srv/starforge/worldbank/exports/north-america/handover.zip \
  --workspace /srv/starforge/worldbank-analysis --prefix north_america --resume
starforge worldbank-product analysis serve \
  --workspace /srv/starforge/worldbank-analysis
~~~

The original importer verifies the source closure and reproduces the reviewed
CSV before it creates the Analysis table. Reports retain raw economic values
as text and label calculated percentages and GDP per person. The delivered
spreadsheet uses text cells for source values and numeric cells for calculations.

## Complete delivery

| Work | Result |
| --- | --- |
| Source selection and acquisition | Complete original source, country, individual indicator and data pages |
| Analyst review | Saved revisions, baseline comparison, selected original rows and explicit exclusions |
| Merchant operation | Original publisher draft, reviewed release, HTTP access and retained buyer configuration |
| Reports | Reviewed observations, coverage, annual change and GDP/population calculation when both series are present |
| Customer files | HTML/JSON report, section CSVs, Excel workbook and original workbook package |
| Customer application | Portable Analysis workspace with retained source, saved SQL, publications and history |
| Receiving and recovery | Same-operation continuation, exact source verification and later customer edits preserved on completed receiving |

The [installation and receiving guide](RECEIVING.md) builds the source-selected
archive and runs the complete installed reference operation. It uses the retained
CAN/MEX/USA GDP and population edition for 2018–2024 and completes managed
application restart, merchant access, resumed source download, four reports,
a workbook and a second customer reopening.

## Original engines

- [World Bank source and browser](../../stellar/scf-starforge-20261009/sf30-seller-sdk/worldbank/README.md)
- [Native publisher, release and buyer operation](../../stellar/scf-starforge-20261009/sf30-seller-sdk/worldbank/NATIVE.md)
- [Shared browser and MCP operation](../../stellar-forge/mcp-merchant-operator/WORLDBANK-WORKSPACES.md)
- [Analysis and customer workbook contract](../../stellar/scf-starforge-20261009/sf30-seller-sdk/worldbank/ANALYSIS.md)
- [Selected-source recipe](../../stellar/scf-starforge-20261009/distribution/selections/worldbank.json)

Use Linux, Node 22.16 or newer, Python 3.11 or newer and the original Python
package's workbooks extra for the complete product. The installed profile selects
the merchant dependencies. Customer work and credentials stay in configured
private directories; installed source retains its own immutable manifest.
