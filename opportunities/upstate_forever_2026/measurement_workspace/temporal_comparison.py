"""Compare two complete saved Monitoring editions without recalculating science."""
from __future__ import annotations
import argparse
from collections import Counter, defaultdict
import hashlib
import html
import json
import math
import os
from pathlib import Path, PurePosixPath
import shutil
import stat
import tempfile
import zipfile

from measurement_workspace.temporal_analysis import canonical, sha, csv_bytes, SCHEMA as ANALYSIS_SCHEMA, DIMENSIONS
from measurement_workspace.temporal_transfer import receive as receive_analysis
from model.common import _sync_directory

SCHEMA = "upstate.temporal-edition-comparison/v1"
PACKAGE_SCHEMA = "upstate.temporal-comparison-package/v1"
VERSION = "1.0.0"
MAXIMUM_BYTES = 1024 * 1024 * 1024
OPENING_FILES = ("review.html", "comparison.json", "selection.json", "series-comparison.csv",
                 "source-record-changes.csv", "settings-changes.csv", "source-file-changes.csv",
                 "monthly-support-changes.csv", "temporal-comparison.zip")
RULE = ("Each side remains its original saved calculation. Numerical subtraction is allowed only "
        "for identical analytical dimensions, original selected row/date support, monthly support, "
        "scientific settings, estimator implementation and physical units, and two finite point slopes. "
        "Original interval bounds are displayed separately; no difference interval, confidence level, "
        "significance or causal effect is inferred.")

def _clone(value):
    return json.loads(canonical(value))

def _digest_file(path):
    h = hashlib.sha256()
    with Path(path).open("rb") as handle:
        before = os.fstat(handle.fileno())
        if not stat.S_ISREG(before.st_mode):
            raise ValueError("Comparison source must be an original regular file.")
        count = 0
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            count += len(block); h.update(block)
        after = os.fstat(handle.fileno())
    if (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns, before.st_ctime_ns) != (
            after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns):
        raise ValueError("Original file changed while reading.")
    return {"bytes": count, "sha256": h.hexdigest()}

def _map(rows, key, label):
    result = {}
    for row in rows:
        identity = key(row)
        if identity in result:
            raise ValueError("Repeated original identity in " + label + ": " + identity)
        result[identity] = row
    return result

def _presence(value, field):
    return {"present": field in value, **({"value": value[field]} if field in value else {})}

def _differences(before, after):
    return [{"field": key, "before": _presence(before, key), "after": _presence(after, key)}
            for key in sorted(set(before) | set(after))
            if canonical(_presence(before, key)) != canonical(_presence(after, key))]

def _record_key(row):
    return canonical([_presence(row, k) for k in ("dataset", "source_table", "id")]).decode("utf-8")

def _record_source(row):
    return {k: v for k, v in row.items() if k not in ("analysis_exclusion", "cohort_id")}

def _analysis(value):
    if not isinstance(value, dict) or value.get("schema") != ANALYSIS_SCHEMA:
        raise ValueError("Select a complete saved Monitoring analysis.")
    identity = sha(canonical({"selection": value["selection"], "sources": value["input_sources"],
                              "implementation": value["implementation"]}))
    if value.get("id") != identity:
        raise ValueError("Saved analysis selection/source/implementation identity differs.")
    for name in ("records", "cohorts", "monthly", "pairs", "leave_one_year_out"):
        if not isinstance(value.get(name), list):
            raise ValueError("Saved analysis lacks its complete original " + name + ".")
    _map(value["cohorts"], lambda row: str(row["id"]), "analytical cohorts")
    _map(value["records"], _record_key, "original source rows")
    canonical(value)
    return value

def _dimensions(cohort, analysis):
    return {**{key: _presence(cohort, key) for key in DIMENSIONS},
            "source_context": _presence(cohort, "source_context"),
            "separate_projects": _presence(analysis["selection"], "separate_projects"),
            **({"projects": _presence(cohort, "projects")} if analysis["selection"].get("separate_projects") else {})}

def _point(estimate):
    lo, hi = estimate.get("slope_lower"), estimate.get("slope_upper")
    if estimate.get("slope_lower_unbounded") or estimate.get("slope_upper_unbounded"):
        return None
    if any(isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v) for v in (lo, hi)):
        return None
    return lo if lo == hi and estimate.get("pair_count", 0) > 0 else None

