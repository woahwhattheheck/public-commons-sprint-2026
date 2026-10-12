// MIT. Numeric type metadata for explicit native xChange product corrections.
import { XCHANGE_PRODUCT_SCHEMA,validNumberToken,pointerPart,object } from './schema.mjs';
import { WorkspaceError } from '../../../workspace/store.mjs';
const starts=(path,parent)=>path===parent||path.startsWith(parent+'/');
export function reconcileXChangeCorrectionNumbers(base,result,patches){
  if(base?.xChange?.schema!=='stellar-forge.xchange-product.v1')return result;
  for(const patch of patches)if(!starts(patch.path,'/xChange/product')&&!starts(patch.path,'/xChange/numberTokens'))throw new WorkspaceError('XCHANGE_CORRECTION_SOURCE_IMMUTABLE','Correct native product fields and their numeric tokens. Catalogue/supplier headers use versioned profile overrides; retained source identity stays unchanged.',422);
  if(!object(result?.xChange?.product))return result;
  const changed=patches.map(p=>p.path).filter(path=>starts(path,'/xChange/product')||starts('/xChange/product',path));
  if(!changed.length)return result;
  const explicitMetadata=patches.some(p=>starts(p.path,'/xChange/numberTokens')||starts('/xChange/numberTokens',p.path)&&!starts('/xChange/product',p.path));
  if(explicitMetadata)return result;
  const tokens={...(result.xChange.numberTokens??{})};
  for(const path of Object.keys(tokens))if(changed.some(p=>starts('/xChange/product'+path,p)||starts(p,'/xChange/product'+path)))delete tokens[path];
  const visit=(v,s,path)=>{
    const nativePath='/xChange/product'+path,touched=changed.some(p=>starts(nativePath,p)||starts(p,nativePath));
    if(!touched)return;
    if(s.type==='number'||s.type==='integer'){
      if(typeof v==='string'&&validNumberToken(v))tokens[path]=v;
      return;
    }
    if(s.type==='object'&&object(v)){for(const[k,child]of Object.entries(s.properties??{}))if(Object.hasOwn(v,k))visit(v[k],child,path+'/'+pointerPart(k));}
    else if(s.type==='array'&&Array.isArray(v)){for(let i=0;i<v.length;i++)visit(v[i],s.items,path+'/'+i);}
  };
  visit(result.xChange.product,XCHANGE_PRODUCT_SCHEMA,'');
  result.xChange.numberTokens=tokens;return result;
}
