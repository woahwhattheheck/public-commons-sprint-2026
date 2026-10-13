# Receive and run the regional study application

The complete public application contains the regional pipeline, published study profiles, raster-mask scenarios and report builder. Use the immutable Git commit supplied with the current delivery message, the receiving worker's existing GIS Python, and its retained scientific Workspace.

## Receive the complete source

Keep the model Workspace at its existing path while receiving the application source into an owned checkout. A Git worker can receive the exact revision with:

```sh
git -C "$UPSTATE_REPOSITORY" fetch origin "$UPSTATE_SOURCE_REF"
git -C "$UPSTATE_REPOSITORY" worktree add --detach "$UPSTATE_RECEIVED_SOURCE" "$UPSTATE_SOURCE_REF"
cd "$UPSTATE_RECEIVED_SOURCE/opportunities/upstate_forever_2026"
"$UPSTATE_GIS_PYTHON" -B -m model.cli runtime
```

Set those variables from the receiving operation's actual repository, destination, source commit and interpreter. The shipped environment.yml defines the native InVEST 3.20.0 GIS environment when an existing equipped interpreter is unavailable. Retained source manifests, input objects, grids and completed run IDs remain in the same Workspace.

## Execute the regional study

The regional study uses the retained 30 m grid. Its management alternatives use the exact 116-HUC reporting mask; native routing keeps all 217 contributing HUCs and the upstream buffer. After the existing regional core baseline is prepared:

```sh
"$UPSTATE_GIS_PYTHON" -B -m source_tools.upstate_study_profiles \
  --workspace "$UPSTATE_MODEL_WORKSPACE" \
  --core-result "$UPSTATE_CORE_RESULT" \
  --profile-spec upper_flint_ndr=source/upper-flint-2024/profile-ndr.json \
  --profile-spec upper_flint_sdr=source/upper-flint-2024/profile-sdr.json \
  --profile-spec upper_flint_combined=source/upper-flint-2024/profile-combined.json \
  --study-scenarios --run \
  --output "$UPSTATE_STUDY_RESULT"
```

The maintained experiment engine owns native compute, case state, completed-stage reuse and paired comparisons. With six distinct source profiles and seven alternatives, it prepares 48 cases. The study saves its experiment ID before execution and builds experiments/<id>/study-report/index.html, study-summary.json and study-comparisons.csv from completed or partial model results. Source and interpretation details are in source/regional-studies-20261013/README.md.

The receiving process should size its GDAL cache to its actual cgroup allocation. Native model and experiment locking remain with the existing engine.

## Compatibility receiving for earlier application snapshots

The following pinned installer supports the earlier source editions named below. The complete current public application already carries these regional modules and their newer source-storage, native reuse and study integrations.


Run the pinned source installer with the already equipped interpreter and the complete joined application:

```sh
/opt/pyvenv/bin/python -B integration/install_regional_pipeline.py /mnt/data/eco12-integrated-20261012 --keep-existing source_tools/climate_region.py --keep-existing model/regional_job.py --keep-existing model/regional_scenarios.py
```

Use the installer file from the immutable source revision accompanying the handoff. Its source catalog is pinned to `6ff9dcdf9d3907945d768d17439fb834ba7f4736`; it contains the actual selected-model source overlay, corrected overlay installer, retained-input optimization, climate preparation, regional baseline execution, scenario execution, physical native-input equivalence and their guides.

Apply the current 7F24 regional/spatial source overlay before this installer. The receiving application is the joined source at `/mnt/data/eco12-integrated-20261012`. Source order is the 12-file regional overlay `F0C8JK0F745`, the 70CB selected/cache source `F0C8JJQ2JBX`, the three-file regional supplement `F0C8RTWEVS5`, then the native-resolution successor `F0C8N1N4VF0` and selected-summary trio `F0C8HGL5YRZ`. The selected-model edits match its `Workspace` alignment code and preserve that code when applied afterward. When updating that spatial overlay again, merge the existing selected-model changes into the newer `Workspace` body before replacing it.

