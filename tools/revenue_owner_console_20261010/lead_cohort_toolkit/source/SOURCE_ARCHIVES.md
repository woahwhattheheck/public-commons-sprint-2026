# Lossless complete-source archives

A customer source bank can contain its whole predecessor as an original file. Repeated deliveries preserve that history correctly, but embedding each older JSON bank again makes successive JSON strings grow quickly. This archive stores shared original text once and reconstructs every original spelling before the existing materializer admits files.

The format preserves the exact original UTF-8 bank, including whitespace, property order, escape spellings, final newline, full nested history and binary-file Base64 strings. Customer member paths, file bytes, working-record hashes and the ordinary complete-source.json remain the same after opening.

## Prepare a transport

Run from the maintained lead_cohort_toolkit directory:

~~~sh
node native/pack-source.mjs /absolute/complete-source.json /absolute/Packed-Source
~~~

The input may be an ordinary complete bank, an existing gzip+Base64 carrier, a raw source archive, or a gzip+Base64 carrier containing that archive. The packer validates each carrier identity and reconstructs archive input before packing. The input bank must have its original files collection.

The output contains five complete ordinary files:

| File | Purpose |
| --- | --- |
| source-archive.json | Readable, uncompressed content-addressed archive graph. |
| source-archive.gzip.json | Gzip+Base64 carrier of that exact archive JSON, with byte count and SHA-256. |
| materialize-source.py | Complete standalone receiver supporting both archive and legacy source carriers. |
| README.md | Complete opening and continuation commands for the recipient. |
| summary.json | Actual source, transport and tool identities; raw/gzip/carrier sizes; node counts; configured budget. |

The default archive budget is 536870912 bytes (512 MiB). It counts the sum of UTF-8 bytes of all reconstructed nodes, including the root and each unique original child, before a node is admitted. It is not the compressed file size. Both the native packer's gzip input and the Python opener's gzip carrier inflation use this budget as their output bound. The opener reads at most one byte beyond the limit, rejects overflow, and admits only streams whose complete gzip members and trailers have been read and validated.

~~~sh
node native/pack-source.mjs /absolute/complete-source.json /absolute/Packed-Source \
  --max-archive-expanded-bytes 1073741824
~~~

Packing independently reconstructs its graph and compares the complete original string. It also reads back the generated gzip bytes through Node's standard zlib implementation. Small banks may become larger because the graph has metadata overhead; summary.json reports the actual measured reduction, which can be negative. A gzip carrier remains useful independently of raw graph size.

## Open with the same original ownership

Use the supplied standalone helper:

~~~sh
python3 /absolute/Packed-Source/materialize-source.py \
  /absolute/Packed-Source/source-archive.gzip.json \
  /absolute/Recovered-Source
~~~

The raw source-archive.json can be selected in the same command. A larger explicit budget uses the same optional flag:

~~~sh
python3 /absolute/Packed-Source/materialize-source.py \
  /absolute/Packed-Source/source-archive.json \
  /absolute/Recovered-Source \
  --max-archive-expanded-bytes 1073741824
~~~

The original two positional arguments remain sufficient. Old path-to-text banks, member-array banks, binary_files and both existing gzip-carrier field conventions remain supported.

After archive reconstruction, the receiver runs the original source admission unchanged: complete member identities, strict UTF-8, canonical Base64, safe portable paths, modes, normalized duplicate names and file/directory collisions. It writes the exact original decoded bank to complete-source.json and the exact original member bytes to their original paths.

The sibling output.source-open-state binds the reconstructed original bank and original member inventory. A matching original JSON, old gzip carrier or new archive therefore refers to the same output owner. An exact interrupted opening resumes that owner. Changed original source, conflicting output bytes or unexpected files fail before replacement. The archive's transport bytes do not become a new customer source identity.

Use the restored product's original README and native reopening entrypoint. For a prepared cohort:

~~~sh
node /absolute/Recovered-Source/native/reopen-cohort.mjs /absolute/Reopened-Customer-Files
~~~

Full delivery history remains available, including history/source-editions/<original-sha>/complete-source.json. The existing recorder can continue from the restored ordinary source directory.

## Graph schema

The raw document has exactly these keys:

~~~json
{
  "schema": "commons.source-archive.v1",
  "root": {"sha256": "<64 lowercase hexadecimal characters>", "bytes": 0},
  "nodes": []
}
~~~

