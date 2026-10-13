"""One native argument mapping shared by execution and completed-stage assembly."""
from __future__ import annotations
from .model_selection import models


def build_native_arguments(selection, profile, paths, table, lulc):
    active = models(selection)
    common = {"dem_path": str(paths["DEM"]), "lulc_path": str(lulc),
              "watersheds_path": str(paths["model_domain"]),
              "biophysical_table_path": str(table), "results_suffix": "",
              "n_workers": -1}
    result = {}
    if "ndr" in active:
        result["ndr"] = {**common, **profile["ndr"], "calc_n": True, "calc_p": True,
                         "runoff_proxy_path": str(paths["PRECIPITATION"])}
    if "sdr" in active:
        result["sdr"] = {**common, **profile["sdr"],
                         "erosivity_path": str(paths["R_FACTOR"]),
                         "erodibility_path": str(paths["K_FACTOR"]), "drainage_path": ""}
    return result
