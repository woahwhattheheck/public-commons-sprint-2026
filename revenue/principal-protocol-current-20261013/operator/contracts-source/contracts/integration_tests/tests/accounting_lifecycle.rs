//! Whole current edition-3 lifecycle on all eight actual Wasm contracts.
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
    let preview=s.pm.preview_mint(&b);
    assert_eq!(preview.original_rate_notional,110*SCALE);
    assert_eq!(preview.issued_notional,110*SCALE-1);
    assert_eq!(preview.issuance_adjustment,1);
    let bob_notional=s.pm.mint(&bob,&b).pt_minted;
    assert_eq!(bob_notional,preview.issued_notional);
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
    s.pm.redeem(&bob,&bob_notional,&bob_notional);
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
    assert_eq!(pm.accounting_edition(),3);assert_eq!(pm.total_paid_yield(),paid);
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
    let old_fraction=s.yt.reward_remainder(&former);
    assert!(old_fraction>0);
    assert!(s.escrow.try_recover_fraction(&impostor,&former).is_err());
    assert_eq!(s.escrow.recover_fraction(&s.admin,&former),old_fraction);
    assert_eq!(s.yt.reward_remainder(&former),0);
    let fraction_receipt=s.escrow.yield_recovery_receipt(&2).unwrap();
    assert_eq!(fraction_receipt.source_account,former);
    assert_eq!(fraction_receipt.reward_remainder,old_fraction);
    // A later full-token recovery moves both the remaining credit and newly earned pending.
    rate(&s,T0+2,12_000_000);
    token::StellarAssetClient::new(&s.env,&s.underlying).set_authorized(&holder,&false);
    assert_eq!(s.escrow.seize_yt(&s.admin,&holder,&(100*SCALE)),100*SCALE);
    let second=s.escrow.yield_recovery_receipt(&3).unwrap();
    assert_eq!(second.source_account,holder);
    assert_eq!(second.pending_underlying,75_757_575);
    assert!(second.reward_remainder>0);
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


#[test]
fn atomic_transfers_allowance_burn_and_fractional_recovery_never_create_yield(){
    // Both exact source-reported witnesses use actual deployed eight-contract stacks.
    for (funded,quote,label) in [(3_i128,25_000_000_i128,"current-06-three-atom-conservation"),
                                (100*SCALE,13_000_000_i128,"current-07-full-unit-conservation")] {
        let maturity=T0+100;let s=deploy_wasm_stack(maturity);
        let alice=Address::generate(&s.env);let bob=Address::generate(&s.env);
        let spender=Address::generate(&s.env);
        grant_user(&s,&alice);grant_user(&s,&bob);grant_user(&s,&spender);
        let shares=deposit_sy(&s,&alice,funded);
        let n=s.pm.mint(&alice,&shares).yt_minted;
        rate(&s,T0+1,quote);
        let first=s.pm.claim_yield(&alice);
        assert_eq!(first,if funded==3{1}else{230_769_230});
        let fraction=s.yt.reward_remainder(&alice);
        let pending=s.yt.total_pending();let paid=s.pm.total_paid_yield();
        s.yt.transfer(&alice,&bob,&1);
        s.yt.transfer(&alice,&bob,&1);
        assert_eq!(s.yt.total_pending(),pending);
        assert_eq!(s.yt.reward_remainder(&alice),fraction);
        assert_eq!(s.yt.reward_remainder(&bob),0);
        assert_eq!(s.pm.claim_yield(&alice),0);assert_eq!(s.pm.claim_yield(&bob),0);
        conservation(&s,funded);
        // Merge, self-transfer and spender-authorized splits use the same exact state.
        s.yt.transfer(&bob,&alice,&2);
        s.yt.transfer(&alice,&alice,&1);
        s.yt.approve(&alice,&spender,&2,&(s.env.ledger().sequence()+10));
        s.yt.transfer_from(&spender,&alice,&bob,&1);
        s.yt.transfer_from(&spender,&alice,&bob,&1);
        assert_eq!(s.yt.allowance(&alice,&spender),0);
        assert_eq!(s.yt.total_pending(),pending);
        assert_eq!(s.pm.total_paid_yield(),paid);
        assert_eq!(s.yt.reward_remainder(&alice),fraction);
        conservation(&s,funded);
        // Later real appreciation can create rewards; a balance split alone cannot.
        rate(&s,T0+2,quote+SCALE);
        s.pm.claim_yield(&alice);s.pm.claim_yield(&bob);
        conservation(&s,funded);
        rate(&s,maturity,quote+SCALE);
        s.pm.redeem(&alice,&n,&(n-2));
        s.pm.redeem(&bob,&0,&2);
        assert_eq!(s.pm.total_pt(),0);assert_eq!(s.pm.total_yt(),0);
        let fa=s.yt.reward_remainder(&alice);let fb=s.yt.reward_remainder(&bob);
        // Burning the last token preserves the original earned fractional rights.
        token::StellarAssetClient::new(&s.env,&s.underlying).set_authorized(&alice,&false);
        token::StellarAssetClient::new(&s.env,&s.underlying).set_authorized(&bob,&false);
        assert_eq!(s.escrow.recover_fraction(&s.admin,&alice),fa);
        assert_eq!(s.escrow.recover_fraction(&s.admin,&bob),fb);
        assert_eq!(s.yt.reward_remainder(&alice),0);assert_eq!(s.yt.reward_remainder(&bob),0);
        s.escrow.finalize_yield(&s.admin);
        assert_eq!(s.yt.total_pending(),0);conservation(&s,funded);
        snapshot(&s,label);
    }
    let s=deploy_wasm_stack(T0+100);let user=Address::generate(&s.env);grant_user(&s,&user);
    let shares=deposit_sy(&s,&user,100*SCALE);
    rate(&s,T0+1,1_000_000_000_000_000_001);
    assert!(s.pm.try_preview_mint(&shares).is_err());
    assert!(s.pm.try_mint(&user,&shares).is_err());
    assert_eq!(s.pm.total_pt(),0);assert_eq!(s.sy.balance_of(&user),shares);
}
