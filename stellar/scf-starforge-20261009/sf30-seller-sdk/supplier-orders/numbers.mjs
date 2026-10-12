// MIT. Exact openTRANS NUMBER arithmetic. Original XML lexemes remain in documents.
export class OrderNumberError extends RangeError {
  constructor(message) { super(message); this.code='ORDER_NUMBER_INVALID'; this.status=422; }
}
const syntax=/^([+-]?)(?:(\d+)(?:\.(\d*))?|\.(\d+))(?:[eE]([+-]?\d+))?$/;
const abs=n=>n<0n?-n:n;
function gcd(a,b){a=abs(a);b=abs(b);while(b){const r=a%b;a=b;b=r;}return a||1n;}
export function fraction(n,d=1n){
  if(typeof n!=='bigint'||typeof d!=='bigint'||d===0n)throw new OrderNumberError('An exact value needs an integer numerator and nonzero denominator.');
  if(d<0n){n=-n;d=-d;}const g=gcd(n,d);return{n:n/g,d:d/g};
}
export const ZERO=Object.freeze({n:0n,d:1n}), ONE=Object.freeze({n:1n,d:1n});
export function exact(value,label='Number'){
  if(value&&typeof value==='object'&&typeof value.n==='bigint'&&typeof value.d==='bigint')return fraction(value.n,value.d);
  if(typeof value!=='string'||value.length>10000)throw new OrderNumberError(label+' must be an exact numeric string of at most 10,000 characters.');
  const m=syntax.exec(value);if(!m)throw new OrderNumberError(label+' is not an openTRANS NUMBER.');
  const whole=m[2]??'0',tail=m[3]??m[4]??'', exponent=BigInt(m[5]??'0');
  if(exponent>10000n||exponent< -10000n)throw new OrderNumberError(label+' exponent exceeds the 10,000-place processing limit.');
  let n=BigInt(whole+tail);if(m[1]==='-')n=-n;
  const scale=BigInt(tail.length)-exponent;
  return scale>=0n?fraction(n,10n**scale):fraction(n*10n**(-scale));
}
export const add=(a,b)=>{a=exact(a);b=exact(b);return fraction(a.n*b.d+b.n*a.d,a.d*b.d);};
export const subtract=(a,b)=>{a=exact(a);b=exact(b);return fraction(a.n*b.d-b.n*a.d,a.d*b.d);};
export const multiply=(a,b)=>{a=exact(a);b=exact(b);return fraction(a.n*b.n,a.d*b.d);};
export const divide=(a,b)=>{a=exact(a);b=exact(b);if(b.n===0n)throw new OrderNumberError('The price quantity or divisor must be nonzero.');return fraction(a.n*b.d,a.d*b.n);};
export const compare=(a,b)=>{a=exact(a);b=exact(b);const n=a.n*b.d-b.n*a.d;return n<0n?-1:n>0n?1:0;};
export const negative=a=>{a=exact(a);return fraction(-a.n,a.d);};
export const absolute=a=>{a=exact(a);return fraction(abs(a.n),a.d);};
export const minimum=(a,b)=>compare(a,b)<=0?exact(a):exact(b);
export const maximum=(a,b)=>compare(a,b)>=0?exact(a):exact(b);
export function sum(values){let value=ZERO;for(const next of values)value=add(value,next);return value;}
export function decimal(value){
  const q=exact(value);let d=q.d,twos=0,fives=0;
  while(d%2n===0n){d/=2n;twos++;}while(d%5n===0n){d/=5n;fives++;}
  if(d!==1n)return null;
  const scale=Math.max(twos,fives),n=q.n*2n**BigInt(scale-twos)*5n**BigInt(scale-fives);
  const sign=n<0n?'-':'',digits=abs(n).toString().padStart(scale+1,'0');
  if(!scale)return sign+digits;
  const tail=digits.slice(-scale).replace(/0+$/,'');return sign+digits.slice(0,-scale)+(tail?'.'+tail:'');
}
export function exactText(value){const q=exact(value);return decimal(q)??q.n.toString()+'/'+q.d.toString();}
export function exactValue(value){const q=exact(value);return{numerator:q.n.toString(),denominator:q.d.toString(),decimal:decimal(q),text:exactText(q)};}
export function rounded(value,{scale,mode}={}){
  if(!Number.isSafeInteger(scale)||scale<0||scale>100||!['half-up','half-even','toward-zero'].includes(mode))
    throw new OrderNumberError('Choose an explicit rounding scale from 0 to 100 and half-up, half-even or toward-zero.');
  const q=exact(value),factor=10n**BigInt(scale),a=abs(q.n)*factor;
  let units=a/q.d;const rem=a%q.d;
  if(mode==='half-up'&&2n*rem>=q.d||mode==='half-even'&&(2n*rem>q.d||2n*rem===q.d&&units%2n===1n))units++;
  return fraction(q.n<0n?-units:units,factor);
}
export function lineValue(item){
  if(!item?.price||item.price.amount==null)return null;
  return divide(multiply(exact(item.price.amount,'Price amount'),exact(item.quantity,'Quantity')),exact(item.price.quantity??'1','Price quantity'));
}
export function moneyMatches(calculated,declared,policy){
  return compare(policy?rounded(calculated,policy):calculated,declared)===0;
}
