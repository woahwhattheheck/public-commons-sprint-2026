"""Build a readable offline opening page for the completed headwaters handover.

The original rehearsal bundle owns publication. This helper reads its frozen
selection and exact final scientific archive, exposing selected original reports
and maps alongside the existing project, teaching files and recorded browser.
It does not change a Workspace or execute a scientific calculation.
"""
from __future__ import annotations

from contextlib import ExitStack
import hashlib
import html
import json
import math
from pathlib import Path, PurePosixPath
from urllib.parse import quote
import zipfile

CASE = "uploads/simulated-headwaters/selected-case.json"
RECEIPT = "uploads/simulated-headwaters/original-demo-receiving.json"
SCHEMA = "upstate.simulated-headwaters-handover/v1"


def _name(value):
    if not isinstance(value, str) or not value or "\\" in value or "\0" in value:
        raise ValueError("Retain a relative handover member name")
    path = PurePosixPath(value)
    if path.is_absolute() or ".." in path.parts or str(path) != value:
        raise ValueError("The handover member must remain inside its original package")
    return value


def _path(output, value):
    name = _name(value)
    path = output
    for part in PurePosixPath(name).parts:
        path = path / part
        if path.is_symlink():
            raise ValueError("The handover source is a file alias: " + name)
    if not path.is_file():
        raise ValueError("The selected handover file is absent: " + name)
    return path


def _retained(output, complete, name):
    path = _path(output, name)
    identity = complete["retained_files"].get(name)
    if not isinstance(identity, dict):
        raise ValueError("The final rehearsal did not retain the selected file: " + name)
    body = path.read_bytes()
    if (len(body) != identity["bytes"]
            or hashlib.sha256(body).hexdigest() != identity["sha256"]):
        raise ValueError("The selected handover source changed: " + name)
    return body


def _json(body):
    return json.loads(body)


def _text(value):
    return html.escape(str(value), quote=True)


def _href(value):
    return quote(_name(value), safe="/")


def _number(value):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        return "Unspecified"
    return format(value, ".8g")


def _title(value):
    return Path(value).stem.replace("_", " ").replace("-", " ")


def _link(path, label, *, download=False, css=""):
    return ('<a href="' + _href(path) + '"' + (' download' if download else '')
            + (' class="' + _text(css) + '"' if css else '') + '>' + _text(label) + '</a>')


def _original_reports(output, complete, receipt):
    """Expose complete selected report directories without changing their bytes."""
    archive_item = complete["files"]["scientific_archive"]
    archive_name = _name(archive_item["path"])
    if complete["retained_files"].get(archive_name) != {
            key: archive_item[key] for key in ("bytes", "sha256")}:
        raise ValueError("Use the final rehearsal's original scientific archive")
    archive_path = _path(output, archive_name)
    # The parent bundle has just verified its complete checkpoint, including
    # this archive's full digest. Verify each extracted member against ARCHIVE.
    before = archive_path.stat()
    report_id = receipt["scientific_report"]["id"]
    delivery_id = receipt["delivery_id"]
    for value in (report_id, delivery_id):
        if not isinstance(value, str) or len(value) != 64 or any(c not in "0123456789abcdef" for c in value):
            raise ValueError("Retain the actual selected scientific report and delivery IDs")
    families = {
        "workspace/scientific-report-editions/" + report_id + "/": "handover/scientific-report/",
        "workspace/deliveries/" + delivery_id + "/": "handover/maps/",
    }
    extra, report_files, map_files = {}, [], []
    with zipfile.ZipFile(archive_path) as archive:
        names = archive.namelist()
        if len(names) != len(set(names)):
            raise ValueError("The selected scientific archive repeats a member")
        manifest = _json(archive.read("ARCHIVE.json"))
        if manifest["project"]["id"] != complete["project_id"]:
            raise ValueError("The scientific archive belongs to another project")
        for prefix, target in families.items():
            original_names = sorted(name for name in manifest["members"] if name.startswith(prefix))
            if not original_names:
                raise ValueError("The final project lacks the selected report directory: " + prefix)
            for name in original_names:
                _name(name)
                relative = _name(name[len(prefix):])
                expected = manifest["members"][name]
                if archive.getinfo(name).file_size != expected["bytes"]:
                    raise ValueError("The selected report member size differs: " + name)
                destination = target + relative
                extra[destination] = {"archive": archive_path, "member": name,
                                      "bytes": expected["bytes"], "sha256": expected["sha256"]}
                (report_files if target.endswith("scientific-report/") else map_files).append(destination)
    after = archive_path.stat()
    if (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns, before.st_ctime_ns) != (
            after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns):
        raise ValueError("The scientific archive changed while preparing its opening page")
    return extra, report_files, map_files


