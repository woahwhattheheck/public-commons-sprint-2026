# Receive the original accepted Apex case

This example consumes the original complete six-export archive:

- File: apex-accepted-placement-exports.zip
- Complete length: **119,254 bytes**
- SHA-256: d2700b5d31a78da61d5fbf7f94c5e62cae9d677cdd40f69a3eb08bc954c67d7a
- Original workspace provenance: workspace-64a7a33c16294ea490bc1a630753c9b3
- Original application: PR1791, commit 1b69ab4dd5e91eecb554367dba3e40fd48bbec50
- Original company/operator thread: https://tokenjunkielabs.slack.com/archives/C0BTTA66TK3/p1791774555464879

**original-case.json** retains all six exact member hashes and the original document selection. The method contains 27 grades, the role edition 47 roles and the selected workforce 19 rows. The three already accepted scenarios are immediate, phased and deferred implementation. Their original calculations and reviews are received intact.

The original full Apex workspace database was not part of this six-export archive. The receiver creates an explicit receiving workspace while retaining the original workspace ID as source provenance. It preserves the original document IDs, content hashes, review bodies and source relationships.

## Execute the native receiving journey

From the complete maintained staff-market-workbench application:

~~~bash
python3 -B classification/receive_accepted.py \
  --package /absolute/path/apex-accepted-placement-exports.zip \
  --expected-source-sha256 d2700b5d31a78da61d5fbf7f94c5e62cae9d677cdd40f69a3eb08bc954c67d7a \
  --expected-source-bytes 119254 \
  --expected-case examples/apex-accepted-package-receiving/original-case.json \
  --workspace /absolute/path/apex-received-workspace \
  --output /absolute/path/apex-receiving-operation \
  --operation-id APEX-ACCEPTED-PACKAGE-RECEIVING-20261013-F11 \
  --actor "F11 original Apex receiving" \
  --source-ref https://tokenjunkielabs.slack.com/archives/C0BTTA66TK3/p1791774555464879 \
  --origin-workspace-id workspace-64a7a33c16294ea490bc1a630753c9b3 \
  --require-original-export-bytes
~~~

The full run performs native preview → receiving → same-operation replay → complete original-document/member/accepted-export readback → native backup → restore → exact reopened comparisons. It retains the original requests and first responses before progressing. Run the same command after interruption; the native saved operations and source inputs are reused.

The final output includes:

- **RECEIVING-SELECTION.json**, the actual receiving workspace identity and original scenario/document selections.
- **RESULT.json**, the complete native results, exact source/export identities and reopened comparisons.
- **received-workspace-backup.zip**, the native portable case with original source bytes, documents, reviews and local receiving history.
- **source/**, the complete unchanged original input.
- **requests/** and **responses/**, the exact original native mutations and explicit replay.
- **receiving-readback/** and **restored-readback/**, complete original documents, individual original members and all six current accepted exports.

To open the received case:

~~~bash
python3 -B cli.py --workspace /absolute/path/apex-received-workspace serve --host 127.0.0.1 --port 0
~~~

Use **Classification → Receive accepted package → Received packages** to reopen the native receipt. Its original-document links use the preserved IDs. The same original classification views provide all source rows, accepted exports, explicit new drafts and subsequent reviews.

To open its saved backup elsewhere:

~~~bash
python3 -B cli.py --workspace /absolute/path/reopened-apex restore \
  --package /absolute/path/received-workspace-backup.zip
python3 -B cli.py --workspace /absolute/path/reopened-apex serve --host 127.0.0.1 --port 0
~~~

The original FSU→Apex browser operator owns the subsequent UI continuation. It selects the actual receiving workspace from RECEIVING-SELECTION.json, preserving the original scenario IDs. This receiving helper creates no browser or duplicate scenario calculation.
