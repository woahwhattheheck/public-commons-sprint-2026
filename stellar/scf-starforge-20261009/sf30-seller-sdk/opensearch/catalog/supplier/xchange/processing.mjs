// MIT. Original 2BA processing settings and native xChange reference-state effects.
import { clone, canonical } from '../../../workspace/store.mjs';
import { fail, text } from '../model.mjs';
import { object, XCHANGE_PRODUCT_SCHEMA } from './schema.mjs';

export const TWO_BA_PROCESSING_SCHEMA = 'stellar-forge.2ba-processing.v1';
export const TWO_BA_PROCESSING_SOURCE = Object.freeze({
  url: 'https://www.2ba.nl/en/documentation/file-exchange/file-upload/process-parameters/',
  originalLanguageUrl: 'https://www.2ba.nl/documentatie/bestandsuitwisseling/upload-bestanden/process-parameters/',
  nativeFormatUrl: 'https://www.2ba.nl/en/documentation/file-exchange/etim-xchange-v2-0/',
  observedAt: '2026-10-12', filename: 'parameters.xml',
  root: 'UCProcessParameters', namespace: 'http://www.2ba.nl',
  exampleArchiveUrl: 'https://www.2ba.nl/wp-content/uploads/parameters.zip',
  exampleArchiveSha256: 'b7b7a88138ac29952a712af412d33de6010bb45bc414ad50c1dd2ad90a2a682f',
  exampleXmlSha256: 'a1e7a2e4d920126eecd45fa6cb603d9da2deeb508dc9ae0ab4de8b08f2db1d2e'
});
export const TWO_BA_PARAMETER_NAMES = Object.freeze([
  'GeneratedBy', 'PackageDescription', 'SendReportToEmail', 'ReportLanguage',
  'SkipLoadProducts', 'SkipLoadArticlesAndPrices', 'SkipLoadPrices', 'SkipLoadAttachments',
  'InteractiveChecks', 'OverrulePackageMutationCode', 'PackageMutationCode',
  'KeepMimeURL', 'AutoConvertToMasterGLN'
]);
const BOOLEAN = new Set(['SkipLoadProducts','SkipLoadArticlesAndPrices','SkipLoadPrices',
  'SkipLoadAttachments','OverrulePackageMutationCode','AutoConvertToMasterGLN']);
const STRING = new Set(['GeneratedBy','PackageDescription','SendReportToEmail']);
const MDX = new Set(XCHANGE_PRODUCT_SCHEMA.properties.ProductAttachments.items
  .properties.AttachmentTypeSpecification.enum);
const own = (value,key) => Object.hasOwn(value,key);
function keys(value,allowed,label) {
  if (!object(value) || Object.keys(value).some(key => !allowed.includes(key)))
    fail('TWO_BA_PROCESSING_FIELD', label + ' contains an unsupported field; original XML element names are case-sensitive.');
}
function xmlText(value,label) {
  if (typeof value !== 'string') fail('TWO_BA_PARAMETER_TYPE', label + ' must be an original string.');
  for (const char of value) {
    const n=char.codePointAt(0);
    if (!(n===9||n===10||n===13||(n>=0x20&&n<=0xd7ff)||(n>=0xe000&&n<=0xfffd)||(n>=0x10000&&n<=0x10ffff)))
      fail('TWO_BA_PARAMETER_XML', label + ' contains a character XML 1.0 cannot represent.');
  }
  return value;
}
const escaped = value => xmlText(value,'Processing value')
  .replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')
  .replaceAll('"','&quot;').replaceAll("'",'&apos;');

