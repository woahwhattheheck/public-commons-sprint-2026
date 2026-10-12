# Repository metadata workspace

A complete OAI-PMH 2.0 metadata workflow for the original Starforge XML and dataset tools. An operator discovers a repository, harvests the selected population through every continuation, reviews its record edition, projects explicit XML fields, and opens the retained dataset in the existing merchant publisher.

The console uses a neutral industrial layout and works on a narrow screen. Source records, original HTTP responses, saved reviews and complete exports remain reachable from the same workspace.

## Open the operator console

Use Python 3.12 with Expat 2.6 or newer, Node 22 or newer, and the complete Starforge source tree. The XML parser, projection functions and dataset engine are imported from the maintained adjacent components.

```bash
python sf30-seller-sdk/oai-pmh/cli.py --workspace /absolute/repository-workspace init
python sf30-seller-sdk/oai-pmh/cli.py --workspace /absolute/repository-workspace serve
```

The second command prints the exact loopback URL and PID. Open that URL. Set `SF30_XML_NODE` to an absolute Node executable when it is not on PATH. The workspace is private and protected by the original XML workspace's operating-system lock. Stop its existing console before opening the same directory in another process.

1. **Repositories:** Add the actual OAI base URL, a display name and request spacing. Complete Identify and ListMetadataFormats; discover sets when the selection uses a set. The catalog is paginated and retains the source request for each entry.
2. **Harvests:** Choose the discovered metadata prefix and explicit optional set/from/until. A stable operation ID identifies the entire continuation. The console follows all pages and retains every observed response.
3. **Edition review:** Review added, updated, deleted, reinstated, unchanged, retained and older records. Choose an exact observation and reason for each conflicting record with the same identifier and datestamp. Record the reviewer and edition note.
4. **Records:** Search every reviewed identifier, inspect its original header and metadata tree, and trace it to its original response page.
5. **Projection:** Select an existing XML mapping or edit the exposed columns and capabilities. Inspect actual record metadata to choose namespace-expanded paths. The metadata-fields button inspects the selected edition and offers an editable Dublin Core or DataCite preset; each repeated field is preserved as a JSON-array string with an explicit missing-value policy.
6. **Exports:** Download the complete publisher source or save the whole workspace. The source package includes the reviewed dataset and complete response lineage. The workspace backup also retains interrupted work, prior attempts, conflicts and saved operator state.

## Repository and continuation semantics

Repository identity is the exact configured OAI base URL. Item identifiers are retained independently from DOI, title and resource-link metadata. Record identity combines the repository, metadata prefix and original identifier.

`Identify` supplies the actual protocol version, earliest datestamp, date granularity and deletion policy. `ListMetadataFormats` supplies prefixes, XML namespaces and schema locations. `ListSets` uses its own complete continuation. A set selection covers that set; the repository can also contain records belonging to no set.

The first ListRecords request carries the selected metadata prefix and optional set/from/until. Subsequent requests carry only the verb and opaque resumption token. Tokens are URL encoded without interpretation. The original selection, every response, token attributes, request time, actual HTTP status and headers remain in the workspace.

From and until are inclusive. Both boundaries use the same granularity. Day-granularity requests are supported by the protocol; second-granularity selections require the repository's declaration. Records use the repository's declared datestamp precision.

The process saves its read intent before making a request and commits each complete page before advancing. A closed process resumes the same operation. HTTP 429 and 503 retain the original response and honor Retry-After; the console waits with a cancellable worker. Expired continuation responses restart the original selection in a new attempt under the same operation ID, retaining earlier attempts. Failed HTTP reads and malformed responses remain inspectable and can be resumed explicitly.

`noRecordsMatch` is a complete empty selected population. `noSetHierarchy` records the repository's absence of sets. Other OAI errors remain attached to their original request. A successful response must echo the requested verb and arguments and contain the appropriate OAI 2.0 result.

Zenodo's official guidance specifies 50 records per page, 30 requests per minute, and resumption tokens valid for two minutes. The default 2.1-second request spacing accommodates that rate; use the actual provider's returned limits and observed retry headers. The complete source acquisition can also run on an equipped host and be imported unchanged into the same operation.

## Edition reconciliation

A harvest becomes reviewable only after its terminal continuation. There is one retained observation per source page and record position, including duplicate observations and deletion notices.

Without a baseline, the edition is built from that complete selection. With a baseline, the repository, metadata prefix and set must match the baseline. Missing identifiers carry forward from that baseline. Only an explicit OAI deleted header removes a previously active record.

