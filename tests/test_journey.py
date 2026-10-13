"""Compact integration journeys using explicitly authored interoperability fixtures.

These fixtures exercise the exposed original registry and API contracts. They are
not claimed to be a watershed model run or a measured environmental result.
"""
import asyncio
import json
import sqlite3
import tempfile
import unittest
from pathlib import Path
from datetime import date,timedelta
import numpy as np
import rasterio
from rasterio.transform import from_origin
from fastapi import FastAPI
from fastapi.testclient import TestClient
import httpx
from eco_intelligence import install_intelligence
from eco_intelligence.provider import ProviderConfig
from eco_intelligence.common import file_digest

SCHEMA='''
CREATE TABLE jobs(id TEXT PRIMARY KEY,tenant_id TEXT,label TEXT,status TEXT,model TEXT,aoi_json TEXT,params_json TEXT,created_at TEXT,updated_at TEXT,output_dir TEXT,error TEXT,receipt_json TEXT);
CREATE TABLE datasets(id TEXT PRIMARY KEY,tenant_id TEXT,kind TEXT,label TEXT,path TEXT,metadata_json TEXT,created_at TEXT);
CREATE TABLE aois(id TEXT PRIMARY KEY,tenant_id TEXT,label TEXT,geometry_json TEXT,metadata_json TEXT,created_at TEXT);
CREATE TABLE ensembles(id TEXT PRIMARY KEY,tenant_id TEXT,job_id TEXT,status TEXT,plan_json TEXT,summary_json TEXT,created_at TEXT,updated_at TEXT,error TEXT);
'''

def build(root):
    dbpath=root/'original.sqlite'
    out=root/'outputs';out.mkdir()
    a=np.arange(3600,dtype='float32').reshape(60,60);a[0,0]=-9999
    b=a*.8;b[0,0]=-9999
    for name,data in [('baseline',a),('candidate',b)]:
        path=out/(name+'.tif')
        with rasterio.open(path,'w',driver='GTiff',width=60,height=60,count=1,dtype='float32',crs='EPSG:32617',transform=from_origin(400000,3900000,30,30),nodata=-9999) as f:
            f.write(data,1);f.set_band_unit(1,'t/ha/yr')
    obs=root/'observations.csv';pred=root/'predictions.csv'
    obs.write_text('date,observed_sediment\n'+''.join(f'{date(2023,1,1)+timedelta(days=i)},{2*(i+1)}\n' for i in range(40)))
    pred.write_text('date,predicted_sediment\n'+''.join(f'{date(2023,1,1)+timedelta(days=i)},{i+1}\n' for i in range(40)))
    with sqlite3.connect(dbpath) as db:
        db.executescript(SCHEMA)
        for object_id,kind,label,path in [('obs','observations','Observed periods',obs),('pred','predictions','Modeled periods',pred),('raster','raster','Baseline SDR fixture',out/'baseline.tif')]:
            db.execute('INSERT INTO datasets VALUES (?,?,?,?,?,?,?)',(object_id,'demo',kind,label,str(path),json.dumps({'units':'tonnes/year','fixture':True}),'2026-10-12T20:00:00+00:00'))
        db.execute('INSERT INTO datasets VALUES (?,?,?,?,?,?,?)',('private','other','observations','Other tenant',str(obs),'{}','2026-10-12T20:00:00+00:00'))
        for job,status in [('base','complete'),('pending','draft')]:
            db.execute('INSERT INTO jobs VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',(job,'demo',job,status,'sdr','{}','{}','2026-10-12T20:00:00+00:00','2026-10-12T20:00:00+00:00',str(out),None,json.dumps({'fixture':True})))
    app=FastAPI();calls={'run':0,'ensemble':0,'calibration':0}
    @app.get('/')
    def index():return {'original':'map workbench'}
    @app.post('/api/jobs/{job_id}/run')
    def run(job_id:str,payload:dict):
        calls['run']+=1
        with sqlite3.connect(dbpath) as db:db.execute("UPDATE jobs SET status='running',updated_at='2026-10-13T01:00:00+00:00' WHERE id=?",(job_id,))
        return {'id':job_id,'status':'running'}
    @app.post('/api/jobs/{job_id}/ensemble')
    def ensemble(job_id:str,payload:dict):
        from itertools import product
        from datetime import datetime,timezone
        calls['ensemble']+=1;keys=sorted(payload['parameter_grid']);grid=[dict(zip(keys,v)) for v in product(*(payload['parameter_grid'][k] for k in keys))]
        ts=datetime.now(timezone.utc).isoformat()
        with sqlite3.connect(dbpath) as db:db.execute('INSERT INTO ensembles VALUES (?,?,?,?,?,?,?,?,?)',('ensemble1','demo',job_id,'running',json.dumps(grid),None,ts,ts,None))
        return {'id':'ensemble1','job_id':job_id,'status':'running'}
    @app.post('/api/calibration/fit')
    def calibration(payload:dict):
        # Fixture native endpoint used to verify exact routing and full input pairing.
        calls['calibration']+=1
        return {'factor':2.,'accepted':True,'fit_points':30,'holdout_points':10,'received':len(payload['observations'])}
    return app,dbpath,calls

