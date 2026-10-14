//! Principal MarketPool — virtual-reserve edition 1, accounting edition 3.
//! Exact PT/SY custody; virtual balances are pricing coefficients only.
#![no_std]
use soroban_sdk::{contract,contractclient,contracterror,contractimpl,contracttype,panic_with_error,symbol_short,token,Address,Env};
pub mod math;
use math::{CurveFrame,TradeQuote,LiquidityQuote};
#[path="../../accounting_math.rs"] mod accounting;
use accounting::{add,sub};
#[contracttype]
#[derive(Clone,Debug,Eq,PartialEq)]
pub struct MarketConfig{
 pub manager:Address,pub sy:Address,pub pt:Address,pub yt:Address,pub oracle:Address,
 pub permissioning:Address,pub underlying:Address,pub risk:Address,pub escrow:Address,
 pub protocol_receiver:Address,pub maturity:u64,pub anchor_apr:i128,pub strength:u32,pub fee_bps:u32,pub protocol_share_bps:u32,
}
#[contracttype]
#[derive(Clone,Debug,Eq,PartialEq)]
pub struct MarketState{
 pub reserve_pt:i128,pub reserve_sy:i128,pub fee_sy:i128,pub creator_sy:i128,
 pub lp_supply:i128,pub started_at:u64,pub paused:bool,
}
#[contracttype]
#[derive(Clone,Debug,Eq,PartialEq)]
pub struct RecoveryResult{pub shares:i128,pub pt:i128,pub sy:i128,pub underlying:i128}
#[contractclient(name="SyClient")]
pub trait Sy{
 fn underlying_address(e:Env)->Address;fn permissioning_address(e:Env)->Address;fn recovery_escrow(e:Env)->Address;
 fn exchange_rate(e:Env)->i128;fn balance_of(e:Env,account:Address)->i128;
 fn transfer(e:Env,from:Address,to:Address,amount:i128)->i128;
 fn withdraw(e:Env,from:Address,shares:i128,to:Address)->i128;
}
#[contractclient(name="PtClient")]
pub trait Pt{
 fn underlying_address(e:Env)->Address;fn permissioning_address(e:Env)->Address;fn recovery_escrow(e:Env)->Address;
 fn maturity(e:Env)->u64;fn minter(e:Env)->Address;fn balance(e:Env,account:Address)->i128;
 fn transfer(e:Env,from:Address,to:Address,amount:i128);
}
#[contractclient(name="YtClient")]
pub trait Yt{
 fn underlying_address(e:Env)->Address;fn permissioning_address(e:Env)->Address;fn oracle_address(e:Env)->Address;
 fn maturity(e:Env)->u64;fn minter(e:Env)->Address;fn accounting_edition(e:Env)->u32;
}
#[contractclient(name="ManagerClient")]
pub trait Manager{
 fn underlying_address(e:Env)->Address;fn maturity(e:Env)->u64;fn accounting_edition(e:Env)->u32;
 fn sy_wrapper_address(e:Env)->Address;fn pt_token_address(e:Env)->Address;fn yt_token_address(e:Env)->Address;
 fn oracle_address(e:Env)->Address;fn permissioning_address(e:Env)->Address;
}
#[contractclient(name="OracleClient")]
pub trait Oracle{fn get_reference_value(e:Env)->i128;fn is_fresh(e:Env,max_stale_seconds:u64)->bool;}
#[contractclient(name="PermClient")]
pub trait Perm{fn is_allowed(e:Env,account:Address)->bool;fn is_allowed_for_asset(e:Env,account:Address,asset:Address)->bool;}
#[contractclient(name="RiskClient")]
pub trait Risk{fn is_paused(e:Env)->bool;fn check_deposit(e:Env,caller:Address,amount:i128);}
#[contractclient(name="EscrowClient")]
pub trait Escrow{fn underlying_address(e:Env)->Address;}
#[contracterror]
#[derive(Copy,Clone,Debug,Eq,PartialEq)]
#[repr(u32)]
pub enum Error{
 Initialized=901,Missing=902,Unauthorized=903,Topology=904,Paused=905,Mature=906,Stale=907,
 Deadline=908,Slippage=909,Custody=910,Reentry=911,Balance=912,Invalid=913,
}
#[contracttype]
#[derive(Clone)]
enum Key{Config,State,Busy,Balance(Address)}
const TTL:u32=518_400;
#[contract]
pub struct MarketPoolContract;
fn config(e:&Env)->MarketConfig{e.storage().instance().get(&Key::Config).unwrap_or_else(||panic_with_error!(e,Error::Missing))}
fn state(e:&Env)->MarketState{e.storage().instance().get(&Key::State).unwrap_or_else(||panic_with_error!(e,Error::Missing))}
fn save(e:&Env,s:&MarketState){e.storage().instance().set(&Key::State,s);e.storage().instance().extend_ttl(TTL,TTL);}
fn balance(e:&Env,a:&Address)->i128{e.storage().persistent().get(&Key::Balance(a.clone())).unwrap_or(0)}
fn put_balance(e:&Env,a:&Address,n:i128){let k=Key::Balance(a.clone());e.storage().persistent().set(&k,&n);e.storage().persistent().extend_ttl(&k,TTL,TTL);}
fn enter(e:&Env){if e.storage().instance().get(&Key::Busy).unwrap_or(false){panic_with_error!(e,Error::Reentry)}e.storage().instance().set(&Key::Busy,&true);}
fn leave(e:&Env){e.storage().instance().set(&Key::Busy,&false);}
fn custody(e:&Env,c:&MarketConfig,s:&MarketState){
 let me=e.current_contract_address();
 if PtClient::new(e,&c.pt).balance(&me)<s.reserve_pt||SyClient::new(e,&c.sy).balance_of(&me)<add(e,s.reserve_sy,add(e,s.fee_sy,s.creator_sy)){panic_with_error!(e,Error::Custody)}
}
fn permitted(e:&Env,c:&MarketConfig,a:&Address){
 if !token::StellarAssetClient::new(e,&c.underlying).authorized(a)||!PermClient::new(e,&c.permissioning).is_allowed(a){panic_with_error!(e,Error::Unauthorized)}
}
fn lp_permitted(e:&Env,c:&MarketConfig,a:&Address){
 permitted(e,c,a);
 if !PermClient::new(e,&c.permissioning).is_allowed_for_asset(a,&e.current_contract_address()){panic_with_error!(e,Error::Unauthorized)}
}
fn deadline(e:&Env,d:u64){if e.ledger().timestamp()>d{panic_with_error!(e,Error::Deadline)}}
fn live(e:&Env,c:&MarketConfig,s:&MarketState){
 if s.paused||RiskClient::new(e,&c.risk).is_paused(){panic_with_error!(e,Error::Paused)}
 if e.ledger().timestamp()>=c.maturity{panic_with_error!(e,Error::Mature)}
 permitted(e,c,&e.current_contract_address());custody(e,c,s);
}
fn frame(e:&Env,c:&MarketConfig,s:&MarketState,lp:i128)->CurveFrame{
 let now=e.ledger().timestamp();
 let oracle=OracleClient::new(e,&c.oracle);
 if !oracle.is_fresh(&3600){panic_with_error!(e,Error::Stale)}
 math::frame(e,now,s.started_at,c.maturity,oracle.get_reference_value(),SyClient::new(e,&c.sy).exchange_rate(),c.anchor_apr,c.strength,lp)
}
fn take_pt(e:&Env,c:&MarketConfig,from:&Address,n:i128){
 if n==0{return}let t=PtClient::new(e,&c.pt);let me=e.current_contract_address();let before=t.balance(&me);
 t.transfer(from,&me,&n);if t.balance(&me)!=add(e,before,n){panic_with_error!(e,Error::Custody)}
}
fn take_sy(e:&Env,c:&MarketConfig,from:&Address,n:i128){
 if n==0{return}let t=SyClient::new(e,&c.sy);let me=e.current_contract_address();let before=t.balance_of(&me);
 if t.transfer(from,&me,&n)!=n||t.balance_of(&me)!=add(e,before,n){panic_with_error!(e,Error::Custody)}
}
fn pay(e:&Env,c:&MarketConfig,to:&Address,pt:i128,sy:i128){
 let me=e.current_contract_address();
 if pt>0{let t=PtClient::new(e,&c.pt);let before=t.balance(&me);let recipient=t.balance(to);t.transfer(&me,to,&pt);
 if t.balance(&me)!=sub(e,before,pt)||t.balance(to)!=add(e,recipient,pt){panic_with_error!(e,Error::Custody)}}
 if sy>0{let t=SyClient::new(e,&c.sy);let before=t.balance_of(&me);let recipient=t.balance_of(to);t.transfer(&me,to,&sy);
 if t.balance_of(&me)!=sub(e,before,sy)||t.balance_of(to)!=add(e,recipient,sy){panic_with_error!(e,Error::Custody)}}
}
#[contractimpl]
impl MarketPoolContract{
 pub fn initialize(e:Env,issuer:Address,c:MarketConfig){
  if e.storage().instance().has(&Key::Config){panic_with_error!(&e,Error::Initialized)}
  issuer.require_auth();c.protocol_receiver.require_auth();if token::StellarAssetClient::new(&e,&c.underlying).admin()!=issuer{panic_with_error!(&e,Error::Unauthorized)}
  let sy=SyClient::new(&e,&c.sy);let pt=PtClient::new(&e,&c.pt);let yt=YtClient::new(&e,&c.yt);let m=ManagerClient::new(&e,&c.manager);
  if c.sy==c.pt||c.sy==c.yt||c.pt==c.yt||c.fee_bps>1000||c.protocol_share_bps>10000||
  sy.underlying_address()!=c.underlying||sy.permissioning_address()!=c.permissioning||sy.recovery_escrow()!=c.escrow||
  pt.underlying_address()!=c.underlying||pt.permissioning_address()!=c.permissioning||pt.recovery_escrow()!=c.escrow||pt.maturity()!=c.maturity||pt.minter()!=c.manager||
  yt.underlying_address()!=c.underlying||yt.permissioning_address()!=c.permissioning||yt.oracle_address()!=c.oracle||yt.maturity()!=c.maturity||yt.minter()!=c.manager||yt.accounting_edition()!=3||
  m.underlying_address()!=c.underlying||m.maturity()!=c.maturity||m.accounting_edition()!=3||
  m.sy_wrapper_address()!=c.sy||m.pt_token_address()!=c.pt||m.yt_token_address()!=c.yt||m.oracle_address()!=c.oracle||m.permissioning_address()!=c.permissioning||
  EscrowClient::new(&e,&c.escrow).underlying_address()!=c.underlying{panic_with_error!(&e,Error::Topology)}
  let s=MarketState{reserve_pt:0,reserve_sy:0,fee_sy:0,creator_sy:0,lp_supply:0,started_at:e.ledger().timestamp(),paused:false};
  frame(&e,&c,&s,1);e.storage().instance().set(&Key::Config,&c);save(&e,&s);
  e.events().publish((symbol_short!("init"),),c);
 }
 pub fn configuration(e:Env)->MarketConfig{config(&e)}
 pub fn reserves(e:Env)->MarketState{state(&e)}
 pub fn market_edition(_e:Env)->u32{1}
 pub fn accounting_edition(_e:Env)->u32{3}
 pub fn underlying_address(e:Env)->Address{config(&e).underlying}
 pub fn recovery_escrow(e:Env)->Address{config(&e).escrow}
 pub fn manager_address(e:Env)->Address{config(&e).manager}
 pub fn balance(e:Env,account:Address)->i128{balance(&e,&account)}
 pub fn total_supply(e:Env)->i128{state(&e).lp_supply}
 pub fn decimals(_e:Env)->u32{4}
 pub fn curve(e:Env)->CurveFrame{let c=config(&e);let s=state(&e);live(&e,&c,&s);frame(&e,&c,&s,s.lp_supply)}
 pub fn quote_swap(e:Env,sy_in:bool,amount_in:i128)->TradeQuote{
  let c=config(&e);let s=state(&e);live(&e,&c,&s);
  math::quote(&e,s.reserve_pt,s.reserve_sy,s.lp_supply,frame(&e,&c,&s,s.lp_supply),sy_in,amount_in,c.fee_bps,c.protocol_share_bps)
 }
 pub fn quote_deposit(e:Env,max_pt:i128,max_sy:i128)->LiquidityQuote{
  let c=config(&e);let s=state(&e);live(&e,&c,&s);
  let q=math::deposit(&e,s.reserve_pt,s.reserve_sy,s.lp_supply,max_pt,max_sy);
  frame(&e,&c,&s,add(&e,s.lp_supply,q.shares));q
 }
 pub fn quote_withdrawal(e:Env,shares:i128)->LiquidityQuote{
  let s=state(&e);math::withdrawal(&e,s.reserve_pt,s.reserve_sy,s.lp_supply,shares)
 }
 pub fn swap(e:Env,from:Address,sy_in:bool,amount_in:i128,min_out:i128,expires:u64)->TradeQuote{
  from.require_auth();deadline(&e,expires);if min_out<0{panic_with_error!(&e,Error::Invalid)}enter(&e);
  let c=config(&e);let mut s=state(&e);live(&e,&c,&s);permitted(&e,&c,&from);
  let q=math::quote(&e,s.reserve_pt,s.reserve_sy,s.lp_supply,frame(&e,&c,&s,s.lp_supply),sy_in,amount_in,c.fee_bps,c.protocol_share_bps);
  if q.amount_out<min_out{panic_with_error!(&e,Error::Slippage)}
  if sy_in{take_sy(&e,&c,&from,amount_in);s.reserve_sy=add(&e,s.reserve_sy,amount_in-q.total_fee);s.fee_sy=add(&e,s.fee_sy,q.protocol_fee);s.creator_sy=add(&e,s.creator_sy,q.creator_fee);s.reserve_pt=sub(&e,s.reserve_pt,q.amount_out);pay(&e,&c,&from,q.amount_out,0);}
  else{take_pt(&e,&c,&from,amount_in);s.reserve_pt=add(&e,s.reserve_pt,amount_in);s.fee_sy=add(&e,s.fee_sy,q.protocol_fee);s.creator_sy=add(&e,s.creator_sy,q.creator_fee);s.reserve_sy=sub(&e,s.reserve_sy,q.gross_amount_out);pay(&e,&c,&from,0,q.amount_out);}
  math::bounded(&e,add(&e,s.fee_sy,s.creator_sy),math::MAX_REAL);
  save(&e,&s);custody(&e,&c,&s);leave(&e);e.events().publish((symbol_short!("swap"),), (from,q.clone()));q
 }
 pub fn add_liquidity(e:Env,from:Address,max_pt:i128,max_sy:i128,min_shares:i128,expires:u64)->LiquidityQuote{
  from.require_auth();deadline(&e,expires);if min_shares<0{panic_with_error!(&e,Error::Invalid)}enter(&e);
  let c=config(&e);let mut s=state(&e);live(&e,&c,&s);permitted(&e,&c,&from);
  let q=math::deposit(&e,s.reserve_pt,s.reserve_sy,s.lp_supply,max_pt,max_sy);
  if q.shares<min_shares{panic_with_error!(&e,Error::Slippage)}let f=frame(&e,&c,&s,add(&e,s.lp_supply,q.shares));
  lp_permitted(&e,&c,&from);let exposure=add(&e,accounting::ceil(&e,q.sy,f.sy_rate,math::SCALE),accounting::ceil(&e,q.pt,math::SCALE,f.oracle_rate));
  RiskClient::new(&e,&c.risk).check_deposit(&e.current_contract_address(),&exposure);
  take_pt(&e,&c,&from,q.pt);take_sy(&e,&c,&from,q.sy);
  s.reserve_pt=add(&e,s.reserve_pt,q.pt);s.reserve_sy=add(&e,s.reserve_sy,q.sy);s.lp_supply=add(&e,s.lp_supply,q.shares);
  put_balance(&e,&from,add(&e,balance(&e,&from),q.shares));save(&e,&s);custody(&e,&c,&s);leave(&e);
  e.events().publish((symbol_short!("deposit"),),(from,q.clone()));q
 }
 pub fn remove_liquidity(e:Env,from:Address,shares:i128,min_pt:i128,min_sy:i128,expires:u64)->LiquidityQuote{
  from.require_auth();deadline(&e,expires);if min_pt<0||min_sy<0{panic_with_error!(&e,Error::Invalid)}enter(&e);
  let c=config(&e);let mut s=state(&e);lp_permitted(&e,&c,&from);permitted(&e,&c,&e.current_contract_address());custody(&e,&c,&s);
  let q=math::withdrawal(&e,s.reserve_pt,s.reserve_sy,s.lp_supply,shares);
  if q.pt<min_pt||q.sy<min_sy{panic_with_error!(&e,Error::Slippage)}
  put_balance(&e,&from,sub(&e,balance(&e,&from),shares));s.lp_supply=sub(&e,s.lp_supply,shares);
  s.reserve_pt=sub(&e,s.reserve_pt,q.pt);s.reserve_sy=sub(&e,s.reserve_sy,q.sy);save(&e,&s);pay(&e,&c,&from,q.pt,q.sy);
  custody(&e,&c,&s);leave(&e);e.events().publish((symbol_short!("withdraw"),),(from,q.clone()));q
 }
 pub fn transfer(e:Env,from:Address,to:Address,amount:i128){
  from.require_auth();math::positive(&e,amount);enter(&e);let c=config(&e);lp_permitted(&e,&c,&from);lp_permitted(&e,&c,&to);
  put_balance(&e,&from,sub(&e,balance(&e,&from),amount));put_balance(&e,&to,add(&e,balance(&e,&to),amount));
  leave(&e);e.events().publish((symbol_short!("lp_xfer"),),(from,to,amount));
 }
 pub fn set_paused(e:Env,issuer:Address,paused:bool){
  issuer.require_auth();enter(&e);let c=config(&e);if token::StellarAssetClient::new(&e,&c.underlying).admin()!=issuer{panic_with_error!(&e,Error::Unauthorized)}
  let mut s=state(&e);s.paused=paused;save(&e,&s);leave(&e);
 }
 /// Creator fees belong to the CURRENT SAC admin, including after rotation.
 pub fn collect_creator_fees(e:Env,issuer:Address)->LiquidityQuote{
  issuer.require_auth();enter(&e);let c=config(&e);
  if token::StellarAssetClient::new(&e,&c.underlying).admin()!=issuer{panic_with_error!(&e,Error::Unauthorized)}
  permitted(&e,&c,&issuer);let mut s=state(&e);custody(&e,&c,&s);
  let q=LiquidityQuote{shares:0,pt:0,sy:s.creator_sy};s.creator_sy=0;save(&e,&s);pay(&e,&c,&issuer,q.pt,q.sy);
  custody(&e,&c,&s);leave(&e);e.events().publish((symbol_short!("creator"),),(issuer,q.clone()));q
 }
 /// Protocol receiver is co-authorized at initialization and immutable in v1.
 pub fn collect_protocol_fees(e:Env,receiver:Address)->LiquidityQuote{
  receiver.require_auth();enter(&e);let c=config(&e);
  if receiver!=c.protocol_receiver{panic_with_error!(&e,Error::Unauthorized)}
  permitted(&e,&c,&receiver);let mut s=state(&e);custody(&e,&c,&s);
  let q=LiquidityQuote{shares:0,pt:0,sy:s.fee_sy};s.fee_sy=0;save(&e,&s);pay(&e,&c,&receiver,q.pt,q.sy);
  custody(&e,&c,&s);leave(&e);e.events().publish((symbol_short!("protocol"),),(receiver,q.clone()));q
 }
 /// Only the fixed original escrow authenticates issuer/deauthorization.
 pub fn seize(e:Env,caller:Address,account:Address,shares:i128)->RecoveryResult{
  caller.require_auth();enter(&e);let c=config(&e);if caller!=c.escrow{panic_with_error!(&e,Error::Unauthorized)}
  let mut s=state(&e);custody(&e,&c,&s);let q=math::withdrawal(&e,s.reserve_pt,s.reserve_sy,s.lp_supply,shares);
  put_balance(&e,&account,sub(&e,balance(&e,&account),shares));s.lp_supply=sub(&e,s.lp_supply,shares);
  s.reserve_pt=sub(&e,s.reserve_pt,q.pt);s.reserve_sy=sub(&e,s.reserve_sy,q.sy);save(&e,&s);pay(&e,&c,&caller,q.pt,0);
  let underlying=if q.sy>0{
   let sy=SyClient::new(&e,&c.sy);let me=e.current_contract_address();
   let asset=token::Client::new(&e,&c.underlying);let before=sy.balance_of(&me);let received=asset.balance(&caller);
   let expected=accounting::floor(&e,q.sy,sy.exchange_rate(),math::SCALE);
   let amount=sy.withdraw(&me,&q.sy,&caller);
   if amount!=expected||sy.balance_of(&me)!=sub(&e,before,q.sy)||asset.balance(&caller)!=add(&e,received,amount){panic_with_error!(&e,Error::Custody)}
   amount
  }else{0};
  custody(&e,&c,&s);leave(&e);let result=RecoveryResult{shares,pt:q.pt,sy:q.sy,underlying};
  e.events().publish((symbol_short!("lp_seize"),),(account,result.clone()));result
 }
}
