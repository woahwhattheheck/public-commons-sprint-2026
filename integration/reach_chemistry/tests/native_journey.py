"""Run against a supplied original native application (or named reference core)."""
import json,sys,tempfile,copy,hashlib,zipfile
from pathlib import Path
sys.path.insert(0,sys.argv[1])
from model.workspace import Workspace
from model.chemistry import Chemistry
from model.common import atomic_json,file_digest
home=Path(__file__).resolve().parents[1]
with tempfile.TemporaryDirectory() as temporary:
 root=Path(temporary); source=root/'source';source.mkdir()
 original=home/'examples/network.json';(source/'network.json').write_bytes(original.read_bytes())
 (source/'notes.txt').write_text('Complete original companion retained.\n')
 atomic_json(source/'sources.json',{'schema':'upstate.sources/v1','entries':[{'id':'network','title':'Constructed reference network','uri':'urn:react12:constructed-reference','vintage':'2026-10-12','kind':'document','path':'network.json','companions':[{'path':'notes.txt'}]}]})
 sender=Workspace(root/'sender',create=True);m=Chemistry(sender);sources=sender.import_sources(source/'sources.json')
 case=m.from_source({'source_collection_id':sources['id'],'source_id':'network'})
 run=m.run({'case_id':case['id'],'request':json.loads((home/'examples/simulation-request.json').read_text())})
 fitted=m.run({'case_id':case['id'],'request':json.loads((home/'examples/calibration-request.json').read_text())})
 assert fitted['calibrated_case_id']!=case['id']
 transfer=m.export({'case_id':case['id'],'run_ids':[run['id'],fitted['id']]})
 assert m.export({'case_id':case['id'],'run_ids':[run['id'],fitted['id']]})==transfer
 original_digest=file_digest(sender.root/transfer['artifact']['path'])
 receiver=Workspace(root/'receiver',create=True);r=Chemistry(receiver)
 received=r.receive(sender.root/transfer['artifact']['path']);assert len(received['adopted_runs'])==2
 assert r.receive(sender.root/transfer['artifact']['path'])==received
 rec=r.get_case(received['case_id']);assert rec['project']==case['project']
 assert receiver.source_file(rec['source_refs'][0]['source_collection_id'],'source-0')[0].read_bytes()==original.read_bytes()
 r2=Chemistry(Workspace(receiver.root));assert len(r2.catalog()['runs'])==2
 for adopted in received['adopted_runs']:
  before=m.artifact(adopted['original_run_id'],'result.json').read_bytes()
  after=r2.artifact(adopted['run_id'],'result.json').read_bytes()
  assert before==after
 project=copy.deepcopy(rec['project']);project['loads'][0]['kg_day']=7.5
 edited=r2.save_case({'project':project,'reason':'Independent receiving-side scenario','parent_id':rec['id'],'source_refs':rec['source_refs']})
 edited_run=r2.run({'case_id':edited['id'],'request':{'mode':'simulate'}})
 assert edited_run['state']=='complete'
 second=r2.export({'case_id':edited['id'],'run_ids':[edited_run['id']]})
 third=Chemistry(Workspace(root/'third',create=True));third_received=third.receive(receiver.root/second['artifact']['path'])
 assert third.get_case(third_received['case_id'])['project']['loads'][0]['kg_day']==7.5
 assert file_digest(sender.root/transfer['artifact']['path'])==original_digest
 print(json.dumps({'source_level_native_journey':'passed','original_companion_retained':True,'received_complete_runs':2,'independent_edit_and_second_receive':True,'sender_unchanged':True,'transfer_bytes':transfer['artifact']['bytes']},indent=2))
