//! Paired exits on the same actual locked ten-contract Wasm source, no live deployment.
mod common;
use common::{deploy_wasm_stack,deposit_sy,grant_user,Stack,T0};
use soroban_sdk::{testutils::{Address as _,Ledger as _},token,Address,Env,TryFromVal};
use principal_manager::{PrincipalManagerContractClient,SCALE};
use principal_yt_token::YTTokenContractClient;
use principal_sy_wrapper::SYWrapperContractClient;
use principal_market_pool::{MarketConfig,MarketPoolContractClient};
use principal_router::RouterContractClient;
fn rate(s:&Stack,at:u64,value:i128){s.env.ledger().with_mut(|l|l.timestamp=at);s.oracle.set_reference_value(&s.admin,&value,&at);}
fn snapshot(s:&Stack,name:&str){
 let root=std::env::var("PRINCIPAL_COURSE_ARTIFACTS").unwrap();std::fs::create_dir_all(&root).unwrap();
 s.env.to_snapshot_file(std::path::Path::new(&root).join(format!("{name}.json")));
}
fn custody(s:&Stack){
 assert_eq!(s.pm.locked_shares(),s.sy.balance_of(&s.pm.address));
 assert!(s.pm.backing_underlying()>=s.pm.principal_reserve()+s.yt.total_pending());
 assert!(token::Client::new(&s.env,&s.underlying).balance(&s.sy.address)>=s.sy.total_underlying());
}
fn wasm(name:&str)->std::vec::Vec<u8>{std::fs::read(std::path::Path::new(&std::env::var("PRINCIPAL_CURRENT_WASM").unwrap()).join(format!("{name}.wasm"))).unwrap()}
fn router(s:&Stack,maturity:u64)->RouterContractClient<'static>{
 let pool_id=s.env.register(wasm("principal_market_pool").as_slice(),());
 grant_user(s,&pool_id);s.perm.grant_asset(&s.admin,&pool_id,&pool_id);s.risk.add_consumer(&s.admin,&pool_id);
 let p=MarketPoolContractClient::new(&s.env,&pool_id);
 p.initialize(&s.admin,&MarketConfig{manager:s.pm.address.clone(),sy:s.sy.address.clone(),pt:s.pt.address.clone(),yt:s.yt.address.clone(),
 oracle:s.oracle.address.clone(),permissioning:s.perm.address.clone(),underlying:s.underlying.clone(),risk:s.risk.address.clone(),escrow:s.escrow.address.clone(),
 protocol_receiver:s.admin.clone(),maturity,anchor_apr:450_000,strength:10,fee_bps:30,protocol_share_bps:2000});
 let id=s.env.register(wasm("principal_router").as_slice(),());let r=RouterContractClient::new(&s.env,&id);r.initialize(&s.admin,&pool_id);r
}
#[test]
fn paired_exit_preserves_paid_pending_transferred_ownership_and_actual_sy(){
 let maturity=T0+100;let s=deploy_wasm_stack(maturity);let r=router(&s,maturity);
 let a=Address::generate(&s.env);let b=Address::generate(&s.env);let c=Address::generate(&s.env);let late=Address::generate(&s.env);
 for who in [&a,&b,&c,&late]{grant_user(&s,who);}
 for who in [&a,&b]{let shares=deposit_sy(&s,who,100*SCALE);s.pm.mint(who,&shares);}
 rate(&s,T0+1,12_500_000);
 assert_eq!(s.pm.claim_yield(&a),20*SCALE);
 let qa=r.preview_recombine(&a,&(100*SCALE));assert_eq!(qa.sy_shares,80*SCALE);assert_eq!(qa.pending_yield,0);
 let before=s.sy.balance_of(&a);let returned=r.recombine(&a,&(100*SCALE),&qa.sy_shares,&maturity);
 assert_eq!(returned,qa);assert_eq!(s.sy.balance_of(&a),before+80*SCALE);assert_eq!(s.pm.claim_yield(&a),0);
 // Current recipient gets principal, not the transferor's previously earned yield.
 s.pt.transfer(&b,&c,&(100*SCALE));s.yt.transfer(&b,&c,&(100*SCALE));
 assert_eq!(s.yt.pending_claim(&b),20*SCALE);assert_eq!(s.yt.pending_claim(&c),0);
 let qc=r.recombine_underlying(&c,&(100*SCALE),&(80*SCALE),&maturity);assert_eq!(qc.underlying,80*SCALE);
 assert_eq!(s.pm.claim_yield(&b),20*SCALE);assert_eq!(s.pm.claim_yield(&c),0);
 let deposited=deposit_sy(&s,&late,80*SCALE);let minted=s.pm.mint(&late,&deposited);assert_eq!(minted.pt_minted,100*SCALE);
 let ql=s.pm.recombine(&late,&minted.pt_minted,&(80*SCALE));assert_eq!(ql.pending_yield,0);
 assert_eq!(s.pm.total_recombined_shares(),240*SCALE);assert_eq!(s.pm.total_recombined_underlying(),240*SCALE);
 assert_eq!(s.pm.total_paid_principal(),0);assert_eq!(s.pm.total_paid_yield(),40*SCALE);assert_eq!(s.pm.locked_shares(),0);
 assert_eq!(s.pm.total_pt(),0);assert_eq!(s.pm.total_yt(),0);
 assert_eq!(s.sy.balance_of(&r.address),0);assert_eq!(s.pt.balance(&r.address),0);assert_eq!(s.yt.balance(&r.address),0);
 assert_eq!(token::Client::new(&s.env,&s.underlying).balance(&s.sy.address)+s.pm.total_paid_yield()+qc.underlying,280*SCALE);
 custody(&s);snapshot(&s,"paired-01-owned-principal-and-earned-yield");
}
#[test]
fn partial_pair_keeps_fraction_and_cold_continues_exact_original_contracts(){
 let maturity=T0+100;let s=deploy_wasm_stack(maturity);let a=Address::generate(&s.env);grant_user(&s,&a);
 let shares=deposit_sy(&s,&a,100*SCALE);s.pm.mint(&a,&shares);rate(&s,T0+1,11_000_000);
 let q=s.pm.preview_recombine(&a,&(33*SCALE));
 assert!(q.reward_remainder>0);assert_eq!(q.pending_yield,90_909_090);
 let balance=s.pm.locked_shares();let supply=s.pt.total_supply();
 assert!(s.pm.try_recombine(&a,&(33*SCALE),&(q.sy_shares+1)).is_err());
 assert_eq!(s.pm.locked_shares(),balance);assert_eq!(s.pt.total_supply(),supply);assert_eq!(s.yt.pending_claim(&a),0);
 let result=s.pm.recombine(&a,&(33*SCALE),&q.sy_shares);assert_eq!(q,result);
 assert_eq!(s.yt.reward_remainder(&a),q.reward_remainder);assert_eq!(s.yt.pending_claim(&a),q.pending_yield);
 assert_eq!(s.pt.balance(&a),67*SCALE);assert_eq!(s.yt.balance(&a),67*SCALE);custody(&s);
 snapshot(&s,"paired-02-partial-fraction-preserved");
 let cold=Env::from_snapshot(s.env.to_snapshot());cold.mock_all_auths();cold.budget().reset_unlimited();
 let cv=|address:&Address|Address::try_from_val(&cold,&soroban_sdk::xdr::ScVal::from(address)).unwrap();
 let pm=PrincipalManagerContractClient::new(&cold,&cv(&s.pm.address));let yt=YTTokenContractClient::new(&cold,&cv(&s.yt.address));
 let sy=SYWrapperContractClient::new(&cold,&cv(&s.sy.address));let user=cv(&a);
 assert_eq!(pm.recombination_edition(),1);assert_eq!(yt.reward_remainder(&user),q.reward_remainder);
 let qc=pm.preview_recombine(&user,&(67*SCALE));assert_eq!(qc.pending_yield,q.pending_yield);
 pm.recombine(&user,&(67*SCALE),&qc.sy_shares);
 assert_eq!(yt.balance(&user),0);assert_eq!(yt.reward_remainder(&user),q.reward_remainder);
 assert_eq!(pm.claim_yield(&user),q.pending_yield);assert_eq!(pm.claim_yield(&user),0);
 assert_eq!(pm.locked_shares(),sy.balance_of(&pm.address));assert!(pm.backing_underlying()>=pm.principal_reserve()+yt.total_pending());
 let root=std::env::var("PRINCIPAL_COURSE_ARTIFACTS").unwrap();cold.to_snapshot_file(std::path::Path::new(&root).join("paired-03-cold-complete-exit.json"));
}
#[test]
fn rejected_exit_does_not_burn_pairs_or_drain_backing(){
 let maturity=T0+4000;let s=deploy_wasm_stack(maturity);let r=router(&s,maturity);let a=Address::generate(&s.env);grant_user(&s,&a);
 let shares=deposit_sy(&s,&a,100*SCALE);s.pm.mint(&a,&shares);
 let old=s.pm.locked_shares();
 assert!(s.pm.try_recombine(&a,&(101*SCALE),&0).is_err());
 assert!(r.try_recombine(&a,&SCALE,&0,&(T0-1)).is_err());
 s.pm.set_paused(&s.admin,&true);assert!(s.pm.try_recombine(&a,&SCALE,&0).is_err());s.pm.set_paused(&s.admin,&false);
 s.perm.revoke_asset(&s.admin,&a,&s.pt.address);assert!(s.pm.try_recombine(&a,&SCALE,&0).is_err());s.perm.grant_asset(&s.admin,&a,&s.pt.address);
 s.perm.revoke_asset(&s.admin,&a,&s.yt.address);assert!(s.pm.try_recombine(&a,&SCALE,&0).is_err());s.perm.grant_asset(&s.admin,&a,&s.yt.address);
 s.perm.revoke_account(&s.admin,&a);assert!(s.pm.try_recombine(&a,&SCALE,&0).is_err());s.perm.grant_account(&s.admin,&a);
 s.env.ledger().with_mut(|l|l.timestamp=T0+3601);assert!(s.pm.try_recombine(&a,&SCALE,&0).is_err());
 rate(&s,T0+3602,12_500_000);s.yt.update_yield_index();rate(&s,T0+3603,11_000_000);
 assert!(s.pm.try_recombine(&a,&SCALE,&0).is_err());rate(&s,T0+3604,12_500_000);
 assert_eq!(s.pm.locked_shares(),old);assert_eq!(s.pt.balance(&a),100*SCALE);assert_eq!(s.yt.balance(&a),100*SCALE);
 snapshot(&s,"paired-04-rejected-authorization-rates-and-limits");
 // Actual native SAC burn creates a custody shortfall; no artificial storage mutation.
 token::Client::new(&s.env,&s.underlying).burn(&s.sy.address,&1);
 assert!(s.pm.try_recombine(&a,&SCALE,&0).is_err());assert_eq!(s.pm.locked_shares(),old);assert_eq!(s.pt.balance(&a),100*SCALE);
 token::StellarAssetClient::new(&s.env,&s.underlying).mint(&s.sy.address,&1);
 rate(&s,maturity,12_500_000);assert!(s.pm.try_recombine(&a,&SCALE,&0).is_err());
 let settled=s.pm.redeem(&a,&(100*SCALE),&(100*SCALE));assert_eq!(settled.underlying_from_pt,80*SCALE);assert_eq!(settled.underlying_from_yt,20*SCALE);
 custody(&s);snapshot(&s,"paired-05-loss-rejection-and-original-maturity");
}
