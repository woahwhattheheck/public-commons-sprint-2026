#![no_std]
#[allow(dead_code)]
#[path="../../common.rs"] pub mod common;
use common::*;
use soroban_sdk::{contract,contractimpl,contracttype,token,Address,Env,symbol_short};

#[contracttype]
#[derive(Clone)]
enum Key { Config, Supply, Reserve, Balance(Address) }
#[contract]
pub struct SYWrapperContract;
#[contractimpl]
impl SYWrapperContract {
    pub fn __constructor(env:Env,config:WrapperConfig) {
        initialize_admin(&env,&config.admin);
        need(&env,token::Client::new(&env,&config.underlying).decimals()==7,Error::InvalidDecimals);
        need(&env,config.underlying!=env.current_contract_address(),Error::InvalidConfig);
        env.storage().instance().set(&Key::Config,&config);
        env.storage().instance().set(&Key::Supply,&0i128);
        env.storage().instance().set(&Key::Reserve,&0i128);
    }
    pub fn config(env:Env)->WrapperConfig {
        let mut c:WrapperConfig=env.storage().instance().get(&Key::Config).unwrap();
        c.admin=admin(&env); c
    }
    pub fn balance_of(env:Env,account:Address)->i128 {
        env.storage().persistent().get(&Key::Balance(account)).unwrap_or(0)
    }
    pub fn total_shares(env:Env)->i128 { env.storage().instance().get(&Key::Supply).unwrap_or(0) }
    pub fn reserve_underlying(env:Env)->i128 { env.storage().instance().get(&Key::Reserve).unwrap_or(0) }
    pub fn effective_reserve(env:Env)->i128 {
        core::cmp::min(Self::token_balance(env.clone()),Self::reserve_underlying(env))
    }
    pub fn token_balance(env:Env)->i128 {
        let c=Self::config(env.clone()); token::Client::new(&env,&c.underlying).balance(&env.current_contract_address())
    }
    pub fn total_underlying(env:Env)->i128 {
        if Self::total_shares(env.clone())==0 { return 0; }
        let raw=Self::token_balance(env.clone()); let reserve=Self::reserve_underlying(env.clone());
        if raw>reserve { raw-reserve } else { 0 }
    }
    pub fn preview_deposit(env:Env,amount:i128)->i128 {
        positive(&env,amount); let total=Self::total_shares(env.clone());
        if total==0 { amount } else {
            let backing=Self::total_underlying(env.clone()); positive(&env,backing);
            mul_div(&env,amount,total,backing)
        }
    }
    pub fn preview_withdraw(env:Env,shares:i128)->i128 {
        nonnegative(&env,shares); let total=Self::total_shares(env.clone());
        need(&env,shares<=total,Error::InsufficientBalance);
        if shares==0 { 0 } else { mul_div(&env,shares,Self::total_underlying(env.clone()),total) }
    }
    pub fn deposit(env:Env,from:Address,amount:i128,min_shares:i128)->i128 {
        from.require_auth(); positive(&env,amount); nonnegative(&env,min_shares);
        let c=Self::config(env.clone()); let here=env.current_contract_address();
        active(&env,&c.risk_control); permitted(&env,&c.permissioning,&c.underlying,&from);
        permitted(&env,&c.permissioning,&c.underlying,&here);
        let token=token::Client::new(&env,&c.underlying);
        let before=token.balance(&here); let total=Self::total_shares(env.clone());
        let backing=Self::total_underlying(env.clone());
        // Unowned donations at zero supply cannot be captured by a first depositor
        // or permanently block it. They are excluded, visibly, from share backing.
        if total==0 { env.storage().instance().set(&Key::Reserve,&before); }
        else { positive(&env,backing); }
        token.transfer(&from,&here,&amount);
        let delta=sub(&env,token.balance(&here),before);
        need(&env,delta==amount,Error::BackingMismatch);
        let shares=if total==0 { delta } else { mul_div(&env,delta,total,backing) };
        positive(&env,shares); need(&env,shares>=min_shares,Error::Slippage);
        RiskClient::new(&env,&c.risk_control).check_deposit(&here,&delta);
        let key=Key::Balance(from.clone()); let previous=Self::balance_of(env.clone(),from.clone());
        keep(&env,&key,&add(&env,previous,shares));
        env.storage().instance().set(&Key::Supply,&add(&env,total,shares));
        env.events().publish((symbol_short!("deposit"),),(from,delta,shares)); shares
    }
    pub fn transfer_shares(env:Env,from:Address,to:Address,shares:i128) {
        from.require_auth(); positive(&env,shares);
        let c=Self::config(env.clone()); active(&env,&c.risk_control);
        permitted(&env,&c.permissioning,&c.underlying,&from);
        permitted(&env,&c.permissioning,&c.underlying,&to);
        permitted(&env,&c.permissioning,&c.underlying,&env.current_contract_address());
        let balance=Self::balance_of(env.clone(),from.clone());
        need(&env,balance>=shares,Error::InsufficientBalance);
        if from!=to {
            let other=Self::balance_of(env.clone(),to.clone());
            keep(&env,&Key::Balance(from.clone()),&(balance-shares));
            keep(&env,&Key::Balance(to.clone()),&add(&env,other,shares));
        }
        env.events().publish((symbol_short!("transfer"),),(from,to,shares));
    }
    pub fn withdraw(env:Env,from:Address,shares:i128,to:Address,min_underlying:i128)->i128 {
        from.require_auth(); positive(&env,shares); nonnegative(&env,min_underlying);
        let c=Self::config(env.clone()); let here=env.current_contract_address();
        need(&env,to!=here,Error::InvalidConfig); active(&env,&c.risk_control);
        permitted(&env,&c.permissioning,&c.underlying,&from);
        permitted(&env,&c.permissioning,&c.underlying,&to);
        permitted(&env,&c.permissioning,&c.underlying,&here);
        let balance=Self::balance_of(env.clone(),from.clone());
        need(&env,balance>=shares,Error::InsufficientBalance);
        let total=Self::total_shares(env.clone());
        let backing=Self::total_underlying(env.clone()); let amount=mul_div(&env,shares,backing,total);
        need(&env,amount>=min_underlying,Error::Slippage);
        // Zero backing is an explicit loss. A caller may burn shares with min=0.
        // This permits settlement to record a complete principal shortfall.
        keep(&env,&Key::Balance(from.clone()),&(balance-shares));
        env.storage().instance().set(&Key::Supply,&(total-shares));
        let token=token::Client::new(&env,&c.underlying);
        let before=token.balance(&here); let receiver_before=token.balance(&to);
        if amount>0 { token.transfer(&here,&to,&amount); }
        need(&env,before-token.balance(&here)==amount&&token.balance(&to)-receiver_before==amount,Error::BackingMismatch);
        env.events().publish((symbol_short!("withdraw"),),(from,to,shares,amount)); amount
    }
    pub fn get_admin(env:Env)->Address { admin(&env) }
    pub fn propose_admin(env:Env,caller:Address,next:Address) { common::propose_admin(&env,&caller,&next); }
    pub fn accept_admin(env:Env,caller:Address) { common::accept_admin(&env,&caller); }
}
