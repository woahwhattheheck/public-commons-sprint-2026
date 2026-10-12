# Complete original Snowflake merchant receiving

This operation carries the already exercised two-partition Snowflake SQL API contract fixture through the full merged merchant product. Its exact original partition bodies, statement handle, source and request recover edition `18bbd54c207434b5957ead9a86aecdfa9e75d58b93291c5ef9f0d86decb2ede2`. The native receiving operation keeps one private directory across interruptions.

## Run

Use the existing complete SCF source, Node 24, installed Stellar SDK and merchant dependencies. The selected source must include merged Snowflake PR1926 and the maintained source-owned merchant provider/transport implementation. Source selection is recorded from the actual installed files on each attempt.

```sh
EXISTING_NODE operations/scf-snowflake-merchant-receiving-20261012/receive.mjs \
  --source-root EXISTING_COMPLETE_SOURCE \
  --directory SAME_PRIVATE_OPERATION
```

The caller writes the original input and merchant terms under the selected private directory, then invokes the original `snowflake/merchant/receiving.mjs` engine. Repeat the same command and directory to resume an interrupted operation. The underlying journal retains upload/download cursors, workspace identity, selected edition, review and publication.

The complete journey opens the original authenticated browser endpoint through the registered Merchant host; pauses a partition upload and resumes it after host restart; prepares the same reviewed edition and SF82 publication; pauses a complete customer export download and resumes after a second host restart; compares the delivered native SQLite rows and original partition BLOBs; receives the full original edition into a second workspace; and activates/opens the original release console. It uses the same original native engines as the product.

## Original inputs

| Input | Bytes | SHA-256 |
| --- | ---: | --- |
| partition-00000.json | 808 | f9c1caa09af67d3b40d651b2361fecc75b2583ec4cc42241fbffd0d54440269b |
| partition-00001.json | 207 | ef5b47f0fe9367d54b11cd871abb33a66cafafb2148b07b6e2eea4591e4728a7 |

The fixture source is the original native core program, Git blob `3b055e33534071b70dce727eb8df5e3450388b27`. Restoring its saved statement handle produces both exact saved partition hashes. The maintained Snowflake compiler and original edition identity function independently recover the saved edition. The portable receiving manifest carries these original identities; local observation sequences and capture timestamps stay in the original operation archive.

The fixture preserves integer `9007199254740993`, decimal `12345678901234567890.123456789012345678`, a scale-38 decimal, nanosecond timestamp text, JSON null and the literal string `null`. Merchant terms reuse the earlier native operation's testnet zero-key identities through the installed Stellar SDK. The fixture does not require external account credentials or a remote query.

## Returned delivery

Return `result.json`, the selected `source-<SHA>.json`, `input-selection.json`, `merchant-case/merchant-receiving.json` and every file under `merchant-case/complete-download/`. That complete customer directory contains original response partitions, receiving manifest, edition/review, original merchant files and native SF82 SQLite snapshot. Keep the private operation directory on the accepting host for the same receiving continuation.

The distinct full Merchant operation is `C94-SNOWFLAKE-MERCHANT-MCP-20261012`, with publication `94c00000-0000-4000-8000-000000000002`. The earlier native HTTP/browser operation keeps its own workspace and publication. Source fixes after an interrupted native result continue this same receiving directory and record their actual new source selection.
