export const DEFAULT_BUDIBASE={
  "schema": "tjlabs.budibase-workshare-input.v1",
  "currency": "USD",
  "fee": 9600,
  "startDate": null,
  "illustrativeStartDate": "2026-10-19",
  "holidays": [],
  "invoiceNetDays": 15,
  "contributorPayDays": 14,
  "reworkReserveFraction": 0.1,
  "unpricedHoursFraction": 0,
  "accessDelayBusinessDays": 0,
  "reviewDelayBusinessDays": 0,
  "cutoverDelayBusinessDays": 0,
  "roles": [
    {
      "id": "platform",
      "name": "Platform and integration engineer",
      "costPerHour": 75,
      "productiveHoursPerDay": 6,
      "seat": "platform-role"
    },
    {
      "id": "operations",
      "name": "Workflow and acceptance specialist",
      "costPerHour": 55,
      "productiveHoursPerDay": 6,
      "seat": "operations-role"
    },
    {
      "id": "lead",
      "name": "Delivery lead",
      "costPerHour": 100,
      "productiveHoursPerDay": 6,
      "seat": "lead-role"
    }
  ],
  "phases": [
    {
      "id": "source",
      "name": "Select the real workflow and configure the receiving environment",
      "businessDays": 5,
      "hours": {
        "platform": 12,
        "operations": 1,
        "lead": 2
      }
    },
    {
      "id": "implement",
      "name": "Implement the agreed workflow, connectors and role configuration",
      "businessDays": 5,
      "hours": {
        "platform": 20,
        "operations": 3,
        "lead": 2
      }
    },
    {
      "id": "accept",
      "name": "Operate customer acceptance, correct behaviour and rehearse recovery",
      "businessDays": 5,
      "hours": {
        "platform": 20,
        "operations": 4,
        "lead": 2
      }
    },
    {
      "id": "handover",
      "name": "Publish, receive, train and transfer continuing operation",
      "businessDays": 5,
      "hours": {
        "platform": 8,
        "operations": 4,
        "lead": 2
      }
    }
  ],
  "milestones": [
    {
      "id": "start",
      "name": "Agreed start and source/environment responsibilities",
      "phase": "start",
      "fraction": 0.4
    },
    {
      "id": "ready",
      "name": "Complete selected workflow ready for customer acceptance",
      "phase": "implement",
      "fraction": 0.4
    },
    {
      "id": "accepted",
      "name": "Production handover and independent receiving accepted",
      "phase": "handover",
      "fraction": 0.2
    }
  ],
  "selectedScope": {
    "workflowCount": 1,
    "targetEnvironmentPairs": 1,
    "datasources": 2,
    "existingScreens": 12,
    "existingTables": 10,
    "existingAutomations": 5,
    "applicationRoles": 4,
    "initialNamedUsers": 20,
    "agreedBehaviourChanges": 4,
    "internalRowsForTransfer": 10000,
    "attachmentBytesForTransfer": 104857600,
    "formatRoute": "Select workspace-new, workspace-update or project after actual inventory",
    "interpretation": "Authored fixed-fee planning ceiling for a selected existing workflow; choose actual source quantities and changes before the customer offer is finalized."
  },
  "care": {
    "selected": false,
    "monthlyFee": 900,
    "platformHours": 4,
    "operationsHours": 1,
    "leadHours": 1,
    "monthlyThirdPartyCost": 0
  },
  "customerEconomics": {
    "months": 12,
    "loadedHourValue": 100,
    "incrementalPlatformMonthly": 0,
    "platformUpfront": 0,
    "currentManualHoursPerMonth": null
  },
  "agencyEconomics": {
    "customerProjectPrice": 12000,
    "agencyAccountManagementHours": 8,
    "agencyAccountManagementCostPerHour": 75
  },
  "referral": {
    "eligibilityConfirmed": false,
    "rate": null,
    "minimumInitialNet": 7200,
    "confirmedEligibleInitialNet": 0,
    "netReceipts": [],
    "includeInServiceCash": false
  },
  "collectionOnBusinessDays": true,
  "collectionDelayCalendarDays": 0
};
const clone=x=>JSON.parse(JSON.stringify(x));
const cents=x=>{const n=Math.round(x*100);if(!Number.isFinite(x)||!Number.isSafeInteger(n)||n<0)throw Error('Use nonnegative money within safe whole-cent range');return n;};
const date=s=>{if(!/^\d{4}-\d{2}-\d{2}$/.test(s))throw Error('Use YYYY-MM-DD');const d=new Date(s+'T00:00:00Z');if(!Number.isFinite(+d)||d.toISOString().slice(0,10)!==s)throw Error('Invalid calendar date');return d;};
const iso=d=>d.toISOString().slice(0,10);
const plus=(s,n)=>{const d=date(s);d.setUTCDate(d.getUTCDate()+n);return iso(d);};
const number=(x,name,max=1000000)=>{if(!Number.isFinite(x)||x<0||x>max)throw Error('Invalid '+name);return x;};
const whole=(x,name,max=3650)=>{number(x,name,max);if(!Number.isInteger(x))throw Error('Whole '+name+' required');return x;};
export function calculateBudibaseWorkshare(input={}){
 const x={...clone(DEFAULT_BUDIBASE),...clone(input),care:{...DEFAULT_BUDIBASE.care,...input.care},customerEconomics:{...DEFAULT_BUDIBASE.customerEconomics,...input.customerEconomics},agencyEconomics:{...DEFAULT_BUDIBASE.agencyEconomics,...input.agencyEconomics},referral:{...DEFAULT_BUDIBASE.referral,...input.referral}};
 for(const k of ['invoiceNetDays','contributorPayDays','collectionDelayCalendarDays','accessDelayBusinessDays','reviewDelayBusinessDays','cutoverDelayBusinessDays'])whole(x[k],k,365);
 for(const k of ['reworkReserveFraction','unpricedHoursFraction'])number(x[k],k,3);
 const fee=cents(x.fee);if(!fee)throw Error('Positive fee required');
 if(!Array.isArray(x.roles)||!x.roles.length||new Set(x.roles.map(r=>r.id)).size!==x.roles.length)throw Error('Unique nonempty roles required');
 if(!Array.isArray(x.phases)||!x.phases.length||new Set(x.phases.map(p=>p.id)).size!==x.phases.length)throw Error('Unique nonempty phases required');
 if(!Array.isArray(x.holidays))throw Error('Holiday array required');const holidays=new Set(x.holidays.map(d=>iso(date(d))));
 const working=d=>{const n=date(d).getUTCDay();return n!==0&&n!==6&&!holidays.has(d);};
 const nextWorking=d=>{for(let n=0;n<3700;n++,d=plus(d,1))if(working(d))return d;throw Error('No working date in calendar');};
 const skipWorking=(d,n)=>{d=nextWorking(d);for(let i=0;i<n;i++)d=nextWorking(plus(d,1));return d;};
 let cursor=skipWorking(x.startDate||x.illustrativeStartDate,x.accessDelayBusinessDays),start=cursor;
 const roles=new Map(x.roles.map(r=>{if(!r.id||!r.name||!r.seat)throw Error('Role identity and selected seat label required');number(r.costPerHour,'role cost');if(!number(r.productiveHoursPerDay,'productive capacity',24))throw Error('Positive capacity required');return[r.id,{...r,hours:0,costCents:0}]}));
 for(const id of ['platform','operations','lead'])if(!roles.has(id))throw Error('Retain the platform, operations and lead cost roles');
 const work=[],phases=[];let baseCost=0,actualCost=0,totalHours=0;
 for(const p of x.phases){whole(p.businessDays,'phase days',260);if(!p.businessDays)throw Error('Positive phase duration required');if(!p.hours||Object.keys(p.hours).some(k=>!roles.has(k)))throw Error('Phase names an unknown role');if(p.id==='accept')cursor=skipWorking(cursor,x.reviewDelayBusinessDays);if(p.id==='handover')cursor=skipWorking(cursor,x.cutoverDelayBusinessDays);
 const dates=[];for(let d=0;d<p.businessDays;d++){dates.push(cursor);cursor=nextWorking(plus(cursor,1));}
 let phaseHours=0,phaseCost=0;for(const[id,h]of Object.entries(p.hours)){number(h,'phase role hours',10000);const r=roles.get(id),hours=h*(1+x.unpricedHoursFraction),base=cents(h*r.costPerHour),cost=cents(hours*r.costPerHour);baseCost+=base;actualCost+=cost;phaseCost+=cost;phaseHours+=hours;totalHours+=hours;r.hours+=hours;r.costCents+=cost;const q=Math.floor(cost/p.businessDays),rem=cost-q*p.businessDays;dates.forEach((d,i)=>work.push({date:d,phase:p.id,role:id,seat:r.seat,hours:hours/p.businessDays,costCents:q+(i<rem?1:0),payDate:plus(d,x.contributorPayDays)}));}
 phases.push({id:p.id,name:p.name,startDate:dates[0],finishDate:dates.at(-1),businessDays:p.businessDays,hours:phaseHours,costCents:phaseCost,roleHours:Object.fromEntries(Object.entries(p.hours).map(([k,h])=>[k,h*(1+x.unpricedHoursFraction)]))});
 }
 if(!Array.isArray(x.milestones)||!x.milestones.length||new Set(x.milestones.map(m=>m.id)).size!==x.milestones.length)throw Error('Unique milestones required');
 if(x.milestones.some(m=>!Number.isFinite(m.fraction)||m.fraction<0)||Math.abs(x.milestones.reduce((n,m)=>n+m.fraction,0)-1)>1e-9)throw Error('Milestone fractions must total1');
 const weight=x.milestones.reduce((n,m)=>n+m.fraction,0),shares=x.milestones.map((m,i)=>{const raw=fee*(m.fraction/weight);return{i,cents:Math.floor(raw),remainder:raw-Math.floor(raw)};});const unallocated=fee-shares.reduce((n,s)=>n+s.cents,0);if(!Number.isSafeInteger(unallocated)||unallocated<0||unallocated>shares.length)throw Error('Milestone money cannot be allocated safely');const rank=[...shares].sort((a,b)=>b.remainder-a.remainder||a.i-b.i);for(let n=0;n<unallocated;n++)rank[n].cents++;const invoices=x.milestones.map((m,i)=>{const issueDate=m.phase==='start'?start:phases.find(p=>p.id===m.phase)?.finishDate;if(!issueDate)throw Error('Unknown invoice phase');const dueDate=plus(issueDate,x.invoiceNetDays),plannedCollection=plus(dueDate,x.collectionDelayCalendarDays);return{...m,issueDate,contractualDueDate:dueDate,collectDate:x.collectionOnBusinessDays?nextWorking(plannedCollection):plannedCollection,feeCents:shares[i].cents};});
 const seatDays=new Map();for(const w of work){const key=w.date+'|'+w.seat;const r=roles.get(w.role),q=seatDays.get(key)||{date:w.date,seat:w.seat,hours:0,capacityHours:r.productiveHoursPerDay};q.hours+=w.hours;q.capacityHours=Math.min(q.capacityHours,r.productiveHoursPerDay);seatDays.set(key,q);}
 const capacityIssues=[...seatDays.values()].filter(d=>d.hours>d.capacityHours+1e-9);
 const referral=x.referral,referrals=[];number(referral.minimumInitialNet,'referral minimum');number(referral.confirmedEligibleInitialNet,'eligible initial net');if(referral.rate!==null)number(referral.rate,'commission rate',1);
 const eligible=referral.eligibilityConfirmed===true&&referral.rate!==null&&referral.confirmedEligibleInitialNet>=referral.minimumInitialNet;
 if(!Array.isArray(referral.netReceipts))throw Error('Referral receipts array required');let used=0;for(const r of referral.netReceipts){date(r.date);number(r.netPaid,'eligible cleared receipt');used+=r.netPaid;if(used>referral.confirmedEligibleInitialNet+1e-8)throw Error('Receipts exceed confirmed eligible initial net');const d=date(r.date),quarter=Math.floor(d.getUTCMonth()/3),due=new Date(Date.UTC(d.getUTCFullYear(),quarter*3+4,0));referrals.push({receivedByBudibase:r.date,netPaidCents:cents(r.netPaid),commissionCents:eligible?cents(r.netPaid*referral.rate):0,paymentDueDate:iso(due),eligibilityConfirmed:eligible});}
 const end=[...work.map(w=>w.payDate),...invoices.map(i=>i.collectDate),...(referral.includeInServiceCash?referrals.map(r=>r.paymentDueDate):[])].sort().at(-1);
 const ledgerStart=[start,...(referral.includeInServiceCash?referrals.filter(r=>r.commissionCents>0).map(r=>r.paymentDueDate):[])].sort()[0];const daily=[];let balance=0,minimum=0;for(let d=ledgerStart;d<=end;d=plus(d,1)){const customer=invoices.filter(i=>i.collectDate===d).reduce((n,i)=>n+i.feeCents,0),paid=work.filter(w=>w.payDate===d).reduce((n,w)=>n+w.costCents,0),commission=referral.includeInServiceCash?referrals.filter(r=>r.paymentDueDate===d).reduce((n,r)=>n+r.commissionCents,0):0;balance+=customer+commission-paid;minimum=Math.min(minimum,balance);daily.push({date:d,serviceCollectionCents:customer,contributorPaymentCents:paid,confirmedReferralCollectionCents:commission,balanceCents:balance});}
 const reserve=cents(baseCost/100*x.reworkReserveFraction),care=x.care;for(const k of ['monthlyFee','platformHours','operationsHours','leadHours','monthlyThirdPartyCost'])number(care[k],k);
 const careCost=cents(care.platformHours*(roles.get('platform')?.costPerHour??0)+care.operationsHours*(roles.get('operations')?.costPerHour??0)+care.leadHours*(roles.get('lead')?.costPerHour??0)+care.monthlyThirdPartyCost);
 const buyer=x.customerEconomics;whole(buyer.months,'adoption months',120);if(!buyer.months||!number(buyer.loadedHourValue,'loaded hourly value'))throw Error('Positive adoption months and hour value required');number(buyer.incrementalPlatformMonthly,'monthly platform cost');number(buyer.platformUpfront,'upfront platform cost');if(buyer.currentManualHoursPerMonth!==null)number(buyer.currentManualHoursPerMonth,'current monthly effort');
 const customerCost=fee+cents(buyer.platformUpfront+buyer.months*(buyer.incrementalPlatformMonthly+(care.selected?care.monthlyFee:0))),breakEven=customerCost/100/buyer.months/buyer.loadedHourValue;
 const agency=x.agencyEconomics;for(const k of Object.keys(agency))number(agency[k],k);const agencyFee=cents(agency.customerProjectPrice),agencyCost=fee+cents(agency.agencyAccountManagementHours*agency.agencyAccountManagementCostPerHour);
 return{schema:'tjlabs.budibase-workshare-output.v1',input:x,calendar:{selectedStartDate:x.startDate,calculationOrigin:x.startDate||x.illustrativeStartDate,basis:x.startDate?'Selected scenario start':'Illustrative unselected start',firstWorkDate:start,finishDate:phases.at(-1).finishDate,productiveBusinessDays:phases.reduce((n,p)=>n+p.businessDays,0),elapsedCalendarDays:Math.round((date(phases.at(-1).finishDate)-date(start))/86400000)+1},summary:{feeCents:fee,hours:totalHours,baseDeliveryCostCents:baseCost,deliveryCostCents:actualCost,contributionCents:fee-actualCost,contributionFraction:(fee-actualCost)/fee,reworkReserveCents:reserve,contributionAfterReserveCents:fee-actualCost-reserve,contributionAfterReserveFraction:(fee-actualCost-reserve)/fee,peakWorkingCapitalCents:-minimum,workingCapitalIncludingReserveCents:-minimum+reserve,requiredFeeFor30PercentAfterReserveCents:Math.ceil((actualCost+reserve)/.7),capacityIssues:capacityIssues.length},roles:[...roles.values()],phases,invoices,work,daily,capacityIssues,care:{...care,hours:care.platformHours+care.operationsHours+care.leadHours,directCostCents:careCost,contributionCents:cents(care.monthlyFee)-careCost},customer:{termMonths:buyer.months,termCostCents:customerCost,breakEvenHoursSavedPerMonth:breakEven,currentHoursEnoughForBreakEven:buyer.currentManualHoursPerMonth===null?null:buyer.currentManualHoursPerMonth>=breakEven},agency:{customerPriceCents:agencyFee,supplierAndManagementCostCents:agencyCost,contributionCents:agencyFee-agencyCost,margin:agencyFee?(agencyFee-agencyCost)/agencyFee:0},referral:{eligible,excludedFromServiceBaseline:!referral.includeInServiceCash,schedules:referrals,totalCommissionCents:referrals.reduce((n,r)=>n+r.commissionCents,0)}};
}
export function budibaseScenarios(input={}){return[0,15,30,60].flatMap(invoiceNetDays=>[0,.2,.4].map(unpricedHoursFraction=>{const r=calculateBudibaseWorkshare({...input,invoiceNetDays,unpricedHoursFraction});return{name:'Net'+invoiceNetDays+' / '+Math.round(unpricedHoursFraction*100)+'% unpriced effort',calendar:r.calendar,summary:r.summary,invoices:r.invoices};}));}
