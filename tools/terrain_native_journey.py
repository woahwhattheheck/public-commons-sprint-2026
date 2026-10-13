"""One executable engineering journey. The authored surfaces are code fixtures,
not observations or Upper Savannah scientific results. No network is used.
"""
from __future__ import annotations
import hashlib
import io
import json
from pathlib import Path
import resource
import shutil
import sys
import time
import zipfile
import numpy as np
import rasterio
from rasterio.transform import from_origin
from rasterio.warp import reproject
from rasterio.enums import Resampling
from source_tools.terrain_io import capture, SourceChanged, TerrainError, read_json, atomic_json, canonical, file_sha
from source_tools.terrain_catalog import adopt, degree_tiles, inspect_raster
from source_tools.terrain_prepare import plan, prepare, profile, pause, native_mosaic, NODATA
from source_tools.terrain_portable import pack, receive


def expect_error(call,kind=Exception):
    try:call()
    except kind:return
    raise AssertionError("Expected explicit failure")


def metadata(path,units="meters",datum="North American Vertical Datum of 1988"):
    path.write_text(f'<metadata><idinfo><citation><citeinfo><title>Authored numerical code-verification surface</title><pubdate>20261012</pubdate></citeinfo></citation></idinfo><spref><vertdef><altsys><altunits>{units}</altunits><altdatum>{datum}</altdatum></altsys></vertdef></spref></metadata>')


def raster(path,values,transform,*,nodata=-9999,scale=1,offset=0):
    with rasterio.open(path,"w",driver="GTiff",count=1,dtype=values.dtype.name,crs="EPSG:32617",
                       width=values.shape[1],height=values.shape[0],transform=transform,nodata=nodata,
                       tiled=True,blockxsize=256,blockysize=256,compress="deflate") as ds:
        ds.write(values,1)
        ds.scales=[scale];ds.offsets=[offset]


class Response:
    def __init__(self,body,*,start=0,etag='"fixture-v1"',interrupt=False):
        self.body=io.BytesIO(body[start:]);self.status=206 if start else 200
        self.headers={"ETag":etag,"Content-Length":str(len(body)-start),"Content-Type":"image/tiff"}
        if start:self.headers["Content-Range"]=f"bytes {start}-{len(body)-1}/{len(body)}"
        self.interrupt=interrupt
    def geturl(self):return "https://www.usgs.gov/terrain-protocol-fixture.tif"
    def read(self,size):
        if self.interrupt and self.body.tell()>=3*1024*1024:raise ConnectionResetError("authored transport interruption")
        return self.body.read(size)
    def __enter__(self):return self
    def __exit__(self,*args):return False


