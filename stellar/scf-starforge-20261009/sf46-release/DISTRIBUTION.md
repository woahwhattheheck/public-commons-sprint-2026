# Stellar Forge portable product release

This adds a usable distribution to the original SF46 release surface. An operator
can move one release directory to another machine, launch the existing seller and
operations together, install successive versions, and return to the previous
version. Merchant configuration, response assets, databases and journals stay in
separate operator directories.

The distribution contains the original committed source from
`scf46-stellar-bazaar/`, `stellar-forge/` and
`stellar/scf-starforge-20261009/`, including shared imports, examples, browser
assets and original licenses. Test directories and `*.test.*` files are omitted.
The builder reads Git objects from one commit. Uncommitted files, local merchant
state, credentials and unrelated projects are never read into the release.

## Build once from a committed checkout

Use Node 22 or newer and Git. Run from the repository root:

```sh
node stellar/scf-starforge-20261009/sf46-release/distribution.mjs pack \
  --source . --out /tmp/stellar-forge-0.1.0 --version 0.1.0
```

The output directory must be new and outside the source checkout. `--ref` accepts
an exact 40-character commit ID; its default is `HEAD`. Commit the distribution
source before building. A release prints its source commit, file count, digest,
versioned installation ID and available commands. The same commit and version
produce the same release digest. Source files retain their original bytes.

The resulting directory is relocatable. It needs neither the original checkout
nor Git at runtime. Archive that complete directory with an ordinary ZIP/tar
tool, transfer it, then extract it before installation. Do not run an archive
extractor as part of an unreviewed remote download command.

## Cold start with the original seller

The starter demonstrates native seller HTTP challenges and its real operations
console using only Node. Run these commands after extracting the bundle:

```sh
node /tmp/stellar-forge-0.1.0/forge.mjs install \
  /tmp/stellar-forge-0.1.0 --home /tmp/stellar-forge-home

cp /tmp/stellar-forge-0.1.0/stellar/scf-starforge-20261009/sf30-seller-sdk/examples/service.json \
  /tmp/stellar-forge-home/config/seller.json

node /tmp/stellar-forge-home/forge.mjs run operations -- \
  --operations-port 0 -- \
  --config /tmp/stellar-forge-home/config/seller.json --port 0
```

Two original startup messages contain the seller and operations URLs. Open the
operations URL in a browser. The seller's `/dataset` returns HTTP 402;
`/_seller/health` and `/_seller/offers` expose the current local configuration.
The supplied example uses nonpayable demo asset and recipient markers. Replace
the configuration with the merchant's actual approved route terms before using
native payments. Ctrl-C reaches the original launcher's normal shutdown path.

There are two `--` separators in the operations example: the first ends the
distribution's options; the second belongs to the original operations launcher.
Every native argument is forwarded as its own process argument. No shell command
is constructed. Relative configuration paths keep the caller's working directory;
use absolute paths in service configurations and shared runbooks.

## Native commands in one installation

Run `node forge.mjs status` to see the paths present in the selected release.

| Command after `run` | Existing original entry point |
| --- | --- |
| `seller` | SF30 declarative seller |
| `operations` | SF30 seller plus operations console |
| `upstream` | SF30 upstream API seller |
| `openapi` | SF61 OpenAPI compiler |
| `pilot` | SF82 compile/resume seller workflow |
| `pilot-ops` | SF96 original pilot, operations and support workflow |
| `buyer` | SF88 prepare/discover/review/execute CLI |
| `capture` | SF85 real merchant HTTP challenge collector |
| `handoff` | SF96 captured challenge to buyer configuration |
| `support` | SF93 support-bundle exporter |
| `seller-check` | SF96 original seller route audit |

Optional `buyer-runbook` and `deploy` commands are included only when their
original named CLI files exist in the selected commit. The exact manifest is
authoritative. Other shipped modules remain importable by their original paths;
the distribution does not advertise nonexistent entry points.

For an original command's help:

```sh
node /tmp/stellar-forge-home/forge.mjs run buyer -- --help
node /tmp/stellar-forge-home/forge.mjs run pilot-ops -- --help
```

SF88 retains its original buyer settings, controlling-terminal approval, signer,
budget accounting and response-file behavior. A release install or activation
does not add approvals, repeat purchases or grant new authority.

