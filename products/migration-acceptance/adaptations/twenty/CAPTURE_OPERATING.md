# Complete Twenty CRM capture and receiving

Prepared by TokenJunkieLabs.

The collector acquires the selected original source and independently observed Twenty destination, keeps every complete response and cursor, and produces one capture for the existing Migration Acceptance review. Operators review the business-key and field mapping, retain an attributed edition, then run the original native load, parity, business acceptance and independent receiving course.

This guide describes the installed code in `products/migration-acceptance/adaptations/twenty/`. The complete `products/migration-acceptance/workbench/` directory and both original source manifests remain part of the installation. Commands below run from `products/migration-acceptance/`.

## Workspace selection and configuration

Use Node 24 or newer with the original installed Migration Acceptance runtime. Keep a private input directory and one private output directory for each original capture operation. Retain that directory through interruptions; it contains the original responses and resume state.

Choose one configuration:

| Original source | Configuration |
| --- | --- |
| Complete retained legacy JSON exports, independently compared with Twenty | `examples/capture-configuration.json` |
| An authorized Twenty source workspace, independently compared with another authorized Twenty workspace | `examples/capture-twenty-to-twenty.json` |

Copy the appropriate configuration into the actual private input directory and replace its placeholders. Both examples use reserved example domains and authored field names. Select the actual API origin, workspace identity, object plural names, exact fields, population and mapping from the authorized workspace's generated OpenAPI and metadata. A source export must be the complete originally selected file, with its original business identifiers; preserve null, empty text and numeric tokens.

The collector uses these original read endpoints:

- `GET /rest/open-api/core` and `GET /rest/open-api/metadata`.
- `GET /rest/metadata/objects` and `GET /rest/metadata/fields`, before and after the record scan.
- `GET /rest/<selected plural>` with the explicit fields, filter when selected, `limit=60`, `depth=0`, and the original `starting_after` cursor.

A configuration supplies the following fields:

| Field | Meaning |
| --- | --- |
| `operationId` | Stable original capture identifier. Reuse it only with the same complete configuration and output directory. |
| `consistency.mode` | `observed-interval`, or `quiesced` with the operator's actual quiescence evidence. |
| `workspaceReference` | The real selected source or destination workspace identity. |
| `baseUrl` | HTTPS API origin without a path, user information or credentials. |
| `tokenEnv` | Name of the receiving runtime's environment variable, such as `TWENTY_TARGET_API_KEY`. The token value is never part of the configuration. |
| `deployedVersion` | Known original deployment version, or null when not established. |
| `objects[].namePlural` | Exact authenticated object plural. |
| `objects[].objectMetadataId` | Optional selected metadata identity; when supplied, it must match the observed object. |
| `objects[].fields` | Explicit selected field names, including `id`; preserve required composite and relationship fields. |
| `objects[].filter` | Null for the selected full live population, or the original nonblank Twenty filter expression. |
| `scope.coverage` | `all-live` for a null filter, `filtered-live` when filtered. |
| `scope.population` | A complete description of the actual selection. |
| `scope.deleted` | `not-observed-by-list` for REST capture. |
| Legacy `objects[].path` | Complete original JSON file path, resolved relative to the configuration file. |
| Legacy `spec.rowsPointer` | JSON Pointer to the complete record array; empty string means the whole document. |
| Legacy `spec.recordIdPointer` | Original stable key inside each record. |
| Legacy `spec.scope` | `all-exported` or `selected-export`, population and actual deletion coverage. |

Retain related objects and their key fields where the reviewed mapping resolves relations. The collector preserves the original metadata, generated response schema and selected relation fields. The mapping explicitly relates a destination record ID to its independently retained original business key; row order does not establish identity.

For an observed interval, record changes can occur while pages are collected. Before/after metadata equality, exact page counts and terminal cursors establish the selected captured material, while the declared interval remains visible. Record absence only means absence from that retained selection. A REST record's attachment metadata does not include the linked binary file.

## Private credentials and actual collection

Have the existing authorized runtime supply the environment variables named by the configuration. Give it the exact approved workspace and read permission. Keep secrets out of the command line, files, screenshots, handover and source repository. The collector sends a bearer credential only to the selected HTTPS origin and rejects redirects.

With a complete actual configuration:

~~~sh
node adaptations/twenty/capture-twenty.mjs \
  /absolute/private-input/capture-configuration.json \
  /absolute/private-capture/original-operation
~~~

The CLI prints the complete capture path, bytes, SHA-256, original operation and selected object counts. Success requires both complete populations, generated OpenAPI, every metadata scan and terminal record page to validate. It performs GET requests only. The later native receiving course writes its selected local receiving database.

The current limits are 60 records per page, 700 milliseconds between collector requests, a 45-second request timeout, 32 MiB per complete HTTP response, and 512 MiB for retained response collection and the serialized complete capture/session boundaries. Encoded JSON and retained retries contribute to storage size. A response that exceeds the supported bound does not become a complete source page; select a coherent smaller population or fewer explicit fields under a new reviewed configuration, while preserving the original interrupted directory.

## Original files, interruptions and resume

Keep the entire output directory:

