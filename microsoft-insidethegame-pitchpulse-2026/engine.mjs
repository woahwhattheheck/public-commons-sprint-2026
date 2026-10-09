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
  REQUIRE(typeof type === 'string' && Object.hasOwn(OUTCOMES,type), 'Unsupported event type');
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
function statsFor(events){
  const stats=Object.fromEntries(TEAM.map(team=>[team,emptyStats()]));
  for(const event of events)tally(stats[event.team],event);
  return stats;
}
const percent=(value,total)=>total? Math.round(100*value/total):0;
const isShot=e=>e.type==='shot';
const onTarget=e=>isShot(e)&&e.outcome!=='wide';
const wonTackle=e=>e.type==='tackle'&&e.outcome==='won';
const highPressure=e=>e.type==='pressure'&&e.outcome==='high';
const completePass=e=>e.type==='pass'&&e.outcome==='complete';
const possession=e=>e.type==='possession';
function evidence(events,team,predicate,amount=()=>1){
  const selected=events.filter(e=>e.team===team&&predicate(e));
  return {value:selected.reduce((sum,e)=>sum+amount(e),0),eventIds:selected.map(e=>e.id)};
}
function controlEvidence(events,team,now){
  const components={
    completedPasses:{...evidence(events,team,completePass),weight:.5},
    shots:{...evidence(events,team,isShot),weight:4},
    tacklesWon:{...evidence(events,team,wonTackle),weight:1.2},
    highPressures:{...evidence(events,team,highPressure),weight:1.5},
    possessionSeconds:{...evidence(events,team,possession,e=>e.duration),weight:1/15}
  };
  const eventIds=events.filter(e=>e.team===team).map(e=>e.id);
  const score=Object.values(components).reduce((sum,c)=>sum+c.value*c.weight,0);
  return {score:Number(score.toFixed(1)),windowSeconds:300,eventCount:eventIds.length,
    afterSecond:now-300,throughSecond:now,eventIds,components};
}

function narrate(event,history,audience,favorite) {
  const team=event.team;
  // history ends at this event's ingestion position, including same-second ordering.
  const recent=history.filter(e=>e.second>event.second-300);
  let kind,priority,headline,why,rule,metrics;
  if(isShot(event)){
    kind=event.outcome==='goal'?'goal':'chance';priority=event.outcome==='goal'?5:3;
    headline=event.outcome==='goal'?`${team} score!`:`${team} create a shot`;
    metrics={shots:evidence(history,team,isShot),shotsOnTarget:evidence(history,team,onTarget),
      recentShots:evidence(recent,team,isShot)};
    why=`${metrics.shots.value} shot(s) in the match, ${metrics.shotsOnTarget.value} on target. ${metrics.recentShots.value} shot(s) in the rolling five-minute window.`;
    rule='SHOT_COUNT + SHOTS_ON_TARGET + ROLLING_300S';
  } else if(highPressure(event)){
    kind='pressure';priority=2;headline=`${team} step up the pressure`;
    metrics={recentHighPressures:evidence(recent,team,highPressure)};
    why=`${metrics.recentHighPressures.value} high-pressure event(s) for ${team} in the last five minutes.`;
    rule='HIGH_PRESSURE_COUNT_300S';
  } else if(wonTackle(event)){
    kind='turnover';priority=2;headline=`${team} win a challenge`;
    metrics={tacklesWon:evidence(history,team,wonTackle)};
    why=`${metrics.tacklesWon.value} successful tackle(s) for ${team} so far.`;
    rule='WON_TACKLE_COUNT';
  } else return null;
  const supporting=new Set([event.id,...Object.values(metrics).flatMap(m=>m.eventIds)]);
  const fanText=team===favorite?`${headline} Your side have changed the moment.`:
    `${headline} Here's what it means for ${favorite}: the other side have an opportunity.`;
  return {
    id:`overlay-${event.id}`,eventId:event.id,second:event.second,expiresAtSecond:event.second+18,
    kind,priority,title:headline,text:audience==='fan'?fanText:`${headline}. ${why}`,why,
    proof:{rule,eventIds:history.filter(e=>supporting.has(e.id)).map(e=>e.id),
      source:'synthetic-event-ledger',rollingWindowSeconds:300,
      afterSecond:event.second-300,throughSecond:event.second,throughEventId:event.id,metrics}
  };
}

export class MatchEngine {
  constructor(){this.events=[];this.ids=new Set();this._byId=new Map();}
  ingest(raw){
    const event=normalizeEvent(raw);
    const existing=this._byId.get(event.id);
    if(existing){
      // A transport retry is idempotent; an attempted correction is not a retry.
      REQUIRE(Object.keys(event).every(key=>event[key]===existing[key]),`Event id conflicts with existing event: ${event.id}`);
      return {duplicate:true,event:existing,acceptedCount:this.events.length};
    }
    if(this.events.length&&event.second<this.events.at(-1).second)throw new Error('Events must be ordered by match second');
    if(this.events.length>=3000)throw new Error('Event limit reached');
    Object.freeze(event);
    this.events.push(event);this.ids.add(event.id);this._byId.set(event.id,event);
    return {duplicate:false,event,acceptedCount:this.events.length};
  }
  reset(){this.events=[];this.ids.clear();this._byId.clear();}
  snapshot({audience='analyst',favorite='Harbor FC',asOfSecond}={}){
    REQUIRE(['analyst','fan'].includes(audience), 'Unknown audience');
    REQUIRE(TEAM.includes(favorite), 'Invalid favorite');
    REQUIRE(asOfSecond===undefined||(Number.isInteger(asOfSecond)&&asOfSecond>=0&&asOfSecond<=5400), 'Invalid snapshot clock');
    const now=asOfSecond??this.events.at(-1)?.second??0;
    // Seeking is a projection, never a reset or rewrite of the accepted ledger.
    const visible=this.events.filter(e=>e.second<=now);
    const stats=statsFor(visible);
    const rolling=visible.filter(e=>e.second>now-300);
    const control=Object.fromEntries(TEAM.map(team=>[team,controlEvidence(rolling,team,now)]));
    const overlayEvents=visible.filter(e=>isShot(e)||highPressure(e)||wonTackle(e)).slice(-12);
    const overlays=overlayEvents.map(e=>narrate(e,visible.slice(0,visible.indexOf(e)+1),audience,favorite));
    const activeOverlays=overlays.filter(e=>now<e.expiresAtSecond);
    return {
      schema:'pitchpulse/v1',fixture:'SYNTHETIC — not Premier League match data',clockSecond:now,
      scoreboard:TEAM.map(team=>({team,...stats[team],passAccuracyPercent:percent(stats[team].completedPasses,stats[team].passes)})),
      control,lastEvent:visible.at(-1)??null,acceptedEvents:visible.length,
      overlays,headline:overlays.at(-1)?.title||'Waiting for synthetic football events',
      activeOverlays,activeHeadline:activeOverlays.at(-1)?.title||'No active overlay at this match clock',
      mode:{audience,favorite},view:{clockMode:asOfSecond===undefined?'latest':'as-of',asOfSecond:now},
      explanation:'Control score (last 300 seconds) = 0.5 × completed passes + 4 × shots + 1.2 × successful tackles + 1.5 × high pressures + possession seconds / 15. Descriptive only, NOT an ML prediction.',
      provenance:{acceptedEventIds:visible.map(e=>e.id),overlayRules:overlays.map(o=>o.proof.rule)}
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
