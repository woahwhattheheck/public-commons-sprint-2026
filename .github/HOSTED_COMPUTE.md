# Local delivery and hosted workflow policy

Hosted GitHub Actions jobs are disabled in this repository. The retained
[.github/hosted-ci-policy.json](hosted-ci-policy.json) policy records that
choice in source, and every workflow job keeps an explicit false condition.
Manual dispatch, event triggers and repository variables do not override it.

The workflows retain their original commands, inputs, permissions, dependency
setup, artifact paths and functional conditions. They remain useful delivery
recipes for an existing Linux runtime. An operator chooses the actual command
needed for the current project; the presence of a recipe does not schedule it
or make an older competition active.

## Export a selected project from the current commit

The original source exporter used by
[public-source-export.yml](workflows/public-source-export.yml) works directly in
the existing checkout. It requires Git and Python, and performs no installation,
build, workflow dispatch or network upload:

```sh
python3 tools/public_source_export.py \
  stellar/scf-starforge-20261009/sf30-seller-sdk \
  /absolute/new/output/seller-source
```

Run that command from the repository root. Select the intended committed source
before exporting, and use a new output directory. The exporter reads regular
tracked Git blobs from that exact `HEAD`; it excludes uncommitted and untracked
files. Its existing size, path and file-type checks still apply.

The output directory contains `source.zip` and `manifest.json`. The manifest
records the source commit, directory tree, file modes, per-file Git identities
and SHA-256 values, plus the archive SHA-256. Share those actual files through the
project's existing delivery channel. No hosted upload job is needed.

## Use another retained recipe

Read the selected workflow's `run:` command, working directory, environment and
required setup. Use the project's maintained README for the current native
entrypoint. Execute only the concrete packaging, processing or verification
command needed for that delivery in the existing runtime. Preserve private
inputs in the existing authorized environment.

GitHub expressions such as `${{ inputs.source_path }}`,
`${{ github.sha }}` and `${{ runner.temp }}` describe values supplied by a
hosted run. Supply the actual local values explicitly. A `uses:` step is not a
local shell command; reuse the existing installed toolchain or the native
project setup. Release, deployment and artifact-upload actions retain their
original publication meaning and require the same authorized destination.

Commons operators with the original `host/workflow_local.py` runner can inspect,
prepare and execute selected native `run:` steps from this checkout. Use the
current Commons source that understands the retained disabled policy and the
explicit hosting wrapper; leave functional and step conditions intact. The
runner does not provision a hosted job or automatically execute an entire
workflow or matrix.

## Maintain the source policy

`.github/hosted-ci-policy.json` uses this declaration:

```json
{"schema":"commons.hosted-ci-policy.v1","mode":"disabled"}
```

The explicit hosting wrapper is `${{ (false) && (<original condition>) }}`.
For a job with no prior condition, the original-condition operand is `true`.
A pre-existing false condition remains false. This preserves the distinction
between the hosting policy and a job's functional eligibility.

When adding or changing a workflow, preserve that policy and all relevant job
conditions. The original Commons `tools/hosted_ci_gate.py --zero-spend REPO_ROOT`
applies the declaration and wrappers while checking that other parsed workflow
content is unchanged. Its `--check REPO_ROOT` mode inspects source without
running workflows. Reuse that tool instead of introducing another CI runner.

Repository-level Actions settings separately prevent hosted execution. Source
conditions travel with the files, including a copied branch or fork. They do not
cancel an already-started run, remove stored artifacts, or alter historical
billing. Those provider operations remain separate from local delivery.

GitHub documents
[job conditions](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-jobs-with-conditions)
and
[repository Actions permissions](https://docs.github.com/en/rest/actions/permissions#get-github-actions-permissions-for-a-repository).

