import fs from "node:fs/promises";
import path from "node:path";
import {createHash} from "node:crypto";

const digest = value => createHash("sha256").update(value).digest("hex");
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

/** Continue one existing Staff server, browser, workspace and completed native run. */
export async function runSnowpackBrowser({page, browser, context, input}) {
  if (!page || !browser || !context) throw new Error("Use the operator's existing browser and context");
  for (const key of ["url","origin","workspace_id","project_id","run_id","dagster_run_id","output"])
    if (!input[key]) throw new Error("Missing original operator input: " + key);
  if (new URL(input.url).origin !== input.origin) throw new Error("Original browser origin changed");
  const output = path.resolve(input.output);
  const progressPath = path.join(output, "browser-workflow.json");
  const requestsDir = path.join(output, "browser-requests");
  await fs.mkdir(requestsDir, {recursive:true});
  const identity = Object.fromEntries(["origin","workspace_id","project_id","run_id","dagster_run_id"]
    .map(key => [key,input[key]]));
  let saved;
  try { saved = JSON.parse(await fs.readFile(progressPath,"utf8")); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  if (saved && JSON.stringify(saved.identity) !== JSON.stringify(identity))
    throw new Error("The retained browser operation belongs to another original run");
  const journal = saved || {schema:"tjlabs.snowpack-browser-workflow/v1", identity,
    state:"running", steps:{}, requests:{}, downloads:{}, observations:{}};
  if (saved?.state==="completed") {
    for (const row of Object.values(saved.downloads))
      if (row.state==="completed" && digest(await fs.readFile(row.path))!==row.sha256)
        throw new Error("Retained completed download bytes changed");
    return {state:"completed",...saved.observations,
      delivery:saved.downloads["Snowpack_Internal_Example_Delivery.zip"],progress_path:progressPath};
  }
  let serial = Promise.resolve(), routeError = null;
  const inflight = new Set();
  async function atomic(file, bytes) {
    const temporary = file + ".writing";
    const handle = await fs.open(temporary,"w",0o600);
    try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
    await fs.rename(temporary,file);
    const directory = await fs.open(path.dirname(file),"r");
    try { await directory.sync(); } finally { await directory.close(); }
  }
  function persist() {
    const bytes = JSON.stringify(journal,null,2) + "\n";
    serial = serial.then(() => atomic(progressPath,bytes));
    return serial;
  }
  async function retain(file, bytes) {
    try {
      const handle = await fs.open(file,"wx",0o600);
      try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
      const directory=await fs.open(path.dirname(file),"r");
      try { await directory.sync(); } finally { await directory.close(); }
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      if (!(await fs.readFile(file)).equals(Buffer.from(bytes)))
        throw new Error("The original retained request or response bytes changed");
    }
  }
  function track(promise) {
    inflight.add(promise);
    promise.catch(error => { routeError = error; }).finally(() => inflight.delete(promise));
  }
  async function until(predicate, message, timeout=60000) {
    const end = Date.now()+timeout;
    while (Date.now()<end) {
      if (routeError) throw routeError;
      const value = await predicate();
      if (value) return value;
      await delay(100);
    }
    throw new Error(message);
  }
  async function requestRoute(route) {
    const request = route.request(), url = new URL(request.url());
    try {
      if (url.origin === input.origin && request.method() === "POST" &&
          ["/api/invoke","/api/receive","/api/open"].includes(url.pathname)) {
        const bytes = request.postData() || "", body = JSON.parse(bytes), id = body.request_id;
        if (!/^[0-9a-f-]{36}$/i.test(id || "")) throw new Error("The UI mutation omitted its original UUID");
        const previous = journal.requests[id];
        if (previous && (previous.sha256 !== digest(bytes) || previous.endpoint !== url.pathname))
          throw new Error("A saved original UI request changed its body or endpoint");
        const step = journal.current || previous?.step;
        if (!step) throw new Error("Unexpected UI mutation outside the original browser continuation");
        const existing = journal.steps[step]?.request_id;
        if (existing && existing !== id) throw new Error("A step attempted a second mutation request ID");
        const file = path.join(requestsDir, id + ".request.json");
        await retain(file,bytes);
        journal.requests[id] = previous || {request_id:id,step,endpoint:url.pathname,
          body_file:file,sha256:digest(bytes),state:"prepared"};
        journal.steps[step] = {...journal.steps[step],request_id:id};
        await persist(); // Persist the actual UI body BEFORE its first dispatch.
      } else if (url.origin === input.origin && request.method() === "GET" &&
          (url.pathname === "/api/backup" || /^\/api\/releases\/[^/]+\/download$/.test(url.pathname))) {
        const name = journal.active_download;
        if (!name) throw new Error("Unexpected archive build outside the original download");
        const row = journal.downloads[name] || {};
        if (row.url && row.url !== request.url()) throw new Error("Resume the original archive request URL");
        journal.downloads[name] = {...row,url:request.url(),request_id:url.searchParams.get("request_id")};
        await persist();
      }
      await route.continue();
    } catch (error) { routeError = error; await route.abort("failed").catch(()=>{}); }
  }
  function responseListener(response) {
    track((async () => {
      const request = response.request(), url = new URL(response.url());
      if (url.origin !== input.origin || request.method() !== "POST" ||
          !["/api/invoke","/api/receive","/api/open"].includes(url.pathname)) return;
      const id = JSON.parse(request.postData() || "{}").request_id, row = journal.requests[id];
      if (!row) throw new Error("A response has no previously retained original request");
      const raw = await response.text(), answer = JSON.parse(raw);
      if (response.status() >= 500 || answer.outcome_unknown) {
        row.state="unresolved"; row.last_http_status=response.status(); await persist(); return;
      }
      const file = path.join(requestsDir,id + ".response.json");
      if (!row.response_file) await retain(file,raw);
      else if (digest(await fs.readFile(row.response_file)) !== digest(raw)) {
        // A replay may add response metadata; keep the first completed response authoritative.
        if (answer.request_id !== id) throw new Error("Replay returned another request identity");
      }
      row.response_file = row.response_file || file;
      row.http_status = response.status(); row.state="completed";
      await persist();
    })());
  }
  await page.route("**/api/**",requestRoute);
  page.on("response",responseListener);
  const json = async endpoint => {
    const response = await page.request.get(input.origin+endpoint);
    const answer = await response.json();
    if (!response.ok()) throw new Error(answer.error?.message || "Read failed: "+response.status());
    return answer;
  };
  const read = async (action,payload) => (await json("/api/read?action="+
    encodeURIComponent(action)+"&payload="+encodeURIComponent(JSON.stringify(payload)))).result;
  const kv = key => page.evaluate(key => new Promise((resolve,reject) => {
    const open=indexedDB.open("pipeline-staff",1);
    open.onerror=()=>reject(open.error);
    open.onsuccess=()=>{const db=open.result,request=db.transaction("kv","readonly").objectStore("kv").get(key);
      request.onsuccess=()=>{resolve(request.result);db.close();};request.onerror=()=>reject(request.error);};
  }),key);
  async function settled(id=null) {
    await page.locator("#shell").waitFor({state:"visible",timeout:60000});
    await until(async () => !(await kv("pending")) && (!id || (await kv("lastResponse"))?.request_id===id),
      "The original UI request is still retained; resume this continuation");
    await page.locator("#pending-panel").waitFor({state:"hidden",timeout:60000});
  }
  async function completeStep(name, firstAction) {
    const step=journal.steps[name] || {};
    if (step.state==="completed") return JSON.parse(await fs.readFile(step.response_file,"utf8"));
    journal.current=name; await persist();
    if (step.request_id) {
      const row=journal.requests[step.request_id];
      if (!row) throw new Error("Original step request is missing");
      if (!row.response_file) {
        const pending=await kv("pending");
        if (pending) {
          if (pending.request_id!==row.request_id) throw new Error("Another original request owns the browser");
          await page.locator("#resume-request").click();
        } else {
          const raw=await fs.readFile(row.body_file,"utf8");
          await page.evaluate(async ({endpoint,raw}) => {
            const response=await fetch(endpoint,{method:"POST",credentials:"same-origin",
              headers:{"Content-Type":"application/json"},body:raw});
            await response.text();
          },{endpoint:row.endpoint,raw});
          await page.reload({waitUntil:"domcontentloaded"});
        }
      } else await page.reload({waitUntil:"domcontentloaded"});
    } else await firstAction();
    const row=await until(() => {
      const id=journal.steps[name]?.request_id, item=id && journal.requests[id];
      return item?.response_file && item;
    },"The original "+name+" response has not completed");
    if (row.http_status<200 || row.http_status>=300) {
      const answer=JSON.parse(await fs.readFile(row.response_file,"utf8"));
      throw new Error(answer.error?.message || "Original UI request rejected");
    }
    await settled((await kv("lastResponse"))?.request_id===row.request_id ? row.request_id : null);
    journal.steps[name]={request_id:row.request_id,response_file:row.response_file,state:"completed"};
    journal.current=null; await persist();
    return JSON.parse(await fs.readFile(row.response_file,"utf8"));
  }
  async function projectView() {
    const project=await read("project.get",{id:input.project_id});
    await page.locator("#projects .project-item").filter({hasText:project.project.label}).first().click();
    await page.locator("#project-title").waitFor({state:"visible"});
    return project;
  }
  async function sourceView() {
    await projectView();
    await page.locator('#tabs [data-tab="source"]').click();
    await page.locator("#source-files .file-item").filter({hasText:/^README\.md/}).first().click();
  }
  async function persistedText(text, base) {
    const encoded=Buffer.from(text,"utf8").toString("base64");
    await page.waitForFunction(({encoded,base}) => new Promise((resolve,reject) => {
      const request=indexedDB.open("pipeline-staff",1);
      request.onerror=()=>reject(request.error);
      request.onsuccess=()=>{const db=request.result,r=db.transaction("kv","readonly").objectStore("kv").getAll();
        r.onsuccess=()=>{resolve(r.result.some(value=>value?.source?.base===base &&
          value.source.files?.["README.md"]?.content_base64===encoded));db.close();};
        r.onerror=()=>reject(r.error);};
    }),{encoded,base},{timeout:30000});
  }
  async function editorEquals(text) {
    await page.waitForFunction(value=>document.getElementById("file-editor")?.value===value,text,{timeout:30000});
  }
  async function download(name, action, {sha256=null,archive=false}={}) {
    let row=journal.downloads[name] || {}, file=path.join(output,name);
    if (row.state==="completed") {
      if (digest(await fs.readFile(row.path))!==row.sha256) throw new Error("Retained download bytes changed");
      return row;
    }
    journal.active_download=name; await persist();
    let headers=null;
    if (row.url) {
      const response=await page.request.get(row.url);
      if (!response.ok()) throw new Error("Original archive download has not completed");
      headers=response.headers(); await atomic(file,await response.body());
    } else {
      const pending=page.waitForEvent("download",{timeout:60000});
      await action(); const event=await pending;
      if (await event.failure()) throw new Error("Original browser download failed");
      await event.saveAs(file);
      const handle=await fs.open(file,"r");try{await handle.sync();}finally{await handle.close();}
    }
    const bytes=await fs.readFile(file), actual=digest(bytes);
    if (sha256 && sha256!==actual) throw new Error("Downloaded original bytes differ from their saved SHA-256");
    if (archive) {
      const observed=headers ? {sha256:headers["x-archive-sha256"],workspace_id:headers["x-workspace-id"],
        revision:headers["x-workspace-revision"],receiving_id:headers["x-receiving-id"]} : await kv("lastDownload");
      if (!observed || observed.sha256!==actual || observed.workspace_id!==input.workspace_id)
        throw new Error("The complete delivery does not match its original archive identity");
      row={...row,identity:observed};
    }
    journal.downloads[name]={...journal.downloads[name],...row,path:file,bytes:bytes.length,sha256:actual,state:"completed"};
    journal.active_download=null; await persist(); return journal.downloads[name];
  }
  try {
    await persist();
    await page.goto(input.url,{waitUntil:"domcontentloaded"});
    await settled();
    const state=await json("/api/state"), run=await read("run.get",{id:input.run_id});
    if (state.workspace_id!==input.workspace_id || run.project_id!==input.project_id || run.id!==input.run_id ||
        run.dagster_run_id!==input.dagster_run_id || run.state!=="succeeded" ||
        run.outcome?.evaluation?.criteria_satisfied!==true)
      throw new Error("Continue only the actual successful original Dagster/dbt run");
    if (!journal.original) {
      const project=await read("project.get",{id:input.project_id});
      const original=await read("file.read",{edition_id:project.edition.id,path:"README.md"});
      if (typeof original.content!=="string") throw new Error("The original README is not UTF-8 text");
      journal.original={project:project.project,edition_id:project.edition.id,file:original,
        native_run_id:run.dagster_run_id,outcome_sha256:run.outcome_sha256};
      await persist();
    }
    const sourceText=journal.original.file.content+"\n\n## Internal operating handoff\n\n"+
      "Observed native run: "+input.dagster_run_id+".\n"+
      "This official Jaffle Shop example is an internal delivery demonstration — no client production run is implied.\n";
    const source=await completeStep("source-edition",async()=>{
      await sourceView();
      await page.locator("#file-editor").fill(sourceText);
      await page.locator("#edition-label").fill("Internal operating handoff");
      await page.locator("#edition-notes").fill("Preserve the original official example and identify its completed native run.");
      await persistedText(sourceText,journal.original.edition_id);
      await page.reload({waitUntil:"domcontentloaded"}); await settled(); await sourceView(); await editorEquals(sourceText);
      await download("original-README.md",()=>page.locator("#file-download").click(),
        {sha256:journal.original.file.sha256});
      journal.observations.source_draft_reload=true; await persist();
      await page.locator("#source-save").click();
    });
    const savedSource=await read("file.read",{edition_id:source.result.id,path:"README.md"});
    if (savedSource.content!==sourceText) throw new Error("Saved source edition differs from the retained UTF-8 draft");
    await projectView(); await page.locator('#tabs [data-tab="runs"]').click();
    await page.locator("#runs-table").getByRole("button",{name:input.run_id,exact:true}).click();
    await page.waitForFunction(id=>document.getElementById("run-summary")?.textContent.includes(id),input.dagster_run_id);
    const artifact=run.outcome.evaluation.artifact_files.find(file=>/(^|\/)manifest\.json$/.test(file.path));
    if (!artifact) throw new Error("The original native manifest artifact is missing");
    await download("original-manifest.json",()=>page.locator("#run-artifacts .artifact-row")
      .filter({hasText:artifact.path}).getByRole("button",{name:"Download original artifact",exact:true}).click(),
      {sha256:artifact.sha256});
    const review=await completeStep("review",async()=>{
      await projectView(); await page.locator('#tabs [data-tab="reviews"]').click();
      await page.locator("#review-run").selectOption(input.run_id);
      await page.locator("#review-reviewer").fill("TJLabs internal delivery operator");
      await page.locator("#review-decision").selectOption("approve");
      await page.locator("#review-comment").fill("Reviewed the original successful native run, original artifact bytes, and required operating criteria for the official example.");
      await page.locator("#review-save").click();
    });
    const releaseLabel="Internal example delivery "+input.run_id;
    const release=await completeStep("release",async()=>{
      await projectView(); await page.locator('#tabs [data-tab="releases"]').click();
      await page.locator("#release-review").selectOption(review.result.id);
      await page.locator("#release-label").fill(releaseLabel);
      await page.locator("#release-notes").fill("Contains the original reviewed native outcome, source history and receiving workflow. Internal example, ready for inspection.");
      await page.locator("#release-create").click();
    });
    await projectView(); await page.locator('#tabs [data-tab="releases"]').click();
    const delivery=await download("Snowpack_Internal_Example_Delivery.zip",()=>page.locator("#releases-table tr")
      .filter({hasText:releaseLabel}).getByRole("button",{name:"Build & download release",exact:true}).click(),{archive:true});
    const originalDraft=sourceText+"\nOriginal workspace follow-up — retain this unsaved note in the original directory.\n";
    if (!journal.steps["receive"]?.request_id) {
      await sourceView(); await page.locator("#file-editor").fill(originalDraft);
      await persistedText(originalDraft,source.result.id);
    }
    const received=await completeStep("receive",async()=>{
      await page.locator("#show-receiving").click();
      await page.locator("#receiving-file").setInputFiles(delivery.path);
      await page.locator("#receive-submit").click();
    });
    const receivingId=received.result.selection.receiving_id;
    if (!receivingId || receivingId==="original") throw new Error("Receiving did not select its retained directory");
    if (!journal.received) {
      const project=await read("project.get",{id:input.project_id});
      const file=await read("file.read",{edition_id:project.edition.id,path:"README.md"});
      journal.received={receiving_id:receivingId,edition_id:project.edition.id,file,
        description:project.project.description+"\nReceived delivery operating notes — retain this later edit."};
      await persist();
    }
    const receivedDraft=journal.received.file.content+"\nReceived workspace follow-up — this unsaved note belongs to the receiving directory.\n";
    if (!journal.steps["received-edit"]?.request_id) {
      await sourceView();
      await editorEquals(journal.received.file.content);
      await page.locator("#file-editor").fill(receivedDraft);
      await persistedText(receivedDraft,journal.received.edition_id);
    }
    await completeStep("received-edit",async()=>{
      await projectView(); await page.locator("#edit-project").click();
      await page.locator("#project-notes").fill(journal.received.description);
      await page.locator("#project-form").getByRole("button",{name:"Save project",exact:true}).click();
    });
    await completeStep("open-original",async()=>{
      await page.locator("#show-receiving").click(); await page.locator("#open-original").click();
    });
    if (!journal.steps["reopen-received"]?.request_id) {
      await sourceView(); await editorEquals(originalDraft);
      const originalProject=await read("project.get",{id:input.project_id});
      if (originalProject.project.description!==journal.original.project.description)
        throw new Error("The received-directory edit changed the original writer");
    }
    await completeStep("reopen-received",async()=>{
      await page.locator("#show-receiving").click();
      await page.locator("#received-table tr").filter({hasText:receivingId})
        .getByRole("button",{name:"Open retained workspace",exact:true}).click();
    });
    await sourceView(); await editorEquals(receivedDraft);
    const again=await completeStep("same-archive-receive",async()=>{
      await page.locator("#show-receiving").click();
      await page.locator("#receiving-file").setInputFiles(delivery.path); await page.locator("#receive-submit").click();
    });
    const finalProject=await read("project.get",{id:input.project_id}), finalRun=await read("run.get",{id:input.run_id});
    if (again.result.selection.receiving_id!==receivingId ||
        finalProject.project.description!==journal.received.description ||
        finalRun.dagster_run_id!==input.dagster_run_id || finalRun.outcome_sha256!==run.outcome_sha256)
      throw new Error("Receiving did not preserve later edits and the original native outcome");
    await sourceView(); await editorEquals(receivedDraft);
    journal.observations={...journal.observations,project_id:run.project_id,run_id:run.id,source_edition_id:source.result.id,review_id:review.result.id,
      release_id:release.result.id,receiving_id:receivingId,original_native_run_id:input.dagster_run_id,
      native_outcome_sha256:run.outcome_sha256,original_and_received_drafts_retained:true,
      same_archive_preserved_later_edit:true};
    journal.state="completed"; journal.current=null; await persist();
    if (input.result_path) await atomic(path.resolve(input.result_path),JSON.stringify(journal,null,2)+"\n");
    return {state:"completed",...journal.observations,delivery,progress_path:progressPath};
  } catch (error) {
    journal.state="incomplete";journal.error={message:error.message,at:new Date().toISOString()};
    await persist().catch(()=>{}); throw error;
  } finally {
    await page.unroute("**/api/**",requestRoute).catch(()=>{});
    page.off("response",responseListener);
    await Promise.allSettled([...inflight]); await serial;
  }
}
