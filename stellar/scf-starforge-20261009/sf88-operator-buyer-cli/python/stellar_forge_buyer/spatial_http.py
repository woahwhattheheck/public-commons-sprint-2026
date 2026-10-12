"""GIS routes carried by the original private DuckDB operator."""
from __future__ import annotations

from .duckdb_spatial import DuckDBSpatial
from .errors import StateError


def spatial(operator):
    if not hasattr(operator,"_spatial"):
        operator._spatial = DuckDBSpatial(operator.workspace,extension_path=operator.spatial_extension)
    return operator._spatial


def get(operator,path):
    from .duckdb_http import _identifier
    parts = path.strip("/").split("/")
    gis = spatial(operator)
    if path=="/api/spatial/state": return gis.status()
    if len(parts)==4 and parts[2] in {"layers","reviews","queries"}:
        identity = _identifier(parts[3])
        key = {"layers":"layer_id","reviews":"review_id","queries":"query_id"}[parts[2]]
        record = next((r for r in gis.status()[parts[2]] if r[key]==identity),None)
        if record is not None: return record
    raise StateError("DUCKDB_SPATIAL_ROUTE_NOT_FOUND")


def validate_export(body):
    from .duckdb_http import _fields,_identifier,_integer
    _fields(body,("query_id","expected_revision","request_id"),("geometry_column","target_crs","expected_bindings"))
    _identifier(body["query_id"])
    _integer(body["expected_revision"],"revision",1)


def export(operator,body,destination):
    return spatial(operator).export_query(body["query_id"],destination,expected_revision=body["expected_revision"],
        geometry_column=body.get("geometry_column","geometry"),target_crs=body.get("target_crs"),
        expected_bindings=body.get("expected_bindings"))


def perform(operator,path,body):
    from .duckdb_http import _fields,_integer
    gis = spatial(operator)
    if path=="/api/spatial/runtime":
        _fields(body)
        return gis.runtime()
    if path=="/api/spatial/reviews":
        _fields(body,("edition_id","geometry_column","source_format","crs"),
                ("spatial_reference_column","geometry_type","keys","geometry_name"))
        return gis.review_layer(**body)
    if path=="/api/spatial/adopt":
        _fields(body,("review_id",))
        return gis.adopt_layer(body["review_id"])
    if path=="/api/spatial/activate":
        _fields(body,("name","layer_id","expected_revision"))
        return gis.activate(body["name"],body["layer_id"],expected_revision=_integer(body["expected_revision"],"revision"))
    if path=="/api/spatial/preview":
        _fields(body,("layer_id",),("max_rows",))
        return gis.preview(body["layer_id"],max_rows=_integer(body.get("max_rows",100),"max_rows",1,1000))
    if path=="/api/spatial/query":
        _fields(body,("sql",),("parameters","max_rows","expected_bindings"))
        return gis.query(body["sql"],body.get("parameters",[]),max_rows=_integer(body.get("max_rows",200),"max_rows",1,10000),
                         expected_bindings=body.get("expected_bindings"))
    if path=="/api/spatial/queries":
        _fields(body,("name","sql"),("parameters","expected_revision"))
        return gis.save_query(body["name"],body["sql"],body.get("parameters",[]),
                              expected_revision=_integer(body.get("expected_revision",0),"revision"))
    if path=="/api/spatial/exports":
        return operator._retained_action(path,body)
    raise StateError("DUCKDB_SPATIAL_ROUTE_NOT_FOUND")
