"""Spatial commands on the original stellar-forge-duckdb entrypoint."""
from __future__ import annotations

from pathlib import Path
from .duckdb_spatial import DuckDBSpatial
from .storage import parse,read


def add_parser(commands):
    parser = commands.add_parser("spatial",help="Review original GIS layers, query and exchange native GIS files")
    sub = parser.add_subparsers(dest="spatial_command",required=True)
    sub.add_parser("status",help="Reopen GIS layers, layer bindings and saved queries")
    sub.add_parser("runtime",help="Load the installed signed spatial extension and read actual GDAL drivers")
    review = sub.add_parser("review",help="Review exact geometry and CRS from an immutable dataset edition")
    review.add_argument("edition_id")
    review.add_argument("--geometry-column",required=True)
    review.add_argument("--format",dest="source_format",choices=["esri-json","geojson","wkt","wkb-hex"],required=True)
    review.add_argument("--crs",required=True,help="Native source CRS, for example EPSG:3857")
    review.add_argument("--spatial-reference-column")
    review.add_argument("--geometry-type",choices=["esriGeometryPoint","esriGeometryMultipoint","esriGeometryPolyline","esriGeometryPolygon"])
    review.add_argument("--geometry-name",default="geometry")
    review.add_argument("--keys",help="Comma-separated original SQL key columns; defaults to the edition keys")
    adopt = sub.add_parser("adopt",help="Retain the reviewed source as an immutable GIS layer")
    adopt.add_argument("review_id")
    active = sub.add_parser("activate",help="Select a layer through a revisioned spatial SQL alias")
    active.add_argument("name")
    active.add_argument("layer_id")
    active.add_argument("--expected-revision",type=int,required=True)
    preview = sub.add_parser("preview",help="Return exact original geometry for the native-CRS map")
    preview.add_argument("layer_id")
    preview.add_argument("--max-rows",type=int,default=100)
    for name in ("query","save-query"):
        p = sub.add_parser(name,help="Preview or retain read-only native spatial SQL")
        if name=="save-query":
            p.add_argument("name")
            p.add_argument("--expected-revision",type=int,default=0)
        else:
            p.add_argument("--max-rows",type=int,default=200)
            p.add_argument("--expected-bindings",help="Exact JSON bindings returned by a spatial preview")
        source = p.add_mutually_exclusive_group(required=True)
        source.add_argument("--sql")
        source.add_argument("--sql-file")
        p.add_argument("--parameters",default="[]")
    export = sub.add_parser("export",help="Retain the complete query as GeoPackage and GeoParquet plus original source")
    export.add_argument("query_id")
    export.add_argument("--destination",required=True)
    export.add_argument("--expected-revision",type=int,required=True)
    export.add_argument("--geometry-column",default="geometry")
    export.add_argument("--target-crs",help="Native reprojection before export; omission retains the query CRS")
    export.add_argument("--expected-bindings")
    receive = sub.add_parser("receive",help="Independently reopen exported GIS files and compare all attributes and geometry")
    receive.add_argument("directory")
    return parser


def dispatch(workspace,args):
    gis = DuckDBSpatial(workspace,extension_path=args.spatial_extension)
    command = args.spatial_command
    if command=="status": return gis.status()
    if command=="runtime": return gis.runtime()
    if command=="review":
        return gis.review_layer(args.edition_id,geometry_column=args.geometry_column,source_format=args.source_format,
            crs=args.crs,spatial_reference_column=args.spatial_reference_column,geometry_type=args.geometry_type,
            geometry_name=args.geometry_name,keys=[k.strip() for k in args.keys.split(",") if k.strip()] if args.keys is not None else None)
    if command=="adopt": return gis.adopt_layer(args.review_id)
    if command=="activate": return gis.activate(args.name,args.layer_id,expected_revision=args.expected_revision)
    if command=="preview": return gis.preview(args.layer_id,max_rows=args.max_rows)
    if command in {"query","save-query"}:
        sql = args.sql if args.sql is not None else read(Path(args.sql_file),262144).decode()
        parameters = parse(args.parameters.encode())
        if command=="save-query": return gis.save_query(args.name,sql,parameters,expected_revision=args.expected_revision)
        return gis.query(sql,parameters,max_rows=args.max_rows,
                         expected_bindings=parse(args.expected_bindings.encode()) if args.expected_bindings else None)
    if command=="export":
        return gis.export_query(args.query_id,args.destination,expected_revision=args.expected_revision,
            geometry_column=args.geometry_column,target_crs=args.target_crs,
            expected_bindings=parse(args.expected_bindings.encode()) if args.expected_bindings else None)
    if command=="receive": return gis.receive_files(args.directory)
    raise ValueError("Unknown spatial command")