class Journey(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name)
        self.app,self.db,self.calls=build(self.root)
        self.engine=install_intelligence(self.app,db_path=self.db,data_root=self.root)
        self.client=TestClient(self.app)
        self.sid=self.post('/sessions',{'title':'Complete data and model investigation'})['id']
    def tearDown(self):self.temp.cleanup()
    def post(self,path,body):
        r=self.client.post('/api/intelligence'+path,json=body)
        self.assertLess(r.status_code,300,r.text)
        return r.json()
    def examine(self,body):return self.post('/sessions/'+self.sid+'/inspect',body)
    def plan(self,body):return self.post('/sessions/'+self.sid+'/plans',body)

    def test_complete_file_profile_compare_sources_and_reopen(self):
        original=file_digest(self.db)
        p=self.examine({'operation':'profile','ref':{'kind':'dataset','id':'obs'}})
        self.assertEqual(p['result']['rows'],40)
        self.assertEqual(p['result']['columns']['observed_sediment']['numeric']['sum'],1640)
        q=self.examine({'operation':'raster_compare','ref':{'kind':'artifact','id':'base','member':'baseline.tif'},'other':{'kind':'artifact','id':'base','member':'candidate.tif'}})
        self.assertEqual(q['result']['paired_cells'],3599)
        self.assertAlmostEqual(q['result']['relative_sum_change_percent'],-20,places=4)
        t=self.examine({'operation':'table_compare','ref':{'kind':'dataset','id':'obs'},'other':{'kind':'dataset','id':'pred'},'keys':['date']})
        self.assertEqual(t['result']['coverage']['paired_finite'],40)
        self.assertEqual(t['result']['pbias_percent'],-50)
        for fmt in ('json','html'):
            r=self.client.get('/api/intelligence/sessions/'+self.sid+'/export?format='+fmt)
            self.assertEqual(r.status_code,200)
            self.assertIn(p['id'],r.text)
        self.assertEqual(file_digest(self.db),original)
        self.assertEqual(self.client.get('/').json(),{'original':'map workbench'})
        self.assertEqual(self.client.get('/intelligence').status_code,200)
        other=FastAPI();install_intelligence(other,db_path=self.db,data_root=self.root)
        restored=TestClient(other).get('/api/intelligence/sessions/'+self.sid).json()
        self.assertEqual(len(restored['evidence']),3)
        self.assertEqual(restored['evidence'][0]['sources'][0]['sha256'],p['sources'][0]['sha256'])

    def test_native_actions_deduplicate_and_reconcile(self):
        p=self.plan({'kind':'calibration','observed':{'kind':'dataset','id':'obs'},'predicted':{'kind':'dataset','id':'pred'},'observed_unit':'t/year','predicted_unit':'t/year'})
        r=self.post('/plans/'+p['id']+'/execute',{})
        self.assertEqual(r['result']['fit']['received'],40)
        self.post('/plans/'+p['id']+'/execute',{})
        self.assertEqual(self.calls['calibration'],1)
        p=self.plan({'kind':'run_job','job_id':'pending'})
        self.post('/plans/'+p['id']+'/execute',{});self.post('/plans/'+p['id']+'/execute',{})
        self.assertEqual(self.calls['run'],1)
        p=self.plan({'kind':'ensemble','job_id':'base','parameter_grid':{'k_param':[1,2,3],'ic_0_param':[.1,.2]}})
        result=self.post('/plans/'+p['id']+'/execute',{})
        self.assertEqual(self.calls['ensemble'],1)
        self.engine.store.finish_plan('demo',p['id'],'reconcile',{'error':'simulated lost response after native admission'})
        restored=self.post('/plans/'+p['id']+'/reconcile',{})
        self.assertEqual(restored['status'],'complete')
        self.assertTrue(restored['result']['recovered_from_original_registry'])
        self.post('/plans/'+p['id']+'/execute',{})
        self.assertEqual(self.calls['ensemble'],1)

    def test_scope_mutation_duplicates_and_grid_failure(self):
        url='/api/intelligence/sessions/'+self.sid+'/inspect'
        for body in [{'operation':'profile','ref':{'kind':'dataset','id':'private'}},
                     {'operation':'profile','ref':{'kind':'artifact','id':'base','member':'../observations.csv'}}]:
            self.assertGreaterEqual(self.client.post(url,json=body).status_code,400)
        self.assertEqual(self.client.get('/api/intelligence/sessions/'+self.sid+'?tenant_id=other').status_code,404)
        p=self.plan({'kind':'analyze_collection','refs':[{'kind':'dataset','id':'obs'}]})
        with (self.root/'observations.csv').open('a') as f:f.write('2023-03-01,42\n')
        self.assertEqual(self.client.post('/api/intelligence/plans/'+p['id']+'/execute',json={}).status_code,409)
        with (self.root/'observations.csv').open('a') as f:f.write('2023-01-01,9\n')
        r=self.client.post(url,json={'operation':'table_compare','ref':{'kind':'dataset','id':'obs'},'other':{'kind':'dataset','id':'pred'},'keys':['date']})
        self.assertEqual(r.status_code,422)
        self.assertIn('Duplicate',r.text)

    def test_real_provider_protocol_with_controlled_transport(self):
        # Transport fixture validates exact request -> native tool execution -> source-cited completion.
        requests=[]
        def respond(req):
            data=json.loads(req.content);requests.append(data)
            if len(requests)==1:
                message={'role':'assistant','content':None,'tool_calls':[{'id':'inspect-call','type':'function','function':{'name':'inspect','arguments':json.dumps({'operation':'profile','ref':{'kind':'dataset','id':'obs'}})}}]}
            else:
                evidence=json.loads(data['messages'][-1]['content'])
                message={'role':'assistant','content':f"The registered observations contain {evidence['result']['rows']} rows [{evidence['id']}]."}
            return httpx.Response(200,json={'choices':[{'message':message}],'usage':{'total_tokens':100}})
        from eco_intelligence.provider import Assistant
        assistant=Assistant(self.engine,ProviderConfig('https://provider.invalid/v1','test-model','not-a-real-secret'),httpx.MockTransport(respond))
        result=asyncio.run(assistant.ask('demo',self.sid,'How many periods are registered?','one'))
        self.assertEqual(len(result['citations']),1)
        self.assertIn('40 rows',result['text'])
        self.assertEqual(asyncio.run(assistant.ask('demo',self.sid,'How many periods are registered?','one')),result)
        self.assertEqual(len(requests),2)
        self.assertNotIn('not-a-real-secret',json.dumps(self.engine.store.session('demo',self.sid)))

if __name__=='__main__':unittest.main(verbosity=2)
