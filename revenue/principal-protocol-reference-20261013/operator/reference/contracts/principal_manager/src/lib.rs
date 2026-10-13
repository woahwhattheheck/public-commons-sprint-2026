#![no_std]
#[allow(dead_code)]
#[path="../../common.rs"] pub mod common;
use common::*;
use soroban_sdk::{contract,contractimpl,contracttype,token,Address,Env,symbol_short};

#[contracttype]
#[derive(Clone)]
enum Key {
    Config, Underlying, Count, Liability, LockedShares, MaturitySample, Issue(u64),
    OwnerNonce(Address,u64), Balance(u64,Address), Recombined(u64,Address,u64),
}
#[contracttype]
#[derive(Clone,Debug,Eq,PartialEq)]
pub struct Recombination {
    pub issue_id:u64,pub owner:Address,pub nonce:u64,pub amount:i128,
    pub min_shares:i128,pub returned_shares:i128,pub recorded_at:u64,
}
#[contract]
pub struct PrincipalManagerContract;
#[contractimpl]
impl PrincipalManagerContract {
    pub fn __constructor(env:Env,config:ManagerConfig) {
        need(&env,config.maturity_timestamp>env.ledger().timestamp(),Error::InvalidTime);
        need(&env,config.max_stale_seconds>0&&config.settlement_window_seconds>0,Error::InvalidConfig);
        initialize_admin(&env,&config.admin);
        let wc=WrapperClient::new(&env,&config.sy_wrapper).config();
        need(&env,wc.permissioning==config.permissioning&&wc.risk_control==config.risk_control,Error::InvalidConfig);
        need(&env,token::Client::new(&env,&wc.underlying).decimals()==7,Error::InvalidDecimals);
        env.storage().instance().set(&Key::Underlying,&wc.underlying);
        env.storage().instance().set(&Key::Config,&config);
        env.storage().instance().set(&Key::Count,&0u64);
        env.storage().instance().set(&Key::Liability,&0i128);
        env.storage().instance().set(&Key::LockedShares,&0i128);
    }
    pub fn config(env:Env)->ManagerConfig {
        let mut c:ManagerConfig=env.storage().instance().get(&Key::Config).unwrap();
        c.admin=admin(&env); c
    }
    pub fn underlying(env:Env)->Address { env.storage().instance().get(&Key::Underlying).unwrap() }
    pub fn issue_count(env:Env)->u64 { env.storage().instance().get(&Key::Count).unwrap_or(0) }
    pub fn find_issue(env:Env,owner:Address,issue_nonce:u64)->Option<u64> {
        env.storage().persistent().get(&Key::OwnerNonce(owner,issue_nonce))
    }
    pub fn get_issue(env:Env,issue_id:u64)->Issue {
        env.storage().persistent().get(&Key::Issue(issue_id))
            .unwrap_or_else(||soroban_sdk::panic_with_error!(&env,Error::Missing))
    }
    pub fn balances(env:Env,issue_id:u64,account:Address)->Balances {
        let _=Self::get_issue(env.clone(),issue_id);
        env.storage().persistent().get(&Key::Balance(issue_id,account)).unwrap_or(Balances{pt:0,yt:0})
    }
    pub fn liability(env:Env)->i128 { env.storage().instance().get(&Key::Liability).unwrap_or(0) }
    pub fn total_locked_shares(env:Env)->i128 { env.storage().instance().get(&Key::LockedShares).unwrap_or(0) }
    pub fn maturity_sample(env:Env)->Option<Sample> { env.storage().instance().get(&Key::MaturitySample) }

