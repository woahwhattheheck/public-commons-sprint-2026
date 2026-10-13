# Migration Acceptance workspace

An editable migration application for an implementation team's source-to-customer receiving workflow. The application operates original dlt 1.31.0 and DuckDB, retains complete source and native pipeline state, and places business acceptance alongside full typed source/target parity. The actual data owner and customer keep the approved business rules and production decisions.

## What the application does

The browser operator and CLI share one authenticated, revisioned workspace. They retain inputs, compile and review exact native pipeline plans, operate extract/normalize/load or a complete run, and expose original failed-package/retry/abort controls without inventing a replacement loader. Every closed native job retains its complete files, original arguments, stage results and source/runtime identities.

The acceptance layer evaluates the complete population. It checks object keys, required columns, parent/child relationships, exact grouped counts and exact decimal/integer sums on both sides. It recomputes the original native comparator against the selected pipeline plan and complete observations. Duplicate multiplicities, schema differences, incomplete native results and pending or failed load packages remain relevant to readiness.

Measured findings are immutable. Acknowledgement records that a finding was read and leaves it unresolved. An accepted exception clears only an explicitly reviewable finding for that exact current report; it cannot clear required keys, native completeness or typed parity. Corrections create new source, pipeline, native verification and report editions. A current accepted selection binds the exact approved plan, completed explicit verify job, complete database, report and decision edition.

The consumer view exposes the retained complete native export selected by that binding. It does not claim to change an external application's connection string. Rollback restores the previous retained selection and its provenance. An imported legacy dlt selection is shown as legacy-unreviewed until business acceptance actually establishes the required evidence.

## Full receiving programmes

The first course uses the unchanged original dlt fruitshop resource functions: 13 customers, 3 inventory categories, 6 inventory rows and 100 purchases. The receiver keeps the complete original resource outputs. Its explicitly authored orphan edition changes only one retained purchase's customer reference, preserving the original preimage. Required acceptance holds; acknowledgement remains unresolved; a separately selected reviewable policy demonstrates a recorded exception. The corrected original source is then loaded and explicitly verified before accepted selection, rollback and reselection.

The primary browser exercises the actual reviewable finding and one lost acknowledgement through the application's original saved request. The final receiving browser reads the corrected project. Both preserve complete downloads, native typed rows, screenshots, actor boundaries, original request identities and historical handoffs.

The additive Chinook course uses the complete published 1.4.5 reference selected by the original source contributor. Its 11 tables and 15,607 rows retain original generator provenance, native SQLite source, all keys and relationships, every invoice control, exact amount arithmetic and source-local date text. It joins the same maintained application and receiving operation. These are public reference records, not customer data. See the original reference and integration guides for the precise source boundary and execution state.

Both courses retain complete editable application source and an original dlt runtime that can be rebuilt offline on a compatible receiving host. Portable workspace handoffs preserve history, all original native source and target files, acceptance inputs/reports/decisions, named prior handoffs and actual request receipts. Fresh, same, forward and older receiving preserve the selected history; an older package cannot silently replace a newer edition.

## Open the operator

Use Node 24 or later and the selected Python 3.12 runtime. No npm dependency installation or hosted CI is needed for this application's HTTP/UI source. The original Python environment is installed and verified through runtime/runtime.mjs, which uses the exact pinned whole dlt checkout, its original uv.lock, the selected uv executable and original DuckDB extra.

    node cli.mjs serve --directory /absolute/private-workspace \
      --auth /absolute/auth.json --runtime-ready /absolute/runtime/runtime-ready.json \
      --host 127.0.0.1 --port 8781

The auth file follows the unchanged original tjlabs.sling-auth.v1 schema:

    {
      "schema": "tjlabs.sling-auth.v1",
      "actors": [
        {"id": "delivery-operator", "name": "Delivery operator", "roles": ["operator"], "token": "REPLACE_WITH_A_PRIVATE_RANDOM_TOKEN"},
        {"id": "customer-reviewer", "name": "Customer reviewer", "roles": ["viewer"], "token": "REPLACE_WITH_ANOTHER_PRIVATE_RANDOM_TOKEN"}
      ]
    }

Store real tokens in a private local file, not in a delivered proposal. The server binds loopback by default. Its browser stores the selected private token and pending request in its original local browser state. The UI keeps mutation controls unavailable until the scope-bound pending request is loaded, preserves exact retries and treats validation, conflict and uncertain outcome distinctly.

## Run the complete original receiving operation

    node receiving/receive.mjs \
      --source /absolute/application \
      --directory /absolute/private-receiving-operation \
      --config /absolute/application/reference/programme.json \
      --runtime-ready /absolute/runtime/runtime-ready.json \
      --source-manifest /absolute/application/SOURCE_MANIFEST.json \
      --playwright /absolute/existing/playwright/index.js \
      --chromium /absolute/existing/chromium \
      --receiving-python /absolute/compatible/python3.12

Preserve that directory and add --resume after a closed interrupted attempt. The receiver verifies the complete source tree before creating its operation and keeps the original source, configuration, actor, origin, request and runtime selection. It never treats a transport timeout as permission to repeat an unknown native write. Original job controls and retained stage receipts govern recovery.

An explicitly supplied --receiving-runtime-ready must already be a complete compatible offline receiving result with the selected original portable archive identity. Otherwise the default receiving path reconstructs the environment offline in the same operation and validates every installed dependency identity. Runtime verification and native children hold the original kernel leases; the Python worker adopts the inherited job lock rather than opening a second owner.

## Readiness and delivery

Source review, syntax inspection, source-native execution, receiving, customer acceptance and payment are separate states. This source package contains the complete prepared implementation and programme. A native completion claim requires the actual operation's CUSTOMER_RESULT.json and its reopened artifacts. The operator's source-only validation records do not substitute for that result.

The complete result binds all named files by bytes and SHA-256, including both browser result manifests and every browser download or image, full native observations, complete handoffs and offline runtime receiving. Completion candidates are tied to the selected source edition and adoption history. A reviewed source correction preserves both complete source editions and the original interrupted operation before continuation.

Read OPERATOR.md for every workflow, COMMISSIONING.md for input and owner responsibilities, WORKSHARE.md for reusable technical scope guidance, runtime/OPERATING.md for original runtime installation/offline transfer, and reference/MIGRATION_SOURCE_AND_ACCEPTANCE.md plus CHINOOK.md for the original relational course.

## Source and licence

The original dlt application and its complete retained upstream contracts remain under vendor/dlt. Their source files and licence notices are unchanged. The root application composes those original stage, custody, archive, exact comparator and lease implementations. It adds the acceptance workflow and complete commissioning UI without substituting a mock pipeline or data engine.

All selected files are listed in SOURCE_MANIFEST.json. Source and outcome provenance is recorded in SOURCE_REFERENCES.json. Original third-party licences are retained in their original cohorts.
