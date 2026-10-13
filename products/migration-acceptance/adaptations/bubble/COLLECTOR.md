# Retained Bubble Data API collection

This collector reads the actual selected Bubble Data API into one complete `bubble.capture.v1` source. It belongs to the existing Migration Acceptance application under `adaptations/bubble/`. It issues GET requests only. It does not invoke workflows, create users, change privacy settings, write database records, or perform a destination migration.

## Configuration and source authority

Start from `configuration.template.json` and replace every placeholder from the actual application owner’s API settings and reviewed population specification. The template origin is deliberately refused. Choose an operation ID and a new private output directory for a different app, branch, query, expected count, or ordering. A following run with the same directory must use the identical complete configuration.

The origin is the exact HTTPS DNS origin without a trailing slash, path, query or credentials. `versionPath` is empty for Live, `/version-test` for the main development branch, or the actual safe custom branch path copied from API Settings. Do not infer that every custom branch begins with “version-”.

Use the API’s unique type name, in lowercase with spaces removed, exactly as shown by Bubble. The collector rejects duplicate selected type names and IDs. The current native importer accepts up to one million records per selected type; the collector preserves that separate local receiving limit even when an Enterprise query can paginate further.

`authEnv` contains only the name of an existing environment variable. Supply the actual approved Bearer token through the original host’s secret mechanism. Never put the token in configuration, command arguments, query strings, source files or the working directory. The collector stores no request headers or environment dump, refuses redirects, and does not persist a response that repeats the exact authorization secret. Raw application data may itself be sensitive and must remain in its authorized private receiving location.

The selected credential determines visibility. Bubble user-token access follows applicable privacy rules; an administrative API token can have broader access. An apparently complete response does not prove that hidden fields or excluded records were available. Retain the account/role and approved scope in the population evidence, without retaining its credential.

## Declared population and partitions

Every selected type has:

- A stable local `id` and the actual provider `typeName`.
- `scope.population`: the exact included organizations, date boundaries or other reviewed population.
- `scope.coverage`: `all-live` or `filtered-live`.
- `scope.inactive`: the explicit treatment of inactive records. No undocumented active-only filter is added.
- `scope.deleted: "not-observed-by-list"`: the list endpoint cannot reconstruct earlier deletions.
- `partitioning`: `single` for one partition, or `reviewed-disjoint` for multiple; `populationCoverage` is `complete-declared` or `selected`; evidence explains the actual reviewed boundary.
- One or more complete constraint/sort definitions, each with an independent ID.

Constraints retain the exact `key`, `constraint_type` and `value`, including explicit null where the reviewed API contract needs it. The collector URL-encodes these full values. It does not invent a field mapping or silently replace a query.

Ordering is explicit: `sort_field`, boolean `descending`, and `additional_sort_fields` objects with `sort_field` and `descending`. Review a stable complete ordering in the original app. Ordering by creation time alone can have ties; equal counts and duplicate detection cannot prove that a shifting tied population was never skipped. Quiescence and independently retained expected records strengthen reconciliation.

The ordinary cursor ceiling is 50,000 items per selected query; Enterprise is 10,000,000 only when the actual plan is explicitly selected. A partition whose observed total exceeds that ceiling stops before being marked complete. At equality, the collector additionally requires `expectedCount: {value, source, evidence}` for that exact population. Larger populations need reviewed disjoint narrower queries or an independently supplied complete export. The collector never slices away overflow or manufactures partitions.

Duplicate original `_id` values within a page, across pages, or across one type’s declared partitions stop completion. IDs remain opaque strings. Different types may use the same ID without being conflated. The declared partition evidence remains necessary: detecting overlaps does not prove that a gap between partitions is absent.

## Run and reopen

Use Node 24 on the existing authorized receiving host:

```sh
node collector.mjs --config /private/capture-config.json --directory /private/bubble-source-capture
```

The command prints only the original operation ID, complete capture file path, size/hash and current state hash. The credential is resolved from the configured environment variable only when another provider GET is actually necessary.

A normal re-run uses exactly the same configuration and directory. Successfully retained HTTP responses are loaded and hash-checked before any network read. A finished capture reopens from those original bytes without requiring a credential or additional provider calls.

An optional local compare-and-set boundary is:

```sh
node collector.mjs --config /private/capture-config.json --directory /private/bubble-source-capture --expect-state ORIGINAL_STATE_SHA256
```

Use `absent` for a caller that requires a previously unstarted directory. A mismatching checkpoint stops. All cooperating writers also use the exclusive immutable writer-epoch chain, so concurrent calls cannot publish the same epoch or silently overwrite one another’s checkpoint.

## Complete request and response custody

