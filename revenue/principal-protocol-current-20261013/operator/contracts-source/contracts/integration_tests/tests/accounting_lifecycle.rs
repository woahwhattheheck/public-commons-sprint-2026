//! Whole current edition-2 lifecycle on all eight actual Wasm contracts.
//! Build all locked artifacts first. These are authored verification courses;
//! only their native compiler/process receipts can establish execution.
mod common;
use common::{deploy_wasm_stack,deposit_sy,grant_user,Stack,T0};
use soroban_sdk::{testutils::{Address as _,Ledger as _},token,Address,Env,TryFromVal};
use principal_manager::SCALE;
use principal_yt_token::YTTokenContractClient;
use principal_manager::PrincipalManagerContractClient;

fn rate(s:&Stack,at:u64,value:i128){
    s.env.ledger().with_mut(|li|li.timestamp=at);
    s.oracle.set_reference_value(&s.admin,&value,&at);
}
fn conservation(s:&Stack,funded:i128){
    let raw=token::Client::new(&s.env,&s.underlying).balance(&s.sy.address);
    assert_eq!(funded,s.pm.total_paid_principal()+s.pm.total_paid_yield()+raw);
    assert_eq!(s.pm.locked_shares(),s.sy.balance_of(&s.pm.address));
    assert!(s.pm.backing_underlying()>=s.pm.principal_reserve()+s.yt.total_pending());
}
fn snapshot(s:&Stack,name:&str){
    let root=std::env::var("PRINCIPAL_COURSE_ARTIFACTS").expect("Select original course artifact directory");
    std::fs::create_dir_all(&root).unwrap();
    s.env.to_snapshot_file(std::path::Path::new(&root).join(format!("{name}.json")));
}

#[test]
fn repeated_claims_late_entry_transfer_and_fixed_maturity_conserve_actual_custody(){
    let maturity=T0+100;let s=deploy_wasm_stack(maturity);
    let alice=Address::generate(&s.env);let bob=Address::generate(&s.env);let carol=Address::generate(&s.env);
    for who in [&alice,&bob,&carol]{grant_user(&s,who);}
    let a=deposit_sy(&s,&alice,100*SCALE);s.pm.mint(&alice,&a);
    rate(&s,T0+1,11_000_000);
    assert_eq!(s.pm.claim_yield(&alice),90_909_090);
    assert_eq!(s.pm.claim_yield(&alice),0);
    let b=deposit_sy(&s,&bob,100*SCALE);
    assert_eq!(s.pm.mint(&bob,&b).pt_minted,110*SCALE);
    assert_eq!(s.pm.claim_yield(&bob),0);
    rate(&s,T0+2,12_000_000);
    assert_eq!(s.pm.claim_yield(&alice),75_757_576);
    s.yt.transfer(&alice,&carol,&(40*SCALE));
    assert_eq!(s.yt.balance(&alice),60*SCALE);
    assert_eq!(s.yt.balance(&carol),40*SCALE);
    conservation(&s,200*SCALE);snapshot(&s,"current-01-live-repeated-claims");
    // First eligible sample freezes even if settlement is requested after a newer sample.
    rate(&s,maturity,13_000_000);
    rate(&s,maturity+1,14_000_000);
    s.pm.redeem(&alice,&(100*SCALE),&(60*SCALE));
    s.pm.redeem(&carol,&0,&(40*SCALE));
    s.pm.redeem(&bob,&(110*SCALE),&(110*SCALE));
    assert_eq!(s.yt.maturity_sample().unwrap().timestamp,maturity);
    assert_eq!(s.yt.accounting_rate(),13_000_000);
    assert_eq!(s.pm.total_pt(),0);assert_eq!(s.pm.total_yt(),0);
    assert_eq!(s.yt.total_pending(),0);conservation(&s,200*SCALE);
    let paid=s.pm.total_paid_yield();
    rate(&s,maturity+2,20_000_000);
    assert_eq!(s.pm.claim_yield(&alice),0);
    assert_eq!(s.pm.claim_yield(&bob),0);
    assert_eq!(s.yt.accounting_rate(),13_000_000);
    assert_eq!(s.pm.total_paid_yield(),paid);
    snapshot(&s,"current-02-frozen-final");
    // Cold snapshot opens the same original contract IDs and retained economic edition.
    let cold=Env::from_snapshot(s.env.to_snapshot());
    let manager_id=Address::try_from_val(&cold,&soroban_sdk::xdr::ScVal::from(&s.pm.address)).unwrap();
    let yt_id=Address::try_from_val(&cold,&soroban_sdk::xdr::ScVal::from(&s.yt.address)).unwrap();
    let pm=PrincipalManagerContractClient::new(&cold,&manager_id);
    let yt=YTTokenContractClient::new(&cold,&yt_id);
    assert_eq!(pm.accounting_edition(),2);assert_eq!(pm.total_paid_yield(),paid);
    assert_eq!(yt.maturity_sample(),s.yt.maturity_sample());
}

