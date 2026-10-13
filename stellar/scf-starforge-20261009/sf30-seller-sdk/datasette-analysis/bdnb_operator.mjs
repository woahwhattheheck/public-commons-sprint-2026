// MIT. Complete BDNB operator workflow on the original Analysis writer.
function createBdnbJournal(scope) {
  const schema = 'stellar-forge.bdnb-browser-working-file.v1';
  const clone = value => JSON.parse(JSON.stringify(value));
  const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const stable = value => value === null || typeof value !== 'object' ? JSON.stringify(value)
    : Array.isArray(value) ? '[' + value.map(stable).join(',') + ']'
    : '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + stable(value[key])).join(',') + '}';
  let value = {schema, scope, drafts: {}, selected: {}, pending: {}, history: [], view: 'source'};
  let revision = 0, queue = Promise.resolve(), failure = null;
  function validate(body) {
    if (!object(body) || body.schema !== schema || body.scope !== scope
      || !object(body.drafts) || !object(body.selected) || !object(body.pending)
      || !Array.isArray(body.history) || typeof body.view !== 'string')
      throw new Error('Choose the complete BDNB working file for this workspace and operation.');
    for (const draft of Object.values(body.drafts))
      if (!object(draft) || Object.values(draft).some(item => typeof item !== 'string' && typeof item !== 'boolean'))
        throw new Error('A saved form must retain its original text and checked values.');
    for (const [key, item] of Object.entries(body.pending)) {
      if (!object(item) || !object(item.envelope) || item.envelope.request_id !== key
        || !/^[a-f0-9]{32}$/.test(key) || !['bdnb.import','bdnb.select','bdnb.compare','bdnb.review','bdnb.publish','bdnb.pack'].includes(item.envelope.action)
        || !object(item.envelope.body) || typeof item.preparedAt !== 'string')
        throw new Error('The working file contains an incomplete original request.');
    }
    for (const item of body.history)
      if (!object(item) || !object(item.envelope) || !object(item.observation) || typeof item.reason !== 'string')
        throw new Error('The working file contains an incomplete retained request history.');
    return body;
  }
  async function open() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('stellar-forge-bdnb-working-files', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('workspaces', {keyPath: 'scope'});
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('BDNB working-file storage could not open.'));
    });
  }
  async function readSaved() {
    const db = await open();
    try {
      return await new Promise((resolve, reject) => {
        const tx = db.transaction('workspaces', 'readonly'), request = tx.objectStore('workspaces').get(scope);
        let result;
        request.onsuccess = () => {result = request.result;};
        tx.oncomplete = () => resolve(result || null);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error || new Error('The working-file read stopped.'));
      });
    } finally {db.close();}
  }
  async function commit(body) {
    const db = await open();
    try {
      return await new Promise((resolve, reject) => {
        const tx = db.transaction('workspaces', 'readwrite'), records = tx.objectStore('workspaces');
        const request = records.get(scope);
        let conflict = null;
        request.onsuccess = () => {
          if ((request.result?.journalRevision || 0) !== revision) {
            conflict = new Error('Another tab saved this working file. Download your edits, then load its saved edition.');
            tx.abort(); return;
          }
          records.put({...body, journalRevision: revision + 1});
        };
        tx.oncomplete = () => {revision++; resolve(revision);};
        tx.onerror = () => reject(conflict || tx.error);
        tx.onabort = () => reject(conflict || tx.error || new Error('The working-file save stopped.'));
      });
    } finally {db.close();}
  }
  function save() {
    const body = clone(value);
    queue = queue.catch(() => {}).then(async () => {
      if (failure) throw failure;
      try {await commit(body);} catch (error) {failure = error; throw error;}
    });
    return queue;
  }
  async function reload() {
    await queue.catch(() => {});
    const saved = await readSaved();
    if (saved) {
      validate(saved);
      if (!Number.isSafeInteger(saved.journalRevision) || saved.journalRevision < 1)
        throw new Error('The saved working-file revision is invalid.');
      revision = saved.journalRevision;
      value = clone(saved); delete value.journalRevision;
    } else {
      revision = 0;
      value = {schema, scope, drafts: {}, selected: {}, pending: {}, history: [], view: 'source'};
    }
    failure = null;
    return clone(value);
  }
  function matches(envelope, request) {
    if (!object(request) || request.id !== envelope.request_id || request.action !== envelope.action
      || request.operation_id !== scope.slice(scope.lastIndexOf(':') + 1)
      || stable(request.body) !== stable(envelope.body))
      throw new Error('The observed request differs from its original workspace, operation or complete body.');
    return request;
  }
  return {
    open: reload,
    reload,
    snapshot: () => clone(value),
    pending: () => clone(value.pending),
    error: () => failure,
    flush: async () => {await queue; if (failure) throw failure;},
    draft: key => clone(value.drafts[key] || {}),
    async setDraft(key, body) {value.drafts[key] = clone(body); return save();},
    async select(key, selected) {value.selected[key] = clone(selected); return save();},
    async view(view) {value.view = view; return save();},
    async prepare(envelope) {
      await queue;
      if (failure) throw failure;
      if (Object.keys(value.pending).length)
        throw new Error('Reconnect the original BDNB request in Working file before creating another.');
      const item = {envelope: clone(envelope), preparedAt: new Date().toISOString()};
      validate({...value, pending: {[envelope.request_id]: item}});
      value.pending[envelope.request_id] = item;
      await save();
    },
    async observe(request) {
      const item = value.pending[request.id];
      if (!item) return false;
      matches(item.envelope, request);
      if (stable(item.observation) === stable(request)
        || item.observation?.status === 'COMPLETE' && request.status !== 'COMPLETE'
        || String(item.observation?.updated_at || '') > String(request.updated_at || '')) return true;
      item.observation = clone(request);
      if (request.status === 'COMPLETE') {
        value.history.push({...clone(item), observation: clone(request),
          reason: 'Original request completed', receivedAt: new Date().toISOString()});
        delete value.pending[request.id];
      }
      await save(); return true;
    },
    async revise(request, reason) {
      const item = value.pending[request.id];
      if (!item) throw new Error('The selected original request is not in this working file.');
      matches(item.envelope, request);
      if (!['FAILED', 'INTERRUPTED'].includes(request.status) || !String(reason).trim())
        throw new Error('A revised draft requires the fresh failed/interrupted request and an explicit reason.');
      value.history.push({...clone(item), observation: clone(request), reason: String(reason),
        receivedAt: new Date().toISOString()});
      delete value.pending[request.id];
      await save();
      return clone(item.envelope);
    },
    async restore(body) {
      validate(body);
      await queue;
      if (failure) throw failure;
      const merged = clone(body), pending = {...value.pending};
      for (const [key, item] of Object.entries(merged.pending)) {
        if (pending[key] && stable(pending[key].envelope) !== stable(item.envelope))
          throw new Error('The imported working file changes an original request. Keep both files.');
        if (!pending[key]) pending[key] = item;
      }
      const histories = new Map([...value.history, ...merged.history].map(item => [stable(item), item]));
      merged.pending = pending;
      merged.history = [...histories.values()];
      value = merged; delete value.journalRevision;
      await save(); return clone(value);
    },
    matches
  };
}