This illustrates the fields; a usable archive needs a valid original JSON root and at least one complete node. Every bytes value is a nonnegative integer within JavaScript's safe-integer range. The root references the exact original bank's SHA-256 and UTF-8 length.

Nodes are ordered so every reference targets an earlier complete node. Each node has one of two exact forms:

~~~json
{"sha256":"<digest>","bytes":123,"kind":"text","text":"complete original text"}
~~~

~~~json
{
  "sha256":"<digest>",
  "bytes":456,
  "kind":"json-template",
  "parts":[
    {"text":"nonempty literal span"},
    {"quote":"<earlier-node-digest>"},
    {"text":"nonempty literal span"}
  ]
}
~~~

A literal contributes its exact text. A quote contributes JSON.stringify of the earlier node's exact text. The Python receiver uses json.dumps with ensure_ascii=False and compact separators for the same string spelling. UTF-8 node validation excludes isolated surrogates; original escaped surrogate tokens that cannot form a UTF-8 child remain in literal spans.

Only a source token whose original spelling already equals JSON.stringify(decodedText) becomes a quote reference. Noncanonical escaping, such as an explicit escaped slash or escaped Unicode spelling, stays literal. Decomposition examines valid JSON object/array strings and recurses to a bounded depth. Content-addressed text nodes also deduplicate ordinary repeated long strings and Base64 values.

Receiving verifies exact keys, kinds, digest spelling, safe integer lengths, unique node IDs, earlier references, each reconstructed node's full SHA-256/length, the root identity and complete reachability. Detached extra nodes reject. Declared node bytes must fit the remaining cumulative budget. Quoted UTF-8 length is measured before allocating the quoted string; a template cannot exceed its declared size. Empty literal parts reject, and reachability uses iterative traversal without an argument-count limit.

The current packer emits canonical JSON for the graph itself. The source bank inside it retains its original spelling.

## Carrier and repeat publication

The gzip transport is a normal compatible envelope:

~~~json
{
  "schema":"commons.source-archive-carrier.v1",
  "codec":"gzip+base64",
  "bytes":12345,
  "sha256":"<SHA-256 of exact decoded archive JSON>",
  "content_base64":"<canonical Base64 gzip data>"
}
~~~

The envelope's identity describes the archive JSON. The archive root identity describes the original source bank. Keep both meanings distinct when transferring and receiving a delivery.

The native packer uses source/source-publication.cjs with summary.json as its completion member. A sibling output.lead-delivery-state binds the exact original input bytes/path, reconstructed source, archive bytes, configured budget and complete tool identities. It publishes through exclusive stages and create-only links, reads back exact members and writes summary.json last.

Retry the same input, tools and output path after interruption. The initial durable timestamp is retained. A deliberate source, tool, budget or input-carrier change uses a new output directory. Existing files are never replaced with a different edition.

## Maintained integration

source/source-archive.cjs exports SCHEMA, packSource(text, options), unpackSource(archive, options) and archiveStatistics(archive). packSource accepts minimumStringLength (default256, minimum32), decompositionDepth (default32, maximum256), and maxExpandedBytes (default512MiB). unpackSource accepts maxExpandedBytes. Statistics summarize an already admitted archive and do not replace receiving.

native/materialize-source.py contains the complete decoder itself, so the distributed helper needs only Python's standard library. native/pack-source.mjs uses Node's standard filesystem, path, crypto and zlib modules plus the maintained source archive, SHA-256 and create-only publication modules. Existing prepare/reopen/record/compose commands retain their ordinary source-bank format; choosing an archive is an additive transport step.


## Ordinary internal file pickup

Use the existing [native source-transfer helper and preview](../../../slack-source-bundle/NATIVE_SOURCE_TRANSFER.md#preview-the-complete-request-before-creation) for a recipient-free ordinary pickup. Its attachment builder preserves complete Base64URL bytes and omits attachment-level charset. Preview measures the exact serialized invocation, independently of decoded source size, and supports an explicit advisory rather than inventing a provider limit. Select the complete archive carrier, materializer and useful readable files; do not also attach an expanded application merely to duplicate bytes already recoverable from the complete carrier. Preserve unique source and the original operation if a provider result is uncertain.
