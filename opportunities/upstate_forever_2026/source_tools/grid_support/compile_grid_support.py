#!/usr/bin/env python3
"""Compile original Upper Savannah source supports on the retained 30 m grid.

This builds physical source masks and class counts, not a model simulation.
Original inputs are retained alongside derived masks. No raster is resampled.
"""
from __future__ import annotations
import argparse, csv, gzip, hashlib, json, math, resource, shutil, sys, time
from contextlib import ExitStack
from datetime import datetime, timezone
from pathlib import Path
import geopandas as gpd
import numpy as np
import pyogrio, rasterio, shapely
from rasterio.enums import MergeAlg
from rasterio.features import rasterize
from rasterio.windows import Window, bounds as window_bounds
from shapely.geometry import box, Polygon, MultiPolygon
from shapely import STRtree

CLASSES={11:'Open water',12:'Perennial ice / snow',21:'Developed, open space',22:'Developed, low intensity',
23:'Developed, medium intensity',24:'Developed, high intensity',31:'Barren land',41:'Deciduous forest',
42:'Evergreen forest',43:'Mixed forest',52:'Shrub / scrub',71:'Grassland / herbaceous',81:'Pasture / hay',
82:'Cultivated crops',90:'Woody wetlands',95:'Emergent herbaceous wetlands'}
SCOPES=[('model_domain',1,'Full upstream model domain','217 original HUC12 polygons'),
('sc_reporting',2,'South Carolina reporting polygon','PlanningBasins2023: Basin = Upper Savannah'),
('arjws_upstream',4,'ARJWS upstream focus','Four original upstream HUC12 memberships'),
('prwd_upstream',8,'PRWD upstream focus','32 original upstream HUC12 memberships'),
('focus_huc12',16,'Four RFP focus watersheds','Four original anchor HUC12 polygons'),
('swpa_11',32,'ARJWS protection: 1,500 ft','SCDES OBJECTID 11; INTAKE S04101'),
('swpa_12',64,'ARJWS protection: 200 ft','SCDES OBJECTID 12; INTAKE S04101'),
('swpa_131',128,'PRWD protection: 1,500 ft','SCDES OBJECTID 131; INTAKE S37109'),
('swpa_132',256,'PRWD protection: 200 ft','SCDES OBJECTID 132; INTAKE S37109')]

def digest(path):
    h=hashlib.sha256()
    with Path(path).open('rb') as f:
        for b in iter(lambda:f.read(1024*1024),b''):h.update(b)
    return h.hexdigest()

def save_json(path,obj):
    Path(path).parent.mkdir(parents=True,exist_ok=True)
    Path(path).write_text(json.dumps(obj,ensure_ascii=False,indent=2,allow_nan=False)+'\n')

def save_csv(path,rows,fields=None):
    Path(path).parent.mkdir(parents=True,exist_ok=True)
    with Path(path).open('w',newline='',encoding='utf-8') as f:
        w=csv.DictWriter(f,fieldnames=fields or list(rows[0]),extrasaction='ignore');w.writeheader();w.writerows(rows)

def polygons_only(g):
    if isinstance(g,(Polygon,MultiPolygon)):return g
    parts=[polygons_only(p) for p in getattr(g,'geoms',[])]
    return shapely.union_all([p for p in parts if not p.is_empty]) if parts else Polygon()

def read_retained(geo,selection):
    path=(geo/'workspace'/selection['object']).resolve()
    if not path.is_relative_to((geo/'workspace').resolve()):raise ValueError('Unsafe source path')
    if digest(path)!=selection['body_sha256']:raise ValueError('Original source identity mismatch')
    raw=path.read_bytes();raw=gzip.decompress(raw) if raw[:2]==b'\x1f\x8b' else raw
    if len(raw)!=selection['decoded_bytes'] or hashlib.sha256(raw).hexdigest()!=selection['decoded_sha256']:
        raise ValueError('Decoded original source mismatch: '+selection['source_id'])
    df=pyogrio.read_dataframe(raw)
    if len(df)!=selection['native_feature_count']:raise ValueError('Original feature count changed')
    return df

