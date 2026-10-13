"""Complete saved-plan design/receiving journey against the published E7A1 contract.

Constructed geometry/records exercise transport and editing. The interface runner
below is deliberately a call-contract fixture, not installed ecological execution.
"""
import base64, copy, hashlib, io, json, sys, tempfile, unittest, zipfile
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from engine import digest, encode, realize, export_bundle, receive_bundle, DesignError
from conservation import *
from server import Store
from test_journey import fixture


def binding_fixture():
    collection=fixture()
    # The original saved-plan consumer emits WGS84 display geometry; scientific
    # area and native source references remain its original recorded context.
    for f in collection['features']:
        def xy(g):
            if isinstance(g,list) and g and isinstance(g[0],(int,float)): return g[:2]
            return [xy(x) for x in g]
        f['geometry']['coordinates']=xy(f['geometry']['coordinates'])
    plan_id='d'*64;study_id='e'*64;selected=['00017','00023'];keys=['a'*64,'b'*64]
    reference={'schema':REFERENCE,'kind':'conservation_plan','workspace_id':'source-workspace',
       'plan_id':plan_id,'study_id':study_id,'selected_ids':selected,
       'candidate_table_sha256':'f'*64,'geometry_inventory_sha256':'c'*64,
       'footprint':{'path':f'conservation-plans/{plan_id}/geodata.gpkg','layer':'selected_union','sha256':'1'*64}}
    units=[]
    for i,f in enumerate(collection['features']):
        f['id']=keys[i]
        f['properties'].update(unit_key=keys[i],unit_id=selected[i],whole_unit_area_ha=13.125+i,reporting_area_ha=11.875+i)
        units.append({'unit_ref':{'kind':'retained_planning_unit','unit_key':keys[i],'native_id':selected[i],
               'source_collection_id':'collection-original','source_id':'parcels-original'},
            'plan_ref':{k:reference[k] for k in ('workspace_id','plan_id','study_id')},
            'candidate':{'id':selected[i],'original_attributes':{'parcel_id':selected[i]},'cost':None},
            'implementation_basis':{'unit_id':selected[i],'whole_unit_area_ha':13.125+i,'reporting_area_ha':11.875+i,
               'supplied_whole_unit_cost':None,'currency':None}})
    union=copy.deepcopy(collection);union['features']=union['features'][:1];union['features'][0]['id']=plan_id
    value={'schema':BINDING,'source_reference':reference,
        'plan':{'id':plan_id,'study_id':study_id,'state':'complete','selected_ids':selected,'title':'Saved plan editor journey'},
        'study':{'id':study_id,'state':'complete'},'selected_units':units,
        'source_assets':{'units':{'body':{'path':'objects/retained.geojson','sha256':'2'*64},'companions':[]}},
        'native_runs':{},'artifacts':{},'scientific_contract':{'metric_state':'context_only'},'consumer_contract':{},
        'geometry':{'representation_crs':'EPSG:4326','coordinate_order':'longitude, latitude','analysis_crs':'EPSG:5070',
          'area_basis':'Original saved projected-plane hectares remain unchanged',
          'reporting_units':copy.deepcopy(collection),'whole_units':copy.deepcopy(collection),
          'reporting_union':copy.deepcopy(union),'whole_unit_union':copy.deepcopy(union)}}
    value['id']=digest(value)
    return value


class OriginalInterfaceFixture:
    def __init__(self, binding): self.binding=binding;self.calls=[];self.project={'id':'source-workspace'}
    def resolve(self, workspace, reference):
        assert workspace is self and reference==self.binding['source_reference']
        self.calls.append('resolve_reference');return copy.deepcopy(self.binding)
    def import_sources(self, path):
        self.calls.append('import_sources');path=Path(path);manifest=json.loads(path.read_bytes())
        assert manifest['schema']=='upstate.sources/v1'
        assert set(manifest)=={'schema','title','captured_at','scope','entries'}
        entry=manifest['entries'][0]
        assert entry['kind']=='vector' and entry['role']=='SCENARIO_MASK' and entry['source_crs']=='EPSG:4326'
        assert not any(k in entry for k in ('body','source_path','view_path','layer'))
        for item in [entry]+entry['companions']:
            assert hashlib.sha256((path.parent/item['path']).read_bytes()).hexdigest()==item['sha256']
        self.manifest=manifest
        return {'id':digest(manifest)}
    def save_scenario(self, selection):
        self.calls.append('save_scenario');assert selection['kind']=='landcover'
        assert selection['source_collection_id']==digest(self.manifest)
        assert selection['patches'][0]['mask_source_id']==self.manifest['entries'][0]['id']
        assert set(selection['patches'][0])=={'mask_source_id','from_codes','to_code','reason'}
        self.scenario=selection;return {'id':digest(selection)}
    def prepare_run(self, selection):
        self.calls.append('prepare_run');assert selection['scenario_id']==digest(self.scenario)
        self.run=selection;return {'id':digest(selection)}


