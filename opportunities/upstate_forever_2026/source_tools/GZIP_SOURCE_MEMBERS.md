# Receive original per-member gzip source banks

The existing source recovery toolkit now accepts a source descriptor whose exact original bytes are carried in `content_gzip_base64`. Use the existing Node inspector/extractor or the same pure JavaScript `createSourceBankToolkit` API. The original ZIP, XZ, plain UTF-8, base64, whole-bank gzip and Canvas receiving paths remain in that toolkit.

## Receive the retained scientific application source

The original input is `application/integration/scientific-context-application-20261013.source.json` inside the retained portable application archive. Its exact size is **11,966,386 bytes**, SHA-256 **9b7d4f7ee0a675dc0b541c00abda79ad000c8457e9d102a96d4da9534c0fbf51**. Retain that original file unchanged.

```sh
node source_tools/source_bank_cli.mjs inspect scientific-context-application-original.json \
  --sha256 9b7d4f7ee0a675dc0b541c00abda79ad000c8457e9d102a96d4da9534c0fbf51

node source_tools/source_bank_cli.mjs extract scientific-context-application-original.json \
  received-original-context \
  --sha256 9b7d4f7ee0a675dc0b541c00abda79ad000c8457e9d102a96d4da9534c0fbf51
```

The destination must be new and its parent must exist. The complete original bank contains **1,004 files / 37,815,140 source bytes**: 741 gzip-carried members, 262 plain-text members and one base64 member. Every recovered path and byte identity is checked before extraction begins. The original input and full inventory remain under `.source-bank-recovery/`.

This retained edition is `eco13-complete-scientific-context-57`. It is an original source edition for composition, not a replacement for a newer working application. Use the maintained application installer or original-object transfer workflow to select the desired editions; preserve current source and the original scientific Workspace. The receiver does not execute decoded files or submit a model.

## Member identities and compression

A gzip member must declare its original nonnegative integer `bytes`, SHA-256, relative path, and exactly one content field. `content`, `content_base64` and `content_gzip_base64` cannot coexist. The new field means base64 of gzip of the **original member bytes**. A member whose original content is itself a gzip file keeps those original compressed bytes; the receiver removes only the expressly declared transport layer.

The existing gzip codec checks headers, DEFLATE, CRC32, decoded size and trailing data. Expansion cannot exceed the member's declared original length, the configured member limit or the remaining complete-bank output allowance. Optional `gzip_bytes` and `gzip_sha256` must be supplied together and are checked before expansion. The final original length and SHA-256 are always checked.

Recovery inventory records each compressed member's transport size and SHA-256 alongside its original output identity and descriptor metadata, without copying Base64 payloads into the metadata. Original modes remain recorded; the unchanged extractor writes private 0600 files and 0700 directories. Top-level `file_count` and `source_bytes` declarations, when present, must match the complete bank.

All existing `--max-input-bytes`, `--max-output-bytes`, `--max-member-bytes`, `--max-members` and `--max-gzip-members` options remain available. No browser, native compression library or network dependency was added to the decoder.

## Executed original-source recovery

The unchanged earlier decoder rejected the actual input with `expected UTF-8 source text`. The continued decoder recovered all 1,004 files in **3.37 seconds**, peak process RSS **209,884 KiB**, on the existing Linux host. An independent Python reading compared every recovered body against its original descriptor and independently decoded original carrier.

Against the separately retained 4,946-file current application, 750 paths were identical, 251 had different original source editions and three paths were absent. Those 254 retained versions now exist in a separate recovery tree; no current source was replaced. This comparison is against that physical application, not the separate frozen-976 inventory.

The original 121,182-byte watershed ZIP also recovered all 17 files / 1,084,587 original bytes unchanged. A corrupt final gzip member in the complete application bank failed CRC32 before the extractor created a destination. Ambiguous content, absent identity, declared expansion below actual size, incorrect source hash and partial compressed identity were rejected through the same maintained decoder.

Keep `AGENTS.md` and the complete current `CURRENT_OWNER_DIRECTION.md` with any downstream handoff. The retained October 13 owner brief is version `2026-10-13.3`, ending at 14:00 UTC; newer actual owner direction takes precedence.
