"""Read actual FloPy binary outputs without conflating numeric and physical agreement."""
from __future__ import annotations

from collections import Counter
import math
from pathlib import Path

from .common import Problem, digest, file_info

BOUNDARY_TERMS = {
    "CHD":"constant_head", "CONSTANT HEAD":"constant_head",
    "DRN":"drains", "DRAINS":"drains",
    "WEL":"wells", "WELLS":"wells",
    "RCHA":"recharge", "RCH":"recharge", "RECHARGE":"recharge",
    "RIV":"river", "RIVER LEAKAGE":"river",
    "GHB":"general_head", "HEAD DEP BOUNDS":"general_head",
    "EVTA":"evapotranspiration", "EVT":"evapotranspiration", "ET":"evapotranspiration",
}
STORAGE_TERMS = {"STO-SS":"storage_specific", "STO-SY":"storage_yield", "STORAGE":"storage"}
INTERNAL_TERMS = {"FLOW-JA-FACE","FLOW RIGHT FACE","FLOW FRONT FACE","FLOW LOWER FACE","DATA-SPDIS","DATA-SAT","CONSTANT HEAD FLOW"}
LENGTH_CODES = {0:"undefined",1:"feet",2:"metres",3:"centimetres"}
TIME_CODES = {0:"undefined",1:"seconds",2:"minutes",3:"hours",4:"days",5:"years"}

def scientific(value):
    value = float(value)
    return format(value, ".17g") if math.isfinite(value) else None

def _strings(array):
    import numpy as np
    data = np.asarray(array)
    if data.ndim == 0:
        return scientific(data.item())
    return [_strings(row) for row in data]

def _data(value, default=None):
    if value is None:
        return default
    return value.get_data() if hasattr(value,"get_data") else value

def _counts(mask):
    return dict(Counter(str(x) for plane in mask for row in plane for x in row))

def _head_masks(head, active, dry, noflow, constant, pass_through=False):
    import numpy as np
    values = np.asarray(head)
    mask = np.full(values.shape,"valid",dtype=object)
    mask[~np.isfinite(values)] = "nonfinite"
    for sentinel in noflow:
        mask[np.isclose(values,sentinel,rtol=1e-6,atol=0)] = "no_flow"
    for sentinel in dry:
        mask[np.isclose(values,sentinel,rtol=1e-6,atol=0)] = "dry"
    mask[np.asarray(active)==0] = "inactive"
    if pass_through:
        mask[np.asarray(active)<0] = "vertical_pass_through"
    counts = dict(Counter(mask.flatten()))
    counts["constant_head"] = int(np.count_nonzero(constant & (mask=="valid")))
    return mask.tolist(), counts

def _listing(path, cls, units):
    try:
        reader = cls(str(path),timeunit=units["time"] if units["time"]!="undefined" else "days")
        pair = reader.get_budget()
        if pair is None:
            return {"path":str(path.name),"available":False,"reason":"No native model budget table was parsed."}
        result = {"path":path.name,"available":True,"precision":"Values printed by the native listing and parsed by the original FloPy reader.","rate_units":units["length"]+"^3/"+units["time"],"volume_units":units["length"]+"^3"}
        for kind,array in zip(("rates","cumulative_volumes"),pair):
            rows = []
            for row in array:
                values = {}
                for key in array.dtype.names:
                    item = row[key]
                    values[key] = int(item) if key in ("time_step","stress_period") else scientific(item)
                rows.append(values)
            result[kind] = rows
        return result
    except (ValueError,IndexError,OSError,KeyError) as exc:
        return {"path":path.name,"available":False,"reason":str(exc)}

