"""Small algorithm/receiving conformance journeys, not a regional model dataset."""
import copy
from dataclasses import replace
import json
from pathlib import Path
import tempfile
import unittest
import zipfile

import numpy as np
import rasterio
from rasterio.transform import Affine
from shapely.geometry import Polygon, box, mapping
import shapely

from model.landcover_ledger import (RasterInput, Options, LedgerError, run_ledger,
                                    coverage_weights, _pixel_polygons, CODES)
from model.landcover_exports import export_report, make_portable, receive_portable


def write_raster(path, array, transform, mask=None):
    with rasterio.open(path, 'w', driver='GTiff', width=array.shape[1], height=array.shape[0],
                       count=1, dtype=array.dtype, crs='EPSG:5070', transform=transform,
                       nodata=0, tiled=True, blockxsize=16, blockysize=16) as ds:
        ds.write(array, 1)
        if mask is not None:
            ds.write_mask(mask.astype(np.uint8)*255)


def inputs(root, height=47, width=61):
    transform = Affine(30, 0, 1000000, 0, -30, 1600000)
    rr, cc = np.indices((height, width))
    baseline = CODES[(rr//7 + cc//11) % len(CODES)]
    scenario = baseline.copy(); scenario[(rr+cc) % 5 == 0] = 41
    other = baseline.copy(); other[cc % 9 == 0] = 90
    baseline[1, 1] = 0; scenario[2, 2] = 0; other[3, 3] = 0
    for name, data in [('base',baseline), ('scenario',scenario), ('other',other)]:
        write_raster(root/(name+'.tif'), data, transform)
    x,y=transform.c,transform.f
    split = x+width*30*.473
    left = box(x-17, y-height*30+13, split, y+19)
    hole = box(x+60, y-270, x+101, y-208)
    left = left.difference(hole)
    right = Polygon([(split,y-height*30+13),(x+width*30-11,y-height*30+13),
                     (x+width*30-11,y-15),(split,y+19)])
    zones={'type':'FeatureCollection','crs':{'type':'name','properties':{'name':'EPSG:5070'}},'features':[
        {'type':'Feature','properties':{'huc12':'000000000001','name':'Conformance west'},'geometry':mapping(left)},
        {'type':'Feature','properties':{'huc12':'000000000002','name':'Conformance east'},'geometry':mapping(right)}]}
    (root/'zones.geojson').write_text(json.dumps(zones))
    return baseline,scenario,other,transform,[left,right]


class Journeys(unittest.TestCase):
    def test_fractional_restart_exports_receiving(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d); base,scenario,other,t,geoms=inputs(root)
            specs={'restoration':RasterInput(root/'scenario.tif'),'wetland':RasterInput(root/'other.tif')}
            opts=Options(tile_size=17,title='ENGINE CONFORMANCE — constructed cells, not Upper Savannah results')
            output=root/'ledger'
            def interrupt(s):
                if s['completed_tiles']==3: raise KeyboardInterrupt
            with self.assertRaises(KeyboardInterrupt):
                run_ledger(RasterInput(root/'base.tif'),specs,root/'zones.geojson',output,options=opts,progress=interrupt)
            self.assertEqual(json.loads((output/'status.json').read_text())['completed_tiles'],3)
            result=run_ledger(RasterInput(root/'base.tif'),specs,root/'zones.geojson',output,options=replace(opts,resume=True))
            # Independent brute-force full pixel/polygon intersection reference.
            rr,cc=np.indices(base.shape); pixels=_pixel_polygons(rr.ravel(),cc.ravel(),t)
            for geom,zid in [(shapely.union_all(geoms),'__domain__'),*zip(geoms,['000000000001','000000000002'])]:
                w=shapely.area(shapely.intersection(pixels,geom)).reshape(base.shape)/10000
                valid=(base!=0)&(scenario!=0)&(other!=0)
                row=next(r for r in result['rows'] if r['zone_id']==zid and r['scenario']=='restoration')
                self.assertAlmostEqual(row['changed_ha'],float(w[valid&(base!=scenario)].sum()),9)
                self.assertAlmostEqual(row['support']['analysis_valid_ha'],float(w[valid].sum()),9)
                self.assertAlmostEqual(row['support']['covered_ha'],float(w.sum()),9)
            transition=result['rasters']['transitions']['restoration']
            with rasterio.open(output/transition) as ds:
                codes=ds.read(1)
            with rasterio.open(output/'study-area-fraction.tif') as ds:
                fractions=ds.read(1)
            expected=base.astype(np.uint16)*100+scenario
            expected[~((base!=0)&(scenario!=0)&(other!=0)&(fractions>0))]=0
            np.testing.assert_array_equal(codes,expected)
            one=run_ledger(RasterInput(root/'base.tif'),specs,root/'zones.geojson',root/'one-tile',options=replace(opts,tile_size=512))
            for a,b in zip(result['rows'],one['rows']):
                self.assertAlmostEqual(a['changed_ha'],b['changed_ha'],9)
                self.assertEqual(a['zone_id'],b['zone_id'])
            export_report(output)
            self.assertIn('ENGINE CONFORMANCE',(output/'report.html').read_text())
            make_portable(output,root/'portable.zip')
            receive_portable(root/'portable.zip',root/'received')
            self.assertEqual((root/'received'/'ledger.json').read_bytes(),(output/'ledger.json').read_bytes())
            self.assertEqual((root/'received'/transition).read_bytes(),(output/transition).read_bytes())
            with self.assertRaises(LedgerError): receive_portable(root/'portable.zip',root/'received')

    def test_rotated_cells_slivers_and_holes(self):
        transform=Affine.translation(1000000,1600000)*Affine.rotation(19)*Affine.scale(30,-30)
        height,width=27,39
        # Geometry deliberately cuts cell corners and includes a subpixel strip.
        outer=Polygon([transform*p for p in [(1.2,1.3),(35.7,2.1),(33.2,25.1),(2.4,23.8)]])
        hole=Polygon([transform*p for p in [(8.2,8.2),(11.4,8.2),(11.4,11.9),(8.2,11.9)]])
        geom=outer.difference(hole)
        weights=coverage_weights(geom,transform,height,width)
        rr,cc=np.indices(weights.shape)
        reference=shapely.area(shapely.intersection(_pixel_polygons(rr.ravel(),cc.ravel(),transform),geom)).reshape(weights.shape)/900
        np.testing.assert_allclose(weights,reference,atol=3e-11,rtol=1e-10)
        self.assertAlmostEqual(weights.sum()*900,geom.area,5)

    def test_invalid_grid_unknown_support_and_changed_source(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d); base,scenario,other,t,_=inputs(root)
            scenario[10,10]=99;write_raster(root/'scenario.tif',scenario,t)
            specs={'A':RasterInput(root/'scenario.tif')};opts=Options(tile_size=19,write_rasters=False)
            with self.assertRaisesRegex(LedgerError,'Unsupported NLCD'):
                run_ledger(RasterInput(root/'base.tif'),specs,root/'zones.geojson',root/'strict',options=opts)
            result=run_ledger(RasterInput(root/'base.tif'),specs,root/'zones.geojson',root/'exclude',options=replace(opts,unknown_policy='exclude'))
            row=next(r for r in result['rows'] if r['zone_id']=='__domain__')
            self.assertAlmostEqual(row['support']['scenario_unknown_class_ha'],.09,9)
            self.assertAlmostEqual(row['support']['baseline_only_ha'],.18,9)
            scenario[10,10]=41;write_raster(root/'scenario.tif',scenario,t)
            with self.assertRaisesRegex(LedgerError,'Input bytes'):
                run_ledger(RasterInput(root/'base.tif'),specs,root/'zones.geojson',root/'exclude',options=replace(opts,resume=True,unknown_policy='exclude'))
            write_raster(root/'shifted.tif',scenario,t*Affine.translation(.25,0))
            with self.assertRaisesRegex(LedgerError,'grid mismatch'):
                run_ledger(RasterInput(root/'base.tif'),{'X':RasterInput(root/'shifted.tif')},root/'zones.geojson',root/'shift',options=opts)

    def test_pair_common_and_unique_overlapping_domain(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);base,sc,ot,t,geoms=inputs(root)
            data=json.loads((root/'zones.geojson').read_text())
            data['features'][1]['geometry']=mapping(geoms[0].buffer(15))
            (root/'overlap.geojson').write_text(json.dumps(data))
            specs={'A':RasterInput(root/'scenario.tif'),'B':RasterInput(root/'other.tif')}
            with self.assertRaisesRegex(LedgerError,'Overlapping zone'):
                run_ledger(RasterInput(root/'base.tif'),specs,root/'overlap.geojson',root/'no-overlap',options=Options(write_rasters=False))
            r=run_ledger(RasterInput(root/'base.tif'),specs,root/'overlap.geojson',root/'overlap',options=Options(allow_overlap=True,support_scope='pair',write_rasters=False))
            domain=next(z for z in r['zones'] if z['id']=='__domain__')
            self.assertLess(domain['geometry_ha'],sum(z['geometry_ha'] for z in r['zones'] if z['id']!='__domain__'))
            for row in r['rows']:
                self.assertAlmostEqual(row['support']['pair_common_valid_ha'],row['support']['analysis_valid_ha'],9)

if __name__=='__main__': unittest.main(verbosity=2)
