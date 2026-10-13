"use strict";
/* Dataset controls use the original forms, artifacts and operation dispatcher. */
window.createSemanticDatasetUI = function(H){
  const { $, $$, esc, field, input, panel, table, badge, empty, records, ref, selected, json, api } = H;
  const cache = new Map();
  const drafts = new Map();
  let workspace = null, generation = 0;
  const identity = r => r.id + "@" + r.revision;
  const isDataset = row => row?.payload?.parameters?.data_model === "dataset" ||
    row?.payload?.spec?.parameters?.data_model === "dataset";
  const snapshot = value => {
    if(!value)return null;
    const wanted = typeof value === "string" ? ref(value) : value;
    return records("snapshot").find(r=>r.id===wanted.id && r.revision===wanted.revision);
  };
  const label = graph => graph?.type==="default" ? "Default graph" :
    graph?.type==="bnode" ? "_:"+graph.value : graph?.value || "Unknown graph";
  const choice = graph => JSON.stringify(graph);
  const graphOption = row => {
    const graph = row.graph || row;
    return '<option value="'+esc(choice(graph))+'">'+esc(label(graph))+
      (row.quad_count===undefined?"":" · "+row.quad_count+" quads"+(row.empty?" · empty":""))+'</option>';
  };
  async function artifactJSON(id){
    if(!cache.has(id)){
      const pending=api("/api/files/"+encodeURIComponent(id)).then(r=>r.json());
      cache.set(id,pending);
      pending.catch(()=>cache.delete(id));
    }
    return cache.get(id);
  }
  async function catalogue(kind,selectedRef){
    let files=[];
    if(kind==="source"){
      const matches=records("job").filter(r=>r.payload.action==="inspect"&&
        r.payload.status==="complete"&&isDataset(r)&&
        r.payload.spec.inputs.some(i=>i.key===r.payload.spec.parameters.input_key&&
          i.source_id===selectedRef.id&&i.revision===selectedRef.revision))
        .sort((a,b)=>String(b.payload.completed_at).localeCompare(String(a.payload.completed_at)));
      files=matches[0]?.payload?.native_result?.files||[];
    }else{
      files=snapshot(selectedRef)?.payload?.files||[];
    }
    const entry=files.find(f=>f.role==="graph_catalog") || files.find(f=>f.path==="graph-catalog.json");
    if(!entry)return null;
    const value=await artifactJSON(entry.artifact_id);
    if(value.schema!=="commons-semantic-graph-catalog/1"||!Array.isArray(value.graphs))
      throw new Error("The retained output is not a complete dataset graph catalogue.");
    return value;
  }
  function selectorHTML(id,rows,{namedOnly=false,allowEmpty=false,title="Graph selection",saved="all"}={}){
    rows=rows.filter(row=>!namedOnly||row.graph.type!=="default");
    const all=saved==="all";
    const selection=new Set(all?[]:saved.map(choice));
    return '<div data-graph-selector="'+esc(id)+'">'+
      field(title,'<select data-graph-mode><option value="all"'+(all?" selected":"")+'>All '+(namedOnly?"named ":"")+'graphs</option><option value="selected"'+(!all?" selected":"")+'>Selected graphs</option></select>')+
      '<div data-selected-graphs'+(all?' hidden':'')+'>'+
      field("Included graph identities",'<select data-graph-values multiple'+(all?' disabled':'')+'>'+
        rows.map(row=>graphOption(row).replace("<option ",selection.has(choice(row.graph))?"<option selected ":"<option ")).join("")+'</select>',
        allowEmpty?"An empty selection makes no named graphs available.":"Select at least one graph, including an empty graph when it belongs in this scope.")+
      '</div><small>'+rows.length+' graph identities in this retained catalogue. Empty graphs are included explicitly.</small></div>';
  }
  function selectorValue(node,{allowEmpty=false}={}){
    if(!node)return "all";
    if($("[data-graph-mode]",node)?.value!=="selected")return "all";
    const values=$$("[data-graph-values] option:checked",node).map(o=>JSON.parse(o.value));
    if(!allowEmpty&&!values.length)throw new Error("Choose at least one graph or choose All graphs.");
    return values;
  }
  function wireSelector(node,onChange=()=>{}){
    const mode=$("[data-graph-mode]",node), list=$("[data-graph-values]",node);
    if(!mode||!list)return;
    mode.addEventListener("change",()=>{
      $("[data-selected-graphs]",node).hidden=mode.value!=="selected";
      list.disabled=mode.value!=="selected";
      onChange();
    });
    list.addEventListener("change",onChange);
  }
  function captureBuild(form){
    $$("[data-source-graphs]",form).forEach(node=>{
      const selector=$("[data-graph-selector]",node);
      if(selector)drafts.set("source:"+node.dataset.sourceGraphs,selectorValue(selector,{allowEmpty:true}));
    });
    $$("[data-mapping-graph]",form).forEach(node=>{
      drafts.set("mapping:"+node.dataset.mappingGraph,{
        type:$("[data-destination-kind]",node).value,
        value:$("[data-destination-iri]",node).value
      });
    });
  }
  async function updateBuild(form,epoch){
    captureBuild(form);
    const mode=$('[name="data_model"]',form)?.value||"graph";
    const section=$("[data-dataset-build]",form);
    if(!section)return;
    section.hidden=mode!=="dataset";
    if(mode!=="dataset")return;
    const selectedSources=selected(form,"sources"), selectedMappings=selected(form,"mappings");
    const local=String(Number(section.dataset.request||0)+1);section.dataset.request=local;
    const sourceNode=$("[data-build-sources]",section),mappingNode=$("[data-build-mappings]",section);
    sourceNode.innerHTML=selectedSources.length?selectedSources.map(r=>{
      const row=records("source").find(s=>s.id===r.id), id=identity(r);
      return '<section class="dataset-scope" data-source-graphs="'+esc(id)+'"><h3>'+esc(row?.payload?.title||r.id)+' · r'+r.revision+'</h3><p data-catalogue-loading>Reading the retained source catalogue…</p></section>';
    }).join(""):empty("Select RDF data revisions above.");
    mappingNode.innerHTML=selectedMappings.length?selectedMappings.map(r=>{
      const row=records("mapping").find(s=>s.id===r.id),id=identity(r),saved=drafts.get("mapping:"+id)||{type:"default",value:""};
      return '<section class="dataset-scope" data-mapping-graph="'+esc(id)+'"><h3>'+esc(row?.payload?.title||r.id)+' · r'+r.revision+'</h3>'+
        field("Mapped row destination",'<select data-destination-kind><option value="default"'+(saved.type==="default"?" selected":"")+'>Default graph</option><option value="uri"'+(saved.type==="uri"?" selected":"")+'>Named graph IRI</option></select>')+
        '<div data-destination-field'+(saved.type!=="uri"?' hidden':'')+'>'+field("Destination graph IRI",'<input data-destination-iri value="'+esc(saved.value||"")+'" placeholder="https://example.org/graphs/components">')+'</div>'+
        '<small>This destination is saved with this snapshot and leaves the original mapping revision unchanged.</small></section>';
    }).join(""):"";
    $$("[data-mapping-graph]",mappingNode).forEach(node=>{
      $("[data-destination-kind]",node).addEventListener("change",()=>{
        $("[data-destination-field]",node).hidden=$("[data-destination-kind]",node).value!=="uri";
        captureBuild(form);
      });
      $("[data-destination-iri]",node).addEventListener("input",()=>captureBuild(form));
    });
    await Promise.all(selectedSources.map(async(r,index)=>{
      const node=sourceNode.children[index],id=identity(r);
      try{
        const catalog=await catalogue("source",r);
        if(!node.isConnected||generation!==epoch||section.dataset.request!==local)return;
        $("[data-catalogue-loading]",node)?.remove();
        if(!catalog){
          node.insertAdjacentHTML("beforeend",'<p class="section-note">All source graphs will be retained. To select individual graphs, first use <strong>Inspect dataset</strong> on this exact source revision in Sources.</p>');
          return;
        }
        node.insertAdjacentHTML("beforeend",selectorHTML(id,catalog.graphs,{saved:drafts.get("source:"+id)||"all"}));
        wireSelector($("[data-graph-selector]",node),()=>captureBuild(form));
      }catch(error){
        if(node.isConnected){const loading=$("[data-catalogue-loading]",node);if(loading)loading.textContent=error.message;}
      }
    }));
  }
  function snapshotControls(){
    return field("Snapshot model",'<select name="data_model"><option value="graph">Single graph</option><option value="dataset">Dataset with named graphs</option></select>')+
      '<section data-dataset-build hidden><p class="section-note">Keep named graphs and the default graph separate. Select graph scope per original source; mapped rows have an explicit destination. The snapshot retains canonical N-Quads, TriG, the empty-graph catalogue and full provenance.</p>'+
      '<div data-build-sources></div><div data-build-mappings></div></section>';
  }
  function runControls(kind){
    if(kind==="validation")return '<section data-dataset-run="validation" hidden>'+
      field("Validation graph mode",'<select name="dataset_validation_mode"><option value="per_graph">Validate each graph separately</option><option value="union">Validate the selected union</option></select>')+
      '<p class="section-note">Each graph is a separate validation target. Selecting union intentionally joins the chosen triples for this run; shape and ontology inputs remain explicitly selected above.</p><div data-run-graph-choices></div></section>';
    if(kind==="query")return '<section data-dataset-run="query" hidden>'+
      field("SPARQL default graph",'<select name="dataset_default_graph"><option value="default">Retained default graph only</option><option value="union">Default plus selected named graphs</option></select>')+
      '<p class="section-note">GRAPH reads only the selected named graphs. FROM and SERVICE cannot introduce unretained inputs. A union choice changes this query view and leaves the snapshot intact.</p><div data-run-graph-choices></div></section>';
    return '<section data-dataset-run="comparison" hidden>'+
      field("Impact traversal scope",'<select name="dataset_impact_mode"><option value="within_graph">Follow relationships within each graph</option><option value="union">Follow relationships across selected graphs</option></select>')+
      '<p class="section-note">The complete difference includes graph membership and empty-graph changes. The impact limit affects the traversal only. Blank-node labels describe a snapshot, not a cross-edition business identifier.</p><div data-run-graph-choices></div></section>';
  }
  async function updateRun(form,kind,epoch){
    const section=$("[data-dataset-run]",form);
    if(!section)return;
    const fields=kind==="comparison"?["before","after"]:["snapshot"];
    const values=fields.map(name=>$('[name="'+name+'"]',form)?.value||"");
    const chosen=values.map(snapshot);
    const active=chosen.some(isDataset);
    section.hidden=!active;
    if(!active)return;
    const holder=$("[data-run-graph-choices]",section);
    const prior=$("[data-graph-selector]",holder);
    if(prior)drafts.set(kind+":"+holder.dataset.basis,selectorValue(prior,{allowEmpty:true}));
    const basis=values.join("|"),request=String(Number(holder.dataset.request||0)+1);
    holder.dataset.request=request;holder.dataset.basis=basis;
    holder.innerHTML='<p>Reading exact snapshot graph identities…</p>';
    if(kind==="comparison"&&!chosen.every(isDataset)){
      holder.innerHTML='<p class="section-note">Choose two dataset snapshots for a dataset comparison. A single-graph snapshot has a different data model.</p>';
      return;
    }
    try{
      const catalogs=await Promise.all(values.map(value=>catalogue("snapshot",ref(value))));
      if(!holder.isConnected||generation!==epoch||holder.dataset.request!==request)return;
      if(catalogs.some(c=>!c))throw new Error("This snapshot is missing its original graph catalogue.");
      const rows=new Map();
      for(const c of catalogs)for(const row of c.graphs)rows.set(choice(row.graph),row);
      holder.innerHTML=selectorHTML(kind,Array.from(rows.values()),{
        namedOnly:kind==="query",allowEmpty:kind==="query",
        title:kind==="query"?"Named graphs available to GRAPH":"Graphs included in this operation",
        saved:drafts.get(kind+":"+basis)||"all"
      });
      wireSelector($("[data-graph-selector]",holder),()=>drafts.set(kind+":"+basis,selectorValue($("[data-graph-selector]",holder),{allowEmpty:true})));
    }catch(error){
      if(holder.isConnected&&generation===epoch)holder.innerHTML='<p class="section-note">'+esc(error.message)+'</p>';
    }
  }
  function mount(root,workspaceId){
    if(workspace!==workspaceId){workspace=workspaceId;drafts.clear();cache.clear();}
    const epoch=++generation;
    const build=$("#snapshot-form",root);
    if(build){
      for(const name of ["data_model","sources","mappings"])$('[name="'+name+'"]',build)?.addEventListener("change",()=>updateBuild(build,epoch));
      updateBuild(build,epoch);
    }
    for(const [id,kind] of [["validation-form","validation"],["query-form","query"],["comparison-form","comparison"]]){
      const f=$("#"+id,root);if(!f)continue;
      const names=kind==="comparison"?["before","after"]:["snapshot"];
      for(const name of names)$('[name="'+name+'"]',f)?.addEventListener("change",()=>updateRun(f,kind,epoch));
      updateRun(f,kind,epoch);
    }
    const source=$("#source-form",root);
    if(source){
      const sync=()=>{const section=$("[data-catalogue-companion]",source);if(section)section.hidden=$('[name="format"]',source).value!=="nquads";};
      $('[name="format"]',source)?.addEventListener("change",sync);sync();
    }
  }
  function augment(id,payload,form){
    if(id==="snapshot-form"){
      const model=$('[name="data_model"]',form).value;
      if(model!=="dataset")return payload;
      captureBuild(form);
      const source_graphs={},mapping_graphs={};
      for(const r of payload.sources)source_graphs[identity(r)]=drafts.get("source:"+identity(r))||"all";
      for(const r of payload.mappings){
        const saved=drafts.get("mapping:"+identity(r))||{type:"default"};
        if(saved.type==="uri"&&!saved.value?.trim())throw new Error("Enter the destination graph IRI for each mapped-row destination.");
        mapping_graphs[identity(r)]=saved.type==="uri"?{type:"uri",value:saved.value.trim()}:{type:"default"};
      }
      for(const value of Object.values(source_graphs))if(Array.isArray(value)&&!value.length)throw new Error("A source graph selection cannot be empty.");
      return {...payload,data_model:"dataset",source_graphs,mapping_graphs};
    }
    if(id==="validation-form"&&isDataset(snapshot(payload.snapshot))){
      return {...payload,validation_scope:{mode:$('[name="dataset_validation_mode"]',form).value,
        graphs:selectorValue($("[data-graph-selector]",form))}};
    }
    if(id==="query-form"&&isDataset(snapshot(payload.snapshot))){
      return {...payload,query_scope:{default_graph:$('[name="dataset_default_graph"]',form).value,
        named_graphs:selectorValue($("[data-graph-selector]",form),{allowEmpty:true})}};
    }
    if(id==="comparison-form"&&(isDataset(snapshot(payload.before))||isDataset(snapshot(payload.after)))){
      if(!isDataset(snapshot(payload.before))||!isDataset(snapshot(payload.after)))throw new Error("Choose two dataset snapshots.");
      return {...payload,comparison_scope:{impact_mode:$('[name="dataset_impact_mode"]',form).value,
        graphs:selectorValue($("[data-graph-selector]",form))}};
    }
    return payload;
  }
  function identityNote(meta){
    if(!meta||typeof meta!=="object")return "";
    const parts=[meta.algorithm,meta.implementation,meta.version].filter(value=>typeof value==="string"&&value);
    return '<p class="section-note">'+esc(parts.join(" · "))+
      (meta.profile?' · Inventory profile: <code>'+esc(meta.profile)+'</code>':"")+
      '. Keep the N-Quads and graph catalogue together to reproduce this dataset identity.</p>';
  }
  function preview(data){
    if(!data||!Array.isArray(data.graphs)||!["commons-semantic-graph-catalog/1","commons-semantic-dataset-inspection/1"].includes(data.schema))return "";
    return '<h3>Complete retained graph catalogue</h3><p>'+
      badge((data.quad_count??"")+" quads")+" "+badge(data.graphs.length+" graph identities")+
      '</p><p class="section-note">Empty graphs remain part of dataset identity. Graph names below are the retained selectors for this exact source or snapshot.</p>'+
      table(["Graph","Quads","Empty","Original source graph"],data.graphs.map(row=>[
        '<code>'+esc(label(row.graph))+'</code><br>'+esc(row.graph.type),
        esc(row.quad_count),badge(row.empty?"Yes":"No"),
        (row.origins||[]).map(origin=>'<code>'+esc(origin.input_key||"")+'</code><br>'+
          esc(label(origin.source_graph))+'<br><small>'+esc(origin.sha256||"")+'</small>').join("<hr>")||"—"
      ]))+'<p><strong>Dataset SHA-256</strong><br><code>'+esc(data.dataset_sha256)+'</code></p>'+
      '<p><strong>N-Quads SHA-256</strong><br><code>'+esc(data.nquads_sha256)+'</code></p>'+
      identityNote(data.canonicalization);
  }
  function recordSummary(row){
    if(!isDataset(row))return "";
    const p=row.payload,s=p.summary||p.native_result?.summary||{},params=p.parameters||p.spec?.parameters||{};
    const details=[["quad_count","Quads"],["graph_count","Graphs"],["named_graph_count","Named graphs"],
      ["empty_graph_count","Empty graphs"],["added_quads","Added quads"],["removed_quads","Removed quads"]];
    const values=details.filter(([k])=>s[k]!==undefined).map(([k,l])=>'<span><strong>'+esc(s[k])+'</strong> '+l+'</span>');
    let scope="";
    if(params.validation_scope)scope=params.validation_scope.mode==="union"?"Validation of the selected union":"Separate validation of each selected graph";
    if(params.query_scope)scope=params.query_scope.default_graph==="union"?"Query default graph: explicit union of default and selected named graphs":"Query default graph: retained default graph";
    if(params.comparison_scope)scope=params.comparison_scope.impact_mode==="union"?"Impact traversal across selected graphs":"Impact traversal within each graph";
    return '<section class="dataset-summary"><p>'+badge("Dataset")+" "+values.join(" · ")+'</p>'+
      (scope?'<p>'+esc(scope)+'</p>':"")+
      identityNote(s.canonicalization)+
      '<p class="section-note">Quad identity and the empty-graph catalogue travel together. Source origins remain separately retained.</p></section>';
  }
  return {isDataset,snapshotControls,runControls,mount,augment,preview,recordSummary};
};
