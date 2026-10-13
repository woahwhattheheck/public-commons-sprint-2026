"""Build the complete offline and native-source nutrient-composition edition."""
from __future__ import annotations
import argparse
import csv
import hashlib
import html
import io
import json
import shutil
from pathlib import Path
from stoichiometry import EDITION, INPUTS, METHODS, MOLAR_FACTOR, analyze

REL = Path("observations/eighteenmile_stoichiometry_20261013")
MANIFEST = "eighteenmile_stoichiometry.sources.json"
TITLE = "Eighteenmile nutrient composition, 2020–2025"
REFERENCES = [
    {"title": "Original state Water Quality Portal measurements", "url": "https://www.waterqualitydata.us/", "use": "The two retained original CSV response bodies preserve all 63 agency fields and source identifiers."},
    {"title": "USGS: Assessing total nitrogen in surface-water samples", "url": "https://www.usgs.gov/publications/assessing-total-nitrogen-surface-water-samples-precision-and-bias-analytical-and", "use": "Kjeldahl plus nitrate/nitrite is an operational total-N calculation. Analytical and computational methods have distinct biases."},
    {"title": "NEMI: EPA Method 351.2", "url": "https://www.nemi.gov/methods/method_summary/9626/", "use": "Kjeldahl nitrogen includes ammonia and digestible organic nitrogen. Subtracting ammonia gives an operational organic-N difference."},
    {"title": "EPA nutrient aggregation methodology", "url": "https://echo.epa.gov/trends/loading-tool/resources/technical-background-methodology/nutrient-aggregation", "use": "Nitrogen components must be combined without counting ammonia twice; elemental nutrient and compound reporting bases differ."},
    {"title": "CIAAW abridged standard atomic weights, 2024 table", "url": "https://www.ciaaw.org/abridged-atomic-weights.htm", "use": "Representative atomic weights N=14.007 and P=30.974 give the explicit conversion factor 30974/14007. These are conversion conventions, not additional laboratory precision."},
    {"title": "EPA CADDIS: Nutrients", "url": "https://www.epa.gov/caddis/nutrients", "use": "Biological response and supporting site evidence matter when evaluating nutrients as a cause. This composition study does not diagnose nutrient limitation."},
]


def text_interval(v, digits=5, scale=1):
    f = lambda x: format(x * scale, f".{digits}g")
    lo, hi = v["lower"], v["upper"]
    if lo is not None and lo == hi:
        return f(lo)
    return ("(" if v["lower_open"] else "[") + ("-infinity" if lo is None else f(lo)) + ", " + ("infinity" if hi is None else f(hi)) + (")" if v["upper_open"] else "]")


def write_json(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + "\n", encoding="utf-8")


def flatten(value, prefix="", result=None):
    if result is None:
        result = {}
    for key, item in value.items():
        field = prefix + "_" + key if prefix else key
        if isinstance(item, dict):
            flatten(item, field, result)
        elif isinstance(item, list):
            result[field] = json.dumps(item, ensure_ascii=False, separators=(",", ":"))
        else:
            result[field] = item
    return result


def write_csv(path, rows):
    rows = [flatten(row) for row in rows]
    names = list(dict.fromkeys(key for row in rows for key in row))
    with path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=names)
        writer.writeheader()
        writer.writerows(rows)


def describe(root, path):
    body = path.read_bytes()
    return {"path": path.relative_to(root).as_posix(), "bytes": len(body), "sha256": hashlib.sha256(body).hexdigest()}


def source_closure(output):
    return sorted(p for p in (output / REL).rglob("*") if p.is_file() and "__pycache__" not in p.parts)