| File or directory | Purpose |
| --- | --- |
| `CAPTURE_SESSION.json` | Exact configuration, its hash, original start time, state and complete capture when sealed. |
| `HTTP_INDEX.json` | Complete retained original response/export file identities. |
| `PAGE_WRITE.json` | Durable original page/retry write intent; allows exact recovery of a page or archived prior response saved before its index update. |
| `originals/` | Full original export files and provider responses, exact request intent, cursor, status, body, time and retry information. Earlier attempts remain retained. |
| `capture.json` | The completed capture admitted for mapping review. |
| `.collector-lock.json` | Ownership of the current process while it operates. |
| `.collector-lock.json.recovery` | Exclusive ownership while recovering an original stale same-host process lock. A held recovery guard is retained for its original owner to inspect. |

After an interruption, inspect the actual retained error and run the same command with the same configuration and output directory. The collector reuses successful complete pages and resumes the missing original GET. A completed session is revalidated and reuses the same complete capture without another network request.

An HTTP 429 retains the full response and the provider's Retry-After. The collector stops. Run the same command only after the retained deadline; an early resume makes no request. Numeric delays and HTTP-date deadlines are retained as a specific retry time. Other HTTP failures also stop with the complete response. Correct the actual credential/access/provider condition before a deliberate continuation. Do not change actor, workspace or selection merely to route around a rejection.

The original lock prevents concurrent collectors in the same output directory. A live original process remains its owner. The CLI only recovers a stale same-host process lock after establishing that its original process is absent. A different host's lock requires the original owner's release. Stale-lock takeover obtains an exclusive recovery guard, rereads the original owner and writes the new live owner before releasing the guard. A held recovery guard is not automatically taken from its owner. Do not delete locks or response files to force a second writer.

On open, the CLI verifies every ordinary original response file, reconciles complete unindexed pages, and verifies an interrupted page-write intent against the exact prior and new file identities. A malformed index is retained and rejected; an indexed file that is missing or changed requires its original recovery. Keep the entire directory and error for the existing operator rather than removing the index.

Changed configuration, changed original response bytes, repeated cursors, a missing terminal page, duplicate record IDs, changed selected metadata or inconsistent population counts reject completion. Keep the original response evidence. A new selection or a fresh observation interval belongs in a new directory with a separately identified operation.

## Review the complete selected source

Open the installed `adaptations/twenty/` page or its exact built standalone review. Select the completed `capture.json` and the reviewed mapping. The authored `examples/mapping.json` describes the example schema; update the full actual business keys, original and destination pointers, native types, missing policies, currency transforms, relationships and acceptance controls for the selected workspace.

The original review supports complete source and destination populations, composite fields, missing-versus-null distinctions, attributed mapping editions and complete editable recovery. Save an unfinished working copy before closing with incomplete intake or mapping forms. Save the complete project after the named reviewer approves the exact capture and mapping. See `OPERATING.md` for the full original editor and acceptance semantics.

Build the exact offline review from the same installed source:

~~~sh
node adaptations/twenty/build-review.mjs /absolute/new-output/twenty-review.html
~~~

Open that output itself. Source files and selected manifests must match; preserve a different earlier output under its original filename.

## Original native load, comparison and complete receiving

Use the complete saved project and the existing owner's runtime-ready selection:

~~~sh
node adaptations/twenty/receive.mjs \
  --project /absolute/input/project.json \
  --directory /absolute/original-workspace \
  --receiving-directory /absolute/independent-receiving \
  --runtime-ready /absolute/runtime-ready.json \
  --operation ACTUAL_ORIGINAL_OPERATION \
  --actor ACTUAL_REVIEWER
~~~

This is the original Migration Acceptance operation. It retains original sources, compiles the reviewed dlt pipeline, performs the local load and verification, evaluates complete parity and business acceptance, exports the editable NDJSON handover, independently receives it and cold-reopens the copied application. Preserve its source request journals and original job identities. Use `--native-project` only for the selected existing native project. Use `--resume` only after inspecting the original ended attempt; an uncertain target write requires its original reviewed continuation.

The optional `--select-local` selects the accepted local DuckDB snapshot only when both parity and acceptance are ready. A live CRM import remains a separately authorized operation with its own original outcome.

## Executable authored collection course

The supplied collector course exercises the actual production collector against the retained, explicitly authored reference bodies. It contacts no CRM and needs no real credential. Its complete journal records every request URL, response body, cursor, saved page and result.

~~~sh
node adaptations/twenty/examples/run-collector-course.mjs /absolute/new-output/authored-collector-course
~~~

The course covers complete paginated metadata and all seven authored target records, preserved source exports, interrupted record retrieval, a retained 429 with blocked early retry, exact later resume, a page-save acknowledgement loss, unchanged completed reopen, changed-source rejection and a repeated cursor. A native Node invocation also operates the actual CLI filesystem/stream adapter against those same local response bodies.

The reference contains two companies, three people and two opportunities. Destination opportunity O001 deliberately differs by USD 50. Zero CAD, empty string, null and leading-zero keys remain distinct. Retain that expected disagreement through the native comparison; the source and destination are independent.

The accompanying recorded source execution used the exact production modules with isolated I/O interfaces. It establishes the exercised interface outcomes listed in its result. It is not evidence of a customer API call, native Python/Node installation or rendered browser inspection.

## Review the delivered application and files

Open the exact built review at desktop and narrow widths. Inspect all selected populations, mappings, findings and saved history; exercise invalid input and unfinished edits. Download and reopen the complete working copy, project and source files. Inspect the extracted handover contents and record the reviewed edition and actual receiving result. The detailed browser receiving steps are in OPERATING.md.
