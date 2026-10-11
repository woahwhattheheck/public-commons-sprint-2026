// MIT. Preserve the original source bytes; normalize only the compiler's value.
import { parseOpenApiValue } from './source-value.mjs';
import { SOURCE_BUNDLE_SCHEMA, openSourceBundle } from './source-bundle.mjs';
import { POSTMAN_SOURCE_SCHEMA, openPostmanSource } from './postman/collection.mjs';

export function parseOpenApiSource(text) {
  const parsed = parseOpenApiValue(text);
  if (parsed.value?.schema === POSTMAN_SOURCE_SCHEMA) {
    const opened = openPostmanSource(parsed.value);
    return {document:opened.document, format:'json', postmanSource:opened.summary};
  }
  if (parsed.value?.schema === SOURCE_BUNDLE_SCHEMA) {
    const opened = openSourceBundle(parsed.value);
    // JSON keeps the original workspace's retained source filename and format.
    return { document: opened.document, format: 'json', sourceBundle: opened.summary };
  }
  const value = parsed.value;
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      !/^3\.[01]\.\d+$/.test(value.openapi) || !value.paths ||
      typeof value.paths !== 'object')
    throw new TypeError('Load an OpenAPI 3.0 or 3.1 JSON or YAML document');
  return { document: value, format: parsed.format };
}
