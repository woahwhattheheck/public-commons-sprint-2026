"""Original-operator lifecycle with native-shaped file fixtures, not hydrology."""
from __future__ import annotations
import ast
import contextlib
import hashlib
import json
import os
from pathlib import Path
import shutil
import tempfile
import threading
import time
import traceback
import unittest
from types import SimpleNamespace
from ecsa_runs.upstate import integrate_operator, retention_for
from ecsa_runs.workspace_adapter import WorkspaceRetention


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True).encode()).hexdigest()


def atomic_json(path, value):
    path = Path(path); path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + '.pending')
    tmp.write_text(json.dumps(value, sort_keys=True)); os.replace(tmp, path)


class NativeFileFixture:
    """Predictable file-producing executor solely to exercise the original queue."""
    def __init__(self, root, create=False):
        self.root = Path(root)
        self.calls = 0
        if create:
            self.root.mkdir()
            atomic_json(self.root / 'workspace.json', {'schema':'fixture', 'id':'original-project-id', 'title':'Protocol exercise'})
        self.project = json.loads((self.root / 'workspace.json').read_text())

    def _get(self, kind, key):
        return {**json.loads((self.root / kind / (key+'.json')).read_text()), 'id':key}

    def get_grid(self, key):
        return json.loads((self.root / 'grids' / key / 'grid.json').read_text())

    def inspect_run(self, key):
        return json.loads((self.root / 'runs' / key / 'run.json').read_text())

    def run(self, key):
        self.calls += 1
        state = self.inspect_run(key)
        directory = self.root / 'runs' / key
        models = state['selection'].get('models', ['ndr','sdr'])
        for name, body in [('ndr/n_total_export.tif', b'protocol-output'*100000),
                           ('ndr/n_total_export.tif.aux.xml', b'<PAMDataset/>'),
                           ('sdr/sed_export.tif', b'sediment-protocol-output')]:
            if name.split('/')[0] not in models: continue
            path = directory / name; path.parent.mkdir(parents=True, exist_ok=True); path.write_bytes(body)
        state.update(state='complete', artifacts={'nitrogen_export':{'path':'ndr/n_total_export.tif',
            'bytes':1400000,'sha256':hashlib.sha256(b'protocol-output'*100000).hexdigest()}},
            stages={name:{'registry_ids':['n_total_export' if name=='ndr' else 'sed_export']} for name in models})
        atomic_json(directory/'run.json', state)
        return state

    def compare_runs(self, ids):
        return {'original_compare_called_with': ids}

    def prepare(self):
        source = {'original_manifest':None,'entries':[]}
        for name, body in [('manifest.json',b'{"native":"source-manifest"}'),('weather.csv',b'day,precipitation\n1,2.5\n'),('mask.gpkg',b'polygon-protocol-file')]:
            sha=hashlib.sha256(body).hexdigest();path=self.root/'objects'/sha
            path.parent.mkdir(exist_ok=True);path.write_bytes(body)
            desc={'object':'objects/'+sha,'sha256':sha,'bytes':len(body),'filename':name}
            if name=='manifest.json':source['original_manifest']=desc
            else:source['entries'].append({'id':name,'body':desc,'companions':[]})
        collection=digest(source);atomic_json(self.root/'sources'/(collection+'.json'), source)
        profile={'source_collection_id':collection,'ndr':{'k_param':2},'sdr':{'k_param':2},'biophysical_source_id':'weather.csv'}
        scenario={'source_collection_id':collection,'kind':'baseline','patches':[]}
        profile_id=digest(profile);scenario_id=digest(scenario)
        atomic_json(self.root/'profiles'/(profile_id+'.json'),profile)
        atomic_json(self.root/'scenarios'/(scenario_id+'.json'),scenario)
        grid_id=digest('grid');directory=self.root/'grids'/grid_id;directory.mkdir(parents=True)
        (directory/'dem.tif').write_bytes(b'grid-protocol-file')
        grid={'id':grid_id,'state':'complete','spec':{'source_collection_id':collection},
              'files':{'DEM':{'path':'dem.tif','sha256':hashlib.sha256(b'grid-protocol-file').hexdigest(),'bytes':18}}}
        atomic_json(directory/'grid.json',grid)
        selection={'grid_id':grid_id,'scenario_id':scenario_id,'profile_id':profile_id,'invest_version':'3.20.0'}
        run_id=digest(selection)
        atomic_json(self.root/'runs'/run_id/'run.json',{'schema':'upstate.run/v1','id':run_id,
                    'state':'prepared','selection':selection,'stages':{},'artifacts':{}})
        return run_id