def _roster(rows):
    return sorted((_record_key(row), sha(canonical(_record_source(row)))) for row in rows)

def _monthly_roster(rows):
    keys = ("year", "month", "record_ids", "eligible", "exclusion", "sampled_days",
            "expected_calendar_days", "daily_coverage_fraction")
    return sorted(canonical({key: _presence(row, key) for key in keys}).decode("utf-8") for row in rows)

def compare(before, after, selection, input_archives, implementation):
    before, after = _analysis(before), _analysis(after)
    if not isinstance(selection, dict) or set(selection) != {"title", "before_edition_id", "after_edition_id"}:
        raise ValueError("Comparison needs its explicit title and ordered original edition IDs.")
    if not isinstance(selection["title"], str) or not 1 <= len(selection["title"].strip()) <= 200:
        raise ValueError("Give the comparison a title of 1–200 characters.")
    for side in ("before", "after"):
        value = selection[side + "_edition_id"]
        if value is not None and (not isinstance(value, str) or len(value) != 64 or any(c not in "0123456789abcdef" for c in value)):
            raise ValueError("Original Workspace edition IDs must be exact identifiers or explicit null.")
    selection = _clone(selection)
    if not isinstance(implementation, dict) or set(implementation) != {"temporal_comparison.py"} or not isinstance(implementation["temporal_comparison.py"], str) or len(implementation["temporal_comparison.py"]) != 64 or any(c not in "0123456789abcdef" for c in implementation["temporal_comparison.py"]):
        raise ValueError("Comparison needs its exact retained implementation identity.")
    if set(input_archives) != {"before", "after"}:
        raise ValueError("Both complete original package identities are required.")
    for side, analysis in (("before", before), ("after", after)):
        if input_archives[side].get("analysis_id") != analysis["id"]:
            raise ValueError("Original package and analysis identity differ.")
    original_maps = [_map(value["records"], _record_key, side + " source")
                     for side, value in (("before", before), ("after", after))]
    record_changes = []
    for key in sorted(set(original_maps[0]) | set(original_maps[1])):
        a, b = original_maps[0].get(key), original_maps[1].get(key)
        state = "added" if a is None else "removed" if b is None else "unchanged" if canonical(a) == canonical(b) else "changed"
        record_changes.append({"key": key, "state": state, "before": a, "after": b,
                               "changes": _differences(a or {}, b or {}) if state != "unchanged" else []})
    cohorts = [{row["id"]: row for row in value["cohorts"]} for value in (before, after)]
    selected, monthly = [], []
    for value in (before, after):
        records_by_cohort, months_by_cohort = defaultdict(list), defaultdict(list)
        for row in value["records"]:
            if row.get("analysis_exclusion") is None:
                records_by_cohort[row["cohort_id"]].append(row)
        for row in value["monthly"]:
            months_by_cohort[row["cohort_id"]].append(row)
        selected.append(records_by_cohort); monthly.append(months_by_cohort)
    settings = _differences(before["selection"], after["selection"])
    scientific_settings_match = canonical({k:v for k,v in before["selection"].items() if k != "title"}) == canonical(
        {k:v for k,v in after["selection"].items() if k != "title"})
    estimator_match = canonical({"version":before.get("version"),"methods":before.get("methods"),
        "kernel":before["implementation"].get("temporal_analysis.py")}) == canonical({
        "version":after.get("version"),"methods":after.get("methods"),
        "kernel":after["implementation"].get("temporal_analysis.py")})
    series = []
    for key in sorted(set(cohorts[0]) | set(cohorts[1])):
        a, b = cohorts[0].get(key), cohorts[1].get(key)
        reasons = []
        if a is None or b is None:
            reasons.append("Analytical cohort exists in only one saved edition.")
        else:
            if canonical(_dimensions(a, before)) != canonical(_dimensions(b, after)):
                reasons.append("Original analytical dimensions, context or units differ.")
            if _roster(selected[0][key]) != _roster(selected[1][key]):
                reasons.append("Original selected source rows, values or date support differ.")
            if _monthly_roster(monthly[0][key]) != _monthly_roster(monthly[1][key]):
                reasons.append("Original calendar-month membership or coverage differs.")
            if not scientific_settings_match:
                reasons.append("Scientific selection or support rules differ.")
            if not estimator_match:
                reasons.append("Estimator implementation or documented method differs.")
        if a is not None and b is not None and (not isinstance(a.get("unit"), str) or not a["unit"].strip() or not selected[0][key] or not selected[1][key]):
            reasons.append("A physical unit or original selected record support is unavailable.")
        support_matches = not reasons
        points = [_point(value["estimate"]) if value else None for value in (a, b)]
        if support_matches and any(value is None for value in points):
            reasons.append("At least one saved slope is bounded, unbounded or unavailable, rather than a finite point.")
        value = a or b
        series.append({"cohort_id":key, "state":"added" if a is None else "removed" if b is None else "paired",
            "station":value.get("station"),"station_name":value.get("station_name"),"parameter":value.get("parameter"),
            "unit":value.get("unit"),"before":a,"after":b,
            "before_selected_records":len(selected[0][key]),"after_selected_records":len(selected[1][key]),
            "matching_source_and_method":support_matches,"point_delta_eligible":not reasons,
            "after_minus_before_point_slope":points[1]-points[0] if not reasons else None,
            "comparison_reasons":reasons,
            "nearby_before_cohort_ids":[c["id"] for c in before["cohorts"] if c["id"] != key and
                all(c.get(k) == value.get(k) for k in ("dataset","station","parameter"))] if a is None else [],
            "nearby_after_cohort_ids":[c["id"] for c in after["cohorts"] if c["id"] != key and
                all(c.get(k) == value.get(k) for k in ("dataset","station","parameter"))] if b is None else []})
    source_maps = [{row["path"]:row for row in value["input_sources"]} for value in (before, after)]
    source_changes = [{"path":name,"before":source_maps[0].get(name),"after":source_maps[1].get(name),
        "state":"added" if name not in source_maps[0] else "removed" if name not in source_maps[1] else
                "unchanged" if canonical(source_maps[0][name]) == canonical(source_maps[1][name]) else "changed"}
        for name in sorted(set(source_maps[0]) | set(source_maps[1]))]
    month_maps = [_map(value["monthly"], lambda row:str(row["id"]), "month-year rows") for value in (before, after)]
    month_changes = [{"month_id":key,"before":month_maps[0].get(key),"after":month_maps[1].get(key),
        "state":"added" if key not in month_maps[0] else "removed" if key not in month_maps[1] else
                "unchanged" if canonical(month_maps[0][key]) == canonical(month_maps[1][key]) else "changed"}
        for key in sorted(set(month_maps[0]) | set(month_maps[1]))]
    result = {"schema":SCHEMA,"version":VERSION,"selection":selection,"input_archives":_clone(input_archives),
        "implementation":_clone(implementation),"rule":RULE,"before":_clone(before),"after":_clone(after),
        "series":series,"record_changes":record_changes,"settings_changes":settings,
        "source_changes":source_changes,"monthly_changes":month_changes,
        "summary":{"before_records":len(before["records"]),"after_records":len(after["records"]),
            "series":len(series),"paired_series":sum(row["state"]=="paired" for row in series),
            "point_deltas":sum(row["point_delta_eligible"] for row in series),
            "record_states":dict(Counter(row["state"] for row in record_changes)),
            "source_states":dict(Counter(row["state"] for row in source_changes)),
            "monthly_states":dict(Counter(row["state"] for row in month_changes)),
            "changed_settings":len(settings)}}
    result["id"] = sha(canonical({"schema":SCHEMA,"version":VERSION,"selection":selection,
        "input_archives":input_archives,"implementation":implementation}))
    return result

