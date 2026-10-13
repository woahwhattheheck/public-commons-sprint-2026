# Exact source transport

This adds a reversible UTF-8 envelope to the existing source-bundle tools. It reduces repeated source bodies across nested JSON, HTML, and deterministic gzip payloads while preserving the complete original bytes. It is useful when an existing connector cannot carry a full source archive in one message.

The canonical pure module is `opportunities/upstate_forever_2026/source_tools/exact_string_transport.mjs`. The generic tool path re-exports that same implementation; the standalone application ships the canonical sibling together with its existing archive codec. The Python source-bundle format and commands remain available.

## Command line

Requires Node.js with ES modules and a local filesystem supporting hard links and directory fsync (the fleet Linux hosts support these operations). Run from the repository root:

```bash
node tools/slack-source-bundle/exact_string_transport_cli.mjs pack source.json source.envelope.json
node tools/slack-source-bundle/exact_string_transport_cli.mjs inspect source.envelope.json --sha256 ORIGINAL_SHA256
node tools/slack-source-bundle/exact_string_transport_cli.mjs unpack source.envelope.json restored-source.json --sha256 ORIGINAL_SHA256
```

The output filename must be new. Publishing writes a private temporary file, synchronizes it, links it into the final name without replacing anything, removes the temporary name, and synchronizes the parent directory. If a post-publication step fails, the error identifies the complete output that already exists; inspect that file before retrying. Interrupted writes can leave a private `.exact-source-*.partial` file in the output directory.

Commands return a JSON receipt with original size and SHA-256. `pack` restores and checks the complete original before publishing. `inspect` also performs full decoding and verification. `--max-bytes N` and `--max-transport-bytes N` override the default 32 MiB source and transport limits. These limits reject excessive input or expansion; they never truncate it.

## Programmatic use

```js
import {createArchiveCodec} from "./archive_codec.mjs";
import {createExactStringTransport,createExactSourceEnvelope} from "./exact_string_transport.mjs";
const codec = createArchiveCodec();
const api = createExactSourceEnvelope(codec, createExactStringTransport);
const envelope = api.encode(originalText, "source.json");
const restored = api.decode(envelope, independentlyRecordedOriginalSha256);
consumeOriginalSourceText(restored.text);
```

Restore the entire text before parsing a source-bank document. JSON whitespace, numeric lexemes, duplicate keys, escaped string spellings, CRLF, BOM, and Unicode are preserved. Numeric values are never parsed and reserialized as the source of truth. Noncanonical JSON strings stay literal; embedded gzip is factored only if recompression produces identical bytes.

The envelope verifies compressed transport, decoded node graph, and full original identity. An independently recorded expected SHA-256 pins the intended original; embedded hashes alone establish consistency. The graph uses literal, concatenate, JSON-quote, and exact-gzip nodes. Node count, recursion, cycles, and materialized output are checked, including checks before concatenation and quotation allocation. Gzip expansion is limited inside the maintained decoder.

The helper transports one opaque text file. It does not extract archive paths, execute received source, upload files, or create public links. Existing receivers continue to enforce their original member/path and installation rules after restoration.

## Receiving and maintenance

Keep the original source, envelope, and independently recorded hash with the operation. Transfer complete bytes using an already authorized attachment route; paginate or split only when the receiving route requires it. Reuse an existing receiver and its current source identity rather than starting another installation.

Run the focused command-line acceptance course on a fleet Linux host:

```bash
node tools/slack-source-bundle/exact_string_transport_course.mjs
```

It exercises exact lexical preservation, a nested shared source, pack/inspect/unpack, external hash mismatch, and refusal to replace an existing output. The course creates and removes its own temporary directory. It does not add a hosted CI workflow.