    pub fn mint(env:Env,from:Address,sy_shares:i128,min_claims:i128,issue_nonce:u64)->Issue {
        from.require_auth(); positive(&env,sy_shares); nonnegative(&env,min_claims);
        let c=Self::config(env.clone()); let here=env.current_contract_address();
        need(&env,env.ledger().timestamp()<c.maturity_timestamp,Error::Maturity);
        need(&env,Self::find_issue(env.clone(),from.clone(),issue_nonce).is_none(),Error::Duplicate);
        Self::check_account(&env,&c,&from); Self::check_account(&env,&c,&here);
        let sample=OracleClient::new(&env,&c.oracle).latest();
        let now=env.ledger().timestamp();
        need(&env,sample.timestamp<=now&&now-sample.timestamp<=c.max_stale_seconds,Error::OracleStale);
        let wrapper=WrapperClient::new(&env,&c.sy_wrapper);
        let underlying=wrapper.preview_withdraw(&sy_shares);
        let claims=mul_div(&env,underlying,sample.value,SCALE);
        positive(&env,claims); need(&env,claims>=min_claims,Error::Slippage);
        let before=wrapper.balance_of(&here);
        let locked=Self::total_locked_shares(env.clone());
        need(&env,before>=locked,Error::BackingMismatch);
        wrapper.transfer_shares(&from,&here,&sy_shares);
        need(&env,wrapper.balance_of(&here)-before==sy_shares,Error::BackingMismatch);
        let id=Self::issue_count(env.clone()).checked_add(1)
            .unwrap_or_else(||soroban_sdk::panic_with_error!(&env,Error::Overflow));
        let issue=Issue {
            id,issue_nonce,issuer:from.clone(),issued_at:now,maturity_timestamp:c.maturity_timestamp,
            entry_sample:sample,initial_shares:sy_shares,entry_underlying:underlying,initial_claims:claims,
            recombined_claims:0,returned_shares:0,locked_shares:sy_shares,
            settled:false,settled_at:0,settlement_sample:None,settlement_claims:0,
            backing_underlying:0,pt_budget:0,yt_budget:0,principal_shortfall:0,
            rounding_numerator:0,pt_redeemed:0,yt_redeemed:0,pt_paid:0,yt_paid:0,pt_supply:claims,yt_supply:claims,
        };
        keep(&env,&Key::Issue(id),&issue);
        keep(&env,&Key::OwnerNonce(from.clone(),issue_nonce),&id);
        keep(&env,&Key::Balance(id,from.clone()),&Balances{pt:claims,yt:claims});
        env.storage().instance().set(&Key::Count,&id);
        env.storage().instance().set(&Key::LockedShares,&add(&env,locked,sy_shares));
        env.events().publish((symbol_short!("mint"),id),(from,sy_shares,claims,issue_nonce)); issue
    }
    pub fn transfer_pt(env:Env,issue_id:u64,from:Address,to:Address,amount:i128)->Balances {
        Self::transfer(&env,issue_id,&from,&to,amount,true)
    }
    pub fn transfer_yt(env:Env,issue_id:u64,from:Address,to:Address,amount:i128)->Balances {
        Self::transfer(&env,issue_id,&from,&to,amount,false)
    }
    pub fn recombination_receipt(env:Env,issue_id:u64,owner:Address,nonce:u64)->Option<Recombination> {
        env.storage().persistent().get(&Key::Recombined(issue_id,owner,nonce))
    }
    pub fn recombine(env:Env,issue_id:u64,from:Address,amount:i128,min_shares:i128,recombination_nonce:u64)->i128 {
        from.require_auth(); positive(&env,amount); nonnegative(&env,min_shares);
        let c=Self::config(env.clone()); Self::check_account(&env,&c,&from);
        let mut issue=Self::get_issue(env.clone(),issue_id);
        need(&env,!issue.settled&&env.ledger().timestamp()<issue.maturity_timestamp,Error::Maturity);
        need(&env,Self::recombination_receipt(env.clone(),issue_id,from.clone(),recombination_nonce).is_none(),Error::Duplicate);
        let mut bal=Self::balances(env.clone(),issue_id,from.clone());
        need(&env,bal.pt>=amount&&bal.yt>=amount,Error::InsufficientBalance);
        let cumulative=add(&env,issue.recombined_claims,amount);
        need(&env,cumulative<=issue.initial_claims,Error::InsufficientBalance);
        let returned=mul_div(&env,issue.initial_shares,cumulative,issue.initial_claims);
        let delta=sub(&env,returned,issue.returned_shares);
        positive(&env,delta); need(&env,delta>=min_shares,Error::Slippage);
        let here=env.current_contract_address(); let wrapper=WrapperClient::new(&env,&c.sy_wrapper);
        let before=wrapper.balance_of(&here); let locked=Self::total_locked_shares(env.clone());
        need(&env,before>=locked&&locked>=issue.locked_shares,Error::BackingMismatch);
        bal.pt-=amount; bal.yt-=amount; issue.pt_supply-=amount; issue.yt_supply-=amount;
        issue.recombined_claims=cumulative; issue.returned_shares=returned; issue.locked_shares-=delta;
        keep(&env,&Key::Balance(issue_id,from.clone()),&bal); keep(&env,&Key::Issue(issue_id),&issue);
        let receipt=Recombination{issue_id,owner:from.clone(),nonce:recombination_nonce,amount,min_shares,returned_shares:delta,recorded_at:env.ledger().timestamp()};
        keep(&env,&Key::Recombined(issue_id,from.clone(),recombination_nonce),&receipt);
        env.storage().instance().set(&Key::LockedShares,&(locked-delta));
        wrapper.transfer_shares(&here,&from,&delta);
        need(&env,before-wrapper.balance_of(&here)==delta,Error::BackingMismatch);
        env.events().publish((symbol_short!("recombine"),issue_id),receipt); delta
    }
    pub fn lock_maturity(env:Env)->Sample {
        let c=Self::config(env.clone()); active(&env,&c.risk_control);
        need(&env,env.ledger().timestamp()>=c.maturity_timestamp,Error::Maturity);
        if let Some(row)=Self::maturity_sample(env.clone()) { return row; }
        let row=OracleClient::new(&env,&c.oracle).first_at_or_after(&c.maturity_timestamp)
            .unwrap_or_else(||soroban_sdk::panic_with_error!(&env,Error::NoSample));
        need(&env,row.timestamp>=c.maturity_timestamp&&row.timestamp-c.maturity_timestamp<=c.settlement_window_seconds,Error::InvalidTime);
        need(&env,row.observed_at>=row.timestamp&&row.observed_at-row.timestamp<=c.max_stale_seconds,Error::OracleStale);
        env.storage().instance().set(&Key::MaturitySample,&row);
        env.events().publish((symbol_short!("maturity"),),row.clone()); row
    }
    pub fn settle(env:Env,issue_id:u64,min_underlying:i128)->Issue {
        nonnegative(&env,min_underlying); let c=Self::config(env.clone());
        active(&env,&c.risk_control);
        let mut issue=Self::get_issue(env.clone(),issue_id); need(&env,!issue.settled,Error::Settled);
        let sample=Self::lock_maturity(env.clone()); let here=env.current_contract_address();
        Self::check_account(&env,&c,&here);
        let asset=Self::underlying(env.clone()); let token=token::Client::new(&env,&asset);
        let before=token.balance(&here); let liability=Self::liability(env.clone());
        need(&env,before>=liability,Error::Insolvent);
        let wrapper=WrapperClient::new(&env,&c.sy_wrapper);
        let shares_before=wrapper.balance_of(&here);
        let locked=Self::total_locked_shares(env.clone());
        need(&env,shares_before>=locked&&locked>=issue.locked_shares,Error::BackingMismatch);
        if issue.locked_shares>0 { wrapper.withdraw(&here,&issue.locked_shares,&here,&min_underlying); }
        else { need(&env,min_underlying==0,Error::Slippage); }
        need(&env,shares_before-wrapper.balance_of(&here)==issue.locked_shares,Error::BackingMismatch);
        let received=sub(&env,token.balance(&here),before); nonnegative(&env,received);
        let claims=issue.initial_claims-issue.recombined_claims;
        need(&env,issue.pt_supply==claims&&issue.yt_supply==claims,Error::BackingMismatch);
        let pt=mul_div_capped(&env,claims,SCALE,sample.value,received); let yt=received-pt;
        let backed_principal=mul_div_capped(&env,received,sample.value,SCALE,claims);
        issue.principal_shortfall=if backed_principal<claims { claims-backed_principal } else { 0 };
        issue.rounding_numerator=mul_rem(&env,claims,SCALE,sample.value);
        issue.settled=true; issue.settled_at=env.ledger().timestamp();
        issue.settlement_sample=Some(sample); issue.settlement_claims=claims;
        env.storage().instance().set(&Key::LockedShares,&(locked-issue.locked_shares));
        issue.backing_underlying=received; issue.pt_budget=pt; issue.yt_budget=yt; issue.locked_shares=0;
        keep(&env,&Key::Issue(issue_id),&issue);
        env.storage().instance().set(&Key::Liability,&add(&env,liability,received));
        env.events().publish((symbol_short!("settle"),issue_id),issue.clone()); issue
    }
    pub fn redeem(env:Env,issue_id:u64,from:Address,to:Address,pt_amount:i128,yt_amount:i128,min_underlying:i128)->Payout {
        from.require_auth(); nonnegative(&env,pt_amount); nonnegative(&env,yt_amount); nonnegative(&env,min_underlying);
        need(&env,pt_amount>0||yt_amount>0,Error::InvalidAmount);
        let c=Self::config(env.clone()); Self::check_account(&env,&c,&from); Self::check_account(&env,&c,&to);
        let here=env.current_contract_address(); need(&env,to!=here,Error::InvalidConfig);
        let mut issue=Self::get_issue(env.clone(),issue_id); need(&env,issue.settled,Error::NotSettled);
        let mut bal=Self::balances(env.clone(),issue_id,from.clone());
        need(&env,bal.pt>=pt_amount&&bal.yt>=yt_amount,Error::InsufficientBalance);
        let pt_redeemed=add(&env,issue.pt_redeemed,pt_amount);
        let yt_redeemed=add(&env,issue.yt_redeemed,yt_amount);
        need(&env,pt_redeemed<=issue.settlement_claims&&yt_redeemed<=issue.settlement_claims,Error::InsufficientBalance);
        let pt_paid=mul_div(&env,issue.pt_budget,pt_redeemed,issue.settlement_claims);
        let yt_paid=mul_div(&env,issue.yt_budget,yt_redeemed,issue.settlement_claims);
        let from_pt=pt_paid-issue.pt_paid; let from_yt=yt_paid-issue.yt_paid;
        let amount=add(&env,from_pt,from_yt); need(&env,amount>=min_underlying,Error::Slippage);
        let asset=Self::underlying(env.clone()); let token=token::Client::new(&env,&asset);
        let before=token.balance(&here); let liability=Self::liability(env.clone());
        need(&env,before>=liability&&liability>=amount,Error::Insolvent);
        let target_before=token.balance(&to);
        bal.pt-=pt_amount; bal.yt-=yt_amount; issue.pt_supply-=pt_amount; issue.yt_supply-=yt_amount;
        issue.pt_redeemed=pt_redeemed; issue.yt_redeemed=yt_redeemed; issue.pt_paid=pt_paid; issue.yt_paid=yt_paid;
        keep(&env,&Key::Balance(issue_id,from.clone()),&bal); keep(&env,&Key::Issue(issue_id),&issue);
        env.storage().instance().set(&Key::Liability,&(liability-amount));
        if amount>0 { token.transfer(&here,&to,&amount); }
        need(&env,before-token.balance(&here)==amount&&token.balance(&to)-target_before==amount,Error::BackingMismatch);
        let row=Payout{issue_id,pt_burned:pt_amount,yt_burned:yt_amount,underlying_from_pt:from_pt,
            underlying_from_yt:from_yt,underlying_total:amount,pt_remaining:bal.pt,yt_remaining:bal.yt};
        env.events().publish((symbol_short!("redeem"),issue_id),(from,to,row.clone())); row
    }
    fn check_account(env:&Env,c:&ManagerConfig,account:&Address) {
        active(env,&c.risk_control);
        let asset=Self::underlying(env.clone());
        permitted(env,&c.permissioning,&asset,account);
        if *account!=env.current_contract_address() { permitted(env,&c.permissioning,&asset,&env.current_contract_address()); }
    }
    fn transfer(env:&Env,issue_id:u64,from:&Address,to:&Address,amount:i128,pt:bool)->Balances {
        from.require_auth(); positive(env,amount);
        let c=Self::config(env.clone()); Self::check_account(env,&c,from); Self::check_account(env,&c,to);
        let mut source=Self::balances(env.clone(),issue_id,from.clone());
        let available=if pt { source.pt } else { source.yt };
        need(env,available>=amount,Error::InsufficientBalance);
        if from!=to {
            let mut target=Self::balances(env.clone(),issue_id,to.clone());
            if pt { source.pt-=amount; target.pt=add(env,target.pt,amount); }
            else { source.yt-=amount; target.yt=add(env,target.yt,amount); }
            keep(env,&Key::Balance(issue_id,from.clone()),&source);
            keep(env,&Key::Balance(issue_id,to.clone()),&target);
        }
        env.events().publish((symbol_short!("claim"),issue_id),(from.clone(),to.clone(),amount,pt)); source
    }
    pub fn get_admin(env:Env)->Address { admin(&env) }
    pub fn propose_admin(env:Env,caller:Address,next:Address) { common::propose_admin(&env,&caller,&next); }
    pub fn accept_admin(env:Env,caller:Address) { common::accept_admin(&env,&caller); }
}
