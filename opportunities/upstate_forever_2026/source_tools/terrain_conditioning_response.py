"""Native NDR/SDR response to saved terrain editions on one unchanged lattice.

This is a terrain-specific comparison. The original general run-comparison rule
requiring one retained grid ID is not weakened. Every non-DEM input and reporting
mask must remain numerically identical, and the original source/profile/scenario
and native versions remain explicit. Export rasters already contain pixel mass.
"""
from __future__ import annotations
from contextlib import ExitStack
import base64
import csv
import html
import json
from pathlib import Path
import shutil
import numpy as np
from model.common import atomic_json,describe_file,digest,file_digest,held,identifier,now,read_json,verify_file
from model import rasters
from .terrain_conditioning import inspect as inspect_terrain

KIND='terrain-conditioning-responses'
FOLDER='terrain-conditioning-response-output'


def _equal_rasters(a,b):
    import rasterio
    with rasterio.open(a) as x,rasterio.open(b) as y:
        rasters.check_same_grid(x,y)
        for _,window in x.block_windows(1):
            aa=x.read(1,window=window,masked=True);bb=y.read(1,window=window,masked=True)
            ma=np.ma.getmaskarray(aa);mb=np.ma.getmaskarray(bb)
            if not np.array_equal(ma,mb) or not np.array_equal(aa.data[~ma],bb.data[~mb]):return False
    return True


def _copy(source,destination):
    destination.parent.mkdir(parents=True,exist_ok=True)
    if destination.exists():
        if file_digest(destination)!=file_digest(source):raise ValueError('Retained response source differs')
    else:shutil.copy2(source,destination)
    return destination


def inspect(ws,key):
    record=ws._get(KIND,identifier(key));p=ws.root/FOLDER/key/'result.json'
    if not p.exists():return {**record,'state':'prepared'}
    result=read_json(p)
    if result.get('id')!=key:raise ValueError('Retained terrain response identity differs')
    for f in result['files']:verify_file(ws.root,f)
    return result


