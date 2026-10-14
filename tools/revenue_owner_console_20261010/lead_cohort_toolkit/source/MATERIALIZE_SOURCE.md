# Resume the original complete-source opening

Run the same maintained command with the original input and destination:

```sh
python3 native/materialize-source.py SOURCE_OR_CARRIER_JSON ORIGINAL_OUTPUT_DIRECTORY
```

The two positional arguments and printed output/source/record identity fields apply to every complete source family admitted below. Use the helper supplied with this toolkit or with the selected complete customer source.

## Complete input and custody
The opener accepts the original path-to-text files object, the original array of complete text members, and binary_files entries with canonical Base64, byte count and SHA-256. Existing gzip+Base64 codec carriers preserve the exact decoded JSON bytes; the same encoding-style decoded-byte carrier is also accepted. Duplicate JSON object keys, invalid UTF-8, noncanonical Base64, incomplete identities, changed bodies, unsafe Windows names, normalized/case-insensitive duplicate paths and file/directory collisions are rejected before any output or recovery-state publication.

The decoded original JSON is written byte for byte as complete-source.json. Text and original ZIP/binary files retain their exact bytes. No in-place body replacement or transformed ZIP is used.

## Interrupted operation and ownership
The private sibling directory OUTPUT.source-open-state contains owner.json, the complete planned-member inventory, unpublished temporary files and the final receipt. Nothing is added inside the application tree except the declared source members and its exact original complete-source.json. The native collector therefore retains the original application closure without absorbing recovery metadata.

Ownership binds the absolute destination, complete decoded source bytes/hash and full planned member inventory. Repeating the same input and output resumes matching files. Another source edition fails its original owner comparison even when its visible source subset happens to match. An older interrupted output with no state can be adopted only after every existing file exactly matches the supplied complete input and every directory is a declared parent. Unknown files, conflicting bytes, symlinks and unexpected directories reject before mutation.

An interruption between state-directory creation and first owner publication is resumable when the state is empty or contains only recognized unpublished owner stages. All such previous stages are preserved. Every current publication uses a unique exclusive stage in the sibling state, full write/flush/file-fsync, create-only hard-link final, exact readback and POSIX directory fsync. Windows retains file fsync while omitting unsupported directory fsync. An existing identical final is accepted; a changed final is never overwritten. A filesystem that cannot hard-link across the sibling state/output boundary returns its actual error while retaining original files.

## Use with the maintained toolkit

The native preparation, message composer and delivery recorder all publish complete-source.json with their required runtime and source files. Open that exact source into a separate destination, then use the command in its README or the retained native reopen entrypoint. Keep the source JSON and original recovery-state directories while an opening is incomplete.

For a source edit, publish a new complete edition and choose a new destination. The previous edition and its original ownership remain available for exact continuation. The native receiving course includes interruption after a published member, same-input resume, changed-input rejection and retained original ZIP comparison.

## Lossless source archives

The same two-argument command also opens `commons.source-archive.v1` documents and gzip carriers containing them. It reconstructs the exact original JSON before original file admission and output ownership checks. `--max-archive-expanded-bytes` sets both inflated carrier bytes and cumulative reconstructed node bytes; the default is 536870912 (512 MiB). Accepted compressed streams are read through their complete gzip trailers. Read [SOURCE_ARCHIVES.md](SOURCE_ARCHIVES.md) for packing, schema, budgets and exact interruption recovery.
