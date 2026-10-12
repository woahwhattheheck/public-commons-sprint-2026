"""Reviewed GIS layers and portable native GIS exports in a customer warehouse."""
from __future__ import annotations

from collections import Counter
from contextlib import contextmanager
import json
import math
import os
from pathlib import Path
import re
import sqlite3
import struct
import tempfile

from .duckdb_dataset import (_descriptor, _hex, _json, _name, _new_destination,
    _now, _parquet_result, _qid, _wire)
from .errors import StateError
from .storage import digest, dump, lock, parse, private_directory, read, sync_directory

SCHEMA = "stellar-forge.sf100.duckdb-spatial.v1"
_FORMATS = {"esri-json", "geojson", "wkt", "wkb-hex"}
_ESRI = {"esriGeometryPoint", "esriGeometryMultipoint", "esriGeometryPolyline", "esriGeometryPolygon"}
_MAX_JSON = 64 * 1024 * 1024


def _literal(value):
    return "'" + str(value).replace("'", "''") + "'"


def _geometry(value):
    if value is None:
        return None
    result = parse(value.encode()) if isinstance(value, str) else value
    if not isinstance(result, dict):
        raise StateError("DUCKDB_SPATIAL_GEOMETRY_OBJECT_REQUIRED")
    return result


def _points(value):
    """Read original XY coordinates without changing order, rings or precision."""
    if isinstance(value, dict):
        if any(key in value for key in ("curveRings", "curvePaths", "z", "m")):
            raise StateError("DUCKDB_SPATIAL_LINEAR_XY_SOURCE_REQUIRED")
        if "x" in value or "y" in value:
            if value.get("x") is None and value.get("y") is None:
                return []
            value = [value["x"], value["y"]]
        else:
            value = next((value[key] for key in ("rings", "paths", "points", "coordinates") if key in value), [])
    if not isinstance(value, (tuple, list)):
        raise StateError("DUCKDB_SPATIAL_COORDINATES_INVALID")
    if not value:
        return []
    if isinstance(value[0], (int, float)):
        if len(value) != 2 or any(type(x) not in (int, float) or not math.isfinite(x) for x in value):
            raise StateError("DUCKDB_SPATIAL_LINEAR_XY_SOURCE_REQUIRED")
        return [tuple(float(x) for x in value)]
    return [point for child in value for point in _points(child)]


def _wkb_points(value):
    """Independent WKB coordinate inventory, including polygon holes."""
    if value is None:
        return []
    data, offset, points = memoryview(value), 0, []
    def take(fmt):
        nonlocal offset
        size = struct.calcsize(fmt)
        if offset + size > len(data):
            raise StateError("DUCKDB_SPATIAL_WKB_INVALID")
        result = struct.unpack_from(fmt, data, offset)
        offset += size
        return result
    def geometry():
        order = take("B")[0]
        if order not in (0,1):
            raise StateError("DUCKDB_SPATIAL_WKB_INVALID")
        endian = "<" if order == 1 else ">"
        kind = take(endian + "I")[0]
        if kind & 0xE0000000 or kind >= 1000:
            raise StateError("DUCKDB_SPATIAL_LINEAR_XY_SOURCE_REQUIRED")
        def point():
            x, y = take(endian + "dd")
            if math.isnan(x) and math.isnan(y):
                return
            if not math.isfinite(x) or not math.isfinite(y):
                raise StateError("DUCKDB_SPATIAL_COORDINATES_INVALID")
            points.append((x, y))
        if kind == 1:
            point()
        elif kind == 2:
            for _ in range(take(endian + "I")[0]): point()
        elif kind == 3:
            for _ in range(take(endian + "I")[0]):
                for _ in range(take(endian + "I")[0]): point()
        elif kind in (4,5,6,7):
            for _ in range(take(endian + "I")[0]): geometry()
        else:
            raise StateError("DUCKDB_SPATIAL_WKB_INVALID")
    geometry()
    if offset != len(data):
        raise StateError("DUCKDB_SPATIAL_WKB_TRAILING_BYTES")
    return points


def _sync(path):
    os.chmod(path, 0o600)
    with open(path, "rb") as stream:
        os.fsync(stream.fileno())


def _verify_file(path, expected):
    actual = _descriptor(path)
    if (actual["bytes"], actual["sha256"]) != (expected.get("bytes"), expected.get("sha256")):
        raise StateError("DUCKDB_SPATIAL_RETAINED_FILE_CHANGED")


def _source_crs(reference):
    if reference is None:
        return None
    value = _geometry(reference)
    if "latestWkid" in value or "wkid" in value:
        code = value.get("latestWkid", value.get("wkid"))
        if type(code) is not int or code < 1:
            raise StateError("DUCKDB_SPATIAL_SOURCE_CRS_INVALID")
        return "EPSG:" + str(code)
    return value.get("wkt2") or value.get("wkt")


