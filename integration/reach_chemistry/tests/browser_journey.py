"""Browser-to-native-adapter contract journey on a supplied reference application."""
from pathlib import Path
import asyncio,json,sys,tempfile,shutil
from playwright.async_api import async_playwright
HOME=Path(__file__).resolve().parents[1]
sys.path.insert(0,sys.argv[1])
from model.workspace import Workspace
from model.chemistry import Chemistry,invoke
async def main():
 with tempfile.TemporaryDirectory() as tmp:
  ws=Workspace(Path(tmp)/'workspace',create=True);m=Chemistry(ws)
  case=m.save_case({'project':json.loads((HOME/'examples/network.json').read_text()),'reason':'Browser contract reference case'})
  run=m.run({'case_id':case['id'],'request':{'mode':'simulate','sample_days':[0,3,10,20]}})
  async def backend(operation,payload):
   if operation=='catalog':return {'workspace_key':'fixture',**m.catalog()}
   if operation=='case':return {'workspace_key':'fixture',**m.get_case(payload['case_id'])}
   if operation=='run':return {'workspace_key':'fixture',**m.get_run(payload['run_id']),'_downloads':[]}
   if operation=='page':return m.result_page(payload)
   if operation=='action':return invoke(ws,payload['action'],payload['payload'])
   raise ValueError(operation)
  async with async_playwright() as pw:
   browser=await pw.chromium.launch(headless=True,executable_path=shutil.which('chromium'),args=['--no-sandbox'])
   page=await browser.new_page(viewport={'width':1440,'height':1100},device_scale_factor=1)
   errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
   await page.expose_function('nativeRead',backend)
   css=(HOME/'native/operator/web/chemistry.css').read_text()
   await page.set_content('<html><head><style>body{font:14px Arial;margin:32px;background:#fff}'+css+'</style></head><body><main id="content"></main></body></html>')
   js=(HOME/'native/operator/web/chemistry.mjs').read_text().replace('export function','function')
   await page.add_script_tag(content=js+'\nwindow.attachChemistry=attachChemistry;window.csvObservations=csvObservations;')
   await page.evaluate('''() => {
    window.chem = attachChemistry({getState:()=>({workspace_key:'fixture',data:{sources:[]}}),
     endpoint:(path,payload)=>({path,payload}),
     api:async v=>await nativeRead(v.path.split('/').pop(),v.payload||{}),
     showTask:()=>{},submitAction:()=>{},toast:console.log,fileList:()=>''});
    document.addEventListener('click',e=>{const b=e.target.closest('[data-action]');if(b)chem.dispatch(b)});
    chem.mount(document.querySelector('#content'));
   }''')
   await page.wait_for_selector('[data-case]');await page.select_option('[data-case]',case['id'])
   await page.click('[data-action="chemistry-open"]');await page.wait_for_selector('[data-project]',state='attached')
   displayed=json.loads(await page.input_value('[data-project]'));assert displayed==case['project']
   await page.click('[data-action="chemistry-run-open"]');await page.wait_for_selector('[data-result-table] table')
   await page.select_option('[data-result-field]','budgets');await page.wait_for_function("document.querySelector('[data-result-table]').textContent.includes('boundary_export_kg')")
   assert await page.locator('[data-result-table] tbody tr').count()==2
   await page.locator('[data-physical] details').evaluate_all('(items)=>items.forEach(x=>x.open=false)')
   await page.screenshot(path=str(HOME/'delivery-results/browser-chemistry.png'),full_page=True)
   observations=await page.evaluate("csvObservations('id,reach,species,day,mg_l,sigma_mg_l\\nx,tributary_a,NH4,1,0.2,0.1','constructed browser CSV')")
   assert observations[0]['mg_l']==.2
   await page.click('[data-action="chemistry-new"]');assert await page.input_value('[data-project]')==''
   assert not errors,errors
   await browser.close()
   print(json.dumps({'browser':'Chromium via Playwright','journey':'original-operator API contract driver with live model adapter on retained-source reference fixture','project_open':True,'live_result_page_rows':2,'csv_import':True,'new_scenario_resets_parent':True,'console_errors':errors},indent=2))
asyncio.run(main())
