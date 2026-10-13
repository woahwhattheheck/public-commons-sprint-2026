/* Curriculum dataset coverage — original bulk occurrences and explicit scoped identities. */
export const CURRICULUM_COVERAGE_FORMAT = 'curriculum-dataset-coverage.v1';

/** Identity dimensions are literal publisher fields. Aliases are never merged. */
export const CURRICULUM_SCOPE_FIELDS = Object.freeze([
  'sequenceSlug', 'programmeSlug', 'programSlug', 'programmeId', 'programme',
  'year', 'yearSlug', 'yearId', 'subjectSlug', 'subjectId', 'keyStageSlug', 'keyStage',
  'unitOptionGroup', 'unitOptionGroupSlug', 'unitOptionGroupId', 'unitOptionSlug',
  'optionSlug', 'optionId', 'tierSlug', 'tier', 'examboardSlug', 'examBoardSlug',
  'examboard', 'examBoard', 'pathwaySlug', 'pathway'
]);
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const escaped = value => String(value).replace(/~/g, '~0').replace(/\//g, '~1');
const child = (pointer, name) => pointer + '/' + escaped(name);
function requireValue(condition, message) { if (!condition) throw new TypeError(message); }
function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (object(value)) return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
  return JSON.stringify(value);
}
/** Receive JSON without silent omission, prototype conversion, or input mutation. */
function jsonCopy(value, pointer = '', ancestors = new Set(), depth = 0) {
  requireValue(depth <= 256, 'JSON nesting exceeds 256 levels at ' + pointer);
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    requireValue(Number.isFinite(value), 'Expected a finite JSON number at ' + pointer);
    return value;
  }
  requireValue(typeof value === 'object' && value !== null, 'Expected a JSON value at ' + pointer);
  requireValue(!ancestors.has(value), 'A JSON cycle occurs at ' + pointer);
  const array = Array.isArray(value), prototype = Object.getPrototypeOf(value);
  requireValue(array || prototype === Object.prototype || prototype === null, 'Expected a JSON object at ' + pointer);
  requireValue(Object.getOwnPropertySymbols(value).length === 0, 'JSON symbol properties are unsupported at ' + pointer);
  ancestors.add(value);
  try {
    const result = array ? [] : {};
    const keys = Object.keys(value);
    if (array) requireValue(keys.length === value.length && keys.every((key, index) => key === String(index)),
      'Expected a dense JSON array without extra properties at ' + pointer);
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      requireValue(descriptor && own(descriptor, 'value'), 'JSON accessors are unsupported at ' + child(pointer, key));
      Object.defineProperty(result, key, { value:jsonCopy(descriptor.value, child(pointer,key), ancestors, depth + 1),
        enumerable:true, configurable:true, writable:true });
    }
    return result;
  } finally { ancestors.delete(value); }
}
function freeze(value) {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const item of Object.values(value)) freeze(item);
    Object.freeze(value);
  }
  return value;
}
function tag(record, field) {
  if (!object(record) || !own(record, field)) return { state:'absent' };
  return record[field] === null ? { state:'null' } : { state:'value', value:record[field] };
}
function textTag(value) { return value.state === 'value' && typeof value.value === 'string' && value.value.length > 0; }
function tagsEqual(left, right) { return canonical(left) === canonical(right); }
function scope(body, record, pointer) {
  const context = {}, contextSources = {};
  for (const field of CURRICULUM_SCOPE_FIELDS) {
    const local = object(record) && own(record,field), inherited = own(body,field);
    context[field] = tag(local ? record : body, field);
    contextSources[field] = local ? child(pointer,field) : inherited ? child('',field) : null;
  }
  return {context, contextSources};
}
function identityContext(context) {
  const result = {};
  for (const field of CURRICULUM_SCOPE_FIELDS) {
    const value = context[field], nested = field === 'examBoard' ? 'slug' : field === 'tier' ? 'tierSlug' : null;
    result[field] = nested && value.state === 'value' && object(value.value)
      ? { state:'value', value:{ [nested]:tag(value.value,nested) } } : value;
  }
  return result;
}
function conflicts(left, right) {
  const result = [], leftIdentity = identityContext(left), rightIdentity = identityContext(right);
  for (const field of CURRICULUM_SCOPE_FIELDS) {
    const a = leftIdentity[field], b = rightIdentity[field];
    if (a.state !== 'absent' && b.state !== 'absent' && !tagsEqual(a,b)) result.push({ field, left:a, right:b });
  }
  return result;
}
function indexRows(rows, selector) {
  const result = new Map();
  for (const row of rows) {
    const key = selector(row);
    if (key === null) continue;
    if (!result.has(key)) result.set(key, []);
    result.get(key).push(row);
  }
  return result;
}
function pointerList(rows) { return rows.map(row => row.pointer); }
function nonemptyText(value, label) {
  requireValue(typeof value === 'string' && value.trim().length > 0, label + ' must be an explicit nonempty string.');
}

