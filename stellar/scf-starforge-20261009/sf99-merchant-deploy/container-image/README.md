# Merchant runtime images

Build and move one merchant runtime image from an existing maintained source
release and its selected runtime profile. The image supplies the exact npm
dependencies, Node, Python and `flock` that the SF99 container deployment needs.
The existing [container generator](../CONTAINERS.md), original supervisor and
maintenance implementation continue to own the merchant service lifecycle.

Run the image CLI from a current source checkout:

```sh
node stellar/scf-starforge-20261009/sf99-merchant-deploy/container-image/cli.mjs help
```

## Select the release and runtime

Keep the original distribution TGZ and its recorded SHA256. Install that same
release through the maintained distribution workflow, then create a profile from
the installed source. `selectedSourceRoot` is that original installed tree;
`sourceRoot` is the path the merchant will use inside its final image.

```sh
node stellar/scf-starforge-20261009/distribution/runtime-profile-cli.mjs create \
  --directory /srv/starforge/runtime-profile \
  --source-root /srv/starforge/release/package/source \
  --native --operator
```

Add the original profile CLI's `--feature NAME` selections for the adapters the
merchant uses. The profile owns version selection, source constraints, installed
package probes and operator requirements. The image preparer reads its generated
`packageJson` directly. A profile selected from another release is rejected even
when the two package versions appear compatible.

Use an already available Linux runtime base, selected by its complete
`repository@sha256:...` digest. Inspect the chosen base on the Docker host and
retain its real digest, platform and executable paths. It must already contain
the profile's Node version, npm, Python 3.11 or newer and `flock`. Additional
Python modules, such as an adapter's driver, can be declared in `pythonModules`;
the image checks their actual imports as its final unprivileged user.

Keep the image's source directory immediately below its dependency directory:

| Purpose | Example image path |
| --- | --- |
| Original source | `/opt/starforge/source` |
| Selected npm dependencies | `/opt/starforge/node_modules` |
| Original release manifest | `/opt/starforge/manifest.json` |
| Retained image runtime contract | `/opt/starforge/merchant-build/runtime-contract.json` |

The runtime executables must live outside `/opt/starforge`. Use the same source,
Node and Python paths in the original SF99 host plan. For the default container
source bind, mount the source directory alone so that its sibling
`node_modules` remains available from the image.

## Image plan

Write a JSON plan with these fields. The paths and digest are explicit inputs
from the selected release, runtime base and operator host.

| Field | Required value |
| --- | --- |
| `schema` | `stellar-forge.merchant-container-image.v1` |
| `id` | Stable lowercase name, beginning with a letter, up to 40 characters |
| `archive` | Absolute path to the retained original source TGZ |
| `archiveSha256` | The original archive's 64-character SHA256 |
| `runtimeProfile` | Absolute path to the selected original `profile.json` |
| `selectedSourceRoot` | Absolute path to that same installed release's source tree |
| `baseImage` | The existing runtime base's immutable repository digest |
| `platform` | `linux/amd64`, `linux/arm64` or `linux/arm64/v8` |
| `sourceRoot` | Absolute source path inside the image |
| `runtime` | Object with absolute image executable paths `node`, `python`, `npm` |
| `uid`, `gid` | Existing operator's unprivileged numeric identities; defaults are 65532 |
| `pythonModules` | Optional array of additional Python module import names |

`inspect` validates the inputs without creating a context. The archive reader
checks the compressed SHA256, every original source file's size, SHA256 and Git
blob identity, the original package metadata, and the source manifest. It rejects
links, traversal, duplicate entries and unlisted files. Profile selection is
joined to the archive's original source commit and all of its dependency input
hashes.

The original source archive determines the supported source modes. An archive
that contains the container generator, mount planner, supervisor, CLI, operations
and Compose maintenance modules supports baked source mode as well as the
existing source bind. Earlier retained archives support source bind mode; select
the following original cumulative release for baked container source.

```sh
node stellar/scf-starforge-20261009/sf99-merchant-deploy/container-image/cli.mjs \
  inspect --plan /srv/starforge/merchant-image.json

node stellar/scf-starforge-20261009/sf99-merchant-deploy/container-image/cli.mjs \
  prepare --plan /srv/starforge/merchant-image.json \
  --out /srv/starforge/image-context
```

The output must be a new directory. It retains the original archive, exact
profile, Dockerfile, selected package manifest and build helpers. Its Docker
ignore file admits only these selected image inputs. Keep this context at its
original absolute path through locking, build and export.

## Lock and build

Lock the selected npm dependency tree once. Supply a compatible retained
`package-lock.json` when one already exists:

```sh
node stellar/scf-starforge-20261009/sf99-merchant-deploy/container-image/cli.mjs \
  lock --context /srv/starforge/image-context \
  --lock-file /srv/starforge/runtime-profile/package-lock.json
```

