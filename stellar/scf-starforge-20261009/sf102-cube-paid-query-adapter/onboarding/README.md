# Cube merchant onboarding

Turn an actual Cube member catalog and a merchant's selected reports into a
private, reusable seller package. This workflow composes the existing SF102
query compiler and handler, SF30 offers and runtime, and SF88 buyer preparation.
It supports multiple reports and complete payment options without editing those
components or maintaining a separate payment implementation.

The source metadata, report plan, examples, selected terms, and generated files
remain bound by saved byte digests. Preparing, reopening, exporting, inspecting,
and creating a buyer review draft require no credentials or network. Capture and
probe commands contact only the explicitly configured Cube backend through the
original upstream transport.

## 1. Read the actual member catalog

Set `SCF_ROOT` to your installed `stellar/scf-starforge-20261009` directory and
`CUBE_ONBOARD` to its `sf102-cube-paid-query-adapter/onboarding/cli.mjs` file.
Save the deployment's original `/meta` response using the same Cube authorization
context that will serve the reports. To capture it through the existing SF30
transport, create a private `upstream.json`:

```json
{
  "origin": "https://YOUR-CUBE-HOST",
  "path": "/cubejs-api/v1/load",
  "authEnv": "CUBE_API_AUTHORIZATION"
}
```

Supply the complete authorization header through `CUBE_API_AUTHORIZATION` in the
operator environment. The workflow stores the variable name. It never copies the
value into metadata, plans, packages, or probe receipts.

```sh
node "$CUBE_ONBOARD" capture-meta \
  --upstream /private/upstream.json --out /private/cube-meta.json
node "$CUBE_ONBOARD" metadata --file /private/cube-meta.json
```

`--path` selects a fixed metadata path for deployments with a custom Cube base
path. Capture uses the original transport's 1 MiB response cap. You can also
import an already saved UTF-8 `/meta` response up to 16 MiB. Explicit
`"allowLoopback": true` in upstream configuration supports an owned local
`http://127.0.0.1:PORT` backend using the original transport option.

Cube's [REST API reference](https://docs.cube.dev/reference/core-data-apis/rest-api/reference)
defines a `cubes` array containing cubes and views, with member arrays such as
`measures`, `dimensions`, and `segments`. The workflow keeps exact member names;
a displayed cube name does not determine the case or prefix of a member. It
excludes explicitly nonpublic entries and does not publish the complete catalog.

## 2. Select reports and set merchant terms

Copy [merchant-plan.example.json](merchant-plan.example.json) to a private file.
Replace the example hostnames, members, input choices, and payment placeholders
with the merchant's actual selections. The example is an editable format sample;
it is not a catalog fetched from a merchant or a funded payment configuration.

The plan supports 1–24 named reports. Each report contains:

- A fixed Cube `query`, a public `description`, and an `inputs` object. Use `{}`
  for a report that accepts no query parameters.
- An exact example and description for every input. Enum examples are strings,
  date examples are `YYYY-MM-DD`, and integer examples are JSON integers. All
  declared inputs are required and must be used in the original query template.
- An optional original `range` guard for public start/end dates. It must refer
  to the date inputs actually used by each public date-range pair.
- Optional report-specific `payment` or `paymentOptions`. Otherwise the complete
  plan-level terms apply. All network, asset, payee, amount, timeout, and extra
  fields remain together in their original option order.

Prices are explicit atomic decimal strings. The workflow uses the original SF30
term validation; token decimal interpretation, address ownership, and settlement
remain at their existing payment boundaries. It does not infer prices or convert
between payment options.

