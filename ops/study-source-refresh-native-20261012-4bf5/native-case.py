"""One connected operation over the original retained public-source providers."""
from __future__ import annotations
import gc,hashlib,json,os,shutil,sqlite3,subprocess,sys,time,traceback
from pathlib import Path

BASE=Path(sys.argv[1]).resolve()
SOURCE=Path(sys.argv[2]).resolve()
SHARED=Path(sys.argv[3]).resolve()
APP=SOURCE/'stellar/scf-starforge-20261009/sf30-seller-sdk/study-source-refresh'
NODE=os.environ['CODEX_PRIMARY_RUNTIME_NODE']
INPUTS=json.loads((SHARED/'inputs.json').read_text())
PYTHON=sys.executable
sys.path.insert(0,str(APP))
from cli import main as operate
from workspace import Workspace
from model import default_mapping,encoded,identity,StudyError
from delivery import export_package,verify_package,import_package,receive_package,archive_package

RESULT={'schema':'study-source-refresh.native-journey.v1','source_commit':'33e15a25627d5a21d5f7436bcb790225b08a4714','phases':[]}
def save():
 target=SHARED/'native-result.json'
 temporary=target.with_suffix('.next')
 temporary.write_text(json.dumps(RESULT,indent=2));temporary.chmod(0o600);os.replace(temporary,target)
def phase(name,**values):
 value={'phase':name,**values};RESULT['phases'].append(value);save()
 print(json.dumps(value),flush=True)
def command(*args):
 return operate(['--workspace',str(BASE/'producer'),*map(str,args)])
def json_file(name,value):
 p=BASE/name;p.write_bytes(encoded(value)+b'\n');p.chmod(0o600);return p
def sha(path):
 h=hashlib.sha256()
 with Path(path).open('rb') as stream:
  while raw:=stream.read(65536):h.update(raw)
 return h.hexdigest()

