'use strict';
const assert = require('node:assert/strict');
const {createConnectedModuleHost} = require('./connected_esm.cjs');

async function run() {
  const make = (modules, globals) => createConnectedModuleHost({modules, globals});
  const source = {source: "export const text='original';"};
  const retained = make({'main.mjs': source});
  source.source = "export const text='replacement';";
  assert.equal((await retained.import('main.mjs')).text, 'original');

  const live = make({
    'a.mjs': "export let value=1;export function increment(){value++}export function context(){return this}",
    'main.mjs': [
      "import {value,increment,context} from './a.mjs';",
      'export const before=value;increment();export const after=value;',
      'export const called=context(), tagged=context\`tag\`;',
      'export const args=(()=>typeof arguments)(), scopeLeak=typeof scope;',
      'export const literal=\`first\\nexport this is a document\\nimport("unchanged")\`;',
      'export function defaults(x=context()){var context=7;return [x,arguments.length]}',
      'export let selected;switch(context()===undefined?1:2){case 1:let context=()=>3;selected=1;}',
      'export default class {static title=this.name;}'
    ].join('\n')
  });
  const output = await live.import('main.mjs');
  assert.deepEqual([output.before, output.after, output.called, output.tagged], [1, 2, undefined, undefined]);
  assert.deepEqual([output.args, output.scopeLeak, output.selected], ['undefined', 'undefined', 1]);
  assert.deepEqual(output.defaults(), [undefined, 0]);
  assert.equal(output.default.title, 'default');
  assert.equal(output.literal, 'first\nexport this is a document\nimport("unchanged")');

  const order = [];
  await make({
    'main.mjs': "import './a.mjs';import './b.mjs';",
    'a.mjs': "import './x.mjs';log.push('a');",
    'x.mjs': "log.push('x');", 'b.mjs': "log.push('b');"
  }, {log: order}).import('main.mjs');
  assert.deepEqual(order, ['x', 'a', 'b']);

  const asyncOrder = [];
  let release;
  const signal = new Promise(resolve => {release = resolve;});
  await make({
    'main.mjs': "import './a.mjs';import './b.mjs';log.push('main');",
    'a.mjs': "import './x.mjs';log.push('a');",
    'x.mjs': "log.push('x:start');await signal;log.push('x:done');",
    'b.mjs': "log.push('b');release();"
  }, {log: asyncOrder, signal, release}).import('main.mjs');
  assert.deepEqual(asyncOrder, ['x:start', 'b', 'x:done', 'a', 'main']);

  const cycle = make({
    'a.mjs': "import {b} from './b.mjs';export function a(){return 'a'};export const text=b();",
    'b.mjs': "import {a} from './a.mjs';export function b(){return a()+'b'};",
    'main.mjs': "export {text} from './a.mjs';export * as b from './b.mjs';"
  });
  const cyclic = await cycle.import('main.mjs');
  assert.equal(cyclic.text, 'ab'); assert.equal(cyclic.b.b(), 'ab');

  const dynamic = make({
    'data.json': {type: 'json', source: '{"value":7}'},
    'main.mjs': "import data from './data.json' with {type:'json'};export const same=data===(await import('./data.json',{with:{type:'json'}})).default;export const url=import.meta.url;"
  });
  const json = await dynamic.import('main.mjs');
  assert.equal(json.same, true); assert.equal(json.url, 'main.mjs');

  const effects = [];
  await assert.rejects(make({
    'main.mjs': "import {missing} from './dep.mjs';effects.push('main');",
    'dep.mjs': "effects.push('dep');export const other=1;"
  }, {effects}).import('main.mjs'), {code: 'MODULE_EXPORT'});
  assert.deepEqual(effects, []);
  await assert.rejects(make({
    'main.mjs': "import './a.mjs';import './b.mjs';",
    'a.mjs': "throw new Error('initialization failed');",
    'b.mjs': "effects.push('later');"
  }, {effects}).import('main.mjs'), /initialization failed/);
  assert.deepEqual(effects, []);
  return {passed: true, course: 'retained source, live imports, lexical scope, sync/async ordering, cycles, JSON and failures'};
}
module.exports = {run};
if (require.main === module) run().then(result => console.log(JSON.stringify(result)))
  .catch(error => {console.error(error);process.exitCode = 1;});
