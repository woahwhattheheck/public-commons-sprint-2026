// Illustrative fixture content only. This module never claims to expose KZFR's
// actual show catalog, live schedule, audio, or Creek Studio metadata.
export const demoArchiveEntries = Object.freeze([
  {id:'sample-01',title:'Northern California Soundscape',category:'music',label:'Music',date:'2026-10-09',summary:'An illustrative mix of regional and independent sounds.'},
  {id:'sample-02',title:'Chico Community Roundtable',category:'community',label:'Community',date:'2026-10-08',summary:'A sample conversation about the neighbors shaping the North State.'},
  {id:'sample-03',title:'Perspectives & Public Affairs',category:'news',label:'News & public affairs',date:'2026-10-07',summary:'Demonstration content for a local public-interest program.'},
  {id:'sample-04',title:'An Open-Mic Kind of Night',category:'music',label:'Music',date:'2026-09-28',summary:'A fictional music episode used to test archive discovery.'},
  {id:'sample-05',title:'Voices of the Valley',category:'community',label:'Community',date:'2026-09-18',summary:'Sample community stories and volunteer conversations.'},
  {id:'sample-06',title:'The Neighborhood Briefing',category:'news',label:'News & public affairs',date:'2026-09-05',summary:'Illustrative archive entry for news and discussion search.'},
]);
const normalize = value => String(value ?? '').trim().normalize('NFKC').toLocaleLowerCase('en-US');
const daysBetween = (a,b) => Math.floor((Date.UTC(a.getUTCFullYear(),a.getUTCMonth(),a.getUTCDate())-Date.UTC(b.getUTCFullYear(),b.getUTCMonth(),b.getUTCDate()))/86400000);
export function filterDemoArchives(entries,{query='',category='all',date='any',now=new Date()}={}) {
  const needle=normalize(query);
  const maxDays=date==='week'?6:date==='month'?29:null;
  return entries.filter(entry => {
    if(category!=='all' && entry.category!==category) return false;
    if(needle && !normalize(`${entry.title} ${entry.summary} ${entry.label}`).includes(needle)) return false;
    if(maxDays!==null) {
      if(!/^\d{4}-\d{2}-\d{2}$/.test(entry.date)) return false;
      const delta=daysBetween(now,new Date(`${entry.date}T00:00:00Z`));
      if(delta<0 || delta>maxDays) return false;
    }
    return true;
  }).sort((a,b)=>b.date.localeCompare(a.date));
}
export function humanDate(iso){const d=new Date(`${iso}T12:00:00Z`);return new Intl.DateTimeFormat('en-US',{month:'short',day:'numeric',year:'numeric',timeZone:'UTC'}).format(d)}
