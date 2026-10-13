/** Focused lifecycle check: a late desk load must not reopen an old workspace. */
import assert from 'node:assert/strict';
import {createExtensionHost} from './extension_host.mjs';

class Node {
  constructor(tag='div') { this.tagName=tag;this.children=[];this.dataset={};this.attributes={};this.parentNode=null; }
  append(...nodes) { for(const node of nodes){node.parentNode=this;this.children.push(node);} }
  replaceChildren(...nodes) { for(const child of this.children)child.parentNode=null;this.children=[];this.append(...nodes); }
  insertBefore(node,next) { node.parentNode=this;const i=this.children.indexOf(next);if(i<0)this.children.push(node);else this.children.splice(i,0,node); }
  setAttribute(key,value) { this.attributes[key]=value; }
  getAttribute(key) { return this.attributes[key] ?? this[key] ?? null; }
  addEventListener() {}
  remove() { if(this.parentNode)this.parentNode.children=this.parentNode.children.filter(child=>child!==this);this.parentNode=null; }
  querySelectorAll(selector) {
    const values=this.children.flatMap(child=>[child,...child.querySelectorAll('*')]);
    if(selector==='[data-view]')return values.filter(node=>node.dataset.view);
    if(selector==='link[rel="stylesheet"]')return values.filter(node=>node.tagName==='link'&&node.rel==='stylesheet');
    return values;
  }
}
const nav=new Node('nav'),head=new Node('head'),content=new Node();
const doc={head,createElement:tag=>new Node(tag),querySelector:()=>nav,
  querySelectorAll:selector=>head.querySelectorAll(selector)};
let state={workspace_key:'first',data:{},tasks:[]};
let release;
const late=new Promise(resolve=>{release=resolve;});
const calls={mount:[],update:[],detach:0,dispatch:0};
const definition={
  id:'native-run-desk',title:'Native run desk',order:40,
  client:{module:'/web/run_workbench.mjs',factory:'attachRunWorkbench',
    requires:['getState','api'],styles:['/web/run_workbench.css'],
    view:{id:'run-desk',title:'Native run desk',after:'runs'},
    lifecycle:{mount:'mount',update:'update',detach:'detach'},
    action_prefixes:['run-desk-'],dispatch:'dispatch'}
};
const host=createExtensionHost({
  document:doc,navigationRoot:nav,getState:()=>state,toast:()=>{},
  api:async()=>({schema:'upstate.operator-extensions/v1',extensions:[
    definition,{...definition,id:'broken',client:{...definition.client,view:{id:'broken'},module:'https://other.invalid/desk.mjs'}}
  ],issues:[]}),
  importModule:async()=>{await late;return {attachRunWorkbench:()=>({
    mount:(_node,value)=>calls.mount.push(value.workspace_key),
    update:value=>calls.update.push(value.workspace_key),
    detach:()=>calls.detach++,
    dispatch:()=>{calls.dispatch++;return true;}
  })};}
});
await host.load();
assert.equal(host.hasView('run-desk'),true);
assert.equal(host.hasView('broken'),false);
assert.equal(host.diagnostics()[0].stage,'registration');
assert.equal(nav.children[0].dataset.view,'run-desk');
assert.equal(host.render('run-desk',content,state),true);
state={workspace_key:'second',data:{},tasks:[]};
host.update(state);
host.render('overview',content,state);
release();
for(let i=0;i<8;i++)await Promise.resolve();
assert.deepEqual(calls.mount,[]);
host.render('run-desk',content,state);
assert.deepEqual(calls.mount,['second']);
host.render('run-desk',content,state);
assert.equal(calls.mount.length,1);
state={...state,tasks:[{id:'one',state:'running'}]};
host.update(state);
assert.equal(calls.update.at(-1),'second');
assert.equal(calls.mount.length,1);
assert.equal(await host.dispatch({dataset:{action:'source-open'}}),false);
assert.equal(await host.dispatch({dataset:{action:'run-desk-refresh'}}),true);
assert.equal(calls.dispatch,1);
const pending=host.dispatch({dataset:{action:'run-desk-start'}});
state={workspace_key:'third',data:{},tasks:[]};
await pending;
assert.equal(calls.dispatch,1);
host.detach();
assert.ok(calls.detach>=1);
host.destroy();
assert.equal(nav.children.length,0);
console.log('Extension lifecycle check passed: delayed load, isolated failure, task refresh, dispatch and workspace switch.');
