// MIT. Text-only review content supplied by an original Applications provider.
const element = (tag, text) => {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  return node;
};
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const scalar = value => typeof value === 'string' || typeof value === 'boolean' ||
  typeof value === 'number' && Number.isFinite(value);

/**
 * A provider may return applicationReview with schema
 * stellar-forge.application-review-content.v1, title, summary and sections.
 * Each section has title, optional collapsed and rows of {label,value}.
 * Values are plain scalars or arrays of scalars. Providers supply selected
 * nonsecret configuration only; the renderer never interprets HTML or URLs.
 */
export function renderApplicationReview(command) {
  const fragment = document.createDocumentFragment(), review = command?.applicationReview;
  if (!plain(review) || review.schema !== 'stellar-forge.application-review-content.v1' ||
      !Array.isArray(review.sections)) return fragment;
  const root = element('section'); root.className = 'application-provider-review';
  if (typeof review.title === 'string' && review.title) root.append(element('h4', review.title));
  if (typeof review.summary === 'string' && review.summary) {
    const summary = element('p', review.summary); summary.className = 'note'; root.append(summary);
  }
  for (const section of review.sections) {
    if (!plain(section) || !Array.isArray(section.rows)) continue;
    const facts = element('dl'); facts.className = 'paths';
    for (const item of section.rows) {
      if (!plain(item) || typeof item.label !== 'string') continue;
      const values = Array.isArray(item.value) ? item.value : [item.value];
      if (!values.every(scalar)) continue;
      const row = element('div'), value = element('dd');
      for (const line of values) value.append(element('div', String(line)));
      row.append(element('dt', item.label), value); facts.append(row);
    }
    if (!facts.childElementCount) continue;
    const group = element(section.collapsed === true ? 'details' : 'section');
    if (typeof section.title === 'string' && section.title)
      group.append(element(section.collapsed === true ? 'summary' : 'h4', section.title));
    group.append(facts); root.append(group);
  }
  if (root.childElementCount) fragment.append(root);
  return fragment;
}
