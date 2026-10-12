"""Retain complete original packages and resolve literal native file references."""
from __future__ import annotations
import copy
import json
from pathlib import Path, PurePosixPath
import re
import shlex

from .common import Problem, digest, integer, number, relative, text

PUBLISHER_COMMIT = "8be96e1727483c9c908977a5b8233eb5c5bbeef9"
BUILDER_SHA = "e1a388a73ad97f04aa6a7f7a8b77170c20565c28bd1e785d466fb2f47461b3dc"
LAYER_MAPPING = [[0, 0], [2, 1], [4, 2]]
WELLS = [
    [4,4,10,"-5"], [2,3,5,"-5"], [2,5,11,"-5"],
    [0,8,7,"-5"], [0,8,9,"-5"], [0,8,11,"-5"], [0,8,13,"-5"],
    [0,10,7,"-5"], [0,10,9,"-5"], [0,10,11,"-5"], [0,10,13,"-5"],
    [0,12,7,"-5"], [0,12,9,"-5"], [0,12,11,"-5"], [0,12,13,"-5"],
]
FINDINGS = [
    {"id":"TWRI_RECHARGE_TEXT", "severity":"review", "message":"The unchanged executable uses 3e-8 ft/s; the publisher prose states 3e-7 ft/s.", "evidence":[{"path":"publisher/examples/scripts/ex-gwf-twri.py","line":68},{"path":"publisher/examples/doc/ex-gwf-twri.tex","section":"boundary conditions"}]},
    {"id":"TWRI_LEGACY_UNITS", "severity":"review", "message":"The unchanged legacy builder omits DIS unit codes. FloPy 3.11.0 defaults declare days/metres, while the MF6 builder declares seconds/feet. Intended source units and native declarations remain distinct.", "evidence":[{"path":"publisher/examples/scripts/ex-gwf-twri.py","function":"build_mf5model"},{"url":"https://raw.githubusercontent.com/modflowpy/flopy/a43f79127d0383e5328a602e72faf9a9730c7d61/flopy/modflow/mfdis.py","function":"ModflowDis.__init__"}]},
    {"id":"TWRI_STEADY_SOLUTION", "severity":"information", "message":"One steady stress period and one output step are an equilibrium solution. Numeric period length 86400 does not make this a transient hydrograph.", "evidence":[{"path":"publisher/examples/scripts/ex-gwf-twri.py","lines":[69,76]}]},
    {"id":"TWRI_NATIVE_GRID", "severity":"information", "message":"Compare aquifers at MF6 layers 0/2/4 with legacy layers 0/1/2. The legacy confining-bed representation remains unchanged.", "evidence":[{"path":"publisher/examples/scripts/ex-gwf-twri.py","function":"build_mf5model"}]},
]

def publisher_source(application):
    application = Path(application)
    manifest = json.loads((application / "publisher" / "manifest.json").read_text(encoding="utf-8"))
    rows = []
    for original in manifest["files"]:
        name = relative(original["path"])
        raw = (application / name).read_bytes()
        if len(raw) != original["bytes"] or digest(raw) != original["sha256"]:
            raise Problem("publisher_source_changed", "Bundled publisher original does not match its exact source manifest.", path=name)
        rows.append((name, raw, original))
    if not any(x[0].endswith("scripts/ex-gwf-twri.py") and digest(x[1]) == BUILDER_SHA for x in rows):
        raise Problem("publisher_builder_missing", "The exact unchanged TWRI builder is required.")
    return rows

def twri_profile():
    return {"adapter":"publisher_twri", "source_commit":PUBLISHER_COMMIT, "builder_path":"publisher/examples/scripts/ex-gwf-twri.py", "builder_sha256":BUILDER_SHA, "mf6_namefile":"ex-gwf-twri01/mfsim.nam", "legacy_namefile":"ex-gwf-twri01/mf2005/ex-gwf-twri01.nam", "layer_mapping":LAYER_MAPPING, "intended_units":{"length":"feet","time":"seconds"}, "declared_units":{"mf6":{"length":"feet","time":"seconds"},"mf2005":{"length":"metres","time":"days"}}, "grid":{"mf6_layers":5,"legacy_layers":3,"rows":15,"columns":15,"delr":"5000","delc":"5000"}, "time":{"steady":True,"periods":1,"steps":1,"period_length":"86400"}, "coordinates":{"kind":"model_local","crs":None}, "publisher_criterion":{"metric":"maximum_absolute_numeric_head_difference","strict_upper_bound":"0.05","aquifers":[1,2,3],"scope":"unchanged publisher baseline numeric comparison; declared unit conflict remains separate"}}

