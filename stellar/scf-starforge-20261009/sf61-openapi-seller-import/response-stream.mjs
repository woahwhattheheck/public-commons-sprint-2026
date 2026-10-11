// MIT. Declared OpenAPI stream media for the original paid HTTP resource.
import { responseStreamContentType } from '../sf31-buyer-client/response-stream.mjs';

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const formats = ['sse', 'ndjson'];

/** Describe explicit HTTP 200 stream declarations using the original resolver. */
export function openApiResponseStreams(operation, refs) {
  if (!object(operation.responses) || !Object.hasOwn(operation.responses, '200')) return [];
  const response = refs.reference(operation.responses['200']);
  if (!object(response.content)) return [];
  const entries = Object.keys(response.content).sort();
  return formats.flatMap(format => {
    const mimeType = entries.find(type => !/[\u0000\r\n]/.test(type) &&
      responseStreamContentType(format, type) && object(response.content[type]));
    return mimeType === undefined ? [] : [{format, status:200, mimeType}];
  });
}

/** Selecting streaming is explicit; an ordinary import retains its old behavior. */
export function selectOpenApiResponseStream(operation, refs, format) {
  if (format === undefined) return null;
  if (!formats.includes(format)) throw new TypeError('responseFormat must be sse or ndjson');
  const selected = openApiResponseStreams(operation, refs).find(value => value.format === format);
  if (!selected) throw new TypeError('Declare an explicit HTTP 200 ' +
    (format === 'sse' ? 'text/event-stream' : 'application/x-ndjson or application/ndjson') +
    ' response with UTF-8 encoding before selecting this stream format');
  return selected;
}
