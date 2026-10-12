# Receive the complete Eurostat economic workspace

This package installs the original Eurostat analyst, merchant and customer application together with its selected native seller, buyer, accounting and delivery source. The receiving command then runs the retained source → review → economic briefing → dataset publication → configured merchant → native customer purchase → complete export → saved delivery reopening operation.

**Operation:** SCF-EUROSTAT-ECONOMIC-WORKSPACE-20261012  
**Original application source:** [5bd4acb39c2012d0cf64c7efc93572416e0224a6](https://github.com/woahwhattheheck/public-commons-sprint-2026/tree/5bd4acb39c2012d0cf64c7efc93572416e0224a6/stellar/scf-starforge-20261009/sf30-seller-sdk/eurostat)  
**Original receiving owner:** FD06, continuing on the existing funded 39DA host after its current FRED operation.  
**Product thread:** https://tokenjunkielabs.slack.com/archives/C0BTB4SUCP9/p1791794802593569  
**Accepted native queue:** https://tokenjunkielabs.slack.com/archives/C0C1F274SGH/p1791799671262889

## Complete source

| Artifact | Bytes | SHA256 |
| --- | ---: | --- |
| source-packet.json | 4318978 | c204ce907dcdd12b563f3d030388b156343c2d5f01cf8852dbc0cdd2cb4b4388 |
| receive-source.py | 16934 | 0ad3e010e24b30ffab2bb6745cd8df501cbdb308e7ff57209280224fd5e53305 |

The packet contains **212 complete original files / 3,082,631 decoded bytes**. Every entry retains the original repository path, Git blob SHA, SHA256, Git mode and base64-encoded complete body. All selected original static, dynamic, named native-runtime and Python dependencies are included. The packet also retains its explicit application roots, dependency graph, original provider branch selection and external package requirements.

The original files include all 33 Eurostat application and distribution files, its complete source fixtures and generated analyst reports, the selected original SF82 dataset merchant, SF88 native buyer, SF36 governor, SF62 approvals, SF100 delivery, source publisher and retained licenses. Component bytes are taken from the single source commit above. The broader repository's other optional provider commands keep their own original imports; this packet selects the Eurostat dataset operation.

## One-command installation and native receiving

Use Linux, Python 3.9 or later and the existing operator's Node 24 native runtime. Save source-packet.json and receive-source.py in the operator's retained transfer directory. The published packet SHA256 is required.

The following source directory is dedicated to Eurostat. The original node_modules path is the equipped 39DA runtime already used by FD06:

~~~sh
python3 receive-source.py \
  --bundle source-packet.json \
  --sha256 c204ce907dcdd12b563f3d030388b156343c2d5f01cf8852dbc0cdd2cb4b4388 \
  --directory /dev/shm/fd06-eurostat-receiving-source \
  --node-modules /dev/shm/routescan-native-runtime-39da/node_modules \
  --project /dev/shm/fd06-eurostat-native-receiving/project \
  --config /dev/shm/fd06-eurostat-native-receiving/receiving.json
~~~

The project and config paths in this command are the new Eurostat operation's selected private locations. The accepting operator writes its original receiving configuration there using the complete retained [receiving template](../../stellar/scf-starforge-20261009/sf30-seller-sdk/eurostat/examples/receiving-template.json) and [native receiving contract](../../stellar/scf-starforge-20261009/sf30-seller-sdk/eurostat/RECEIVING.md).

The configuration uses the existing actual funded buyer profile, signer references, original accounting workspace, HTTPS merchant ingress, facilitator, payment asset and explicit acquisition caps. For the retained 576-row edition, pageSize 300 and maxPages 2 select two complete native customer pages. Its source.file is:

~~~text
/dev/shm/fd06-eurostat-receiving-source/stellar/scf-starforge-20261009/sf30-seller-sdk/eurostat/sources/une_rt_m-2024-2025.original.json
~~~

Source URL, actual acquisition time, transport and the complete reuse review are already retained in examples/original-acquisition.json and examples/reviewed-query.json. The receiving template's operator-specific placeholders need the accepting host's actual values. The original FRED operation retains its own four intents and current allowance continuation.

To materialize source first, omit the paired --project and --config arguments. The same command can later supply them and reuse every matching source file. An explicit --node selects a different installed path for the original Node executable.

## Materialization and continuation behavior

Before writing source, the installer verifies the complete packet SHA256, repository, source commit, operation, entrypoint, all relative paths, unique file identities, decoded sizes, Git blob hashes, SHA256 values, explicit roots and original observation response. It inspects existing source files before materializing the first missing one.

Missing original files are written through complete temporary files and linked into place without replacing an existing file. Existing matching files are retained. An existing file with different bytes is named in the error so the operator can reconcile that actual source target. Source paths and in-tree directory parents must be real local paths. The original explicit node_modules directory is linked once and retained in the source installation manifest.

The private source root contains .eurostat-source-installation.json with the complete original source inventory and actual runtime binding. A local lock serializes source installation. These files belong to the source transfer; the original application independently retains its project, native session, release and accounting state.

After successful installation the script prints a MATERIALIZED result, then replaces itself with exactly:

~~~sh
node SOURCE_ROOT/stellar/scf-starforge-20261009/sf30-seller-sdk/eurostat/cli.mjs \
  receive --workspace ORIGINAL_EUROSTAT_PROJECT --input ORIGINAL_PRIVATE_CONFIG
~~~

There is one native launch per invocation. The original receiver's checkpoint at PROJECT/receivers/ID/receiver.json controls continuation, retains the exact source/config/buyer binding, and adopts its original extraction, release, native dataset session, finalization and delivery. If the process stops, continue the same source command and configuration. The publisher can recover its complete retained candidate through the original run UUID.

The selected merchant and buyer load the maintained native SDK 2.28.0 and Stellar SDK from the explicitly supplied equipped runtime. Existing external import references are recorded in packet.runtime.import_specifiers. The original lazy PostgreSQL driver imports are outside the selected Eurostat driver. Source materialization uses Python's standard library.

## Retained actual analyst product

The included official JSON-stat response has **576 observations across 24 monthly series**, with 24 months from January 2024 through December 2025. It preserves the exact returned category order, all original labels, unit and seasonal basis, original metadata and value spelling. The capture covers Germany, Spain, France and Italy; total and under-25 ages; and total, male and female sex categories.

| Original artifact | Bytes | SHA256 |
| --- | ---: | --- |
| Original API response | 10,408 | 689d5a0a94c358459f5321fd6a2f8c1da8c089f46ae032b27590c6d895ea56cf |
| Complete briefing HTML | 107,672 | ef7176b7223b3674d6f88e4f0e96dc8675e6514cf2c78fc9a566cb5b3fff9a4d |
| Structured briefing JSON | 415,668 | a1da7cf47d9a42a9d4de0ca7d26835a24ef5880691921235d3a430ab70407eab |
| Exact observations CSV | 160,202 | e4a0326aa171efbfe919b1633ee9d5842cebd4fd455a3407a8bddd0a898613f2 |

The complete report is available under sf30-seller-sdk/eurostat/examples/briefing-20261012/. Its original acquisition and source-specific review accompany the raw response. The application also retains the actual empty-age and latest-period API responses, allowing the user to inspect the source's empty and missing-period behavior.

## Actual native receiving outcome

The application's COMPLETE state requires the original publisher's dataset, original native customer session, full accounting finalization, complete SF100 export, exact comparison of every delivered observation and reopening of the same saved delivery. The customer handover includes the exact original response, retained capture, full source review and economic briefing beside the customer dataset.

Record the actual checkpoint path, native session identity, accounting completion, delivery directory and reopened snapshot in the existing receiving thread. Reopen the same project in the existing Applications surface or with the original eurostat serve command for its analyst and publisher interface. The browser session uses that same retained project and actual completed customer state.

## Source retrieval

The packet is a complete 4.3 MB UTF-8 JSON artifact. An equipped native host can download its immutable raw GitHub URL at this carrier's source commit. GitHub's Git blob endpoint also returns the complete body; some content convenience endpoints return an empty content field for files larger than 1 MiB. Use the published whole-file SHA256 after any transfer.

The packet Git blob is **3e9a2f9eb692af53fdd5272ab2b99e63a1d54144**. The receiving script Git blob is **5fc9d6192a49c8387e7cd8ae7616eeae58b8de9f**. Both complete bodies and the original source identities are retained in this directory for direct receiving.
