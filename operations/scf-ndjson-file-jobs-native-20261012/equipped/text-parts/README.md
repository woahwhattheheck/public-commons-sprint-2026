# Receive the complete original NDJSON file-job source

This directory carries the exact repaired source archive for the existing **SCF-NDJSON-FILE-JOBS-3AD791-20261012** operation as six complete UTF-8 files. Each file is below 1 MiB, so the native Git reader can return it in full. The original source archive, receiving program, native workflow, and selected product/publisher commits stay continuous.

## Original source

The ZIP is the complete archive published by [PR1856](https://github.com/woahwhattheheck/public-commons-sprint-2026/pull/1856), at carrier merge `131f362f9c37047454a216688c62bca460117a4c`.

| Selection | Original identity |
|---|---|
| Product source | `1d01fe16eb66d06a18a61e59f7a66d859cc5caa3`, all 287 files |
| Publisher source | `b670ee2c460f2821b3af0cec9bcd70c5be365e3c`, all 21 files |
| Archive | NDJSON_File_Jobs_Original_Source_20261012.zip |
| Archive bytes | 3,301,268 |
| Archive SHA256 | `91659e8eaae0ed734041c7264bc48f675ec224fd2d8a5d4b0e447da38d04a74c` |
| Archive Git blob | `05a520ac1cec1844e7147cb919038ce55e84d068` |
| Members | 309, including the complete original source manifest |
| Source bytes | 3,095,878 across 308 files |

Both original SCVO packages are present: Digital Ethics Fund 2022 with all five grants and Connecting to Care Fund 2024 with all seven. Each retained mapping has all 26 columns. The full original native command consumes both packages through sealed upload, job execution, complete ZIP delivery, independent receiving and process ownership.

## Receive the complete archive

From this exact published directory, read `SOURCE_PARTS.json`, `join-source.py`, and `archive.part-0001.b64` through `archive.part-0006.b64` with the native Git file reader using `encoding: "utf-8"`. Save every complete returned body, including its final newline, in one retained parts directory.

The first five encoded files are 786,433 bytes each. The last is 469,533 bytes. The parts manifest fixes every encoded and decoded byte count and SHA256, their order, and the whole original archive identity.

Use the existing operation's selected private inbox as the destination:

```sh
python3 -B /absolute/retained/text-parts/join-source.py \
  /absolute/retained/text-parts \
  /absolute/existing-operation/inbox/NDJSON_File_Jobs_Original_Source_20261012.zip
```

The standard-library helper verifies every part, streams the original ZIP into its destination filesystem, checks the complete SHA256 and Git identity, and publishes atomically. It reuses an identical completed destination. Its output gives the original archive identity and destination.

Continue with the original [prepare-ndjson.py](https://github.com/woahwhattheheck/public-commons-sprint-2026/blob/131f362f9c37047454a216688c62bca460117a4c/operations/scf-ndjson-file-jobs-native-20261012/equipped/prepare-ndjson.py), [NATIVE_HANDOFF.json](https://github.com/woahwhattheheck/public-commons-sprint-2026/blob/131f362f9c37047454a216688c62bca460117a4c/operations/scf-ndjson-file-jobs-native-20261012/equipped/NATIVE_HANDOFF.json), and [equipped receiving guide](https://github.com/woahwhattheheck/public-commons-sprint-2026/blob/131f362f9c37047454a216688c62bca460117a4c/operations/scf-ndjson-file-jobs-native-20261012/equipped/README.md). That receiving program verifies the whole source manifest and every file, then uses the existing native controller, selected toolchain and shared admission directory. The same original Muse assignment retains native execution and result return.

## Recovery from the original Git binary patches

The native `github_get_pr_diff` action with `format: "patch"` returns the complete patch in the result's `diff` field. The exact source recovery used:

```javascript
await github_get_pr_diff({
  repo_full_name: "woahwhattheheck/public-commons-sprint-2026",
  pr_number: 1755,
  format: "patch"
});
await github_get_pr_diff({
  repo_full_name: "woahwhattheheck/public-commons-sprint-2026",
  pr_number: 1856,
  format: "patch"
});
```

PR1755 contains the original 3,116,487-byte Git binary literal, blob `e2b91b3245c9ee1ec3c2a10e793f789d0813656b`. PR1856 contains the exact forward Git delta: 145,173 decoded bytes. Decode each Git85 line, inflate the zlib member, then apply that delta to its verified original literal. The result matches the complete repaired archive identity above. Every one of its 308 source members was then checked against its original manifest by size, SHA256 and Git blob; the two complete grants packages and both 26-column mappings also matched.

The six files here are direct base64 partitions of that verified archive. Receiving them avoids requiring binary-response support in the connector.
