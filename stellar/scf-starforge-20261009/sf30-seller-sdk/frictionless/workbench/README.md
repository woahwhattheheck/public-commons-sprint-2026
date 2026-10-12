# Frictionless source workbench

This workbench turns an existing Frictionless merchant publisher into a complete source-onboarding workspace. Operators inspect host-declared inputs, retain the original capture, author ordered query projections, review every selected row, choose the publisher's reviewed source and save its original publication plans. Source receiving carries the exact capture, query text, native reviews and edition history to the next operator.

The product uses the original Frictionless parser, source archive, publisher, scheduler and merchant MCP server. Its private workbench journal records the additional intake, source-edition and review workflow. The existing publisher owns extraction, candidate review, publication, dataset generations and schedules.

## Installed entry points

Choose **Frictionless source workbench** in installed Applications or use:

~~~sh
stellar-forge frictionless-agent inspect --config MERCHANT.json --workspace ALIAS
stellar-forge frictionless-agent serve --config MERCHANT.json --workspace ALIAS --port 0 --mcp-port 0
stellar-forge frictionless-source --help
~~~

The existing **stellar-forge frictionless workbench** command exposes the same source client. Full host configuration, browser steps and agent tools are documented in [FRICTIONLESS_WORKSPACE.md](../../../../../stellar-forge/mcp-merchant-operator/FRICTIONLESS_WORKSPACE.md). Complete delivered-source instructions are in [RECEIVING.md](RECEIVING.md).

Configure a workspace alias against an already declared publisher of kind **frictionless**. Its inputs are host-declared descriptor files, public HTTPS descriptors or complete original source archives. The built-in **current** alias points to the publisher's presently selected source. A client selects aliases; it does not supply arbitrary filesystem paths or new credential destinations.

## Complete operator workflow

The browser opens the source panel above the existing publisher controls.

| Screen | Operator outcome |
|---|---|
| Source inputs | Inspect the declared input identity and explicitly retain one complete native capture. |
| Resources | Read original schemas, field inspection, rights/references and every captured file. |
| Source editions | Author ordered projections or edit exact query JSON; retain each revision as an immutable edition. |
| Review and select | Run the original full native review, read its findings and select a reviewed edition with the current publisher source hash. |
| Publication plan | Obtain the native query's original plan template, save it with a stable request identity and open that exact plan in the existing publisher. |
| Compare captures | Read the original descriptor, schema, dialect and file-hash comparison between two retained source captures. |
| Source receiving | Export the source archive and all selected-edition commissioning records, then receive every declared file. |
| Requests | Inspect actual native outcomes, open saved inputs/results and explicitly resume or cancel the original request. |

Intake retains a capture even when a suggested query still needs correction. Source edition creation and full review use the existing native validators. A completed review operation and a successful source review are separate states; publication requires an applicable successful review.

The query editor accepts **queriesText**, an exact JSON string. Original source inspection provides this string from Python serialization. Large integer constraints and column insertion order therefore survive browser/client reopen. Structured **queries** remains supported for safely representable input. Native numeric and missing-value semantics remain with the original parser.

## Publisher source selection and original plans

The maintained publisher now supports source selection only for its opting-in Frictionless driver. Selection runs under the original writer and checks the current source hash and the selected immutable source bytes. The original configured source remains in the workspace metadata as its initial binding; the latest retained source selection supplies subsequent operations.

Before the first selection, the workspace marker advances to the Frictionless-compatible v2 form. A runtime that only understands the original v1 marker cannot silently continue using the initial source. The maintained Frictionless driver, merchant configuration reader and release path all recognize the new marker.

Source selection and its original event commit together. Publication-plan saving optionally receives a caller-retained request UUID; the plan, its request binding and original event commit in the same transaction. A repeated exact request resolves the original saved plan, including after a lost response. Previously saved plans retain their own source capture and can still be inspected.

Opening a saved plan in the browser delegates to the original publisher host. The original dirty-plan confirmation, native validation and extraction/review/publication flow remain in force.

## Requests, files and ownership

The private workbench directory is inside the original publisher workspace. It uses the maintained Linux writer lease and a full-sync SQLite journal. Each mutation retains its UUID, exact ordered input and applicable version before work begins. Startup marks an ended active request interrupted; it does not launch it.

Native operations use the original source process runner. Closing the workbench cancels and drains only its own active source task. The merchant borrowing lease owns the workbench model, retained readers and borrowed browser, and releases them before the original publisher owner closes.

The source browser is an original loopback, origin-checked publisher listener. MCP authentication stays with the original merchant server. Browser capability/instance details are not embedded into portable source files.

Complete native inspection, review and comparison reports are retained as the original Python response bytes. Browser summaries are views; their corresponding file downloads preserve the full original JSON. Export snapshots freeze the original edition, capture inspection, all then-retained reviews, source-selection history, saved-plan bindings and receiving guide before native source export begins.

The agent file and download interfaces reuse the original retained-file reader and resumable downloader. A descriptor binds workspace/export identity, original manifest, each file's full digest and its byte offset. Original reader release and owner reopening are handled by that same client.

## Native model and browser integration

The model entry point is **openFrictionlessSourceWorkbench({publisher, inputs, environment})**. It receives an already owned original Frictionless publisher. Its methods expose status/current/input/capture/edition/review/planInput/comparison/operation, explicit start/resume/cancel/wait and exact retained files.

The server entry point is **startFrictionlessSourceServer({workspace, port, ownsWorkspace, schedule})**. A borrowed listener requires the owner's original scheduler and closes only its listener. The merchant adapter borrows through the existing MerchantPublisher lifecycle; it does not open a parallel publisher.

The source-owned distribution contribution includes the command aliases, client exports, merchant provider, Applications provider, complete browser assets and receiving guide. The original Frictionless distribution supplies its maintained parser and optional Parquet decoder closure.

## Receiving and validation scope

Use [RECEIVING.md](RECEIVING.md) to download and reopen the full source handover. Use the original dataset/SF100 and customer workflows when a delivery also includes published data, customer reports or a warehouse.

This source change does not record a new provider purchase or customer acceptance. Native operating results belong to their explicit original operation records. The original NOAA customer operation remains a separate retained run using its already captured public input.