def _show(value):
    return html.escape(json.dumps(value, ensure_ascii=False, sort_keys=True) if isinstance(value,(dict,list)) else
                       "Unavailable" if value is None else str(value))

def _interval(value):
    if value is None:
        return "No cohort in this edition"
    estimate = value.get("estimate", {})
    lo = "−∞" if estimate.get("slope_lower_unbounded") else _show(estimate.get("slope_lower"))
    hi = "+∞" if estimate.get("slope_upper_unbounded") else _show(estimate.get("slope_upper"))
    return lo + " to " + hi + " " + _show(value.get("unit")) + "/year; " + _show(estimate.get("direction"))

def render_report(result):
    series = "".join("<tr><td>"+_show(r["station"])+"<br>"+_show(r["parameter"])+"<br><small>"+_show(r["cohort_id"])+"</small></td><td>"+
        _interval(r["before"])+"</td><td>"+_interval(r["after"])+"</td><td>"+
        (_show(r["after_minus_before_point_slope"])+" "+_show(r["unit"])+"/year" if r["point_delta_eligible"] else
         "<ul>"+"".join("<li>"+_show(v)+"</li>" for v in r["comparison_reasons"])+"</ul>")+
        "<details><summary>Complete original analytical contexts and support</summary><pre>"+
        _show({"before":r["before"],"after":r["after"],"nearby_before":r["nearby_before_cohort_ids"],"nearby_after":r["nearby_after_cohort_ids"]})+
        "</pre></details></td></tr>" for r in result["series"])
    def rows(name, label):
        return '<details><summary>'+label+' ('+str(len(result[name]))+')</summary><div class="scroll"><table><thead><tr><th>Original selection</th><th>Before</th><th>After</th><th>Change</th></tr></thead><tbody>'+''.join(
            '<tr><td>'+_show(r.get('field',r.get('path',r.get('month_id',r.get('key')))))+'</td><td><pre>'+_show(r.get('before'))+
            '</pre></td><td><pre>'+_show(r.get('after'))+'</pre></td><td>'+_show(r.get('state',r.get('changes','Changed')))+
            '</td></tr>' for r in result[name])+'</tbody></table></div></details>'
    links = [("comparison.json","Complete comparison JSON"),("series-comparison.csv","Series CSV"),
        ("source-record-changes.csv","Every original source row (CSV)"),("settings-changes.csv","Settings CSV"),
        ("source-file-changes.csv","Original file changes CSV"),("monthly-support-changes.csv","Month support CSV"),
        ("before/review.html","Original before report"),("after/review.html","Original after report"),
        ("before/temporal-analysis.zip","Exact before package"),("after/temporal-analysis.zip","Exact after package")]
    body = '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+_show(result["selection"]["title"])+'</title><style>body{font:16px/1.5 system-ui,sans-serif;color:#222;background:#fafafa;margin:0}main{max-width:1250px;margin:auto;padding:24px}h1{font-size:26px}h2{font-size:20px}p{max-width:90ch}.scroll{overflow:auto}table{border-collapse:collapse;width:100%;background:white}td,th{border:1px solid #bbb;padding:10px;vertical-align:top;text-align:left}th{background:#eee}pre{font:12px/1.5 monospace;white-space:pre-wrap;overflow-wrap:anywhere;max-width:65ch}details{margin:18px 0}summary{font-weight:600;cursor:pointer}a{color:#17415b}nav{display:flex;gap:10px;flex-wrap:wrap}nav a{padding:8px;border:1px solid #aaa;background:white}small{overflow-wrap:anywhere}li{margin:4px 0}@media(max-width:500px){main{padding:14px}h1{font-size:22px}td,th{padding:8px;min-width:140px}}@media print{details{display:block}nav{display:none}}</style><main><p>TokenJunkieLabs · Monitoring change</p><h1>'+_show(result["selection"]["title"])+'</h1><p>'+_show(RULE)+'</p><p>These are two saved editions. “Before” and “after” are your selected ordering, not treatment and control or proof of environmental change. Keep all extracted files together.</p><nav>'+''.join('<a href="'+path+'">'+label+'</a>' for path,label in links)+'</nav><h2>Saved-edition identities</h2><pre>'+_show({"comparison_id":result["id"],"selection":result["selection"],"input_archives":result["input_archives"],"summary":result["summary"]})+'</pre><h2>Original analytical series</h2><p>Bounds are the original conservative support envelopes. They are not confidence intervals. Different context cohorts stay separate; nearby IDs are navigation clues, not matched series.</p><div class="scroll"><table><thead><tr><th>Series</th><th>Before original slope</th><th>After original slope</th><th>Point difference eligibility</th></tr></thead><tbody>'+series+'</tbody></table></div>'+rows("settings_changes","Exact setting changes")+rows("source_changes","All original source files")+rows("monthly_changes","All original month-year rows")+rows("record_changes","All original source records")+'<h2>Independent reopening</h2><p>In Monitoring change, choose “Receive saved comparison” and select temporal-comparison.zip. Both original scientific packages are retained without recalculation. The original before/after reports remain separately usable. The complete comparison JSON retains all input rows, missing and null values, interpretation choices and original results.</p></main></html>'
    return body.encode("utf-8")

def _flush(path):
    # Only owned, newly generated staged files reach this flush.
    with path.open("r+b") as handle:
        os.fsync(handle.fileno())

def _install(stage, destination):
    for path in stage.rglob("*"):
        if path.is_file(): _flush(path)
    if destination.exists():
        raise ValueError("Choose a new output directory; existing editions stay unchanged.")
    stage.rename(destination)
    _sync_directory(destination.parent)

def build(before_zip, after_zip, destination, selection):
    destination = Path(destination).absolute()
    if destination.exists():
        raise ValueError("Choose a new comparison directory.")
    destination.parent.mkdir(parents=True, exist_ok=True)
    stage = Path(tempfile.mkdtemp(prefix=".temporal-comparison-",dir=destination.parent))
    try:
        archives, originals = {}, {}
        for side, path in (("before",before_zip),("after",after_zip)):
            path = Path(path).resolve(strict=True)
            descriptor = _digest_file(path)
            received = receive_analysis(path, stage/side, maximum_bytes=MAXIMUM_BYTES//2)
            copied = _digest_file(stage/side/"temporal-analysis.zip")
            if copied != descriptor or _digest_file(path) != descriptor:
                raise ValueError("Original package changed during comparison capture.")
            archives[side] = {**descriptor,"analysis_id":received["id"]}
            originals[side] = json.loads((stage/side/"analysis.json").read_text("utf-8"))
        implementation = {"temporal_comparison.py":sha(Path(__file__).read_bytes())}
        result = compare(originals["before"], originals["after"], selection, archives, implementation)
        (stage/"comparison.json").write_bytes(canonical(result))
        (stage/"selection.json").write_bytes(canonical(selection))
        (stage/"review.html").write_bytes(render_report(result))
        for filename, key in (("series-comparison.csv","series"),("source-record-changes.csv","record_changes"),
                ("settings-changes.csv","settings_changes"),("source-file-changes.csv","source_changes"),
                ("monthly-support-changes.csv","monthly_changes")):
            (stage/filename).write_bytes(csv_bytes(result[key]))
        (stage/"engine").mkdir()
        for name in ("temporal_comparison.py","temporal_transfer.py","temporal_analysis.py"):
            shutil.copyfile(Path(__file__).with_name(name),stage/"engine"/name)
        (stage/"OPEN_ME.txt").write_text("Open review.html and keep all files together. Before/after original reports and exact ZIPs are in their named directories. Receive temporal-comparison.zip in Monitoring change to retain this exact comparison. No source calculation is rerun by receiving.\n",encoding="utf-8")
        members = [{"path":path.relative_to(stage).as_posix(),**_digest_file(path)}
                   for path in sorted(stage.rglob("*")) if path.is_file()]
        manifest = {"schema":PACKAGE_SCHEMA,"comparison_id":result["id"],"members":members}
        (stage/"package-manifest.json").write_bytes(canonical(manifest))
        with zipfile.ZipFile(stage/"temporal-comparison.zip","w",zipfile.ZIP_DEFLATED,compresslevel=6,allowZip64=True) as archive:
            for path in sorted(stage.rglob("*")):
                if path.is_file() and path != stage/"temporal-comparison.zip":
                    archive.write(path,path.relative_to(stage).as_posix())
        _install(stage,destination)
        return {"id":result["id"],"selection":selection,"summary":result["summary"],"input_archives":archives,
                "implementation":implementation,"output":str(destination)}
    finally:
        if stage.exists(): shutil.rmtree(stage)

def receive(source, destination, maximum_bytes=MAXIMUM_BYTES):
    source, destination = Path(source).resolve(strict=True), Path(destination).absolute()
    if destination.exists(): raise ValueError("Choose a new receiving directory.")
    destination.parent.mkdir(parents=True,exist_ok=True)
    stage = Path(tempfile.mkdtemp(prefix=".receive-comparison-",dir=destination.parent))
    temporary = Path(tempfile.mkdtemp(prefix=".verify-comparison-",dir=destination.parent))
    original = _digest_file(source)
    try:
        with zipfile.ZipFile(source) as archive:
            infos = archive.infolist()
            if len(infos)>5000 or sum(i.file_size for i in infos)>maximum_bytes:
                raise ValueError("Comparison exceeds receiving capacity.")
            names = set()
            for item in infos:
                name = item.filename; path = PurePosixPath(name)
                if not name or item.is_dir() or path.is_absolute() or str(path)!=name or any(p in ("..",".","") for p in path.parts) or "\\" in name or ":" in name or "\x00" in name or stat.S_ISLNK(item.external_attr>>16):
                    raise ValueError("Unsafe comparison package member.")
                if name.casefold() in names: raise ValueError("Duplicate comparison member.")
                names.add(name.casefold())
            if archive.getinfo("package-manifest.json").file_size>4*1024*1024:
                raise ValueError("Comparison manifest exceeds capacity.")
            manifest = json.loads(archive.read("package-manifest.json"))
            if manifest.get("schema") != PACKAGE_SCHEMA: raise ValueError("Unsupported comparison package.")
            rows = _map(manifest["members"],lambda row:row["path"],"comparison inventory")
            if set(rows) != {i.filename for i in infos} - {"package-manifest.json"}:
                raise ValueError("Comparison package does not match its complete inventory.")
            for item in infos:
                target = stage.joinpath(*PurePosixPath(item.filename).parts); target.parent.mkdir(parents=True,exist_ok=True)
                with archive.open(item) as incoming, target.open("xb") as outgoing:
                    shutil.copyfileobj(incoming,outgoing,1024*1024)
                if item.filename in rows and _digest_file(target) != {k:rows[item.filename][k] for k in ("bytes","sha256")}:
                    raise ValueError("Comparison member differs: "+item.filename)
        result = json.loads((stage/"comparison.json").read_text("utf-8"))
        if result.get("schema") != SCHEMA or result.get("id") != manifest.get("comparison_id"):
            raise ValueError("Comparison identity differs.")
        if json.loads((stage/"selection.json").read_text("utf-8")) != result["selection"]:
            raise ValueError("Comparison selection differs.")
        for side in ("before","after"):
            archive_path = stage/side/"temporal-analysis.zip"
            if _digest_file(archive_path) != {k:result["input_archives"][side][k] for k in ("bytes","sha256")}:
                raise ValueError("Original "+side+" archive identity differs.")
            received = receive_analysis(archive_path,temporary/side,maximum_bytes=maximum_bytes//2)
            native = json.loads((temporary/side/"analysis.json").read_text("utf-8"))
            if canonical(native) != canonical(result[side]) or native["id"] != received["id"]:
                raise ValueError("Original "+side+" saved result differs.")
            actual_names = {p.relative_to(temporary/side).as_posix() for p in (temporary/side).rglob("*") if p.is_file()}
            selected_names = {name[len(side)+1:] for name in rows if name.startswith(side+"/")}
            if selected_names != actual_names: raise ValueError("Original "+side+" loose package is incomplete.")
            for name in actual_names:
                if _digest_file(stage/side/name) != _digest_file(temporary/side/name):
                    raise ValueError("Original "+side+" file differs: "+name)
        expected = compare(result["before"],result["after"],result["selection"],result["input_archives"],result["implementation"])
        if canonical(expected) != canonical(result):
            raise ValueError("Saved comparison rows do not reproduce from the retained original results.")
        for name, digest in result["implementation"].items():
            if _digest_file(stage/"engine"/name)["sha256"] != digest:
                raise ValueError("Comparison implementation body differs.")
        shutil.copyfile(source,stage/"temporal-comparison.zip")
        if _digest_file(stage/"temporal-comparison.zip") != original or _digest_file(source) != original:
            raise ValueError("Incoming comparison package changed.")
        _install(stage,destination)
        return {"id":result["id"],"selection":result["selection"],"summary":result["summary"],
                "input_archives":result["input_archives"],"implementation":result["implementation"],
                "received_package":original,"output":str(destination)}
    finally:
        shutil.rmtree(temporary,ignore_errors=True)
        if stage.exists(): shutil.rmtree(stage)

def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="action",required=True)
    make = sub.add_parser("build"); make.add_argument("--before",required=True); make.add_argument("--after",required=True)
    make.add_argument("--title",required=True); make.add_argument("--before-edition-id"); make.add_argument("--after-edition-id"); make.add_argument("--output",required=True)
    accept = sub.add_parser("receive"); accept.add_argument("--package",required=True); accept.add_argument("--output",required=True)
    args = parser.parse_args(argv)
    if args.action=="build":
        result = build(args.before,args.after,args.output,{"title":args.title,"before_edition_id":args.before_edition_id,"after_edition_id":args.after_edition_id})
    else: result = receive(args.package,args.output)
    print(json.dumps(result,ensure_ascii=False,sort_keys=True))
    return 0

if __name__=="__main__": raise SystemExit(main())
