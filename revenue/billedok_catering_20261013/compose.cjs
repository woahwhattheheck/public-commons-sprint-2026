'use strict';
/** Operate the complete researched catering package through the unchanged fulfillment engine. */
function compose(core, sha, input) {
  const need=(ok,message)=>{if(!ok)throw Error(message);};
  const {case_id:id,prepared_at:at,records,buyer}=input;
  need(records.length===6&&new Set(records.map(x=>x.company_domain)).size===6,'Six distinct original companies are required.');
  const enc=s=>{const b=unescape(encodeURIComponent(s)),a='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';let out='';for(let i=0;i<b.length;i+=3){const x=b.charCodeAt(i),y=b.charCodeAt(i+1),z=b.charCodeAt(i+2);out+=a[x>>>2]+a[(x&3)<<4|(Number.isNaN(y)?0:y>>>4)]+(Number.isNaN(y)?'=':a[(y&15)<<2|(Number.isNaN(z)?0:z>>>6)])+(Number.isNaN(z)?'=':a[z&63]);}return out;};
  const textJSON=x=>JSON.stringify(x,null,2)+'\n';
  const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let ledger={};const operations=[];
  const apply=(suffix,kind,data)=>{const body={operation_id:id+':'+suffix,kind,input:data,expected_root_sha256:core.hash(core.validateRoot(ledger))};const result=core.applyLeadFulfillment(ledger,body,at);ledger=result.ledger;operations.push({body,at});return result;};
  apply('brief','pack-save',{id,customer:{name:'BilledOK',company_domain:'billedok.de',contact_url:buyer.contact_url,case_id:id},brief:{
    title:'Fünf weitere recherchierte Catering-Betriebe für BilledOK',
    description:'Ein kostenloses vollständiges Unternehmensprofil und fünf weitere deutsche Catering-Betriebe mit veröffentlichtem Geschäftskontakt, konkretem Einkaufs- oder Küchenablauf, Originalquellen und individuell vorbereitetem Gesprächseinstieg.',
    geography:'Deutschland',skills:['Catering-Einkauf','Lieferantenrechnungen','Artikelpreisvergleich'],lead_kind:'company_fit',quantity:5,currency:'USD',price_minor:2000,max_age_days:30,
    excluded_domains:['billedok.de','catering-nimmersatt.de'],excluded_sources:[],
    exclusions:'Der bestehende Bestell-, Qualitäts-, Buchhaltungs- und Archivierungsprozess bleibt erhalten. Bedarf, Belegvolumen und interne Einkaufszuständigkeit werden im Gespräch geklärt. Rechnungsmuster ausschließlich freiwillig und berechtigt bereitstellen.'
  },operator_note:'Complete original research and prepared first offer. Preserve current relationship and shared-account capacity rules.'});
  const ids=records.map(r=>'billedok-'+r.slug+'-20261013');
  apply('leads','leads-save',{pack_id:id,leads:records.map((r,i)=>({
    id:ids[i],organization:r.company,company_domain:r.company_domain,company_url:r.company_url,buyer_key:r.company_domain,person:r.contact_name,
    source_url:r.source_url,published_on:'',author_updated_on:'',lead_kind:'company_fit',checked_at:at,deadline_on:'',deadline_at:'',
    demand:r.observed,fit:r.fit_hypothesis,contact_url:'mailto:'+r.email,contact_instructions:r.contact_type+'. Kontaktquelle: '+r.contact_source,
    geography:r.area,budget:'',opening_message:r.opening,source_status:'open',status_note:r.qualification,
    tags:['DE','catering','supplier-invoices','company-fit'],
    operator_note:r.role+'. Bestehender Ablauf: '+r.booking+' Vorschlag: '+r.proposed_demo+' Weitere Quellen: '+r.additional_sources.join(' ')
  }))});
  const editions={sample:'billedok-free-vegetaria-20261013',paid:'billedok-paid-five-20261013'};
  apply('sample','edition-prepare',{pack_id:id,id:editions.sample,kind:'sample',lead_ids:ids.slice(0,1)});
  apply('paid','edition-prepare',{pack_id:id,id:editions.paid,kind:'paid',lead_ids:ids.slice(1)});
  const headings=['Unternehmen','Region','Ansprechpartner','Rolle','E-Mail','Telefon','Beobachteter Ablauf','Bestehender Prozess','Möglicher Ansatz','Kleine Demonstration','Gesprächseinstieg','Qualifizierung','Hauptquelle','Kontaktquelle','Weitere Quellen','Prüfdatum'];
  const csvCell=x=>'"'+String(x??'').replace(/"/g,'""')+'"';
  const csv=rows=>[headings,...rows.map(r=>[r.company,r.area,r.contact_name,r.role,r.email,r.phone,r.observed,r.booking,r.fit_hypothesis,r.proposed_demo,r.opening,r.qualification,r.source_url,r.contact_source,r.additional_sources.join(' | '),r.checked_date])].map(row=>row.map(csvCell).join(',')).join('\r\n')+'\r\n';
  const title=kind=>kind==='sample'?'Ein recherchierter Catering-Betrieb für BilledOK':'Fünf weitere Catering-Betriebe für BilledOK';
  const fields=r=>[
    ['Region',r.area],['Geschäftskontakt',r.contact_name+' · '+r.role+'\n'+r.email+' · '+r.phone],
    ['Öffentlich beobachteter Ablauf',r.observed],['Bestehender Prozess',r.booking],
    ['Möglicher BilledOK-Ansatz',r.fit_hypothesis],['Vorgeschlagene kleine Demonstration',r.proposed_demo],
    ['Vorbereiteter Gesprächseinstieg',r.opening],['Vor dem Versuch klären',r.qualification]
  ];
  const sources=r=>[...new Set([r.source_url,r.contact_source,...r.additional_sources])];
  const md=(kind,rows)=>'# '+title(kind)+'\n\nStand: 13. Oktober 2026. '+(kind==='sample'?'Kostenloses Musterprofil.':'Fünf zusätzliche Unternehmensprofile · 20 USD insgesamt.')+'\n\nDie öffentlichen Quellen belegen den beschriebenen Betrieb und seinen Ablauf. Der vorgeschlagene Einsatz ist eine Gesprächshypothese; die passende Person bestätigt Bedarf und Vorgehen.\n\n'+rows.map(r=>'## '+r.company+'\n\n'+fields(r).map(([k,v])=>'### '+k+'\n\n'+v+'\n').join('\n')+'\n### Originalquellen\n\n'+sources(r).map(u=>'- '+u).join('\n')+'\n\nGeprüft: '+r.checked_date+'\n').join('\n---\n\n');
  const html=(kind,rows)=>'<!doctype html>\n<html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+escape(title(kind))+'</title><style>*,*:before,*:after{box-sizing:border-box}body{margin:0;background:#f4f4f4;color:#222;font:16px/1.6 system-ui,-apple-system,Segoe UI,sans-serif}main{max-width:980px;margin:auto;padding:36px 24px}h1{font-size:30px;line-height:1.2;margin:0 0 18px}h2{font-size:24px;line-height:1.3;margin:0 0 18px}h3{font-size:16px;line-height:1.4;margin:22px 0 6px}p{margin:0 0 14px;white-space:pre-line}a{color:#222;text-decoration:underline;overflow-wrap:anywhere}header,article{background:white;border:1px solid #c5c5c5;padding:26px;margin:0 0 24px}nav{margin:22px 0}nav a{display:block;padding:6px 0}ul{padding-left:22px}li{margin:8px 0}.opening{border-left:3px solid #777;background:#f4f4f4;padding:16px}.meta{color:#484848;font-size:14px}footer{border-top:1px solid #bbb;padding-top:20px}@media(max-width:600px){main{padding:16px 12px}header,article{padding:20px 16px}h1{font-size:25px}h2{font-size:22px}}@media print{body{background:white}main{max-width:none;padding:0}nav{display:none}article{break-inside:avoid}a{color:#222}}</style></head><body><main><header><p class="meta">BilledOK · Recherche vom 13. Oktober 2026</p><h1>'+escape(title(kind))+'</h1><p>'+(kind==='sample'?'Kostenloses Musterprofil.':'Fünf zusätzliche Unternehmensprofile · 20 USD insgesamt.')+'</p><p>Die öffentlichen Quellen belegen den beschriebenen Betrieb und seinen Ablauf. Der vorgeschlagene Einsatz ist eine Gesprächshypothese; die passende Person bestätigt Bedarf und Vorgehen.</p><nav aria-label="Unternehmensprofile">'+rows.map(r=>'<a href="#'+r.slug+'">'+escape(r.company)+'</a>').join('')+'</nav></header>'+rows.map(r=>'<article id="'+r.slug+'"><h2>'+escape(r.company)+'</h2>'+fields(r).map(([k,v])=>'<h3>'+escape(k)+'</h3><p'+(k==='Vorbereiteter Gesprächseinstieg'?' class="opening"':'')+'>'+escape(v)+'</p>').join('')+'<h3>Originalquellen</h3><ul>'+sources(r).map(u=>'<li><a href="'+escape(u)+'">'+escape(u)+'</a></li>').join('')+'</ul><p class="meta">Geprüft: '+escape(r.checked_date)+'</p></article>').join('')+'<footer><p>Für den ersten Kontakt den veröffentlichten Geschäftskanal nutzen und den Vorschlag auf den aktuellen Betrieb zuschneiden. Qualität, Einheiten, Gutschriften und vorhandene Einkaufswerkzeuge im gemeinsamen Vergleich berücksichtigen.</p></footer></main></body></html>\n';
  const guide='# BilledOK · So nutzen Sie die recherchierten Unternehmensprofile\n\nStand: 13. Oktober 2026.\n\n## Inhalt und Auswahl\n\nDas Muster enthält Vegetaria. Das zusätzliche Paket enthält fünf weitere Catering-Betriebe. Jeder Betrieb hat einen veröffentlichten Geschäftskontakt, konkrete Originalquellen, einen beobachteten Ablauf, einen eng gefassten möglichen Einsatz und einen individuell vorbereiteten Gesprächseinstieg.\n\n## Öffnen und weiterarbeiten\n\nÖffnen Sie zuerst die HTML-Datei im Browser. Sie enthält den vollständigen Bericht, eine Unternehmensnavigation und anklickbare Quellen; sie benötigt keine Anmeldung oder Installation. Die gleichnamige Markdown-Datei enthält denselben vollständigen Text. Die UTF-8-CSV lässt sich mit Komma als Trennzeichen in einer Tabellenkalkulation öffnen. Die JSON-Datei enthält die unveränderte ausgewählte Datenausgabe mit Kontakten, Quellen und Gesprächsvorschlägen.\n\n## Erstes Gespräch und kleiner Versuch\n\n1. Öffnen Sie die angegebenen Originalseiten erneut und bestätigen Sie den aktuellen Geschäftsbereich sowie den veröffentlichten Kontakt.\n2. Nutzen Sie den individuellen Einstieg und klären Sie die Einkaufszuständigkeit, Häufigkeit der Rechnungen und vorhandene Auswertung.\n3. Vereinbaren Sie bei Interesse einen kleinen Vergleich weniger regelmäßig gekaufter Artikel aus freiwillig und berechtigt bereitgestellten Lieferantenrechnungen. Lassen Sie notwendige Vertraulichkeits- und Datenschutzfragen vor dem Bereitstellen klären.\n4. Prüfen Sie Artikelzuordnung, Mengen und Packungsgrößen sowie Netto-/Bruttobasis, Qualität, Zuschläge, Rabatte und Gutschriften gemeinsam. Ein niedrigerer Einzelpreis allein entscheidet nicht über einen Lieferantenwechsel.\n5. Behalten Sie vorhandene Bestellung, Speiseplanung, Buchhaltung und Originalbelegablage bei. Vorhandene Bestell- und Anfragewerkzeuge bleiben bestehen; mögliche Integrationen sind gesondert zu klären.\n\n## Umfang des Angebots\n\nEin vollständiges Musterprofil ist kostenlos. Fünf zusätzliche recherchierte Unternehmensprofile kosten zusammen 20 USD. Bei einem sachlichen Fehler oder einem unbrauchbaren veröffentlichten Kontakt umfasst das Paket eine Korrektur oder ein Ersatzprofil innerhalb von sieben Tagen nach Lieferung. Diese Recherche beschreibt passende Unternehmen und öffentliche Abläufe; Nachfrage, Budget, Belegzugang und Zuständigkeit ergeben sich aus dem jeweiligen Gespräch.\n';
  const customers=[],fileSpec=[];
  const add=(path,content,type,leadIds,kind)=>{const name=path.split('/').pop(),h=sha.sha256Utf8(content);customers.push({path,content,...h});fileSpec.push({id:'billedok-file-'+(fileSpec.length+1)+'-20261013',name,title:name,description:kind==='shared'?'Anleitung für die vollständigen recherchierten Profile.':'Vollständige '+(kind==='sample'?'kostenlose':'zusätzliche')+' Profil-Ausgabe mit Quellen und vorbereitetem Gesprächseinstieg.',type,lead_ids:leadIds,source_url:'',content_base64:enc(content),...h});};
  for(const [kind,rows,leadIds] of [['sample',records.slice(0,1),ids.slice(0,1)],['paid',records.slice(1),ids.slice(1)]]){
    add('customer/'+kind+'.csv',csv(rows),'text/csv',leadIds,kind);
    add('customer/'+kind+'.md',md(kind,rows),'text/markdown',leadIds,kind);
    add('customer/'+kind+'.html',html(kind,rows),'text/html',leadIds,kind);
    const e=core.validateRoot(ledger).editions.find(x=>x.id===editions[kind]);need(e,'Prepared original edition missing.');
    add('customer/'+kind+'-edition.json',textJSON(core.customerEdition(e)),'application/json',leadIds,kind);
  }
  add('customer/START-HERE.md',guide,'text/markdown',[],'shared');
  apply('customer-files','customer-files-save',{pack_id:id,files:fileSpec});
  const root=core.validateRoot(ledger);
  const packageIds=[];
  for(const kind of ['sample','paid']){
    const selected=fileSpec.filter((_,i)=>kind==='sample'?i<4||i===8:i>=4);
    const packageId='billedok-'+kind+'-customer-package-20261013';packageIds.push(packageId);
    apply(kind+'-package','customer-package-prepare',{pack_id:id,id:packageId,edition_id:editions[kind],title:title(kind),instructions:'Öffnen Sie START-HERE.md und die vollständige HTML-Datei. CSV, Markdown und JSON enthalten die weitere verwendbare Ausgabe. Originalquellen vor dem individuellen Geschäftskontakt erneut öffnen.',files:selected.map(f=>{const v=root.customer_files.find(x=>x.id===f.id);need(v,'Saved customer file missing.');return {id:v.id,revision:v.revision,sha256:v.sha256};})});
  }
  const working=core.leadFulfillmentExport(ledger,{packId:id,format:'working-record'}).value;
  const reopened=core.applyLeadFulfillment({}, {operation_id:id+':independent-receiving',kind:'working-record-receive',input:{bundle:working},expected_root_sha256:core.hash(core.validateRoot({}))},at).ledger;
  need(core.hash(core.leadFulfillmentExport(reopened,{packId:id,format:'working-record'}).value)===core.hash(working),'Independent working-record receiving differs.');
  const packages=packageIds.map(packageId=>{const selected=core.leadCustomerPackageSelection(ledger,packageId,id);need(core.hash(selected)===core.hash(core.leadCustomerPackageSelection(reopened,packageId,id)),'Independent customer package differs.');return {id:packageId,selection:selected};});
  return {ledger,operations,working_record:working,customer_files:customers,packages,validation:{companies:records.length,editions:working.editions.length,customer_files:fileSpec.length,customer_packages:packages.length,whole_record_receive_equal:true,package_receive_equal:true,visual_review:'pending_actual_rendered_review'}};
}
module.exports={compose};