class OriginalOperatorJourney(unittest.TestCase):
    def test_original_queue_loss_recovery_portable_native_reopening(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)
            server=root/'server.py'
            original=Path(__file__).with_name('original_operator_seam.py').read_bytes()
            server.write_bytes(original)
            before=ast.parse(original)
            receipt=integrate_operator(server,write=True)
            self.assertEqual(receipt['changed_call_sites'],1)
            self.assertEqual(integrate_operator(server,write=True)['state'],'already_integrated')
            after=ast.parse(server.read_bytes())
            self.assertEqual(ast.dump(before.body[1].body[0]),ast.dump(after.body[1].body[0]))
            lost={'remaining':1}
            def completion_write(path,value):
                if value.get('state')=='complete' and '/tasks/' in str(path) and lost['remaining']:
                    lost['remaining']-=1
                    raise OSError('injected lost original operator success write')
                atomic_json(path,value)
            env={'Path':Path,'contextlib':contextlib,'traceback':traceback,'shutil':shutil,
                 'now':lambda:time.time(),'atomic_json':completion_write,
                 'summary_error':lambda e:({'code':'FIXTURE','message':str(e)},500),
                 'CUSTOMER_REVIEW_ACTIONS':set(),'required':lambda d,k:d[k]}
            exec(compile(server.read_bytes(),str(server),'exec'),env)
            op=env['Operator']();op.root=root/'operator';op.root.mkdir()
            op.lock=threading.RLock();op.gates={'workspace':threading.RLock()};op.closing=False
            ws=NativeFileFixture(root/'native',True);run_id=ws.prepare()
            op.ws=lambda key:ws
            key=digest('original-upstream-task')
            taskfile=op.root/'tasks'/(key+'.json')
            atomic_json(taskfile,{'id':key,'workspace':'workspace','action':'run.start',
                 'payload':{'run_id':run_id},'state':'queued','attempts':[]})
            op.task=lambda job:json.loads((op.root/'tasks'/(job+'.json')).read_text())
            with self.assertRaisesRegex(OSError,'lost original operator'):op._perform(key)
            self.assertEqual(ws.calls,1)
            native_result=ws.inspect_run(run_id)
            # Success had reached retention but not the original task's final write.
            task=op.task(key);self.assertEqual(task['state'],'running')
            deleted=ws.root/'runs'/run_id/'ndr'/'n_total_export.tif'
            deleted.unlink()
            task['state']='queued';atomic_json(taskfile,task)
            op._perform(key)
            task=op.task(key)
            self.assertEqual(ws.calls,1)  # No second native execution.
            self.assertEqual(task['state'],'complete');self.assertTrue(deleted.exists())
            self.assertEqual(task['result'],native_result)
            self.assertEqual(task['retention']['recovered_from_attempt'],1)
            self.assertEqual(len(task['attempts']),2)
            self.assertEqual(op._invoke({'action':'run.compare','payload':{'run_ids':[run_id,'other']},'workspace':'workspace'}),
                             {'original_compare_called_with':[run_id,'other']})
            retained=retention_for(op,ws)
            self.assertEqual(retained.store.list(),[])
            archive=root/'native-complete.ecsar';retained.export(archive)
            # Remove BOTH original native project and operator/retention state.
            shutil.rmtree(ws.root);shutil.rmtree(op.root)
            received=WorkspaceRetention.receive(archive,root/'received-store',retained.namespace)
            result=received.restore_native(key,root/'received-native')
            reopened=NativeFileFixture(root/'received-native')
            self.assertEqual(reopened.inspect_run(run_id),native_result)
            self.assertTrue((reopened.root/'runs'/run_id/'ndr'/'n_total_export.tif.aux.xml').exists())
            self.assertEqual(reopened.project['id'],'original-project-id')
            self.assertEqual(result['members'],13)
            # An independently edited received scenario is a new original run,
            # while the received baseline and its complete outputs remain intact.
            edited_scenario = dict(reopened._get('scenarios', native_result['selection']['scenario_id']))
            edited_scenario.pop('id'); edited_scenario['title'] = 'Independent received scenario'
            scenario_id = digest(edited_scenario)
            atomic_json(reopened.root/'scenarios'/(scenario_id+'.json'), edited_scenario)
            changed_selection = {**native_result['selection'], 'scenario_id': scenario_id, 'models':['ndr']}
            next_run = digest(changed_selection)
            atomic_json(reopened.root/'runs'/next_run/'run.json', {'schema':'upstate.run/v1',
                'id':next_run,'state':'prepared','selection':changed_selection,'stages':{},'artifacts':{}})
            branch = env['Operator'](); branch.root=root/'branch-operator'; branch.root.mkdir()
            branch.lock=threading.RLock(); branch.gates={'workspace':threading.RLock()}; branch.closing=False
            branch.ws=lambda key:reopened
            branch.task=lambda job:json.loads((branch.root/'tasks'/(job+'.json')).read_text())
            next_job=digest('independent-received-task')
            atomic_json(branch.root/'tasks'/(next_job+'.json'), {'id':next_job,'workspace':'workspace',
                'action':'run.start','payload':{'run_id':next_run},'state':'queued','attempts':[]})
            branch._perform(next_job)
            self.assertEqual(branch.task(next_job)['state'],'complete')
            self.assertEqual(reopened.calls,1)
            self.assertEqual(branch.task(next_job)['retention']['model_family'],'InVEST_NDR')
            self.assertNotIn('sdr', reopened.inspect_run(next_run)['stages'])
            self.assertEqual(reopened.inspect_run(run_id), native_result)
            self.assertEqual(reopened.inspect_run(next_run)['selection']['scenario_id'], scenario_id)
            # Conflict preflight cannot silently overwrite an independent edit.
            altered=reopened.root/'runs'/run_id/'sdr'/'sed_export.tif'
            altered.write_bytes(b'independent-edit')
            missing=reopened.root/'runs'/run_id/'ndr'/'n_total_export.tif';missing.unlink()
            with self.assertRaisesRegex(ValueError,'differs'):
                received.restore_native(key,reopened.root,repair_missing=True)
            self.assertFalse(missing.exists());self.assertEqual(altered.read_bytes(),b'independent-edit')
            print(json.dumps({'journey':'original_operator_native_tree','native_calls':1,'operator_attempts':2,
                 'received_files':result['members'],'queue_jobs_added':0,'changed_call_sites':1,'independent_received_run':True}))
