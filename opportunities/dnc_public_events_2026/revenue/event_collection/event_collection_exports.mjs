// TJLabs public event collection: reviewed portable projections; no network writer.
const copy = x => JSON.parse(JSON.stringify(x));
const fail = (code, message) => { const e=new Error(message); e.code=code; throw e; };
const need = (condition, code, message) => { if(!condition) fail(code,message); };
function canonical(value) {
  if(Array.isArray(value)) return '['+value.map(canonical).join(',')+']';
  if(value && typeof value==='object') return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';
  return JSON.stringify(value);
}
const text = v => typeof v==='string' ? v : '';
const present = x => x!==null && x!==undefined && x!=='';
function utcParts(y,m,d,h=0,n=0,s=0) {
  const v=new Date(0); v.setUTCFullYear(y,m-1,d); v.setUTCHours(h,n,s,0); return v;
}
function date(value) {
  need(typeof value==='string' && /^\d{4}-\d{2}-\d{2}$/.test(value),'DATE_UNRESOLVED','Use an exact YYYY-MM-DD date.');
  const [y,m,d]=value.split('-').map(Number), v=utcParts(y,m,d);
  need(y>=1 && v.getUTCFullYear()===y && v.getUTCMonth()===m-1 && v.getUTCDate()===d,'DATE_INVALID','The original date is not a real calendar day.');
  return v;
}
function dateShift(value, days) {
  const v=date(value);v.setUTCDate(v.getUTCDate()+days);const r=v.toISOString().slice(0,10);
  need(/^\d{4}-\d{2}-\d{2}$/.test(r),'DATE_RANGE','The date is outside the four-digit year range.');return r;
}
function localParts(value) {
  const m=/^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value||'');
  need(m,'TIME_UNRESOLVED','Use a full local date and time, or an explicit offset-bearing instant.');
  const d=date(m[1]), h=Number(m[2]), n=Number(m[3]), s=Number(m[4]||0);
  need(h<24 && n<60 && s<60,'TIME_INVALID','The original clock time is invalid.');
  d.setUTCHours(h,n,s,0);return {epoch:d.getTime(),date:m[1],time:[h,n,s].map(x=>String(x).padStart(2,'0')).join(':')};
}
function zoneFormatter(zone) {
  need(typeof zone==='string' && zone.length>0,'TIMEZONE_UNRESOLVED','Choose the event time zone before converting a local clock time.');
  try { return new Intl.DateTimeFormat('en-CA',{timeZone:zone,calendar:'gregory',numberingSystem:'latn',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}); }
  catch { fail('TIMEZONE_INVALID','Use a named time zone supported by this browser.'); }
}
function partsAt(epoch, formatter) {
  const a=Object.fromEntries(formatter.formatToParts(new Date(epoch)).filter(x=>x.type!=='literal').map(x=>[x.type,x.value]));
  const d=a.year.padStart(4,'0')+'-'+a.month+'-'+a.day, t=a.hour+':'+a.minute+':'+a.second;
  return {date:d,time:t,epoch:localParts(d+'T'+t).epoch};
}
function resolveEventInstant(value, timezone) {
  need(typeof value==='string','TIME_UNRESOLVED','The event time is missing.');
  const explicit=/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}(?::\d{2})?)(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if(explicit) {
    const local=localParts(explicit[1]+'T'+explicit[2]);let offset=0;
    if(explicit[3]!=='Z') {
      const [h,m]=explicit[3].slice(1).split(':').map(Number);
      need(h<=23&&m<=59,'OFFSET_INVALID','The original UTC offset is invalid.');
      offset=(h*60+m)*(explicit[3][0]==='-'?-1:1);
    }
    const epoch=local.epoch-offset*60000;
    need(Number.isFinite(epoch),'TIME_INVALID','The original instant is invalid.');
    return {epoch,utc:new Date(epoch).toISOString().replace('.000',''),basis:'explicit-offset',timezone:timezone||null};
  }
  const local=localParts(value), formatter=zoneFormatter(timezone), offsets=new Set();
  // Gather both sides of nearby transitions, then require the original wall clock exactly.
  for(let hours=-48;hours<=48;hours+=6) {
    const probe=local.epoch+hours*3600000;
    offsets.add(partsAt(probe,formatter).epoch-probe);
  }
  const candidates=[...offsets].map(offset=>local.epoch-offset).filter(epoch=>partsAt(epoch,formatter).epoch===local.epoch);
  const unique=[...new Set(candidates)];
  need(unique.length>0,'DST_GAP','This local clock time does not occur in its named zone. Preserve the source and resolve its intended time.');
  need(unique.length===1,'DST_FOLD','This local clock time occurs twice. Supply the source-confirmed UTC offset.');
  return {epoch:unique[0],utc:new Date(unique[0]).toISOString().replace('.000',''),basis:'named-zone',timezone};
}
function eventSchedule(schedule, timezone) {
  need(schedule&&typeof schedule==='object','SCHEDULE_UNRESOLVED','Receive or enter the complete event schedule.');
  if(schedule.kind==='all-day') {
    const start=text(schedule.start), end=text(schedule.end);date(start);date(end);
    need(typeof schedule.end_inclusive==='boolean','END_MEANING_UNRESOLVED','State whether the original all-day end date is inclusive.');
    const exclusive=schedule.end_inclusive?dateShift(end,1):end;
    need(date(exclusive)>date(start),'DATE_ORDER','An all-day event must end after its first day.');
    return {kind:'all-day',start,endExclusive:exclusive,endInclusive:dateShift(exclusive,-1),timezone:timezone||null};
  }
  need(schedule.kind==='timed','SCHEDULE_UNRESOLVED','This event has an unresolved date or time.');
  const start=resolveEventInstant(schedule.start,timezone),end=resolveEventInstant(schedule.end,timezone);
  need(end.epoch>start.epoch,'TIME_ORDER','The event must finish after it starts.');
  return {kind:'timed',start,end,timezone:timezone||null};
}
const icsText=value=>String(value??'').replace(/\\/g,'\\\\').replace(/\r\n|\r|\n/g,'\\n').replace(/;/g,'\\;').replace(/,/g,'\\,').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g,'');
const csv=value=>'"'+String(value??'').replace(/"/g,'""')+'"';
const utf8Length=s=>unescape(encodeURIComponent(s)).length;
function foldCalendarLine(line) {
  let result='',part='',count=0;
  for(const ch of line) {
    const n=utf8Length(ch);
    if(count+n>75) {result+=part+'\r\n';part=' ';count=1;}
    part+=ch;count+=n;
  }
  return result+part;
}
function safeUrl(value) {
  if(!present(value)) return '';
  need(typeof value==='string'&&!/[\u0000-\u0020\u007f]/.test(value),'URL_INVALID','Use an absolute HTTP or HTTPS URL without control characters.');
  const m=/^https?:\/\/([^/?#]+)(?:[/?#].*)?$/i.exec(value);
  need(m&&!/[\\@]/.test(m[1])&&!/\\/.test(value),'URL_INVALID','The URL must be public HTTP or HTTPS without embedded credentials or backslashes.');
  need(/^(?:[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?|\[[0-9A-Fa-f:.]+\])(?::\d{1,5})?$/.test(m[1]),'URL_INVALID','Use an absolute public HTTP or HTTPS host.');return value;
}
function plain(value) {
  if(typeof value==='string')return value;
  if(value===null||value===undefined)return '';
  return canonical(value);
}
function name(value) {return typeof value==='string'?value:text(value?.name);}
function place(value) {
  if(typeof value==='string')return value;
  if(!value)return '';
  return [value.name,typeof value.address==='string'?value.address:plain(value.address),value.city,value.region,value.postal_code,value.country].filter(present).join(', ');
}
function description(values,entry) {
  const chunks=[text(values.editorial_summary),values.venue?'Venue: '+place(values.venue):'',Array.isArray(values.organizers)&&values.organizers.length?'Organizers: '+values.organizers.map(name).join('; '):'',entry.source_url?'Original source: '+entry.source_url:''];
  return chunks.filter(Boolean).join('\n\n');
}
const htmlText=value=>String(value).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\r\n|\r|\n/g,'<br>');
function recurrencePresent(value) {
  return value!==null&&value!==undefined&&value!==false&&value!==''&&!(Array.isArray(value)&&value.length===0);
}
function timestamp(value) {
  const m=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value||'');
  need(m&&Number.isFinite(Date.parse(value)),'EXPORT_TIME','Supply the retained UTC export timestamp.');
  const v=new Date(value),normalized=value.replace(/\.(\d{1,3})Z$/,(_,f)=>'.'+f.padEnd(3,'0')+'Z');
  need(v.toISOString()===(normalized.includes('.')?normalized:normalized.replace('Z','.000Z')),'EXPORT_TIME','The export timestamp is not a valid date.');
  return v.toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,'');
}
function association(values,mapping,field,issues,id) {
  need(Object.hasOwn(mapping,field),'TARGET_ASSOCIATION_UNMAPPED','Choose the exact target '+field+'; an explicit empty list clears it.');
  const a=mapping[field];need(Array.isArray(a),'TARGET_MAPPING','Association mapping must be an explicit list.');
  need(a.every(x=>typeof x==='string'&&x.trim()||(field==='organizers'&&Number.isSafeInteger(x)&&x>0)),'TARGET_ASSOCIATION_TYPE',field==='organizers'?'Use exact organizer names or positive post IDs.':'Use exact target '+field+' names; this CSV field does not identify records by numeric ID.');
  need(a.every(x=>!String(x).includes(',')&&!/[\r\n]/.test(String(x))),'ASSOCIATION_AMBIGUOUS',field==='organizers'?'A comma in an organizer name needs its actual supported post ID.':'A comma in a '+field+' name cannot be represented unambiguously by this CSV field; retain it for a supported native update.');
  return a.map(String).join(', ');
}
const TEC_FIELD_MAPPING=Object.freeze({title:'Event Name',schedule:'Event date and time',venue:'Event Venue Name',organizers:'Event Organizers',categories:'Event Category',event_url:'Event Website',media:'Event Featured Image',editorial_summary:'Event Description',status:null,links:null,notes:null});
function validateTecFields(mapping) {
  need(mapping&&typeof mapping==='object'&&!Array.isArray(mapping),'TARGET_FIELDS','Retain the target field mapping.');
  for(const [field,value] of Object.entries(mapping)) {
    need(Object.hasOwn(TEC_FIELD_MAPPING,field),'TARGET_FIELDS','Unknown target source field '+field);
    need(value===null||value===TEC_FIELD_MAPPING[field],'TARGET_FIELDS','Use the supported The Events Calendar heading for '+field+'.');
  }
  for(const field of ['title','schedule'])need(mapping[field]===TEC_FIELD_MAPPING[field],'TARGET_FIELDS','Keep the required '+field+' mapping.');
}
const TEC_COLUMNS=['Event Name','Event Description','Event Start Date','Event Start Time','Event End Date','Event End Time','All Day Event','Timezone','Event Venue Name','Event Organizers','Event Category','Event Website','Event Featured Image'];
const TEC_OPTIONAL_COLUMNS={editorial_summary:['Event Description'],venue:['Event Venue Name'],organizers:['Event Organizers'],categories:['Event Category'],event_url:['Event Website'],media:['Event Featured Image']};
function tecColumns(target) {
  const chosen=new Set(['Event Name','Event Start Date','Event Start Time','Event End Date','Event End Time','All Day Event','Timezone']);
  for(const [field,columns] of Object.entries(TEC_OPTIONAL_COLUMNS))if(target.mapping[field]===TEC_FIELD_MAPPING[field])for(const column of columns)chosen.add(column);
  return TEC_COLUMNS.filter(column=>chosen.has(column));
}
function tecRow(entry,resolved,target,mapping,issues) {
  const v=entry.values,zone=resolved.timezone||text(target.timezone);zoneFormatter(zone);
  const start=resolved.kind==='timed'?partsAt(resolved.start.epoch,zoneFormatter(zone)):{date:resolved.start,time:''};
  const end=resolved.kind==='timed'?partsAt(resolved.end.epoch,zoneFormatter(zone)):{date:resolved.endInclusive,time:''};
  const clear=mapping.clear_fields||[];
  need(Array.isArray(clear)&&clear.every(f=>Object.hasOwn(TEC_OPTIONAL_COLUMNS,f)),'TARGET_CLEAR_FIELDS','Choose supported optional fields to clear explicitly.');
  const selected=f=>target.mapping[f]===TEC_FIELD_MAPPING[f];
  const cells={'Event Name':v.title,'Event Start Date':start.date,'Event Start Time':start.time,'Event End Date':end.date,'Event End Time':end.time,'All Day Event':resolved.kind==='all-day'?'TRUE':'FALSE','Timezone':zone};
  if(selected('editorial_summary')) {
    need(clear.includes('editorial_summary')||(Object.hasOwn(v,'editorial_summary')&&v.editorial_summary!==null),'TARGET_FIELD_UNOBSERVED','The editorial summary is unobserved. Omit this column or explicitly select clearing.');
    cells['Event Description']=clear.includes('editorial_summary')?'':htmlText(v.editorial_summary);
  }
  if(selected('venue')) {const value=clear.includes('venue')?'':association(v.venue,mapping,'venues',issues,entry.id);need(!value.includes(','),'MULTIPLE_VENUES','This projection supports one explicitly mapped target venue.');cells['Event Venue Name']=value;}
  if(selected('organizers'))cells['Event Organizers']=clear.includes('organizers')?'':association(v.organizers,mapping,'organizers',issues,entry.id);
  if(selected('categories'))cells['Event Category']=clear.includes('categories')?'':association(v.categories,mapping,'categories',issues,entry.id);
  if(selected('event_url')) {
    need(clear.includes('event_url')||(Object.hasOwn(v,'event_url')&&v.event_url!==null),'TARGET_FIELD_UNOBSERVED','The event website is unobserved. Omit this column or explicitly select clearing.');
    cells['Event Website']=clear.includes('event_url')?'':safeUrl(v.event_url);
  }
  if(selected('media')) {
    need(clear.includes('media')||Object.hasOwn(mapping,'image_url'),'TARGET_MEDIA_UNMAPPED','Choose the exact permitted image URL, explicitly clear it, or omit this column.');
    cells['Event Featured Image']=clear.includes('media')?'':safeUrl(mapping.image_url);
  }
  const identity={title:v.title,all_day:resolved.kind==='all-day',start_date:start.date,start_time:start.time,end_date:end.date,end_time:end.time};
  const duplicateKey=identity.all_day?canonical({title:identity.title,all_day:true,start_date:identity.start_date}):canonical(identity);
  if(present(mapping.target_event_id)) {
    need(Number.isSafeInteger(mapping.target_event_id)&&mapping.target_event_id>0,'TARGET_EVENT_ID','Use the actual positive target post ID.');
    need(mapping.last_accepted_identity&&typeof mapping.last_accepted_identity==='object','TARGET_BASELINE_REQUIRED','An existing target event needs its last accepted title and schedule before a repeat CSV review.');
    const before=mapping.last_accepted_identity;
    const beforeKey=before.all_day?canonical({title:before.title,all_day:true,start_date:before.start_date}):canonical(Object.fromEntries(Object.keys(identity).map(k=>[k,before[k]])));
    need(beforeKey===duplicateKey,'CSV_UPDATE_IDENTITY_CHANGED','The title or dates differ from the accepted target event. CSV can create a duplicate; retain this update for an explicit target-ID operation.');
  }
  return {row:tecColumns(target).map(column=>cells[column]),identity,duplicateKey};
}
/**
 * projections is the model-selected set, in stable order:
 * {workspace:{id,revision,title}, entries:[{id,revision,source_key,source_url,values,original,withdrawn}], archive:<complete original model archive>}.
 * target has {kind:'tec-csv',id,name,timezone,timezone_policy:'preserve'|'override',entry_mappings:{[entryId]:{...}}}.
 */
function buildEventExport(projection, options) {
  need(projection&&projection.workspace&&Array.isArray(projection.entries),'EXPORT_INPUT','Receive the model-selected collection and complete archive.');
  need(options&&['portable-json','ical','tec-csv'].includes(options.format),'EXPORT_FORMAT','Choose JSON, iCalendar or The Events Calendar CSV.');
  need(typeof projection.workspace.id==='string'&&projection.workspace.id.length>0,'WORKSPACE_ID','A stable collection ID is required.');
  need(Number.isSafeInteger(projection.workspace.revision)&&projection.workspace.revision>=0,'WORKSPACE_REVISION','Retain the exact collection revision.');
  const stamp=timestamp(options.generatedAt),ids=projection.entries.map(e=>e.id);
  need(ids.every(x=>typeof x==='string'&&x.length>0)&&new Set(ids).size===ids.length,'ENTRY_IDS','Select distinct original entry IDs.');
  need(projection.archive!==undefined,'ARCHIVE_REQUIRED','Include the original complete model archive with the export.');
  const target=copy(options.target||{}),issues=[],exported=[],omitted=[],events=[],rows=[],identities=[],duplicateKeys=new Map();
  if(options.format==='tec-csv') {
    need(target.kind==='tec-csv'&&text(target.id)&&text(target.name),'TARGET_REQUIRED','Select a named The Events Calendar target.');
    need(['preserve','override'].includes(target.timezone_policy),'TARGET_TIMEZONE_POLICY','Choose whether to preserve event zones or explicitly use the target zone.');
    if(target.timezone_policy==='override')zoneFormatter(target.timezone);
    need(target.entry_mappings&&typeof target.entry_mappings==='object'&&!Array.isArray(target.entry_mappings),'TARGET_MAPPING','Retain the exact per-entry target mapping.');
    validateTecFields(target.mapping);
  }
  for(const entry of projection.entries) {
    try {
      need(entry.values&&typeof entry.values==='object','ENTRY_VALUES','The selected current values are missing.');
      need(text(entry.values.title).trim(),'TITLE_REQUIRED','Enter the event title.');
      if(options.format==='portable-json'){exported.push(entry.id);continue;}
      need(!entry.withdrawn,'ENTRY_WITHDRAWN','This working entry is withdrawn; its complete record remains in JSON.');
      const v=entry.values,mapping=target.entry_mappings?.[entry.id]||{};
      need(!recurrencePresent(v.schedule?.recurrence)||mapping.recurrence_mode==='selected-occurrence','RECURRENCE_REVIEW','Choose this retained record explicitly as a single occurrence; its recurrence rule is preserved in JSON.');
      const originalZone=text(v.schedule?.timezone);
      const zone=options.format==='tec-csv'&&target.timezone_policy==='override'?target.timezone:originalZone;
      if(zone!==originalZone)issues.push({entry_id:entry.id,code:'TIMEZONE_SELECTED',field:'schedule',severity:'notice',message:'The operator selected '+zone+' instead of '+(originalZone||'an unresolved source zone')+'. The original schedule remains in JSON.'});
      // When a source named zone exists it defines its local clock; a target override only changes output display.
      const resolved=eventSchedule(v.schedule,originalZone||zone);
      if(options.format==='tec-csv'&&target.timezone_policy==='override')resolved.timezone=zone;
      if(options.format==='ical') {
        const uid=encodeURIComponent(projection.workspace.id)+'.'+encodeURIComponent(entry.id)+'@events.tjlabs.local';
        const e=['BEGIN:VEVENT','UID:'+uid,'DTSTAMP:'+stamp,'SEQUENCE:'+projection.workspace.revision,'SUMMARY:'+icsText(v.title)];
        if(resolved.kind==='all-day')e.push('DTSTART;VALUE=DATE:'+resolved.start.replace(/-/g,''),'DTEND;VALUE=DATE:'+resolved.endExclusive.replace(/-/g,''));
        else e.push('DTSTART:'+resolved.start.utc.replace(/[-:]/g,''),'DTEND:'+resolved.end.utc.replace(/[-:]/g,''));
        if(v.venue)e.push('LOCATION:'+icsText(place(v.venue)));
        const desc=description(v,entry);if(desc)e.push('DESCRIPTION:'+icsText(desc));
        if(v.event_url||entry.source_url)e.push('URL:'+safeUrl(v.event_url||entry.source_url));
        if(Array.isArray(v.categories)&&v.categories.length)e.push('CATEGORIES:'+v.categories.map(x=>icsText(name(x))).join(','));
        const status=typeof v.status==='string'?v.status.toLowerCase():'';
        if(['cancelled','canceled'].includes(status))e.push('STATUS:CANCELLED');
        else if(['confirmed','scheduled'].includes(status))e.push('STATUS:CONFIRMED');
        else if(status==='tentative')e.push('STATUS:TENTATIVE');
        if(originalZone)e.push('X-TJLABS-SOURCE-TIMEZONE:'+icsText(originalZone));
        e.push('END:VEVENT');events.push(...e);
      } else {
        need(!['cancelled','canceled'].includes(text(v.status).toLowerCase()),'CSV_CANCELLATION_REVIEW','Preserve the cancellation for an explicit target event update; CSV status is an import-wide publication setting.');
        const result=tecRow(entry,resolved,target,mapping,issues);
        need(!duplicateKeys.has(result.duplicateKey),'CSV_IDENTITY_COLLISION','Another selected event has the same target CSV duplicate key; review both identities before import.');
        duplicateKeys.set(result.duplicateKey,entry.id);rows.push(result.row);
        identities.push({entry_id:entry.id,target_event_id:mapping.target_event_id||null,identity:result.identity});
      }
      exported.push(entry.id);
    } catch(error) {
      omitted.push(entry.id);issues.push({entry_id:entry.id,code:error.code||'EXPORT_ERROR',field:'entry',severity:'error',message:error.message});
    }
  }
  // A collision must not silently leave the first indistinguishable row importable.
  if(options.format==='tec-csv') {
    const collisions=new Set(issues.filter(x=>x.code==='CSV_IDENTITY_COLLISION').map(x=>x.entry_id));
    if(collisions.size) {
      for(const entry of projection.entries.filter(x=>collisions.has(x.id))) {
        try {
          const zone=text(entry.values.schedule?.timezone)||(target.timezone_policy==='override'?target.timezone:'');
          const resolved=eventSchedule(entry.values.schedule,zone);
          if(target.timezone_policy==='override')resolved.timezone=target.timezone;
          const result=tecRow(entry,resolved,target,target.entry_mappings?.[entry.id]||{},[],entry.id);
          const first=duplicateKeys.get(result.duplicateKey);
          if(first&&exported.includes(first)) {
            const at=exported.indexOf(first);exported.splice(at,1);rows.splice(at,1);identities.splice(at,1);omitted.push(first);
            issues.push({entry_id:first,code:'CSV_IDENTITY_COLLISION',field:'entry',severity:'error',message:'This entry shares a target duplicate key with another selected entry; both remain in the complete JSON.'});
          }
        } catch {}
      }
    }
  }
  const review={schema:'tjlabs.public-events-export/v1',format:options.format,generated_at:options.generatedAt,workspace:copy(projection.workspace),selected_ids:ids,exported_ids:exported,omitted_ids:omitted,issues,target:copy(target),target_identities:identities,entries:copy(projection.entries),archive:copy(projection.archive)};
  const files=[{name:'event-collection-complete.json',media_type:'application/json',content:JSON.stringify(review,null,2)+'\n'}];
  if(options.format==='ical')files.push({name:'selected-events.ics',media_type:'text/calendar;charset=utf-8',content:['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//TJLabs//Public Event Collection//EN','CALSCALE:GREGORIAN',...events,'END:VCALENDAR'].map(foldCalendarLine).join('\r\n')+'\r\n'});
  if(options.format==='tec-csv')files.push({name:'selected-events-tec.csv',media_type:'text/csv;charset=utf-8',content:[tecColumns(target),...rows].map(row=>row.map(csv).join(',')).join('\r\n')+'\r\n'});
  return {...review,files};
}

/** Bind once to the maintained source/editor model. No copy of its validation or archive format. */
function createEventExportAdapter(model) {
  need(model&&typeof model.validateWorkspace==='function'&&typeof model.exportArchive==='function'&&typeof model.projection==='function','MODEL_REQUIRED','Supply the original event collection model.');
  function buildExport(input,options) {
    const ws=model.validateWorkspace(input);
    need(options&&Array.isArray(options.entryIds),'EXPORT_SELECTION','Select the exact entry IDs for this export.');
    need(new Set(options.entryIds).size===options.entryIds.length,'EXPORT_SELECTION','Select each entry once.');
    const p=model.projection(ws),byId=new Map(p.records.map(r=>[r.id,r]));
    need(options.entryIds.every(id=>byId.has(id)),'EXPORT_SELECTION','Every selected entry must belong to the current collection.');
    const selected=options.entryIds.map(id=>byId.get(id));
    const target=copy(options.target===undefined?ws.target:options.target)||{};
    const format=options.format==='icalendar'?'ical':options.format;
    if(format==='event-csv') {
      timestamp(options.generatedAt);
      need(target.adapter==='event-csv'&&text(target.name),'TARGET_REQUIRED','Select a named review CSV target.');
      need(target.mapping&&typeof target.mapping==='object','TARGET_FIELDS','Choose the review CSV fields.');
      const mapping=Object.entries(target.mapping).filter(([,heading])=>heading!==null);
      need(mapping.length>0&&mapping.every(([field,heading])=>model.FIELDS.includes(field)&&typeof heading==='string'&&heading.trim()),'TARGET_FIELDS','Use original normalized fields and named CSV headings.');
      need(new Set(mapping.map(([,heading])=>heading)).size===mapping.length,'TARGET_FIELDS','Use distinct review CSV headings.');
      const headers=['Entry ID','Original source','Editorial disposition',...mapping.map(([,heading])=>heading)];
      need(new Set(headers).size===headers.length,'TARGET_FIELDS','Do not reuse an identity column heading.');
      const formulaIssues=[];
      const spreadsheet=(value,entry_id,field)=>{const raw=String(value??'');if(/^[\u0000-\u0020]*[=+\-@]/.test(raw)){formulaIssues.push({entry_id,field,code:'SPREADSHEET_TEXT_PREFIX',severity:'notice',message:'A leading apostrophe makes this review cell spreadsheet text. The exact original value remains in the complete JSON.'});return "'"+raw;}return raw;};
      const safeHeaders=headers.map((heading,index)=>spreadsheet(heading,null,'column-'+index));
      need(new Set(safeHeaders).size===safeHeaders.length,'TARGET_FIELDS','Spreadsheet-safe column headings must remain distinct.');
      const rows=selected.map(r=>[r.id,r.source_url,r.disposition,...mapping.map(([field])=>spreadsheet(Object.hasOwn(r.values,field)?plain(r.values[field]):'',r.id,field))]);
      const review={schema:'tjlabs.public-events-export/v1',format,generated_at:options.generatedAt,workspace:{id:ws.id,revision:ws.revision,title:ws.title,seal:ws.seal},selected_ids:options.entryIds.slice(),exported_ids:options.entryIds.slice(),omitted_ids:[],issues:formulaIssues,target,sources:copy(p.sources),entries:copy(selected),archive:JSON.parse(model.exportArchive(ws))};
      return {...review,files:[{name:'event-collection-complete.json',media_type:'application/json',content:JSON.stringify(review,null,2)+'\n'},{name:'selected-events-review.csv',media_type:'text/csv;charset=utf-8',content:[safeHeaders,...rows].map(row=>row.map(csv).join(',')).join('\r\n')+'\r\n'}]};
    }
    const projection={workspace:{id:ws.id,revision:ws.revision,title:ws.title,seal:ws.seal},entries:selected.map(r=>({...copy(r),withdrawn:r.disposition==='withdrawn'})),archive:JSON.parse(model.exportArchive(ws))};
    const result=buildEventExport(projection,{...options,format,target:{...target,kind:target.adapter||target.kind}});
    result.sources=copy(p.sources);
    result.files[0].content=JSON.stringify(Object.fromEntries(Object.entries(result).filter(([k])=>k!=='files')),null,2)+'\n';
    return result;
  }
  return {buildExport,TEC_FIELD_MAPPING};
}

export { canonical, resolveEventInstant, foldCalendarLine, TEC_FIELD_MAPPING, buildEventExport, createEventExportAdapter };
