// MIT. Editable workbooks use the original planning fields, values and ZIP writer.
import {zipWorkspace} from '../../../../stellar-forge/developer-site/dist/onboarding.mjs';
import {sha256, parseTable, initialMapping} from '../../../../stellar-forge/developer-site/dist/source-table-workspace.mjs';
import {receivePlanningFile} from '../../../../stellar-forge/developer-site/dist/grant-plan-source.mjs';
import {
  ROLES, nativeRoleRows, planningBaseline, planningRoleCsv, createPlanningBook,
  importPlanningBook, rebasePlanningBook, receivePlanningWorkbook,
  changePlanningMapping, retainPlanningTableReview, serializePlanningBook,
} from './source-tables-core.mjs';
import {
  workbookUpload, workbookSelectionBody, validateWorkbookProjection,
  validateWorkbookSource, requireWorkbookProjectCapacity,
} from './source-workbooks.mjs';

export const WORKBOOK_EXPORT_SCHEMA = 'stellar-forge.planning-workbook-export.v1';
export const WORKBOOK_PROFILE_SCHEMA = 'stellar-forge.planning-workbook-export-profile.v1';
export const WORKBOOK_RETURN_SCHEMA = 'stellar-forge.planning-workbook-return-profile.v1';
const MAPPING_SCHEMA = 'stellar-forge.planning-workbook-mapping.v1';
const MAX = 32 * 1024 * 1024;
const encoder = new TextEncoder();
const clone = value => JSON.parse(JSON.stringify(value));
const json = value => JSON.stringify(value, null, 2) + '\n';
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const need = (value, code, message, details={}) => {
  if (!value) throw Object.assign(new Error(message), {code, ...details});
};
const columns = Object.freeze({packages:11,milestones:5,contributors:4,assignments:3});
const titles = Object.freeze({packages:'Work packages',milestones:'Milestones',contributors:'Contributors',assignments:'Assignments'});
const MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PACKAGE_REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