def compare(ws,case_id,baseline_run_id):
    import rasterio
    from model.native_versions import comparison_versions,models_for_outputs
    from model.native import common_comparison_outputs
    terrain=inspect_terrain(ws,identifier(case_id),verify=True)
    if terrain['state']!='complete':raise ValueError('Prepare the terrain editions first')
    baseline=ws.inspect_run(identifier(baseline_run_id));bg=ws.get_grid(baseline['selection']['grid_id'])
    if baseline['state']!='complete':raise ValueError('Complete the selected original baseline run')
    if bg['spec']['source_collection_id']!=terrain['case']['context_collection_id'] or bg['inputs']['DEM']['source_sha256']!=terrain['case']['dem']['sha256']:
        raise ValueError('Choose the original baseline made from this terrain case’s unconditioned DEM and context source collection')
    bindings=[b for b in ws._list('terrain-conditioning-bindings') if b.get('case_id')==case_id and b.get('original_run_id')==baseline_run_id and b.get('run_id')]
    by_variant={b['variant']:b for b in bindings};selected=[]
    for variant in terrain['variants']:
        if variant['statistics']['changed_cells']==0:continue
        if variant['name'] not in by_variant:raise ValueError('Prepare and run the changed terrain edition '+variant['name'])
        binding=by_variant[variant['name']];run=ws.inspect_run(binding['run_id'])
        if run['state']!='complete':raise ValueError('Finish the native models for '+variant['name'])
        grid=ws.get_grid(run['selection']['grid_id'])
        if {k:v for k,v in run['selection'].items() if k!='grid_id'}!={k:v for k,v in baseline['selection'].items() if k!='grid_id'}:
            raise ValueError('Terrain response requires the same original scenario, profile and native version')
        for name,source in bg['inputs'].items():
            if name=='DEM':continue
            if grid['inputs'].get(name,{}).get('source_sha256')!=source['source_sha256']:raise ValueError('Non-terrain source changed: '+name)
        for name in set(bg['files']) & set(grid['files']):
            if name=='DEM' or not bg['files'][name]['path'].endswith('.tif'):continue
            left=verify_file(ws.root/'grids'/bg['id'],bg['files'][name]);right=verify_file(ws.root/'grids'/grid['id'],grid['files'][name])
            if not _equal_rasters(left,right):raise ValueError('Non-terrain prepared values or reporting support changed: '+name)
        for name in ('model_domain','reporting_area','upstream_buffer_m','resolution_m'):
            if grid['spec'].get(name)!=bg['spec'].get(name):raise ValueError('Original geometry selection changed: '+name)
        selected.append({'variant':variant['name'],'burn_depth_m':variant['burn_depth_m'],'run':run})
    if not selected:raise ValueError('This case has no changed terrain surface; retain the original native result')
    runs=[baseline]+[x['run'] for x in selected];outputs=common_comparison_outputs(runs)
    versions=comparison_versions(runs,models_for_outputs(outputs))
    selection=ws._save(KIND,{'case_id':case_id,'baseline_run_id':baseline_run_id,'alternatives':[{'variant':x['variant'],'burn_depth_m':x['burn_depth_m'],'run_id':x['run']['id']} for x in selected],'native_versions':versions,'implementation_sha256':file_digest(Path(__file__)),'direction':'alternative minus baseline'})
    key=selection['id'];folder=ws.root/FOLDER/key;folder.mkdir(parents=True,exist_ok=True)
    with held(folder/'.response.lock'):
        if (folder/'result.json').exists():return inspect(ws,key)
        rows=[];files=[];pictures=[];originals=[]
        for run in runs:
            source=ws.root/'runs'/run['id'];target=folder/'original-runs'/run['id']
            paths=[source/'run.json']
            for metric in outputs:
                art=run['artifacts'][metric];paths.append(verify_file(source,art))
                if art.get('native_output'):paths.append(verify_file(source,art['native_output']))
            for path in dict.fromkeys(paths):
                destination=_copy(path,target/path.relative_to(source));f=describe_file(ws.root,destination);files.append(f);originals.append({'run_id':run['id'],'member':str(destination.relative_to(folder)),**f})
        for metric in outputs:
            unit=rasters.MASS_UNITS[metric];artifacts=[r['artifacts'][metric] for r in runs]
            if any(a['units']!=unit for a in artifacts):raise ValueError('Use original normalized pixel-mass outputs, not per-hectare native rates')
            with ExitStack() as stack:
                datasets=[stack.enter_context(rasterio.open(verify_file(ws.root/'runs'/r['id'],r['artifacts'][metric]))) for r in runs]
                for ds in datasets[1:]:rasters.check_same_grid(datasets[0],ds)
                shape=datasets[0].shape;profile=datasets[0].profile
                arrays=[ds.read(1,masked=True) for ds in datasets]
                masks=[(~np.ma.getmaskarray(a))&np.isfinite(a.data) for a in arrays]
                joint=np.logical_and.reduce(masks);count=int(joint.sum())
                if not count:raise ValueError('Selected native outputs have no common valid cells for '+metric)
                base=arrays[0].data.astype('float64');base_sum=float(base[joint].sum(dtype='float64'))
                from .terrain_conditioning import _write
                maskpath=folder/(metric+'-joint-support.tif');_write(maskpath,joint.astype('float64'),np.ones(shape,bool),profile,'mask');files.append(describe_file(ws.root,maskpath))
                for i,chosen in enumerate(selected,1):
                    value=arrays[i].data.astype('float64');change=np.where(joint,value-base,0);vf=folder/(chosen['variant']+'-'+metric);vf.mkdir(exist_ok=True)
                    output=vf/'change.tif';_write(output,change,joint,profile,unit,direction='alternative minus baseline',baseline_run=baseline_run_id,alternative_run=chosen['run']['id'],support='Common valid cells across baseline and every selected alternative')
                    files.append(describe_file(ws.root,output,units=unit));delta=float(change[joint].sum(dtype='float64'));total=float(value[joint].sum(dtype='float64'))
                    row={'variant':chosen['variant'],'burn_depth_m':chosen['burn_depth_m'],'metric':metric,'units':artifacts[i].get('sum_units',unit.replace('/pixel','')),'baseline_joint_total':base_sum,'alternative_joint_total':total,'change_joint_total':delta,'change_percent':100*delta/base_sum if base_sum else None,'joint_valid_cells':count,'joint_area_ha':count*bg['grid']['pixel_area_ha'],'baseline_valid_cells':int(masks[0].sum()),'alternative_valid_cells':int(masks[i].sum()),'lost_valid_cells':int((masks[0]&~masks[i]).sum()),'gained_valid_cells':int((~masks[0]&masks[i]).sum()),'baseline_native_total':artifacts[0]['sum'],'alternative_native_total':artifacts[i]['sum'],'run_id':chosen['run']['id'],'difference':str(output.relative_to(folder))};rows.append(row)
                    from PIL import Image
                    stride=max(1,int(np.ceil(max(shape)/1200)));values=change[::stride,::stride];keep=joint[::stride,::stride];bound=float(np.max(np.abs(change[joint])))
                    intensity=np.full(values.shape,128,dtype='uint8') if bound==0 else np.clip((values+bound)/(2*bound)*210+25,0,255).astype('uint8')
                    rgba=np.stack([intensity,intensity,intensity,np.where(keep,255,0).astype('uint8')],axis=-1);Image.fromarray(rgba).save(vf/'change.png')
                    metadata={'minimum':-bound,'maximum':bound,'units':unit,'native_cell_stride':stride,'data_minimum':float(change[joint].min()),'data_maximum':float(change[joint].max()),'native_shape':list(shape),'sampling':'Every stride-th original cell; all analytical quantities use full native support'}
                    atomic_json(vf/'preview.json',metadata);files.extend(describe_file(ws.root,p) for p in (vf/'change.png',vf/'preview.json'))
                    pictures.append({'variant':chosen['variant'],'metric':metric,'uri':'data:image/png;base64,'+base64.b64encode((vf/'change.png').read_bytes()).decode(),'minimum':metadata['minimum'],'maximum':metadata['maximum'],'stride':stride,'units':unit})
        csv_path=folder/'native-response.csv'
        with csv_path.open('w',newline='',encoding='utf-8') as f:
            writer=csv.DictWriter(f,fieldnames=list(rows[0]));writer.writeheader();writer.writerows(rows)
        files.append(describe_file(ws.root,csv_path))
        result={'id':key,'state':'complete','schema':'upstate.terrain-native-response/v1','selection':selection,'completed_at':now(),'title':terrain['title']+' — native response','source_classification':terrain['case'].get('source_classification'),'rows':rows,'originals':originals,'baseline_reuse':[v['name'] for v in terrain['variants'] if v['statistics']['changed_cells']==0],'interpretation':'Actual completed native terrain-input sensitivity on the original fixed lattice. Tables and difference rasters use common valid cells across the baseline and every selected alternative, separately for each quantity. Original full-support totals and gained/lost valid cells are retained alongside that common-support result. Pixel-mass exports are summed once; neither hectare conversion nor reporting weighting is applied again. These conditional model responses do not by themselves demonstrate greater predictive accuracy.'}
        atomic_json(folder/'native-response.json',result,immutable=True);files.append(describe_file(ws.root,folder/'native-response.json'))
        report=_report(folder,result,pictures);files.append(describe_file(ws.root,report));result['files']=files;atomic_json(folder/'result.json',result,immutable=True)
        return result


