# Complete McCampbell cross-profile review

[Download the complete review archive](./McCampbell_Cross_Profile_Review_20261012.zip), then open `reconciliation.html`. The same directory contains `report.html` for the EQuIS4 source and `baseline/report.html` for the EQuIS3 source.

The archive retains both original public 2508877 deliveries, all seven native receiving CSV files, independent field decisions, the full source comparison, the full correspondence table and all three self-contained editors. Its 37 members contain 125,237,384 logical bytes in an 8,829,090-byte ZIP. SHA256: `721a8d4a7a236179c6821e4a1100439003eeebedddc9e28a4825b2d368dfbe6b`.

## Original data and recorded decisions

The complete [EQuIS3](https://www.mccampbell.com/EDDs/Equis3.zip) and [EQuIS4](https://www.mccampbell.com/EDDs/Equis4_CSV.zip) inputs each contain 500 result rows. [The original acquisition receipt](./source-receipt.json) retains the exact seven source members. This review traverses every physical row, including duplicate samples and the full test/batch context.

| Section | EQuIS3 entities | EQuIS4 entities | Candidate groups | Ambiguous groups |
| --- | ---: | ---: | ---: | ---: |
| Results | 500 | 500 | 492 | 21 |
| Samples | 30 | 32 | 30 | 2 |
| Tests | 41 | 41 | 38 | 3 |
| Batch assignments | 41 | 41 | 39 | 3 |

The [saved correspondence document](./cross-profile-decisions.json) explicitly defers all 29 ambiguous groups, pairs the original COD example and records the original BOD entity link. Every other entity remains available for review. The two source field documents record Keep for the exact COD result-unit tokens, preserving `mg/l` and `mg/L` independently.

The complete editable CSV and TSV each retain 599 groups and the explicit entity link. Both parse back to correspondence document SHA256 `27d312bc9cbf3c82fc8e81e67376bb401ed6c09c97bcab7461a625128c1c57e6`. The separate full field table contains 25,229 comparisons.

## Completed source execution

The unchanged laboratory application, source profiles, original ZIP writers and complete result reader ran over both retained original inputs in the connected V8 runtime. Its adapters supplied the memory filesystem, SHA256 and standard DEFLATE operations. The resulting archive was reopened through `readLabResult`; every member, both original inputs, both field reviews, the original comparison, the correspondence review and the after-review comparison matched.

All seven prepared native CSV files matched the complete original member bytes after the recorded Keep choices. [cross-profile-result.json](./cross-profile-result.json) contains the complete execution context, result identities, per-family totals, all seven native comparisons and editable-table hashes. [cross-profile-members.json](./cross-profile-members.json) gives the exact archive member map.

The complete native sealed-file worker, same-job replay and Chromium receiving flow uses the same sources and correspondence through [receiving.cross-profile.example.json](../../receiving.cross-profile.example.json). Its operating steps are in [RECONCILIATION.md](../../RECONCILIATION.md).

## Reopen and continue

With the source-pinned installation:

```bash
starforge lab-edd result \
  --file /absolute/McCampbell_Cross_Profile_Review_20261012.zip \
  --out /absolute/new-reopen-result.json
```

Open the correspondence editor to review complete native keys and field differences. It links directly to the original physical rows in each source editor. Save a correspondence JSON, CSV or TSV, and use that complete document with the same original source pair for a new receiving result. A changed native field belongs to that source's own field-decision document.

The full application uses the existing source-file intake, job identity, worker and result receiving. [The complete guide](../../RECONCILIATION.md) lists the actual CLI, SDK, file slots and native operating procedure.
