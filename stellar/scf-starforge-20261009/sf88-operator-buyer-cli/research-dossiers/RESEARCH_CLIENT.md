# Operate the existing Research workspace

The Research client connects to the same authenticated workspace used by the browser and Applications. It can review saved questions, source editions, selections and findings; operate a saved Crossref acquisition; receive reviewed source material; and retain complete reports and portable dossiers.

The original workspace owns its server, source credentials and saved operations. The client and merchant attachment own only their connection, in-flight requests and temporary download readers. Closing an attachment drains those readers while the original server and its saved acquisition continue.

## Connect to the original application

Use the private startup record written by the installed Applications operation:

```text
/private/applications/operations/ORIGINAL_OPERATION/application-url.json
```

The maintained Applications record uses command `research-workspace` and source `original-command-stdout`. The client also accepts the original printed startup URL or Research startup JSON. Applications records need no added `original` member.

Supply the original Research directory separately. The authenticated listener verifies the directory-derived workspace identity and its current instance identity. The startup file is reread on every request, so a managed restart may replace the token and listener while preserving the original workspace.

The direct Research launcher can publish a connection file itself:

```sh
starforge research-workspace --dir /private/research --connection-file /private/research-connection.json
```

Keep the startup record private to its owner. It contains the bearer credential in the URL fragment. A host-owned connection file must be a regular private file; symbolic links and files shared through additional hard links are rejected.

## CLI

`research-client` is included through the distribution's source-owned command contribution. The original Research CLI also accepts `research-dossiers remote` with the same commands.

```sh
starforge research-client status \
  --connection-file /private/application-url.json --directory /private/research

starforge research-client list \
  --connection-file /private/application-url.json --directory /private/research --limit 25

starforge research-client section \
  --connection-file /private/application-url.json --directory /private/research \
  --id DOSSIER_ID --section questions --limit 25
```

Page zero returns the exact dossier revision or inventory snapshot to use for the next page. Continue with those returned values. Source pages contain complete projected records for the selected page, and raw edition exports retain the complete original response bytes. A changing current inventory requires a new page zero; an explicitly selected historical dossier revision remains readable.

Commands use the original research identifiers and revision controls:

| Operation | Commands |
| --- | --- |
| Read the workspace | `status`, `list`, `metadata`, `section` |
| Maintain a question and its evidence | `create`, `update`, `question-add`, `question-update`, `evidence`, `selection` |
| Write cited analysis | `finding-add`, `finding-update`, `compare` |
| Receive complete source material | `receive`, `reference`, `openalex-editions`, `receive-openalex` |
| Operate a saved Crossref acquisition | `crossref-prepare`, `crossref-list`, `crossref-review`, `crossref-start`, `crossref-stop`, `crossref-receive` |
| Retain and reopen original files | `export`, `export-crossref`, `export-edition`, `export-compare`, `reopen` |

Run `starforge research-client help` for each command's fields. Structured mutations use `--input REQUEST.json`. The JSON keeps the original fields, including `expectedRevision`. For an existing question, read its current text and notes, compose the complete intended value, and write it with the revision that was reviewed.

```json
{
  "expectedRevision": 12,
  "notes": "The complete revised question notes, including the existing analysis.",
  "status": "open"
}
```

```sh
starforge research-client question-update \
  --connection-file /private/application-url.json --directory /private/research \
  --id DOSSIER_ID --question QUESTION_ID --input question-review.json
```

The CLI reports provider and source errors using the original error code. A write whose reply is lost carries `outcomeUnknown`: read the same dossier and saved operation before another write. The client does not automatically replay a mutation.

### Receive a reviewed original response

A response is selected as a complete local file and a SHA-256 digest. The client reads and validates that exact file before passing its UTF-8 bytes to the original receiving API. A leading UTF-8 byte-order mark is retained. The original edition's raw-byte hash is available through the dossier's edition metadata and complete raw-edition export.

```json
{
  "questionId": "QUESTION_ID",
  "label": "Reviewed retained edition",
  "provider": "PROVIDER_ID",
  "sourceReference": "https://original-provider.example/source",
  "expectedRevision": 12
}
```

```sh
starforge research-client receive \
  --connection-file /private/application-url.json --directory /private/research \
  --id DOSSIER_ID --input receive.json \
  --source-file /private/original-response.json --sha256 ORIGINAL_SHA256
```

The provider must match a format supported by the original Research engine or an adapter already configured by its host. Reference mode receives a provider-edition reference through that configured adapter. OpenAlex mode borrows the original workspace's retained edition bridge, preserving its progress, coverage and source identities while returning compact dossier metadata.

### Continue the same Crossref operation

Prepare from an existing question and the DOI-bearing sources already received there. Preserve the original `requestId` and preparation fields for a replay after a lost reply.

```json
{
  "requestId": "analyst-review-20261012",
  "questionId": "QUESTION_ID",
  "label": "Publication metadata and update review",
  "expectedRevision": 12,
  "selectedOnly": true
}
```

```sh
starforge research-client crossref-prepare \
  --connection-file /private/application-url.json --directory /private/research \
  --id DOSSIER_ID --input crossref-plan.json

starforge research-client crossref-review \
  --connection-file /private/application-url.json --directory /private/research \
  --id DOSSIER_ID --operation ORIGINAL_OPERATION --section dois --limit 50

starforge research-client crossref-start \
  --connection-file /private/application-url.json --directory /private/research \
  --id DOSSIER_ID --operation ORIGINAL_OPERATION --plan-sha256 REVIEWED_PLAN_SHA256
```

Start and stop address that saved operation. Review shows its acquisition state, coverage, warnings and projected source differences in pages. A completed partial acquisition keeps its useful original records and transport-failure detail. The source host retains its existing rate limits, cache, transport settings and cancellation behavior.