server=None
try:
 BASE.mkdir(mode=0o700,parents=True,exist_ok=True)
 if (BASE/'producer').exists():
  raise RuntimeError('Original operation directory already exists; reconcile retained phase first.')
 command('init')
 inputs=[(provider,name,INPUTS[name]) for provider,name in [('acs','acs2023'),('acs','acs2024'),('bls','bls')]]
 sources={}
 for provider,name,path in inputs:
  received=command('import-source','--provider',provider,'--source',path,'--node',NODE)
  sources[name]=received['id']
  phase('source.import',name=name,id=received['id'],capture_id=received['capture_id'],
        rows=received['rows'])
  del received;gc.collect()
 # Original HUD retained-release API: no seller or network capture is created.
 build=BASE/'hud-build.mjs'
 build.write_text("""import {retainHudRelease,writeHudSource} from './source/stellar/scf-starforge-20261009/sf30-seller-sdk/hud-income-limits/release.mjs';
import {join} from 'node:path';
const base=process.argv[2],python=process.argv[3],original=process.argv[4];
const retained=await retainHudRelease(join(base,'hud-original-release'),
 {fiscalYear:2026,effectiveDate:'2026-05-01',reviewer:'Study source operator',
 note:'Original published HUD FY2026 Section 8 workbook, area definitions, methodology and source HTTP receipts.'},
 {sourceDirectory:original,python});
const selected=await writeHudSource(join(base,'hud-source.json'),retained,{counties:['17143','17179','17203']});
process.stdout.write(JSON.stringify({release_id:retained.manifest.releaseId,source:join(base,'hud-source.json')})+'\\n');
""")
 build.chmod(0o600)
 completed=subprocess.run([NODE,str(build),str(BASE),PYTHON,INPUTS['hud_original_directory']],capture_output=True,text=True,timeout=150)
 if completed.returncode:raise RuntimeError('Original HUD release builder: '+completed.stderr[-6000:])
 hud=json.loads(completed.stdout)
 received=command('import-source','--provider','hud','--source',hud['source'],'--node',NODE)
 sources['hud']=received['id'];phase('source.import',name='hud',id=received['id'],capture_id=received['capture_id'],rows=received['rows'])
 del received;gc.collect()
 workspace=Workspace(BASE/'producer')
 catalog=workspace.catalog(source_ids=list(sources.values()),limit=500)
 selected_tables={'B01003':'persons','B25001':'housing_units','B25002':'housing_units',
                  'B25003':'housing_units','B19013':'money','B25064':'money','B25077':'money'}
 chosen=[{'family':item['family'],'measure_id':item['measure_id']} for item in catalog['measures']
         if item['family']!='acs' or any(item['measure_id'].startswith(table+'_') for table in selected_tables)]
 assert chosen and {item['family'] for item in chosen}=={'acs','laus','qcew','hud_income_limits'}
 geographies=[]
 for item in catalog['geographies']:
  geo={k:v for k,v in item.items() if k!='rows'}
  geo.update(client_geography_id=item['source_geography_id'],
   comparison_group='retained-id:'+item['family']+':'+item['source_geography_id'],
   crosswalk_note='Operator matched this exact retained provider geography identifier across the selected source definition editions.')
  geographies.append(geo)
 portfolio={'schema':'stellar-forge.study-portfolio.v1','name':'Published housing and labor source portfolio',
            'geographies':geographies,'measures':chosen}
 port=workspace.save_revision('portfolio',portfolio)
 mappings={}
 for year in (2023,2024):
  mapping=default_mapping('Published source units '+str(year))
  for item in chosen:
   if item['family']=='acs':
    table=item['measure_id'].split('_')[0];kind=selected_tables[table]
    unit='USD_'+str(year)+'_published' if kind=='money' else kind
    mapping['units'].append({'family':'acs','measure_id':item['measure_id'],'unit':unit,
                            'output_unit':unit,'factor':'1','decimal_places':None})
  mappings[year]=workspace.save_revision('mapping',mapping)['id']
 editions={}
 for year in (2023,2024):
  edition=workspace.freeze([sources['acs'+str(year)],sources['bls'],sources['hud']],port['id'],mappings[year],
                           'Retained ACS '+str(year)+' with published labor and HUD inputs')
  if edition['global_issues'] or edition['counts']['rows_with_mapping_issues']:
   raise RuntimeError('Frozen selection requires correction: '+json.dumps(edition))
  editions[year]=edition['id']
  phase('edition.freeze',year=year,id=edition['id'],counts=edition['counts'])
 # One saved comparison distinguishes new reference periods from revised releases.
 same=workspace.compare(editions[2024],editions[2023],mode='same_period')
 assert same['counts'].get('added',0)>0 and same['counts'].get('removed',0)>0
 phase('comparison.same_period',id=same['id'],counts=same['counts'])
 paired=workspace.compare(editions[2024],editions[2023],mode='successive_release',
  note='Review the two retained ACS rolling windows as successive releases. Published monetary unit vintages remain explicit; labor and HUD inputs retain their original periods.',
  unchanged='accept')
 phase('comparison.successive_release',id=paired['id'],counts=paired['counts'])
 keys=[row[0] for row in workspace.connection.execute('SELECT key FROM differences WHERE comparison_id=? AND kind!=?',(paired['id'],'unchanged'))]
 old_version=paired['review_version']
 if keys:
  paired=workspace.review(paired['id'],keys,'accept','Native study operator',
   'Reviewed original source values, MOEs, disclosure statuses, explicit geography mapping and period labels. Retain current published monetary units; incompatible unit vintages keep a null delta.',
   old_version)
  try:
   workspace.review(paired['id'],keys[:1],'accept','Native study operator','Stale reply recovery',old_version)
   raise AssertionError('stale decision version was accepted')
  except StudyError as error:
   assert error.code=='REVIEW_CHANGED'
  phase('review.saved',review_version=paired['review_version'],reviewed_keys=len(keys),stale_version_rejected=True)
 assert paired['pending']==0 and not paired['global_issues']
 sample=workspace.connection.execute('SELECT row_id FROM edition_rows WHERE edition_id=? ORDER BY row_id LIMIT 1',(editions[2024],)).fetchone()[0]
 original=workspace.original_row(editions[2024],sample)
 assert original['native'] and original['canonical']['source_hash']
 packet=export_package(workspace,paired['id'],expected_version=paired['review_version'],
                       operator='Native study operator',label='Published housing and labor source refresh',
                       destination=BASE/'complete-packet')
 manifest=verify_package(packet['directory'])
 event_count=workspace.connection.execute('SELECT COUNT(*) FROM events').fetchone()[0]
 phase('export.complete',package_id=manifest['package_id'],rows=manifest['rows'],
       files=len(manifest['files']),bytes=sum(x['bytes'] for x in manifest['files']),events=event_count)
 workspace.close();del workspace,original;gc.collect()
 # Retire only the disposable producer copy after the complete packet is verified.
 shutil.rmtree(BASE/'producer')
 receiver=Workspace(BASE/'receiver')
 imported=import_package(receiver,BASE/'complete-packet')
 history=receiver.connection.execute('SELECT COUNT(*) FROM events').fetchone()[0]
 imported_again=import_package(receiver,BASE/'complete-packet')
 assert receiver.connection.execute('SELECT COUNT(*) FROM events').fetchone()[0]==history
 assert receiver.overview()['exports'][0]['id']==manifest['package_id']
 assert verify_package(imported['directory'])['package_id']==manifest['package_id']
 phase('package.import',events=history,repeated_import_deduplicated=True,received_package_visible=True)
 receiver.close();del receiver;gc.collect()
 shutil.rmtree(BASE/'receiver')
 fresh=receive_package(BASE/'complete-packet',BASE/'reopened')
 reopened=receive_package(BASE/'complete-packet',BASE/'reopened')
 assert fresh['package_id']==reopened['package_id']==manifest['package_id'] and reopened['reopened']
 phase('package.receive',fresh_reopen=True,review_version=fresh['comparison']['review_version'])
 # Preserve source/review packet before browser work; the completed product is independent of Chrome.
 archive=archive_package(BASE/'complete-packet',SHARED/'Study_Source_Refresh_Original_Packet.zip')
 phase('packet.archive',path=archive['path'],sha256=archive['sha256'],bytes=archive['bytes'])
 RESULT.update(sources=sources,portfolio_id=port['id'],edition_ids=editions,comparison_id=paired['id'],
               package_id=manifest['package_id'],packet=archive,source_complete=True)
 save()
 shutil.rmtree(BASE/'complete-packet')
 serverlog=(BASE/'server.log').open('w')
 server=subprocess.Popen([PYTHON,str(APP/'cli.py'),'--workspace',str(BASE/'reopened'),'serve'],
                         stdout=serverlog,stderr=subprocess.STDOUT,env={**os.environ,'PYTHONDONTWRITEBYTECODE':'1'})
 connection=BASE/'reopened'/'connection.json'
 deadline=time.monotonic()+15
 while not connection.exists():
  if server.poll() is not None:raise RuntimeError('Study HTTP server exited: '+(BASE/'server.log').read_text())
  if time.monotonic()>deadline:raise RuntimeError('Study HTTP connection was not ready')
  time.sleep(.1)
 browser=subprocess.run([NODE,str(SHARED/'browser.mjs'),str(connection),str(SHARED),str(BASE/'browser-profile')],
                        capture_output=True,text=True,timeout=150)
 (SHARED/'browser.log').write_text(browser.stdout+browser.stderr)
 if browser.returncode:raise RuntimeError('Original study browser operation: '+browser.stderr[-6000:])
 browser_result=json.loads(browser.stdout.strip().splitlines()[-1])
 RESULT['browser']=browser_result
 phase('browser.complete',**browser_result)
 RESULT['status']='PASS';save()
 print(json.dumps({'status':'PASS','operation':'STUDY-SOURCE-REFRESH-NATIVE-4BF5-20261012','source':RESULT['source_commit'],
                   'package_id':manifest['package_id'],'archive':archive,'sources':sources,
                   'same_period':same['counts'],'successive_release':paired['counts'],'browser':browser_result}),flush=True)
except BaseException as error:
 RESULT['status']='FAILED';RESULT['failure']={'type':type(error).__name__,'message':str(error)}
 save();traceback.print_exc();raise
finally:
 if server is not None:
  server.terminate()
  try:server.wait(timeout=8)
  except subprocess.TimeoutExpired:server.kill();server.wait(timeout=3)
