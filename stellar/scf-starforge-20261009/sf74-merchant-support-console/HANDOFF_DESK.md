# Receive and continue a saved support handoff

The Handoffs section receives an existing merchant MCP support export into this same merchant workspace. It shows the retained case identity and original files, resumes an interrupted transfer, and opens the received case in the existing case editor. It uses the original support downloader, completion manifest and case store.

## Configure a receiving workstation

Use the complete repository or current complete distribution and Node 22 or newer. The source merchant MCP must already have the support export you want to receive. Obtain its export ID from that existing operation; receiving does not create another export.

The operator who runs this workstation supplies one private source configuration file. Source URLs, access credentials and local directory paths stay on the host. Each source has a short alias and a label shown in the browser:

```json
{
  "schema": "stellar-forge.support-handoff-sources.v1",
  "sources": {
    "merchant-operations": {
      "label": "Merchant operations",
      "url": "https://merchant-operations.example/mcp",
      "tokenEnv": "MCP_ACCESS_TOKEN",
      "directory": "/private/stellar-forge/received-handoffs"
    }
  }
}
```

Replace the example URL with the actual MCP endpoint. HTTPS is accepted; literal loopback HTTP is also available for an existing local MCP. URLs with credentials, query strings or fragments are rejected. The token named by `tokenEnv` must already be available in the server process environment; the JSON contains its environment-variable name, not the credential value. A source can still open its completed local files when its credential is absent.

Create the receiving directories before starting the desk. Set the configuration file to mode `0600` and the receiving directories to `0700`. Each source directory must be separate from every other source directory and from the case directory: neither equal paths nor nested roots are accepted. A relative source directory is resolved against the configuration file's parent directory. Keep each source alias, endpoint and directory stable across restarts so existing transfers retain their original binding.

```sh
node stellar/scf-starforge-20261009/sf74-merchant-support-console/server.mjs \
  --cases-dir /private/stellar-forge/merchant-cases \
  --handoff-sources /private/stellar-forge/handoff-sources.json \
  --port 8784
```

Open the printed loopback address on the same workstation. Handoffs appears when this configuration is enabled. The server reads local transfer history on page load; it contacts the source only after an explicit inspection or download action. The browser cannot submit a different endpoint, credential or filesystem path.

## Receive the original export

1. Select the configured source and enter the original export ID.
2. Choose **Inspect source handoff**. Review the source case, revision, creation time, original filenames, sizes and manifest identity. This inspection reads the existing completion manifest.
3. Start the download. The request is bound to the exact inspected manifest. The original downloader saves each received range and checkpoint in the source's private directory. Progress reports saved bytes for each file.
4. Use **Stop** when needed. The current operation stops and retains its completed bytes. Select the same source and export ID and resume; a changed source export is rejected rather than mixed into the retained transfer.
5. After completion, open the received case. The existing case editor retains the original workspace, support sources and metadata. If another case has unsaved changes, its normal keep/discard/save flow appears before switching.

The workstation supports up to two active transfers. A second request for an already active source/export uses the same operation. Transfer history and pagination read the local checkpoints, so operators can find an interrupted export without requesting a new source export. A stopped or restarted browser can return to **View saved transfer** and continue the same work.

## Continue the received case

Use the existing case editor to change ownership, follow-up date, status, notes or workorder terms, then save the case normally. Opening the same completed handoff again returns to that same local case and its current revision. It retains the original imported revision and does not replace later edits.

Opening a completed handoff verifies its original file bytes before importing or reopening it. Original file downloads also verify the retained size and SHA-256 before returning an attachment. Completion history records the original successful transfer; a later file change is detected when it is opened or downloaded.

The complete local handoff remains usable while its source MCP is offline. Open the saved transfer, open the received case, and download its original files from the same workstation. Inspections and resumptions require the configured source to be available again.

## Restart, recovery and retention

Stop the console with Ctrl-C or SIGTERM. It cancels its own active transfers and waits for their retained checkpoint work before closing. Restart with the same configuration and case directory, select the saved transfer, and resume. The original download lease also protects the same directory from concurrent CLI and browser writers.

Keep the entire receiving root, including each export's `download-state` directory and completion manifest. Back up that root together with the original case directory and private source configuration. The environment credential is managed separately by the host's existing secret configuration. Removing or moving checkpoints can break the connection to the original imported case.

| Observed condition | Operator action |
| --- | --- |
| Source unavailable or credential unavailable | Restore the existing source connection or process credential, then resume the same export. Completed local handoffs can still be opened. |
| Source manifest changed | Confirm the intended retained export with its source owner. Keep the existing local files; use the correct distinct source export ID. |
| Another transfer owns the directory | Return to that existing operation or wait for its owner to finish. Use the original downloader's stopped-writer recovery when applicable. |
| Local file or checkpoint differs | Preserve the retained directory and inspect its original completion/checkpoint with the existing support CLI. Do not replace files from a different export. |
| Receiving disk is full | Make space on the workstation, then resume the same saved transfer. |
| Case revision conflict | Use the original case editor's latest-version or save-separately actions. |

See [case desk operations](CASE_DESK.md) for case backups, conflicts and saved-version recovery, [runtime support](RUNTIME_SUPPORT.md) for the retained sources and workorder flow, and the [merchant MCP support guide](../../../stellar-forge/mcp-merchant-operator/SUPPORT.md) for source exports and CLI transfer/recovery.

## Existing implementation

`handoff-store.mjs` supplies host-configured source aliases and a small in-process job registry. `handoff-desk.mjs` renders this section in the original page. Durable transfer state remains owned by `stellar-forge/mcp-merchant-operator/support-download.mjs` and its shared retained downloader; received cases remain in `case-store.mjs`. The browser receives source labels, retained identities and progress, with same-origin requests to the existing loopback server.
