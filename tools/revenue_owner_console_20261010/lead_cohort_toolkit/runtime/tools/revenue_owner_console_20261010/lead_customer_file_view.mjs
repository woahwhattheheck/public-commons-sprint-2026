/** File preparation stays in the existing monochrome lead fulfillment desk. */
const input=(name,label,type='text',extra='')=>'<label>'+label+'<input name="'+name+'" type="'+type+'" '+extra+'></label>';
const area=(name,label,rows=3,extra='')=>'<label>'+label+'<textarea name="'+name+'" rows="'+rows+'" '+extra+'></textarea></label>';
export function renderLeadCustomerFilesPanel(){
  return '<section id="cf-panel" hidden aria-labelledby="cf-title"><h2 id="cf-title">Complete customer files</h2>'+
    '<p>Keep the worksheets, operating guides and original files for this customer. Prepare an explicit package against its saved sample, paid selection or replacement.</p>'+
    '<div class="actions"><button id="cf-new" type="button">Add a customer file</button><button id="cf-download-draft" type="button">Download current file draft</button></div>'+
    '<div id="cf-files"></div><details id="cf-editor"><summary>Prepare or revise a customer file</summary>'+
    '<form id="cf-file-form">'+input('id','Original file ID','text','required maxlength="160"')+
    input('upload','Complete file','file')+'<p id="cf-byte-status" class="muted">Choose the complete original file.</p>'+
    '<p id="cf-incoming-status" hidden></p><button id="cf-use-incoming" type="button" hidden>Use the retained incoming file</button>'+
    '<div class="grid">'+input('name','Customer filename or relative path','text','required maxlength="240" placeholder="onboarding/worksheet.csv"')+
    input('title','Customer file title','text','required maxlength="300"')+
    input('type','File type','text','required maxlength="160" value="application/octet-stream"')+
    input('source_url','Original public source, when applicable','url','maxlength="4000"')+'</div>'+
    area('description','How the customer uses this file',3,'required maxlength="8000"')+
    '<fieldset><legend>Companies contained in this file</legend><label><input name="common" type="checkbox">Common customer instructions, with no company-specific records</label>'+
    '<div id="cf-file-scope"></div><p>A file containing several companies can enter a package only when every one of those companies is selected in its lead edition.</p></fieldset>'+
    '<div class="actions"><button id="cf-preview-file" type="button">Review complete file</button><button id="cf-save-file" type="submit" disabled>Save reviewed file</button>'+
    '<button id="cf-close-file" type="button">Close file draft</button></div><div id="cf-file-preview" aria-live="polite"></div></form></details>'+
    '<details><summary>Import complete files from JSON</summary><form id="cf-import-form">'+
    input('upload','Complete file-source JSON','file','accept=".json,application/json"')+
    area('json','Complete file records',9,'spellcheck="false"')+
    '<p>Use an object with pack_id and files. Each file has its stable id and complete document, including original base64 bytes, byte count, SHA-256, filename, type, description and lead_ids. The CLI also reads selected local files directly.</p>'+
    '<div class="actions"><button id="cf-preview-import" type="button">Review all incoming files</button><button id="cf-save-import" type="submit" disabled>Save reviewed files</button></div>'+
    '<div id="cf-import-preview" aria-live="polite"></div></form></details>'+
    '<h3>Prepare a complete customer package</h3><form id="cf-package-form"><div class="grid">'+
    '<label>Original lead edition<select name="edition_id" required></select></label>'+
    '<label>Earlier package being updated<select name="supersedes"><option value="">New complete package</option></select></label>'+
    input('title','Customer package title','text','required maxlength="300"')+'</div>'+
    area('instructions','Customer opening and operating instructions',4,'required maxlength="16000"')+
    area('reason','Reason for updating the earlier package',2,'maxlength="4000"')+
    '<div id="cf-package-files"></div><p id="cf-package-selection" class="muted"></p>'+
    '<div class="actions"><button id="cf-preview-package" type="button">Review complete package</button><button id="cf-save-package" type="submit" disabled>Prepare reviewed customer package</button></div>'+
    '<div id="cf-package-preview" aria-live="polite"></div></form><h3>Saved complete customer packages</h3><div id="cf-packages"></div></section>';
}
