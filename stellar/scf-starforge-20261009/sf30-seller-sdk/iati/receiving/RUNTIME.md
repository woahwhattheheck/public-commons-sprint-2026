# IATI source, package and READY runtime preparation

`prepareIatiOperatorRuntime` connects the complete IATI operator to a real
installation made by the existing distribution workflow. It calls the original
Git reader and builder, the original runtime prepare/recover/install functions,
full source and profile inspection, and SF46's `inspectMerchantRuntime`.
The caller's existing native foreground owns resource admission and the
subsequent publisher/operator journey.

## Callable contract

~~~js
import { prepareIatiOperatorRuntime } from
  '/absolute/source/stellar/scf-starforge-20261009/sf30-seller-sdk/iati/receiving/runtime.mjs';

const prepared = await prepareIatiOperatorRuntime({
  repository: '/absolute/iati-source-cache/repository.git',
  sourceRoot: '/absolute/source',
  sourceCommit: 'FULL_ORIGINAL_40_CHARACTER_COMMIT',
  outputDirectory: '/absolute/iati-runtime-preparation',
  operationId: 'IATI-PUBLISHER-7108-20261012-runtime',
  pythonExecutable: '/absolute/existing/python3',
  npmExecutable: '/absolute/existing/npm',
  sourceOffline: true,
  dependencyOffline: true,
  onProgress: event => process.stderr.write(JSON.stringify(event) + '\n'),
});

const { runtimeDirectory, sourceRoot: installedSourceRoot,
  sourceManifestSha256, installationId, profileId } = prepared;
~~~

Use the module from the exact selected bootstrap source root. `repository`
contains the original selected Git commit and tree; it can be a bare cache.
The private output directory must be separate from the bootstrap source,
Git cache and donor directories. The same operation ID, selected commit,
paths and options are retained in `input.json`.

The profile is fixed to the original source-only operator selection:

~~~json
{"native":false,"features":[],"pins":{},"operator":true}
~~~

The existing host supplies Node 22.16+, Python 3.11+, Linux and flock. Put the
selected Node executable's directory first in the native foreground's PATH so
the original npm commands use that same Node. Chromium and Playwright belong
to the subsequent existing browser receiver's selected runtime paths.

## Source acquisition using the original cache

A complete existing cache can be supplied directly. The preparation validates
every executing bootstrap module against the selected Git tree before calling
the builder. The original builder selects the committed `iati-operator`
recipe, complete component directories and selected contributions, then
discovers the static imports and browser assets through its maintained parser.

For an explicitly selected new cache on a responding worker, the original
Git source reader can receive exact missing objects from its configured
promisor remote:

~~~sh
git init --bare /absolute/iati-source-cache/repository.git
git -C /absolute/iati-source-cache/repository.git remote add origin \
  https://github.com/woahwhattheheck/public-commons-sprint-2026.git
git -C /absolute/iati-source-cache/repository.git config remote.origin.promisor true
git -C /absolute/iati-source-cache/repository.git config remote.origin.partialclonefilter blob:none
git -C /absolute/iati-source-cache/repository.git fetch \
  --no-tags --depth=1 --filter=blob:none origin FULL_ORIGINAL_COMMIT
~~~

Initialize that new owned cache once. Continue its original cache thereafter.
For this route, explicitly set `sourceOffline:false`. The maintained reader
requires a Git executable supporting `--no-lazy-fetch`. It reads exact
immutable tree objects and leaves donor worktrees and branches intact.

Materialize the bootstrap from the selected original source through the
existing Git/source receiver. The executing closure consists of:

- `iati/receiving/runtime.mjs`.
- `distribution/build.mjs`, `runtime-workspace/storage.mjs` and `git-source.mjs`.
- `distribution/build-state.mjs`, `browser-assets.mjs`, `product-package.mjs`.
- `distribution/specification.mjs`, `source-selection.mjs`.
- `distribution/runtime-unpack.py` and `git-object-receiving.py`.

The package supplies the complete installer/profile and SF46 source used for
the actual installation. The bootstrap source is verified against the same
selected commit, then the generated original package supplies the next stage.
Include the complete IATI receiving directory when preparing the bootstrap
for the caller's publisher and operator procedures.

## Receive existing Git, source or archive donors

The optional `sourceReceiving` configuration invokes the original
`distribution/git-object-receiving.py` directly:

~~~js
{
  repository: '/absolute/iati-cache/repository.git',
  sourceReceiving: {
    directory: '/absolute/iati-cache',
    metadata: '/absolute/source-input/iati-git-source.json',
    donorRepositories: ['/absolute/existing-original/repository.git'],
    donorSources: ['/absolute/existing-installed/package/source'],
    donorArchives: [
      {path: '/absolute/original-source.tgz', sha256: 'FULL_ORIGINAL_SHA256'}
    ],
    incoming: ['/absolute/retained-original-blob-files']
  }
}
~~~

The metadata is the original receiver's
`stellar-forge.git-object-receiving.v1` document: exact repository, commit and
tree; full native tree rows; exact raw Git `commitText`; and original required
paths. Its file bytes and SHA-256 are retained in this operation's input.
Use the native raw commit object or a verified original signature payload
and signature to recover those bytes; normalizing author timestamps or signed
commit text changes the Git identity.

