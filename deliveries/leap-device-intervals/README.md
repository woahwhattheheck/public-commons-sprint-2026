# Leap DEVICE interval application source

Source: `2bc8b3abfae586bbe43aaa471c5194fe764032f5` in [woahwhattheheck/public-commons-sprint-2026](https://github.com/woahwhattheheck/public-commons-sprint-2026/tree/2bc8b3abfae586bbe43aaa471c5194fe764032f5).
Operation: `LEAP-DEVICE-INTERVAL-DELIVERY-20261012`.

This package contains all 88 declared application/receiving source files, their source declaration, the original project license and the complete authored receiving input. It preserves the original Utility, NDJSON and XML Python dependency closure and the Green Button source license.

## Operate the source application

On Linux, use Python 3.11 or later with Expat 2.6 or later. From the extracted package root:

```sh
python3 stellar/scf-starforge-20261009/sf30-seller-sdk/leap-intervals/cli.py --workspace /private/leap-workspace init
python3 stellar/scf-starforge-20261009/sf30-seller-sdk/leap-intervals/cli.py --workspace /private/leap-workspace serve --connection-file /private/leap-connection.json
```

Open the authenticated local application URL returned by the owner. Keep its connection file private. The complete [operator guide](stellar/scf-starforge-20261009/sf30-seller-sdk/leap-intervals/README.md) covers intake, mappings, batch review, complete corrections, original job reconciliation, missing windows, exports and restore.

## Generate the original receiving input at the chosen host path

```sh
node operations/scf-leap-interval-receiving-20261012/generate-functional-input.mjs /private/leap-functional-input
```

The input directory is outside the extracted source. The generator writes the complete original CSVs, evidence, receiving configuration and manifest. It verifies existing identical files and preserves different files.

The included `receiving-input/` directory records the complete portfolio for the canonical `/private/leap-functional-input` location. The generator is the supported way to materialize it at the actual receiving host's directory; this rebinds input paths without changing any original CSV or evidence bytes.

The portfolio covers 8 devices × 4 days × 96 quarter-hours: 3,072 distinct intervals and 9,216 channel rows. Its original invalid edition has 9,217 rows and two deliberate issues; its complete correction retains all 9,216 rows. A separate historical CSV preserves the literal published 2024 example. The evidence identifies the provenance and authored functional assumptions.

## Complete installed Utility → Leap operation

Use the complete repository checkout at the source commit above for the original Starforge distribution build. This source delivery contains the product, original application dependencies, distribution selections and receiving programs. The original full distribution builder/installer and its selected dependency graph are obtained from that complete repository checkout.

Follow [the whole-operation guide](operations/scf-leap-interval-receiving-20261012/README.md). It performs the selected build/install, original Utility customer receiving, Leap browser actions, CLI export, separate cold restore and desktop/mobile reopen. The actual selected source commit and native outcomes belong to the resulting operation report.

The original Utility report is retained under its known file identity in the receiving guide. Native reconstruction consumes the same two original published XML files and eighteen UtilityAPI example resources, all included in the declared source.

## Contents and verification

`SOURCE_PACKAGE.json` binds every other member by complete UTF-8 byte length and SHA-256. The original application declaration additionally records Git blob identities. The ordinary ZIP preserves the full original bytes and file permissions. The delivery record beside the archive retains the archive's exact size, SHA-256 and immutable source commit.

The four-document workshare and original case receiver are in [Commons PR 34985](https://github.com/woahwhattheheck/commons/pull/34985). Its implementation scope is one Leap partner account, two agreed source variants and a 15-business-day delivery.