Otherwise omit `--lock-file` to run the host's npm in the prepared context. Use
`--npm /absolute/path/to/npm` when needed. This resolves a lock with lifecycle
scripts disabled and retains its exact bytes. The accepted lock must keep every
selected root version, use lockfile version 3 and retain integrity-pinned public
npm registry tarballs for its transitive packages.

```sh
node stellar/scf-starforge-20261009/sf99-merchant-deploy/container-image/cli.mjs \
  check --context /srv/starforge/image-context

node stellar/scf-starforge-20261009/sf99-merchant-deploy/container-image/cli.mjs \
  build --context /srv/starforge/image-context --engine /usr/bin/docker
```

The native build uses the already selected local base, `npm ci`, the original
archive and that retained lock. The final image runs the original runtime profile
inspection with dependency imports enabled, explicit Python and the selected
numeric user. A successful build returns a receipt only after Docker reports the
actual image ID, source labels and platform.

The receipt in `image-receipt.json` joins the image ID to the release archive,
source commit, profile ID, dependency lock, base digest, runtime paths and build
context identity. Use its immutable `imageId` in the existing container spec.
The local deterministic tag is convenient for finding the image; the image ID
selects the exact bytes to run or export.

## Join the original container deployment

Set the existing container spec's `image` to the receipt's `imageId`. Use the
same `uid`, `gid` and original host-plan runtime paths as the image plan. The
existing source bind mode mounts the host's selected current source at the
image's exact source path and leaves the image dependency directory available.

Use `sourceMode: "image"` when the image receipt's `sourceModes` contains
`image`. That means the selected original archive already contains the required
container entry points. The outer container bundle must select those same
source hashes. An earlier source archive retains `bind` as its supported mode.

Continue through [CONTAINERS.md](../CONTAINERS.md) and
[OPERATE_CONTAINERS.md](../OPERATE_CONTAINERS.md) for generation, service startup,
status, HTTPS readiness and original maintenance. Status and smoke operations
that inspect the supervisor run in the merchant container's own process
namespace. The image remains replaceable while the original receiver journal,
delivery outbox, leases and retained recovery bundle keep their identities on
the operator host.

## Export and restore the exact image

Export a new transfer directory from a successfully built image:

```sh
node stellar/scf-starforge-20261009/sf99-merchant-deploy/container-image/cli.mjs \
  status --context /srv/starforge/image-context --engine /usr/bin/docker

node stellar/scf-starforge-20261009/sf99-merchant-deploy/container-image/cli.mjs \
  export --context /srv/starforge/image-context \
  --out /srv/starforge/image-transfer --engine /usr/bin/docker
```

The engine saves the immutable image ID through Docker, then retains the actual
tar bytes, their SHA256 and the original image receipt. Copy the complete
directory containing `image.tar` and `image-bundle.json` to the destination
operator host through the existing artifact transport.

```sh
node stellar/scf-starforge-20261009/sf99-merchant-deploy/container-image/cli.mjs \
  import --bundle /srv/starforge/image-transfer --engine /usr/bin/docker
```

Import verifies the archive bytes before invoking Docker. It adopts an already
present identical image or loads the retained tar, then compares the actual
image ID, source labels, context identity and platform. It restores the local
tag only when that tag is absent or already selects the same image. Use the
returned immutable image ID in the recovered container bundle, then continue
the original maintenance restore and reopen workflow.

## Interrupted operations

| Observation | Recovery |
| --- | --- |
| Context exists after preparation | Continue from its retained `context.json`; use a new directory for changed inputs. |
| Lock resolution was interrupted | Repeat `lock` on the same context; a completed accepted lock is reused. |
| Build finished but the CLI lost its response | Repeat `build`; the deterministic tag and source/context labels reconcile the completed image before another build is started. |
| Same build is still running | Follow that original process; its retained build record identifies its PID and host. |
| Image receipt exists | `status` reads Docker's actual immutable image and checks the receipt. |
| Export was interrupted | Keep the original context and image receipt; export to a new transfer directory. A partial tar is retained separately from a completed transfer manifest. |
| Import lost its response | Repeat `import` on the same complete transfer; the actual image ID is reconciled before loading again. |
| A local tag selects another image | Keep that tag intact; choose the explicit immutable image ID or resolve the intended tag ownership. |

For an upgrade, select the next original source release and resolve its profile
into new directories. Keep the previous context, receipt, exported image and
original encrypted recovery artifacts until the existing maintenance workflow
has reopened the merchant successfully. This makes an image rollback a precise
runtime selection within the original state recovery operation.

## Native command references

- [Docker image save](https://docs.docker.com/reference/cli/docker/image/save/)
- [Docker image load](https://docs.docker.com/reference/cli/docker/image/load/)
- [npm ci](https://docs.npmjs.com/cli/v11/commands/npm-ci/)
- [Compose service configuration](https://docs.docker.com/reference/compose-file/services/)