The original receiver reconstructs and hashes the actual Git objects.
Donor repositories, installed source and declared archives are read-only.
An archive donor carries its independently observed full SHA-256. Exact
incoming object files retain their original Git names and bytes. The IATI
caller uses the maintained source receiver throughout.

When the builder requests further original missing blob IDs, the caller maps
those IDs through that same retained Git tree, records the additional paths,
and invokes the original receiver again. Its `missing-objects.json`
remains the concrete source acquisition input if a body has not yet arrived.
Repeat the same preparation after receiving those original bodies into the
same selected cache.

The original B710 managed-STAC composition demonstrates this same maintained
source→builder→installer sequence at public source
`5cbf72ca6cf1bb473f42a27bfdb5b4978114d6d8`. Its existing operation, private
workspaces and donor installation remain separate. The current IATI source
selection and its own output/installation records determine this product's
actual package.

## Preparation and interruption recovery

The IATI caller retains one original output-directory flock. It publishes
complete input and stage metadata through the existing private temporary,
fsync and rename primitive while holding that lease. Unpublished temporary
records remain in the directory; a retry keeps the selected input intact.

The maintained builder owns its release directory, immutable selected source,
materialization state and pack lease. A completed build reuses its verified
archive. An interrupted build resumes its original materialization or pack.

Before calling the installer, the preparation records the selected target in
`installation-attempts.json`. It calls the original APIs as follows:

| Retained condition | Original continuation |
| --- | --- |
| Selected target does not yet exist | Prepare the original archive and profile, then install. |
| Complete original plan/profile/state exists | Resume `installRuntime` in that same directory. |
| Interrupted preparation has its original preparation record | Call `recoverRuntime` into the next retained target. |
| Initial preparation record itself was interrupted | Preserve the partial directory; call the original prepare function in the next retained target with the outer operation's same archive/profile. |
| Completed IATI readiness result exists | Reinspect the same runtime, whole source, original profile and lock; return the original completed identity. |

Changed source commits, recipe, profile, archive, donor selection or paths
cannot reuse this operation's input. Complete previous attempts remain intact.
An active original npm installation keeps the original installation lease;
the caller uses that installer's normal busy/continuation contract.

The preparation returns the installed source and actual READY binding to the
caller's same authorized publisher/operator workflow. That native foreground
continues with the original data workspace, Applications and browser lifecycle.

## Actual return value

The successful value has schema `stellar-forge.iati-runtime-ready.v1` and
`state:"READY"`. It contains:

| Field | Meaning |
| --- | --- |
| `runtimeDirectory`, `installationDirectory` | Actual selected final installation directory. |
| `sourceRoot` | Actual installed `package/source` root returned by the original runtime. |
| `sourceCommit`, `sourceManifestSha256` | Original package commit and complete manifest identity. |
| `installationId`, `profileId` | Original installer/profile identities. |
| `runtime` | Complete `inspectMerchantRuntime` result, including profile and lock SHA-256. |
| `inspection` | Original READY/dependency/source inspection result. |
| `distribution`, `archive` | Original pack receipt and full archive byte/hash readback. |
| `criticalSources` | Exact whole IATI operator and original XML/native dependency file identities. |
| `preparationAttempts` | Every selected installation target and retained recovery predecessor. |
| `records` | Original preparation, source, release, attempt and final readiness record paths. |

The complete source manifest retains every package file, including the original
receiving callbacks. The targeted IATI file checks supplement that full
inventory and original unpacker/profile verification.

## Compose the single publisher and operator receiving

Pass the returned installed source root to the original Python publisher
procedure. It creates or reopens the selected private workspace, builds the
real publisher editions and portfolio, retains its reviewed finance report,
and closes its workspace before the operator receiver begins.

Then call the installed `runIatiOperatorReceiving` with:

~~~js
{
  directory: '/absolute/closed-original-iati-workspace',
  outputDirectory: '/absolute/iati-operator-receiving',
  sourceRoot: prepared.sourceRoot,
  runtimeDirectory: prepared.runtimeDirectory,
  operationId: 'IATI-PUBLISHER-7108-20261012-operator',
  actor: {id: 'iati-receiving-operator', label: 'IATI receiving operator'},
  expected: publisherResult.expected,
  pythonExecutable: '/absolute/existing/python3',
  chromiumExecutable: '/absolute/existing/chromium',
  playwrightModule: '/absolute/existing/playwright/index.mjs'
}
~~~

Use the publisher procedure's actual expected portfolio ID, revision,
definition digest, counts, financial groups and selected comparison. The
operator receiver checks the installed source and original READY runtime
before starting the existing Applications workflow and authenticated MCP
source-workspace leaf. The same native foreground retains the complete
publisher, installation, browser, report, archive and reopen results.

## Run or continue from a private input file

~~~sh
node /absolute/source/stellar/scf-starforge-20261009/sf30-seller-sdk/iati/receiving/runtime.mjs \
  /absolute/iati-runtime-input.json
~~~

Progress goes to standard error. The complete final result goes to standard
output and `outputDirectory/runtime-ready.json`. On failure,
`preparation-error.json` names the actual source/build/install stage,
original error and missing-object or selected runtime path. Preserve the
source cache, release output, every installation attempt and the caller's
original native record when continuing.

Keep customer publisher files, report data, private console capabilities and
staff state in their original private receiving directories. The selected
software package contains the maintained product source and its guides.
