/** Interpretable, locally TRAINED multinomial Naive Bayes over payout-note text.
 * Labels indicate human review relevance, not proof of fraud or dishonesty.
 */
const EXAMPLES = [
  ['Monthly creator royalty settlement for September','routine'],
  ['Approved contractor milestone payment under agreement','routine'],
  ['Vendor invoice number 3381 for approved supplies','routine'],
  ['Quarterly affiliate earnings scheduled disbursement','routine'],
  ['Refund of verified travel reimbursement claim','routine'],
  ['Payroll adjustment reviewed by finance desk','routine'],
  ['Routine fulfillment partner payout September','routine'],
  ['Subscription creator fee share for this month','routine'],
  ['Approved service contract invoice completed','routine'],
  ['Confirmed charity grant tranche recipient approved','routine'],
  ['Partner commission for order reconciliation','routine'],
  ['Settled creator membership stipend approved','routine'],
  ['URGENT override recipient bank account has changed','review'],
  ['Bypass compliance manual wire payout today','review'],
  ['Emergency transfer to newly supplied alternate recipient','review'],
  ['Urgent manual exception skip normal review','review'],
  ['Use new wallet address outside original agreement','review'],
  ['Secret bonus transfer without manager approval','review'],
  ['Changed beneficiary please disregard prior account','review'],
  ['High priority rush payment ignore documentation','review'],
  ['Off ledger commission sent to different email','review'],
  ['Need immediate override despite missing invoice','review'],
  ['Manual exceptional wire to unverified beneficiary','review'],
  ['Priority disbursement no audit log please','review'],
];
const TOKEN = /[a-z][a-z0-9]{1,24}/g;
export function tokenize(value){return String(value||'').toLowerCase().match(TOKEN)||[];}
export function train(rows=EXAMPLES){
  const labels=['routine','review'];
  const docs=Object.fromEntries(labels.map(l=>[l,0]));
  const counts=Object.fromEntries(labels.map(l=>[l,new Map()]));
  const totals=Object.fromEntries(labels.map(l=>[l,0]));
  const vocab=new Set();
  for (const [text,label] of rows){
    if(!(label in counts))throw new TypeError('unknown training label');
    docs[label]++;
    for(const token of tokenize(text)){
      vocab.add(token);counts[label].set(token,(counts[label].get(token)||0)+1);totals[label]++;
    }
  }
  if(labels.some(l=>docs[l]===0)) throw new TypeError('training needs each label');
  return Object.freeze({labels,docs,counts,totals,vocab,trainedExamples:rows.length});
}
export const DEFAULT_MODEL=train();
export function classify(text,model=DEFAULT_MODEL){
  const tokens=tokenize(text).filter(t=>model.vocab.has(t));
  const fullTotal=Object.values(model.docs).reduce((a,b)=>a+b,0);
  const logScores={};const featureScores={};
  for(const label of model.labels){
    logScores[label]=Math.log(model.docs[label]/fullTotal);
    featureScores[label]=[];
    for(const token of tokens){
      const contribution=Math.log(((model.counts[label].get(token)||0)+1)/(model.totals[label]+model.vocab.size));
      logScores[label]+=contribution;
      featureScores[label].push({token,contribution});
    }
  }
  const max=Math.max(...Object.values(logScores));
  const weights=Object.fromEntries(model.labels.map(label=>[label,Math.exp(logScores[label]-max)]));
  const total=Object.values(weights).reduce((a,b)=>a+b,0);
  const probability=weights.review/total;
  const impacts=tokens.map(token=>({
    token,
    lift:Math.log(((model.counts.review.get(token)||0)+1)/(model.totals.review+model.vocab.size))-
      Math.log(((model.counts.routine.get(token)||0)+1)/(model.totals.routine+model.vocab.size))
  }));
  impacts.sort((a,b)=>Math.abs(b.lift)-Math.abs(a.lift));
  return {
    label:probability>=0.67?'review':'routine',
    reviewProbability:Number(probability.toFixed(4)),
    topSignals:impacts.slice(0,4).map(x=>({token:x.token,reviewLift:Number(x.lift.toFixed(3))})),
    trainedExamples:model.trainedExamples,
    knownTokens:tokens.length,
    note:'Learned text pattern signal, not a fraud determination.'
  };
}
