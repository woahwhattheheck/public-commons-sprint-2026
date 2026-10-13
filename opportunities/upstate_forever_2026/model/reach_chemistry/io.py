"""Complete human-usable result artifacts; no service or independent workspace."""
from __future__ import annotations
import csv
import html
import io
import json
import os
from pathlib import Path
import tempfile
from hashlib import sha256
import zipfile
from .model import Project, ModelError, canonical_bytes


def atomic_write(path: Path, body: bytes) -> None:
    path = Path(path); path.parent.mkdir(parents=True, exist_ok=True)
    pending = None
    try:
        with tempfile.NamedTemporaryFile(dir=path.parent, prefix=".chemistry-", delete=False) as stream:
            pending = Path(stream.name); stream.write(body); stream.flush(); os.fsync(stream.fileno())
        os.replace(pending, path); pending = None
        fd = os.open(path.parent, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
        try: os.fsync(fd)
        finally: os.close(fd)
    finally:
        if pending: pending.unlink(missing_ok=True)


def json_write(path: Path, value: dict) -> None:
    atomic_write(path, canonical_bytes(value) + b"\n")


def csv_body(rows: list[dict], fields: list[str]) -> bytes:
    output = io.StringIO(newline="")
    writer = csv.DictWriter(output, fieldnames=fields, extrasaction="ignore", lineterminator="\n")
    writer.writeheader()
    for row in rows:
        safe = {}
        for key in fields:
            v = row.get(key, "")
            # Keep generated CSV safe when opened directly by a spreadsheet operator.
            if isinstance(v, str) and v.lstrip().startswith(("=", "+", "-", "@")):
                v = "'" + v
            safe[key] = v
        writer.writerow(safe)
    return output.getvalue().encode("utf-8")


def table(rows: list[dict], fields: list[tuple[str, str]], caption: str) -> str:
    def value(v):
        if v is None: return "—"
        if isinstance(v, float): return f"{v:.8g}"
        return str(v)
    return ("<table><caption>" + html.escape(caption) + "</caption><thead><tr>" +
            "".join("<th scope='col'>" + html.escape(label) + "</th>" for _, label in fields) +
            "</tr></thead><tbody>" + "".join("<tr>" + "".join("<td>" + html.escape(value(row.get(k))) + "</td>" for k,_ in fields) + "</tr>" for row in rows) + "</tbody></table>")


def report(project: Project, result: dict) -> str:
    schema = result.get("schema", "")
    title = html.escape(project.title)
    intro = ("Concentrations are milligrams of the declared conserved basis per litre. "
             "Masses and exports are kilograms of that basis. Each reach is completely mixed at fixed volume. "
             "Changes between input phases are explicit; coefficients and source references are retained in project.json.")
    sections = []
    run = result.get("baseline", result)
    if "budgets" in run:
        sections.append("<h2>Where the chemical mass went</h2>" + table(run["budgets"],
            [("basis","Basis"),("initial_kg","Starting kg"),("input_kg","Added kg"),
             ("final_storage_kg","Remaining kg"),("boundary_export_kg","Exported kg"),
             ("untracked_reaction_sink_kg","Other sinks kg"),("residual_kg","Balance residual kg")], "Complete duration mass balance"))
        sections.append("<h2>Final reach conditions</h2>" + table(run["final"],
            [("reach","Reach"),("species","Species"),("basis","Basis"),("mg_l","mg/L"),("kg","Stored kg")], "Final concentrations and retained mass"))
        series = [{"day": sample["day"], **value} for sample in run["samples"] for value in sample["values"]]
        sections.append("<h2>Time-series results</h2>" + table(series,
            [("day","Day"),("reach","Reach"),("species","Species"),("mg_l","mg/L"),("kg","Stored kg")], "Every requested observation point"))
    if "sources" in result:
        rows = [{"source": part["source_tag"], **b} for part in result["sources"] for b in part["result"]["budgets"]]
        sections.append("<h2>Source attribution</h2>" + table(rows,
            [("source","Source"),("basis","Basis"),("input_kg","Added kg"),("final_storage_kg","Remaining kg"),
             ("boundary_export_kg","Exported kg"),("untracked_reaction_sink_kg","Other sinks kg")], "Original source contributions carried through the same chemistry"))
    if "observations" in result:
        sections.append("<h2>Observation fit and independent holdout</h2>" + table(result["observations"],
            [("id","Observation"),("role","Use"),("day","Day"),("observed_mg_l","Observed mg/L"),
             ("predicted_mg_l","Modeled mg/L"),("qualifier","Qualifier"),("weighted_residual","Weighted residual")], "Fitted and held-out records remain separate"))
        sections.append(table(result["parameters"],[("id","Parameter"),("kind","Unit-bearing field"),("original","Original"),("fitted","Fitted"),("active_bound","Bound indicator")], "Calibrated coefficients"))
        ident = result["identifiability"]
        sections.append("<p>Local weighted-Jacobian rank: " + str(ident["rank"]) + " / " + str(ident["parameters"]) +
                        ". " + html.escape(ident["interpretation"]) + "</p>")
    if "rows" in result:
        rows = [{"observation": r["observation"]["id"], "predicted_mg_l":r["predicted_mg_l"], **d}
                for r in result["rows"] for d in r["derivatives"]]
        sections.append("<h2>Which parameters change the result</h2>" + table(rows,
            [("observation","Observation"),("parameter","Parameter"),("predicted_mg_l","Modeled mg/L"),
             ("mg_l_per_parameter_unit","mg/L per parameter unit"),("elasticity","Elasticity")], "Exact forward-tangent sensitivities"))
    if "selected" in result:
        rows = [{"order": r["order"], **r["candidate"], "incremental_logdet_gain":r["incremental_logdet_gain"]} for r in result["selected"]]
        sections.append("<h2>Monitoring design</h2>" + table(rows,
            [("order","Order"),("id","Candidate"),("reach","Reach"),("species","Species"),("day","Day"),
             ("incremental_logdet_gain","Added information")], "Local greedy design under the supplied prior"))
    if "summaries" in result:
        rows = [{**r["observation"], **{k:v for k,v in r.items() if k != "observation"}} for r in result["summaries"]]
        sections.append("<h2>Parameter ensemble</h2><p>"+html.escape(result["interpretation"])+"</p>"+table(rows,
            [("id","Observation"),("p05_mg_l","5th percentile mg/L"),("median_mg_l","Median mg/L"),("p95_mg_l","95th percentile mg/L")], "All generated parameter draws are included in the export"))
    prov = project.raw.get("provenance", {})
    sections.append("<h2>Input identity</h2><p>" + html.escape(str(prov.get("reference", "See project.json for input provenance."))) +
                    "</p><p class='mono'>SHA-256 " + project.fingerprint + "</p>")
    return f"""<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>{title} — chemistry results</title><style>
*{{box-sizing:border-box}}body{{margin:0;background:#fff;color:#171717;font:15px/1.5 system-ui,sans-serif}}
main{{max-width:1280px;margin:0 auto;padding:32px}}header{{border-bottom:2px solid #222;margin-bottom:24px;padding-bottom:18px}}
h1{{font-size:28px;line-height:1.2}}h2{{font-size:21px;margin-top:32px}}p{{max-width:100ch}}.mono{{font:12px/1.5 ui-monospace,monospace;overflow-wrap:anywhere}}
table{{width:100%;border-collapse:collapse;margin:16px 0;display:block;overflow-x:auto}}th,td{{padding:9px 12px;text-align:left;vertical-align:top;border-bottom:1px solid #ccc}}
th{{background:#ededed;white-space:nowrap}}caption{{text-align:left;font-weight:600;margin-bottom:8px}}td{{font-variant-numeric:tabular-nums}}footer{{border-top:1px solid #aaa;margin-top:32px;padding-top:12px}}
@media print{{main{{max-width:none;padding:0}}table{{display:table;font-size:10px}}tr{{break-inside:avoid}}h2{{break-after:avoid}}}}
</style></head><body><main><header><p>ECOSYSTEM SCIENCES · REACH CHEMISTRY</p><h1>{title}</h1><p>{html.escape(intro)}</p></header>
{''.join(sections)}<footer>TokenJunkieLabs · {html.escape(schema)} · Complete editable inputs and machine-readable results accompany this report.</footer></main></body></html>"""


def write_outputs(directory: Path, project: Project | dict, result: dict, request: dict | None = None) -> dict:
    p = Project(project) if isinstance(project, dict) else project
    directory = Path(directory); directory.mkdir(parents=True, exist_ok=True)
    json_write(directory/'project.json', p.raw)
    json_write(directory/'result.json', result)
    if request is not None: json_write(directory/'request.json', request)
    atomic_write(directory/'report.html', report(p, result).encode('utf-8'))
    if 'calibrated_project' in result: json_write(directory/'calibrated-project.json', result['calibrated_project'])
    run = result.get('baseline', result)
    if 'final' in run:
        atomic_write(directory/'final-concentrations.csv', csv_body(run['final'], ['reach','species','basis','mg_l','kg']))
        atomic_write(directory/'mass-budget.csv', csv_body(run['budgets'], ['basis','initial_kg','input_kg','final_storage_kg','boundary_export_kg','untracked_reaction_sink_kg','residual_kg','relative_residual']))
        rows = [{'day':sample['day'], **r} for sample in run['samples'] for r in sample['values']]
        atomic_write(directory/'timeseries.csv', csv_body(rows, ['day','reach','species','basis','mg_l','kg']))
        atomic_write(directory/'boundary-export.csv', csv_body(run['boundary_export_by_state'], ['reach','species','basis','kg']))
        json_write(directory/'reaction-transfers.json', {'reactions':run['reactions']})
        features = []
        by_reach = {}
        for r in run['final']: by_reach.setdefault(r['reach'], []).append(r)
        for rid, reach in p.reaches.items():
            if 'geometry' in reach:
                features.append({'type':'Feature','id':rid,'geometry':reach['geometry'],
                                 'properties':{'reach':rid,'project_sha256':p.fingerprint,
                                 **{r['species']+'_mg_l':r['mg_l'] for r in by_reach[rid]},
                                 **{r['species']+'_basis':r['basis'] for r in by_reach[rid]}}})
        if features: json_write(directory/'reach-results.geojson', {'type':'FeatureCollection','features':features})
    if 'observations' in result:
        atomic_write(directory/'observation-fit.csv', csv_body(result['observations'],
            ['id','reach','species','day','role','qualifier','observed_mg_l','predicted_mg_l','sigma_mg_l','weighted_residual']))
    if 'parameter_draws' in result:
        ids=[q['id'] for q in result['parameters']]
        atomic_write(directory/'parameter-draws.csv', csv_body([{'draw':i,**dict(zip(ids,row))} for i,row in enumerate(result['parameter_draws'])], ['draw']+ids))
        ids=[q['observation']['id'] for q in result['summaries']]
        atomic_write(directory/'prediction-draws.csv', csv_body([{'draw':i,**dict(zip(ids,row))} for i,row in enumerate(result['prediction_draws_mg_l'])], ['draw']+ids))
    names = [q.name for q in directory.iterdir() if q.is_file() and q.name not in ('manifest.json','results.zip') and not q.name.startswith('.')]
    manifest={'schema':'reach-chemistry-artifacts/1','project_sha256':p.fingerprint,'files':[]}
    for name in sorted(names):
        body=(directory/name).read_bytes()
        manifest['files'].append({'path':name,'bytes':len(body),'sha256':sha256(body).hexdigest()})
    json_write(directory/'manifest.json',manifest)
    with tempfile.NamedTemporaryFile(dir=directory, prefix='.archive-',delete=False) as tmp:
        pending=Path(tmp.name)
    try:
        with zipfile.ZipFile(pending,'w',compression=zipfile.ZIP_DEFLATED) as z:
            for name in sorted(names)+['manifest.json']: z.write(directory/name,name)
        os.replace(pending,directory/'results.zip')
    finally: pending.unlink(missing_ok=True)
    return manifest
