# Original McCampbell laboratory examples

These are the complete original example ZIPs linked from [McCampbell Analytical's EDD page](https://www.mccampbell.com/edds.php), retrieved once on 12 October 2026. Their original sample, test, result, batch, qualifier and limit strings remain intact.

| Original archive | Bytes | SHA256 | Original format |
| --- | ---: | --- | --- |
| [Equis3.zip](Equis3.zip) | 9,862 | `9253032d539ced2d60b04f1c3e9188dc55c8a2c0ce873c2e8cd4273f28db203d` | sample + combined test/result/QC + batch |
| [Equis4_CSV.zip](Equis4_CSV.zip) | 10,432 | `a57c18f4bf8054503155e1c8ccdb0bf7b736e4cc5eefef5e8d4c61a145ed2879` | sample + test + result + batch |

The exact original URLs, HTTP status, retrieval times, response version headers and every member's bytes, SHA256, header fields and row count are in [source-receipt.json](source-receipt.json).

## Complete source-model receiving

The original Node 24 implementation inspected all 500 result rows in each format and every sample, test and batch row. It exported and parsed the complete source-bound JSON choices through both CSV and TSV, built the original native preview, and reproduced all three/four unchanged native CSV members byte for byte. Each source family retained 137 blank nondetect results and 589 reported limit cells.

| Original cohort | Sample rows | Test identities | Result rows | Batch assignments | Profile observations |
| --- | ---: | ---: | ---: | ---: | --- |
| Three-file | 30 | 41 | 500 | 41 | 0 error, 2 review |
| Four-file | 32 | 41 | 500 | 41 | 3 error, 5 review |

[Download the complete receiving model](McCampbell_Complete_EDD_Model_20261012.zip), containing both original ZIPs, all seven native CSV members, both full previews/reports, complete lineage, source-bound decisions and editable tables.

[model-result.json](model-result.json) records the exact source/review identities, complete table hashes, same-delivery comparison and full compressed result identity. The observations belong to the selected versioned software profile and these published example files. The original source and all versions of repeated identities remain available for the receiving operator's review.

The complete compressed result retains every decoded source field, row lineage, original profile report, explicit Keep decision, full native preview, native file hash and same-delivery comparison. It is the reusable source-model computation for this original acquisition.

## Continue the same whole application

The [supplied receiving configuration](../../receiving.example.json) selects these exact ZIPs. Select its actual existing browser module, executable and private output/scratch directories, then follow [RECEIVING.md](../../RECEIVING.md). That maintained operation uses the original sealed-file compiler, input store and worker for both complete families, repeats the same reviewed job, reopens every member, and operates the resulting report in the browser.

For another laboratory delivery, select its complete original file family, the actual client format/version and reference values, and a new private result edition. Decisions bind to that delivery's exact source and row hashes.
