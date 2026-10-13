# Install and operate the saved Monitoring comparison and scientific report

This directory carries the complete maintained Monitoring component, its original installers and declared base dependency bodies. It upgrades an existing registered Upper Savannah application while keeping its Workspace, native source collections, model runs, campaign history and other installed desks.

The canonical source remains under `opportunities/upstate_forever_2026/`. Every source-bank member has its complete original body, byte count and SHA256. `manifest.json` identifies the pinned source and the exact parts. The maintained Monitoring installer performs the source changes with its existing preimage guard, shared installation lock and rollback copies.

## Existing application and scientific project

Use the receiving host's existing application and scientific Python environment. The base must already contain:

- The original shared extension registry, operator task queue, file transport and complete Workspace backup/restore.
- The existing Scientific reports composer and source-edition provider: `sourceReports.openForSources`, `source-reports.render`, `source-reports.export`, and the scientific catalog/preview/edition routes.
- The declared Implementation and Study transfer dependencies listed in the manifest. Their complete pinned bodies are carried for source custody; the Monitoring installer preserves these shared installed dependencies.
- The original GIS/optimization/report libraries used by the application, including Fiona, Shapely, pyproj, SciPy and ReportLab.

The two scientific figure renderers and the maintained observed-report renderer are installed through the same guarded file inventory. Exact original predecessors are admitted: all three historical vector-renderer editions, the original map renderer, its role-label successor, and the current edition. The installed map renderer supplies `ROLE_LABELS_VERSION = 1`. The observed-report renderer retains the current source-code binding and independent-capture inventory repair, with all four original historical bodies admitted by the same predecessor guard. Unknown newer source remains protected by the original installer; send its exact differing path/body to the current source owner for composition.

The saved scientific course below names the actual retained project `b9d5d257-c6bb-4f07-b975-8e8c63705db3`: its 217-catchment network, original 87-station source family, completed six-site campaign, and completed three-budget frontier. The supplied selection files name those exact records. They are suitable for an independently received copy of that project; its operator workspace key is determined by its actual receiving path.

The original 45,027,826-byte frontier archive has SHA256 `be799c9f0db7cd8d15c1aa912ea21207b537e212a63f796307611da8ac0a2ece`. The newer 221,545,725-byte regional archive already requested by SOL61 has SHA256 `2083e1f82456848bbc5350a286fd7c808810fb2c30400c9967093fd30ffc4641` and preserves later source work. Continue the actual copy already received on that host. The source bank does not replace its scientific project or source data.

## Stage and install the complete source

Place this whole bank directory on the existing host. Choose an application directory containing `model/workspace.py` and a new stage outside it. Keep the host's existing scientific Python executable.

```sh
python BANK/stage.py --application APP --source-root STAGE
python STAGE/integrations/monitoring/install_monitoring.py APP --source-root STAGE --check
python STAGE/integrations/monitoring/install_monitoring.py APP --source-root STAGE
```

`stage.py` first verifies the complete original `source_tools.application_assembly` body carried under `bootstrap/`, then delegates decoding, safe source paths, byte/hash validation and immutable file publication to that original module. The base application does not need to supply a matching staging API. It checks every part and member before writing the first staged source file. Repeating it with the same complete bank reuses identical staged files.

The installer reads the maintained inventory beside its own script. Its `--check` output names every intended path and identity before the normal installation command. The installed inventory now includes the original installers and their five maintained source-custody documents, so a later upgrade sees the current predecessor history. Scientific report maps and the existing composer are integrated with the saved comparison feature.

Restart the original operator after installation so its imported provider modules and browser assets use this source edition. Preserve its original operator-state directory and registered Workspace. Use its usual supervisor or original command:

```sh
python -B operator/server.py --workspace WORKSPACE --operator-state PRIVATE_OPERATOR_STATE --port 0
```

The startup receipt supplies the private operator URL and actual workspace key. Keep the full URL, including its token fragment, in a private local file for the maintained browser drivers.

## Complete the native comparison and report

This course consumes completed saved plans. Its budget comparison does not execute an optimizer or create another campaign.

