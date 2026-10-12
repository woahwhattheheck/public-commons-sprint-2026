# Managed document pipelines in Research

The **Pipeline jobs** view operates the Unstructured Pipelines account selected by the local launcher. It takes original files through a saved preparation, a reviewed provider job, retained output, a research question, evidence selection, and an exported report. The same research Store keeps questions, sources, findings, revision history, and portable dossiers.

The [managed Jobs operations](https://docs.unstructured.io/api-reference/workflow/overview) use their own account and workflow API. The separate [self-hosted document workshare](UNSTRUCTURED.md) continues to use its original native merchant and buyer. Choose the interface used by the customer's deployment.

## Launch the operator

Use the current installed merchant distribution:

~~~sh
starforge research-workspace \
  --dir /absolute/private/research \
  --pipeline-source /absolute/private/pipeline-source.json
~~~

The equivalent source command is:

~~~sh
node stellar/scf-starforge-20261009/sf88-operator-buyer-cli/research-dossiers/server.mjs \
  --dir /absolute/private/research \
  --pipeline-source /absolute/private/pipeline-source.json
~~~

Open the complete local address returned by the command. The fragment carries the local session token. The server listens on loopback, checks the Host and Origin, and requires the session token for every data operation.

The source selection file contains private paths chosen by the launcher:

~~~json
{
  "schema": "stellar-forge.unstructured-pipelines-source.v1",
  "workspaceId": "customer-document-operations",
  "directory": "/absolute/private/unstructured-jobs",
  "configurationFile": "/absolute/private/unstructured-pipelines.json"
}
~~~

The provider configuration selects an existing account and reviewed template:

~~~json
{
  "schema": "stellar-forge.unstructured-pipelines-config.v1",
  "account": "customer-document-account",
  "apiUrl": "https://platform.unstructuredapp.io/",
  "apiKeyEnv": "UNSTRUCTURED_API_KEY",
  "profiles": [
    {
      "id": "reviewed-document-template",
      "label": "Customer document processing",
      "requestData": {
        "template_id": "REPLACE_WITH_EXISTING_TEMPLATE_ID"
      }
    }
  ]
}
~~~

Replace the illustrated account, API address, paths, and template with the customer's selected values. Set the named key variable in the original process environment. The browser receives the safe account identity and named profile summaries. It never selects a credential variable or a filesystem path.

A profile may supply an exact provider `job_nodes` array instead of `template_id`. The original parameters, including node settings, stay in the private job workspace. The saved review identifies the profile and its digest. See the [provider API guide](unstructured-pipelines/README.md) for the complete configuration and programmable interface.

The provider documents at most ten files per local-file job, 50 MB per file, and at least one second between create requests. It allows five jobs to run concurrently and schedules overflow. The implementation uses a conservative decimal 50,000,000-byte file ceiling. The browser accepts at most ten files and 32 MiB in total; a smaller configured limit also applies. The original account gate serializes creates within this shared operations directory and preserves launch spacing across profiles, configuration revisions, and process restarts. Independent hosts must coordinate through their shared account operations. Provider status remains the status returned by the service.

## Open the saved source from Applications

In the original runtime workspace, choose **Applications → Research dossiers**.
Select the private research directory and set **Original document-pipeline source
selection** to the absolute path of the source JSON above. The saved field is
`pipelineSourceConfig`; the original command receives it as `--pipeline-source`.

Use the existing **Private environment JSON** field when the original process
needs a private API-key variable. The variable name must match `apiKeyEnv` in the
account configuration. The account, API address and processing profiles remain
in that original private configuration.

**Review** retains the selected source file, its referenced account configuration
and the original pipeline jobs directory. It validates the configuration through
the selected runtime's original Pipelines contract. A new jobs directory can be
created in an existing private parent through the normal Applications preparation.
The account selection is reviewed without starting a provider job.

Choose **Save**, connect the selected runtime, then **Review Start → Start**.
Applications opens the original authenticated Research listener after its startup
announcement identifies the selected research directory and pipeline workspace.
The existing **Pipeline jobs** view operates the original saved jobs.

Use **Stop** to close the managed listener. Reopen the same saved application and
start it again to continue its retained jobs, outputs and dossier decisions. If
the source selection or account configuration changes, review those current
inputs through Applications before starting. The original provider controls,
action recovery, reconciliation and receiving flow below remain available.

## Prepare and submit a job

1. Open or create a research dossier, then add the research question the documents should inform.
2. Open **Pipeline jobs**. Choose a named processing profile and question, give the job a useful label, and select the original files in their intended order.
3. Choose **Save preparation**. The server copies and verifies the original bytes into the job workspace before publishing its immutable plan. The browser keeps the preparation request ID, file names, types, sizes, and hashes so the same preparation can be found after a lost reply.
4. Open the saved job. Review its account, profile, source files, sizes, and original plan. Each original input can be downloaded from this record.
5. Check the review selection and choose **Submit reviewed job**.

Submission uses the original saved plan and its exact retained files. A named profile cannot silently change beneath an existing preparation. A new account, different API base, altered profile, or changed input selection requires a new preparation with a fresh review.

The returned provider job ID becomes the job's identity for progress, cancellation, and downloads. Local plan IDs and provider IDs are displayed separately. Provider IDs are preserved as opaque strings, including deployment-specific forms.

**Reload saved job** reads the retained local state. **Refresh provider status** makes an explicit original GET and captures the returned job and details. The UI shows when each provider observation was received. Reloading the browser does not repeatedly poll the provider or create a new job.

## Receive useful output

The provider's job record determines the available file and node selections. The operator displays these returned selections rather than inferring them from input order.

1. Select an observed provider output and choose **Retain original output**.
2. The original download response is saved with its file ID, optional node ID, receipt, content type, byte count, and digest.
3. Choose **Review** for that retained output. JSON elements preserve their text and original metadata; page numbers, element IDs, types, coordinates, table metadata, and other returned fields remain available in the original record.
4. Filter by page, type, or text to inspect relevant material. Open an item to read its complete content and original metadata.
5. Choose a research question and edition label, then **Receive reviewed edition**.
6. Use the dossier's existing Sources, Questions, and Findings views to select evidence, annotate it, write findings, and export the report.

The original provider output remains downloadable from its saved job even if construction of a research edition exceeds the dossier's size ceiling. **Download output** on the retained-output row reads that verified original directly.

A research edition includes the exact output bytes, safe job and profile bindings, original input metadata, and a reproducible source projection. It is limited to 64 MiB after serialization, including its encoded original output and projection. The original job's configured retention ceiling and the research-edition ceiling serve different purposes. A portable dossier, including its revision history and retained editions, is limited to 256 MiB by the original Store.

A completed job's output is marked available. An output retained while the provider reports another state keeps that observed status and is marked partial. Later status observations do not rewrite an edition already received into a dossier.

Binary output remains a byte-preserving downloadable source. Its research projection records the original file and provider binding. Text and JSON content are rendered as text; provider HTML and table markup are shown in their original metadata rather than executed in the browser.

## Reopen interrupted work

The job workspace contains the original preparation, command records, captured responses, input files, selected output files, and receiving decisions. Keep this directory together. Browser recovery records contain request identifiers and selections; the original process remains the owner of the files and provider credentials.

| Where a reply was lost | Continue the existing work |
| --- | --- |
| Saving a preparation | Use **Find saved preparation**. If it was interrupted before publication, select the same files in the same order and retry the saved preparation. The original hashes and request ID must match. |
| Submitting a job | Reopen the saved action. A retained create response is projected into the original operation. If the response is unresolved, use **Find and reconcile an existing provider job**. |
| Reading progress | Reopen the exact saved action, or explicitly request a new provider observation from the current revision. |
| Retaining an output | Reopen the exact saved request in Action recovery. Its recorded result identifies the original retained output even after a later action advanced the job. |
| Receiving an edition | Use the saved receiving decision. The original request, output digest, question, label, and dossier revision recover the existing edition and receipt. |
| Closing the source process | Reopen the original job directory and account. The source reads its captures before deciding which operation state to display. |

### An unresolved create response

A provider can accept a create request before the local process receives its reply. The operation records **SUBMISSION_UNKNOWN** and preserves the prepared inputs. It does not repeat the create request automatically.

Read the provider job list from the configured account. Compare the candidate's actual provider record with the preparation and the account's job history. Select the existing job and record why it belongs to that original preparation. Reconciliation reads that exact provider job before attaching its ID to the local operation.

A demonstrably undispatched request remains prepared and records the reason. A later reviewed submission uses a new saved action. The distinction comes from the original dispatch and response records.

### Cancellation

Choose **Request cancellation** and record a reason. The provider's cancellation acknowledgement is retained separately from the job's status. A subsequent original GET supplies the observed status. The interface displays **STOPPED** only after the provider returns that state.

### A lost receiving reply

Receiving is an explicit dossier change. The local receiving record is saved before the original Store commits the edition. If the browser loses the reply, the same decision locates the committed edition by request and digest and recovers its original revision. Later dossier edits remain intact.

Choosing another question, label, or output is a new decision. The browser keeps pending decisions visible so the original result can be recovered before further work is reviewed.

## Share and reopen the research

Use the dossier's existing Export command for HTML, Markdown, or portable JSON. The report carries selected sources and findings through the existing reporting engine.

To reopen a portable dossier elsewhere:

1. Start a research workspace at the receiving location.
2. Choose **Open dossier file** and select the original portable JSON.
3. Open **Pipeline jobs**, then the retained research edition.
4. Review its original provider output, input metadata, source bindings, and selected research.

A portable dossier can be reviewed without a configured provider source. Original input downloads, provider progress, cancellation, and new processing use the retained job workspace and its configured account. Transfer those private operational materials only to the intended operator through the customer's chosen handover.

## Programmable integration

The installed package exposes the original operations, contract, client, edition, and research-workspace modules:

~~~js
import {openPipelineOperations} from
  '@tokenjunkielabs/starforge-merchant/buyer/research-dossiers/unstructured-pipelines';
import {openUnstructuredPipelineWorkspace} from
  '@tokenjunkielabs/starforge-merchant/buyer/research-dossiers/unstructured-pipelines-workspace';
~~~

The [provider guide](unstructured-pipelines/README.md) documents prepare, submit, refresh, list, inspect, reconcile, cancel, retainOutput, and the original input/output readers. It includes the exact multipart fields, accepted HTTP responses, deployment prefixes, size limits, and account gate.

The research wrapper adds dossier ownership, browser uploads, review, filtering, direct original downloads, and explicit receiving. Every control takes an original request ID and reviewed operation revision. Submission and reconciliation also bind the reviewed plan digest.

The private loopback server exposes these operations through the existing authenticated research routes. It closes the provider client with the original server so pending requests settle into their retained operation records.

## Source references

- [Unstructured Pipelines operations overview and local-file limits](https://docs.unstructured.io/api-reference/workflow/overview)
- [Managed provider contract, lifecycle, and pinned SDK references](unstructured-pipelines/README.md)
- [Original self-hosted document receiving](UNSTRUCTURED.md)
