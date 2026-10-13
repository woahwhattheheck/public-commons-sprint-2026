"""Full design/receiving and revision checks; fixtures exercise editing, not ECO modeling."""
import copy
import io
import json
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from engine import *
from server import Store, Conflict

def fixture():
    def ring(x,y,w,h,z=False):
        r=[[x,y],[x+w,y],[x+w,y+h],[x,y+h],[x,y]]
        return [p+[27] for p in r] if z else r
    return {"type":"FeatureCollection", "name":"EDITOR FIXTURE — not model data", "custom":{"keep":True}, "features":[
      {"type":"Feature","id":"north-9","properties":{"name":"North field","cn":78,"usle_p":0.8,"tags":["retain",1],"zero":0},"geometry":{"type":"Polygon","coordinates":[ring(-82.0,34.0,.01,.007),ring(-81.997,34.002,.002,.002)]}},
      {"type":"Feature","id":200,"properties":{"name":"River parcels","cn":82,"usle_p":0.9,"null":None},"geometry":{"type":"MultiPolygon","coordinates":[[ring(-81.987,34.001,.003,.002,True)],[ring(-81.987,34.005,.003,.002,True)]]}}
    ]}

def design():
    p=new_project(fixture(),'Editor acceptance fixture','editor-fixture.geojson')
    p['parameters']=[{'id':'cn','property':'cn','label':'Curve number','unit':'dimensionless','min':1,'max':100}]
    p['alternatives']=[{'id':'designA','title':'Riparian design','description':'Explicit input changes','edits':{'f_000001':{'values':{'cn':72},'note':'Authored scenario input'}},'additions':[]}]
    return p

class DesignJourney(unittest.TestCase):
    def test_complete_receive_edit_and_reexport(self):
        p=design(); before=copy.deepcopy(p['baseline']); base=realize(p)
        changed=realize(p,'designA')
        self.assertEqual(changed['features'][0]['properties']['cn'],72)
        self.assertEqual(changed['features'][1],base['features'][1])
        self.assertEqual(changed['features'][0]['geometry'],base['features'][0]['geometry'])
        blob=export_bundle(p); recv=receive_bundle(blob)
        self.assertEqual(recv,p);self.assertEqual(blob,export_bundle(p))
        recv['alternatives'][0]['edits']['f_000001']['values']['cn']=69
        self.assertEqual(receive_bundle(export_bundle(recv)),recv)
        self.assertEqual(p['baseline'],before);self.assertEqual(realize(p,'designA')['features'][0]['properties']['cn'],72)
        with zipfile.ZipFile(io.BytesIO(blob)) as z:
            handoff=json.loads(z.read('handoff.json'))
            self.assertEqual(handoff['alternatives'][0]['feature_keys_in_order'],['f_000001','f_000002'])
            self.assertIn(b'72',z.read('actions.csv'))
    def test_geometry_parts_holes_z_and_bbox(self):
        p=design();g=copy.deepcopy(p['baseline']['collection']['features'][1]['geometry'])
        g['coordinates'][0][0][1][0]+=.0005
        p['alternatives'][0]['edits']['f_000002']={'geometry':g}
        value=realize(p,'designA');self.assertEqual(value['features'][1]['geometry'],g)
        self.assertEqual(value['features'][0]['geometry']['coordinates'][1],fixture()['features'][0]['geometry']['coordinates'][1])
        info=geometry_info(fixture()['features'][0]['geometry'])
        reversed_g=copy.deepcopy(fixture()['features'][0]['geometry'])
        for ring in reversed_g['coordinates']:ring.reverse()
        self.assertAlmostEqual(info['area_m2'],geometry_info(reversed_g)['area_m2'],places=4)
        self.assertGreater(info['area_ha'],0)
    def test_added_excluded_and_parameter_validation(self):
        p=design();f=copy.deepcopy(fixture()['features'][0]);f['id']='added'
        p['alternatives'][0]['additions']=[{'key':'new1','feature':f}]
        p['alternatives'][0]['edits']['f_000002']={'excluded':True}
        p['alternatives'][0]['edits']['new1']={'values':{'cn':50}}
        value=realize(p,'designA');self.assertEqual(len(value['features']),2)
        self.assertEqual(value['features'][-1]['properties']['cn'],50)
        self.assertEqual(receive_bundle(export_bundle(p)),p)
        p['alternatives'][0]['edits']['new1']['values']['cn']=101
        with self.assertRaises(DesignError): validate_project(p)
    def test_invalid_geometry_and_crs(self):
        p=fixture();p['crs']={'type':'name','properties':{'name':'EPSG:3857'}}
        with self.assertRaises(DesignError):new_project(p,'Bad')
        g={'type':'Polygon','coordinates':[[[0,0],[1,1],[1,0],[0,1],[0,0]]]}
        with self.assertRaises(DesignError):geometry_info(g)
        g={'type':'Polygon','coordinates':[[[179,0],[-179,0],[-179,1],[179,1],[179,0]]]}
        with self.assertRaises(DesignError):geometry_info(g)
    def test_transactional_revision_conflicts_and_restart(self):
        with tempfile.TemporaryDirectory() as tmp:
            path=Path(tmp)/'store.sqlite3';store=Store(path);p=design()
            first=store.save(p,0,create=True);self.assertEqual(first['revision'],1)
            stale=copy.deepcopy(p);p['title']='Changed';second=store.save(p,1);self.assertEqual(second['revision'],2)
            with self.assertRaises(Conflict):store.save(stale,1)
            self.assertEqual(Store(path).get(p['id'])['project'],p)
            self.assertEqual(store.revision(p['id'],1),stale)
            self.assertEqual(len(store.history(p['id'])),2)
            p['baseline']['source']['filename']='changed'
            with self.assertRaises(Conflict):store.save(p,2)
    def test_tamper_and_csv_html_safety(self):
        p=design();p['title']='<script>alert(1)</script>'
        p['alternatives'][0]['title']='=BAD()';blob=export_bundle(p)
        with zipfile.ZipFile(io.BytesIO(blob)) as z:
            self.assertNotIn(b'<script>',z.read('design-summary.html'))
            self.assertIn(b"'=BAD()",z.read('actions.csv'))
            contents={x:z.read(x) for x in z.namelist()}
        contents['baseline.geojson']+=b' '
        out=io.BytesIO()
        with zipfile.ZipFile(out,'w') as z:
            for k,v in contents.items():z.writestr(k,v)
        with self.assertRaises(DesignError):receive_bundle(out.getvalue())

if __name__=='__main__':unittest.main(verbosity=2)