Receive the reviewed result with both immutable identities and the current dossier revision:

```json
{
  "expectedRevision": 12,
  "expectedPlanSha256": "REVIEWED_PLAN_SHA256",
  "expectedEditionSha256": "REVIEWED_EDITION_SHA256"
}
```

```sh
starforge research-client crossref-receive \
  --connection-file /private/application-url.json --directory /private/research \
  --id DOSSIER_ID --operation ORIGINAL_OPERATION --input crossref-receive.json
```

The existing operation reconciles an already committed matching edition before another receive. A partial refresh keeps original unreturned records in the projected comparison. Authored question notes, source selections and findings remain in the original dossier.

### Retain complete outputs

```sh
starforge research-client export \
  --connection-file /private/application-url.json --directory /private/research \
  --id DOSSIER_ID --format json.gz --out /private/research-portable.json.gz

starforge research-client export \
  --connection-file /private/application-url.json --directory /private/research \
  --id DOSSIER_ID --format html --out /private/research-report.html

starforge research-client reopen \
  --connection-file /private/application-url.json --directory /private/research \
  --source-file /private/research-portable.json.gz --sha256 EXPORTED_SHA256
```

The original portable writer streams the complete retained dossier. Report exports are the original Markdown or HTML report. A destination is published exclusively as a new file after the complete stream is retained; an existing destination is preserved. Receipts include byte length, SHA-256 and the actual exported dossier revision when the server supplies it.

Portable reopen hashes the complete selected file, streams through the same open file descriptor, and validates it again before the upload reaches EOF. The original server commits through its maintained streaming importer. Its saved-history conflict rules distinguish a replay, an extension and an incompatible history.

## SDK

```js
import {ResearchWorkspaceClient} from '@tokenjunkielabs/starforge-merchant/buyer/research-dossiers/client';

const client = new ResearchWorkspaceClient({
  connectionFile: '/private/application-url.json',
  directory: '/private/research'
});
try {
  const status = await client.status();
  const first = await client.list({limit: 25});
  const questions = await client.section(first.items[0].id, {
    section: 'questions', limit: 25
  });
  // Continue with questions.next and its returned revision when present.
} finally {
  await client.close();
}
```

The class methods follow the original dossier APIs and saved Crossref lifecycle. Structured responses use a 16 MiB control limit. Complete portable files, reports, comparisons and raw editions use streaming downloads under the original portable-file limit. A source file's before/after identity and digest are checked without placing its complete data in a tool reply.

## Merchant attachment

Create a host-owned connection selection alongside the original merchant configuration:

```json
{
  "schema": "stellar-forge.research-workspaces.v1",
  "workspaces": {
    "research": {
      "label": "Research workspace",
      "consoleUrlFile": "/private/application-url.json",
      "directory": "/private/research",
      "sources": {
        "reviewed_metadata": {
          "file": "/private/original-response.json",
          "kind": "research",
          "provider": "PROVIDER_ID",
          "sourceReference": "https://original-provider.example/source",
          "sha256": "ORIGINAL_SHA256"
        }
      }
    }
  }
}
```

The host selects the paths, provider and exact source digests. Tools address workspace aliases and source handles. A source handle may contain original research JSON, a provider reference or a complete portable dossier.

Add `researchWorkspaceConnection` to an existing merchant's private configuration, or create a merchant through the maintained initializer:

```sh
starforge merchant-mcp init-research-workspaces \
  --dir /private/research-merchant \
  --connection /private/research-workspaces.json

starforge merchant-mcp serve \
  --config /private/research-merchant/merchant-mcp.json
```

The family contains 27 tools. The normal operating sequence is:

1. `merchant_research_workspaces` lists host-declared aliases and source handles.
2. `merchant_research_attach` verifies the original listener and returns this attachment's ID.
3. `merchant_research_list`, `merchant_research_dossier` and `merchant_research_section` read original dossiers and complete paged records.
4. `merchant_research_question`, `merchant_research_evidence` and `merchant_research_finding` commit reviewed analysis through the original revision guard.
5. `merchant_research_crossref_prepare`, `operations`, `review`, `start`, `stop` and `receive` operate the same saved Crossref acquisition; each short name in this list has the `merchant_research_crossref_` prefix.
6. `merchant_research_export` retains a complete output and records its original selection, revision, byte length and hash.
7. `merchant_research_file_read` returns resumable base64 chunks from an immutable retained file. Continue with the returned offset and identity until EOF, then verify the full decoded byte count and SHA-256. `merchant_research_file_release` closes that temporary reader.
8. `merchant_research_reopen` streams a host-declared portable file or an exact retained portable export into the original workspace.
9. `merchant_research_detach` drains this attachment using its returned attachment ID.

`merchant_research_exports` pages the durable original export receipts, including after reattachment. Exports live in the merchant's private export directory under the selected workspace alias. A completed file remains available after its temporary reader closes. Multiple requests for identical complete bytes can share a content-addressed file while retaining each original export selection as a separate receipt.

A file-read snapshot expires after inactivity or closes on detach. Reattach and read the same retained export from the last decoded offset when needed. New receiving and editing requests continue to use the original dossier's revision and source operation identities.

## Maintained composition

The server's default browser responses remain complete. Metadata projection and section paging are additive for programmatic clients. Existing streamed portable export and reopen, original provider references, OpenAlex imports, Crossref state and optional document/source adapters retain their original routes. Applications remains responsible for starting, stopping and replacing its listener.

The implementation joins the existing merchant registry and distribution contribution loader. It uses the same original Research store, its immutable numbered revisions and source edition IDs. No separate merchant research store is introduced.
