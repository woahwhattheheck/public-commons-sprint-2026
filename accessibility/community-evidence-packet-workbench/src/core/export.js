/**
 * Snapshot exporters. Empty and incomplete packets still export.
 */

import { escapeHtml, escapeMarkdown, escapeMarkdownFence, csvRow } from "./escape.js";
import { sha256Hex, utf8Bytes, BYTE_IDENTITY_NOTICE } from "./hash.js";
import { collisionKey, uniqueArchivePath } from "./paths.js";
import { buildStoreZip } from "./zip.js";
import {
  packetToJson,
  packetToJsonObject,
  isEmptyPacket,
  missingFields,
  advisoryNotices,
  archivePathForItem,
  WACZ_POLICY,
} from "./packet.js";

export const RO_CRATE_CONTEXT = "https://w3id.org/ro/crate/1.2/context";

function itemBytes(item) {
  if (item._bytes instanceof Uint8Array) return item._bytes;
  if (item.textContent) return utf8Bytes(item.textContent);
  return utf8Bytes("");
}

function payloadEntries(packet) {
  const used = new Set();
  const entries = [];
  for (const item of packet.items) {
    const path = archivePathForItem(item, used);
    entries.push({
      path,
      bytes: itemBytes(item),
      item,
    });
  }
  return entries;
}

export function exportJson(packet) {
  return packetToJson(packet);
}

export function exportMarkdown(packet) {
  const missing = missingFields(packet);
  const empty = isEmptyPacket(packet);
  const notices = advisoryNotices(packet);
  const lines = [];
  lines.push("# " + (packet.title || "(untitled packet)"));
  lines.push("");
  lines.push("Community evidence packet snapshot. This file is a local export, not a certificate.");
  lines.push("");
  if (empty) lines.push("**State:** empty. Fields below are labeled as missing on purpose.");
  else if (missing.length) lines.push("**State:** incomplete. Missing: " + missing.join(", ") + ".");
  else lines.push("**State:** fields present in this session. Completeness is not verification.");
  lines.push("");
  lines.push("- Packet id: " + (packet.id || "(missing)"));
  lines.push("- Community: " + (packet.community || "(missing)"));
  lines.push("- Collector: " + (packet.collector || "(missing)"));
  lines.push("- Location: " + (packet.location || "(missing)"));
  lines.push("- Period: " + (packet.period?.start || "(missing)") + " → " + (packet.period?.end || "(missing)"));
  lines.push("- Created: " + (packet.created || "(missing)"));
  lines.push("");
  lines.push("## Statement");
  lines.push("");
  lines.push(packet.statement ? escapeMarkdownFence(packet.statement) : "(missing)");
  lines.push("");
  lines.push("## Byte identity");
  lines.push("");
  lines.push(BYTE_IDENTITY_NOTICE);
  lines.push("");
  lines.push(WACZ_POLICY);
  lines.push("");
  lines.push("## Items");
  lines.push("");
  if (!packet.items.length) {
    lines.push("No items. Empty export is intentional.");
  } else {
    for (const item of packet.items) {
      lines.push("### " + escapeMarkdown(item.name || item.id));
      lines.push("");
      lines.push("- Role: " + item.role);
      lines.push("- Path: `" + (item.path || item.name || "") + "`");
      lines.push("- Bytes: " + item.bytes);
      lines.push("- SHA-256: `" + (item.sha256 || "(missing)") + "`");
      lines.push("- Recognized as: " + item.recognizedAs);
      if (item.waczOpaque) lines.push("- WACZ: opaque attachment (not opened)");
      if (item.caption) lines.push("- Caption: " + escapeMarkdownFence(item.caption));
      if (item.provenance) lines.push("- Provenance: " + escapeMarkdownFence(item.provenance));
      lines.push("");
    }
  }
  if (notices.length) {
    lines.push("## Notices");
    lines.push("");
    for (const n of notices) lines.push("- `" + n.code + "` " + n.text);
    lines.push("");
  }
  return lines.join("\n");
}