def parameters():
    return {"recharge":"3e-8", "wells":copy.deepcopy(WELLS), "legacy_units":{"length":"metres","time":"days"}}

def _tokens(line):
    try:
        lexer = shlex.shlex(line, posix=True)
        lexer.whitespace_split = True
        lexer.commenters = "#!"
        return list(lexer)
    except ValueError:
        return []

def package_profile(files, selected):
    names = {name for name, _ in files}
    mf6_candidates = sorted(n for n in names if PurePosixPath(n).name.lower() == "mfsim.nam")
    legacy_candidates = sorted(n for n in names if n.lower().endswith(".nam") and n not in mf6_candidates)
    mf6 = selected.get("mf6_namefile") or (mf6_candidates[0] if len(mf6_candidates) == 1 else None)
    legacy = selected.get("legacy_namefile")
    findings = []
    if mf6 is not None:
        relative(mf6)
    if legacy is not None:
        relative(legacy)
    for engine, chosen, candidates in (("mf6",mf6,mf6_candidates),("mf2005",legacy,legacy_candidates)):
        if not chosen or chosen not in names:
            findings.append({"id":"SELECT_"+engine.upper(), "severity":"blocking", "message":"Select the exact original native namefile for "+engine+".", "candidates":candidates})
    refs = []
    units = {}
    texts = {}
    for name, raw in files:
        try:
            content = raw.decode("utf-8-sig")
        except UnicodeDecodeError:
            continue
        if "\x00" in content:
            continue
        texts[name] = content
        for lineno, line in enumerate(content.splitlines(), 1):
            tokens = _tokens(line)
            if not tokens:
                continue
            upper = [x.upper() for x in tokens]
            candidates = []
            for keyword in ("FILEIN", "OPEN/CLOSE"):
                for index, value in enumerate(upper[:-1]):
                    if value == keyword:
                        candidates.append(tokens[index+1])
            # MF6 model/simulation namefiles use type, original filename, modelname.
            if name == mf6 or name.lower().endswith(".nam"):
                if upper[0] not in ("BEGIN","END","#") and len(tokens) >= 2:
                    if upper[0].endswith("6"):
                        candidates.append(tokens[1])
                    elif len(tokens) >= 3 and re.fullmatch(r"\d+", tokens[1]):
                        units[(str(PurePosixPath(name).parent), tokens[1])] = tokens[2]
                        if upper[0] not in ("LIST","DATA","DATA(BINARY)") or "OLD" in upper:
                            candidates.append(tokens[2])
            for candidate in candidates:
                parent = PurePosixPath(name).parent
                joined = str(parent / candidate)
                try:
                    relative(joined)
                except Problem:
                    findings.append({"id":f"EXTERNAL_{len(findings)}", "severity":"blocking", "message":"Original package refers outside the retained relative file tree.", "path":name,"line":lineno,"reference":candidate})
                    continue
                exists = joined in names
                refs.append({"from":name,"line":lineno,"reference":candidate,"path":joined,"present":exists})
                if not exists:
                    findings.append({"id":f"MISSING_{len(findings)}","severity":"blocking","message":"Original referenced file is absent.","path":name,"line":lineno,"reference":joined})
    # Legacy EXTERNAL unit numbers resolve against the original namefile table.
    if legacy:
        parent = str(PurePosixPath(legacy).parent)
        for name, content in texts.items():
            if str(PurePosixPath(name).parent) != parent:
                continue
            for lineno, line in enumerate(content.splitlines(),1):
                token = _tokens(line)
                if len(token) > 1 and token[0].upper() == "EXTERNAL":
                    ref = units.get((parent, token[1]))
                    if not ref:
                        findings.append({"id":f"UNIT_{len(findings)}","severity":"blocking","message":"Legacy EXTERNAL unit has no original namefile mapping.","path":name,"line":lineno,"unit":token[1]})
                    else:
                        target = str(PurePosixPath(parent) / ref)
                        safe = True
                        try:
                            relative(target)
                        except Problem:
                            safe = False
                        present = safe and target in names
                        refs.append({"from":name,"line":lineno,"unit":token[1],"reference":ref,"path":target,"present":present})
                        if not present:
                            findings.append({"id":f"UNIT_FILE_{len(findings)}","severity":"blocking","message":"Legacy EXTERNAL unit maps to an absent or external original file.","path":name,"line":lineno,"unit":token[1],"reference":ref})
    mapping = selected.get("layer_mapping", [])
    if not isinstance(mapping, list) or not mapping:
        findings.append({"id":"LAYER_MAPPING_REQUIRED","severity":"blocking","message":"Supply explicit aquifer layer pairs after inspecting the original native model."})
    else:
        left, right = set(), set()
        for pair in mapping:
            if not isinstance(pair, list) or len(pair) != 2:
                raise Problem("layer_mapping", "Layer mapping must contain explicit [MF6, legacy] index pairs.", 400)
            a, b = integer(pair[0], "MF6 layer", 0, 100000), integer(pair[1], "Legacy layer", 0, 100000)
            if a in left or b in right:
                raise Problem("layer_mapping", "Each selected aquifer layer is mapped once.", 400)
            left.add(a); right.add(b)
    profile = {"adapter":"native_package","mf6_namefile":mf6,"legacy_namefile":legacy,"layer_mapping":mapping,"intended_units":selected.get("intended_units"),"file_references":refs,"coordinates":{"kind":"model_local","crs":None}}
    return profile, findings

