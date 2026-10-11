# Retained ClickHouse merchant releases

Use the original seller release store to retain, compare, activate, drain and
roll back an existing [ClickHouse merchant](../sf30-seller-sdk/clickhouse/README.md).
The same original seller handles its HTTP 402 responses, native facilitator,
typed input validation, paid queries, operations and availability controls.

Each release keeps the original prepared source, plan, bindings, service,
OpenAPI and generated customer client. The original working directory can move
after staging. Connection values remain in the launching process environment;
the package contains only the selected environment variable names.

ClickHouse remains a live external database. Rollback restores the retained
query, input contract, payment terms, runtime selection and customer files. It
does not rewind database contents or restore an earlier database schema. Every
start performs the original actual source preflight. A release staged from the
operator workspace also retains its reviewed native column types and refuses a
changed schema before opening a seller listener.

## Start in the existing workspace

Set the endpoint, user and password environment variables named by the original
source configuration. Use the existing secret configuration for the host. Then:

```sh
npx --no-install starforge clickhouse-workspace \
  --state /private/clickhouse-workspace --port 8443
```

For native paid execution, add `--facilitator HTTPS_URL` and install the original
native payment dependencies from the distribution guide. The default remains
`CHALLENGE_ONLY`; source/schema preflight is real, but the seller does not execute
a paid query. The original loopback facilitator option is
`--allow-local-facilitator`, used only with an explicitly selected local URL.

Open the complete printed workspace URL. Save the real source and merchant plan,
review its native schema and every complete ordered payment option, and prepare
the merchant using the existing workflow. Under **Prepared merchants**:

1. Select the prepared merchant. Enter a stable release ID and descriptive label
   under **Publish and roll back retained releases**.
2. Choose **Stage selected merchant**. Staging is offline. It verifies and copies
   the original ten-file package and binds the existing native review to the
   retained release. Repeating the same ID with identical source, review schema,
   label and selected runtime reopens that same release. Changed work needs a new
   ID.
3. Choose **Open release controls**, then follow its private console link. Stop a
   direct workspace merchant first if one is running. The console owns the
   original retained-release child; its operations stay available in that console.
4. Select the staged release and review its route, complete payment alternatives,
   query contracts, source limits and retained package identity. Enter the change
   note and choose **Select this release**. Selection uses the original current
   generation and does not switch a running seller immediately.
5. Choose **Start selected** or **Restart selected**. Restart drains the original
   owned seller before launching the selected version. The console exposes the
   actual customer API, live OpenAPI, merchant operations and private availability
   controls returned by that instance.
6. After staging a second version, use the same comparison and restart workflow.
   **Select previous release** records the original rollback selection; **Restart
   selected** then serves that retained version. A failed new start leaves that
   version selected and the seller stopped, so the operator can select the earlier
   version and start it explicitly.

The workspace retains this ordinary SF82 store at
`STATE/merchant-releases`. **Close controls and drain seller** closes the original
console and the seller it owns. Closing the workspace also drains its owned
console/seller. Reopen the same workspace state to recover release inventory,
selection and history; reopening starts no seller automatically. Closing a browser
tab alone leaves the launching process running.

The workspace shows the release runtime before staging. It inherits the CLI's
seller port and facilitator selection. Retained children use the original
ClickHouse command's seller capacity of 64 and 60-second drain grace; source
concurrency, query/scan/result limits and request timeout remain those of the
retained original source and service. The direct-workspace
`--max-in-flight`/`--drain-grace-ms` options apply to its direct merchant.

## Original release CLI

The installed command is `starforge releases`. From a source checkout, use
`node stellar/scf-starforge-20261009/sf82-seller-pilot/release-cli.mjs` in its place.
Prepare the original package first; the directory supplied below contains
`source.json`, `merchant-plan.json`, `service.json` and `client/`.

```sh
npx --no-install starforge releases init --store /private/clickhouse-releases
npx --no-install starforge releases stage \
  --store /private/clickhouse-releases --id transfers-v1 \
  --label 'Approved transfer query and terms' \
  --clickhouse-package /private/clickhouse-ready --port 8423
npx --no-install starforge releases console \
  --store /private/clickhouse-releases --port 8425
```

Add the selected `--facilitator HTTPS_URL` to **stage** for native execution; its
exact URL and local option are part of the retained runtime and release comparison.
This source form accepts no replacement handlers or upstream bindings.

The existing `list`, `inspect`, `diff`, `activate`, `rollback`, `status` and `run`
commands work on these releases. For a terminal-driven change, read `status` or
`diff` and pass the actual returned generation as `--expect`; do not substitute a
stale generation. `run` owns its foreground seller and Ctrl-C drains it. Stop an
existing manager in its own terminal or console before changing process ownership.

To stage another version, prepare a **new** ClickHouse directory from the revised
original source and plan, then stage it under a new release ID. The earlier retained
version is immutable. Direct bare-package staging verifies the original public and
typed input contract and uses fresh native preflight at each start. To retain the
workspace's prior native output-schema review as well, stage from that workspace.

## Customer delivery

Each retained release shown in the workspace has **Download retained client** and
**Download retained OpenAPI** actions. These continue to work after the former
prepared directory moves. The browser checks the response SHA-256 before saving.
The customer archive contains exactly:

| Member | Original product output |
| --- | --- |
| `openapi.json` | Prepared public API and exact payment alternatives |
| `client/seller-client.mjs` | Original generated JavaScript client |
| `client/seller-client.d.mts` | Its TypeScript declarations |
| `client/seller-openapi.json` | The exact OpenAPI bytes used by the generator |
| `client/package.json` | Original standalone client package |
| `client/README.md` | Its original usage guide |