class ConservationJourney(unittest.TestCase):
    def test_edit_receive_native_register_restart(self):
        binding=binding_fixture();raw=json.dumps(binding,ensure_ascii=False,indent=2).encode()
        original=copy.deepcopy(binding)
        p=import_binding(raw);source_baseline=copy.deepcopy(p['baseline']);a={'id':'treatment','title':'Changed restoration footprint','description':'Contract journey', 'edits':{},'additions':[]}
        p['alternatives']=[a]
        geom=copy.deepcopy(p['baseline']['collection']['features'][0]['geometry']);geom['coordinates'][0][1][0]-=.001
        a['edits']['f_000001']={'geometry':geom,'note':'Smaller actual design footprint'}
        a['edits']['f_000002']={'excluded':True}
        bundle=export_landcover(p,'treatment',from_codes=[81,82],to_code=41,reason='Explicit authored test selection',
                 prepare_run={'grid_id':'original-grid','profile_id':'original-profile','models':['ndr','sdr']})
        reopened,plan,files=read_landcover(bundle)
        self.assertEqual(reopened,p);self.assertEqual(files['conservation-binding.json'],raw)
        self.assertEqual(plan['design_source_reference'],binding['source_reference'])
        self.assertEqual(json.loads(files['design.geojson'])['features'][0]['properties']['reporting_area_ha'],11.875)
        self.assertEqual(len(json.loads(files['design.geojson'])['features']),1)
        native=OriginalInterfaceFixture(binding)
        with tempfile.TemporaryDirectory() as td:
            root=Path(td)
            store=Store(root/'design.sqlite3');saved=store.save(p,0,create=True)
            self.assertEqual(Store(root/'design.sqlite3').get(p['id'])['project'],p)
            result=register_landcover(native,bundle,root/'native-revision',resolve_reference=native.resolve)
            self.assertEqual(native.calls,['resolve_reference','import_sources','save_scenario','prepare_run'])
            same=register_landcover(native,bundle,root/'native-revision',resolve_reference=native.resolve)
            self.assertEqual(result,same)
            self.assertEqual(native.run['models'],['ndr','sdr'])
            with self.assertRaises(DesignError):
                (root/'native-revision'/'design.geojson').write_text('{}')
                register_landcover(native,bundle,root/'native-revision',resolve_reference=native.resolve)
        successor=receive_bundle(export_bundle(reopened));successor['alternatives'][0]['edits']['f_000001']['note']='Independent review'
        self.assertEqual(successor['baseline'],source_baseline)
        self.assertEqual(binding,original)
        self.assertEqual(p['alternatives'][0]['edits']['f_000001']['note'],'Smaller actual design footprint')
        self.assertEqual(receive_bundle(export_bundle(successor)),successor)

    def test_explicit_roles_and_changed_source(self):
        b=binding_fixture();raw=json.dumps(b).encode()
        for role in ROLES:
            p=import_binding(raw,geometry_role=role)
            self.assertEqual(p['baseline']['collection'],b['geometry'][role])
            self.assertEqual(binding_for(p)['source_reference']['selected_ids'],['00017','00023'])
        p=import_binding(raw);p['alternatives']=[{'id':'a','title':'Explicit codes','edits':{},'additions':[]}]
        for args in ({'from_codes':[], 'to_code':41},{'from_codes':[True], 'to_code':41},{'from_codes':[81,81],'to_code':41},{'from_codes':[81], 'to_code':False}):
            with self.assertRaises(DesignError): export_landcover(p,'a',reason='Review',**args)
        p['baseline']['source']['conservation']['original_binding']['data']=base64.b64encode(raw+b' ').decode()
        with self.assertRaises(DesignError): binding_for(p)