For each selected query the collector sends `cursor=0`, `limit=100`, `exclude_remaining=false`. It advances by the returned `count`, not by the number of remaining records. Each page must report the requested cursor, a count equal to its complete results length, and the same total `cursor + count + remaining`. A nonterminal empty page is rejected. The last page must have zero remaining records.

Every exact request is saved before dispatch. Its selection hash is SHA-256 over canonical JSON:

```json
{"endpoint": "...complete endpoint...", "type": {"id": "...", "typeName": "...", "scope": "...complete scope..."}, "partition": "...complete partition..."}
```

The actual implementation hashes those objects, not the illustrative strings above. Each saved page also carries the exact method and URL. There are no authorization headers in this record.

The complete `response.text()` is retained before JSON validation, with UTF-8 byte length, SHA-256, HTTP status, received time and original attempt number. Numeric provider fields are not converted into destination values here. The collector parses only pagination and opaque record IDs; the downstream exact-JSON reader receives the original text and controls decimal precision, null/missing distinctions, relationships and mappings.

`countBefore` is exactly the first page envelope, also present as `pages[0]`. `countAfter` is a separately requested and retained cursor-zero page of the identical query, made after that partition’s terminal page. It carries its own full raw text and observation time. Both counts must agree with the complete collected population and any configured independent count.

The capture’s `consistency` exactly retains the configuration. `observed-interval` states what was observed; `quiesced` requires actual supplied evidence. Neither the software nor stable counts assert a provider transaction or snapshot. Updates that preserve a count may still occur. Reconciliation with a separately retained expected capture remains the acceptance step.

## Interruption and failed requests

The output retains:

- `configuration.json`: immutable complete configuration.
- `writer-epochs/`: full original process identities and release receipts.
- `responses/<query-and-phase>/request.json`: immutable complete request.
- Numbered attempt and response records for every actual read attempt.
- `checkpoints/`: full immutable state editions.
- `state.json`: the current checked local state.
- `capture.json`: the complete successful source, including every page and before/after envelope.

Publication uses exclusive creation, file fsync, same-directory atomic rename/link and directory fsync. An interrupted temporary file is not mistaken for a completed response. A retained successful response is never fetched again. If an attempt was dispatched but no complete response was retained, resumption preserves that unanswered attempt and issues the same read as a new numbered attempt. It does not assert that the lost response was recovered.

A non-200 or transport failure remains complete evidence. Inspect it and its actual provider instructions; resumption after that failure requires `--retry-failed`. The collector does not loop on provider quota errors, switch credentials, or rotate accounts. A 200 response with invalid pagination, count, source identity or overlapping records remains an invalid original source; changing configuration requires a new operation instead of replacing it.

A live original writer cannot be displaced. After a process exits without a release, read the latest numbered writer JSON, verify its actual original owner, and use its full byte SHA with `--recover-lock SHA`. Automatic recovery is limited to the same Linux host and exact retained PID/start ticks/boot/PID namespace. The new writer publishes the next immutable epoch; it never deletes the original identity. An incomplete owner record or another host’s abandoned operation requires that original owner’s filesystem recovery, not an invented process identity.

## Use with original migration acceptance

The adapter receives:

```json
{
  "schema": "bubble.reconciliation-capture.v1",
  "source": "...complete source capture...",
  "expected": "...separately retained destination or rehearsal capture..."
}
```

The two actual capture operation IDs must differ. The expected population comes from independently retained source data, not from projecting the source and relabeling it as expected. The maintained adapter prepares full native source and expected tables, while the original compiler, load, verification, acceptance and handoff writers remain authoritative.

Keep the entire capture directory with the original private case. The reusable collector code and blank template can be public; customer captures and credentials cannot be included in that publication.

## Official contract references

Retrieved 2026-10-13:

1. [Bubble Data API requests](https://manual.bubble.io/core-resources/api/the-bubble-api/the-data-api/data-api-requests): GET constraints, cursor/count/remaining, `exclude_remaining`, sorting and ordinary/Enterprise cursor ceilings.
2. [Bubble Data API endpoints](https://manual.bubble.io/core-resources/api/the-bubble-api/the-data-api/data-api-endpoints): actual app/branch endpoints, custom domains and unique lowercase type names.
3. [How to authenticate](https://manual.bubble.io/help-guides/integrations/api/the-bubble-api/authentication/how-to-authenticate): existing Bearer-token authentication.
4. [Data API privacy rules](https://manual.bubble.io/help-guides/integrations/api/the-bubble-api/the-data-api/data-api-privacy-rules): visibility of records/fields under the selected authentication.

The core request reference defines cursor as the first record rank, count as returned items, and remaining as unreceived items. This implementation follows that definition when advancing pages.
