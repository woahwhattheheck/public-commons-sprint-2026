# Lossless source bundles for Slack Canvas

One standard-library Python CLI replaces per-delivery whitespace repair scripts. Pack **explicitly selected** source files into printable ASCII, publish the resulting envelope, read that exact published content back, then verify and unpack the original bytes. The decoder never normalizes source text: literal nonbreaking spaces, tabs, CRLF, binary bytes, empty files and consecutive blank lines survive.

No install, network access, Slack credential, source execution, package manager, Git invocation or hosted CI is part of this tool. Python 3.10+ with stdlib zlib is required; local execution was on Python 3.13.5/Linux.

## Sender

Review the selected source for publication to the intended audience. Use the correct private channel for private work. Encoding is **not encryption or an authorization bypass**, and the tool does not inspect secrets or automatically select files.

```sh
python source_bundle.py pack --root ./working-source \
  --base '<original-source-commit>' --output /tmp/source-envelope.txt \
  src/module.py patches/integration.patch
```

The output file must be new. The JSON line on stderr supplies the original manifest SHA256, source bytes and file count. Publish the envelope **as generated**, inside one top-level code block. Put the original SHA256 in the accompanying handoff. Do not manually rewrite base64, source whitespace or the digest to make a failed verification pass. Prefer a byte-preserving file upload when the transport supports it; the envelope is for prose-only paths.

Pack does not recurse or follow source symlinks. It requires regular files and records normalized 0644/0755 modes (executability, not all original permission/ACL metadata). The root must be trusted and quiescent: this is not a snapshotting filesystem or a defense against concurrent hostile changes to parent directories.

## Receiver

Save the native Canvas **markdown text**, not the outer JSON/escaped tool-response wrapper. Exactly one envelope is allowed in the input. Keep the sender's original digest separately from the envelope.

```sh
python source_bundle.py verify ./canvas-readback.md --sha256 '<original-manifest-sha256>'
python source_bundle.py unpack ./canvas-readback.md \
  --sha256 '<original-manifest-sha256>' --parent ./review-area
```

The parent must already exist. The second command prints a new, uniquely named `tjl-source-*` directory and digest. It never writes over a live checkout or existing output directory. Every source file is checked before extraction and again after writing. A sidecar `.tjl-source-manifest.json` contains the base description, paths, modes, sizes and individual hashes, without embedded content.

Inspect the recovered source before applying a patch or running anything. The `--base` field is informational: the tool does not fetch or verify a Git commit, apply patches, run installers or reconcile concurrent changes. An expected digest establishes equality to the sender's bytes, **not sender identity, source safety or recipient authorization**. Retain existing source review and customer-sharing requirements.

## Format and failure behavior

Canonical ASCII JSON contains the format version, source-base description, and sorted records of path, mode, byte count, SHA256 and base64 content. A zlib-compressed outer payload is base64-encoded with line wrapping. Only whitespace in this transport is ignored; decoded source data is never edited. The original digest covers the complete uncompressed manifest, including metadata and file content.

Verification rejects wrong original digests, truncation, duplicate envelopes or JSON keys, trailing compressed data, oversized expansion, inconsistent individual hashes/sizes, symlinks during packing, traversal/absolute paths, reserved device names, case-folded or Unicode-normalized path collisions and file/directory conflicts. Extraction uses a newly created private directory. Modes are restored where the OS supports them; Windows ACL/executable behavior was not validated. Limits are 256 selected files, a 16 MiB expanded manifest and a 32 MiB textual input; Slack may impose smaller publication limits. Split a large delivery by actual module boundary or use supported native file transfer, rather than trimming the envelope.

Source code is not sent automatically. The two pure-Python functions `pack` and `inspect_bundle` can be called by an existing publisher/consumer, so native tool code can pass the generated string directly instead of retyping it through a model. `unpack` creates files but never executes them. On I/O failure it removes only its own newly created output directory. Atomic power-loss durability, cryptographic signing and archival retention are outside this CLI.

## Executed acceptance

```sh
python -m unittest -v test_source_bundle.py
```

Two focused groups pass: deterministic byte/mode roundtrip into two distinct output directories, and invalid/tampered/path-colliding input refusal before extraction. The byte probe includes every byte value 0-255, real NBSP, CRLF, tabs, multiple blank lines and an empty file. These checks run locally, not via a repository-wide test suite.

A native `slack_create_canvas` / `slack_update_canvas` / independent `slack_read_file` roundtrip was executed on 2026-10-11. The final accepted payload contains the real SF31 `public-buyer.mjs` from [PR709](https://github.com/woahwhattheheck/public-commons-sprint-2026/pull/709), a 40-byte whitespace probe and an empty file: **503 source bytes, three files, all byte-equal after recovery**. Original manifest digest: `da1bdb13be3c81d6491ed181876f50643d86189b5aef1cf955cd15601798f976`. The recovered buyer entrypoint then passed the original two grouped Node22 TLS integration checks with its original buyer/transport/test dependencies supplied from the already-verified source. Only that entrypoint and the two probes traversed this native acceptance envelope, not the entire application.

The initial larger envelope had manual transcription damage and was replaced before acceptance; no repair guesses were used to obtain the accepted source bytes. Native roundtrip equality, not visual rendering or successful Canvas creation alone, is the delivery check.

## References

- [Python bounded decompression](https://docs.python.org/3.13/library/zlib.html#zlib.Decompress.decompress)
- [Python unique private temporary directories](https://docs.python.org/3.13/library/tempfile.html#tempfile.mkdtemp)
- [Slack Canvas creation](https://docs.slack.dev/reference/methods/canvases.create/)

MIT. No customer source or secret is bundled with this reusable tool.
