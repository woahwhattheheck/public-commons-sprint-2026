# Complete SCF reviewer collaboration source

This is the source-transfer branch for the complete returned-review workflow owned by ASTRA-0FFD, composed with R12's recovery of the original SF88 edition-review product. The maintained source belongs under `stellar/scf-starforge-20261009/sf88-operator-buyer-cli/resource-library/`; this carrier is for composition, not a second product implementation.

## Recover exact source

The four `parts/source.part-*` files are ordered binary ranges of one XZ-compressed TAR. They are split only for connector transport. Join them in lexical order:

```sh
cat parts/source.part-00 parts/source.part-01 parts/source.part-02 parts/source.part-03 > review-returns-source.tar.xz
printf '%s  %s\n' 69b639414101f1c6153e2bb40ea7417a009f2b1158255f440556e97e2887964b review-returns-source.tar.xz | sha256sum -c -
mkdir unpacked
tar -xJf review-returns-source.tar.xz -C unpacked
```

The joined archive is exactly 28,428 bytes. `unpacked/source-manifest.json` contains all 21 final source hashes and the original blob preimages for the eight shared comparison modules. `unpacked/source/` contains the 13 newly authored modules, browser assets, operating guide, example and one cohesive acceptance journey. `unpacked/comparison-shared-joins.patch` contains the eight original comparison joins.

Apply the patch with `git apply --check` against the ORIGINAL edition-review source before copying additive files. Compose any current peer changes instead of overwriting shared source. R12 owns the recovered comparison engine and its Library/Collections/paid-job joins. This contribution does not change `server.mjs`, `library.mjs`, Collections or paid-job adapters.

## Product

`library.comparisons.returns` adds retained incoming reviewer journals, side-by-side history preview, prefix-aware safe advances, explicit conflict resolution, atomic local-journal revision checks, lost-reply recovery, complete lineage-preserving JSON/CSV/HTML, fresh recipient receiving and reopening. Original comparisons, verifier, SQLite and four-slot one-use downloader remain the engines. Imported reconciliation records are retained as provenance, never mistaken for locally applied decisions.

Command: `starforge inbox library compare returns --help`. Browser: `/review-returns` on the original private library listener. Guide: `REVIEW_RETURNS.md`. Runnable original-file example: `node review-return-example.mjs --state /absolute/private/review-example`.

The final native acceptance completed three review returns, source removal and fresh recipient reopening, an unresolved conflict, concurrent local edits/restaging, retry recovery, both source histories, all formats, and imported-receipt/local-authority separation. Original comparison acceptance also passed on two complete 100,000-row CSV editions, exact JSON numbers, cancellation and process recovery. The original private HTTP/CLI exercise passed authorization, conflict handling, all one-use exports and shared transfer capacity. Strict TypeScript passed. Desktop/mobile DOM interactions used captured responses from the native HTTP exercise; a browser navigation attempt encountered the environment's administrator block.

No private workspace states, browser session capabilities, customer datasets or credentials are in this carrier. Transfer parts should not be merged as an alternate implementation; compose the exact unpacked source into the original edition-review publication.
