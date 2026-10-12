# Census ACS: original native receiving operation

This execution branch carries the complete two-release operation
`CENSUS-ACS-NATIVE-4BF5-20261011`. Application source is
`685b78f39901fe0afd2fa2f477481984466ad555` in
`woahwhattheheck/public-commons-sprint-2026`. Product modules retain those
original bytes; this directory supplies the operator journey and input paths.

## Run on the selected Linux host

Use the selected serial worker and its maintained Node/Python/native package
installation. The original publisher requires Node's `node:sqlite` API;
Node 24.20.0 and Python 3.12.3 fit the source requirements. Reuse the existing
SF30/SF31/SF88 dependency closure for the following HUD operation after this
process closes its listeners.

Place the original input files together and copy `inputs.example.json`
alongside them as `inputs.json`. Filenames resolve against that file. Preserve
each Jam workbook's original basename, which becomes its annotation member.

Set the actual retained paths:

```bash
CENSUS_SOURCE=/absolute/public-commons-sprint-2026
CENSUS_HANDOFF=/absolute/public-commons-sprint-2026/operations/census-acs-native-20261011-4bf5
CENSUS_INPUTS=/absolute/census-inputs/inputs.json
CENSUS_RUN=/absolute/private-work/census-native-4bf5
PEORIA_SOURCE=/absolute/original-peoria-application
```

Use a checkout at the merged application source above. With a full Git checkout, the runner checks all tracked `stellar/scf-starforge-20261009` and `stellar-forge` files against that pin. The handoff branch carries the operation separately from the application checkout.

A retained source closure may instead pass `--source-index /absolute/source-index-685b.json`. The runner binds the exact index SHA256 `03732b374ae6dbccfdc170090f89663f1c91dcc5bab98d91f229fd2616eaec4f`, all386 paths and their4,438,571 source bytes to the merged commit; every regular file is matched to its original Git blob. Both routes use the same original application, inputs and journey. The optional index digest is part of the retained run binding.

This is an explicit update from the pre-merge application pin to the complete merged Census application. It keeps the same operation ID, captured data, original publisher/acquisition/receiving engines and original Peoria assembler.

Use the same absolute run path for a continuation:

```bash
umask 077
/usr/bin/flock -n "${CENSUS_RUN}.lock" \
  /usr/bin/node --max-old-space-size=128 \
  "${CENSUS_HANDOFF}/native-journey.mjs" \
  --checkout "${CENSUS_SOURCE}" \
  --inputs "${CENSUS_INPUTS}" \
  --run "${CENSUS_RUN}" \
  --python /usr/bin/python3 \
  --peoria-source "${PEORIA_SOURCE}"
```

The private work parent must exist. The runner creates its private run directory,
reports actual host/PID/runtime and phases as JSON lines, and retains native
publisher, version-store, acquisition and delivery files there. Child Node
processes inherit the same 128 MiB JavaScript heap setting. Admit this as one
serial operation through the receiving host's existing capacity controller.

The selected original Peoria application contains `acs.py`, Git blob
`57e4436d117d44b169a4d0bf46123c33e8f87cde`, with its original sibling modules.
The consumer imports that application in place. Private application source
stays in its current delivery surface.

## Original inputs

| Input | Bytes | SHA256 |
| --- | ---: | --- |
| 2023 public ZIP | 110375 | d41ab05d13a7e11e4e62a25ec33d9847dc8d9f22e0f50913006726f6ab988fd7 |
| 2024 public ZIP | 127283 | 18b31bd329276cbf1e3288d49d023ae45fe99c8d05880570748d86a3f53b62d7 |
| 2023 original native package | 814755 | 23115cea68ed5d0e8250b717f8c9789713f9a8b39288b670451eb69fd1cb65e0 |
| 2024 original native package | 807544 | 0d06d7db2d45c0003424515f00e8017a54428194c29d95f41ef8d509b2cff054 |
| 2023 Jam workbook | 13138 | c884b6c56f0951b8fbc28217b00577fbc22e2372dc375686d024e507c4e8d807 |
| 2024 Jam workbook | 13432 | 14a61938cff58166ef265af9a324b8a6f4cf6040f8630634e5711cb5b07e2cf5 |

Each workbook requires its adjacent original HTTP capture JSON. Import checks
the URL, HTTP status, byte count and workbook hash; the captured-manifest digest
also binds the exact receipt bytes.

The runner uses original `capture.py import` with each public archive,
unchanged native package and year-specific annotation. The completed original
imports produced these identities:

| Release | Capture ID | Files | Tables | Geographies |
| --- | --- | ---: | ---: | ---: |
| 2023 | 830ca9e4a8c2f386d66b1be4ef2b4877ff2e6a1b6f1bd72b9b0db79dd25c3598 | 65 | 26 | 17 |
| 2024 | fd511a0887a4be43cfa5265beb48224ff68f995cda3e1dcc1d3c9cc12cf19fd6 | 66 | 26 | 17 |

## Connected operation

2023 initializes one original publisher and version store. The original seller
exposes live offer and snapshot metadata, from which the runner prepares the
original SF88 configuration.

Acquisition uses the original SF88 trusted-host `executePage` seam, original
X402 buyer, streaming response writer, SF82 evidence and version-store HTTP
handler. This HTTP source returns native `NO_PAYMENT_REQUIRED`; the seller's
offer/control surface runs in original `CHALLENGE_ONLY` mode.

After 2023's first completed native page, the operation switches the fixed
source pointer and publishes 2024 through the same publisher. It finishes 2023
with its previously selected snapshot, then acquires the complete 2024 snapshot.
Completed sessions reopen without another HTTP exchange. Recovery retains the
last orchestration result under an adjacent name and reconstructs the session
from original response and evidence files.

The Python companion opens the actual `DatasetAcquisition` sessions, delivers
through original SF100, and passes verified `jsonl_rows()` to the Census
consumer. That consumer reconstructs every chunk and complete manifest member,
including exact native package and workbook receipts. Original
`acs.assemble_bundle` consumes both releases, followed by reopening both
completed deliveries.

Every page belongs to the original SF88 session. `journey-state.json` records
only the operator journey's selected IDs and continuation phase.

## Completed observation reference

The original observation projection already ran against these exact captures:

| Measure | 2023 | 2024 |
| --- | ---: | ---: |
| Observation rows | 5627 | 5627 |
| Reported estimates | 5626 | 5625 |
| Open-interval estimates | 1 | 1 |
| Insufficient-sample estimates | 0 | 1 |
| Reported margins of error | 5588 | 5587 |
| Controlled margins of error | 38 | 38 |
| Open-interval margins of error | 1 | 1 |
| Insufficient-sample margins of error | 0 | 1 |

Both retain `B25035_001` for `1600000US1779007` as raw estimate `1938`
and raw margin token `-333333333`; the release-specific `Jam Values!D35`
mapping resolves `lte 1939`. Controlled margins retain raw `-555555555`
with a nullable numeric margin.

## Result and continuation

Successful execution writes `journey-result.json`: source identities, original
snapshots, page/row counts, completed recovery, consumer summaries and original
assembler output paths/hashes. Keep the run directory and native files. Phase
JSON lines provide actual first-process and progress information to the existing
receiving thread.

Continue with the same command after an ordinary interruption. For an uncertain
native attempt, use its existing session's original recovery path. If source
validation or application execution fails, preserve the actual phase, error
and files so the owner can repair that issue within the same operation.
