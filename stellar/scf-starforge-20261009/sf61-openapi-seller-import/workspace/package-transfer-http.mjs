// MIT. Additive transfer operations inside the ORIGINAL SF61 host lifecycle.
import {
  inspectMerchantPackage, listMerchantPackages, exportMerchantPackage,
  inspectMerchantPackageExport, listMerchantPackageExports,
  readMerchantPackageExportFile, releaseMerchantPackageExportFile,
  receiveMerchantPackage, stageMerchantPackage, MerchantPackageFileReads,
} from './package-transfer.mjs';

function number(url,name,fallback) {
  const value=url.searchParams.get(name);
  if(value===null)return fallback;
  if(!/^(0|[1-9][0-9]*)$/.test(value)||!Number.isSafeInteger(Number(value)))
    throw new TypeError('Use a nonnegative integer '+name+'.');
  return Number(value);
}
function page(url) {return {after:url.searchParams.get('after')??'',limit:number(url,'limit',25)};}
function bodyFields(value,allowed) {
  if(value===null||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!allowed.includes(key)))
    throw new TypeError('Supply the original package-transfer fields.');
  return value;
}
/** Call after original Host, Origin and x-workspace-token checks.
 * POST calls participate in the original workspace busy and drain lifecycle.
 * Receiving paths and release stores are host inputs; MCP resolves saved aliases. */
export function createPackageTransferRoutes({parent,validatePlan}) {
  const reads=new MerchantPackageFileReads({errorPrefix:'OPENAPI'}),pending=new Set();
  let closing;
  const track=action=>{
    if(closing)throw Object.assign(new Error('Package transfer is closing.'),{code:'OPENAPI_CLOSING',status:503});
    const promise=Promise.resolve().then(action);pending.add(promise);
    return promise.finally(()=>pending.delete(promise));
  };
  return {
    get(pathname,url,send) {return track(async()=>{
      if(pathname==='/api/package-transfer/packages')return send(200,await listMerchantPackages({parent,...page(url)}));
      if(pathname==='/api/package-transfer/inspect')return send(200,await inspectMerchantPackage({parent,name:url.searchParams.get('name')}));
      if(pathname==='/api/package-transfer/exports')return send(200,await listMerchantPackageExports({parent,...page(url)}));
      if(pathname==='/api/package-transfer/manifest') {
        const value=await inspectMerchantPackageExport({parent,exportId:url.searchParams.get('exportId')});
        return send(200,{...value,fileReads:reads.status(value.exportId+':'+value.manifestFile.sha256)});
      }
      if(pathname==='/api/package-transfer/file')return send(200,await readMerchantPackageExportFile({parent,reads,
        exportId:url.searchParams.get('exportId'),file:url.searchParams.get('file'),
        expectedManifestSha256:url.searchParams.get('expectedManifestSha256'),
        expectedSha256:url.searchParams.get('expectedSha256'),
        offset:number(url,'offset',0),limit:number(url,'limit',196608),
        ...(url.searchParams.has('readId')?{readId:url.searchParams.get('readId')}:{})}));
      return send(404,{error:'Unknown package-transfer operation.'});
    });},
    async post(pathname,body,send) {
      if(pathname==='/api/package-transfer/export')return send(201,await exportMerchantPackage({parent,
        ...bodyFields(body,['name','expectedPackageManifestSha256'])}));
      if(pathname==='/api/package-transfer/file-release')return send(200,await releaseMerchantPackageExportFile({parent,reads,
        ...bodyFields(body,['exportId','readId'])}));
      if(pathname==='/api/package-transfer/receive')return send(201,await receiveMerchantPackage({parent,
        ...bodyFields(body,['directory','name','expectedManifestSha256'])}));
      if(pathname==='/api/package-transfer/stage')return send(201,await stageMerchantPackage({parent,validatePlan,
        ...bodyFields(body,['name','store','id','createStore','expectedPackageManifestSha256'])}));
      return send(404,{error:'Unknown package-transfer operation.'});
    },
    close() {
      return closing??=(async()=>{await Promise.allSettled([...pending]);await reads.close();})();
    },
  };
}
