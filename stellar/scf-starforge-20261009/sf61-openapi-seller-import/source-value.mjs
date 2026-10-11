// MIT. Shared native JSON/YAML parser for entry documents and source fragments.
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
export function parseOpenApiValue(text) {
  if (typeof text!=='string'||Buffer.byteLength(text)>4*1024*1024) throw new TypeError('OpenAPI source must be at most 4 MiB');
  const parsedText=text.charCodeAt(0)===0xfeff?text.slice(1):text;
  const json=/^\s*[\[{]/.test(parsedText);
  let value;
  if (json) value=JSON.parse(parsedText);
  else {
    let yaml; try { yaml=require('yaml'); } catch { throw new TypeError('OPENAPI_YAML_ENGINE_UNAVAILABLE: install the original SF61 package dependencies'); }
    const document=yaml.parseDocument(parsedText,{version:'1.2',schema:'core',uniqueKeys:true,merge:false});
    if (document.errors.length||document.warnings.length) throw new TypeError('OpenAPI YAML must use standard YAML 1.2 with unique string keys');
    value=document.toJS({maxAliasCount:32,mapAsMap:false});
  }
  return {value,format:json?'json':'yaml'};
}
