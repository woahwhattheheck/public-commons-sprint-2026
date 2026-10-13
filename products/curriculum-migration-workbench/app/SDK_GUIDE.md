# Generated Oak TypeScript SDK

The workbench generates a portable client from the selected source edition. Keep `client.ts`, `types.ts` and `inventory.json` together. The generated files bind the edition identifier and source provenance; regenerating from a following edition produces a separate reviewable output.

## Source and scope

- Repository: `oaknational/oak-curriculum-api`.
- Captured commit: `eabbd67483f37cf6ceb8abb697fc44cb12aca99c`.
- REST source: [`__tests__/__snapshots__/api-v1-surface.json`](https://github.com/oaknational/oak-curriculum-api/blob/eabbd67483f37cf6ceb8abb697fc44cb12aca99c/__tests__/__snapshots__/api-v1-surface.json). It declares 32 operations under `/api/v1`: 31 JSON success responses and one asset redirect.
- Bulk source: [`src/app/api/bulk/schema.json/schema.json`](https://github.com/oaknational/oak-curriculum-api/blob/eabbd67483f37cf6ceb8abb697fc44cb12aca99c/src/app/api/bulk/schema.json/schema.json). Bulk types are available through `BulkExport` and the original definition aliases.
- The original source files, their SHA-256 identities and the edition provenance remain in `inventory.json`. Keep the upstream licence with a distributed source edition.

## Compile with an existing TypeScript toolchain

The client uses Fetch, Headers, URL, URLSearchParams and AbortSignal. Use TypeScript 5 or later with the DOM library and an ES2022-capable runtime that provides Fetch, or pass an equivalent Fetch implementation. The generator itself is ordinary JavaScript and requires no runtime package.

With an existing compiler and an ESM project (`package.json` containing `"type": "module"`):

```sh
tsc --strict --target ES2022 --module NodeNext --moduleResolution NodeNext \
  --lib ES2022,DOM --outDir dist client.ts types.ts
```

The emitted client imports `./types.js`; TypeScript resolves its source to `types.ts`. The generated client and types must stay in the same directory. This command describes the intended compiler invocation; it is not a compilation receipt.

## Open the client against the operator's selected API

```ts
import { OakClient, OakApiError, OakProtocolError } from './client.js';

export function openCurriculumClient(
  apiBaseUrl: string,
  readToken: () => string | Promise<string>
) {
  return new OakClient({
    // Include the API major, for example an operator-provided URL ending /api/v1.
    baseUrl: apiBaseUrl,
    token: readToken,
  });
}

export async function findLessons(client: OakClient, query: string, signal?: AbortSignal) {
  const response = await client.getLessonsSearchByTextSimilarity({
    query: { q: query, keyStage: 'ks3', subject: 'english' },
  }, { signal });
  // The complete returned array is available as response.data.
  return response.data;
}

export async function readLesson(client: OakClient, lessonSlug: string, signal?: AbortSignal) {
  const response = await client.getLessonsGetLesson({
    path: { lesson: lessonSlug },
  }, { signal });
  return response.data;
}
```

`baseUrl` is the full API base; the client appends the captured operation path. The client encodes path values and query values, checks declared required request fields and enums, and passes cancellation through to Fetch. A token callback can read the current operator credential when each request is made. Credentials are not part of a portable source edition.

## Import a published response into the workbench

The pinned source includes the complete key-stage response at `src/lib/handlers/keyStages/schemas/keyStageResponse.example.json`, SHA-256 `af8fe60429f989019784d11c49611d6016f06032ba6552dd86b120803af696d0`:

```json
[{ "slug": "ks1", "title": "Key Stage 1" }]
```

Select the key-stage case in the workbench. Set the response source kind to `published-example`, import this complete body as the candidate response, and label it **Verification reuse of the original published key-stage response example**. Save it through the normal response editor, then compare it with the original. The comparison should retain unchanged content and its original source identity. This is a saved review of an existing published example; it is not a new API acquisition or output from a migration candidate.

For a migration review, save the actual candidate implementation's complete response as a separate response with its own source label and acquisition details. Record the comparison and decision, export the full workspace, and receive that export to reopen the source editions, responses, mappings and history.


### Save through the original model API

The application source ZIP contains `model.mjs`. Its public functions return a new workspace containing the new history events. Persist that returned workspace through the application's existing export/save flow.

```js
import * as Model from './model.mjs';

export function savePublishedKeyStageReview(workspace, caseId, actor) {
  const selected = workspace.cases.find(c => c.id === caseId);
  const body = [{slug: 'ks1', title: 'Key Stage 1'}];
  if (!selected || selected.operationKey !== 'GET /key-stages') {
    throw new Error('Select the existing key-stage case.');
  }
  if (!selected.responses.original ||
      Model.canonical(selected.responses.original.body) !== Model.canonical(body)) {
    throw new Error('The selected original is not this published example.');
  }
  const context = {actor, at: new Date().toISOString()};
  const saved = Model.saveResponse(workspace, caseId, 'candidate', {
    status: 200,
    contentType: 'application/json',
    headers: {},
    body,
    provenance: {
      kind: 'published-example',
      label: 'Verification reuse of the original published key-stage response example',
      repository: 'oaknational/oak-curriculum-api',
      commit: 'eabbd67483f37cf6ceb8abb697fc44cb12aca99c',
      path: 'src/lib/handlers/keyStages/schemas/keyStageResponse.example.json',
      sha256: 'af8fe60429f989019784d11c49611d6016f06032ba6552dd86b120803af696d0',
    },
  }, context);
  return Model.compareCase(saved, caseId, context);
}
```

This saves the published response directly and preserves the selected original. Any existing field mappings and target-edition selection remain part of the comparison. The function makes no HTTP request.

## Requests with query pages and a JSON body

```ts
const page = await client.getKeyStageSubjectLessonsGetKeyStageSubjectLessons({
  path: {keyStage: 'ks3', subject: 'english'},
  query: {limit: 25, offset: 0},
}, {signal});

const restrictions = await client.getLessonsPostCheckRestrictedLessons({
  body: {lessonSlugs: selectedLessonSlugs},
}, {signal});
```

Keep each page's arguments and complete returned value when collecting a source edition. The client makes one request per call; it does not combine or infer pages. Supply the next offset explicitly for an operation whose captured contract declares it.

The captured restriction-check body does not specify `requestBody.required`. Its generated body property is therefore optional, while a supplied body requires `lessonSlugs` as an array of strings. The example supplies that body explicitly. Original endpoint documentation records additional operational limits, including a maximum `limit` of 100 for questions list endpoints; the compact snapshot's numeric types do not encode that bound.

## Asset redirects

```ts
const asset = await client.getAssetsGetLessonAsset({
  path: {lesson: selectedLessonSlug, type: 'worksheet'},
}, {signal});

if (asset.kind === 'redirect') {
  // A server-side Fetch implementation can expose the original Location.
  const location = asset.location;
  // Present or process that URL under the receiving application's own policy.
} else {
  // Browser Fetch can expose only an opaque redirect, with status 0.
  // Use an authorized server-side transport if the application needs Location.
}
```

The source operation returns HTTP 302, not a file body. The client sets `redirect: 'manual'`, so it does not forward the API bearer token to a redirected host. It returns `kind: 'redirect'` when the response is visible, or `kind: 'opaque-redirect'` when the browser hides it. A visible 302 can still have no readable Location; handle that explicitly. The original endpoint guide describes video CDN redirects and time-limited signed storage links for other asset types. Preserve a returned redirect as that observation, not as downloaded content.

## Errors and complete response bodies

```ts
try {
  const response = await client.getRateLimitGetRateLimit({}, {signal});
  return response.data;
} catch (error) {
  if (error instanceof OakApiError) {
    return {
      operationId: error.operationId,
      status: error.status,
      body: error.body,
      rawBody: error.rawBody,
    };
  }
  if (error instanceof OakProtocolError) {
    throw new Error(`Unexpected successful response for ${error.operationId}: ${error.message}`);
  }
  throw error;
}
```

The compact REST source refers to three error definitions that it does not include. The SDK keeps those error bodies as `unknown` and retains both the parsed body and original text in `OakApiError`. A successful declared JSON status with empty or malformed JSON raises `OakProtocolError`. Network failures and aborts retain their Fetch error. The client does not retry a request automatically.

## Types and inventory interpretation

Required and nullable describe different things. A required field remains present even when `null` is an allowed value. For example, bulk `contentGuidance` is a required array-or-null field, while `transcript_sentences` is optional and may also be null. Original property spelling is preserved, including bulk `downloadsavailable` and REST `downloadsAvailable`.

JSON schema references resolve against the captured source. Declared bulk definitions become exported aliases; unresolved references remain unknown with a diagnostic. JSON Schema integers use TypeScript's `number` type. Constraints such as format, range and exact one-of exclusivity remain in the full source schemas. Static TypeScript output does not validate a returned JSON value; use the workbench's source-schema validation for that explicit review step.

The public GraphQL inventory supplies 110 relation-like names and descriptions, including 65 `published_` names. It does not publish the fields. The inventory records that limitation and does not generate tables, relationships, SQL migration statements, GraphQL queries, permissions or field-level nullability from those names. OWA's 16 captured exported string constants are retained as source declarations; no environment secret is evaluated.

## Complete generated operation map

Method names are the captured operation IDs. Required path and query arguments are in the associated request type.

| SDK method | HTTP | Captured path | Success status |
| --- | --- | --- | --- |
| `getKeyStagesGetKeyStages` | GET | `/key-stages` | 200 |
| `getAssetsGetSubjectAssets` | GET | `/key-stages/{keyStage}/subject/{subject}/assets` | 200 |
| `getKeyStageSubjectLessonsGetKeyStageSubjectLessonRestrictions` | GET | `/key-stages/{keyStage}/subject/{subject}/check-restricted` | 200 |
| `getKeyStageSubjectLessonsGetKeyStageSubjectLessons` | GET | `/key-stages/{keyStage}/subject/{subject}/lessons` | 200 |
| `getQuestionsGetQuestionsForKeyStageAndSubject` | GET | `/key-stages/{keyStage}/subject/{subject}/questions` | 200 |
| `getAllKeyStageAndSubjectUnitsGetAllKeyStageAndSubjectUnits` | GET | `/key-stages/{keyStage}/subject/{subject}/units` | 200 |
| `getKeywordsGetKeywords` | GET | `/keywords` | 200 |
| `getLessonsPostCheckRestrictedLessons` | POST | `/lessons/check-restricted` | 200 |
| `getAssetsGetLessonAssets` | GET | `/lessons/{lesson}/assets` | 200 |
| `getAssetsGetLessonAsset` | GET | `/lessons/{lesson}/assets/{type}` | 302 |
| `getQuestionsGetQuestionsForLessons` | GET | `/lessons/{lesson}/quiz` | 200 |
| `getLessonsGetLesson` | GET | `/lessons/{lesson}/summary` | 200 |
| `getLessonTranscriptGetLessonTranscript` | GET | `/lessons/{lesson}/transcript` | 200 |
| `getAllProgrammesForSubjectGetProgramme` | GET | `/programmes/{programme}` | 200 |
| `getAssetsGetProgrammeAssets` | GET | `/programmes/{programme}/assets` | 200 |
| `getQuestionsGetQuestionsForProgramme` | GET | `/programmes/{programme}/questions` | 200 |
| `getAllProgrammesForSubjectGetProgrammeUnits` | GET | `/programmes/{programme}/units` | 200 |
| `getRateLimitGetRateLimit` | GET | `/rate-limit` | 200 |
| `getLessonsSearchByTextSimilarity` | GET | `/search/lessons` | 200 |
| `searchTranscriptsSearchTranscripts` | GET | `/search/transcripts` | 200 |
| `getSequencesGetSubjectSequence` | GET | `/sequences/{sequence}` | 200 |
| `getAssetsGetSequenceAssets` | GET | `/sequences/{sequence}/assets` | 200 |
| `getQuestionsGetQuestionsForSequence` | GET | `/sequences/{sequence}/questions` | 200 |
| `getSequencesGetSequenceUnits` | GET | `/sequences/{sequence}/units` | 200 |
| `getSubjectsGetAllSubjects` | GET | `/subjects` | 200 |
| `getSubjectsGetSubject` | GET | `/subjects/{subject}` | 200 |
| `getSubjectsGetSubjectKeyStages` | GET | `/subjects/{subject}/key-stages` | 200 |
| `getAllProgrammesForSubjectGetAllProgrammesForSubject` | GET | `/subjects/{subject}/programmes` | 200 |
| `getSubjectsGetSubjectYears` | GET | `/subjects/{subject}/years` | 200 |
| `getThreadsGetAllThreads` | GET | `/threads` | 200 |
| `getThreadsGetThreadUnits` | GET | `/threads/{threadSlug}/units` | 200 |
| `getUnitsGetUnit` | GET | `/units/{unit}/summary` | 200 |

## Receiving the SDK

1. Save the three generated files with the selected source edition's licence and provenance.
2. Compare `SOURCE_EDITION`, `SOURCE_PROVENANCE` and `inventory.json` against the intended workbench edition.
3. Compile in the receiving application's actual TypeScript configuration. Open the retained published example in the workbench to inspect its original schema, response and provenance.
4. Make an explicitly selected live request only when the operator chooses to acquire new output. Retain its operation, arguments, observed source and complete result in the workbench.
5. Review a following edition as a separate source selection, preserving the existing results and migration decisions in the full workspace export.
