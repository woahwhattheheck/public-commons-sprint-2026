"""Portable, explicit value encoding. No pickle and no lossy CSV result storage."""
from __future__ import annotations
import base64
import datetime as dt
import decimal
import json
import math
from pathlib import Path
from typing import Any

TAG = "__ecsa_value_v1__"

def pack(value: Any) -> Any:
    import numpy as np
    import pandas as pd
    if value is pd.NA:
        return {TAG: "NA"}
    if value is pd.NaT:
        return {TAG: "NaT"}
    if isinstance(value, pd.DataFrame):
        geo = hasattr(value, "geometry") and hasattr(value, "crs")
        geometry_name = value.geometry.name if geo else None
        dtypes = []
        for i in range(len(value.columns)):
            series = value.iloc[:, i]
            dtype = str(series.dtype)
            info = {"dtype": dtype}
            if dtype == "category":
                info.update(categories=pack(series.cat.categories.tolist()), ordered=series.cat.ordered)
            dtypes.append(info)
        return {TAG: "GeoDataFrame" if geo else "DataFrame",
                "columns": pack(value.columns), "index": pack(value.index),
                "rows": [[pack(x) for x in row] for row in value.itertuples(index=False, name=None)],
                "dtypes": dtypes, "attrs": pack(value.attrs),
                "geometry": geometry_name,
                "crs": value.crs.to_wkt() if geo and value.crs is not None else None}
    if isinstance(value, pd.MultiIndex):
        return {TAG: "MultiIndex", "values": pack(value.tolist()), "names": pack(value.names)}
    if isinstance(value, pd.RangeIndex):
        return {TAG: "RangeIndex", "start": value.start, "stop": value.stop,
                "step": value.step, "name": pack(value.name)}
    if isinstance(value, pd.Index):
        return {TAG: "Index", "values": pack(value.tolist()), "dtype": str(value.dtype),
                "name": pack(value.name)}
    if isinstance(value, np.ndarray):
        return {TAG: "ndarray", "dtype": str(value.dtype), "shape": list(value.shape),
                "values": pack(value.tolist())}
    if isinstance(value, np.generic):
        if isinstance(value, np.datetime64):
            return {TAG: "np_datetime64", "value": str(value), "dtype": str(value.dtype)}
        return pack(value.item())
    if isinstance(value, pd.Timestamp):
        return {TAG: "Timestamp", "value": value.isoformat()}
    if isinstance(value, pd.Timedelta):
        return {TAG: "Timedelta", "nanoseconds": value.value}
    if isinstance(value, dt.datetime):
        return {TAG: "datetime", "value": value.isoformat()}
    if isinstance(value, dt.date):
        return {TAG: "date", "value": value.isoformat()}
    if isinstance(value, decimal.Decimal):
        return {TAG: "decimal", "value": str(value)}
    if isinstance(value, Path):
        return {TAG: "path", "value": str(value)}
    if hasattr(value, "wkb_hex"):
        return {TAG: "geometry", "wkb_hex": value.wkb_hex}
    if isinstance(value, bytes):
        return {TAG: "bytes", "value": base64.b64encode(value).decode("ascii")}
    if isinstance(value, float) and not math.isfinite(value):
        return {TAG: "float", "value": "nan" if math.isnan(value) else "inf" if value > 0 else "-inf"}
    if isinstance(value, tuple):
        return {TAG: "tuple", "values": [pack(x) for x in value]}
    if isinstance(value, list):
        return [pack(x) for x in value]
    if isinstance(value, dict):
        # Represent mappings explicitly so model output cannot collide with the tag.
        return {TAG: "mapping", "items": [[pack(k), pack(v)] for k, v in value.items()]}
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    raise TypeError(f"Unsupported result value: {type(value).__name__}; add an explicit codec")

def unpack(value: Any) -> Any:
    if isinstance(value, list):
        return [unpack(x) for x in value]
    if not isinstance(value, dict) or TAG not in value:
        return value
    import pandas as pd
    import numpy as np
    kind = value[TAG]
    if kind == "mapping": return {unpack(k): unpack(v) for k, v in value["items"]}
    if kind == "tuple": return tuple(unpack(x) for x in value["values"])
    if kind == "NA": return pd.NA
    if kind == "NaT": return pd.NaT
    if kind == "float": return float(value["value"])
    if kind == "Timestamp": return pd.Timestamp(value["value"])
    if kind == "Timedelta": return pd.Timedelta(value["nanoseconds"], unit="ns")
    if kind == "datetime": return dt.datetime.fromisoformat(value["value"])
    if kind == "date": return dt.date.fromisoformat(value["value"])
    if kind == "decimal": return decimal.Decimal(value["value"])
    if kind == "path": return Path(value["value"])
    if kind == "bytes": return base64.b64decode(value["value"], validate=True)
    if kind == "geometry":
        from shapely import wkb
        return wkb.loads(value["wkb_hex"], hex=True)
    if kind == "RangeIndex":
        return pd.RangeIndex(value["start"], value["stop"], value["step"], name=unpack(value["name"]))
    if kind == "Index":
        return pd.Index(unpack(value["values"]), dtype=value["dtype"], name=unpack(value["name"]))
    if kind == "MultiIndex":
        return pd.MultiIndex.from_tuples(unpack(value["values"]), names=unpack(value["names"]))
    if kind == "ndarray":
        return np.array(unpack(value["values"]), dtype=value["dtype"]).reshape(value["shape"])
    if kind == "np_datetime64": return np.array(value["value"], dtype=value["dtype"])[()]
    if kind in ("DataFrame", "GeoDataFrame"):
        rows = [[unpack(x) for x in row] for row in value["rows"]]
        columns = unpack(value["columns"])
        frame = pd.DataFrame(rows, columns=columns, index=unpack(value["index"]))
        for i, info in enumerate(value["dtypes"]):
            if info["dtype"] == "geometry": continue
            dtype = (pd.CategoricalDtype(unpack(info["categories"]), ordered=info["ordered"])
                     if info["dtype"] == "category" else info["dtype"])
            frame.isetitem(i, frame.iloc[:, i].astype(dtype))
        if kind == "GeoDataFrame":
            import geopandas as gpd
            frame = gpd.GeoDataFrame(frame, geometry=value["geometry"], crs=value["crs"])
        frame.attrs = unpack(value["attrs"])
        return frame
    raise ValueError(f"Unknown ECSA value type {kind!r}")

def dumps(value: Any) -> bytes:
    return json.dumps(pack(value), sort_keys=True, separators=(",", ":"), ensure_ascii=False,
                      allow_nan=False).encode("utf-8")

def loads(data: bytes) -> Any:
    return unpack(json.loads(data.decode("utf-8")))