export function defaultPlanningWorkbookProfile() {
  return {schema:WORKBOOK_PROFILE_SCHEMA,numberMode:'exact-text',precisionPolicy:'text',
    amountMode:'native-values',note:''};
}
export function validatePlanningWorkbookProfile(value) {
  need(plain(value) && value.schema === WORKBOOK_PROFILE_SCHEMA &&
    Object.keys(value).sort().join(',') === 'amountMode,note,numberMode,precisionPolicy,schema',
    'WORKBOOK_EXPORT_PROFILE', 'Use the complete saved workbook export choices.');
  need(['exact-text','spreadsheet-numbers'].includes(value.numberMode) &&
    ['text','reject'].includes(value.precisionPolicy) &&
    ['native-values','formulas'].includes(value.amountMode) &&
    typeof value.note === 'string' && value.note.length <= 2000 && !value.note.includes('\0'),
    'WORKBOOK_EXPORT_PROFILE', 'Choose number storage, precision handling, amount cells and a source note.');
  need(value.numberMode !== 'exact-text' || value.amountMode === 'native-values',
    'WORKBOOK_FORMULA_PROFILE', 'Exact text keeps the original native amount values. Select spreadsheet numbers to add amount formulas.');
  return clone(value);
}
export function defaultPlanningWorkbookReturnProfile() {
  return {schema:WORKBOOK_RETURN_SCHEMA,
    modeByRole:Object.fromEntries(Object.keys(ROLES).map(role=>[role,'merge'])),
    orphanPolicy:'preserve',includeHiddenRows:false,note:''};
}
export function validatePlanningWorkbookReturnProfile(value) {
  need(plain(value) && value.schema === WORKBOOK_RETURN_SCHEMA &&
    Object.keys(value).sort().join(',') === 'includeHiddenRows,modeByRole,note,orphanPolicy,schema' &&
    plain(value.modeByRole) && Object.keys(value.modeByRole).sort().join(',') === Object.keys(ROLES).sort().join(',') &&
    Object.values(value.modeByRole).every(mode=>mode==='merge'||mode==='replace') &&
    ['preserve','remove-unreferenced'].includes(value.orphanPolicy) &&
    typeof value.includeHiddenRows === 'boolean' &&
    typeof value.note === 'string' && value.note.trim() && value.note.length <= 2000,
    'WORKBOOK_RETURN_PROFILE', 'Choose merge or replace for every returned table, hidden rows, dependent settings and a receiving note.');
  return clone(value);
}
function xml(value) {
  return String(value).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&apos;');
}
function excelText(value) {
  let text = String(value);
  for (const part of text) {
    const point = part.codePointAt(0);
    need(point < 0xd800 || point > 0xdfff, 'WORKBOOK_UNICODE', 'Retain complete Unicode text in every worksheet cell.');
  }
  need(text.length <= 32767, 'WORKBOOK_CELL_LENGTH', 'A worksheet cell may contain at most 32,767 UTF-16 characters.');
  // Escape literal Excel escape sequences first. Carriage returns need an Excel
  // escape so XML end-of-line normalization does not change the source value.
  text = text.replace(/_x[0-9a-f]{4}_/gi, match=>'_x005F_' + match.slice(1))
    .replace(/[\x00-\x08\x0b-\x0f\x10-\x1f\ufffe\uffff]/g,
      part=>'_x'+part.charCodeAt(0).toString(16).toUpperCase().padStart(4,'0')+'_');
  return xml(text);
}
function letter(value) {
  let text = '';
  while(value) { value--; text = String.fromCharCode(65 + value % 26) + text; value = Math.floor(value/26); }
  return text;
}
function coordinate(value) {
  const match = /^([A-Z]+)([1-9]\d*)$/.exec(String(value));
  need(match, 'WORKBOOK_COORDINATE', 'Use the original worksheet coordinate.');
  let column = 0; for (const part of match[1]) column = column*26 + part.charCodeAt(0)-64;
  const row = Number(match[2]);
  need(column <= 16384 && Number.isSafeInteger(row) && row <= 1048576,
    'WORKBOOK_COORDINATE', 'Keep worksheet coordinates within the original workbook format.');
  return {column,row};
}
function numericCell(value) {
  const text = String(value);
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d{1,5})?$/.test(text)) return false;
  const [coefficient, exponent='0'] = text.replace(/^[+-]/,'').toLowerCase().split('e');
  const parts = coefficient.split('.'), joined = (parts[0] || '') + (parts[1] || '');
  const nonzero = joined.search(/[1-9]/);
  if(nonzero < 0) return true;
  const significant = joined.slice(nonzero).replace(/0+$/,'').length;
  const magnitude = (parts[0] || '').length - nonzero - 1 + Number(exponent);
  return significant <= 15 && magnitude >= -307 && magnitude <= 307;
}
function textCell(ref,value,style=2) {
  return '<c r="'+ref+'" s="'+style+'" t="inlineStr"><is><t xml:space="preserve">'+excelText(value)+'</t></is></c>';
}
function numberCell(ref,value,formula) {
  return '<c r="'+ref+'" s="3">'+(formula?'<f>'+xml(formula)+'</f>':'')+'<v>'+xml(value)+'</v></c>';
}
function selectedValue(value,field,role,ref,profile,decisions) {
  const raw = value === null || value === undefined ? '' : String(value);
  const kind = ROLES[role].fields.find(item=>item[0]===field)?.[2];
  if(raw==='' || !['integer','decimal'].includes(kind)) return {raw,numeric:false};
  const portable = numericCell(raw), numeric = profile.numberMode === 'spreadsheet-numbers' && portable;
  need(profile.numberMode !== 'spreadsheet-numbers' || portable || profile.precisionPolicy === 'text',
    'WORKBOOK_NUMERIC_PRECISION', titles[role]+' '+ref+' ('+field+') needs exact text to retain this value.', {role,cell:ref,value:raw});
  decisions.push({sheet:titles[role],cell:ref,field,sourceText:raw,
    storage:numeric?'number':'text',reason:profile.numberMode==='exact-text'?'selected exact-text profile':
      portable?'within the selected 15-significant-digit numeric policy':'retained as exact text by the selected precision policy'});
  return {raw,numeric};
}
function styles() {
  return XML+'<styleSheet xmlns="'+MAIN+'">'+
    '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>'+
    '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFEAEAEA"/><bgColor indexed="64"/></patternFill></fill></fills>'+
    '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'+
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'+
    '<cellXfs count="4">'+
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'+
    '<xf numFmtId="49" fontId="1" fillId="2" borderId="0" xfId="0" applyAlignment="1" applyFill="1"><alignment vertical="top" wrapText="1"/></xf>'+
    '<xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1" applyNumberFormat="1"><alignment vertical="top" wrapText="1"/></xf>'+
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" horizontal="right"/></xf>'+
    '</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';
}
function sheetXml(headers,rows,{widths,hiddenRows=[],formulas={},nativeValues={},role,profile,decisions=[]}={}) {
  const lastRow = Math.max(2,rows.length+1),lastColumn = letter(headers.length);
  let data = '<row r="1" ht="30" customHeight="1">'+headers.map((value,col)=>textCell(letter(col+1)+'1',value,1)).join('')+'</row>';
  rows.forEach((row,index)=>{
    const rowNumber=index+2;
    data+='<row r="'+rowNumber+'"'+(hiddenRows.includes(rowNumber)?' hidden="1"':'')+'>';
    row.forEach((value,col)=>{
      const ref=letter(col+1)+rowNumber,field=headers[col];
      if(!role) data+=textCell(ref,value);
      else {
        const selected=selectedValue(value,field,role,ref,profile,decisions);
        const formula=formulas[ref];
        if(formula) {
          need(selected.numeric,'WORKBOOK_FORMULA_PRECISION','The cached amount needs a numeric cell.');
          data+=numberCell(ref,nativeValues[ref]??selected.raw,formula);
          const decision=decisions.at(-1);
          if(decision?.cell===ref){decision.storage='formula';decision.formula=formula;}
        } else data+=selected.numeric?numberCell(ref,selected.raw):textCell(ref,selected.raw);
      }
    });
    data+='</row>';
  });
  if(!rows.length) data+='<row r="2">'+headers.map((_,col)=>textCell(letter(col+1)+'2','')).join('')+'</row>';
  const cols=headers.map((_,index)=>'<col min="'+(index+1)+'" max="'+(index+1)+'" width="'+(widths?.[index]??24)+'" customWidth="1"/>').join('');
  return XML+'<worksheet xmlns="'+MAIN+'"><dimension ref="A1:'+lastColumn+lastRow+'"/>'+
    '<sheetViews><sheetView workbookViewId="0"><pane xSplit="1" ySplit="1" topLeftCell="B2" activePane="bottomRight" state="frozen"/></sheetView></sheetViews>'+
    '<sheetFormatPr defaultRowHeight="15"/><cols>'+cols+'</cols><sheetData>'+data+'</sheetData>'+
    (role?'<autoFilter ref="A1:'+lastColumn+Math.max(1,rows.length+1)+'"/>':'')+
    '<pageMargins left="0.3" right="0.3" top="0.5" bottom="0.5" header="0.2" footer="0.2"/>'+
    '<pageSetup orientation="landscape" fitToWidth="1" fitToHeight="0"/>'+
    '<headerFooter><oddFooter>&amp;LGrant planning&amp;RPage &amp;P of &amp;N</oddFooter></headerFooter></worksheet>';
}
function mappingFor(role,lastRow,profile) {
  return {schema:MAPPING_SCHEMA,plan:{name:titles[role]+' from the saved native plan',
    notes:'Explicit exported worksheet layout. Original values, formulas, hidden rows and blank rows remain in the retained workbook.',
    sheet:titles[role],range:'A1:'+letter(columns[role])+Math.max(2,lastRow),headerRow:1,
    hiddenRows:'exclude',blankRows:'skip',mergedCells:'reject',
    columns:ROLES[role].fields.map(([name],index)=>({name,source:letter(index+1),blank:'empty',
      formula:name==='amount_usd'&&profile.amountMode==='formulas'?'cached':'reject',
      error:'reject',date:'raw',trim:false,valueMap:[]}))},
    numericText:Object.fromEntries(ROLES[role].fields.map(([name,_label,type])=>[name,
      ['integer','decimal'].includes(type)?'decimal':'source']))};
}
export async function createPlanningWorkbookArchive(plan,selectedProfile) {
  const baseline=planningBaseline(plan),profile=validatePlanningWorkbookProfile(selectedProfile),tables=[],parts=[],decisions=[];
  for(const role of Object.keys(ROLES)) {
    const parsed=parseTable(planningRoleCsv(plan,role),{delimiter:',',header:true});
    const values=parsed.rows.map(row=>[...row.cells]),formulas={},nativeValues={};
    if(role==='packages'&&profile.amountMode==='formulas') {
      const source=nativeRoleRows(plan,role);
      source.forEach((row,index)=>{
        if(row.pricing_mode!=='hours')return;
        const refs={hours:'E'+(index+2),rate:'F'+(index+2),amount:'G'+(index+2)};
        const eligible=[row.estimated_hours,row.assumed_hourly_rate_usd,row.amount_usd].every(numericCell);
        need(eligible||profile.precisionPolicy==='text','WORKBOOK_FORMULA_PRECISION',
          'Package '+row.id+' needs original native amount values to retain its precision.');
        if(eligible){formulas[refs.amount]=refs.hours+'*'+refs.rate;nativeValues[refs.amount]=String(row.amount_usd);}
      });
    }
    const mapping=mappingFor(role,values.length+1,profile);
    const widths=ROLES[role].fields.map(([_name,_label,type])=>type==='text'?55:type==='id'?24:19);
    const content=sheetXml(parsed.headings,values,{widths,formulas,nativeValues,role,profile,decisions});
    parts.push({path:'xl/worksheets/sheet'+(tables.length+1)+'.xml',content});
    tables.push({role,sheet:titles[role],headers:parsed.headings,rows:values,
      range:mapping.plan.range,mapping,sourceRows:values.length,sourceCsv:planningRoleCsv(plan,role)});
  }
  const source={id:baseline.id,revision:baseline.revision,contentSha256:baseline.contentSha256,
    name:baseline.name,source:clone(baseline.source??{})};
  const readme=[
    ['Saved plan',source.name],['Saved revision',String(source.revision)],['Source plan ID',source.id],
    ['Saved content identity',source.contentSha256],['Scenario',plan.scenario.scenario_name],
    ['Requested award (USD)',String(plan.scenario.award_request_usd)],['Project end day',String(plan.scenario.project_end_day)],
    ['Calendar start',plan.planning.calendarStart??''],['Number storage',profile.numberMode],
    ['Excess precision',profile.precisionPolicy],['Work-package amount cells',profile.amountMode],['Export note',profile.note],
    ['Editing','Edit the four planning sheets. Keep their headings and sheet names. Add rows below the header; retain identifiers for existing records.'],
    ['Receiving','Open the saved source project and receive the returned workbook with the saved return profile. Review all returned tables, choose merge or replace, calculate the native preview and save a named revision.'],
    ['Formula results','Formulas contain the saved native amount as their initial stored result. A spreadsheet application recalculates edited formula cells. Save the workbook after recalculation and review the returned values in Grant Operations.'],
    ['Exact values','The original native plan and export settings accompany this workbook. Exact-text cells preserve the source spelling; spreadsheet-number cells use the explicit precision policy.'],
    ['Budget calculation','Grant Operations computes the complete budget, cash timing and capacity from reviewed inputs. The saved native plan is included in planning.zip.'],
    ...tables.map(table=>['Planning range · '+table.sheet,table.range]),
  ];
  parts.push({path:'xl/worksheets/sheet5.xml',content:sheetXml(['Item','Detail'],readme,{widths:[30,110]})});
  const workbook=XML+'<workbook xmlns="'+MAIN+'" xmlns:r="'+REL+'"><workbookPr date1904="0"/>'+
    '<bookViews><workbookView activeTab="0"/></bookViews><sheets>'+
    [...tables.map(table=>table.sheet),'Read me'].map((name,index)=>'<sheet name="'+xml(name)+'" sheetId="'+(index+1)+'" r:id="rId'+(index+1)+'"/>').join('')+
    '</sheets><definedNames>'+tables.map(table=>'<definedName name="Grant_'+table.role+'">'+
      xml("'"+table.sheet+"'!"+table.range.split(':').map(ref=>ref.replace(/^([A-Z]+)(\d+)$/,'$$$1$$$2')).join(':'))+'</definedName>').join('')+
    '</definedNames><calcPr calcId="0" calcMode="auto" fullCalcOnLoad="0" forceFullCalc="0"/></workbook>';
  parts.unshift({path:'[Content_Types].xml',content:XML+'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'+
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>'+
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'+
    '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'+
    Array.from({length:5},(_,i)=>'<Override PartName="/xl/worksheets/sheet'+(i+1)+'.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>').join('')+'</Types>'},
    {path:'_rels/.rels',content:XML+'<Relationships xmlns="'+PACKAGE_REL+'"><Relationship Id="workbook" Type="'+REL+'/officeDocument" Target="xl/workbook.xml"/></Relationships>'},
    {path:'xl/workbook.xml',content:workbook},
    {path:'xl/_rels/workbook.xml.rels',content:XML+'<Relationships xmlns="'+PACKAGE_REL+'">'+
      Array.from({length:5},(_,i)=>'<Relationship Id="rId'+(i+1)+'" Type="'+REL+'/worksheet" Target="worksheets/sheet'+(i+1)+'.xml"/>').join('')+
      '<Relationship Id="styles" Type="'+REL+'/styles" Target="styles.xml"/></Relationships>'},
    {path:'xl/styles.xml',content:styles()});
  const raw=zipWorkspace(parts);
  need(raw.length<=MAX,'WORKBOOK_EXPORT_CAPACITY','The complete workbook exceeds the original 32 MiB source project.');
  return {schema:WORKBOOK_EXPORT_SCHEMA,source,profile,tables,decisions,parts,
    workbook:{filename:'planning.xlsx',bytes:raw.length,sha256:await sha256(raw),data:raw}};
}
function configureRole(book,role,csv,mode) {
  const next=clone(book),binding=next.bindings.find(row=>row.role===role);
  need(binding,'WORKBOOK_ROLE','Retain the complete received planning table.');
  const mapping=initialMapping(csv,{delimiter:',',header:true,skipEmptyRecords:false});
  mapping.keyColumns=ROLES[role].keys.map(key=>mapping.columns.find(column=>column.sourceName===key).index);
  for(const column of mapping.columns) {
    const type=ROLES[role].fields.find(field=>field[0]===column.sourceName)?.[2];
    if(type==='integer')column.type='integer';
    else if(type==='decimal')column.type='decimal-text';
  }
  const mapped=changePlanningMapping(next,role,mapping),target=mapped.bindings.find(row=>row.role===role);
  target.mode=mode;target.excludedRows=[];
  target.fields=Object.fromEntries(ROLES[role].fields.map(([name])=>[name,{source:'column',column:name}]));
  return mapped;
}
function originalCellsMatch(body,table) {
  need(body.rows.length===table.rows.length,'WORKBOOK_EXPORT_ROWS','The original reader must recover every exported '+table.sheet+' row.');
  body.rows.forEach((row,index)=>row.cells.forEach((cell,column)=>{
    need(cell.field===table.headers[column]&&String(cell.original.value??'')===String(table.rows[index][column]??''),
      'WORKBOOK_EXPORT_CELL','The original reader differs from the saved native value at '+table.sheet+' '+letter(column+1)+(index+2)+'.');
  }));
}
function savedReference(plan) {return {id:plan.id,revision:plan.revision,contentSha256:plan.contentSha256};}
export async function preparePlanningWorkbookHandover(plan,profile,{nativeZip,projectWorkbook,inflate}={}) {
  need(nativeZip instanceof Uint8Array&&typeof projectWorkbook==='function','WORKBOOK_HANDOVER_INPUT',
    'Supply the selected original planning ZIP and its complete native workbook reader.');
  const received=await receivePlanningFile(nativeZip,{filename:'planning.zip',...(inflate?{inflate}:{})});
  const revision=received.document.revisions.find(row=>row.revision===received.document.currentRevision);
  need(received.document.id===plan.id&&revision?.revision===plan.revision&&revision.contentSha256===plan.contentSha256,
    'WORKBOOK_NATIVE_REVISION','The planning ZIP must contain the exact selected saved revision.');
  const output=await createPlanningWorkbookArchive(plan,profile);
  let book=plan.planning.sourceTables?rebasePlanningBook(await importPlanningBook(plan.planning.sourceTables),plan):
    createPlanningBook(plan,{name:plan.name+' workbook handover'});
  book.settings={...book.settings,scenarioName:plan.scenario.scenario_name,
    awardRequestUsd:String(plan.scenario.award_request_usd),projectEndDay:plan.scenario.project_end_day};
  book.workbookExportProfile=clone(output.profile);
  let source=await workbookUpload(output.workbook.filename,output.workbook.data);
  const projections=[];
  for(const table of output.tables) {
    const result=await projectWorkbook({source,mapping:table.mapping});
    await validateWorkbookSource(result.source);
    const body=await validateWorkbookProjection(result.projection,result.source);
    need(result.source.sha256===output.workbook.sha256,'WORKBOOK_EXPORT_SOURCE','Retain the exact original exported workbook.');
    originalCellsMatch(body,table);
    book=await receivePlanningWorkbook(book,{role:table.role,source:result.source,projection:result.projection});
    book=configureRole(book,table.role,body.csv.text,'replace');
    book=await retainPlanningTableReview(book,table.role);
    projections.push({role:table.role,body});source=result.source;
  }
  requireWorkbookProjectCapacity(book);
  const returnProfile=defaultPlanningWorkbookReturnProfile();
  returnProfile.note='Receive the complete returned workbook against saved revision '+plan.revision+'. Review each table before calculating native changes.';
  const files=[
    {path:'planning.xlsx',content:output.workbook.data},
    {path:'planning.zip',content:nativeZip},
    {path:'WORKBOOK_PROFILE.json',content:json(output.profile)},
    {path:'RETURN_PROFILE.json',content:json(returnProfile)},
    {path:'planning-source-project.json',content:serializePlanningBook(book)},
    {path:'WORKBOOK_GUIDE.md',content:planningWorkbookHandoverGuide(output)},
    ...output.tables.map(table=>({path:'mappings/'+table.role+'.json',content:json(table.mapping)})),
    ...projections.map(row=>({path:'tables/'+row.role+'.csv',content:row.body.csv.text})),
  ];
  const manifest={schema:WORKBOOK_EXPORT_SCHEMA,source:savedReference(plan),profile:clone(output.profile),
    workbook:{filename:output.workbook.filename,bytes:output.workbook.bytes,sha256:output.workbook.sha256},
    nativeZip:{bytes:nativeZip.length,sha256:await sha256(nativeZip)},
    tables:projections.map(row=>({role:row.role,sheet:row.body.mapping.plan.sheet,range:row.body.mapping.plan.range,
      rows:row.body.rows.length,csvSha256:row.body.csv.sha256})),numericCells:output.decisions,
    files:await Promise.all(files.map(async file=>{const raw=typeof file.content==='string'?encoder.encode(file.content):file.content;
      return {path:file.path,bytes:raw.length,sha256:await sha256(raw)};}))};
  files.push({path:'WORKBOOK_EXPORT.json',content:json(manifest)});
  const bytes=files.reduce((n,file)=>n+(typeof file.content==='string'?encoder.encode(file.content).length:file.content.length),0);
  need(bytes<=128*1024*1024,'WORKBOOK_HANDOVER_CAPACITY','The complete workbook handover exceeds the existing 128 MiB command allowance.');
  const archive=zipWorkspace(files);
  return {manifest,files,book,source,workbook:output.workbook,
    archive:{filename:'planning-workbook-handover.zip',bytes:archive.length,sha256:await sha256(archive),data:archive}};
}
function sourceRange(metadata,width) {
  const raw=metadata.observedRange;
  need(typeof raw==='string','WORKBOOK_RETURN_RANGE','Retain the original reader worksheet range.');
  const ends=raw.split(':'),first=coordinate(ends[0]),last=coordinate(ends.at(-1));
  need(first.row===1&&first.column===1&&last.column===width,'WORKBOOK_RETURN_LAYOUT',
    'The returned planning sheet must start at A1 and keep its declared columns. Use the worksheet selector to review a changed layout.');
  return 'A1:'+letter(width)+Math.max(2,last.row);
}
export async function receivePlanningWorkbookReturn(book,upload,selectedProfile,{inspectWorkbook,projectWorkbook}={}) {
  const profile=validatePlanningWorkbookReturnProfile(selectedProfile);
  need(typeof inspectWorkbook==='function'&&typeof projectWorkbook==='function','WORKBOOK_RETURN_READER',
    'Use the original complete workbook inspection and projection functions.');
  let next=await importPlanningBook(book),source=upload;const received=[];
  const exportProfile=next.workbookExportProfile?validatePlanningWorkbookProfile(next.workbookExportProfile):defaultPlanningWorkbookProfile();
  for(const role of Object.keys(ROLES)) {
    const response=await inspectWorkbook({source,preview:{sheet:titles[role],offset:0,limit:1}});
    await validateWorkbookSource(response.source);source=response.source;
    const metadata=response.preview.metadata,range=sourceRange(metadata,columns[role]);
    const header=response.preview.rows[0]?.cells;
    need(Array.isArray(header)&&header.length===columns[role]&&header.every((cell,index)=>
      String(cell.value??'')===ROLES[role].fields[index][0]&&!cell.formula),
      'WORKBOOK_RETURN_HEADERS','The '+titles[role]+' headings differ from the saved native export. Review the changed layout with the worksheet selector.');
    const mapping=mappingFor(role,coordinate(range.split(':')[1]).row,exportProfile);
    mapping.plan.range=range;mapping.plan.hiddenRows=profile.includeHiddenRows?'include':'exclude';
    mapping.plan.notes=profile.note;
    const result=await projectWorkbook({source,mapping}),body=await validateWorkbookProjection(result.projection,result.source);
    next=await receivePlanningWorkbook(next,{role,source:result.source,projection:result.projection});
    next=configureRole(next,role,body.csv.text,profile.modeByRole[role]);
    source=result.source;
    received.push({role,sheet:titles[role],range,rows:body.rows.length,
      excludedRanges:clone(body.excludedRanges),sourceSha256:result.source.sha256,selectionSha256:result.projection.sha256});
  }
  next.orphanPolicy=profile.orphanPolicy;next.workbookReturnProfile=profile;
  requireWorkbookProjectCapacity(next);
  return {book:next,source,profile,received};
}
export function planningWorkbookHandoverGuide(output) {
  const profile=output.profile,source=output.source;
  return '# Editable grant-plan workbook\n\n'+
    'Saved plan: '+source.name+' · revision '+source.revision+'.\n\n'+
    'The workbook contains the complete work-package, milestone, contributor and assignment tables from that saved native plan. '+
    'planning.zip contains its complete original native history and source. planning-source-project.json retains the exported workbook, its four reader selections and their existing table mappings.\n\n'+
    '## Edit and return\n\n'+
    '1. Keep planning.zip and the original planning.xlsx. Edit a copy of the workbook and save the complete returned XLSX.\n'+
    '2. Keep the four sheet names and the field headings in row 1. Preserve existing identifiers when editing a record. Add records as complete new rows.\n'+
    '3. In Grant Operations, open the intended saved plan and Source tables. Open planning-source-project.json. Choose Receive returned planning workbook and select the saved return choices.\n'+
    '4. Select merge to retain existing records omitted from a returned sheet, or replace to make the returned rows the complete selected table. Choose how dependent assignments/payment settings should be handled. The native preview displays these changes.\n'+
    '5. Review every returned table using the source rows and mappings. Calculate the native preview, enter the review note, apply it to the working plan and save a named revision.\n'+
    '6. Download the complete native planning ZIP and editable source project for the receiving operator.\n\n'+
    '## Saved number choices\n\n'+
    'Number storage: '+profile.numberMode+'. Values outside the numeric precision policy: '+profile.precisionPolicy+
    '. Package amount cells: '+profile.amountMode+'.\n\n'+
    'Exact text retains the original numeric spelling. Spreadsheet-number cells use at most 15 significant decimal digits and the documented range; the selected precision choice retains longer values as text or asks for a different export choice. '+
    'The original numeric spelling and each chosen cell representation are recorded in WORKBOOK_EXPORT.json.\n\n'+
    'Amount formulas, when selected, reference the hours and rate cells and initially retain the original native amount as their stored result. Save the spreadsheet after recalculation when you edit it. '+
    'The importer reads the selected stored results and retains the formulas. Grant Operations computes the complete reviewed budget, payment timing and capacity using its original calculator.\n\n'+
    '## Complete files\n\n'+
    'planning.xlsx, planning.zip, WORKBOOK_PROFILE.json, RETURN_PROFILE.json, WORKBOOK_EXPORT.json, planning-source-project.json, '+
    'four explicit worksheet mappings and four original-reader CSV projections form the complete handover. The source project carries every selected worksheet cell, original XLSX, earlier source edition and review.\n\n'+
    '## Headless workflow\n\n'+
    'Use the existing source-tables CLI export-plan-workbook command with --workspace, --plan, --revision, --profile and --output-directory. '+
    'Receive an edited XLSX with receive-returned-workbook using --project, --file, --return-profile and --output. Then use the existing review, preview and save commands for the original native writer.\n\n'+
    '## Format references\n\n'+
    '- https://learn.microsoft.com/en-us/office/open-xml/spreadsheet/structure-of-a-spreadsheetml-document\n'+
    '- https://learn.microsoft.com/en-us/office/open-xml/spreadsheet/working-with-formulas\n'+
    '- https://learn.microsoft.com/en-us/troubleshoot/microsoft-365-apps/excel/floating-point-arithmetic-inaccurate-result\n';
}

