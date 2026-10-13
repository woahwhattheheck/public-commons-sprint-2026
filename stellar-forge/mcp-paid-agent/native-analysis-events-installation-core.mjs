// SPDX-License-Identifier: MIT
// Complete received event work joins the original customer Installation preparer.
import {prepareInstallation,renderWorkorder} from '../../stellar/scf_2026/sf49_data_commissioning/installation-workorders/prepare-core.mjs';
import {eventObject as object,eventNeed as need,validateEventDownloadIndex} from './native-analysis-events-contract.mjs';
export const EVENT_INSTALLATION_SCHEMA='stellar-forge.analysis-event-installation.v1';
export const EVENT_INSTALLATION_PROFILE='webhook-event-analysis';
const clone=value=>JSON.parse(JSON.stringify(value));
export function composeEventInstallation(seed,profile,bindings,index,{analysisWorkspace}={}){
 validateEventDownloadIndex(index);
 need(object(bindings)&&profile?.id===EVENT_INSTALLATION_PROFILE&&
 bindings.profile===profile.id&&typeof analysisWorkspace==='string'&&
 /^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(analysisWorkspace),'INSTALLATION_SELECTION_REQUIRED');
 const chosen=clone(bindings);
 const identity='Original Analysis workspace '+index.workspace_id+', programme '+index.programme+
 '; delivery '+index.delivery_id+'; accepted operation '+index.accepted_operation_id+
 '; selected result '+index.edition_id+'; review '+index.review_sha256+
 '; snapshot programme '+index.workspace_programme_edition_id+' revision '+index.workspace_programme_revision+
 '; complete sixteen-file index '+index.index_sha256+'.';
 for(const section of ['task','source','receiving'])need(chosen[section]===undefined||object(chosen[section]),'INSTALLATION_BINDINGS_INVALID');
 chosen.task??={};chosen.source??={};chosen.receiving??={};
 if(!chosen.source.reference)chosen.source.reference=identity;
 if(!chosen.receiving.application)chosen.receiving.application=profile.receiving.application+
 ' Original selected host alias: '+analysisWorkspace+'. Full original files are retained in delivery/.';
 const prepared=prepareInstallation(seed,profile,chosen);
 need(prepared.document.workshare?.caseId===bindings.workshareCaseId&&
 typeof bindings.workshareCaseId==='string'&&bindings.workshareCaseId.length>0,'ORIGINAL_WORKSHARE_REQUIRED');
 const source={schema:EVENT_INSTALLATION_SCHEMA,analysisWorkspace,workshareCaseId:bindings.workshareCaseId,
 installationSelection:clone(prepared.source),eventIndex:clone(index),
 retainedDirectory:'delivery',originalSeed:'source/seed.json',originalBindings:'source/bindings.json',
 originalProfile:'source/profile.json',derivedBindings:'derived-bindings.json'};
 const table=['| Original customer file | Bytes | SHA-256 |','| --- | ---: | --- |',
 ...index.files.map(file=>'| '+file.name+' | '+file.bytes+' | '+file.sha256+' |')].join('\n');
 const annex='# Complete event customer receiving\n\n'+identity+'\n\n'+
 'Original commercial case: '+bindings.workshareCaseId+'\n\n'+
 'Selected Analysis alias: '+analysisWorkspace+'\n\n'+
 'Every full member below is retained under delivery/. Open the whole report, workbook, source and native archive; '+
 'the exact selected result and programme in the archived database retain their separate identities.\n\n'+table+'\n\n'+
 'The original Installation seed, explicit operator bindings and selected profile are retained under source/. '+
 'installation-input.json and installation-preview-input.json enter the existing Customer installations desk. '+
 'WORKORDER.md contains every original commercial phase, funded assignment, native check and remaining selection. '+
 'Original buyer/payment records continue to own spending and financial outcome.\n';
 return {schema:EVENT_INSTALLATION_SCHEMA,prepared,derivedBindings:chosen,source,
 sourceMarkdown:annex,workorder:renderWorkorder(prepared)};
}
