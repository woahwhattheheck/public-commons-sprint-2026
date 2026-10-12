# FHIR Bulk Data browser operation and receiving

The private workbench opens a retained FHIR Bulk Data workspace, acquires provider exports, reviews the exact original resources, builds a native seller dataset, compares received editions, and transfers a complete editable workspace. Its browser and command-line interfaces use the same workspace and the original SF30 NativeEngine.

## Open the workbench

Use Python 3.11 or newer and Node 22 or newer. Keep this directory beside the maintained `xml` directory and the original SDK modules; `fhir_runtime.py` loads their native workspace and engine. The server binds to loopback and prints its private browser URL.

```bash
python3 -B fhir_server.py --workspace /absolute/path/to/fhir-workspace --port 0
```

The workspace is created when the directory does not exist and reopened when it does. To use a retained credentials profile, add `--credentials-file /absolute/path/to/fhir-credentials.json`. The profile file stays on the operator machine. The connection stores the profile name; the browser receives the profile catalogue without secret values. See the main README for the supported authentication profiles.

Open the complete printed URL. The browser moves its capability out of the URL into session storage. Requests carry that capability to the loopback server, which applies its exact Host and Origin checks. Keep the workspace and browser profile private: they contain the original clinical export and editable working state. All original resource JSON is displayed as text.

The workspace has eight sections:

| Section | Work performed |
| --- | --- |
| Overview | Reopen recent sources, mappings, datasets, comparisons and retained export operations. |
| Provider exports | Define a connection, read its CapabilityStatement and Group pages, review the exact export request, receive the original export and continue its operation. |
| Original resources | Inspect original NDJSON records, provider outcomes and explicit deletion records; browse observed fields and download each original source member. |
| Dataset mapping | Select one original resource type, edit exact path selections and native column semantics, preview the projection, save a mapping and build an edition. |
| Dataset editions | Review the mapping, column statistics and original native snapshot of a completed dataset. |
| Native query | Select returned fields, add declared scalar conditions, choose the native sort column and move through the original cursor pages. |
| Edition changes | Compare editions built with one mapping, or compose an explicit sequence of full and incremental source captures. |
| Deliver and receive | Export a merchant dataset, source-backed dataset packet or complete editable workspace, and reconstruct received packets. |

## Receive an original provider export

Save the connection with its actual FHIR base URL, source classification and selected authentication profile. Read its published capabilities. For a Group export, browse the provider's actual Group pages and select the original Group identifier.

Choose system, Patient or Group scope and inspect the complete request shown by the workbench. Resource types, `_since`, `_until`, element selection and type filters retain the exact configured values. The acquisition engine validates supported parameter semantics and preserves the request, response headers, manifest and original downloaded bytes.

Start the export once. The browser saves its operation identifier before sending the request. The workspace retains each acquisition step. The automatic receiver continues the same operation and follows its actual provider retry deadline. Closing the page stops browser polling; reopening the workspace lets the operator continue that operation.

A saved request appears above the work area after an interrupted response. **Retry saved request** sends its retained body or original upload again. Original acquisition IDs and content-addressed writes keep that retry bound to its existing operation. **Return to draft** clears the local saved command so the operator can edit the form; server-side source and acquisition records remain accessible.

If a kickoff reached the provider without returning an observable status URL, use the original provider status URL when it becomes available. The acquisition panel supports adopting that URL into the retained operation. Pausing browser polling and cancelling a provider export are separate controls; the cancellation request has its own retained request identifier.

## Review exact resources and build a useful dataset

The source inventory records actual resource types and observed field paths. Filter the original rows by output, provider outcome or deletion kind, and inspect the exact retained line before mapping it. The page controls follow the next offset returned by the server, including pages shortened by large records. Original member download names are preserved through nested composed captures.

A mapping projects one explicit resource type. Path selections are JSON arrays of exact tokens, such as `["name","*","family"]`. Empty object keys, punctuation and explicit array positions remain distinct. Select the handling of multiple matches: require one, choose first, choose last, retain a JSON array, or join with an explicit separator. Configure missing values, nullable native values and the output column type.

The editable default mapping includes retained resource identity and source information. Add the fields needed for the actual receiving task. Preview validates the complete source and shows the retained first rows within its displayed byte budget. Save the reviewed mapping, then build the selected source with it.

Original JSON number tokens remain available in retained source bytes and JSON-encoded projection cells. Native numeric query behavior follows the selected native number type. Choose a string or JSON cell when the receiving requirement needs a decimal representation preserved outside native numeric arithmetic.

Reusing the same saved mapping across source editions produces comparable columns. Every mapped cell participates in comparison. The default record_id is capture-specific provenance, so it can change when the same resource is received in a composed state. For a content-focused comparison, remove that column from the reviewed mapping and retain resource_json; the exact capture and physical line remain available in original-source inspection and transfer. A keyed comparison requires nonempty unique keys. Where a source contains conflicting duplicate identities, inspect the original candidates and resolve the retained source state explicitly before relying on a unique resource key.

## Query and compare actual editions

The browser uses the native dataset endpoint. Conditions combine with AND. Equality strings are exact and case-sensitive; nullable cells follow the original native rules. String ranges and ordering use the original UTF-16 ordering. Choose one declared native sort column. Equal sort values retain the native original row order.

Pagination preserves the exact scalar query and cursor supplied by the original dataset handler. **Save current query result** includes the build, snapshot, requested parameters and full native response. It is useful as a reusable receiving query with the original result attached.

