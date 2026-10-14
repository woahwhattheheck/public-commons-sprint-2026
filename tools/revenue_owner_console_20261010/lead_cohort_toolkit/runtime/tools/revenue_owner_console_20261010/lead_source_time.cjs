'use strict';
// Interpret retained source wording without inventing calendar dates.
// Qualification uses the observation's original source/check binding.
const DAY=86400000;
const UNITS={minute:60000,minutes:60000,minuto:60000,minutos:60000,
  hour:3600000,hours:3600000,hora:3600000,horas:3600000,
  day:DAY,days:DAY,dia:DAY,dias:DAY,
  week:7*DAY,weeks:7*DAY,semana:7*DAY,semanas:7*DAY};
function wording(value){return typeof value==='string'?
  value.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').trim().replace(/\s+/g,' '):'';}
function duration(value,kind){
  const label=wording(value);
  const pattern=kind==='publication'?
    /^(?:(?:posted|published) (\d{1,6}) (minutes?|hours?|days?|weeks?) ago|publicad[oa] hace (\d{1,6}) (minutos?|horas?|dias?|semanas?))\.?$/i:
    /^(?:ends? in (\d{1,6}) (minutes?|hours?|days?|weeks?)|termina en (\d{1,6}) (minutos?|horas?|dias?|semanas?))\.?$/i;
  const match=pattern.exec(label);
  if(!match)return null;
  const count=Number(match[1]??match[3]),unit=UNITS[(match[2]??match[4]).toLowerCase()];
  return Number.isSafeInteger(count)&&unit?{count,unit}:null;
}
function observedSourceTiming(lead,at){
  const observation=lead?.source_time_observation;
  if(!observation||typeof observation!=='object'||observation.source_url!==lead.source_url||
      observation.checked_at!==lead.checked_at)return null;
  const checked=Date.parse(observation.checked_at),now=Date.parse(at);
  if(!Number.isFinite(checked)||!Number.isFinite(now)||checked>now)return null;
  const elapsed=now-checked,publication=duration(observation.publication_label,'publication'),
    closing=duration(observation.closing_label,'closing');
  return {
    sameUtcDate:observation.checked_at.slice(0,10)===at.slice(0,10),
    // A three-week label is retained as wording, with an upper age bound of
    // four weeks plus elapsed time. No guessed publication date is stored.
    publicationMaxAgeMs:publication?(publication.count+1)*publication.unit+elapsed:null,
    closingPositive:Boolean(closing&&closing.count>0),
    closingElapsed:Boolean(closing&&elapsed>=closing.count*closing.unit),
    publicationLabel:observation.publication_label??'',
    closingLabel:observation.closing_label??''
  };
}
module.exports={observedSourceTiming};