SQL, source probes, private database configuration and credentials are excluded.
The prepared OpenAPI identifies the original preparation mode; the running
seller's **live OpenAPI** reports its actual current runtime mode. Use the original
merchant MCP client export below when a customer needs that exact running-instance
document. The existing generated-client/native buyer workflow and independent
customer spending cap remain unchanged.

## Bring the reviewed merchant into a fleet

Choose **Download fleet source** for a prepared merchant or **Download retained
fleet source** for an existing release. Both read the original verified package.
The retained form remains usable after the earlier prepared directory moves.

In the existing `/fleet.html` setup workbench, open the intended merchant and
registered source card, then choose **Import source JSON**. The source import
preserves that card's alias, replaces its source settings, and displays the
ordered native output-schema review. Review the original package path and
merchant host before exporting the fleet launch packet.

This private host file contains the existing native source alias fields:
`clickhousePackage`, optional `clickhouseColumnTypes`, and the selected
facilitator runtime. The fleet assigns its own fixed slot ports. Database
credentials remain in the merchant host environment. The original fleet setup,
stage, review, activation, operations, drain and rollback commands all consume
the same registered source and retained stores.

## Existing merchant MCP

Configure a new original MCP merchant against the host-selected package:

```sh
npx --no-install starforge merchant-mcp init \
  --dir /private/clickhouse-operator \
  --clickhouse-package /private/clickhouse-ready --seller-port 8423
npx --no-install starforge merchant-mcp serve \
  --config /private/clickhouse-operator/merchant-mcp.json
```

Use the original MCP bearer-token environment setup. Add `--facilitator HTTPS_URL`
to `init` when that is the selected runtime. An existing configuration can declare
another source alias with `clickhousePackage` and the original `runtime` fields.
When that package has a saved workspace review, retain its exact
`inspection.columnTypes` map as `clickhouseColumnTypes` on the same alias. The
original source inspector and stage operation validate it against the package,
include it in the execution identity, and require the same native types on start.
The `initializeMerchant` API accepts that same optional companion; aliases without
a saved map still perform the original native source preflight.
Arguments from an MCP client select that alias; they cannot select arbitrary host
paths, SQL or credentials.

Use the existing tools in order:

| Tool | Meaning for this merchant |
| --- | --- |
| `merchant_sources` | Verify the configured package, typed contracts, limits and full terms without connecting to the database |
| `merchant_stage` | Retain the original package under a new ID |
| `merchant_inspect` / `merchant_compare` | Read its exact digest and compare with the current selection |
| `merchant_activate` | Select that inspected digest using the current generation |
| `merchant_start` / `merchant_restart` | Open the original source and seller using the selected digest/generation and owned instance |
| `merchant_operations` | Return the original operations and private availability links for that instance |
| `merchant_catalog` | Read its actual health, complete offers and live OpenAPI |
| `merchant_client_export` | Produce the original five-file client from that running instance's OpenAPI in a new named customer directory |
| `merchant_rollback` | Select an inspected retained version using the original history and current generation |
| `merchant_stop` | Drain only the instance owned by this MCP process |

The MCP process and the browser console use the same original manager lock and
release history. They do not run the same merchant concurrently. To operate the
workspace's already-staged releases from an existing MCP configuration, set its
host `releaseStore` to the canonical `STATE/merchant-releases` directory and use
an existing private `exportsDirectory`; close the workspace-owned release console
before handing process ownership to MCP. Source aliases are needed only for new
staging. No new MCP tool or payment protocol is introduced.

## Retention and recovery details

The release adapter reads ten allowlisted original files with their existing
per-file limits and a 32 MiB aggregate limit. It verifies the native declaration,
original plan compiler, source/service bindings, full public OpenAPI and generated
client before copying. It rejects incomplete packages, changed bytes, symbolic
links and an output store nested inside the input package. The release manifest,
original offers and service bind the private copy by hashes. Inspection and
activation recheck those retained files; neither executes a query or starts a
listener.

Use the same installed compiler/client-generator version for preparation and
release operation. If the installation has changed since a package was prepared,
prepare a new directory from its retained source and plan with the current
installation. In the workspace, open its saved revision, run **Native review** and
**Prepare merchant**, then stage the resulting package. The previous working
directory and old release bytes remain unchanged. Preserve the matching original
installation with archived releases when moving them between hosts.

Mutable availability data lives separately under each release's
`clickhouse-runtime/availability`. The existing source preflight and merchant
shutdown close the source on failures. The SF82 manager's original readiness
handshake checks the exact retained offers/service and owns the started child.
The original release console supplies its own allowed navigation origin; private
operations API requests still require their own origin.

Keep the private release store, workspace revisions/reviews and original named
secret configuration in the host's existing backup process. If the live database
schema changes, reopen the saved source in the workspace, review the actual new
schema, and prepare/stage a new release. A column-type mismatch does not silently
rewrite a retained release. If a manager survives an interrupted controlling
session, the original status identifies its ownership; use that manager's existing
controls rather than launching a second seller.

Embedding applications may pass the host-only `env` option through
`startReleaseConsole` or `runActiveRelease`. It is copied into the original child
environment and is never stored in release JSON or exposed in browser responses.
The workspace also accepts an explicit `releaseRuntime` when supplied a custom
`nativeFactory`, because a JavaScript closure cannot be serialized into an
independent child. The normal workspace CLI derives this configuration from its
existing facilitator options. For a directly staged workspace-reviewed package,
the original `stageRelease` API accepts `clickhouseColumnTypes` alongside
`clickhousePackage`; the workspace supplies that map from its verified saved native
review.
