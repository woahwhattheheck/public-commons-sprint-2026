# Source provenance

## Existing comparator

Repository: `woahwhattheheck/public-commons-sprint-2026`.

Original location: `business/berkeley-servicenow-27-11797c/cmdb-qa/cmdb_qa.mjs`.

Original PR481 merge: `4714646d7fe09db36fdf7844385d2ddd5e5eb9f0`.

Current full original Git blob: `2186ed145d7f9a50bd3066c3c33d1e7fbad453b0`.

UTF-8 length: 7,625 bytes. SHA-256: `f4eb477a76903ed8aaf72f0fb05e70db4b66729fe6914c925183726edd6164f3`.

That complete parent file is preserved unchanged. The original test is preserved unchanged as well. `original-adapter.cjs` copies the original parser, table validation, reconciliation and finding-CSV function bodies, removes their module-export declarations, and binds SHA-256 and UTF-8 length to the maintained browser-compatible helper. The native receiving operation compares its result with the original ESM module on the same full input strings.

## Existing helper components

`vendor/connected_sha256.cjs` is the complete maintained Commons SHA-256 helper. Its original license and provenance comments are preserved in that file.

`vendor/zip-original.js` reuses the complete small ZIP writer from the original Managed Platform customer-companion source. Two byte-buffer allocations are adapted: UTF-8 encoding returns the Uint8Array directly, and file chunks retain the existing Uint8Array rather than copying it. These changes avoid expanding file bytes into ordinary JavaScript number arrays. The archive format and member accounting are unchanged.

## New operating source

The acceptance workspace, browser UI, HTML composer, operating guide, source builder and original worked case extend the original comparator. They retain full original input editions and implement explicit mapping, exception ownership, immutable comparison history, corrected-target lineage, named receiving decisions, complete export/reopen and a portable customer handover.

The worked case is authored for the operating demonstration. It is not drawn from an Alcor or Berkeley instance.
