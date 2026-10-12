// MIT. Original accounting target and input review inside Applications.
const node=(tag,text,className)=>{
  const value=document.createElement(tag);
  if(text!==undefined)value.textContent=String(text);
  if(className)value.className=className;
  return value;
};
function row(label,value){
  const fragment=document.createDocumentFragment();
  fragment.append(node('dt',label),node('dd',value??'Not selected'));
  return fragment;
}
export function renderAccountingApplicationReview(command){
  const review=command?.accounting;
  if(review?.schema!=='stellar-forge.managed-accounting-binding.v1')return document.createDocumentFragment();
  const section=node('section',undefined,'panel');
  section.append(node('h4','Accounting workspace and registered targets'));
  const facts=node('dl',undefined,'facts');
  for(const [label,value] of [
    ['Original accounting workspace',review.directory],['Selection directory',review.selectionDirectory],
    ['Registry',review.connectionsFile],['Registry SHA-256',review.connectionsSha256],
    ['Reviewed start SHA-256',review.bindingSha256],['Local listener','127.0.0.1:'+review.port],
    ['Opening mode',review.recoveryStartPaused?'Paused for original recovery':'Original accounting workspace'],
  ])facts.append(row(label,value));
  section.append(facts);
  for(const [provider,label] of [['quickbooks','QuickBooks Online'],['xero','Xero']]){
    const target=review.targets?.[provider],detail=node('div');
    detail.append(node('h5',label));
    if(!target){detail.append(node('p','No saved native selection. Use Connections after opening to authorize and review a company, then review and reopen the application.','note'));}
    else{
      const selected=node('dl',undefined,'facts');
      for(const [name,value] of [
        ['Selected company',target.companyName??target.organizationName??target.tenantName],
        ['Base currency',target.baseCurrency],['Alias',target.alias],['Reviewed grant',target.grantId],
        [provider==='quickbooks'?'Company / environment':'Tenant',provider==='quickbooks'?target.realmId+' / '+target.environment:target.tenantId],
        ['Selected source SHA-256',review.selections[provider]],['Reviewer',target.review.actor+' · '+target.review.reference],
      ])selected.append(row(name,value));
      detail.append(selected);
    }
    section.append(detail);
  }
  for(const profile of review.profiles??[]){
    const detail=node('details'),facts=node('dl',undefined,'facts');
    detail.append(node('summary',profile.label+' · '+profile.alias));
    for(const [label,value] of [['Registered callback',profile.callbackUri],['Original source SHA-256',profile.source.sha256],
      ['Profile SHA-256',profile.profileSha256],['Private store',profile.directory],['Directory reference',profile.directoryEnv],
      ['Client-secret reference',profile.clientSecretEnv??'Not selected']])facts.append(row(label,value));
    detail.append(facts);section.append(detail);
  }
  if(review.inputs?.length){
    const detail=node('details'),facts=node('dl',undefined,'facts');detail.append(node('summary','Original accounting inputs'));
    for(const input of review.inputs)facts.append(row(input.name,input.path+(input.sha256?' · SHA-256 '+input.sha256:'')));
    detail.append(facts);section.append(detail);
  }
  section.append(node('p','This start freezes the selected company and tenant for the original accounting clients. A later saved selection is activated by another reviewed application start.','note'));
  return section;
}