class DuckDBSpatial:
    """A GIS catalogue over immutable original editions; WKB remains in this DB."""

    def __init__(self, workspace, *, extension_path=None):
        self.workspace = workspace
        self.directory = workspace.directory
        configured = extension_path or os.environ.get("STARFORGE_DUCKDB_SPATIAL_EXTENSION")
        self.extension = str(Path(configured).expanduser().resolve(strict=True)) if configured else "spatial"
        with workspace._guard(), workspace._connection(writeable=True) as db:
            db.execute("BEGIN")
            try:
                db.execute("CREATE TABLE IF NOT EXISTS sf_spatial_reviews(id VARCHAR PRIMARY KEY,record VARCHAR NOT NULL)")
                db.execute("CREATE TABLE IF NOT EXISTS sf_spatial_features(review_id VARCHAR,sf_row BIGINT,wkb BLOB,raw_sha256 VARCHAR,PRIMARY KEY(review_id,sf_row))")
                db.execute("CREATE TABLE IF NOT EXISTS sf_spatial_layers(id VARCHAR PRIMARY KEY,record VARCHAR NOT NULL)")
                db.execute("CREATE TABLE IF NOT EXISTS sf_spatial_views(name VARCHAR PRIMARY KEY,layer_id VARCHAR,revision BIGINT)")
                db.execute("CREATE TABLE IF NOT EXISTS sf_spatial_view_history(name VARCHAR,revision BIGINT,record VARCHAR,PRIMARY KEY(name,revision))")
                db.execute("CREATE TABLE IF NOT EXISTS sf_spatial_queries(id VARCHAR PRIMARY KEY,name VARCHAR UNIQUE,revision BIGINT,record VARCHAR)")
                db.execute("CREATE TABLE IF NOT EXISTS sf_spatial_query_history(id VARCHAR,revision BIGINT,record VARCHAR,PRIMARY KEY(id,revision))")
                db.commit()
            except BaseException:
                db.rollback()
                raise

    @contextmanager
    def _connection(self, *, writeable=False, allowed_paths=(), bind=False):
        with self.workspace._connection(writeable=writeable, allowed_paths=allowed_paths,
                                         spatial_extension=self.extension) as db:
            if bind:
                self._bind(db)
            yield db

    def _bindings(self, db):
        return {"views": self.workspace._views(db),
                "layers": [{"name": n, "layer_id": i, "revision": r} for n,i,r in
                           db.execute("SELECT name,layer_id,revision FROM sf_spatial_views ORDER BY name").fetchall()],
                "available_layers": [row[0] for row in db.execute("SELECT id FROM sf_spatial_layers ORDER BY id").fetchall()]}

    def _bind(self, db):
        for raw, in db.execute("SELECT record FROM sf_spatial_layers ORDER BY id").fetchall():
            layer = parse(raw.encode())
            edition = self.workspace._record(db, "sf_editions", layer["edition_id"])
            sql = ("SELECT e.*, ST_SetCRS(ST_GeomFromWKB(f.wkb)," + _literal(layer["crs"])
                   + ") AS " + _qid(layer["geometry_name"]) + " FROM " + _qid(edition["table"])
                   + " e JOIN sf_spatial_features f ON e.sf_row=f.sf_row AND f.review_id="
                   + _literal(layer["review_id"]))
            db.execute("CREATE TEMP VIEW " + _qid(layer["table"]) + " AS " + sql)
        for name,identity in db.execute("SELECT name,layer_id FROM sf_spatial_views").fetchall():
            layer = self.workspace._record(db, "sf_spatial_layers", identity)
            db.execute("CREATE TEMP VIEW " + _qid(name) + " AS SELECT * FROM " + _qid(layer["table"]))

    def status(self):
        with self.workspace._guard(), self.workspace._connection() as db:
            records = lambda table: [parse(row[0].encode()) for row in db.execute("SELECT record FROM " + table + " ORDER BY id").fetchall()]
            return {"schema": SCHEMA, "runtime": {"extension": self.extension, "required_duckdb": "1.5.6"},
                    "reviews": records("sf_spatial_reviews"), "layers": records("sf_spatial_layers"),
                    "queries": records("sf_spatial_queries"), "bindings": self._bindings(db)}

    def runtime(self):
        with self.workspace._guard(), self._connection() as db:
            result = db.execute("SELECT * FROM ST_Drivers()")
            drivers = [dict(zip([d[0] for d in result.description], row)) for row in result.fetchall()]
            missing = {name for name in ("ESRIJSON","GPKG") if not any(d.get("short_name") == name for d in drivers)}
            if missing:
                raise StateError("DUCKDB_SPATIAL_GDAL_DRIVERS_REQUIRED")
            return {"schema": SCHEMA + ".runtime", "duckdb": self.workspace.duckdb.__version__,
                    "extension": self.extension, "geometry_always_xy": True, "drivers": drivers,
                    "extension_file": _descriptor(Path(self.extension)) if self.extension != "spatial" else None}

    @staticmethod
    def _check_crs(db, value):
        if not isinstance(value, str) or not value.strip() or len(value.encode()) > 32768:
            raise StateError("DUCKDB_SPATIAL_EXPLICIT_CRS_REQUIRED")
        value = value.strip()
        db.execute("SELECT ST_CRS(ST_SetCRS(ST_Point(0,0)," + _literal(value) + "))").fetchone()
        return value

    def review_layer(self, edition_id, *, geometry_column, source_format, crs,
                     spatial_reference_column=None, geometry_type=None, keys=None,
                     geometry_name="geometry"):
        edition_id = _hex(edition_id)
        if source_format not in _FORMATS:
            raise StateError("DUCKDB_SPATIAL_SOURCE_FORMAT_INVALID")
        _qid(geometry_column)
        _name(geometry_name)
        crs = crs.strip() if isinstance(crs, str) else crs
        if source_format == "esri-json" and geometry_type not in _ESRI:
            raise StateError("DUCKDB_SPATIAL_ESRI_GEOMETRY_TYPE_REQUIRED")
        with self.workspace._guard():
            with self.workspace._connection() as db:
                edition = self.workspace._record(db, "sf_editions", edition_id)
                names = [column["name"] for column in edition["columns"]]
                if geometry_column not in names or geometry_name.casefold() in {n.casefold() for n in names + ["sf_row"]}:
                    raise StateError("DUCKDB_SPATIAL_GEOMETRY_COLUMN_INVALID")
                if spatial_reference_column is not None and spatial_reference_column not in names:
                    raise StateError("DUCKDB_SPATIAL_SOURCE_CRS_COLUMN_INVALID")
                keys = edition["keys"] if keys is None else keys
                if not isinstance(keys,list) or not keys or len(set(keys)) != len(keys) or any(k not in names for k in keys):
                    raise StateError("DUCKDB_SPATIAL_REVIEWED_KEYS_REQUIRED")
                reference = _qid(spatial_reference_column) if spatial_reference_column else "NULL"
                source = db.execute("SELECT sf_row," + _qid(geometry_column) + "," + reference
                                    + " FROM " + _qid(edition["table"]) + " ORDER BY sf_row").fetchall()
                qkeys = ",".join(map(_qid,keys))
                if db.execute("SELECT 1 FROM " + _qid(edition["table"]) + " WHERE "
                              + " OR ".join(_qid(k) + " IS NULL" for k in keys) + " LIMIT 1").fetchone():
                    raise StateError("DUCKDB_SPATIAL_NULL_KEY")
                if db.execute("SELECT 1 FROM " + _qid(edition["table"]) + " GROUP BY " + qkeys + " HAVING count(*)>1 LIMIT 1").fetchone():
                    raise StateError("DUCKDB_SPATIAL_NONUNIQUE_KEY")
            reference_values = sorted({_json(_geometry(row[2])) for row in source if row[2] is not None})
            if len(reference_values) > 1:
                raise StateError("DUCKDB_SPATIAL_MIXED_SOURCE_CRS")
            source_reference = parse(reference_values[0].encode()) if reference_values else None
            derived_crs = _source_crs(source_reference)
            if derived_crs is not None and derived_crs != crs:
                raise StateError("DUCKDB_SPATIAL_REVIEW_CRS_DIFFERS_FROM_SOURCE")
            with tempfile.TemporaryDirectory(prefix="spatial-review-", dir=self.directory) as temporary:
                file = Path(temporary) / "source.esrijson"
                if source_format == "esri-json":
                    features = []
                    for rowid,raw,_ in source:
                        geometry = _geometry(raw)
                        if geometry is not None: _points(geometry)
                        features.append({"attributes":{"sf_row":rowid},"geometry":geometry})
                    feature_set = {"geometryType":geometry_type,"hasZ":False,"hasM":False,
                                   "fields":[{"name":"sf_row","type":"esriFieldTypeInteger"}],"features":features}
                    if source_reference is not None:
                        feature_set["spatialReference"] = source_reference
                    elif re.fullmatch(r"EPSG:[1-9][0-9]*",crs):
                        feature_set["spatialReference"] = {"wkid":int(crs[5:])}
                    else:
                        feature_set["spatialReference"] = {"wkt":crs}
                    dump(file,feature_set,exclusive=True)
                with self._connection(writeable=True,allowed_paths=[file] if file.exists() else []) as db:
                    crs = self._check_crs(db,crs)
                    if not source:
                        converted = {}
                    elif source_format == "esri-json":
                        converted = dict(db.execute(
                            "SELECT sf_row,CAST(wkb_geometry AS BLOB) FROM ST_Read(?,keep_wkb:=true,allowed_drivers:=['ESRIJSON'])",
                            [str(file)]).fetchall())
                    else:
                        function = {"geojson":"ST_GeomFromGeoJSON(?)","wkt":"ST_GeomFromText(?)",
                                    "wkb-hex":"ST_GeomFromWKB(from_hex(?))"}[source_format]
                        converted = {rowid:db.execute("SELECT ST_AsWKB(" + function + ")",[raw]).fetchone()[0]
                                     for rowid,raw,_ in source}
                    if set(converted) != {r[0] for r in source}:
                        raise StateError("DUCKDB_SPATIAL_SOURCE_ROW_SET_CHANGED")
                    features,states,coordinate_count = [],{"null":0,"empty":0,"valid":0,"invalid":0},0
                    extent,geometry_types = None,set()
                    for rowid,raw,_ in source:
                        wkb = converted[rowid]
                        source_points = _points(_geometry(raw)) if source_format in {"esri-json","geojson"} and raw is not None else None
                        native_points = _wkb_points(wkb)
                        if source_points is not None and Counter(source_points) != Counter(native_points):
                            raise StateError("DUCKDB_SPATIAL_SOURCE_COORDINATES_CHANGED")
                        if (raw is None) != (wkb is None):
                            raise StateError("DUCKDB_SPATIAL_SOURCE_NULL_STATE_CHANGED")
                        coordinate_count += len(native_points)
                        raw_bytes = raw.encode() if isinstance(raw,str) else _json(raw).encode()
                        features.append((rowid,wkb,digest(raw_bytes)))
                        if wkb is None:
                            states["null"] += 1
                            continue
                        empty,valid,kind = db.execute(
                            "SELECT ST_IsEmpty(g),ST_IsValid(g),CAST(ST_GeometryType(g) AS VARCHAR) FROM (SELECT ST_GeomFromWKB(?) g)",
                            [wkb]).fetchone()
                        states["empty" if empty else "valid" if valid else "invalid"] += 1
                        geometry_types.add(kind)
                        for x,y in native_points:
                            extent = [x,y,x,y] if extent is None else [min(extent[0],x),min(extent[1],y),max(extent[2],x),max(extent[3],y)]
                    coordinate_sha = digest(_json([{"sf_row":rowid,"raw_sha256":sha,
                                                   "wkb_sha256":digest(wkb) if wkb is not None else None}
                                                  for rowid,wkb,sha in features]).encode())
                    identity = {"schema":SCHEMA+".layer-review","edition_id":edition_id,
                                "source_manifest_sha256":edition.get("manifest_sha256"),
                                "geometry_column":geometry_column,"source_format":source_format,
                                "geometry_type":geometry_type,"spatial_reference_column":spatial_reference_column,
                                "source_spatial_reference":source_reference,"crs":crs,
                                "geometry_name":geometry_name,"keys":keys,"coordinate_binding_sha256":coordinate_sha}
                    review_id = digest(_json(identity).encode())
                    existing = db.execute("SELECT record FROM sf_spatial_reviews WHERE id=?",[review_id]).fetchone()
                    if existing: return parse(existing[0].encode())
                    record = {**identity,"review_id":review_id,"created_at":_now(),"row_count":len(source),
                              "coordinate_count":coordinate_count,"states":states,"geometry_types":sorted(geometry_types),
                              "extent":extent,"dimension":"XY","transformation":None}
                    db.execute("BEGIN")
                    try:
                        db.execute("INSERT INTO sf_spatial_reviews VALUES(?,?)",[review_id,_json(record)])
                        if features:
                            db.executemany("INSERT INTO sf_spatial_features VALUES(?,?,?,?)",[(review_id,*row) for row in features])
                        db.commit()
                    except BaseException:
                        db.rollback()
                        raise
                    return record

    def adopt_layer(self,review_id):
        review_id = _hex(review_id)
        with self.workspace._guard(),self.workspace._connection(writeable=True) as db:
            review = self.workspace._record(db,"sf_spatial_reviews",review_id)
            identity = digest((SCHEMA+".layer:"+review_id).encode())
            existing = db.execute("SELECT record FROM sf_spatial_layers WHERE id=?",[identity]).fetchone()
            if existing: return parse(existing[0].encode())
            record = {**review,"schema":SCHEMA+".layer","layer_id":identity,"table":"sf_layer_"+identity,"adopted_at":_now()}
            db.execute("INSERT INTO sf_spatial_layers VALUES(?,?)",[identity,_json(record)])
            return record

    def activate(self,name,layer_id,*,expected_revision):
        name,layer_id = _name(name),_hex(layer_id)
        if type(expected_revision) is not int or expected_revision < 0:
            raise StateError("DUCKDB_SPATIAL_REVISION_REQUIRED")
        with self.workspace._guard(),self.workspace._connection(writeable=True) as db:
            self.workspace._record(db,"sf_spatial_layers",layer_id)
            if db.execute("SELECT 1 FROM duckdb_tables() WHERE lower(table_name)=lower(?) UNION ALL "
                          "SELECT 1 FROM duckdb_views() WHERE lower(view_name)=lower(?)",[name,name]).fetchone():
                raise StateError("DUCKDB_SPATIAL_VIEW_NAME_ALREADY_USED")
            db.execute("BEGIN")
            try:
                current = db.execute("SELECT name,layer_id,revision FROM sf_spatial_views WHERE lower(name)=lower(?)",[name]).fetchone()
                if (current[2] if current else 0) != expected_revision:
                    raise StateError("DUCKDB_SPATIAL_ACTIVE_LAYER_CHANGED")
                if current and current[1] == layer_id:
                    db.commit()
                    return {"name":current[0],"layer_id":layer_id,"revision":current[2]}
                name = current[0] if current else name
                result = {"name":name,"layer_id":layer_id,"revision":expected_revision+1,"activated_at":_now()}
                db.execute("INSERT INTO sf_spatial_views VALUES(?,?,?) ON CONFLICT(name) DO UPDATE SET layer_id=excluded.layer_id,revision=excluded.revision",
                           [name,layer_id,result["revision"]])
                db.execute("INSERT INTO sf_spatial_view_history VALUES(?,?,?)",[name,result["revision"],_json(result)])
                db.commit()
                return result
            except BaseException:
                db.rollback()
                raise

    def query(self,sql,parameters=None,*,max_rows=200,expected_bindings=None):
        parameters = [] if parameters is None else parameters
        sql = self.workspace._sql(sql,parameters)
        if type(max_rows) is not int or not 1 <= max_rows <= 10000:
            raise StateError("DUCKDB_SPATIAL_PREVIEW_LIMIT_INVALID")
        with self.workspace._guard(),self._connection(bind=True) as db:
            bindings = self._bindings(db)
            if expected_bindings is not None and bindings != expected_bindings:
                raise StateError("DUCKDB_SPATIAL_QUERY_BINDINGS_CHANGED")
            result = db.execute(sql,parameters)
            columns = [{"name":c[0],"type":str(c[1])} for c in result.description]
            rows = result.fetchmany(max_rows+1)
            return {"columns":columns,"rows":_wire(rows[:max_rows]),"truncated":len(rows)>max_rows,"bindings":bindings}

    def preview(self,layer_id,*,max_rows=100):
        layer_id = _hex(layer_id)
        if type(max_rows) is not int or not 1 <= max_rows <= 1000:
            raise StateError("DUCKDB_SPATIAL_PREVIEW_LIMIT_INVALID")
        with self.workspace._guard(),self._connection(bind=True) as db:
            layer = self.workspace._record(db,"sf_spatial_layers",layer_id)
            geometry = _qid(layer["geometry_name"])
            result = db.execute("SELECT "+",".join(map(_qid,layer["keys"]))+",ST_AsGeoJSON("+geometry+") FROM "
                                +_qid(layer["table"])+" ORDER BY sf_row LIMIT ?",[max_rows+1]).fetchall()
            return {"layer":layer,"crs":layer["crs"],"extent":layer["extent"],"truncated":len(result)>max_rows,
                    "features":[{"key":_wire(row[:-1]),"geometry":parse(row[-1].encode()) if row[-1] else None}
                                for row in result[:max_rows]]}

    def save_query(self,name,sql,parameters=None,*,expected_revision=0):
        name = _name(name)
        parameters = [] if parameters is None else parameters
        sql = self.workspace._sql(sql,parameters)
        _json(parameters)
        if type(expected_revision) is not int or expected_revision < 0:
            raise StateError("DUCKDB_SPATIAL_QUERY_REVISION_REQUIRED")
        identity = digest((SCHEMA+":"+name.casefold()).encode())
        with self.workspace._guard(),self.workspace._connection(writeable=True) as db:
            current = db.execute("SELECT revision,record FROM sf_spatial_queries WHERE id=?",[identity]).fetchone()
            if (current[0] if current else 0) != expected_revision:
                raise StateError("DUCKDB_SPATIAL_SAVED_QUERY_CHANGED")
            previous = parse(current[1].encode()) if current else None
            if previous and previous["sql"] == sql and previous["parameters"] == parameters:
                return previous
            record = {"query_id":identity,"name":previous["name"] if previous else name,"revision":expected_revision+1,
                      "sql":sql,"parameters":parameters,"saved_at":_now(),"kind":"gis-query"}
            db.execute("BEGIN")
            try:
                db.execute("INSERT INTO sf_spatial_queries VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,record=excluded.record",
                           [identity,record["name"],record["revision"],_json(record)])
                db.execute("INSERT INTO sf_spatial_query_history VALUES(?,?,?)",[identity,record["revision"],_json(record)])
                db.commit()
                return record
            except BaseException:
                db.rollback()
                raise

    def _register_export(self,record):
        result = dict(record,files=list(record["files"]))
        result["files"].append(_descriptor(Path(record["directory"])/"manifest.json"))
        with self.workspace._guard(),self.workspace._connection(writeable=True) as db:
            db.execute("INSERT INTO sf_exports VALUES(?,?) ON CONFLICT(id) DO UPDATE SET record=excluded.record",
                       [result["export_id"],_json(result)])
        return result

    def export_query(self,query_id,destination,*,expected_revision,
                     geometry_column="geometry",target_crs=None,expected_bindings=None):
        query_id = _hex(query_id)
        _name(geometry_column)
        if type(expected_revision) is not int or expected_revision < 1:
            raise StateError("DUCKDB_SPATIAL_QUERY_REVISION_REQUIRED")
        target = _new_destination(destination,self.directory)
        with lock(target):
            request_file = target/"request.json"
            options = {"geometry_column":geometry_column,"target_crs":target_crs}
            if request_file.exists():
                request = parse(read(request_file,_MAX_JSON))
                if (request.get("schema") != SCHEMA+".query-export" or request.get("workspace") != str(self.directory)
                    or request.get("directory") != str(target) or request.get("options") != options
                    or request.get("query",{}).get("query_id") != query_id
                    or request.get("query",{}).get("revision") != expected_revision):
                    raise StateError("DUCKDB_SPATIAL_EXPORT_DESTINATION_CONFLICT")
                if expected_bindings is not None and expected_bindings != request["bindings"]:
                    raise StateError("DUCKDB_SPATIAL_EXPORT_BINDINGS_CONFLICT")
            else:
                if any(p.name != "operation.lock" for p in target.iterdir()):
                    raise StateError("DUCKDB_SPATIAL_EXPORT_DESTINATION_NOT_EMPTY")
                with self.workspace._guard(),self.workspace._connection() as db:
                    query = self.workspace._record(db,"sf_spatial_queries",query_id)
                    bindings = self._bindings(db)
                    layers = [parse(row[0].encode()) for row in db.execute("SELECT record FROM sf_spatial_layers ORDER BY id").fetchall()]
                if query["revision"] != expected_revision:
                    raise StateError("DUCKDB_SPATIAL_SAVED_QUERY_CHANGED")
                if expected_bindings is not None and bindings != expected_bindings:
                    raise StateError("DUCKDB_SPATIAL_QUERY_BINDINGS_CHANGED")
                identity = {"schema":SCHEMA+".query-export","kind":"gis-query","workspace":str(self.directory),
                            "directory":str(target),"query":query,"bindings":bindings,"layers":layers,"options":options}
                request = {**identity,"export_id":digest(_json(identity).encode()),"created_at":_now()}
                dump(request_file,request,exclusive=True)
            complete = target/"manifest.json"
            if complete.exists():
                record = parse(read(complete,_MAX_JSON))
                if record["export_id"] != request["export_id"]:
                    raise StateError("DUCKDB_SPATIAL_EXPORT_DESTINATION_CONFLICT")
                for file in record["files"]: _verify_file(target/file["name"],file)
                return self._register_export(record)
            parquet,partial = target/"result.parquet",target/"result.parquet.partial"
            execution_file = target/"execution.json"
            execution = parse(read(execution_file,_MAX_JSON)) if execution_file.exists() else None
            if execution and execution.get("export_id") != request["export_id"]:
                raise StateError("DUCKDB_SPATIAL_EXPORT_EXECUTION_CHANGED")
            def publish(part,final,descriptor):
                _verify_file(part,descriptor)
                os.rename(part,final)
                sync_directory(target)
            if not parquet.exists():
                if execution and execution.get("parquet"):
                    publish(partial,parquet,execution["parquet"])
                else:
                    if partial.exists():
                        partial.rename(target/("interrupted-"+_descriptor(partial)["sha256"]+".parquet"))
                    with self.workspace._guard(),self._connection(allowed_paths=[partial],bind=True) as db:
                        if self._bindings(db) != request["bindings"]:
                            raise StateError("DUCKDB_SPATIAL_QUERY_BINDINGS_CHANGED")
                        query = request["query"]
                        db.execute("CREATE TEMP TABLE sf_spatial_selected AS "+query["sql"],query["parameters"])
                        selected = [{"name":c[0],"type":str(c[1])} for c in db.execute("SELECT * FROM sf_spatial_selected LIMIT 0").description]
                        geometries = [c["name"] for c in selected if c["type"].startswith("GEOMETRY")]
                        if geometries != [geometry_column]:
                            raise StateError("DUCKDB_SPATIAL_ONE_SELECTED_GEOMETRY_REQUIRED")
                        g = _qid(geometry_column)
                        source_crs = db.execute("SELECT ST_CRS("+g+") FROM sf_spatial_selected LIMIT 1").fetchone()
                        if source_crs is None:
                            source_crs = db.execute("SELECT ST_CRS(CAST(NULL AS "+next(c["type"] for c in selected if c["name"]==geometry_column)+"))").fetchone()
                        source_crs = source_crs[0] if source_crs else None
                        if not source_crs:
                            raise StateError("DUCKDB_SPATIAL_QUERY_CRS_REQUIRED")
                        crs = self._check_crs(db,target_crs or source_crs)
                        projection = []
                        for column in selected:
                            name = _qid(column["name"])
                            projection.append(("ST_Transform("+name+","+_literal(crs)+") AS "+name)
                                              if column["name"]==geometry_column and crs!=source_crs else name)
                        db.execute("CREATE TEMP TABLE sf_export_result AS SELECT "+",".join(projection)+" FROM sf_spatial_selected")
                        rows = db.execute("SELECT count(*) FROM sf_export_result").fetchone()[0]
                        projection,columns,query_columns,encodings = _parquet_result(db)
                        db.execute("COPY (SELECT "+projection+" FROM sf_export_result) TO ? "
                                   "(FORMAT PARQUET,COMPRESSION ZSTD,GEOPARQUET_VERSION 'V1')",[str(partial)])
                        _sync(partial)
                        execution = {"export_id":request["export_id"],"rows":rows,"columns":columns,
                                     "query_columns":query_columns,"column_encodings":encodings,
                                     "geometry_column":geometry_column,"source_crs":source_crs,"crs":crs,
                                     "axis_order":"XY","transformation":{"source":source_crs,"target":crs} if crs!=source_crs else None,
                                     "parquet":_descriptor(partial,"result.parquet")}
                        execution["parquet"]["path"] = str(parquet)
                        dump(execution_file,execution)
                        publish(partial,parquet,execution["parquet"])
            if not execution:
                raise StateError("DUCKDB_SPATIAL_EXPORT_EXECUTION_MISSING")
            _verify_file(parquet,execution["parquet"])
            gpkg,part = target/"result.gpkg",target/"result.partial.gpkg"
            allowed = [parquet,part]+[Path(str(part)+suffix) for suffix in ("-journal","-wal","-shm")]
            with self.workspace._guard(),self._connection(allowed_paths=allowed) as db:
                if not gpkg.exists():
                    if execution.get("gpkg"):
                        publish(part,gpkg,execution["gpkg"])
                    else:
                        if part.exists():
                            part.rename(target/("interrupted-"+_descriptor(part)["sha256"]+".gpkg"))
                        projection,gpkg_columns = [],[]
                        for column in execution["columns"]:
                            name,kind = _qid(column["name"]),column["type"]
                            native = kind.startswith("GEOMETRY") or kind in {"BOOLEAN","TINYINT","SMALLINT","INTEGER","BIGINT","FLOAT","DOUBLE","VARCHAR","DATE","TIMESTAMP"}
                            projection.append(name if native else "CAST("+name+" AS VARCHAR) AS "+name)
                            gpkg_columns.append({"name":column["name"],"type":kind if native else "VARCHAR",
                                                 "encoding":"native" if native else "exact_text"})
                        fid = "sf_gis_fid"
                        while fid.casefold() in {c["name"].casefold() for c in gpkg_columns}: fid += "_"
                        sql = ("COPY (SELECT "+",".join(projection)+" FROM read_parquet($source)) TO $target "
                               "(FORMAT GDAL,DRIVER 'GPKG',LAYER_NAME 'features',SRS "+_literal(execution["crs"])
                               +",LAYER_CREATION_OPTIONS ['FID="+fid+"','GEOMETRY_NAME="+geometry_column+"','SPATIAL_INDEX=YES'])")
                        db.execute(sql,{"source":str(parquet),"target":str(part)})
                        _sync(part)
                        execution["gpkg_columns"],execution["gpkg_fid"] = gpkg_columns,fid
                        execution["gpkg"] = _descriptor(part,"result.gpkg")
                        execution["gpkg"]["path"] = str(gpkg)
                        dump(execution_file,execution)
                        publish(part,gpkg,execution["gpkg"])
            _verify_file(gpkg,execution["gpkg"])
            receiving = self.receive_files(target,execution=execution)
            receiving_file = target/"receiving.json"
            if receiving_file.exists():
                prior = parse(read(receiving_file,_MAX_JSON))
                if prior["result_binding"] != receiving["result_binding"]:
                    raise StateError("DUCKDB_SPATIAL_RECEIVING_CHANGED")
            else:
                dump(receiving_file,receiving,exclusive=True)
            source_editions = sorted({layer["edition_id"] for layer in request["layers"]})
            sources = []
            for edition_id in source_editions:
                record = self.workspace.export_source(edition_id,target/"source"/edition_id)
                for file in record["files"]:
                    path = Path(file["path"])
                    sources.append(_descriptor(path,path.relative_to(target).as_posix()))
            guide = target/"RECEIVING.md"
            if not guide.exists():
                guide.write_text(self._receiving_guide(execution),encoding="utf-8")
                _sync(guide)
            files = [_descriptor(path) for path in (parquet,gpkg,request_file,execution_file,receiving_file,guide)]+sources
            record = {**request,**{key:execution[key] for key in ("rows","columns","query_columns","column_encodings","geometry_column","source_crs","crs","axis_order","transformation","gpkg_columns","gpkg_fid")},
                      "state":"COMPLETE","completed_at":_now(),"files":files,
                      "source_editions":source_editions,"receiving":receiving}
            dump(complete,record,exclusive=True)
            return self._register_export(record)

    @staticmethod
    def _receiving_guide(execution):
        return ("# GIS receiving\n\nOpen result.gpkg, layer features, in QGIS or another GeoPackage reader. "
                "Open result.parquet in a GeoParquet reader. Both files retain the same complete query result.\n\n"
                "CRS: "+execution["crs"]+". Coordinate axis convention: X then Y. Geometry column: "
                +execution["geometry_column"]+".\n\n"
                "Exact source editions and original delivery files are under source/. Their original geometry JSON, "
                "spatial reference and raw attributes remain unchanged. request.json binds the original saved SQL "
                "revision and layer choices. execution.json records each native and portable field type. "
                "GeoPackage stores decimal, wide integer and nested values as exact text where native field types "
                "would lose information. Use query_columns when restoring the original SQL types.\n\n"
                "receiving.json was produced by a fresh native DuckDB/GDAL connection using only the exported files. "
                "It compares every attribute, null and geometry in both directions and checks embedded CRS metadata. "
                "A receiving worker can repeat: stellar-forge-duckdb --workspace NEW spatial receive DIRECTORY.\n")

    def receive_files(self,directory,*,execution=None):
        """Fresh independent GDAL/Parquet receiver: original tables are unavailable."""
        directory = private_directory(Path(directory),create=False)
        execution = execution or parse(read(directory/"execution.json",_MAX_JSON))
        parquet,gpkg = directory/"result.parquet",directory/"result.gpkg"
        for path,key in ((parquet,"parquet"),(gpkg,"gpkg")): _verify_file(path,execution[key])
        db = self.workspace.duckdb.connect(":memory:",config={"enable_external_access":"true",
            "autoinstall_known_extensions":"false","autoload_known_extensions":"false","allow_unsigned_extensions":"false",
            "threads":"1","memory_limit":self.workspace.memory_limit})
        try:
            db.execute("LOAD "+_literal(self.extension))
            db.execute("SET geometry_always_xy=true")
            db.execute("SET allowed_paths=["+",".join(_literal(p) for p in (parquet,gpkg))+"]")
            db.execute("SET enable_external_access=false")
            db.execute("SET lock_configuration=true")
            db.execute("CREATE TEMP VIEW source_parquet AS SELECT * FROM read_parquet("+_literal(parquet)+")")
            db.execute("CREATE TEMP VIEW source_gpkg AS SELECT * FROM ST_Read("+_literal(gpkg)+",keep_wkb:=true,allowed_drivers:=['GPKG'])")
            descriptions = {}
            for table in ("source_parquet","source_gpkg"):
                result = db.execute("SELECT * FROM "+table+" LIMIT 0")
                descriptions[table] = [{"name":c[0],"type":str(c[1])} for c in result.description]
            geometry = execution["geometry_column"]
            gpkg_names = {c["name"] for c in descriptions["source_gpkg"]}
            if "wkb_geometry" not in gpkg_names:
                raise StateError("DUCKDB_SPATIAL_RECEIVER_GPKG_GEOMETRY_MISSING")
            pselect,gselect = [],[]
            original = {c["name"]:c for c in execution["query_columns"]}
            for column in execution["columns"]:
                name = column["name"]
                if name == geometry:
                    pselect.append("ST_AsWKB("+_qid(name)+") AS "+_qid(name))
                    gselect.append("CAST(wkb_geometry AS BLOB) AS "+_qid(name))
                else:
                    if name not in gpkg_names:
                        raise StateError("DUCKDB_SPATIAL_RECEIVER_ATTRIBUTE_MISSING")
                    kind = original[name]["type"]
                    pselect.append("CAST("+_qid(name)+" AS "+kind+") AS "+_qid(name))
                    gselect.append("CAST("+_qid(name)+" AS "+kind+") AS "+_qid(name))
            psql,gsql = "SELECT "+",".join(pselect)+" FROM source_parquet","SELECT "+",".join(gselect)+" FROM source_gpkg"
            forward = db.execute("SELECT count(*) FROM (("+psql+") EXCEPT ALL ("+gsql+"))").fetchone()[0]
            reverse = db.execute("SELECT count(*) FROM (("+gsql+") EXCEPT ALL ("+psql+"))").fetchone()[0]
            counts = [db.execute("SELECT count(*) FROM "+table).fetchone()[0] for table in ("source_parquet","source_gpkg")]
            if forward or reverse or counts != [execution["rows"],execution["rows"]]:
                raise StateError("DUCKDB_SPATIAL_RECEIVER_ROWS_OR_GEOMETRY_CHANGED")
            metadata = db.execute("SELECT decode(value) FROM parquet_kv_metadata(?) WHERE decode(key)='geo'",[str(parquet)]).fetchone()
            geo = parse(metadata[0].encode()) if metadata else None
            if (not isinstance(geo,dict) or geo.get("primary_column") != geometry
                or geo.get("columns",{}).get(geometry,{}).get("encoding") != "WKB"):
                raise StateError("DUCKDB_SPATIAL_GEOPARQUET_METADATA_REQUIRED")
            gpkg_meta = db.execute("SELECT layers FROM ST_Read_Meta(?)",[str(gpkg)]).fetchone()
            with sqlite3.connect("file:"+str(gpkg)+"?mode=ro",uri=True) as connection:
                gpkg_crs = connection.execute("SELECT g.column_name,g.srs_id,s.organization,s.organization_coordsys_id,s.definition "
                                             "FROM gpkg_geometry_columns g JOIN gpkg_spatial_ref_sys s ON g.srs_id=s.srs_id "
                                             "WHERE g.table_name='features'").fetchall()
            if len(gpkg_crs)!=1 or gpkg_crs[0][0]!=geometry:
                raise StateError("DUCKDB_SPATIAL_GPKG_CRS_METADATA_REQUIRED")
            expected = execution["crs"].split(":")
            if len(expected)==2 and expected[0]=="EPSG":
                if (gpkg_crs[0][2],str(gpkg_crs[0][3])) != tuple(expected):
                    raise StateError("DUCKDB_SPATIAL_GPKG_CRS_CHANGED")
                identifier = (geo["columns"][geometry].get("crs") or {}).get("id",{})
                if (identifier.get("authority"),str(identifier.get("code"))) != tuple(expected):
                    raise StateError("DUCKDB_SPATIAL_GEOPARQUET_CRS_CHANGED")
            result_binding = digest(_json({"parquet":execution["parquet"]["sha256"],"gpkg":execution["gpkg"]["sha256"],
                                          "rows":counts[0],"geometry_column":geometry,"crs":execution["crs"]}).encode())
            return {"schema":SCHEMA+".receiving","state":"COMPLETE","result_binding":result_binding,
                    "received_at":_now(),"duckdb":self.workspace.duckdb.__version__,"rows":counts[0],
                    "parquet_minus_gpkg":forward,"gpkg_minus_parquet":reverse,
                    "geometry_comparison":"all original WKB values, multiplicity and null states",
                    "crs":execution["crs"],"geoparquet":geo,"gpkg_crs":_wire(gpkg_crs),
                    "gpkg_layers":_wire(gpkg_meta[0]) if gpkg_meta else None,"file_columns":descriptions}
        finally:
            db.close()
