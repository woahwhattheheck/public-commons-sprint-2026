# Producing native-model versions in scientific deliveries

## Original product path

The existing scientific delivery builder now freezes the producing NDR and SDR identities in `native-execution.json`. Its existing retained-file inventory, manifest project assets, working archive and authenticated download routes carry this file. The PDF, offline HTML and structured report share the same native execution section. Baseline raster FGDC metadata and original map footers label the producing model stage rather than the delivery application's adapter constant.

A completed stage's original `runtime.version` takes precedence. If that stage has no recorded version, the report labels the original run runtime as a fallback. Historical records with neither use their retained requested version and say that it is a legacy declaration. A later SDR execution can update the run runtime without changing the earlier NDR output. Versions remain separate for each model, with requested and last-run values shown for context.

`native-execution.json` retains ordered run IDs, original selections, per-model provenance, original module/source identities and selected models from the run and stages. Original environment and complete stage files stay in the original working project. The current manifest keeps its structured `model.versions` and `model.native_version_provenance`, and `model.version` remains the actual common version across all selected runs/models or null when there is none. Its separate `model.application_version` records the delivery adapter version; `model.execution_provenance` points to the hashed execution companion.

The direct native delivery cohort uses the same shared per-model comparison rule as scenario analysis. Each compared NDR stage must agree with baseline NDR, and each compared SDR stage must agree with baseline SDR. NDR and SDR can have different effective versions within a run. All prior grid, profile, original land-cover scenario, common support, units and native output rules remain in effect.

The frozen execution digest joins the saved delivery selection. A resumed incomplete delivery verifies the retained companion bytes and exact frozen contents before continuing. Existing complete delivery records and their source files remain readable through the original inspector.

## Component installation closure

Use the complete current application or the existing component installers. The extension host permits multiple descriptors to declare the same static asset. Each importing desk therefore declares `native_versions.mjs` directly:

- `operator/extensions/scenario-analysis.json`
- `operator/extensions/decisions.json`
- `operator/extensions/scenario-analysis-delivery.json`
- the existing `operator/extensions/portfolio-pairing.json`

Both shared source files are part of the current component source: `model/native_versions.py` and `operator/web/native_versions.mjs`. The Python helper uses the original application's `model/model_selection.py`.

The original `operator/apply_scenario_analysis.py` accepts its plaintext source packet or its complete `commons.source-bank/v1` with `installer_packet`, original predecessor metadata and complete runtime/registry files. It checks helper inclusion and direct descriptor ownership before writing. Old source packets without these imports retain their previous behavior. Its legacy mode adds the browser helper to the original explicit static allowlist; extension mode serves it through the descriptor. Existing guarded preimages, concurrent-change checks and exact original operator joins remain authoritative.

`install_economic_desk.py` installs the Python helper with its original desk files and requires the existing native model-selection module alongside the original decision companion. Use its existing `--dry-run` to inspect the exact paths before the original installation.

`operator/scenario_decision_install.py` remains the original watershed preview integrator. When the installed producer imports the shared version helper, it verifies and compiles that helper and its native model-selection dependency before changing the server. Its returned receipt records their SHA256 values. Source delivery remains the existing complete component/application receiver; no new assembler is introduced.

## Receiving check

After composing these source files with the current complete application, use the original operator and an actual retained cohort. Open the existing saved analysis or portfolio continuation, build the original delivery, and inspect its PDF/HTML, one nutrient FGDC file, sediment FGDC file, map footers and `native-execution.json`. A run whose completed NDR stage has a different version from its last observed run runtime must show the stage's original version, with the last-run value separately identified. Reopen the saved delivery through its original inventory and download that same hashed companion.

Gura engine acceptance retains its original geography. Published South Carolina source-water areas require an actual intersecting Upper Savannah reporting grid and geographically matched native runs; the existing prepared-plan/source-area flow preserves those original identities.

## Receiving the client report and briefing

The original `source_tools/receive_client_delivery.py` continues to accept one
explicit retained delivery ID or its completed original native-study checkpoint.
Its selected application, compiler SHA256, report edition, project and ordered
native cohort remain authoritative. Edition
`2026-10-13-client-report-native-execution-13` adds the original
`native-execution.json` link to the client report's scientific evidence section
and therefore to its briefing. The edition change gives an already completed
edition-12 delivery a distinct retained rebuild.

The receiver verifies all six generated client files: PDF, HTML, Markdown,
structured report model, briefing HTML and briefing index. The index binds the
exact original model bytes; the HTML's embedded navigation model must match that
same index. Meeting notes remain the briefing's separate interactive export.
Native execution is checked against the delivery's frozen digest, ordered cohort,
client model version vectors and manifest descriptor. The existing working archive
inventory must preserve the same project, delivery selection and all seven file
descriptors, including native execution. The builder already verifies the complete
archive bytes; receiving reads its original inventory without another full scan.

For the selected edition in this source bank:

```sh
"$GIS_PYTHON" -B "$APPLICATION/source_tools/receive_client_delivery.py" \
  --application "$APPLICATION" --workspace "$ORIGINAL_WORKSPACE" \
  --native-study-record "$ORIGINAL_STUDY_CHECKPOINT" \
  --expected-report-edition 2026-10-13-client-report-native-execution-13 \
  --expected-compiler-sha256 a691e3061ba5ef8e3a156a29f7932ad1fe56b215e69b5bc8611567b2e625407e
```

Use `--delivery-id` instead of `--native-study-record` when continuing a selected
retained delivery directly. The receipt now includes each original client file,
the briefing binding and page count, and the native execution descriptor/digest.
Run this continuation after the existing native operation completes; it uses that
operation's original Workspace and report-bound native cohort.

## Validation scope

The current native-study consumer retains its separate original supported-engine and official-module source checks; its maintained source owner composes that context independently.

The change formats original native records and checks component source closure. It does not recompute ecological quantities. Full source and exact hashes are retained for receiving and independent review; native application execution is performed by the existing receiving operation.