export function normalizeTwoBaProcessing(value,{target,keepMimeUrlCodes=[]}={}) {
  if (target !== '2ba-xchange-2.0')
    fail('TWO_BA_PROCESSING_TARGET','Select the 2BA xChange recipient before adding its processing settings.');
  keys(value,['schema','reason','parameters','source'],'2BA processing selection');
  if (value.schema !== TWO_BA_PROCESSING_SCHEMA)
    fail('TWO_BA_PROCESSING_SCHEMA','Use the versioned 2BA processing selection.');
  keys(value.parameters,TWO_BA_PARAMETER_NAMES,'Processing parameters');
  const reason=text(value.reason,'Reason for the processing selection',2000), parameters={};
  for (const name of TWO_BA_PARAMETER_NAMES) {
    if (!own(value.parameters,name)) continue;
    const entry=value.parameters[name];
    if (BOOLEAN.has(name)) {
      if (typeof entry !== 'boolean') fail('TWO_BA_PARAMETER_TYPE',name+' must be true or false, not a string.');
      parameters[name]=entry;
    } else if (STRING.has(name)) {
      xmlText(entry,name);
      if ([...entry].length>255) fail('TWO_BA_PARAMETER_LENGTH',name+' exceeds the recipient limit of 255 characters.');
      if (name==='SendReportToEmail' && entry!=='' &&
          entry.split(';').some(address=>! /^[^\s;<>@]+@[^\s;<>@]+\.[^\s;<>@]+$/.test(address)))
        fail('TWO_BA_REPORT_EMAIL','Enter complete report email addresses separated by semicolons.');
      parameters[name]=entry;
    } else if (name==='ReportLanguage') {
      if (!['EN','NL'].includes(entry)) fail('TWO_BA_REPORT_LANGUAGE','Choose the original report language EN or NL.');
      parameters[name]=entry;
    } else if (name==='PackageMutationCode') {
      if (!['ReplaceExistingCatalog','UpdateExistingCatalog'].includes(entry))
        fail('TWO_BA_MUTATION_CODE','Choose ReplaceExistingCatalog or UpdateExistingCatalog.');
      parameters[name]=entry;
    } else if (name==='InteractiveChecks') {
      if (!Array.isArray(entry)||entry.length>2) fail('TWO_BA_INTERACTIVE_CHECKS','Choose at most one attachment solution for each dataset type.');
      const codes=new Set(), checks=[];
      for (const item of entry) {
        keys(item,['Code','SolutionId'],'Interactive attachment check');
        const allowed=item.Code==='7000160'?['106','108']:item.Code==='7000161'?['165','166']:null;
        if (!allowed||!allowed.includes(item.SolutionId)||codes.has(item.Code))
          fail('TWO_BA_INTERACTIVE_CHECKS','Use 7000160 with 106/108, or 7000161 with 165/166; each code occurs once.');
        codes.add(item.Code);checks.push({Code:item.Code,SolutionId:item.SolutionId});
      }
      parameters[name]=checks.sort((a,b)=>a.Code.localeCompare(b.Code,'en'));
    } else if (name==='KeepMimeURL') {
      xmlText(entry,name);
      if (entry.length>1024 || (entry!==''&&entry!=='*'&&
          entry.split(';').some(code=>!MDX.has(code))))
        fail('TWO_BA_KEEP_URL_CODES','Use original xChange MDX codes separated by semicolons, or *. BMEcat MD codes are a different code list.');
      if (entry!==''&&entry!=='*'&&new Set(entry.split(';')).size!==entry.split(';').length)
        fail('TWO_BA_KEEP_URL_CODES','Each selected native MDX code occurs once.');
      parameters[name]=entry;
    }
  }
  if (parameters.OverrulePackageMutationCode===true&&!own(parameters,'PackageMutationCode'))
    fail('TWO_BA_MUTATION_SELECTION','Choose the explicit complete or mutation processing method when overriding the native catalogue type.');
  if (!Array.isArray(keepMimeUrlCodes)||keepMimeUrlCodes.some(code=>!MDX.has(code)))
    fail('TWO_BA_KEEP_URL_CODES','The attachment policy must use original xChange MDX codes from the selected schema.');
  const selected=[...new Set(keepMimeUrlCodes)].sort();
  if (selected.length) {
    const supplied=parameters.KeepMimeURL;
    if (supplied!==undefined && canonical(supplied==='*'?['*']:supplied.split(';').sort())!==canonical(selected))
      fail('TWO_BA_KEEP_URL_CONFLICT','The processing KeepMimeURL and saved attachment policy select different codes; use one matching selection.');
    if (supplied===undefined) parameters.KeepMimeURL=selected.join(';');
  }
  return {schema:TWO_BA_PROCESSING_SCHEMA,reason,parameters,source:clone(TWO_BA_PROCESSING_SOURCE)};
}

