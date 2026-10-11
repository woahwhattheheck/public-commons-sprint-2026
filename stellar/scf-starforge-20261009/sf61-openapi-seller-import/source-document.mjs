// MIT. Original source bytes stay intact; only the compiler's value is normalized.
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
export function parseOpenApiSource(text) {
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
  if (!value||typeof value!=='object'||Array.isArray(value)||!/^3\.[01]\.\d+$/.test(value.openapi)||!value.paths||typeof value.paths!=='object') throw new TypeError('Load an OpenAPI 3.0 or 3.1 JSON or YAML document');
  return {document:value,format:json?'json':'yaml'};
}