def member_identity(value):
    """An original descriptor or the identity of a small generated document."""
    if isinstance(value, bytes):
        return {"bytes": len(value), "sha256": hashlib.sha256(value).hexdigest()}
    return {key: value[key] for key in ("bytes", "sha256")}


def write_members(destination, members):
    """Stream original report trees, including large nested project downloads."""
    with ExitStack() as stack:
        archives = {}
        for name, value in sorted(members.items()):
            _name(name)
            if isinstance(value, bytes):
                destination.writestr(name, value)
                continue
            original_path = value["archive"]
            if original_path not in archives:
                archives[original_path] = stack.enter_context(zipfile.ZipFile(original_path))
            archive = archives[original_path]
            digest, length = hashlib.sha256(), 0
            with archive.open(value["member"]) as source, destination.open(name, "w", force_zip64=True) as target:
                for block in iter(lambda: source.read(1024 * 1024), b""):
                    target.write(block)
                    digest.update(block)
                    length += len(block)
            if length != value["bytes"] or digest.hexdigest() != value["sha256"]:
                raise ValueError("The original report changed while writing its handover: " + name)


STYLE = """
:root{color-scheme:light;font-family:Arial,Helvetica,sans-serif;color:#202020;background:#fff;
font-size:16px;line-height:1.55}
*{box-sizing:border-box}body{margin:0;background:#fff;color:#202020}
a{color:#202020;text-underline-offset:.2em}a:hover{text-decoration-thickness:2px}
a:focus-visible,summary:focus-visible{outline:3px solid #303030;outline-offset:4px}
header,main,footer{max-width:1120px;margin:auto;padding:28px 32px}
header{padding-top:48px;border-bottom:1px solid #b9b9b9}
.eyebrow{font-size:.78rem;letter-spacing:.08em;text-transform:uppercase;color:#4b4b4b}
h1{font-size:clamp(1.85rem,4vw,2.7rem);line-height:1.15;margin:12px 0 18px;font-weight:650}
h2{font-size:1.45rem;line-height:1.25;margin:0 0 16px}h3{font-size:1.06rem;margin:0 0 10px}
p{max-width:80ch;margin:10px 0 18px}.lead{font-size:1.08rem;color:#383838}
nav,.actions{display:flex;flex-wrap:wrap;gap:10px;margin:22px 0}
.button{display:inline-flex;align-items:center;justify-content:center;min-height:44px;
padding:10px 16px;border:1px solid #555;border-radius:3px;background:#fff;color:#202020;
font-weight:600;text-decoration:none;text-align:center}
.button.primary{background:#242424;border-color:#242424;color:#fff}
.button:hover{box-shadow:inset 0 0 0 1px currentColor}
section{padding:30px 0;border-bottom:1px solid #c9c9c9}
.stats,.cards,.figures{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px}
.stat,.card{min-width:0;padding:18px;border:1px solid #bbb;background:#fff;color:#202020;border-radius:3px}
.stat strong{display:block;font-size:1.35rem;line-height:1.3}.muted{color:#555;font-size:.9rem}
.cards{grid-template-columns:repeat(2,minmax(0,1fr))}
.table-scroll{max-width:100%;overflow:auto;border:1px solid #bbb;border-radius:3px;margin:14px 0}
table{width:100%;border-collapse:collapse;text-align:left;font-size:.92rem}
th,td{padding:10px 12px;border-bottom:1px solid #d0d0d0;vertical-align:top}
th{font-weight:650;background:#f2f2f2;color:#202020}tr:last-child td{border-bottom:0}
.numeric{white-space:nowrap;font-variant-numeric:tabular-nums;text-align:right}
.unit{white-space:nowrap}.quantity{min-width:7.5em}
dl{display:grid;grid-template-columns:minmax(8em,.7fr) minmax(0,1.3fr);gap:8px 16px;margin:0}
dt{font-weight:600}dd{margin:0;overflow-wrap:anywhere}
.file-list{padding-left:22px}.file-list li{padding:5px 0}.file-list a{overflow-wrap:anywhere}
details{margin:18px 0}summary{cursor:pointer;font-weight:600;padding:9px 0}
code{font-family:ui-monospace,Consolas,monospace;font-size:.84em;overflow-wrap:anywhere}
figure{margin:0;border:1px solid #c3c3c3;padding:12px;background:#fff;color:#202020;min-width:0}
figure img{width:100%;height:210px;object-fit:contain;display:block;background:#fff}
figcaption{font-size:.85rem;margin-top:8px;overflow-wrap:anywhere}
video{display:block;width:100%;max-height:680px;background:#151515;border:1px solid #777}
.callout{padding:16px 18px;background:#f5f5f5;border-left:3px solid #555;color:#202020}
footer{font-size:.86rem;color:#555;padding-bottom:44px}
@media(max-width:620px){header,main,footer{padding-left:18px;padding-right:18px}
header{padding-top:28px}.stats{grid-template-columns:1fr}.stat{display:flex;gap:12px;align-items:baseline}
.stat strong{font-size:1.15rem}.cards,.figures{grid-template-columns:1fr}
nav{display:grid;grid-template-columns:1fr 1fr}.button{padding:10px 12px;font-size:.9rem}
dl{grid-template-columns:1fr;gap:2px}dd{margin-bottom:12px}th,td{padding:9px 10px}
h2{font-size:1.3rem}section{padding:25px 0}}
@media print{header,main,footer{max-width:none;padding:16px 0}.actions,nav,video{display:none}
.card,figure,.stat{break-inside:avoid}details{display:block}a{color:#000}.table-scroll{overflow:visible}}
"""


