#!/usr/bin/env node
// MIT. Operate the original SDK, cart workspace and native Woo checkout in one receiving instance.
import {readFileSync,writeFileSync,mkdirSync,existsSync,copyFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {createRequire} from 'node:module';
import {CartWorkspace,SOURCE} from '../workspace.mjs';
import {loadSDK,action,serve} from '../server.mjs';

const argv=process.argv.slice(2),args={};
while(argv.length){const key=argv.shift();if(!key?.startsWith('--')||!argv.length)throw Error('Use --name value arguments.');args[key.slice(2)]=argv.shift();}
const root=resolve(args.root||process.env.COCART_RUNTIME_ROOT||'');
if(!args.root&&!process.env.COCART_RUNTIME_ROOT)throw Error('Select the owned native runtime root.');
const transport=args.transport||process.env.COCART_TRANSPORT_ORIGIN;
const sdkEntry=args.sdk||process.env.COCART_SDK_ENTRY;
const chromiumPath=args.chromium||'/workspace/scratch/bc0850d7ba23/browser-runtime/chrome-headless-shell';
const modules=args['node-modules']||process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES;
if(!transport||!sdkEntry||!modules)throw Error('Provide the actual transport, original SDK and installed Node module directory.');
const checkpointDir=args['checkpoint-dir']||process.env.COCART_CHECKPOINT_DIR||null;
if(checkpointDir)mkdirSync(checkpointDir,{recursive:true});
const out=join(root,'exports/cocart'),progressPath=join(root,'cocart-receiving-progress.json'),workRoot=join(root,'headless-workspace');
mkdirSync(out,{recursive:true});
const hash=b=>createHash('sha256').update(b).digest('hex');
const write=(p,v)=>writeFileSync(p,JSON.stringify(v,null,2)+'\n');
const originalProduct=JSON.parse(readFileSync(join(root,'exports/native-product.json'),'utf8'));
const merchantOrigin=originalProduct.storeOrigin;
const profileBytes=readFileSync(join(root,'exports/merchant-profile.json'));
const profile=JSON.parse(profileBytes);
const sdk=await loadSDK(resolve(sdkEntry));
let progress=existsSync(progressPath)?JSON.parse(readFileSync(progressPath,'utf8')):{
 schema:'tjlabs.cocart-native-receiving/v1',startedAt:new Date().toISOString(),source:SOURCE,
 productId:String(originalProduct.productId),originalProfileSha256:hash(profileBytes),steps:[],routes:[],pageErrors:[]
};
if(progress.productId!==String(originalProduct.productId)||progress.originalProfileSha256!==hash(profileBytes))throw Error('Continue this operation with its original saved native product/profile.');
function save(){write(progressPath,progress);write(join(out,'operation.json'),progress);if(checkpointDir){write(join(checkpointDir,'Receiving_Progress.json'),progress);if(typeof workspace!=='undefined'&&!workspace.active){const bytes=workspace.receivingBundle();writeFileSync(join(checkpointDir,'CoCart_Receiving_Workspace.json.gz'),gzipSync(bytes,{level:6}));}}}
function note(name,detail={}){const row={name,at:new Date().toISOString(),...detail};progress.steps.push(row);save();console.log(JSON.stringify({step:name,...detail}));return row;}
const completed=name=>progress.steps.some(s=>s.name===name);
const workspace=new CartWorkspace(existsSync(join(workRoot,'workspace.json'))?{root:workRoot,...sdk}:{
 root:workRoot,create:true,...sdk,profile,profileBytes,receivingTransport:{
 store_url:transport,checkout_url:transport+new URL(profile.checkout_url).pathname+new URL(profile.checkout_url).search,reason:'Independent native WooCommerce receiving instance'
 }
});
const act=async(name,payload)=>action(workspace,name,payload,workspace.view().version);
const cart=()=>workspace.view().carts.find(c=>c.id===progress.cartId);
const snapshot=()=>{const c=cart();return c?.snapshots.find(s=>s.id===c.current_snapshot)?.projection;};
let browser=null,web=null,context=null,page=null;
async function launch(viewport={width:1440,height:1050}){
 const require=createRequire(import.meta.url),{chromium}=require(join(modules,'playwright'));
 const b=await chromium.launch({executablePath:chromiumPath,headless:true,args:[
 '--no-sandbox','--disable-dev-shm-usage','--disable-gpu','--in-process-gpu','--no-zygote','--single-process','--renderer-process-limit=1','--js-flags=--max-old-space-size=128'
 ]});
 const c=await b.newContext({viewport,acceptDownloads:true,ignoreHTTPSErrors:true});
 c.on('page',p=>p.on('pageerror',e=>{progress.pageErrors.push({at:new Date().toISOString(),message:e.message});save();}));
 const canonical=new URL(merchantOrigin),local=new URL(transport);
 c.on('page',p=>p.on('requestfailed',request=>{
   progress.requestFailures??=[];
   progress.requestFailures.push({at:new Date().toISOString(),url:request.url(),method:request.method(),failure:request.failure()});
   save();
 }));
 await c.route('**/*',async route=>{
   const request=route.request(),u=new URL(request.url());
   if(u.hostname!==canonical.hostname&&u.origin!==local.origin){await route.continue();return;}
   const response=await c.request.fetch(transport+u.pathname+u.search,{
     method:request.method(),headers:request.headers(),data:request.postDataBuffer()??undefined,
     maxRedirects:0,timeout:90000
   });
   const headers=response.headers(),originalLocation=headers.location||null;
   let receivingLocation=originalLocation;
   if(originalLocation){
     const target=new URL(originalLocation,u);
     if(target.hostname===canonical.hostname||target.origin===local.origin){
       receivingLocation=merchantOrigin+target.pathname+target.search+target.hash;
     }
   }
   progress.routes.push({at:new Date().toISOString(),method:request.method(),url:u.href,path:u.pathname,status:response.status(),
     originalLocation,receivingLocation,contentType:headers['content-type']||null});
   save();
   await route.fulfill({response,...(receivingLocation&&receivingLocation!==originalLocation?{headers:{...headers,location:receivingLocation}}:{})});
 });
 return {browser:b,context:c};
}
async function uiDone(expected){
 await page.waitForFunction(expected=>{
  const e=document.querySelector('#status');
  return !!e&&(e.classList.contains('error')||e.textContent===expected);
 },expected,{timeout:90000});
 const state=await page.locator('#status').evaluate(e=>({text:e.textContent,error:e.classList.contains('error')}));
 if(state.error)throw Error('Native workspace UI: '+state.text);
}
async function mutate(name,payload){
 if(completed(name))return;
 const result=await act('cart.mutate',{cart_id:progress.cartId,request_id:'cocart-native-v1:'+name,...payload});
 if(result.operation.status!=='APPLIED')throw Error('Original '+name+' returned '+result.operation.status+': '+JSON.stringify(result.operation.error||result.operation.refresh_error||{}));
 const p=snapshot();note(name,{operationId:result.operation.id,status:result.operation.status,lines:p.items.length,items:p.item_count,currency:p.currency,total:p.total_display});
}
async function captureBundle(){
 const bytes=workspace.receivingBundle();writeFileSync(join(out,'CoCart_Receiving_Workspace.json'),bytes);
 return {filename:'CoCart_Receiving_Workspace.json',bytes:bytes.length,sha256:hash(bytes),workspaceVersion:workspace.view().version};
}
async function main(){
 if(!completed('merchant-profile-received')){
   const source=workspace.view().profile_source;
   if(!workspace.readObject(source.sha256).equals(profileBytes))throw Error('Original merchant profile bytes changed.');
   copyFileSync(join(root,'exports/merchant-profile.json'),join(out,'Native_Merchant_Profile.json'));
   copyFileSync(join(root,'exports/native-product.json'),join(out,'Native_Product.json'));
   note('merchant-profile-received',{sha256:source.sha256,canonicalOrigin:merchantOrigin,productId:progress.productId,versions:originalProduct.versions});
 }
 if(!completed('native-catalog')){
   const result=await act('catalog.load',{page:1,per_page:20});
   if(!result.catalog.products.some(p=>String(p.id)===progress.productId))throw Error('The actual mapped Woo product is absent from the native CoCart catalog.');
   note('native-catalog',{catalogId:result.catalog.id,products:result.catalog.products.map(p=>({id:p.id,name:p.name,type:p.type})),source:result.catalog.exchange.sha256});
 }
 if(!progress.cartId){
   const existing=workspace.view().carts.find(c=>c.label==='Headless customer receiving');
   const selected=existing|| (await act('cart.create',{label:'Headless customer receiving'})).cart;
   progress.cartId=selected.id;save();note('native-cart-created',{cartId:selected.id,cartKeySha256:hash(selected.cart_key)});
 }
 await mutate('cart-add-one',{action:'add',product_id:progress.productId,quantity:1});
 await mutate('cart-quantity-two',{action:'quantity',item_key:snapshot().items[0]?.item_key,quantity:2});
 if(!completed('quantity-two-admission')){
   const result=await act('checkout.prepare',{cart_id:progress.cartId,mode:'replace'});
   if(result.handoff.admission.eligible||result.handoff.storefront.total!=='5.00')throw Error('The original quantity-two cart did not retain its exact native total and mapping comparison.');
   note('quantity-two-admission',{total:result.handoff.storefront.total,eligible:false,reasons:result.handoff.admission.reasons});
 }
 await mutate('cart-calculate',{action:'calculate'});
 await mutate('cart-remove',{action:'remove',item_key:snapshot().items[0]?.item_key});
 await mutate('cart-restore',{action:'restore',item_key:snapshot().removed_items[0]?.item_key});
 await mutate('cart-clear',{action:'clear'});
 await mutate('cart-final-add-two',{action:'add',product_id:progress.productId,quantity:2});
 web=await serve({workspace,port:0});
 ({browser,context}=await launch());
 progress.browserVersion=browser.version();save();
 page=await context.newPage();page.setDefaultTimeout(60000);
 await page.goto(web.origin,{waitUntil:'networkidle',timeout:90000});
 await page.locator('#cart-title').filter({hasText:'Headless customer receiving'}).waitFor();
 if(!completed('browser-cart-quantity-one')){
   const input=page.locator('[data-quantity]').first();await input.fill('1');
   await page.locator('[data-update]').first().click();await uiDone('Native cart updated.');
   const p=snapshot();if(p.items.length!==1||p.items[0].quantity!==1||p.total_display!=='2.50')throw Error('Native browser quantity change did not retain USD2.50.');
   note('browser-cart-quantity-one',{items:p.item_count,total:p.total_display,workspaceRevision:workspace.view().revision});
 }
 if(!progress.previewId){
   await page.locator('#checkout [name=mode]').selectOption('replace');
   await page.locator('#checkout button').click();await uiDone('Current cart is ready to continue in Woo checkout.');
   const h=cart().handoffs.at(-1);
   if(!h?.admission.eligible||h.storefront.total!=='2.50')throw Error('The current native cart does not match the original saved product mapping.');
   progress.previewId=h.id;save();note('browser-checkout-prepared',{previewId:h.id,total:h.storefront.total,mode:h.mode,admission:h.admission});
 }
 await page.screenshot({path:join(out,'CoCart_Workspace_Desktop.png'),fullPage:true});
 if(!completed('native-woo-order-received')){
   let native=await context.newPage();native.setDefaultTimeout(60000);
   native.on('response',async response=>{
    if(response.url().includes('wc-ajax=checkout')){
      try{const result=await response.json();write(join(out,'Native_Checkout_Response.json'),result);
       if(result.result==='success'&&result.redirect){progress.nativeOrderUrl=result.redirect;save();}
      }catch(error){progress.checkoutResponseReadError=error.message;save();}
    }
   });
   if(progress.nativeOrderUrl){
      await native.goto(progress.nativeOrderUrl,{waitUntil:'networkidle',timeout:90000});
   }else{
      if(progress.checkoutDispatchedAt)throw Error('The original checkout was dispatched. Recover its existing native order URL before continuing this same operation.');
      const h=cart().handoffs.find(x=>x.id===progress.previewId),u=new URL(h.checkout_url);
      await native.goto(merchantOrigin+u.pathname+u.search,{waitUntil:'networkidle',timeout:90000});
      await native.locator('form.checkout').waitFor();
      const fields={billing_first_name:'Receiving',billing_last_name:'Operator',billing_company:'Native customer receiving',
       billing_address_1:'1 Receiving Way',billing_city:'Denver',billing_postcode:'80202',billing_phone:'2025550104',billing_email:'receiving@example.invalid'};
      const country=native.locator('#billing_country');if(await country.count())await country.selectOption('US');
      for(const [id,value]of Object.entries(fields)){const field=native.locator('#'+id);if(await field.count())await field.fill(value);}
      const state=native.locator('#billing_state');if(await state.count()){if(await state.evaluate(e=>e.tagName)==='SELECT')await state.selectOption('CO');else await state.fill('CO');}
      await native.locator('#billing_email').blur();
      await native.locator('#payment_method_sf104_native').waitFor({state:'attached',timeout:90000});
      await native.locator('#payment_method_sf104_native').check({force:true});
      const terms=native.locator('#terms');if(await terms.count())await terms.check({force:true});
      await native.screenshot({path:join(out,'Native_Woo_Checkout.png'),fullPage:true});
      progress.checkoutDispatchedAt=new Date().toISOString();save();
      await native.locator('#place_order').click();
      await native.waitForURL(u=>u.pathname.includes('/order-received/'),{timeout:120000});
      await native.waitForLoadState('networkidle',{timeout:90000});
      progress.nativeOrderUrl=native.url();save();
   }
   const link=native.getByRole('link',{name:'Download payment instructions',exact:true});
   await link.waitFor({timeout:90000});
   const downloadPromise=native.waitForEvent('download',{timeout:90000});
   await link.click();const download=await downloadPromise;
   const target=join(out,'Original_Woo_Checkout_Handoff.json');await download.saveAs(target);
   const bytes=readFileSync(target),h=JSON.parse(bytes);
   const response=await act('woo.attach',{cart_id:progress.cartId,preview_id:progress.previewId,content_base64:bytes.toString('base64')});
   progress.orderReference=response.order.order_reference;progress.handoffSha256=hash(bytes);save();
   await native.screenshot({path:join(out,'Native_Woo_Order.png'),fullPage:true});
   note('native-woo-order-received',{orderReference:response.order.order_reference,attemptGeneration:response.order.attempt_generation,originalBuyerIntent:response.order.original_buyer_intent,storefront:response.order.storefront,handoffBytes:bytes.length,handoffSha256:hash(bytes),resource:h.operation?.url});
   await native.close();
 }
 await page.reload({waitUntil:'networkidle'});
 await page.getByText('Woo order '+progress.orderReference+' · attempt 1',{exact:true}).waitFor();
 const downloadPromise=page.waitForEvent('download');await page.getByRole('link',{name:'Download receiving workspace',exact:true}).click();
 const download=await downloadPromise;const uiExport=join(out,'CoCart_Receiving_Workspace.json');await download.saveAs(uiExport);
 const receivingBytes=readFileSync(uiExport),originalVersion=workspace.view().version;
 const receiverRoot=join(root,'received-headless-workspace');
 const receiver=CartWorkspace.receive({root:receiverRoot,bytes:receivingBytes,...sdk});
 if(receiver.view().version!==originalVersion)throw Error('The original receiving workspace revision changed.');
 const resumed=CartWorkspace.receive({root:receiverRoot,bytes:receivingBytes,...sdk});
 if(resumed.view().version!==originalVersion)throw Error('The same receiving input did not reopen its existing workspace.');
 if(!completed('receiving-workspace-imported'))note('receiving-workspace-imported',{bytes:receivingBytes.length,sha256:hash(receivingBytes),workspaceVersion:originalVersion,objects:JSON.parse(receivingBytes).objects.length,carts:receiver.view().carts.length});
 await browser.close();browser=null;context=null;await web.close();web=null;
 web=await serve({workspace:resumed,port:0});
 ({browser,context}=await launch({width:390,height:844}));
 page=await context.newPage();await page.goto(web.origin,{waitUntil:'networkidle',timeout:90000});
 await page.getByText('Woo order '+progress.orderReference+' · attempt 1',{exact:true}).waitFor({timeout:60000});
 const width=await page.evaluate(()=>({viewport:innerWidth,document:document.documentElement.scrollWidth,body:document.body.scrollWidth}));
 if(width.document>width.viewport+2)throw Error('The receiving workspace exceeds the390px mobile page width: '+JSON.stringify(width));
 await page.screenshot({path:join(out,'CoCart_Received_Workspace_Mobile.png'),fullPage:true});
 if(!completed('fresh-browser-receiving'))note('fresh-browser-receiving',{viewport:width,orderReference:progress.orderReference,workspaceVersion:resumed.view().version});
 if(progress.pageErrors.length)throw Error('Browser page errors: '+JSON.stringify(progress.pageErrors));
 progress.completedAt=new Date().toISOString();progress.result='COMPLETE';progress.finalWorkspaceVersion=workspace.view().version;
 progress.output={receiving:{filename:'CoCart_Receiving_Workspace.json',bytes:receivingBytes.length,sha256:hash(receivingBytes)},orderReference:progress.orderReference,cartOperations:cart().operations.length,nativeSnapshots:cart().snapshots.length};
 save();console.log(JSON.stringify({result:progress.result,output:progress.output,completedAt:progress.completedAt}));
}
try{await main();}
catch(error){progress.error={at:new Date().toISOString(),message:error.message,stack:error.stack,details:error.toJSON?.()||null};try{save();await captureBundle();}catch{}console.error(JSON.stringify({error:error.message,stack:error.stack,details:error.toJSON?.()||null}));process.exitCode=1;}
finally{if(browser)await browser.close().catch(()=>{});if(web)await web.close().catch(()=>{});save();}