def _budgets(reader, step, time, units):
    import numpy as np
    result = {"kstp":int(step[0]),"kper":int(step[1]),"totim":scientific(time),"rate_units":units["length"]+"^3/"+units["time"],"terms":[],"records":[],"excluded_internal_terms":[],"unmapped_terms":[]}
    grouped = {}
    def header_value(value):
        if isinstance(value,(bytes,np.bytes_)):
            return value.decode("ascii",errors="replace")
        if isinstance(value,(np.integer,int)):
            return int(value)
        if isinstance(value,(np.floating,float)):
            return scientific(value)
        return str(value)
    for index,header in enumerate(reader.recordarray):
        if (int(header["kstp"])-1,int(header["kper"])-1)!=tuple(step):
            continue
        label=header["text"].decode("ascii",errors="replace").strip()
        retained_header={name:header_value(header[name]) for name in header.dtype.names}
        record={"index":index,"header":retained_header,"native_label":label}
        if label in INTERNAL_TERMS or label.startswith("DATA-"):
            result["excluded_internal_terms"].append(label)
            record["scope"]="excluded_internal";result["records"].append(record)
            continue
        canonical = BOUNDARY_TERMS.get(label) or STORAGE_TERMS.get(label)
        if canonical is None:
            result["unmapped_terms"].append(label)
            record["scope"]="unmapped";result["records"].append(record)
            continue
        # Native IMETH3 is [layer address array, flow array]. Converting the pair
        # to one ndarray would count integer layer numbers as flux. full3D=True
        # would also downcast this branch to float32 in the pinned FloPy reader.
        entry=reader.get_record(index,full3D=False)
        imeth=int(header["imeth"]) if "imeth" in header.dtype.names else 0
        if imeth==3:
            if not isinstance(entry,(list,tuple)) or len(entry)!=2:
                raise Problem("budget_record_shape","The original IMETH3 record is not its layer/data pair.",index=index)
            layers,flows=np.asarray(entry[0]),np.asarray(entry[1])
            if layers.shape!=flows.shape or layers.dtype.kind not in ("i","u"):
                raise Problem("budget_record_shape","Original IMETH3 layer addresses do not match the native rate array.",index=index)
            record["layer_addresses"]=layers.tolist()
            q=flows.astype(np.float64,copy=False).reshape(-1)
        else:
            entry=np.asarray(entry)
            if entry.dtype.names:
                q_name=next((name for name in entry.dtype.names if name.lower()=="q"),None)
                if q_name is None:
                    result["unmapped_terms"].append(label)
                    record["scope"]="unmapped_record_shape";result["records"].append(record)
                    continue
                record["address_and_auxiliary_fields"]={name:[header_value(value) for value in entry[name].reshape(-1)] for name in entry.dtype.names if name!=q_name}
                q=np.asarray(entry[q_name],dtype=np.float64).reshape(-1)
            else:
                q=np.asarray(entry,dtype=np.float64).reshape(-1)
        values=q.tolist()
        if any(not math.isfinite(value) for value in values):
            raise Problem("nonfinite_budget","A native budget term contains a nonfinite flow.",term=label,index=index)
        record.update({"scope":"storage" if label in STORAGE_TERMS else "boundary","canonical":canonical,"rate_values":[scientific(value) for value in values],"entries":len(values)})
        result["records"].append(record)
        incoming=math.fsum(value for value in values if value>0)
        outgoing=-math.fsum(value for value in values if value<0)
        current=grouped.setdefault(canonical,{"canonical":canonical,"scope":record["scope"],"native_labels":[],"record_indices":[],"in":0.0,"out":0.0,"entries":0})
        if label not in current["native_labels"]:
            current["native_labels"].append(label)
        current["record_indices"].append(index)
        current["in"]+=incoming;current["out"]+=outgoing;current["entries"]+=len(values)
    result["excluded_internal_terms"]=sorted(set(result["excluded_internal_terms"]))
    result["unmapped_terms"]=sorted(set(result["unmapped_terms"]))
    total_in=math.fsum(item["in"] for item in grouped.values())
    total_out=math.fsum(item["out"] for item in grouped.values())
    for item in grouped.values():
        result["terms"].append({**item,"in":scientific(item["in"]),"out":scientific(item["out"]),"net":scientific(item["in"]-item["out"])})
    denominator=(total_in+total_out)/2
    result["mapped_balance"]={"in":scientific(total_in),"out":scientific(total_out),"difference":scientific(total_in-total_out),"percentage_discrepancy":scientific(100*(total_in-total_out)/denominator) if denominator else None,"denominator":scientific(denominator),"complete_term_mapping":not result["unmapped_terms"]}
    return result

