"""Native-source-contract journey with constructed raster inputs, not regional runs.

The fixture supplies the inspected Workspace/common callable contract. It does
not load or impersonate an installed InVEST engine or claim native simulation.
"""
from contextlib import contextmanager
import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import shutil
import sys
import tempfile
import types
import unittest
from unittest.mock import patch

from model import landcover_workspace as component
from model.landcover_ledger import LedgerError, sha256_file
from test_landcover_journey import inputs


def digest(value):
    return hashlib.sha256(json.dumps(value,sort_keys=True,separators=(',',':')).encode()).hexdigest()


def identifier(value):
    if len(value)!=64 or any(c not in '0123456789abcdef' for c in value):
        raise ValueError('Bad retained identifier')
    return value


def read_json(path):return json.loads(Path(path).read_text())


def describe_file(root,path):
    path=Path(path)
    return {'path':path.relative_to(root).as_posix(),'bytes':path.stat().st_size,'sha256':sha256_file(path)}


def verify_file(root,descriptor):
    root=Path(root).resolve();p=(root/descriptor['path']).resolve(strict=True)
    if not p.is_relative_to(root) or p.stat().st_size!=descriptor['bytes'] or sha256_file(p)!=descriptor['sha256']:
        raise ValueError('Retained file changed')
    return p


@contextmanager
def held(path,blocking=False):
    import fcntl
    with Path(path).open('a') as stream:
        fcntl.flock(stream.fileno(),fcntl.LOCK_EX|(0 if blocking else fcntl.LOCK_NB))
        yield


class SourceContractWorkspace:
    def __init__(self,root):
        self.root=root;self.project={'id':'constructed-native-contract-workspace'}
        inputs(root)
        self.grid_id=digest('grid');self.collection=digest('collection')
        self.grid={'id':self.grid_id,'state':'complete','spec':{'title':'Constructed cells','source_collection_id':self.collection},'grid':{'crs':'EPSG:5070','resolution':30},'files':{}}
        grid_dir=root/'grids'/self.grid_id;grid_dir.mkdir(parents=True)
        shutil.copy2(root/'base.tif',grid_dir/'nlcd.tif');self.grid['files']['NLCD']=describe_file(grid_dir,grid_dir/'nlcd.tif')
        self.scenarios={digest('baseline'):{'id':digest('baseline'),'kind':'baseline','title':'Original baseline'},digest('landcover'):{'id':digest('landcover'),'kind':'landcover','title':'Retained edit'}}
        self.runs={}
        for kind in ('baseline','landcover'):
            sid=digest(kind);selection={'scenario_id':sid,'profile_id':digest('profile'),'grid_id':self.grid_id,'invest_version':'3.20.0'}
            rid=digest(selection);row={'id':rid,'selection':selection,'state':'prepared','stages':{},'artifacts':{}}
            directory=root/'runs'/rid;directory.mkdir(parents=True)
            if kind=='landcover':
                shutil.copy2(root/'scenario.tif',directory/'scenario_lulc.tif')
                row['stages']['landcover']={'artifact':describe_file(directory,directory/'scenario_lulc.tif')}
            self.runs[rid]=row
        self.source={'id':'captured-polygons','title':'Constructed watershed source','kind':'vector','vintage':'fixture','body':describe_file(root,root/'zones.geojson')}
    def inspect_run(self,key):return copy.deepcopy(self.runs[key])
    def get_grid(self,key):assert key==self.grid_id;return copy.deepcopy(self.grid)
    def _get(self,kind,key):assert kind=='scenarios';return copy.deepcopy(self.scenarios[key])
    def source_file(self,collection,source):assert collection==self.collection and source==self.source['id'];return verify_file(self.root,self.source['body']),copy.deepcopy(self.source)
    def overview(self):return {'runs':list(self.runs.values()),'scenarios':list(self.scenarios.values()),'sources':[{'id':self.collection,'entries':[self.source]}]}