The original [Cube query format](https://docs.cube.dev/reference/core-data-apis/rest-api/query-format)
determines the supported template profile:

| Input or query field | Onboarding behavior |
| --- | --- |
| Measures, dimensions, segments, filter and ordering members | Must be fixed names present in the saved metadata, with the corresponding member kind. |
| Time dimensions | Must have metadata type `time`. Granularity is fixed or an enum of supported default/custom names from that member. |
| Filter values | Strings or permitted nulls. Public substitutions use string enums; date operators accept date inputs. |
| Integer inputs | Used for a bounded nonnegative `offset`. Integer substitution into a filter is rejected because the original renderer produces numbers and Cube filters require strings. |
| Row limit | A fixed integer from 1 to `min(1000, upstream.maxRows)`, matching the original compiler. |
| `and` / `or` filters | Each logical group uses either measure filters or dimension filters, following Cube's separate aggregation semantics. |
| Public date ranges | One date, the same date repeated, or a matching start/end pair with the original range guard. |
| Ordering and timezone | Literal values or restricted enums. A buyer cannot choose another member or supply an arbitrary Cube query. |

The original `maxDays` guard compares the difference between the two dates.
Cube includes both dates and pads the end to the end of its day, so `maxDays: 31`
can include 32 calendar dates. Fixed relative ranges retain Cube's semantics and
are not reproducible data snapshots. The workflow uses one row-oriented result;
data blending and `compareDateRange` need a different result shape and are not
accepted by this package profile.

An `outputExample` is optional merchant-provided documentation. Preparation never
fills one with invented query results. Unknown metadata members or wrong member
types produce a preparation error, before any directory or backend call.

## 3. Prepare, reopen and probe

```sh
node "$CUBE_ONBOARD" prepare \
  --metadata /private/cube-meta.json --plan /private/merchant-plan.json \
  --dir /private/cube-merchant
node "$CUBE_ONBOARD" review --dir /private/cube-merchant
node "$CUBE_ONBOARD" probe --dir /private/cube-merchant \
  --report daily-count --out /private/daily-count-probe
```

Preparation compiles the original templates, renders every exact example, and
builds original seller offers. Review can run in a fresh process with the Cube
credential absent. It shows the selected members, actual rendered requests,
public inputs, limits, complete payment options, and recorded exports/probes.

The probe performs one merchant backend read of the saved example using the
original Cube handler. It records the actual response privately, retaining
numeric strings, status, row count, source URL, and query/response digests. It does
not go through a buyer, sign, settle, or automatically retry. Probe results are
not copied into the public buyer package. A reopened historical receipt is
marked `RECORDED` with `filesRevalidated: false`; it does not claim to have
rechecked an external output directory.

## 4. Export and launch the original seller

```sh
node "$CUBE_ONBOARD" export --dir /private/cube-merchant \
  --out /private/cube-package
node "$CUBE_ONBOARD" inspect-package --package /private/cube-package
node /private/cube-package/launch.mjs --runtime "$SCF_ROOT" --port 8423
```

The package can be moved to a machine with the maintained Stellar Forge runtime.
It includes the saved source metadata and plan, original Cube adapter config,
original seller config, compiled catalog and OpenAPI, public report/input
documentation, buyer instructions, and a small launch entry point. The runtime
validates their saved bytes and recompiles the native bindings before launch.
Directories and files must retain permissions 0700 and 0600.

The launcher calls the original `serve.mjs`. Its trusted handler module composes
`createCubePaidHandler` with an admission hook that calls `renderCubeQuery` before
the payment lifecycle in `NATIVE_X402` mode. In that mode, invalid, repeated,
missing or unknown inputs receive 400 before payment, and a valid unsigned
request reaches the original 402. The original `CHALLENGE_ONLY` mode advertises
402 metadata without running application admission or contacting Cube.

For native payment and the original operations dashboard:

```sh
node /private/cube-package/launch.mjs --runtime "$SCF_ROOT" \
  --port 8423 --facilitator https://YOUR-CONFIGURED-FACILITATOR \
  --operations-port 8424 --history-dir /private/cube-usage
```

The original launchers own facilitator validation, payment handling, graceful
drain, and usage history. Use their pinned dependencies for native mode. Both
listeners bind to loopback; the seller's HTTPS proxy must match the exact
`publicOrigin`. Keep the operations listener private. Health, readiness,
developer documentation, and generated clients use the native reserved routes.

Share `catalog.json`, `reports.json`, `openapi.json`, and `BUYER.md` with a buyer.
Keep the complete merchant package private. The saved OpenAPI describes the
default challenge-only launch; the running portal reports the actual mode.

## 5. Prepare the buyer's exact operation

```sh
node "$CUBE_ONBOARD" buyer --package /private/cube-package \
  --report daily-count --accept 0 --intent-id october-first-report \
  --out /private/report-review.json
node "$SCF_ROOT/sf88-operator-buyer-cli/cli.mjs" \
  --review --config /private/report-review.json
```

Add `--inputs /private/inputs.json` to supply an object of HTTP query strings;
otherwise this uses the merchant's saved example. The command selects one
explicit original payment option, validates the complete request, and invokes
original SF88 `prepareReview`. It preserves the original listing and exact
selected terms in the resulting review config.

Continue with the existing [SF88 workspace and buyer setup](../../sf88-operator-buyer-cli/README.md).
Those components own signer configuration, operator approval, budgets, execution,
response files and recovery. The onboarding package does not supply buyer keys
or spending authorization.

Source files, workspaces, exports, probe destinations and buyer drafts use
create-only writes. Reopen the existing workspace to continue its handoff. For
changed reports, prices, or metadata, prepare another immutable workspace and
export to a new directory. A partially written directory without its final
manifest is incomplete and cannot be launched; choose a fresh destination after
correcting the underlying filesystem error.
