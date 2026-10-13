// MIT. Public reader projection shared by the maintained grant publishers.
// Authoring documents remain complete in their original source workspace.
const INTERNAL_URL = /^https?:\/\/(?:[^/]+\.)?(?:slack\.com|notion\.so|notion\.site|notion\.com)\/|^https?:\/\/chatgpt\.com\/(?:space|canvas|api\/library)\//i;
const MAIL_URL = /^https?:\/\/mail\.google\.com\/mail\//i;
const restricted = value => typeof value === 'string' && (INTERNAL_URL.test(value) || MAIL_URL.test(value));

/** Keep substantive labels while removing private workspace navigation. */
export function projectPublicGrantMarkdown(markdown) {
  if (typeof markdown !== 'string') throw new TypeError('Use the complete original grant Markdown.');
  return markdown
    .replace(/\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)/gi,
      (original, label, url) => restricted(url) ? label : original)
    .replace(/\bmessage(?:\s+(?:id|identifier))?\s+`[a-f0-9]{16}`/gi, 'the original sent message')
    .replace(/\bthread(?:\s+(?:id|identifier))?\s+`[a-f0-9]{16}`/gi, 'the original conversation');
}

/** HTML and Markdown preserve the same public navigation boundary. */
export function projectPublicGrantHtml(html) {
  if (typeof html !== 'string') throw new TypeError('Use the complete original grant HTML.');
  return html
    .replace(/<a\b([^>]*?)\bhref=(["'])(.*?)\2([^>]*)>([\s\S]*?)<\/a>/gi,
      (original, before, quote, url, after, label) => restricted(url) ? label : original)
    .replace(/\bmessage(?:\s+(?:id|identifier))?\s+<code>[a-f0-9]{16}<\/code>/gi, 'the original sent message')
    .replace(/\bthread(?:\s+(?:id|identifier))?\s+<code>[a-f0-9]{16}<\/code>/gi, 'the original conversation');
}

/** Retain public source identities and authenticated-source catalogue metadata. */
export function projectPublicGrantSourceIndex(value) {
  if (Array.isArray(value)) return value.map(projectPublicGrantSourceIndex).filter(item => item !== undefined);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).flatMap(([key, item]) => {
    const projected = projectPublicGrantSourceIndex(item);
    return projected === undefined ? [] : [[key, projected]];
  }));
  return restricted(value) ? undefined : value;
}
