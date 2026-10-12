# Complete registered-protocol source kit

This kit materializes the exact source selected by the merged NCT03529110 protocol receiver. It contains all **292 files / 3,745,352 source bytes**: the original 283-file Research engine, its three original Developer Portal assets, and the six protocol files merged in PR 2319.

DBC61 retains the existing study-extraction and protocol receiving operation. This kit prepares its source directory. The original protocol CLI, Research APIs and package helper perform capture, dossier receiving, exports and customer reopening.

## Exact source selection

| Component | Immutable source |
|---|---|
| Original 283-file engine | Citation envelope at commit `3f9251671b6816fa4af94699f39d5c70fafe4277`, Git blob `03888169824bcffb2422f51622fcf6d7d4379f4a`; 3,670,230 envelope bytes / SHA-256 `4b15d21cf32ba2a0f082209c828f2ba4beca19e98ceb2f8af1eeea7c15268caa` |
| Three original Developer Portal assets | Addition packet at merge `42c9d8bba273a117a53d3baf3a7d2e11341f41d8`; 46,410 packet bytes / SHA-256 `f1890ee59c679d9322dc5e2edaf97eda606c34c7c1921a797215395b5d02e45e` |
| Six protocol files | Merge `e27d1f15fe16c115ca5f4531d2f96bae1133021d` (PR 2319), 186,694 source bytes |
| Full original engine cohort | The receiver's embedded `ORIGINAL_ENGINE_COHORT`: 286 files / 3,558,658 bytes |

Every original engine row and body is preserved. The six protocol paths are additive. The envelope records the original source base, citation release, asset repair and final protocol release separately. Evolving repository-main files do not replace these selected bodies.

The four kit files are:

- `source-envelope.json`: every complete UTF-8 source body plus its original Git blob, SHA-256, byte length and mode.
- `source-selection.json`: the full 292-file identity map, source lineage and native programme paths, without duplicating file content.
- `materialize-source.py`: the original Research materializer adapted to this protocol selection.
- `READY.md`: these receiving instructions.

### Transfer identities

| File | Bytes | SHA-256 |
|---|---:|---|
| `source-envelope.json` | 3926309 | `3efc44471b884026b38c203920531cee25c8877720e63d0316dd095f6c0d94dc` |
| `materialize-source.py` | 7659 | `81d888a1a5e61215a311a06dd5d205c6ef0e179df4f171938040565eeccc87a6` |
| `source-selection.json` | 102568 | `5b06b2310413e08b866f7ed9b2eb37364809d8665b3502708673e0bc9d516a32` |

Preserve the exact UTF-8 bytes, including each file's final line feed. The complete source envelope is under 4 MiB. An existing exact-byte file transfer can carry it as one file or verified parts; rendered prose is not the source carrier.

## Materialize the full source

Use the existing equipped Linux worker and a separate private source directory for this selection. The materializer requires Python 3.11 or newer and the standard library. Its command accepts absolute paths:

```sh
KIT_DIR=/absolute/received/396c-study-protocol-native
PROTOCOL_PROJECT=/absolute/private/study-protocol-source

python3 -B "$KIT_DIR/materialize-source.py" \
  --source-envelope "$KIT_DIR/source-envelope.json" \
  --directory "$PROTOCOL_PROJECT"
```

The materializer first verifies the complete envelope byte length and SHA-256. It then validates all 292 original file lengths, SHA-256 values, Git blob identities, unique canonical paths and selected modes before writing any source body.

Files are received through ordinary-directory checks and same-directory private candidates, fsynced, then published with an exclusive link. A matching existing file is reused; a different file or symbolic link is rejected. This is the unchanged original Research receiving mechanism.

The successful stdout record has state `COMPLETE`, sourceFiles `292`, sourceBytes `3745352`, the selected release and the original envelope SHA. The directory also contains `.study-protocol-source-materialization.json`, including the full source inventory and lineage. The original protocol receiver independently verifies its 286-file engine and adds the same six programme rows to the customer delivery's `ENGINE_SOURCE.json`.

If transfer or materialization stops, retain the original envelope and directory. Repeating the exact materializer command verifies and reuses the same completed files and manifest. Preserve a mismatch for reconciliation; select the intended exact source before continuing.

## Continue the original protocol operation

The actual product requires the existing selected Node 24 runtime and its original Research prerequisites. A fresh PDF capture also uses the existing Poppler `pdfinfo` and `pdftotext` executables. Reusing a complete capture uses the original capture inspector and retained bytes.

The source materializer does not install dependencies, start a Research listener, create a workspace/dossier/question, or run a provider request. Use DBC61's actual current connection, IDs, base revision, operation and output directories.

