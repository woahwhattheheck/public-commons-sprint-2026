//! Runs the five compiled Wasm artifacts in the actual pinned Soroban host.
//! This is a labelled software reference course, not a network deployment.
use principal_manager::{PrincipalManagerContractClient,common::{ManagerConfig,SCALE}};
use principal_oracle_adapter::OracleAdapterContractClient;
use principal_permissioning::PermissioningContractClient;
use principal_risk_control::RiskControlContractClient;
use principal_sy_wrapper::{SYWrapperContractClient,common::WrapperConfig};
use soroban_sdk::{Address,BytesN,Env,IntoVal,TryFromVal,token,symbol_short};
use soroban_sdk::testutils::{Address as _,Ledger,AuthorizedFunction,IssuerFlags};

const ORACLE:&[u8]=include_bytes!("../../../target/wasm32v1-none/release/principal_oracle_adapter.wasm");
const PERMISSION:&[u8]=include_bytes!("../../../target/wasm32v1-none/release/principal_permissioning.wasm");
const RISK:&[u8]=include_bytes!("../../../target/wasm32v1-none/release/principal_risk_control.wasm");
const WRAPPER:&[u8]=include_bytes!("../../../target/wasm32v1-none/release/principal_sy_wrapper.wasm");
const MANAGER:&[u8]=include_bytes!("../../../target/wasm32v1-none/release/principal_manager.wasm");

struct Course { e:Env,admin:Address,user:Address,peer:Address,asset:Address,
    permission:Address,risk:Address,oracle:Address,wrapper:Address,manager:Address }
fn setup()->Course {
    let e=Env::default(); e.budget().reset_unlimited(); e.mock_all_auths();
    e.ledger().with_mut(|l| { l.timestamp=1_000; l.protocol_version=26; });
    let admin=Address::generate(&e); let user=Address::generate(&e); let peer=Address::generate(&e);
    let sac=e.register_stellar_asset_contract_v2(admin.clone());
    sac.issuer().set_flag(IssuerFlags::RevocableFlag);
    sac.issuer().set_flag(IssuerFlags::ClawbackEnabledFlag);
    let asset=sac.address();
    let permission=e.register(PERMISSION,(admin.clone(),));
    let risk=e.register(RISK,(admin.clone(),1_000*SCALE,86_400u64));
    let oracle=e.register(ORACLE,(admin.clone(),600u64));
    let wrapper=e.register(WRAPPER,(WrapperConfig{admin:admin.clone(),underlying:asset.clone(),
        permissioning:permission.clone(),risk_control:risk.clone()},));
    let manager=e.register(MANAGER,(ManagerConfig{admin:admin.clone(),sy_wrapper:wrapper.clone(),
        oracle:oracle.clone(),permissioning:permission.clone(),risk_control:risk.clone(),
        maturity_timestamp:2_000,max_stale_seconds:600,settlement_window_seconds:600},));
    let permission_client=PermissioningContractClient::new(&e,&permission);
    for account in [&admin,&user,&peer,&wrapper,&manager] {
        permission_client.grant_account(&admin,account,&100_000);
        permission_client.grant_asset(&admin,account,&asset,&100_000);
    }
    RiskControlContractClient::new(&e,&risk).set_caller(&admin,&wrapper,&true);
    OracleAdapterContractClient::new(&e,&oracle).set_reference_value(&admin,&SCALE,&1_000,&BytesN::from_array(&e,&[1;32]));
    token::StellarAssetClient::new(&e,&asset).mint(&user,&(500*SCALE));
    Course{e,admin,user,peer,asset,permission,risk,oracle,wrapper,manager}
}
fn time(c:&Course,value:u64) { c.e.ledger().with_mut(|l|l.timestamp=value); }
fn snapshot(e:&Env,name:&str) {
    if let Ok(dir)=std::env::var("PRINCIPAL_COURSE_ARTIFACTS") {
        let path=std::path::Path::new(&dir).join(format!("{name}.json"));
        e.to_snapshot_file(path);
    }
}
fn cold_address(e:&Env,address:&Address)->Address {
    Address::try_from_val(e,&soroban_sdk::xdr::ScVal::from(address)).unwrap()
}

