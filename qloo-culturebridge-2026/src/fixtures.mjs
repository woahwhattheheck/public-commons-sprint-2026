/* DEMO-ONLY fixtures are intentionally synthetic and explicitly labeled. */
const alternatives={
artist:['Massive Attack','Sufjan Stevens','FKA twigs','Nina Simone','Radiohead','Cocteau Twins','Khruangbin','Little Simz','Bon Iver','Floating Points','Portishead','Yaeji'],
movie:['Arrival','In the Mood for Love','Parasite','Her','Moonlight','Spirited Away','The Grand Budapest Hotel','Everything Everywhere All at Once','Aftersun','The Matrix','Past Lives','Dune'],
book:['Never Let Me Go','The Dispossessed','The Left Hand of Darkness','Pachinko','The Overstory','Station Eleven','The Night Circus','Annihilation','Kindred','The Three-Body Problem','Braiding Sweetgrass','Cloud Atlas'],
videogame:['Journey','Hades','Disco Elysium','Outer Wilds','Celeste','Tunic','Spiritfarer','Hollow Knight','Sable','Stardew Valley','Gris','Return of the Obra Dinn']};
function hash(s){let n=2166136261;for(const ch of s.toLowerCase()){n^=ch.charCodeAt(0);n=Math.imul(n,16777619)}return n>>>0}
function sequence(seed,kind){const opts=alternatives[kind];const h=hash(seed);const rot=h%opts.length;let arr=opts.map((_,i)=>({id:`demo:${kind}:${(i+rot)%opts.length}`,name:opts[(i+rot)%opts.length],affinity:null}));
  // deterministic seed-specific ranking, retaining a guaranteed overlap for story demos.
  arr.sort((a,b)=>hash(seed+':'+a.id)-hash(seed+':'+b.id));return arr.slice(0,10)}
export function demoResults(seedA,seedB,kind){return {resultsA:{results:{entities:sequence(seedA,kind)}},resultsB:{results:{entities:sequence(seedB,kind)}},
  trace:[{step:'plan',status:'done',detail:'Use synthetic demonstration fixtures, not network results.'},{step:'resolve',status:'done',detail:'Mapped two input seeds to deterministic fixture rankings.'},{step:'retrieve',status:'done',detail:`Loaded two independently ranked ${kind} fixture sets.`}]};}
