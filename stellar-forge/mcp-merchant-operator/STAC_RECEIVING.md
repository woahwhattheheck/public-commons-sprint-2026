# Receive the retained Austin and Cirrus case through the original client

The executable [customer journey](examples/stac-client-retained-receiving.mjs) runs the
existing Node client, command implementation and merchant MCP adapter against the
original STAC imagery and processing hosts. It uses the complete retained Austin
and Cirrus handover. It does not generate a replacement catalog or processing run.

## Select the complete input and source

The required input is the original gzip processing handover:

| Field | Original value |
| --- | --- |
| Bytes | 148607 |
| SHA256 | `453026898def5ff1ef7de0fbb0546ecb4c95af6b3b040f5f16c5c08cac0eeed0` |
| Imagery edition | `edition-0716a54ee55d41d49d368b36` |
| Processing run edition | `processing-edition-3da24759c3314821afe17256` |
| Selected asset bytes | 29731 |
| Selected asset SHA256 | `3838006f6aa188a3e52eaa58bbb58de3d1f4c65fad201d50bea495e86f3905b7` |

The original case is retained as `STAC_Cirrus_Receiving_Case_20261012.zip`
(157152 bytes) in the [original STAC handoff](https://tokenjunkielabs.slack.com/archives/C0BTB4SUCP9/p1791761556094779).
Select its complete original processing handover using the byte count and digest
above. The containing ZIP is a different file. The same envelope is already present
in the original B710 receiving workspace as `cirrus-native.processing.json.gz`.

Select an existing equipped source or installed source tree. `SOURCE_ROOT`
contains `stellar-forge/mcp-merchant-operator/`. `NATIVE_ROOT` contains both
`sf30-seller-sdk/` and `sf88-operator-buyer-cli/`, with their original dependencies.
In a complete source tree, the latter is normally
`SOURCE_ROOT/stellar/scf-starforge-20261009`. Use the original source manifest's
actual commit for `SOURCE_COMMIT`.

The original client is released in PR1749 / `cfd773e8636464df57b42d0d25ceb8d7618fafb8`.
The native imagery importer includes PR1807 /
`3a82a92aa7ee12c397606b979097b5f2655819e2`, whose workspace blob is
`9667097fbc4053676100dfc52fa059e0d6790a74`. This preserves immutable edition
comparison when a received edition is forwarded again with local provenance.
Compatible current descendants retain these original interfaces. The separate
Prescient client extension and managed Applications receiving keep their existing
source and operation ownership.

## Run the original receiving operation

Use the existing Node runtime and a private output directory. In the Commons fleet,
run this command through the maintained native admission/lifetime entry for the
original receiving operation. Keep its original request and controller record on
continuation.

```sh
node "$SOURCE_ROOT/stellar-forge/mcp-merchant-operator/examples/stac-client-retained-receiving.mjs" \
  "$RECEIVING_DIRECTORY" \
  "$SOURCE_ROOT" \
  "$NATIVE_ROOT" \
  "$SOURCE_COMMIT" \
  "$ORIGINAL_PROCESSING_GZIP"
```

The output, source and native roots are explicit paths. The input path must select
the exact original gzip above. The executable verifies its complete bytes before
the first import.

For the already-retained older B710 native closure, the final optional argument
can select the exact merged PR1807 `workspace.mjs`. This is the original module,
with its unchanged relative dependencies available beside it; the executable
requires its full Git blob identity before loading it. The maintained C79F placement
uses that single explicit source override and retains the rest of B710's runtime
unchanged. A current native source containing the correction needs no override.

The prepared complete-process declaration for the existing C79F command is
192 MiB, with 256 MiB reserve, and 16 MiB of new receiving output, with 64 MiB disk
reserve. These are declarations; the actual run writes its observed peak to
`maxRssKiB`. An equipped receiving owner should account for the same command and
its selected runtime through the existing admission interface.

## Complete customer path

The command emits and atomically retains ten completed stages:

1. Inspect and import the exact complete processing handover through the existing CLI.
2. Read all 15 original scenes across the retained four-page edition and compare the edition.
3. Read the original two processing editions, four run records, statistics, associations and full source file.
4. Save the original thumbnail through streaming, reconstruct it through native ranges, reject overwrite and retain its native asset review.
5. Save the reviewed local query and analyst decision, then reject the stale revision of that decision.
6. Export the complete original JSON, CSV and HTML reports and chunked imagery handover.
7. Import the imagery into the second native host, preserve the analyst decision and reuse the identical handover receipt.
8. Export all original processing editions and receive that complete package into the second host.
9. Use the original retained processing cancellation control.
10. Restart the first host, preserve workspace identity, rotate its private connection, recover the original durable operation, reject another workspace and exercise the pending-read wait deadline.

The underlying source capture remains the original case. The receiving transport
refuses fresh provider capture, and the completed result records the observed
provider request count. The original Cirrus page coverage and statistics remain
unchanged; receiving those records does not turn a filled page or a missing native
cursor into complete provider coverage. Imagery and processing associations retain
their actual original dates.

## Preserve and continue the same output

`progress.json` records each completed stage and the original operation selection.
`result.json` is written when the complete journey finishes. Failure records retain
the actual error in `progress.json`; the command drains its own hosts and clients
in `finally`. The directory also contains the native customer and second receiving
workspaces, original input, reports, full handovers and received thumbnail.

Preserve this directory and the original native controller record after interruption.
The run uses stable native processing operation IDs and reopens its saved workspaces.
After the original controller has ended, continue that same operation with the same
input, source selection and output directory. It reuses native imports/exports and
the retained analyst decision checkpoint. It never replaces the output with a new
case merely to repeat completed steps.

The `*-serve.json` and `connection.json` files are private connection material.
Keep them in the original private directory. Share the complete selected customer
exports, reports and actual result through the existing handover, with their hashes.

## Retained cloud continuation

The complete original C79F native continuation is published in
[its existing-operation handoff](../../operations/scf-stac-client-native-receiving-20261012/README.md).
It includes the original lifecycle read, exact source inputs, maintained placement,
same customer command and full result preservation. An equipped session can consume
that saved operation without reconstructing its source or creating another receiving
identity. The source/native/output arguments above remain the ordinary customer entry.
