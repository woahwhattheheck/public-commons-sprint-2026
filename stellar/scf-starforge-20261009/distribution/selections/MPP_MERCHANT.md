# Native MPP merchant and customer installation

The `mpp-merchant` selection delivers the original native MPP console, merchant and customer workbench, managed Applications launcher, merchant MCP, generated customer clients and complete file receiving. Its source archive carries the selected recipe and the original Git identities of its implementation.

## Receive one selected release

Build from a complete checkout containing this recipe. Select the full commit that the receiver intends to operate, then retain the returned archive path, byte count and SHA-256 together with its source manifest.

```sh
node stellar/scf-starforge-20261009/distribution/build.mjs \
  --repo /absolute/original-checkout --ref FULL_SOURCE_COMMIT \
  --selection mpp-merchant --out /absolute/private/mpp-release
```

The original builder reads committed source. The selection keeps its explicit command and export roots, follows their native JavaScript imports, and retains the original components required by runtime path lookups. These include the complete MPP source, templates and browser assets; SF36/SF54/SF59/SF62 governor and approval modules; SF86 observation data; SF82 release storage; the managed PTY worker, managed command launcher and runtime browser assets. Native modules keep their existing implementations and filesystem relationships.

Continue an interrupted build in its original output directory:

```sh
node stellar/scf-starforge-20261009/distribution/build.mjs \
  --repo /absolute/original-checkout --out /absolute/private/mpp-release --resume
node stellar/scf-starforge-20261009/distribution/build.mjs \
  --out /absolute/private/mpp-release --status
```

The saved output retains its original source commit and selection. Use a new output directory for a different release. An archive's actual manifest and hash identify the release received by the next operator.

## Install the application runtime

Use the retained original runtime installer from the source checkout. Linux, Node 22.16 or newer, Python 3.11 or newer, npm and `flock` are required. The MCP feature supplies the original merchant agent dependencies; the operator selection supplies its maintained Python runtime.

```sh
node stellar/scf-starforge-20261009/distribution/runtime-install-cli.mjs prepare \
  --dir /absolute/private/mpp-application-runtime \
  --archive /absolute/private/mpp-release/ORIGINAL_ARCHIVE.tgz \
  --sha256 ORIGINAL_ARCHIVE_SHA256 --feature mcp --operator
node stellar/scf-starforge-20261009/distribution/runtime-install-cli.mjs install \
  --dir /absolute/private/mpp-application-runtime
node stellar/scf-starforge-20261009/distribution/runtime-install-cli.mjs inspect \
  --dir /absolute/private/mpp-application-runtime --load --source
```

Use the actual archive filename and SHA from the completed builder. The installer preserves source under `package/` and the selected application dependencies beside it. Its `READY` result is the actual installation result. `prepare` produces a reviewable installation before dependency receiving completes.

An existing compatible dependency installation can be received through `install --adopt-existing` in the prepared runtime. It requires the complete original selected dependencies and lock already in that destination. The installer checks them through its ordinary lease and source-selected profile. For a partially completed normal installation use `resume --dir SAME_DIRECTORY` with the same original cache and Node headers when required.

To upgrade, use the original `runtime-install upgrade --from OLD_DIRECTORY --dir NEW_DIRECTORY --archive ORIGINAL_ARCHIVE.tgz --sha256 ORIGINAL_ARCHIVE_SHA256 --feature mcp --operator` path. Keep the old installation and its application registration available through receiving. Register the actual following READY installation in the existing Runtime workspace before selecting it in Applications.

Once installed, invoke the original commands through the runtime installer:

```sh
node stellar/scf-starforge-20261009/distribution/runtime-install-cli.mjs run \
  --dir /absolute/private/mpp-application-runtime -- mpp --help
```

The examples below use `starforge` as the installed command. The same arguments can follow `runtime-install run --dir ORIGINAL_RUNTIME --`.

## Receive the native MPP SDK separately

The merchant and customer profiles select a separate absolute `dependencyRoot`. This is the original MPP SDK runtime:

