# USGS Water in Applications

Applications starts the maintained Water workspace over a selected private project. The browser keeps the original source selection, capture, scientific review, edition, HEC-DSS mapping and customer receiving workflows. A saved application adds reviewed startup inputs, an observed Open link, and the original managed Start/Stop/reopen lifecycle.

## Review and save the application

Open the installed Runtime Workspace, attach its received merchant runtime, and choose **Applications → USGS water and native DSS**. Choose the original project directory or one new directory below an existing private parent.

| Input | Meaning |
| --- | --- |
| Private Water project | The original workspace, including received editions and native DSS exports. A new directory is created only when Start runs. |
| Original buyer configuration | Optional existing SF88 buyer configuration for the workspace's original purchase actions. |
| HEC-DSS Python executable | Optional absolute path to an installed official HEC-DSS interpreter. If omitted, the original host environment supplies the interpreter. |
| Local edition seller port | Optional port for a saved edition seller explicitly started from the Water workspace. Zero selects an available local port. |
| Existing facilitator URL | Optional HTTPS facilitator, or an existing loopback HTTP facilitator for the original native workflow. |
| Port | The Water browser port. Zero selects an available local port. |
| Environment file | Optional original private runtime environment, reviewed by the existing Applications controller. |

Review resolves the real project, current saved selection, optional buyer file and selected interpreter. It also binds the Water implementation and browser files from the installed runtime. Save retains the original application request and resource identity. Neither operation starts a listener or an acquisition.

Use the original managed-home adoption step when prompted by Runtime Workspace. The application uses the existing managed worker and launch history. Its project resource key prevents two managed instances from selecting the same Water project.

## Start, Open and Stop

**Start** validates the saved inputs, acquires the project lease and opens the original Water workspace. A new project remains without a saved selection until the operator explicitly saves one in Water. A received project can already contain source editions and DSS exports without a project selection; those records remain available.

The worker accepts the Open link only after it checks the actual child process, selected project, startup record and live local listener. The workspace binds to `127.0.0.1`; a requested fixed port must match the observed port. The resulting Open link is saved with the original application operation.

**Open** enters the existing Water interface. Source acquisition, scientific review, edition publication, native mapping and receiving continue to use that interface's original actions. Starting the application does not start those jobs. An optional buyer remains the original buyer, and an optional seller is started explicitly from the Water workspace.

**Stop** sends the original managed operation its normal termination signal. Water closes its source/edition services, cancels and drains its admitted native jobs, then releases its project lease. The private startup record changes to STOPPED after that close. The original selection, captures, reviews, editions, DSS files and received handovers remain in the project.

A restarted launcher can reconnect to the same managed operation and saved Open link through the existing process identity and operation history. After a completed Stop, use the saved application's Start action to reopen the project. If its selection, buyer configuration, interpreter or runtime source has changed, review and save the current inputs before starting again. The source edition and native export IDs remain owned by Water.

## Use a complete received native project

The native DSS handover contains the original capture, scientific review, exact mapping plan, native file and its verification records. Receive it with Water's maintained receiving command or browser before selecting that project in Applications. Choose its existing destination; an Applications startup does not copy the project or create another export.

The original receiving command checks all retained members and the selected source/export identity before either destination is installed. The official HEC-DSS reader verifies the native file. Repeating the same completed receiving operation reopens its original export; an unchanged completed export does not require a second native write.

The companion [merchant/agent receiving guide](../../../../stellar-forge/mcp-merchant-operator/USGS_WORKSPACE.md) covers the 35 Water tools, manifest-pinned download checkpoints, full host restart, complete handover download and native receiving. [DSS.md](DSS.md) describes mapping and verification in the original Water product.

Keep the private interpreter and any buyer credentials on the receiving host. The application registration and source package carry source code and operating guidance, not local credentials.

## Use the same managed command directly

The installed CLI dispatches to the original Water command:

```sh
starforge usgs-water managed \
  --project /absolute/private/water-project \
  --port 0 \
  --hec-dss-python /absolute/hecdss-runtime/bin/python
```

Optional inputs are `--buyer-config`, `--merchant-port` and `--facilitator`. The command prints one compact startup record containing its actual local URL and waits for SIGINT or SIGTERM. The same close/drain path runs on either signal.

Applications also supplies `--expected-inputs-sha` and `--expected-project-sha` from its reviewed selection. These bind the saved launch to the actual original inputs; an empty selection uses `empty`. Direct programmatic callers can use `reviewWaterManagedInputs` and pass its returned identity to `startManagedWaterWorkspace`. Close the returned service when finished. `runManagedWaterWorkspace` provides the normal command-line signal lifecycle.

## Retained operating state

`managed-workspace.json` records the actual launch, original process identity, reviewed inputs, requested ports and observed local URL. `managed-workspace.lock` uses the same operation lease as Runtime Workspace. These are private host operation records. The normal Water files remain the source and native-DSS records; a startup status does not replace them.

The live `/api/application` route returns the managed binding only for a managed launch. It uses the original Water local-host and request-origin checks. The ordinary `serve` command keeps its existing behavior.

If a saved input changes before Start, review it again. If a fixed port is occupied, stop its actual owner or choose an available port. If a process terminates unexpectedly, reopen the original application operation and project; retain the original native job/export ID and use Water's existing recovery or receiving actions. The Applications history and the Water project together identify the work that actually completed.

## Distribution

The original `contributions/usgs-water.json` owns the Water command, merchant customer CLI and exported interfaces. `./seller/usgs-water/managed` exports this lifecycle. The maintained Git builder, runtime installer and source manifest carry the same Water implementation and browser assets. No additional scheduler or dependency installer is introduced by this application.
