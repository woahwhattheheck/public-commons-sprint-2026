//! Shared exact arithmetic, wire types and cross-contract clients for the reference integration.
//! All token amounts, prices and claims use seven decimal places.
use soroban_sdk::{contractclient, contracterror, contracttype, panic_with_error, Address, BytesN, Env, IntoVal, U256, Val};

pub const SCALE: i128 = 10_000_000;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum Error {
    Unauthorized=101, InvalidAmount=102, Overflow=103, InvalidConfig=104,
    PermissionDenied=105, Paused=106, LimitExceeded=107, Missing=108,
    OracleStale=109, InvalidTime=110, Maturity=111, Duplicate=112,
    InsufficientBalance=113, Slippage=114, BackingMismatch=115,
    Settled=116, NotSettled=117, NoSample=118, Insolvent=119,
    InvalidDecimals=120, EmptySharesWithBacking=121,
}
#[contracttype]
#[derive(Clone)]
pub enum AdminKey { Admin, PendingAdmin }

pub fn need(env: &Env, ok: bool, error: Error) {
    if !ok { panic_with_error!(env, error); }
}
pub fn positive(env: &Env, amount: i128) { need(env, amount > 0, Error::InvalidAmount); }
pub fn nonnegative(env: &Env, amount: i128) { need(env, amount >= 0, Error::InvalidAmount); }
pub fn add(env: &Env, a:i128, b:i128)->i128 {
    a.checked_add(b).unwrap_or_else(||panic_with_error!(env,Error::Overflow))
}
pub fn sub(env: &Env, a:i128, b:i128)->i128 {
    a.checked_sub(b).unwrap_or_else(||panic_with_error!(env,Error::Overflow))
}
pub fn mul_div(env:&Env,a:i128,b:i128,d:i128)->i128 {
    nonnegative(env,a); nonnegative(env,b); positive(env,d);
    let v=U256::from_u128(env,a as u128).mul(&U256::from_u128(env,b as u128))
        .div(&U256::from_u128(env,d as u128)).to_u128()
        .unwrap_or_else(||panic_with_error!(env,Error::Overflow));
    need(env,v <= i128::MAX as u128,Error::Overflow); v as i128
}
pub fn mul_div_capped(env:&Env,a:i128,b:i128,d:i128,cap:i128)->i128 {
    nonnegative(env,a); nonnegative(env,b); positive(env,d); nonnegative(env,cap);
    let value=U256::from_u128(env,a as u128).mul(&U256::from_u128(env,b as u128))
        .div(&U256::from_u128(env,d as u128));
    if value>=U256::from_u128(env,cap as u128) { cap }
    else { value.to_u128().unwrap_or_else(||panic_with_error!(env,Error::Overflow)) as i128 }
}
pub fn mul_rem(env:&Env,a:i128,b:i128,d:i128)->i128 {
    nonnegative(env,a); nonnegative(env,b); positive(env,d);
    U256::from_u128(env,a as u128).mul(&U256::from_u128(env,b as u128))
        .rem_euclid(&U256::from_u128(env,d as u128)).to_u128()
        .unwrap_or_else(||panic_with_error!(env,Error::Overflow)) as i128
}
pub fn touch(env:&Env) {
    let target=core::cmp::min(env.storage().max_ttl(),100_000);
    env.storage().instance().extend_ttl(target/2,target);
}
pub fn keep<K:IntoVal<Env,Val>,V:IntoVal<Env,Val>>(env:&Env,key:&K,value:&V) {
    env.storage().persistent().set(key,value);
    let target=core::cmp::min(env.storage().max_ttl(),100_000);
    env.storage().persistent().extend_ttl(key,target/2,target);
}
pub fn initialize_admin(env:&Env,admin:&Address) {
    admin.require_auth();
    env.storage().instance().set(&AdminKey::Admin,admin); touch(env);
}
pub fn admin(env:&Env)->Address {
    env.storage().instance().get(&AdminKey::Admin).unwrap_or_else(||panic_with_error!(env,Error::Missing))
}
pub fn require_admin(env:&Env,caller:&Address) {
    caller.require_auth(); need(env,*caller==admin(env),Error::Unauthorized); touch(env);
}
pub fn propose_admin(env:&Env,caller:&Address,next:&Address) {
    require_admin(env,caller); need(env,*next!=env.current_contract_address(),Error::InvalidConfig);
    env.storage().instance().set(&AdminKey::PendingAdmin,next);
}
pub fn accept_admin(env:&Env,caller:&Address) {
    caller.require_auth();
    let pending:Option<Address>=env.storage().instance().get(&AdminKey::PendingAdmin);
    need(env,pending==Some(caller.clone()),Error::Unauthorized);
    env.storage().instance().set(&AdminKey::Admin,caller);
    env.storage().instance().remove(&AdminKey::PendingAdmin); touch(env);
}
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Sample {
    pub sequence:u64, pub value:i128, pub timestamp:u64, pub observed_at:u64, pub source_id:BytesN<32>,
}
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Window { pub start:u64, pub end:u64, pub volume:i128, pub limit:i128 }
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct WrapperConfig { pub admin:Address, pub underlying:Address, pub permissioning:Address, pub risk_control:Address }
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ManagerConfig {
    pub admin:Address, pub sy_wrapper:Address, pub oracle:Address,
    pub permissioning:Address, pub risk_control:Address,
    pub maturity_timestamp:u64, pub max_stale_seconds:u64, pub settlement_window_seconds:u64,
}
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Balances { pub pt:i128, pub yt:i128 }
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Issue {
    pub id:u64, pub issue_nonce:u64, pub issuer:Address, pub issued_at:u64, pub maturity_timestamp:u64,
    pub entry_sample:Sample, pub initial_shares:i128, pub entry_underlying:i128, pub initial_claims:i128,
    pub recombined_claims:i128, pub returned_shares:i128, pub locked_shares:i128,
    pub settled:bool, pub settled_at:u64, pub settlement_sample:Option<Sample>, pub settlement_claims:i128,
    pub backing_underlying:i128, pub pt_budget:i128, pub yt_budget:i128, pub principal_shortfall:i128,
    pub rounding_numerator:i128, pub pt_redeemed:i128, pub yt_redeemed:i128,
    pub pt_paid:i128, pub yt_paid:i128, pub pt_supply:i128, pub yt_supply:i128,
}
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Payout {
    pub issue_id:u64, pub pt_burned:i128, pub yt_burned:i128,
    pub underlying_from_pt:i128, pub underlying_from_yt:i128, pub underlying_total:i128,
    pub pt_remaining:i128, pub yt_remaining:i128,
}
#[contractclient(name="PermissionClient")]
pub trait PermissionAPI {
    fn is_allowed(env:Env,account:Address)->bool;
    fn is_allowed_for_asset(env:Env,account:Address,asset:Address)->bool;
}
#[contractclient(name="RiskClient")]
pub trait RiskAPI {
    fn is_paused(env:Env)->bool;
    fn check_deposit(env:Env,caller:Address,amount:i128)->Window;
}
#[contractclient(name="OracleClient")]
pub trait OracleAPI {
    fn latest(env:Env)->Sample;
    fn first_at_or_after(env:Env,timestamp:u64)->Option<Sample>;
}
#[contractclient(name="WrapperClient")]
pub trait WrapperAPI {
    fn config(env:Env)->WrapperConfig;
    fn transfer_shares(env:Env,from:Address,to:Address,shares:i128);
    fn balance_of(env:Env,account:Address)->i128;
    fn total_shares(env:Env)->i128;
    fn total_underlying(env:Env)->i128;
    fn preview_withdraw(env:Env,shares:i128)->i128;
    fn withdraw(env:Env,from:Address,shares:i128,to:Address,min_underlying:i128)->i128;
}
pub fn permitted(env:&Env,permissioning:&Address,asset:&Address,account:&Address) {
    let p=PermissionClient::new(env,permissioning);
    need(env,p.is_allowed(account)&&p.is_allowed_for_asset(account,asset),Error::PermissionDenied);
}
pub fn active(env:&Env,risk:&Address) {
    need(env,!RiskClient::new(env,risk).is_paused(),Error::Paused); touch(env);
}
