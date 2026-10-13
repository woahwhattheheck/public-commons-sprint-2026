"""Source-bound terrain conditioning on the original Workspace and exact DEM grid.

Raw, spill-level filled and source-explicit stream-burn/fill editions remain separate.
No elevations are created in missing cells and no raster grid is changed. Native
InVEST preprocessing/routing remains the consumer, not an algorithm replaced here.
"""
from __future__ import annotations
import argparse
from collections import deque
import copy
import csv
import hashlib
import heapq
import json
import math
import os
import platform
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time
from typing import Callable

import numpy as np
from model.common import atomic_json, canonical, describe_file, digest, file_digest, held, identifier, now, read_json, verify_file

VERSION = '1.0.0'
METHOD = 'https://doi.org/10.1016/j.cageo.2013.04.024'
KIND = 'terrain-conditioning-cases'
RUNS = 'terrain-conditioning-output'
DIRECTIONS = ((0,1),(1,1),(1,0),(1,-1),(0,-1),(-1,-1),(-1,0),(-1,1))


def _number(value, name, *, positive=False):
    if isinstance(value,bool):raise ValueError(name+' must be a finite number')
    n=float(value)
    if not math.isfinite(n) or n < 0 or (positive and n<=0):raise ValueError(name+' must be '+('positive' if positive else 'nonnegative')+' and finite')
    return n


def _source(ws, collection, source_id, kind):
    path, entry=ws.source_file(identifier(collection),source_id)
    if entry['kind']!=kind:raise ValueError('Select an original '+kind+' source')
    return path,entry


def save_case(ws, selection):
    if not isinstance(selection,dict):raise ValueError('Select a source-bound terrain case')
    allowed={'title','dem_collection_id','dem_source_id','hydro_collection_id','hydro_source_id','hydro_layer','hydro_where','burn_depths_m','corridor_half_width_m','nodata_boundary','purpose','context_collection_id'}
    if set(selection)-allowed:raise ValueError('Unknown terrain fields: '+', '.join(sorted(set(selection)-allowed)))
    s=copy.deepcopy(selection)
    title=str(s.get('title') or '').strip()
    if not title or len(title)>300:raise ValueError('Provide a terrain case title of 1–300 characters')
    source,entry=_source(ws,s.get('dem_collection_id'),s.get('dem_source_id'),'raster')
    units=str(entry.get('units') or '').strip().lower()
    if units not in {'m','metre','metres','meter','meters'}:raise ValueError('Use the existing terrain source preparation to normalize the declared elevation units to metres first')
    import rasterio
    from pyproj import CRS
    with rasterio.open(source) as ds:
        if not ds.crs or ds.count!=1:raise ValueError('Select a single-band numeric DEM with a CRS')
        crs=CRS.from_user_input(ds.crs)
        if not crs.is_projected or len(crs.axis_info)<2 or any(abs(a.unit_conversion_factor-1)>1e-12 for a in crs.axis_info[:2]):raise ValueError('Select a projected metre DEM')
        a=ds.transform
        if a.b!=0 or a.d!=0 or a.a<=0 or a.e>=0 or not all(math.isfinite(x) for x in list(a)[:6]):raise ValueError('Select a finite, unrotated, north-up DEM')
        if ds.scales[0]!=1 or ds.offsets[0]!=0:raise ValueError('Normalize original elevation scale/offset through the existing terrain preparation first')
        grid={'crs':ds.crs.to_wkt(),'transform':list(a)[:6],'width':ds.width,'height':ds.height,'pixel_area_m2':abs(a.a*a.e),'dtype':ds.dtypes[0],'crs_name':crs.to_string()}
    depths=s.get('burn_depths_m',[])
    if not isinstance(depths,list):raise ValueError('Burn depths must be an explicit list in metres')
    depths=sorted(set(_number(x,'Burn depth',positive=True) for x in depths))
    half=_number(s.get('corridor_half_width_m',0),'Corridor half-width')
    boundary=s.get('nodata_boundary','edge-and-nodata')
    if boundary not in {'edge-and-nodata','outer-edge-only'}:raise ValueError('Choose edge-and-nodata or outer-edge-only boundary treatment')
    hydro=None
    if s.get('hydro_source_id'):
        hp,he=_source(ws,s.get('hydro_collection_id'),s['hydro_source_id'],'vector')
        if s.get('hydro_where') is not None and not isinstance(s['hydro_where'],dict):raise ValueError('Hydrography filter must map original field names to exact values')
        hydro={'collection_id':s['hydro_collection_id'],'source_id':s['hydro_source_id'],'sha256':file_digest(hp),'layer':s.get('hydro_layer') or he.get('layer'),'where':s.get('hydro_where'),'source_title':he.get('title'),'source_uri':he.get('uri'),'vintage':he.get('vintage')}
    if depths and hydro is None:raise ValueError('Choose the original line hydrography before requesting stream-burn variants')
    context=s.get('context_collection_id') or s['dem_collection_id']
    ws._get('sources',identifier(context))
    implementation={'python_sha256':file_digest(Path(__file__)), 'kernel_sha256':file_digest(Path(__file__).with_name('terrain_flood.cpp'))}
    payload={'implementation':implementation,'context_collection_id':context,'title':title,'version':VERSION,'dem':{'collection_id':s['dem_collection_id'],'source_id':s['dem_source_id'],'sha256':file_digest(source),'source_title':entry.get('title'),'source_uri':entry.get('uri'),'vintage':entry.get('vintage'),'vertical_datum':entry.get('vertical_datum')},'grid':grid,'hydrography':hydro,'burn_depths_m':depths,'corridor_half_width_m':half,'nodata_boundary':boundary,'purpose':str(s.get('purpose') or '').strip(),'method':METHOD,'source_classification':entry.get('classification') or entry.get('data_classification') or entry.get('notes')}
    return ws._save(KIND,payload)


