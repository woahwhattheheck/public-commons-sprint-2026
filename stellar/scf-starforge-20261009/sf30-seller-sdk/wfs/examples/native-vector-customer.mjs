// MIT. Native vector receiving inside the original complete GeoSolutions customer operation.
import assert from 'node:assert/strict';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {normalizeCrs} from '../protocol.mjs';
import {inspectWfsVector,listWfsVectors} from '../vector.mjs';
import {optionalJson,exactFile} from '../source.mjs';
import {parseExactJSON,stringifyExactJSON} from '../../stac/vector/json.mjs';

const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const plain=value=>JSON.parse(JSON.stringify(value));
const complete=value=>{assert.equal(value.state,'COMPLETE');assert.equal(value.receipt.state,'COMPLETE');return value;};
const ids={captures:['wfs-original-vector-edition-1','wfs-original-vector-edition-2'],
  comparison:'wfs-original-vector-comparison',receive:'wfs-original-vector-receiving'};
async function downloadBytes(download){
  const stream=await download.createReadStream();assert(stream,'The original browser download failed.');
  const chunks=[];let size=0;
  for await(const part of stream){size+=part.length;assert(size<=256*1024*1024);chunks.push(part);}
  return Buffer.concat(chunks);
}
async function browserReady(page,url){
  await page.goto(url,{waitUntil:'networkidle'});
  await page.waitForFunction(()=>document.getElementById('project-title').textContent==='GeoSolutions WFS original customer workspace');
  await page.locator('nav>[data-section="vectors"]').click();
  await page.locator('#vector-refresh').waitFor({state:'visible'});
  await page.waitForFunction(()=>!document.getElementById('vector-refresh').disabled);
}
async function inspectRow(page,id){
  const row=page.locator('#vector-history tr').filter({has:page.getByText(id,{exact:true})});
  assert.equal(await row.count(),1,'One retained native operation must own this ID.');
  await row.getByRole('button',{name:'Inspect',exact:true}).click();
  await page.waitForFunction(id=>!document.getElementById('vector-inspection').hidden&&
    document.getElementById('vector-selection-summary').textContent.includes(id),id);
  await page.waitForFunction(()=>!document.getElementById('vector-refresh').disabled);
}
function exportDetails(view,capture,profile){
  complete(view);const manifest=parseExactJSON(view.manifestJson),receiving=parseExactJSON(view.receivingJson);
  assert.equal(manifest.schema,'starforge.vector-export.v1');
  assert.equal(manifest.sourceCapture.sha256,capture.receipt.manifest.sha256);
  assert.equal(receiving.allOriginalBindingsMatched,true);
  assert.deepEqual([...new Set(manifest.native.layers.map(row=>row.driver))].sort(),['ESRI Shapefile','GPKG']);
  const original=profile.layers[capture.receipt.sourceId];
  for(const layer of manifest.native.layers){
    assert.equal(layer.sourceId,capture.receipt.sourceId);
    assert.equal(layer.sourceReference.captureSha256,capture.receipt.manifest.sha256);
    assert.equal(layer.sourceFeatureCount,capture.receipt.counts.features);
    assert.equal(layer.coordinateOrder,'x,y');
    for(const [name,rule]of Object.entries(original.fields??{})){
      const field=layer.fields.find(row=>row.sourceName===name);assert(field);
      if(rule.names?.[layer.driver])assert.equal(field.targetName,rule.names[layer.driver]);
      if(rule.mode==='json')assert(['json','reference'].includes(field.codec));
    }
  }
  return{manifest,receiving};
}
/** Run before the original merchant source snapshot so every native result travels to its customer. */
export async function prepareNativeVectorCustomer({app,call,source,orders,root,outputs,retained,step,nativeBrowser,browserUrl}){
  const captures=[];
  for(let index=0;index<orders.length;index++){
    const order=await app.query('order',{orderId:orders[index]});
    assert.equal(order.complete,true);assert.equal(order.rows,source.manifest.editions[index].numberMatched);
    const sourceCrs=normalizeCrs(order.selection.srsName);
    assert.equal(sourceCrs,normalizeCrs(source.selection.srsName));
    for(const declared of order.responseCrs)assert.equal(normalizeCrs(declared),sourceCrs);
    // The original WFS parser has already checked each retained GeoJSON response against this CRS.
    const input={id:ids.captures[index],orderId:orders[index],sourceCrs,coordinateOrder:'x,y',
      identityJson:'{"mode":"feature-id"}'};
    const saved=await retained('native-vector/capture-'+(index+1)+'.json',async()=>input);assert.deepEqual(saved,input);
    complete(await call('vector_capture',saved));
    const view=complete(await app.query('vector',{id:input.id})),manifest=parseExactJSON(view.manifestJson),
      inspection=parseExactJSON(view.inspectionJson);
    assert.equal(inspection.counts.features,order.rows);
    assert.equal(manifest.selection.sourceEdition.order.id,orders[index]);
    assert.equal(manifest.selection.sourceEdition.projectId,app.binding.projectId);
    assert.equal(inspection.layers.length,1);
    assert.equal(inspection.layers[0].id,view.receipt.sourceId);
    captures.push(view);
  }
  assert.equal(captures[0].receipt.sourceId,captures[1].receipt.sourceId);
  const comparison=complete(await call('vector_compare',{id:ids.comparison,before:ids.captures[0],after:ids.captures[1]}));
  const compared=complete(await app.query('vector',{id:comparison.id})),comparisonManifest=parseExactJSON(compared.manifestJson);
  const counts=comparisonManifest.counts;
  assert.equal(counts.unchanged+counts.changed+counts.removed,captures[0].receipt.counts.features);
  assert.equal(counts.unchanged+counts.changed+counts.added,captures[1].receipt.counts.features);
  let offset=0,changes=0;
  do{const page=parseExactJSON((await app.query('vector-changes',{id:comparison.id,offset,limit:100})).resultJson);
    changes+=page.changes.length;offset=page.nextOffset;}while(offset!==null);
  assert.equal(changes,counts.added+counts.removed+counts.changed);
  const capture=captures[1],inspection=parseExactJSON(capture.inspectionJson),layer=inspection.layers[0];
  assert(layer.fields.STATE_NAME,'The selected original states source must retain STATE_NAME.');
  const numeric=Object.keys(layer.fields).find(name=>name==='PERSONS'&&
    Object.keys(layer.fields[name].kinds).some(kind=>['integer','number'].includes(kind)))??
    Object.keys(layer.fields).find(name=>Object.keys(layer.fields[name].kinds).some(kind=>['integer','number'].includes(kind)));
  assert(numeric,'Choose an actual numeric field from the original source.');
  const page=await(await nativeBrowser()).newPage({viewport:{width:1440,height:1000}});
  page.setDefaultTimeout(180000);const errors=[];page.on('pageerror',error=>errors.push(String(error)));
  let request,reviewed,exported,zip,loss;
  try{
    await browserReady(page,browserUrl);
    await page.locator('#vector-capture').selectOption(capture.id);
    await page.locator('#vector-load-profile').click();
    await page.getByLabel('STATE_NAME GeoPackage name',{exact:true}).waitFor({state:'visible'});
    await page.waitForFunction(()=>!document.getElementById('vector-load-profile').disabled);
    await page.locator('#vector-format-gpkg').check();await page.locator('#vector-format-shape').check();
    await page.locator('#vector-layer-name').fill('states_reviewed');
    await page.getByLabel('STATE_NAME GeoPackage name',{exact:true}).fill('state_name');
    await page.getByLabel('STATE_NAME Shapefile name',{exact:true}).fill('ST_NAME');
    await page.getByLabel(numeric+' representation',{exact:true}).selectOption('json');
    const earlier=await optionalJson(join(root,'native-vector/ui-export-request.json'),8*1024*1024);
    if(earlier){
      request=JSON.parse(earlier.bodyText);
      assert.equal(request.action,'vector-export');assert.equal(request.captureId,capture.id);
      // A resumed foreground retains the original UI review and operation, including its exact spacing.
      if(!await page.locator('#vector-profile').isVisible())await page.locator('#vector-export-form details summary').click();
      await page.locator('#vector-profile').fill(request.profileJson);
    }
    reviewed=await page.locator('#vector-profile').inputValue();
    const profile=parseExactJSON(reviewed),selected=profile.layers[capture.receipt.sourceId];
    assert.equal(selected.assignSourceCrs,parseExactJSON(capture.receipt.profileJson).layers[capture.receipt.sourceId].assignSourceCrs);
    assert.equal(selected.name,'states_reviewed');assert.equal(selected.fields.STATE_NAME.names.GPKG,'state_name');
    assert.equal(selected.fields.STATE_NAME.names['ESRI Shapefile'],'ST_NAME');assert.equal(selected.fields[numeric].mode,'json');
    const downloaded=page.waitForEvent('download');
    await page.locator('#vector-profile-download').click();
    const file=await downloadBytes(await downloaded);assert.equal(file.toString('utf8'),reviewed);
    await exactFile(join(outputs,'native-reviewed-profile.json'),file);
    await page.screenshot({path:join(outputs,'merchant-vector-mapping.png'),fullPage:true});
    if(earlier){
      exported=complete(await app.action(request));
      await page.locator('#vector-refresh').click();
    }else{
      let accept,reject,firstBody,interceptCount=0;
      const committed=new Promise((done,fail)=>{accept=done;reject=fail;});committed.catch(()=>{});
      const routeHandler=async route=>{
        const raw=route.request().postData(),body=raw?JSON.parse(raw):{};
        if(body.action!=='vector-export')return route.continue();
        try{
          interceptCount++;
          if(interceptCount>1){assert.equal(raw,firstBody);return route.continue();}
          assert.equal(body.captureId,capture.id);assert.equal(body.profileJson,reviewed);
          firstBody=raw;request=body;
          const saved=await retained('native-vector/ui-export-request.json',async()=>({bodyText:raw}));
          assert.equal(saved.bodyText,raw);
          const response=await route.fetch({timeout:180000});assert.equal(response.status(),200,await response.text());
          const result=complete(await response.json());assert.equal(result.id,request.id);
          loss=await retained('native-vector/lost-export-reply.json',async()=>({
            id:request.id,bodySha256:hash(raw),receipt:result.receipt,interruptedAfter:'COMMITTED_HTTP_RESULT'}));
          assert.equal(loss.id,request.id);assert.equal(loss.bodySha256,hash(raw));
          await route.abort('connectionreset');accept(result);
        }catch(error){reject(error);await route.abort().catch(()=>{});}
      };
      await page.route('**/api/action',routeHandler);
      try{
        await page.locator('#vector-export-form button[type="submit"]').click();await committed;
        await page.waitForFunction(()=>!document.getElementById('vector-retry').disabled);
        await page.reload({waitUntil:'networkidle'});
        await page.locator('nav>[data-section="vectors"]').click();
        await page.waitForFunction(id=>[...document.getElementById('vector-pending-select').options].some(option=>option.value===id),request.id);
        await page.locator('#vector-pending-select').selectOption(request.id);
        await page.locator('#vector-retry').click();
        await page.waitForFunction(id=>{
          try{const value=JSON.parse(document.getElementById('vector-result').textContent);return value.id===id&&value.state==='COMPLETE';}
          catch{return false;}
        },request.id);
        assert.equal(interceptCount,2);
        exported=complete(await app.query('vector',{id:request.id}));
        assert.deepEqual(exported.receipt,loss.receipt);
      }finally{await page.unroute('**/api/action',routeHandler);}
    }
    const replay=complete(await call('vector_export',{id:request.id,captureId:capture.id,profileJson:request.profileJson}));
    assert.equal(replay.reused,true);
    exported=complete(await app.query('vector',{id:request.id}));
    const details=exportDetails(exported,capture,parseExactJSON(request.profileJson));
    const list=await app.query('vectors',{offset:0,limit:1000});
    assert.equal(list.items.filter(item=>item.id===request.id).length,1);
    await inspectRow(page,request.id);
    const download=page.waitForEvent('download');
    await page.locator('#vector-selected-download').click();zip=await downloadBytes(await download);
    await exactFile(join(outputs,'wfs-original-native-vectors.zip'),zip);
    await page.screenshot({path:join(outputs,'merchant-vector-native.png'),fullPage:true});
    await exactFile(join(outputs,'native-export-manifest.json'),Buffer.from(exported.manifestJson+'\n'));
    assert(details.manifest.files.some(file=>file.path.endsWith('.gpkg')));
    assert(details.manifest.files.some(file=>file.path.endsWith('.shp')));
    assert.deepEqual(errors,[]);
  }finally{await page.close();}
  const receiveInput={action:'vector-receive',id:ids.receive,archiveBase64:zip.toString('base64'),
    archiveSha256:hash(zip),manifestSha256:exported.receipt.manifest.sha256};
  complete(await app.action(receiveInput));
  const received=complete(await app.query('vector',{id:ids.receive}));
  assert.equal(received.receipt.manifest.sha256,exported.receipt.manifest.sha256);
  assert.equal(parseExactJSON(received.receivingJson).allOriginalBindingsMatched,true);
  const records=[...captures,compared,exported,received].map(value=>({
    id:value.id,kind:value.kind,requestSha256:value.requestSha256,receipt:plain(value.receipt)}));
  const result={schema:'stellar-forge.wfs-native-vector-customer.v1',projectId:app.binding.projectId,
    sourceManifestSha256:hash(source.raw),sourceOrderIds:[...orders],records,
    exportId:exported.id,comparisonId:compared.id,receivedId:received.id,counts,
    reviewedProfile:{path:'native-reviewed-profile.json',bytes:Buffer.byteLength(reviewed),sha256:hash(reviewed)},
    archive:{path:'wfs-original-native-vectors.zip',bytes:zip.length,sha256:hash(zip)},
    interruptedReply:await optionalJson(join(root,'native-vector/lost-export-reply.json'),4*1024*1024),
    browserErrors:errors};
  await step('native-vectors-before-original-publication',result);return result;
}
export async function verifyNativeVectorCustomer({directory,python,expected,label,step}){
  const rows=await listWfsVectors({directory,offset:0,limit:1000});assert.equal(rows.projectId,expected.projectId);
  const records=[];
  for(const original of expected.records){
    assert.equal(rows.items.filter(row=>row.id===original.id).length,1);
    const actual=complete(await inspectWfsVector({directory,id:original.id,python}));
    assert.equal(actual.requestSha256,original.requestSha256);assert.deepEqual(actual.receipt,original.receipt);
    if(actual.receivingJson)assert.equal(parseExactJSON(actual.receivingJson).allOriginalBindingsMatched,true);
    records.push({id:actual.id,manifestSha256:actual.receipt.manifest.sha256});
  }
  await step(label,{projectId:rows.projectId,directory,records});return records;
}
export async function inspectNativeVectorBrowser({page,expected,outputs}){
  await page.locator('nav>[data-section="vectors"]').click();
  await page.waitForFunction(()=>!document.getElementById('vector-refresh').disabled);
  await inspectRow(page,expected.exportId);
  assert(await page.locator('#vector-layers tr').count()>=2);
  assert((await page.locator('#vector-native-json').inputValue()).includes('"allOriginalBindingsMatched": true'));
  await page.screenshot({path:join(outputs,'customer-vector-native.png'),fullPage:true});
  return{exportId:expected.exportId,manifestSha256:expected.records.find(row=>row.id===expected.exportId).receipt.manifest.sha256};
}
