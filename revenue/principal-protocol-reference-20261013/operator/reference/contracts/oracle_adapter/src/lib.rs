#![no_std]
#[allow(dead_code)]
#[path="../../common.rs"] pub mod common;
use common::*;
use soroban_sdk::{contract,contractimpl,contracttype,Address,BytesN,Env,symbol_short};

#[contracttype]
#[derive(Clone)]
enum Key { Count, MaxDelay, Sample(u64) }
#[contract]
pub struct OracleAdapterContract;
#[contractimpl]
impl OracleAdapterContract {
    pub fn __constructor(env:Env,admin:Address,max_submission_delay:u64) {
        need(&env,max_submission_delay>0,Error::InvalidConfig);
        initialize_admin(&env,&admin);
        env.storage().instance().set(&Key::Count,&0u64);
        env.storage().instance().set(&Key::MaxDelay,&max_submission_delay);
    }
    pub fn set_reference_value(env:Env,caller:Address,value:i128,timestamp:u64,source_id:BytesN<32>)->Sample {
        require_admin(&env,&caller); positive(&env,value);
        let now=env.ledger().timestamp();
        let max_delay:u64=env.storage().instance().get(&Key::MaxDelay).unwrap();
        need(&env,timestamp<=now&&now-timestamp<=max_delay,Error::InvalidTime);
        let count=Self::sample_count(env.clone());
        if count>0 {
            let prior=Self::get_sample(env.clone(),count);
            need(&env,timestamp>prior.timestamp,Error::InvalidTime);
        }
        let sequence=count.checked_add(1).unwrap_or_else(||soroban_sdk::panic_with_error!(&env,Error::Overflow));
        let row=Sample{sequence,value,timestamp,observed_at:now,source_id};
        keep(&env,&Key::Sample(sequence),&row);
        env.storage().instance().set(&Key::Count,&sequence);
        env.events().publish((symbol_short!("sample"),sequence),row.clone()); row
    }
    pub fn sample_count(env:Env)->u64 { env.storage().instance().get(&Key::Count).unwrap_or(0) }
    pub fn get_sample(env:Env,sequence:u64)->Sample {
        env.storage().persistent().get(&Key::Sample(sequence))
            .unwrap_or_else(||soroban_sdk::panic_with_error!(&env,Error::NoSample))
    }
    pub fn latest(env:Env)->Sample { Self::get_sample(env.clone(),Self::sample_count(env)) }
    pub fn first_at_or_after(env:Env,timestamp:u64)->Option<Sample> {
        let count=Self::sample_count(env.clone());
        if count==0 { return None; }
        if Self::get_sample(env.clone(),count).timestamp<timestamp { return None; }
        let mut low=1u64; let mut high=count;
        while low<high {
            let mid=low+(high-low)/2;
            if Self::get_sample(env.clone(),mid).timestamp<timestamp { low=mid+1; }
            else { high=mid; }
        }
        Some(Self::get_sample(env,low))
    }
    pub fn is_fresh(env:Env,max_stale_seconds:u64)->bool {
        if Self::sample_count(env.clone())==0 { return false; }
        let row=Self::latest(env.clone()); let now=env.ledger().timestamp();
        row.timestamp<=now&&now-row.timestamp<=max_stale_seconds
    }
    pub fn get_admin(env:Env)->Address { admin(&env) }
    pub fn propose_admin(env:Env,caller:Address,next:Address) { common::propose_admin(&env,&caller,&next); }
    pub fn accept_admin(env:Env,caller:Address) { common::accept_admin(&env,&caller); }
}