def derive(parent, changes, reason):
    if parent["profile"]["adapter"] != "publisher_twri":
        raise Problem("scenario_adapter", "This edition editor applies the reviewed TWRI recharge, existing wells and metadata. Retain other native models as their own complete source package.")
    if not isinstance(changes, list) or not 1 <= len(changes) <= 17:
        raise Problem("changes", "A scenario requires 1–17 explicit changes.", 400)
    value = copy.deepcopy(parent["parameters"])
    normalized, seen = [], set()
    for change in changes:
        kind = change.get("kind")
        text(change.get("reason",""), "Change reason", 4000, True)
        if kind == "recharge":
            key = "recharge"
            if change.get("before") != value["recharge"]:
                raise Problem("change_basis", "Recharge before value differs from the selected parent edition.")
            number(change.get("after"), "Recharge", nonnegative=True)
            value["recharge"] = change["after"]
            normalized.append({**change,"units":"feet/seconds","source":{"path":"publisher/examples/scripts/ex-gwf-twri.py","line":68}})
        elif kind == "well":
            index = integer(change.get("index"), "Original well index", 0, len(value["wells"])-1)
            key = f"well:{index}"
            if change.get("before") != value["wells"][index][3]:
                raise Problem("change_basis", "Well before value differs from the selected parent edition.")
            number(change.get("after"), "Well flow")
            value["wells"][index][3] = change["after"]
            normalized.append({**change,"mf6_cell":value["wells"][index][:3],"legacy_cell":[dict(LAYER_MAPPING)[value["wells"][index][0]],*value["wells"][index][1:3]],"units":"feet^3/seconds","source":{"path":"publisher/examples/scripts/ex-gwf-twri.py","variable":"wel_spd"}})
        elif kind == "legacy_units":
            key = "legacy_units"
            if change.get("before") != value["legacy_units"] or change.get("after") != {"length":"feet","time":"seconds"}:
                raise Problem("change_basis", "Legacy metadata correction must explicitly retain its original unit codes and select intended feet/seconds.")
            value["legacy_units"] = copy.deepcopy(change["after"])
            normalized.append({**change,"scope":"Attributed derived-input metadata correction; original publisher baseline remains unchanged."})
        else:
            raise Problem("change_kind", "Select recharge, an original well, or the explicit legacy unit metadata correction.", 400)
        if key in seen:
            raise Problem("duplicate_change", "A scenario changes each original parameter once.", 400)
        seen.add(key)
    profile = copy.deepcopy(parent["profile"])
    profile["declared_units"]["mf2005"] = copy.deepcopy(value["legacy_units"])
    return value, profile, normalized
