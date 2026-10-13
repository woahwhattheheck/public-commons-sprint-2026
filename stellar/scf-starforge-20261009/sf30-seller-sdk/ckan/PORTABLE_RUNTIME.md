# Install the catalog workspace with Python 3.12

The catalog workspace can use an explicitly selected Python 3.12 runtime while retaining the complete original GSA converter, schemas, dependency lock and review behavior. Use the `portable-python312` profile for that interpreter. The default `original` profile follows the upstream Python requirement, `>=3.13,<4.0`, and is installed through [DCAT_ENGINE.md](DCAT_ENGINE.md).

This guide applies to the source directory containing this file. In the installed `ckan-merchant` package, it is `source/stellar/scf-starforge-20261009/sf30-seller-sdk/ckan/`. The source checkout has the same path without the leading `source/`. Keep the application source read-only and place its Python environment and saved customer workspaces in separate owned directories.

## Install the complete original dependency selection

Select an actual Python 3.12 executable. From this guide's directory, create a private environment at an absolute path of your choice:

~~~sh
umask 077
python3.12 -m venv /absolute/private/dcat-python312
/absolute/private/dcat-python312/bin/python -m pip install \
  --require-hashes --only-binary=:all: \
  -r portable-runtime-requirements.txt
/absolute/private/dcat-python312/bin/python -m pip check
/absolute/private/dcat-python312/bin/python -B dcat_migration.py \
  --runtime-profile portable-python312 --check-runtime
~~~

[portable-runtime-requirements.txt](portable-runtime-requirements.txt) is the complete export of the original lock's 47 main packages, pinned to their original versions and all 679 original distribution SHA-256 hashes. The lock itself remains unchanged at [vendor/gsa-dcat-us/jsonschema/poetry.lock](vendor/gsa-dcat-us/jsonschema/poetry.lock). Its SHA-256 is `20318bd0c8a2213346f0acce36c639c2f3da8162b18e08641bf347e3df1349b1`; the requirements export is `1cef430eb3989ca9faab7120341d651343014706707e77cd43ad50ecad7af33c`.

For an existing wheelhouse that carries this exact lock selection for the host's Python ABI and platform, add `--no-index --find-links /absolute/wheelhouse` to the install command. Hash checking remains enabled. A missing compatible wheel means that wheelhouse needs the actual locked distribution before installation can finish.

The engine verifies its original source files and registry selection before importing the converter. The runtime output records the real interpreter, installed dependency versions, matches to the retained lock and required format checkers. Preserve this output with the customer installation record. The IRI checker is part of the required original dependency selection; it determines whether a proposed series identity satisfies the actual schema.

The portable profile accepts Python `>=3.12,<3.13`. Setting a Python executable alone keeps the default `original` profile. Choose both the executable and profile when starting the maintained application.

## Start the command line and browser application

Set the two host environment values for the installed `starforge` command:

~~~sh
export SCF_DCAT_PYTHON=/absolute/private/dcat-python312/bin/python
export SCF_DCAT_RUNTIME_PROFILE=portable-python312
starforge dcat init --workspace /absolute/private/customer-catalog \
  --origin https://catalog.example/
starforge dcat serve --workspace /absolute/private/customer-catalog --port 0
~~~

Use the private application URL returned by the running process. A saved project can be reopened with the same `serve` command. The Node application selects the configured executable with shell execution disabled; customer catalog JSON cannot set the runtime profile.

Use the installed Node runtime required by the package. Exact-number catalog and mapping handling uses Node 22.16 or newer and its original JSON source-token support. [MIGRATION_OPERATING.md](MIGRATION_OPERATING.md) covers the complete browser and command line workflow, including comparison, typed corrections, normalization, review, cutover, rollback and full workspace receiving.

For a first source review, retain the original full editions and import them separately:

~~~sh
starforge dcat import --workspace /absolute/private/customer-catalog \
  --file /absolute/catalogs/legacy-data.json --profile 1.1 --label "Original legacy edition"
starforge dcat import --workspace /absolute/private/customer-catalog \
  --file /absolute/catalogs/current-data.json --profile 3.0 --label "Published comparison edition"
~~~

Each import returns the saved catalog identity. Select those exact identities in the browser, or pass them as `--source` and `--comparison` to `starforge dcat review`. The application retains the complete originals. A 3.0 source is preserved byte for byte by default; explicit normalization creates its own recorded review selection.

