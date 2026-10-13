"""Whole editor workflow capacity exercise; authored fields, not ecological simulation."""
import copy,json,resource,sys,tempfile,time
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from engine import new_project,export_bundle,receive_bundle
from eco_bridge import compile_plan
from server import Store

def run(n=2500):
    start=time.perf_counter();features=[]
    for i in range(n):
        x=-82+(i%50)*.002;y=34+(i//50)*.002
        features.append({'type':'Feature','id':'field-'+str(i),'properties':{'field_id':'F'+str(i),'forest_density_multiplier':1.0,'name':'Field '+str(i)},'geometry':{'type':'Polygon','coordinates':[[[x,y],[x+.0015,y],[x+.0015,y+.0015],[x,y+.0015],[x,y]]]}})
    p=new_project({'type':'FeatureCollection','name':'Authored editor capacity workload','features':features},'Whole editor capacity workload')
    p['parameters']=[{'id':'density','property':'forest_density_multiplier','label':'Density multiplier','unit':'factor','min':0,'max':2}]
    p['alternatives']=[{'id':'alternative_'+str(j),'title':'Alternative '+str(j),'edits':{f'f_{i+1:06d}':{'values':{'density':.8+j*.05}} for i in range(j,n,6)},'additions':[]} for j in range(6)]
    stages={'construct_s':time.perf_counter()-start}
    with tempfile.TemporaryDirectory() as td:
        store=Store(Path(td)/'source.sqlite3');t=time.perf_counter();saved=store.save(p,0,create=True);stages['save_s']=time.perf_counter()-t
        t=time.perf_counter();blob=export_bundle(saved['project']);stages['export_s']=time.perf_counter()-t
        t=time.perf_counter();received=receive_bundle(blob);stages['receive_s']=time.perf_counter()-t
        assert received==p
        t=time.perf_counter();received['alternatives'][0]['edits']['f_000001']['values']['density']=.73
        Store(Path(td)/'received.sqlite3').save(received,0,create=True)
        native=compile_plan(received,'alternative_0',{'forest_density_multiplier':'forest_density_multiplier'})
        assert native['scenario']['actions'][0]['params']['value']==.73
        assert store.get(p['id'])['project']['alternatives'][0]['edits']['f_000001']['values']['density']==.8
        stages['independent_edit_native_plan_s']=time.perf_counter()-t
    return {'workload':'authored field-editor capacity journey','fields':n,'alternatives':6,'native_actions':len(native['scenario']['actions']),'archive_bytes':len(blob),'elapsed_s':time.perf_counter()-start,'max_rss_kib':resource.getrusage(resource.RUSAGE_SELF).ru_maxrss,'stages':stages}

if __name__=='__main__':print(json.dumps(run(int(sys.argv[1]) if len(sys.argv)>1 else 2500),indent=2))