def compile_support(app,geo,out,tile=512,source_directory=None):
    started=datetime.now(timezone.utc).isoformat();tick=time.monotonic()
    if out.exists() and any(out.iterdir()):raise ValueError('Use a new output directory; retained editions are never overwritten')
    for name in ('rasters','tables','vectors','originals','source'):(out/name).mkdir(parents=True,exist_ok=True)
    source=source_directory or app/'source/annual-nlcd-native-20261013/source';refpath=source/'land-cover.tif'
    refmeta=json.loads((source/'source-manifest.json').read_text())['entries'][0]
    if digest(refpath)!=refmeta['sha256']:raise ValueError('Reference source identity changed')
    selections_doc=json.loads((geo/'source-selections.json').read_text())
    selections={s['source_id']:s for s in selections_doc['selections']}
    ids={'huc12_full':'original-model-domain','focus_huc12':'usgs-wbd-focus-huc12-20261012',
      'public_intakes':'scdes-public-surface-intakes-20261012','protection_original':'scdes-arjws-prwd-swpa-20261012',
      'arjws_upstream':'upstream-57ec79c39ad77b0d030c7d53','prwd_upstream':'upstream-cae87067e9e9267765622747'}
    native={name:read_retained(geo,selections[sid]) for name,sid in ids.items()}
    planning=app/'source/geography/planning_basins2023'
    reporting=gpd.read_file(planning/'PlanningBasins2023.shp');reporting=reporting.loc[reporting.Basin.eq('Upper Savannah')].copy()
    if len(reporting)!=1:raise ValueError('Expected one original Upper Savannah reporting polygon')
    native['sc_reporting_original']=reporting;repairs=[]
    with rasterio.open(refpath) as ref:
        crs=ref.crs;transform=ref.transform;width=ref.width;height=ref.height
        if ref.count!=1 or ref.dtypes[0]!='uint8' or not crs.is_projected:raise ValueError('Expected projected categorical grid')
        if not (math.isclose(abs(transform.a),30,abs_tol=1e-6) and math.isclose(abs(transform.e),30,abs_tol=1e-6)):
            raise ValueError('This edition requires the retained 30 m reference')
        cell_ha=abs(transform.a*transform.e-transform.b*transform.d)/10000;gridextent=box(*ref.bounds)
        working={}
        for name,df in native.items():
            projected=df.to_crs(crs)
            for idx,g in projected.geometry.items():
                if g.is_empty:raise ValueError('Empty original geometry')
                if not g.is_valid:
                    fixed=polygons_only(shapely.make_valid(g))
                    if fixed.is_empty or not fixed.is_valid:raise ValueError('Unusable working geometry')
                    repairs.append({'layer':name,'row_index':int(idx),'objectid':int(projected.loc[idx,'OBJECTID']),
                      'reason':shapely.is_valid_reason(g),'method':'GEOS make_valid; polygonal parts only',
                      'original_projected_area_m2':float(g.area),'working_area_m2':float(fixed.area),
                      'area_delta_m2':float(fixed.area-g.area)})
                    projected.at[idx,'geometry']=fixed
            working[name]=projected
        hucs=working['huc12_full'].sort_values('huc12').reset_index(drop=True)
        if len(hucs)!=217 or not hucs.huc12.is_unique:raise ValueError('Original 217 HUC inventory changed')
        hucs['zone_id']=np.arange(1,len(hucs)+1,dtype='uint16')
        selected_zones={}
        for key in ('arjws_upstream','prwd_upstream','focus_huc12'):
            members=set(working[key].huc12)
            if not members.issubset(set(hucs.huc12)):raise ValueError('Membership outside original domain')
            for _,row in working[key].iterrows():
                original=hucs.loc[hucs.huc12.eq(row.huc12)].iloc[0]
                if not original.geometry.equals(row.geometry):raise ValueError('Upstream geometry differs from domain')
            selected_zones[key]=hucs.loc[hucs.huc12.isin(members),'zone_id'].to_numpy()
        geoms={'model_domain':shapely.union_all(hucs.geometry.to_numpy()),
          'sc_reporting':shapely.union_all(working['sc_reporting_original'].geometry.to_numpy()),
          **{key:shapely.union_all(working[key].geometry.to_numpy()) for key in selected_zones}}
        for _,r in working['protection_original'].iterrows():geoms['swpa_'+str(int(r.OBJECTID))]=r.geometry
        tree=STRtree(hucs.geometry.to_numpy());zonal=np.zeros((9,218,256),dtype='uint64')
        scope_class=np.zeros((9,256),dtype='uint64');combinations=np.zeros((512,256),dtype='uint64')
        zones_count=np.zeros(218,dtype='uint64');overlap_cells=0
        profile={'driver':'GTiff','width':width,'height':height,'count':1,'crs':crs,'transform':transform,
          'tiled':True,'blockxsize':256,'blockysize':256,'compress':'deflate','zlevel':6,'BIGTIFF':'IF_SAFER'}
        with rasterio.Env(GDAL_CACHEMAX=64*1024*1024),ExitStack() as stack:
            zd=stack.enter_context(rasterio.open(out/'rasters/huc12-zones.tif','w',**profile,dtype='uint16',nodata=0))
            bd=stack.enter_context(rasterio.open(out/'rasters/scope-membership.tif','w',**profile,dtype='uint16'))
            mds={key:stack.enter_context(rasterio.open(out/f'rasters/{key}.tif','w',**profile,dtype='uint8')) for key,_,_,_ in SCOPES}
            zd.update_tags(AREA_OR_POINT='Area',zone_mapping='tables/huc12-zones.csv',boundary_rule='all_touched=False; ascending HUC12, last wins at overlap')
            bd.update_tags(AREA_OR_POINT='Area',scope_definitions=json.dumps([{'id':k,'bit':b} for k,b,_,_ in SCOPES]))
            for key,bit,title,basis in SCOPES:mds[key].update_tags(AREA_OR_POINT='Area',title=title,scope=basis,values='0=outside,1=inside; no NoData',membership_bit=bit)
            total=math.ceil(width/tile)*math.ceil(height/tile);done=0
            for y in range(0,height,tile):
                for x in range(0,width,tile):
                    win=Window(x,y,min(tile,width-x),min(tile,height-y));wt=ref.window_transform(win)
                    shape=(int(win.height),int(win.width));extent=box(*window_bounds(win,transform))
                    indices=sorted(int(i) for i in tree.query(extent,predicate='intersects'))
                    shapes=[(hucs.geometry.iloc[i],i+1) for i in indices]
                    zones=rasterize(shapes,out_shape=shape,transform=wt,fill=0,dtype='uint16',all_touched=False,skip_invalid=False) if shapes else np.zeros(shape,dtype='uint16')
                    if len(shapes)>1:
                        count=rasterize([(g,1) for g,_ in shapes],out_shape=shape,transform=wt,fill=0,dtype='uint16',merge_alg=MergeAlg.add,all_touched=False,skip_invalid=False)
                        overlap_cells+=int(np.count_nonzero(count>1))
                    bits=np.zeros(shape,dtype='uint16');memberships=[]
                    for key,bit,_,_ in SCOPES:
                        if key=='model_domain':mask=(zones>0).astype('uint8')
                        elif key in selected_zones:mask=np.isin(zones,selected_zones[key]).astype('uint8')
                        else:
                            g=geoms[key]
                            mask=rasterize([(g,1)],out_shape=shape,transform=wt,fill=0,dtype='uint8',all_touched=False,skip_invalid=False) if g.intersects(extent) else np.zeros(shape,dtype='uint8')
                        bits|=mask.astype('uint16')*bit;mds[key].write(mask,1,window=win);memberships.append(mask.astype(bool))
                    data=ref.read(1,window=win);flat=data.ravel().astype('int64');zf=zones.ravel().astype('int64')
                    zones_count+=np.bincount(zf,minlength=218).astype('uint64')
                    ck=bits.ravel().astype('int64')*256+flat
                    combinations+=np.bincount(ck,minlength=512*256).reshape(512,256).astype('uint64')
                    for si,mask in enumerate(memberships):
                        select=mask.ravel();scope_class[si]+=np.bincount(flat[select],minlength=256).astype('uint64')
                        zonal[si]+=np.bincount(zf[select]*256+flat[select],minlength=218*256).reshape(218,256).astype('uint64')
                    zd.write(zones,1,window=win);bd.write(bits,1,window=win);done+=1
                    if done%26==0 or done==total:print(json.dumps({'phase':'native_grid_compilation','tiles':done,'total':total,'elapsed_seconds':round(time.monotonic()-tick,2)}),flush=True)
        valid=np.ones(256,dtype=bool)
        if ref.nodata is not None:valid[int(ref.nodata)]=False
        present=np.flatnonzero(combinations.sum(axis=0)).tolist()
        if any(c not in CLASSES and valid[c] for c in present):raise ValueError('Unexpected source class')
        with (source/'class-area.csv').open() as f:prior={int(r['class_code']):int(r['cells']) for r in csv.DictReader(f)}
        actual={c:int(combinations[:,c].sum()) for c in present if valid[c]}
        if actual!=prior:raise ValueError('Compiled rectangle differs from original class inventory')
        shutil.copytree(geo,out/'originals/geography',dirs_exist_ok=True)
        shutil.copytree(planning,out/'originals/planning_basins2023',dirs_exist_ok=True)
        shutil.copytree(source,out/'originals/nlcd2025',dirs_exist_ok=True)
        shutil.copy2(Path(__file__).resolve(),out/'source/compile_grid_support.py')
        gpkg=out/'vectors/geographic-support.gpkg'
        for name,df in native.items():df.to_file(gpkg,layer=name,driver='GPKG',engine='pyogrio',append=gpkg.exists())
        working['huc12_full']=hucs
        for name in ('huc12_full','sc_reporting_original','protection_original'):
            working[name].to_file(gpkg,layer=name+'_5070_working',driver='GPKG',engine='pyogrio',append=True)
        huc_rows=[]
        for i,r in hucs.iterrows():
            huc_rows.append({'zone_id':int(r.zone_id),'huc12':r.huc12,'name':r['name'],'states':r.states,'tohuc':r.tohuc,
              'publisher_area_km2':float(r.areasqkm),'projected_vector_area_ha':float(r.geometry.area/10000),
              'grid_cells':int(zones_count[i+1]),'grid_area_ha':float(zones_count[i+1]*cell_ha),
              'sc_reporting_cells':int(zonal[1,i+1].sum()),
              **{k:bool(r.huc12 in set(working[k].huc12)) for k in selected_zones}})
        save_csv(out/'tables/huc12-zones.csv',huc_rows)
        summaries=[];classes=[];hc=[];domain_combos=np.array([bool(i&1) for i in range(512)])
        for si,(key,bit,title,basis) in enumerate(SCOPES):
            choose=np.array([bool(i&bit) for i in range(512)]);inside=combinations[choose&domain_combos].sum(axis=0)
            total=int(scope_class[si].sum());valid_cells=int(scope_class[si,valid].sum());g=geoms[key];clip=g.intersection(gridextent)
            summaries.append({'scope_id':key,'bit':bit,'title':title,'basis':basis,'grid_cells':total,'grid_area_ha':total*cell_ha,
              'valid_landcover_cells':valid_cells,'nodata_cells':total-valid_cells,'in_model_domain_cells':int(inside.sum()),
              'outside_model_domain_cells':total-int(inside.sum()),'projected_vector_area_ha':float(g.area/10000),
              'vector_area_outside_reference_grid_ha':float(max(0,g.area-clip.area)/10000),
              'intersecting_huc12_count':int(np.count_nonzero(zonal[si,1:].sum(axis=1)))})
            for c in sorted(CLASSES):
                n=int(scope_class[si,c]);ni=int(inside[c])
                classes.append({'scope_id':key,'class_code':c,'class_name':CLASSES[c],'cells':n,'area_ha':n*cell_ha,
                  'percent_of_valid_scope':n/valid_cells*100 if valid_cells else 0,'in_model_domain_cells':ni,'in_model_domain_area_ha':ni*cell_ha})
            for zi in range(1,218):
                if not zonal[si,zi].sum():continue
                for c in sorted(CLASSES):
                    hc.append({'scope_id':key,'zone_id':zi,'huc12':str(hucs.iloc[zi-1].huc12),'class_code':c,'class_name':CLASSES[c],
                      'cells':int(zonal[si,zi,c]),'area_ha':int(zonal[si,zi,c])*cell_ha})
        save_csv(out/'tables/scope-summary.csv',summaries);save_csv(out/'tables/scope-landcover.csv',classes)
        save_csv(out/'tables/huc12-scope-landcover.csv',hc)
        overlaps=[]
        for a,ba,_,_ in SCOPES:
            for b,bb,_,_ in SCOPES:
                n=int(combinations[[i for i in range(512) if i&ba and i&bb]].sum())
                overlaps.append({'scope_a':a,'scope_b':b,'cells':n,'area_ha':n*cell_ha})
        save_csv(out/'tables/scope-overlaps.csv',overlaps)
        rows=[]
        for combo in range(512):
            for c in present:
                n=int(combinations[combo,c])
                if n:rows.append({'membership_bits':combo,'scope_ids':'|'.join(k for k,b,_,_ in SCOPES if combo&b),
                  'class_code':c,'class_name':CLASSES.get(c,'NoData'),'cells':n,'area_ha':n*cell_ha})
        save_csv(out/'tables/exact-membership-landcover.csv',rows)
        intakes=[]
        with rasterio.open(out/'rasters/scope-membership.tif') as bd:
            for _,r in working['public_intakes'].iterrows():
                p=r.geometry;row,col=ref.index(p.x,p.y);ingrid=0<=row<height and 0<=col<width
                hids=sorted(str(hucs.iloc[int(i)].huc12) for i in tree.query(p,predicate='intersects') if hucs.geometry.iloc[int(i)].covers(p))
                bits=int(bd.read(1,window=Window(col,row,1,1))[0,0]) if ingrid else None
                intakes.append({'objectid':int(r.OBJECTID),'pwsno':r.PWSNO,'pwsname':r.PWSNAME,'intake':r.INTAKE,'facility':r.FACILITYNA,
                  'county':r.COUNTY,'original_status':r.INTAKESTAT,'point_huc12':'|'.join(hids),
                  'point_scope_ids':'|'.join(k for k,_,_,_ in SCOPES if geoms[k].covers(p)),
                  'within_reference_grid':ingrid,'grid_row':int(row) if ingrid else '', 'grid_col':int(col) if ingrid else '',
                  'cell_scope_membership_bits':bits if ingrid else '',
                  'cell_scope_ids':'|'.join(k for k,b,_,_ in SCOPES if bits is not None and bits&b),'x_epsg5070':float(p.x),'y_epsg5070':float(p.y)})
        save_csv(out/'tables/original-intakes-grid-crosswalk.csv',intakes);save_json(out/'tables/geometry-working-repairs.json',repairs)
        grid={'crs':crs.to_string(),'transform':list(transform)[:6],'width':width,'height':height,'cell_count':width*height,
          'pixel_area_ha':cell_ha,'bounds':list(ref.bounds),'reference_sha256':refmeta['sha256'],'reference_source_time':refmeta['source_time']}
    result={'schema':'upstate.native-grid-support/v1','created_at_utc':started,'source_project_id':selections_doc['project_id'],
      'grid':grid,'scopes':summaries,'classes':CLASSES,'huc12':huc_rows,'intakes':intakes,'geometry_working_repairs':repairs,
      'source_selection_file':'originals/geography/source-selections.json',
      'geometry_boundary_rule':'GDAL rasterize all_touched=False; polygon centers and boundary rasterization; no resampling',
      'huc_overlap_cells':overlap_cells,'huc_overlap_assignment':'ascending HUC12 order, last wins at overlap',
      'source_rectangular_counts_match':True,
      'method_references':['https://rasterio.readthedocs.io/en/stable/api/rasterio.features.html','https://gdal.org/en/stable/drivers/vector/esrijson.html'],
      'interpretation':['Original land-cover and source-support measurements, not NDR/SDR simulation results.',
        'Model domain, SC reporting, upstream focus memberships and designated protection polygons remain distinct overlapping supports.',
        'Do not sum nested or overlapping protection polygons. Use retained exact bit combinations to form a union.',
        'Raw masks cover the reference rectangle. Intersect sc_reporting with model_domain for model reporting.',
        'Pixel areas use the exact affine determinant; vector and raster areas differ at discretized boundaries.',
        'Original invalid geometries remain unchanged; logged derived working geometries use make_valid.',
        'Point membership uses vector geometry; containing-cell membership is recorded separately.',
        'Reuse masks only with matching CRS, dimensions and all six affine values, not nominal resolution alone.'],
      'runtime':{'started_at_utc':started,'completed_at_utc':datetime.now(timezone.utc).isoformat(),
        'elapsed_seconds':round(time.monotonic()-tick,3),'max_resident_mb':round(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss/1024,3),
        'tile_size':tile,'python':sys.version.split()[0],'rasterio':rasterio.__version__,'pyogrio':pyogrio.__version__,
        'gdal_vector':'.'.join(map(str,pyogrio.__gdal_version__)),'shapely':shapely.__version__}}
    save_json(out/'support-summary.json',result);return result

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--application',type=Path,required=True)
    p.add_argument('--geography',type=Path,required=True);p.add_argument('--output',type=Path,required=True)
    p.add_argument('--tile-size',type=int,default=512);p.add_argument('--source-directory',type=Path,help='Complete explicit land-cover source edition; defaults to the retained application source');a=p.parse_args()
    if not 128<=a.tile_size<=1024:p.error('tile-size must be 128..1024')
    s=compile_support(a.application.resolve(),a.geography.resolve(),a.output.resolve(),a.tile_size,a.source_directory.resolve() if a.source_directory else None)
    print(json.dumps({'status':'complete','output':str(a.output.resolve()),'runtime':s['runtime'],'scopes':s['scopes']}),flush=True)
if __name__=='__main__':main()
