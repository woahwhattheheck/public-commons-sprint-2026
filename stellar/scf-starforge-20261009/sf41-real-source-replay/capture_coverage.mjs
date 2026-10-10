// MIT. Authentic single-provider x402 Bazaar capture-v1 manifest completeness proof.
// Accepts original observed page metadata, never invented provider rows or purchases.
const number=(v)=>Number.isSafeInteger(v)&&v>=0;
const positive=(v)=>number(v)&&v>0;
const fail=(message)=>{throw Error('Capture coverage: '+message)};
export function inspectCaptureCoverage(manifest,pages){
  if(!Array.isArray(pages)||pages.length!==manifest.sources?.length||!pages.length)
    fail('page count does not match manifest sources');
  const rows=pages.reduce((n,p)=>n+p.rows,0);
  if(!number(rows))fail('unsafe total row count');
  const endpoints=new Set();
  const urls=pages.map(p=>{
    if(!p?.source?.url||!number(p.rows)||!p.sha256)fail('missing page provenance');
    let u;try{u=new URL(p.source.url)}catch{fail('malformed original page URL')}
    if(u.protocol!=='https:'||u.username||u.password)fail('non-HTTPS original page URL');
    endpoints.add(u.origin+u.pathname);
    return u;
  });
  if(manifest.schema!=='SCF-SF41/capture-v1'||endpoints.size!==1){
    return {verified:false,status:endpoints.size>1?'MIXED_PROVIDERS':'UNRECOGNIZED_MANIFEST',rows,pages:pages.length};
  }
  if(manifest.endpoint!==[...endpoints][0])fail('endpoint differs from page origin/path');
  if(!positive(manifest.page_size)||manifest.page_size>100)fail('invalid captured page_size');
  if(!number(manifest.rows_captured)||manifest.rows_captured!==rows)
    fail('rows_captured does not equal source page row sum');
  let target=manifest.expected_total??null,offset=0,proof='DECLARED_TOTAL_MATCHED';
  if(target!==null&&!number(target))fail('invalid expected_total');
  const hashes=new Set();
  for(let i=0;i<pages.length;i++){
    const p=pages[i],u=urls[i];
    const requestedOffset=Number(u.searchParams.get('offset'));
    const requestedLimit=Number(u.searchParams.get('limit'));
    if(!u.searchParams.has('offset')||!u.searchParams.has('limit')||
       !number(requestedOffset)||requestedOffset!==offset||
       requestedLimit!==manifest.page_size)
      fail('noncontiguous or invalid native request at page '+i);
    if(p.rows>requestedLimit)fail('page over requested limit at '+i);
    if(hashes.has(p.sha256))fail('identical native bytes repeated across offsets');
    hashes.add(p.sha256);
    if(p.version!==undefined&&p.version!==null&&p.version!==2)
      fail('non-v2 provider page at '+i);
    const pagination=p.pagination;
    if(pagination!==undefined&&pagination!==null){
      if(typeof pagination!=='object'||Array.isArray(pagination))fail('invalid native pagination object');
      if(pagination.offset!==undefined&&pagination.offset!==offset)
        fail('native returned offset mismatch at '+i);
      if(pagination.limit!==undefined&&
         (!positive(pagination.limit)||pagination.limit>100||pagination.limit<p.rows))
        fail('invalid native returned limit at '+i);
      if(pagination.total!==undefined){
        if(!number(pagination.total))fail('invalid native total at '+i);
        if(target===null)target=pagination.total;
        else if(target!==pagination.total)fail('native total changed at '+i);
      }
    }
    offset+=p.rows;
    if(target!==null&&offset>target)fail('pages exceed native declared total');
    if(p.rows===0&&target!==null&&offset<target)fail('early empty page at '+i);
    if(p.rows===0&&i!==pages.length-1)fail('terminal empty page followed by more pages');
    if(target!==null&&offset===target&&i!==pages.length-1)
      fail('pages supplied after declared total already reached');
  }
  if(target!==null){
    if(offset!==target)fail('incomplete corpus: '+offset+'/'+target);
    if(manifest.pagination_coverage!==undefined&&manifest.pagination_coverage!==null&&
       manifest.pagination_coverage!=='DECLARED_TOTAL_MATCHED')
      fail('coverage label conflicts with declared total');
  }else{
    if(pages.at(-1).rows!==0)fail('no declared total or explicit empty final page');
    proof='EXPLICIT_EMPTY_PAGE';
    if(manifest.pagination_coverage!==undefined&&manifest.pagination_coverage!==null&&
       manifest.pagination_coverage!=='EXPLICIT_EMPTY_PAGE')
      fail('coverage label conflicts with explicit EOF');
  }
  return {verified:true,status:proof,rows,pages:pages.length,expected_total:target,endpoint:manifest.endpoint};
}