def _metric(before,after,before_mask,after_mask):
    def flat(value):
        if isinstance(value,list):
            for item in value:
                yield from flat(item)
        else:
            yield value
    left,right=list(flat(before)),list(flat(after))
    ma,mb=list(flat(before_mask)),list(flat(after_mask))
    if len(left)!=len(right) or len(left)!=len(ma) or len(right)!=len(mb):
        raise Problem("comparison_shape","The selected native array shapes differ.")
    differences=[]
    for x,y,mx,my in zip(left,right,ma,mb):
        if mx=="valid" and my=="valid" and x is not None and y is not None:
            xv,yv=float(x),float(y)
            if math.isfinite(xv) and math.isfinite(yv):
                differences.append(yv-xv)
    count,total=len(differences),len(left)
    values={"cells":total,"jointly_valid":count,"excluded":total-count,
            "before_exclusions":dict(Counter(v for v in ma if v!="valid")),
            "after_exclusions":dict(Counter(v for v in mb if v!="valid")),
            "max_absolute":None,"mean_signed":None,"root_mean_square":None}
    if count:
        values.update({"max_absolute":scientific(max(abs(x) for x in differences)),"mean_signed":scientific(math.fsum(differences)/count),"root_mean_square":scientific(math.sqrt(math.fsum(x*x for x in differences)/count))})
    return values

def cross_engine(result):
    before,after = result["engines"]["mf2005"],result["engines"]["mf6"]
    mapping = result["layer_mapping"]
    length_match = before["units"]["length"] == after["units"]["length"] and before["units"]["length"]!="undefined"
    time_match = before["units"]["time"] == after["units"]["time"] and before["units"]["time"]!="undefined"
    horizontal_grid_match = before["grid"]["rows"]==after["grid"]["rows"] and before["grid"]["columns"]==after["grid"]["columns"] and before["grid"]["delr"]==after["grid"]["delr"] and before["grid"]["delc"]==after["grid"]["delc"]
    pairs = []
    unmatched_before = list(range(len(before["heads"])))
    for mf6 in after["heads"]:
        candidates = [(i,x) for i,x in enumerate(before["heads"]) if (x["kstp"],x["kper"],x["totim"]) == (mf6["kstp"],mf6["kper"],mf6["totim"])]
        if len(candidates) != 1:
            pairs.append({"mf6_step":{"kstp":mf6["kstp"],"kper":mf6["kper"],"totim":mf6["totim"]},"physical_comparable":False,"issue":"No unique original legacy output has the same native numeric step and time."})
            continue
        index,legacy = candidates[0]
        if index in unmatched_before:
            unmatched_before.remove(index)
        physical = length_match and time_match and horizontal_grid_match
        aquifers = []
        for mf6_layer,legacy_layer in mapping:
            numeric = _metric(legacy["values"][legacy_layer],mf6["values"][mf6_layer],legacy["mask"][legacy_layer],mf6["mask"][mf6_layer]) if horizontal_grid_match else None
            aquifers.append({"mf6_layer":mf6_layer,"legacy_layer":legacy_layer,"numeric_difference":numeric,"physical_head_difference":numeric if physical else None})
        pairs.append({"mf6_step":{"kstp":mf6["kstp"],"kper":mf6["kper"],"totim":mf6["totim"],"unit":after["units"]["time"]},"legacy_step":{"kstp":legacy["kstp"],"kper":legacy["kper"],"totim":legacy["totim"],"unit":before["units"]["time"]},"physical_comparable":physical,"issue":None if physical else "Native length/time declarations or horizontal grids differ. These are not a physical same-time comparison.","aquifers":aquifers})
    return {"before_engine":"mf2005","after_engine":"mf6","declared_units_match":length_match and time_match,"horizontal_grid_matches":horizontal_grid_match,"pairs":pairs,"unmatched_legacy_steps":[before["heads"][i]["totim"] for i in unmatched_before],"criterion_scope":"The publisher's unchanged baseline assertion is retained separately from masked-cell or physical-unit comparisons."}

