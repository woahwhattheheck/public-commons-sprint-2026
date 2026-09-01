/**
 * Escaping for generated snapshots. Not a general-purpose sanitizer.
 */

const AMP = "\u0026";
const HTML_MAP = {
  "&": AMP + "amp;",
  "<": AMP + "lt;",
  ">": AMP + "gt;",
  '"': AMP + "quot;",
  "'": AMP + "#39;",
};

export function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => HTML_MAP[ch]);
}

export function escapeAttr(value) {
  return escapeHtml(value);
}

export function escapeMarkdown(value) {
  return String(value ?? "").replace(/[\\`*_{}\[\]()#+\-.!|]/g, "\\$&");
}

export function escapeMarkdownFence(value) {
  return String(value ?? "").replace(/```/g, "`\u200b``");
}

/**
 * Neutralize CSV formula injection. Prefix risky leading characters.
 */
export function csvCell(value) {
  let s = String(value ?? "");
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  if (/[",\n\r]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
  return s;
}

export function csvRow(cells) {
  return cells.map(csvCell).join(",");
}
