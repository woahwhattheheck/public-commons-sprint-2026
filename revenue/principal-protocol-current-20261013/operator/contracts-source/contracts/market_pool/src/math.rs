//! Integer virtual-reserve market edition 1. All quantities are atomic units.
//! LP has four decimals; one initial LP atom represents 1000 deposited PT atoms.
//! Virtual balances are never transferable assets or withdrawal entitlements.
use soroban_sdk::{contracterror,contracttype,panic_with_error,Env};
#[path="../../accounting_math.rs"] mod accounting;
use accounting::{add,floor,ceil};
pub const SCALE:i128=10_000_000;
pub const YEAR:i128=31_536_000;
pub const LP_QUANTUM:i128=1_000;
pub const MAX_REAL:i128=1_000_000_000_000_000_000_000_000_000;
pub const MAX_VIRTUAL:i128=1_000_000_000_000_000_000_000_000_000_000_000_000;
pub const MAX_RATE:i128=1_000_000_000_000_000_000;
pub const MAX_COEFFICIENT:i128=1_000_000_000_000_000_000;
#[contracterror]
#[derive(Copy,Clone,Debug,Eq,PartialEq)]
#[repr(u32)]
pub enum MathError{Invalid=801,Range=802,NoOutput=803,InsufficientReserve=804}
#[contracttype]
#[derive(Clone,Debug,Eq,PartialEq)]
pub struct CurveFrame{
 pub sampled_at:u64,pub remaining:u64,pub oracle_rate:i128,pub sy_rate:i128,
 pub target_price:i128,pub pt_coefficient:i128,pub sy_coefficient:i128,
 pub virtual_pt:i128,pub virtual_sy:i128,
}
#[contracttype]
#[derive(Clone,Debug,Eq,PartialEq)]
pub struct TradeQuote{
 pub sy_in:bool,pub amount_in:i128,pub gross_amount_out:i128,pub amount_out:i128,pub fee_in_sy:bool,pub total_fee:i128,
 pub protocol_fee:i128,pub creator_fee:i128,pub fee_tier_bps:u32,pub reserve_pt:i128,pub reserve_sy:i128,
 pub lp_supply:i128,pub frame:CurveFrame,
}
pub fn bounded(e:&Env,n:i128,limit:i128)->i128{if n<0||n>limit{panic_with_error!(e,MathError::Range)}n}
pub fn positive(e:&Env,n:i128)->i128{if n<=0{panic_with_error!(e,MathError::Invalid)}bounded(e,n,MAX_REAL)}
pub fn frame(e:&Env,now:u64,start:u64,maturity:u64,oracle:i128,sy:i128,apr:i128,strength:u32,lp:i128)->CurveFrame{
 if now<start||now>=maturity||maturity<=start||maturity-start>10*YEAR as u64||
 oracle<=0||oracle>MAX_RATE||sy<=0||sy>MAX_RATE||apr<0||apr>SCALE||
 strength==0||strength>100||lp<=0{panic_with_error!(e,MathError::Invalid)}
 let remaining=maturity-now;
 // PT is original-rate notional: maturity underlying is PT*SCALE/oracle.
 // Floors are conservative and never invert the PT/SY quotation.
 let underlying_price=floor(e,SCALE,SCALE,oracle);
 let sy_price=floor(e,underlying_price,SCALE,sy);
 let discount=add(e,SCALE,ceil(e,apr,remaining as i128,YEAR));
 let target=floor(e,sy_price,SCALE,discount);
 if target<=0{panic_with_error!(e,MathError::Range)}
 // Coefficients, not virtual balances, are rounded. LP scaling is EXACT.
 let a=bounded(e,floor(e,LP_QUANTUM*strength as i128,(maturity-start) as i128,remaining as i128),MAX_COEFFICIENT);
 let b=bounded(e,floor(e,a,target,SCALE),MAX_COEFFICIENT);
 if a==0||b==0{panic_with_error!(e,MathError::Range)}
 let vp=bounded(e,floor(e,lp,a,1),MAX_VIRTUAL);
 let vs=bounded(e,floor(e,lp,b,1),MAX_VIRTUAL);
 CurveFrame{sampled_at:now,remaining,oracle_rate:oracle,sy_rate:sy,target_price:target,pt_coefficient:a,sy_coefficient:b,virtual_pt:vp,virtual_sy:vs}
}
pub fn quote(e:&Env,p:i128,s:i128,lp:i128,f:CurveFrame,sy_in:bool,gross:i128,fee_bps:u32,protocol_share_bps:u32)->TradeQuote{
 positive(e,p);positive(e,s);positive(e,lp);positive(e,gross);
 if fee_bps>1000||protocol_share_bps>10_000{panic_with_error!(e,MathError::Invalid)}
 let time_numerator=fee_bps as i128*f.remaining as i128;
 let (real_in,real_out,virtual_in,virtual_out)=if sy_in{(s,p,f.virtual_sy,f.virtual_pt)}else{(p,s,f.virtual_pt,f.virtual_sy)};
 let x=add(e,real_in,virtual_in);let y=add(e,real_out,virtual_out);
 // Original fee asset is SY in BOTH directions. Buy fee is on SY input;
 // sell fee is on gross SY output. Round only the final SY fee, once.
 let input_fee=if sy_in{ceil(e,gross,time_numerator,10_000*YEAR)}else{0};
 if input_fee>=gross{panic_with_error!(e,MathError::NoOutput)}
 let net_input=gross-input_fee;
 let gross_out=floor(e,net_input,y,add(e,x,net_input));
 let fee=if sy_in{input_fee}else{ceil(e,gross_out,time_numerator,10_000*YEAR)};
 let out=if sy_in{gross_out}else{
  if fee>=gross_out{panic_with_error!(e,MathError::NoOutput)}gross_out-fee
 };
 if out<=0{panic_with_error!(e,MathError::NoOutput)}
 if gross_out>=real_out{panic_with_error!(e,MathError::InsufficientReserve)}
 bounded(e,add(e,real_in,net_input),MAX_REAL);
 let protocol=floor(e,fee,protocol_share_bps as i128,10_000);
 TradeQuote{sy_in,amount_in:gross,gross_amount_out:gross_out,amount_out:out,fee_in_sy:true,total_fee:fee,protocol_fee:protocol,creator_fee:fee-protocol,fee_tier_bps:fee_bps,reserve_pt:p,reserve_sy:s,lp_supply:lp,frame:f}
}
#[contracttype]
#[derive(Clone,Debug,Eq,PartialEq)]
pub struct LiquidityQuote{pub shares:i128,pub pt:i128,pub sy:i128}
pub fn deposit(e:&Env,p:i128,s:i128,lp:i128,max_pt:i128,max_sy:i128)->LiquidityQuote{
 positive(e,max_pt);positive(e,max_sy);
 let (shares,pt,sy)=if lp==0{
  if p!=0||s!=0{panic_with_error!(e,MathError::Invalid)}
  (max_pt/LP_QUANTUM,max_pt,max_sy)
 }else{
  positive(e,p);positive(e,s);positive(e,lp);
  let shares=core::cmp::min(floor(e,max_pt,lp,p),floor(e,max_sy,lp,s));
  (shares,ceil(e,shares,p,lp),ceil(e,shares,s,lp))
 };
 positive(e,shares);bounded(e,add(e,lp,shares),MAX_REAL);
 bounded(e,add(e,p,pt),MAX_REAL);bounded(e,add(e,s,sy),MAX_REAL);
 LiquidityQuote{shares,pt,sy}
}
pub fn withdrawal(e:&Env,p:i128,s:i128,lp:i128,shares:i128)->LiquidityQuote{
 positive(e,shares);positive(e,lp);if shares>lp{panic_with_error!(e,MathError::Invalid)}
 LiquidityQuote{shares,pt:floor(e,shares,p,lp),sy:floor(e,shares,s,lp)}
}
