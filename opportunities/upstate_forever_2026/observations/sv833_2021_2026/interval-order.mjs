// Original interval-order support for SV-833; standard ECMAScript, no dependencies.
function checked(a) {
  if (!a || !Number.isFinite(a.lo) || (a.hi !== null && !Number.isFinite(a.hi))) throw Error("Use finite lower bounds and finite upper bounds or null for unbounded upper support.");
  if (a.hi !== null && (a.hi < a.lo || (a.hi === a.lo && (a.loOpen || a.hiOpen)))) throw Error("Empty interval.");
  return a;
}
export function intervalOrder(a, b) {
  checked(a); checked(b);
  if (a.hi === a.lo && b.hi === b.lo && a.lo === b.lo) return 0;
  const ah = a.hi === null ? Infinity : a.hi, bh = b.hi === null ? Infinity : b.hi;
  if (ah < b.lo || (ah === b.lo && (a.hiOpen || b.loOpen))) return -1;
  if (bh < a.lo || (bh === a.lo && (b.hiOpen || a.loOpen))) return 1;
  return null;
}
export function classifyPairedIntervals(rows) {
  if (new Set(rows.map(x => x.activity)).size !== rows.length) throw Error("Each activity must occur once.");
  for (const row of rows) {
    checked(row.x); checked(row.y);
    if (row.x.lo !== row.x.hi) throw Error("This score-bound calculation requires an exact x value.");
  }
  const counts = {concordant:0, discordant:0, x_tie:0, y_tie:0, both_tie:0, unresolved:0};
  const pairs = [];
  for (let i=0;i<rows.length;i++) for (let j=i+1;j<rows.length;j++) {
    const a=rows[i], b=rows[j], x=intervalOrder(a.x,b.x), y=intervalOrder(a.y,b.y);
    const classification = x===0 ? (y===0?"both_tie":"x_tie") : y===0 ? "y_tie" : y===null ? "unresolved" : x===y ? "concordant" : "discordant";
    counts[classification]++;
    pairs.push({activity_a:a.activity, activity_b:b.activity, date_a:a.date, date_b:b.date, x_order:x, y_order:y, classification});
  }
  const denominator=rows.length*(rows.length-1)/2;
  const score=counts.concordant-counts.discordant;
  return {
    summary:{activities:rows.length,pairs:denominator,...counts,
      conservative_tau_a_lower:denominator?(score-counts.unresolved)/denominator:null,
      conservative_tau_a_upper:denominator?(score+counts.unresolved)/denominator:null},
    pairs
  };
}
export function arithmeticMeanSupport(rows) {
  if (!rows.length) return {n:0,lo:null,hi:null,loOpen:false,hiOpen:false};
  for (const row of rows) checked(row);
  return {n:rows.length,lo:rows.reduce((s,x)=>s+x.lo,0)/rows.length,
    hi:rows.some(x=>x.hi===null)?null:rows.reduce((s,x)=>s+x.hi,0)/rows.length,
    loOpen:rows.some(x=>Boolean(x.loOpen)),hiOpen:rows.some(x=>Boolean(x.hiOpen))};
}
export function omissionInfluence(rows, excludedActivity) {
  if (!rows.some(x=>x.activity===excludedActivity)) throw Error("The selected original activity is absent.");
  return {excluded_activity:excludedActivity,full:arithmeticMeanSupport(rows),
    without_selected_activity:arithmeticMeanSupport(rows.filter(x=>x.activity!==excludedActivity))};
}