class NativeContractJourney(unittest.TestCase):
    def test_original_operands_resume_operator_downloads_and_reopen(self):
        native=(digest,held,identifier,verify_file,describe_file,read_json)
        esri=types.ModuleType('model.spatial_esri');esri.is_esri_source=lambda p,e:False;esri.OriginalEsriFeatures=None
        with tempfile.TemporaryDirectory() as d,patch.object(component,'_native',return_value=native),patch.dict(sys.modules,{'model.spatial_esri':esri}):
            root=Path(d);ws=SourceContractWorkspace(root)
            ids={row['selection']['scenario_id']:row['id'] for row in ws.runs.values()}
            payload={'title':'NATIVE CONTRACT CONFORMANCE — constructed cells', 'baseline_run_id':ids[digest('baseline')],'alternative_run_ids':[ids[digest('landcover')]],'zones':{'source_collection_id':ws.collection,'source_id':ws.source['id'],'id_field':'huc12','name_field':'name'},'options':{'tile_size':17}}
            native_before=copy.deepcopy(ws.runs)
            def interrupt(state):
                if state['completed_tiles']==3:raise InterruptedError('Constructed worker interruption')
            with self.assertRaises(InterruptedError):component.build(ws,payload,progress=interrupt)
            result=component.build(ws,payload)
            self.assertEqual(result['zone_count'],2);self.assertEqual(result['alternative_count'],1)
            self.assertEqual(ws.runs,native_before)
            reopened=component.inspect(ws,result['id']);self.assertEqual(reopened['edition'],result)
            self.assertEqual(component.build(ws,payload),result)
            self.assertEqual(len(component.verify_all(ws)),1)
            self.assertEqual(component.catalog(ws)['editions'][0]['id'],result['id'])
            self.assertEqual(reopened['binding']['operands'][1]['basis'],'retained_landcover_stage')
            self.assertEqual(reopened['binding']['operands'][0]['basis'],'retained_grid_NLCD')
            zone=read_json(root/component.KIND/result['id']/'zones-original.geojson')['features'][0]
            self.assertEqual(zone['properties']['_source_properties']['huc12'],'000000000001')
            # Actual authored operator module and descriptor, with the inspected host callback contract.
            path=Path(component.__file__).parents[1]/'operator'/'landcover_operator.py'
            spec=importlib.util.spec_from_file_location('landcover_operator',path);adapter=importlib.util.module_from_spec(spec);spec.loader.exec_module(adapter)
            class Operator:
                def ws(self,key):assert key=='fixture';return ws
                def _ticket(self,key,path,body,title):
                    self.ws(key);self.assert_file(path,body)
                    return {'id':digest(str(path)),'workspace':key,'title':title,'url':'/api/download?fixture='+path.name}
                def assert_file(self,path,body):assert path.stat().st_size==body['bytes'] and sha256_file(path)==body['sha256']
            operator=Operator()
            read=adapter.read(operator,'fixture','edition',{'id':result['id']})
            self.assertNotIn('document',read)
            self.assertEqual(read['preview_url'],f"/api/file/landcover-ledger/fixture/{result['id']}?embedded=1")
            self.assertEqual(len(read['_downloads']),len(result['files']))
            preview_ticket,policy=adapter.preview(operator,'fixture',result['id'])
            self.assertEqual(preview_ticket['workspace'],'fixture');self.assertEqual(len(preview_ticket['id']),64)
            self.assertIn("default-src 'none'",policy);self.assertIn("script-src 'sha256-",policy)
            self.assertNotIn('unsafe-inline',policy);self.assertNotIn('allow-same-origin',policy)
            self.assertIn('allow-modals',policy)
            descriptor=json.loads((path.parent/'extensions'/'landcover-ledger.json').read_text())
            route=descriptor['backend']['file_routes'][0]
            self.assertEqual(route['response'],'ticket_policy_pair')
            context={'operator':operator,'route.workspace_key':'fixture','route.edition_id':result['id']}
            self.assertEqual(getattr(adapter,route['handler'])(*(context[key] for key in route['args'])),(preview_ticket,policy))
            with self.assertRaises(ValueError):adapter.preview(operator,'../fixture',result['id'])
            with self.assertRaises(ValueError):adapter.preview(operator,'fixture','../report.html')
            task=adapter.decorate_task(operator,{'workspace':'fixture','action':'landcover.ledger.build','state':'complete','result':result})
            self.assertEqual(len(task['_downloads']),len(result['files']))
            self.assertEqual(adapter.invoke(operator,'fixture','landcover.ledger.build',payload),result)
            # Full directory receiving preserves relative original source bindings.
            received=root.parent/(root.name+'-received')
            try:
                shutil.copytree(root,received);ws.root=received
                self.assertEqual(component.inspect(ws,result['id'])['edition'],result)
                self.assertEqual(len(component.verify_all(ws)),1)
            finally:shutil.rmtree(received,ignore_errors=True);ws.root=root
            bad=copy.deepcopy(payload);bad['alternative_run_ids']=[payload['baseline_run_id']]
            with self.assertRaises(LedgerError):component.build(ws,bad)
            raster=root/'runs'/payload['alternative_run_ids'][0]/'scenario_lulc.tif'
            with raster.open('ab') as stream:stream.write(b'changed')
            with self.assertRaises(ValueError):component.inspect(ws,result['id'])