The engine's complete review can return status 2 when the candidate needs correction. The application saves that full review and its actual schema findings. An edited candidate and its exact typed identity mappings can then produce another review without changing the retained converter or either source edition.

## Select the same runtime in managed Applications

Add the following values to the existing private Applications environment JSON object:

~~~json
{
  "SCF_DCAT_PYTHON": "/absolute/private/dcat-python312/bin/python",
  "SCF_DCAT_RUNTIME_PROFILE": "portable-python312"
}
~~~

Keep any other existing environment entries. The original Applications environment file is owned by the operating user and readable only by that user, with mode `0600`; its containing private directory uses mode `0700`.

Prepare a `dcat-migration` application using the maintained `ckan` provider, select the existing customer workspace, and select that environment file through the normal Applications review. The provider resolves the actual Python executable through the original executable selector. Its prepared selection and authenticated startup identity bind the selected runtime profile. The observer uses the same merged private environment as the launched process.

When the executable, profile or private environment changes, review the new application selection before starting it. The existing workspace and its retained reviews remain available. A new native review records its actual runtime selection and gets its own complete review identity.

The original CKAN agent launcher accepts the same two environment values. Its catalog tools operate on the same saved workspace and retain the same input, review and release identities. Follow the complete eight-tool procedure in [MIGRATION_OPERATING.md](MIGRATION_OPERATING.md); the environment selects the host runtime outside the customer tool arguments.

## Receive the complete customer workspace

Use the workspace archive to move a reviewed project to another installation:

~~~sh
starforge dcat archive --workspace /absolute/private/customer-catalog \
  --out /absolute/delivery/customer-catalog.ckanw
starforge dcat inspect-archive --file /absolute/delivery/customer-catalog.ckanw
~~~

Retain the archive SHA-256 returned by the exporter. On the receiving installation, install this same package and its Python runtime, then receive the complete archive into a new directory:

~~~sh
starforge dcat receive --file /absolute/delivery/customer-catalog.ckanw \
  --sha256 EXACT_ARCHIVE_SHA256 --workspace /absolute/private/received-catalog
starforge dcat serve --workspace /absolute/private/received-catalog --port 0
~~~

The complete archive carries original editions, saved requests, full reviews, exact candidate files, typed correction selections and release history. It preserves the workspace identity when received into its new location. Original and candidate downloads preserve their original bytes, including the original encoding.

Inspect the retained review, compare the active release and open the source files before continuing the customer's work. Cutover selects a reviewed candidate against the current release; rollback selects an earlier retained release against that same current identity. Both actions use the recorded source, candidate and review bindings. Changing the Python profile does not rewrite any archived review.

## Source identity and completed operation

The complete 37-file GSA selection is unchanged from [GSA/dcat-us commit 4996591483b52f4ccc0cb72c42e4ec3fe59a4b06](https://github.com/GSA/dcat-us/tree/4996591483b52f4ccc0cb72c42e4ec3fe59a4b06/jsonschema). The adjacent [source manifest](vendor/gsa-dcat-us/source-manifest.json) records every retained original. The upstream project continues to declare Python 3.13; the portable wrapper makes its distinct host selection explicit in each native review.

The completed original GSA receiving operation used Python 3.12.14 and this exact dependency export. It reviewed both full 344-member editions, retained the 11 IRI exceptions in the automatic legacy conversion, compared that output byte for byte with an independent call to the unchanged converter, preserved the complete current edition, and validated a corrected candidate with explicit identity mappings. All 344 original members were conserved.

The installation record retains that complete original source/input packet and all native results under operation `DCAT-GSA-MIGRATION-20261012-390E`. Its native manifest identifies every saved report, original candidate and mapping file. The installed customer application uses the ordinary `starforge dcat` commands above and carries its continued work through the complete customer workspace archive.

The profile is part of the complete review's runtime declaration:

~~~json
{
  "runtime_profile": {
    "id": "portable-python312.v1",
    "required_python": ">=3.12,<3.13",
    "upstream_required_python": ">=3.13,<4.0"
  }
}
~~~

Keep the original converter and schema source with the installed package. The named `ckan-merchant` selection explicitly retains this guide, the complete requirements export and the original Poetry lock alongside the engine and its full source manifest.
