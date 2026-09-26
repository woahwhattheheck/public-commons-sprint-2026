import { BYTE_IDENTITY_NOTICE } from "../core/hash.js";
import { escapeHtml } from "../core/escape.js";
import {
  emptyPacket,
  packetToJson,
  advisoryNotices,
  makeTextItem,
  makeFileItem,
  matchingFileBytes,
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
import { importPacketFile } from "./import-file.js";

let packet = emptyPacket();
let generation = 0;

const $ = (id) => document.getElementById(id);

function stillCurrent(gen, target) {
  return generation === gen && packet === target;
}

function editStamp() {
  return JSON.stringify({
    title: $("title").value,
    community: $("community").value,
    collector: $("collector").value,
    location: $("location").value,
    start: $("start").value,
    end: $("end").value,
    tags: $("tags").value,
    statement: $("statement").value,
    items: packet.items.map((item) => [item.id, item.role, item.caption, item.sha256]),
  });
}

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

function byteIdentityNotice(item) {
  if (item._bytes instanceof Uint8Array) return BYTE_IDENTITY_NOTICE;
  if (Object.prototype.hasOwnProperty.call(item, "textContent")) {
    return "Imported text payload is available locally, but the displayed SHA-256 came from imported metadata and has not been verified in this session. Package export re-hashes the local text bytes.";
  }
  if (Number(item.bytes) === 0) {
    return "Imported metadata describes a zero-byte payload. Package export reconstructs and re-hashes the empty payload; the displayed imported SHA-256 is not treated as verified.";
  }
  return "Imported metadata only: payload bytes are not loaded in this session. Attach the original file below to restore package export while keeping this item's details; the displayed SHA-256 is not session-verified yet.";
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
        <p class="hash">${escapeHtml(byteIdentityNotice(item))}<br><code>${escapeHtml(item.sha256 || "(hash missing)")}</code> · ${escapeHtml(String(item.bytes))} bytes</p>
        <label>Role
          <select data-role="${i}">
            ${["photo","testimony","minutes","map","recording","wacz","document","other"].map((r) =>
              `<option value="${r}"${item.role===r?" selected":""}>${r}</option>`).join("")}
          </select>
        </label>
        <label>Caption
          <input type="text" data-caption="${i}" value="${escapeHtml(item.caption)}">
        </label>
        ${!(item._bytes instanceof Uint8Array) && !Object.prototype.hasOwnProperty.call(item, "textContent") && Number(item.bytes) > 0
          ? `<label class="file-btn">Attach original file<input type="file" data-reattach="${i}"></label>`
          : ""}
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
  try {
    readPacketFields();
    renderNotices();
    const base = (packet.title || "packet").replace(/[^\w.-]+/g, "-").slice(0, 40);
    if (kind === "html") download(base + ".html", textBytes(exportHtml(packet)), "text/html");
    else if (kind === "md") download(base + ".md", textBytes(exportMarkdown(packet)), "text/markdown");
    else if (kind === "json") download(base + ".json", textBytes(exportJson(packet)), "application/json");
    else if (kind === "zip") download(base + ".zip", await exportFilesZip(packet), "application/zip");
    else if (kind === "crate") download(base + "-rocrate.zip", await exportRoCrateZip(packet), "application/zip");
    else if (kind === "bag") download(base + "-bagit.zip", await exportBagItZip(packet), "application/zip");
  } catch (error) {
    if (error?.code === "PAYLOAD_BYTES_UNAVAILABLE") {
      $("export-status").textContent =
        "Package export stopped: an imported item has metadata but no local payload bytes. Use Attach original file on that item before ZIP, RO-Crate, or BagIt export.";
      return;
    }
    $("export-status").textContent =
      "Export failed locally: " + String(error?.code || "EXPORT_FAILED") + ".";
  }
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
    ev.target.value = "";
    if (!files.length) return;
    generation += 1;
    const gen = generation;
    const target = packet;
    const staged = [];
    try {
      for (const file of files) {
        const buf = await file.arrayBuffer();
        if (!stillCurrent(gen, target)) {
          $("export-status").textContent = "File import cancelled because the packet changed.";
          return;
        }
        staged.push(await makeFileItem(file, buf));
        if (!stillCurrent(gen, target)) {
          $("export-status").textContent = "File import cancelled because the packet changed.";
          return;
        }
      }
    } catch (error) {
      if (stillCurrent(gen, target)) {
        $("export-status").textContent =
          "File import stopped before any item was added: " +
          String(error?.code || "READ_FAILED") +
          ".";
      }
      return;
    }
    if (!stillCurrent(gen, target)) {
      $("export-status").textContent = "File import cancelled because the packet changed.";
      return;
    }
    target.items.push(...staged);
    render();
    $("export-status").textContent =
      staged.length === 1 ? "Added 1 file to this packet." : "Added " + staged.length + " files to this packet.";
  });
  $("add-text").addEventListener("click", () => {
    $("text-box").hidden = !$("text-box").hidden;
  });
  $("save-text").addEventListener("click", async () => {
    const name = $("paste-name").value || "testimony.txt";
    const text = $("paste-text").value;
    generation += 1;
    const gen = generation;
    const target = packet;
    let item;
    try {
      item = await makeTextItem(name, text, "testimony");
    } catch (error) {
      if (stillCurrent(gen, target)) {
        $("export-status").textContent =
          "Text import stopped before the item was added: " +
          String(error?.code || "READ_FAILED") +
          ".";
      }
      return;
    }
    if (!stillCurrent(gen, target)) {
      $("export-status").textContent = "Text import cancelled because the packet changed.";
      return;
    }
    target.items.push(item);
    $("paste-text").value = "";
    $("text-box").hidden = true;
    render();
  });
  $("import-json").addEventListener("change", async (ev) => {
    const file = ev.target.files[0];
    ev.target.value = "";
    if (!file) return;
    generation += 1;
    const gen = generation;
    const target = packet;
    const stamp = editStamp();
    let result;
    try {
      result = await importPacketFile(file, target);
    } catch (error) {
      if (stillCurrent(gen, target)) {
        $("export-status").textContent =
          "JSON import failed locally: " + String(error?.code || "IMPORT_FAILED") + ".";
      }
      return;
    }
    if (!stillCurrent(gen, target)) {
      $("export-status").textContent =
        "JSON import cancelled because a newer packet change superseded it.";
      return;
    }
    if (editStamp() !== stamp) {
      $("export-status").textContent =
        "JSON import cancelled so edits made while it was reading stay in this packet.";
      return;
    }
    $("export-status").textContent = result.message;
    if (!result.ok) return;
    packet = result.packet;
    bindPacketFields();
    render();
  });
  $("clear").addEventListener("click", () => {
    generation += 1;
    packet = emptyPacket();
    bindPacketFields();
    render();
    $("export-status").textContent =
      "Packet cleared. Pending file, text, and JSON imports were cancelled.";
  });
  $("items").addEventListener("change", (ev) => {
    const role = ev.target.getAttribute("data-role");
    if (role != null) packet.items[Number(role)].role = ev.target.value;
  });
  $("items").addEventListener("input", (ev) => {
    const cap = ev.target.getAttribute("data-caption");
    if (cap != null) packet.items[Number(cap)].caption = ev.target.value;
  });
  $("items").addEventListener("change", async (ev) => {
    const index = ev.target.getAttribute("data-reattach");
    if (index == null) return;
    const file = ev.target.files[0];
    ev.target.value = "";
    if (!file) return;
    const target = packet;
    const item = target.items[Number(index)];
    if (!item) return;
    generation += 1;
    const gen = generation;
    const expectedSize = item.bytes;
    const expectedHash = item.sha256;
    try {
      const buffer = await file.arrayBuffer();
      if (!stillCurrent(gen, target) || !target.items.includes(item)) return;
      const bytes = await matchingFileBytes(item, buffer);
      if (!stillCurrent(gen, target) || !target.items.includes(item)) return;
      if (item.bytes !== expectedSize || item.sha256 !== expectedHash) return;
      item._bytes = bytes;
      render();
      $("export-status").textContent =
        "Original bytes attached. Recorded size and SHA-256 match; item details were kept. This is byte identity, not authenticity.";
    } catch (error) {
      if (!stillCurrent(gen, target) || !target.items.includes(item)) return;
      $("export-status").textContent = error?.code === "FILE_BYTES_MISMATCH"
        ? "Selected file does not match the recorded size and SHA-256. The item is unchanged; choose its original file."
        : "Original file could not be read locally. The item is unchanged.";
    }
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
