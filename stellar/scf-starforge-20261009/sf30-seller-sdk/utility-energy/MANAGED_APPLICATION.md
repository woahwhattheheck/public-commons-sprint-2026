# Managed Utility operations

The Utility application runs the original UtilityAPI and Green Button workspace inside the maintained runtime Applications lifecycle. Review the selected runtime, workspace, Python interpreter and source binding, save the application, and start it through the existing worker. The original Python process owns its source database, capture journal, publisher and local HTTP console. Browser and MCP clients attach to that console.

The complete customer workflow remains in [README.md](README.md). The agent interface and retained file receiver are documented in [UTILITY_ENERGY_WORKSPACE.md](../../../../stellar-forge/mcp-merchant-operator/UTILITY_ENERGY_WORKSPACE.md).

## Receive the original workspace

Use an existing private Utility workspace or initialize one with the maintained command:

~~~sh
starforge utility-energy --workspace /private/utility-customer init
~~~

A customer packet uses the original reconstruction command. Keep its exact received SHA256:

~~~sh
starforge utility-energy --workspace /private/utility-received restore \
  --file /private/incoming/utility-workspace.zip \
  --sha256 RECEIVED_PACKET_SHA256
~~~

The native packet preserves the original imports and raw XML/JSON, capture pages, source and mapping identifiers, reviewed selections, native editions, comparisons, bill reconciliations and completed action history. Its reconstruction verifies the original source and dataset identities. A restored workspace has its own physical directory and database identity; inspect and bind that actual receiver.

## Review and save in Applications

Open the maintained runtime workspace, register or reopen the original managed home and runtime, and select **Utility data workspace** in Applications. Its product-owned provider appears through the existing utility-energy contribution.

| Field | Operating meaning |
| --- | --- |
| Original Utility workspace | Existing absolute private directory initialized or received by the Utility command. |
| Existing Python executable | Absolute selected Python 3.11 or newer executable with Expat 2.6 or newer for the original XML parser. |
| Console connection file | Optional new private filename for the original console URL. Use this to attach the Utility MCP provider. |
| Environment file | Existing Applications private environment file, including source token environment references and selected native runtime variables when used. |
| Port | Original local listener port; zero selects an available loopback port. |

Use the existing Review, Save, Connect and Review Start flow. Review Start executes the read-only Utility binding command with the selected interpreter and runtime. It checks the original NDJSON workspace marker, its current directory and database identity, the Utility application marker, Python and Expat versions, and every source member in the application binding.

The binding contains the native source SHA256 map. It covers the original NDJSON/XML adapter, Utility source/analysis/delivery/publisher, browser assets, source contracts, command and startup helper. The complete installed distribution manifest remains the authority for the rest of the selected source and dependencies. Replacing a selected executable, source member or workspace identity requires a new review.

## Start, connect and stop

Start uses the original managed worker, request identity, resource lease, environment and operation history. Its resource key uses the existing NDJSON workspace directory, so the same physical source workspace has one original owner.

The application prints one startup record with schema:

~~~text
stellar-forge.utility-workspace-launch.v1
~~~

The maintained observer verifies that record against the saved start request, selected adopted source, interpreter, workspace binding and expected port. It then reads the same authenticated loopback /api/launch response before retaining the application URL. Open uses that retained URL. The optional connection file contains the original private one-line console URL and is written by the console owner.

Stop first removes live readiness, shuts down the accept loop and drains accepted HTTP requests. The original owner then closes its publisher child, database and workspace lease. The connection file is removed only when it still contains the URL written by that owner. The original Applications record, logs and completed customer work remain available for reopen.

A running browser or MCP attachment must refer to this same owner. The Utility MCP **reopen** operation drains its client-side requests and rereads the original connection file after the same console restarts. It checks the original workspace and binding identity before reattaching.

## Direct command operation

The same implementation is available without the Applications browser:

~~~sh
starforge utility-energy --python /absolute/python3 \
  --workspace /private/utility-customer binding
~~~

The response includes schema stellar-forge.utility-managed-binding.v1, the original workspace identity, source map, parser and interpreter, and sha256. Start with that reviewed digest:

~~~sh
starforge utility-energy --python /absolute/python3 \
  --workspace /private/utility-customer serve \
  --expected-binding REVIEWED_BINDING_SHA256 \
  --connection-file /private/utility-console.url \
  --startup-format json --port 0
~~~

The existing legacy console URL output remains available when expected-binding is omitted. The authenticated /api/launch endpoint supplies the same original startup identity for client attachment.

## Recover original work

Read the original action inventory and exact saved UUID after an interrupted capture, review, build, export or publisher response. Completed actions return their saved result for the same fingerprint. A failed or interrupted result remains available through the operation reader; continue from the retained source/capture/publisher state.

The original capture journal retains its page and provider continuation. Resume that capture through capture.resume and capture.advance. Keep the same original selected meter/collection/time-window profile.

Before changing a reviewed interval selection, inspect its preview, source priority, meter and channel identity, units, coverage and issues. Save a new reviewed selection and build a new native edition. The original comparison reports exact row changes; it retains unchanged rows and previous review history.

Customer export, whole workspace packet, original source files and native dataset packets remain available from the original console. MCP file preparation retains one complete native response; subsequent download continuation reads that retained file and its manifest. Reopening a completed download verifies the same manifest and file hashes locally.

## Source integration

The existing distribution/contributions/utility-energy.json declares applicationProviders.utility-energy. The adapter is application-provider.mjs, its original binding implementation is managed.py, and Applications preparation and live startup verification are managed-application.mjs. The shared Applications registry and lifecycle remain the original implementations.

No separate workspace database, capture engine, interval calculation, dataset publisher or runtime launcher is introduced.
