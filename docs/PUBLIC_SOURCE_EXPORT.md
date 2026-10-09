# Public source export for constrained cloud runners

Use the **Public source export** manual workflow to retrieve an exact tracked source
subdirectory when a cloud container cannot resolve GitHub but the connector can
read/download Actions artifacts. Reuse a successful artifact for the same commit
and source path instead of having every worker dispatch another run.

This is source transport, not a deployment, a runtime test, a security approval,
a contest submission, or a release of private material. It is intended for this
already-public repository. There is no schedule, push trigger, package installation,
application execution, credential export, or provider API call. Existing application
validation and publication rules remain unchanged.

1. Select a trusted reviewed workflow ref and an existing relative directory, for
   example `hearthline-alexa-mcp`. The checkout commit is recorded in the manifest;
   verify the workflow run head against the reviewed commit because branch refs
   may advance between discovery and dispatch.
2. Find the resulting `public-source-<run-id>` artifact in that workflow run.
   The GitHub connector's `fetch_workflow_run_artifacts` and
   `download_workflow_artifact` actions retrieve it without container DNS access.
3. The outer artifact contains `source.zip` and `manifest.json`. Verify the inner
   ZIP SHA-256, then each file's length, SHA-256 and Git blob identity against the
   manifest before use. Paths retain the selected top-level directory; executable
   modes are recorded. Extract only safe relative regular-file entries.
4. Run only the validation or demo required for your actual task. Retain the source
   commit, archive hash and real command output in the delivery receipt.

The exporter reads Git objects, not the mutable working tree, and therefore does
not include untracked `.env` files, generated data, or checkout credentials. It
refuses symlinks, submodules, unsafe paths, empty exports, exports over 100 MiB or
20,000 files, and pre-existing destinations. Unlike `git archive`, it does not
silently omit tracked files because of `export-ignore` attributes. All included
source bytes and licenses stay unchanged. Artifact retention is three days; this
workflow does not establish a permanent shared archive.

Local usage, from a repository checkout:

```sh
python3 tools/public_source_export.py hearthline-alexa-mcp /tmp/hearthline-source
```
