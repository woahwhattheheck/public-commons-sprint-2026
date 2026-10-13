"""Adapter filesystem journeys against the published v5 writer contract.

FixtureWorkspace implements the exact exposed scenario serialization contract;
this exercises adapter IO/receiving, not the installed ECO modeling dependencies.
"""
import copy,json,tempfile,unittest,sys
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from engine import new_project,encode,DesignError
from eco_bridge import compile_plan,register_original,receive_materialized,geometry_inputs
from test_journey import fixture

class FixtureWorkspace:
    @classmethod
    def open(cls,root):
        x=cls();x.root=Path(root);x.manifest=json.loads((x.root/'workspace.json').read_text())
        x.scenarios={s['id']:convert(s) for s in x.manifest.get('scenarios',[])};return x
    def put_scenario(self,scenario):
        self.scenarios[scenario.id]=scenario
        self.manifest['scenarios']=[{'id':s.id,'name':s.name,'description':s.description,
            'actions':[dict(kind=a.kind,layer=a.layer,selector=a.selector,params=a.params) for a in s.actions],
            'metadata':s.metadata} for s in self.scenarios.values()]
        (self.root/'workspace.json').write_text(json.dumps(self.manifest,indent=2))

def convert(s):
    return SimpleNamespace(id=s['id'],name=s['name'],description=s.get('description',''),
        actions=[SimpleNamespace(**a) for a in s['actions']],metadata=s.get('metadata',{}))

def project():
    fields=fixture()
    for i,f in enumerate(fields['features']):f['properties'].update(field_id='A'+str(i+1),forest_density_multiplier=1.0)
    p=new_project(fields,'Adapter acceptance')
    p['parameters']=[dict(id='density',property='forest_density_multiplier',label='Density',unit='factor',min=0,max=2)]
    p['alternatives']=[dict(id='woodland',title='Lower density',description='Explicit factors',
          edits={'f_000001':{'values':{'density':0.9}}},additions=[])]
    return p

class NativeBridgeJourney(unittest.TestCase):
    def test_register_receive_edit_and_original_retention(self):
        with tempfile.TemporaryDirectory() as td,patch('eco_bridge._native',return_value=(FixtureWorkspace,convert)):
            root=Path(td)/'original';root.mkdir();(root/'data').mkdir();p=project()
            fields=encode(p['baseline']['collection']);(root/'data/fields.geojson').write_bytes(fields)
            (root/'data/source-table.csv').write_text('field_id,forest_density\nA1,1\nA2,1\n')
            manifest={'schema':'eco-forest-density-v1','dataset_id':'adapter-fixture',
             'datasets':{'fields':{'path':'data/fields.geojson','format':'geojson','id_field':'field_id'},
                         'forest_density':{'path':'data/source-table.csv','format':'csv'}},
             'parameters':{'forest_corr_sigma_km':20.0,'county_volume_bias_sigma':0.12,'stand_mult_sigma':0.15,'county_mult_rho':0.35},
             'scenarios':[{'id':'baseline','name':'Baseline','description':'','actions':[],'metadata':{}}]}
            (root/'workspace.json').write_bytes(encode(manifest))
            fm={'forest_density_multiplier':'forest_density_multiplier'}
            plan=compile_plan(p,'woodland',fm)
            self.assertEqual(plan['scenario']['actions'],[{'kind':'set_factor','layer':'fields',
               'selector':{'field_id':['A1']},'params':{'factor':'forest_density_multiplier','value':0.9}}])
            result=register_original(p,plan,Path(td),root);self.assertEqual(result['status'],'created')
            self.assertEqual(register_original(p,plan,Path(td),root)['status'],'already-present')
            before={str(x.relative_to(root)):x.read_bytes() for x in root.rglob('*') if x.is_file()}
            p['alternatives'][0]['edits']['f_000001']['geometry']=copy.deepcopy(p['baseline']['collection']['features'][0]['geometry'])
            p['alternatives'][0]['edits']['f_000001']['geometry']['coordinates'][0][1][0]+=.0005
            added=copy.deepcopy(p['baseline']['collection']['features'][1]);added['id']='new-native-A3';added['properties']['field_id']='A3'
            p['alternatives'][0]['additions']=[{'key':'newA3','feature':added}]
            p['alternatives'][0]['edits']['newA3']={'values':{'density':1.1}}
            plan=compile_plan(p,'woodland',fm,materialized_inputs=True)
            out=receive_materialized(p,plan,Path(td),root,Path(td)/'received')
            dest=Path(out['workspace']);saved=FixtureWorkspace.open(dest)
            self.assertEqual(saved.manifest['parameters'],manifest['parameters'])
            self.assertEqual(list(saved.scenarios),[plan['scenario']['id']])
            self.assertEqual(json.loads((dest/'data/fields.geojson').read_text()),geometry_inputs(p,'woodland'))
            self.assertEqual((dest/'design-handover/original-fields.geojson').read_bytes(),fields)
            self.assertTrue((dest/'design-handover/editable-design.zip').is_file())
            self.assertEqual(before,{str(x.relative_to(root)):x.read_bytes() for x in root.rglob('*') if x.is_file()})
            with self.assertRaises(DesignError):receive_materialized(p,plan,Path(td),root,dest)
    def test_complete_mapping_and_identifier_ambiguity(self):
        p=project()
        with self.assertRaises(DesignError):compile_plan(p,'woodland',{})
        p['baseline']['collection']['features'][1]['properties']['field_id']='A1'
        from engine import digest
        p['baseline']['source']['canonical_collection_sha256']=digest(p['baseline']['collection'])
        with self.assertRaises(DesignError):compile_plan(p,'woodland',{'forest_density_multiplier':'forest_density_multiplier'})

if __name__=='__main__':unittest.main(verbosity=2)
