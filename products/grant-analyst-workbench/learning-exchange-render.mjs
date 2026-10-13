import {SCHEMAS,inspectPacket,inspectDraft,inspectReturn,inspectBundle,identityText,canonical} from "./learning-exchange.mjs";
export async function renderLearningReview(value,sources){
 const api=typeof globalThis.LearningExchange==="object"?globalThis.LearningExchange:{SCHEMAS,inspectPacket,inspectDraft,inspectReturn,inspectBundle,identityText,canonical};
 const pins={"domainSource":{"bytes":26916,"sha256":"53a16c64424208acded09c5f16824d1af12ba9f3678892015493fb25151a9a74"},"uiSource":{"bytes":19246,"sha256":"c911b871f174d8500723536060b6ed4140d34d9bd47dcdf6226b12bfd271bd3e"},"css":{"bytes":3590,"sha256":"e74bbb5e981a13ca564cc6417720ab6bdc962ebd6c11ed84064710af816ad9b2"},"template":{"bytes":3632,"sha256":"33728d7df9cdc18b990f3322463cdcdb793e21fbd8af3741dae3201285dc3cbf"}};
 for(const [key,pin] of Object.entries(pins)){if(typeof sources[key]!=="string")throw new Error("Supply complete "+key);const actual=api.identityText(sources[key]);if(actual.bytes!==pin.bytes||actual.sha256!==pin.sha256)throw new Error("Selected offline source differs: "+key);}
 if(value.schema===api.SCHEMAS.packet)api.inspectPacket(value);else if(value.schema===api.SCHEMAS.draft)api.inspectDraft(value);else if(value.schema===api.SCHEMAS.returned)api.inspectReturn(value);else api.inspectBundle(value);
 const exports=["SCHEMAS","canonical","identityText","parseExchange","issuePacket","inspectPacket","createDraft","saveDraft","inspectDraft","createReturn","inspectReturn","previewReturn","rebaseReturn","prepareApply","createBundle","inspectBundle"];
 const domain="(function(){\n"+sources.domainSource.replace(/\bexport /g,"")+"\nglobalThis.LearningExchange={"+exports.join(",")+"};\n})();\nglobalThis.LearningExchange.renderLearningReview="+renderLearningReview.toString()+";";
 const safe=value=>JSON.stringify(value).replace(/</g,"\\u003c").replace(/\u2028/g,"\\u2028").replace(/\u2029/g,"\\u2029");
 const substitutions={
  "/*EXCHANGE_STYLE*/":sources.css,
  "/*EXCHANGE_PAYLOAD*/":safe(value),
  "/*EXCHANGE_SOURCES*/":safe(sources),
  "/*EXCHANGE_DOMAIN*/":domain.replace(/<\/script/gi,"<\\/script"),
  "/*EXCHANGE_UI*/":sources.uiSource.replace(/<\/script/gi,"<\\/script")
 };
 for(const key of Object.keys(substitutions))if(sources.template.split(key).length!==2)throw new Error("Offline template must contain exactly one "+key);
 // A single pass never interprets placeholder-looking text inside retained files.
 const html=sources.template.replace(/\/\*EXCHANGE_(?:STYLE|PAYLOAD|SOURCES|DOMAIN|UI)\*\//g,key=>substitutions[key]);
 const actual=api.identityText(html),identity=value.id||"review";
 return {html,...actual,filename:"learning-review-"+identity+".html"};
}
