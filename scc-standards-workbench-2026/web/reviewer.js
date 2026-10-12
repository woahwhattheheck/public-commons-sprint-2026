(() => {
"use strict";
const $=s=>document.querySelector(s),all=s=>[...document.querySelectorAll(s)];
const envelope=JSON.parse($("#review-data").textContent),packet=envelope.packet,edition=packet.edition.snapshot;
const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const clone=v=>JSON.parse(JSON.stringify(v)),uid=prefix=>prefix+"-"+(crypto.randomUUID?crypto.randomUUID():Array.from(crypto.getRandomValues(new Uint8Array(16)),v=>v.toString(16).padStart(2,"0")).join(""));
const key="standards-review-draft:"+envelope.packet_sha256;
let language="en",view="instructions",clauseId=edition.clauses[0]?.id||"",editing=null,changed=false,storage=true;
const texts={
 en:{document:"Read clauses",cases:"Worked cases",comments:"My comments",instructions:"Instructions & reviewer",search:"Find a clause",general:"Whole document",add:"Add a comment",edit:"Edit comment",remove:"Remove comment",save:"Save comment",clause:"Clause",kind:"Comment type",lang:"Comment language",body:"Comment",proposedEn:"Proposed English wording",proposedFr:"Proposed French wording",optional:"Optional",technical:"Technical",editorial:"Editorial",public:"General review",name:"Name",organization:"Organization",email:"Return contact",declaration:"These details are supplied by the reviewer.",example:"This is an authored practice response.",local:"Draft kept in this browser. Export a draft file to carry it elsewhere.",nostorage:"Browser storage is unavailable. Save a draft file before closing.",exported:"Response file exported. Return it through the route in the instructions.",opened:"The saved draft is open for this exact packet.",instructionsTitle:"Review this edition",notSent:"This page works offline. Export the response JSON and return it through the recorded route.",noRoute:"No return route was supplied in this packet.",emptyComments:"No comments yet. Choose a clause or add a comment about the whole document.",references:"Public source references",reviewQuestions:"Review questions",observations:"Authored expected observations",data:"Original source rows",noFrench:"French text is not supplied for this item.",none:"Not set",source:"Source",statement:"Reviewer details",packet:"Frozen packet",period:"Recorded consultation window",procedure:"Selected procedure",prepared:"Prepared",count:"comments",returnRoute:"Return your response",draftMissing:"This file does not belong to the exact packet open here.",bodyNeeded:"Write the comment before saving.",exportEmpty:"Add at least one complete comment before exporting a response.",savedFile:"Draft file saved.",confirmRemove:"Remove this comment from your working response?",duplicate:"The opened response repeats a comment identity.",overwrite:"Opening this file will replace the current working response. Save your current draft file first if you need it."},
 fr:{document:"Lire les clauses",cases:"Cas documentés",comments:"Mes commentaires",instructions:"Instructions et personne répondante",search:"Rechercher une clause",general:"Document entier",add:"Ajouter un commentaire",edit:"Modifier le commentaire",remove:"Supprimer le commentaire",save:"Enregistrer le commentaire",clause:"Clause",kind:"Type de commentaire",lang:"Langue du commentaire",body:"Commentaire",proposedEn:"Texte anglais proposé",proposedFr:"Texte français proposé",optional:"Facultatif",technical:"Technique",editorial:"Rédactionnel",public:"Observation générale",name:"Nom",organization:"Organisation",email:"Coordonnées de retour",declaration:"Ces renseignements sont déclarés par la personne répondante.",example:"Il s'agit d'une réponse d'exercice rédigée pour la démonstration.",local:"Brouillon conservé dans ce navigateur. Exportez un fichier pour le déplacer.",nostorage:"Le stockage du navigateur est indisponible. Enregistrez un fichier avant de fermer.",exported:"Fichier de réponse exporté. Transmettez-le selon les instructions.",opened:"Le brouillon enregistré est ouvert pour ce dossier exact.",instructionsTitle:"Examiner cette édition",notSent:"Cette page fonctionne hors ligne. Exportez la réponse JSON et transmettez-la par le mode indiqué.",noRoute:"Aucun mode de retour n'a été indiqué dans ce dossier.",emptyComments:"Aucun commentaire. Choisissez une clause ou commentez le document entier.",references:"Références publiques",reviewQuestions:"Questions d'examen",observations:"Observations attendues rédigées pour le cas",data:"Lignes des sources originales",noFrench:"Aucun texte français n'est fourni pour cet élément.",none:"Non indiqué",source:"Source",statement:"Renseignements sur la personne répondante",packet:"Dossier figé",period:"Période de consultation indiquée",procedure:"Procédure sélectionnée",prepared:"Préparé",count:"commentaires",returnRoute:"Transmettre votre réponse",draftMissing:"Ce fichier ne correspond pas au dossier exact ouvert ici.",bodyNeeded:"Rédigez le commentaire avant de l'enregistrer.",exportEmpty:"Ajoutez au moins un commentaire complet avant d'exporter une réponse.",savedFile:"Fichier de brouillon enregistré.",confirmRemove:"Supprimer ce commentaire de votre réponse de travail?",duplicate:"La réponse ouverte contient un identifiant de commentaire en double.",overwrite:"L'ouverture remplacera la réponse de travail actuelle. Enregistrez d'abord un fichier de brouillon si vous souhaitez la conserver."}
};
const t=k=>(texts[language==="fr"?"fr":"en"][k]||k);
function fresh(){return{schema:"standards-consultation-response/v1",packet_id:packet.packet_id,packet_sha256:envelope.packet_sha256,edition_id:packet.edition.id,source_edition_sha256:packet.source_edition_sha256,projection_sha256:packet.projection_sha256,response_id:uid("response"),prepared_at:new Date().toISOString(),reviewer:{name:"",organization:"",email:"",language:"en"},authored_example:false,comments:[]};}
let response=fresh(),pendingEditor=null;
function bound(value){return value&&value.schema==="standards-consultation-response/v1"&&value.packet_id===packet.packet_id&&value.packet_sha256===envelope.packet_sha256&&value.edition_id===packet.edition.id&&value.source_edition_sha256===packet.source_edition_sha256&&value.projection_sha256===packet.projection_sha256;}
function opened(value){
 const data=value?.schema==="standards-consultation-draft/v1"?value.response:value;
 if(!bound(data)||!Array.isArray(data.comments)||data.comments.length>500||!data.reviewer||typeof data.response_id!=="string")throw Error(t("draftMissing"));
 const ids=new Set(),known=new Set(edition.clauses.map(c=>c.id));
 for(const c of data.comments){if(!c||typeof c.id!=="string"||ids.has(c.id))throw Error(t("duplicate"));ids.add(c.id);if(c.clause_id&&!known.has(c.clause_id))throw Error(t("draftMissing"));for(const f of ["body","proposed_text_en","proposed_text_fr"]){if(c[f]!==undefined&&typeof c[f]!=="string")throw Error(t("draftMissing"));}}
 response=clone(data);delete response.exported_at;
 pendingEditor=value?.schema==="standards-consultation-draft/v1"?value.editor||null:null;
 language=value?.language||response.reviewer.language||"en";if(!["en","fr","bilingual"].includes(language))language="en";
 view=value?.view||"comments";if(!["instructions","document","cases","comments"].includes(view))view="comments";
 if(value?.clause_id&&known.has(value.clause_id))clauseId=value.clause_id;
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
function draftValue(){readReviewer();return{schema:"standards-consultation-draft/v1",packet_sha256:envelope.packet_sha256,response:clone(response),editor:editorValue(),language,view,clause_id:clauseId};}
function persist(){changed=true;try{localStorage.setItem(key,JSON.stringify(draftValue()));storage=true;}catch{storage=false;}$("#saved").textContent=t(storage?"local":"nostorage");}
function download(name,value){const blob=new Blob([JSON.stringify(value,null,2)+"\n"],{type:"application/json;charset=utf-8"}),url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function languagePart(item,base){
 if(language==="fr")return item[base+"_fr"]||"";
 return item[base+"_en"]||item[base]||"";
}
function table(rows){if(!rows?.length)return"";return'<div class="table-wrap"><table><tbody>'+rows.map((row,i)=>"<tr>"+row.map(cell=>"<"+(i?"td":"th")+">"+esc(cell)+"</"+(i?"td":"th")+">").join("")+"</tr>").join("")+"</tbody></table></div>";}
function safeLink(url,title){try{const parsed=new URL(url);if(["https:","http:"].includes(parsed.protocol))return'<a href="'+esc(parsed.href)+'" target="_blank" rel="noopener noreferrer">'+esc(title||url)+"</a>";}catch{}return esc(title||url);}
function sourceRefs(ids){return(ids||[]).map(id=>edition.sources.find(s=>s.id===id)).filter(Boolean).map(s=>'<p class="source-row"><strong>'+safeLink(s.url,s.title)+'</strong><br>'+esc([s.publisher,s.version,s.language].filter(Boolean).join(" · "))+(s.sha256?"<br><code>"+esc(s.sha256)+"</code>":"")+"</p>").join("");}
function paired(c){
 const segment=lang=>'<section lang="'+lang+'"><p class="meta">'+(lang==="fr"?"Français":"English")+'</p><h2>'+esc(c["title_"+lang]||t("noFrench"))+'</h2><div class="prose">'+esc(c["body_"+lang]||(lang==="fr"?t("noFrench"):""))+"</div>"+table(c["table_"+lang])+"</section>";
 return language==="bilingual"?'<div class="pair">'+segment("en")+segment("fr")+"</div>":'<div class="single">'+segment(language==="fr"?"fr":"en")+"</div>";
}
function renderOutline(){
 const q=$("#search").value.toLocaleLowerCase();
 $("#outline").innerHTML=edition.clauses.filter(c=>[c.number,c.title_en,c.title_fr].join(" ").toLocaleLowerCase().includes(q)).map(c=>'<button data-clause="'+esc(c.id)+'" class="'+(clauseId===c.id&&view==="document"?"selected":"")+'">'+esc(c.number)+" · "+esc(language==="fr"?c.title_fr||c.title_en:c.title_en)+'<small>'+response.comments.filter(r=>r.clause_id===c.id).length+" "+esc(t("count"))+"</small></button>").join("");
}
function render(){
 document.documentElement.lang=language==="fr"?"fr":"en";
 $("#language").value=language;$("#packet-title").textContent=packet.title;$("#edition-label").textContent=packet.edition.label;
 $("#packet-dates").textContent=(packet.consultation.opens||t("none"))+" — "+(packet.consultation.closes||t("none"));
 $("#search-label").textContent=t("search");
 $("#navigation").innerHTML=["instructions","document","cases","comments"].map(v=>'<button data-view="'+v+'" class="'+(v===view?"selected":"")+'">'+esc(t(v))+"</button>").join("");
 renderOutline();
 if(view==="instructions")renderInstructions();else if(view==="document")renderDocument();else if(view==="cases")renderCases();else renderComments();
 $("#saved").textContent=t(storage?"local":"nostorage");
}
function renderInstructions(){
 const instruction=language==="fr"?packet.instructions_fr:packet.instructions_en,route=language==="fr"?packet.reply_route_fr:packet.reply_route_en;
 let body='<section class="card"><h2>'+esc(t("instructionsTitle"))+'</h2><p>'+esc(t("notSent"))+'</p><div class="prose">'+esc(instruction)+"</div>";
 if(language==="bilingual")body+='<div lang="fr" class="prose">'+esc(packet.instructions_fr)+"</div>";
 body+='<h3>'+esc(t("returnRoute"))+'</h3><div class="prose">'+esc(route||t("noRoute"))+"</div>"+(language==="bilingual"?'<div lang="fr" class="prose">'+esc(packet.reply_route_fr||texts.fr.noRoute)+"</div>":"");
 body+='<details><summary>'+esc(t("packet"))+'</summary><p>'+esc(t("prepared"))+": "+esc(packet.prepared_at)+'</p><p>'+esc(t("procedure"))+": "+esc(packet.procedure.title)+" · "+esc(packet.procedure.edition)+"</p><p>"+esc(packet.procedure.public_review_requirement)+" · "+esc(packet.procedure.public_review_days??t("none"))+' days / jours</p><p><code>'+esc(envelope.packet_sha256)+"</code></p><p><code>"+esc(packet.source_edition_sha256)+"</code></p></details></section>";
 body+='<section class="card" id="reviewer-fields"><h2>'+esc(t("statement"))+'</h2><p>'+esc(t("declaration"))+'</p><div class="form-grid">'+["name","organization","email"].map(k=>'<label>'+esc(t(k))+' <small>('+esc(t("optional"))+')</small><input name="'+k+'" maxlength="'+(k==="organization"?"1000":"500")+'" value="'+esc(response.reviewer[k])+'"></label>').join("")+'<label>'+esc(t("lang"))+'<select name="reviewer_language">'+options(["en","fr","bilingual"],response.reviewer.language,{en:"English",fr:"Français",bilingual:"English + français"})+'</select></label></div><label class="checkbox"><input type="checkbox" name="authored_example" '+(response.authored_example?"checked":"")+">"+esc(t("example"))+"</label></section>";
 $("#main").innerHTML=body;
}
function renderDocument(){
 const c=edition.clauses.find(c=>c.id===clauseId)||edition.clauses[0];if(!c){$("#main").textContent=t("none");return;}
 clauseId=c.id;
 $("#main").innerHTML='<article class="card"><div class="toolbar"><span class="badge">'+esc(c.number)+" · "+esc(c.kind)+'</span><button class="primary" data-add-comment="'+esc(c.id)+'">'+esc(t("add"))+"</button></div>"+paired(c)+'<details><summary>'+esc(t("references"))+"</summary>"+sourceRefs(c.source_ids)+"</details>"+(c.case_ids?.length?'<p>'+c.case_ids.map(id=>'<button data-case="'+esc(id)+'">'+esc((edition.cases.find(r=>r.id===id)||{}).title||id)+"</button>").join(" ")+"</p>":"")+"</article>";
}
function caseCard(c){
 const title=language==="fr"?c.title_fr||c.title:c.title,questions=language==="fr"?c.review_questions_fr:c.review_questions,observations=language==="fr"?c.expected_observations_fr:c.expected_observations;
 let body='<article class="card" id="case-'+esc(c.id)+'"><h2>'+esc(title)+"</h2>";
 const lists=(heading,items)=>'<h3>'+esc(heading)+'</h3><ul class="question-list">'+(items||[]).map(q=>"<li>"+esc(q)+"</li>").join("")+"</ul>";
 body+=lists(t("reviewQuestions"),questions)+lists(t("observations"),observations);
 if(language==="bilingual")body+='<section lang="fr"><h3>'+esc(c.title_fr||texts.fr.noFrench)+"</h3>"+lists(texts.fr.reviewQuestions,c.review_questions_fr)+lists(texts.fr.observations,c.expected_observations_fr)+"</section>";
 body+='<details><summary>'+esc(t("data"))+"</summary>"+(c.source_rows||[]).map(r=>'<section><p class="meta">'+esc(r.source_id)+" · "+esc(r.locator||r.record||r.row||"")+"</p><pre class=\"prose\">"+esc(JSON.stringify(r,null,2))+"</pre></section>").join("")+"</details><details><summary>"+esc(t("references"))+"</summary>"+sourceRefs(c.source_ids)+"</details></article>";
 return body;
}
function renderCases(){ $("#main").innerHTML=edition.cases.map(caseCard).join("")||'<div class="empty">'+esc(t("none"))+"</div>";}
function renderComments(){
 let body='<div class="toolbar"><h2>'+esc(t("comments"))+' ('+response.comments.length+')</h2><button class="primary" data-add-comment="">'+esc(t("add"))+"</button></div>";
 body+=response.comments.length?'<div class="comment-list">'+response.comments.map(c=>{const clause=edition.clauses.find(x=>x.id===c.clause_id);return'<article class="card"><div class="toolbar"><h3>'+esc(clause?clause.number+" · "+(language==="fr"?clause.title_fr||clause.title_en:clause.title_en):t("general"))+'</h3><button data-edit-comment="'+esc(c.id)+'">'+esc(t("edit"))+'</button></div><span class="badge">'+esc(t(c.kind))+'</span><span class="badge">'+esc(c.language)+'</span><div class="comment-summary">'+esc(c.body)+"</div>"+(c.proposed_text_en?'<details><summary>'+esc(t("proposedEn"))+'</summary><div class="prose">'+esc(c.proposed_text_en)+"</div></details>":"")+(c.proposed_text_fr?'<details><summary>'+esc(t("proposedFr"))+'</summary><div lang="fr" class="prose">'+esc(c.proposed_text_fr)+"</div></details>":"")+"</article>";}).join("")+"</div>":'<div class="empty">'+esc(t("emptyComments"))+"</div>";
 $("#main").innerHTML=body;
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
 pendingEditor=null;$("#comment-dialog").close();editing=null;persist();render();
}
$("#comment-form").addEventListener("submit",e=>{e.preventDefault();try{commitComment();}catch(x){$("#comment-error").textContent=x.message;}});
$("#close-comment").addEventListener("click",()=>{pendingEditor=editorValue();$("#comment-dialog").close();persist();});
$("#comment-dialog").addEventListener("cancel",()=>{pendingEditor=editorValue();setTimeout(persist,0);});
$("#delete-comment").addEventListener("click",()=>{if(confirm(t("confirmRemove"))){response.comments=response.comments.filter(c=>c.id!==editing);pendingEditor=null;$("#comment-dialog").close();persist();render();}});
document.addEventListener("click",e=>{
 const v=e.target.closest("[data-view]");if(v){readReviewer();view=v.dataset.view;persist();render();}
 const c=e.target.closest("[data-clause]");if(c){readReviewer();clauseId=c.dataset.clause;view="document";persist();render();}
 const a=e.target.closest("[data-add-comment]");if(a){editComment(null,a.dataset.addComment);}
 const edit=e.target.closest("[data-edit-comment]");if(edit){pendingEditor=null;editComment(edit.dataset.editComment);}
 const ca=e.target.closest("[data-case]");if(ca){view="cases";render();document.getElementById("case-"+ca.dataset.case)?.scrollIntoView({block:"start"});}
});
document.addEventListener("input",e=>{if(e.target.closest("#reviewer-fields")||e.target.closest("#comment-fields"))persist();});
$("#search").addEventListener("input",renderOutline);
$("#language").addEventListener("change",e=>{readReviewer();language=e.target.value;persist();render();});
$("#save-draft").addEventListener("click",()=>{download("consultation-draft-"+response.response_id+".json",draftValue());changed=false;$("#saved").textContent=t("savedFile");});
$("#load-draft").addEventListener("click",()=>$("#open-file").click());
$("#open-file").addEventListener("change",async e=>{
 const file=e.target.files[0];if(!file)return;
 try{if(file.size>8*1024*1024)throw Error("8 MiB maximum.");const value=JSON.parse(await file.text());if(changed&&!confirm(t("overwrite")))return;opened(value);persist();render();if(pendingEditor)editComment();$("#saved").textContent=t("opened");}catch(x){error(x.message);}finally{e.target.value="";}
});
$("#export-response").addEventListener("click",()=>{try{
 readReviewer();if($("#comment-dialog").open)commitComment();
 if(pendingEditor){if(pendingEditor.body?.trim()){const index=response.comments.findIndex(c=>c.id===pendingEditor.id);if(index>=0)response.comments[index]=pendingEditor;else response.comments.push(pendingEditor);pendingEditor=null;}else throw Error(t("bodyNeeded"));}
 if(!response.comments.length||response.comments.some(c=>!c.body.trim()))throw Error(t("exportEmpty"));
 const value={...clone(response),exported_at:new Date().toISOString()};if(new Blob([JSON.stringify(value)]).size>8*1024*1024)throw Error("8 MiB maximum.");
 download("consultation-response-"+response.response_id+".json",value);persist();changed=false;$("#saved").textContent=t("exported");renderOutline();
 }catch(x){error(x.message);}
});
window.addEventListener("beforeunload",e=>{if(changed){e.preventDefault();e.returnValue="";}});
render();if(pendingEditor)editComment();
})();
