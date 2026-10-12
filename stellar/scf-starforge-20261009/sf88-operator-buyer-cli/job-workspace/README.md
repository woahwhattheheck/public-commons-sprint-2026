# Paid job customer workspace

The customer workspace takes a merchant purchase ticket through original checkout, accepted application execution and a retained working resource. Import the original acceptance, follow execution, retrieve the result, and use the same file in the resource library and collections. The job list keeps labels, status, settlement identity, local activity, and delivery together across restarts.

The merchant runs the application through the [durable jobs service](../../sf30-seller-sdk/jobs/README.md). Its [buyer interface](../../sf30-seller-sdk/jobs/BUYER.md) owns acceptance and download records. This workspace uses those records directly and adds a customer browser, a searchable library, research notes, and portable result collections.

## Install and open

Use Node 24 and the maintained Starforge merchant distribution. The command is `starforge job-workspace`; its typed JavaScript entry is `@tokenjunkielabs/starforge-merchant/buyer/job-workspace`. The distribution includes the workspace, original buyer, resource library, and collection implementation.

For a source checkout, run `node stellar/scf-starforge-20261009/sf88-operator-buyer-cli/job-workspace/cli.mjs` in place of `starforge job-workspace` in the examples.

Choose an absolute directory owned by the account that runs the workspace:

```sh
starforge job-workspace serve --state /srv/starforge/customer-jobs
```

Open the printed `url` exactly as supplied. The local server uses a private token in the URL fragment. Its four views are **Checkout**, **Jobs**, **Resource library**, and **Collections**; each opens with the same local authorization.

To include buyer directories and delivered files that already exist outside the workspace, configure their parent roots on the first open:

```sh
starforge job-workspace serve --state /srv/starforge/customer-jobs --buyer-root /srv/starforge/buyers --file-root /srv/starforge/downloads
```

The workspace creates its own `buyers/` and `artifacts/` directories automatically. Reopen with the original state path and omit the root options. Supplying roots again requires the same canonical set saved on the first open.

The running server owns the workspace lease. Use its browser while it is running. Press Ctrl-C to finish local work and close before using standalone commands against that same state.

## Purchase a prepared application job

Open the same customer workspace with an existing original SF88 operator:

~~~sh
starforge job-workspace serve --state /srv/starforge/customer-jobs --operator-workspace /srv/starforge/operator
~~~

Alternatively, use --operator-profile with the absolute path of an existing private Node buyer profile. The installed source supplies the original native runtime. Each imported checkout retains its selected operator and runtime.

In **Checkout**, import the merchant’s private job handoff, inspect the merchant, function and exact atomic payment terms, then select **Review request**. The original buyer prepares the request and returns its offline review. **Start checkout** uses that exact review and the existing terminal approval. Keep the foreground command or original Applications terminal connected while approving.

A settled HTTP 202 response is verified and retained by the original job buyer. **Open accepted job** selects its entry in Jobs, where status monitoring, result retrieval and library use continue.

The checkout preserves its original request, stable intent, permanent attempt and native result. **Recover original operation** reopens that same purchase after an interruption. A renewed merchant ticket can replace an unattempted preparation while preserving the job, input, terms and intent.

[The complete checkout guide](checkout/README.md) covers installation, operator/profile selection, browser actions, original terminal approval, cancellation, recovery, renewed tickets, CLI commands and the typed application interface.

## Add an accepted job

An original merchant checkout produces an acceptance containing the job, function, input hash, status URL, and result URL. Retain those exact JSON bytes together with the corresponding private handoff or claim token.

In **Jobs**, choose the acceptance file and either its handoff file or claim token, add a useful label, and select **Add job**. The workspace creates an original job buyer and saves the acceptance in private intake storage.

For command-line intake:

```sh
starforge job-workspace retain --state /srv/starforge/customer-jobs --acceptance-file /srv/starforge/intake/accepted.json --handoff-file /srv/starforge/intake/handoff.json --label "October demand report"
```

Alternatively, use `--claim-token-file /absolute/private-token.txt`. Handoff and token files must be regular files owned by the running account with private permissions; on Unix use mode 0600. The acceptance limit is 64 KiB. Use its saved bytes, since its hash is part of the retained identity.

If an original job buyer already exists inside a configured buyer root, add its directory instead:

```sh
starforge job-workspace register --state /srv/starforge/customer-jobs --buyer-directory /srv/starforge/buyers/october-report --label "October demand report"
```

Both operations return the workspace entry ID and `reused`. Adding the same accepted identity again returns the existing entry. Its original buyer remains the source of payment acceptance and delivery.

## Operate the job

Select an entry to see its original receipt, function, input hash, merchant state, settlement, latest local task, and saved result.

| Action | Effect |
| --- | --- |
| **Refresh status** | Read the current merchant status once and retain it in the original buyer. |
| **Monitor job** | Poll the customer status endpoint until execution completes or the local deadline ends. |
| **Retrieve result** | Wait for completion when needed, verify the result, save it, and update the resource library. |
| **Stop local operation** | Abort this workspace's active status or retrieval operation. |
| **Reopen receipt** | Read the saved local buyer receipt and refresh the displayed entry. |
| **Update library** | Reconcile delivered files into the existing library index. |

Merchant execution has its own lifecycle. Stopping local monitoring or retrieval leaves that merchant lifecycle in place; operate merchant cancellation and retry through the merchant jobs workspace.

The workspace supports four simultaneous local operations and one per entry. Repeating the same active operation returns that operation. A different operation on an occupied entry returns a conflict so the current task can finish or be stopped deliberately.

The command-line equivalents return the retained entry:

