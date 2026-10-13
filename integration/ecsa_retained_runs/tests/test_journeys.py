from __future__ import annotations
import dataclasses
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import unittest
import numpy as np
import pandas as pd
from ecsa_runs import codec
from ecsa_runs.gateway import RunGateway,RetainedProvider
from ecsa_runs.store import RunStore
from ecsa_runs.archive import export_workspace,receive_workspace
from ecsa_runs.comparison import compare_runs
from ecsa_runs.bindings import repair_bc10_source

class Journeys(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name)
        self.code=self.root/'code';self.code.mkdir();self.data=self.root/'data';self.data.mkdir()
        shutil.copyfile(Path(__file__).with_name('provider_fixture.py'),self.code/'original_provider.py')
        (self.data/'retained.txt').write_text('original data')
        self.weather=self.root/'weather.csv';self.weather.write_text('id,rain\n001,2.3\n')
        self.g=RunGateway(self.root/'workspace');self.g.configure(self.code/'original_provider.py',self.data)
    def tearDown(self):self.temp.cleanup()
    def queue(self,**kw):
        kind=kw.pop('kind','baseline');name=kw.pop('name','Baseline');key=kw.pop('request_key',None)
        return self.g.submit('fixture-family',{'weather_csv':str(self.weather),**kw},kind=kind,name=name,request_key=key,result_file_fields=['/native_output'])

    def test_warm_batch_retained_compare_report_receive(self):
        jobs=[self.queue(rows=6000,value=i,name=f'Run {i}',kind='scenario' if i else 'baseline') for i in range(6)]
        original_weather=self.weather.read_bytes();self.weather.write_text('later file change')
        started=time.monotonic();counts=self.g.execute([j['id'] for j in jobs],workers=2)
        self.assertEqual(counts,{'complete':6})
        results=[self.g.store.result(j['id']) for j in jobs]
        self.assertEqual(len({r['pid'] for r in results}),2)
        self.assertGreater(max(r['warm_count'] for r in results),1)
        for r in results:
            self.assertEqual(r['weather_received'],original_weather)
            self.assertEqual(r['spatial'].iloc[0]['source_cell_id'],'000000')
            self.assertEqual(len(r['spatial']),6000)
            self.assertEqual((Path(r['native_output'])/'result.bin').stat().st_size,1048576)
            self.assertTrue(any(e['kind']=='native_stage' for e in self.g.store.events(r['_ecsa_execution']['job_id'])))
        self.g.select(jobs[-1]['id']);cmp=self.g.comparison(jobs[0]['id'],jobs[-1]['id'])
        self.assertEqual(cmp['metrics'].iloc[0]['delta'],5)
        self.assertTrue(cmp['spatial_delta']['nitrate_delta_mg_l'].eq(5).all())
        reopened=RunGateway(self.g.store.root)
        self.assertEqual(reopened.active()['run_id'],results[-1]['run_id'])
        pd.testing.assert_frame_equal(reopened.current_comparison()['metrics'],cmp['metrics'])
        report=self.g.export_report(self.root/'report',jobs[0]['id'],jobs[-1]['id'])
        self.assertEqual(len(report['runs']),2)
        packet=codec.loads((self.root/'report'/jobs[0]['id']/'complete-result.json').read_bytes())
        exported=Path(packet['result']['native_output'])
        self.assertFalse(exported.is_absolute())
        self.assertEqual((self.root/'report'/jobs[0]['id']/exported/'result.bin').stat().st_size,1048576)
        archive=self.root/'project.ecsar';export_workspace(self.g.store,archive)
        shutil.rmtree(self.g.store.root);shutil.rmtree(self.code);shutil.rmtree(self.data);self.weather.unlink()
        received=receive_workspace(archive,self.root/'received');r=RunGateway(received.root)
        self.assertEqual(r.active()['run_id'],results[-1]['run_id'])
        self.assertEqual((Path(r.active()['native_output'])/'result.bin').stat().st_size,1048576)
        pd.testing.assert_frame_equal(r.current_comparison()['spatial_delta'],cmp['spatial_delta'])
        # New independent run uses preserved snapshots and previously captured weather.
        oldspec=received.read(received.get(jobs[0]['id'])['spec_sha']);oldspec['name']='Independent edit';oldspec['inputs']['value']=11
        edit=received.submit(oldspec)
        self.assertEqual(r.execute([edit['id']],workers=1),{'complete':1})
        self.assertEqual(r.store.result(edit['id'])['metrics'].iloc[0]['value'],11)
        print(json.dumps({'journey':'warm_batch_receive_edit','runs':6,'rows_per_run':6000,'workers':2,'elapsed_seconds':round(time.monotonic()-started,3),'archive_bytes':archive.stat().st_size}),flush=True)

    def test_lease_fence_recovery_crash_and_cancel(self):
        job=self.queue(value=8);a=self.g.store.claim('dead',lease_seconds=.04,job_ids=[job['id']]);time.sleep(.06)
        self.g.store.recover();b=self.g.store.claim('new',job_ids=[job['id']])
        self.assertNotEqual(a['lease_token'],b['lease_token'])
        self.assertFalse(self.g.store.finish(job['id'],a['lease_token'],error='stale'))
        self.g.store.finish(job['id'],b['lease_token'],error='reset');self.g.store.retry(job['id'])
        crash=self.queue(crash_once=True)
        self.assertEqual(self.g.execute([job['id'],crash['id']],workers=1),{'complete':2})
        self.assertEqual(self.g.store.get(crash['id'])['attempt'],2)
        slow=self.queue(sleep=20);errors=[]
        def execute():
            try:self.g.execute([slow['id']],workers=1,lease_seconds=1,poll_seconds=.03)
            except BaseException as e:errors.append(e)
        t=threading.Thread(target=execute);t.start()
        deadline=time.monotonic()+10
        while self.g.store.get(slow['id'])['state']!='running':
            self.assertLess(time.monotonic(),deadline);time.sleep(.02)
        self.g.store.cancel(slow['id']);t.join(5)
        self.assertFalse(t.is_alive());self.assertFalse(errors)
        self.assertEqual(self.g.store.get(slow['id'])['state'],'cancelled')
        self.assertTrue(any(e['kind']=='lease_recovered' for e in self.g.store.events(job['id'])))

    def test_source_mutation_and_idempotency(self):
        job=self.queue(value=4,request_key='caller-42')
        duplicate=self.queue(value=4,request_key='caller-42');self.assertEqual(job['id'],duplicate['id'])
        with self.assertRaises(ValueError):self.queue(value=5,request_key='caller-42')
        bad=self.queue(mutate=True)
        self.g.execute([bad['id']],workers=1)
        self.assertEqual(self.g.store.get(bad['id'])['state'],'failed')
        self.assertEqual((self.data/'retained.txt').read_text(),'original data')
        # The failed worker cannot poison another run's copy or immutable snapshot.
        self.assertEqual(self.g.execute([job['id']],workers=1),{'complete':1})

    def test_codec_comparison_and_manifest(self):
        import geopandas as gpd
        from shapely.geometry import Point
        from decimal import Decimal
        frame=pd.DataFrame({'id':pd.Series(['001',None],dtype='string'),'nullable':pd.Series([1,pd.NA],dtype='Int64'),
                            'category':pd.Categorical(['b','a'],categories=['c','b','a'],ordered=True),
                            'time':pd.to_datetime(['2026-10-12T12:00Z',None])})
        geo=gpd.GeoDataFrame(frame,geometry=[Point(1,2),None],crs='EPSG:4326')
        payload={'frame':geo,'decimal':Decimal('1.2300'),'tag':{codec.TAG:'mapping'},'array':np.array([[1,np.nan],[3,np.inf]]),'bytes':b'\x00\xff'}
        restored=codec.loads(codec.dumps(payload))
        pd.testing.assert_frame_equal(geo,restored['frame']);np.testing.assert_equal(payload['array'],restored['array'])
        self.assertEqual(payload['decimal'],restored['decimal']);self.assertEqual(payload['tag'],restored['tag'])
        raw=self.weather.read_bytes()
        manifest={'manifest_id':'m-1','project_id':'p-1','model_family':'fixture-family','scenario_id':'s-1',
                  'assets':[{'asset_id':'a-1','stored_path':str(self.weather),'sha256':hashlib.sha256(raw).hexdigest(),'size_bytes':len(raw),'binding_role':'weather','original_name':'weather.csv'}],
                  'knobs':{},'validation':{'ready':True}}
        j=self.g.submit_manifest(manifest)
        spec=self.g.store.read(j['spec_sha']);self.assertEqual(spec['family'],'fixture-family');self.assertEqual(spec['name'],'s-1')
        self.weather.write_text('changed')
        with self.assertRaisesRegex(ValueError,'changed since preview'):self.g.submit_manifest(manifest)
        a={'family':'x','run_id':'a','metrics':pd.DataFrame([{'metric':'a','value':0,'unit':'mg/L'},{'metric':'b','value':1,'unit':'mg/L'}])}
        b={'family':'x','run_id':'b','metrics':pd.DataFrame([{'metric':'a','value':2,'unit':'mg/L'},{'metric':'b','value':1,'unit':'g/L'}])}
        c=compare_runs(a,b)['metrics'];self.assertEqual(c.iloc[0]['relative_change'],'zero_baseline');self.assertTrue(pd.isna(c.iloc[1]['delta']))

    def test_source_preserving_binding_repair_and_cli(self):
        source='''from types import SimpleNamespace
# Unrelated original content must survive byte-exactly.
def validate_native_bindings(model_family, assets, knobs):
    roles = {a.binding_role for a in assets if a.binding_role}
    required = {"InVEST_NDR": {"dem", "lulc"}, "GTMODEL": {"model_source", "weather"}}.get(model_family.upper(), set())
    missing = sorted(required - (roles | set(knobs)))
    return {"ready": not missing, "missing_roles": missing, "asset_count": len(list(assets)) if not isinstance(assets, list) else len(assets)}

def untouched():
    return "Do not rewrite the rest of this source."
'''
        path=self.root/'original_bc10.py';path.write_text(source)
        result=repair_bc10_source(path,write=True);self.assertTrue(result['written'])
        after=path.read_text();self.assertTrue(after.endswith(source[source.index('def untouched'):]))
        self.assertFalse(repair_bc10_source(path,write=True)['changed'])
        namespace={};exec(compile(after,str(path),'exec'),namespace)
        empty=namespace['validate_native_bindings']('InVEST_NDR',iter([]),{})
        self.assertFalse(empty['ready']);self.assertEqual(empty['missing_roles'],['dem','lulc'])
        from types import SimpleNamespace
        full=namespace['validate_native_bindings']('InVEST_NDR',(SimpleNamespace(binding_role=x) for x in ['dem','lulc']),{})
        self.assertTrue(full['ready']);self.assertEqual(full['asset_count'],2)
        cli=subprocess.run([sys.executable,'-m','ecsa_runs','--workspace',str(self.g.store.root),'list'],capture_output=True,text=True)
        self.assertEqual(cli.returncode,0,cli.stderr);self.assertEqual(json.loads(cli.stdout),[])

if __name__=='__main__':unittest.main(verbosity=2)
