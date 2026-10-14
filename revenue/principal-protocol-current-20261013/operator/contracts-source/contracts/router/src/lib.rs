//! Atomic, noncustodial composition of the original accounting contracts.
//! Every asset stays with the authenticated user or original backing contracts.
#![no_std]
use soroban_sdk::{contract,contractclient,contracterror,contractimpl,contracttype,panic_with_error,symbol_short,token,Address,Env};
#[path="../../market_pool/src/math.rs"] pub mod math;
use math::{TradeQuote,LiquidityQuote};
#[contracttype]
#[derive(Clone,Debug,Eq,PartialEq)]
pub struct MarketConfig{
 pub manager:Address,pub sy:Address,pub pt:Address,pub yt:Address,pub oracle:Address,
 pub permissioning:Address,pub underlying:Address,pub risk:Address,pub escrow:Address,
 pub protocol_receiver:Address,pub maturity:u64,pub anchor_apr:i128,pub strength:u32,pub fee_bps:u32,pub protocol_share_bps:u32,
}

#[contractclient(name="MarketPoolContractClient")]
pub trait Pool{
 fn configuration(e:Env)->MarketConfig;fn market_edition(e:Env)->u32;fn accounting_edition(e:Env)->u32;
 fn quote_swap(e:Env,sy_in:bool,amount_in:i128)->TradeQuote;
 fn swap(e:Env,from:Address,sy_in:bool,amount_in:i128,min_out:i128,expires:u64)->TradeQuote;
 fn add_liquidity(e:Env,from:Address,max_pt:i128,max_sy:i128,min_shares:i128,expires:u64)->LiquidityQuote;
 fn remove_liquidity(e:Env,from:Address,shares:i128,min_pt:i128,min_sy:i128,expires:u64)->LiquidityQuote;
}
#[path="../../accounting_math.rs"] mod accounting;
#[contracttype]
#[derive(Clone,Debug,Eq,PartialEq)]
pub struct MintResult{pub pt_minted:i128,pub yt_minted:i128}
#[contracttype]
#[derive(Clone,Debug,Eq,PartialEq)]
pub struct RedeemResult{pub underlying_from_pt:i128,pub underlying_from_yt:i128}
#[contracttype]
#[derive(Clone,Debug,Eq,PartialEq)]
pub struct RoutedLiquidity{pub deposited_sy:i128,pub minted:MintResult,pub liquidity:LiquidityQuote}
#[contracttype]
#[derive(Clone,Debug,Eq,PartialEq)]
pub struct RoutedSwap{pub underlying:i128,pub trade:TradeQuote}
#[contracttype]
#[derive(Clone,Debug,Eq,PartialEq)]
pub struct RecombineQuote{
 pub amount:i128,pub sy_shares:i128,pub underlying_allowance:i128,pub underlying_value:i128,
 pub retained_rounding:i128,pub oracle_rate:i128,pub sy_rate:i128,pub inverse_index:i128,
 pub pending_yield:i128,pub reward_remainder:i128,pub sampled_at:u64,pub maturity:u64,
}
#[contracttype]
#[derive(Clone,Debug,Eq,PartialEq)]
pub struct RoutedRecombine{pub exit:RecombineQuote,pub underlying:i128}
#[contractclient(name="SyClient")]
pub trait Sy{fn deposit(e:Env,from:Address,amount:i128)->i128;fn withdraw(e:Env,from:Address,shares:i128,to:Address)->i128;}
#[contractclient(name="ManagerClient")]
pub trait Manager{
 fn mint(e:Env,from:Address,sy_shares:i128)->MintResult;
 fn recombination_edition(e:Env)->u32;
 fn preview_recombine(e:Env,from:Address,amount:i128)->RecombineQuote;
 fn recombine(e:Env,from:Address,amount:i128,min_sy:i128)->RecombineQuote;
 fn claim_yield(e:Env,from:Address)->i128;
 fn redeem(e:Env,from:Address,pt_amount:i128,yt_amount:i128)->RedeemResult;
}
#[contracterror]
#[derive(Copy,Clone,Debug,Eq,PartialEq)]
#[repr(u32)]
pub enum Error{Initialized=1001,Missing=1002,Unauthorized=1003,Deadline=1004,Slippage=1005,Invalid=1006}
#[contracttype]
#[derive(Clone)]
enum Key{Market}
#[contract]
pub struct RouterContract;
fn market(e:&Env)->Address{e.storage().instance().get(&Key::Market).unwrap_or_else(||panic_with_error!(e,Error::Missing))}
fn configuration(e:&Env)->MarketConfig{MarketPoolContractClient::new(e,&market(e)).configuration()}
fn authorized(e:&Env,from:&Address,expires:u64){
 from.require_auth();if e.ledger().timestamp()>expires{panic_with_error!(e,Error::Deadline)}
}
fn minimum(e:&Env,actual:i128,min:i128){if min<0||actual<min{panic_with_error!(e,Error::Slippage)}}
#[contractimpl]
impl RouterContract{
 pub fn initialize(e:Env,issuer:Address,pool:Address){
  if e.storage().instance().has(&Key::Market){panic_with_error!(&e,Error::Initialized)}
  issuer.require_auth();let p=MarketPoolContractClient::new(&e,&pool);let c=p.configuration();
  if p.market_edition()!=1||p.accounting_edition()!=3||token::StellarAssetClient::new(&e,&c.underlying).admin()!=issuer{panic_with_error!(&e,Error::Unauthorized)}
  e.storage().instance().set(&Key::Market,&pool);e.storage().instance().extend_ttl(518_400,518_400);
  e.events().publish((symbol_short!("init"),),pool);
 }
 pub fn market_address(e:Env)->Address{market(&e)}
 pub fn configuration(e:Env)->MarketConfig{configuration(&e)}
 pub fn router_edition(_e:Env)->u32{2}
 pub fn quote_swap(e:Env,sy_in:bool,amount_in:i128)->TradeQuote{MarketPoolContractClient::new(&e,&market(&e)).quote_swap(&sy_in,&amount_in)}
 pub fn tokenize(e:Env,from:Address,underlying:i128,min_pt:i128,min_yt:i128,expires:u64)->MintResult{
  authorized(&e,&from,expires);let c=configuration(&e);let shares=SyClient::new(&e,&c.sy).deposit(&from,&underlying);
  let out=ManagerClient::new(&e,&c.manager).mint(&from,&shares);minimum(&e,out.pt_minted,min_pt);minimum(&e,out.yt_minted,min_yt);
  e.events().publish((symbol_short!("tokenize"),),(from,underlying,out.clone()));out
 }
 pub fn swap_sy_for_pt(e:Env,from:Address,sy:i128,min_pt:i128,expires:u64)->TradeQuote{
  authorized(&e,&from,expires);MarketPoolContractClient::new(&e,&market(&e)).swap(&from,&true,&sy,&min_pt,&expires)
 }
 pub fn swap_pt_for_sy(e:Env,from:Address,pt:i128,min_sy:i128,expires:u64)->TradeQuote{
  authorized(&e,&from,expires);MarketPoolContractClient::new(&e,&market(&e)).swap(&from,&false,&pt,&min_sy,&expires)
 }
 pub fn buy_pt(e:Env,from:Address,underlying:i128,min_pt:i128,expires:u64)->RoutedSwap{
  authorized(&e,&from,expires);let c=configuration(&e);let sy=SyClient::new(&e,&c.sy).deposit(&from,&underlying);
  let trade=MarketPoolContractClient::new(&e,&market(&e)).swap(&from,&true,&sy,&min_pt,&expires);
  RoutedSwap{underlying,trade}
 }
 pub fn sell_pt(e:Env,from:Address,pt:i128,min_underlying:i128,expires:u64)->RoutedSwap{
  authorized(&e,&from,expires);let c=configuration(&e);let trade=MarketPoolContractClient::new(&e,&market(&e)).swap(&from,&false,&pt,&0,&expires);
  let underlying=SyClient::new(&e,&c.sy).withdraw(&from,&trade.amount_out,&from);minimum(&e,underlying,min_underlying);
  RoutedSwap{underlying,trade}
 }
 pub fn add_liquidity(e:Env,from:Address,max_pt:i128,max_sy:i128,min_shares:i128,expires:u64)->LiquidityQuote{
  authorized(&e,&from,expires);MarketPoolContractClient::new(&e,&market(&e)).add_liquidity(&from,&max_pt,&max_sy,&min_shares,&expires)
 }
 /// Explicit split, never a guessed optimum. Unused PT/SY and all YT stay with user.
 pub fn tokenize_liquidity(e:Env,from:Address,underlying:i128,sy_to_mint:i128,min_pt:i128,min_yt:i128,min_shares:i128,expires:u64)->RoutedLiquidity{
  authorized(&e,&from,expires);let c=configuration(&e);let deposited_sy=SyClient::new(&e,&c.sy).deposit(&from,&underlying);
  if sy_to_mint<=0||sy_to_mint>=deposited_sy{panic_with_error!(&e,Error::Invalid)}
  let minted=ManagerClient::new(&e,&c.manager).mint(&from,&sy_to_mint);minimum(&e,minted.pt_minted,min_pt);minimum(&e,minted.yt_minted,min_yt);
  let liquidity=MarketPoolContractClient::new(&e,&market(&e)).add_liquidity(&from,&minted.pt_minted,&(deposited_sy-sy_to_mint),&min_shares,&expires);
  RoutedLiquidity{deposited_sy,minted,liquidity}
 }
 pub fn remove_liquidity(e:Env,from:Address,shares:i128,min_pt:i128,min_sy:i128,expires:u64)->LiquidityQuote{
  authorized(&e,&from,expires);MarketPoolContractClient::new(&e,&market(&e)).remove_liquidity(&from,&shares,&min_pt,&min_sy,&expires)
 }
 /// Paired exit acts on the user's real balances; earned yield stays in original YT accounting.
 pub fn preview_recombine(e:Env,from:Address,amount:i128)->RecombineQuote{
  let m=ManagerClient::new(&e,&configuration(&e).manager);
  if m.recombination_edition()!=1{panic_with_error!(&e,Error::Invalid)}
  m.preview_recombine(&from,&amount)
 }
 pub fn recombine(e:Env,from:Address,amount:i128,min_sy:i128,expires:u64)->RecombineQuote{
  authorized(&e,&from,expires);let m=ManagerClient::new(&e,&configuration(&e).manager);
  if m.recombination_edition()!=1{panic_with_error!(&e,Error::Invalid)}
  let out=m.recombine(&from,&amount,&min_sy);minimum(&e,out.sy_shares,min_sy);out
 }
 pub fn recombine_underlying(e:Env,from:Address,amount:i128,min_underlying:i128,expires:u64)->RoutedRecombine{
  authorized(&e,&from,expires);let c=configuration(&e);let m=ManagerClient::new(&e,&c.manager);
  if m.recombination_edition()!=1{panic_with_error!(&e,Error::Invalid)}
  let exit=m.recombine(&from,&amount,&0);
  let before=token::Client::new(&e,&c.underlying).balance(&from);
  let underlying=SyClient::new(&e,&c.sy).withdraw(&from,&exit.sy_shares,&from);
  if underlying!=exit.underlying_value||token::Client::new(&e,&c.underlying).balance(&from)!=accounting::add(&e,before,underlying){
   panic_with_error!(&e,Error::Invalid)
  }
  minimum(&e,underlying,min_underlying);RoutedRecombine{exit,underlying}
 }
 pub fn claim_yield(e:Env,from:Address,min_underlying:i128,expires:u64)->i128{
  authorized(&e,&from,expires);let out=ManagerClient::new(&e,&configuration(&e).manager).claim_yield(&from);minimum(&e,out,min_underlying);out
 }
 pub fn redeem(e:Env,from:Address,pt:i128,yt:i128,min_underlying:i128,expires:u64)->RedeemResult{
  authorized(&e,&from,expires);let out=ManagerClient::new(&e,&configuration(&e).manager).redeem(&from,&pt,&yt);
  minimum(&e,accounting::add(&e,out.underlying_from_pt,out.underlying_from_yt),min_underlying);out
 }
}
