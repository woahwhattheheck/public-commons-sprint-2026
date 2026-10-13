# Receive the original complete GeoCat source

This is the source receiving stage of `SCF-GEOCAT-COMPLETE-CUSTOMER-PACKAGE-20261012-33E6`. The selected product remains `woahwhattheheck/tjlabs-stellar-merchant-workspace@d22dfce88dde61d6708d24cfa919bea708044d38`. It is not another customer acquisition, build selection or GeoNetwork run.

The original coordinator retains execution ownership until an equipped seat explicitly accepts the handoff in the existing STAC thread. Report that acceptance before starting. Do not run a second worker if the original operation already has a live owner. This source-only stage does not invoke a provider, npm, the STAC application, a catalogue host or a final file save.

## Complete retained inputs

- `original-source-metadata.json.gz`: 352478 bytes, SHA256 `217a1bf33b5cea7f98f31f42e588db751502d6b88eb3662b82640d1e644f8a68`, Git blob `aadaa24c11196bc36bbf07e84979377a10c25cc9`.
- Its uncompressed metadata: 2349616 bytes, SHA256 `68a4d0ebf24e1a4a94c6e9f9f771f96ddeddb621342d2d91d3e50fda1cbf838c`, Git blob `83d976f7e551f957af74b9b00eb0540cfe483979`.
- `git-object-receiving.py`: the unchanged native receiver from the selected d22 source; Git blob `6fe4119a46e89c2a5831abe9a5c5726f4dc5668a`, 48,086 bytes, SHA256 `fedc33b92a755fe6e0cdbe7fe9a06f53c7bc19ab49e8115ea2d51512b4025c58`.
- `source-input-selection.json`: unchanged full selection, Git blob `db2e89c597bdac6de64052a08af454b377c7af1f`.

The metadata contains the complete original Git tree and exact signed commit text. The commit text was independently hashed back to d22 before publication. It selects all 1,878 paths / 24,744,679 bytes. The original receiver reconstructs and validates every Git tree, the complete commit and every selected file mode, size and Git blob. Compressed metadata is an input, not a claim that the selected source bodies are already available.

## Original source donors

Receive the already-saved complete maintained-source TGZ through its normal file receiving route. The coordinator supplies the actual saved file identity and full search result privately. It is a read-only donor: an earlier or later source archive contributes only members whose complete bytes match the selected d22 Git blob. Record the actual downloaded path, byte count and SHA256; never assume that the donor's source version equals d22.

The same receiver can additionally consume an existing complete application source via `--donor-source ABSOLUTE_ROOT` or an existing Git database via `--donor-repository ABSOLUTE_REPOSITORY`. These inputs are read-only. Use only existing paths whose actual custody is known. The receiver has its own original cache/selection lock and supports reopening that same cache after an interrupted source receive.

## Exact native invocation

Use the existing Python 3.11+ and Git executables, and a task-owned absolute source cache and new materialization directory. Resolve the following placeholders to actual files on the accepting host; keep the original operation and source commit unchanged.

First verify the three exact hashes above and decompress the metadata into a new file. Decompression must produce the declared 2349616 bytes and SHA256 `68a4d0ebf24e1a4a94c6e9f9f771f96ddeddb621342d2d91d3e50fda1cbf838c`. Preserve both complete input files.

```sh
python3 -B git-object-receiving.py \\
  --metadata /ABSOLUTE/INPUTS/original-source-metadata.json \\
  --commit d22dfce88dde61d6708d24cfa919bea708044d38 \\
  --directory /ABSOLUTE/ORIGINAL_GEOCAT/source-cache \\
  --git /ABSOLUTE/EXISTING/git \\
  --donor-archive ACTUAL_DOWNLOADED_TGZ_SHA256 /ABSOLUTE/DOWNLOADED/source.tgz \\
  --materialize /ABSOLUTE/ORIGINAL_GEOCAT/source
```

Exit 0 with `OBJECTS_AVAILABLE` means the whole selected source is materialized. Exit 2 with `SOURCE_NEEDED` is the original receiving continuation: retain `source-cache/source-receiving.json` and `source-cache/missing-objects.json`, and return their complete contents to the coordinator. Do not treat that result as a completed package. Feed only the remaining exact Git blobs through the receiver's existing `--incoming` path, then reopen the same cache with the same source selection. Preserve all received bodies and original receipts.

## Continue the same full package

The maintained package runner/bridge/guide were merged in public PR2771 at `59347e537098fca5e97d6d468fd5a9e875c20f4a`. Their exact reviewed blobs are run.py `280c47a89a3ce2a0c30798a2c0e9cef6490a0c27`, runtime.mjs `23ffe0443d04ab3d658abdfaf58d0c20967fad6e`, README.md `e916073ab32ff328653c4e0ac63a5d1f3cdfbf51`.

Once every source object is present, the original package owner supplies the actual host configuration/resource declaration and selects that completed Git repository as a read-only donor. The explicit `maintained-install` option uses the original installer when the old retained graph is absent, then performs the same lock/source/import inspections, installed STAC browser journey, fresh host reopen, complete source/application package and recorded final save. Native installation and customer outcomes remain separate from this source handoff. The actual catalogue request remains `SCF-GEOCAT-NATIVE-CUSTOMER-20261012-33E6`; do not create a new host, delivery or customer request.