if __name__=='__main__':unittest.main()


def browser_journey(page, out):
    """Exercise saved-plan intake and full native handover through actual UI controls."""
    original=binding_fixture();raw=b'\xef\xbb\xbf'+json.dumps(original,indent=2).encode()
    source=out/'saved-conservation-binding.json';source.write_bytes(raw)
    page.set_viewport_size({'width':1536,'height':1050})
    page.locator('#import-conservation').click()
    page.locator('#conservation-file').set_input_files(str(source))
    page.locator('#conservation-title').fill('Saved conservation plan — scenario design')
    page.locator('#conservation-form').evaluate('(f)=>f.requestSubmit()')
    page.wait_for_function("state.project?.title==='Saved conservation plan — scenario design'")
    assert page.locator('#conservation-context').is_visible()
    assert '00017' in page.locator('#conservation-reference').text_content()
    page.locator('#add-alt').click();page.locator('#name-input').fill('Revised land-cover footprint')
    page.locator('#name-form').evaluate('(f)=>f.requestSubmit()')
    page.locator('#field-list button').first.click()
    page.locator('#mode-edit').click()
    dot=page.locator('#map [data-vi="1"][data-ri="0"]').first
    point=dot.bounding_box();assert point
    x,y=point['x']+point['width']/2,point['y']+point['height']/2
    page.mouse.move(x,y);page.mouse.down();page.mouse.move(x-12,y+7,steps=7);page.mouse.up()
    page.wait_for_timeout(200)
    page.locator('#field-note').fill('Retain original selected units and area context; edit treatment footprint.')
    page.locator('#field-note').press('Tab')
    page.locator('#save').click()
    page.wait_for_function("document.querySelector('#save-state').textContent.startsWith('Saved')")
    sender=page.evaluate('state.project.id')
    page.locator('#upstate-plan').click()
    page.locator('#upstate-from').fill('81, 82');page.locator('#upstate-to').fill('41')
    page.locator('#upstate-reason').fill('Explicit authored editor integration selection')
    page.locator('#upstate-form details summary').click()
    page.locator('#upstate-grid').fill('original-grid');page.locator('#upstate-profile').fill('original-profile')
    page.locator('#upstate-models').fill('ndr,sdr')
    with page.expect_download() as item:
        page.locator('#upstate-form').evaluate('(f)=>f.requestSubmit()')
    output=out/'conservation-native-handover.zip';item.value.save_as(str(output))
    project,plan,files=read_landcover(output.read_bytes())
    assert files['conservation-binding.json']==raw
    assert project['baseline']['collection']==original['geometry']['reporting_units']
    assert plan['prepare_run']['models']==['ndr','sdr']
    page.locator('#mode-select').click();page.locator('#fit').click();page.wait_for_timeout(100)
    page.screenshot(path=str(out/'conservation-design-desktop.png'),full_page=True)
    nested=out/'conservation-editable-project.zip';nested.write_bytes(files['design-project.zip'])
    page.locator('#receive-file').set_input_files(str(nested))
    page.wait_for_function('state.project.id!=='+json.dumps(sender))
    received_id=page.evaluate('state.project.id')
    page.locator('#alternative-list button').nth(1).click();page.locator('#field-list button').first.click()
    page.locator('#field-note').fill('Independent received conservation design review')
    page.locator('#field-note').press('Tab');page.locator('#save').click()
    page.wait_for_function("document.querySelector('#save-state').textContent.startsWith('Saved')")
    import urllib.request
    source_project=json.load(urllib.request.urlopen('http://127.0.0.1:8848/api/projects/'+sender))['project']
    assert source_project['alternatives'][0]['edits']['f_000001']['note'].startswith('Retain original')
    page.set_viewport_size({'width':390,'height':844});page.wait_for_timeout(100);page.locator('#fit').click()
    page.screenshot(path=str(out/'conservation-design-phone.png'),full_page=True)
    return {'original_project_id':sender,'received_project_id':received_id,'original_binding_bytes_preserved':True,
        'original_projected_areas_preserved':True,'original_selected_ids':['00017','00023'],
        'native_source_manifest_adapter':'E7A1 published original interface','native_calls':'interface fixture',
        'native_handover_export':True,'independent_receive_edit':True}
