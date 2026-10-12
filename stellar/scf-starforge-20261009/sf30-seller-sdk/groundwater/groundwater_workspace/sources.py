"""Retain complete original packages and resolve literal native file references."""
from __future__ import annotations
import copy
import json
import posixpath
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
        lexer.escape = ""
        lexer.commenters = "#!"
        return list(lexer)
    except ValueError:
        return []

# This identity belongs to the reader loaded by this process. Editing its file
# cannot make an already-imported parser claim to have executed newer code.
_REFERENCE_READER = {
    "schema": "starforge.groundwater-reference-reader.v1",
    "grammar": "selected-mf6-and-mf2005-input-closure-v2",
    "source_sha256": digest(Path(__file__).read_bytes()),
}

def reference_reader():
    return copy.deepcopy(_REFERENCE_READER)

def reference_selection(profile):
    return {key: copy.deepcopy(profile.get(key)) for key in
            ("mf6_namefile", "legacy_namefile", "layer_mapping", "intended_units")}

def reference_file_manifest(source):
    return sorted([{"path": row["path"], "bytes": row["bytes"], "sha256": row["sha256"]}
                   for row in source["files"]], key=lambda row: row["path"])

def verify_source_identity(source):
    body = {key: value for key, value in source.items()
            if key not in ("id", "project_id", "created", "updated", "sha256")}
    if digest(body) != source["sha256"]:
        raise Problem("source_identity", "The retained source body differs from its original immutable identity.")

def reference_basis(source, inspection=None):
    """A diagnostic basis supplements the immutable source; it never rewrites it."""
    verify_source_identity(source)
    if source["kind"] != "native_package":
        return None
    if inspection is None:
        reader = source.get("reference_reader")
        profile, findings = source["profile"], source["findings"]
        inspection_id, inspection_sha = None, None
    else:
        body = {key: value for key, value in inspection.items()
                if key not in ("id", "project_id", "created", "updated", "sha256")}
        if (digest(body) != inspection["sha256"] or
                inspection["source_id"] != source["id"] or
                inspection["source_sha256"] != source["sha256"] or
                inspection["file_manifest_sha256"] != digest(reference_file_manifest(source)) or
                reference_selection(inspection["profile"]) != reference_selection(source["profile"])):
            raise Problem("reference_inspection_identity",
                          "The retained reference inspection does not belong to these unchanged source bytes and selections.")
        reader = inspection["reader"]
        profile, findings = inspection["profile"], inspection["findings"]
        inspection_id, inspection_sha = inspection["id"], inspection["sha256"]
    value = {
        "schema": "starforge.groundwater-reference-basis.v1",
        "source_id": source["id"], "source_sha256": source["sha256"],
        "file_manifest_sha256": digest(reference_file_manifest(source)),
        "inspection_id": inspection_id, "inspection_sha256": inspection_sha,
        "reader": copy.deepcopy(reader), "profile": copy.deepcopy(profile),
        "findings": copy.deepcopy(findings),
    }
    value["sha256"] = digest(value)
    return value

def verify_reference_basis(basis, source):
    verify_source_identity(source)
    if (not isinstance(basis, dict) or
            basis.get("schema") != "starforge.groundwater-reference-basis.v1" or
            digest({key: value for key, value in basis.items() if key != "sha256"}) != basis.get("sha256") or
            basis.get("source_id") != source["id"] or
            basis.get("source_sha256") != source["sha256"] or
            basis.get("file_manifest_sha256") != digest(reference_file_manifest(source)) or
            reference_selection(basis.get("profile", {})) != reference_selection(source["profile"])):
        raise Problem("reference_basis_identity",
                      "The frozen native run reference inspection differs from its original source or selections.")
    return basis


