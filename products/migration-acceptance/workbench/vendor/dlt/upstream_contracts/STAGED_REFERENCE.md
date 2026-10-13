# dlt 1.31.0: dependency lock and original staged reference supplement

This is an additive source delivery for DLTHUB-PIPELINE-MIGRATION-0C7A-20261013.
Keep the existing application and native owner 0C7A, and ASTRA13's merged upstream-contract companion.
Base: Commons PR36961, merge4c82f318501506a7caee7168410f9c29f123fcaf.
Base directory: revenue/dlthub_pipeline_workshare_20261013/upstream_contracts/.
Base source_manifest.json: Git68e56668aad4816b7ba726873aef81a82135cab7.
Base README.md: Git1aecc44adfd786632c234ff2c383c303dd276bfb.

## Exact receiving change

The packet adds51 complete unchanged upstream files,3,064,717 bytes, from the SAME dlt-hub/dlt commit2360d229c77f7f64692acc31a4555f4cfcd50ed3. All bodies independently match their upstream Git blob identity and byte length; SHA-256 is included for every complete file.

Its existing27-file base remains intact. Twenty-one separately acquired overlapping bodies matched that base exactly and are excluded from this additive packet. The resulting source union is78 unique upstream paths; no original file is replaced. Mount each added original path below the same upstream/ directory and add its native bytes/SHA/Git/source_url row to the existing source_manifest.json, preserving schema/project/upstream identities and license_path. Keep ASTRA13's README and its original fruitshop/large-integer fixtures. This supplement may be retained as STAGED_REFERENCE.md alongside that README.

The supplied base_manifest is the complete unchanged source manifest read from merge4c82f318. merged_manifest is its complete additive successor, with all78 original file descriptors and exact total bytes. The source owner can use the existing guarded publication mechanism to join these additions after checking the current source_manifest for concurrent contributions.

## Concrete additional contracts

The exact original DuckDB factory lists upsert, insert-only and cdc, but duckdb_merge_strategies_selector removes those three for an installed DuckDB older than1.4.0. The dlt extra's duckdb>=0.9 dependency alone therefore does not establish those operations are available. The original1,864,588-byte uv.lock in this packet pins DuckDB1.5.3 and supplies the complete dependency resolution, platform wheel URLs and hashes. Preserve the actual receiving environment and show its destination version when presenting these strategies.

Source: dlt/destinations/impl/duckdb/factory.py, lines130-150, already in the base; complete new uv.lock, Gitc9a7406b68a202d9ec01f2071ae149eb71ebe9de. Keep the version-selected capabilities returned by the native engine.

The original DuckDB package uses insert_values as its preferred loader format. Its real job implementation, SQL client superclass and merge SQL are added here, together with the original relational schema, migrations, trace and CLI functions. These support source-level binding in the existing operator. They are not a partial installation of dlt: install the complete engine at the pinned commit.

The original package metadata requires Python>=3.10,<3.15. The existing owner's exact-commit installation can retain the original lock or explicitly choose DuckDB1.5.3:
    python -m pip install 'dlt[duckdb] @ git+https://github.com/dlt-hub/dlt.git@2360d229c77f7f64692acc31a4555f4cfcd50ed3' 'duckdb==1.5.3'
This command pins the engine commit and DuckDB; retain the supplied lock and actual installed dependency record for complete environment reproducibility.

## Unchanged executable reference closure

The14 reference files are every member of tests/pipeline/cases/github_pipeline/, the original tests/normalize/cases/github.issues.load_page_5_duck.json, and tests/pipeline/cases/separate_steps/pipeline_step_loop.py. Their imports close over installed dlt and Python stdlib; github_extract.py's adjacent github_pipeline module is included. The two original zero-byte files are intentional and retained exactly.

The full original JSON is526,313 bytes, Git9afbb8c0421223be385c3ac5480fa441613c3f67. It contains100 distinct issue IDs; its top-level list fields contain34 labels and31 assignees. Created timestamps span2018-08-14T10:51:35Z through2023-02-17T09:52:12Z. Those are raw source observations, not native destination-row assertions. Keep the original full JSON bytes. Use Python's original JSON parsing and native normalization; the existing large-integer fixture from the base companion remains separate.

For a materialized upstream directory /owned/dlt-upstream, make /owned/dlt-upstream/_storage the process current directory. The fixture's unchanged literal ../tests/normalize/cases/github.issues.load_page_5_duck.json then resolves to this supplied input.

Bind the original dlt configuration to an owned, retained reference directory:
    PIPELINES_DIR=/absolute/owned/dlt-reference/pipelines
    DESTINATION__DUCKDB__CREDENTIALS=/absolute/owned/dlt-reference/reference.duckdb
    RUNTIME__DLTHUB_TELEMETRY=false

From /owned/dlt-upstream/_storage, the original staged commands are:
    python ../tests/pipeline/cases/github_pipeline/github_extract.py
    python ../tests/pipeline/cases/github_pipeline/github_normalize.py
    python ../tests/pipeline/cases/github_pipeline/github_load.py

They keep pipeline_name=dlt_github_pipeline, dataset_name=github_3 and destination=duckdb. The original combined entrypoint is:
    python ../tests/pipeline/cases/github_pipeline/github_pipeline.py duckdb

The application owner selects the reference and its placement in the one existing programme. Continue an interrupted staged operation through the existing dlt pipeline/package identities. Do not interpret the combined entrypoint as permission to discard pending state or initialize a second customer programme.

The unchanged datetime_key_pipeline.py also carries a three-row incremental cursor-boundary example and its fourth advanced row. Its modes are scd2, upsert and incremental, optionally followed by advance. Its pipeline name is fixed, so retain a distinct original reference working directory per selected scenario. The other complete cases preserve upstream SCD2, null-column, legacy-key and normalized-refresh examples. Use a specific case only for a concrete original integration need; no repository-wide suite is requested.

## Preserve the existing recovery guide

The merged README's precise run(data) branch is correct: after pending extraction is normalized, remaining normalized packages are loaded and returned before new extraction. If none remain, control can fall through to supplied new input. The original package IDs and actual branch outcome determine which source was processed.

Keep the original abort plan and local restore behavior. A retained .restore snapshot enables rewind; an older package without it retains the native warning and actual remaining state. Abort does not undo all destination writes. No supplemental convenience state machine or destination rollback is introduced.

Use the existing base guide for native failure/retry/abort semantics and exact LoadInfo/LoadPackageInfo representation. The newly supplied production guide and actual CLI implementation give complete adjacent source for the same contracts.

## Delivery evidence

Source-only acquisition and complete byte/hash verification are finished. Every added leaf was fetched from the exact pinned public upstream commit. The full original uv.lock was acquired through its Git blob after the contents reader rejected its size. All original bytes match; no text extraction or inferred fixture reconstruction is used.

The existing application owner receives this complete source bank and retains its native execution and commercial ownership. Its actual pipeline/database outputs remain the result of its original receiving programme.
