// MIT. Shared human-readable labels for the cash-plan screen and printable report.
const months=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
export function cashDate(value) {
  if(typeof value!=='string')return 'Date unavailable';
  const match=/^(\d{4}-\d{2}-\d{2})(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2}))?$/.exec(value);
  if(!match)return 'Date unavailable';
  const day=new Date(match[1]+'T00:00:00Z');
  if(!Number.isFinite(day.getTime())||day.toISOString().slice(0,10)!==match[1])return 'Date unavailable';
  const date=value.length===10?day:new Date(value);
  if(!Number.isFinite(date.getTime()))return 'Date unavailable';
  const text=months[date.getUTCMonth()]+' '+date.getUTCDate()+', '+date.getUTCFullYear();
  return value.length===10?text:text+' at '+String(date.getUTCHours()).padStart(2,'0')+':'+
    String(date.getUTCMinutes()).padStart(2,'0')+' UTC';
}
export function cashCurrency(currency) {
  const code=String(currency?.code||'Currency'),scale=currency?.scale;
  return Number.isInteger(scale)&&scale>=0?code+' ('+scale+' decimal '+(scale===1?'place':'places')+')':code;
}
export function cashLabel(value) {
  return String(value??'').replaceAll('_',' ').toLowerCase().replace(/^\w/,character=>character.toUpperCase());
}
