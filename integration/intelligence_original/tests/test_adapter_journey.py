"""One current-workspace routing and complete catalog receiver integration fixture."""
import json
import sqlite3
import tempfile
import unittest
from pathlib import Path
from fastapi import FastAPI
from fastapi.testclient import TestClient
from eco_intelligence import install_intelligence
from eco_intelligence.adapters import CatalogRepository, WorkspaceGateway
from eco_intelligence.profiling import pair_tables
from test_journey import build

class AdapterJourney(unittest.TestCase):
    def test_manifest_receive_native_route_recovery_and_time_pairing(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);unused,dbpath,_=build(root)
            db=sqlite3.connect(dbpath);db.row_factory=sqlite3.Row
            try:
                datasets=[dict(r) for r in db.execute("SELECT * FROM datasets WHERE tenant_id='demo'")]
                jobs=[dict(r) for r in db.execute("SELECT * FROM jobs WHERE tenant_id='demo'")]
            finally:db.close()
            for d in datasets:
                d['metadata']=json.loads(d.pop('metadata_json'))
                d['path']=Path(d['path']).relative_to(root).as_posix()
            for j in jobs:
                j['artifacts']=[{'member':p.name,'path':p.relative_to(root).as_posix(),'metadata':{'fixture':True}} for p in (root/'outputs').glob('*.tif')]
                j.pop('output_dir')
            catalog={'format':'eco-intelligence-catalog-v1','tenants':{'demo':{'root':'.','datasets':datasets,'jobs':jobs}}}
            (root/'catalog.json').write_text(json.dumps(catalog))
            receipts={};app=FastAPI()
            @app.post('/api/workspaces/{tenant_id}/jobs/launch',status_code=202)
            def launch(tenant_id:str,body:dict):
                self.assertEqual(tenant_id,'demo')
                self.assertEqual(body['model'],'sdr')
                self.assertNotIn(body['correlation'],receipts)
                value={'job_id':'native-current-1','status':'queued','correlation':body['correlation']}
                receipts[body['correlation']]=value
                return value
            def request_builder(tenant,action,pid,payload,context):
                # Deliberately fixture-native schema, not an assumed live model request schema.
                return {'model':'sdr','source_job_id':action.job_id,'correlation':pid}
            def lookup(tenant,pid,action,plan):return receipts.get(pid)
            gateway=WorkspaceGateway(app,request_builder,lookup,{'run_job':'Native workspace prepared model'})
            engine=install_intelligence(app,repository=CatalogRepository(root/'catalog.json',root),state_path=root/'investigations.sqlite',gateway=gateway)
            c=TestClient(app);base='/api/intelligence'
            sid=c.post(base+'/sessions',json={'title':'Catalog receiving journey'}).json()['id']
            compare=c.post(f'{base}/sessions/{sid}/inspect',json={'operation':'raster_compare','ref':{'kind':'artifact','id':'base','member':'baseline.tif'},'other':{'kind':'artifact','id':'base','member':'candidate.tif'}})
            self.assertEqual(compare.status_code,200,compare.text)
            self.assertEqual(compare.json()['result']['paired_cells'],3599)
            self.assertEqual(c.get(base+'/status').json()['actions'],['analyze_collection','run_job'])
            p=c.post(f'{base}/sessions/{sid}/plans',json={'kind':'run_job','job_id':'pending'}).json()
            r=c.post(base+'/plans/'+p['id']+'/execute',json={})
            self.assertEqual(r.status_code,200,r.text)
            self.assertEqual(r.json()['result']['native']['status'],'queued')
            engine.store.finish_plan('demo',p['id'],'reconcile',{'error':'lost response fixture'})
            r=c.post(base+'/plans/'+p['id']+'/reconcile',json={})
            self.assertEqual(r.json()['status'],'complete')
            c.post(base+'/plans/'+p['id']+'/execute',json={})
            self.assertEqual(len(receipts),1)
            # A new process reads the same catalog and retained complete investigation.
            reopened=FastAPI();install_intelligence(reopened,repository=CatalogRepository(root/'catalog.json',root),state_path=root/'investigations.sqlite',gateway=gateway)
            self.assertEqual(len(TestClient(reopened).get(f'{base}/sessions/{sid}').json()['evidence']),1)
            self.assertEqual(c.get(base+'/inventory?tenant_id=other').status_code,404)
            # ISO representations of the same physical periods pair, not merely string-equal dates.
            a=root/'timezone-a.csv';b=root/'timezone-b.csv'
            a.write_text('date,observed_sediment\n2024-01-01T00:00:00Z,10\n2024-01-02T00:00:00Z,20\n')
            b.write_text('date,predicted_sediment\n2023-12-31T19:00:00-05:00,8\n2024-01-01T19:00:00-05:00,16\n')
            summary,obs,pred=pair_tables(a,b,['date'],'observed_sediment','predicted_sediment',canonical_time=True)
            self.assertEqual(summary['coverage']['paired_finite'],2)
            self.assertEqual(obs,[]);self.assertEqual(pred,[])
            # Changing an auxiliary raster file invalidates an old prepared source.
            source=engine.repo.source('demo',{'kind':'artifact','id':'base','member':'baseline.tif'})[1]
            (root/'outputs/baseline.tif.aux.xml').write_text('<PAMDataset/>')
            with self.assertRaises(Exception):engine.repo.assert_unchanged('demo',source)

if __name__=='__main__':unittest.main(verbosity=2)
