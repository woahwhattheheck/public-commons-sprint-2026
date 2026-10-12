# Aviary in Applications

Applications opens the original Aviary migration workspace with its existing Python executable. The same source, SQLite database, mapping revisions, native packages, API operation IDs, upload progress and complete handoffs remain available in the original browser and CLI.

## Prepare the collection once

Use the original source directory and mapping described in [the operator guide](README.md):

~~~sh
starforge aviary --python /absolute/python3 init \
  --source /private/original-collection \
  --workspace /private/aviary-workspace \
  --mapping /private/reviewed-mapping.json
~~~

For a complete handoff, the original receiver opens its retained application and workspace:

~~~sh
starforge aviary --python /absolute/python3 receive \
  --source /private/Aviary_Complete_Workspace.zip \
  --output /private/aviary-received
~~~

Select /private/aviary-received/workspace in Applications after receiving. The native receiver preserves the workspace ID, original files, saved mapping history, API operation records and provider IDs from that handoff.

The installed aviary command exposes the complete original init, show, preview, mapping, save-mapping, assign-keys, package, export, plan, run, reconcile, refresh-upload, transcripts and receive commands. The same entry can run directly as node research/aviary/cli.mjs, with the surrounding source path appropriate to the selected package.

## Review and open

1. Open the maintained runtime workspace and choose a READY runtime containing the research-aviary contribution.
2. Choose Applications, then **Aviary collection migration**.
3. Select the saved workspace directory and the existing Python 3.11 or later executable. This application uses Python's standard library.
4. Choose a local port, or use zero to let the original server choose a free port. Select the existing private environment file when the original API operation needs its named credential variable.
5. Review the application, save it, review Start and start it. Open follows the actual listener reported by the original Python server.

Review reads the native workspace identity, original source-manifest identity and selected Python. It retains the complete native application source and the selected runtime. Start checks that same binding before the original server opens. The live launch endpoint must agree with the announced workspace, source, Python and process before Applications exposes Open.

A source collection can contain large media. Application review reads the retained source manifest and native identity without rescanning every media byte. The original native preview, package, upload and export methods retain their existing source verification.

## Operate the collection

Use the original five-table browser to inspect resources, media, transcripts, indexes and supplements. Save explicit mapping revisions, retain native user keys, review exclusions and visibility, and produce the complete native import ZIP. The original source remains available alongside the mapped rows.

API planning and execution use the collection's existing configuration and original operation ID. Enter the actual organization, collection and token environment name through the native workflow. Those settings and the entered receiver's responses stay in the original migration records.

If an upload or resource action needs recovery, open the same saved operation. The original client retains remote resource/media IDs and accepted upload parts. Reconcile a lost creation reply with that original action, or refresh an upload manifest for the same original media/upload ID. The original API client's cooldown and source checks remain in effect.

## Stop and reopen

Stop controls the existing managed command and its original Python process. Mapping revisions, local source, accepted operations, native child actions and completed files stay in the saved workspace. Reopen the same saved application and use Review Start to open that workspace again.

The workbench marks a prior unfinished operator job as interrupted. Open its original API operation to continue from the recorded action and upload state. A changed native runtime or replaced workspace identity requires the existing review flow to select that change explicitly.

Applications retains the actual effective port, including canonical HTTP port 80 and a server-assigned port. Reopening on another free port preserves the workspace ID and saved collection state.

## Complete receiving

Export from the original browser or CLI:

~~~sh
starforge aviary --python /absolute/python3 export \
  --workspace /private/aviary-workspace \
  --output /private/delivery/Aviary_Complete_Workspace.zip
~~~

The original handoff contains the native application, original collection, source manifest, every saved mapping revision, API plan/action journal, retained provider IDs, transcript downloads and human review. It now also carries managed.py and this guide, so the original application's binding and launch commands remain available in the received native source.

Receive the complete ZIP through the original receive command, then choose its workspace directory in a READY runtime containing this contribution. Review selects that runtime's native source and Python while retaining the received workspace and migration records. Completed remote actions retain their original provider IDs and original source relationships.

## Source entry points

| Entry | Purpose |
| --- | --- |
| aviary.py | Original native collection, package, API and receiving commands |
| cli.mjs | Installed Node command forwarding to the selected Python |
| managed.py | Original workspace/source/Python binding and managed native launch |
| application.mjs | Applications preparation and live startup reader |
| application-provider.mjs | Source-owned catalog and lifecycle registration |
| server.py | Original browser operator and live listener identity |
| distribution/contributions/research-aviary.json | Complete installed source and command declaration |

The application kind and installed managed command are aviary-workspace; the provider is research-aviary. Existing saved workspaces keep their original native IDs. The source owner retains the original collection intake and complete API/browser receiving operation.