def extract_outputs(sim,mf,attempt,request,publisher_completed):
    import numpy as np
    import flopy
    attempt = Path(attempt)
    gwf = sim.get_model()
    dis = gwf.dis
    units6 = {"length":str(_data(dis.length_units,"undefined")).lower().replace("meters","metres"),"time":str(_data(sim.tdis.time_units,"undefined")).lower()}
    units5 = {"length":LENGTH_CODES.get(int(mf.dis.lenuni),"undefined"),"time":TIME_CODES.get(int(mf.dis.itmuni),"undefined")}
    active6 = _data(dis.idomain)
    if active6 is None:
        active6 = np.ones((int(_data(dis.nlay)),int(_data(dis.nrow)),int(_data(dis.ncol))),dtype=int)
    active5 = mf.bas6.ibound.array
    constant6,constant5 = np.zeros(np.shape(active6),dtype=bool),np.asarray(active5)<0
    if gwf.chd:
        for rows in gwf.chd.stress_period_data.get_data().values():
            for row in rows:
                constant6[tuple(row["cellid"])] = True
    if mf.chd:
        for rows in mf.chd.stress_period_data.data.values():
            for row in rows:
                constant5[int(row["k"]),int(row["i"]),int(row["j"])] = True
    h6,c6 = gwf.output.head(),gwf.output.budget()
    model_root = Path(mf.model_ws)
    head_candidates = [p for p in model_root.iterdir() if p.suffix.lower() in (".hds",".hed",".bhd")]
    budget_candidates = [p for p in model_root.iterdir() if p.suffix.lower() in (".cbc",".cbb",".bud")]
    if len(head_candidates)!=1 or len(budget_candidates)!=1:
        raise Problem("legacy_outputs","Select one actual legacy head and budget file in the retained native model.",heads=[p.name for p in head_candidates],budgets=[p.name for p in budget_candidates])
    h5 = flopy.utils.HeadFile(head_candidates[0],precision="double")
    c5 = flopy.utils.CellBudgetFile(budget_candidates[0],precision="double")
    engines = {}
    for engine,model,head,budget,units,active,constant,dry,noflow in (
        ("mf6",gwf,h6,c6,units6,active6,constant6,[-1e30],[1e30]),
        ("mf2005",mf,h5,c5,units5,active5,constant5,[float(mf.lpf.hdry)],[float(mf.bas6.hnoflo)]),
    ):
        heads,budgets = [],[]
        times,steps = head.get_times(),head.get_kstpkper()
        if not times or len(times)!=len(steps):
            raise Problem("head_steps","Native head output has no complete time/step index.",engine=engine)
        budget_steps = budget.get_kstpkper()
        for index,(time,step) in enumerate(zip(times,steps)):
            values = head.get_data(kstpkper=tuple(step))
            mask,counts = _head_masks(values,active,dry,noflow,constant,pass_through=engine=="mf6")
            heads.append({"kstp":int(step[0]),"kper":int(step[1]),"totim":scientific(time),"values":_strings(values),"mask":mask,"counts":counts})
            if tuple(step) not in budget_steps:
                raise Problem("budget_steps","A head step has no corresponding original budget record.",engine=engine,step=list(step))
            budgets.append(_budgets(budget,step,time,units))
        listing_path = Path(gwf.model_ws) / (gwf.name+".lst") if engine=="mf6" else Path(mf.model_ws)/mf.lst.file_name[0]
        listing = _listing(listing_path,flopy.utils.Mf6ListBudget if engine=="mf6" else flopy.utils.MfListBudget,units)
        engines[engine] = {"model_id":model.name,"units":units,"head_precision":str(head.precision),"budget_precision":str(budget.precision),"shape":list(np.shape(active)),"heads":heads,"budgets":budgets,"listing":listing,"mask_definition":{"inactive":"Native idomain/ibound = 0; negative MF6 idomain is vertical pass-through and excluded","dry":list(map(scientific,dry)),"no_flow":list(map(scientific,noflow)),"nonfinite":"NaN or infinity","constant_head":"Native fixed-head cell retained as a valid comparison cell"},"grid":{"rows":int(np.shape(active)[1]),"columns":int(np.shape(active)[2]),"delr":_strings(model.modelgrid.delr),"delc":_strings(model.modelgrid.delc),"top":_strings(model.modelgrid.top),"bottom":_strings(model.modelgrid.botm),"coordinates":"model_local","crs":None},"head_file":str(Path(head.filename).relative_to(attempt)),"budget_file":str(Path(budget.filename).relative_to(attempt))}
    mapping = request["edition"]["profile"]["layer_mapping"]
    for a,b in mapping:
        if a>=engines["mf6"]["shape"][0] or b>=engines["mf2005"]["shape"][0]:
            raise Problem("layer_mapping","The selected aquifer mapping is outside the actual native head arrays.")
    reference_basis = request["run"].get("reference_basis")
    if reference_basis is not None:
        from .sources import verify_reference_basis
        verify_reference_basis(reference_basis,request["source"])
    findings = list(reference_basis["findings"] if reference_basis else request["source"]["findings"])
    if units6 != units5:
        findings.append({"id":"NATIVE_UNIT_DISAGREEMENT","severity":"review","message":"Actual native models declare different length or time units. Numeric head agreement does not establish a physical same-unit/same-time comparison.","mf6":units6,"mf2005":units5})
    for engine,content in engines.items():
        if not content["listing"]["available"]:
            findings.append({"id":"LISTING_"+engine.upper(),"severity":"review","message":content["listing"]["reason"]})
        labels = sorted({x for step in content["budgets"] for x in step["unmapped_terms"]})
        if labels:
            findings.append({"id":"UNMAPPED_BUDGET_"+engine.upper(),"severity":"review","message":"Native budget labels remain outside the explicit canonical mass-budget mapping.","labels":labels})
        if any(step["counts"].get("dry",0)+step["counts"].get("no_flow",0)+step["counts"].get("nonfinite",0) for step in content["heads"]):
            findings.append({"id":"EXCLUDED_HEADS_"+engine.upper(),"severity":"review","message":"Native dry, no-flow or nonfinite values are excluded and counted in paired comparisons."})
    result = {"schema":"starforge.groundwater-native-result.v1","run_id":request["run"]["id"],"project_id":request["run"]["project_id"],"edition_id":request["edition"]["id"],"edition_sha256":request["edition"]["sha256"],"source_id":request["source"]["id"],"source_sha256":request["source"]["sha256"],"runtime_sha256":request["run"]["runtime_sha256"],"application_sha256":request["run"]["application_sha256"],"engines":engines,"layer_mapping":mapping,"intended_units":request["edition"]["profile"].get("intended_units"),"time_semantics":"steady_solution" if request["edition"]["profile"].get("time",{}).get("steady") else "native_periods","findings":findings,"publisher_comparison":{"executed":bool(publisher_completed),"criterion":request["edition"]["profile"].get("publisher_criterion"),"scope":"Unchanged publisher all-cell numeric assertion and normalized-discharge plots; native unit compatibility is a separate result."},"scientific_precision":"Head/budget arrays read from original native binary files. JSON uses 17 significant decimal digits; exact original binary bytes remain authoritative."}
    if reference_basis is not None:
        result["reference_basis_sha256"] = reference_basis["sha256"]
    result["cross_engine"] = cross_engine(result)
    # Keep per-side source/units even when the original publisher numeric assertion passes.
    return result

