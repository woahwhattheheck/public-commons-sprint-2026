(() => {
"use strict";
const $=s=>document.querySelector(s),all=s=>[...document.querySelectorAll(s)];
const envelope=JSON.parse($("#review-data").textContent),packet=envelope.packet,edition=packet.edition.snapshot;
const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const clone=v=>JSON.parse(JSON.stringify(v)),uid=prefix=>prefix+"-"+(crypto.randomUUID?crypto.randomUUID():Array.from(crypto.getRandomValues(new Uint8Array(16)),v=>v.toString(16).padStart(2,"0")).join(""));
const key="standards-review-draft:"+envelope.packet_sha256;
let language="en",view="instructions",clauseId=edition.clauses[0]?.id||"",editing=null,changed=false,storage=true;
let readClauseIds=new Set(),outlineFilter="all",commentFilter="",commentPage=0,lastExport=null;
const texts={
 en:{document:"Read clauses",cases:"Worked cases",comments:"My comments",instructions:"Instructions & reviewer",search:"Find a clause",general:"Whole document",add:"Add a comment",edit:"Edit comment",remove:"Remove comment",save:"Save comment",clause:"Clause",kind:"Comment type",lang:"Comment language",body:"Comment",proposedEn:"Proposed English wording",proposedFr:"Proposed French wording",optional:"Optional",technical:"Technical",editorial:"Editorial",public:"General review",name:"Name",organization:"Organization",email:"Return contact",declaration:"These details are supplied by the reviewer.",example:"This is an authored practice response.",local:"Draft kept in this browser. Export a draft file to carry it elsewhere.",nostorage:"Browser storage is unavailable. Save a draft file before closing.",exported:"Response file exported. Return it through the route in the instructions.",opened:"The saved draft is open for this exact packet.",instructionsTitle:"Review this edition",notSent:"This page works offline. Export the response JSON and return it through the recorded route.",noRoute:"No return route was supplied in this packet.",emptyComments:"No comments yet. Choose a clause or add a comment about the whole document.",references:"Public source references",reviewQuestions:"Review questions",observations:"Authored expected observations",data:"Original source rows",noFrench:"French text is not supplied for this item.",none:"Not set",source:"Source",statement:"Reviewer details",packet:"Frozen packet",period:"Recorded consultation window",procedure:"Selected procedure",prepared:"Prepared",count:"comments",returnRoute:"Return your response",draftMissing:"This file does not belong to the exact packet open here.",bodyNeeded:"Write the comment before saving.",exportEmpty:"Add at least one complete comment before exporting a response.",savedFile:"Draft file saved.",confirmRemove:"Remove this comment from your working response?",duplicate:"The opened response repeats a comment identity.",overwrite:"Opening this file will replace the current working response. Save your current draft file first if you need it."},
 fr:{document:"Lire les clauses",cases:"Cas documentés",comments:"Mes commentaires",instructions:"Instructions et personne répondante",search:"Rechercher une clause",general:"Document entier",add:"Ajouter un commentaire",edit:"Modifier le commentaire",remove:"Supprimer le commentaire",save:"Enregistrer le commentaire",clause:"Clause",kind:"Type de commentaire",lang:"Langue du commentaire",body:"Commentaire",proposedEn:"Texte anglais proposé",proposedFr:"Texte français proposé",optional:"Facultatif",technical:"Technique",editorial:"Rédactionnel",public:"Observation générale",name:"Nom",organization:"Organisation",email:"Coordonnées de retour",declaration:"Ces renseignements sont déclarés par la personne répondante.",example:"Il s'agit d'une réponse d'exercice rédigée pour la démonstration.",local:"Brouillon conservé dans ce navigateur. Exportez un fichier pour le déplacer.",nostorage:"Le stockage du navigateur est indisponible. Enregistrez un fichier avant de fermer.",exported:"Fichier de réponse exporté. Transmettez-le selon les instructions.",opened:"Le brouillon enregistré est ouvert pour ce dossier exact.",instructionsTitle:"Examiner cette édition",notSent:"Cette page fonctionne hors ligne. Exportez la réponse JSON et transmettez-la par le mode indiqué.",noRoute:"Aucun mode de retour n'a été indiqué dans ce dossier.",emptyComments:"Aucun commentaire. Choisissez une clause ou commentez le document entier.",references:"Références publiques",reviewQuestions:"Questions d'examen",observations:"Observations attendues rédigées pour le cas",data:"Lignes des sources originales",noFrench:"Aucun texte français n'est fourni pour cet élément.",none:"Non indiqué",source:"Source",statement:"Renseignements sur la personne répondante",packet:"Dossier figé",period:"Période de consultation indiquée",procedure:"Procédure sélectionnée",prepared:"Préparé",count:"commentaires",returnRoute:"Transmettre votre réponse",draftMissing:"Ce fichier ne correspond pas au dossier exact ouvert ici.",bodyNeeded:"Rédigez le commentaire avant de l'enregistrer.",exportEmpty:"Ajoutez au moins un commentaire complet avant d'exporter une réponse.",savedFile:"Fichier de brouillon enregistré.",confirmRemove:"Supprimer ce commentaire de votre réponse de travail?",duplicate:"La réponse ouverte contient un identifiant de commentaire en double.",overwrite:"L'ouverture remplacera la réponse de travail actuelle. Enregistrez d'abord un fichier de brouillon si vous souhaitez la conserver."}
};
const t=k=>(texts[language==="fr"?"fr":"en"][k]||k);

Object.assign(texts.en,{
 return:"Review & return",reading:"Reading progress",read:"Read",unread:"To read",readCount:"clauses marked read",markRead:"Mark this clause read",markUnread:"Mark as still to read",previous:"Previous clause",next:"Next clause",nextUnread:"Continue with an unread clause",allClauses:"All clauses",unreadClauses:"Still to read",commentedClauses:"With comments",filter:"Show clauses",noMatches:"No clauses match this search.",outline:"Clause index",start:"Start reading",resume:"Continue reading",overview:"Review the clauses, work through the examples, then return your comments.",stepRead:"Read the document",stepReadBody:"Use the clause index or Next clause. Mark a clause read when you have finished with it.",stepComment:"Write your comments",stepCommentBody:"Attach each observation and any proposed wording to the clause it concerns. Use Whole document for general points.",stepReturn:"Return your response",stepReturnBody:"Review the complete response, export the JSON file and use the return route supplied with this packet.",preview:"Review response",summary:"Save readable copy",summarySaved:"Readable response copy saved.",responseTitle:"Review and return your response",responseIntro:"Check the comments and proposed wording below, then export the response file for the consultation operator.",route:"Return instructions",exportAction:"Export response file",exportHelp:"Return the JSON response file through this route. The readable copy is available for your own records.",pending:"An unfinished comment is saved in this draft.",resumeComment:"Continue unfinished comment",discardComment:"Discard unfinished comment",confirmDiscard:"Discard the unfinished comment? Saved comments will be kept.",privateProgress:"Reading marks stay with your local draft.",details:"Packet details",sourceDetails:"Source identifiers",originalFields:"Complete original record",sourceValues:"Original values",field:"Field",value:"Value",missing:"No value supplied",dateMissing:"Date not supplied",noWindow:"Consultation dates have not been set.",opens:"Opens",closes:"Closes",preparedLabel:"Prepared on",english:"English",french:"French",bilingual:"English and French",commentsFor:"Comments for",noReviewer:"Reviewer details have not been added.",editReviewer:"Edit reviewer details",backComments:"Edit comments",responseSaved:"Response file ready to return",lastExport:"Latest response export",recordCopy:"Consultation response",copyHelp:"Keep this readable copy with the JSON response file.",responseIdentity:"Response identity",responseDate:"Copy prepared",kindNormative:"Requirement",kindInformative:"Guidance",kindScope:"Scope",kindDefinition:"Definition",page:"Page",of:"of",previousPage:"Previous comments",nextPage:"Next comments",findComments:"Find a comment",matching:"matching comments",nothingFound:"No comments match this search.",readAll:"All clauses are marked read.",saveDraftLabel:"Save draft",openDraftLabel:"Open draft",exportLabel:"Export response",languageLabel:"Language",invalidFile:"This file contains a review value that cannot be opened. Keep the original file and choose a saved draft or response for this packet.",tooMany:"The response can contain up to 500 comments.",fileLimit:"The response file must be no larger than 8 MiB.",copyIncludes:"This copy includes all saved comments and proposed wording.",noProposed:"No replacement wording supplied.",returnMissing:"The packet does not specify a return route. Use the consultation's established return channel.",source:"Source",commentOne:"comment",commentMany:"comments",editCopy:"Edit the saved comments before making another copy.",readPosition:"Clause",navLabel:"Review steps",skip:"Skip to review content"
});
Object.assign(texts.fr,{
 return:"Réviser et transmettre",reading:"Progression de lecture",read:"Lu",unread:"À lire",readCount:"clauses marquées comme lues",markRead:"Marquer cette clause comme lue",markUnread:"Marquer comme restant à lire",previous:"Clause précédente",next:"Clause suivante",nextUnread:"Continuer avec une clause à lire",allClauses:"Toutes les clauses",unreadClauses:"Restant à lire",commentedClauses:"Avec commentaires",filter:"Afficher les clauses",noMatches:"Aucune clause ne correspond à cette recherche.",outline:"Index des clauses",start:"Commencer la lecture",resume:"Poursuivre la lecture",overview:"Lisez les clauses, examinez les exemples, puis transmettez vos commentaires.",stepRead:"Lire le document",stepReadBody:"Utilisez l'index ou Clause suivante. Marquez une clause comme lue lorsque vous avez terminé son examen.",stepComment:"Rédiger les commentaires",stepCommentBody:"Associez chaque observation et tout texte proposé à la clause concernée. Utilisez Document entier pour les observations générales.",stepReturn:"Transmettre la réponse",stepReturnBody:"Révisez la réponse complète, exportez le fichier JSON et utilisez le mode de retour indiqué dans ce dossier.",preview:"Réviser la réponse",summary:"Enregistrer une copie lisible",summarySaved:"Copie lisible de la réponse enregistrée.",responseTitle:"Réviser et transmettre votre réponse",responseIntro:"Vérifiez les commentaires et les textes proposés ci-dessous, puis exportez le fichier de réponse pour la personne responsable de la consultation.",route:"Instructions de retour",exportAction:"Exporter le fichier de réponse",exportHelp:"Transmettez le fichier de réponse JSON par ce mode de retour. Vous pouvez conserver une copie lisible dans vos dossiers.",pending:"Un commentaire inachevé est conservé dans ce brouillon.",resumeComment:"Reprendre le commentaire inachevé",discardComment:"Abandonner le commentaire inachevé",confirmDiscard:"Abandonner le commentaire inachevé? Les commentaires enregistrés seront conservés.",privateProgress:"Les marques de lecture restent dans votre brouillon local.",details:"Détails du dossier",sourceDetails:"Identifiants des sources",originalFields:"Enregistrement original complet",sourceValues:"Valeurs originales",field:"Champ",value:"Valeur",missing:"Aucune valeur fournie",dateMissing:"Date non indiquée",noWindow:"Les dates de consultation ne sont pas définies.",opens:"Ouverture",closes:"Clôture",preparedLabel:"Préparé le",english:"Anglais",french:"Français",bilingual:"Anglais et français",commentsFor:"Commentaires pour",noReviewer:"Les renseignements sur la personne répondante ne sont pas ajoutés.",editReviewer:"Modifier les renseignements",backComments:"Modifier les commentaires",responseSaved:"Fichier de réponse prêt à transmettre",lastExport:"Dernière exportation de la réponse",recordCopy:"Réponse à la consultation",copyHelp:"Conservez cette copie lisible avec le fichier de réponse JSON.",responseIdentity:"Identité de la réponse",responseDate:"Copie préparée",kindNormative:"Exigence",kindInformative:"Indication",kindScope:"Domaine d'application",kindDefinition:"Définition",page:"Page",of:"sur",previousPage:"Commentaires précédents",nextPage:"Commentaires suivants",findComments:"Rechercher un commentaire",matching:"commentaires correspondants",nothingFound:"Aucun commentaire ne correspond à cette recherche.",readAll:"Toutes les clauses sont marquées comme lues.",saveDraftLabel:"Enregistrer le brouillon",openDraftLabel:"Ouvrir un brouillon",exportLabel:"Exporter la réponse",languageLabel:"Langue",invalidFile:"Ce fichier contient une valeur de réponse qui ne peut pas être ouverte. Conservez l'original et choisissez un brouillon ou une réponse de ce dossier.",tooMany:"La réponse peut contenir jusqu'à 500 commentaires.",fileLimit:"Le fichier de réponse ne doit pas dépasser 8 Mio.",copyIncludes:"Cette copie comprend tous les commentaires enregistrés et les textes proposés.",noProposed:"Aucun texte de remplacement fourni.",returnMissing:"Le dossier ne précise aucun mode de retour. Utilisez le canal habituel de la consultation.",source:"Source",commentOne:"commentaire",commentMany:"commentaires",editCopy:"Modifiez les commentaires enregistrés avant de préparer une autre copie.",readPosition:"Clause",navLabel:"Étapes de l'examen",skip:"Passer au contenu de l'examen"
});
function humanDate(value){
 if(!value)return t("dateMissing");
 const raw=String(value),dateOnly=/^\d{4}-\d{2}-\d{2}$/.test(raw),d=new Date(dateOnly?raw+"T12:00:00Z":raw);
 if(!Number.isFinite(d.getTime()))return raw;
 const options=dateOnly?{year:"numeric",month:"long",day:"numeric",timeZone:"UTC"}:{year:"numeric",month:"long",day:"numeric",hour:"2-digit",minute:"2-digit",timeZoneName:"short"};
 return new Intl.DateTimeFormat(language==="fr"?"fr-CA":"en-CA",options).format(d);
}
function consultationWindow(){
 const c=packet.consultation;
 if(!c.opens&&!c.closes)return t("noWindow");
 return[c.opens?t("opens")+": "+humanDate(c.opens):"",c.closes?t("closes")+": "+humanDate(c.closes):""].filter(Boolean).join(" · ");
}
function clauseTitle(c){return c?c.number+" · "+(language==="fr"?c.title_fr||c.title_en:c.title_en||c.title_fr):t("general");}
function languageName(value){return value==="fr"?t("french"):value==="bilingual"?t("bilingual"):value==="en"?t("english"):String(value||t("none"));}
function kindName(value){return({normative:t("kindNormative"),informative:t("kindInformative"),scope:t("kindScope"),definition:t("kindDefinition")})[value]||t(value);}
function action(name,text,attrs="",primary=false){return'<button type="button" data-reviewer-action="'+name+'" '+attrs+' class="'+(primary?"primary":"")+'">'+esc(text)+"</button>";}
function progressText(){return readClauseIds.size+" / "+edition.clauses.length+" "+t("readCount");}
function pendingNotice(){
 return pendingEditor?'<section class="draft-recovery" role="status"><p>'+esc(t("pending"))+'</p><div class="toolbar">'+action("resume-comment",t("resumeComment"))+action("discard-comment",t("discardComment"))+"</div></section>":"";
}
function mainFocus(){const main=$("#main");main.focus({preventScroll:true});main.scrollIntoView({block:"start",behavior:"instant"});}
function goView(target,focus=true){readReviewer();view=target;persist(false);render();if(focus)mainFocus();}
function goClause(id,focus=true){
 if(!edition.clauses.some(c=>c.id===id))return;
 readReviewer();clauseId=id;view="document";persist(false);render();
 if(window.matchMedia("(max-width: 650px)").matches)$("#clause-browser").open=false;
 if(focus)mainFocus();
}
function sourceMetadata(source){
 return[source.publisher,source.version,source.language].filter(Boolean).join(" · ");
}
function recordValue(value){
 if(value===null||value===undefined)return'<span class="empty-value">'+esc(t("missing"))+"</span>";
 if(value==="")return'<span class="empty-value">'+esc(t("missing"))+"</span>";
 return esc(typeof value==="object"?JSON.stringify(value,null,2):String(value));
}
function fieldName(key){return String(key).replace(/([a-z])([A-Z])/g,"$1 $2").replace(/[_-]+/g," ").replace(/^./,c=>c.toLocaleUpperCase());}
function originalRow(row){
 const source=edition.sources.find(s=>s.id===row.source_id),isCells=Array.isArray(row.cells);
 const pairs=isCells?row.cells.map(cell=>[cell.name||String(cell.column),cell.value]):Object.entries(row).filter(([k])=>!["source_id","source_file_id","sha256","row_sha256","row_hash_basis","locator","record","row","csv_record","language"].includes(k));
 const values=pairs.length?'<div class="table-wrap"><table><thead><tr><th scope="col">'+esc(t("field"))+'</th><th scope="col">'+esc(t("value"))+"</th></tr></thead><tbody>"+pairs.map(([k,v])=>"<tr><th scope=\"row\">"+esc(isCells?k:fieldName(k))+'</th><td class="prose">'+recordValue(v)+"</td></tr>").join("")+"</tbody></table></div>":"";
 const locator=row.csv_record?(language==="fr"?"Enregistrement CSV ":"CSV record ")+row.csv_record:row.locator||row.record||row.row||"";
 return'<section class="source-record"'+(row.language==='fr'?' lang="fr"':'')+'><h4>'+esc(source?.title||t("source"))+'</h4><p class="meta">'+esc([locator,row.language?languageName(row.language):""].filter(Boolean).join(" · "))+'</p>'+values+'<details><summary>'+esc(t("originalFields"))+'</summary><pre class="prose">'+esc(JSON.stringify(row,null,2))+"</pre></details></section>";
}
function responseComment(c,index,expanded=false){
 const clause=edition.clauses.find(x=>x.id===c.clause_id),proposal=(field,title,lang)=>c[field]?expanded?'<section lang="'+lang+'"><h4>'+esc(title)+'</h4><div class="prose">'+esc(c[field])+"</div></section>":'<details><summary>'+esc(title)+'</summary><div class="prose" lang="'+lang+'">'+esc(c[field])+"</div></details>":"";
 return'<article class="card response-comment"><div class="toolbar"><h3><span class="comment-number">'+(index+1)+".</span> "+esc(clauseTitle(clause))+'</h3>'+(expanded?"":'<button type="button" data-edit-comment="'+esc(c.id)+'">'+esc(t("edit"))+"</button>")+'</div><p class="meta">'+esc(t(c.kind))+" · "+esc(languageName(c.language))+'</p><div class="comment-summary">'+esc(c.body)+"</div>"+proposal("proposed_text_en",t("proposedEn"),"en")+proposal("proposed_text_fr",t("proposedFr"),"fr")+"</article>";
}
function returnInstructions(){
 const primary=language==="fr"?packet.reply_route_fr:packet.reply_route_en;
 return'<div class="prose">'+esc(primary||t("returnMissing"))+"</div>"+(language==="bilingual"?'<div class="prose" lang="fr">'+esc(packet.reply_route_fr||texts.fr.returnMissing)+"</div>":"");
}
function reviewerDescription(){
 const r=response.reviewer,details=[r.name,r.organization,r.email].filter(Boolean);
 return details.length?details.map(s=>'<span>'+esc(s)+"</span>").join(""):'<span class="empty-value">'+esc(t("noReviewer"))+"</span>";
}
function responseDocument(value,generatedAt){
 const content='<header><p class="eyebrow">STANDARDS / NORMES</p><h1>'+esc(t("recordCopy"))+'</h1><h2>'+esc(packet.title)+'</h2><p>'+esc(packet.edition.label)+'</p><p>'+esc(t("responseDate"))+": "+esc(humanDate(generatedAt))+'</p></header><section class="card"><h2>'+esc(t("statement"))+'</h2><div class="reviewer-summary">'+reviewerDescription()+'</div><p>'+esc(languageName(value.reviewer.language))+'</p>'+(value.authored_example?'<p>'+esc(t("example"))+"</p>":"")+'</section><p>'+value.comments.length+" "+esc(t(value.comments.length===1?"commentOne":"commentMany"))+"</p>"+value.comments.map((c,i)=>responseComment(c,i,true)).join("")+'<section class="card"><h2>'+esc(t("route"))+'</h2>'+returnInstructions()+'<p>'+esc(t("copyHelp"))+'</p></section><details class="identity"><summary>'+esc(t("responseIdentity"))+'</summary><dl><dt>Response</dt><dd>'+esc(value.response_id)+'</dd><dt>Packet SHA-256</dt><dd>'+esc(value.packet_sha256)+'</dd><dt>Edition SHA-256</dt><dd>'+esc(value.source_edition_sha256)+'</dd></dl></details>';
 const style='*{box-sizing:border-box}html{color-scheme:light}body{font:15px/1.6 system-ui,sans-serif;color:#202020;background:#fff;max-width:1020px;margin:36px auto;padding:0 24px}h1{font-size:30px}h2{font-size:23px}h3{font-size:18px}h4{font-size:15px}h1,h2,h3,h4{line-height:1.3;break-after:avoid}.card{border:1px solid #bbb;padding:20px;margin:20px 0}.meta,.eyebrow{color:#555;font-size:13px}.prose,.comment-summary{white-space:pre-wrap;overflow-wrap:anywhere}.comment-summary{margin:16px 0}.reviewer-summary span{display:block}.identity{font-size:12px;overflow-wrap:anywhere}dd{margin:0 0 10px}section{min-width:0}@media(max-width:600px){body{padding:0 16px;margin:20px auto}.card{padding:16px}}@media print{body{max-width:none;margin:0;padding:0}.card{border:0;padding:0}details{display:none}.response-comment{break-inside:auto}}';
 return'<!doctype html><html lang="'+(language==="fr"?"fr":"en")+'"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; base-uri \'none\'; form-action \'none\'"><title>'+esc(packet.title)+" — "+esc(t("recordCopy"))+'</title><style>'+style+"</style></head><body>"+content+"</body></html>\n";
}
function responseValue(){
 readReviewer();
 if($("#comment-dialog").open)commitComment();
 if(pendingEditor){
  const value=pendingEditor;
  if(!value.body?.trim()){
   if(value.proposed_text_en?.trim()||value.proposed_text_fr?.trim())throw Error(t("bodyNeeded"));
   pendingEditor=null;
  }else{
   const index=response.comments.findIndex(c=>c.id===value.id);
   if(index>=0)response.comments[index]=clone(value);
   else{if(response.comments.length>=500)throw Error(t("tooMany"));response.comments.push(clone(value));}
   pendingEditor=null;
  }
 }
 if(!response.comments.length||response.comments.some(c=>!c.body?.trim()))throw Error(t("exportEmpty"));
 if(response.comments.length>500)throw Error(t("tooMany"));
 const value={...clone(response),exported_at:new Date().toISOString()};
 if(new Blob([JSON.stringify(value,null,2)+"\n"]).size>8*1024*1024)throw Error(t("fileLimit"));
 return value;
}
function exportResponse(){
 try{
  const value=responseValue(),filename="consultation-response-"+response.response_id+".json";
  download(filename,value);lastExport={filename,at:value.exported_at};persist();changed=false;
  view="return";render();$("#saved").textContent=t("exported");mainFocus();
 }catch(x){error(x.message);}
}
function saveReadableCopy(){
 try{const value=responseValue();downloadFile("consultation-response-"+response.response_id+".html",responseDocument(value,value.exported_at),"text/html;charset=utf-8");persist();render();$("#saved").textContent=t("summarySaved");}
 catch(x){error(x.message);}
}
function renderReturn(){
 const count=response.comments.length;
 let body='<section class="card"><p class="eyebrow">'+esc(packet.edition.label)+'</p><h1>'+esc(t("responseTitle"))+'</h1><p>'+esc(t("responseIntro"))+'</p><div class="response-metrics"><div><strong>'+count+'</strong><span>'+esc(t(count===1?"commentOne":"commentMany"))+'</span></div><div><strong>'+readClauseIds.size+" / "+edition.clauses.length+'</strong><span>'+esc(t("readCount"))+'</span></div></div><p class="meta">'+esc(t("privateProgress"))+'</p><div class="reviewer-summary">'+reviewerDescription()+'</div><p>'+esc(languageName(response.reviewer.language))+'</p><div class="toolbar">'+action("reviewer",t("editReviewer"))+action("comments",t("backComments"))+"</div></section>"+pendingNotice();
 if(lastExport)body+='<section class="export-confirmation" role="status"><h2>'+esc(t("responseSaved"))+'</h2><p>'+esc(humanDate(lastExport.at))+'</p><p class="filename">'+esc(lastExport.filename)+"</p></section>";
 body+=count?response.comments.map((c,i)=>responseComment(c,i,true)).join(""):'<section class="empty"><p>'+esc(t("emptyComments"))+'</p><button type="button" data-add-comment="">'+esc(t("add"))+"</button></section>";
 body+='<section class="card return-card"><h2>'+esc(t("route"))+'</h2>'+returnInstructions()+'<p>'+esc(t("exportHelp"))+'</p><div class="toolbar">'+action("export",t("exportAction"),"",true)+action("summary",t("summary"))+'</div></section>';
 $("#main").innerHTML=body;
}

function fresh(){return{schema:"standards-consultation-response/v1",packet_id:packet.packet_id,packet_sha256:envelope.packet_sha256,edition_id:packet.edition.id,source_edition_sha256:packet.source_edition_sha256,projection_sha256:packet.projection_sha256,response_id:uid("response"),prepared_at:new Date().toISOString(),reviewer:{name:"",organization:"",email:"",language:"en"},authored_example:false,comments:[]};}
let response=fresh(),pendingEditor=null;
function bound(value){return value&&value.schema==="standards-consultation-response/v1"&&value.packet_id===packet.packet_id&&value.packet_sha256===envelope.packet_sha256&&value.edition_id===packet.edition.id&&value.source_edition_sha256===packet.source_edition_sha256&&value.projection_sha256===packet.projection_sha256;}
function opened(value){
 const isDraft=value?.schema==="standards-consultation-draft/v1",data=isDraft?value.response:value;
 if(!bound(data)||!Array.isArray(data.comments)||data.comments.length>500||!data.reviewer||typeof data.response_id!=="string")throw Error(t("draftMissing"));
 const ids=new Set(),known=new Set(edition.clauses.map(c=>c.id));
 for(const key of ["name","organization","email"])if(data.reviewer[key]!==undefined&&typeof data.reviewer[key]!=="string")throw Error(t("invalidFile"));
 if(!["en","fr","bilingual"].includes(data.reviewer.language||"en"))throw Error(t("invalidFile"));
 for(const c of data.comments){
  if(!c||typeof c.id!=="string"||ids.has(c.id))throw Error(t("duplicate"));
  ids.add(c.id);
  if(typeof c.clause_id!=="string"||(c.clause_id&&!known.has(c.clause_id)))throw Error(t("draftMissing"));
  if(!["technical","editorial","public"].includes(c.kind)||!["en","fr","bilingual"].includes(c.language))throw Error(t("invalidFile"));
  for(const f of ["body","proposed_text_en","proposed_text_fr"])if(c[f]!==undefined&&(typeof c[f]!=="string"||c[f].length>120000))throw Error(t("invalidFile"));
  if(typeof c.body!=="string")throw Error(t("invalidFile"));
 }
 const editor=isDraft?value.editor||null:null;
 if(editor){
  if(typeof editor.id!=="string"||typeof editor.clause_id!=="string"||(editor.clause_id&&!known.has(editor.clause_id)))throw Error(t("invalidFile"));
  if(!["technical","editorial","public"].includes(editor.kind)||!["en","fr","bilingual"].includes(editor.language))throw Error(t("invalidFile"));
  for(const f of ["body","proposed_text_en","proposed_text_fr"])if(typeof editor[f]!=="string"||editor[f].length>120000)throw Error(t("invalidFile"));
 }
 response=clone(data);delete response.exported_at;
 response.reviewer={name:"",organization:"",email:"",language:"en",...response.reviewer};
 pendingEditor=editor?clone(editor):null;lastExport=null;
 language=value?.language||response.reviewer.language||"en";if(!["en","fr","bilingual"].includes(language))language="en";
 view=value?.view||"comments";if(!["instructions","document","cases","comments","return"].includes(view))view="comments";
 if(value?.clause_id&&known.has(value.clause_id))clauseId=value.clause_id;
 if(isDraft){readClauseIds=new Set((Array.isArray(value.read_clause_ids)?value.read_clause_ids:[]).filter(id=>known.has(id)));outlineFilter=["all","unread","commented"].includes(value.outline_filter)?value.outline_filter:"all";}
 commentFilter="";commentPage=0;
}
try{const saved=localStorage.getItem(key);if(saved)opened(JSON.parse(saved));}catch{storage=false;}
function error(message){$("#error").textContent=message;$("#error").hidden=false;setTimeout(()=>$("#error").hidden=true,12000);}
function readReviewer(){
 const form=$("#reviewer-fields");if(!form)return;
 for(const k of ["name","organization","email"])response.reviewer[k]=form.querySelector('[name="'+k+'"]').value;
 response.reviewer.language=form.querySelector('[name="reviewer_language"]').value;
 response.authored_example=form.querySelector('[name="authored_example"]').checked;
}
function editorValue(){
 if(!$("#comment-dialog").open)return pendingEditor;
 return{id:editing||uid("comment"),clause_id:$("#comment-fields [name=clause_id]").value,kind:$("#comment-fields [name=kind]").value,language:$("#comment-fields [name=comment_language]").value,body:$("#comment-fields [name=body]").value,proposed_text_en:$("#comment-fields [name=proposed_text_en]").value,proposed_text_fr:$("#comment-fields [name=proposed_text_fr]").value};
}
function draftValue(){
 readReviewer();
 return{schema:"standards-consultation-draft/v1",packet_sha256:envelope.packet_sha256,response:clone(response),editor:editorValue(),language,view,clause_id:clauseId,read_clause_ids:[...readClauseIds],outline_filter:outlineFilter};
}
function persist(modified=true){
 changed=changed||modified;
 try{localStorage.setItem(key,JSON.stringify(draftValue()));storage=true;}catch{storage=false;}
 $("#saved").textContent=t(storage?"local":"nostorage");
}
function downloadFile(name,content,type){
 const blob=new Blob([content],{type}),url=URL.createObjectURL(blob),a=document.createElement("a");
 a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function download(name,value){downloadFile(name,JSON.stringify(value,null,2)+"\n","application/json;charset=utf-8");}
function languagePart(item,base){
 if(language==="fr")return item[base+"_fr"]||"";
 return item[base+"_en"]||item[base]||"";
}
function table(rows){if(!rows?.length)return"";return'<div class="table-wrap"><table><tbody>'+rows.map((row,i)=>"<tr>"+row.map(cell=>"<"+(i?"td":"th")+">"+esc(cell)+"</"+(i?"td":"th")+">").join("")+"</tr>").join("")+"</tbody></table></div>";}
function safeLink(url,title){try{const parsed=new URL(url);if(["https:","http:"].includes(parsed.protocol))return'<a href="'+esc(parsed.href)+'" target="_blank" rel="noopener noreferrer">'+esc(title||url)+"</a>";}catch{}return esc(title||url);}
function sourceRefs(ids){
 return(ids||[]).map(id=>edition.sources.find(s=>s.id===id)).filter(Boolean).map(s=>'<section class="source-row"><strong>'+safeLink(s.url,s.title)+'</strong><p>'+esc(sourceMetadata(s))+'</p>'+(s.sha256?'<details><summary>'+esc(t("sourceDetails"))+'</summary><code>'+esc(s.sha256)+"</code></details>":"")+"</section>").join("");
}
function paired(c){
 const segment=lang=>'<section lang="'+lang+'"><p class="meta">'+(lang==="fr"?"Français":"English")+'</p><h2>'+esc(c["title_"+lang]||t("noFrench"))+'</h2><div class="prose">'+esc(c["body_"+lang]||(lang==="fr"?t("noFrench"):""))+"</div>"+table(c["table_"+lang])+"</section>";
 return language==="bilingual"?'<div class="pair">'+segment("en")+segment("fr")+"</div>":'<div class="single">'+segment(language==="fr"?"fr":"en")+"</div>";
}
function renderOutline(){
 const q=$("#search").value.trim().toLocaleLowerCase();
 const visible=edition.clauses.filter(c=>{
  const searchMatch=[c.number,c.title_en,c.title_fr,c.body_en,c.body_fr].join(" ").toLocaleLowerCase().includes(q);
  return searchMatch&&(outlineFilter==="all"||outlineFilter==="unread"&&!readClauseIds.has(c.id)||outlineFilter==="commented"&&response.comments.some(r=>r.clause_id===c.id));
 });
 $("#outline").innerHTML=visible.length?visible.map(c=>{
  const comments=response.comments.filter(r=>r.clause_id===c.id).length;
  return'<button type="button" data-clause="'+esc(c.id)+'" class="'+(clauseId===c.id&&view==="document"?"selected":"")+'" '+(clauseId===c.id&&view==="document"?'aria-current="location"':"")+'><span>'+esc(clauseTitle(c))+'</span><small>'+esc(readClauseIds.has(c.id)?t("read"):t("unread"))+(comments?" · "+comments+" "+esc(t(comments===1?"commentOne":"commentMany")):"")+"</small></button>";
 }).join(""):'<p class="empty-index">'+esc(t("noMatches"))+"</p>";
}
function render(){
 document.documentElement.lang=language==="fr"?"fr":"en";
 $("#language").value=language;$("#language-label").textContent=t("languageLabel");$("#packet-title").textContent=packet.title;$("#edition-label").textContent=packet.edition.label;
 $("#packet-dates").textContent=consultationWindow();$("#reading-progress").textContent=progressText();
 $("#clause-browser-label").textContent=t("outline");$("#search-label").textContent=t("search");
 $("#clause-filter-label").textContent=t("filter");$("#clause-filter").innerHTML=options(["all","unread","commented"],outlineFilter,{all:t("allClauses"),unread:t("unreadClauses"),commented:t("commentedClauses")});
 $("#navigation").setAttribute("aria-label",t("navLabel"));
 $("#navigation").innerHTML=["instructions","document","cases","comments","return"].map((v,i)=>'<button type="button" data-view="'+v+'" class="'+(v===view?"selected":"")+'" '+(v===view?'aria-current="page"':"")+'><span class="step-number">'+(i+1)+'</span><span>'+esc(t(v))+"</span></button>").join("");
 $("#save-draft").textContent=t("saveDraftLabel");$("#load-draft").textContent=t("openDraftLabel");$("#preview-response").textContent=t("preview");$("#export-response").textContent=t("exportLabel");$("#skip-content").textContent=t("skip");
 renderOutline();
 if(view==="instructions")renderInstructions();else if(view==="document")renderDocument();else if(view==="cases")renderCases();else if(view==="return")renderReturn();else renderComments();
 $("#saved").textContent=t(storage?"local":"nostorage");
}
function renderInstructions(){
 const instruction=language==="fr"?packet.instructions_fr:packet.instructions_en;
 const next=edition.clauses.find(c=>!readClauseIds.has(c.id))||edition.clauses[0];
 let body='<section class="card review-introduction"><p class="eyebrow">'+esc(packet.edition.label)+'</p><h1>'+esc(t("instructionsTitle"))+'</h1><p class="lead">'+esc(t("overview"))+'</p><div class="prose">'+esc(instruction)+"</div>";
 if(language==="bilingual")body+='<div lang="fr" class="prose">'+esc(packet.instructions_fr)+"</div>";
 body+='<div class="review-steps">'+["Read","Comment","Return"].map((key,i)=>'<section><span class="step-number">'+(i+1)+'</span><h2>'+esc(t("step"+key))+'</h2><p>'+esc(t("step"+key+"Body"))+"</p></section>").join("")+'</div><div class="toolbar">'+(next?action("start",t(readClauseIds.size?"resume":"start"),'data-clause-target="'+esc(next.id)+'"',true):"")+action("comments",t("comments"))+'</div><p class="meta">'+esc(progressText())+" · "+esc(t("privateProgress"))+"</p></section>"+pendingNotice();
 body+='<section class="card" id="reviewer-fields"><h2>'+esc(t("statement"))+'</h2><p>'+esc(t("declaration"))+'</p><div class="form-grid">'+["name","organization","email"].map(k=>'<label>'+esc(t(k))+' <small>('+esc(t("optional"))+')</small><input name="'+k+'" maxlength="'+(k==="organization"?"1000":"500")+'" autocomplete="'+(k==="name"?"name":k==="organization"?"organization":"email")+'" value="'+esc(response.reviewer[k])+'"></label>').join("")+'<label>'+esc(t("lang"))+'<select name="reviewer_language">'+options(["en","fr","bilingual"],response.reviewer.language,{en:"English",fr:"Français",bilingual:"English + français"})+'</select></label></div><label class="checkbox"><input type="checkbox" name="authored_example" '+(response.authored_example?"checked":"")+">"+esc(t("example"))+"</label></section>";
 body+='<section class="card"><h2>'+esc(t("returnRoute"))+'</h2>'+returnInstructions()+'<details class="packet-details"><summary>'+esc(t("details"))+'</summary><dl><dt>'+esc(t("preparedLabel"))+'</dt><dd>'+esc(humanDate(packet.prepared_at))+'</dd><dt>'+esc(t("period"))+'</dt><dd>'+esc(consultationWindow())+'</dd><dt>'+esc(t("procedure"))+'</dt><dd>'+esc([packet.procedure.title,packet.procedure.edition].filter(Boolean).join(" · "))+'</dd></dl><p class="prose">'+esc(packet.procedure.public_review_requirement||"")+'</p>'+(packet.procedure.public_review_days!==null&&packet.procedure.public_review_days!==undefined?'<p>'+esc(packet.procedure.public_review_days)+" "+(language==="fr"?"jours":"days")+"</p>":"")+'<p><code>'+esc(envelope.packet_sha256)+'</code></p><p><code>'+esc(packet.source_edition_sha256)+"</code></p></details></section>";
 $("#main").innerHTML=body;
}
function renderDocument(){
 const c=edition.clauses.find(c=>c.id===clauseId)||edition.clauses[0];if(!c){$("#main").textContent=t("none");return;}
 clauseId=c.id;
 const index=edition.clauses.indexOf(c),previous=edition.clauses[index-1],next=edition.clauses[index+1],unread=edition.clauses.find(x=>!readClauseIds.has(x.id)&&x.id!==c.id);
 let body=pendingNotice()+'<article class="card"><div class="toolbar"><p class="meta">'+esc(t("readPosition"))+" "+(index+1)+" "+esc(t("of"))+" "+edition.clauses.length+' · '+esc(kindName(c.kind))+'</p><button type="button" class="primary" data-add-comment="'+esc(c.id)+'">'+esc(t("add"))+"</button></div>"+paired(c);
 if(c.case_ids?.length)body+='<section class="clause-cases"><h3>'+esc(t("cases"))+'</h3><div class="toolbar">'+c.case_ids.map(id=>{const item=edition.cases.find(r=>r.id===id);return item?'<button type="button" data-case="'+esc(id)+'">'+esc(language==="fr"?item.title_fr||item.title:item.title)+"</button>":"";}).join("")+"</div></section>";
 body+='<details><summary>'+esc(t("references"))+"</summary>"+sourceRefs(c.source_ids)+"</details>";
 body+='<div class="reading-actions">'+action("mark-read",readClauseIds.has(c.id)?t("markUnread"):t("markRead"),'aria-pressed="'+readClauseIds.has(c.id)+'"')+'<p class="meta">'+esc(progressText())+'</p></div><nav class="clause-navigation" aria-label="'+esc(t("outline"))+'">'+(previous?'<button type="button" data-clause="'+esc(previous.id)+'">'+esc(t("previous"))+"</button>":"<span></span>")+(next?'<button type="button" data-clause="'+esc(next.id)+'">'+esc(t("next"))+"</button>":action("return",t("preview"),"",true))+"</nav></article>";
 if(!next&&unread)body+='<p>'+action("start",t("nextUnread"),'data-clause-target="'+esc(unread.id)+'"')+"</p>";
 $("#main").innerHTML=body;
}
function caseCard(c){
 const title=language==="fr"?c.title_fr||c.title:c.title,questions=language==="fr"?c.review_questions_fr:c.review_questions,observations=language==="fr"?c.expected_observations_fr:c.expected_observations;
 const lists=(heading,items)=>items?.length?'<h3>'+esc(heading)+'</h3><ul class="question-list">'+items.map(q=>"<li>"+esc(q)+"</li>").join("")+"</ul>":"";
 let body='<article class="card" id="case-'+esc(c.id)+'"><h2>'+esc(title)+"</h2>"+lists(t("reviewQuestions"),questions)+lists(t("observations"),observations);
 if(language==="bilingual")body+='<section lang="fr"><h3>'+esc(c.title_fr||texts.fr.noFrench)+"</h3>"+lists(texts.fr.reviewQuestions,c.review_questions_fr)+lists(texts.fr.observations,c.expected_observations_fr)+"</section>";
 const links=edition.clauses.filter(clause=>clause.case_ids?.includes(c.id));
 if(links.length)body+='<div class="toolbar">'+links.map(clause=>'<button type="button" data-clause="'+esc(clause.id)+'">'+esc(clauseTitle(clause))+"</button>").join("")+"</div>";
 body+='<details><summary>'+esc(t("data"))+"</summary>"+(c.source_rows||[]).filter(row=>language==="bilingual"||!row.language||row.language===language).map(originalRow).join("")+"</details><details><summary>"+esc(t("references"))+"</summary>"+sourceRefs(c.source_ids)+"</details></article>";
 return body;
}
function renderCases(){
 $("#main").innerHTML='<header class="content-heading"><h1>'+esc(t("cases"))+'</h1><p>'+edition.cases.length+" "+esc(t("cases").toLocaleLowerCase())+'</p></header>'+edition.cases.map(caseCard).join("")||'<div class="empty">'+esc(t("none"))+"</div>";
}
function renderCommentResults(){
 const q=commentFilter.toLocaleLowerCase(),matches=response.comments.map((c,index)=>({c,index})).filter(({c})=>[c.body,c.proposed_text_en,c.proposed_text_fr,clauseTitle(edition.clauses.find(x=>x.id===c.clause_id))].join(" ").toLocaleLowerCase().includes(q));
 const pages=Math.max(1,Math.ceil(matches.length/25));commentPage=Math.min(commentPage,pages-1);
 const holder=$("#comment-results");if(!holder)return;
 holder.innerHTML=matches.length?'<p class="meta">'+matches.length+" "+esc(t("matching"))+'</p><div class="comment-list">'+matches.slice(commentPage*25,commentPage*25+25).map(({c,index})=>responseComment(c,index)).join("")+"</div>"+(pages>1?'<nav class="comment-pagination">'+action("previous-comments",t("previousPage"),commentPage?"":"disabled")+'<span>'+esc(t("page"))+" "+(commentPage+1)+" "+esc(t("of"))+" "+pages+"</span>"+action("next-comments",t("nextPage"),commentPage+1<pages?"":"disabled")+"</nav>":""):'<div class="empty">'+esc(t("nothingFound"))+"</div>";
}
function renderComments(){
 let body='<div class="toolbar content-heading"><h1>'+esc(t("comments"))+' ('+response.comments.length+')</h1><button type="button" class="primary" data-add-comment="">'+esc(t("add"))+"</button></div>"+pendingNotice();
 if(response.comments.length)body+='<div class="comment-search"><label for="comment-search">'+esc(t("findComments"))+'</label><input type="search" id="comment-search" value="'+esc(commentFilter)+'"></div><div id="comment-results"></div><div class="toolbar">'+action("return",t("preview"),"",true)+"</div>";
 else body+='<div class="empty">'+esc(t("emptyComments"))+"</div>";
 $("#main").innerHTML=body;
 renderCommentResults();
}
function options(values,selected,labels={}){return values.map(v=>'<option value="'+esc(v)+'" '+(v===selected?"selected":"")+">"+esc(labels[v]||v)+"</option>").join("");}
function editComment(id=null,target=""){
 const c=response.comments.find(x=>x.id===id)||pendingEditor||{id:uid("comment"),clause_id:target,kind:"technical",language:language==="fr"?"fr":language,body:"",proposed_text_en:"",proposed_text_fr:""};
 editing=c.id;pendingEditor=null;
 $("#comment-heading").textContent=t(id?"edit":"add");$("#save-comment").textContent=t("save");$("#delete-comment").textContent=t("remove");$("#delete-comment").hidden=!response.comments.some(x=>x.id===editing);$("#comment-error").textContent="";
 const clauseOptions='<option value="">'+esc(t("general"))+"</option>"+edition.clauses.map(x=>'<option value="'+esc(x.id)+'" '+(x.id===c.clause_id?"selected":"")+">"+esc(x.number+" · "+(language==="fr"?x.title_fr||x.title_en:x.title_en))+"</option>").join("");
 $("#comment-fields").innerHTML='<label>'+esc(t("clause"))+'<select name="clause_id">'+clauseOptions+'</select></label><div class="form-grid"><label>'+esc(t("kind"))+'<select name="kind">'+options(["technical","editorial","public"],c.kind,{technical:t("technical"),editorial:t("editorial"),public:t("public")})+'</select></label><label>'+esc(t("lang"))+'<select name="comment_language">'+options(["en","fr","bilingual"],c.language,{en:"English",fr:"Français",bilingual:"English + français"})+"</select></label></div>"+["body","proposed_text_en","proposed_text_fr"].map(k=>'<label>'+esc(t(k==="body"?"body":k==="proposed_text_en"?"proposedEn":"proposedFr"))+(k==="body"?"":" <small>("+esc(t("optional"))+")</small>")+'<textarea name="'+k+'" rows="'+(k==="body"?5:4)+'" maxlength="120000" '+(k==="body"?"required":"")+'>'+esc(c[k]||"")+"</textarea></label>").join("");
 $("#comment-dialog").showModal();$("#comment-fields [name=body]").focus();
}
function commitComment(){
 const value=editorValue();if(!value)return;
 if(!value.body.trim())throw Error(t("bodyNeeded"));
 const index=response.comments.findIndex(c=>c.id===value.id);
 if(index>=0)response.comments[index]=value;else {if(response.comments.length>=500)throw Error("500 comments maximum / 500 commentaires au maximum.");response.comments.push(value);}
 pendingEditor=null;lastExport=null;$("#comment-dialog").close();editing=null;persist();render();
}
$("#comment-form").addEventListener("submit",e=>{e.preventDefault();try{commitComment();}catch(x){$("#comment-error").textContent=x.message;}});
$("#close-comment").addEventListener("click",()=>{pendingEditor=editorValue();$("#comment-dialog").close();persist();});
$("#comment-dialog").addEventListener("cancel",()=>{pendingEditor=editorValue();setTimeout(persist,0);});
$("#delete-comment").addEventListener("click",()=>{if(confirm(t("confirmRemove"))){response.comments=response.comments.filter(c=>c.id!==editing);pendingEditor=null;lastExport=null;$("#comment-dialog").close();persist();render();}});
document.addEventListener("click",e=>{
 const v=e.target.closest("[data-view]");if(v){goView(v.dataset.view);return;}
 const c=e.target.closest("[data-clause]");if(c){goClause(c.dataset.clause);return;}
 const a=e.target.closest("[data-add-comment]");if(a){editComment(null,a.dataset.addComment);return;}
 const edit=e.target.closest("[data-edit-comment]");if(edit){pendingEditor=null;editComment(edit.dataset.editComment);return;}
 const ca=e.target.closest("[data-case]");if(ca){goView("cases",false);document.getElementById("case-"+ca.dataset.case)?.scrollIntoView({block:"start"});return;}
 const action=e.target.closest("[data-reviewer-action]");if(!action)return;
 const name=action.dataset.reviewerAction;
 if(name==="start")goClause(action.dataset.clauseTarget);
 else if(name==="return"||name==="comments")goView(name);
 else if(name==="reviewer"){goView("instructions");$("#reviewer-fields").scrollIntoView({block:"start"});$("#reviewer-fields input").focus({preventScroll:true});}
 else if(name==="mark-read"){if(readClauseIds.has(clauseId))readClauseIds.delete(clauseId);else readClauseIds.add(clauseId);persist(false);render();}
 else if(name==="resume-comment")editComment();
 else if(name==="discard-comment"){if(confirm(t("confirmDiscard"))){pendingEditor=null;persist();render();}}
 else if(name==="export")exportResponse();
 else if(name==="summary")saveReadableCopy();
 else if(name==="previous-comments"||name==="next-comments"){commentPage+=name==="previous-comments"?-1:1;renderCommentResults();$("#comment-results").scrollIntoView({block:"start"});}
});
document.addEventListener("input",e=>{
 if(e.target.closest("#reviewer-fields")||e.target.closest("#comment-fields")){lastExport=null;persist();}
 if(e.target.id==="comment-search"){commentFilter=e.target.value;commentPage=0;renderCommentResults();}
});
document.addEventListener("change",e=>{if(e.target.closest("#reviewer-fields")||e.target.closest("#comment-fields")){lastExport=null;persist();}});
$("#search").addEventListener("input",renderOutline);
$("#clause-filter").addEventListener("change",e=>{outlineFilter=e.target.value;persist(false);renderOutline();});
$("#language").addEventListener("change",e=>{readReviewer();language=e.target.value;persist(false);render();});
$("#save-draft").addEventListener("click",()=>{download("consultation-draft-"+response.response_id+".json",draftValue());changed=false;$("#saved").textContent=t("savedFile");});
$("#load-draft").addEventListener("click",()=>$("#open-file").click());
$("#preview-response").addEventListener("click",()=>goView("return"));
$("#open-file").addEventListener("change",async e=>{
 const file=e.target.files[0];if(!file)return;
 try{
  if(file.size>8*1024*1024)throw Error(t("fileLimit"));
  const value=JSON.parse(await file.text());if(changed&&!confirm(t("overwrite")))return;
  opened(value);changed=false;persist(false);render();if(pendingEditor)editComment();$("#saved").textContent=t("opened");
 }catch(x){error(x.message);}finally{e.target.value="";}
});
$("#export-response").addEventListener("click",exportResponse);
window.addEventListener("beforeunload",e=>{if(changed){e.preventDefault();e.returnValue="";}});
if(window.matchMedia("(max-width: 650px)").matches)$("#clause-browser").open=false;
if(typeof ResizeObserver==="function")new ResizeObserver(entries=>{document.documentElement.style.setProperty("--footer-height",(Math.ceil(entries[0].target.getBoundingClientRect().height)+24)+"px");}).observe($(".footer"));
render();if(pendingEditor)editComment();
})();
