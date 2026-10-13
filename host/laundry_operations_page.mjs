// MIT. Same complete laundry application in a lossless compact Page preview.
import {compactInlinePayload} from './connected_inline_payload.mjs';
export function compactLaundryOperationsHtml(html,{gzipSource}={}){return compactInlinePayload(html,{dataId:'laundry-operations-data',zipGlobal:'LaundryOperationsZip',bootstrapBefore:'const LaundryOperations=(()=>{',codecGlobal:'LaundryOperationsInflate',compactBootstrap:true,gzipSource});}
