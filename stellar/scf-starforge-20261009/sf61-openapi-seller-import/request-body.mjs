// MIT. Original OpenAPI body declarations, used by inspection and native import.
import { compileMultipartSchema } from '../sf30-seller-sdk/multipart.mjs';
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
export function openApiRequestBody(operation,refs) {
  if (operation.requestBody===undefined) return null;
  const body=refs.reference(operation.requestBody);
  if (body.required!==undefined&&typeof body.required!=='boolean') throw new TypeError('requestBody.required must be boolean');
  const entries=Object.entries(body.content??{}).filter(([type])=>['application/json','multipart/form-data'].includes(type));
  if (entries.length!==1) throw new TypeError('Select a source operation with one JSON or multipart body representation');
  const [mediaType,media]=entries[0];
  if (!plain(media)) throw new TypeError('Request media declaration must be an object');
  if (media.encoding&&Object.keys(media.encoding).length) throw new TypeError('Custom multipart encoding requires a dedicated source integration');
  const schema=refs.schema(media.schema);
  if (schema.type!=='object'||!plain(schema.properties)) throw new TypeError('Request bodies require an object schema');
  if (mediaType==='multipart/form-data') compileMultipartSchema(schema);
  return {mediaType,bodyType:mediaType==='application/json'?'json':'form-data',required:body.required===true,schema,media};
}
export function requestBodySummary(body) {
  if (!body) return null;
  return {mediaType:body.mediaType,bodyType:body.bodyType,required:body.required,
    fields:Object.entries(body.schema.properties).map(([name,schema])=>({name,type:schema.type,
      file:schema.type==='string'&&schema.format==='binary'||schema.type==='array'&&schema.items?.format==='binary',
      required:body.schema.required?.includes(name)===true,description:schema.description??'',
      ...(schema.enum?{values:schema.enum}:{}),...(schema.default!==undefined?{default:schema.default}:{})}))};
}
