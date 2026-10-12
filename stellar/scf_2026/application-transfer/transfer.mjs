/**
 * Exact-text application transfer. All extraction is from supplied source.
 * No network, wallet, provider submission, scheduling, or third-party package.
 */
export class ApplicationTransferError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'ApplicationTransferError';
    this.code = code;
    this.details = details;
  }
}

const fail = (code, message, details) => {
  throw new ApplicationTransferError(code, message, details);
};

function nonempty(value, label) {
  if (typeof value !== 'string' || value.trim() === '') {
    fail('INVALID_PROFILE', label + ' must be a nonempty string');
  }
  return value;
}

function positiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 1) {
    fail('INVALID_PROFILE', label + ' must be a positive integer');
  }
  return value;
}

function headingKey(text) {
  return text.trim().replace(/[ \t]+#+[ \t]*$/, '').replace(/[ \t]+/g, ' ').normalize('NFC');
}

function trimRange(lines, start, end) {
  while (start < end && lines[start].trim() === '') start++;
  while (end > start && lines[end - 1].trim() === '') end--;
  return { start, end };
}

function rangeText(lines, range) {
  return lines.slice(range.start, range.end).join('\n');
}

function parseMarkdown(source) {
  if (typeof source !== 'string') fail('INVALID_SOURCE', 'Source must be text');
  // Normalize line separators for extraction only; the CLI hashes original bytes.
  const lines = source.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  if (lines[0]?.charCodeAt(0) === 0xfeff) lines[0] = lines[0].slice(1);
  const headings = [];
  let fence = null;
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const fenceMatch = line.match(/^ {0,3}(\x60{3,}|~{3,})(.*)$/);
    if (fence) {
      const closing = line.match(/^ {0,3}(\x60+|~+)[ \t]*$/);
      if (closing && closing[1][0] === fence.character && closing[1].length >= fence.length) fence = null;
      continue;
    }
    if (fenceMatch) {
      // A backtick fence cannot have a backtick in its info string.
      if (fenceMatch[1][0] !== '\x60' || !fenceMatch[2].includes('\x60')) {
        fence = { character: fenceMatch[1][0], length: fenceMatch[1].length };
        continue;
      }
    }
    const match = line.match(/^ {0,3}(#{1,6})[ \t]+(.+?)[ \t]*$/);
    if (match) headings.push({ level: match[1].length, title: headingKey(match[2]), line: index });
  }
  return { lines, headings };
}

function paragraphRanges(lines, start, end) {
  const ranges = [];
  while (start < end) {
    while (start < end && lines[start].trim() === '') start++;
    if (start >= end) break;
    const first = start;
    while (start < end && lines[start].trim() !== '') start++;
    ranges.push({ start: first, end: start });
  }
  return ranges;
}

function selectRanges(document, selector, fieldId) {
  if (!selector || typeof selector !== 'object' || Array.isArray(selector)) {
    fail('INVALID_PROFILE', 'Each selector must be an object', { fieldId });
  }
  const allowedKeys = new Set(['heading', 'occurrence', 'scope', 'include_heading', 'paragraph_starts']);
  const unknownKeys = Object.keys(selector).filter(key => !allowedKeys.has(key));
  if (unknownKeys.length) fail('INVALID_PROFILE', 'Unknown selector option: ' + unknownKeys.join(', '), { fieldId, unknownKeys });
  const requested = headingKey(nonempty(selector.heading, 'Selector heading'));
  const matches = document.headings.filter(item => item.title === requested);
  if (matches.length === 0) {
    fail('HEADING_NOT_FOUND', 'Source heading was not found: ' + requested, { fieldId, heading: requested });
  }
  let heading;
  if (selector.occurrence !== undefined) {
    positiveInteger(selector.occurrence, 'Selector occurrence');
    heading = matches[selector.occurrence - 1];
    if (!heading) fail('HEADING_OCCURRENCE_NOT_FOUND', 'Requested heading occurrence does not exist', {
      fieldId, heading: requested, occurrence: selector.occurrence, available: matches.length,
    });
  } else {
    if (matches.length !== 1) fail('AMBIGUOUS_HEADING', 'Select an occurrence for repeated heading: ' + requested, {
      fieldId, heading: requested, lines: matches.map(item => item.line + 1),
    });
    heading = matches[0];
  }
  const scope = selector.scope ?? 'section';
  if (!['section', 'lead'].includes(scope)) fail('INVALID_PROFILE', 'Selector scope must be section or lead', { fieldId });
  if (selector.include_heading !== undefined && typeof selector.include_heading !== 'boolean') {
    fail('INVALID_PROFILE', 'include_heading must be boolean', { fieldId });
  }
  const next = document.headings.find(item => item.line > heading.line &&
    (scope === 'lead' || item.level <= heading.level));
  const bodyEnd = next ? next.line : document.lines.length;
  const start = selector.include_heading ? heading.line : heading.line + 1;
  const selected = trimRange(document.lines, start, bodyEnd);
  if (selected.start === selected.end) fail('EMPTY_SELECTION', 'Selected section is empty', { fieldId, heading: requested });
  if (selector.paragraph_starts === undefined) {
    return [{ ...selected, heading: requested, headingLine: heading.line + 1 }];
  }
  if (selector.include_heading) fail('INVALID_PROFILE', 'paragraph_starts cannot be combined with include_heading', { fieldId });
  if (!Array.isArray(selector.paragraph_starts) || selector.paragraph_starts.length === 0) {
    fail('INVALID_PROFILE', 'paragraph_starts must be a nonempty array', { fieldId });
  }
  const paragraphs = paragraphRanges(document.lines, selected.start, selected.end);
  const chosen = [];
  const seen = new Set();
  for (const prefix of selector.paragraph_starts) {
    nonempty(prefix, 'Paragraph prefix');
    const found = paragraphs.filter(range => rangeText(document.lines, range).startsWith(prefix));
    if (found.length !== 1) fail(found.length ? 'AMBIGUOUS_PARAGRAPH' : 'PARAGRAPH_NOT_FOUND',
      'Paragraph prefix must match exactly one source paragraph', { fieldId, heading: requested, prefix, matches: found.length });
    if (seen.has(found[0].start)) fail('DUPLICATE_SELECTION', 'Two prefixes select the same paragraph', { fieldId });
    seen.add(found[0].start);
    chosen.push({ ...found[0], heading: requested, headingLine: heading.line + 1 });
  }
  return chosen.sort((left, right) => left.start - right.start);
}

export function countText(text) {
  let codePoints = 0;
  let utf8Bytes = 0;
  for (const character of text) {
    codePoints++;
    const point = character.codePointAt(0);
    utf8Bytes += point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4;
  }
  return {
    codePoints,
    utf16CodeUnits: text.length,
    utf8Bytes,
    whitespaceWords: text.trim() ? text.trim().split(/\s+/u).length : 0,
    lines: text.length ? text.split('\n').length : 0,
  };
}

function assessLimits(counts, limits = {}) {
  if (!limits || typeof limits !== 'object' || Array.isArray(limits)) {
    fail('INVALID_PROFILE', 'Field limits must be an object');
  }
  const supported = new Set(['max_characters', 'character_unit', 'max_words']);
  for (const key of Object.keys(limits)) {
    if (!supported.has(key)) fail('INVALID_PROFILE', 'Unknown limit option: ' + key);
  }
  const characterUnit = limits.character_unit ?? 'utf16';
  if (!['utf16', 'code_points', 'utf8_bytes'].includes(characterUnit)) {
    fail('INVALID_PROFILE', 'character_unit must be utf16, code_points, or utf8_bytes');
  }
  const overages = [];
  if (limits.max_characters !== undefined && limits.max_characters !== null) {
    positiveInteger(limits.max_characters, 'max_characters');
    const count = characterUnit === 'utf16' ? counts.utf16CodeUnits :
      characterUnit === 'code_points' ? counts.codePoints : counts.utf8Bytes;
    if (count > limits.max_characters) overages.push({
      kind: 'characters', unit: characterUnit, count, limit: limits.max_characters,
      overBy: count - limits.max_characters,
    });
  }
  if (limits.max_words !== undefined && limits.max_words !== null) {
    positiveInteger(limits.max_words, 'max_words');
    if (counts.whitespaceWords > limits.max_words) overages.push({
      kind: 'words', unit: 'whitespace_words', count: counts.whitespaceWords, limit: limits.max_words,
      overBy: counts.whitespaceWords - limits.max_words,
    });
  }
  const specified = limits.max_characters != null || limits.max_words != null;
  return {
    limits: { characterUnit, maxCharacters: limits.max_characters ?? null, maxWords: limits.max_words ?? null },
    status: overages.length ? 'limit_exceeded' : specified ? 'within_limits' : 'limits_not_supplied',
    overages,
  };
}

/** Build fields from exact source ranges; no summarization or automatic clipping. */
export function buildTransfer(source, profile, sourceIdentity = {}) {
  if (!profile || profile.schema !== 'starforge.application-field-map.v1') {
    fail('INVALID_PROFILE', 'Expected starforge.application-field-map.v1');
  }
  nonempty(profile.title, 'Profile title');
  if (!Array.isArray(profile.fields) || profile.fields.length === 0) {
    fail('INVALID_PROFILE', 'Profile must contain fields');
  }
  const document = parseMarkdown(source);
  const seenIds = new Set();
  const fields = profile.fields.map((field, index) => {
    if (!field || typeof field !== 'object') fail('INVALID_PROFILE', 'Field must be an object');
    const id = nonempty(field.id, 'Field id');
    if (!/^[a-z0-9]+(?:[-_][a-z0-9]+)*$/.test(id) || seenIds.has(id)) {
      fail('INVALID_PROFILE', 'Field ids must be unique lowercase filenames', { fieldId: id });
    }
    seenIds.add(id);
    const label = nonempty(field.label, 'Field label');
    if (!Array.isArray(field.selectors) || field.selectors.length === 0) {
      fail('INVALID_PROFILE', 'Each field requires source selectors', { fieldId: id });
    }
    const ranges = field.selectors.flatMap(selector => selectRanges(document, selector, id));
    const value = ranges.map(range => rangeText(document.lines, range)).join('\n\n');
    const counts = countText(value);
    return {
      id, label, filename: String(index + 1).padStart(2, '0') + '-' + id + '.txt',
      value, counts, ...assessLimits(counts, field.limits),
      sourceRanges: ranges.map(range => ({
        startLine: range.start + 1, endLine: range.end,
        heading: range.heading, headingLine: range.headingLine,
      })),
    };
  });
  const covered = new Set();
  for (const field of fields) {
    for (const range of field.sourceRanges) {
      for (let line = range.startLine; line <= range.endLine; line++) covered.add(line);
    }
  }
  const unselected = [];
  let start = null;
  for (let index = 0; index <= document.lines.length; index++) {
    const omitted = index < document.lines.length &&
      document.lines[index].trim() !== '' && !covered.has(index + 1);
    if (omitted && start === null) start = index + 1;
    if (!omitted && start !== null) {
      unselected.push({ startLine: start, endLine: index });
      start = null;
    }
  }
  return {
    schema: 'starforge.application-transfer.v1',
    title: profile.title,
    source: { ...sourceIdentity, counts: countText(source), lineCount: document.lines.length },
    fields,
    summary: {
      fieldCount: fields.length,
      fieldsExceedingLimits: fields.filter(field => field.status === 'limit_exceeded').map(field => field.id),
      fieldsWithoutLimits: fields.filter(field => field.status === 'limits_not_supplied').map(field => field.id),
      unselectedNonemptyLineRanges: unselected,
    },
  };
}

function escapeHtml(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export function renderMarkdown(transfer) {
  return '# ' + transfer.title + '\n\n' +
    transfer.fields.map(field => '## ' + field.label + '\n\n' + field.value).join('\n\n') + '\n';
}

export function renderReview(transfer) {
  const cards = transfer.fields.map((field, index) => {
    const limit = field.limits.maxCharacters === null ? 'Character limit not supplied' :
      String(field.limits.maxCharacters) + ' ' + field.limits.characterUnit + ' character limit';
    const status = field.overages.length ?
      field.overages.map(item => String(item.overBy) + ' ' + item.kind + ' over limit').join('; ') :
      field.status === 'within_limits' ? 'Within configured limits' : 'Set the issuer limits in the field map';
    const id = 'field-' + field.id;
    return '<section class="field"><div class="field-head"><div><p class="eyebrow">Field ' +
      String(index + 1) + '</p><h2>' + escapeHtml(field.label) +
      '</h2></div><button type="button" data-copy="' + id + '">Copy field</button></div>' +
      '<p class="counts">' + field.counts.utf16CodeUnits + ' UTF-16 units · ' +
      field.counts.codePoints + ' Unicode code points · ' + field.counts.whitespaceWords +
      ' whitespace words</p><p class="limit ' + (field.overages.length ? 'exceeded' : '') + '">' +
      escapeHtml(limit + '. ' + status + '.') + '</p><label class="sr-only" for="' +
      id + '">' + escapeHtml(field.label) + '</label><textarea id="' + id +
      '" readonly spellcheck="false">' + escapeHtml(field.value) + '</textarea><pre class="print-value">' + escapeHtml(field.value) + '</pre></section>';
  }).join('\n');
  const script = "document.addEventListener('click',async function(event){" +
    "var button=event.target.closest('button[data-copy]');if(!button)return;" +
    "var area=document.getElementById(button.dataset.copy);var copied=false;" +
    "try{if(navigator.clipboard&&window.isSecureContext){await navigator.clipboard.writeText(area.value);copied=true;}}" +
    "catch(error){}if(!copied){area.focus();area.select();try{copied=document.execCommand('copy');}catch(error){}}" +
    "document.getElementById('copy-status').textContent=copied?'Field copied.':'Text selected. Use your device copy command.';" +
    "});";
  return '<!doctype html>\n<html lang="en"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; script-src \'unsafe-inline\'; base-uri \'none\'; form-action \'none\'">' +
    '<title>' + escapeHtml(transfer.title) + '</title><style>' +
    '*{box-sizing:border-box}body{margin:0;color:#171717;background:#f5f5f5;font:16px/1.5 system-ui,sans-serif}' +
    'main{max-width:1120px;margin:auto;padding:36px 22px}header{border-bottom:2px solid #171717;margin-bottom:24px;padding-bottom:20px}' +
    'h1{font-size:30px;line-height:1.2;margin:0 0 12px}h2{font-size:21px;margin:0}p{margin:8px 0}' +
    '.field{background:#fff;border:1px solid #aaa;padding:22px;margin:0 0 22px}.field-head{display:flex;gap:20px;align-items:center;justify-content:space-between}' +
    '.eyebrow{font-size:12px;text-transform:uppercase;letter-spacing:.06em;margin:0 0 4px}.counts,.limit{font-size:13px}' +
    '.exceeded{font-weight:700;border-left:4px solid #171717;padding-left:10px}' +
    'button{border:1px solid #171717;background:#fff;color:#171717;border-radius:3px;padding:10px 16px;font:inherit;cursor:pointer;white-space:nowrap}' +
    'button:hover,button:focus-visible{background:#e8e8e8}textarea{width:100%;min-height:330px;resize:vertical;border:1px solid #aaa;border-radius:0;padding:14px;font:14px/1.55 ui-monospace,monospace;color:#171717;background:#fff}' +
    '.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0)}' +
    '#copy-status{min-height:24px;font-size:14px}footer{font-size:13px;border-top:1px solid #aaa;padding-top:16px}' +
    '@media(max-width:600px){main{padding:24px 12px}.field{padding:15px}.field-head{align-items:flex-start;flex-direction:column;gap:12px}h1{font-size:25px}textarea{min-height:360px}}' +
    '.print-value{display:none}' +
    '@media print{body{background:#fff}main{max-width:none;padding:0}button,textarea,#copy-status{display:none}.field{break-inside:auto}.field-head{break-after:avoid}.print-value{display:block;white-space:pre-wrap;overflow-wrap:anywhere;font:12px/1.5 ui-monospace,monospace}}' +
    '</style></head><body><main><header><p class="eyebrow">Application field transfer</p><h1>' +
    escapeHtml(transfer.title) + '</h1><p>' + transfer.fields.length +
    ' fields extracted from the supplied manuscript. Review each value against the destination form and copy it when ready.</p>' +
    '<p id="copy-status" role="status" aria-live="polite"></p></header>' + cards +
    '<footer>Text is preserved from the selected source ranges. Field limits follow the supplied map; over-limit values remain complete for editing.</footer>' +
    '</main><script>' + script + '</script></body></html>\n';
}