def _file_list(paths):
    return '<ul class="file-list">' + "".join(
        "<li>" + _link(path, _title(path)) + "</li>" for path in paths) + "</ul>"


def _primary(paths, suffix):
    selected = [path for path in paths if path.lower().endswith(suffix)]
    return min(selected, key=lambda p: (len(PurePosixPath(p).parts), len(p), p)) if selected else None


def _render(case, receipt, complete, report_files, map_files, browser):
    runs = case["runs"]
    course = case.get("parameter_course") or {}
    progress = course.get("progress") or {}
    report_html = _primary(report_files, ".html")
    report_pdf = _primary(report_files, ".pdf")
    project_zip = complete["files"]["scientific_archive"]["path"]
    recording = ((browser or {}).get("phases") or {}).get("recording")
    buttons = []
    if report_html:
        buttons.append(_link(report_html, "Read the scientific report", css="button primary"))
    if report_pdf:
        buttons.append(_link(report_pdf, "Download report PDF", download=True, css="button"))
    buttons.append(_link(project_zip, "Download working project", download=True, css="button"))
    buttons.append('<a class="button" href="#walkthrough">'
                   + ("Recorded walkthrough" if recording else "Teaching course") + "</a>")
    case_cards = []
    for row in runs:
        footprint = row.get("footprint_summary") or {}
        case_cards.append('<article class="stat"><strong>' + _text(row["role"].capitalize())
            + '</strong><span>' + _text(row["scenario_title"]) + '<br><span class="muted">'
            + _text(_number(footprint.get("net_changed_hectares"))) + ' ha changed · '
            + _text(_number(footprint.get("net_changed_cells"))) + ' cells</span></span></article>')
    comparisons = []
    quantities = {"nitrogen_export": "Nitrogen", "phosphorus_export": "Phosphorus",
                  "sediment_export": "Sediment"}
    for run in runs[1:]:
        rows = [row for row in case["native_changes"] if row["run_id"] == run["run_id"]]
        body = []
        for row in rows:
            if row["direction"] != "alternative minus baseline":
                raise ValueError("Use the retained native comparison direction")
            body.append('<tr><td class="quantity">' + _text(quantities.get(row["quantity"], row["quantity"]))
                + '</td><td class="numeric">' + _text(_number(row.get("alternative_minus_baseline")))
                + '</td><td class="unit">' + _text(row.get("units") or "Unspecified")
                + '</td><td class="numeric">' + _text(_number(row.get("common_valid_cells"))) + '</td></tr>')
        comparisons.append('<article class="card"><h3>' + _text(run["scenario_title"])
            + '</h3><p class="muted">' + ('Changed parameter profile' if run.get("profile_changed")
                else 'Same parameter profile as the baseline') + '</p><div class="table-scroll">'
            + '<table><thead><tr><th>Quantity</th><th class="numeric">Signed change</th><th>Unit</th>'
            + '<th class="numeric">Common cells</th></tr></thead><tbody>' + "".join(body)
            + '</tbody></table></div></article>')
    course_text = (str(progress.get("complete", "Unspecified")) + " / "
                   + str(progress.get("total", "Unspecified")) + " retained native runs complete")
    selected_figures = [path for path in report_files if path.lower().endswith((".svg", ".png"))][:6]
    figures = ('<div class="figures">' + "".join(
        '<figure><a href="' + _href(path) + '"><img src="' + _href(path) + '" alt="'
        + _text(_title(path)) + '" loading="lazy"></a><figcaption>' + _text(_title(path))
        + '</figcaption></figure>' for path in selected_figures) + '</div>') if selected_figures else ""
    visible_reports = [path for path in report_files if path.lower().endswith((".html", ".pdf"))]
    visible_maps = [path for path in map_files if path.lower().endswith((".html", ".pdf", ".gpkg", ".qgz"))]
    media = ""
    if recording:
        path = "browser/" + _name(recording["path"])
        if complete["retained_files"].get(path) != {
                key: recording[key] for key in ("bytes", "sha256")}:
            raise ValueError("The opening page recording differs from the completed browser")
        media = ('<video controls preload="metadata" aria-label="Original recorded operator walkthrough">'
                 '<source src="' + _href(path) + '"></video><p>'
                 + _link(path, "Download the original recording", download=True) + '</p>')
    else:
        media = '<p>This handover includes the saved teaching course without a browser recording.</p>'
    teaching = [row["path"] for row in complete["files"]["teaching"]]
    narration = "uploads/simulated-headwaters/narration-script.md"
    extra_teaching = [CASE, "uploads/simulated-headwaters/selected-case.md",
                      "uploads/simulated-headwaters/TEACHING_GUIDE.md", narration]
    teaching.extend(path for path in extra_teaching if path in complete["retained_files"])
    browser_files = ((browser or {}).get("files") or [])
    screenshots = ["browser/" + row["path"] for row in browser_files
                   if row["path"].lower().endswith((".png", ".jpg", ".jpeg"))]
    chapter_files = ["browser/" + row["path"] for row in browser_files
                     if row["path"].lower().endswith((".pdf", ".html", ".zip"))
                     and ("field" in row["path"].lower() or "customer" in row["path"].lower()
                          or "qc-comparison" in row["path"].lower())]
    stage_names = [
        ("baseline_native", "Baseline native calculation"),
        ("alternative_native", "Riparian native calculation"),
        ("control_native", "Matched-control native calculation"),
        ("parameter_course", "Complete parameter course"),
        ("mapped_delivery", "Mapped delivery"),
        ("scientific_report_edition", "Scientific report"),
        ("selected_study_cold_reopen", "Selected-study independent reopening"),
        ("cold_reopen", "Full-project independent reopening"),
    ]
    history = []
    for key, label in stage_names:
        stage = receipt.get("stages", {}).get(key) or {}
        if stage.get("state") == "complete" and stage.get("first_completed_at"):
            history.append("<tr><td>" + _text(label) + '</td><td class="numeric">'
                + _text(_number(stage.get("first_elapsed_seconds"))) + "</td><td>"
                + _text(stage["first_completed_at"]) + "</td></tr>")
    elapsed = ('<section aria-labelledby="history-heading"><h2 id="history-heading">Recorded execution history</h2>'
        '<p>These first-completed phase durations come from the saved demonstration record. '
        'The working project retains the original native logs and reuse history; the walkthrough has its own duration.</p>'
        '<div class="table-scroll"><table><thead><tr><th>Operation</th><th class="numeric">Elapsed seconds</th>'
        '<th>First completion (UTC)</th></tr></thead><tbody>' + "".join(history)
        + '</tbody></table></div></section>') if history else ""
    identities = [
        ("Project", case["project_id"]), ("Native comparison", case["comparison_id"]),
        ("Scientific report", receipt["scientific_report"]["id"]),
        ("Parameter study", course.get("ensemble_id", "Unspecified")),
        ("Programme", receipt.get("programme_id", "Unspecified")),
        ("Rehearsal", complete["rehearsal_id"]),
    ]
    details = '<dl>' + "".join('<dt>' + _text(label) + '</dt><dd><code>' + _text(value)
                              + '</code></dd>' for label, value in identities) + '</dl>'
    return ('<!doctype html><html lang="en"><head><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width,initial-scale=1">'
        '<meta name="color-scheme" content="light"><title>Headwaters restoration study</title>'
        '<style>' + STYLE + '</style></head><body>'
        '<header><div class="eyebrow">Simulated inputs · Native InVEST '
        + _text(receipt.get("invest_version", "3.20.0")) + '</div>'
        '<h1>Headwaters restoration study</h1>'
        '<p class="lead">Follow one saved landscape from its original inputs through restoration alternatives, '
        'native nutrient and sediment calculations, field quality review, customer handback and an independently reopened working project.</p>'
        '<nav aria-label="Open the completed study">' + "".join(buttons) + '</nav></header><main>'
        '<section aria-labelledby="case-heading"><h2 id="case-heading">Three cases on the same landscape</h2>'
        '<p>The original simulated grid, scenario masks and parameter choices travel with this delivery. '
        'The comparison below reads the retained native results for these exact selected runs.</p>'
        '<div class="stats">' + "".join(case_cards) + '</div></section>'
        '<section aria-labelledby="comparison-heading"><h2 id="comparison-heading">What changed in the model</h2>'
        '<p>These are signed annual export changes: <strong>alternative minus baseline</strong>. '
        'A negative value means lower export. Each quantity uses its own original common-valid-cell support.</p>'
        '<div class="cards">' + "".join(comparisons) + '</div>'
        '<p class="muted">Whole-run totals may cover different valid cells. The paired changes above retain '
        'the common support of each original comparison; nitrogen, phosphorus and sediment keep their separate units.</p></section>'
        '<section aria-labelledby="study-heading"><h2 id="study-heading">Read the complete scientific study</h2>'
        '<p><strong>' + _text(course_text) + '</strong>. The report includes the saved parameter choices, '
        'native process figures, exact support, field observations and quality-control history.</p>'
        + _file_list(visible_reports) + figures
        + '<details><summary>Comparison directions in the retained products</summary>'
        '<div class="table-scroll"><table><thead><tr><th>Product</th><th>Direction</th><th>Reduction sign</th></tr></thead>'
        '<tbody><tr><td>Native scenario comparison</td><td>Alternative minus baseline</td><td>Negative</td></tr>'
        '<tr><td>Parameter sensitivity</td><td>Varied-profile baseline minus reference-profile baseline</td><td>Negative</td></tr>'
        '<tr><td>Paired raster and joint siting products</td><td>Baseline minus alternative</td><td>Positive</td></tr>'
        '</tbody></table></div><p>Read each product’s original support and profile selection before comparing its values.</p></details></section>'
        '<section aria-labelledby="maps-heading"><h2 id="maps-heading">Maps and physical outputs</h2>'
        '<p>Open the original mapped delivery. Its legends, units and source references remain attached to the report files.</p>'
        + _file_list(visible_maps)
        + '<p>The complete working project also contains the original native rasters, source objects, editable selections and application.</p></section>'
        '<section id="walkthrough" aria-labelledby="walkthrough-heading"><h2 id="walkthrough-heading">'
        + ('The recorded operator course' if recording else 'The saved teaching course') + '</h2>'
        '<p>The course follows the actual retained case and saved controls. Its teaching selection and narration script identify the original inputs and displayed quantities.</p>'
        + media + _file_list(teaching)
        + ('<details><summary>Field, QC comparison and customer handback downloads</summary>' + _file_list(chapter_files) + '</details>' if chapter_files else '')
        + ('<details><summary>Original desktop and narrow-screen captures</summary>' + _file_list(screenshots) + '</details>' if screenshots else '')
        + '</section>' + elapsed + '<section aria-labelledby="continue-heading"><h2 id="continue-heading">Continue the same working project</h2>'
        '<div class="actions">' + _link(project_zip, "Download the complete working project", download=True, css="button primary")
        + '</div><ol><li>Extract the project archive into a fresh directory.</li>'
        '<li>Open <code>application/START_HERE.md</code> for the maintained launch and runtime instructions.</li>'
        '<li>Open its retained Workspace to inspect the saved model results, reports, Programme, field plan and customer history.</li></ol>'
        '<p>Keep this complete handover together so the report assets, recording and downloads remain available offline.</p>'
        '<details><summary>Original project and source identities</summary>' + details
        + '<p>' + _link("handover/contents.json", "Open the handover file index")
        + ' · ' + _link(CASE, "Open the frozen scientific selection")
        + ' · ' + _link(RECEIPT, "Open the original completed demonstration record")
        + '</p></details></section></main>'
        '<footer>Explicit simulated teaching study. Authored landscape inputs and decisions are identified in the original sources; '
        'the displayed quantities are retained native model outputs. Laboratory concentrations retain their own units and sampling support.</footer>'
        '</body></html>\n')