/**
 * Inspect one retained publisher bulk dataset. No endpoint calls, slug normalization,
 * generated curriculum identities, edition inference, or selected candidate collapse.
 *
 * input: {id, editionId, namespace, body, provenance?}
 * Semantic keys exclude dataset ID, edition ID, order and JSON Pointer. Occurrence
 * pointers distinguish repeated identities. Every JSON value is retained unchanged.
 */
export function inspectCurriculumDataset(input) {
  requireValue(object(input), 'A curriculum dataset object is required.');
  nonemptyText(input.id, 'Dataset id');
  nonemptyText(input.editionId, 'Edition id');
  nonemptyText(input.namespace, 'Namespace');
  requireValue(object(input.body), 'Dataset body must be the original bulk JSON object.');
  const body = jsonCopy(input.body), provenance = own(input,'provenance') ? jsonCopy(input.provenance) : null;
  const dataset = { id:input.id, editionId:input.editionId, namespace:input.namespace, body, provenance,
    provenancePresent:own(input,'provenance') };
  const units = [], lessons = [], references = [], issues = [];
  const issue = (code, severity, pointer, message, detail = {}, relatedPointers = []) => {
    issues.push({ code, severity, pointer, relatedPointers, message, detail });
  };
  function collection(field) {
    if (!own(body,field)) {
      issue('MISSING_COLLECTION','error',child('',field),'The bulk dataset does not contain its ' + field + ' collection.');
      return [];
    }
    if (!Array.isArray(body[field])) {
      issue('INVALID_COLLECTION','error',child('',field),'The bulk ' + field + ' collection must be an array.',
        { received:tag(body,field) });
      return [];
    }
    return body[field];
  }
  const sequenceSlug = tag(body,'sequenceSlug');
  if (!textTag(sequenceSlug)) issue('INVALID_SEQUENCE_SLUG','error','/sequenceSlug',
    'The original bulk sequenceSlug must be a nonempty string.', {received:sequenceSlug});
  function row(kind, record, pointer, order) {
    const slugField = kind === 'unit' ? 'unitSlug' : 'lessonSlug', slug = tag(record,slugField);
    const scoped = scope(body,record,pointer);
    // Lesson unitSlug is part of its declared identity, not an inferred membership.
    const declaredUnit = kind === 'lesson' ? tag(record,'unitSlug') : null;
    const identity = { namespace:input.namespace, kind, context:identityContext(scoped.context), slug,
      ...(kind === 'lesson' ? { unitSlug:declaredUnit } : {}) };
    const requiredScope = kind === 'unit' ? ['yearSlug','year','keyStageSlug','subjectSlug'] : ['keyStageSlug','subjectSlug'];
    const missingScope = requiredScope.filter(field => {
      const value = scoped.context[field];
      return field === 'year'
        ? !(value.state === 'value' && (Number.isSafeInteger(value.value) || value.value === 'All years'))
        : !textTag(value);
    });
    const identityValid = textTag(sequenceSlug) && textTag(slug) && !missingScope.length &&
      (kind !== 'lesson' || textTag(declaredUnit));
    for (const field of missingScope) issue('INVALID_IDENTITY_CONTEXT','error',
      scoped.contextSources[field] ?? child(pointer,field),
      'The occurrence is missing a valid original ' + field + ' identity field.',
      { field, received:scoped.context[field], occurrence:pointer });
    const value = { kind, key:canonical(identity), identity, identityValid, pointer, order, record,
      datasetId:input.id, editionId:input.editionId, namespace:input.namespace,
      slug, ...scoped, ...(kind === 'lesson' ? { unitSlug:declaredUnit } : {}) };
    if (!object(record)) issue('INVALID_RECORD','error',pointer,'A ' + kind + ' occurrence must be a JSON object.');
    if (!textTag(slug)) issue('INVALID_SLUG','error',child(pointer,slugField),
      'The ' + kind + ' occurrence needs its original nonempty ' + slugField + '.', { received:slug });
    for (const field of CURRICULUM_SCOPE_FIELDS) {
      if (object(record) && own(record,field) && own(body,field) && !tagsEqual(tag(record,field),tag(body,field))) {
        issue('DATASET_CONTEXT_DISAGREEMENT','warning',child(pointer,field),
          'The occurrence declares a different ' + field + ' from the dataset; both values remain retained.',
          { field, dataset:tag(body,field), occurrence:tag(record,field) }, [child('',field)]);
      }
    }
    return value;
  }
  const sequence = collection('sequence'), payloads = collection('lessons');
  sequence.forEach((record,index) => {
    const pointer = child('/sequence',index), unit = row('unit',record,pointer,index);
    unit.referencePointers = [];
    units.push(unit);
    if (!object(record) || !own(record,'unitLessons')) {
      issue('MISSING_UNIT_LESSONS','error',child(pointer,'unitLessons'),
        'This unit has no retained lesson-reference list; an empty list has not been inferred.');
      return;
    }
    if (!Array.isArray(record.unitLessons)) {
      issue('INVALID_UNIT_LESSONS','error',child(pointer,'unitLessons'),'Unit lesson references must be an array.',
        { received:tag(record,'unitLessons') });
      return;
    }
    record.unitLessons.forEach((entry,order) => {
      const referencePointer = child(child(pointer,'unitLessons'),order);
      const lessonSlug = tag(entry,'lessonSlug'), state = tag(entry,'state');
      const publication = state.state === 'value' && state.value === 'published' ? 'published'
        : state.state === 'value' && ['new','migration'].includes(state.value) ? 'non-published'
        : state.state === 'value' && typeof state.value === 'string' ? 'unknown'
        : state.state === 'absent' || state.state === 'null' ? 'unspecified' : 'invalid';
      const reference = { kind:'lesson-reference', pointer:referencePointer, parentPointer:pointer, order,
        datasetId:input.id, editionId:input.editionId, namespace:input.namespace, record:entry,
        lessonSlug, state, declaredOrder:tag(entry,'lessonOrder'), publication, expectedPayload:publication === 'published',
        context:unit.context, contextSources:unit.contextSources };
      references.push(reference); unit.referencePointers.push(referencePointer);
      if (!object(entry)) issue('INVALID_LESSON_REFERENCE','error',referencePointer,
        'A unit lesson reference must be a JSON object.');
      if (!textTag(lessonSlug)) issue('INVALID_REFERENCE_SLUG','error',child(referencePointer,'lessonSlug'),
        'The reference needs its original nonempty lessonSlug.', { received:lessonSlug });
      if (publication === 'unknown') issue('UNRECOGNIZED_REFERENCE_STATE','warning',child(referencePointer,'state'),
        'The source state is outside published/new/migration; its publication expectation remains unresolved.', { received:state });
      const declaredOrder = tag(entry,'lessonOrder');
      if (declaredOrder.state !== 'value' || !Number.isSafeInteger(declaredOrder.value))
        issue('INVALID_LESSON_ORDER','error',child(referencePointer,'lessonOrder'),
          'The original lessonOrder must be an integer; array order remains retained.', { received:declaredOrder });
      if (publication === 'unspecified') issue('UNSPECIFIED_REFERENCE_STATE','warning',child(referencePointer,'state'),
        'The original state does not establish that a lesson payload should be published.', { received:state });
      if (publication === 'invalid') issue('INVALID_REFERENCE_STATE','error',child(referencePointer,'state'),
        'The reference state must be a string when supplied.', { received:state });
    });
  });
  payloads.forEach((record,index) => {
    const value = row('lesson',record,child('/lessons',index),index);
    value.referencePointers = [];
    lessons.push(value);
    if (!textTag(value.unitSlug)) issue('INVALID_LESSON_UNIT_SLUG','error',child(value.pointer,'unitSlug'),
      'A lesson payload needs its original nonempty unitSlug.', { received:value.unitSlug });
  });
  const unitsBySlug = indexRows(units,row => textTag(row.slug) ? row.slug.value : null);
  const lessonsBySlug = indexRows(lessons,row => textTag(row.slug) ? row.slug.value : null);
  for (const [kind,rows] of [['unit',units],['lesson',lessons]]) {
    for (const duplicates of indexRows(rows,row=>row.key).values()) {
      if (duplicates.length > 1) issue('DUPLICATE_' + kind.toUpperCase() + '_IDENTITY','warning',duplicates[0].pointer,
        'Several ' + kind + ' occurrences have the same scoped identity; none was removed or selected.',
        { key:duplicates[0].key, count:duplicates.length }, pointerList(duplicates.slice(1)));
    }
  }
  for (const lesson of lessons) {
    const candidates = textTag(lesson.unitSlug) ? unitsBySlug.get(lesson.unitSlug.value) ?? [] : [];
    const contextMatches = [], contextDisagreements = [];
    for (const candidate of candidates) {
      const differences = conflicts(lesson.context,candidate.context);
      if (!differences.length) contextMatches.push(candidate.pointer);
      else contextDisagreements.push({pointer:candidate.pointer,differences});
      const a = tag(lesson.record,'unitTitle'), b = tag(candidate.record,'unitTitle');
      if (textTag(a) && textTag(b) && a.value !== b.value) issue('UNIT_TITLE_DISAGREEMENT','warning',
        child(lesson.pointer,'unitTitle'),'The lesson and a candidate unit have different original unit titles.',
        { lessonTitle:a.value, unitTitle:b.value },[child(candidate.pointer,'unitTitle')]);
    }
    lesson.unitMembership = { status:!textTag(lesson.unitSlug) ? 'invalid' : candidates.length === 0 ? 'missing'
      : candidates.length > 1 ? 'ambiguous' : 'matched',
      candidateUnitPointers:pointerList(candidates), contextCompatibleUnitPointers:contextMatches, contextDisagreements };
    if (textTag(lesson.unitSlug) && !candidates.length) issue('MISSING_LESSON_UNIT','error',child(lesson.pointer,'unitSlug'),
      'The lesson payload names a unitSlug absent from the sequence.', { unitSlug:lesson.unitSlug.value });
    if (candidates.length > 1) issue('AMBIGUOUS_UNIT_MEMBERSHIP','warning',child(lesson.pointer,'unitSlug'),
      'The lesson unitSlug has multiple sequence occurrences; variant membership requires review.',
      { candidates:candidates.length, contextCompatibleUnitPointers:contextMatches },pointerList(candidates));
    if (contextDisagreements.length) issue('LESSON_UNIT_CONTEXT_DISAGREEMENT','warning',lesson.pointer,
      'The lesson context differs from one or more original unit candidates.',
      { candidates:contextDisagreements },contextDisagreements.map(item=>item.pointer));
  }
  const usedPayloads = new Set();
  for (const reference of references) {
    const candidates = textTag(reference.lessonSlug) ? lessonsBySlug.get(reference.lessonSlug.value) ?? [] : [];
    const parent = units[Number(reference.parentPointer.slice('/sequence/'.length))];
    const sameUnit = [], otherUnit = [], contextMatches = [], contextDisagreements = [];
    for (const candidate of candidates) {
      candidate.referencePointers.push(reference.pointer); usedPayloads.add(candidate.pointer);
      if (tagsEqual(candidate.unitSlug,parent.slug)) sameUnit.push(candidate.pointer);
      else otherUnit.push(candidate.pointer);
      const differences = conflicts(reference.context,candidate.context);
      if (!differences.length) contextMatches.push(candidate.pointer);
      else contextDisagreements.push({pointer:candidate.pointer,differences});
      const a = tag(reference.record,'lessonTitle'), b = tag(candidate.record,'lessonTitle');
      if (textTag(a) && textTag(b) && a.value !== b.value) issue('LESSON_TITLE_DISAGREEMENT','warning',
        child(reference.pointer,'lessonTitle'),'The reference and a candidate payload have different original lesson titles.',
        { referenceTitle:a.value, payloadTitle:b.value },[child(candidate.pointer,'lessonTitle')]);
    }
    reference.resolution = {
      status:!textTag(reference.lessonSlug) ? 'invalid' : candidates.length > 1 ? 'ambiguous'
        : candidates.length === 1 ? 'matched' : reference.expectedPayload ? 'missing-published'
        : reference.publication === 'non-published' ? 'missing-non-published' : 'missing-unspecified',
      candidatePayloadPointers:pointerList(candidates), sameUnitPayloadPointers:sameUnit,
      otherUnitPayloadPointers:otherUnit, contextCompatiblePayloadPointers:contextMatches, contextDisagreements };
    if (reference.expectedPayload && textTag(reference.lessonSlug) && !candidates.length)
      issue('MISSING_PUBLISHED_LESSON_PAYLOAD','error',child(reference.pointer,'lessonSlug'),
        'The published lesson reference has no matching lessonSlug in the original lessons collection.',
        { lessonSlug:reference.lessonSlug.value, coverageRule:'published-reference-global-lesson-slug' });
    if (candidates.length > 1) issue('AMBIGUOUS_LESSON_PAYLOAD','warning',reference.pointer,
      'Several original lesson payloads match this reference; all occurrences remain available.',
      { candidates:candidates.length },pointerList(candidates));
    // Cross-unit reuse is evidence for review, never a missing-payload error.
    if (otherUnit.length) issue('CROSS_UNIT_LESSON_REFERENCE','info',reference.pointer,
      'A matching payload names a different unitSlug; reuse or variants may explain this reference.',
      { sameUnitPayloadPointers:sameUnit, otherUnitPayloadPointers:otherUnit },otherUnit);
    if (contextDisagreements.length) issue('REFERENCE_CONTEXT_DISAGREEMENT','warning',reference.pointer,
      'The reference context differs from one or more matching payloads.',
      { candidates:contextDisagreements },contextDisagreements.map(item=>item.pointer));
  }
  const unreferenced = lessons.filter(lesson => !usedPayloads.has(lesson.pointer));
  for (const lesson of unreferenced) issue('UNREFERENCED_LESSON_PAYLOAD','info',lesson.pointer,
    'No retained sequence lesson reference names this payload lessonSlug; the original payload is preserved.',
    { lessonSlug:lesson.slug });
  const duplicateReferences = indexRows(references,row=>canonical([row.parentPointer,row.lessonSlug]));
  for (const group of duplicateReferences.values()) if (group.length > 1)
    issue('DUPLICATE_LESSON_REFERENCE','warning',group[0].pointer,
      'The same unit occurrence references this lessonSlug more than once; original order is preserved.',
      { count:group.length },pointerList(group.slice(1)));
  const count = predicate => references.filter(predicate).length;
  const byCode = {}, bySeverity = { error:0, warning:0, info:0 };
  for (const item of issues) { byCode[item.code] = (byCode[item.code] ?? 0) + 1; bySeverity[item.severity]++; }
  const summary = {
    units:units.length, lessons:lessons.length, references:references.length,
    uniqueUnitKeys:new Set(units.map(row=>row.key)).size, uniqueLessonKeys:new Set(lessons.map(row=>row.key)).size,
    publishedReferences:count(row=>row.publication === 'published'),
    nonPublishedReferences:count(row=>row.publication === 'non-published'),
    unspecifiedReferences:count(row=>row.publication === 'unspecified'),
    unknownStateReferences:count(row=>row.publication === 'unknown' || row.publication === 'invalid'),
    publishedReferencesWithPayload:count(row=>row.expectedPayload && row.resolution.candidatePayloadPointers.length > 0),
    missingPublishedPayloads:count(row=>row.resolution.status === 'missing-published'),
    missingNonPublishedPayloads:count(row=>row.resolution.status === 'missing-non-published'),
    ambiguousReferences:count(row=>row.resolution.status === 'ambiguous'),
    ambiguousUnitMemberships:lessons.filter(row=>row.unitMembership.status === 'ambiguous').length,
    unreferencedPayloads:unreferenced.length, issues:issues.length, issuesBySeverity:bySeverity, issuesByCode:byCode,
    coverageRule:'published-reference-global-lesson-slug',
    complete:bySeverity.error === 0 && count(row=>['unspecified','unknown','invalid'].includes(row.publication)) === 0,
    interpretation:'Complete means the retained dataset satisfies these reference checks; it does not establish collection-wide publisher completeness.'
  };
  return freeze({ schema:CURRICULUM_COVERAGE_FORMAT, dataset, units, lessons, references, issues, summary });
}
