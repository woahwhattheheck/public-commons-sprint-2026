const TEAM = Object.freeze(['Harbor FC', 'Valley FC']);
const OUTCOMES = Object.freeze({
  pass:['complete','missed'], shot:['goal','saved','wide'],
  tackle:['won','lost'], pressure:['high','low'], possession:['held']
});
const REQUIRE = (condition,message) => { if (!condition) throw new Error(message); };

export function normalizeEvent(source) {
  REQUIRE(source && typeof source === 'object' && !Array.isArray(source), 'Event must be an object');
  const {id, second, team, type, outcome, player='Unspecified', duration=0} = source;
  REQUIRE(typeof id === 'string' && /^[A-Za-z0-9_-]{1,48}$/.test(id), 'Invalid event id');
  REQUIRE(Number.isInteger(second) && second >= 0 && second <= 5400, 'Invalid match clock');
  REQUIRE(TEAM.includes(team), 'Team is not in synthetic fixture');
  REQUIRE(Object.hasOwn(OUTCOMES,type), 'Unsupported event type');
  REQUIRE(OUTCOMES[type].includes(outcome), 'Unsupported outcome');
  REQUIRE(typeof player === 'string' && player.length > 0 && player.length <= 64, 'Invalid player name');
  REQUIRE(Number.isInteger(duration) && duration >= 0 && duration <= 60, 'Invalid duration');
  REQUIRE(type === 'possession' ? duration > 0 : duration === 0, 'Duration only applies to possession');
  return {id,second,team,type,outcome,player,duration};
}

function emptyStats(){return {goals:0,shots:0,shotsOnTarget:0,passes:0,completedPasses:0,tacklesWon:0,highPressures:0,possessionSeconds:0};}
function tally(stats,e){
  if(e.type==='pass'){stats.passes++; if(e.outcome==='complete')stats.completedPasses++;}
  if(e.type==='shot'){stats.shots++;if(e.outcome!=='wide')stats.shotsOnTarget++;if(e.outcome==='goal')stats.goals++;}
  if(e.type==='tackle'&&e.outcome==='won')stats.tacklesWon++;
  if(e.type==='pressure'&&e.outcome==='high')stats.highPressures++;
  if(e.type==='possession')stats.possessionSeconds+=e.duration;
}
function controlScore(stats){return stats.completedPasses*.5+stats.shots*4+stats.tacklesWon*1.2+stats.highPressures*1.5+stats.possessionSeconds/15;}
const percent=(value,total)=>total? Math.round(100*value/total):0;

function narrate(event, total, recent, audience, favorite) {
  const team = event.team, clubIsFavorite=team===favorite;
  const stats = total[team], local = recent[team];
  let kind='context',priority=1,headline,why,rule;
  if(event.type==='shot'){
    kind=event.outcome==='goal'?'goal':'chance';priority=event.outcome==='goal'?5:3;
    headline=event.outcome==='goal'?`${team} score!`:`${team} create a shot`;
    why=`${stats.shots} shot(s) in the match, ${stats.shotsOnTarget} on target. ${local.shots} shot(s) in the rolling five-minute window.`;
    rule='SHOT_COUNT + SHOTS_ON_TARGET + ROLLING_300S';
  } else if(event.type==='pressure'&&event.outcome==='high'){
    kind='pressure';priority=2;headline=`${team} step up the pressure`;
    why=`${local.highPressures} high-pressure event(s) for ${team} in the last five minutes.`;
    rule='HIGH_PRESSURE_COUNT_300S';
  } else if(event.type==='tackle'&&event.outcome==='won'){
    kind='turnover';priority=2;headline=`${team} win a challenge`;
    why=`${stats.tacklesWon} successful tackle(s) for ${team} so far.`;
    rule='WON_TACKLE_COUNT';
  } else return null;
  const fanText = clubIsFavorite ? `${headline} ${team===favorite?'Your side':'The opposition'} have changed the moment.` :
    `${headline} Here's what it means for ${favorite}: the other side have an opportunity.`;
  return {
    id:`overlay-${event.id}`,eventId:event.id,second:event.second,expiresAtSecond:event.second+18,
    kind,priority,title:headline,
    text:audience==='fan'?fanText:`${headline}. ${why}`,
    why,proof:{rule,eventIds:[event.id],source:'synthetic-event-ledger',rollingWindowSeconds:300},
  };
}