export function twoBaProcessingEffects(profile,nativeCatalogueType) {
  if (!own(profile,'processing')) return null;
  const selected=normalizeTwoBaProcessing(profile.processing,{
    target:profile.target,keepMimeUrlCodes:profile.attachmentPolicy?.keepMimeUrlCodes??[]
  });
  const p=selected.parameters;
  const effectiveCatalogueType=p.OverrulePackageMutationCode===true
    ? (p.PackageMutationCode==='ReplaceExistingCatalog'?'FULL':'CHANGE') : nativeCatalogueType;
  const checkCode=effectiveCatalogueType==='FULL'?'7000160':effectiveCatalogueType==='CHANGE'?'7000161':null;
  const check=p.InteractiveChecks?.find(item=>item.Code===checkCode)??null;
  const attachmentMode=p.SkipLoadAttachments===true?'skip':
    check&&['106','166'].includes(check.SolutionId)?'keep-omitted':
    check&&['108','165'].includes(check.SolutionId)?'delete-omitted':'recipient-interactive';
  return {schema:'stellar-forge.2ba-processing-effects.v1',
    parameters:clone(p),reason:selected.reason,source:clone(selected.source),
    nativeCatalogueType,effectiveCatalogueType,
    skipProducts:p.SkipLoadProducts===true,skipTradeItems:p.SkipLoadArticlesAndPrices===true,
    skipPrices:p.SkipLoadPrices===true||p.SkipLoadArticlesAndPrices===true,
    attachments:{mode:attachmentMode,checkCode:check?.Code??null,solutionId:check?.SolutionId??null,
      keepMimeURL:p.KeepMimeURL??null,referenceIdentity:'native type, specification, URI and language'},
    masterGln:p.AutoConvertToMasterGLN===true?'recipient-account-mapping':'original-supplier',
    reportLanguage:p.ReportLanguage??'NL',
    reportDestination:p.SendReportToEmail??null};
}

export function twoBaParametersDescriptor(profile) {
  if (!own(profile,'processing')) fail('TWO_BA_PROCESSING_REQUIRED','Save and review an explicit 2BA processing selection before exporting the upload package.');
  const selected=normalizeTwoBaProcessing(profile.processing,{
    target:profile.target,keepMimeUrlCodes:profile.attachmentPolicy?.keepMimeUrlCodes??[]
  });
  const rows=['<?xml version="1.0" encoding="utf-8"?>',
    '<UCProcessParameters xmlns="'+TWO_BA_PROCESSING_SOURCE.namespace+'">'];
  for (const name of TWO_BA_PARAMETER_NAMES) {
    if (!own(selected.parameters,name)) continue;
    const value=selected.parameters[name];
    if (name==='InteractiveChecks') {
      rows.push('  <InteractiveChecks>');
      for (const check of value) rows.push('    <Check Code="'+check.Code+'" SolutionId="'+check.SolutionId+'"/>');
      rows.push('  </InteractiveChecks>');
    } else rows.push('  <'+name+'>'+escaped(typeof value==='boolean'?String(value):value)+'</'+name+'>');
  }
  rows.push('</UCProcessParameters>','');
  const body=rows.join('\n');
  if (Buffer.byteLength(body)>64*1024) fail('TWO_BA_PARAMETERS_SIZE','The complete processing XML exceeds 64 KiB.');
  return {type:'application/xml; charset=utf-8',filename:'parameters.xml',body};
}

