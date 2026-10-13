import {renderCustomerDocumentViewer} from "./customer-document-viewer.mjs";
import {documentPreview} from "./customer-package-panel.mjs";
export function localizationOpening(name,source){
 if(!/^localization-(?:sample|paid)\/app\.html$/.test(name))return null;
 const marker="<script>const INITIAL=",start=source.indexOf(marker);
 if(start<0||source.indexOf(marker,start+1)>=0)throw Error("The complete localization opening changed.");
 let at=start+marker.length;
 function value(){
  const begin=at,open=source[at],stack=[];let quoted=false,escaped=false;
  if(open!=="{"&&open!=="["&&open!=='"')throw Error("The original localization value is absent.");
  for(;at<source.length;at++){
   const c=source[at];
   if(quoted){if(escaped)escaped=false;else if(c==="\\")escaped=true;else if(c==='"'){quoted=false;if(open==='"'){at++;return JSON.parse(source.slice(begin,at));}}continue;}
   if(c==='"'){quoted=true;continue;}
   if(c==="{"||c==="[")stack.push(c);
   else if(c==="}"||c==="]"){const expected=c==="}"?"{":"[";if(stack.pop()!==expected)throw Error("Original localization value differs.");if(!stack.length){at++;return JSON.parse(source.slice(begin,at));}}
  }
  throw Error("The original localization value is incomplete.");
 }
 const workspace=value();if(source.slice(at,at+14)!==",SOURCE_FILES=")throw Error("Complete localization source is absent.");at+=14;
 const files=value();if(source.slice(at,at+7)!==",GUIDE=")throw Error("Complete localization guide is absent.");at+=7;
 const guide=value();
 if(workspace?.schema!=="tjlabs.merchant-localization.v1"||!Array.isArray(workspace.research)||!Array.isArray(files)||typeof guide!=="string"||workspace.research.length!==workspace.selection.leadIds.length)throw Error("Original merchant selection or guide differs.");
 const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
 const working=name.replace(/app\.html$/,"working.json");
 return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Merchant localization desk</title><style>html{color-scheme:light}*{box-sizing:border-box}body{margin:0;padding:20px;font:16px/1.55 system-ui;color:#222;background:#fff;overflow-wrap:anywhere}h1{font-size:24px;line-height:1.2}h2{font-size:19px}aside{border:1px solid #bbb;padding:16px;background:#f5f5f5}li{margin:8px 0}code{white-space:normal;overflow-wrap:anywhere}pre{font:inherit;white-space:pre-wrap;overflow-wrap:anywhere}summary{cursor:pointer;min-height:44px;font-weight:600}</style></head><body data-localization-opening="complete"><h1>Merchant localization desk</h1><p>Complete editable localization preparation for '+workspace.research.length+' original merchant '+(workspace.research.length===1?"profile":"profiles")+'.</p><aside><h2>Open the working desk</h2><ol><li>Download the complete pack and extract its ZIP.</li><li>Open <code>'+esc(name)+'</code> in a browser.</li><li>Use <strong>Open working file</strong> to receive <code>'+esc(working)+'</code>, or open your later saved working or recovery file.</li></ol><p>Keep original source text, entered translations, preferred terms, review decisions and complete handovers together.</p></aside><h2>Included merchant research</h2><ul>'+workspace.research.map(row=>"<li>"+esc(row.record.organization)+"</li>").join("")+'</ul><h2>Working views</h2><ol><li>Original merchant context and published sources</li><li>Merchant-selected pilot scope</li><li>Actual content and human review</li><li>Protected names and preferred terms</li><li>Complete handovers, edit history and unfinished-work recovery</li></ol><details><summary>Read the complete localization guide</summary><pre>'+esc(guide)+'</pre></details></body></html>';
}
export function previewLocalizationDocument(name,source){return localizationOpening(name,source)??documentPreview(name,source);}
function localizationDocumentPreview(name,source){return localizationOpening(name,source)??originalDocumentPreview(name,source);}
export function renderLocalizationPackageViewer(options,format={}){
 let html=renderCustomerDocumentViewer(options,format);
 const original=documentPreview.toString(),escaped=original.replace(/<\/script/gi,"<\\/script");
 if(html.split(escaped).length!==2)throw Error("The original complete document preview changed.");
 const replacement=original.replace(/^function documentPreview\(/,"function originalDocumentPreview(")+"\n"+localizationOpening.toString()+"\n"+localizationDocumentPreview.toString().replace(/^function localizationDocumentPreview\(/,"function documentPreview(");
 return html.replace(escaped,()=>replacement.replace(/<\/script/gi,"<\\/script"));
}
