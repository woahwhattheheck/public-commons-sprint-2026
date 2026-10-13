// MIT. Host-owned aliases for existing report-editorial Analysis sessions.
import {dirname,resolve} from 'node:path';
import {readWorkflowSeriesPrivateFile} from './workflow-series-connection.mjs';
import {need,plain,REPORT_REVIEW_ID,REPORT_REVIEW_ALIAS} from './report-editorial-records.mjs';
export {REPORT_REVIEW_ALIAS} from './report-editorial-records.mjs';
export async function readReportEditorialConfiguration(filename){
  filename=resolve(filename);
  const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await readWorkflowSeriesPrivateFile(filename,1024*1024)));
  need(plain(value)&&value.schema==='stellar-forge.report-editorial-connection.v1'&&
    Object.keys(value).every(k=>['schema','workspaces'].includes(k))&&plain(value.workspaces)&&
    Object.keys(value.workspaces).length>=1&&Object.keys(value.workspaces).length<=100,
    'Declare the existing Analysis workspace aliases.');
  const workspaces=Object.create(null);
  for(const[alias,item]of Object.entries(value.workspaces)){
    need(REPORT_REVIEW_ALIAS.test(alias)&&plain(item)&&
      Object.keys(item).every(k=>['label','workspaceId','launchFile'].includes(k))&&
      typeof item.label==='string'&&item.label.trim()&&item.label.length<=160&&
      REPORT_REVIEW_ID.test(item.workspaceId)&&typeof item.launchFile==='string'&&item.launchFile.length>=1&&
      item.launchFile.length<=4000&&!/[\x00-\x1f]/.test(item.launchFile),'Declare the exact original workspace and private launch file.');
    workspaces[alias]={label:item.label,workspaceId:item.workspaceId,launchFile:resolve(dirname(filename),item.launchFile)};
  }
  return{schema:value.schema,workspaces};
}