For each identifier, the newest repository datestamp wins. An older incoming record preserves the baseline's newer record. Identical observations at the same datestamp collapse for edition membership while their response pages remain retained. Different observations at the same datestamp require an explicit operator choice. A later active record can reinstate a deleted identifier.

The approval is bound to the exact reconciliation digest and operation revision. Reviewed editions are immutable; a changed selection or later harvest creates its own edition. An edition keeps the full baseline chain and its review.

## XML projection and native dataset

The workspace uses the original `xml/xml_source.py` hardened streaming parser, `Node`, `project()`, `typed()`, `validate_plan()` and `dataset_spec()`. It calls the original `xml/native.mjs` pipe and `dataset-handler.mjs` to load, validate and query the complete projected CSV.

An OAI mapping uses the original schema:

```json
{
  "schema": "stellar-forge.xml-mapping.v1",
  "name": "repository_records",
  "recordPath": [
    "{http://www.openarchives.org/OAI/2.0/}OAI-PMH",
    "{http://www.openarchives.org/OAI/2.0/}ListRecords",
    "{http://www.openarchives.org/OAI/2.0/}record"
  ],
  "columns": [
    {
      "name": "identifier",
      "path": [
        "{http://www.openarchives.org/OAI/2.0/}header",
        "{http://www.openarchives.org/OAI/2.0/}identifier"
      ],
      "type": "string"
    }
  ],
  "keys": ["identifier"],
  "filters": ["identifier"],
  "sorts": ["identifier"],
  "maxRows": 250000,
  "maxBytes": 67108864,
  "maxLimit": 250,
  "defaultLimit": 50
}
```

Every active OAI record produces one projected row; deletion headers remain in lineage. Source identifiers should stay strings. Integer and number output use the original native dataset rules. Repeated elements use an explicit single/first/last/join/JSON policy; missing elements and xsi:nil also require explicit mapping choices. Set `allowEmpty` deliberately when publishing an empty active edition.

The generated dataset must contain exactly the edition's active-record count. The saved build retains its mapping ID, edition ID, native snapshot, original engine blob, CSV hash and configuration hash. Original query capabilities, limits and cursor behavior remain available.

## Native CLI

Each command opens and closes the same original workspace. JSON documents can be read from a named file or `-` on stdin.

| Command | Purpose |
| --- | --- |
| `init`, `state`, `serve` | Create, inspect or open the original workspace |
| `repository --url URL --label NAME --interval SECONDS` | Add the exact repository |
| `start --repository ID --verb VERB --arguments JSON --id OPERATION [--baseline EDITION]` | Save an original discovery or harvest operation |
| `run --id OPERATION`, `resume --id OPERATION` | Follow the complete continuation |
| `import-response --id OPERATION --body FILE --transport JSON` | Import an actual response from another host |
| `preview --id OPERATION [--choices JSON]` | Reconcile the complete record edition |
| `review --id PREVIEW --expected PREVIEW --reviewer NAME --note NOTE` | Approve the exact reconciliation |
| `records --id EDITION --offset N --limit N` | Page through all retained identifiers |
| `changes --id PREVIEW --offset N --limit N` | Page through all reconciliation decisions |
| `requests --id OPERATION --offset N --limit N` | Inspect original request and response history |
| `default-mapping`, `mapping --plan JSON` | Prepare or retain an original XML mapping |
| `build --edition EDITION --mapping MAPPING` | Project the complete reviewed edition |
| `query --build BUILD --parameters JSON` | Query through the original dataset engine |
| `export-source --build BUILD --out NEW_DIRECTORY` | Export the complete publisher source |
| `backup --out NEW_ARCHIVE` | Save the whole workspace |
| `restore --archive ARCHIVE` | Restore into the new `--workspace` directory |

Transport JSON contains the actual `url`, integer `status`, original header pairs in `headers`, `finalURL` and UTC `observedAt`. The importer checks the captured URL against the next request in the retained operation. Pages up to the original XML limit of 256 MiB are accepted by the native importer. The browser accepts response uploads up to 32 MiB.

Conflict choices map an exact identifier to `{"observationId":"retained observation ID","note":"reason"}`. Choices only apply to the current conflicting observations. The operator can inspect each complete source record before selecting it.

## Portable source and merchant integration

The exported directory has `source.json` and `capture/capture.json`. The capture manifest hashes every retained member:

- Native `data.csv` and `dataset.json`.
- Exact reviewed `mapping.json` and complete `lineage.json`.
- `records.jsonl` mapping edition membership back to original observations.
- `requests.jsonl` retaining observed transport and continuation attempts.
- Exact original XML pages and retained HTTP error bodies.