def boundary_seeds(valid, policy):
    from scipy.ndimage import binary_dilation
    seeds=np.zeros(valid.shape,dtype=bool)
    seeds[0,:]=valid[0,:];seeds[-1,:]=valid[-1,:];seeds[:,0]=valid[:,0];seeds[:,-1]=valid[:,-1]
    if policy=='edge-and-nodata':seeds|=valid&binary_dilation(~valid,structure=np.ones((3,3),bool))
    return seeds


def flood_python(elevation,valid,seeds,progress=None):
    """Stable 8-connected Priority-Flood with the improved FIFO depression queue."""
    h,w=elevation.shape;z=elevation.astype('float64',copy=True);seen=~valid.copy()
    opened=[(float(z[r,c]),int(r*w+c)) for r,c in zip(*np.nonzero(seeds&valid))]
    heapq.heapify(opened);seen[seeds&valid]=True;pit=deque();count=0;total=int(valid.sum())
    while opened or pit:
        height,index=pit.popleft() if pit else heapq.heappop(opened)
        r,c=divmod(index,w);count+=1
        for dr,dc in DIRECTIONS:
            rr,cc=r+dr,c+dc
            if rr<0 or cc<0 or rr>=h or cc>=w or seen[rr,cc]:continue
            seen[rr,cc]=True
            if z[rr,cc]<=height:z[rr,cc]=height;pit.append((height,rr*w+cc))
            else:heapq.heappush(opened,(float(z[rr,cc]),rr*w+cc))
        if progress and count%262144==0:progress({'phase':'filling','cells':count,'total':total})
    if count!=total:raise ValueError('Some valid cells have no path to a selected boundary outlet; preserve the source and explicitly revise the boundary selection')
    return z


