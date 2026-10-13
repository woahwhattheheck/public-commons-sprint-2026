"""Source-edition, queued adapter, native format and current installer journeys."""
import copy, gzip, hashlib, importlib, json, shutil, sys, tempfile, time, unittest, zipfile
from pathlib import Path
from unittest.mock import patch
from contract_support import domain_fixture, configuration
from native_contract_support import NativeWorkspace, NativeOperator, install, load_json, atomic_json
adapter=install()
from model.monitoring_workspace import MonitoringWorkspace
from model.monitoring_sources import vector_view
from model.monitoring_actions import invoke
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT));import install_native_monitoring as joins


def retain_native(ws,source_dir):
    domain,stations=domain_fixture(24)
    alternate=copy.deepcopy(stations['features'][2]);alternate['id']='alternate-source-station';alternate['properties']['site_no']='TEST-ALTERNATE-00002';stations['features'].append(alternate)
    (source_dir/'domain.geojson').write_text(json.dumps(domain));(source_dir/'stations.geojson').write_text(json.dumps(stations))
    (source_dir/'metadata.xml').write_text('<source>Authored current-contract GIS fixture</source>')
    manifest={'schema':'upstate.sources/v1','title':'Original retained vector fixture','entries':[
        {'id':'DOMAIN','title':'Native geometry','uri':'urn:test:domain','vintage':'authored','kind':'vector','path':'domain.geojson','companions':[{'path':'metadata.xml'}]},
        {'id':'STATIONS','title':'Station positions','uri':'urn:test:stations','vintage':'authored','kind':'vector','path':'stations.geojson'}]}
    path=source_dir/'sources.json';path.write_text(json.dumps(manifest));edition=ws.import_sources(path)
    return edition

