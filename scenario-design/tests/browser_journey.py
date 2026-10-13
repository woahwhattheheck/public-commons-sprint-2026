"""Chromium UI journey with the real local server through a Python HTTP test transport."""
import json, sys, zipfile, os, tempfile, shutil
from pathlib import Path
from playwright.sync_api import sync_playwright
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from test_journey import fixture
from ui_transport import install, BASE
import urllib.request
OUT=Path(os.getenv('ECO_DESIGN_ACCEPTANCE_DIR',str(Path(tempfile.gettempdir())/'eco-design-acceptance')));OUT.mkdir(parents=True,exist_ok=True)
collection=fixture()
collection['features'][0]['properties']['field_id']='A1'
collection['features'][1]['properties']['field_id']='A2'
for feature in collection['features']: feature['properties']['forest_density_multiplier']=1.0
source=OUT/'Field-design-acceptance.geojson';source.write_text(json.dumps(collection))
with sync_playwright() as pw:
    browser=pw.chromium.launch(executable_path=os.getenv('CHROMIUM_PATH') or shutil.which('chromium') or shutil.which('chromium-browser'),headless=True,args=['--no-sandbox'])
    page=browser.new_page(viewport={'width':1536,'height':1050},accept_downloads=True)
    errors=[]
    page.on('pageerror',lambda e:errors.append(str(e)))
    install(page)
    page.locator('#import-file').set_input_files(str(source))
    page.wait_for_function("document.querySelector('#project-title').value==='Field-design-acceptance'")
    page.locator('#add-alt').click()
    page.locator('#name-input').fill('Riparian restoration alternative')
    page.locator('#name-form').evaluate('(form)=>form.requestSubmit()')
    page.locator('#field-list button').first.click()
    page.locator('#add-parameter').click()
    page.locator('#param-property').select_option('forest_density_multiplier')
    page.locator('#param-label').fill('Forest density multiplier')
    page.locator('#param-unit').fill('factor')
    page.locator('#param-min').fill('0')
    page.locator('#param-max').fill('2')
    page.locator('#parameter-form').evaluate('(form)=>form.requestSubmit()')
    page.get_by_role('spinbutton',name='Forest density multiplier',exact=True).fill('0.9')
    page.get_by_role('spinbutton',name='Forest density multiplier',exact=True).press('Tab')
    page.locator('#field-note').fill('Retained source field A1; lower-density input alternative.')
    page.locator('#field-note').press('Tab')
    # Move the first exterior vertex through the actual SVG pointer event loop.
    page.locator('#mode-edit').click()
    dot=page.locator('#map [data-vi="0"][data-ri="0"]').first
    point=dot.bounding_box();assert point, 'Vertex control not visible'
    x,y=point['x']+point['width']/2,point['y']+point['height']/2
    page.mouse.move(x,y);page.mouse.down();page.mouse.move(x-14,y-9,steps=7);page.mouse.up()
    page.wait_for_timeout(350)
    # Draw a new field away from the originals, using the normal map controls.
    page.locator('#mode-draw').click()
    box=page.locator('#map').bounding_box()
    for dx,dy in ((.72,.72),(.86,.72),(.86,.88),(.72,.88)):
        page.mouse.click(box['x']+box['width']*dx,box['y']+box['height']*dy)
    page.locator('#finish-draw').click()
    page.wait_for_function("document.querySelector('#field-count').textContent==='3'")
    page.get_by_role('spinbutton',name='Forest density multiplier',exact=True).fill('1.1')
    page.get_by_role('spinbutton',name='Forest density multiplier',exact=True).press('Tab')
    page.locator('#save').click()
    page.wait_for_function("document.querySelector('#save-state').textContent.startsWith('Saved')")
    original=page.evaluate("state.project.id")
    saved=page.evaluate("JSON.parse(JSON.stringify(state.project))")
    assert saved['alternatives'][0]['edits']['f_000001']['geometry']!=collection['features'][0]['geometry']
    assert saved['baseline']['collection']==collection
    assert len(saved['alternatives'][0]['additions'])==1
    page.locator('#native-plan').click()
    with page.expect_download() as item:
        page.locator('#native-form').evaluate('(form)=>form.requestSubmit()')
    native_plan_file=OUT/'native-scenario-plan.json';item.value.save_as(str(native_plan_file))
    native=json.loads(native_plan_file.read_text())
    assert native['materialized_inputs'] and native['factor_action_count']==2
    assert native['scenario']['actions'][0]['selector']=={'field_id':['A1']}
    assert native['scenario']['actions'][1]['params']['value']==1.1
    # Inspect the restored original, changed alternative and normal field control state.
    page.locator('#field-list button').first.click();page.locator('#mode-select').click()
    page.locator('#fit').click();page.wait_for_timeout(250)
    page.screenshot(path=str(OUT/'scenario-design-desktop.png'),full_page=True)
    with page.expect_download() as item:page.locator('#export-project').click()
    bundle=OUT/'editable-scenario-handover.zip';item.value.save_as(str(bundle))
    page.evaluate("state.project=null;state.dirty=false;render()")
    page.locator('#receive-file').set_input_files(str(bundle))
    page.wait_for_function("state.project!==null && state.project.id!=="+json.dumps(original)+"")
    received=page.evaluate('JSON.parse(JSON.stringify(state.project))')
    assert received['id']!=original
    assert received['baseline']==saved['baseline']
    assert received['alternatives']==saved['alternatives']
    page.locator('#alternative-list button').nth(1).click()
    page.locator('#field-list button').first.click()
    page.get_by_role('spinbutton',name='Forest density multiplier',exact=True).fill('0.85')
    page.get_by_role('spinbutton',name='Forest density multiplier',exact=True).press('Tab')
    page.locator('#save').click()
    page.wait_for_function("document.querySelector('#save-state').textContent.startsWith('Saved')")
    # The first project's value stays at 0.9 after independent received editing.
    sender=json.load(urllib.request.urlopen(BASE+'/api/projects/'+original))['project']
    param=sender['parameters'][0]['id']
    assert sender['alternatives'][0]['edits']['f_000001']['values'][param]==0.9
    page.set_viewport_size({'width':390,'height':844})
    page.wait_for_timeout(200)
    page.locator('#fit').click()
    page.screenshot(path=str(OUT/'scenario-design-mobile.png'),full_page=True)
    from test_conservation_journey import browser_journey
    conservation_result=browser_journey(page,OUT)
    assert not errors, errors
    report={'browser':'Chromium /usr/bin/chromium','transport':'DOM and application JS with Python HTTP transport to the real local server; browser network policy unchanged','source_original_preserved':True,
      'vertex_drag':True,'polygon_drawing':True,'numeric_input_edit':True,
      'export_receive_independent_edit':True,'sender_unchanged':True,'native_plan_export':True,'page_errors':errors,
      'original_project_id':original,'received_project_id':received['id'],
      'conservation_journey':conservation_result,'source':'authored editor acceptance fixture; not ecological output'}
    (OUT/'browser-result.json').write_text(json.dumps(report,indent=2))
    print(json.dumps(report,indent=2));browser.close()
