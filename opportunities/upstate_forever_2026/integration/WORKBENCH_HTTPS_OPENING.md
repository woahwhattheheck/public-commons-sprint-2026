# Open the existing workbench with its configured HTTPS connection

The original OPEN_WORKBENCH entry now owns an optional outbound native connector alongside its original operator. The qualified Linux receiving runtime runs both. There is one native operator, one original scientific queue, and one persistent connector instance.

## Configure the existing receiving machine once

Keep the original selected full application, qualified Python, scientific Workspaces and private operator-state directory. Receive the complete native connector source, lifecycle helper, component fragments and this guide through the ordinary cumulative installer. Its optional paths are:

- source_tools/eco_native_connector.py
- integration/NATIVE_HTTPS_CONNECTOR.md
- integration/component_fragments/native-https-connector.json
- source_tools/workbench_transport.py
- integration/WORKBENCH_HTTPS_OPENING.md
- integration/component_fragments/workbench-https-opening.json

The current source_tools/workbench_session.py receives seven exact lifecycle joins while retaining its original Windows shutdown, source selection, advertised-origin verification and opening behavior. The qualified Linux connector stays optional for every ordinary local receiving machine.

Put the existing owner-only connector JSON at PRIVATE_OPERATOR_STATE/eco-transport.json, or select its existing private path once with --connector-config PRIVATE_CONFIG on the normal launcher. The latter retains only its path in that receiving machine's workbench-transport.json. Keep those private files mode0600 and the private directories mode0700. The existing deployment owner supplies its actual canonical edge origin/operator ID and existing connector credential file. Native TeamAccess credentials preserve the intended recipient's Workspace and role permissions.

The private JSON follows the existing native connector contract:
```json
{
  "schema": "upstate.eco-native-connector/v1",
  "edge_origin": "https://EXACT_EXISTING_DEPLOYED_ORIGIN",
  "operator_id": "EXACT_EXISTING_OPERATOR_ID",
  "connector_token_file": "/existing/private/connector-token.json",
  "native_session_file": "/existing/private/operator-state/workbench-session.json",
  "native_token_file": "/existing/private/recipient-native-token.json",
  "application": "/existing/full/application",
  "state_directory": "/existing/private/eco-transport-state",
  "workers": 4,
  "max_spool_bytes": 10737418240,
  "native_timeout_seconds": 600
}
```

The configuration names this exact application's maintained workbench-session.json. The original operator creates that session record; the connector reads its actual current loopback port and binding. Use the existing separately scoped TeamAccess token file for a recipient. For the original private owner preview, the existing connector contract permits omitting native_token_file. Credential values stay in their existing private files.

Configuration is read BEFORE the launcher verifies or opens its native session. If the ordinary launch selection has no advertised origin, the private connector's exact edge_origin supplies it. An existing explicit/profile origin must match exactly. This prevents opening a native server that rejects the connector's original Host/Origin. Only the non-secret advertised origin can enter a saved portable launch profile.

## Normal opening and persistence

Use the SAME normal OPEN_WORKBENCH command, original profile and runtime arguments. The native server opens as before. After its authenticated original session is written, the original launcher starts the connector with the selected Python. Bv1.7 retries transient registration failures inside its existing transport; readiness is reported only after its actual connected event.

The original launcher prints concise workbench_https states and safe error codes. The private workbench-transport-status.json contains process IDs, state and original project/Workspace identities. It contains no credential, token, request body or private URL. Source/runtime/config/authentication failures remain concrete codes for the existing owner to correct. A changed private configuration, credential file or received connector source restarts a failed child against the SAME persistent journal. Unexpected child-process termination retries with a delay; protocol-level retries remain in the original connector.

A private owner lock prevents two normal openings from owning two connector children. Reopening an already-owned native session with its existing connector reuses that owner. When attaching transport for the first time to an already-running original native server, the reopening terminal owns just this connector; the original native server keeps its original owner. That same loop reuses the launcher's authenticated original-session verifier every five seconds, so a stale session file cannot keep transport running after its server disappears. Keep that terminal open for the connection.

Only a terminal connector_error suppresses crash restart until the existing configuration, credential file or connector source changes. Retained reconnecting/startup_retry messages do not prevent recovery after an unexpected process exit.

Ordinary Ctrl+C/native close stops this launcher's connector child and preserves the private config, connector instance, SQLite journal and spooled request/response bytes. A 15-second grace bounds connector shutdown; if needed, the launcher stops only its own connector child and leaves its retained journal for original recovery. The native server follows its unchanged graceful shutdown path. The next original normal opening automatically reloads that private selection, recreates only its connector process, and resumes the same connector instance and journal against the native session's actual new port. On Linux a parent-death signal also stops the owned connector if its launcher unexpectedly disappears.

## Study and per-project exports

The maintained portable application export already retains complete source_tools and integration directories. The lifecycle component declares its source, guide, exact original launcher and native-connector/recipient-opening dependencies. This makes the complete generic feature travel in every selected Study or whole-Workspace application export.

Private config, connector/native credentials, operator-state JSON, logs and the transport spool are required to be outside BOTH the application and scientific Workspace. They are therefore outside the original application/Study source closure. A receiving machine opens locally unless its owner supplies its own existing authorized transport configuration. Original scientific records, source-only saved worksheets and all completed model results retain their existing native transfer contracts.

## Actual receiving course

On the currently accepted whole-application Linux host, receive the current cumulative source and use its existing private opening/configuration. Read the connector's actual connected result, open the same canonical HTTPS origin and original project chooser, and operate the original saved source/download through that native app. Open a second independent browser tab, which now restores its non-secret session marker through the existing health endpoint before normal API authentication.

Close the original maintained launcher normally. Reopen through the same OPEN_WORKBENCH entry and same private state. Confirm the original connector instance and journal remain, the native loopback port is read from the new private session, and the original project/download still opens. Export the actual whole application/selected Study through its maintained per-project controls and verify that this complete generic source is included while receiving-machine secrets remain in the original private state.