class CurrentJourneys(unittest.TestCase):
    def test_current_sources_campaign_queued_export_and_independent_edit(self):
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary);source=root/'source';source.mkdir();ws=NativeWorkspace(root/'ws',create=True)
            edition=retain_native(ws,source);service=MonitoringWorkspace(ws)
            self.assertNotIn('id',load_json(ws.root/'sources'/(edition['id']+'.json')))
            with self.assertRaises(ValueError):service.import_network(domain_source_id='DOMAIN')
            network=service.import_network(domain_collection_id=edition['id'],domain_source_id='DOMAIN',station_source_id='STATIONS',stratum_field='stratum',priority_field='priority',station_outlet_field='at_outlet')
            self.assertEqual(len(network['nodes']),24);self.assertEqual(network['source_bindings']['domain']['native_driver'],'GeoJSON')
            plan=service.design(network_id=network['id'],configuration=configuration())
            campaign=service.create_campaign(plan_id=plan['id'],operation_id='native-create',title='Current native-contract campaign')
            revision=service.revise_campaign(campaign_id=campaign['campaign_id'],expected_revision_id=campaign['id'],operation_id='native-bind',site_bindings={h:'TEST-'+h[1:] for h in plan['selected_ids']})
            event=service.field_event(campaign_id=campaign['campaign_id'],expected_revision_id=revision['id'],operation_id='native-field',visit_key=plan['calendar']['visits'][0]['visit_key'],status='collected',sample_id='CURRENT-01',occurred_at='2026-11-02T10:00:00-05:00')
            operator=NativeOperator(ws,root/'operator')
            try:
                request={'workspace':operator.primary,'action':'monitoring.export','operation_id':'native-export-0001','payload':{'campaign_id':campaign['campaign_id']}}
                task=operator.submit(request)
                while task['state'] in {'queued','running'}:time.sleep(.01)
                public=operator.task_view(task['id']);self.assertEqual(public['state'],'complete',public)
                self.assertNotIn('path',public['result']);self.assertTrue(public['result']['download_url'].startswith('/api/file/'))
                self.assertEqual(operator.submit(request)['id'],task['id']);self.assertEqual(operator.calls,1)
                with zipfile.ZipFile(task['result']['path']) as z:
                    self.assertEqual(z.read('sources/domain/metadata.xml'),(source/'metadata.xml').read_bytes())
                    self.assertEqual(z.read('sources/domain/domain.geojson'),(source/'domain.geojson').read_bytes())
                    for member in json.loads(z.read('manifest.json'))['files']:
                        self.assertEqual(hashlib.sha256(z.read(member['path'])).hexdigest(),member['sha256'])
                backups=[service.export(campaign_id=campaign['campaign_id'],format='workspace') for _ in range(2)]
                for output in backups:self.assertFalse(Path(output['path']).is_relative_to(ws.root))
                with zipfile.ZipFile(backups[1]['path']) as z:
                    self.assertFalse(any(name.endswith('.zip') for name in z.namelist()))
                    z.extractall(root/'received')
                received=MonitoringWorkspace(NativeWorkspace(root/'received/workspace'))
                changed=received.revise_campaign(campaign_id=campaign['campaign_id'],expected_revision_id=event['id'],operation_id='independent-edit',title='Independent received campaign')
                self.assertEqual(changed['revision'],4);self.assertEqual(service.campaign(campaign['campaign_id'])['revision']['revision'],3)
                # A binding revision must not relabel an already-collected sample.
                site=plan['calendar']['visits'][0]['site_id'];self.assertEqual(site,'F00002')
                revised_bindings={**service.campaign(campaign['campaign_id'])['revision']['site_bindings'],site:'TEST-ALTERNATE-00002'}
                service.revise_campaign(campaign_id=campaign['campaign_id'],expected_revision_id=event['id'],operation_id='new-planned-station',site_bindings=revised_bindings)
                current=service.campaign(campaign['campaign_id'])
                self.assertEqual(current['calendar'][0]['station_id'],'TEST-00002')
                self.assertEqual(current['calendar'][0]['planned_station_id'],'TEST-ALTERNATE-00002')
                future=next(v for v in current['calendar'] if v['site_id']==site and v['round']==2)
                self.assertEqual(future['station_id'],'TEST-ALTERNATE-00002')
                # Interrupt after first plan write but before frontier head update.
                params={'network_id':network['id'],'configuration':configuration(),'budgets':['900.00','1800.00']}
                model=importlib.import_module('model.monitoring_workspace');actual=model.atomic_json;seen=0
                def crash(path,body):
                    nonlocal seen
                    if 'monitoring_frontier_jobs' in str(path) and body.get('completed'):
                        seen+=1
                        if seen==1:raise KeyboardInterrupt('between native ID-free record and head')
                    return actual(path,body)
                with patch.object(model,'atomic_json',crash):
                    with self.assertRaises(KeyboardInterrupt):service.frontier(**params)
                resumed=service.frontier(**params);self.assertEqual(resumed['budgets_completed'],2)
            finally:operator.close()
    def test_actual_fiona_projected_geopackage_and_gzipped_esri_json(self):
        import fiona
        from pyproj import Transformer
        with tempfile.TemporaryDirectory() as temporary:
            p=Path(temporary);project=Transformer.from_crs(4326,3857,always_xy=True)
            ring=[project.transform(*q) for q in [(-83,35),(-82.99,35),(-82.99,35.01),(-83,35.01),(-83,35)]]
            schema={'geometry':'Polygon','properties':{'HUC12':'str:12','TOHUC':'str:12'}}
            file=p/'domain.gpkg'
            with fiona.open(file,'w',driver='GPKG',crs='EPSG:3857',schema=schema,layer='catchments') as output:
                output.write({'geometry':{'type':'Polygon','coordinates':[ring]},'properties':{'HUC12':'030601010001','TOHUC':'000000000000'}})
            value,metadata=vector_view(file,layer='catchments')
            self.assertEqual(value['features'][0]['properties']['HUC12'],'030601010001')
            self.assertAlmostEqual(value['features'][0]['geometry']['coordinates'][0][0][0],-83,places=7)
            esri={'displayFieldName':'HUC12','geometryType':'esriGeometryPolygon','spatialReference':{'wkid':3857},'fields':[{'name':'HUC12','type':'esriFieldTypeString','length':12},{'name':'TOHUC','type':'esriFieldTypeString','length':12}],
                  'features':[{'attributes':{'HUC12':'030601010001','TOHUC':'000000000000'},'geometry':{'rings':[ring]}}]}
            zipped=p/'model-domain.esri.json.gz';zipped.write_bytes(gzip.compress(json.dumps(esri).encode()))
            esri_value,esri_metadata=vector_view(zipped)
            self.assertEqual(esri_value['features'][0]['properties']['HUC12'],'030601010001')
            self.assertAlmostEqual(esri_value['features'][0]['geometry']['coordinates'][0][0][1],35,places=7)
            self.assertEqual(esri_metadata['native_driver'],'ESRIJSON')
    def test_current_operator_installer_preserves_peers_and_csp(self):
        server='''import json\nACTIONS={"peer.action"}\nclass Operator:\n    def _invoke(self, task):\n        return 42\n    def task_view(self, key):\n        task = {}\n        return self.customer_reviews.decorate_task(task)\nclass Handler:\n    def do_GET(self):\n        if True:\n            if True:\n                if url.path == "/api/state":\n                    return 42\n        selected="index.html"\n        if selected not in {"index.html", "app.mjs", "style.css", "peer.mjs"}:\n            raise ValueError()\n        policy="script-src 'self'; style-src 'self'"\n'''
        current=joins.server(server);self.assertEqual(joins.server(current),current)
        self.assertIn('"peer.mjs"',current);self.assertIn("style-src 'self'",current)
        app="const viewLabels={overview:'Overview'};\nconst community=attachCommunity({});\nfunction render(){\n  spatialWorkspace.suspend();\n  const d=state.data;\n}"
        updated=joins.app(app);self.assertEqual(joins.app(updated),updated)
        self.assertIn('const d=state.data;',updated)
        component=(ROOT/'src/opportunities/upstate_forever_2026/operator/web/monitoring-component.mjs').read_text()
        self.assertNotIn('<style>',component);self.assertIn('/web/monitoring.css',component)
        self.assertEqual(joins.index(joins.index('<nav><button>Peer</button></nav>')),joins.index('<nav><button>Peer</button></nav>'))
        self.assertEqual(joins.remove_server(current),server)
        self.assertEqual(joins.remove_app(updated),app)
        original_index='<nav><button>Peer</button></nav>'
        self.assertEqual(joins.remove_index(joins.index(original_index)),original_index)
        # Join a shared host after the prior direct monitoring edition. Migrating
        # our exact hooks must leave the registry's wrapper and peer state alone.
        registry_server=current.replace('    def _invoke(self, task):',
            '    def __init__(self):\n        self.extensions = ExtensionRegistry(self, Fault)\n    def _invoke(self, task):').replace(
                'return self.customer_reviews.decorate_task(task)',
                'return self.extensions.decorate_task(self.customer_reviews.decorate_task(task))')
        expected=server.replace('    def _invoke(self, task):',
            '    def __init__(self):\n        self.extensions = ExtensionRegistry(self, Fault)\n    def _invoke(self, task):').replace(
                'return self.customer_reviews.decorate_task(task)',
                'return self.extensions.decorate_task(self.customer_reviews.decorate_task(task))')
        self.assertEqual(joins.remove_server(registry_server),expected)
        import install_monitoring
        with tempfile.TemporaryDirectory() as directory:
            target=Path(directory)
            (target/'model').mkdir();(target/'model/workspace.py').write_text('# exact host contract fixture\n')
            (target/'operator/web').mkdir(parents=True)
            (target/'operator/extension_registry.py').write_text('# registry existence fixture; actual registry has a separate native journey\n')
            (target/'operator/server.py').write_text(registry_server)
            (target/'operator/web/app.mjs').write_text(updated)
            (target/'operator/web/index.html').write_text(joins.index(original_index))
            result=install_monitoring.install(target)
            self.assertEqual(result['integration'],'shared-extension-registry')
            self.assertEqual((target/'operator/server.py').read_text(),expected)
            self.assertEqual((target/'operator/web/app.mjs').read_text(),app)
            self.assertEqual((target/'operator/web/index.html').read_text(),original_index)
            descriptor=json.loads((target/'operator/extensions/monitoring.json').read_text())
            self.assertEqual(descriptor['version'],'1.2.0')
            self.assertEqual(len(descriptor['backend']['actions']),7)
            self.assertEqual(install_monitoring.install(target)['changed_paths'],[])

if __name__=='__main__':unittest.main(verbosity=2)
