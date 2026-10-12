// MIT. Named procedure sets shared by the original Runbooks server and browser.
export const RUNBOOK_PROFILE_LIMIT=32;
const KEY=/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const need=(ok,code,message)=>{if(!ok)throw Object.assign(new Error(message),{code,status:400});};
function label(value,name,max,{empty=false,trim=true}={}){
  need(typeof value==='string','RUNBOOK_INVALID_PROFILE','Enter '+name+'.');
  const result=trim?value.trim():value;
  need((empty||result.trim().length>0)&&result.length<=max&&!result.includes('\0'),'RUNBOOK_INVALID_PROFILE','Check '+name+' and its length.');
  return result;
}
export function normalizeRunbookProfiles(profiles,steps){
  if(profiles===undefined)return undefined;
  need(Array.isArray(profiles)&&profiles.length<=RUNBOOK_PROFILE_LIMIT,'RUNBOOK_PROFILE_LIMIT','Use up to '+RUNBOOK_PROFILE_LIMIT+' named procedure sets.');
  need(Array.isArray(steps)&&steps.length>0,'RUNBOOK_INVALID_PROFILE','Save the procedure catalog before choosing a set.');
  const stepIds=new Set(steps.map(step=>step.id)),ids=new Set();
  return profiles.map(profile=>{
    need(plain(profile)&&typeof profile.id==='string'&&KEY.test(profile.id),'RUNBOOK_INVALID_PROFILE','Give each procedure set a stable identifier.');
    need(!ids.has(profile.id),'RUNBOOK_DUPLICATE_PROFILE','Give every procedure set a distinct identifier.');ids.add(profile.id);
    need(Array.isArray(profile.stepIds)&&profile.stepIds.length>0&&profile.stepIds.length<=steps.length&&new Set(profile.stepIds).size===profile.stepIds.length&&profile.stepIds.every(id=>typeof id==='string'&&stepIds.has(id)),'RUNBOOK_INVALID_PROFILE_STEPS','Choose at least one distinct existing procedure for each set.');
    const selected=new Set(profile.stepIds);
    return {id:profile.id,name:label(profile.name,'procedure set name',240),description:label(profile.description??'','procedure set description',16_000,{empty:true,trim:false}),stepIds:steps.filter(step=>selected.has(step.id)).map(step=>step.id)};
  });
}
export function runbookProfileSelection(edition,profileId){
  need(plain(edition)&&Array.isArray(edition.steps)&&edition.steps.length>0,'RUNBOOK_INVALID_PROFILE','Choose a saved procedure edition.');
  if(profileId===undefined||profileId===null)return {profile:null,steps:edition.steps};
  need(typeof profileId==='string'&&KEY.test(profileId),'RUNBOOK_INVALID_PROFILE','Choose an existing named procedure set.');
  const profiles=normalizeRunbookProfiles(edition.profiles,edition.steps)??[];
  const profile=profiles.find(item=>item.id===profileId);
  need(profile,'RUNBOOK_PROFILE_NOT_FOUND','The selected procedure set does not exist in this saved edition. Choose a set from that edition.');
  const selected=new Set(profile.stepIds);
  return {profile,steps:edition.steps.filter(step=>selected.has(step.id))};
}
export function runbookCycleSteps(cycle){return runbookProfileSelection(cycle.edition,cycle.profileId).steps;}
export function runbookProfileFields(cycle){
  const {profile}=runbookProfileSelection(cycle.edition,cycle.profileId);
  return profile?{profileId:profile.id,profileName:profile.name}:{};
}