```sh
starforge job-workspace refresh --state /srv/starforge/customer-jobs --entry ENTRY_ID
starforge job-workspace watch --state /srv/starforge/customer-jobs --entry ENTRY_ID --deadline-ms 300000 --poll-ms 1500
starforge job-workspace fetch --state /srv/starforge/customer-jobs --entry ENTRY_ID --deadline-ms 300000 --poll-ms 1500
```

Replace `ENTRY_ID` with the full ID returned by intake or list. The default local deadline is five minutes, with status polling every 1.5 seconds. Deadlines may range from 100 ms to one hour; polling may range from 100 ms to 30 seconds.

The merchant's `COMPLETED` state describes the application job. A local task's `COMPLETE` state describes the requested customer operation. For example, a successful status refresh can report a merchant job that failed. Read both fields when integrating the API.

## Work with the result

Retrieval uses the original buyer's completion identity and delivery checks: job, function, input, acceptance, completed revision, native settlement, source URL, content type, filename, byte count, and SHA-256. The saved delivery becomes a library resource.

Use **Preview**, **Download**, or **Open in library** on a retrieved result. Preview and download recheck the file against the retained delivery. The library searches names and available text, retains note revisions, and supports tags and starred resources. Job provenance includes its original settlement and acceptance identity.

In the job view, write **Research notes**, set tags or a star, and save. Choose an existing collection or create one, then select **Add verified result**. Open **Collections** to review its members and export a portable collection package. Receiving that package preserves the original resource provenance and its selected annotation revisions. See the [collection guide](../resource-library/COLLECTIONS.md) for the receiving workflow.

The library verifies files up to 64 MiB and indexes up to the first 1 MiB of text per file. Verification coverage and search coverage are distinct. Binary and larger-text files retain their verified delivery even when their searchable text is limited.

## Organize and reopen

Search by label or retained job identity, filter by merchant state, and switch among active, archived, or all entries. Labels and archive changes use the displayed revision to avoid overwriting another edit.

```sh
starforge job-workspace list --state /srv/starforge/customer-jobs --query October --view active --limit 50
starforge job-workspace show --state /srv/starforge/customer-jobs --entry ENTRY_ID
starforge job-workspace label --state /srv/starforge/customer-jobs --entry ENTRY_ID --label "October final report" --expected-revision 3
starforge job-workspace archive --state /srv/starforge/customer-jobs --entry ENTRY_ID --archived true --expected-revision 4
starforge job-workspace status --state /srv/starforge/customer-jobs
```

Use the revision returned by your latest read in place of the example numbers. Archiving hides an entry from the active list while retaining its buyer, delivery, notes, and collection membership.

The state directory contains `workspace.json`, original buyers under `buyers/`, retrieved results under `artifacts/`, exact acceptance intake under `intake/`, and the derived library database under `library/`. External buyer and file roots remain part of the configured workspace.

On orderly shutdown, active local requests are aborted and drained before the library and lease close. After an interrupted process, outstanding local tasks become `INTERRUPTED` on reopen. Select an explicit refresh, monitor, or retrieval operation to continue from the retained receipt.

Back up the closed state directory together with any configured external roots. Restore those files at the same canonical paths. For a different directory layout, create a new workspace and register the original buyers under its configured roots or retain their original acceptance and private handoff. Use collection packages to transfer selected delivered resources and research notes.

## JavaScript integration

The public entry exports `openJobWorkspace`, `startJobCustomerWorkspace`, and `runJobWorkspaceCommand`, with adjacent TypeScript declarations:

```js
import { openJobWorkspace } from '@tokenjunkielabs/starforge-merchant/buyer/job-workspace';

const workspace = await openJobWorkspace({
  directory: '/srv/starforge/customer-jobs',
});

try {
  const { entry } = await workspace.register({
    buyerDirectory: '/srv/starforge/buyers/october-report',
    label: 'October demand report',
  });
  await workspace.start(entry.id, { kind: 'fetch', deadlineMs: 300000 });
  const saved = await workspace.wait(entry.id);
  if (saved.task?.state !== 'COMPLETE') {
    throw new Error(saved.task?.error ?? 'Result retrieval did not complete');
  }
  console.log({ jobId: saved.receipt.jobId, resourceId: saved.resourceId });
} finally {
  await workspace.close();
}
```

This example reopens a state whose buyer roots were configured earlier. Embedding the browser uses `startJobCustomerWorkspace({ model: workspace, port: 0 })`; close the returned host before closing the workspace.

## Recovery messages

| Message or observation | Recovery |
| --- | --- |
| Workspace lease is occupied | Use the current browser owner, or close it before opening another process. |
| Buyer/file root conflicts | Reopen with the saved canonical roots or omit the root flags. |
| Revision conflict | Read the current entry, review it, and repeat the edit with its current revision. |
| Local task interrupted or deadline reached | Reopen the receipt and start the desired status or retrieval operation. |
| File unavailable or hash differs | Restore the original file or retrieve the result again through its original buyer. |
| Retrieval saved a result but index refresh failed | Resolve the displayed library error and use **Update library**. The delivery remains retained. |

## Native continuation

`continuation.mjs` exercises the customer application against the retained output of the original durable-jobs native journey:

```sh
node --max-old-space-size=192 stellar/scf-starforge-20261009/sf88-operator-buyer-cli/job-workspace/continuation.mjs --retained /absolute/original-paid-jobs-directory
```

Run the original journey with `SF_JOBS_JOURNEY_KEEP=1` to retain that directory. If the original driver stopped during buyer setup with only its first report still PREPARED, set `SF_JOBS_JOURNEY_RESUME` to that retained directory when running the same native journey. It renews and saves that job's private ticket before continuing buyer setup. The continuation uses its two completed jobs and original buyer records, customer HTTP intake and retrieval, library preview/download, annotation revisions, collection export/receive, and reopen. It keeps its state for inspection when a step fails.
