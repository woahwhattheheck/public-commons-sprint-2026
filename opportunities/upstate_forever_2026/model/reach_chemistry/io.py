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


def report(project: Project, result: dict, request: dict | None = None) -> str:
    """Render the current scientific presentation without changing result values."""
    from .reporting import report as scientific_report
    return scientific_report(project, result, request, links=[
        ("Complete result JSON", "result.json"),
        ("Original chemical project", "project.json"),
        *([("Original analysis request", "request.json")] if request is not None else []),
    ])


def write_outputs(directory: Path, project: Project | dict, result: dict, request: dict | None = None) -> dict:
    p = Project(project) if isinstance(project, dict) else project
    directory = Path(directory); directory.mkdir(parents=True, exist_ok=True)
    json_write(directory/'project.json', p.raw)
    json_write(directory/'result.json', result)
    if request is not None: json_write(directory/'request.json', request)
    atomic_write(directory/'report.html', report(p, result, request).encode('utf-8'))
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