Complete the whole native course with one command after the original installation:

```sh
python BANK/receive_native.py --application APP --workspace WORKSPACE \
  --selection BANK/native-comparison-selection.json --output OUTPUT/native-report \
  --report-title "Regional monitoring budget choices — scientific report" --transfer
```

The command reopens the completed frontier and source-bound comparison; retains its
complete packet; prepares the original scientific source; renders the original
HTML/PDF edition; exports its complete ZIP through the maintained operator provider;
and copies every original report output into `OUTPUT/native-report/scientific-report/`.
With `--transfer`, it also performs the original complete Workspace backup and
independent restore, then reopens the exact comparison, report source and edition.
`result.json` gives the actual IDs, file paths, byte counts and SHA256 values.

The request, selected original source bytes and installed producer identities are
recorded before native actions. Repeating the exact same invocation reopens its
same records and files from the atomic journal. A changed selection, report title,
contact or installed producer uses a new output directory. Optional `--contact
CONTACT.json` supplies the existing scientific composer's contact object. Omitting
`--transfer` completes all reports without another full archive; use the existing
host's archive boundary when that broader receiving operation is already running.

The equivalent original commands remain available individually. From `APP`, use
the native selection and a receiving-output directory outside the Workspace:

```sh
python -m model.monitoring_frontier_comparison --workspace WORKSPACE prepare \
  --selection BANK/native-comparison-selection.json --output OUTPUT/comparison.json
python -m model.monitoring_frontier_comparison --workspace WORKSPACE export \
  --id SAVED_COMPARISON_ID --output OUTPUT/comparison-files
python model/monitoring_report_cli.py --workspace WORKSPACE \
  --output OUTPUT/comparison-report-source.json prepare \
  --comparison-id SAVED_COMPARISON_ID \
  --title "Regional monitoring budget choices — scientific report"
```

Read `SAVED_COMPARISON_ID` directly from `OUTPUT/comparison.json.id`. The report-source command retains every original comparison plan, exact source packet, selected observed context, vector map and budget/coverage figure. Its output identifies the new document in the same native source collection system.

The existing native scientific edition API can complete HTML/PDF and all report files on the native/API host independently of browser availability. Run the following with the actual Workspace and the preceding output:

```sh
python - WORKSPACE OUTPUT/comparison-report-source.json OUTPUT/scientific-edition.json <<'PY'
import sys
from pathlib import Path
from model.common import atomic_json, read_json
from model.workspace import Workspace
from model import monitoring_report_source, scientific_report_editions
ws = Workspace(Path(sys.argv[1]))
source = read_json(Path(sys.argv[2]))
report = monitoring_report_source.inspect(ws, source["id"], verify=True)
payload = {"sources": [report["source"]], "title": report["title"], "contact": {}}
preview = scientific_report_editions.preview(ws, payload)
result = scientific_report_editions.render(ws, {**payload, "preview_id": preview["id"]})
edition, directory, operation = scientific_report_editions.inspect(
    ws, result["scientific_report_edition_id"])
atomic_json(Path(sys.argv[3]), {
    "project_id": ws.project["id"], "comparison_report_id": report["id"],
    "scientific_report_edition_id": edition["id"], "directory": str(directory),
    "edition": edition, "files": scientific_report_editions.files(edition, directory),
})
print(edition["id"])
PY
```

These are the original producer and renderer APIs, with their original source verification, immutable output and locks. Their returned directory contains the completed report and all original report files. The browser course below reopens and downloads the native report edition and its complete ZIP through the original queue.

If the receiving project has the original 589-result Eighteenmile context, choose its existing per-plan context records in the comparison selection before preparing the comparison. The retained 87-station network maps `21SC60WQ_WQX-SV-233` to `SV-233` and `21SC60WQ_WQX-SV-376` to `SV-376`; the other two cohort stations are outside that station family. The supplied comparison selection intentionally has an empty context list and operates the original saved planning designs immediately. Adding original observed contexts is a new explicit selection, retaining their exact plan/source identities.

## Operate the complete browser course