| Package | Exact native version |
| --- | --- |
| `@stellar/mpp` | `0.7.1` |
| `mppx` | `0.6.29` |
| `@stellar/stellar-sdk` | `15.1.0` |

The application distribution's MCP and optional Stellar dependencies remain in its own installation. The original native loader resolves the MPP peer set from the profile's `dependencyRoot`.

```sh
starforge mpp runtime-receive /absolute/private/mpp-native-runtime \
  --cache /absolute/private/mpp-native-archives --cache-limit-bytes 4194304
starforge mpp runtime-receive /absolute/private/mpp-native-runtime --inspect
```

The maintained Python receiver streams the original locked archives, verifies their SHA512 integrity, preserves nested package paths and executable links, and checkpoints completed packages. Repeating the command continues that same installation. The 4 MiB partial cache retains verified archives while space allows; receiving continues on the installation filesystem when persistent cache space fills. `--offline` requires every still-needed archive to be present in the selected cache. `MPP_RUNTIME_PYTHON` can select an existing Python executable.

Alternatively, the original `runtime-template` command followed by `npm ci --ignore-scripts --omit=dev --no-audit --no-fund` installs the same manifest and lock. Reuse a matching retained original native runtime when one already belongs to the receiving operation.

## Open the original private workspace

Create a new native workspace in an existing private parent, or use the original initialized directory and retained customer/merchant configuration:

```sh
starforge mpp init /absolute/private/mpp-workspace
starforge mpp serve /absolute/private/mpp-workspace 8787
```

The CLI takes a positional port. Port `0` selects an available loopback port. Its private startup URL opens the original workbench. The browser console and merchant listener use separate ports. The merchant's actual public HTTPS origin and reverse proxy remain the operator's selected deployment.

For an existing merchant MCP host, launch the console with `--token-env MPP_CONSOLE_TOKEN` and supply that same existing environment value to both owners. The native token must be exactly 64 lowercase hexadecimal characters. The variable name is retained in configuration; the private browser URL carries its authentication fragment.

## Save, start and operate in Applications

Open the existing Runtime workspace and its **Applications** page. Select the actual READY installation and **MPP merchant and customer**. Enter the initialized private workspace, local port, optional console token environment name, existing terminal Python executable and private environment JSON file.

Use **Review application → Save application → Review start → Start reviewed application**. The review binds the original source, private workspace creation identity, current profiles and selected environment. **Open application** appears after the actual native startup record and authenticated console identity match the original managed wrapper and child process. The original managed terminal stays with that application.

Within the workbench:

1. **Merchant** saves the selected public HTTPS origin, HMAC secret environment name, native dependency directory and real payment routes. Start its listener after saving. Read its configured profile and listener identity from the returned state.
2. **Customer handoff** provides the actual merchant contract, OpenAPI document and complete generated customer package.
3. **Customer workbench** receives the original contract or package, reviews the original payer, governor, asset and fee limits, then saves the selected profile. Preview retains the exact method, full URL and JSON body before preparation.
4. Preparation retains the actual native challenge under a chosen original purchase ID. Execution presents the original governor approval in **Application output**. Submit the displayed response through **Send line to original terminal** when the operator approves that purchase.
5. Purchase history, job inspection, response download, original resume, delivery recovery and independent finality reconciliation remain in that same workspace.

An idle merchant listener can have zero active requests. Use the returned merchant object and its profile/port identity to identify the listener; its `active` count measures in-flight requests.

## Attach the maintained merchant agent

Keep the original native console running in its Application or original terminal. Save the private MPP connection file with schema `stellar-forge.merchant-mpp-connection.v1`, the actual announced loopback origin, original workspace, token environment name and named customer configuration files. Each customer's configuration points to that same native workspace and its original governor, signer environment, native dependency directory and limits.

```sh
starforge merchant-mcp init-mpp \
  --dir /absolute/private/mpp-agent \
  --connection /absolute/private/mpp-connection.json
starforge merchant-mcp serve \
  --config /absolute/private/mpp-agent/merchant-mcp.json --port 3211
```

