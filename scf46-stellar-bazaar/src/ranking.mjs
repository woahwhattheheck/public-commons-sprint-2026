// MIT. Deterministic, dependency-free lexical/fuzzy ranking for validated x402 Bazaar records.
// This module only reads already trusted catalog rows; it never ingests payment payloads.
const STOP = new Set([
  'a','an','and','are','can','could','find','for','get','give','i','in','is','me',
  'my','of','on','or','please','show','that','the','to','want','which','with','you'
]);
const NORMALIZE = s => String(s ?? '').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
export const tokenize = s => NORMALIZE(s).match(/[\p{L}\p{N}]+/gu) ?? [];
const words = s => tokenize(typeof s === 'string' ? s.slice(0,2048) : '');
const object = o => o !== null && typeof o === 'object' && !Array.isArray(o);
const field = (text, weight) => ({ tokens: words(text).slice(0,128), weight });

function toFields(row) {
  const resource = object(row.resource) ? row.resource : {};
  const info = object(row.extensions?.bazaar?.info) ? row.extensions.bazaar.info : {};
  const input = object(info.input) ? info.input : {};
  const props = object(input.inputSchema?.properties) ? input.inputSchema.properties : {};
  const parameters = Object.entries(props).slice(0,32).map(([name, spec]) =>
    name+' '+(object(spec) && typeof spec.description === 'string' ? spec.description : '')).join(' ');
  return [
    field(resource.serviceName, 9),
    field(Array.isArray(resource.tags) ? resource.tags.filter(x => typeof x === 'string').slice(0,16).join(' ') : '', 7),
    field(input.toolName, 8),
    field(input.description, 4),
    field(resource.description, 4),
    field(parameters, 2),
    field(resource.url, 0.6)
  ];
}

// Small, bounded edit distance prevents a misspelled merchant/tool name from vanishing.
// Never uses fuzzy scores as proof of semantic equivalence.
function editDistanceWithin(a, b, limit) {
  if (Math.abs(a.length - b.length) > limit) return false;
  let previous = Array.from({length:b.length+1}, (_,i)=>i);
  for (let i=1;i<=a.length;i++) {
    const current = [i]; let rowMin = current[0];
    for (let j=1;j<=b.length;j++) {
      current[j] = Math.min(previous[j]+1,current[j-1]+1,previous[j-1]+(a[i-1]===b[j-1]?0:1));
      rowMin = Math.min(rowMin,current[j]);
    }
    if (rowMin > limit) return false;
    previous = current;
  }
  return previous[b.length] <= limit;
}

export function analyzeQuery(query) {
  if (typeof query !== 'string' || !query.trim() || query.length > 1024) throw new RangeError('query is required (max 1024 chars)');
  const raw = [...new Set(words(query))].slice(0,32);
  if (!raw.length) throw new RangeError('query requires searchable terms');
  const meaningful = raw.filter(t=>!STOP.has(t));
  return meaningful.length ? meaningful : raw;
}

/**
 * Rank real, already-validated catalog entries, supplying [canonicalKey, row] pairs.
 * BM25F-style weighted fields + exact-phrase + limited typo recovery. Corpus DF
 * comes from the entries actually passed in; no external model or fabricated corpus.
 * Rows are never mutated. Hard payment/network/ownership filters belong upstream.
 */
export function rankBazaarEntries(entries, query) {
  const q = analyzeQuery(query);
  const docs = [...entries].map(([key,row]) => ({key,row,fields:toFields(row)}));
  if (!docs.length) return [];
  const avg = docs[0].fields.map((_,i) =>
    Math.max(1,docs.reduce((sum,d)=>sum+d.fields[i].tokens.length,0)/docs.length));
  const df = new Map(q.map(t=>[t,0]));
  for (const doc of docs) {
    doc.fields = doc.fields.map((f,i)=>{
      const tf = new Map();
      for (const t of f.tokens) tf.set(t,(tf.get(t)??0)+1);
      return {...f, tf, normalizedWeight:f.weight/(0.25+0.75*f.tokens.length/avg[i])};
    });
    const vocabulary = new Set(doc.fields.flatMap(f=>[...f.tf.keys()]));
    for (const t of q) if (vocabulary.has(t)) df.set(t,df.get(t)+1);
  }
  const total = docs.length;
  const ranked = [];
  for (const doc of docs) {
    let score=0, coverage=0, exactHits=0;
    for (const t of q) {
      let weighted=0;
      for (const f of doc.fields) weighted += Math.min(3,f.tf.get(t)??0)*f.normalizedWeight;
      if (weighted) {coverage++;exactHits++;}
      else if (t.length>=5) {
        // Fuzz only on domain-bearing text fields, never URLs or arbitrary parameters.
        let best=0;
        const limit=t.length>=8?2:1;
        for (const f of doc.fields.slice(0,5)) for (const v of f.tf.keys()) {
          if (v.length<5 || v[0]!==t[0] || !editDistanceWithin(t,v,limit)) continue;
          best=Math.max(best,0.22*f.normalizedWeight);
        }
        weighted=best;
        if (best) coverage++;
      }
      if (weighted) {
        // Smoothed positive IDF. Rare distinctive words outweigh ubiquitous terms.
        const idf=Math.log1p((total-(df.get(t)??0)+0.5)/((df.get(t)??0)+0.5));
        score+=idf*(2.2*weighted/(1.2+weighted));
      }
    }
    if (!coverage) continue;
    const phrase=q.join(' ');
    const hasPhrase=q.length>=2 && doc.fields.slice(0,5).some(f=>f.tokens.join(' ').includes(phrase));
    score*=1+0.45*coverage/q.length;
    if (hasPhrase) score+=1.4;
    if (exactHits===q.length) score+=0.4;
    ranked.push({key:doc.key,row:doc.row,score});
  }
  return ranked.sort((a,b)=>b.score-a.score || a.key.localeCompare(b.key));
}