def findings(d):
    chosen = {p["metric"]: p for p in d["pair_summaries"] if p["station_a"] == "SV-375" and p["station_b"] == "SV-376"}
    pnr = chosen["pn_mass"]
    nfr = chosen["nox_fraction"]
    cc = d["coverage"]
    return [
        f"On {pnr['counts'].get('higher', 0)} of {pnr['n']} shared dates, SV-376 has a definitely higher phosphorus:reconstructed-nitrogen mass ratio than SV-375. The remaining {pnr['counts'].get('overlapping', 0)} date has overlapping bounds. P:N remains defined even at zero phosphorus.",
        f"The nitrate/nitrite fraction of reconstructed N is lower at SV-376 on {nfr['counts'].get('lower', 0)} dates and overlaps on {nfr['counts'].get('overlapping', 0)}. It is not definitely higher on any shared date. This separates nitrogen composition from the existing total-N concentration comparison.",
        f"The {cc['p_censored']} below-quantitation phosphorus observations make the N:P upper bound unbounded over positive P. There are {cc['mass_ratio_exact']} exact N:P ratios; all other activities retain intervals. Original phosphorus at zero leaves N:P undefined, so no finite point value is substituted.",
        f"Ammonia is available for {cc['activities'] - cc['organic_n_status'].get('not_sampled', 0)} activities. In {cc['organic_n_status'].get('negative_values_in_raw_difference', 0)}, the raw TKN-minus-ammonia interval includes negative values. These are overlapping analytical supports, not observed negative organic nitrogen; they are retained rather than silently set to zero.",
    ]


def method_paragraphs():
    return [
        "All joins use the exact original ActivityIdentifier, with matching station, date, clock, time-zone label, project, sample media and depth. Each activity has one unfiltered Kjeldahl-N, one nitrate/nitrite-N and one phosphorus row. Ammonia and the six agency-calculated Nitrogen rows remain separate original characteristics.",
        "Numeric concentrations retain [value,value]. Present Below Quantification Limit retains [0,reported limit), using the original limit's mg/L unit when the reported-result unit is blank. No zero, half-limit, limit or other point substitution is used. Source decimal strings become exact rational numbers before arithmetic; every exported endpoint includes its exact rational representation.",
        "Reconstructed N = Kjeldahl-N + nitrate/nitrite-N. Ammonia is already part of Kjeldahl-N and is not added again. Original weight-basis fields are blank. Elemental N/P interpretation follows the retained analyte and analytical-method identities, including the publisher's Total Phosphorus in Water method name. This operational reconstruction is separate from the original calculated Nitrogen values and does not remove analytical-method bias.",
        "For positive phosphorus, N:P bounds are [N_lower/P_upper, N_upper/P_lower], with endpoint openness propagated. A zero lower P bound makes the positive-P ratio unbounded above; at P=0 the ratio is undefined. P:N = P/N stays defined because every selected activity has positive reconstructed N. The NOx fraction uses NOx/(NOx+TKN), retaining the numerator's shared occurrence in the denominator.",
        "Molar N:P equals mass N:P times 30974/14007, using CIAAW's representative abridged atomic weights P=30.974 and N=14.007. Conversion precision is not laboratory precision. No universal molar threshold or limiting-nutrient classification is imposed.",
        "Same-date contrasts are station B minus station A, ordered by station identifier. They retain both activity IDs and original clocks. A direction is definite only when the entire interval is strictly on that side of zero, including open-endpoint handling. N:P directions involving below-limit P apply only over positive P; P:N directions do not need that qualification.",
        "Station, station-year and station-season summaries weight observed activities equally. The mean and linearly interpolated 25th/50th/75th order statistics are closed conservative envelopes; finite endpoint attainability is not claimed for tied censored order statistics. Sampling calendars differ, and SV-245 has one activity. Bounds describe source censoring, not confidence intervals or laboratory uncertainty.",
        "The results describe sampled unfiltered nutrient composition. They are not annual nutrient loads, treatment efficiencies, river transport balances or nutrient-limitation diagnoses. Same-date samples are separated in clock time; upstream/downstream causality and biological response require the corresponding network and field evidence.",
    ]


