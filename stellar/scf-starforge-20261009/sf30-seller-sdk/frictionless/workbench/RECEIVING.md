# Receive and reopen a Frictionless source edition

This directory carries one immutable source edition and its original commissioning records. Start with **manifest.json** and **source-edition.json**, then receive **source.tar.gz** through the original Frictionless source receiver.

The original package descriptor, resource files, captured reference files, schemas, dialect and source rights travel inside the native source archive. The workbench also retains the exact query JSON text, complete native reviews, original source selections and saved publication-plan bindings for the exported edition. Publication and customer processing continue through their existing dataset and customer handovers.

## Files and identities

| File | Meaning |
|---|---|
| manifest.json | Original workbench export UUID, workspace UUID, edition UUID, original source/capture hashes and every delivered member's byte count and SHA-256. |
| source.tar.gz | Complete native source archive made by the original Frictionless exporter. Its internal manifest binds the original source configuration and every captured file. |
| source-edition.json | Frozen edition/capture metadata, exact queriesText, the selected review, all then-retained source selections and saved-plan bindings for this edition. |
| capture-inspection.json | The original full native capture inspection, or an explicitly marked original inspection-error record when intake retained a source that still needed a query correction. |
| reviews/UUID.json | Every native review for this edition retained when export began, with each original report preserved as exact bytes. |
| RECEIVING.md | These receiving and reopening instructions, declared in the original export manifest. |
| Frictionless-Source-Download.json | Additional complete download descriptor written by the merchant client. It binds the native manifest and all of its files to the original workspace and export UUID. |

The native export manifest lists its content files; the merchant download descriptor additionally binds **manifest.json** itself. The download client may retain its own checkpoint files beside these members. Those files belong to the transfer operation and should remain when continuing an interrupted transfer.

Read source rights and references from the original descriptor and captured material. An export preserves those declarations; it does not grant additional data rights or independently establish scientific validity.

## Obtain every declared file

Use the installed merchant source client against the original MCP URL returned by the source-workbench launcher. Supply the token through the already selected host environment variable; keep its value outside commands and reports.

~~~sh
stellar-forge frictionless-source download \
  --url ORIGINAL_MCP_URL \
  --workspace ORIGINAL_WORKSPACE_ALIAS \
  --workspace-id ORIGINAL_WORKBENCH_UUID \
  --id ORIGINAL_EXPORT_UUID \
  --directory /private/received-source-handover \
  --token-env MCP_ACCESS_TOKEN
~~~

Use the exact original workspace and export IDs from the completed export operation. The receiver reads the original complete manifest before downloading its members. It retains offsets, verifies already received prefixes and confirms each full file's length and SHA-256 before committing the completed transfer.

If the connection closes, run the **same command with the same receiving directory and IDs**. The existing receiver reopens released file readers with their original digest and byte offset. A completed file is reused after verification. Reconnection does not start another source capture, review or export.

When the merchant process has reopened, first reopen the same declared workbench through **merchant_frictionless_open**, then inspect its persistent workspace UUID. The new instance IDs describe the new owner lifetime; the workbench UUID and existing export UUID remain the receiving identity. Use the listener that belongs to that reopened owner. Changing a transfer's endpoint or immutable binding requires its explicit original receiver recovery rules, rather than editing checkpoint files.

The browser's **Source receiving** view offers the native manifest and each exact file. For a full handover with many review files, the client command above receives every declared member and retains the complete transfer state. Keep all declared members together.

## Receive the original source archive

Use the same installed source distribution that contains the Frictionless source exporter and receiver. The source commands use Node, the original Python parser and its supported dependencies. Set **SF_FRICTIONLESS_PYTHON** to the configured Python executable when it differs from the host default. CSV, TSV and JSON use the original standard-library parser. Parquet uses the original selected decoder and its declared Python requirements.

Read the **source.tar.gz** SHA-256 from the verified export manifest. Select a new private output directory:

~~~sh
stellar-forge frictionless source-receive \
  --archive /private/received-source-handover/source.tar.gz \
  --sha256 ORIGINAL_ARCHIVE_SHA256 \
  --output /private/received-native-source
~~~

The original receiver checks the complete archive, validates its members and writes the received source atomically. Keep its actual return value with the source handover. The resulting **source.json** refers to the received capture. **original-source.json** retains the exact exporting source configuration.

The source configuration's hash may change when its capture path is relocated. The exported **source-edition.json** separately records:

- **edition.sourceHash**, the original immutable exporting source configuration.
- **capture.captureSha256**, the original capture manifest identity.
- **queriesText**, the exact original query definitions.
- **receivingSourceHash**, the source identity from the exporter's verified receiving copy.

