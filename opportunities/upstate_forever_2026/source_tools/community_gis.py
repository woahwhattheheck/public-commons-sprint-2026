#!/usr/bin/env python3
"""Join original RFP whole-block-group context to the four retained WBD polygons.

Writes a native-CRS GeoPackage, geographic GeoJSON, analysis CSV and standalone
map report, then retains them in the original scientific Workspace. Population
fields describe complete RFP-assigned block groups, not clipped populations.
"""
from __future__ import annotations
import argparse
import csv
from html import escape
import json
from pathlib import Path
import sys

APP = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(APP))
from model.workspace import Workspace
from model.common import atomic_json, file_digest, held
from model.spatial_esri import OriginalEsriFeatures
from model.communities import get_table


def build(workspace_path: Path, production: Path, output: Path) -> dict:
    import fiona
    from pyproj import Geod, Transformer
    from shapely.geometry import mapping
    from shapely.ops import transform
    w = Workspace(workspace_path)
    operation = json.loads(production.read_text())
    if operation['project_id'] != w.project['id']:
        raise ValueError('Use the original Community receiving Workspace')
    output.mkdir(parents=True, exist_ok=True)
    result_file = output / 'community-gis.json'
    with held(output / '.community-gis.lock', blocking=False):
        if result_file.exists():
            result = json.loads(result_file.read_text())
            if result['project_id'] != w.project['id'] or result['table_id'] != operation['table_id']:
                raise ValueError('The retained GIS build has another original selection')
            for name, r in result['files'].items():
                if file_digest(output / name) != r['sha256']:
                    raise ValueError('The retained GIS file changed: ' + name)
            return result
        table = get_table(w, operation['table_id'])
        collection = w._get('sources', operation['geometry_source_collection_id'])
        entries = [e for e in collection['entries'] if e.get('role') == 'FOCUS_CATCHMENTS']
        if len(entries) != 1:
            raise ValueError('Select the original four-focus-watershed geometry edition')
        source, entry = w.source_file(collection['id'], entries[0]['id'])
        features = OriginalEsriFeatures(source, entry)
        to_geo = Transformer.from_crs(features.crs, 'EPSG:4326', always_xy=True)
        geod = Geod(ellps='WGS84')
        summaries = {r['scope_id']:r for r in table['summaries']['watersheds']}
        all_hucs = {str(f.properties['huc12']) for f in features}
        if all_hucs != set(summaries):
            raise ValueError('Original geometry and RFP watershed memberships differ')
        rows, geographic, native = [], [], []
        for feature in features:
            original = feature.properties
            huc = str(original['huc12'])
            summary = summaries[huc]
            utility_ids = sorted({m['utility_id'] for g in table['groups'] for m in g['memberships'] if m['watershed_id'] == huc})
            geometry = feature.native_geometry
            if geometry is None or geometry.is_empty or feature.geometry_operations:
                raise ValueError('Retain an unchanged usable original polygon: ' + huc)
            g = transform(to_geo.transform, geometry)
            area, perimeter = geod.geometry_area_perimeter(g)
            row = {'huc12':huc, 'watershed':summary['label'], 'utility':';'.join(utility_ids),
                   'tohuc':str(original['tohuc']), 'tohuc_selected':int(str(original['tohuc']) in all_hucs),
                   'source_objectid':int(original['objectid']), 'bg_count':summary['geoid_count'],
                   'bg_population':summary['population_total'], 'bg_households':summary['households_total'],
                   'bg_poverty_households':summary['poverty_households_total'],
                   'bg_poverty_percent':float(summary['household_poverty_percent']),
                   'bg_below_income_count':summary['below_state_median_count'],
                   'source_area_km2':float(original['areasqkm']), 'geometry_area_km2':round(abs(area)/1e6,6),
                   'geometry_perimeter_km':round(perimeter/1000,6),
                   'geometry_minus_source_km2':round(abs(area)/1e6-float(original['areasqkm']),6),
                   'bg_basis':'Whole RFP-assigned census block groups; not clipped watershed population',
                   'table_sha256':table['source']['sha256'], 'geometry_sha256':entry['body']['sha256']}
            rows.append(row)
            properties={**row, 'original_attributes':json.dumps(original,ensure_ascii=False,sort_keys=True)}
            native.append({'geometry':mapping(geometry),'properties':properties})
            geographic.append({'type':'Feature','id':huc,'geometry':mapping(g),'properties':properties})
        rows.sort(key=lambda r:r['huc12'])
        geojson={'type':'FeatureCollection','name':'RFP community context by original focus watershed',
                 'features':geographic}
        atomic_json(output/'community-watersheds.geojson',geojson,immutable=True)
        schema={'geometry':'Unknown','properties':{}}
        for k,v in native[0]['properties'].items():
            schema['properties'][k]='int64' if isinstance(v,int) else 'float' if isinstance(v,float) else 'str'
        gpkg=output/'community-watersheds.gpkg'
        if gpkg.exists():
            raise ValueError('An interrupted GeoPackage is retained; select a new output directory')
        with fiona.open(gpkg,'w',driver='GPKG',layer='community_watersheds',crs_wkt=features.crs_wkt,schema=schema) as sink:
            sink.writerecords(native)
        with fiona.open(gpkg,layer='community_watersheds') as received:
            if {f['properties']['huc12'] for f in received} != all_hucs:
                raise ValueError('The working GeoPackage omitted an original watershed')
        with (output/'community-watersheds.csv').open('x',newline='',encoding='utf-8') as f:
            writer=csv.DictWriter(f,fieldnames=list(rows[0]));writer.writeheader();writer.writerows(rows)
        # Projection coordinates are used only to draw the retained geometry.
        bounds=features.bounds;x0,y0,x1,y1=bounds;dx=x1-x0;dy=y1-y0
        width,height=960,720;scale=min((width-100)/dx,(height-100)/dy)
        def xy(x,y):return (50+(x-x0)*scale, height-50-(y-y0)*scale)
        paths=[]
        for feature in features:
            huc=str(feature.properties['huc12']);g=feature.native_geometry
            polys=[g] if g.geom_type=='Polygon' else list(g.geoms)
            parts=[]
            for poly in polys:
                for ring in [poly.exterior,*poly.interiors]:
                    points=[xy(x,y) for x,y in ring.coords]
                    parts.append('M'+' L'.join(f'{x:.2f},{y:.2f}' for x,y in points)+' Z')
            label=g.representative_point();lx,ly=xy(label.x,label.y)
            number=next(i for i,r in enumerate(rows,1) if r['huc12']==huc)
            paths.append(f'<path d="{" ".join(parts)}"><title>{escape(summaries[huc]["label"])}</title></path>'
                         f'<text x="{lx:.2f}" y="{ly:.2f}">{number}</text>')
        svg=f'<svg viewBox="0 0 {width} {height}" role="img" aria-label="Four original USGS focus-watershed outlines"><g fill="white" stroke="black" stroke-width="1.5" fill-rule="evenodd">'+''.join(paths)+'</g></svg>'
        header=['Map','Watershed / HUC12','Utility','Whole block groups','Block-group population','Households','Households below poverty','WBD area km²','Geodesic area km²','Original downstream HUC12']
        table_html='<div class="table-wrap"><table><thead><tr>'+''.join('<th>'+escape(c)+'</th>' for c in header)+'</tr></thead><tbody>'
        for i,r in enumerate(rows,1):
            cells=[i,r['watershed']+' / '+r['huc12'],r['utility'],r['bg_count'],f'{r["bg_population"]:,}',f'{r["bg_households"]:,}',f'{r["bg_poverty_households"]:,}',r['source_area_km2'],r['geometry_area_km2'],r['tohuc']]
            table_html+='<tr>'+''.join('<td>'+escape(str(c))+'</td>' for c in cells)+'</tr>'
        table_html+='</tbody></table></div>'
        body='''<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Four-watershed Community GIS</title><style>body{font:16px/1.55 system-ui,sans-serif;color:#222;background:white;margin:0;overflow-wrap:anywhere}main{max-width:1200px;margin:auto;padding:24px}h1{font-size:28px;line-height:1.2}h2{font-size:21px}.table-wrap{overflow:auto}table{border-collapse:collapse;min-width:1040px;width:100%;font-size:14px}th,td{padding:10px;border:1px solid #bbb;text-align:left;vertical-align:top}th{background:#eee}svg{display:block;max-width:100%;max-height:700px;margin:auto;border:1px solid #aaa}svg text{fill:black;stroke:white;stroke-width:3;paint-order:stroke;font:20px system-ui;text-anchor:middle}.links a{display:inline-block;margin:8px 16px 8px 0}code{overflow-wrap:anywhere}@media(max-width:600px){main{padding:16px}}@media print{.table-wrap{overflow:visible}table{min-width:0;font-size:10px}}</style><main><p>Upper Savannah · Original source geometry and community context</p><h1>Four-watershed Community GIS</h1><p>The four retained USGS watershed outlines are joined by complete HUC12 to the original RFP community table. Each population total counts whole assigned block groups. It is not a spatially clipped population, a utility service population or an exposure estimate.</p>'''
        body+=svg+'<h2>Watershed and community context</h2>'+table_html
        body+='''<h2>Use the working data</h2><p class="links"><a download href="community-watersheds.gpkg">Native-CRS GeoPackage</a><a download href="community-watersheds.geojson">Geographic GeoJSON</a><a download href="community-watersheds.csv">Full analysis CSV</a></p><p>The GeoPackage preserves the original EPSG:3857 polygon coordinates and full source attributes. The GeoJSON explicitly transforms those polygons to longitude/latitude (EPSG:4326). Geodesic area and perimeter are measured on the WGS84 ellipsoid from those transformed coordinates; WBD's published area remains a separate field. Original downstream HUC12 values are carried without extending the four-watershed network.</p><h2>Source and methods</h2><p>Original RFP Table 1 / 2024 ACS: 17 whole block groups, 27,448 people and 11,001 households. Geometry is the complete retained USGS WBD four-HUC response captured on October 13, 2026. The original Community package, manifest, records and source bytes travel with this scientific Workspace.</p><p>Native coordinate reference: EPSG:3857. Drawing is a geographic context diagram using the original projected coordinates; use the GIS data for measurement. Shared block-group memberships are counted once within each selection. No area-based allocation of demographic data is performed.</p></main></html>'''
        (output/'community-geography.html').write_text(body,encoding='utf-8')
        file_names=['community-watersheds.gpkg','community-watersheds.geojson','community-watersheds.csv','community-geography.html']
        file_records={n:{'bytes':(output/n).stat().st_size,'sha256':file_digest(output/n)} for n in file_names}
        entries_out=[{'id':'COMMUNITY_WATERSHED_GIS','kind':'vector','title':'Four-watershed community planning context',
             'role':'COMMUNITY_CONTEXT','uri':entry['uri'],'vintage':entry['vintage'],'path':'community-watersheds.gpkg',
             'sha256':file_records['community-watersheds.gpkg']['sha256'],'source_format':'GPKG','source_crs':features.crs,
             'layer':'community_watersheds','units':'Whole source block-group counts and separately labeled watershed geometry metrics',
             'companions':[{'path':n,'sha256':file_records[n]['sha256']} for n in file_names if n!='community-watersheds.gpkg'],
             'provenance':{'table_id':table['id'],'table_sha256':table['source']['sha256'],
                           'geometry_source_id':entry['id'],'geometry_sha256':entry['body']['sha256'],
                           'reader':features.reader_metadata}}]
        manifest={'schema':'upstate.sources/v1','title':'Four-watershed Community GIS production','captured_at':'2026-10-13',
                  'entries':entries_out,'notes':['Original polygon coordinates and original RFP whole-block-group context remain distinct.']}
        atomic_json(output/'sources.json',manifest,immutable=True)
        retained=w.import_sources(output/'sources.json')
        result={'schema':'upstate.community-gis/v1','project_id':w.project['id'],'table_id':table['id'],
                'source_collection_id':retained['id'],'source_id':'COMMUNITY_WATERSHED_GIS','features':len(rows),
                'rows':rows,'files':file_records,'native_crs':features.crs,'geojson_crs':'EPSG:4326'}
        atomic_json(result_file,result,immutable=True)
        return result


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--workspace',required=True,type=Path);p.add_argument('--production',required=True,type=Path);p.add_argument('--output',required=True,type=Path)
    a=p.parse_args()
    try:print(json.dumps(build(a.workspace,a.production,a.output),indent=2))
    except (OSError,ValueError,KeyError,TypeError) as error:p.exit(1,str(error)+'\n')
