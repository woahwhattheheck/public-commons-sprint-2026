"""One complete, labelled native-routing interpretation course.

Runs the actual routing_paths module on exact encoded direction rasters.
--native additionally creates two clearly authored discriminating DEMs, invokes
the installed PyGeoprocessing2.4.11 D8/MFD producer and interprets those actual
output bytes. It never replaces an accepted production run or source raster.
"""
from __future__ import annotations
import argparse
import importlib.metadata
import importlib.util
import json
import math
from pathlib import Path

def load_kernel(path):
    spec = importlib.util.spec_from_file_location("routing_paths", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

def run(kernel):
    affine = (30, 0, 0, 0, -30, 90)
    original = {
        (1, 1): {"direction": 17, "terrain_valid": True, "stream": False, "elevation": 20},
        (1, 2): {"direction": 3, "terrain_valid": True, "stream": False, "elevation": 10},
        (0, 2): {"direction": -268435456, "terrain_valid": True, "stream": False, "elevation": 12},
        (1, 3): {"direction": None, "terrain_valid": True, "stream": True, "elevation": 5},
    }
    reads = []
    def read(row, col):
        reads.append((row, col))
        return original[(row, col)]
    joined = kernel.trace_paths(read, 4, 3, "mfd", (1, 1), affine)
    assert joined["terminal_shares"]["stream"] == 1
    assert len(reads) == len(set(reads)) == 4
    assert joined["edge_count"] == 4
    merge = next(r for r in joined["cells"] if (r["row"], r["column"]) == (1, 3))
    assert merge["routed_share"] == 1
    assert math.isclose(merge["mean_distance_native_units"], 30 + 30 * math.sqrt(2))
    assert joined["accounting_residual"] == 0
    # Equal unsigned/signed native Int32 high nibble.
    assert kernel.decode_direction(0xf0000000, "mfd") == kernel.decode_direction(-268435456, "mfd")
    directions = []
    for index, (dr, dc) in enumerate(kernel.OFFSETS):
        source = {
            (1, 1): {"direction": index, "terrain_valid": True, "stream": False, "elevation": 9},
            (1+dr, 1+dc): {"direction": None, "terrain_valid": True, "stream": True, "elevation": 8},
        }
        result = kernel.trace_paths(lambda r,c: source[(r,c)], 3,3,"d8",(1,1),affine)
        assert result["terminal_shares"]["stream"] == 1
        assert (result["terminals"][0]["row"], result["terminals"][0]["column"]) == (1+dr,1+dc)
        directions.append(result)
    boundary_source = {
        (0,0): {"direction": 3 + (1<<16), "terrain_valid": True, "stream": False, "elevation": 10},
        (0,1): {"direction": None, "terrain_valid": True, "stream": True, "elevation": 9},
    }
    boundary = kernel.trace_paths(lambda r,c: boundary_source[(r,c)], 2,1,"mfd",(0,0),affine)
    assert boundary["terminal_shares"]["stream"] == .75
    assert boundary["terminal_shares"]["outside_extent"] == .25
    # Stream pixels terminate before interpreting a missing native direction.
    starts_stream = kernel.trace_paths(lambda r,c: boundary_source[(0,1)],1,1,"d8",(0,0),affine)
    assert starts_stream["terminal_shares"]["stream"] == 1 and starts_stream["edge_count"] == 0
    missing = {}
    for label, changes, kind in [
        ("unknown_stream", {"direction": 0, "stream": None}, "stream_unknown"),
        ("missing_d8", {"direction": 128, "stream": False}, "direction_missing"),
        ("missing_mfd", {"direction": 0, "stream": False}, "direction_missing"),
    ]:
        cell={"terrain_valid":True,"elevation":10,**changes}
        result=kernel.trace_paths(lambda r,c:cell,1,1,"mfd" if label=="missing_mfd" else "d8",(0,0),affine)
        assert result["terminal_shares"][kind] == 1
        missing[label]=result
    # A valid branch into missing terrain is retained, never renormalized.
    nodata_source={
        (0,1):{"direction":1+(1<<16),"terrain_valid":True,"stream":False,"elevation":8},
        (0,0):{"direction":None,"terrain_valid":True,"stream":True,"elevation":6},
        (0,2):{"direction":None,"terrain_valid":False,"stream":None,"elevation":None},
    }
    nodata=kernel.trace_paths(lambda r,c:nodata_source[(r,c)],3,1,"mfd",(0,1),affine)
    assert nodata["terminal_shares"]["stream"] == .5 and nodata["terminal_shares"]["terrain_nodata"] == .5
    cyclic={(0,0):0,(0,1):4}
    try:
        kernel.trace_paths(lambda r,c:{"direction":cyclic[(r,c)],"terrain_valid":True,"stream":False,"elevation":1},
                           2,1,"d8",(0,0),affine)
    except kernel.RoutingCycleError as exc:
        cycle=exc.cells
        assert cycle[0] == cycle[-1] and len(cycle)==3
    else:
        raise AssertionError("Reachable cycle was accepted")
    # Follow a native stream only when explicitly requested.
    follow=kernel.trace_paths(lambda r,c:{"direction":0,"terrain_valid":True,"stream":True,"elevation":1},
                              2,1,"d8",(0,0),affine,stop_at_stream=False)
    assert follow["terminal_shares"]["outside_extent"]==1 and follow["edge_count"]==2
    # No recursion/path cap in a long one-cell-wide retained route.
    long=kernel.trace_paths(lambda r,c:{"direction":0,"terrain_valid":True,"stream":c==4999,"elevation":5000-c},
                            5000,1,"d8",(0,0),affine)
    assert long["reachable_cells"]==5000 and long["terminal_shares"]["stream"]==1
    return {
        "schema":"upstate.routing-path-course/v1",
        "source_kind":"authored discriminating encoded rasters; not field data or a production run",
        "split_rejoin":joined,"all_eight_d8":directions,"edge_split":boundary,
        "terrain_nodata":nodata,"missing_support":missing,"cycle_rejected":cycle,
        "stream_start":starts_stream,"explicit_stream_continuation":follow,
        "long_route_summary":{k:long[k] for k in ("reachable_cells","edge_count","terminal_shares","accounting_residual")},
    }

def run_native(kernel, directory):
    import numpy
    from osgeo import gdal, osr
    import pygeoprocessing.routing
    version=importlib.metadata.version("pygeoprocessing")
    if version!="2.4.11":
        raise ValueError("This native encoding course selects PyGeoprocessing2.4.11")
    directory.mkdir(parents=True,exist_ok=True)
    results=[]
    for case, dem in [
        ("east_slope", numpy.tile(numpy.arange(8,0,-1,dtype=numpy.float64),(7,1))),
        ("two_outlet_slope", numpy.array([[20+2*r+abs(c-3) for c in range(7)] for r in range(7)],dtype=numpy.float64)),
    ]:
        dem_path=directory/(case+"-authored-dem.tif")
        ds=gdal.GetDriverByName("GTiff").Create(str(dem_path),dem.shape[1],dem.shape[0],1,gdal.GDT_Float64,
            options=["TILED=YES","BLOCKXSIZE=256","BLOCKYSIZE=256"])
        ds.SetGeoTransform((500000,30,0,3900000,0,-30))
        crs=osr.SpatialReference();crs.ImportFromEPSG(26917);ds.SetProjection(crs.ExportToWkt())
        ds.GetRasterBand(1).SetNoDataValue(-9999);ds.GetRasterBand(1).WriteArray(dem);ds.FlushCache();ds=None
        for algorithm in ("d8","mfd"):
            flow=directory/(case+"-"+algorithm+".tif")
            getattr(pygeoprocessing.routing,"flow_dir_"+algorithm)((str(dem_path),1),str(flow))
            dataset=gdal.Open(str(flow)); values=dataset.GetRasterBand(1).ReadAsArray(); nodata=dataset.GetRasterBand(1).GetNoDataValue()
            def read(row,col):
                value=int(values[row,col])
                return {"direction":None if value==nodata else value,"terrain_valid":True,
                        "stream":False,"elevation":float(dem[row,col])}
            result=kernel.trace_paths(read,dem.shape[1],dem.shape[0],algorithm,(3,3),
                                      (30,0,500000,0,-30,3900000))
            assert math.isclose(result["terminal_shares"]["outside_extent"],1,abs_tol=1e-10)
            results.append({"case":case,"algorithm":algorithm,"producer_version":version,
                            "original_dem":str(dem_path),"original_direction":str(flow),"result":result})
    return results

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("--kernel",required=True,type=Path)
    parser.add_argument("--output",required=True,type=Path)
    parser.add_argument("--native",action="store_true")
    args=parser.parse_args()
    kernel=load_kernel(args.kernel)
    result=run(kernel)
    if args.native:
        result["actual_native_producer_cases"]=run_native(kernel,args.output.parent/"native-routing-inputs")
    args.output.parent.mkdir(parents=True,exist_ok=True)
    args.output.write_text(json.dumps(result,ensure_ascii=False,allow_nan=False,indent=2)+"\n",encoding="utf-8")
    print(json.dumps({"ok":True,"output":str(args.output),"native":args.native,
                      "split_rejoin_stream_share":result["split_rejoin"]["terminal_shares"]["stream"],
                      "boundary_stream_share":result["edge_split"]["terminal_shares"]["stream"],
                      "long_route_cells":result["long_route_summary"]["reachable_cells"]}))
if __name__=="__main__":
    main()