## Upgrade and rollback

Build or obtain a later complete release. Install it beside the current version:

```sh
node /tmp/stellar-forge-0.2.0/forge.mjs install \
  /tmp/stellar-forge-0.2.0 --home /tmp/stellar-forge-home
node /tmp/stellar-forge-home/forge.mjs status
```

The first install becomes active automatically. Subsequent installs are staged.
Use the exact `releaseId` printed by install:

```sh
node /tmp/stellar-forge-home/forge.mjs activate RELEASE_ID
node /tmp/stellar-forge-home/forge.mjs rollback
```

`install ... --activate` combines staging and explicit activation. An exclusive
local update lock serializes changes. A failed copy is never activated. Source
files are checked before copying and again before the new directory becomes
available. The active pointer is replaced atomically, preserving the previous
release ID. A crash after staging leaves the previous version active; select the
completed version with `activate`. Repeating an install is idempotent. An
interrupted first installation can be resumed with its original release bundle.

Activation affects **new launches**. Running sellers remain on their original
version. Use the original SF30 graceful shutdown and SF99 host-service operator
procedure when switching a live deployment. The installer neither restarts
services nor changes Caddy/systemd. Rollback changes source selection only; it
does not roll back merchant databases, journals, wallet operations or purchases.
Use the original merchant state recovery workflow when a data recovery is needed.

The home layout is deliberately simple:

| Path | Contents |
| --- | --- |
| `forge.mjs`, `release-core.mjs` | Local installation manager |
| `installation.json`, `active.json` | Installation and active/previous release selection |
| `releases/RELEASE_ID/` | Complete versioned source release |
| `config/` | Operator configuration; never rewritten by upgrades |
| `state/` | Merchant operational state; never included in source releases |

There is no automatic deletion of old releases or merchant data. The incoming
bundle's manager can always operate an existing home using `--home`; this is also
the path for future manager upgrades without rewriting a live installation.

## Optional native SDK installation

Challenge-only seller, compilation, review and local operations run without npm.
The generated package declares the same exact x402 version that the committed
original SF30 `native-factory.mjs` declares. At the initial delivery this is
`2.28.0` for `@x402/core`, `@x402/stellar`, `@x402/extensions` and `@x402/fetch`.
This follows the [original pinned first-party package manifest](https://github.com/x402-foundation/x402/blob/7f2b2f1f77fa5317615735e3378a6fad41cccb4e/typescript/packages/mechanisms/stellar/package.json)
and [SF04 dependency inventory](../sf04-protocol-baseline/BASELINE.md).

When a native runtime is needed, install packages in the **selected release
directory** printed by `status`:

```sh
npm install --ignore-scripts --omit=dev
node forge.mjs doctor
```

The installer never runs npm itself. `doctor` reports exact installed versions;
missing optional packages remain visible even if npm tolerated their absence.
Retain the generated `package-lock.json` with your deployment and reuse that
lock for reproducible dependency installation. Dependencies and their separate
licenses remain their upstream authors' work; no upstream tarballs are embedded
in the source release. Native SDK availability is separate from configured
facilitator, signer and successful merchant payment.

## Release checks and trust

`verify` checks every declared file, rejects symlinks, missing/changed files,
unlisted source and malformed manifests. Optional dependencies under
`node_modules/` and the deployment's `package-lock.json` are outside the source
digest and are reported separately. The source digest proves byte consistency;
compare it with the trusted publication when accepting an externally supplied
bundle:

```sh
node forge.mjs verify /path/to/bundle --expect PUBLISHED_SHA256
node forge.mjs install /path/to/bundle --home /private/forge --expect PUBLISHED_SHA256
```

`verify`, `doctor`, `status`, install, activate and rollback make no network calls,
import no payment engine and run no tests. `run` launches only the selected
original command with inherited terminal and normal signal handling. Network,
wallet and merchant behavior comes from that command and its explicit settings.

The delivery was exercised as a single local product flow: committed-source
packaging, cold install, original seller plus operations HTTP challenge, staged
upgrade, activation, rollback, unchanged operator files and corrupt-bundle
rejection. This exercises the distribution; it is not a Stellar settlement or
customer-revenue claim. No GitHub Actions run is needed.