def compare_results(before,after):
    if before["source_sha256"] != after["source_sha256"]:
        raise Problem("comparison_source","Choose baseline/scenario runs derived from the same exact original source.")
    if before["layer_mapping"] != after["layer_mapping"]:
        raise Problem("comparison_layers","The selected runs have different native aquifer mappings.")
    output = {"schema":"starforge.groundwater-comparison.v1","before_run_id":before["run_id"],"after_run_id":after["run_id"],"before_result_sha256":digest(before),"after_result_sha256":digest(after),"engines":{}}
    for engine in ("mf6","mf2005"):
        a,b = before["engines"][engine],after["engines"][engine]
        same_grid = a["grid"] == b["grid"] and a["shape"] == b["shape"]
        same_units = a["units"] == b["units"] and "undefined" not in a["units"].values()
        steps,used = [],set()
        for current in b["heads"]:
            matches = [(i,old) for i,old in enumerate(a["heads"]) if (old["kstp"],old["kper"],old["totim"])==(current["kstp"],current["kper"],current["totim"])]
            comparable = same_grid and same_units and len(matches)==1
            item = {"kstp":current["kstp"],"kper":current["kper"],"totim":current["totim"],"physical_comparable":comparable,"units":b["units"],"layers":[]}
            if len(matches)==1:
                index,old = matches[0]; used.add(index)
                for layer in range(min(len(old["values"]),len(current["values"]))):
                    metric = _metric(old["values"][layer],current["values"][layer],old["mask"][layer],current["mask"][layer]) if same_grid else None
                    item["layers"].append({"layer":layer,"numeric_difference":metric,"physical_head_difference":metric if comparable else None})
            if not comparable:
                item["issue"] = "Native grid, declared units or exact original output time differs."
            steps.append(item)
        terms = []
        for new in b["budgets"]:
            matches = [old for old in a["budgets"] if (old["kstp"],old["kper"],old["totim"])==(new["kstp"],new["kper"],new["totim"])]
            if len(matches)!=1:
                continue
            oldterms = {x["canonical"]:x for x in matches[0]["terms"]}
            newterms = {x["canonical"]:x for x in new["terms"]}
            for name in sorted(set(oldterms)|set(newterms)):
                old,newterm = oldterms.get(name),newterms.get(name)
                terms.append({"term":name,"kstp":new["kstp"],"kper":new["kper"],"totim":new["totim"],"before":old,"after":newterm,"physical_comparable":same_grid and same_units and old is not None and newterm is not None,"net_difference":scientific(float(newterm["net"])-float(old["net"])) if same_grid and same_units and old and newterm else None})
        output["engines"][engine] = {"grid_matches":same_grid,"units_match":same_units,"before_units":a["units"],"after_units":b["units"],"steps":steps,"budget_rates":terms,"unmatched_before_steps":[x["totim"] for i,x in enumerate(a["heads"]) if i not in used],"time_semantics":after["time_semantics"]}
    return output

def plot_native(result,directory):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    import numpy as np
    directory = Path(directory)
    directory.mkdir(parents=True,exist_ok=True)
    paths = []
    for engine,content in result["engines"].items():
        head = content["heads"][-1]
        layers = [pair[0 if engine=="mf6" else 1] for pair in result["layer_mapping"]]
        fig,axes = plt.subplots(1,len(layers),figsize=(4*len(layers),4),squeeze=False)
        for ax,layer in zip(axes[0],layers):
            values = np.array(head["values"][layer],dtype=float)
            mask = np.array(head["mask"][layer])!="valid"
            shown = np.ma.array(values,mask=mask)
            image = ax.imshow(shown,origin="upper",cmap="viridis")
            ax.set_title(f"{engine} layer {layer}"); ax.set_xlabel("Column index"); ax.set_ylabel("Row index")
            fig.colorbar(image,ax=ax,label="Head ("+content["units"]["length"]+")")
        fig.suptitle("Native "+result["time_semantics"].replace("_"," ")+"; grid indices, no assumed CRS")
        fig.tight_layout()
        filename=engine+"-heads.png"
        fig.savefig(directory/filename,dpi=150); plt.close(fig)
        paths.append(filename)
    return paths