Use the original receiver's actual source path and fresh inspection when working in another directory. Compare the capture identity, original source bytes and query definitions; do not replace a current source hash with an old path-dependent hash.

Once reception completes, reopening reads the existing **source.json**. Keep the received directory intact. Do not use another source-receive invocation to overwrite it.

## Review the received source

Run the original full source review against the received source configuration:

~~~sh
stellar-forge frictionless review-source \
  --source /private/received-native-source/source.json
~~~

The native review reads every selected row and applies the declared field, key, missing-value, type, schema and dialect contract. Preserve its actual result alongside the originating reviews. A source operation can complete with validation findings; inspect its reported resource states and issues before selecting that source for publication.

Original reports retain the previous environment's actual observation and reviewer. A receiving review is a new observation in the receiving environment. Preserve both, including corrections and unsuccessful reviews.

The workbench's exact **queriesText** is the portable query-editing input. Keep projected columns in their original order and preserve literal missing values. JSON integer constraints outside the exact JavaScript range should stay in this text form. The original Python handling of decimal JSON numbers remains unchanged; represent precision-sensitive text according to the source's native contract instead of silently narrowing it through a browser number.

## Reopen in the source workbench

Add the exported archive to the receiving merchant's existing source-workbench connection under a host-selected alias:

~~~json
{
  "kind": "source-archive",
  "label": "Received source edition",
  "path": "/private/received-source-handover/source.tar.gz"
}
~~~

Keep the original connection schema and publisher alias. The installed **Frictionless source workbench** application opens the same configured publisher and scheduler under one merchant MCP owner.

1. Open the declared workbench and inspect its persistent workspace UUID.
2. Inspect this archive alias and retain the actual SHA-256 returned by the host.
3. Start one explicit intake using that SHA, the current workbench version and a caller-retained request UUID.
4. Read the retained capture's resources and original file list.
5. Create a receiving edition from **queriesText** in the original exported **source-edition.json**. A receiving edition has its own UUID while retaining the same original source meaning and capture.
6. Run the original full native review and retain its actual reviewer and result.
7. Inspect the publisher's current source hash, then select this reviewed edition using that exact current hash.
8. Obtain and review the original publication-plan template for the selected query. Save it through the original publisher, then continue its existing extraction, candidate review and publication controls.

The receiving workbench preserves its own edition and operation history. The exported original UUIDs remain source provenance; they are not rewritten to impersonate receiving operations.

## Recover a disconnected operation

The source workbench stores an original request before beginning its action. Browser requests retain their exact input before dispatch and store a confirmed native result before refreshing derived views.

For an uncertain result, use **Requests** or the native request client:

~~~sh
stellar-forge frictionless-source request \
  --url ORIGINAL_MCP_URL \
  --workspace ORIGINAL_WORKSPACE_ALIAS \
  --workspace-id ORIGINAL_WORKBENCH_UUID \
  --id ORIGINAL_REQUEST_UUID
~~~

If the retained action is incomplete and the original owner is available, explicitly resume that same request:

~~~sh
stellar-forge frictionless-source request \
  --url ORIGINAL_MCP_URL \
  --workspace ORIGINAL_WORKSPACE_ALIAS \
  --workspace-id ORIGINAL_WORKBENCH_UUID \
  --id ORIGINAL_REQUEST_UUID \
  --resume --wait
~~~

A browser reload reads retained state. It does not replay a mutation. A new UUID represents a new requested action; retain the original body, query order and UUID when recovering an interrupted operation.

A completed source export freezes the exact selected edition, reviews, source selections, saved-plan bindings and guide. Later reviews do not change an already started export. Reopening a completed export verifies and returns its original files.

## Operational scope and limits

This source handover carries a complete source archive and the selected edition's commissioning records. The publisher's full database, candidate rows, published dataset generations, payment records and customer warehouse are carried by their respective existing export workflows. Export those artifacts as well when the receiving work includes them.

The workbench permits up to 64 native queries per source edition. Its original native archive is limited to 256 MiB compressed and the source receiver applies its existing 512 MiB unpacked bound. The merchant receiver permits at most 10,000 declared files, including the native manifest, and 256 MiB per file; download and native manifest bounds are 64 MiB. Full row review remains subject to the original native source contract and its resource bounds.

Retain the complete handover, actual native return values, configuration selection and final source version used to receive it. Close borrowed browsers and file readers through their original owner. A browser close does not close the publisher or scheduler that another component still owns.