export function exportHtml(packet) {
  const missing = missingFields(packet);
  const empty = isEmptyPacket(packet);
  const notices = advisoryNotices(packet);
  const state = empty ? "empty" : missing.length ? "incomplete" : "present";
  const rows = packet.items
    .map((item) => {
      return `<tr>
        <td>${escapeHtml(item.name || item.id)}</td>
        <td>${escapeHtml(item.role)}</td>
        <td>${escapeHtml(String(item.bytes))}</td>
        <td><code>${escapeHtml(item.sha256 || "(missing)")}</code></td>
        <td>${escapeHtml(item.recognizedAs)}${item.waczOpaque ? " (opaque WACZ)" : ""}</td>
        <td>${escapeHtml(item.caption)}</td>
      </tr>`;
    })
    .join("\n");
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(packet.title || "Community evidence packet")}</title>
  <style>
    body { font-family: ui-sans-serif, system-ui, sans-serif; color: #141414; background: #f7f4ee; margin: 0; }
    main { max-width: 52rem; margin: 0 auto; padding: 1.25rem; }
    h1 { font-size: 1.5rem; }
    table { width: 100%; border-collapse: collapse; }
    th, td { border: 2px solid #141414; padding: 0.4rem; text-align: left; vertical-align: top; }
    code { word-break: break-all; }
    .notice { border: 2px solid #141414; padding: 0.75rem; margin: 0.75rem 0; }
  </style>
</head>
<body>
<main>
  <h1>${escapeHtml(packet.title || "(untitled packet)")}</h1>
  <p>Local HTML snapshot. Not a certificate. State: <strong>${escapeHtml(state)}</strong>.</p>
  <ul>
    <li>Community: ${escapeHtml(packet.community || "(missing)")}</li>
    <li>Collector: ${escapeHtml(packet.collector || "(missing)")}</li>
    <li>Location: ${escapeHtml(packet.location || "(missing)")}</li>
    <li>Packet id: ${escapeHtml(packet.id)}</li>
  </ul>
  <h2>Statement</h2>
  <p>${escapeHtml(packet.statement || "(missing)")}</p>
  <h2>Byte identity</h2>
  <p>${escapeHtml(BYTE_IDENTITY_NOTICE)}</p>
  <p>${escapeHtml(WACZ_POLICY)}</p>
  <h2>Items</h2>
  ${
    packet.items.length
      ? `<table><thead><tr><th>Name</th><th>Role</th><th>Bytes</th><th>SHA-256</th><th>Recognition</th><th>Caption</th></tr></thead><tbody>${rows}</tbody></table>`
      : "<p>No items. Empty export is intentional.</p>"
  }
  ${
    notices.length
      ? `<div class="notice"><h2>Notices</h2><ul>${notices
          .map((n) => `<li><code>${escapeHtml(n.code)}</code> ${escapeHtml(n.text)}</li>`)
          .join("")}</ul></div>`
      : ""
  }
</main>
</body>
</html>
`;
}

export function exportCsv(packet) {
  const header = csvRow(["name", "role", "path", "bytes", "sha256", "recognizedAs", "waczOpaque", "caption"]);
  const rows = packet.items.map((item) =>
    csvRow([
      item.name,
      item.role,
      item.path,
      item.bytes,
      item.sha256,
      item.recognizedAs,
      item.waczOpaque ? "yes" : "no",
      item.caption,
    ]),
  );
  if (!rows.length) {
    return header + "\n" + csvRow(["(no items)", "", "", "0", "", "", "", "empty export"]);
  }
  return [header, ...rows].join("\n") + "\n";
}

export function roCrateMetadata(packet, entries) {
  const graph = [
    {
      "@id": "ro-crate-metadata.json",
      "@type": "CreativeWork",
      conformsTo: { "@id": "https://w3id.org/ro/crate/1.2" },
      about: { "@id": "./" },
    },
    {
      "@id": "./",
      "@type": ["Dataset"],
      name: packet.title || "(untitled packet)",
      description: packet.statement || "Community evidence packet (fields may be missing).",
      identifier: packet.id,
      hasPart: entries.map((e) => ({ "@id": e.path })),
    },
  ];
  for (const e of entries) {
    graph.push({
      "@id": e.path,
      "@type": e.item.waczOpaque ? "File" : "File",
      name: e.item.name,
      encodingFormat: e.item.mediaType,
      contentSize: String(e.item.bytes),
      sha256: e.item.sha256,
      note: e.item.waczOpaque
        ? "Opaque WACZ attachment. Not unpacked by this workbench."
        : e.item.note || undefined,
    });
  }
  return {
    "@context": RO_CRATE_CONTEXT,
    "@graph": graph,
  };
}

export function bagitText() {
  return "BagIt-Version: 1.0\nTag-File-Character-Encoding: UTF-8\n";
}

export function bagInfo(packet) {
  return [
    "Source-Organization: local-workbench",
    "Bagging-Date: " + (packet.updated || packet.created || "").slice(0, 10),
    "External-Identifier: " + packet.id,
    "Bag-Software-Agent: community-evidence-packet-workbench",
    "Internal-Sender-Description: Local byte-identity bag. Not a certificate.",
    "",
  ].join("\n");
}

export async function bagManifest(entries) {
  const lines = [];
  for (const e of entries) {
    const hex = e.item.sha256 || (await sha256Hex(e.bytes));
    const payload = e.path.replace(/^data\//, "");
    lines.push(`${hex}  ${payload}`);
  }
  if (!lines.length) {
    const empty = utf8Bytes("");
    const hex = await sha256Hex(empty);
    lines.push(`${hex}  EMPTY.txt`);
  }
  return lines.join("\n") + "\n";
}

export async function exportRoCrateZip(packet) {
  let entries = payloadEntries(packet);
  const used = new Set(entries.map((e) => collisionKey(e.path)));
  const crate = utf8Bytes(JSON.stringify(roCrateMetadata(packet, entries), null, 2));
  const cratePath = uniqueArchivePath("ro-crate-metadata.json", used);
  used.add(collisionKey(cratePath));
  const files = [
    { path: cratePath, bytes: crate },
    ...entries.map((e) => ({ path: e.path, bytes: e.bytes })),
  ];
  if (!entries.length) {
    files.push({
      path: uniqueArchivePath("EMPTY.txt", used),
      bytes: utf8Bytes("Empty packet. Placeholder payload so the crate still has a file.\n"),
    });
  }
  return buildStoreZip(files);
}

export async function exportBagItZip(packet) {
  let entries = payloadEntries(packet);
  if (!entries.length) {
    entries = [
      {
        path: "data/EMPTY.txt",
        bytes: utf8Bytes("Empty packet. Placeholder payload so the bag still has a data file.\n"),
        item: { sha256: "", name: "EMPTY.txt", waczOpaque: false, mediaType: "text/plain", bytes: 0 },
      },
    ];
    entries[0].item.sha256 = await sha256Hex(entries[0].bytes);
    entries[0].item.bytes = entries[0].bytes.length;
  }
  const dataEntries = entries.map((e) => {
    const payload = e.path.replace(/^data\//, "");
    return { path: "data/" + payload, bytes: e.bytes, item: e.item };
  });
  const manifest = utf8Bytes(await bagManifest(dataEntries));
  const files = [
    { path: "bagit.txt", bytes: utf8Bytes(bagitText()) },
    { path: "bag-info.txt", bytes: utf8Bytes(bagInfo(packet)) },
    { path: "manifest-sha256.txt", bytes: manifest },
    ...dataEntries.map((e) => ({ path: e.path, bytes: e.bytes })),
  ];
  return buildStoreZip(files);
}

export async function exportFilesZip(packet) {
  const entries = payloadEntries(packet);
  const json = utf8Bytes(exportJson(packet));
  const md = utf8Bytes(exportMarkdown(packet));
  const html = utf8Bytes(exportHtml(packet));
  const used = new Set(["packet.json", "packet.md", "packet.html"].map(collisionKey));
  const files = [
    { path: "packet.json", bytes: json },
    { path: "packet.md", bytes: md },
    { path: "packet.html", bytes: html },
    ...entries.map((e) => ({ path: e.path, bytes: e.bytes })),
  ];
  for (const f of files.slice(3)) used.add(collisionKey(f.path));
  if (!entries.length) {
    files.push({
      path: uniqueArchivePath("EMPTY.txt", used),
      bytes: utf8Bytes("Empty packet. Placeholder so the zip still contains a payload file.\n"),
    });
  }
  return buildStoreZip(files);
}

export { packetToJsonObject };
