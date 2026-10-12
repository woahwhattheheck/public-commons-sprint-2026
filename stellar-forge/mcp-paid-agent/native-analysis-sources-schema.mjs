// SPDX-License-Identifier: MIT
// Import-only schema for saved native purchase → original analytical source registration.
const name={type:'string',pattern:'^[A-Za-z][A-Za-z0-9_-]{0,63}$'};
const originalId={type:'string',pattern:'^[A-Za-z0-9._:-]{1,128}$'};
const revision={type:'integer',minimum:0};
export const nativeSourceOperations=Object.freeze({
  'response-inboxes':{properties:{},required:[],description:'List immutable host-registered original read-only inbox aliases.'},
  'saved-responses':{properties:{inbox_alias:name,offset:revision,limit:{type:'integer',minimum:1,maximum:100}},required:[],
    description:'Inspect original retained requests in the default native inbox or one host-registered original inbox. No request runs.'},
  'attach-object':{
    properties:{name,acquisition_id:originalId,format:{type:'string',enum:['json','csv']},expected_revision:revision},
    required:['name','acquisition_id','format','expected_revision'],
    description:'Attach a complete recorded original object assembly for analytical JSON/CSV use; no acquisition or assembly.'
  },
  'attach-response':{
    properties:{name,intent_id:originalId,inbox_alias:name,format:{type:'string',enum:['json','csv','ndjson','sse']},expected_revision:revision},
    required:['name','intent_id','format','expected_revision'],
    description:'Attach an existing SAVED response from the default MCP inbox or an explicit host inbox alias. Preserve original outcome and stream completion.'
  },
});

