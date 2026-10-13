# Open the original authored chemistry recovery project

The maintained REACT12 component contains its complete four-reach authored reference project and original analysis requests. This preparation command retains those exact files in an existing scientific Workspace, saves the original chemical case through its native writer, and emits a selection that the complete receiving progression and Chemistry browser journey can use directly.

The project keeps its original nitrogen/phosphorus bases, reach volumes, flows, exchange, reactions, phased loads and object-level provenance. The original calibration request contains 36 authored recovery observations: 28 fit and 8 holdout records. Its unchanged parameters fit nitrification rate and point-source loading. Simulation, monitoring and uncertainty requests are also retained.

## Prepare the same original Workspace

From the current application:

    python source_tools/prepare_chemistry_reference.py \
      --workspace /actual/scientific-workspace \
      --output /actual/chemistry-reference

The Workspace must already exist. Preparation verifies all seven original example files against the retained REACT12 source manifest before importing anything. The original source manifest and all requests travel as source companions with the project. A repeated preparation with the same selection reopens the same immutable source and case IDs.

The default mode is calibrate. Select --mode simulate, --mode monitoring or --mode uncertainty for another complete original request, using its own output directory. The source project and coefficients stay unchanged.

The output contains:

- inputs/: the unchanged seven example files and original source manifest.
- sources.json: the native source edition that was imported.
- chemistry-selection.json: the actual case ID, relative original request path and editable-receive selection accepted by the complete receiving progression.
- chemistry-reference-opening.json: the existing project and original operator workspace identities, source and case IDs, selected request identity, actual observation-role counts and ready browser arguments.

The original case and all source companions are retained through Workspace.import_sources and Chemistry.from_source. Reopening verifies that the original complete project and retained native file match.

## Operate the complete browser workflow

Pass chemistry-selection.json to the maintained receiving progression's existing chemistry selection option. Relative request paths are resolved beside that selection and frozen before execution.

For a direct browser operation, use the emitted browser_arguments array and the existing private operator URL file:

    python - /actual/chemistry-reference/chemistry-reference-opening.json \
      /actual/private/operator-url.txt <<'PY'
    import json, subprocess, sys
    with open(sys.argv[1], encoding="utf-8") as source:
        opening = json.load(source)
    subprocess.run([
        "node", "source/run_chemistry_browser.mjs",
        "--url-file", sys.argv[2], *opening["browser_arguments"]
    ], check=True)
    PY

This uses the actual original operator, saved case, original model queue, generated reports, editable package receiving and complete Workspace backup/restore. The native calculation runs through the installed model.reach_chemistry engine. Calculation results and timings are produced by that execution.

After an interruption, repeat the browser command with --resume appended to the argument array. Its original output directory and request state preserve the same save, analysis, export and receiving tasks. See source/CHEMISTRY_BROWSER.md for the complete operator workflow and continuation contract.

## Retained source

The input edition is the unchanged ASTRA-REACT12 0.1.0 release under integration/reach_chemistry/examples. Its original provenance labels describe a constructed mathematical reference. Upper Savannah field observations keep their own retained source, geographic and measured-observation selections in the scientific application.

The original project and analysis definitions remain documented in CHEMISTRY.md. The real operator workflow is documented in operator/CHEMISTRY_OPERATOR.md.
