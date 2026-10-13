// MIT. Lossless complete flight-school application preview.
import {compactInlinePayload} from './connected_inline_payload.mjs';
export function compactFlightSchoolOperationsHtml(html,{gzipSource}={}){return compactInlinePayload(html,{dataId:'flight-school-data',zipGlobal:'FlightSchoolOperationsZip',bootstrapBefore:'const FlightSchoolOperations=(()=>{',codecGlobal:'FlightSchoolOperationsInflate',gzipSource,compactBootstrap:true});}
