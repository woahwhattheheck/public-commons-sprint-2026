/* CultureBridge's pure decision engine. No fabricated Qloo affinity scores. */
export const KINDS = Object.freeze({artist:'urn:entity:artist',movie:'urn:entity:movie',book:'urn:entity:book',videogame:'urn:entity:videogame'});

export function cleanSeed(value) {
  if (typeof value !== 'string') throw new Error('Each seed must be text');
  const s = value.trim().replace(/\s+/g, ' ');
  if (s.length < 2 || s.length > 80 || /[<>\u0000-\u001f]/.test(s)) throw new Error('Choose a seed between 2 and 80 printable characters');
  return s;
}
export function cleanKind(value) {
  if (!Object.hasOwn(KINDS, value)) throw new Error('Choose a supported bridge category');
  return value;
}
const folded = v => String(v ?? '').trim().toLocaleLowerCase('en').replace(/\s+/g,' ');
// Only an actual provider string can establish shared entity identity. Coercing
// an object or number would turn unrelated malformed IDs into false matches.
const stableId = v => typeof v === 'string' ? v.trim() : '';
const declaredType = v => {
  const raw = typeof v === 'string' ? v : v && typeof v === 'object' && !Array.isArray(v) ? v.id : null;
  if (typeof raw !== 'string') return '';
  const type = raw.trim().toLowerCase();
  return Object.hasOwn(KINDS,type) ? KINDS[type] : type.startsWith('urn:entity:') ? type : '';
};
function hasWrongExplicitType(row,entity,expected) {
  if (!expected) return false;
  const declarations = [entity?.type,entity?.entity_type,entity?.types,row?.type,row?.entity_type,row?.types]
    .flatMap(v => Array.isArray(v) ? v : [v])
    .map(declaredType).filter(Boolean);
  // Missing/unknown metadata is not proof of a mismatch; an explicit category
  // is, including any documented urn:entity:* value outside our four domains.
  return declarations.length > 0 && !declarations.includes(expected);
}
function itemsFromQloo(doc) {
  if (Array.isArray(doc)) return doc;
  for (const path of [doc?.results?.entities,doc?.results?.items,doc?.results,doc?.entities,doc?.data?.results?.entities,doc?.data?.results,doc?.data?.entities]) {
    if (Array.isArray(path)) return path;
  }
  return [];
}
export function normalizeInsights(doc,{kind}={}) {
  const seen = new Set();
  const expected = kind ? KINDS[cleanKind(kind)] : null;
  return itemsFromQloo(doc).map((x,i)=>{
    const entity=x?.entity || x?.properties?.entity || x || {};
    const id=[entity?.entity_id,entity?.id,entity?.qloo_id,x?.entity_id,x?.id,x?.qloo_id]
      .map(stableId).find(Boolean) || '';
    if (hasWrongExplicitType(x,entity,expected)) return null;
    const name=String(entity?.name || entity?.properties?.name || x?.name || '');
    const key=id?`id:${folded(id)}`:`name:${folded(name)}`;
    const affinityCandidate=x?.query?.affinity ?? x?.affinity ?? x?.metrics?.affinity;
    const affinity=(typeof affinityCandidate==='number' && Number.isFinite(affinityCandidate)) ? affinityCandidate : null;
    if(!name||!key||seen.has(key)) return null;
    seen.add(key);
    return {id,name,key,rank:i+1,affinity,description:String(entity?.properties?.description || entity?.description || '').slice(0,240),
      image: typeof entity?.properties?.image?.url==='string' ? entity.properties.image.url : null};
  }).filter(Boolean).slice(0,50);
}
const rankScore = rank => 1/Math.sqrt(rank || 1);
export function bridgeIntersection(left,right,{take=12}={}) {
  // Same display text does not prove same cultural entity. A brand, artist or
  // place can share a name with a different Qloo record. Require a stable ID
  // on both sides before calling a match Qloo-grounded evidence.
  const byId=new Map();
  for(const x of left) { const id=stableId(x?.id); if(id) byId.set(folded(id),x); }
  const used=new Set();const bridges=[];
  for(const b of right){
    const id=stableId(b?.id);
    if(!id)continue;
    const a=byId.get(folded(id));
    if(!a || used.has(folded(id)))continue;
    used.add(folded(id));
    const sa=rankScore(a.rank),sb=rankScore(b.rank);
    // Balance matters: a bridge is only as strong as its weaker connection.
    const score=Math.round(100*Math.sqrt(sa*sb)*Math.min(sa,sb)/Math.max(sa,sb));
    bridges.push({id,name:b.name,score,rankA:a.rank,rankB:b.rank,
      affinityA:a.affinity,affinityB:b.affinity,description:b.description||a.description,
      explanation:`Ranked #${a.rank} for the first taste and #${b.rank} for the second. Shared-ground score uses rank balance, not an invented Qloo affinity.`,
      evidence:{source:'Qloo Insights',primary:'two independent ranked result sets',computedScore:'rank-balanced heuristic'}});
  }
  return bridges.sort((a,b)=>b.score-a.score||a.rankA-b.rankA||a.rankB-b.rankB).slice(0,take);
}
export function buildAgentResponse({seedA,seedB,kind,resultsA,resultsB,mode,trace}) {
  const a=normalizeInsights(resultsA,{kind}),b=normalizeInsights(resultsB,{kind});
  const matches=bridgeIntersection(a,b);
  trace.push({step:'compare',status:'done',detail:`Compared ${a.length} and ${b.length} returned entities; ${matches.length} shared candidates shown.`});
  return {mode,seedA,seedB,kind,bridges:matches,counts:{first:a.length,second:b.length,shared:matches.length},trace,
    method:'Both sides are separately queried. Recommendations require the same stable Qloo entity ID on both sides and reject explicitly different entity categories; names alone are not evidence. Higher-balanced rank is preferred.',
    warnings:mode==='fixture'?['Illustrative offline fixture, NOT live Qloo data; rankings are synthetic.']:[]};
}
