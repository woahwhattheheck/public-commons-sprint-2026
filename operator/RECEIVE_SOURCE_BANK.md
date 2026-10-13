# Receive a published operation into an existing application

The source-bank receiver turns an exported Canvas into the original operation input and applies it with the application's existing atomic, journalled receiver. It uses Python's standard library and the existing application directory.

## Run the source-context atlas update

Save the exported Markdown or native Canvas JSON from [the source-context atlas bank](https://tokenjunkielabs.slack.com/docs/T0BRETUB5TK/F0C8J9D9867) as atlas-source-context-v3.canvas.md. Use the application's existing Python interpreter and absolute application directory:

```sh
APP=/actual/existing/application
PYTHON=/actual/existing/python

"$PYTHON" -B "$APP/operator/receive_source_bank.py" \
  atlas-source-context-v3.canvas.md \
  --application "$APP" \
  --operation-id UPSTATE-ATLAS-SOURCE-CONTEXT-7BF6-V3-20261013 \
  --member integration/map-atlas-source-context-v3.integration.json \
  --sha256 674a7e59d0c86606be268688cc0084afafdc821dc51a216c35c3b5be40be5522
```

This published input is exactly **93,309 bytes**. Its six complete files include explicit previous-source hashes for the five updated atlas files; its seven literal edits preserve concurrent application changes. Apply it to the integrated atlas core from merged PR 2741 or its composed receiving edition. The core receiver reports any changed preimage with the affected path and edit ID.

The same command accepts source-bank JSON, exported native MCP JSON containing the Canvas, original integration JSON, gzip carriers, or stdin (-). A source-bank can contain inspectable source files alongside the ready operation. Specify the exact member when a bank contains multiple operations.

A successful result includes the original integration state, per-file results, operation ID and canonical journal hash, plus source_input with the exact packet file's path, bytes and SHA-256. Source composition, allowed-path enforcement and journal recovery remain owned by operator/integrate_operations.py.

## Continue after an interruption

Once the input is retained, its original bytes are available from the application itself:

```sh
"$PYTHON" -B "$APP/operator/receive_source_bank.py" \
  --application "$APP" \
  --resume UPSTATE-ATLAS-SOURCE-CONTEXT-7BF6-V3-20261013
```

You can also rerun the original command. The receiver uses the existing operation journal and reconciles files already applied. A completed operation preserves later source changes. Source mismatches retain the core receiver's conflict result and exit code.

Input retention uses .operator-integration/.received/<packet-file-sha256>.json and an operation-local source-input.json binding. An operation ID stays bound to the same exact input bytes and the same application. Publish an intentional revision under a new operation ID.

After source intake completes, continue the original native programme and browser journey using their existing Workspace, run IDs and output paths. Reload the operator's Python process and extension descriptors with that receiver's retained start command so the new handlers become active.

## Supported input and identity rules

| Input | Receiving behavior |
| --- | --- |
| Original upstate.operator-integration/v1 JSON | Preserves all original file bytes, including formatting and a UTF-8 BOM. |
| commons.source-bank/v1 | Validates each files[] member's exact path, base64, byte length and SHA-256; selects an existing integration JSON member. |
| Canvas Markdown or exported native JSON | Reads fenced JSON and nested Canvas text; the original base64 member supplies the authoritative packet bytes. |
| JSON.gz or base64-encoded gzip | Expands through the same decoding path, with a 16 MiB limit per carrier or member. |
| Several different matching packets | Lists their operation IDs, member paths and hashes; accepts the explicit selector that resolves the ambiguity. |
| Parsed operation object without original JSON text | Requests the original text or base64 member, which preserves the published packet's file identity. |

Canvas may change structural spaces to nonbreaking spaces. The intake recognizes those spaces **outside quoted JSON strings only** when reading a transport wrapper. Every decoded source member keeps its original bytes. A direct operation that required transport repair needs its original JSON or authoritative base64 member.

The --sha256 argument is the hash of the original decoded packet file. The existing journal's bundle_sha256 is the hash of canonical JSON; those values intentionally describe different byte sequences.

The bank is a transport container. It carries an already assembled operation with files, edits and allowed_paths; source-bank joins and standalone code members remain inspectable source. This keeps the authored operation and its recovery identity identical across seats.

## Publish a compatible operation

Use the existing upstate.operator-integration/v1 schema with a stable operation_id, allowed_paths listing every target, a files object and an edits array. Each complete file entry contains its UTF-8 content, exact bytes and SHA-256; an update to an existing authored edition includes expected_previous_sha256. Omit that previous hash for a newly added file. Each literal edit contains id, path, before and after using the original receiver's unique preimage and postimage rules.

Serialize the final operation once and place those exact UTF-8 bytes in a source-bank member with path, encoding: "base64", content_base64, bytes and sha256. Keep that packet immutable after publication.

Native seats can invoke this script from a sibling received checkout while --application still names the original live application. The command loads the integrator from that application. Both new intake files can be published independently through the normal repository checkout; they require no descriptor registration.