function atField(path,field) { return path==='/'+field||path.startsWith('/'+field+'/'); }
function replaceField(after,before,field) {
  const tokens=after.numberTokens??{};
  for (const path of Object.keys(tokens)) if(atField(path,field)) delete tokens[path];
  if (before&&own(before.body,field)) {
    after.body[field]=clone(before.body[field]);
    for (const [path,token] of Object.entries(before.numberTokens??{})) if(atField(path,field)) tokens[path]=token;
  } else delete after.body[field];
  after.numberTokens=tokens;
}
function detailKey(attachment,detail) {
  if(!object(attachment)||!object(detail)||typeof detail.AttachmentUri!=='string') return null;
  return canonical([attachment.AttachmentType??null,attachment.AttachmentTypeSpecification??null,
    detail.AttachmentUri,detail.AttachmentLanguage??null]);
}
function omittedAttachments(current,before,field) {
  const supplied=Array.isArray(current.body[field])?current.body[field]:[];
  const prior=Array.isArray(before?.body[field])?before.body[field]:[];
  const keys=new Set();
  for(const attachment of supplied) for(const detail of Array.isArray(attachment?.AttachmentDetails)?attachment.AttachmentDetails:[]) {
    const key=detailKey(attachment,detail);if(key!==null)keys.add(key);
  }
  const omitted=[];
  for(let index=0;index<prior.length;index++) {
    const attachment=prior[index];if(!object(attachment)||!Array.isArray(attachment.AttachmentDetails))continue;
    const details=[];
    for(let n=0;n<attachment.AttachmentDetails.length;n++) {
      const detail=attachment.AttachmentDetails[n],key=detailKey(attachment,detail);
      if(key!==null&&!keys.has(key)) details.push({index:n,value:detail});
    }
    if(details.length)omitted.push({index,attachment,details});
  }
  return omitted;
}
function appendOmitted(after,before,field,omitted) {
  const rows=Array.isArray(after.body[field])?clone(after.body[field]):[];
  const tokens=after.numberTokens??{};
  for(const prior of omitted) {
    const next=rows.length,attachment=clone(prior.attachment);
    attachment.AttachmentDetails=prior.details.map(item=>clone(item.value));
    rows.push(attachment);
    const oldPrefix='/'+field+'/'+prior.index,newPrefix='/'+field+'/'+next;
    for(const [path,token] of Object.entries(before.numberTokens??{})) {
      if(path!==oldPrefix&&!path.startsWith(oldPrefix+'/'))continue;
      const rest=path.slice(oldPrefix.length);
      const match=/^\/AttachmentDetails\/([0-9]+)(\/.*)?$/.exec(rest);
      if(match) {
        const newIndex=prior.details.findIndex(item=>item.index===Number(match[1]));
        if(newIndex!==-1) tokens[newPrefix+'/AttachmentDetails/'+newIndex+(match[2]??'')]=token;
      } else tokens[newPrefix+rest]=token;
    }
  }
  if(rows.length||own(after.body,field))after.body[field]=rows;
  after.numberTokens=tokens;
}

// The source message is unchanged. These are the reference-state effects displayed
// beside that message, with exact old numeric tokens retained for skipped subtrees.
export function applyTwoBaRetainedFields({kind,current,previous,effects}) {
  if(!effects) return {current,omittedAttachmentCount:0,unresolvedAttachments:false,details:null};
  const bodyKey=kind==='product'?'product':'item',field=kind==='product'?'ProductAttachments':'ItemAttachments';
  const next=clone(current),after={body:next[bodyKey],numberTokens:next.numberTokens??{}};
  const before=previous?{body:previous[bodyKey],numberTokens:previous.numberTokens??{}}:null;
  const details={prices:kind==='tradeItem'&&effects.skipPrices?'retained-previous':'supplied',
    attachments:effects.attachments.mode};
  if(kind==='tradeItem'&&effects.skipPrices)replaceField(after,before,'Pricing');
  const omitted=omittedAttachments(after,before,field);
  const count=omitted.reduce((n,item)=>n+item.details.length,0);
  if(effects.attachments.mode==='skip')replaceField(after,before,field);
  else if(effects.attachments.mode==='keep-omitted'&&before)appendOmitted(after,before,field,omitted);
  next[bodyKey]=after.body;next.numberTokens=after.numberTokens;
  return {current:next,omittedAttachmentCount:count,
    unresolvedAttachments:effects.attachments.mode==='recipient-interactive'&&count>0,details};
}
