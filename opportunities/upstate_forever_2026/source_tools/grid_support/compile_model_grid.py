#!/usr/bin/env python3
"""Compile full-resolution, independent source masks on a declared model grid.

Original source bodies and GDAL-derived working geometries are retained. The
result is source support, not modeled water-quality results or intake loading.
"""
from __future__ import annotations
import argparse,csv,hashlib,json,math,resource,shutil,sys,time,zipfile
from contextlib import ExitStack
from datetime import datetime,timezone
from pathlib import Path
import geopandas as gpd
import numpy as np
import rasterio,shapely
from rasterio.transform import Affine
from rasterio.windows import Window,bounds as window_bounds
from rasterio.features import rasterize
from shapely import STRtree
from shapely.geometry import box
from compile_grid_support import read_retained,polygons_only,SCOPES,save_json,save_csv,digest

def compile_model_grid(geo,shp,gridfile,out,tile=512):
    start=datetime.now(timezone.utc).isoformat();tick=time.monotonic()
    if out.exists() and any(out.iterdir()):raise ValueError('Use a new immutable output directory')
    for part in ('rasters','vectors','tables','originals','source'):(out/part).mkdir(parents=True,exist_ok=True)
    original=json.loads(gridfile.read_text());grid=original['grid']
    crs=grid['crs'];height,width=grid['shape'];tr=Affine(*grid['affine_6']);area=abs(tr.a*tr.e-tr.b*tr.d)/10000
    sels=json.loads((geo/'source-selections.json').read_text());sel={s['source_id']:s for s in sels['selections']}
    ids={'model_domain':'original-model-domain','focus_huc12':'usgs-wbd-focus-huc12-20261012',
      'intakes':'scdes-public-surface-intakes-20261012','protection':'scdes-arjws-prwd-swpa-20261012',
      'arjws_upstream':'upstream-57ec79c39ad77b0d030c7d53','prwd_upstream':'upstream-cae87067e9e9267765622747'}
    native={k:read_retained(geo,sel[sid]) for k,sid in ids.items()}
    report=gpd.read_file(shp);native['sc_reporting']=report.loc[report.Basin.eq('Upper Savannah')].copy()
    if len(native['sc_reporting'])!=1:raise ValueError('Exact reporting selector must select one feature')
    working={};repairs=[]
    for key,df in native.items():
        w=df.to_crs(crs)
        for ix,g in w.geometry.items():
            if not g.is_valid:
                fixed=polygons_only(shapely.make_valid(g))
                if fixed.is_empty or not fixed.is_valid:raise ValueError('Unusable source geometry')
                repairs.append({'source':key,'objectid':int(w.loc[ix,'OBJECTID']),'reason':shapely.is_valid_reason(g),
                  'method':'GEOS make_valid; polygonal parts only','original_area_m2':float(g.area),
                  'working_area_m2':float(fixed.area),'delta_area_m2':float(fixed.area-g.area)})
                w.at[ix,'geometry']=fixed
        working[key]=w
    hucs=working['model_domain'].sort_values('huc12').reset_index(drop=True);hucs['zone_id']=range(1,len(hucs)+1)
    if len(hucs)!=217 or not hucs.huc12.is_unique:raise ValueError('Wrong original HUC inventory')
    geoms={k:shapely.union_all(working[k].geometry.to_numpy()) for k in ('model_domain','sc_reporting','arjws_upstream','prwd_upstream','focus_huc12')}
    for _,r in working['protection'].iterrows():geoms['swpa_'+str(int(r.OBJECTID))]=r.geometry
    tree=STRtree(hucs.geometry.to_numpy());scope_hucs=np.zeros((9,218),dtype='uint64');combo=np.zeros(512,dtype='uint64')
    memberships={k:hucs.loc[hucs.huc12.isin(working[k].huc12),'zone_id'].to_numpy() for k in ('arjws_upstream','prwd_upstream','focus_huc12')}
    profile=dict(driver='GTiff',width=width,height=height,count=1,crs=crs,transform=tr,tiled=True,
      blockxsize=256,blockysize=256,compress='deflate',zlevel=6,BIGTIFF='IF_SAFER')
    with rasterio.Env(GDAL_CACHEMAX=64*1024*1024),ExitStack() as stack:
        zone=stack.enter_context(rasterio.open(out/'rasters/huc12-zones.tif','w',**profile,dtype='uint16',nodata=0))
        packed=stack.enter_context(rasterio.open(out/'rasters/scope-membership.tif','w',**profile,dtype='uint16'))
        maskfiles={k:stack.enter_context(rasterio.open(out/f'rasters/{k}.tif','w',**profile,dtype='uint8')) for k,_,_,_ in SCOPES}
        reporting=stack.enter_context(rasterio.open(out/'rasters/sc-reporting-within-model.tif','w',**profile,dtype='uint8'))
        packed.update_tags(AREA_OR_POINT='Area',scope_definitions=json.dumps([{'id':k,'bit':b} for k,b,_,_ in SCOPES]))
        zone.update_tags(AREA_OR_POINT='Area',zone_mapping='tables/huc12-zones.csv')
        for k,b,title,basis in SCOPES:maskfiles[k].update_tags(AREA_OR_POINT='Area',title=title,scope=basis,values='0=outside;1=inside; no NoData')
        reporting.update_tags(AREA_OR_POINT='Area',expression='model_domain AND sc_reporting',values='0=outside;1=inside; no NoData')
        count=0;total=math.ceil(height/tile)*math.ceil(width/tile)
        for y in range(0,height,tile):
            for x in range(0,width,tile):
                win=Window(x,y,min(tile,width-x),min(tile,height-y));wt=rasterio.windows.transform(win,tr)
                shape=(int(win.height),int(win.width));extent=box(*window_bounds(win,tr))
                indices=sorted(int(i) for i in tree.query(extent,predicate='intersects'))
                shapes=[(hucs.geometry.iloc[i],i+1) for i in indices]
                zones=rasterize(shapes,out_shape=shape,transform=wt,dtype='uint16',fill=0,all_touched=False,skip_invalid=False) if shapes else np.zeros(shape,dtype='uint16')
                bits=np.zeros(shape,dtype='uint16')
                for si,(k,b,_,_) in enumerate(SCOPES):
                    if k=='model_domain':m=(zones>0).astype('uint8')
                    elif k in memberships:m=np.isin(zones,memberships[k]).astype('uint8')
                    else:m=rasterize([(geoms[k],1)],out_shape=shape,transform=wt,dtype='uint8',fill=0,all_touched=False,skip_invalid=False) if geoms[k].intersects(extent) else np.zeros(shape,dtype='uint8')
                    bits|=m.astype('uint16')*b;maskfiles[k].write(m,1,window=win)
                    scope_hucs[si]+=np.bincount(zones[m.astype(bool)],minlength=218).astype('uint64')
                reporting.write(((bits&3)==3).astype('uint8'),1,window=win)
                packed.write(bits,1,window=win);zone.write(zones,1,window=win)
                combo+=np.bincount(bits.ravel(),minlength=512).astype('uint64');count+=1
                if count%26==0 or count==total:print(json.dumps({'phase':'model_support','tiles':count,'total':total,'seconds':round(time.monotonic()-tick,2)}),flush=True)
    rows=[];extent=box(*grid['bounds'])
    for si,(k,b,title,basis) in enumerate(SCOPES):
        totalcells=int(combo[[i for i in range(512) if i&b]].sum());inside=int(combo[[i for i in range(512) if i&b and i&1]].sum())
        rows.append({'scope_id':k,'bit':b,'title':title,'source_selection':basis,'grid_cells':totalcells,'grid_area_ha':totalcells*area,
          'model_domain_cells':inside,'model_domain_area_ha':inside*area,'outside_model_domain_cells':totalcells-inside,
          'projected_vector_area_ha':float(geoms[k].area/10000),'vector_area_outside_grid_ha':float(geoms[k].difference(extent).area/10000),
          'intersecting_huc12_count':int(np.count_nonzero(scope_hucs[si,1:]))})
    save_csv(out/'tables/scope-summary.csv',rows)
    hr=[]
    for i,r in hucs.iterrows():hr.append({'zone_id':i+1,'huc12':r.huc12,'name':r['name'],'states':r.states,'tohuc':r.tohuc,
      'publisher_area_km2':float(r.areasqkm),'vector_area_ha':float(r.geometry.area/10000),
      **{k+'_cells':int(scope_hucs[si,i+1]) for si,(k,_,_,_) in enumerate(SCOPES)}})
    save_csv(out/'tables/huc12-zones.csv',hr)
    overlap=[]
    for a,ba,_,_ in SCOPES:
        for b,bb,_,_ in SCOPES:
            n=int(combo[[i for i in range(512) if i&ba and i&bb]].sum());overlap.append({'scope_a':a,'scope_b':b,'cells':n,'area_ha':n*area})
    save_csv(out/'tables/scope-overlaps.csv',overlap)
    exact=[{'membership_bits':i,'scope_ids':'|'.join(k for k,b,_,_ in SCOPES if i&b),'cells':int(n),'area_ha':int(n)*area} for i,n in enumerate(combo) if n]
    save_csv(out/'tables/exact-membership.csv',exact)
    ir=[]
    for _,r in working['intakes'].iterrows():
        p=r.geometry;containing=sorted(str(hucs.iloc[int(i)].huc12) for i in tree.query(p,predicate='intersects') if hucs.geometry.iloc[int(i)].covers(p))
        ir.append({'objectid':int(r.OBJECTID),'pwsno':r.PWSNO,'pwsname':r.PWSNAME,'intake':r.INTAKE,
          'facility':r.FACILITYNA,'county':r.COUNTY,'status':r.INTAKESTAT,'point_huc12':'|'.join(containing),
          'point_scopes':'|'.join(k for k,_,_,_ in SCOPES if geoms[k].covers(p)),'x':float(p.x),'y':float(p.y),
          **{k+'_distance_m':float(geoms[k].distance(p)) for k in ('swpa_11','swpa_12','swpa_131','swpa_132')}})
    save_csv(out/'tables/original-intakes.csv',ir);save_json(out/'tables/geometry-working-repairs.json',repairs)
    gpkg=out/'vectors/geographic-support.gpkg'
    for k,df in native.items():df.to_file(gpkg,layer=k+'_original',driver='GPKG',engine='pyogrio',append=gpkg.exists())
    working['model_domain']=hucs
    for k,df in working.items():df.to_file(gpkg,layer=k+'_working',driver='GPKG',engine='pyogrio',append=True)
    # Complete original source closure, including original invalid protection geometry.
    shutil.copytree(geo,out/'originals/geography',dirs_exist_ok=True)
    shutil.copytree(shp.parent,out/'originals/planning_basins2023',dirs_exist_ok=True)
    shutil.copy2(gridfile,out/'originals/model-grid-HW13.json')
    for name in ('compile_model_grid.py','compile_grid_support.py'):shutil.copy2(Path(__file__).parent/name,out/'source'/name)
    actual_domain=rows[0]['grid_cells'];actual_reporting=rows[1]['model_domain_cells']
    retained={'model_domain_cells':original['masks']['model-domain-30m.tif']['included_cells'],
              'sc_reporting_within_model_cells':original['masks']['sc-reporting-support-30m.tif']['included_cells']}
    result={'schema':'upstate.model-grid-support/v1','created_at_utc':start,'source_project_id':sels['project_id'],
      'grid':{**grid,'pixel_area_ha':area,'definition_sha256':digest(gridfile)},'scopes':rows,'huc12':hr,'intakes':ir,
      'geometry_working_repairs':repairs,'retained_grid_counts':retained,
      'actual_counts':{'model_domain_cells':actual_domain,'sc_reporting_within_model_cells':actual_reporting},
      'retained_grid_counts_match':actual_domain==retained['model_domain_cells'] and actual_reporting==retained['sc_reporting_within_model_cells'],
      'interpretation':['Compiled original geographic support, not simulated physical fields or native NDR/SDR output.',
        'Upstream focus memberships are not service areas and do not substitute for the published protection polygons.',
        'Nested protection features overlap. Use exact bit combinations for union counts, not sums of scope areas.',
        'Raw reporting polygon is separate from its intersection with the model domain. Both masks are delivered.',
        'Original intake point and protection polygon geometry are retained independently, including Pioneer offsets.',
        'Original invalid polygons are unchanged in the original layers; only logged working copies use make_valid.',
        'Native NLCD source uses a different EPSG:5070 affine; these EPSG:26917 masks must not be overlaid without an explicit grid-aware operation.'],
      'method_references':['https://rasterio.readthedocs.io/en/stable/api/rasterio.features.html','https://gdal.org/en/stable/drivers/vector/esrijson.html'],
      'runtime':{'started_at_utc':start,'finished_at_utc':datetime.now(timezone.utc).isoformat(),'elapsed_seconds':round(time.monotonic()-tick,3),
        'peak_rss_mb':round(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss/1024,3),'tile_size':tile,'python':sys.version.split()[0],
        'rasterio':rasterio.__version__,'shapely':shapely.__version__}}
    save_json(out/'support-summary.json',result)
    print(json.dumps({'status':'complete','runtime':result['runtime'],'same_grid_counts':result['retained_grid_counts_match'],'scopes':rows}),flush=True)
    return result

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--geography',type=Path,required=True)
    p.add_argument('--reporting-shp',type=Path,required=True);p.add_argument('--grid',type=Path,required=True);p.add_argument('--output',type=Path,required=True)
    a=p.parse_args();compile_model_grid(a.geography.resolve(),a.reporting_shp.resolve(),a.grid.resolve(),a.output.resolve())
if __name__=='__main__':main()