#[test]
fn backed_distinct_entry_rates_partial_redemption_and_cold_reopen() {
    let c=setup(); let w=SYWrapperContractClient::new(&c.e,&c.wrapper);
    let m=PrincipalManagerContractClient::new(&c.e,&c.manager);
    let o=OracleAdapterContractClient::new(&c.e,&c.oracle);
    assert_eq!(w.deposit(&c.user,&(200*SCALE),&(200*SCALE)),200*SCALE);
    let first=m.mint(&c.user,&(100*SCALE),&(100*SCALE),&7);
    let auth=c.e.auths();
    assert_eq!(auth.len(),1); assert_eq!(auth[0].0,c.user);
    assert_eq!(auth[0].1.function,AuthorizedFunction::Contract((c.manager.clone(),symbol_short!("mint"),
        (c.user.clone(),100*SCALE,100*SCALE,7u64).into_val(&c.e))));
    assert_eq!(auth[0].1.sub_invocations.len(),1);
    assert_eq!(auth[0].1.sub_invocations[0].function,AuthorizedFunction::Contract((c.wrapper.clone(),
        soroban_sdk::Symbol::new(&c.e,"transfer_shares"),(c.user.clone(),c.manager.clone(),100*SCALE).into_val(&c.e))));
    time(&c,1_030); o.set_reference_value(&c.admin,&10_200_000,&1_030,&BytesN::from_array(&c.e,&[2;32]));
    let second=m.mint(&c.user,&(100*SCALE),&(102*SCALE),&8);
    assert_eq!(first.initial_claims,100*SCALE); assert_eq!(second.initial_claims,102*SCALE);
    assert_eq!(w.balance_of(&c.manager),200*SCALE);
    assert_eq!(m.total_locked_shares(),200*SCALE);
    m.transfer_pt(&first.id,&c.user,&c.peer,&(40*SCALE));
    m.transfer_yt(&first.id,&c.user,&c.peer,&(100*SCALE));
    time(&c,2_000); o.set_reference_value(&c.admin,&11_000_000,&2_000,&BytesN::from_array(&c.e,&[3;32]));
    c.e.set_auths(&[]); // Real manager->wrapper->asset invoker authorization.
    let a=m.settle(&first.id,&(100*SCALE)); let b=m.settle(&second.id,&(100*SCALE));
    assert_eq!(a.pt_budget,909_090_909); assert_eq!(a.yt_budget,90_909_091);
    assert_eq!(b.pt_budget,927_272_727); assert_eq!(b.yt_budget,72_727_273);
    assert_eq!(m.liability(),200*SCALE); assert_eq!(m.total_locked_shares(),0);
    snapshot(&c.e,"01-fixed-settlement");
    let cold=Env::from_snapshot(c.e.to_snapshot()); cold.budget().reset_unlimited(); cold.mock_all_auths();
    let manager=cold_address(&cold,&c.manager); let user=cold_address(&cold,&c.user);
    let peer=cold_address(&cold,&c.peer); let asset=cold_address(&cold,&c.asset);
    let admin=cold_address(&cold,&c.admin); let oracle=cold_address(&cold,&c.oracle);
    let cm=PrincipalManagerContractClient::new(&cold,&manager);
    assert_eq!(cm.get_issue(&first.id),a);
    cold.ledger().with_mut(|l|l.timestamp=2_100);
    OracleAdapterContractClient::new(&cold,&oracle).set_reference_value(&admin,&15_000_000,&2_100,&BytesN::from_array(&cold,&[4;32]));
    let one=cm.redeem(&first.id,&user,&user,&(60*SCALE),&0,&0);
    let two=cm.redeem(&first.id,&peer,&peer,&(40*SCALE),&(100*SCALE),&0);
    assert_eq!(one.underlying_from_pt+two.underlying_from_pt,a.pt_budget);
    assert_eq!(two.underlying_from_yt,a.yt_budget);
    assert_eq!(cm.liability(),100*SCALE);
    assert_eq!(cm.get_issue(&second.id).backing_underlying,100*SCALE);
    let last=cm.redeem(&second.id,&user,&user,&(102*SCALE),&(102*SCALE),&(100*SCALE));
    assert_eq!(last.underlying_total,100*SCALE); assert_eq!(cm.liability(),0);
    assert_eq!(token::Client::new(&cold,&asset).balance(&manager),0);
    assert_eq!(cm.get_issue(&first.id).settlement_sample.unwrap().value,11_000_000);
    snapshot(&cold,"02-cold-return-and-complete-redemption");
}
#[test]
fn paired_recombination_preserves_exact_original_shares_and_nonce() {
    let c=setup(); let w=SYWrapperContractClient::new(&c.e,&c.wrapper);
    let m=PrincipalManagerContractClient::new(&c.e,&c.manager);
    let o=OracleAdapterContractClient::new(&c.e,&c.oracle);
    time(&c,1_010); o.set_reference_value(&c.admin,&10_300_000,&1_010,&BytesN::from_array(&c.e,&[5;32]));
    w.deposit(&c.user,&(100*SCALE),&(100*SCALE));
    let issue=m.mint(&c.user,&(100*SCALE),&(103*SCALE),&1);
    let part=m.recombine(&issue.id,&c.user,&(10*SCALE),&1,&99);
    assert_eq!(part,97_087_378);
    assert!(m.try_recombine(&issue.id,&c.user,&(10*SCALE),&1,&99).is_err());
    let remaining=issue.initial_claims-10*SCALE;
    let last=m.recombine(&issue.id,&c.user,&remaining,&1,&100);
    assert_eq!(part+last,100*SCALE);
    assert_eq!(w.balance_of(&c.user),100*SCALE); assert_eq!(w.balance_of(&c.manager),0);
    assert_eq!(m.total_locked_shares(),0);
    assert_eq!(m.get_issue(&issue.id).pt_supply,0);
    assert_eq!(m.get_issue(&issue.id).yt_supply,0);
    assert_eq!(m.recombination_receipt(&issue.id,&c.user,&99).unwrap().returned_shares,part);
    assert_eq!(w.withdraw(&c.user,&(100*SCALE),&c.user,&(100*SCALE)),100*SCALE);
    snapshot(&c.e,"03-exact-paired-recombination");
}
#[test]
fn actual_clawback_and_extreme_prices_keep_capped_settlement_representable() {
    let c=setup(); let w=SYWrapperContractClient::new(&c.e,&c.wrapper);
    let m=PrincipalManagerContractClient::new(&c.e,&c.manager);
    let asset=token::StellarAssetClient::new(&c.e,&c.asset);
    asset.mint(&c.wrapper,&(100*SCALE)); // Supplied unowned donation, before share issuance.
    w.deposit(&c.user,&(100*SCALE),&(100*SCALE));
    let issue=m.mint(&c.user,&(100*SCALE),&(100*SCALE),&2);
    asset.clawback(&c.wrapper,&(150*SCALE));
    assert_eq!(w.reserve_underlying(),100*SCALE); assert_eq!(w.effective_reserve(),50*SCALE);
    assert_eq!(w.total_underlying(),0);
    time(&c,2_000); OracleAdapterContractClient::new(&c.e,&c.oracle)
        .set_reference_value(&c.admin,&SCALE,&2_000,&BytesN::from_array(&c.e,&[6;32]));
    let closed=m.settle(&issue.id,&0); assert_eq!(closed.principal_shortfall,100*SCALE);
    assert_eq!(closed.pt_budget,0); assert_eq!(closed.yt_budget,0);
    assert_eq!(m.redeem(&issue.id,&c.user,&c.user,&(100*SCALE),&(100*SCALE),&0).underlying_total,0);
    snapshot(&c.e,"04-actual-token-loss");
    for (i,price) in [1i128,i128::MAX].iter().enumerate() {
        let x=setup(); let w=SYWrapperContractClient::new(&x.e,&x.wrapper);
        let m=PrincipalManagerContractClient::new(&x.e,&x.manager);
        w.deposit(&x.user,&(100*SCALE),&(100*SCALE)); let issue=m.mint(&x.user,&(100*SCALE),&(100*SCALE),&5);
        time(&x,2_000); OracleAdapterContractClient::new(&x.e,&x.oracle)
            .set_reference_value(&x.admin,price,&2_000,&BytesN::from_array(&x.e,&[7;32]));
        let result=m.settle(&issue.id,&(100*SCALE));
        assert_eq!(result.pt_budget+result.yt_budget,100*SCALE);
        assert!(result.principal_shortfall>=0&&result.principal_shortfall<=100*SCALE);
        assert_eq!(m.redeem(&issue.id,&x.user,&x.user,&(100*SCALE),&(100*SCALE),&(100*SCALE)).underlying_total,100*SCALE);
        snapshot(&x.e,&format!("05-extreme-price-{i}"));
    }
}
#[test]
fn real_permission_risk_and_missing_signature_gates_preserve_custody() {
    let c=setup(); let w=SYWrapperContractClient::new(&c.e,&c.wrapper);
    let m=PrincipalManagerContractClient::new(&c.e,&c.manager);
    let r=RiskControlContractClient::new(&c.e,&c.risk);
    let p=PermissioningContractClient::new(&c.e,&c.permission);
    assert!(r.try_check_deposit(&c.user,&SCALE).is_err());
    assert!(r.try_check_deposit(&c.user,&(-SCALE)).is_err());
    r.set_deposit_limit(&c.admin,&(10*SCALE));
    assert!(w.try_deposit(&c.user,&(11*SCALE),&0).is_err());
    assert_eq!(w.total_shares(),0); assert_eq!(w.token_balance(),0);
    r.set_deposit_limit(&c.admin,&(100*SCALE));
    p.revoke_asset(&c.admin,&c.user,&c.asset);
    assert!(w.try_deposit(&c.user,&SCALE,&0).is_err());
    p.grant_asset(&c.admin,&c.user,&c.asset,&100_000);
    w.deposit(&c.user,&(10*SCALE),&(10*SCALE));
    let issue=m.mint(&c.user,&(10*SCALE),&(10*SCALE),&3);
    c.e.set_auths(&[]);
    assert!(m.try_transfer_pt(&issue.id,&c.user,&c.peer,&SCALE).is_err());
    c.e.mock_all_auths();
    r.pause(&c.admin);
    assert!(m.try_transfer_pt(&issue.id,&c.user,&c.peer,&SCALE).is_err());
    r.unpause(&c.admin); p.revoke_asset(&c.admin,&c.manager,&c.asset);
    assert!(m.try_transfer_yt(&issue.id,&c.user,&c.peer,&SCALE).is_err());
    p.grant_asset(&c.admin,&c.manager,&c.asset,&100_000);
    p.grant_account(&c.admin,&c.peer,&1_001); time(&c,1_002);
    assert!(m.try_transfer_pt(&issue.id,&c.user,&c.peer,&SCALE).is_err());
    assert_eq!(m.balances(&issue.id,&c.user).pt,10*SCALE);
    assert_eq!(m.total_locked_shares(),10*SCALE); assert_eq!(w.balance_of(&c.manager),10*SCALE);
    snapshot(&c.e,"06-original-authorization-and-risk");
}
