# Original following source release runner

These two source files are the original completed D1CC producer used by the following source-release operation and subsequently consumed by the e287 cumulative release. They are retained byte for byte beside the existing [Applications continuation](README.md), so another receiving host can obtain the actual source rather than depend on a transient path.

| File | Bytes | SHA256 | Git blob |
| --- | ---: | --- | --- |
| [run-release.mjs](run-release.mjs) | 6319 | `19302570ecbb36510f8bd29b28e894a9d647adeaa3646201ec2bd4e997853836` | `e92e3cf0bcfa54f9ee6f9387830bcb7daccebc82` |
| [launch-release.py](launch-release.py) | 2201 | `2928afd1714b533b95920fcda5b6dd8ee0362c07dea95c9ae4c0434853bea584` | `6f453f67b252c5e23ef12b6e6209df8075a07114` |

Original source directory: `/workspace/scratch/d1ccf784531e/scf-following-release`. The publication does not alter either source file.

## Source producer

The existing native owner invokes:

```sh
node run-release.mjs /absolute/path/release-intent.json
```

The original intent schema is `starforge.following-source-release-operation.v1`. Its selected inputs include `operationRoot`, `builderDirectory`, `builderFiles` (name, bytes, SHA256), `sourceCache`, `sourceCommit`, `sourceTree`, `releaseDirectory`, and `installedDirectory`. The operation directory already exists when the runner starts.

The runner verifies the selected builder files, calls that original `buildDistribution`, retains a completed archive receipt, and performs the original offline npm source installation with lifecycle scripts disabled. It verifies the archive, installed source/version, and every manifest member's path, type, size where declared, and digest. It saves `installation.json` with state `SOURCE_INSTALLED`. The npm write cache is derived from `operationRoot/npm-cache` and reaches the builder through the inherited npm cache environment.

A partial source build remains in its original directory. The existing `continue-applications.mjs` carries the supported `buildDistribution(..., resume: true)` step before invoking this runner, then performs the original runtime upgrade and Applications receiving. Its input manifest selects the source runner by path and SHA256. A newly prepared receiving operation can select this retained file with the same SHA256 before freezing that operation's input. An already started operation keeps its selected input and uses its maintained placement or recovery path.

## Original foreground declaration

`launch-release.py` preserves the actual prior D1CC foreground declaration, including its original operation identity, runtime directory, cache consumers, project paths and resource request. Those values describe that original operation. The existing `launch-private-retained.py` and Applications continuation provide the current retained receiving path for another owned operation; publishing the historical declaration does not start or remint a producer.

Runtime READY inspection, managed application start/stop, and customer receiving follow through the existing runtime installer and Applications continuation. `SOURCE_INSTALLED` records the completed source-install phase.

## Publication verification

The original source files were read from the retained directory and their full UTF-8 bodies, byte counts, SHA256 values and Git blob identities were captured together. The Git publication uses those exact bodies. No new source package, runtime installation or customer acquisition is performed by this source handoff.
