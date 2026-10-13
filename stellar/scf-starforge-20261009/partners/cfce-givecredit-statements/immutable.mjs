// MIT. Native ownership of plain JSON values; immutable subtrees are visited once.
const retained=new WeakSet();
export function isImmutableJSON(value){return value===null||typeof value!=='object'||retained.has(value);}
export function freezeJSON(value){
  if(value===null||typeof value!=='object'||retained.has(value))return value;
  const active=new Set();
  function visit(node,depth){
    if(node===null||typeof node!=='object'||retained.has(node))return;
    if(depth>512||active.has(node))throw new TypeError('Receive an acyclic JSON workspace.');
    const prototype=Object.getPrototypeOf(node);
    if(!Array.isArray(node)&&prototype!==Object.prototype&&prototype!==null)
      throw new TypeError('Native immutable workspaces require plain JSON objects and arrays.');
    active.add(node);
    for(const key of Object.keys(node)){
      const descriptor=Object.getOwnPropertyDescriptor(node,key);
      if(!descriptor||!Object.prototype.hasOwnProperty.call(descriptor,'value'))
        throw new TypeError('Native immutable workspaces require JSON data properties.');
      visit(descriptor.value,depth+1);
    }
    Object.freeze(node);retained.add(node);active.delete(node);
  }
  visit(value,0);return value;
}