def package_profile(files, selected):
    """Inspect only the selected native input graphs, preserving every source byte.

    FloPy 3.11 uses the simulation directory for MF6 references and the selected
    legacy model/namefile directory for MODFLOW-2005 references. A filename's
    suffix cannot select either grammar: BAS6 is a legacy unit-table record.
    """
    originals = dict(files)
    names = set(originals)
    if len(names) != len(files):
        raise Problem("duplicate_member", "Original native paths must be unique.")
    mf6_candidates = sorted(n for n in names if PurePosixPath(n).name.lower() == "mfsim.nam")
    legacy_candidates = sorted(n for n in names if n.lower().endswith(".nam") and n not in mf6_candidates)
    mf6 = selected.get("mf6_namefile") or (mf6_candidates[0] if len(mf6_candidates) == 1 else None)
    legacy = selected.get("legacy_namefile")
    findings, refs, visited, pending = [], [], set(), []
    units, input_paths, output_paths = {}, set(), set()
    for engine, chosen, candidates in (("mf6",mf6,mf6_candidates),("mf2005",legacy,legacy_candidates)):
        if chosen is not None:
            relative(chosen)
        if not chosen or chosen not in names:
            findings.append({"id":"SELECT_"+engine.upper(), "severity":"blocking",
                             "message":"Select the exact original native namefile for "+engine+".",
                             "candidates":candidates})
    if mf6 and legacy and mf6 == legacy:
        findings.append({"id":"NAMEFILE_ENGINE_COLLISION","severity":"blocking",
                         "message":"The selected simulation and legacy namefiles cannot be the same original file."})

    def finding(code, message, **detail):
        findings.append({"id":code+"_"+str(len(findings)), "severity":"blocking",
                         "message":message, **detail})

    def resolve(base, candidate):
        if (not isinstance(candidate,str) or not candidate or "\\" in candidate or
                ":" in candidate or PurePosixPath(candidate).is_absolute()):
            raise Problem("unsafe_native_reference","Native reference is not a supported retained relative path.")
        # Native ./ and ../ are meaningful. Normalize them, then require the
        # result to stay inside the original archive root.
        return relative(posixpath.normpath(posixpath.join(base,candidate)))

    def add(engine, source, line, candidate, base, *, role="input", kind="package", unit=None):
        row = {"engine":engine,"role":role,"from":source,"line":line,
               "reference":candidate,"base":base}
        if unit is not None:
            row["unit"] = unit
        try:
            target = resolve(base,candidate)
        except Problem:
            refs.append({**row,"path":None,"present":False})
            finding("EXTERNAL","Original native reference is outside the retained relative tree or uses an unsupported path.",path=source,line=line,reference=candidate,role=role)
            return None
        present = target in names
        refs.append({**row,"path":target,"present":present})
        if role == "output":
            output_paths.add(target)
            return target
        input_paths.add(target)
        if not present:
            finding("MISSING","Original required native input file is absent.",path=source,line=line,reference=candidate,resolved_path=target,engine=engine)
        elif kind != "data":
            pending.append((engine,target,kind,base,unit))
        return target

    def lines(name):
        raw = originals[name]
        try:
            content = raw.decode("utf-8-sig")
        except UnicodeDecodeError:
            finding("INPUT_TEXT","A selected native control file is not readable UTF-8 text.",path=name)
            return []
        if "\x00" in content:
            finding("INPUT_TEXT","A selected native control file contains binary data.",path=name)
            return []
        return enumerate(content.splitlines(),1)

    mf6_base = str(PurePosixPath(mf6).parent) if mf6 else "."
    legacy_base = str(PurePosixPath(legacy).parent) if legacy else "."
    if mf6 in names:
        input_paths.add(mf6)
        pending.append(("mf6",mf6,"simulation_namefile",mf6_base,None))

    # Build the complete selected legacy unit map before following any EXTERNAL
    # control. LIST and output DATA records are not required input files.
    if legacy in names:
        input_paths.add(legacy)
        visited.add(("mf2005",legacy,"legacy_namefile",None))
        for lineno, line in lines(legacy):
            tokens = _tokens(line)
            if not tokens:
                continue
            if len(tokens) < 3 or not re.fullmatch(r"[+-]?\d+",tokens[1]):
                finding("LEGACY_NAMEFILE","Legacy namefile records require type, integer unit and original filename.",path=legacy,line=lineno,record=line)
                continue
            ftype, unit, filename = tokens[0].upper(), abs(int(tokens[1])), tokens[2]
            status = {token.upper() for token in tokens[3:]}
            unit_key = unit if unit else ftype
            if unit_key in units and units[unit_key]["filename"] != filename:
                finding("LEGACY_UNIT_DUPLICATE","The selected legacy namefile maps one unit to different original files.",path=legacy,line=lineno,unit=unit)
                continue
            units[unit_key] = {"filename":filename,"type":ftype,"status":sorted(status),"line":lineno}
            if ftype == "LIST":
                add("mf2005",legacy,lineno,filename,legacy_base,role="output",unit=unit)
            elif ftype.startswith("DATA"):
                if "REPLACE" in status or "NEW" in status:
                    add("mf2005",legacy,lineno,filename,legacy_base,role="output",unit=unit)
                elif "OLD" in status:
                    add("mf2005",legacy,lineno,filename,legacy_base,kind="data",unit=unit)
                # DATA with unspecified access remains a unit declaration.
                # It becomes required if an actual EXTERNAL input uses it.
            else:
                add("mf2005",legacy,lineno,filename,legacy_base,unit=unit)

    while pending:
        engine, name, kind, base, current_unit = pending.pop(0)
        key = (engine,name,kind,current_unit)
        if key in visited:
            continue
        visited.add(key)
        block = None
        for lineno,line in lines(name):
            tokens = _tokens(line)
            if not tokens:
                continue
            upper = [token.upper() for token in tokens]
            if engine == "mf6" and kind in ("simulation_namefile","model_namefile"):
                if upper[0] == "BEGIN":
                    block = upper[1] if len(upper)>1 else None
                    continue
                if upper[0] == "END":
                    block = None
                    continue
                accepted = {"TIMING","MODELS","EXCHANGES","SOLUTIONGROUP"} if kind=="simulation_namefile" else {"PACKAGES"}
                if block in accepted:
                    if block=="SOLUTIONGROUP" and upper[0]=="MXITER":
                        continue
                    if len(tokens)<2 or not re.fullmatch(r"[A-Z][A-Z0-9-]*6",upper[0]):
                        finding("MF6_NAMEFILE","Selected MF6 input block requires native file type and original filename.",path=name,line=lineno,block=block,record=line)
                    else:
                        next_kind = "model_namefile" if block=="MODELS" else "package"
                        add(engine,name,lineno,tokens[1],base,kind=next_kind)
                    continue
                if kind=="model_namefile" and block=="OPTIONS" and upper[0]=="LIST":
                    if len(tokens)>1:
                        add(engine,name,lineno,tokens[1],base,role="output")
                    continue
            # Only reachable control files are scanned. Listing text, generated
            # output and unrelated .nam files are retained without this grammar.
            for index, keyword in enumerate(upper[:-1]):
                if keyword == "FILEOUT":
                    add(engine,name,lineno,tokens[index+1],base,role="output")
                elif keyword == "FILEIN":
                    add(engine,name,lineno,tokens[index+1],base)
                elif keyword == "OPEN/CLOSE":
                    add(engine,name,lineno,tokens[index+1],base,kind="data")
            if engine == "mf2005" and upper[0] == "EXTERNAL":
                if len(tokens)<2 or not re.fullmatch(r"[+-]?\d+",tokens[1]):
                    finding("UNIT","Legacy EXTERNAL requires an integer original unit.",path=name,line=lineno,record=line)
                    continue
                unit = abs(int(tokens[1]))
                mapping = units.get(unit)
                if mapping is None:
                    finding("UNIT","Legacy EXTERNAL unit has no selected original namefile mapping.",path=name,line=lineno,unit=unit)
                elif "REPLACE" in mapping["status"] or "NEW" in mapping["status"] or mapping["type"]=="LIST":
                    finding("UNIT_OUTPUT","Legacy EXTERNAL input refers to a declared output unit.",path=name,line=lineno,unit=unit)
                else:
                    add(engine,name,lineno,mapping["filename"],base,kind="data",unit=unit)
            # Fixed-format array LOCAT fields require native package context to
            # distinguish internal records. Do not declare such references
            # resolved from a guess about arbitrary numeric model data.
            if engine=="mf2005" and len(line)>=40:
                locat, factor, fmt = line[:10].strip(),line[10:20].strip(),line[20:40].strip()
                if re.fullmatch(r"[+-]?\d+",locat) and re.fullmatch(r"[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[EDed][+-]?\d+)?",factor) and fmt.startswith("("):
                    value = int(locat)
                    if value and (value<0 or abs(value)!=current_unit):
                        finding("FIXED_FORMAT_UNINSPECTED","A legacy fixed-format LOCAT array control requires native package-aware inspection; reference completeness is unresolved.",path=name,line=lineno,locat=value,current_unit=current_unit,record=line)

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
    profile = {"adapter":"native_package","mf6_namefile":mf6,"legacy_namefile":legacy,
               "layer_mapping":mapping,"intended_units":selected.get("intended_units"),
               "file_references":refs,"coordinates":{"kind":"model_local","crs":None},
               "reference_scope":{"input_files":sorted(input_paths),"declared_output_files":sorted(output_paths),
                                  "untraversed_original_files":sorted(names-input_paths),
                                  "literal_inputs_resolved":not any(row.get("severity")=="blocking" for row in findings),
                                  "scope":"Selected MF6 block/control files and selected legacy package/unit inputs; all original members remain retained."}}
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
