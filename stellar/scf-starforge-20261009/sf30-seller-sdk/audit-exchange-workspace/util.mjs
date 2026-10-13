import {createHash} from "node:crypto";
export function canonical(value){
  if(value===null||typeof value!=="object")return JSON.stringify(value);
  if(Array.isArray(value))return "["+value.map(canonical).join(",")+"]";
  return "{"+Object.keys(value).sort().map(k=>JSON.stringify(k)+":"+canonical(value[k])).join(",")+"}";
}
export const sha256=bytes=>createHash("sha256").update(bytes).digest("hex");
