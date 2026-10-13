// MIT. Complete lossless print-production application preview.
import {compactInlinePayload} from './connected_inline_payload.mjs';
export function compactPrintProductionWorkbenchHtml(html,{gzipSource}={}){return compactInlinePayload(html,{dataId:'print-production-data',zipGlobal:'PrintProductionZip',bootstrapBefore:'const PrintProductionEngine=(()=>{',codecGlobal:'PrintProductionInflate',gzipSource,compactBootstrap:true});}
