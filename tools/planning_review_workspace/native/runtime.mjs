import {createHash} from "node:crypto";
const encoder=new TextEncoder(),decoder=new TextDecoder("utf-8",{fatal:true,ignoreBOM:true});
export const runtime={
 sha256:value=>createHash("sha256").update(typeof value==="string"?Buffer.from(value,"utf8"):Buffer.from(value)).digest("hex"),
 encode:value=>encoder.encode(value),
 decode:value=>decoder.decode(value),
 toBase64:value=>Buffer.from(value).toString("base64"),
 fromBase64:value=>{if(typeof value!=="string"||value.length%4||/[^A-Za-z0-9+/=]/.test(value))throw Error("Invalid Base64");const b=Buffer.from(value,"base64");if(b.toString("base64")!==value)throw Error("Noncanonical Base64");return new Uint8Array(b);}
};