def flood(elevation,valid,seeds,folder,*,engine='auto',progress=None):
    """Use an original compiled helper where available; portable Python otherwise."""
    if engine not in {'auto','cpp','python'}:raise ValueError('Unknown terrain engine')
    helper=Path(__file__).with_name('terrain_flood.cpp')
    compiler=shutil.which('g++') or shutil.which('clang++')
    if engine=='python' or (engine=='auto' and (not compiler or not helper.is_file())):
        return flood_python(elevation,valid,seeds,progress),'python-priority-flood'
    if not compiler or not helper.is_file():raise RuntimeError('The selected compiled terrain engine requires its retained C++ source and a C++17 compiler')
    cache=Path(folder)/'engine';cache.mkdir(parents=True,exist_ok=True)
    runtime=digest({'source':file_digest(helper),'platform':platform.system(),'machine':platform.machine(),'byteorder':sys.byteorder,'compiler':compiler})
    exe=cache/('priority-flood-'+runtime[:20]+('.exe' if os.name=='nt' else ''))
    with held(cache/'.compile.lock'):
        if not exe.exists():
            pending=exe.with_suffix('.partial')
            proc=subprocess.run([compiler,'-O3','-std=c++17',str(helper),'-o',str(pending)],capture_output=True,text=True)
            if proc.returncode:raise RuntimeError('Terrain helper compilation failed: '+proc.stderr[-4000:])
            os.replace(pending,exe)
    with tempfile.TemporaryDirectory(prefix='flood-',dir=cache) as td:
        td=Path(td)
        np.asarray(elevation,dtype='=f8').tofile(td/'z.bin');np.asarray(valid,dtype='u1').tofile(td/'valid.bin');np.asarray(seeds,dtype='u1').tofile(td/'seeds.bin')
        command=[str(exe),str(elevation.shape[1]),str(elevation.shape[0]),str(td/'z.bin'),str(td/'valid.bin'),str(td/'seeds.bin'),str(td/'out.bin')]
        proc=subprocess.Popen(command,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
        errors=[]
        try:
            for line in proc.stderr:
                if line.startswith('cells '):
                    _,done,total=line.split()
                    if progress:progress({'phase':'filling','cells':int(done),'total':int(total)})
                else:errors.append(line.rstrip())
            stdout=proc.stdout.read();status=proc.wait()
            if status:raise RuntimeError('Terrain conditioning failed: '+'; '.join(errors)[-4000:])
            if int(stdout.strip())!=int(valid.sum()):raise RuntimeError('Incomplete terrain traversal')
        except BaseException:
            proc.terminate();proc.wait();raise
        result=np.fromfile(td/'out.bin',dtype='=f8')
        if result.size!=elevation.size:raise RuntimeError('Incomplete conditioned terrain array')
        return result.reshape(elevation.shape),'cpp17-priority-flood'


def _hydro_mask(ws,case,shape,transform):
    import rasterio.features
    from model.rasters import vector_geometry
    from shapely.geometry import mapping
    hydro=case['hydrography']
    if not hydro:return np.zeros(shape,dtype=bool),{'features':0,'selected_length_m':0.0}
    path,entry=_source(ws,hydro['collection_id'],hydro['source_id'],'vector')
    if file_digest(path)!=hydro['sha256']:raise ValueError('Original hydrography identity differs')
    rows,crs=vector_geometry(path,layer=hydro['layer'],where=hydro['where'],target_crs=case['grid']['crs'])
    geometries=[];length=0
    for row in rows:
        g=row['geometry']
        if g.geom_type not in {'LineString','MultiLineString'}:raise ValueError('Terrain conditioning needs original line hydrography; use a separately documented source conversion for polygons')
        length+=g.length
        if case['corridor_half_width_m']>0:g=g.buffer(case['corridor_half_width_m'],cap_style=2)
        geometries.append(mapping(g))
    mask=rasterio.features.rasterize(((g,1) for g in geometries),out_shape=shape,transform=transform,all_touched=True,fill=0,dtype='uint8').astype(bool)
    return mask,{'features':len(rows),'selected_length_m':length,'cell_rule':'All cells touched by the original line or explicitly buffered corridor; source is not simplified'}


def _write(path,values,valid,profile,units,**tags):
    import rasterio
    path=Path(path);path.parent.mkdir(parents=True,exist_ok=True)
    pending=path.with_name('.'+path.name+'.partial')
    p=profile.copy();p.update(driver='GTiff',count=1,dtype='float64',nodata=-1.7976931348623157e308,tiled=True,blockxsize=256,blockysize=256,compress='deflate',predictor=3,BIGTIFF='IF_SAFER')
    out=np.where(valid,values,p['nodata']).astype('float64')
    if not np.isfinite(out[valid]).all():raise ValueError('Conditioning generated nonfinite valid elevations')
    with rasterio.open(pending,'w',**p) as dst:
        dst.write(out,1);dst.set_band_unit(1,units);dst.update_tags(**{k:str(v) for k,v in tags.items()})
    with pending.open('rb') as stream:os.fsync(stream.fileno())
    os.replace(pending,path)


def _descent(values,valid):
    """Local downhill-neighbour diagnostics, not a flat-resolved flow model."""
    has_lower=np.zeros(valid.shape,dtype=bool);has_equal=np.zeros(valid.shape,dtype=bool)
    for dr,dc in DIRECTIONS:
        rs=slice(max(0,dr),min(values.shape[0],values.shape[0]+dr));cs=slice(max(0,dc),min(values.shape[1],values.shape[1]+dc))
        rt=slice(max(0,-dr),min(values.shape[0],values.shape[0]-dr));ct=slice(max(0,-dc),min(values.shape[1],values.shape[1]-dc))
        both=valid[rs,cs]&valid[rt,ct]
        has_lower[rt,ct]|=both&(values[rs,cs]<values[rt,ct]);has_equal[rt,ct]|=both&(values[rs,cs]==values[rt,ct])
    return {'with_strictly_lower_neighbour_cells':int((valid&has_lower).sum()),'flat_or_local_low_cells':int((valid&~has_lower).sum()),'no_lower_with_equal_neighbour_cells':int((valid&~has_lower&has_equal).sum()),'meaning':'8-neighbour local relief only; plateaus still need the native model flat-resolution and routing'}


def _depressions(depth,valid,area):
    from scipy.ndimage import label,maximum,sum_labels
    labels,count=label(valid&(depth>0),structure=np.ones((3,3),dtype='u1'))
    indexes=np.arange(1,count+1)
    cells=np.bincount(labels.ravel(),minlength=count+1)[1:]
    volumes=sum_labels(depth,labels,indexes)*area if count else []
    maxima=maximum(depth,labels,indexes) if count else []
    return [{'region':int(i),'cells':int(n),'area_ha':float(n*area/10000),'fill_volume_m3':float(v),'maximum_fill_m':float(m)} for i,n,v,m in zip(indexes,cells,volumes,maxima)]


def _csv(path,rows,fields):
    with Path(path).open('w',newline='',encoding='utf-8') as f:
        writer=csv.DictWriter(f,fieldnames=fields);writer.writeheader();writer.writerows(rows)


def inspect(ws,key,*,verify=False):
    key=identifier(key);case=ws._get(KIND,key);path=ws.root/RUNS/key/'result.json'
    if not path.exists():return {'id':key,'case':case,'state':'prepared'}
    value=read_json(path)
    if value.get('case_id')!=key or value.get('version')!=VERSION:raise ValueError('Terrain result identity differs')
    if verify:
        for member in value.get('files',[]):verify_file(ws.root,member)
    return {'id':key,'case':case,**value}


def catalog(ws):
    out=[]
    for case in ws._list(KIND):
        value=inspect(ws,case['id']);out.append({'id':case['id'],'title':case['title'],'state':value['state'],'variants':[{k:v[k] for k in ('name','burn_depth_m','statistics','seconds')} for v in value.get('variants',[])],'source_collection_id':value.get('source_collection_id'),'dem':case['dem'],'hydrography':case['hydrography'],'purpose':case['purpose']})
    return out


def execute(ws,key,*,engine='auto',progress:Callable|None=None):
    import rasterio
    key=identifier(key);case=ws._get(KIND,key)
    if case.get('implementation')!={'python_sha256':file_digest(Path(__file__)), 'kernel_sha256':file_digest(Path(__file__).with_name('terrain_flood.cpp'))}:raise ValueError('Save a new terrain case using this installed implementation; prior source-bound editions remain preserved')
    folder=ws.root/RUNS/key;folder.mkdir(parents=True,exist_ok=True)
    with held(folder/'.case.lock'):
        previous=inspect(ws,key,verify=True)
        if previous['state']=='complete':return {**previous,'reused':True}
        start=time.monotonic();state={'case_id':key,'version':VERSION,'state':'running','phase':'reading','updated_at':now()}
        def update(extra):
            state.update(extra,updated_at=now());atomic_json(folder/'progress.json',state)
            if progress:progress(dict(state))
        update({})
        try:
            path,entry=_source(ws,case['dem']['collection_id'],case['dem']['source_id'],'raster')
            if file_digest(path)!=case['dem']['sha256']:raise ValueError('Original DEM identity differs')
            with rasterio.open(path) as ds:
                if list(ds.transform)[:6]!=case['grid']['transform'] or (ds.width,ds.height)!=(case['grid']['width'],case['grid']['height']):raise ValueError('Original DEM grid differs')
                original=ds.read(1,masked=True);valid=(~np.ma.getmaskarray(original))&np.isfinite(original.data);z=original.data.astype('float64');profile=ds.profile.copy();transform=ds.transform
            if not valid.any():raise ValueError('The selected DEM contains no finite valid elevation')
            area=case['grid']['pixel_area_m2'];seeds=boundary_seeds(valid,case['nodata_boundary'])
            hydro,hydro_summary=_hydro_mask(ws,case,z.shape,transform)
            hydro_summary.update(selected_cells=int(hydro.sum()),valid_dem_cells=int((hydro&valid).sum()),missing_dem_cells=int((hydro&~valid).sum()))
            if case['burn_depths_m'] and not (hydro&valid).any():raise ValueError('Selected original hydrography does not intersect any valid DEM cell')
            variants=[('raw',None),('filled',0.0)]+[(f'burn-{i+1}-filled',depth) for i,depth in enumerate(case['burn_depths_m'])]
            summary=[];files=[];native_entries=[]
            for name,burn in variants:
                vf=folder/name;vf.mkdir(exist_ok=True);saved=vf/'variant.json'
                if saved.exists():
                    v=read_json(saved)
                    if v.get('case_id')!=key or v.get('version')!=VERSION or v.get('name')!=name or v.get('burn_depth_m')!=burn:raise ValueError('Retained terrain variant belongs to another selection')
                    for member in v['files']:verify_file(ws.root,member)
                    summary.append(v);files.extend(v['files']);native_entries.append(copy.deepcopy(v['source_entry']));continue
                update({'phase':name,'variants_complete':len(summary),'variants_total':len(variants)})
                then=time.monotonic();source=z.copy()
                if burn:source[hydro&valid]-=burn
                if not np.isfinite(source[valid]).all():raise ValueError('Selected burn depth overflows the source elevation range')
                if burn is None:conditioned=source;implementation='original values'
                else:conditioned,implementation=flood(source,valid,seeds,folder,engine=engine,progress=update)
                change=np.where(valid,conditioned-z,0);fill=np.where(valid,conditioned-source,0)
                if np.any(fill[valid]<0):raise RuntimeError('Depression filling lowered an elevation')
                _write(vf/'dem.tif',conditioned,valid,profile,'m',case_id=key,variant=name,method=METHOD,vertical_datum=case['dem'].get('vertical_datum') or 'As declared in original source',burn_depth_m=burn or 0)
                _write(vf/'elevation-change.tif',change,valid,profile,'m',direction='conditioned minus original')
                _write(vf/'fill-depth.tif',fill,valid,profile,'m',direction='filled minus pre-fill surface')
                depressions=_depressions(fill,valid,area);_csv(vf/'depressions.csv',depressions,['region','cells','area_ha','fill_volume_m3','maximum_fill_m'])
                from .terrain_conditioning_report import previews
                picture_files=previews(vf,conditioned,change,fill,valid,hydro)
                stats={'valid_cells':int(valid.sum()),'nodata_cells':int((~valid).sum()),'changed_cells':int(np.count_nonzero(valid&(change!=0))),'raised_cells':int(np.count_nonzero(valid&(change>0))),'lowered_cells':int(np.count_nonzero(valid&(change<0))),'changed_area_ha':float(np.count_nonzero(valid&(change!=0))*area/10000),'maximum_raise_m':max(0,float(change[valid].max())),'maximum_lower_m':max(0,float(-change[valid].min())),'raised_volume_m3':float(change[change>0].sum(dtype='float64')*area),'lowered_volume_m3':float(-change[change<0].sum(dtype='float64')*area),'fill_volume_m3':float(fill[valid].sum(dtype='float64')*area),'fill_regions':len(depressions),'boundary_seed_cells':int(seeds.sum()),'stream_lowered_cells':int(np.count_nonzero(valid&hydro&(change<0))),'local_relief':_descent(conditioned,valid)}
                dem=describe_file(ws.root,vf/'dem.tif');vfiles=[describe_file(ws.root,p) for p in [vf/'dem.tif',vf/'elevation-change.tif',vf/'fill-depth.tif',vf/'depressions.csv',*picture_files]]
                native_entry={'id':'terrain-'+key[:16]+'-'+name,'kind':'raster','role':'DEM','title':case['title']+' / '+name,'uri':entry.get('uri') or METHOD,'vintage':entry.get('vintage') or 'Original retained source edition','units':'m','vertical_datum':case['dem'].get('vertical_datum'),'path':dem['path'],'bytes':dem['bytes'],'sha256':dem['sha256'],'conditioning_case_id':key,'conditioning_variant':name,'conditioning_parameters':{'burn_depth_m':burn,'corridor_half_width_m':case['corridor_half_width_m'],'nodata_boundary':case['nodata_boundary']},'original_dem':case['dem'],'original_hydrography':case['hydrography'],'grid':case['grid'],'observed':stats,'classification':case.get('source_classification'),'companions':[]}
                v={'name':name,'burn_depth_m':burn,'engine':implementation,'seconds':time.monotonic()-then,'statistics':stats,'source_entry':native_entry,'files':vfiles,'case_id':key,'version':VERSION}
                atomic_json(saved,v,immutable=True);summary.append(v);files.extend(vfiles);native_entries.append(copy.deepcopy(native_entry))
            _write(folder/'hydrography-mask.tif',hydro.astype('float64'),np.ones(valid.shape,bool),profile,'0 or 1',rule=hydro_summary.get('cell_rule','No hydrography selected'))
            files.append(describe_file(ws.root,folder/'hydrography-mask.tif'))
            fields=['variant','burn_depth_m','valid_cells','changed_cells','raised_cells','lowered_cells','changed_area_ha','maximum_raise_m','maximum_lower_m','fill_volume_m3','fill_regions','seconds']
            rows=[{k:({'variant':v['name'],'burn_depth_m':v['burn_depth_m'],'seconds':v['seconds'],**v['statistics']}).get(k) for k in fields} for v in summary]
            _csv(folder/'comparison.csv',rows,fields);files.append(describe_file(ws.root,folder/'comparison.csv'))
            result={'case_id':key,'version':VERSION,'title':case['title'],'state':'complete','completed_at':now(),'seconds':time.monotonic()-start,'variants':summary,'hydrography':hydro_summary,'case':case,'interpretation':'These are alternative elevation inputs, not pollutant forecasts or demonstrated improvements in hydrologic accuracy. Native InVEST preprocessing and routing still execute for every newly selected scientific case. Fill volume is a geometric elevation-change volume, not available storm-water storage.'}
            if (folder/'summary.json').exists():
                retained=read_json(folder/'summary.json')
                if retained.get('case_id')!=key:raise ValueError('Retained terrain summary belongs to another case')
                result=retained
            else:atomic_json(folder/'summary.json',result,immutable=True)
            files.append(describe_file(ws.root,folder/'summary.json'))
            from .terrain_conditioning_report import write_report
            report=write_report(ws.root,folder,result);files.append(describe_file(ws.root,report))
            # Reuse original source objects and all metadata companions through the native writer.
            originals=[]; context_entries=[]
            for selected_collection in dict.fromkeys([case['context_collection_id'],case['dem']['collection_id']]+([case['hydrography']['collection_id']] if case['hydrography'] else [])):
                original_collection=ws._get('sources',selected_collection)
                originals.append(describe_file(ws.root,ws.root/'sources'/(selected_collection+'.json')))
                originals.append(describe_file(ws.root,ws.root/original_collection['original_manifest']['object']))
                for retained_entry in original_collection['entries']:
                    source,original_entry=ws.source_file(selected_collection,retained_entry['id'])
                    view=ws.root/'source-views'/selected_collection/digest(retained_entry['id'])
                    bodies=[original_entry['body']]+original_entry.get('companions',[])
                    described=[describe_file(ws.root,view/body.get('view_path',body['filename'])) for body in bodies]
                    originals.extend(described)
                    if selected_collection==case['context_collection_id']:
                        copied={k:copy.deepcopy(v) for k,v in original_entry.items() if k not in {'body','companions','bytes'}}
                        copied.update(described[0],companions=described[1:]);context_entries.append(copied)
            companions={f['path']:f for f in originals+files+[describe_file(ws.root,ws.root/KIND/(key+'.json'))]}
            for native_entry in native_entries:native_entry['companions']=[f for name,f in companions.items() if name!=native_entry['path']]
            manifest={'schema':'upstate.sources/v1','title':case['title'],'entries':context_entries+native_entries,'scope':{'conditioning_case_id':key,'original_source':case['dem']},'notes':[result['interpretation']]}
            manifest_path=ws.root/('terrain-conditioning-'+key+'.sources.json');atomic_json(manifest_path,manifest,immutable=True)
            collection=ws.import_sources(manifest_path)
            result['source_collection_id']=collection['id'];result['source_ids']=[e['id'] for e in native_entries]
            result['context_source_ids']=[e['id'] for e in context_entries]
            files.append(describe_file(ws.root,manifest_path));result['files']=files
            atomic_json(folder/'result.json',result,immutable=True);update({'state':'complete','phase':'complete','source_collection_id':collection['id']})
            return {'id':key,**result,'reused':False}
        except BaseException as error:
            update({'state':'interrupted','error':type(error).__name__+': '+str(error)});raise


def native_grid(ws, case_id, variant, grid_id):
    """Change only DEM source selection; preserve the original model-grid writer."""
    result=inspect(ws,case_id,verify=True)
    if result['state']!='complete':raise ValueError('Complete the selected terrain case first')
    found=[v for v in result['variants'] if v['name']==variant]
    if len(found)!=1:raise ValueError('Choose an existing terrain edition')
    original=ws.get_grid(identifier(grid_id))
    if original['spec']['source_collection_id']!=result['case']['context_collection_id']:
        raise ValueError('Choose a grid built from this case’s original context source collection')
    spec=copy.deepcopy(original['spec']);spec['source_collection_id']=result['source_collection_id']
    spec['input_sources']['DEM']=found[0]['source_entry']['id']
    spec['title']=result['title']+' / '+variant
    grid=ws.prepare_grid(spec)
    record=ws._save('terrain-conditioning-bindings',{'case_id':case_id,'variant':variant,'original_grid_id':original['id'],'grid_id':grid['id'],'source_collection_id':result['source_collection_id']})
    return {'binding':record,'grid':grid}


def native_run(ws,case_id,variant,run_id):
    """Prepare a new original native run; Run remains the existing run.start action."""
    original=ws.inspect_run(identifier(run_id))
    binding=native_grid(ws,case_id,variant,original['selection']['grid_id'])
    selected=copy.deepcopy(original['selection']);selected['grid_id']=binding['grid']['id']
    run=ws.prepare_run(selected)
    record=ws._save('terrain-conditioning-bindings',{'case_id':case_id,'variant':variant,'original_run_id':run_id,'run_id':run['id'],'grid_id':binding['grid']['id'],'source_collection_id':binding['binding']['source_collection_id']})
    return {'binding':record,'run':run,'run_action':{'action':'run.start','payload':{'run_id':run['id']}}}


def main(argv=None):
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--workspace',required=True)
    sp=p.add_subparsers(dest='command',required=True)
    sp.add_parser('catalog')
    s=sp.add_parser('save');s.add_argument('selection')
    r=sp.add_parser('run');r.add_argument('case_id');r.add_argument('--engine',choices=['auto','cpp','python'],default='auto')
    r=sp.add_parser('inspect');r.add_argument('case_id')
    r=sp.add_parser('grid');r.add_argument('case_id');r.add_argument('variant');r.add_argument('grid_id')
    r=sp.add_parser('native');r.add_argument('case_id');r.add_argument('variant');r.add_argument('run_id')
    a=p.parse_args(argv)
    from model.workspace import Workspace
    ws=Workspace(a.workspace)
    if a.command=='catalog':out=catalog(ws)
    elif a.command=='save':out=save_case(ws,read_json(a.selection))
    elif a.command=='run':out=execute(ws,a.case_id,engine=a.engine,progress=lambda v:print(json.dumps(v),file=sys.stderr))
    elif a.command=='grid':out=native_grid(ws,a.case_id,a.variant,a.grid_id)
    elif a.command=='native':out=native_run(ws,a.case_id,a.variant,a.run_id)
    else:out=inspect(ws,a.case_id,verify=True)
    print(json.dumps(out,indent=2,allow_nan=False))

if __name__=='__main__':main()