def write_figures(d, dest):
    """Retain exact finite P:N source coordinates in the existing figure schema."""
    pp = [p for p in d["pairs"] if p["station_a"] == "SV-375" and p["station_b"] == "SV-376" and p["metric"] == "pn_mass"]
    allv = [v for p in pp for v in (p["b_minus_a"]["lower"], p["b_minus_a"]["upper"])]
    lo, hi = min(0, min(allv)), max(allv)
    span = hi - lo
    lo -= span * .08; hi += span * .12
    series = []
    for side, marker in (("lower", "circle"), ("upper", "square")):
        series.append({"name": side.capitalize() + " bound", "geometry": "scatter", "marker": marker,
                       "points": [{"x": i + 1, "y": p["b_minus_a"][side], "censored": p["b_minus_a"][side + "_open"],
                                   "activity_a": p["activity_a"], "activity_b": p["activity_b"], "date": p["date"]} for i, p in enumerate(pp)]})
    figure = {"id": "same-date-phosphorus-nitrogen-balance", "title": "Same-date phosphorus:nitrogen balance",
              "caption": "Original SV-376 minus SV-375 P:N mass-ratio bounds on all 23 shared dates, 2024–2025. Circles mark lower bounds and squares upper bounds; hollow markers are excluded endpoints. The original per-date CSV retains every activity and collection time. P:N is defined at zero P; reconstructed N is positive throughout.",
              "panels": [{"title": "SV-376 minus SV-375", "x": {"label": "Shared date, ordered index", "unit": "", "domain": [0, len(pp) + 1], "ticks": [{"value": i+1, "label": str(i+1)} for i in range(len(pp)) if i % 2 == 0]},
                          "y": {"label": "P:N difference", "unit": "mg P / mg N", "domain": [lo, hi], "ticks": [{"value": x, "label": format(x, ".3g")} for x in (0, .02, .04, .06) if lo <= x <= hi]},
                          "series": series, "reference_lines": [{"axis": "y", "value": 0}]}]}
    write_json(dest / "figure-spec.json", {"schema": "upstate.scientific-figure-spec/v1", "figures": [figure]})
    # Browser companion uses the same finite numbers and original indices.
    w,h,l,r,t,b = 1020,420,78,25,55,66
    X=lambda x:l+(x/(len(pp)+1))*(w-l-r)
    Y=lambda y:h-b-(y-lo)/(hi-lo)*(h-t-b)
    svg=[f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" role="img" aria-labelledby="title desc"><title id="title">{html.escape(figure["title"])}</title><desc id="desc">{html.escape(figure["caption"])}</desc><rect width="100%" height="100%" fill="white"/><style>text{{font-family:Arial,sans-serif;fill:#222;font-size:13px}}</style><text x="{l}" y="28" font-size="19">SV-376 minus SV-375: phosphorus:nitrogen mass ratio</text>']
    for tick in figure['panels'][0]['y']['ticks']:
        y=Y(tick['value']);svg.append(f'<line x1="{l}" x2="{w-r}" y1="{y}" y2="{y}" stroke="#ddd"/><text x="{l-9}" y="{y+4}" text-anchor="end">{tick["label"]}</text>')
    svg.append(f'<line x1="{l}" x2="{w-r}" y1="{Y(0)}" y2="{Y(0)}" stroke="#333" stroke-dasharray="4 4"/>')
    for i,p in enumerate(pp):
        x=X(i+1);v=p['b_minus_a'];y1,y2=Y(v['lower']),Y(v['upper'])
        svg.append(f'<line x1="{x}" x2="{x}" y1="{y1}" y2="{y2}" stroke="#222"/>')
        fill='white' if v['lower_open'] else '#222';svg.append(f'<circle cx="{x}" cy="{y1}" r="3" stroke="#222" fill="{fill}"/>')
        fill='white' if v['upper_open'] else '#222';svg.append(f'<rect x="{x-3}" y="{y2-3}" width="6" height="6" stroke="#222" fill="{fill}"/>')
        if i%2==0:svg.append(f'<text x="{x}" y="{h-b+22}" text-anchor="middle">{i+1}</text>')
    svg.append(f'<text x="{w/2}" y="{h-15}" text-anchor="middle">Shared-date index (complete date and source key in paired-composition.csv)</text></svg>')
    (dest / "paired-pn-balance.svg").write_text(''.join(svg),encoding='utf-8')
    return figure


def build(application_root: Path, output: Path):
    if output.exists():
        raise FileExistsError("Choose a new output directory; an earlier edition is immutable: " + str(output))
    if not output.parent.is_dir():
        raise FileNotFoundError("Output parent must exist")
    authored = Path(__file__).resolve().parent
    # A generated package is itself a complete input source for subsequent builds.
    captures=[]
    for desc in INPUTS:
        original = application_root / desc["path"]
        if not original.is_file():
            original = application_root / REL / "original" / Path(desc["path"]).name
        captures.append((desc, original.read_bytes()))
    d=analyze(captures)
    output.mkdir()
    dest=output/REL;dest.mkdir(parents=True)
    for name in ("stoichiometry.py", "build.py", "explorer.html", "README.md", "receive.py"):
        shutil.copyfile(authored/name,dest/name)
    (dest/'original').mkdir()
    retained=[]
    for desc,body in captures:
        path=dest/'original'/Path(desc['path']).name;path.write_bytes(body)
        retained.append({**desc,"retained_path":path.relative_to(output).as_posix()})
    d['references']=REFERENCES
    d['retained_inputs']=retained
    d['interpretation']=findings(d)
    d['methods']=method_paragraphs()
    write_json(dest/'composition.json',d)
    write_json(dest/'source-inputs.json',{'schema':'upstate.nutrient-composition-inputs/v1','edition':EDITION,'inputs':retained,'method_identifiers':METHODS,'conversion':{'N_atomic_weight':14.007,'P_atomic_weight':30.974,'mass_to_molar_factor_exact':str(MOLAR_FACTOR)},'references':REFERENCES})
    write_csv(dest/'activities.csv',d['activities'])
    write_csv(dest/'station-calendar-summaries.csv',d['cohorts'])
    write_csv(dest/'paired-composition.csv',d['pairs'])
    write_csv(dest/'paired-direction-summary.csv',d['pair_summaries'])
    write_csv(dest/'original-result-index.csv',d['source_records'])
    write_json(dest/'summary.json',{k:d[k] for k in ('schema','edition','coverage','interpretation','pair_summaries')})
    fs=findings(d)
    methods_html='<ol class="method-list">'+''.join('<li>'+html.escape(p)+'</li>' for p in d['methods'])+'</ol><h3>Primary references</h3><ol>'+''.join('<li><a href="'+html.escape(r['url'],quote=True)+'">'+html.escape(r['title'])+'</a><p class="small">'+html.escape(r['use'])+'</p></li>' for r in REFERENCES)+'</ol>'
    report=(authored/'explorer.html').read_text().replace('__FINDINGS__',''.join('<p>'+html.escape(s)+'</p>' for s in fs)).replace('__METHODS__',methods_html).replace('__EDITION__',EDITION).replace('__STUDY_DATA__',json.dumps(d,ensure_ascii=False,separators=(',',':'),allow_nan=False).replace('<','\\u003c').replace('\u2028','\\u2028').replace('\u2029','\\u2029'))
    (dest/'index.html').write_text(report,encoding='utf-8')
    figure=write_figures(d,dest)
    station_rows=[]
    for station in sorted({a['station'] for a in d['activities']}):
        c={x['metric']:x for x in d['cohorts'] if x['group_by']=='station' and x['group']==station}
        station_rows.append([station,str(c['pn_mass']['n']),text_interval(c['pn_mass']['statistics']['median']),text_interval(c['np_mass']['statistics']['median']),text_interval(c['nox_fraction']['statistics']['median'])])
    pair_rows=[]
    for p in d['pair_summaries']:
        if p['station_a']=='SV-375' and p['station_b']=='SV-376' and p['metric'] in ('pn_mass','np_mass','nox_fraction','tn','p'):
            pair_rows.append([p['metric'],str(p['n']),str(p['counts'].get('higher',0)),str(p['counts'].get('lower',0)),str(p['counts'].get('overlapping',0))])
    sections=[['Source and scientific findings',fs],['Station composition',[
        'Each summary uses the original sampled activities, not equal years or matched station calendars. Finite summary ranges are closed enclosing bounds.',
        {'kind':'table','columns':['Station','Activities','Median P:N mass','Median N:P mass','Median NOx fraction'],'rows':station_rows,'widths':[.75,.65,1.5,1.5,1.5]},
        'SV-245 supplies only one activity. N:P ratios with below-limit P apply over positive P; at P=0 they are undefined.']],
        ['Same-date component contrasts',[
            'The original SV-375/SV-376 comparison covers 23 dates in 2024–2025. B is SV-376. Sampling clocks differ by 25–49 minutes. All source rows and the full annual/seasonal direction counts are retained.',
            {'kind':'table','columns':['Quantity','Pairs','B higher','B lower','Overlapping'],'rows':pair_rows},
            'P:N is defined for the complete selected cohort; unlike N:P, it does not need a positive-P qualification. Direction comparisons use exact rational arithmetic and preserve strict below-limit endpoints.']],
        ['Nitrogen reconstruction and censored components',d['methods'][:3]],
        ['Ratio arithmetic and interpretation',d['methods'][3:]],
        ['Open the complete original-source explorer',[{'kind':'links','items':[
            {'title':'Offline nutrient-composition explorer','path':(REL/'index.html').as_posix()},
            {'title':'All original activities with exact endpoints','path':(REL/'activities.csv').as_posix()},
            {'title':'All same-date component contrasts','path':(REL/'paired-composition.csv').as_posix()},
            {'title':'All 589 original row identities and fields','path':(REL/'original-result-index.csv').as_posix()},
            {'title':'Source methods and primary references','path':(REL/'README.md').as_posix()}]}]]]
    companions=source_closure(output)
    recipe={'schema':'upstate.observed-report/v1','title':TITLE,'edition':EDITION,
            'inputs':[describe(output,p) for p in companions if p.suffix in ('.csv','.json')],
            'sections':sections,'figure_spec':(REL/'figure-spec.json').as_posix(),
            'figures':[{'id':figure['id'],'path':(REL/'paired-pn-balance.svg').as_posix()}],
            'source_links':[(REL/name).as_posix() for name in ('source-inputs.json','README.md','stoichiometry.py','build.py')]}
    recipe_path=output/'eighteenmile_stoichiometry.report.json';write_json(recipe_path,recipe)
    entry={'id':EDITION,'title':TITLE,'kind':'document',**describe(output,recipe_path),
           'uri':'https://www.waterqualitydata.us/','vintage':'Original 2020–2025 observations; derived 2026-10-13',
           'metadata':{'report_schema':'upstate.observed-report/v1','context_layer':True,**d['coverage'],'ratio_basis':'unfiltered same-activity operational N and publisher total P','composition_schema':d['schema']},
           'companions':[describe(output,p) for p in companions]}
    manifest={'schema':'upstate.sources/v1','title':TITLE,'captured_at':'2026-10-13','entries':[entry]}
    write_json(output/MANIFEST,manifest)
    return {'schema':'upstate.nutrient-composition-build/v1','edition':EDITION,'output':str(output),'manifest':str(output/MANIFEST),'html':str(dest/'index.html'),'coverage':d['coverage'],'member_count':len(source_closure(output))+2}


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--application-root',type=Path,default=Path(__file__).resolve().parents[2])
    p.add_argument('--output',type=Path,required=True)
    a=p.parse_args()
    print(json.dumps(build(a.application_root.resolve(),a.output.resolve()),indent=2,ensure_ascii=False))

if __name__=='__main__':main()