export function mountBdnb({api, startAction, submitEnvelope, el, definition, jsonDetails, table, display, bytes, notice, download, workspaceScope}) {
  const root = document.getElementById('bdnb-root');
  const clone = value => JSON.parse(JSON.stringify(value));
  const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const id = () => crypto.randomUUID().replaceAll('-', '');
  const lines = value => String(value || '').split(/\r?\n/).map(v => v.trim()).filter(Boolean);
  const pretty = value => JSON.stringify(value, null, 2);
  const tableNames = ['batiment_groupe', 'adresse', 'rel_batiment_groupe_adresse',
    'passage_millesime_batiment_groupe_id', 'metadonnees_bdnb_version'];
  const views = [['source','Source editions'],['territory','Territories'],['comparison','Edition comparison'],
    ['review','Review decisions'],['products','Reports & handover'],['records','All records']];
  const forms = {}, panes = {}, nodes = {};
  let scope = null, journal = null, opening = null, snapshot = null, status = null, schema = null;
  let selected = null, collection = null, offset = 0, pageGeneration = 0, recordGeneration = 0;
  let statusGeneration = 0, busy = false, lastStatusKey = null, currentView = 'source', initializationError = null;
  const fail = error => notice(error.message || String(error), true);
  function assertScope() {
    if (scope !== workspaceScope()) throw new Error('Reopen this original workspace and operation before continuing.');
  }
  function button(label, action, className) {
    const node = el('button', label, className); node.type = 'button';
    node.addEventListener('click', () => Promise.resolve().then(action).catch(fail)); return node;
  }
  function saveJson(filename, value) {
    const url = URL.createObjectURL(new Blob([pretty(value) + '\n'], {type:'application/json'}));
    const link = el('a'); link.href = url; link.download = filename; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
  function parse(text, fallback, name) {
    if (!String(text || '').trim()) return clone(fallback);
    try {return JSON.parse(text);} catch (error) {throw new Error(name + ': ' + error.message);}
  }
  function exactId(value, name) {
    if (!/^[a-f0-9]{32}$/.test(value || '')) throw new Error(name + ' must be the original 32-character ID.');
    return value;
  }
  function required(value, name) {
    if (!String(value || '').trim()) throw new Error('Enter ' + name + '.');
    return String(value);
  }
  function field(name, label, {value='', kind='text', options=null, help='', required:needed=false, wide=false, list=null}={}) {
    const wrap = el('label', label, wide ? 'bdnb-wide' : '');
    const control = options ? el('select') : kind === 'textarea' ? el('textarea') : el('input');
    control.name = name;
    if (options) for (const [key,title] of options) {
      const option = el('option', title); option.value = key; control.append(option);
    } else if (kind === 'textarea') control.rows = 3;
    else control.type = kind === 'checkbox' ? 'checkbox' : 'text';
    if (kind === 'checkbox') control.checked = value === true; else control.value = value;
    if (needed) control.required = true;
    if (list) control.setAttribute('list', 'bdnb-options-' + list);
    control.autocomplete = 'off';
    if (kind !== 'checkbox') control.spellcheck = false;
    wrap.append(control);
    if (help) wrap.append(el('small', help));
    return wrap;
  }
  function values(form) {
    return Object.fromEntries([...form.querySelectorAll('[name]')].map(node =>
      [node.name, node.type === 'checkbox' ? node.checked : node.value]));
  }
  function apply(form, data) {
    for (const node of form.querySelectorAll('[name]')) if (Object.hasOwn(data, node.name)) {
      if (node.type === 'checkbox') node.checked = data[node.name] === true;
      else node.value = data[node.name] ?? '';
    }
  }
  async function retain(key) {await journal.setDraft(key, values(forms[key]));}
  function identityField(name) {
    return field(name, 'Original ' + name.replaceAll('_',' '), {value:id(), required:true,
      help:'Retained with this form. Use a new ID for a deliberate new edition.'});
  }
  function entityField(name, label, kind, needed=true) {
    return field(name,label,{list:kind,required:needed,help:needed?'Choose or paste the exact retained ID.':'Optional exact retained predecessor ID.'});
  }
  function form(key, title, fields, action, buildBody, label) {
    const section = el('section', undefined, 'bdnb-section'); section.append(el('h3',title));
    const node = el('form', undefined, 'bdnb-form'), grid = el('div',undefined,'bdnb-grid');
    grid.append(...fields); node.append(grid);
    const send = el('button',label,'primary'); send.type='submit'; send.setAttribute('data-mutation','');
    const actions = el('div',undefined,'bdnb-actions'); actions.append(send);
    const idField={source:'edition_id',territory:'selection_id',comparison:'comparison_id',review:'review_id',publication:'publication_id',pack:'pack_id'}[key];
    actions.append(button('New edition ID',async()=>{apply(node,{[idField]:id()});await retain(key);}));
    node.append(actions); forms[key]=node;node.bdnbBuild=buildBody;
    apply(node,journal.draft(key));
    node.addEventListener('input',()=>retain(key).catch(fail));
    node.addEventListener('change',()=>retain(key).catch(fail));
    node.addEventListener('submit',event=>{
      event.preventDefault();
      operate(async()=>{
        await retain(key); const body=buildBody(values(node));
        const result=await startAction(action,body,scope,{
          requestId:action==='bdnb.pack'?body.pack_id:undefined,
          prepared:async envelope=>{await journal.prepare(envelope); renderWorking();}
        });
        if(result?.request) await journal.observe(result.request);
        renderWorking(); await refreshStatus();
        if(result?.request?.status==='COMPLETE'&&result.request.result?.entity)
          await openRecord(result.request.result.entity.id);
      }).catch(fail);
    });
    section.append(node); return section;
  }
  async function operate(fn) {
    assertScope();
    if(busy)throw new Error('Finish the current BDNB interaction first.');
    const previousInert=root.inert, previousBusy=root.getAttribute('aria-busy');
    busy=true;root.inert=true;root.setAttribute('aria-busy','true');
    try{return await fn();}
    finally{
      busy=false;root.inert=previousInert;
      if(previousBusy===null)root.removeAttribute('aria-busy');
      else root.setAttribute('aria-busy',previousBusy);
    }
  }
  async function read(action,body={}) {
    assertScope();const result=await api('/api/datasette/bdnb/read',{method:'POST',body:{action,body}});assertScope();return result;
  }
  function switchView(view, save=true) {
    if(!views.some(([name])=>name===view))view='source';
    currentView=view;
    for(const [name] of views){panes[name].hidden=name!==view;nodes['nav-'+name].setAttribute('aria-current',String(name===view));}
    if(save)journal.view(view).catch(fail);
  }
  function buildSource() {
    const controls=[
      identityField('edition_id'),field('title','Edition title',{required:true}),
      field('publisher','Publisher',{required:true}),field('source_url','Original source URL',{required:true}),
      field('license','Original licence or terms reference',{kind:'textarea',required:true,wide:true}),
      field('captured_at','Original acquisition time',{required:true,help:'ISO date and time with its explicit offset.'}),
      field('millesime','Publisher edition',{required:true,help:'Use the actual label from this source package.'}),
      field('structure_version','Dictionary structure version',{required:true}),
      field('dictionary','Complete publisher dictionary (optional)',{kind:'textarea',wide:true,help:'Paste the complete source-backed dictionary JSON when this edition uses another structure version. Leave empty for the installed dictionary.'}),
      field('scope_kind','Source coverage',{options:[['department','Department'],['commune','Commune'],['custom','Custom extraction']]}),
      field('scope_codes','Original coverage codes',{kind:'textarea',help:'One exact code per line; leading zeros remain text.'}),
      field('scope_description','Source coverage and extraction description',{kind:'textarea',required:true})
    ];
    for(const name of tableNames){
      const group=el('fieldset',undefined,'bdnb-wide');group.append(el('legend',name));
      const grid=el('div',undefined,'bdnb-grid'),prefix='table_'+name+'_';
      grid.append(field(prefix+'enabled','Include this supplied table',{kind:'checkbox',value:name==='batiment_groupe'}),
        field(prefix+'path','Complete CSV path on this host',{wide:true}),
        field(prefix+'bytes','Complete file bytes'),field(prefix+'sha256','Complete SHA-256'),
        field(prefix+'delimiter','CSV delimiter',{value:',',required:true,help:'One original delimiter character. Enter \\t for a tab.'}),
        field(prefix+'geometry_encoding','Original geometry representation',{options:[['opaque','Keep original geometry text'],['wkt','WKT'],['ewkb-hex','EWKB hexadecimal'],['geojson-text','GeoJSON text']]}),
        field(prefix+'null_values','Declared null strings',{kind:'textarea',value:'[]',help:'JSON array. Empty means no string is interpreted as null.'}),
        field(prefix+'extra_fields','Additional field definitions',{kind:'textarea',value:'[]',help:'JSON array of source-backed name/type/nullable/description/unit definitions.'}));
      group.append(grid);controls.push(group);
    }
    const section=form('source','Retain a complete publisher edition',controls,'bdnb.import',data=>{
      const selectedDictionary=String(data.dictionary||'').trim()?parse(data.dictionary,null,'complete publisher dictionary'):null;
      if(selectedDictionary!==null&&!object(selectedDictionary))throw new Error('Use one complete publisher dictionary JSON object.');
      const tables=tableNames.filter(name=>data['table_'+name+'_enabled']).map(name=>{
        const prefix='table_'+name+'_',length=String(data[prefix+'bytes']);
        if(!/^(0|[1-9][0-9]*)$/.test(length)||!Number.isSafeInteger(Number(length)))throw new Error('Enter exact file bytes for '+name+'.');
        if(!/^[a-f0-9]{64}$/.test(data[prefix+'sha256']))throw new Error('Enter the full file SHA-256 for '+name+'.');
        const delimiter=data[prefix+'delimiter']==='\\t'?'\t':data[prefix+'delimiter'];
        if([...delimiter].length!==1||/[\r\n\0"]/.test(delimiter))throw new Error('Enter one valid original CSV delimiter character for '+name+'.');
        const nullValues=parse(data[prefix+'null_values'],[],name+' null strings');
        const extras=parse(data[prefix+'extra_fields'],[],name+' extra fields');
        if(!Array.isArray(nullValues)||nullValues.some(v=>typeof v!=='string')||!Array.isArray(extras))throw new Error('Use complete JSON arrays for null strings and extra fields.');
        return {table:name,path:required(data[prefix+'path'],name+' original path'),bytes:Number(length),
          sha256:data[prefix+'sha256'],format:'csv',delimiter,encoding:'utf-8',
          null_values:nullValues,geometry_encoding:data[prefix+'geometry_encoding'],extra_fields:extras};
      });
      if(!tables.some(t=>t.table==='batiment_groupe'))throw new Error('Select the actual batiment_groupe source table.');
      return {edition_id:exactId(data.edition_id,'Edition ID'),descriptor:{
        schema:'stellar-forge.bdnb-source.v1',title:required(data.title,'edition title'),
        publisher:required(data.publisher,'publisher'),source_url:required(data.source_url,'source URL'),
        license:required(data.license,'original licence'),captured_at:required(data.captured_at,'acquisition time'),
        millesime:required(data.millesime,'publisher edition'),structure_version:required(data.structure_version,'dictionary version'),
        ...(selectedDictionary?{dictionary:selectedDictionary}:{}),
        scope:{kind:data.scope_kind,codes:lines(data.scope_codes),description:required(data.scope_description,'coverage description')},tables}};
    },'Import complete edition');
    const helpers=el('div',undefined,'bdnb-actions'),input=el('input');input.type='file';input.accept='.json,application/json';
    input.setAttribute('aria-label','Load complete BDNB source descriptor');
    input.addEventListener('change',()=>operate(async()=>{
      const file=input.files[0];if(!file)return;
      const raw=JSON.parse(await file.text()),descriptor=raw.descriptor||raw;
      if(descriptor.schema!=='stellar-forge.bdnb-source.v1'||!Array.isArray(descriptor.tables)||!object(descriptor.scope))
        throw new Error('Choose a complete BDNB source descriptor.');
      const data={};
      for(const key of ['title','publisher','source_url','license','captured_at','millesime','structure_version'])data[key]=descriptor[key];
      data.edition_id=raw.edition_id||values(forms.source).edition_id;
      data.dictionary=descriptor.dictionary?pretty(descriptor.dictionary):'';
      data.scope_kind=descriptor.scope.kind;data.scope_codes=(descriptor.scope.codes||[]).join('\n');data.scope_description=descriptor.scope.description;
      for(const name of tableNames)data['table_'+name+'_enabled']=false;
      for(const item of descriptor.tables){
        if(!tableNames.includes(item.table)||item.format!=='csv'||item.encoding!=='utf-8')throw new Error('The installed form requires its declared UTF-8 CSV tables.');
        if(typeof item.delimiter!=='string'||[...item.delimiter].length!==1||/[\r\n\0"]/.test(item.delimiter))throw new Error('The original CSV delimiter must be one valid character.');
        const prefix='table_'+item.table+'_';data[prefix+'enabled']=true;
        for(const key of ['path','bytes','sha256','delimiter','geometry_encoding'])data[prefix+key]=item[key];
        if(item.delimiter==='\t')data[prefix+'delimiter']='\\t';
        data[prefix+'null_values']=pretty(item.null_values||[]);data[prefix+'extra_fields']=pretty(item.extra_fields||[]);
      }
      apply(forms.source,data);await retain('source');input.value='';notice('Loaded the complete source descriptor into the retained form.');
    }).catch(fail));
    helpers.append(input,button('Download source descriptor',()=>saveJson('BDNB_Source_Descriptor.json',forms.source.bdnbBuild(values(forms.source)))),
      button('New edition ID',async()=>{apply(forms.source,{edition_id:id()});await retain('source');}));
    section.append(helpers,el('p','Original file strings, table grain, typed values and geometry remain separately inspectable. Address weights describe allocation across groups served by an address.','hint'));
    panes.source.append(section,jsonDetails('Installed source dictionary and complete API',schema));
  }
  function buildForms() {
    buildSource();
    panes.territory.append(el('p','Select groups from one complete edition. Linked addresses remain attached through the original relationship table. Nonempty filter dimensions intersect; empty dimensions keep the edition’s full coverage.','hint'),
      form('territory','Record a territory selection',[
        identityField('selection_id'),entityField('edition_id','Source edition','edition'),
        field('title','Selection title',{required:true}),
        field('department_codes','Department codes',{kind:'textarea'}),
        field('commune_codes','Commune codes',{kind:'textarea'}),
        field('group_ids','Exact building-group IDs',{kind:'textarea',wide:true})
      ],'bdnb.select',d=>({selection_id:exactId(d.selection_id,'Selection ID'),edition_id:exactId(d.edition_id,'Source edition'),
        title:required(d.title,'selection title'),filters:{department_codes:lines(d.department_codes),commune_codes:lines(d.commune_codes),group_ids:lines(d.group_ids)}}),'Retain territory'));
    panes.comparison.append(el('p','Compare two actual publisher editions. Same-ID matches, publisher correspondence, scope movement and unresolved identities remain distinct. Splits and merges preserve every supporting group and passage row.','hint'),
      form('comparison','Compare complete selected editions',[
        identityField('comparison_id'),field('title','Comparison title',{required:true}),
        entityField('before_selection_id','Earlier selection','selection'),entityField('after_selection_id','Later selection','selection'),
        field('passage_edition_ids','Passage-table edition IDs',{kind:'textarea',help:'One imported edition ID per line. Leave empty to compare without supplied passage evidence.'}),
        field('correspondence_mode','Correspondence',{options:[['direct','Exact before → after edges'],['chain','Explicit connected intermediate editions']]}),
        field('edition_path','Ordered publisher editions for correspondence',{kind:'textarea',help:'For chain mode, one exact millesime label per line, from the earlier edition through each intermediate edition to the later edition. Supply imported passage editions containing the intermediate building groups. Direct mode may leave this empty.'}),
        field('fields','Group fields to compare',{kind:'textarea',wide:true,help:'One exact field name per line. Empty selects the union of all actual fields.'}),
        field('include_unchanged','Include unchanged rows in the full comparison',{kind:'checkbox'})
      ],'bdnb.compare',d=>({comparison_id:exactId(d.comparison_id,'Comparison ID'),title:required(d.title,'comparison title'),
        before_selection_id:exactId(d.before_selection_id,'Earlier selection'),after_selection_id:exactId(d.after_selection_id,'Later selection'),
        passage_edition_ids:lines(d.passage_edition_ids).map(v=>exactId(v,'Passage edition')),correspondence_mode:d.correspondence_mode,
        ...(lines(d.edition_path).length?{edition_path:lines(d.edition_path)}:{}),
        fields:lines(d.fields).length?lines(d.fields):null,include_unchanged:d.include_unchanged===true}),'Run complete comparison'));
    panes.review.append(el('p','Open a comparison finding in All records and choose Review this finding to bind its exact evidence. Each successor records the current preceding review.','hint'),
      form('review','Record a finding decision',[
        identityField('review_id'),entityField('comparison_id','Comparison','comparison'),
        field('item_id','Original finding ID',{required:true}),field('evidence_sha256','Exact finding evidence SHA-256',{required:true}),
        field('outcome','Decision',{options:[['needs-review','Needs review'],['accepted','Accepted'],['deferred','Deferred'],['rejected','Rejected']]}),
        field('author','Recorded by',{required:true}),field('reason','Decision and reason',{kind:'textarea',required:true,wide:true}),
        entityField('supersedes_id','Current preceding review','review',false)
      ],'bdnb.review',d=>{
        if(!/^[a-f0-9]{64}$/.test(d.item_id)||!/^[a-f0-9]{64}$/.test(d.evidence_sha256))throw new Error('Select the complete finding and evidence identities.');
        return {review_id:exactId(d.review_id,'Review ID'),comparison_id:exactId(d.comparison_id,'Comparison'),item_id:d.item_id,
          evidence_sha256:d.evidence_sha256,outcome:d.outcome,author:required(d.author,'recorded author'),reason:required(d.reason,'review reason'),
          supersedes_id:d.supersedes_id?exactId(d.supersedes_id,'Prior review'):null};
      },'Record review'));
    panes.products.append(el('p','Publish a selected territory or comparison with its current review set. The report and workbook provide the operational summary; full annexes preserve the complete selected rows. A later decision gets a new publication.','hint'),
      form('publication','Publish reports and full annexes',[
        identityField('publication_id'),entityField('entity_id','Selection or comparison','publishable'),
        field('title','Report title',{required:true}),field('note','Publication note',{kind:'textarea',wide:true})
      ],'bdnb.publish',d=>({publication_id:exactId(d.publication_id,'Publication ID'),entity_id:exactId(d.entity_id,'Selected entity'),
        title:required(d.title,'report title'),note:d.note||''}),'Publish selected report'),
      form('pack','Prepare the complete editable handover',[
        identityField('pack_id'),entityField('publication_id','Published report','publication'),
        field('note','Handover note',{kind:'textarea',wide:true})
      ],'bdnb.pack',d=>({pack_id:exactId(d.pack_id,'Pack ID'),publication_id:exactId(d.publication_id,'Publication'),note:d.note||''}),'Prepare complete handover'));
    nodes.productFiles=el('div');panes.products.append(nodes.productFiles);
  }
  function filterEntities(kind) {
    return (status?.entities||[]).filter(item=>!kind||item.kind===kind||kind==='publishable'&&['selection','comparison'].includes(item.kind));
  }
  function renderOptions() {
    for(const kind of ['edition','selection','comparison','review','publication','pack','publishable']){
      nodes['options-'+kind].replaceChildren(...filterEntities(kind).map(item=>{
        const option=el('option');option.value=item.id;option.label=item.title+' · '+item.kind;return option;
      }));
    }
  }
  function renderList() {
    if(!nodes.list)return;
    const kind=nodes.kind.value,query=nodes.query.value.toLocaleLowerCase();
    const items=filterEntities(kind).filter(item=>[item.title,item.id,item.kind].join(' ').toLocaleLowerCase().includes(query));
    nodes.list.replaceChildren(...items.slice().reverse().map(item=>{
      const row=el('article',undefined,'bdnb-record');
      row.append(button(item.title||item.id,()=>operate(()=>openRecord(item.id))),
        definition({kind:item.kind,id:item.id,created_at:item.created_at,...(item.summary||{})}));
      return row;
    }));
    if(!items.length)nodes.list.append(el('p','No retained records match this selection.','empty'));
    nodes.count.textContent=items.length+' records';
  }
  async function refreshStatus() {
    const generation=++statusGeneration,next=await read('bdnb.status');
    if(generation!==statusGeneration)return;
    if(next.schema!=='stellar-forge.bdnb-status.v1'||next.operation_id!==snapshot.operation_id||!Array.isArray(next.entities))
      throw new Error('The BDNB catalogue differs from the selected operation.');
    status=next;renderOptions();renderList();
    nodes.status.replaceChildren(definition(next.counts||{}));
  }
  async function downloadFile(file) {
    if(typeof window.showSaveFilePicker!=='function')return download(file);
    const handle=await window.showSaveFilePicker({suggestedName:file.filename||file.name});
    const query=new URLSearchParams({name:file.name});
    if(file.edition_id)query.set('edition_id',file.edition_id);
    if(file.export_id)query.set('export_id',file.export_id);
    let response=null,reader=null,target=null,finished=false,count=0;
    try{
      response=await api('/api/datasette/download?'+query,{raw:true});
      if(Number(response.headers.get('Content-Length'))!==file.bytes||response.headers.get('X-Content-SHA256')!==file.sha256)
        throw new Error('The returned file identity differs from the selected publication.');
      target=await handle.createWritable();
      reader=response.body.getReader();
      while(true){const part=await reader.read();if(part.done)break;count+=part.value.byteLength;
        if(count>file.bytes)throw new Error('The downloaded file exceeds its retained length.');await target.write(part.value);}
      if(count!==file.bytes)throw new Error('The download ended before the complete retained file.');
      await target.close();finished=true;notice('Saved '+(file.filename||file.name)+'.');
    }finally{
      if(!finished){
        if(target){try{await target.abort();}catch{}}
        if(reader){try{await reader.cancel();}catch{}}
        else if(response&&response.body){try{await response.body.cancel();}catch{}}
      }
      if(reader)reader.releaseLock();
    }
  }
  function filesView(files) {
    const box=el('div',undefined,'bdnb-selected');
    for(const file of files||[]){
      const row=el('div',undefined,'bdnb-record');
      row.append(el('strong',file.filename||file.name),definition({bytes:file.bytes,sha256:file.sha256}),
        button('Save complete file',()=>downloadFile(file)));
      box.append(row);
    }
    return box;
  }
  async function openRecord(entityId) {
    const generation=++recordGeneration,record=await read('bdnb.get',{entity_id:exactId(entityId,'Record ID')});
    if(generation!==recordGeneration)return;
    if(record.id!==entityId||!record.sha256||!object(record.collections))throw new Error('The record differs from the selected immutable entity.');
    selected=record;collection=Object.keys(record.collections)[0]||null;offset=0;
    await journal.select('entity_id',record.id);
    nodes.detail.replaceChildren(el('h3',record.title||record.id),definition({kind:record.kind,id:record.id,sha256:record.sha256,created_at:record.created_at,...record.summary}),
      jsonDetails('Complete frozen input, lineage and source record',record));
    if(record.files?.length){
      nodes.detail.append(filesView(record.files));
      nodes.productFiles.replaceChildren(el('h3',record.title||record.id),filesView(record.files));
    }
    const actions=el('div',undefined,'bdnb-actions');
    if(record.kind==='edition')actions.append(button('Use for territory',async()=>{apply(forms.territory,{edition_id:record.id});await retain('territory');switchView('territory');}));
    if(['selection','comparison'].includes(record.kind))actions.append(button('Prepare report',async()=>{
      apply(forms.publication,{entity_id:record.id,title:record.title,publication_id:id()});await retain('publication');switchView('products');
    }));
    if(record.kind==='publication')actions.append(button('Prepare handover',async()=>{
      apply(forms.pack,{publication_id:record.id,pack_id:id()});await retain('pack');switchView('products');
    }));
    actions.append(button('Download complete record JSON',()=>saveJson('BDNB_'+record.kind+'_'+record.id+'.json',record)));
    nodes.detail.append(actions);
    nodes.collections.replaceChildren(...Object.keys(record.collections).map(name=>{
      const option=el('option',name+' · '+record.collections[name].row_count+' rows');option.value=name;return option;
    }));
    nodes.rowSection.hidden=!collection;
    switchView('records');
    if(collection)await loadRows(0);
  }
  async function reviewFinding(row) {
    if(selected?.kind!=='comparison')throw new Error('Open the original comparison before recording a review.');
    apply(forms.review,{review_id:id(),comparison_id:selected.id,item_id:row.id,evidence_sha256:row.evidence_sha256,
      supersedes_id:row.review?.id||'',reason:'',outcome:'needs-review'});
    await retain('review');switchView('review');
  }
  function rowDetail(row) {
    const detail=el('details',undefined,'bdnb-record');
    detail.append(el('summary',(row.classification||row.table||row.kind||'Record')+' · '+display(row.key??row.id??row.ordinal)));
    if(Array.isArray(row.changes))detail.append(table(['field','before','after','state','reason'],row.changes,{className:'bdnb-table'}));
    if(row.raw)detail.append(el('h3','Original source strings'),table(['field','value'],Object.entries(row.raw).map(([field,value])=>({field,value}))));
    if(row.typed)detail.append(el('h3','Declared typed projection'),table(['field','type','state','value','raw','unit'],
      Object.entries(row.typed).map(([field,value])=>({field,...value})),{className:'bdnb-table'}));
    if(row.geometry)detail.append(jsonDetails('Original geometry and coordinate reference',row.geometry));
    if(row.before||row.after)detail.append(jsonDetails('Complete original before / after rows',{before:row.before,after:row.after}));
    if(row.correspondence)detail.append(jsonDetails('Full publisher correspondence',row.correspondence));
    if(row.findings?.length)detail.append(table(['code','field','detail'],row.findings,{className:'bdnb-table'}));
    if(row.review)detail.append(jsonDetails('Current review and history references',row.review));
    if(selected?.kind==='comparison'&&row.evidence_sha256)detail.append(button('Review this finding',()=>reviewFinding(row)));
    detail.append(jsonDetails('Complete original row',row));return detail;
  }
  async function loadRows(nextOffset) {
    if(!selected||!collection)return;
    const generation=++pageGeneration,entity=selected,chosen=collection;
    nodes.rows.setAttribute('aria-busy','true');
    try{
      const page=await read('bdnb.rows',{entity_id:entity.id,collection:chosen,offset:nextOffset,limit:50});
      if(generation!==pageGeneration||selected!==entity||collection!==chosen)return;
      const original=entity.collections[chosen];
      if(page.schema!=='stellar-forge.bdnb-page.v1'||page.entity_id!==entity.id||page.entity_sha256!==entity.sha256
        ||page.collection!==chosen||page.version_id!==original.version_id||page.offset!==nextOffset||page.limit!==50
        ||!Array.isArray(page.rows)||page.rows.length>50||!Number.isSafeInteger(page.total)||page.total!==original.row_count
        ||nextOffset+page.rows.length>page.total||!page.rows.length&&nextOffset<page.total
        ||page.next_offset!==(nextOffset+page.rows.length<page.total?nextOffset+page.rows.length:null))
        throw new Error('The returned row page differs from its complete immutable selection.');
      offset=nextOffset;nodes.rows.replaceChildren(...page.rows.map(rowDetail));
      if(!page.rows.length)nodes.rows.append(el('p','This complete collection is empty.','empty'));
      nodes.page.textContent=(page.rows.length?offset+1:0)+'–'+(offset+page.rows.length)+' of '+page.total;
      nodes.previous.disabled=offset===0;nodes.next.disabled=page.next_offset===null;
      nodes.next.onclick=()=>operate(()=>loadRows(page.next_offset)).catch(fail);
    }finally{if(generation===pageGeneration)nodes.rows.removeAttribute('aria-busy');}
  }
  function renderWorking() {
    if(!nodes.pending||!journal)return;
    const entries=Object.values(journal.pending());
    const focused=document.activeElement,editingReason=focused?.dataset?.bdnbRevisionReason;
    const selection=editingReason?{start:focused.selectionStart,end:focused.selectionEnd}:null;
    nodes.pending.replaceChildren();
    for(const item of entries){
      const record=el('div',undefined,'bdnb-record'),envelope=item.envelope;
      record.append(el('strong',envelope.action),definition({request_id:envelope.request_id,status:item.observation?.status||'Awaiting receipt'}),
        jsonDetails('Original request and latest observation',item));
      const reason=el('textarea');reason.rows=2;reason.placeholder='Reason for opening a corrected draft';
      reason.setAttribute('aria-label','Reason for corrected draft');
      reason.dataset.bdnbRevisionReason=envelope.request_id;
      const draftKey='revision-'+envelope.request_id;
      reason.value=journal.draft(draftKey).reason||'';
      reason.addEventListener('input',()=>journal.setDraft(draftKey,{reason:reason.value}).catch(fail));
      async function inspect(){
        const request=await api('/api/datasette/requests/'+envelope.request_id);assertScope();
        journal.matches(envelope,request);await journal.observe(request);renderWorking();
        if(request.status==='COMPLETE'&&request.result?.entity)await openRecord(request.result.entity.id);
        return request;
      }
      record.append(button('Inspect original request',()=>operate(inspect)),
        button('Reconnect or continue',()=>operate(async()=>{
          let request;
          try{request=await inspect();}catch(error){if(error.status!==404)throw error;}
          if(!request){
            const result=await submitEnvelope(envelope,scope);await journal.observe(result.request);
          }else if(['FAILED','INTERRUPTED'].includes(request.status)){
            const result=await api('/api/datasette/requests/'+envelope.request_id+'/resume',{method:'POST',body:{}});
            assertScope();await journal.observe(result.request);
          }
          renderWorking();await refreshStatus();
        })),reason,button('Open corrected draft',()=>operate(async()=>{
          const request=await api('/api/datasette/requests/'+envelope.request_id);assertScope();
          await journal.revise(request,required(reason.value,'revision reason'));renderWorking();
          const key={'bdnb.import':'source','bdnb.select':'territory','bdnb.compare':'comparison','bdnb.review':'review','bdnb.publish':'publication','bdnb.pack':'pack'}[envelope.action];
          const idName={source:'edition_id',territory:'selection_id',comparison:'comparison_id',review:'review_id',publication:'publication_id',pack:'pack_id'}[key];
          apply(forms[key],{[idName]:id()});await retain(key);
          switchView(key==='publication'||key==='pack'?'products':key);
          notice('The original failed request is retained. Review the corrected form before submitting its new edition.');
        })));
      nodes.pending.append(record);
      if(editingReason===envelope.request_id){reason.focus({preventScroll:true});reason.setSelectionRange(selection.start,selection.end);}
    }
    if(!entries.length)nodes.pending.append(el('p','All submitted BDNB requests have a received completion. Unsubmitted forms remain saved here.','hint'));
    if(journal.error())nodes.pending.prepend(el('p',journal.error().message,'bdnb-status bdnb-error'));
    nodes.history.replaceChildren(jsonDetails('Complete retained request history',journal.snapshot().history));
  }
  function buildWorking() {
    const panel=el('details',undefined,'bdnb-working');panel.append(el('summary','Working file and original request recovery'));
    panel.append(el('p','Save or restore full forms, selected record, pending requests and received history for this exact workspace. Browser drafts travel in this file; accepted records travel in the Analysis handover.','hint'));
    const actions=el('div',undefined,'bdnb-actions'),input=el('input');input.type='file';input.accept='.json,application/json';
    input.setAttribute('aria-label','Restore full BDNB working file');
    input.addEventListener('change',()=>operate(async()=>{
      const file=input.files[0];if(!file)return;await journal.restore(JSON.parse(await file.text()));
      for(const [key,node]of Object.entries(forms))apply(node,journal.draft(key));
      input.value='';renderWorking();switchView(journal.snapshot().view,false);
      notice('Restored full drafts and merged original request history.');
    }).catch(fail));
    actions.append(button('Download full working file',()=>saveJson('BDNB_Working_File.json',journal.snapshot())),
      button('Load saved working edition',()=>operate(async()=>{
        await journal.reload();for(const [key,node]of Object.entries(forms))apply(node,journal.draft(key));
        renderWorking();switchView(journal.snapshot().view,false);
      })),input);
    nodes.pending=el('div');nodes.history=el('div');panel.append(actions,nodes.pending,nodes.history);root.append(panel);
  }
  function buildRecords() {
    const filters=el('div',undefined,'bdnb-grid');nodes.kind=el('select');
    for(const kind of ['','edition','selection','comparison','review','publication','pack']){
      const option=el('option',kind||'All kinds');option.value=kind;nodes.kind.append(option);
    }
    const kindLabel=el('label','Record kind');kindLabel.append(nodes.kind);
    nodes.query=el('input');nodes.query.type='search';const queryLabel=el('label','Find title or ID');queryLabel.append(nodes.query);
    filters.append(kindLabel,queryLabel);nodes.kind.addEventListener('change',renderList);nodes.query.addEventListener('input',renderList);
    nodes.count=el('span',undefined,'meta');nodes.list=el('div');nodes.detail=el('div',undefined,'bdnb-section');
    const lookup=el('form',undefined,'bdnb-inline'),input=el('input');input.required=true;input.placeholder='Exact retained record ID';input.setAttribute('aria-label','Exact record ID');
    const open=el('button','Open record');open.type='submit';lookup.append(input,open);
    lookup.addEventListener('submit',event=>{event.preventDefault();operate(()=>openRecord(input.value)).catch(fail);});
    nodes.rowSection=el('section',undefined,'bdnb-section');nodes.rowSection.hidden=true;nodes.collections=el('select');
    const label=el('label','Complete collection');label.append(nodes.collections);
    nodes.collections.addEventListener('change',()=>{
      const chosen=nodes.collections.value;
      operate(async()=>{
        const previous=collection;
        collection=chosen;
        try{await loadRows(0);}
        catch(error){collection=previous;throw error;}
      }).catch(error=>{nodes.collections.value=collection||'';fail(error);});
    });
    nodes.rows=el('div');nodes.previous=button('Previous',()=>operate(()=>loadRows(Math.max(0,offset-50))));
    nodes.next=el('button','Next');nodes.next.type='button';nodes.page=el('span',undefined,'meta');
    const pages=el('div',undefined,'pagination');pages.append(nodes.previous,nodes.page,nodes.next);
    nodes.rowSection.append(label,button('Refresh selected rows',()=>operate(()=>loadRows(offset))),nodes.rows,pages);
    panes.records.append(filters,lookup,nodes.count,nodes.list,nodes.detail,nodes.rowSection);
  }
  async function initialize() {
    journal=createBdnbJournal(scope);await journal.open();schema=await read('bdnb.schema');
    if(schema.schema!=='stellar-forge.bdnb-schema.v1')throw new Error('The installed BDNB schema is unsupported.');
    root.replaceChildren(el('h2','BDNB territory delivery'),
      el('p','Retain original building data, review territory coverage and edition changes, and hand over the complete editable result.','hint'));
    nodes.status=el('div',undefined,'bdnb-status');root.append(nodes.status);
    const nav=el('nav',undefined,'bdnb-nav');nav.setAttribute('aria-label','BDNB workflow');
    for(const [name,title]of views){nodes['nav-'+name]=button(title,()=>switchView(name));nav.append(nodes['nav-'+name]);}
    root.append(nav);buildWorking();
    for(const [name]of views){panes[name]=el('div');root.append(panes[name]);}
    for(const kind of ['edition','selection','comparison','review','publication','pack','publishable']){
      const list=el('datalist');list.id='bdnb-options-'+kind;nodes['options-'+kind]=list;root.append(list);
    }
    buildForms();buildRecords();
    for(const [key,node]of Object.entries(forms))await journal.setDraft(key,values(node));
    switchView(journal.snapshot().view,false);renderWorking();await refreshStatus();
    const savedView=journal.snapshot().view,chosen=journal.snapshot().selected.entity_id;
    if(chosen){await openRecord(chosen);switchView(savedView);}
  }
  async function render(value) {
    const selectedScope=value.workspace_id+':'+value.operation_id;
    if(scope&&scope!==selectedScope)throw new Error('The BDNB working file belongs to another original operation.');
    scope=selectedScope;snapshot=value;
    if(initializationError)return;
    if(!opening)opening=initialize().catch(error=>{
      initializationError=error;
      const recovery=el('div',undefined,'bdnb-status bdnb-error');recovery.append(el('p',error.message));
      if(journal)recovery.append(button('Download current working file',()=>saveJson('BDNB_Working_File.json',journal.snapshot())));
      recovery.append(button('Load saved working file and retry',async()=>{initializationError=null;opening=null;await render(snapshot);}));
      root.append(recovery);throw error;
    });
    await opening;assertScope();
    for(const request of value.requests||[])if(journal.pending()[request.id])await journal.observe(request);
    renderWorking();
    const statusKey=JSON.stringify([value.state?.updated_at,(value.requests||[]).map(r=>[r.id,r.status,r.updated_at])]);
    if(statusKey!==lastStatusKey){lastStatusKey=statusKey;await refreshStatus();}
  }
  return {render};
}
