#![no_std]
#[allow(dead_code)]
#[path="../../common.rs"] pub mod common;
use common::*;
use soroban_sdk::{contract,contractimpl,contracttype,Address,Env,symbol_short};

#[contracttype]
#[derive(Clone)]
enum Key { Paused, Limit, Duration, Window, Caller(Address), Pauser(Address) }
#[contract]
pub struct RiskControlContract;
#[contractimpl]
impl RiskControlContract {
    pub fn __constructor(env:Env,admin:Address,deposit_limit:i128,window_seconds:u64) {
        nonnegative(&env,deposit_limit); need(&env,window_seconds>0,Error::InvalidConfig);
        initialize_admin(&env,&admin);
        env.storage().instance().set(&Key::Paused,&false);
        env.storage().instance().set(&Key::Limit,&deposit_limit);
        env.storage().instance().set(&Key::Duration,&window_seconds);
    }
    pub fn set_caller(env:Env,caller:Address,contract:Address,allowed:bool) {
        require_admin(&env,&caller); keep(&env,&Key::Caller(contract.clone()),&allowed);
        env.events().publish((symbol_short!("caller"),),(contract,allowed));
    }
    pub fn set_pauser(env:Env,caller:Address,pauser:Address,allowed:bool) {
        require_admin(&env,&caller); keep(&env,&Key::Pauser(pauser.clone()),&allowed);
        env.events().publish((symbol_short!("pauser"),),(pauser,allowed));
    }
    pub fn pause(env:Env,caller:Address) {
        caller.require_auth();
        let allowed:bool=env.storage().persistent().get(&Key::Pauser(caller.clone())).unwrap_or(false);
        need(&env,caller==admin(&env)||allowed,Error::Unauthorized); touch(&env);
        env.storage().instance().set(&Key::Paused,&true);
        env.events().publish((symbol_short!("pause"),),(caller,true));
    }
    pub fn unpause(env:Env,caller:Address) {
        require_admin(&env,&caller); env.storage().instance().set(&Key::Paused,&false);
        env.events().publish((symbol_short!("pause"),),(caller,false));
    }
    pub fn is_paused(env:Env)->bool { env.storage().instance().get(&Key::Paused).unwrap_or(false) }
    pub fn window(env:Env)->Window {
        let now=env.ledger().timestamp();
        let duration:u64=env.storage().instance().get(&Key::Duration).unwrap();
        let limit:i128=env.storage().instance().get(&Key::Limit).unwrap();
        if let Some(mut row)=env.storage().instance().get::<_,Window>(&Key::Window) {
            need(&env,now>=row.start,Error::InvalidTime);
            if now<row.end { row.limit=limit; return row; }
        }
        Window{start:now,end:now.checked_add(duration).unwrap_or_else(||soroban_sdk::panic_with_error!(&env,Error::Overflow)),volume:0,limit}
    }
    pub fn check_deposit(env:Env,caller:Address,amount:i128)->Window {
        caller.require_auth(); positive(&env,amount);
        let allowed:bool=env.storage().persistent().get(&Key::Caller(caller)).unwrap_or(false);
        need(&env,allowed,Error::Unauthorized); need(&env,!Self::is_paused(env.clone()),Error::Paused);
        let mut row=Self::window(env.clone()); row.volume=add(&env,row.volume,amount);
        need(&env,row.limit==0||row.volume<=row.limit,Error::LimitExceeded);
        env.storage().instance().set(&Key::Window,&row); touch(&env);
        env.events().publish((symbol_short!("deposit"),),row.clone()); row
    }
    pub fn set_deposit_limit(env:Env,caller:Address,limit:i128) {
        require_admin(&env,&caller); nonnegative(&env,limit);
        env.storage().instance().set(&Key::Limit,&limit);
        env.events().publish((symbol_short!("limit"),),(caller,limit));
    }
    pub fn get_admin(env:Env)->Address { admin(&env) }
    pub fn propose_admin(env:Env,caller:Address,next:Address) { common::propose_admin(&env,&caller,&next); }
    pub fn accept_admin(env:Env,caller:Address) { common::accept_admin(&env,&caller); }
}
