#!/usr/bin/env python3
"""Package the complete original land-cover and geographic source analysis."""
from __future__ import annotations
import argparse,json,hashlib,shutil,csv
from datetime import datetime,timezone
from pathlib import Path
import rasterio
import numpy as np
from render_landcover import render

def desc(p,root):
    with p.open('rb') as f:h=hashlib.file_digest(f,'sha256').hexdigest()
    return {'path':p.relative_to(root).as_posix(),'bytes':p.stat().st_size,'sha256':h}
def prepare(root):
    for n in ['render_landcover.py','prepare_native_handoff.py','compile_grid_support.py','import_support.py']:
        p=Path(__file__).parent/n;t=root/'source'/n
        if p.resolve()!=t.resolve():shutil.copy2(p,t)
    summary=json.loads((root/'support-summary.json').read_text())
    intersection=root/'rasters/sc-reporting-within-model.tif'
    if not intersection.exists():
        count=0
        with rasterio.open(root/'rasters/model_domain.tif') as a,rasterio.open(root/'rasters/sc_reporting.tif') as b:
            with rasterio.open(intersection,'w',**a.profile) as out:
                for _,win in a.block_windows(1):
                    v=((a.read(1,window=win)==1)&(b.read(1,window=win)==1)).astype('uint8');out.write(v,1,window=win);count+=int(v.sum())
                out.update_tags(values='0=outside,1=inside; no NoData',scope='Original SC reporting polygon intersected with original upstream domain',boundary_rule='all_touched=False',source_grid='Original NLCD2025 EPSG5070')
        if count!=summary['scopes'][1]['in_model_domain_cells']:raise ValueError('Reporting intersection changed')
    groups={'forest':[41,42,43],'pasture_and_crops':[81,82],'developed':[21,22,23,24],'wetlands':[90,95]}
    with (root/'tables/scope-landcover.csv').open(newline='') as f:classes=list(csv.DictReader(f))
    grouped=[]
    for scope in summary['scopes']:
        rows=[r for r in classes if r['scope_id']==scope['scope_id']]
        for name,codes in groups.items():
            n=sum(int(r['cells']) for r in rows if int(r['class_code']) in codes)
            ni=sum(int(r['in_model_domain_cells']) for r in rows if int(r['class_code']) in codes)
            grouped.append({'scope_id':scope['scope_id'],'category':name,'class_codes':'|'.join(map(str,codes)),
              'cells':n,'area_ha':n*summary['grid']['pixel_area_ha'],'percent_valid':n/scope['valid_landcover_cells']*100,
              'in_model_cells':ni,'in_model_area_ha':ni*summary['grid']['pixel_area_ha'],'source_sha256':summary['grid']['reference_sha256']})
    with (root/'tables/descriptive-landcover-groups.csv').open('w',newline='') as f:
        w=csv.DictWriter(f,fieldnames=list(grouped[0]));w.writeheader();w.writerows(grouped)
    (root/'START_HERE.md').write_text('''# Upper Savannah original land-cover source workspace

Open OPEN_SUPPORT.html. It is self-contained: inspect the actual 2025 source composition, change the geographic scope, choose a whole-watershed map measure, click a HUC12 and export that original scope-by-watershed class table. Use Whole support to clear a watershed selection. The model-intersection checkbox switches raw source support to its model-domain intersection. All sixteen declared class labels remain visible, including zero-count classes.

All raster, GeoPackage and table downloads work offline from the HTML. Editable full-resolution geometry, twelve masks/zone rasters, complete 217-HUC and 71-intake crosswalks, original source bodies, source-code compiler and importer are in this archive. Raster class areas use the exact affine determinant, not rounded nominal pixels. The original land-cover file is unchanged canonical corrected source 3fa517b4cc3251b9e1bd31e51b54b036a875c09e5f1075511da7c8e951656670. Its complete original source-manifest, plan and other companions are in originals/nlcd2025.

## Two distinct grids
This edition measures the original EPSG:5070 land-cover grid, 6443 by 6319, retaining its actual source cell edges. It does not replace the separate EPSG:26917 HW13/model-grid package, 5858 by 6582. The native-grid raw reporting mask includes 95 cells outside the domain; its supplied intersection excludes those cells. The model-grid counterpart includes 76 such cells. These are different grids, not interchangeable denominators. Do not place masks from one grid directly over the other.

## Reproduce and import
Run source/compile_grid_support.py --application APP --geography ORIGINAL_GEOGRAPHY --source-directory CORRECTED_NLCD --output NEW_OUTPUT. Then source/prepare_native_handoff.py NEW_OUTPUT. The GIS dependencies are Rasterio, GeoPandas, Pyogrio, Shapely and NumPy. Compilation operates window by window without raster resampling. Existing original files are preserved; choose a new output directory.

From the complete application, source/import_support.py --application APP --workspace EXISTING_WORKSPACE --manifest source-manifest.json adds the finished source package and cold reopens its primary view. To import the independent original raster for scientific preparation, use that same importer with originals/nlcd2025/source-manifest.json. This returns the source collection containing usgs-annual-nlcd-2025-native-region-3fa517b4cc3251b9; select that collection and entry explicitly.

## Meaning
The land-cover percentages are descriptive source measurements. They are not modeled N/P/sediment export or claims of treatment effectiveness. Forest combines classes 41/42/43; pasture and crops 81/82; developed 21/22/23/24; wetlands 90/95. Groups do not replace the full original class table. Utility-upstream membership, published protection boundaries and intake points are independent; nested protection supports overlap. The exact membership bitfield and class table support union calculations without double counting.

Original polygons and their logged working interpretations are both retained. This independent source-analysis package does not change the maintained geographic producer, its original-reader path, or any admitted native scenario course. Existing baseline/restoration/control model results retain their own selected input provenance.
''')
    inventory=[desc(p,root) for p in sorted(root.rglob('*')) if p.is_file() and p not in {root/'OPEN_SUPPORT.html',root/'SOURCE_FILES.json',root/'source-manifest.json'} and '__pycache__' not in p.parts]
    (root/'SOURCE_FILES.json').write_text(json.dumps({'schema':'upstate.source-file-inventory/v1','files':inventory},indent=2)+'\n')
    render(root)
    def entry(p,key,title,kind):
        d=desc(p,root)
        return {'id':key,'title':title,'kind':kind,'role':'NATIVE_LANDCOVER_SUPPORT','uri':'urn:sha256:'+d['sha256'],
          'vintage':'Original 2025 land cover and retained geographic sources; compiled 2026-10-13',**d,
          'metadata':{'grid':summary['grid'],'reference_source_sha256':summary['grid']['reference_sha256']}}
    primary=entry(root/'OPEN_SUPPORT.html','native-landcover-support-20261013','Upper Savannah original land-cover source workspace','document')
    primary['companions']=[desc(p,root) for p in sorted(root.rglob('*')) if p.is_file() and p not in {root/'OPEN_SUPPORT.html',root/'source-manifest.json'} and '__pycache__' not in p.parts]
    entries=[primary]
    for p in sorted((root/'rasters').glob('*.tif')):entries.append(entry(p,'nlcd-native-'+p.stem+'-20261013',p.stem.replace('_',' ').replace('-',' '),'raster'))
    for name,title,kind in [('vectors/geographic-support.gpkg','Original and interpreted source geography','vector'),('tables/huc12-scope-landcover.csv','Complete original 217-HUC by source scope and class','table'),('tables/scope-landcover.csv','Original source-scope class composition','table')]:
        p=root/name;entries.append(entry(p,'nlcd-native-'+p.stem+'-20261013',title,kind))
    manifest={'schema':'upstate.sources/v1','title':'Upper Savannah original NLCD2025 source analysis','entries':entries,'captured_at':datetime.now(timezone.utc).isoformat()}
    (root/'source-manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
    print(json.dumps({'status':'NATIVE_HANDOFF_READY','entries':len(entries),'source_files':len(primary['companions']),'viewer_bytes':(root/'OPEN_SUPPORT.html').stat().st_size}))
if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('root',type=Path);a=p.parse_args();prepare(a.root.resolve(strict=True))
