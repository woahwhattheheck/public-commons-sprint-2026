/** Recoverable Conservation authoring in the existing operator. */
import {openConservationWorkingStore, makeFile, encodeFile, inspectFile} from "./conservation_working.mjs";
const h = value => String(value ?? "").replace(/[&<>"']/g, c =>
  ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const copy = value => structuredClone(value);
const opt = (value, label, selected) => '<option value="' + h(value) + '"' +
  (value === selected ? " selected" : "") + ">" + h(label) + "</option>";
const btn = (name, label, disabled = false) => '<button type="button" data-action="conservation-working-' +
  h(name) + '"' + (disabled ? " disabled" : "") + ">" + h(label) + "</button>";
function download(bytes, filename) {
  const body = typeof bytes === "string" ? bytes : bytes instanceof Uint8Array ? bytes : JSON.stringify(bytes, null, 2) + "\n";
  const url = URL.createObjectURL(new Blob([body], {type:"application/json;charset=utf-8"}));
  const anchor = document.createElement("a"); anchor.href = url; anchor.download = filename;
  document.body.append(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 60000);
}
export function attachConservationWorkingView({getWorkspace, getProject, capture, compare, apply, repaint}) {
  const states = new Map();
  let storePromise = null;
  const database = () => storePromise ||= openConservationWorkingStore().catch(error => {storePromise = null; throw error;});
  function state() {
    const project = getProject(), workspace = getWorkspace();
    if (!project?.id || !workspace) return null;
    const key = JSON.stringify([project.id, workspace]);
    if (!states.has(key)) states.set(key, {key,projectId:project.id,workspace,loaded:false,loading:false,
      files:[],file:null,preview:null,previewPayload:null,selectedId:"",editionId:"",name:"",
      editionLabel:"",message:"",error:false,busy:false,pending:null,saving:null,signature:null,
      conflict:false,detached:false,comparison:null,generation:0});
    return states.get(key);
  }
  const visible = s => state() === s;
  function notify(s, message, error = false) {
    s.message = message; s.error = error;
    if (visible(s)) repaint();
  }
  function snapshot(s) {
    if (!visible(s)) throw Error("Open this working file in its original project workspace.");
    return copy(capture());
  }
  function filename(file) {
    return "Conservation_Working_" + file.id + ".json";
  }
  async function refresh(s) {
    const db = await database();
    s.files = await db.list(s.projectId);
  }
  async function load(s) {
    if (s.loaded || s.loading) return;
    s.loading = true;
    try {
      await refresh(s); s.loaded = true;
      if (!s.selectedId && s.files.length) s.selectedId = s.files[0].id;
    } catch (error) {s.loaded = true;s.message = "Browser recovery: " + error.message + ". Download working files to retain your edits.";s.error = true;}
    finally {s.loading = false;if (visible(s)) repaint();}
  }
  function title(s, payload) {
    return s.name.trim() || payload.draft?.title?.trim() || payload.originals?.study?.title || "Conservation working file";
  }
  function dirty(s, payload) {
    return JSON.stringify(payload) !== s.signature;
  }
  function remember() {
    const s = state();
    if (!s) return;
    const payload = snapshot(s);
    if (!s.file && !payload.form && !(payload.selection?.selected_ids?.length || payload.selection?.retained_selection)) return;
    if (!dirty(s, payload)) return;
    s.pending = payload;
    if (!s.busy && !s.saving && !s.conflict) void flush(s);
  }
  async function flush(s = state()) {
    if (!s) return;
    if (s.saving) return s.saving;
    if (s.conflict) return;
    const process = async () => {
      while (s.pending && !s.conflict) {
        const payload = s.pending; s.pending = null;
        let candidate;
        try {
          candidate = await makeFile({payload,name:title(s,payload),existingFile:s.file || undefined});
          const db = await database();
          const saved = s.file
            ? await db.save({projectId:s.projectId,fileId:s.file.id,expectedRevision:s.file.revision,payload,name:title(s,payload)})
            : await db.create({payload,name:title(s,payload)});
          s.file = saved; s.name = saved.name; s.selectedId = saved.id;
          s.signature = JSON.stringify(payload); s.error = false;
          s.message = "Working edits saved in this browser.";
          await refresh(s);
        } catch (error) {
          // The candidate includes every named edition even when persistent storage fails.
          s.localCandidate = candidate || s.localCandidate;
          s.pending ||= payload; s.conflict = true;s.error = true;
          s.message = error.message + " Your current edits are retained here. Download them or save an independent working file.";
        }
      }
    };
    s.saving = process();
    try {await s.saving;} finally {s.saving = null;if (visible(s)) repaint();}
  }
  async function protect(s) {
    const payload = snapshot(s);
    if (s.file || payload.form || payload.selection?.selected_ids?.length || payload.selection?.retained_selection) {
      if (dirty(s,payload)) s.pending = payload;
    }
    await flush(s);
    if (s.conflict) throw Error("Download the current edits or save an independent file before opening another working edition.");
  }
  function selectedPayload(s) {return s.previewPayload || s.preview?.active?.payload || null;}
  async function showFile(s, id) {
    await protect(s);
    const db = await database(), file = await db.read(s.projectId, id);
    if (!visible(s)) return;
    if (!file) throw Error("This browser working file is no longer available.");
    s.preview = file;s.previewPayload = null;s.editionId = "";s.selectedId = file.id;
    s.detached = true;s.comparison = null;s.generation++;
    notify(s, "Opened the complete working file for review. Check its original records, then restore its authored forms.");
  }
  async function comparePreview(s) {
    const payload = selectedPayload(s);
    if (!payload) throw Error("Open a saved working file first.");
    const generation = s.generation;
    const result = await compare(copy(payload));
    if (!visible(s) || generation !== s.generation) return null;
    s.comparison = result;
    notify(s, result.available ? "Original project records are available. Restore this edition to continue editing."
      : "Review the listed original records. The complete working file remains available to download.");
    return result;
  }
  async function restore(s) {
    await protect(s);
    const payload = selectedPayload(s);
    if (!payload || !s.preview) throw Error("Open a saved working edition first.");
    const generation = s.generation, file = s.preview, editorBefore = JSON.stringify(snapshot(s));
    const result = await compare(copy(payload));
    if (!visible(s) || generation !== s.generation) return;
    if (JSON.stringify(snapshot(s)) !== editorBefore) throw Error("The editor changed during source review. Save its current work, then restore the chosen edition again.");
    s.comparison = result;
    if (!result.available) throw Error("The selected edition needs the original records listed below before its forms can be restored.");
    const db = await database();
    // Fresh CAS occurs before any live editor form is replaced.
    const admission = s.file?.id === file.id ? s.file : file;
    const saved = await db.save({projectId:s.projectId,fileId:file.id,expectedRevision:admission.revision,
      payload,name:admission.name});
    if (!visible(s) || generation !== s.generation) return;
    if (JSON.stringify(snapshot(s)) !== editorBefore) throw Error("The editor changed during working-file admission. Its current values remain open; choose Restore again after saving them.");
    await apply(copy(payload), result);
    if (!visible(s)) return;
    s.file = saved;s.preview = null;s.previewPayload = null;s.detached = false;
    s.signature = JSON.stringify(saved.active.payload);s.name = saved.name;s.selectedId = saved.id;
    s.pending = null;s.conflict = false;s.localCandidate = null;
    await refresh(s);
    notify(s, "Restored the complete authored edition. Continue in the original Conservation forms.");
  }
  function summary(payload) {
    if (!payload) return "";
    const select = payload.selection || {};
    return '<dl class="cons-definitions"><dt>Project</dt><dd>' + h(payload.project?.title || payload.project?.id) +
      '</dd><dt>Open form</dt><dd>' + h(payload.form || "Candidate selection") +
      '</dd><dt>Study draft</dt><dd>' + h(payload.draft?.title || "Untitled") +
      '</dd><dt>Matched families</dt><dd>' + h(payload.draft?.matched_families?.length || 0) +
      '</dd><dt>Authored criteria</dt><dd>' + h(payload.optimization?.criteria?.length || 0) +
      '</dd><dt>Case comparisons</dt><dd>' + h(payload.optimization?.scenario_cases?.length || 0) +
      '</dd><dt>Original study</dt><dd>' + h(select.study_id || "New study") +
      '</dd><dt>Original portfolio</dt><dd>' + h(select.plan_id || "No selected portfolio") +
      '</dd><dt>Explicit selected units</dt><dd>' + h(select.selected_ids?.length || 0) +
      '</dd><dt>Retained large selection</dt><dd>' + h(select.retained_selection?.selection_id || "No retained cohort") +
      "</dd></dl>";
  }
  function render() {
    const s = state();
    if (!s) return "";
    if (!s.loaded && !s.loading) void load(s);
    const payload = selectedPayload(s), file = s.preview || s.file;
    let out = '<details class="cons-disclosure" data-conservation-working-panel><summary>Working files and recovery</summary>' +
      '<p>Unfinished study, portfolio, priority, family and scenario choices are retained together. Named editions preserve complete authored versions; downloaded working files reopen in an independently received copy of the same project.</p>' +
      '<p data-conservation-working-status role="' + (s.error ? "alert" : "status") + '">' + h(s.message || (s.loading ? "Opening browser working files…" : "Edits are saved as you work.")) + '</p>' +
      '<div class="cons-grid"><label class="cons-field"><span>Working file name</span><input data-working-field="name" value="' + h(s.name) + '" maxlength="240"></label>' +
      '<label class="cons-field"><span>Saved files for this project</span><select data-working-field="file">' +
      opt("", "Choose a saved working file", s.selectedId) + s.files.map(x => opt(x.id, x.name + " · " + (x.updatedAt || x.updated_at || ""), s.selectedId)).join("") + "</select></label></div>" +
      '<div class="cons-actions">' + btn("open","Open saved file",s.busy || !s.selectedId) +
      btn("download","Download complete working file",s.busy) +
      btn("fork","Save independent working file",s.busy) +
      btn("refresh","Refresh saved files",s.busy) + '</div>' +
      '<label class="cons-field"><span>Open a downloaded working file</span><input type="file" data-working-field="import" accept=".json,application/json"' + (s.busy ? " disabled" : "") + "></label>";
    if (s.file && !s.detached) {
      out += '<div class="cons-grid"><label class="cons-field"><span>Named edition</span><input data-working-field="edition-label" value="' + h(s.editionLabel) +
        '" maxlength="240"></label></div><div class="cons-actions">' + btn("save-edition","Save this complete edition",s.busy || s.conflict) + "</div>";
    }
    if (file?.editions?.length) {
      out += '<div class="cons-grid"><label class="cons-field"><span>Original named editions</span><select data-working-field="edition">' +
        opt("", "Active working edition", s.editionId) + file.editions.map(x => opt(x.id, x.label + " · " + x.createdAt, s.editionId)).join("") +
        '</select></label></div><div class="cons-actions">' + btn("edition","Open edition for review",s.busy) + "</div>";
    }
    if (payload) {
      out += '<section class="cons-subsection"><h3>Opened working edition</h3>' + summary(payload) +
        '<details><summary>Complete original authored values</summary><pre>' + h(JSON.stringify(payload,null,2)) + "</pre></details>";
      if (s.comparison) {
        out += '<div class="cons-table-wrap" tabindex="0"><table class="cons-table"><caption>Original record comparison</caption><thead><tr><th>Record</th><th>Current availability</th></tr></thead><tbody>' +
          (s.comparison.rows || []).map(row => "<tr><td>" + h(row.label) + "</td><td>" + h(row.message) + "</td></tr>").join("") +
          '</tbody></table></div>';
      }
      out += '<div class="cons-actions">' + btn("compare","Check original project records",s.busy) +
        btn("restore","Restore this edition into the editor",s.busy || !s.comparison?.available) +
        btn("close-preview","Return to current editor",s.busy) + "</div></section>";
    }
    return out + '<p>Full original datasets and completed scientific outputs travel in the existing editable Study or Workspace export. These working files retain the complete authored choices and their original record references.</p></details>';
  }
  function field(event) {
    const target = event.target, name = target?.getAttribute?.("data-working-field");
    if (!name) return false;
    const s = state(); if (!s) return true;
    if (name === "name") {s.name = target.value;if (event.type === "change") {s.signature = null;remember();}}
    if (name === "edition-label") s.editionLabel = target.value;
    if (name === "file") s.selectedId = target.value;
    if (name === "edition") s.editionId = target.value;
    if (name === "import" && event.type === "change" && target.files?.[0]) {
      const incoming = target.files[0];
      void operation(s,async () => {
        await protect(s);
        if (incoming.size > 32 * 1024 * 1024) throw Error("Choose a complete working file of at most 32 MiB.");
        const bytes = new Uint8Array(await incoming.arrayBuffer());
        const inspected = (await inspectFile(bytes)).file;
        if (inspected.projectId !== s.projectId) throw Error("Open this working file in its original project: " + inspected.projectId);
        const db = await database();
        const file = await db.importFile({bytes,expectedProjectId:s.projectId,name:inspected.name,filename:incoming.name});
        if (!visible(s)) return;
        s.preview = file;s.previewPayload = null;s.selectedId = file.id;s.editionId = "";
        s.detached = true;s.comparison = null;s.generation++;await refresh(s);
        notify(s,"Received a complete independent working copy. Review its original records before restoring the forms.");
      });
    }
    return true;
  }
  async function operation(s, action) {
    if (s.busy) return true;
    s.busy = true;if (visible(s)) repaint();
    try {await action();}
    catch (error) {notify(s,error.message || String(error),true);}
    finally {
      s.busy = false;
      if (visible(s)) remember();
      if (s.pending && !s.conflict) void flush(s);
      if (visible(s)) repaint();
    }
    return true;
  }
  async function dispatch(name) {
    const s = state();
    if (!s) throw Error("Open an original project first.");
    return operation(s,async () => {
      if (name === "refresh") {await refresh(s);s.loaded = true;return;}
      if (name === "open") {await showFile(s,s.selectedId);return;}
      if (name === "compare") {await comparePreview(s);return;}
      if (name === "restore") {await restore(s);return;}
      if (name === "close-preview") {
        s.preview = null;s.previewPayload = null;s.detached = false;s.comparison = null;s.generation++;return;
      }
      if (name === "download") {
        const payload = s.detached ? selectedPayload(s) : snapshot(s);
        const file = await makeFile({payload,name:s.detached ? s.preview.name : title(s,payload),
          existingFile:s.detached ? s.preview : s.file || undefined});
        const encoded = await encodeFile(file);
        download(encoded.bytes,encoded.filename || filename(file));
        notify(s,"Downloaded the complete current working edition and named history.");return;
      }
      if (name === "fork") {
        const payload = s.detached ? selectedPayload(s) : snapshot(s);
        const source = s.detached ? s.preview : s.file;
        const db = await database();
        const file = source ? await db.fork({projectId:s.projectId,fileId:source.id,existingFile:source,payload,name:title(s,payload) + " — independent copy"})
          : await db.create({payload,name:title(s,payload)});
        if (!visible(s)) return;
        if (s.detached) {s.preview = file;s.previewPayload = payload;s.comparison = null;}
        else {s.file = file;s.signature = JSON.stringify(payload);
          if (s.pending && JSON.stringify(s.pending) === s.signature) s.pending = null;
          s.conflict = false;s.localCandidate = null;}
        s.selectedId = file.id;s.name = file.name;await refresh(s);
        notify(s,"Saved an independent complete working file.");return;
      }
      if (name === "save-edition") {
        const payload = snapshot(s);s.pending = payload;await flush(s);
        if (s.conflict || !s.file) throw Error("Save or download your current work before naming an edition.");
        const db = await database();
        s.file = await db.saveEdition({projectId:s.projectId,fileId:s.file.id,expectedRevision:s.file.revision,
          label:s.editionLabel.trim() || "Saved edition",payload});
        s.editionLabel = "";await refresh(s);notify(s,"Saved the complete named edition.");return;
      }
      if (name === "edition") {
        await protect(s);
        const file = s.preview || s.file;
        if (!file) throw Error("Open a working file first.");
        const edition = s.editionId ? file.editions.find(row => row.id === s.editionId) : file.active;
        if (!edition) throw Error("Choose an original saved edition.");
        s.preview = file;s.previewPayload = copy(edition.payload);s.detached = true;s.comparison = null;s.generation++;return;
      }
      throw Error("Unknown working-file control.");
    });
  }
  function detach() {const s = state();if(s) {remember();void flush(s);}}
  return {render,field,dispatch,remember,detach,flush};
}
