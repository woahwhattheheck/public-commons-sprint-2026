// MIT. Carry accepted customer sections into the maintained SCF reviewer edition.
const WEBHOOK = '## Webhook customer adoption: complete event tasks and operator handover';
const OPENFN = '## OpenFn: paid workflow commissioning and complete receiving';
const REFERRAL = '## Referral implementation: source changes, returned outcomes and complete receiving';
const RISINGWAVE = '## Recurring subscription delivery and streaming-data commissioning';
const OPENFN_PARAGRAPHS = [
  '**Paid workflow commissioning and complete receiving — OpenFn.**',
  '**OpenFn implementation opportunity.**',
];
const clean = value => String(value).replaceAll('\r\n', '\n').trim() + '\n';
const quoted = value => value.replace(/[.*+?^$()|[\]{}\\]/g, '\\$&');
function need(value, message) { if (!value) throw new Error(message); }

/** Keep public source links and the substantive labels of private correspondence. */
export function projectGrantMarkdown(markdown, { application = false } = {}) {
  let value = clean(markdown)
    .replace(/\s*·?\s*\[(Original commercial delivery|Original offer and contact operation|Complete commercial and engineering brief|Completed operation)\]\(https:\/\/tokenjunkielabs\.slack\.com\/[^)\s]+\)\.?/g, '')
    .replace(/\[([^\]]+)\]\(https:\/\/(?:tokenjunkielabs\.slack\.com\/|mail\.google\.com\/mail\/)[^)\s]+\)/g, '$1')
    .replace(/ \. /g, '. ').replace(/\.\s*·\s*\[/g, '. [')
    .replaceAll('enterprise@openfn.org', 'OpenFn’s published enterprise mailbox');
  if (application) {
    value = value.replace(/\n\*\*(?:Application sources|Source basis):\*\*[\s\S]*$/, '\n\n**Sources and supporting detail:** The [product and finance companion](./product-and-finance.md) retains the complete installation workflows, customer implementation context, funded packages and resource study. The [source index](./source-index.json) identifies the selected product sources and application edition. Issuer references are the [SCF #46 round](https://communityfund.stellar.org/awards/recxrSMYwAl8vcglg), [Build submission criteria](https://stellar.gitbook.io/scf-handbook/scf-awards/build-award/submission-criteria), [budget and deliverable guidance](https://stellar.gitbook.io/scf-handbook/scf-awards/build-award/budget-and-deliverable-guidelines) and [Official Rules](https://stellar.gitbook.io/scf-handbook/scf-awards/official-rules-for-submissions).\n')
      .replace(/§9A connects this task to the existing six funded packages\./g,
        'The [complete customer workflow](./product-and-finance.md#environmental-provider-intake-complete-source-editions-commissioning-and-receiving) connects this task to the existing six funded packages.')
      .replace(/operating sequence and six-package linkage are included in §9A\./g,
        'operating sequence and six-package linkage are included in the [product and financing companion](./product-and-finance.md#federal-awards-complete-funding-research-workshares-and-receiving).');
  }
  return clean(value);
}

/** An H2 owns its H3+ content, ending before the next H1 or H2. */
function section(value, heading) {
  const source = clean(value), matches = [...source.matchAll(new RegExp('^' + quoted(heading) + '\\n', 'gm'))];
  need(matches.length <= 1, 'Keep one customer section: ' + heading);
  if (!matches.length) return null;
  const start = matches[0].index, body = start + heading.length + 1;
  const following = source.slice(body).search(/^#{1,2}\s/m);
  const end = following < 0 ? source.length : body + following;
  return { start, end, text: clean(source.slice(start, end)) };
}
function installSection(companion, heading, replacement) {
  const value = clean(companion), found = section(value, heading);
  if (found) return clean(value.slice(0, found.start) + clean(replacement) + '\n' + value.slice(found.end));
  const before = value.indexOf('## 10. Open the existing work\n');
  return before < 0 ? clean(value + '\n' + clean(replacement)) :
    clean(value.slice(0, before) + clean(replacement) + '\n' + value.slice(before));
}
function paragraph(manuscript, prefix) {
  const source = clean(manuscript), hits = [...source.matchAll(new RegExp('^' + quoted(prefix) + '[^\\n]*(?:\\n(?!\\n|#{1,6}\\s)[^\\n]+)*', 'gm'))];
  need(hits.length <= 1, 'Keep one accepted customer paragraph: ' + prefix);
  return hits.length ? hits[0][0] : null;
}

/** Update complete accepted customer text while retaining every other chapter and table. */
export function receiveGrantCustomerSections(productAndFinanceMarkdown, manuscript) {
  let companion = clean(productAndFinanceMarkdown);
  for (const heading of [WEBHOOK, REFERRAL, RISINGWAVE]) {
    const incoming = section(manuscript, heading);
    if (incoming) companion = installSection(companion, heading, projectGrantMarkdown(incoming.text));
  }
  const incoming = OPENFN_PARAGRAPHS.map(prefix => paragraph(manuscript, prefix));
  need(incoming.every(Boolean) || incoming.every(value => value === null), 'Select both accepted OpenFn paragraphs from the complete canonical manuscript.');
  if (incoming.every(Boolean)) {
    const current = section(companion, OPENFN);
    let updated = current ? current.text : OPENFN + '\n';
    for (let i = 0; i < OPENFN_PARAGRAPHS.length; i++) {
      const prior = paragraph(updated, OPENFN_PARAGRAPHS[i]), next = projectGrantMarkdown(incoming[i]).trim();
      updated = prior ? updated.replace(prior, next) : clean(updated) + '\n' + next + '\n';
    }
    companion = installSection(companion, OPENFN, updated);
  }
  return projectGrantMarkdown(companion);
}

/** Public index projection preserves source identities and measured file metadata. */
export function projectGrantSourceIndex(value) {
  if (Array.isArray(value)) return value.map(projectGrantSourceIndex).filter(item => item !== undefined);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).flatMap(([key, item]) => {
      if (key === 'canonical_manuscript') return [];
      const publicItem = projectGrantSourceIndex(item);
      return publicItem === undefined ? [] : [[key, publicItem]];
    }));
  }
  return typeof value === 'string' && /^https:\/\/(?:tokenjunkielabs\.slack\.com\/|mail\.google\.com\/mail\/)/.test(value) ? undefined : value;
}

