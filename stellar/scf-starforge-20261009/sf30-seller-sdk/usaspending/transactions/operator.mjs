// MIT. Transaction operations through the existing award browser and CLI.
import { requireThat, plain } from '../core.mjs';
import { workshareBrief } from '../brief.mjs';
export const TRANSACTION_HELP=[
'Transaction commands use the same retained award workspace:',
'  tx-state',
'  tx-capture --edition ID --key ORIGINAL_AWARD_ID [--page-size 250 --max-rows 250000]',
'  tx-resume --capture ID',
'  tx-capacity --capture ID --max-rows N --updated-at ISO_TIME',
'  tx-import --edition ID --key ORIGINAL_AWARD_ID --file ORIGINAL_PAGES.json',
'  tx-summary --capture ID [--out FILE]',
'  tx-browse --capture ID [--page N --limit N --search TEXT --start-date YYYY-MM-DD --end-date YYYY-MM-DD]',
'  tx-compare --before ID --after ID [--out FILE]',
'  tx-review --capture ID --revision N --file ASSESSMENT.json',
'  tx-source --capture ID --page N --out ORIGINAL_RESPONSE.json',
'  tx-export --capture ID --out FILE [--include-reviews]',
'  tx-csv --capture ID --out FILE [--spreadsheet]',
'  tx-brief --capture ID --out FILE',
'  tx-receive --file CAPTURE.json [--edition ID --include-reviews]',
''
].join('\n');
function fields(body,names) {requireThat(plain(body)&&Object.keys(body).every(k=>names.includes(k)),'TRANSACTION_OPTIONS_INVALID');}
function captureParam(url){const value=url.searchParams.get('capture');requireThat(value,'TRANSACTION_CAPTURE_REQUIRED');return value;}
export function transactionGet(workspace,url) {
  const tx=workspace.transactions,path=url.pathname,q=url.searchParams;
  if(path==='/api/transactions/state')return {value:tx.state()};
  if(path==='/api/transactions/summary')return {value:tx.summary(captureParam(url))};
  if(path==='/api/transactions/rows')return {value:tx.browse(captureParam(url),{page:Number(q.get('page')??1),limit:Number(q.get('limit')??100),search:q.get('search')??'',startDate:q.get('startDate')??'',endDate:q.get('endDate')??''})};
  if(path==='/api/transactions/compare')return {value:tx.compare(q.get('before'),q.get('after'))};
  if(path==='/api/transactions/source'){
    const s=tx.source(captureParam(url),Number(q.get('page')));
    if(q.get('format')==='receipt')return {value:{captureId:s.capture_id,page:s.page,request:s.request,receipt:s.receipt,sha256:s.sha256}};
    return {value:s.response,options:{filename:s.capture_id+'-page-'+s.page+'.json'}};
  }
  if(path==='/api/transactions/export'){
    const capture=captureParam(url),format=q.get('format')??'json';
    if(format==='csv')return {value:tx.csv(capture,{spreadsheet:true}),options:{type:'text/csv; charset=utf-8',filename:capture+'.csv'}};
    requireThat(format==='json','TRANSACTION_EXPORT_FORMAT_INVALID');
    return {value:tx.export(capture,{includeReview:q.get('reviews')==='true'}),options:{filename:capture+'.json'}};
  }
  if(path==='/api/transactions/brief'){
    const capture=captureParam(url),c=tx.capture(capture);
    return {value:tx.brief(capture,{awardBrief:workshareBrief(workspace,c.award_edition_id,c.award_key)}),options:{type:'text/markdown; charset=utf-8',filename:capture+'-workshare.md'}};
  }
  throw Object.assign(new Error('Unknown transaction operation.'),{code:'NOT_FOUND',status:404});
}
export function transactionPost(workspace,path,body,{startJob}) {
  const tx=workspace.transactions;
  if(path==='/api/transactions/capture'){
    fields(body,['editionId','awardKey','pageSize','maxRows']);
    return {status:202,value:startJob('award_transactions',signal=>tx.run(body,{signal}))};
  }
  if(path==='/api/transactions/resume'){
    fields(body,['captureId']);return {status:202,value:startJob('award_transactions',signal=>tx.run(body,{signal}))};
  }
  if(path==='/api/transactions/capacity'){fields(body,['captureId','maxRows','expectedUpdatedAt']);return {value:tx.capacity(body)};}
  if(path==='/api/transactions/import'){fields(body,['editionId','awardKey','pages','maxRows']);return {value:tx.import(body)};}
  if(path==='/api/transactions/review'){fields(body,['captureId','expectedRevision','review']);return {value:tx.saveReview(body)};}
  if(path==='/api/transactions/receive'){
    fields(body,['packet','editionId','includeReview']);
    requireThat(body.includeReview===undefined||typeof body.includeReview==='boolean','TRANSACTION_REVIEW_OPTION_INVALID');
    return {value:tx.receive(body.packet,{editionId:body.editionId,includeReview:body.includeReview??false})};
  }
  throw Object.assign(new Error('Unknown transaction operation.'),{code:'NOT_FOUND',status:404});
}
export async function transactionCommand(workspace,o,{only,need,num,json,output,signal}) {
  const tx=workspace.transactions;
  switch(o.command) {
    case 'tx-state':only(o,[]);return tx.state();
    case 'tx-capture':only(o,['edition','key','page-size','max-rows']);return tx.run({editionId:need(o,'edition'),awardKey:need(o,'key'),pageSize:num(o,'page-size',250,1,5000),maxRows:num(o,'max-rows',250000,1,250000)},{signal});
    case 'tx-resume':only(o,['capture']);return tx.run({captureId:need(o,'capture')},{signal});
    case 'tx-capacity':only(o,['capture','max-rows','updated-at']);return tx.capacity({captureId:need(o,'capture'),maxRows:num(o,'max-rows',undefined,1,250000),expectedUpdatedAt:need(o,'updated-at')});
    case 'tx-import':{
      only(o,['edition','key','file','max-rows']);
      const value=await json(need(o,'file'));fields(value,['pages']);
      return tx.import({editionId:need(o,'edition'),awardKey:need(o,'key'),pages:value.pages,maxRows:num(o,'max-rows',250000,1,250000)});
    }
    case 'tx-summary':only(o,['capture','out']);return output(o,tx.summary(need(o,'capture')));
    case 'tx-browse':only(o,['capture','page','limit','search','start-date','end-date','out']);return output(o,tx.browse(need(o,'capture'),{page:num(o,'page',1,1),limit:num(o,'limit',100,1,500),search:o.search??'',startDate:o['start-date']??'',endDate:o['end-date']??''}));
    case 'tx-compare':only(o,['before','after','out']);return output(o,tx.compare(need(o,'before'),need(o,'after')));
    case 'tx-review':only(o,['capture','revision','file']);return tx.saveReview({captureId:need(o,'capture'),expectedRevision:num(o,'revision',undefined,0),review:await json(need(o,'file'))});
    case 'tx-source':only(o,['capture','page','out']);need(o,'out');return output(o,tx.source(need(o,'capture'),num(o,'page',undefined,1)).response,{text:true});
    case 'tx-export':only(o,['capture','out','include-reviews']);need(o,'out');return output(o,tx.export(need(o,'capture'),{includeReview:!!o['include-reviews']}));
    case 'tx-csv':only(o,['capture','out','spreadsheet']);need(o,'out');return output(o,tx.csv(need(o,'capture'),{spreadsheet:!!o.spreadsheet}),{text:true});
    case 'tx-brief':{
      only(o,['capture','out']);need(o,'out');const c=tx.capture(need(o,'capture'));
      return output(o,tx.brief(c.id,{awardBrief:workshareBrief(workspace,c.award_edition_id,c.award_key)}),{text:true});
    }
    case 'tx-receive':only(o,['file','edition','include-reviews']);return tx.receive(await json(need(o,'file'),128*1024*1024),{editionId:o.edition,includeReview:!!o['include-reviews']});
    default:throw Object.assign(new Error('Unknown transaction command. Use --help.'),{code:'COMMAND_UNKNOWN'});
  }
}
