#![no_std]
#[allow(dead_code)]
#[path="../../common.rs"] pub mod common;
use common::*;
use soroban_sdk::{contract,contractimpl,contracttype,Address,Env,symbol_short};

#[contracttype]
#[derive(Clone)]
enum Key { Account(Address), Asset(Address,Address) }

#[contract]
pub struct PermissioningContract;
#[contractimpl]
impl PermissioningContract {
    pub fn __constructor(env:Env,admin:Address) { initialize_admin(&env,&admin); }
    pub fn grant_account(env:Env,caller:Address,account:Address,valid_until:u64) {
        require_admin(&env,&caller); need(&env,valid_until>env.ledger().timestamp(),Error::InvalidTime);
        keep(&env,&Key::Account(account.clone()),&valid_until);
        env.events().publish((symbol_short!("account"),),(account,valid_until,true));
    }
    pub fn revoke_account(env:Env,caller:Address,account:Address) {
        require_admin(&env,&caller); keep(&env,&Key::Account(account.clone()),&0u64);
        env.events().publish((symbol_short!("account"),),(account,0u64,false));
    }
    pub fn grant_asset(env:Env,caller:Address,account:Address,asset:Address,valid_until:u64) {
        require_admin(&env,&caller); need(&env,valid_until>env.ledger().timestamp(),Error::InvalidTime);
        keep(&env,&Key::Asset(account.clone(),asset.clone()),&valid_until);
        env.events().publish((symbol_short!("asset"),),(account,asset,valid_until,true));
    }
    pub fn revoke_asset(env:Env,caller:Address,account:Address,asset:Address) {
        require_admin(&env,&caller); keep(&env,&Key::Asset(account.clone(),asset.clone()),&0u64);
        env.events().publish((symbol_short!("asset"),),(account,asset,0u64,false));
    }
    pub fn is_allowed(env:Env,account:Address)->bool {
        let expiry:u64=env.storage().persistent().get(&Key::Account(account)).unwrap_or(0);
        env.ledger().timestamp()<expiry
    }
    pub fn is_allowed_for_asset(env:Env,account:Address,asset:Address)->bool {
        let expiry:u64=env.storage().persistent().get(&Key::Asset(account,asset)).unwrap_or(0);
        env.ledger().timestamp()<expiry
    }
    pub fn get_admin(env:Env)->Address { admin(&env) }
    pub fn propose_admin(env:Env,caller:Address,next:Address) { common::propose_admin(&env,&caller,&next); }
    pub fn accept_admin(env:Env,caller:Address) { common::accept_admin(&env,&caller); }
}
