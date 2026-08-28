import { BYTE_IDENTITY_NOTICE } from "../core/hash.js";
import { escapeHtml } from "../core/escape.js";
import {
  emptyPacket,
  importPacket,
  packetToJson,
  advisoryNotices,
  makeTextItem,
  makeFileItem,
  WACZ_POLICY,
} from "../core/packet.js";
import {
  exportHtml,
  exportMarkdown,
  exportJson,
  exportFilesZip,
  exportRoCrateZip,
  exportBagItZip,
} from "../core/export.js";

let packet = emptyPacket();

const $ = (id) => document.getElementById(id);

function bindPacketFields() {
  $("title").value = packet.title;
  $("community").value = packet.community;
  $("collector").value = packet.collector;
  $("location").value = packet.location;
  $("start").value = packet.period.start;
  $("end").value = packet.period.end;
  $("tags").value = packet.tags.join(", ");
  $("statement").value = packet.statement;
}

function readPacketFields() {
  packet.title = $("title").value;
  packet.community = $("community").value;
  packet.collector = $("collector").value;
  packet.location = $("location").value;
  packet.period.start = $("start").value;
  packet.period.end = $("end").value;
  packet.tags = $("tags").value.split(",").map((s) => s.trim()).filter(Boolean);
  packet.statement = $("statement").value;
  packet.updated = new Date().toISOString();
}

function renderNotices() {
  const box = $("notices");
  const notices = advisoryNotices(packet);
  box.innerHTML = notices
    .map(
      (n) =>
        `<div class="notice"><strong>${escapeHtml(n.code)}</strong> ${escapeHtml(n.text)}</div>`,
    )
    .join("");
}

function renderItems() {
  const root = $("items");
  if (!packet.items.length) {
    root.innerHTML =
      '<div class="empty-hint">No items yet. Add files or paste testimony. Empty packets still export.</div>';
    return;
  }
  root.innerHTML = packet.items
    .map((item, i) => {
      return `<article class="item" data-index="${i}">
        <h3>${escapeHtml(item.name || item.id)}</h3>
        <p class="fine">${escapeHtml(item.note || item.recognizedAs)}${item.waczOpaque ? " — opaque WACZ, not opened." : ""}</p>
        <p class="hash">${escapeHtml(BYTE_IDENTITY_NOTICE)}<br><code>${escapeHtml(item.sha256 || "(hash missing)")}</code> · ${escapeHtml(String(item.bytes))} bytes</p>
        <label>Role
          <select data-role="${i}">
            ${["photo","testimony","minutes","map","recording","wacz","document","other"].map((r) =>
              `<option value="${r}"${item.role===r?" selected":""}>${r}</option>`).join("")}
          </select>
        </label>
        <label>Caption
          <input type="text" data-caption="${i}" value="${escapeHtml(item.caption)}">
        </label>
        <button type="button" class="secondary" data-remove="${i}">Remove item</button>
      </article>`;
    })
    .join("");
}

function render() {
  readPacketFields();
  renderNotices();
  renderItems();
}

function download(name, bytes, type) {
  const blob = new Blob([bytes], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
  $("export-status").textContent = "Saved locally as " + name + ". Object URL revoked. No remote send.";
}

function textBytes(s) {
  return new TextEncoder().encode(s);
}

async function doExport(kind) {
  readPacketFields();
  renderNotices();
  const base = (packet.title || "packet").replace(/[^\w.-]+/g, "-").slice(0, 40);
  if (kind === "html") download(base + ".html", textBytes(exportHtml(packet)), "text/html");
  else if (kind === "md") download(base + ".md", textBytes(exportMarkdown(packet)), "text/markdown");
  else if (kind === "json") download(base + ".json", textBytes(exportJson(packet)), "application/json");
  else if (kind === "zip") download(base + ".zip", await exportFilesZip(packet), "application/zip");
  else if (kind === "crate") download(base + "-rocrate.zip", await exportRoCrateZip(packet), "application/zip");
  else if (kind === "bag") download(base + "-bagit.zip", await exportBagItZip(packet), "application/zip");
}

function wire() {
  ["title","community","collector","location","start","end","tags","statement"].forEach((id) => {
    $(id).addEventListener("input", () => {
      readPacketFields();
      renderNotices();
    });
  });
  $("files").addEventListener("change", async (ev) => {
    const files = [...ev.target.files];
    for (const file of files) {
      const buf = await file.arrayBuffer();
      packet.items.push(await makeFileItem(file, buf));
    }
    ev.target.value = "";
    render();
  });
  $("add-text").addEventListener("click", () => {
    $("text-box").hidden = !$("text-box").hidden;
  });
  $("save-text").addEventListener("click", async () => {
    const name = $("paste-name").value || "testimony.txt";
    const text = $("paste-text").value;
    packet.items.push(await makeTextItem(name, text, "testimony"));
    $("paste-text").value = "";
    $("text-box").hidden = true;
    render();
  });
  $("import-json").addEventListener("change", async (ev) => {
    const file = ev.target.files[0];
    if (!file) return;
    const text = await file.text();
    packet = importPacket(text);
    bindPacketFields();
    render();
    ev.target.value = "";
  });
  $("clear").addEventListener("click", () => {
    packet = emptyPacket();
    bindPacketFields();
    render();
  });
  $("items").addEventListener("change", (ev) => {
    const role = ev.target.getAttribute("data-role");
    const cap = ev.target.getAttribute("data-caption");
    if (role != null) packet.items[Number(role)].role = ev.target.value;
    if (cap != null) packet.items[Number(cap)].caption = ev.target.value;
  });
  $("items").addEventListener("click", (ev) => {
    const rm = ev.target.getAttribute("data-remove");
    if (rm != null) {
      packet.items.splice(Number(rm), 1);
      render();
    }
  });
  $("ex-html").addEventListener("click", () => doExport("html"));
  $("ex-md").addEventListener("click", () => doExport("md"));
  $("ex-json").addEventListener("click", () => doExport("json"));
  $("ex-zip").addEventListener("click", () => doExport("zip"));
  $("ex-crate").addEventListener("click", () => doExport("crate"));
  $("ex-bag").addEventListener("click", () => doExport("bag"));
  $("ex-copy").addEventListener("click", async () => {
    readPacketFields();
    const text = packetToJson(packet);
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      $("export-status").textContent = "JSON copied with the clipboard API. Local only.";
    } else {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
      $("export-status").textContent = "JSON copied via a local textarea.";
    }
  });
  $("ex-print").addEventListener("click", () => window.print());
  bindPacketFields();
  render();
}

wire();
void WACZ_POLICY;