Use the browser-authorized host's actual original server and installed Chromium. Run the maintained driver from its staged location; make the host's existing Playwright package available through its normal Node module environment.

```sh
node STAGE/source/run_monitoring_browser.mjs \
  --url-file PRIVATE_OPERATOR_URL_FILE --workspace ACTUAL_WORKSPACE_KEY \
  --restored-selection BANK/monitoring-selection.json \
  --comparison-selection BANK/browser-comparison-selection.json \
  --comparison-report-title "Regional monitoring budget choices — scientific report" \
  --browser-executable ACTUAL_CHROMIUM --browser-renderer-limit 2 \
  --output OUTPUT/browser-course --video
```

This opens the original network, campaign and calendar; reopens the saved budget frontier; prepares its exact comparison and report source; enters the existing ordered scientific composer; renders or reopens the completed edition; downloads every original source/report member and the complete report ZIP; and reopens the same records in a fresh browser and independently received complete Workspace. The comparison maps use original geometry transformed to EPSG:5070 with all polygon vertices and holes retained.

The driver preserves the existing composer draft, source order and contact fields. If the operator already had other selected report sources, they remain part of that explicitly observed draft. The complete native preview and source identities enter the durable browser request.

For an interrupted invocation, use the same selection files, title, output directory and workspace key with `--resume`. Its private request state retains each original action body before dispatch and resumes the same accepted task or lost-response operation. Changing a selected source, report title or scientific intent calls for a new output directory. The actual running receiver invocation keeps its existing intent.

The complete original Chemistry browser and both maintained progression files are also in this bank. The progression supports `--monitoring-comparison-selection`, `--monitoring-comparison-report-title` and optional `--monitoring-comparison-report-delivery`. Use that continuation when the host already owns the full regional course; the direct Monitoring command above is the course for this already received campaign and report.

## Source and interpretation

The original planning scenario uses USD 4,800 / 9,000 / 13,200 budgets, programme overhead 600, setup 250 and 150 per visit across three rounds. Those explicit engineering planning assumptions produced the retained six-, twelve- and eighteen-site choices. They remain separate from station observations and do not assert agency prices or available field crews. The report preserves cost in integer cents and the original source-weighted coverage units.

Scientific raw data are already retained in the Workspace and remain editable through complete Workspace transfer. Broader observed-context inventories also reference their original microbial and nutrient source families; this scoped code upgrade retains those inventories without reimporting unrelated datasets. The source-bank manifest distinguishes installed component files, preserved base dependencies and receiving-driver source.

The current complete native-report release contains 97 source members and 1,866,478 source bytes, including 66 installed component paths, 25 preserved base-dependency bodies and six receiving-driver paths. Its current shared renderer was read from `fa7a77aecef81f13765a0c1024aef68dd323cb15`; the frozen original release remains available at `39a1b704557493ed5b4dc495a7e5fa47362d18df`. The receiving command uses the native `portable.resume_restore` on applications that supply it, with the original full-member receiving check retained for earlier complete bases.

## Rendered-product inspection before presentation

The owner instruction in repository `AGENTS.md` version `2026-10-13.1` applies to the producing receiving worker. Open and render the exact outgoing operator and scientific reports, view their actual screens or real screenshots, and operate their important controls before describing them as client-ready. Inspect the populated scientific Workspace at the intended desktop/screenshare and narrow widths, relevant empty/loading/error states, downloads/exports and reopening. View the generated PDF, HTML and source pages themselves; repair unreadable, clipped, overflowing or broken output in the same operation. Source checks and screenshot capture alone do not establish rendered readiness.

Keep the plain industrial presentation: readable tables, restrained controls, clear hierarchy, consistent spacing and useful labels. Preserve the existing native science and the current receiving owners. Carry this instruction into the receiver's application-level instructions and current handoff guides. Return the actual populated-workspace screenshots and report files so the original producing team can also inspect them. This continues the existing Ecosystem sprint; its cutoff remains **October 13, 2026, 14:00 UTC** (10:00 a.m. America/Kentucky/Louisville).