/** Follow each retained customer source URL when rebuilding the public source register. */
export function receiveGrantCustomerSources(index, companion) {
  const receive = (id, title, pattern, sectionText) => {
    const found = sectionText.match(pattern);
    if (!found) return;
    const [url, commit, path] = found, at = index.sources.findIndex(item => item.id === id);
    const previous = at < 0 ? {} : index.sources[at];
    const source = { ...previous, id, kind: 'published-source', label: previous.label || title,
      repository: url.split('/').slice(3, 5).join('/'), commit, path, url };
    if (previous.url && previous.url !== url) delete source.git_blob;
    if (at < 0) index.sources.push(source); else index.sources[at] = source;
  };
  const webhook = section(companion, WEBHOOK)?.text || '';
  const openfn = section(companion, OPENFN)?.text || '';
  receive('webhook-customer-commissioning', 'Complete webhook customer commissioning',
    /https:\/\/github\.com\/woahwhattheheck\/tjlabs-stellar-merchant-workspace\/blob\/([a-f0-9]{40})\/(products\/webhook-feed\/COMMISSIONING\.md)/, webhook);
  receive('openfn-commissioning-service', 'OpenFn source-to-PostgreSQL commissioning and receiving',
    /https:\/\/github\.com\/woahwhattheheck\/commons\/tree\/([a-f0-9]{40})\/(opportunities\/openfn-commissioning-\d{8})/, openfn);
  receive('openfn-grant-inclusion', 'OpenFn customer workflow and existing funded packages',
    /https:\/\/github\.com\/woahwhattheheck\/commons\/blob\/([a-f0-9]{40})\/(opportunities\/openfn-commissioning-\d{8}\/SCF_INCLUSION\.md)/, openfn);
  const referral = section(companion, REFERRAL)?.text || '';
  receive('gravity-referral-source', 'Referral source, operating contract and responsibilities',
    /https:\/\/github\.com\/woahwhattheheck\/commons\/blob\/([a-f0-9]{40})\/(tools\/revenue_owner_console_\d{8}\/case_assets\/elimu-gravity-referral-implementation-\d{8}-450e\/SOURCE_DOMAIN\.md)/, referral);
  receive('gravity-referral-receiving', 'Complete referral operating result and receiving',
    /https:\/\/github\.com\/woahwhattheheck\/commons\/blob\/([a-f0-9]{40})\/(tools\/revenue_owner_console_\d{8}\/case_assets\/elimu-gravity-referral-implementation-\d{8}-450e\/OPERATED_GRAVITY_RECEIVING\.md)/, referral);
  receive('gravity-referral-commissioning', 'Complete referral commissioning and staff handover scope',
    /https:\/\/github\.com\/woahwhattheheck\/commons\/blob\/([a-f0-9]{40})\/(tools\/revenue_owner_console_\d{8}\/case_assets\/elimu-gravity-referral-implementation-\d{8}-450e\/Elimu_Referral_Implementation_Workshare_Offer_\d{8}\.md)/, referral);
  const subscriptions = section(companion, RISINGWAVE)?.text || '';
  receive('risingwave-subscription-operation', 'Source subscription delivery and complete customer receiving',
    /https:\/\/github\.com\/woahwhattheheck\/public-commons-sprint-2026\/blob\/([a-f0-9]{40})\/(stellar\/scf-starforge-\d{8}\/sf30-seller-sdk\/risingwave\/README\.md)/, subscriptions);
  receive('risingwave-subscription-commissioning', 'Complete subscription delivery commercial and receiving package',
    /https:\/\/github\.com\/woahwhattheheck\/commons\/tree\/([a-f0-9]{40})\/(tools\/revenue_owner_console_\d{8}\/case_assets\/risingwave-subscription-delivery-pilot-\d{8})/, subscriptions);
  return index;
}