def _report(folder,result,pictures):
    data=json.dumps({'result':result,'pictures':pictures},ensure_ascii=False,allow_nan=False).replace('<','\\u003c')
    content='''<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Native terrain response</title><style>
body{font:15px/1.5 system-ui;color:#222;background:#f3f3f3;margin:0}*{box-sizing:border-box}main{max-width:1180px;margin:auto;padding:28px}h1{font-size:28px}section{border:1px solid #bbb;background:white;padding:20px;margin:22px 0}select,button,textarea{font:inherit;background:white;border:1px solid #777;padding:9px;max-width:100%;color:#222}label{display:block}a{color:#222}table{border-collapse:collapse;width:100%;font-variant-numeric:tabular-nums}th,td{padding:9px;border-bottom:1px solid #ddd;text-align:right;white-space:nowrap}th{background:#eee}th:first-child,td:first-child{text-align:left}.scroll{overflow:auto}.controls{display:flex;gap:16px;flex-wrap:wrap}img{width:100%;max-height:550px;object-fit:contain;image-rendering:pixelated;background:#eee}.note{font-size:13px;color:#555}dl{display:grid;grid-template-columns:1fr 1fr;gap:8px}dt{font-weight:600}dd{margin:0}textarea{width:100%;min-height:100px}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px}@media(max-width:700px){main{padding:14px}section{padding:14px}h1{font-size:23px}.controls>*{width:100%}select{width:100%}dl{grid-template-columns:1fr}}
</style><main><header><p>Ecosystem Sciences · terrain-input sensitivity</p><h1 id="title"></h1><p id="scope"></p></header><section><h2>Native export response</h2><p>Positive change increases modeled export; negative change decreases it. All selections below use the same scenario, parameter profile and native model version.</p><div class="controls"><label>Quantity<select id="metric"></select></label><label>Terrain edition<select id="variant"></select></label></div><figure><img id="map" alt="Native pixel-mass export difference"><figcaption id="legend" class="note"></figcaption></figure><dl id="totals"></dl><a id="raster" download>Full-resolution difference GeoTIFF</a></section><section><h2>All changed terrain choices</h2><div class="scroll"><table><thead><tr><th>Edition / quantity</th><th>Baseline</th><th>Alternative</th><th>Change</th><th>Units</th><th>Joint ha</th><th>Lost / gained cells</th></tr></thead><tbody id="rows"></tbody></table></div><p><a href="native-response.csv" download>Exact response CSV</a> · <a href="native-response.json" download>Complete scientific record</a></p></section><section><h2>Interpretation and original data</h2><p id="interpretation"></p><p id="reuse"></p><details><summary>Original native runs and full-resolution outputs</summary><div id="originals"></div></details><details><summary>Original source selection and native versions</summary><pre id="selection"></pre></details></section><section><h2>Scientific notes</h2><label>Interpretation<textarea id="notes"></textarea></label><p><button id="export">Export notes and selected map</button> <label style="display:inline">Import notes <input type="file" id="import" accept="application/json,.json"></label></p><p id="status" role="status"></p></section></main><script id="data" type="application/json">'''+data+'''</script><script>
const D=JSON.parse(document.querySelector('#data').textContent),R=D.result,$=id=>document.getElementById(id),F=x=>typeof x==='number'?(x===0?0:x).toLocaleString(undefined,{maximumFractionDigits:4}):String(x??'—'),E=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));const key='terrain-response-notes:'+R.id;let saved={};try{saved=JSON.parse(localStorage.getItem(key)||'{}')}catch{}
$('title').textContent=R.title;$('scope').textContent='Source classification: '+(R.source_classification||'Retained source classification')+'. Actual InVEST runs on the original source lattice.';$('metric').innerHTML=[...new Set(R.rows.map(r=>r.metric))].map(x=>'<option value="'+E(x)+'">'+E(x.replaceAll('_',' '))+'</option>').join('');$('variant').innerHTML=[...new Set(R.rows.map(r=>r.variant))].map(x=>'<option>'+E(x)+'</option>').join('');for(const k of ['metric','variant'])if([...$(k).options].some(o=>o.value===saved[k]))$(k).value=saved[k];$('notes').value=saved.notes||'';$('interpretation').textContent=R.interpretation;$('reuse').textContent='Unchanged elevation editions reuse the original baseline: '+R.baseline_reuse.join(', ')+'.';$('selection').textContent=JSON.stringify(R.selection,null,2);$('originals').innerHTML=R.originals.map(f=>'<p><a download href="'+E(f.member)+'">'+E(f.member)+'</a></p>').join('');$('rows').innerHTML=R.rows.map(r=>'<tr>'+[r.variant+' / '+r.metric.replaceAll('_',' '),r.baseline_joint_total,r.alternative_joint_total,r.change_joint_total,r.units,r.joint_area_ha,r.lost_valid_cells+' / '+r.gained_valid_cells].map(v=>'<td>'+E(F(v))+'</td>').join('')+'</tr>').join('');
function record(){return{schema:'upstate.terrain-response-notes/v1',response_id:R.id,metric:$('metric').value,variant:$('variant').value,notes:$('notes').value}}function save(){try{localStorage.setItem(key,JSON.stringify(record()));$('status').textContent='Saved in this browser.'}catch{$('status').textContent='Use Export to retain these notes.'}}function draw(){const r=R.rows.find(r=>r.metric===$('metric').value&&r.variant===$('variant').value),p=D.pictures.find(p=>p.metric===r.metric&&p.variant===r.variant);$('map').src=p.uri;$('legend').textContent=F(p.minimum)+' to '+F(p.maximum)+' '+p.units+'; '+(p.stride===1?'every native cell shown':'preview samples every '+p.stride+'th cell')+'. Exact analytical values remain in the GeoTIFF.';$('raster').href=r.difference;$('totals').innerHTML=[['Baseline on common support',F(r.baseline_joint_total)+' '+r.units],['Alternative on common support',F(r.alternative_joint_total)+' '+r.units],['Change',F(r.change_joint_total)+' '+r.units+' ('+F(r.change_percent)+'%)'],['Common valid support',F(r.joint_valid_cells)+' cells / '+F(r.joint_area_ha)+' ha']].map(([k,v])=>'<dt>'+E(k)+'</dt><dd>'+E(v)+'</dd>').join('')}for(const k of ['metric','variant'])$(k).onchange=()=>{draw();save()};$('notes').oninput=save;$('export').onclick=()=>{const u=URL.createObjectURL(new Blob([JSON.stringify(record(),null,2)],{type:'application/json'})),a=document.createElement('a');a.href=u;a.download='terrain-response-notes.json';a.click();setTimeout(()=>URL.revokeObjectURL(u),1000)};$('import').onchange=async e=>{try{const r=JSON.parse(await e.target.files[0].text());if(r.schema!=='upstate.terrain-response-notes/v1'||r.response_id!==R.id||!R.rows.some(x=>x.metric===r.metric&&x.variant===r.variant)||typeof r.notes!=='string')throw Error('Select notes for this exact native response');$('metric').value=r.metric;$('variant').value=r.variant;$('notes').value=r.notes;draw();save()}catch(e){$('status').textContent=e.message}};draw();
</script></html>'''
    path=folder/'index.html';path.write_text(content,encoding='utf-8');return path
