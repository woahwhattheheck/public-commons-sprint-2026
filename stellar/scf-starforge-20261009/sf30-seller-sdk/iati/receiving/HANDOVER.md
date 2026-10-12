# Complete IATI customer handover

This command packages the completed original IATI workflow for a receiving team. The delivery contains the actual READY distribution archive, the final reviewed portfolio and full report, all three complete merchant datasets, the original publisher XML, its supplied attribution notice, and the public installation and operator guides.

The original runtime archive and every selected source file keep their exact bytes. The command also places the verified report files under **report/** so the customer can open **report/report.html** directly after extracting the outer ZIP. It retains the original **reports/iati-report.zip** alongside that readable copy.

## Run the original complete procedure

The maintained **receiving/complete.mjs** calls this command only after the original installed Applications procedure has returned COMPLETE and both source and received Applications have finished Stop. That procedure selects the final operator-reviewed revision. It passes the original merchant datasets from the same complete publisher cohort; the packager checks their lineage against the selected portfolio's native editions.

No additional installer, workspace, native engine, MCP server, source capture, seller, or payer is created by this command. The customer ZIP does not include connection files, session tokens, private operation records, or screenshots.

The packager uses Python 3.11 or later and its standard library on the Linux receiving host. It uses a kernel file lock for one output directory and reads large files and ZIP members in bounded chunks.

## Files in the customer ZIP

| Location | Purpose |
| --- | --- |
| **CONTENTS.md** | Readable entry point and original selection |
| **manifest.json** | Complete member inventory with byte lengths and SHA-256 values |
| **NOTICE.txt** | The exact supplied publisher attribution text |
| **runtime/** | The one unchanged original READY distribution archive |
| **publisher/publisher.xml** | Complete original public publisher source |
| **publisher/AIDDATA_NIGERIA.md** and **publisher/aiddata-nigeria.json**, when selected | Complete dated AidData attribution, original license observations and source identities |
| **portfolio/iati-portfolio.zip** | Original portable portfolio, full revision history and native dataset packets |
| **reports/iati-report.zip** | Original complete report archive for the final reviewed revision |
| **report/** | Byte-identical verified report HTML, JSON, three CSVs, all review records and comparison files |
| **merchant-datasets/activities/** | Complete data.csv, dataset.json and iati-lineage.json |
| **merchant-datasets/transactions/** | Complete data.csv, dataset.json and iati-lineage.json |
| **merchant-datasets/budgets/** | Complete data.csv, dataset.json and iati-lineage.json |
| **guides/** | IATI, domain, operator, runtime, installation and handover guides |

Every retained native report member is copied into the readable report directory. The command verifies its original manifest before copying it and verifies the completed outer archive again before publishing it. It does not summarize or discard row changes, review findings, or source history.

The customer manifest contains logical archive names and public source/portfolio metadata. It contains no host filesystem paths. A manifest cannot contain its own final digest without a circular dependency, so the separate **result.json** records its SHA-256 and the complete outer ZIP's SHA-256.

## Explicit selection input

Standalone creation uses one complete JSON input file and an empty or already-selected private output directory:

~~~sh
python3 /absolute/IATI-source/receiving/handover.py \
  --input /absolute/receiving/handover/input.json
~~~

The input must contain these exact top-level fields:

~~~json
{
  "schema": "stellar-forge.iati-customer-handover.v1",
  "operationId": "the-original-complete-iati-operation",
  "output": "/absolute/private/handover/IATI_Customer_Handover.zip",
  "sourceCommit": "THE_EXACT_40_CHARACTER_PUBLIC_COMMIT",
  "publisher": {
    "label": "Original publisher label",
    "url": "https://the.original.public.publisher/source.xml",
    "fetchedAt": "THE_ORIGINAL_TIME_WITH_TIMEZONE",
    "bytes": 123,
    "sha256": "THE_ORIGINAL_64_CHARACTER_XML_SHA256"
  },
  "portfolio": {
    "id": "THE_ORIGINAL_64_CHARACTER_PORTFOLIO_ID",
    "revision": 5,
    "definitionSha256": "THE_REVIEWED_64_CHARACTER_DEFINITION_SHA256",
    "counts": {
      "sources": 1,
      "activities": 0,
      "transactions": 0,
      "budgets": 0,
      "plannedDisbursementsRetained": 0,
      "reviewRecords": 0,
      "excludedFinancialRecords": 0
    },
    "financialGroups": []
  },
  "files": [
    {
      "path": "/absolute/original/file",
      "name": "its/selected/customer-name",
      "bytes": 123,
      "sha256": "ITS_REVIEWED_64_CHARACTER_SHA256"
    }
  ],
  "notice": "The complete original publisher attribution and reuse notice."
}
~~~

The values above describe the schema; they are placeholders and are not an executable source selection. Use the complete input retained by **complete.mjs**, which includes all required files and the actual reported counts and financial groups.

The input's **files** list must contain:

- Exactly one **runtime/** archive ending in **.tgz**, **.tar.gz** or **.zip**.
- **publisher/publisher.xml**, **portfolio/iati-portfolio.zip**, and **reports/iati-report.zip**.
- All nine merchant dataset files shown in the table.
- **guides/IATI.md**, **guides/DOMAIN.md**, **guides/OPERATIONS.md**, **guides/RUNTIME.md**, **guides/INSTALLATION.md**, and **guides/HANDOVER.md**. Additional plainly named Markdown guides are accepted.

When the selected public source is the retained AidData Nigeria research XML, the original complete procedure also includes **publisher/AIDDATA_NIGERIA.md** and **publisher/aiddata-nigeria.json** as a pair. Their metadata must identify that same original XML by its full bytes and SHA-256. Both public bodies are copied unchanged; their dated license and release observations remain distinct from the IATI-derived report counts.

The three merchant lineages must equal the selected final portfolio's original native build reviews. The data.csv and dataset.json lengths and digests must match those same reviews. Both native ZIPs must select that same portfolio and revision, and their reports must retain the exact selected definition, counts and financial groups. This input describes one complete public publisher XML; the final portfolio must reference that source as its sole publisher. A multi-publisher customer handover needs an explicitly expanded source selection rather than omitting its other original XML files.

Amounts remain decimal strings. Currency, transaction type, budget type and status, reporting organization, hierarchy, value date and budget period retain their original dimensions. The packager performs no financial arithmetic.

All physical input files must be regular files with no symbolic or additional hard links, including in their parent paths. Files are checked by their complete byte digest, size, original inode and modification metadata while they are read. Keep the output in a separate private directory, outside every selected original file location. Archive names must be relative, distinct and portable; parent traversal, links, directories, ambiguous names and unsupported customer-file categories are rejected.

## Completion and retry

Successful creation writes:

- The complete **IATI_Customer_Handover.zip** selected by **output**.
- **result.json** next to that ZIP, containing schema, COMPLETE state, operation ID, source commit, ZIP byte length and SHA-256, selection and manifest hashes, complete file inventory, original publisher metadata and final portfolio selection.
- Private selection and lock metadata beside the output. These records are not customer ZIP members.

The command prints the result as JSON. The printed result includes **reused: true** when it verifies and reopens the already-completed ZIP. The retained result record keeps its original completed bytes.

The stable operation and logical selection are retained before packaging. Source paths are kept out of that logical identity, so identical public source bytes may be received at another host location without changing the customer selection. Different source bytes, notices, portfolio selections or customer names require a distinct operation/output selection.

All archive and metadata writes use private stages. Each stage is completely written and fsynced before create-only publication. The full ZIP is read back and every member is verified before publication. An interrupted stage is preserved under an **.interrupted-** name; it is never mistaken for a complete output. If publication finished before its staging name was removed, the retry reconciles only that exact recognized same-inode publication alias. Other hard links or an existing unrelated output are rejected.

If the process ends after publishing the ZIP but before publishing **result.json**, repeat the exact original command. It verifies that same ZIP and completes the missing receipt. No source file or original runtime archive is replaced. If storage is exhausted, retain the failed attempt and obtain enough space for the same full declared operation before repeating it.

Limits are 256 explicitly selected input files, 16,384 total outer members, 4 GiB per selected input/member, 64 MiB per JSON metadata document, and 16 GiB of total expanded outer content. The total includes both retained native ZIPs and the directly readable report copy. Resource admission belongs to the caller's original complete operation.

## Verify a received delivery

Use the exact expected outer SHA-256 from the sender's completed **result.json**:

~~~sh
python3 /absolute/IATI-source/receiving/handover.py \
  --verify /absolute/received/IATI_Customer_Handover.zip \
  --expected-sha256 THE_ORIGINAL_COMPLETE_ARCHIVE_SHA256
~~~

Verification is read-only. It hashes the full archive, checks the manifest's logical selection and exact attribution, rejects extra or duplicate members, and streams every member to confirm its byte length and digest. It returns VERIFIED with the original portfolio and source identity. Omitting **--expected-sha256** checks the archive's internal consistency; a separately retained expected digest also binds it to the sender's exact delivery.

After verification, use a normal ZIP tool to extract the outer customer ZIP into a fresh directory. Open **CONTENTS.md** or **report/report.html**, then follow **guides/INSTALLATION.md** and **guides/OPERATIONS.md** for the original runtime installation and Applications receiving workflow.

The maintained native CLI can receive **portfolio/iati-portfolio.zip** into an initialized private IATI workspace:

~~~sh
python3 /absolute/installed/IATI-source/cli.py \
  --workspace /absolute/private/received-workspace init
python3 /absolute/installed/IATI-source/cli.py \
  --workspace /absolute/private/received-workspace receive \
  --file /absolute/customer/portfolio/iati-portfolio.zip
~~~

Use the original READY runtime's Node/Python configuration described in the installation and operator guides. Receiving rebuilds the native local index while preserving original source, plan, dataset and portfolio history identities. The saved **receivingBuilds** describe those local reconstructions separately. A repeated native receive uses the same original portable portfolio history.

The included **dataset.json** files point to their adjacent **data.csv** files. Keep each complete three-file merchant dataset together when using the maintained dataset/publisher tools. Any later merchant configuration or payment is a separate explicit operator action; this handover does not perform it.
