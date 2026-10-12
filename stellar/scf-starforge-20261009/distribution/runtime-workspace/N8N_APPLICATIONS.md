# n8n automation merchants in Applications

Use the existing **Applications** page to prepare and operate the original n8n merchant from a selected installed runtime. The same saved application owns its original seller, customer endpoint, job worker, seller operations and automation console.

## Select the source and configuration

Choose a READY runtime containing `starforge n8n-merchant` and `sf30-seller-sdk/n8n/launch.mjs`. Include the original **schema** feature and the existing native payment dependencies when installing the selected runtime. A source checkout with an existing schema installation can use its original `NODE_PATH`; the runtime's prepared profile carries its own installed dependencies.

Configure an existing n8n child and production wrapper using the [complete merchant guide](../../sf30-seller-sdk/n8n/README.md). The configuration must contain the actual wrapper workflow ID, production webhook URL, selected public output fields, input schema and merchant payment terms. The example invoice child provides a complete input/output contract to adapt to the intended service.

Credentials remain environment references in that configuration. Supply an existing private environment JSON file in Applications when the process needs those references. Applications pins that file for launch and passes its values privately to the original process.

## Prepare and open

1. Select **Applications → New application → n8n automation merchant** and the READY runtime.
2. Enter a **Private merchant directory**. For a new merchant, select a new directory under an existing private parent and provide the **Original n8n merchant configuration** file. For an existing merchant, use its original prepared directory and the same installed source.
3. Select the existing native payment factory module if this seller requires one. Choose **Start the original job worker** when eligible settled jobs should begin or resume at launch. Leaving it clear opens the original operator first.
4. Use port **0** for automatic local ports, or select distinct fixed ports for the automation console, seller, customer endpoint, seller operations and jobs operations.
5. Choose **Review application**, inspect the selected files, original runtime and exact command, then **Save application**.
6. Choose **Review start → Start reviewed application**. The maintained managed worker starts the original command. **Open application** appears after the original process's private record and authenticated live identity agree.

Review and Save retain the selected new directory without creating it. Start calls the original preparation. If preparation was interrupted after some immutable files were written, the same configuration completes those files under the original preparation lease. Existing files must match exactly; a completed prepared merchant keeps its original manifest and application.

If an existing merchant was prepared from a different source path, reopen it with that original source. Its generated application binds the absolute original runtime URLs and their hashes. A new installed source is a separate explicit preparation, with its original job and n8n dispatch state retained at the selected old path.

## Work in the original merchant

| Operation | Original behavior |
| --- | --- |
| Prepare a job | Validate the configured input and download the private original customer purchase handoff. |
| Receive payment and execute | The original SF30 seller and native settlement journal make the job eligible; the original worker starts its selected n8n workflow. |
| Review progress | Read local job state, original settlement, n8n execution, native output and retained history in the automation console. |
| Drain the worker | Stop new local work and let current jobs finish. |
| Resume monitoring | Reuse the original dispatch/execution and its retained provider read delay. |
| Recover a lost acknowledgment | Associate the original execution after its saved Webhook input matches the complete original dispatch. |
| Authorize a later run | Recheck the original failed execution, retain the decision, and queue another dispatch for the same settled job. |
| Export | Retain complete original job input, attempts, history, settlement and dispatch records; download the original completed result bytes. |

The console links to the original jobs and seller operations. The customer endpoint retains the original job claim and result contract. The n8n instance continues to own its remote executions.

## Stop and reopen

Use the saved application's **Stop** action. The original managed operation forwards shutdown to the original CLI, which closes its listeners and job owner. Its launch record becomes `STOPPING` while the job lease is still owned; the managed operation records the completed process exit. A later launch writes its new private identity under the same original ownership.

Reopening the runtime browser or restarting its controller does not start another merchant. Open the retained active application, or review and start it after its original operation has stopped. A new start with a changed configuration, source module, private environment or runtime requires the current original review.

The new private console capability belongs to the new original launch. Existing prepared jobs, native settlements, dispatches, results and recovery history remain in the same merchant directory.

## Original CLI and embedding

Applications calls the selected installed source through its original managed release:

~~~sh
starforge n8n-merchant serve \
  --directory /srv/starforge/merchants/invoice \
  --initialize /srv/starforge/config/invoice-n8n.json \
  --managed-source /absolute/selected/runtime/package/source/stellar/scf-starforge-20261009/sf30-seller-sdk/n8n \
  --port 0
~~~

The maintained application builder supplies the actual `--managed-source` path from the selected runtime; the path above illustrates that field. `--initialize` may be omitted when reopening an existing prepared merchant. `--port` and `--operator-port` select the same automation-console listener and are mutually exclusive. Existing seller/customer/operations port flags retain their original meanings.

For an explicitly interrupted standalone preparation:

~~~sh
starforge n8n-merchant prepare \
  --input /srv/starforge/config/invoice-n8n.json \
  --directory /srv/starforge/merchants/invoice \
  --resume
~~~

The typed package entry `@tokenjunkielabs/starforge-merchant/merchant/n8n` exports `startN8nMerchantLaunch` and `readN8nMerchantLaunch`. The former owns the original merchant services; the latter reads its retained private identity and verifies it through the live authenticated operator.

## Shared Applications composition

The complete additive source is [application-n8n.mjs](application-n8n.mjs).

- Import `n8nApplication` and `prepareN8nApplication` in `applications.mjs`; include `n8nApplication(common)` in the original catalog.
- In `applicationCommand`, call `prepareN8nApplication(settings, inputPath, runtimeDirectory)` for `n8n-merchant`, retaining its returned arguments and inputs. The original common code supplies the port and private environment.
- Import `n8nStartup` in `application-command.mjs`. Route the one-line `stellar-forge.n8n-merchant-launch.v1` announcement through `await n8nStartup(request, text, context)` in the existing serialized output chain, then save the original application URL and returned identity through the existing store.
- Retain `context.pid`: for this nonterminal application it identifies the original `forge.mjs` process. The n8n CLI must be its child, and the live launch must have that exact parent.
