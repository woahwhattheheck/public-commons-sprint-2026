# Installed Census workbook customer

This packet runs the original installed merchant workspace, native workbook parser, saved buyer, dataset receiving and Python Analysis APIs, then opens that same acquisition with the released Rust buyer CLI. The two inputs are the original Census ACS special-value reference workbooks. The runner reads retained input files or downloads the exact original public bytes and verifies their pinned size and SHA-256 before use.

## Selected product

- Cumulative source: e28755f20dd4f9cb932d82fb59feb48424e327e7.
- Maintained writer upgrade: d723d8709de2495b865fa2073f5e7ff844cac262 (PR1477), applied to an owned installation as the two explicit postimages below.
- Original package manifest SHA-256: 267cd1292c8e542e8a70134c814bba7d624d2b375191a8892fb269f226bf4ff7.
- Original source TGZ: 7,245,436 bytes; SHA-256 0da9dea0db031b5ecc442e10f5b73134034d872224e6b98f2fd5fa78cb778568.
- Rust SDK: merged 712ae7f7d9fac5d2e3d3c239ac9dedf28d2d0f62, included as eleven exact source files in that installation.
- Public Rust Linux kit: starforge-rust-linux-x86_64-712ae7f7.tgz, 852,391 bytes; SHA-256 dae8c45ae127214971067772c9c23835e4f2689ef2670b870cc3f98832470203.
- CLI binary SHA-256: d895ec3cf3dc8056d74f8a3b15a91d1f5ecd3940db1cd0012b0fc5234669b7b9.

The selected SDK uses the original Node buyer engine. Its Linux executable requires x86_64 and glibc 2.34 or newer. Reuse an equipped environment with Node 24, Python 3.11 or newer, Playwright and Chromium. The original Python Analysis SDK has no required third-party dependencies; the workbook parser uses Python standard-library OOXML handling.

## Original inputs

| File | Bytes | SHA-256 | Original source |
| --- | ---: | --- | --- |
| 2023_Jam_Values.xlsx | 13,138 | c884b6c56f0951b8fbc28217b00577fbc22e2372dc375686d024e507c4e8d807 | https://www2.census.gov/programs-surveys/acs/tech_docs/jam_values/2023_Jam_Values.xlsx |
| 2024_Jam_Values.xlsx | 13,432 | 14a61938cff58166ef265af9a324b8a6f4cf6040f8630634e5711cb5b07e2cf5 | https://www2.census.gov/programs-surveys/acs/tech_docs/jam_values/2024_Jam_Values.xlsx |

The mapping selects the native `Jam Values!A20:G36` table by worksheet coordinates. It retains the actual numeric zero values, source cell types and the original trailing whitespace. This Census table describes special-value conventions. Its sixteen reference rows remain attached to their original source coordinates and bytes.

## Run on the existing installed product

Use an owned installation for this customer run. Preserve its original e287 package manifest and apply these two maintained public postimages before executing:

| Original installed path, below `source/stellar/scf-starforge-20261009/sf30-seller-sdk/dataset-refresh/` | Exact Git blob | Published source |
| --- | --- | --- |
| versions.mjs | 079e4f8eca9819b7cd916579e34f703664ef4346 | https://raw.githubusercontent.com/woahwhattheheck/public-commons-sprint-2026/d723d8709de2495b865fa2073f5e7ff844cac262/stellar/scf-starforge-20261009/sf30-seller-sdk/dataset-refresh/versions.mjs |
| writer-lease.mjs | b0d0207910ffc77e6b8bd0a8c5558c52c5c8dbea | https://raw.githubusercontent.com/woahwhattheheck/public-commons-sprint-2026/d723d8709de2495b865fa2073f5e7ff844cac262/stellar/scf-starforge-20261009/sf30-seller-sdk/dataset-refresh/writer-lease.mjs |

The maintained Linux lease is held by the native open file description and released on normal close or process death. The original store migrates v1 to v2 while retaining the original candidate, revision, snapshot and source bindings. A preexisting legacy JSON lease requires the original owner to identify and recover its completed writer before migration. This packet starts its own customer workspace.

Extract this source into a private owned directory. Point the variables at that actual owned installation, runtime and released Rust executable:

```sh
export SCF_MERCHANT_PACKAGE=/absolute/installed/node_modules/@tokenjunkielabs/starforge-merchant
export SCF_PLAYWRIGHT_MODULE=/absolute/existing/playwright/index.mjs
export SCF_CHROMIUM=/absolute/existing/chromium
export SCF_PYTHON=/absolute/existing/python3
export SCF_RUST_BINARY=/absolute/starforge-rust-linux-x86_64/bin/starforge-buyer-rust
node ./run-installed-customer.mjs
```

The wrapper verifies the original base manifest, both exact writer postimages, the released binary and both workbook hashes before opening the native application. Its result records the base source plus the explicit two-file upgrade, including their byte sizes, Git blob IDs and SHA-256 values. By default it keeps its own state under `browser-run/` beside these scripts. `SCF_CENSUS_WORKSPACE` may select another absolute owned directory containing these original controller/caller files; its `inputs/` files are retained or retrieved from the pinned public Census URLs.

## Customer workflow

The browser imports the original workbook, inspects its native cells, saves a reviewed mapping, creates the native CSV candidate, queries typed rows, reopens the same saved plan, reviews a later mapping edition, exports the exact original source bundle, publishes the selected candidate and retains the original buyer request. It opens the same publisher state again, verifies the 390-pixel layout and restores the original current snapshot after native rollback.

The original customer caller performs one four-page, sixteen-row acquisition through the native explicit HTTP 200 branch, which records its original NO_PAYMENT_REQUIRED outcome. It creates the original workbook delivery and receiving room, reopens its copied delivery, loads the native Python Analysis workspace, queries the table and receives the complete CSV, JSONL and SQLite query exports. The annual workflow imports the actual 2024 workbook, reviews all sixteen rows, identifies the one changed Year Moved In row, publishes that edition and reopens the browser comparison. The previously acquired customer remains pinned to the original 2023 snapshot.

The Rust continuation attaches that completed acquisition to its original operator, recovers it, creates the original verified delivery, reads all sixteen typed rows, copies the exact dataset bytes and reopens the retained handle. Its ten native calls preserve the saved acquisition and source snapshot.

## Retained output and handoff

The original browser controller saves completed phases in `browser-run/checkpoint.json`. Reuse the same owned workspace on a continuation; the original code consumes completed phases and completed acquisition pages. Keep its native journals, complete reports and original error details on that runtime.

After the full browser, Python and Rust workflow succeeds, `public-native-result.json` contains the exact source/input hashes, completed phase names, runtime versions, sixteen-row assertions, annual comparison counts and screenshot hashes. Return this compact result and the named screenshots to the original coordination thread. Keep the complete local customer state available for the owner to reopen.

## Source composition

`operator-browser-journey.mjs` retains the original controller flow from SHA-256 9aa777df675daa2f0052a5c335084a93fb77208df4dc03475f54ae60948f4801. `original-customer-continuation.mjs` retains the original caller from SHA-256 489f070a8646e56467e91656778e4c898d23c7838722c9e16525584dd85c74cc. This packet replaces their host-specific path bindings with explicit installed-runtime inputs. `run-installed-customer.mjs` composes the released Rust CLI with the completed native acquisition.

All included code is MIT licensed. Census input bytes are retained from the original public Census URLs above.
