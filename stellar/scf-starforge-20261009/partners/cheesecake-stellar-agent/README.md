# Stellar agent application

A complete receiving application for selected original Stellar merchant requests. It combines the maintained native buyer, exact request review, application authorization, the existing MCP transport and an industrial browser.

Start with [OPERATOR.md](OPERATOR.md) for the complete receiving installation, configuration, review, execution, result and recovery flow. [SCOPE.md](SCOPE.md) describes the Cheesecake Labs implementation workshare and acceptance inputs.

## Source entry points

| File | Responsibility |
| --- | --- |
| `application.mjs` | Original handoff validation, retained subject/request binding, native buyer and fixed agent tools. |
| `configuration.mjs` | Trusted receiving-host paths, operator selection and authorization module. |
| `cli.mjs` | Source verification, request review, original execution, recovery and result export. |
| `server.mjs` | Authenticated HTTP application and the maintained MCP transport. |
| `ui/` | Requests, review, explicit execution confirmation, original operation and result workflow. |
| `operations/operator_receiving.cjs` | Same-state receiving operation for the supplied reference, real Chromium and server restart. |

The original runtime is selected explicitly from source `f8db4d8cff51ace62bb7b25655131aaed78bdde8`. Configure its actual installed SF88 directory and the exact retained buyer handoff in `application.example.json`; create the private empty state directory before first open.

```sh
node cli.mjs verify-source --config /private/application.json
node cli.mjs list --config /private/application.json
node server.mjs --config /private/application.json --port 8767
```

The server receives `STELLAR_APP_ACCESS_TOKEN` through the protected process environment. Its host supplies the authenticated subject and current authorization lookup. The original native buyer retains approval, signer, spending ledger, one attempt and saved-result authority.

The completed reference operation on 12 October 2026 imported and reopened four exact original requests, completed browser and native MCP review, preserved native PREPARED states through a clean server restart, and displayed the original result-availability response. The kit includes its complete receiving record and the separate actual Gateway provider observations.

Licensed under the repository's [MIT license](LICENSE).

