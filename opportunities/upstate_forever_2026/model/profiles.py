"""Preserve actual biophysical tables and explicit native algorithm parameters."""
from __future__ import annotations
import csv
import io
from .common import finite
from .model_selection import models as normalize_models, required_table_fields, selected

NDR_KEYS = {"threshold_flow_accumulation", "k_param", "flow_dir_algorithm",
            "subsurface_critical_length_n", "subsurface_eff_n", "runoff_proxy_av"}
SDR_KEYS = {"threshold_flow_accumulation", "k_param", "flow_dir_algorithm",
            "sdr_max", "ic_0_param", "l_max"}
TABLE_FIELDS = ("lucode", "load_n", "load_p", "load_type_n", "load_type_p",
                "eff_n", "eff_p", "crit_len_n", "crit_len_p",
                "proportion_subsurface_n", "usle_c", "usle_p")

def inspect_table(path, models=None, *, selected_models=None):
    if models is not None and selected_models is not None and normalize_models(models) != normalize_models(selected_models):
        raise ValueError("The two model selections for the original table differ")
    active = normalize_models(selected_models if selected_models is not None else models)
    required = required_table_fields(active)
    with open(path, encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        fields = reader.fieldnames or []
        missing = sorted(set(required) - set(fields))
        if missing:
            raise ValueError("Biophysical CSV requires columns: " + ", ".join(missing))
        rows, seen = [], set()
        for line, row in enumerate(reader, 2):
            token = row["lucode"].strip()
            try:
                code = int(token)
            except ValueError as exc:
                raise ValueError("CSV line " + str(line) + " has a noninteger lucode") from exc
            if code in seen:
                raise ValueError("Duplicate biophysical lucode: " + str(code))
            seen.add(code)
            for name in ("load_n", "load_p", "eff_n", "eff_p", "crit_len_n",
                         "crit_len_p", "proportion_subsurface_n", "usle_c", "usle_p"):
                if name not in required:
                    continue
                x = finite(row[name], name, minimum=0)
                if name in ("eff_n", "eff_p", "proportion_subsurface_n", "usle_c", "usle_p") and x > 1:
                    raise ValueError(name + " must be between zero and one")
                if name in ("crit_len_n", "crit_len_p") and x <= 0:
                    raise ValueError(name + " must be positive")
            for name in ("load_type_n", "load_type_p"):
                if name not in required:
                    continue
                if row[name].strip() not in ("application-rate", "measured-runoff"):
                    raise ValueError(name + " must state application-rate or measured-runoff")
            rows.append(row)
    if not rows:
        raise ValueError("The biophysical CSV is empty")
    return {"columns": fields, "rows": rows, "lucodes": sorted(seen)}

def checked_parameters(profile):
    if not isinstance(profile.get("title"), str) or not profile["title"].strip():
        raise ValueError("Name the parameter profile")
    if not profile.get("references"):
        raise ValueError("Supply the source references for this parameter profile")
    result = {}
    active = selected(profile)
    for model, allowed, optional in (("ndr", NDR_KEYS, {"runoff_proxy_av"}),
                                     ("sdr", SDR_KEYS, set())):
        if model not in active:
            continue
        values = profile.get(model, {})
        if not isinstance(values, dict):
            raise ValueError(model.upper() + " parameters must be an object")
        if set(values) - allowed:
            raise ValueError("Unsupported " + model + " parameters: " + ", ".join(sorted(set(values) - allowed)))
        missing = allowed - optional - set(values)
        if missing:
            raise ValueError("Supply " + model + " parameters: " + ", ".join(sorted(missing)))
        out = dict(values)
        if out["flow_dir_algorithm"] not in ("mfd", "d8"):
            raise ValueError("Native flow_dir_algorithm must be mfd or d8")
        for name in allowed - {"flow_dir_algorithm"}:
            if name not in out:
                continue
            positive = name in ("threshold_flow_accumulation", "k_param",
                                "subsurface_critical_length_n", "l_max", "runoff_proxy_av")
            out[name] = finite(out[name], model + "." + name, positive=positive)
        for name in ("subsurface_eff_n", "sdr_max"):
            if name in out and not 0 <= out[name] <= 1:
                raise ValueError(model + "." + name + " must be between zero and one")
        result[model] = out
    return result

def scenario_spec(value):
    if not value.get("title") or not value.get("reason"):
        raise ValueError("Name the scenario and explain the actual land-cover assumptions")
    kind = value.get("kind")
    if kind not in ("baseline", "landcover"):
        raise ValueError("Scenario kind must be baseline or landcover")
    patches = value.get("patches", [])
    if kind == "baseline" and patches:
        raise ValueError("The baseline uses the original land-cover edition")
    if kind == "landcover" and not patches:
        raise ValueError("Add the actual proposed land-cover changes")
    for patch in patches:
        if not patch.get("mask_source_id"):
            raise ValueError("Select a retained vector or aligned binary raster mask for each scenario area")
        if type(patch.get("to_code")) is not int:
            raise ValueError("Each scenario destination must be an integer land-cover code")
        if not isinstance(patch.get("from_codes"), list) or not patch["from_codes"] or any(type(x) is not int for x in patch["from_codes"]):
            raise ValueError("List the original land-cover codes affected by each change")
        if not patch.get("reason"):
            raise ValueError("Explain each mapped land-cover change")
    return value