The selected programme directory is:

```sh
PROTOCOL_PROGRAMME="$PROTOCOL_PROJECT/stellar/scf-starforge-20261009/sf88-operator-buyer-cli/research-dossiers"
```

For a retained complete capture, inspect it and continue the same receiving selection:

```sh
node "$PROTOCOL_PROGRAMME/study-protocol-cli.mjs" inspect-capture \
  --directory "$PROTOCOL_CAPTURE"

node "$PROTOCOL_PROGRAMME/study-protocol-cli.mjs" receive \
  --capture "$PROTOCOL_CAPTURE" \
  --directory "$PROTOCOL_RECEIVING" \
  --connection "$PROTOCOL_CONNECTION" \
  --workspace-id "$PROTOCOL_WORKSPACE_ID" \
  --dossier "$PROTOCOL_DOSSIER_ID" \
  --question "$PROTOCOL_QUESTION_ID" \
  --base-revision "$PROTOCOL_BASE_REVISION" \
  --operation "$PROTOCOL_OPERATION"
```

Each `PROTOCOL_*` value above comes from that existing operation. In particular, preserve the original receiving directory and immutable selection after a lost response or interruption. The original API owns revision checks and exact-request recovery.

If the original owner has not captured the registered PDF, the same CLI also supports:

```sh
node "$PROTOCOL_PROGRAMME/study-protocol-cli.mjs" run \
  --study-file "$PROTOCOL_ORIGINAL_REGISTRY" \
  --directory "$PROTOCOL_OPERATION_DIRECTORY" \
  --connection "$PROTOCOL_CONNECTION" \
  --workspace-id "$PROTOCOL_WORKSPACE_ID" \
  --dossier "$PROTOCOL_DOSSIER_ID" \
  --question "$PROTOCOL_QUESTION_ID" \
  --base-revision "$PROTOCOL_BASE_REVISION" \
  --operation "$PROTOCOL_OPERATION"
```

The original registry input is `NCT03529110_Original_Registry_Study.json`, 99,951 bytes / SHA-256 `1e8f401843a30673b2d653ceb2682ad8f6d038af268a185c3333028d339d14c1`. It is supplied by the existing caller and verified by the original source module. The public source kit does not contain connection files, tokens, a replacement registry response, or a customer workspace.

The registry document-type label is “Study Protocol and Statistical Analysis Plan.” The selected PDF itself is protocol DS8201-A-U302, version 6.0, 25 September 2020; its methods section refers further rules to the SAP. The original capture and reviewed methods map preserve that distinction.

## Package and receive the completed customer delivery

After the original receiving operation completes, verify its output and use the unchanged merged package helper:

```sh
node "$PROTOCOL_PROGRAMME/study-protocol-cli.mjs" inspect-receiving \
  --directory "$PROTOCOL_RECEIVING"

python3 -B "$PROTOCOL_PROGRAMME/package-study-protocol.py" package \
  --directory "$PROTOCOL_RECEIVING" \
  --out "$PROTOCOL_DELIVERY_ARCHIVE"

python3 -B "$PROTOCOL_PROGRAMME/package-study-protocol.py" inspect \
  --archive "$PROTOCOL_DELIVERY_ARCHIVE"
```

The archive includes the full original capture, actual receiving receipts, original dossier portable and revision reports, and all 292 selected source files. The package helper verifies and reuses an existing identical final archive before allocating a new candidate.

On the receiving host, use the exact archive SHA returned by the original package result:

```sh
python3 -B "$PROTOCOL_PROGRAMME/package-study-protocol.py" receive \
  --archive "$PROTOCOL_DELIVERY_ARCHIVE" \
  --expected-sha256 "$PROTOCOL_DELIVERY_SHA256" \
  --directory "$PROTOCOL_FRESH_DELIVERY"
```

This last command materializes the verified delivery. Its `OPEN_FIRST.md` and complete `receiving/programme-source/STUDY-PROTOCOL-RECEIVING.md` provide the original Research server/store and dossier-reopening commands. Native customer reopening remains a distinct result produced by those original APIs.

The source release, materialized source, completed native receiving, archive publication and fresh customer reopen are separate outcomes. Keep each actual receipt in DBC61's same operation and carry the resulting complete archive through its already selected private handover destination.

## Source verification

All 292 bodies in this kit have been compared with the original source identities and the six merged protocol postimages. The 286 engine descriptors match the receiver's embedded selection. The materializer's original ordinary-file and atomic-publication functions are unchanged; its selected envelope constants, programme validation and manifest identity are adapted for this complete protocol kit. Customer execution is performed by the existing native caller.
