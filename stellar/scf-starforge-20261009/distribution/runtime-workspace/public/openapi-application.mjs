// MIT. Readable registration review inside the original Applications form.
const element = (tag, text, className) => {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
};
function row(label, value) {
  const fragment = document.createDocumentFragment();
  fragment.append(element('dt', label), element('dd', String(value ?? 'Not selected')));
  return fragment;
}
export function renderOpenApiApplicationReview(command) {
  const review = command?.openapi;
  if (!review || review.schema !== 'stellar-forge.openapi-managed-binding.v1') return document.createDocumentFragment();
  const section = element('section', undefined, 'panel');
  section.append(element('h4', 'Registered provider connections'));
  if (!review.profiles.length) {
    section.append(element('p', 'No OAuth registry is selected. Original API-key, bearer and client-credentials configuration remains available in API merchant authoring.', 'note'));
    return section;
  }
  section.append(element('p', 'These are the host’s registered sources and callback locations. Approve a returned grant in the original API workspace before binding it to a paid route. Opening this application does not authorize a provider.', 'note'));
  const summary = element('dl', undefined, 'facts');
  summary.append(row('Host configuration', review.connectionsFile), row('Configuration SHA-256', review.connectionsSha256),
    row('Reviewed launch SHA-256', review.bindingSha256),
    row('Local listener', '127.0.0.1:' + review.port),
    row('Provider transport', review.allowLoopbackOAuth ? 'Explicit local development is enabled' : 'Original public HTTPS profiles'));
  section.append(summary);
  for (const profile of review.profiles) {
    const detail = element('details');
    detail.append(element('summary', profile.label + ' · ' + profile.alias));
    const facts = element('dl', undefined, 'facts');
    facts.append(
      row('Original source SHA-256', profile.source.sha256),
      row('Security scheme', profile.source.scheme),
      row('Registered profile SHA-256', profile.profileSha256),
      row('Exact callback to register', profile.callbackUri),
      row('Private directory reference', profile.directoryEnv),
      row('Private store', profile.directory),
      row('Client-secret reference', profile.clientSecretEnv ?? 'Public client; no secret reference'),
      row('Authorization origin', profile.authorizationOrigin),
      row('Token origin', profile.tokenOrigin),
      row('Approved resource origins', profile.resourceOrigins.join('\n')),
      row('Registered scopes', profile.scopeCount + ' · exact values are reviewed in the original authorization controls'),
    );
    detail.append(facts); section.append(detail);
  }
  section.append(element('p', 'Saved grants and renewal history remain in their original private stores. A changed registry, registered source or private location requires a new start review. Normal grant renewal preserves this application configuration.', 'note'));
  return section;
}
