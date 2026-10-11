// MIT. Portable customer exports and explicitly configured acquisition schedules.
import {readReview,createAcquisition,reviewAcquisition,selectReview} from './acquisition.mjs';
import {FIELD_MAP,SOURCE,stable,digest,identifier,integer,fail,units} from './contract.mjs';

const columns=['at','temperature','feelsLike','dewPoint','pressure','humidity','clouds','visibility','uvIndex',
  'windSpeed','windGust','windDirection','rainRate','snowRate','precipitationProbability','sunrise','sunset'];
const quote=value=>'"'+String(value??'').replaceAll('"','""')+'"';
export function csv(data){
  const unit=data.units,head=['timestamp_utc','timestamp_local','timezone',...columns.slice(1),'weather','alert_ids'];
  const zone=data.timezone;
  const local=at=>zone?new Intl.DateTimeFormat('sv-SE',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).format(new Date(at*1000)):'';
  const rows=data.hourly.map(r=>[new Date(r.at*1000).toISOString(),local(r.at),zone,...columns.slice(1).map(k=>r[k]??''),JSON.stringify(r.weather??[]),JSON.stringify(r.alertIds??[])]);
  return '\uFEFF'+[head,...rows].map(row=>row.map(quote).join(',')).join('\r\n')+'\r\n';
}
export function ndjson(data){return data.hourly.map(row=>JSON.stringify({project:data.project,timezone:data.timezone,units:data.units,...row})).join('\n')+'\n';}
export async function handoff(store,projectId,reviewId){
  const review=await readReview(store,projectId,reviewId),project=store.snapshot().projects[projectId],sources=[];
  for(const ref of project.sources){const r=await store.read('sources',ref.id);if(r.sha256!==ref.sha256)fail('SOURCE_CHANGED','Retained source inventory changed',409);sources.push(r.value);}
  return {schema:'stellar-forge.openweather-handoff.v1',createdAt:new Date().toISOString(),review,customerSources:sources,
    merchantPackages:project.exports.filter(x=>x.state==='COMPLETE'),releaseSelections:project.stages??[],
    operation:{node:'Node 22.16+',server:'openweather/cli.mjs serve --store PRIVATE_DIRECTORY',
      applicationTokenEnvironment:'OPENWEATHER_APP_TOKEN',providerKeyEnvironment:review.selection.keyEnv,
      directClient:'openweather/client.mjs with client.d.mts',fieldMap:FIELD_MAP,
      restart:'Reopen the same private store and retained application port. Review acquisition recovery before retrying unknown requests.',
      rollback:'Select the previous data edition for the direct API; original SF82 generation controls merchant release rollback.',
      backup:'Export the weather backup and retain original merchant packages/release store in the existing host backup.'},
    primarySource:SOURCE};
}
export async function configureSchedule(store,{project:projectId,expectedRevision,enabled,intervalMinutes=10,hours=48,autoSelect=false}){
  identifier(projectId);integer(intervalMinutes,'Refresh interval minutes',10,1440);integer(hours,'Hourly window',1,4800);
  if(typeof enabled!=='boolean'||typeof autoSelect!=='boolean')fail('INVALID_INPUT','Schedule choices must be booleans');
  const state=store.snapshot(),project=state.projects[projectId];if(!project)fail('PROJECT_MISSING','Project was not found',404);
  if(enabled&&autoSelect){
    if(!project.activeReview)fail('INITIAL_REVIEW','Select the first reviewed data edition before enabling automatic selection',409);
    const review=await readReview(store,projectId,project.activeReview);
    if(review.data.revision!==project.revision||stable(review.selection)!==stable(project.selection)||stable(review.fieldMap)!==stable(FIELD_MAP))
      fail('INITIAL_REVIEW','Review this exact project revision and field mapping before automatic selection',409);
  }
  return store.transaction(s=>{
    const current=s.projects[projectId];if(current.revision!==expectedRevision)fail('PROJECT_CHANGED','Reload the current project before configuring its schedule',409);
    if(enabled&&s.account?.keyEnv!==current.selection.keyEnv)fail('ACCOUNT_REQUIRED','Configure the same account and its local call allowance first',409);
    current.schedule={enabled,intervalMinutes,hours,autoSelect,approvedReview:autoSelect?current.activeReview:null,
      nextAt:new Date(Date.now()+intervalMinutes*60000).toISOString(),pendingJob:null,lastJob:current.schedule?.lastJob??null,lastError:null};
    return current.schedule;
  });
}
export function createScheduler(store,acquirer){
  let timer=null,busy=false,closed=false;
  const tick=async()=>{
    if(busy||closed)return;busy=true;
    try{
      for(const original of Object.values(store.snapshot().projects)){
        let p=store.snapshot().projects[original.id],schedule=p.schedule;
        if(!schedule?.enabled||acquirer.running().some(id=>store.snapshot().jobs[id]?.project===p.id))continue;
        let job=schedule.pendingJob?store.snapshot().jobs[schedule.pendingJob]:null;
        if(job&&!['READY','COMPLETE'].includes(job.state)){
          await store.transaction(s=>{const c=s.projects[p.id].schedule;if(c?.pendingJob===job.id)c.lastError='Scheduled acquisition '+job.state+': '+(job.reason??'Review its retained request before continuation');});continue;
        }
        if(!job){
          if(Date.now()<Date.parse(schedule.nextAt))continue;
          const due=Date.parse(schedule.nextAt),start=Math.floor(due/3600000)*3600;
          const requestId='scheduled-'+digest({project:p.id,revision:p.revision,due}).slice(0,48);
          job=await createAcquisition(store,{project:p.id,start,end:start+schedule.hours*3600,requestId});
          await store.transaction(s=>{const current=s.projects[p.id];if(current.revision!==p.revision||!current.schedule?.enabled)return;
            current.schedule.pendingJob=job.id;current.schedule.nextAt=new Date(Date.now()+current.schedule.intervalMinutes*60000).toISOString();});
        }
        const observed=job.state==='COMPLETE'?job:await acquirer.run(job.id);
        p=store.snapshot().projects[p.id];schedule=p.schedule;
        if(!schedule?.enabled||schedule.pendingJob!==job.id)continue;
        let error=null;
        if(observed.state==='COMPLETE'&&schedule.autoSelect){
          try{const review=await reviewAcquisition(store,{job:job.id,notes:'Scheduled selection under retained mapping '+schedule.approvedReview,acceptPartial:false});
            await selectReview(store,{project:p.id,review:review.id,expectedRevision:p.revision});}
          catch(e){error=e.message;}
        }else if(observed.state!=='COMPLETE')error=observed.state+': '+(observed.reason??'Inspect the retained acquisition');
        await store.transaction(s=>{const c=s.projects[p.id].schedule;if(c?.pendingJob===job.id){
          c.lastJob=job.id;c.lastError=error;if(observed.state==='COMPLETE')c.pendingJob=null;}});
      }
    }finally{busy=false;}
  };
  return {start(){if(!timer){timer=setInterval(()=>{void tick().catch(()=>{});},30000);timer.unref();}},
    tick,close:async()=>{closed=true;if(timer)clearInterval(timer);timer=null;while(busy)await new Promise(r=>setTimeout(r,20));}};
}
