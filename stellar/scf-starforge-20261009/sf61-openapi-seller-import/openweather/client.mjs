// MIT. Node and browser client for retained data; hourly traversal pins the first returned edition.
const ID=/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const check=v=>{if(typeof v!=='string'||!ID.test(v))throw new TypeError('Use a project or data-edition identifier');return v;};
export function createWeatherClient({url,token,timeoutMs=20000,fetchImpl=globalThis.fetch}){
  const base=new URL(url);
  if(!['https:','http:'].includes(base.protocol)||base.protocol==='http:'&&!['127.0.0.1','localhost','[::1]'].includes(base.hostname)||
    base.username||base.password||base.search||base.hash)throw new TypeError('Use HTTPS or local loopback HTTP without URL credentials');
  if(typeof token!=='string'||!token.trim())throw new TypeError('Supply the application access token');
  if(!Number.isInteger(timeoutMs)||timeoutMs<1000||timeoutMs>120000)throw new TypeError('Use a 1–120 second request deadline');
  const root=base.href.replace(/\/$/,'');
  const request=async(project,review,kind,query='')=>{
    const r=await fetchImpl(root+'/weather/'+check(project)+'/'+check(review)+'/'+kind+query,
      {headers:{'x-weather-token':token,accept:'application/json'},redirect:'error',signal:AbortSignal.timeout(timeoutMs)});
    const chunks=[];let bytes=0;
    if(r.body)for await(const c of r.body){bytes+=c.length;if(bytes>2*1024*1024)throw new Error('Weather application response exceeded 2 MiB');chunks.push(c);}
    const joined=new Uint8Array(bytes);let offset=0;for(const c of chunks){joined.set(c,offset);offset+=c.length;}
    let data;try{data=JSON.parse(new TextDecoder().decode(joined));}catch{throw new Error('Weather application did not return complete JSON');}
    if(!r.ok)throw Object.assign(new Error(data.error??'Weather application rejected the request'),{status:r.status,code:data.code});
    if(data.schema!=='stellar-forge.openweather-customer.v1'||data.project!==project||!ID.test(data.review)||review!=='active'&&data.review!==review)
      throw new Error('Weather application returned a different data contract');
    return data;
  };
  const current=(project,{review='active'}={})=>request(project,review,'current');
  const hourlyPage=(project,{review='active',offset=0,limit=100}={})=>{
    if(!Number.isInteger(offset)||offset<0||!Number.isInteger(limit)||limit<1||limit>200)throw new TypeError('Use a nonnegative offset and limit 1–200');
    return request(project,review,'hourly','?offset='+offset+'&limit='+limit);
  };
  async function* hourly(project,{review='active',limit=100}={}){
    let offset=0,pinned=review;
    while(true){
      const page=await hourlyPage(project,{review:pinned,offset,limit});
      if(page.offset!==offset||!Array.isArray(page.data)||pinned!=='active'&&page.review!==pinned)throw new Error('Hourly page changed its retained edition');
      pinned=page.review;
      yield*page.data;
      if(page.nextOffset===null)break;
      if(!Number.isSafeInteger(page.nextOffset)||page.nextOffset<=offset)throw new Error('Hourly continuation did not advance');
      offset=page.nextOffset;
    }
  }
  return {current,hourlyPage,hourly};
}
