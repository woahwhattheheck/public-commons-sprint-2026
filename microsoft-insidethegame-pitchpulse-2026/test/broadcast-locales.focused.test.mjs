// Focused, synthetic, zero-provider browser-language and evidence-boundary check.
// Run: node test/broadcast-locales.focused.test.mjs
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {STORY_LANGUAGES,localizeMoment} from '../locale.mjs';

const raw=readFileSync(new URL('../broadcast.mjs',import.meta.url),'utf8');
const head="import {STORY_LANGUAGES, localizeMoment} from './locale.mjs';";
assert.ok(raw.startsWith(head),'expected exact browser localizer import');
const executable=raw.replace(head,'const {STORY_LANGUAGES,localizeMoment}=__locale;');
const moment={
  kind:'goal',title:'Harbor FC score!',
  text:'Harbor FC score! 2 shots in the match, 1 on target. 1 shot in the rolling five-minute window.',
  eventId:'synthetic-event-12',expiresAtSecond:125,
  proof:{rule:'GOAL_EVENT',metrics:{shots:{value:2},shotsOnTarget:{value:1},recentShots:{value:1}}}
};
const example={
  clockSecond:110,acceptedEvents:1,
  scoreboard:[{team:'Harbor FC',goals:1,shots:2,completedPasses:7,passes:9},
              {team:'Valley FC',goals:0,shots:1,completedPasses:5,passes:8}],
  activeOverlays:[moment]
};
async function render(lang,payload=example){
  const nodes=new Map(),calls=[];
  const create=()=>({
    textContent:'',attributes:{},children:[],
    setAttribute(key,value){this.attributes[key]=value;},
    replaceChildren(...children){this.children=children;}
  });
  const document={
    hidden:false,documentElement:{lang:''},title:'',
    body:{classList:{toggle(){}}},
    getElementById(id){if(!nodes.has(id))nodes.set(id,create());return nodes.get(id);},
    createElement:()=>create(),
    addEventListener(){},
  };
  const ctx={document,location:{search:'?language='+encodeURIComponent(lang)},
    __locale:{STORY_LANGUAGES,localizeMoment},
    fetch:async (url,init)=>{calls.push({url,init});return {ok:true,json:async()=>JSON.parse(JSON.stringify(payload))};},
    URLSearchParams,AbortController,Date,setTimeout:()=>1,clearTimeout(){},setInterval:()=>1};
  runInNewContext(executable,ctx,{timeout:1000});
  await new Promise(resolve=>setImmediate(resolve));
  return {document,calls,el:id=>document.getElementById(id)};
}
const snapshot=JSON.stringify(example);
for(const [language,pattern,safety] of [
  ['en',/Harbor FC score!/,/NOT LIVE/],
  ['es',/¡Gol de Harbor FC!/,/NO EN DIRECTO.*NOT LIVE/],
  ['pt',/Gol do Harbor FC!/,/NÃO AO VIVO.*NOT LIVE/]
]){
  const view=await render(language);
  assert.equal(view.document.documentElement.lang,language);
  assert.match(view.el('moment-title').textContent,pattern);
  assert.match(view.el('broadcast-synthetic').textContent,safety);
  assert.equal(view.el('moment-event').textContent.endsWith(moment.eventId),true);
  assert.equal(view.el('moment-rule').textContent.endsWith(moment.proof.rule),true);
  assert.equal(view.el('score').textContent,'1 — 0');
  assert.equal(view.el('clock').textContent,'01:50');
  assert.equal(view.el('moment-expires').textContent.endsWith('02:05'),true);
  assert.equal(view.calls.length,1);
  assert.match(view.calls[0].url,/^\/api\/state\?/);
  assert.equal(view.calls[0].url.includes('language='),false,'localize only client-side');
}
const unknown=await render('not-a-language');
assert.equal(unknown.document.documentElement.lang,'en');
assert.match(unknown.el('moment-title').textContent,/Harbor FC score!/);
const expired=await render('es',{...example,clockSecond:125});
assert.equal(expired.el('moment-event').textContent,'SIN EVENTO ACTIVO');
assert.doesNotMatch(expired.el('moment-title').textContent,/Gol de Harbor/);
assert.equal(JSON.stringify(example),snapshot,'immutable synthetic source record');
console.log('PASS PitchPulse broadcast language focus: EN/ES/PT, invalid fallback, expiry, source proof/score/clock invariants; zero provider calls');
