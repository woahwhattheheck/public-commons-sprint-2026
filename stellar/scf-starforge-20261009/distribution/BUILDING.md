# Produce a merchant release from one Git commit

Use the maintained `build.mjs` in a current source checkout. It selects the
distribution specification, component files, native dependency versions and
relative ESM import closure from one resolved commit. The worktree can contain
other work; the selected Git snapshot determines the complete package.

```sh
node stellar/scf-starforge-20261009/distribution/build.mjs \
  --repo /absolute/public-commons-sprint-2026 \
  --ref FULL_COMMIT_SHA \
  --out /absolute/new-merchant-release
```

Node, npm and Git with `--no-lazy-fetch` support are required. The builder emits
phase progress on stderr and the final JSON receipt on stdout. The original
native command worker can retain those streams together with
`new-merchant-release/distribution.json`. This works with an ordinary checkout
or a bare repository whose chosen commit and trees are already available.

## Source acquisition and reuse

The source reader resolves the ref once, reads that commit's tree, and inspects
the selected blobs in batches. It disables replacement objects and implicit
lazy fetching so each source read has a known identity and acquisition step.
Existing Git object storage and configured alternates supply cached bytes.

For a partial clone, missing selected blobs are requested together from its
existing promisor remotes. The first batch obtains the specification and
license; subsequent batches obtain selected components and any newly discovered
static imports. Each request contains exact blob IDs from the chosen tree.
Acquisition leaves branch refs, the checkout and `FETCH_HEAD` in place, and
does not start automatic Git maintenance. The repository keeps the objects for
the next operation. Use an existing clone and its ordinary authenticated Git
configuration when access is required.

After acquisition, the reader checks each blob's type, declared size, complete
batch framing and Git object hash before passing its original bytes to the
builder. The reader and builder share a 64 MiB aggregate source limit, while
original source files retain their 2 MiB limit. Before materialization, the whole
package—including its generated manifest, metadata, README and license—must fit
the original installer's 64 MiB unpacked limit and 4 MiB member limit. The regular-file
restrictions, component inventory, static-import parsing and pinned runtime
dependency rules remain part of packaging.

The progress stream reports the resolved commit, selected file count, source
inspection, each fetch, bytes loaded, materialization, npm packaging and final
archive hash. It carries configured remote names instead of credential-bearing
remote URLs. The final `sourceAcquisition` receipt records Git command count,
metadata/content batches, fetched and cached object counts, unique bytes and
timing. These measurements are outside the archive so the same selected source
retains the same package bytes.

## Repeat the build offline

After the source objects are present, use a new output directory:

```sh
node stellar/scf-starforge-20261009/distribution/build.mjs \
  --repo /absolute/public-commons-sprint-2026 \
  --ref FULL_COMMIT_SHA \
  --out /absolute/merchant-release-offline \
  --offline
```

This option prevents source acquisition. Missing objects produce
`MISSING_SOURCE_OBJECTS` with the selected commit and object IDs in the
programmatic error. The CLI identifies the missing count and the recovery
action. Acquire those objects in the same repository, then repeat the selected
commit. If materialization or packaging has already created the output, continue
that original directory with `--resume` as described below.

The completed output contains the original npm archive, `distribution.json`,
and an inspectable `package/` directory. `package/manifest.json` maps every
included original path to its Git blob, SHA-256, byte count and mode. Install
the archive and use its maintained `starforge` command as described in the
[merchant guide](README.md). Component owners can consume that exact archive
and manifest while later source changes continue toward the following release.

## Continue an interrupted build

On Linux, resume in the original output directory after restoring available
disk space or ending the interrupted operation's original process:

```sh
node stellar/scf-starforge-20261009/distribution/build.mjs \
  --repo /absolute/public-commons-sprint-2026 \
  --out /absolute/new-merchant-release --resume --offline
```

The retained `build.json` binds the output to one source commit, package version
and exact manifest. With no `--ref`, resume selects that saved commit even when
the repository's current branch has advanced. An explicitly supplied ref must
resolve to the same commit. Existing Git object storage supplies the selected
source, and the original specification, browser mappings, import closure and
dependency selection still determine the package.

Completed source files retain their existing bytes and inode. A partially
written file continues only after its existing bytes match the exact original
prefix. Missing files are written into the same stage. Conflicting bytes, an
unexpected file or a linked directory stop that specific operation with the
affected path. The builder never substitutes the current branch's newer source.
Progress and the final receipt report copied, resumed and reused file counts
and the number of bytes actually written by the continuation.

The original `npm pack --ignore-scripts --json` runs inside the same output's
`pack-work/` directory. Its archive is linked into the final output without
copying it. Linux keeps the original open-description file lock with npm, so a
surviving pack process remains the sole writer when its parent exits. A second
invocation reports `DISTRIBUTION_BUILD_ALREADY_RUNNING`; it does not infer that
a process in another namespace is stale or start another pack against it.

If npm finished before its result was retained, the existing original release
reader verifies the archive against the retained manifest and complete source
stage. That completed archive is then reused. This particular recovery needs
Python 3.11+; select an installed interpreter with `--python EXECUTABLE`.
A truncated, unacknowledged archive in the builder's private pack work area can
be removed and packed again after its bytes and failed state are inspected.
An acknowledged archive or final delivery with conflicting bytes remains
available for diagnosis. Final archive and receipt publication use exclusive
links and durable records, so interruption cannot overwrite an existing result.

Repeating `--resume` after completion returns the original archive, integrity
and receipt with `reused: true`. With no ref, or the same full source commit,
that path does not read Git, parse source or invoke npm again. The original
archive is hashed as a stream when reopening its receipt.

Inspect retained progress without acquiring source or starting a build:

```sh
node stellar/scf-starforge-20261009/distribution/build.mjs \
  --out /absolute/new-merchant-release --status
```

Status reports retained materialization or completion, the pinned commit and
available result. It describes the saved files; it does not declare a process
alive or release its lock.

Older output directories can also continue. An existing original
`package/manifest.json` supplies their source commit. For a legacy partial stage
without that manifest, specify its original full commit with `--ref`. The same
complete inventory and prefix comparison adopt only the declared package
files. Fresh builds keep the existing new-directory behavior; `--resume` is an
explicit choice and incomplete recovery uses Linux's native `flock`.

## Programmatic build

```js
import { buildDistribution } from './build.mjs';

const receipt = await buildDistribution({
  repository: '/absolute/public-commons-sprint-2026',
  ref: 'FULL_COMMIT_SHA',
  output: '/absolute/new-merchant-release',
  offline: false,
  onProgress: event => process.stderr.write(JSON.stringify(event) + '\n'),
});
```

Existing callers can keep the original arguments. `offline` and `onProgress` add
offline source reads and structured progress; the existing receipt fields
retain their meaning. `npm pack --ignore-scripts` remains the packaging step.

Pass `resume: true` to `buildDistribution` to continue the same `output` and omit
`ref` to use its retained pin. `python` selects the interpreter for the original
archive verifier when recovering an unacknowledged completed pack. The exported
`inspectDistributionBuild({ output })` provides the same retained state as
`--status`.

Git references: [batch object reads](https://git-scm.com/docs/git-cat-file),
[partial clone acquisition](https://git-scm.com/docs/partial-clone),
[explicit fetch input](https://git-scm.com/docs/git-fetch), and
[`--no-lazy-fetch`](https://git-scm.com/docs/git).