Compare two editions built from one saved mapping. If the chosen editions use different mappings, **Rebuild after source and compare** rebuilds the later source using the earlier edition's mapping and performs the comparison. Added, removed and changed rows refer to those observed export editions; original provider deletion records remain accessible in the sources.

For retained resource state, choose the base capture and add the actual modification captures in their intended order. The source engine checks their provider scope, original request coverage and modification intervals. The complete composition retains its original captures. If a capture contains conflicting duplicates, select the precise source, resource type, resource ID, file ID and physical line to keep. Build the resulting composed source with the same reviewed mapping to compare it with the base edition.

## Deliver and reconstruct

**Merchant dataset** contains the original native CSV, dataset configuration and README for the seller. **Dataset packet** contains the original source packet, saved mapping and completed native edition so the receiving workspace can reconstruct that dataset. **Editable workspace** carries the full source set, mappings, builds, comparisons, connections, observed capabilities, Group pages, export definitions and acquisition operations.

Receive a dataset packet in the delivery section and query its reconstructed edition. Receive a whole editable workspace into a fresh workspace. Its receiving operation is retained before reconstruction begins; if receiving is interrupted, select the same original archive and resume it. The interface keeps that upload available while a receiving record is incomplete, even when some sources or mappings have already arrived. Completed workspace receiving restores the original workspace identity and complete collection membership.

Credentials are supplied separately on the receiving machine. The editable archive preserves the original provider request and resource files required to resume work; protect it with the same access controls as the source export.

## Operate the complete browser receiving workflow

`operate_browser.mjs` starts from the completed `OPERATED_FHIR_BULK.json` produced by the native receiving programme. That JSON points to the original workspace and its received full export, incremental export, composed state, mappings and native builds. The browser programme reopens that workspace and operates the rendered controls.

Install Playwright and its Chromium runtime in the receiving environment. The programme imports the installed `playwright` package; in the ChatGPT runtime it can also use `CODEX_PRIMARY_RUNTIME_NODE_MODULES`. Supply `--chromium` when using an existing Chromium executable. The Python executable may be selected with `--python` or `CODEX_PRIMARY_RUNTIME_PYTHON`.

```bash
node operate_browser.mjs \
  --receiving /absolute/path/to/native-output/OPERATED_FHIR_BULK.json \
  --out /absolute/path/to/original-browser-output \
  --source /absolute/path/to/sf30-seller-sdk/fhir_bulk \
  --python python3
```

Use the same output directory to resume an interrupted browser programme. Its owner file prevents concurrent writers, while its journal preserves each completed phase, actual source identities and retained browser profile. Dead process ownership can be recovered by reopening the same programme. The native workspace lock also protects each active server.

The complete programme operates these phases:

1. Reopen the completed original export and inspect its exact original resource line.
2. Create and edit a default mapping with an actual observed field, remove the capture-specific record_id column for resource-content comparison, retain the full resource_json, preview it, save it and build the native dataset.
3. Query an original resource ID, select columns, sort, page forward and back where the actual dataset supports another page, and download the complete native query response.
4. Compose the original base and incremental captures in the native receiving order, including the original explicit duplicate resolutions.
5. Build the composed source with the same browser mapping, compare the received editions and download the complete change set.
6. Download the merchant dataset, source-backed dataset packet and complete editable workspace.
7. Receive the dataset packet through the browser in a fresh workspace, reconstruct the original CSV and configuration, compare the native snapshot and query the received edition.
8. Receive the whole editable workspace, compare all original collection memberships and resource bytes, restart its server and reopen the query at a mobile viewport.
9. Reopen the original browser workspace and confirm the operated mapping, dataset and comparison remain available.

Every mutation in these phases is made through the rendered interface. Read-only native calls inspect the actual result returned by the same workspace. Screenshots cover the real rendered pages. An interrupted phase records its error and an available page screenshot; rerunning the same output resumes the original receiving programme.

### Complete browser outputs

| File | Content |
| --- | --- |
| `OPERATED_FHIR_BROWSER.json` | Completed native identities, query, composition, comparison, receiving outcomes, artifact identities and browser page errors. |
| `BROWSER_JOURNEY.json` | Per-phase state, timing, observed source file identities and original receiving identity. |
| `01-original-export.png` through `09-reopened-workspace-mobile.png` | Nine complete browser views of the operated workflow. |
| `fhir-browser-native-query.json` | Actual native scalar query, snapshot and response. |
| `fhir-browser-edition-changes.jsonl` | Complete original comparison changes. |
| `fhir-browser-merchant-dataset.zip` | Merchant-ready native edition. |
| `fhir-browser-dataset-packet.zip` | Original source-backed dataset transfer. |
| `fhir-browser-editable-workspace.zip` | Complete original editable workspace. |
| `ORIGINAL_BROWSER_WORKSPACE.json` and `RECEIVED_BROWSER_WORKSPACE.json` | Original and reconstructed workspace membership. |

Opening a completed output rechecks its recorded artifact byte identities and returns the existing completion. Retain the whole original browser output and its native receiving output together when handing work to another operator.

## Source references

- [HL7 FHIR Bulk Data Access STU3 export specification](https://hl7.org/fhir/uv/bulkdata/STU3/en/export.html)
- [SMART Bulk Data reference server](https://github.com/smart-on-fhir/bulk-data-server)
- [SMART public reference server configuration](https://bulk-data.smarthealthit.org/)
- [Local HTTP contract](HTTP_API.md)
- [FHIR source and mapping engine](fhir_source.py)
- [Retained acquisition engine](fhir_acquisition.py)
- [Native workspace and receiving implementation](fhir_workspace.py)

License: MIT.