def run(base):
    started=time.perf_counter()
    base=Path(base).resolve()
    if base.exists():raise ValueError("Select a new engineering-journey directory; existing data is preserved")
    base.mkdir(parents=True)
    http=base/"http";http.mkdir()
    body=(bytes(range(256))*40000)+b"complete"
    target=http/"original.tif"
    url="https://www.usgs.gov/terrain-protocol-fixture.tif"
    expect_error(lambda:capture(url,target,opener=lambda request,**kw:Response(body,interrupt=True)),ConnectionResetError)
    offset=read_json(http/"original.tif.http.json")["received_bytes"]
    assert offset==3*1024*1024
    def resumed(request,**kw):
        assert request.get_header("Range")==f"bytes={offset}-"
        assert request.get_header("If-range")=='"fixture-v1"'
        return Response(body,start=offset)
    record=capture(url,target,opener=resumed)
    assert record["sha256"]==hashlib.sha256(body).hexdigest() and target.read_bytes()==body
    # Crash between the complete fsynced prefix checkpoint and commit publication.
    partial=target.with_name(target.name+".partial");target.rename(partial)
    record.update(state="receiving",received_bytes=len(body),prefix_sha256=hashlib.sha256(body).hexdigest(),expected_bytes=len(body))
    atomic_json(http/"original.tif.http.json",record)
    def forbidden(*args,**kwargs):raise AssertionError("Completed body must recover offline")
    assert capture(url,target,opener=forbidden)["state"]=="complete"
    changed=http/"changed.tif"
    expect_error(lambda:capture(url,changed,opener=lambda request,**kw:Response(body,interrupt=True)),ConnectionResetError)
    expect_error(lambda:capture(url,changed,opener=lambda request,**kw:Response(body,start=offset,etag='"fixture-v2"')),SourceChanged)
    assert degree_tiles([-83,34,-82,35])[0]["tile"]=="n35w083"
    assert len(degree_tiles([-83.1,33.9,-81.9,35.1]))==9
    raw=base/"authored-fixtures";raw.mkdir()
    meta=raw/"metres.xml";metadata(meta)
    # An extensive native 10m lattice with overlap, zeros, negative samples and holes.
    height,width,overlap=1536,1536,96
    yy,xx=np.indices((height,width),dtype="float32")
    left=(xx*.25+yy*.5-500).astype("float32")
    right=((xx+width-overlap)*.25+yy*.5-500).astype("float32")
    left[100:160,width-70:width-20]=-9999
    left[300:330,width-80:width-40]=np.nan
    right[700:710,800:810]=-9999
    first=raw/"left.tif";second=raw/"right.tif"
    raster(first,left,from_origin(500000,4000000,10,10))
    raster(second,right,from_origin(500000+(width-overlap)*10,4000000,10,10))
    store=base/"sender"
    original_reference="https://www.usgs.gov/3d-elevation-program"
    derivation={"kind":"constructed engineering fixture","purpose":"numerical algorithm and transport exercise"}
    a=adopt(store,first,meta,origin=original_reference,label="authored-left",derivation=derivation)
    meta2=raw/"navd88.xml";metadata(meta2,datum="NAVD88")
    b=adopt(store,second,meta2,origin=original_reference,label="authored-right",derivation=derivation)
    native=native_mosaic(store,[a,b])
    expected=np.full((height,2*width-overlap),NODATA,dtype="float32")
    valid=np.isfinite(left)&(left!=-9999)
    expected[:,:width][valid]=left[valid]
    valid_right=np.isfinite(right)&(right!=-9999)&(expected[:,width-overlap:]==NODATA)
    expected[:,width-overlap:][valid_right]=right[valid_right]
    with rasterio.open(store/native["file"]["path"]) as ds:
        np.testing.assert_array_equal(ds.read(1),expected)
        assert ds.transform==from_origin(500000,4000000,10,10)
    grid={"crs":"EPSG:32617","transform":[30,0,500000,0,-30,4000000],
          "width":expected.shape[1]//3,"height":height//3}
    domain=raw/"domain.geojson"
    leftx,top=500000,4000000
    rightx,bottom=leftx+grid["width"]*30,top-grid["height"]*30
    domain.write_text(json.dumps({"type":"FeatureCollection","crs":{"type":"name","properties":{"name":"EPSG:32617"}},
        "features":[{"type":"Feature","properties":{"id":"authored-domain"},"geometry":{"type":"Polygon",
        "coordinates":[[[leftx,bottom],[rightx,bottom],[rightx,top],[leftx,top],[leftx,bottom]]]}}]}))
    p=plan(store,grid,source_ids=[a["id"],b["id"]],domain_path=domain,title="Engineering exercise — constructed terrain",chunk_size=128)
    expect_error(lambda:prepare(store,p["id"],stop_after_chunks=3),InterruptedError)
    checkpoint=list((store/"prepared"/p["id"] /"chunks").glob("*.tif"))
    assert len(checkpoint)==3
    times={str(path):path.stat().st_mtime_ns for path in checkpoint}
    pause(store,p["id"])
    assert prepare(store,p["id"])["state"]=="paused"
    pause(store,p["id"],resume=True)
    result=prepare(store,p["id"])
    assert result["state"]=="complete"
    assert all(Path(path).stat().st_mtime_ns==mtime for path,mtime in times.items())
    with rasterio.open(store/result["entry"]["path"]) as ds:
        actual=ds.read(1)
        assert ds.transform==from_origin(500000,4000000,30,30)
        assert ds.units==( "m", )
    reference=np.full(actual.shape,NODATA,dtype="float32")
    reproject(expected,reference,src_transform=from_origin(500000,4000000,10,10),src_crs="EPSG:32617",
              src_nodata=NODATA,dst_transform=from_origin(500000,4000000,30,30),dst_crs="EPSG:32617",
              dst_nodata=NODATA,resampling=Resampling.bilinear)
    np.testing.assert_array_equal(actual,reference)
    missing=int((actual==NODATA).sum())
    assert result["entry"]["observed"]["nodata_cells"]==missing
    assert not result["entry"]["observed"]["domain_complete"]
    assert prepare(store,p["id"])["reused"] is True
    bundle=pack(store,p["id"],base/"terrain.sf-DEM.zip")
    copied=receive(bundle["packet"],base/"receiver",expected_sha256=bundle["sha256"])
    assert prepare(copied["directory"],p["id"])["reused"] is True
    expect_error(lambda:receive(bundle["packet"],base/"receiver"),TerrainError)
    assert file_sha(Path(copied["directory"])/result["entry"]["path"])==result["entry"]["sha256"]
    # Independently editable receiver: same sources, new nearest-neighbour plan.
    alternate=plan(copied["directory"],grid,source_ids=[a["id"],b["id"]],title="Receiver's independent nearest surface",resampling="nearest",chunk_size=128)
    changed_result=prepare(copied["directory"],alternate["id"])
    assert not (store/"plans"/(alternate["id"]+".json")).exists()
    # A domain extending outside the grid must never be labelled complete.
    outside=raw/"outside.geojson"
    v=read_json(domain);v["features"][0]["geometry"]["coordinates"][0][0][0]-=1000
    v["features"][0]["geometry"]["coordinates"][0][-1][0]-=1000
    outside.write_text(json.dumps(v))
    p2=plan(copied["directory"],grid,source_ids=[a["id"],b["id"]],domain_path=outside,title="Oversized-domain exercise",resampling="nearest",chunk_size=256)
    assert p2["domain"]["outside_grid_area_ha"]>0 and not p2["domain"]["contained_by_grid"]
    # Exact scale/offset and international-foot conversion, applied once.
    foot=raw/"feet.xml";metadata(foot,units="feet")
    foot_body=raw/"feet.tif"
    original=np.full((96,96),10,dtype="int16");original[3,4]=0;original[5,6]=-10;original[7,8]=-9999
    raster(foot_body,original,from_origin(500000,4000000,30,30),scale=2,offset=3)
    foot_store=base/"units"
    f=adopt(foot_store,foot_body,foot,origin=original_reference,label="authored-feet",derivation=derivation,
            unit_reference="Authored scale/offset and international-foot conversion fixture")
    fp=plan(foot_store,{**grid,"width":96,"height":96},source_ids=[f["id"]],title="Engineering exercise — unit conversion",resampling="nearest",chunk_size=64)
    fr=prepare(foot_store,fp["id"])
    with rasterio.open(foot_store/fr["entry"]["path"]) as ds: converted=ds.read(1)
    expected_feet=((original.astype("float64")*2+3)*.3048).astype("float32")
    expected_feet[original==-9999]=NODATA
    np.testing.assert_array_equal(converted,expected_feet)
    # External GDAL masks must survive original retention and native mosaicking.
    mask_body=raw/"masked-original.tif"
    raster(mask_body,np.full((64,64),25,dtype="float32"),from_origin(500000,4000000,30,30))
    mask=np.full((64,64),255,dtype="uint8");mask[20:30,20:30]=0
    with rasterio.Env(GDAL_TIFF_INTERNAL_MASK=False),rasterio.open(mask_body,"r+") as ds:ds.write_mask(mask)
    mask_store=base/"native-mask"
    ms=adopt(mask_store,mask_body,meta,origin=original_reference,label="authored-mask",derivation=derivation)
    assert any(item["path"].endswith(".msk") for item in ms["files"])
    mm=native_mosaic(mask_store,[ms])
    with rasterio.open(mask_store/mm["file"]["path"]) as ds:
        np.testing.assert_array_equal(ds.read_masks(1),mask)
    # Corruption cannot silently enter a completed source or packet.
    corrupted=base/"corrupted.zip"
    with zipfile.ZipFile(bundle["packet"]) as src,zipfile.ZipFile(corrupted,"w",compression=zipfile.ZIP_DEFLATED) as dst:
        for name in src.namelist():
            body_=src.read(name)
            if name.endswith("sources.csv"):body_=body_[:-1]+bytes([body_[-1]^1])
            dst.writestr(name,body_)
    expect_error(lambda:receive(corrupted,base/"bad-receiver"),TerrainError)
    assert not (base/"bad-receiver").exists()
    output={"schema":"terrain.engineering-journey/v1","input_kind":"authored numerical and HTTP protocol fixtures",
            "native_source_cells":int(height*width*2),"mosaic_cells":int(expected.size),"prepared_cells":int(actual.size),
            "prepared_valid_cells":int(actual.size-missing),"prepared_nodata_cells":missing,
            "original_reproject_array":"identical","preserved_restart_chunks":len(checkpoint),
            "resumed_http_bytes":offset,"complete_body_offline_recovery":True,"changed_source_rejected":True,
            "portable_files":bundle["files"],"portable_bytes":bundle["bytes"],"independent_receiver_plan":alternate["id"],
            "unit_conversion":"exact float32 array equality","outside_grid_domain_detected":True,
            "corrupted_packet_rejected":True,"original_external_mask_retained":True,"elapsed_seconds":round(time.perf_counter()-started,3),
            "max_rss_kib":resource.getrusage(resource.RUSAGE_SELF).ru_maxrss,
            "plan_id":p["id"],"store":str(store),"inspector":str(store/"prepared"/p["id"] /"inspector"/"report.html")}
    atomic_json(base/"journey.json",output)
    print(json.dumps(output,indent=2))
    return output

if __name__=="__main__":run(sys.argv[1] if len(sys.argv)>1 else __import__("tempfile").gettempdir()+"/terrain-native-journey-"+__import__("uuid").uuid4().hex)
