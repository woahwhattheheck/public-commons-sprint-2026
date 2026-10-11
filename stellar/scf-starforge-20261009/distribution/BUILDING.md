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
builder. The original regular-file restrictions, 2 MiB per-file and 32 MiB total
source limits, component inventory, static-import parsing and pinned runtime
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
commit. If a packaging attempt has already created an output directory, retain
it for inspection and choose a new directory for the continuation.

The completed output contains the original npm archive, `distribution.json`,
and an inspectable `package/` directory. `package/manifest.json` maps every
included original path to its Git blob, SHA-256, byte count and mode. Install
the archive and use its maintained `starforge` command as described in the
[merchant guide](README.md). Component owners can consume that exact archive
and manifest while later source changes continue toward the following release.

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

Existing callers can keep the original arguments. The two optional fields add
offline source reads and structured progress; the existing receipt fields
retain their meaning. `npm pack --ignore-scripts` remains the packaging step.

Git references: [batch object reads](https://git-scm.com/docs/git-cat-file),
[partial clone acquisition](https://git-scm.com/docs/partial-clone),
[explicit fetch input](https://git-scm.com/docs/git-fetch), and
[`--no-lazy-fetch`](https://git-scm.com/docs/git).
