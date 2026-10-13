# Complete ECMAScript source in the connected host

`connected_esm.cjs` runs supplied JavaScript module source without deleting words that happen to look like module syntax. It uses the repository's existing original Acorn 8.19.0 at `vendor/acorn-source-closure/acorn.cjs`. There is no second parser distribution, package installation, source fetch or new CommonJS loader.

This repairs a real composer failure: a global replacement of `export ` removed the same word from a document string, changing a source-family ZIP. Anchoring the replacement to a line is also unsafe for multiline templates. This host parses the original module, changes actual syntax ranges and retains the complete input through `host.source(id)`.

## Use with a complete supplied source graph

```js
const {createConnectedModuleHost, commonJsNamespace} = require('./connected_esm.cjs');
const host = createConnectedModuleHost({
  modules: {
    'lib/counter.mjs': 'export let count=0;export function add(){count++}',
    'main.mjs': `import {count,add} from './lib/counter.mjs';
      add(); export const result=count;`
  },
  externals: {
    'node:crypto': commonJsNamespace(existingCryptoModule)
  },
  globals: {console: existingConsole}
});
const main = await host.import('main.mjs');
// main.result === 1
```

Source can be a path-to-string object, a Map, or descriptors `{source,type:'javascript',url}`. Descriptor source/type/url are copied at host construction. Changing the caller's descriptor later does not replace the retained module. A new source edition uses a new host. Repeated imports share evaluation and the same namespace.

The default resolver uses exact supplied identifiers and POSIX relative paths. It does not infer extensions, package exports, index files or network locations. A supplied `resolve(specifier,referrer)` can select the application's existing resolver. Bare names must resolve to supplied source or an explicit external. URL relative resolution uses the host's ordinary `URL` when available; a connected runtime without it can supply the existing application resolver.

An external is an object of explicitly named exports. `commonJsNamespace(value)` exposes the original CommonJS value as `default`; supply a second array of selected names to expose its live properties. The caller retains CommonJS module caching, dependency resolution and native capability ownership. The ESM host does not guess exports from text or execute `require`.

Explicit global names are selected at construction; their values remain live through the supplied object. Standard ambient JavaScript globals remain those of the executing runtime. Module namespaces expose sorted, immutable export keys and live getters.

## Module behavior

- Static default, named, namespace and side-effect imports, named/default exports, re-exports and star exports are linked before module bodies run.
- Star ambiguity is resolved by the ultimate binding identity. The same binding through two paths remains available; conflicting bindings are omitted and a direct request for them rejects.
- The parser identifies declarations and reference scope. Local shadowing, function parameter defaults, nested function arguments, imported bare calls and tags retain their relevant language behavior.
- Synchronous dependency bodies finish in depth-first source order. Actual top-level `await` and `for await` allow asynchronous sibling progress. Static cycles share completion for outside importers.
- Exported function declarations are instantiated before body evaluation; lexical declarations retain their temporal dead zones. Imported bindings remain live and reject assignment.
- `import.meta` has a null prototype, `url` and a resolver using the supplied module IDs. Dynamic `import()` uses the same retained graph and cache.
- JSON source uses `{type:'json',source:'...complete JSON...'}` and imports with `{type:'json'}` attributes. A top-level host import of a selected JSON entry is also supported.
- Parse/link errors precede application effects. Evaluation errors remain associated with the original module/component and are returned on later imports.

Complete originals, including strings, templates and comments, remain in `host.source(id)`. Compilation only changes module syntax and necessary references; reflection on a transformed function can show those changes. `host.describe()` gives selected IDs, dependency edges, export names, AST edit ranges and current module/component state without copying full sources or private data into a report.

This is an application source host for authorized code, not a security sandbox or a substitute for an installed Node/browser runtime. It executes in the caller's realm through Function constructors. Its namespaces use ordinary getter descriptors rather than native Module Namespace exotic descriptors. Direct `eval` requires a native module lexical environment and is rejected explicitly as `MODULE_DIRECT_EVAL`; indirect eval retains the ordinary runtime's behavior. Syntax outside the retained parser/runtime's supported language is reported at parse/compile time. As with native modules, a self-dependent asynchronous import can remain pending.

## Existing complete source-family composer

`connected_source_family.cjs` is the receiving adapter for the maintained native source-family composer and portable viewer. It executes the three full original ESM modules and receives the four original CommonJS dependencies through the caller's existing loader. Customer artifacts remain in their original private source package.

```js
const {createSourceFamilyReceiver} = require('./connected_source_family.cjs');
const receiver = await createSourceFamilyReceiver({
  files: originalPacket.files,
  loadCommonJS: ({id, source, sources}) => originalCommonJSHost.load({id, source, sources})
});
const selected = receiver.open(originalSourceFamilyInput);
const preview = receiver.render(originalSourceFamilyInput);
// selected keeps the original complete archives; preview is the original renderer output.
```

The callback receives complete retained source and must return the original CommonJS module value. Use the existing source/runtime loader; the illustrative callback name above does not install another loader. The adapter also exposes the original `prepareFamily`, `prepareFamilies` and `readFamily` operations with the maintained hash functions. ZIP, gzip, archive and hash renderer sources are bound from the same supplied edition.

For a connected V8 cell, receive Acorn and this CommonJS module with the existing loader, bind its single require to the exact retained Acorn export, and use the same API. The host does not need filesystem, process, Buffer or TextEncoder. Keep complete private customer source out of the public utility repository.

The initial consumer course reopened two original 25-member customer archives through the complete unchanged source-family reader, re-created each exact archive, and rendered the exact previously delivered HTML. The public repository contains the reusable host and receiving adapter; the full private fixtures and original customer Pages remain in their existing Slack cases. This course exercised the actual composer in connected V8; native installed receiving and rendered customer operation retain their original equipped owners.

## Focused local regression

```sh
node host/connected_esm_smoke.cjs
```

This single small course covers the observed source corruption, retained descriptors, live bindings and lexical scope, synchronous and asynchronous evaluation order, cycles, JSON imports, and errors before later effects. It is deliberately not registered as a GitHub Actions workflow. The existing JavaScript source-closure collector and its mixed-language collector owner remain unchanged.

## Parser and language references

- Existing original parser attribution: `vendor/acorn-source-closure/SOURCE.json` and `LICENSE`.
- [ECMAScript script and module semantics](https://tc39.es/ecma262/multipage/ecmascript-language-scripts-and-modules.html). The source host implements the behavior needed by the maintained connected application path; it is not a claim of complete ECMAScript engine conformance.

## Owner product inspection instruction

Follow the repository's current `AGENTS.md` and `docs/policies/rendered-product-inspection-policy.md` where present. Before presenting a customer app, preview, report or attachment as ready, open and operate the exact outgoing version and actually view the rendered result at relevant desktop and narrow widths, including important states, downloads and reopening. Fix the actual product. Source execution and exact output equality do not replace looking at a customer-facing result. Preserve the existing original receiver rather than starting duplicate browser courses.