export class MatchEngine {
  constructor(){this.events=[];this.ids=new Set();}
  ingest(raw){
    const event=normalizeEvent(raw);
    // Replayed network events must never double-count goals or possession.
    if(this.ids.has(event.id))return {duplicate:true,event,acceptedCount:this.events.length};
    if(this.events.length&&event.second<this.events.at(-1).second)throw new Error('Events must be ordered by match second');
    if(this.events.length>=3000)throw new Error('Event limit reached');
    this.events.push(event);this.ids.add(event.id);
    return {duplicate:false,event,acceptedCount:this.events.length};
  }
  reset(){this.events=[];this.ids.clear();}
  snapshot({audience='analyst',favorite='Harbor FC'}={}){
    REQUIRE(['analyst','fan'].includes(audience), 'Unknown audience');
    REQUIRE(TEAM.includes(favorite), 'Invalid favorite');
    const stats=Object.fromEntries(TEAM.map(t=>[t,emptyStats()]));
    for(const event of this.events)tally(stats[event.team],event);
    const now=this.events.at(-1)?.second??0;
    const windowStats=Object.fromEntries(TEAM.map(t=>[t,emptyStats()]));
    const rolling=this.events.filter(e=>e.second>now-300);
    for(const event of rolling)tally(windowStats[event.team],event);
    const control=Object.fromEntries(TEAM.map(team=>[team,{score:Number(controlScore(windowStats[team]).toFixed(1)),
      windowSeconds:300,eventCount:rolling.filter(e=>e.team===team).length}]));
    // Each overlay is calculated at its own event clock, not using later match events.
    const overlayEvents=this.events.filter(e=>e.type==='shot'||(e.type==='pressure'&&e.outcome==='high')||(e.type==='tackle'&&e.outcome==='won')).slice(-12);
    const overlays=overlayEvents.map(e=>{
      const end=this.events.indexOf(e);
      const history=this.events.slice(0,end+1);
      const historical=Object.fromEntries(TEAM.map(team=>[team,emptyStats()]));
      const historicalWindow=Object.fromEntries(TEAM.map(team=>[team,emptyStats()]));
      for(const prior of history){
        tally(historical[prior.team],prior);
        if(prior.second>e.second-300)tally(historicalWindow[prior.team],prior);
      }
      return narrate(e,historical,historicalWindow,audience,favorite);
    }).filter(Boolean);
    const last=this.events.at(-1)??null;
    return {
      schema:'pitchpulse/v1',fixture:'SYNTHETIC — not Premier League match data',clockSecond:now,
      scoreboard:TEAM.map(team=>({team,...stats[team],passAccuracyPercent:percent(stats[team].completedPasses,stats[team].passes)})),
      control,lastEvent:last,acceptedEvents:this.events.length,
      overlays,headline:overlays.at(-1)?.title||'Waiting for synthetic football events',
      mode:{audience,favorite},
      explanation:'Control score (last 300 seconds) = 0.5 × completed passes + 4 × shots + 1.2 × successful tackles + 1.5 × high pressures + possession seconds / 15. Descriptive only, NOT an ML prediction.',
      provenance:{acceptedEventIds:this.events.map(e=>e.id),overlayRules:overlays.map(o=>o.proof.rule)}
    };
  }
}

export const SYNTHETIC_EVENTS=Object.freeze([
{id:'ev01',second:24,team:'Harbor FC',type:'pass',outcome:'complete',player:'Player H7'},
{id:'ev02',second:38,team:'Harbor FC',type:'possession',outcome:'held',player:'Player H8',duration:30},
{id:'ev03',second:66,team:'Valley FC',type:'tackle',outcome:'won',player:'Player V4'},
{id:'ev04',second:91,team:'Valley FC',type:'pass',outcome:'complete',player:'Player V9'},
{id:'ev05',second:121,team:'Valley FC',type:'pressure',outcome:'high',player:'Player V7'},
{id:'ev06',second:143,team:'Valley FC',type:'shot',outcome:'saved',player:'Player V10'},
{id:'ev07',second:192,team:'Harbor FC',type:'pass',outcome:'complete',player:'Player H6'},
{id:'ev08',second:208,team:'Harbor FC',type:'pressure',outcome:'high',player:'Player H11'},
{id:'ev09',second:238,team:'Harbor FC',type:'shot',outcome:'goal',player:'Player H9'},
{id:'ev10',second:296,team:'Valley FC',type:'pass',outcome:'missed',player:'Player V8'},
{id:'ev11',second:333,team:'Harbor FC',type:'possession',outcome:'held',player:'Player H2',duration:28},
{id:'ev12',second:392,team:'Valley FC',type:'tackle',outcome:'won',player:'Player V5'},
{id:'ev13',second:454,team:'Valley FC',type:'pressure',outcome:'high',player:'Player V3'},
{id:'ev14',second:503,team:'Valley FC',type:'shot',outcome:'wide',player:'Player V11'},
{id:'ev15',second:562,team:'Harbor FC',type:'shot',outcome:'saved',player:'Player H9'},
]);