// MIT. Exact, display-only views of retained Paycashless provider observations.
const own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
const isObject=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
export function exactObservation(row){
 const value=row?.value??row?.projection??{};
 const tokens=row?.numberTokens??row?.projectionNumberTokens??{};
 function walk(v,p){
  if(own(tokens,p))return String(tokens[p]);
  if(Array.isArray(v))return v.map((x,i)=>walk(x,p+'/'+i));
  if(isObject(v))return Object.fromEntries(Object.entries(v).map(([k,x])=>[k,walk(x,p+'/'+k.replaceAll('~','~0').replaceAll('/','~1'))]));
  return v;
 }
 return walk(value,'');
}
export function amountLabel(amount,currency){
 if(amount===null||amount===undefined||amount==='')return 'Not supplied';
 const raw=String(amount),unit=currency==='NGN'?'kobo':currency==='USD'?'cents':'minor units';
 if(!['NGN','USD'].includes(currency)||!/^[-+]?\d+$/.test(raw))return raw+' '+unit+(currency?' · '+currency:'');
 const sign=raw.startsWith('-')?'-':'',digits=raw.replace(/^[-+]/,'').padStart(3,'0');
 const major=digits.slice(0,-2).replace(/^0+(?=\d)/,'').replace(/\B(?=(\d{3})+(?!\d))/g,',')+'.'+digits.slice(-2);
 return currency+' '+sign+major+' · '+raw+' '+unit;
}
export function resourceSummary(row){
 const value=exactObservation(row),kind=row?.kind??'';
 let primary=null,secondary=null,relation=null;
 if(kind==='paycashless-invoice'){primary=['Due',value.amountDue];secondary=['Paid',value.amountPaid];relation=value.number??value.reference??value.id;}
 else if(kind==='paycashless-invoice-payment'){primary=['Paid',value.amountPaid];secondary=['Requested',value.amountRequested];relation=[value.invoiceId,value.intentId].filter(Boolean).join(' / ');}
 else if(kind==='paycashless-payment'){primary=['Charged',value.chargedAmount];secondary=['Expected',value.expectedAmount];relation=value.reference??value.id;}
 else if(kind==='paycashless-payout'){primary=['Payout',value.amount];secondary=['Fee',value.fee];relation=[value.destinationBankId,value.destinationAccountNumber].filter(Boolean).join(' / ');}
 return {value,primary:primary?primary[0]+': '+amountLabel(primary[1],value.currency):null,secondary:secondary?secondary[0]+': '+amountLabel(secondary[1],value.currency):null,
  relation,status:value.status??(typeof value.paid==='boolean'?(value.paid?'paid':'unpaid'):row.status??row.kind),
  title:value.number??value.reference??value.name??value.id??row?.resourceId,
  currency:value.currency??null};
}
export const REGISTER_KINDS=[
 ['paycashless-invoice','Invoices'],['paycashless-invoice-payment','Invoice payments'],
 ['paycashless-payment','Payment intents'],['paycashless-payout','Payouts'],
 ['paycashless-dedicated-account','Dedicated accounts']
];
export const OBSERVATION_SECTIONS={
 'paycashless-invoice':[['Invoice and collection',['id','number','reference','status','customerId','currency','amountDue','amountPaid','amountOverpaid','amountRemaining','subTotal']],['Payment terms and tax',['acceptPartialPayments','maxInstallments','daysUntilDue','dueDate','totalInclusiveTaxAmount','totalExclusiveTaxAmount','paidAt','cancelledAt','cancellationReason']],['Original line items',['items']],['Original tax rates',['taxRates']]],
 'paycashless-invoice-payment':[['Invoice payment',['id','invoiceId','intentId','currency','amountPaid','amountRequested','paid']]],
 'paycashless-payment':[['Payment intent',['id','reference','status','currency','expectedAmount','chargedAmount','acceptedAmountPolicy','customerId']],['Payment channel and charges',['paymentMethod','paymentChannel','fee','vat','emtl']]],
 'paycashless-payout':[['Payout',['id','reference','status','currency','amount','destinationAccountNumber','destinationBankId','networkSessionId']],['Charges and confirmation',['stampDuty','fee','vat','requiresConfirmation','confirmationState','failureCode','failureMessage']],['Initiation and approval',['initiation','approval','cancellation','narration']]]
};