The installer downloads each exact file from that public revision and verifies its byte count and SHA256. When the existing application contains the maintained `model/model_selection.py` API from the current 70CB cache source, the installer exercises its real model normalization, role/output selection and native/profile interfaces, then retains those newer source bodies. This preserves completed NDR/SDR stage reuse and current workspace behavior. For the earlier original application, it applies the selected-model overlay through the context-preserving installer. Both routes then apply the retained-input overlay. The installation record identifies the exact selected-core source bodies adopted or changed. It then places the additive climate and regional modules in their application-relative directories, preserving prior versions when replacing a module. The installed files receive a targeted syntax/import check in the same interpreter. That check also calls the real progress writer with its running state transition and reads the persisted result, covering the first-transition defect corrected in this source revision. The operator and experiment application remain in the existing joined source root.

The installer includes the exact six-change update from the public native-equivalence v1 source to v2. It reads v1 from the pinned catalog or the offline `--bundle`, applies each unique source change, and verifies the full resulting v2 body: `377cfe7fa9e071f19dc180d667efeb5f9aa9f1071807a075273a0d7c2d21e621` (12,835 bytes). The installed matcher compares actual native stage runtimes and the original InVEST NDR/SDR dependencies, and includes TIFF masks and metadata companions in raster identity. The installation record contains both the original and resulting source hashes.

The default download directory is `integration/regional-downloads/<source-ref>/` under the application. Verified downloads are reused after interruption. The final `installed.json` identifies the exact application, interpreter, input revision, applied core edits and installed module bodies.

If the public source files have already been received as a directory with `model/`, `source_tools/` and `integration/` beneath it, select that root:

```sh
/opt/pyvenv/bin/python -B integration/install_regional_pipeline.py /mnt/data/eco12-integrated-20261012 --keep-existing source_tools/climate_region.py --keep-existing model/regional_job.py --keep-existing model/regional_scenarios.py --bundle /mnt/data/received-regional-pipeline
```

The current selected-stage summary trio is Canvas `F0C8HGL5YRZ`: apply its `model/regional_job.py`, `model/regional_scenarios.py` and `model/scenario_summary.py` together. Its driver hashes are `1d10da98f6db1671ffa8186cb9a56a425b5ecde8318aeadda31485ea42f6cb69` and `14bf7614ddd212bc345218273494241e04bddd2b0c50f8c526232522559ec2e8`; its complete summary module is `e161b0a41a5a57d1acba194b07baaf4234106f418ce1394418e05624edb2cd5b`. These produce the annual quantity tables immediately after actual selected-model execution and after paired scenario comparison.

`--keep-existing source_tools/climate_region.py` preserves the current joined climate source, including the 7F24 regional successor, and records its actual byte count and SHA256. The current climate successor is 16,166 bytes, SHA256 `a0d7cc4710b2ec998727ee1536af36370bfe27193afd08cb43b1c9e3d2aa9fcd`; the installer verifies that its retained raster aligner accepts `checkpoint_directory` and `source_identity` before keeping that source. If that file is absent, the pinned climate source is installed. When the receiving application already contains the later 7F24 regional driver and scenario summaries, also pass `--keep-existing model/regional_job.py --keep-existing model/regional_scenarios.py` to preserve those joined drivers. Kept Python modules still receive syntax and interface checks, including the real running-state transition. The `model/scenario_summary.py` source remains part of the regional overlay.

A separate retained download directory can be selected with `--cache`. Repeat the same invocation to continue an interrupted installation; already applied exact core edits and already installed matching files are retained.

## Execute the real scientific selection

From the joined source root, prepare climate roles on the same canonical grid as the terrain and land-cover inputs using `source_tools/climate_region.py`. The real source manifests and selected parameters define the scientific plan described in `model/REGIONAL_JOB.md`.

The scientific baseline entry is:

```sh
/opt/pyvenv/bin/python -B -m model.regional_job run --workspace "$UPSTATE_MODEL_WORKSPACE" --plan "$UPSTATE_CORE_PLAN" --source-reference "$UPSTATE_SOURCE_REF" --output "$UPSTATE_CORE_RESULT"
```

The actual source edition determines whether that core selects NDR, SDR or both. Once the baseline completes, execute the actual land-cover alternatives with their retained mask sources:

```sh
/opt/pyvenv/bin/python -B -m model.regional_scenarios --core-result "$UPSTATE_CORE_RESULT" --plan "$UPSTATE_SCENARIOS_PLAN" --output "$UPSTATE_SCENARIOS_RESULT"
```

Use the completed `scenario_runs` mapping and the separately retained parcel, protection and water source editions in the delivery plan, then invoke `model.regional_job finish` through its documented interface. The full existing seven-family delivery consumes the combined native baseline and its land-cover alternatives; each native result retains its actual model selection and outputs.