/** Browser controls mount only when the original planning listener supplies its context. */
export function createPlanningWorkbookExport(context) {
  const {getPlan,getBook,store,api,alive,redraw,status,button,field,select,checkbox,
    section,table,details,download,fileChooser}=context;
  const el=(tag,text,className)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=String(text);if(className)node.className=className;return node;};
  let last=null,disposed=false;const openSections=new Set();
  function disclosure(key,label,...children){
    const node=details(label,...children);node.open=openSections.has(key);
    node.addEventListener('toggle',()=>{if(node.open)openSections.add(key);else openSections.delete(key);});
    return node;
  }
  const active=()=>!disposed&&alive();
  const selectedExport=()=>getBook().workbookExportProfile?
    validatePlanningWorkbookProfile(getBook().workbookExportProfile):defaultPlanningWorkbookProfile();
  const selectedReturn=()=>getBook().workbookReturnProfile?clone(getBook().workbookReturnProfile):
    defaultPlanningWorkbookReturnProfile();
  function saveExport(patch) {
    const next=clone(getBook()),value={...selectedExport(),...patch};
    if(value.numberMode==='exact-text'){value.precisionPolicy='text';value.amountMode='native-values';}
    next.workbookExportProfile=validatePlanningWorkbookProfile(value);store(next,{redraw:true,invalidate:false});
  }
  function saveReturn(patch) {
    const next=clone(getBook());next.workbookReturnProfile={...selectedReturn(),...patch};
    store(next,{redraw:true,invalidate:false});
  }
  async function exportPlan() {
    const plan=clone(getPlan()),profile=selectedExport();
    const response=await api('/api/plans/'+encodeURIComponent(plan.id)+'/export.zip?revision='+plan.revision,
      undefined,{download:true});
    const nativeZip=new Uint8Array(await response.arrayBuffer());
    const result=await preparePlanningWorkbookHandover(plan,profile,{
      nativeZip,projectWorkbook:request=>api('/api/source-tables/workbook/project',request)});
    if(!active())return;
    last={kind:'export',result};
    download(result.archive.data,result.archive.filename,'application/zip');
    redraw();status('Downloaded the complete editable workbook handover for saved revision '+plan.revision+'.');
  }
  async function receive(file) {
    need(file.size>0&&file.size<=MAX,'WORKBOOK_CAPACITY','Choose a complete workbook within the original 32 MiB allowance.');
    const profile=validatePlanningWorkbookReturnProfile(selectedReturn());
    const upload=await workbookUpload(file.name,new Uint8Array(await file.arrayBuffer()));
    const result=await receivePlanningWorkbookReturn(getBook(),upload,profile,{
      inspectWorkbook:request=>api('/api/source-tables/workbook/inspect',request),
      projectWorkbook:request=>api('/api/source-tables/workbook/project',request),
    });
    if(!active())return;
    last={kind:'return',result};store(result.book,{redraw:true});
    status('Received all four planning sheets and retained their original workbook cells. Review each mapped table, then calculate the native changes.');
  }
  function render() {
    const plan=getPlan(),profile=selectedExport(),returnProfile=selectedReturn();
    const panel=section('Editable workbook handover',
      'Export the exact saved plan as a workbook with its complete native ZIP, source project and worksheet mappings. Receive the edited workbook through the same Source tables workflow.');
    panel.append(el('p','Selected saved plan: '+plan.name+' · revision '+plan.revision+'. Working edits enter the workbook after saving a native revision.','pt-help'));
    const exportFields=el('div',undefined,'pt-grid');
    exportFields.append(
      select('Number storage',profile.numberMode,[
        ['exact-text','Exact text — retain every saved decimal'],
        ['spreadsheet-numbers','Spreadsheet numbers — use the selected precision policy'],
      ],value=>saveExport({numberMode:value})),
      select('Values beyond numeric precision',profile.precisionPolicy,[
        ['text','Keep the value as exact text'],['reject','Stop the export and identify the value'],
      ],value=>saveExport({precisionPolicy:value})),
      select('Work-package amount cells',profile.amountMode,[
        ['native-values','Saved native amount values'],['formulas','Hours × rate formulas with saved native results'],
      ],value=>saveExport({amountMode:value})),
      field('Workbook handover note',profile.note,value=>saveExport({note:value}),{area:true,maximum:2000}),
    );
    if(profile.numberMode==='exact-text')for(const control of exportFields.querySelectorAll('select')){
      if(control.options[0]?.value==='text'||control.options[0]?.value==='native-values'){
        control.disabled=true;control.dataset.fixedDisabled='true';
      }
    }
    const actions=el('div',undefined,'pt-actions');
    actions.append(button('Export saved plan workbook',exportPlan),
      button('Download workbook choices',()=>download(json(selectedExport()),'WORKBOOK_PROFILE.json')));
    const exportBox=disclosure('export','Export choices',exportFields,el('p',
      'Spreadsheet numbers use an explicit 15-significant-digit policy. Values outside it stay as text or stop the export. The handover records every numeric storage choice.','pt-help'));
    panel.append(exportBox,actions);
    const returnFields=el('div',undefined,'pt-grid');
    for(const [role,definition]of Object.entries(ROLES))returnFields.append(select(definition.label+' receiving',
      returnProfile.modeByRole[role],[
        ['merge','Merge listed identifiers and keep other saved rows'],
        ['replace','Replace this complete collection with the returned rows'],
      ],value=>saveReturn({modeByRole:{...selectedReturn().modeByRole,[role]:value}})));
    returnFields.append(
      select('References to removed rows',returnProfile.orphanPolicy,[
        ['preserve','Keep references for explicit review'],
        ['remove-unreferenced','Remove assignments and payment settings whose source rows were removed'],
      ],value=>saveReturn({orphanPolicy:value})),
      checkbox('Include hidden worksheet rows',returnProfile.includeHiddenRows,value=>saveReturn({includeHiddenRows:value})),
      field('Returned workbook review note',returnProfile.note,value=>saveReturn({note:value}),{area:true,maximum:2000}),
    );
    const receiving=disclosure('return','Receive an edited workbook',el('p',
      'Keep the four sheet names and exact headings. Retain identifiers for existing rows. The saved workbook number and formula choices above also apply to the return.'),
      returnFields);
    const receiveActions=el('div',undefined,'pt-actions');
    receiveActions.append(button('Receive returned workbook',()=>fileChooser('.xlsx',receive)),
      button('Download receiving choices',()=>download(json(validatePlanningWorkbookReturnProfile(selectedReturn())),'RETURN_PROFILE.json')),
      button('Open handover source project',()=>fileChooser('.json',async file=>{
        need(file.size>0&&file.size<=MAX,'WORKBOOK_CAPACITY','Choose the complete saved source project within 32 MiB.');
        const next=await importPlanningBook(await file.text());
        if(!active())return;
        if(JSON.stringify(next)!==JSON.stringify(getBook()))download(serializePlanningBook(getBook()),'previous-planning-source-project.json');
        store(next,{redraw:true});last=null;
        status('Opened the handover source project. Check its saved baseline and the receiving choices before bringing back the edited workbook.');
      })));
    receiving.append(receiveActions);panel.append(receiving);
    if(last?.kind==='export'){
      const result=last.result,summary=section('Complete workbook handover',
        result.files.length+' files for saved revision '+result.manifest.source.revision+'.');
      summary.append(table(['Sheet','Range','Native rows'],result.manifest.tables.map(row=>[row.sheet,row.range,row.rows])));
      const again=el('div',undefined,'pt-actions');
      again.append(button('Download complete handover again',()=>download(result.archive.data,result.archive.filename,'application/zip')),
        button('Download editable workbook',()=>download(result.workbook.data,result.workbook.filename,'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')),
        button('Use exported source project',()=>{
          if(JSON.stringify(getBook())!==JSON.stringify(result.book))download(serializePlanningBook(getBook()),'previous-planning-source-project.json');
          store(clone(result.book),{redraw:true});status('Selected the complete exported source project for receiving the edited workbook.');
        }));
      summary.append(again,disclosure('numbers','Saved number storage choices',table(['Sheet','Cell','Saved value','Workbook storage','Reason'],
        result.manifest.numericCells.map(cell=>[cell.sheet,cell.cell,cell.sourceText,cell.storage,cell.reason]))));
      panel.append(summary);
    }else if(last?.kind==='return'){
      panel.append(section('Returned workbook retained','Review each mapped table below before preparing native changes.'),
        table(['Sheet','Range','Included source rows','Row exclusions'],last.result.received.map(row=>
          [row.sheet,row.range,row.rows,JSON.stringify(row.excludedRanges)])));
    }
    const guide=el('a','Workbook handover operating guide');guide.href='/source-workbook-handover.md';guide.target='_blank';guide.rel='noopener';
    panel.append(guide);return panel;
  }
  return {render,dispose(){disposed=true;last=null;}};
}