The original merchant HTTP or stdio host exposes the native MPP tools. The agent's incoming MCP access configuration is separate from the console token. Use the endpoint and access mode returned by that actual host.

Begin with `merchant_mpp_consoles` and `merchant_mpp_status`. Receive the original contract or bundle, then retain a stable customer review ID and its returned SHA. Configure that exact reviewed profile before request preview and preparation. Payment jobs retain their original purchase IDs through execute, resume and finalize. The original console continues to own the workspace and the approval terminal.

The complete connection schema, tool arguments and receiving sequence are in the retained source guide `stellar-forge/mcp-merchant-operator/MPP.md`.

## Receive the complete customer deliverable

CLI receiving uses the original native generator and manifest:

```sh
starforge mpp customer-export /absolute/private/mpp-workspace /absolute/private/customer-package
starforge mpp customer-inspect /absolute/private/customer-package
starforge mpp customer-resume /absolute/private/customer-package
```

Run a workspace-owning CLI export after its console closes, or use the original live console or merchant agent export while the console owns it. The generated package includes the original contract, OpenAPI and Node/TypeScript/Python client sources and configuration templates. Fill the actual customer configuration from those retained templates; retain its original offer, native runtime, payer, governor and transport selections.

For a received original bundle, use `starforge mpp customer-receive ORIGINAL_BUNDLE.json NEW_CUSTOMER_DIRECTORY`, then inspect or resume that exact directory. Agent exports retain their export ID, manifest SHA and original payload. Download all manifest members, preserving their bytes and paths, through the original resumable receiving helper.

Purchased resources remain separate from the client package. Inspect the saved purchase and response status, then export its original response with `starforge mpp export ORIGINAL_WORKSPACE purchases ORIGINAL_PURCHASE_ID NEW_ABSOLUTE_OUTPUT` after that workspace's console closes, or download from the running original interface.

## Continue the original operation

| Saved state | Continuation |
| --- | --- |
| Source build interrupted | Same output directory and `build --resume` |
| Application installation interrupted | Same installation and `runtime-install resume` |
| Native SDK archive receiving interrupted | Same `mpp runtime-receive` destination and original cache |
| Application Start response missing | Reopen its saved operation and continue the original start |
| Application stopped | Fresh start review against the same retained workspace |
| Native job request interrupted | Inspect its original job and purchase before continuing |
| Signed purchase or transfer response interrupted | Original `resume` purchase ID |
| Retained response awaits independent finality | Original `finalize` purchase ID |
| Merchant resource delivery unfinished | Original `recover-delivery` delivery ID |
| Customer package interrupted | Original receiving directory and `customer-resume` |

Use **Stop application** to drain the original console jobs and merchant listener and release its native lease. A subsequent start can use new loopback ports while preserving the original workspace, purchases and source-bound profiles. A browser refresh or a missing command response is reconciled through the existing process lifecycle.

Preserve the full private native workspace, selected native dependency directory, original governor policy/ledger and its host-held keys, merchant resource files and any handler modules still referenced by unfinished deliveries. Retain the actual selected source manifest, archive SHA, installation ID, profile ID and original Applications workspace/run identifiers in the operator handover.

## Retained operating sources

These paths are below the installed package's `source/` directory:

| Workflow | Maintained source guide |
| --- | --- |
| Native merchant, buyer and recovery | `stellar/scf-starforge-20261009/mpp-charge/README.md` |
| Complete customer package | `stellar/scf-starforge-20261009/mpp-charge/customer/README.md` |
| Customer workbench | `stellar/scf-starforge-20261009/mpp-charge/customer/workbench-guide.md` |
| Original managed application | `stellar/scf-starforge-20261009/distribution/runtime-workspace/MPP_APPLICATIONS.md` |
| Merchant agent | `stellar-forge/mcp-merchant-operator/MPP.md` |
| Exact managed receiving continuation | `stellar/scf-starforge-20261009/distribution/receiving/MPP_MANAGED_RECEIVING.md` |

Source composition retains the original native modules and explicit dynamic launch/data dependencies. The completed native build, installation, Applications start and customer receiving supply their own actual result records for the selected release.