#[test]
fn ordinary_transfer_keeps_earned_pending_and_explicit_issuer_recovery_preserves_it(){
    let maturity=T0+100;let s=deploy_wasm_stack(maturity);
    let former=Address::generate(&s.env);let holder=Address::generate(&s.env);
    grant_user(&s,&former);grant_user(&s,&holder);
    let shares=deposit_sy(&s,&former,100*SCALE);s.pm.mint(&former,&shares);
    rate(&s,T0+1,11_000_000);
    s.yt.transfer(&former,&holder,&(100*SCALE));
    let pending=s.yt.pending_claim(&former);
    assert_eq!(pending,90_909_090);assert_eq!(s.yt.balance(&former),0);
    assert_eq!(s.yt.pending_claim(&holder),0);
    token::StellarAssetClient::new(&s.env,&s.underlying).set_authorized(&former,&false);
    assert!(s.pm.try_claim_yield(&former).is_err());
    let impostor=Address::generate(&s.env);
    assert!(s.escrow.try_recover_yield(&impostor,&former,&pending).is_err());
    assert_eq!(s.escrow.recover_yield(&s.admin,&former,&pending),pending);
    assert_eq!(s.yt.pending_claim(&former),0);
    let receipt=s.escrow.yield_recovery_receipt(&1).unwrap();
    assert_eq!(receipt.source_account,former);
    assert_eq!(receipt.pending_underlying,pending);
    assert_eq!(receipt.yt_amount,0);
    assert_eq!(s.escrow.finalize_yield(&s.admin),pending);
    // A later full-token recovery moves both the remaining credit and newly earned pending.
    rate(&s,T0+2,12_000_000);
    token::StellarAssetClient::new(&s.env,&s.underlying).set_authorized(&holder,&false);
    assert_eq!(s.escrow.seize_yt(&s.admin,&holder,&(100*SCALE)),100*SCALE);
    let second=s.escrow.yield_recovery_receipt(&2).unwrap();
    assert_eq!(second.source_account,holder);
    assert_eq!(second.pending_underlying,75_757_576);
    assert!(s.yt.try_seize_position(&s.escrow.address,&s.escrow.address,&1).is_err());
    assert_eq!(s.escrow.finalize_yield(&s.admin),75_757_576);
    conservation(&s,100*SCALE);snapshot(&s,"current-03-explicit-pending-recovery");
    s.escrow.seize_pt(&s.admin,&former,&(100*SCALE));
    rate(&s,maturity,12_000_000);
    s.escrow.finalize_pt(&s.admin,&(100*SCALE));
    s.escrow.finalize_yt(&s.admin,&(100*SCALE));
    assert_eq!(s.pm.total_pt(),0);assert_eq!(s.pm.total_yt(),0);
    assert_eq!(s.yt.total_pending(),0);conservation(&s,100*SCALE);
    snapshot(&s,"current-04-recovered-final");
}

#[test]
fn maturity_requires_original_timely_sample_and_later_quotes_cannot_create_more_claims(){
    let maturity=T0+100;let s=deploy_wasm_stack(maturity);
    let user=Address::generate(&s.env);grant_user(&s,&user);
    let shares=deposit_sy(&s,&user,100*SCALE);s.pm.mint(&user,&shares);
    s.env.ledger().with_mut(|li|li.timestamp=maturity);
    assert!(s.pm.try_redeem(&user,&(100*SCALE),&0).is_err());
    assert_eq!(s.pm.total_pt(),100*SCALE);
    assert!(s.oracle.try_set_reference_value(&s.admin,&(2*SCALE),&(maturity+1)).is_err());
    rate(&s,maturity,2*SCALE);
    let r=s.pm.redeem(&user,&(100*SCALE),&(100*SCALE));
    assert_eq!(r.underlying_from_pt,50*SCALE);
    assert_eq!(r.underlying_from_yt,50*SCALE);
    rate(&s,maturity+1,4*SCALE);
    assert_eq!(s.pm.claim_yield(&user),0);
    assert_eq!(s.yt.accounting_rate(),2*SCALE);conservation(&s,100*SCALE);
    snapshot(&s,"current-05-complete-maturity-proof");
}
