// Complete VentCRM package view using the unchanged 6A62 document viewer.
import {renderCustomerPackagePanel} from "./vendor/customer-package-panel.mjs";
const root="ventcrm-complete-customer-packages";
const style=String.raw`
#ventcrm-complete-customer-packages{color-scheme:light;box-sizing:border-box;font:15px/1.5 system-ui,sans-serif;color:#171717;background:#fff;margin:0;padding:1.2rem;min-width:0}
#ventcrm-complete-customer-packages *{box-sizing:border-box}
#ventcrm-complete-customer-packages h1{font-size:1.4rem;line-height:1.3;margin:0 0 .5rem;color:#171717}
#ventcrm-complete-customer-packages h2{font-size:1.05rem;line-height:1.4;margin:0;overflow-wrap:anywhere;color:#171717}
#ventcrm-complete-customer-packages section{border:1px solid #aaa;padding:1rem;margin:1rem 0;background:#fff;color:#171717;min-width:0}
#ventcrm-complete-customer-packages button{border:1px solid #333;background:#222;color:#fff;padding:.6rem .8rem;cursor:pointer;border-radius:2px;font:inherit;min-height:44px;max-width:100%;overflow-wrap:anywhere}
#ventcrm-complete-customer-packages button.secondary{background:#fff;color:#222}
#ventcrm-complete-customer-packages button:disabled{background:#eee;color:#555;cursor:default}
#ventcrm-complete-customer-packages button:focus-visible,#ventcrm-complete-customer-packages select:focus-visible{outline:3px solid #333;outline-offset:2px}
#ventcrm-complete-customer-packages p{margin:.6rem 0;color:#171717;overflow-wrap:anywhere}
#ventcrm-complete-customer-packages label{display:block;margin:.85rem 0 .25rem;color:#171717}
#ventcrm-complete-customer-packages select{width:100%;max-width:100%;min-height:44px;padding:.5rem;background:#fff;color:#171717;border:1px solid #777;font:inherit}
#ventcrm-complete-customer-packages option{background:#fff;color:#171717}
#ventcrm-complete-customer-packages .controls{display:flex;flex-wrap:wrap;gap:.5rem;margin-top:.65rem}
#ventcrm-complete-customer-packages .preview-head{display:flex;justify-content:space-between;gap:1rem;align-items:start}
#ventcrm-complete-customer-packages iframe{display:block;width:100%;height:680px;border:1px solid #aaa;margin-top:1rem;background:#fff}
#ventcrm-complete-customer-packages #document-preview[hidden]{display:none!important}
@media(max-width:480px){#ventcrm-complete-customer-packages{padding:.7rem}#ventcrm-complete-customer-packages section{padding:.8rem}#ventcrm-complete-customer-packages .preview-head{flex-direction:column}}
`;
export function renderVentCRMPackageViewer(input,{fragment=false}={}){
 if(input?.schema!=="commons.ventcrm-complete-package-viewer.v1")throw Error("Select the complete VentCRM package input.");
 const original=renderCustomerPackagePanel({customer:"VentCRM",envelope:input.envelope});
 const head=original.match(/<head>([\s\S]*?)<\/head>/),start=original.indexOf("<body>"),end=original.lastIndexOf("</body>");
 if(!head||start<0||end<=start)throw Error("The complete original viewer template changed.");
 const markup='<div id="'+root+'">'+original.slice(start+6,end)+"</div>";
 if(fragment)return "<style>"+style+"</style>"+markup;
 return '<!doctype html><html lang="en"><head>'+head[1].replace(/<style>[\s\S]*?<\/style>/,"<style>"+style+"</style>")+'</head><body style="margin:0">'+markup+"</body></html>\n";
}
