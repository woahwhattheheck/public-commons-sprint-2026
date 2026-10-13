# JSON Support conversion adapter
Node.js 22 or newer. No installed packages are required.

## What this adapter does
This is a customer-run command line companion to the report desk. It implements the vendor's two published conversion routes: a JSON data envelope returns binary XLSX; XLSX encoded as base64 or CSV text returns a JSON data envelope. Both use the same API key header. The API is metered; an invocation can consume the customer's allowance. The public contract is https://www.jsonsupport.com/developers.html, read October 13, 2026.

The separate website converter performs its interactive conversion in the browser; its local-data statement does not apply to this API command. API inputs go to the published vendor endpoint. The report desk continues to own its local source review, mapping, decisions and handover.

## Files and execution
Keep conversion-adapter.mjs and this guide together. Select an existing input file and a NEW output directory whose parent already exists. Existing directories and output files are refused. Every invocation gets its own output directory, original input, request body, result and operation record.

Use an existing environment/secret-manager injection to set JSON_SUPPORT_API_KEY for the process. Do not put the key in arguments, source, a customer archive or a report. The adapter never retrieves a key, signs up, changes billing or configures a webhook.

### JSON records to Excel
```sh
node conversion-adapter.mjs to-xlsx --input ./records.json --output-dir ./conversion-001
```

The default records shape is an array of objects or one object. A single object becomes one row. An object containing a field named data is still one record: it is not silently unwrapped.

For an existing exact API envelope containing only a data array:
```sh
node conversion-adapter.mjs to-xlsx --input ./request-envelope.json --input-shape envelope --output-dir ./conversion-002 --output-name client-report.xlsx
```

The adapter validates the JSON shape and embeds the original numeric/text representation in the request. It does not parse then reserialize record values, so large integer literals and decimal spellings are preserved before the vendor receives them. The original source bytes are retained, including any original UTF-8 BOM. Any BOM removed for the JSON request stays in the original-input file.

### Excel or CSV to JSON
```sh
node conversion-adapter.mjs to-json --format xlsx --input ./client-report.xlsx --output-dir ./conversion-003
node conversion-adapter.mjs to-json --format csv --input ./client-report.csv --output-dir ./conversion-004 --output-name client-rows.json
```

XLSX bytes are base64 encoded without a text conversion. CSV must be valid UTF-8; its text, line endings and BOM are preserved in the JSON string sent to the vendor. This adapter does not guess a legacy encoding or parse/reformat the CSV. It does not guess an undocumented raw-CSV body for the forward endpoint; the forward command accepts the published JSON data shape.

### Local limits
Defaults are 180 seconds for the full request/body, 32 MiB of input and 64 MiB of response. These are adapter limits, not published vendor limits. Set --timeout-seconds, --max-input-mib or --max-response-mib explicitly when the actual input needs different local limits. A response exceeding the selected limit is retained as a truncated, redacted failure prefix and receives no valid converted-output filename.

Only one HTTP request is attempted. Redirects are rejected, so the key cannot follow a redirect to a different host. The published endpoint is fixed in the source. There is no automatic retry after timeout, interruption, HTTP error or failed local save.

## Read the result directory
A successful operation contains:

| File | Purpose |
| --- | --- |
| original-input.json, .csv or .xlsx | Exact original input bytes |
| request.json | Exact transmitted JSON body, without the API key |
| converted.xlsx or selected XLSX filename | Exact successful binary response |
| converted.json or selected JSON filename | Exact successful JSON response, including its data envelope |
| operation.json | Operation ID, original/request/output names, byte counts, SHA256, dates, response status, selected nonsecret headers and final state |

The source directory is created with POSIX mode 0700 and files with 0600; normal operating-system ACL semantics still apply. Original filenames are recorded as metadata; the original bytes use a fixed safe filename inside the new directory. No existing source or output file is overwritten.

Exit 0 means the successful response was saved and passed the stated structural check. XLSX validation checks the complete single-disk ZIP directory, each actual local header/name/data extent, nonoverlapping entries, and the stored/deflated bytes, size, CRC32 and expected XML roots of [Content_Types].xml and xl/workbook.xml. Required XML decompression is capped by the selected local input/response byte limit. It does not evaluate workbook formulas or the correctness of customer calculations. ZIP64/encrypted workbooks are refused by this adapter. JSON validation checks that data is an array of objects, and preserves the exact response bytes rather than reserializing numbers.

Before using a report, open the actual workbook/returned rows, reconcile the expected row/column structure and review any vendor transformations against the original input. A technically valid spreadsheet is not by itself an accepted client report.

## Receive into the current report desk
Select the same agency and saved report in the desk. Inspect the selected conversion's operation.json: require schema json-support.conversion-return/v1, status succeeded, the intended direction and the output metadata. Recompute the output's byte count and SHA256 against that record, and retain the complete original output.

For a to-json result, open Conversion and results. Paste the complete returned JSON envelope into Optional actual reverse-conversion JSON, then choose Compare returned JSON. The comparison uses every row's position, field name, value and type against the currently saved mapped sample. Review differences against the original source; choose the actual outcome and enter the output filename, observed row count and inspection notes. Include the adapter operation ID and any transformation decision in those notes, then choose Record result.

For a to-xlsx result, open the actual workbook in the intended spreadsheet software, inspect its rows and formatting, and record the output filename and the actual inspection outcome in Conversion and results. Keep that workbook in the same handover folder as its complete adapter operation directory. An optional round trip uses a separate explicit to-json invocation on this exact XLSX into a new output directory, followed by the comparison above; it is another metered request.

After recording the result, use Handovers to save the named report edition and download its full JSON and readable report. Also download the complete working file. Deliver those files together with the original-input, request, actual converted output and operation.json, preserving the full conversion directory so the recipient can trace the recorded result and continue the same report.

## Failure and restart
Exit 1 means a started/retained operation failed or is uncertain. Exit 2 means local arguments, input or configuration failed before a request was issued. When a directory exists, operation.json is the authoritative local record; a process killed before it can finish may leave prepared/requesting state.

An HTTP error records status, selected request identifiers and Retry-After if provided. Its response-error.txt is a UTF-8, credential-redacted rendering of the captured body. Metadata records the original captured bytes/hash and whether the body was complete. Raw error bytes are deliberately not retained; the actual output and input source files have their own exact identities.

A timeout, broken response, interrupt, 5xx or successful response that fails format validation can mean the provider already processed the request. The record says uncertain and provider_may_have_processed true. A local save failure after response receipt also needs reconciliation; preserve every existing file before deciding whether a new request is necessary.

The adapter does not claim idempotency or retry safety for these endpoints. Inspect the retained status, account usage and actual vendor result first. If a deliberate retry is appropriate, choose a new output directory and record the earlier operation in the desk's history. Never reuse or delete the prior operation merely to make the next command run.

## Source and limits of the contract
Primary developer reference: https://www.jsonsupport.com/developers.html.
Local browser behavior: https://www.jsonsupport.com/.
The developer page supplies the endpoints, data shapes and binary/envelope return formats. It does not publish idempotency keys, a bulk limit, a complete error schema, an output download endpoint or callback signing. This adapter uses only the documented synchronous conversion contract. Its private file layout, checksums, explicit result states and desk receiving rules are engineering additions.