def build_members(output, complete):
    """Return additional ZIP members for the original complete bundle publisher."""
    output = Path(output)
    if not (output / CASE).is_file():
        return {}
    if complete.get("schema") != "upstate.rehearsal-receiving/v1" or complete.get("state") != "COMPLETE":
        raise ValueError("Finish the original headwaters rehearsal before building its complete handover")
    case = _json(_retained(output, complete, CASE))
    receipt = _json(_retained(output, complete, RECEIPT))
    if (case.get("schema") != "upstate.simulated-teaching-selection/v1"
            or case.get("project_id") != complete.get("project_id")
            or receipt.get("project_id") != complete.get("project_id")
            or case.get("demo_id") != receipt.get("demo_id")
            or receipt.get("state") != "complete"
            or case.get("native_direction") != "alternative minus baseline"
            or not isinstance(case.get("runs"), list) or len(case["runs"]) != 3
            or case["runs"][0].get("role") != "baseline"):
        raise ValueError("The opening page requires the same complete three-case native headwaters selection")
    run_ids = [row["run_id"] for row in case["runs"]]
    if (run_ids != [receipt["baseline_run_id"], *receipt["alternative_run_ids"]]
            or case["comparison_id"] != receipt["comparison_id"]
            or any(row["run_id"] not in run_ids[1:] for row in case["native_changes"])):
        raise ValueError("The opening page changed the selected native comparison")
    extra, report_files, map_files = _original_reports(output, complete, receipt)
    browser = None
    if complete.get("browser"):
        browser = _json(_retained(output, complete, complete["browser"]["path"]))
        if (browser.get("state") != "COMPLETE"
                or browser.get("rehearsal_id") != complete["rehearsal_id"]):
            raise ValueError("Use the same completed recorded browser course")
    page = _render(case, receipt, complete, report_files, map_files, browser)
    extra["START_HERE.html"] = page.encode("utf-8")
    extra["handover/contents.json"] = (json.dumps({
        "schema": SCHEMA, "project_id": complete["project_id"],
        "rehearsal_id": complete["rehearsal_id"],
        "selection": {"path": CASE, **complete["retained_files"][CASE]},
        "scientific_archive": complete["files"]["scientific_archive"],
        "scientific_report_id": receipt["scientific_report"]["id"],
        "delivery_id": receipt["delivery_id"],
        "report_files": report_files, "map_files": map_files,
        "members": {name: member_identity(value) for name, value in sorted(extra.items())},
    }, ensure_ascii=False, sort_keys=True, indent=2) + "\n").encode("utf-8")
    return extra
