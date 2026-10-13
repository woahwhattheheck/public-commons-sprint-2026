"""Exercise the actual received ECSA registry with the monitoring implementation.

Usage: python tests/shared_registry_journey.py /path/to/received/extension_registry.py
The original registry is a peer dependency, not included or replaced by this product.
"""
import importlib.util,json,shutil,sys,tempfile
from pathlib import Path
from native_contract_support import NativeWorkspace, NativeOperator, install
adapter=install()
from test_native_contract import retain_native, configuration
from model.monitoring_actions import invoke
ROOT=Path(__file__).resolve().parents[1]


def main(source):
    with tempfile.TemporaryDirectory() as directory:
        root=Path(directory);operator_root=root/'application/operator';(operator_root/'web').mkdir(parents=True)
        shutil.copyfile(source,operator_root/'extension_registry.py')
        owned=ROOT/'src/opportunities/upstate_forever_2026/operator'
        for path in (owned/'web').iterdir():shutil.copyfile(path,operator_root/'web'/path.name)
        (operator_root/'extensions').mkdir();shutil.copyfile(owned/'extensions/monitoring.json',operator_root/'extensions/monitoring.json')
        spec=importlib.util.spec_from_file_location('received_actual_registry',operator_root/'extension_registry.py')
        module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
        class Fault(ValueError):
            def __init__(self,code,message,status):super().__init__(message);self.code=code;self.status=status
        ws=NativeWorkspace(root/'workspace',create=True);inputs=root/'inputs';inputs.mkdir();edition=retain_native(ws,inputs)
        operator=NativeOperator(ws,root/'operator-state')
        try:
            registry=module.ExtensionRegistry(operator,Fault,directory=operator_root/'extensions',builtin_actions={'peer.action'}).load()
            manifest=registry.manifest();assert not manifest['issues'],manifest['issues']
            assert len(registry.accepted_actions)==7;assert registry.has_route('GET','/api/monitoring')
            catalog=registry.read('GET','/api/monitoring',operator.primary,{'action':'source.catalog','payload':'{}','workspace':operator.primary})
            assert catalog['collections'][0]['id']==edition['id']
            task={'workspace':operator.primary,'action':'monitoring.network.import','payload':{'domain_collection_id':edition['id'],'domain_source_id':'DOMAIN','station_source_id':'STATIONS','stratum_field':'stratum','priority_field':'priority','station_outlet_field':'at_outlet'}}
            network=registry.invoke(task);assert len(network['nodes'])==24
            plan=registry.invoke({**task,'action':'monitoring.design','payload':{'network_id':network['id'],'configuration':configuration()}})
            campaign=registry.invoke({**task,'action':'monitoring.campaign.create','payload':{'plan_id':plan['id'],'title':'Registered monitoring','operation_id':'registered-original-create'}})
            export_task={**task,'id':'registered-export','action':'monitoring.export','state':'complete','payload':{'campaign_id':campaign['campaign_id']}}
            export_task['result']=registry.invoke(export_task)
            decorated=registry.decorate_task(export_task)
            assert not decorated.get('_extension_issues'),decorated
            assert decorated['result']['download_url'].startswith('/api/file/')
            verified=registry.verify_workspace(ws);assert verified['monitoring']['campaigns']==1
            assert not registry.manifest()['issues']
            output={'peer_registry_file_sha256':__import__('hashlib').sha256(Path(source).read_bytes()).hexdigest(),
                'scope':'Actual received ECSA registry + actual monitoring service; source/queue storage contract fixture',
                'registered_actions':sorted(registry.accepted_actions),'manifest_issues':registry.manifest()['issues'],
                'native_source_catalog':True,'network_to_design_to_campaign':True,'native_ticket_decoration':True,
                'receiving_verifier':verified,'passed':True}
            (ROOT/'evidence/shared-registry.json').write_text(json.dumps(output,indent=2));print(json.dumps(output,indent=2))
        finally:operator.close()

if __name__=='__main__':main(Path(sys.argv[1]))