The manifest includes repository identity, selection, completed operation/attempt, reviewed edition, active/deleted counts and native build identity. Metadata, rights fields and resource links stay connected to their source. Review the repository's metadata-use terms as part of the edition note.

The OAI publisher consumes this closure through `openSourceDatasetPublisher`. It retains plans, extractions, candidate reviews, original versioned-dataset publication and recovery in the existing publisher. Merchant preparation uses the existing SF82 dataset-package release interface and keeps the complete optional source-file closure for the receiving host. The original SF88 buyer flow acquires the same immutable dataset snapshot. See [PUBLISHING.md](PUBLISHING.md) for the maintained publisher CLI and receiving commands.

## Complete save and reopen

A workspace backup contains the original SQLite state and every retained source, mapping, build, request and edition. The archive manifest gives each member's exact size and SHA-256. Restoration checks every member and the original SQLite database before reopening. It creates a new private directory, preserving the prior workspace.

The console binds to `127.0.0.1`, requires its actual Host/Origin and session token for mutations, and serves a restrictive content policy. Downloads select known retained object IDs. Source XML uses the existing DTD/entity rejection and parser limits.

## Primary protocol references

- [OAI-PMH 2.0 specification](https://www.openarchives.org/OAI/openarchivesprotocol.html): identifiers, records, datestamps, deletion headers, sets, selective harvests, protocol errors and continuations.
- [Zenodo OAI-PMH documentation](https://developers.zenodo.org/#oai-pmh): endpoint, metadata formats, page size, token expiry and request limits.
- [DataCite metadata schemas](https://schema.datacite.org/): current schemas; actual captured namespaces and ListMetadataFormats drive each projection.


## Project the actual repository metadata

In Projection, choose **Use repository metadata fields** after selecting a reviewed edition. The application inspects an actual active record's expanded XML names. Dublin Core and DataCite kernel-4, including the OAI DataCite envelope, have editable presets. Other formats use the original record inspector and explicit mapping editor.

The DataCite preset retains the repository identifier and datestamp separately from the metadata identifier and its declared type. It exposes titles, creator names, subjects, related identifiers, rights, rights URIs and descriptions as JSON-array strings, preserving repeated values and order. Publication year is an explicit nullable integer; publisher, resource type, language and version are explicit nullable strings. Missing arrays become an explicitly selected empty array. The complete original XML remains available for attributes, entity relationships and richer future mappings.

The original dataset engine supplies identifier, date, metadata identifier, publication year, publisher, resource type and language filters/sorts, plus publication-year ranges. The metadata preset allows up to 1,048,576 UTF-16 code units per cell so complete long descriptions can be preserved; the editable 64 MiB dataset budget and native response page budget remain explicit. Saving the mapping checks every row of the complete edition before creating a dataset. The preset is an editable operator choice; it does not change a source record.

Use `python cli.py --workspace /absolute/workspace metadata-mapping --edition EDITION` to print the same plan for native use.

### Portable transport and private sessions

Source exports retain the exact original XML and HTTP response bodies. The portable request log omits Cookie, Set-Cookie, Set-Cookie2, Authorization and Proxy-Authorization header values and lists the omitted header names. Each exchange retains a SHA-256 binding to its original canonical private exchange, and the capture manifest declares this transport policy. The complete original headers remain in the private workspace and its full backup. Publisher plans and merchant source packages carry the declared portable source bytes.


## Reopen the complete Zenodo worked case

The source-only entry point `examples/zenodo_20261011.py` imports the original unchanged acquisition archive, resumes the same retained operation IDs, reviews the complete selected population, and opens its original typed dataset. The archive is the 356,305-byte `adc6-oai-records-20261011.zip`, retained in the original [acquisition thread](https://tokenjunkielabs.slack.com/archives/C0BTB4SUCP9/p1791761425735799), file `F0C8EUSGMLJ`. Its expected SHA-256 is built into the entry point.

```bash
python sf30-seller-sdk/oai-pmh/examples/zenodo_20261011.py --archive /absolute/adc6-oai-records-20261011.zip --workspace /absolute/zenodo-workspace --serve
```

A new workspace receives the exact captured response bodies and observed transport; an existing matching workspace reuses its retained pages, edition and build. The script prints the same edition ID, build ID and native dataset snapshot, followed by the console URL. Add `--export /absolute/new-source-directory` or `--backup /absolute/new-backup.zip` to produce complete receiving artifacts before opening the console. A newly imported workspace records its actual current review time; the complete original saved backup preserves the earlier operator history.

This case uses all 231 actual DataCite records from 2026-10-11T00:00:00Z through 2026-10-11T01:00:00Z. The five record pages are complete, and the separately retained first set-catalog page keeps its actual continuation.
