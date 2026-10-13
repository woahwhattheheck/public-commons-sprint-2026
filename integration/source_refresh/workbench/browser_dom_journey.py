"""Offline Chromium DOM + real retained-file fixture backend bridge.

The separate journey.py exercises real HTTP. This file avoids browser navigation
and all browser network use; it does not modify Chromium's administrator policy.
"""
from pathlib import Path
import copy,json,shutil,urllib.parse
from concurrent.futures import ThreadPoolExecutor
from playwright.sync_api import sync_playwright
from journey import seed,HTTP,ROOT

root=Path('/mnt/data/eco-refresh/workbench/browser-workspace')
if root.exists():shutil.rmtree(root)
ws,old,entries,*_=seed(root)
e=copy.deepcopy(entries);e[7]['body']=ws.retain('new coefficients','bio.dat');new=ws.collection(e)
executor=ThreadPoolExecutor(max_workers=1)
jobs={}
def submit(kind,payload,fn):
 import hashlib
 key=hashlib.sha256(json.dumps([kind,payload,len(jobs)]).encode()).hexdigest()
 task={'id':key,'action':kind,'state':'queued'};jobs[key]=task
 def run():
  task['state']='running'
  try:
   if fn is None:
    destination=root.parent/(key+'.zip');ws.backup(destination,include_intermediates=True)
    task['_downloads']=[{'id':key}]
   else:task['result']=fn()
   task['state']='complete'
  except Exception as e:task.update(state='failed',error={'message':str(e)})
 executor.submit(run);return dict(task)

def bridge(url,options):
 target=urllib.parse.urlsplit(url);action=target.path.split('/api/')[-1]
 payload=json.loads(options.get('body','{}')) if options.get('method')=='POST' else {k:v[0] for k,v in urllib.parse.parse_qs(target.query).items()}
 try:
  if target.path=='/api/task':return {'status':200,'body':json.dumps(jobs[payload['id']])}
  if target.path=='/api/session':return {'status':200,'body':json.dumps({'connected':True})}
  response=HTTP.dispatch(ws,action,payload,submit=submit)
  return {'status':response.status,'body':response.body.decode(),'contentType':response.content_type}
 except Exception as e:return {'status':400,'body':json.dumps({'error':str(e)})}
errors=[]
try:
 with sync_playwright() as p:
  browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
  page=browser.new_page(viewport={'width':1440,'height':1000});page.on('pageerror',lambda e:errors.append(str(e)))
  text=(ROOT/'operator/web/source-refresh.html').read_text()
  import re
  text=re.sub(r'<link[^>]*>','',text);text=re.sub(r'<script.*?</script>','',text)
  page.set_content(text);page.add_style_tag(content=(ROOT/'operator/web/source-refresh.css').read_text())
  page.expose_function('fixtureBackend',bridge)
  page.evaluate('''() => {window.fixturePlan=null;history.replaceState=(a,b,url)=>{window.fixturePlan=url;};window.fetch=async(url,options)=>{const r=await fixtureBackend(String(url),options||{});return new Response(r.body,{status:r.status,headers:{'Content-Type':r.contentType||'application/json'}})};}''')
  page.add_script_tag(type='module',content=(ROOT/'operator/web/source-refresh.mjs').read_text())
  page.wait_for_function('document.querySelector("#previous").options.length === 3')
  page.select_option('#previous',old['id']);page.select_option('#replacement',new['id']);page.click('button[type=submit]')
  page.get_by_text('Comparison complete. Review changes, then save the rebuild plan.').wait_for();assert page.locator('#changes tbody tr').count()==10
  page.click('#create');page.get_by_text('Saved. Review exactly which selections are reused or derived.').wait_for();assert page.locator('#plan tbody tr').count()==6
  page.click('#prepare');page.wait_for_function('document.querySelector("#progress").textContent.includes("Status: prepared")')
  page.click('#execute');page.wait_for_function('document.querySelector("#progress").textContent.includes("Status: complete")')
  assert len(ws.executed)==2
  page.click('#reload');page.wait_for_function('document.querySelector("#progress").textContent.includes("Status: complete")')
  assert page.locator('#reports a').count()==3
  page.screenshot(path='/mnt/data/eco-refresh/workbench/source-refresh-desktop.png',full_page=True)
  page.set_viewport_size({'width':390,'height':844});page.screenshot(path='/mnt/data/eco-refresh/workbench/source-refresh-mobile.png',full_page=True)
  assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
  page.click('#export');page.get_by_text('Download complete editable workspace',exact=True).wait_for()
  current=page.evaluate('new URL(window.fixturePlan,"http://fixture").searchParams.get("plan_id")')
  report='/source-refresh/api/report?'+urllib.parse.urlencode({'plan_id':current,'format':'html'});reply=bridge(report,{'method':'GET'});assert reply['status']==200
  page.set_content(reply['body']);page.screenshot(path='/mnt/data/eco-refresh/workbench/source-refresh-report.png',full_page=True)
  assert not errors,errors
  print(json.dumps({'scope':'Offline Chromium DOM plus retained-file fixture backend bridge; real HTTP is exercised separately. No browser networking or administrator-policy changes.', 'stages':['choose editions','compare 10 sources','save six-node plan','prepare changed selections','execute two changed run probes','reopen saved state','render complete HTML report','desktop and 390px mobile review','original backup action and download ticket'],'browser_errors':errors,'native_run_probes':len(ws.executed),'report_status':reply['status'],'mobile_overflow':False},indent=2))
  browser.close()
finally:executor.shutdown(wait=True)
