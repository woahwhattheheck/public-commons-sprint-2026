//! Same original Soroban host, actual ten locked Wasm contracts; no deployment.
mod common;
use common::{deploy_wasm_stack,deposit_sy,grant_user,Stack,T0};
use soroban_sdk::{testutils::{Address as _,Ledger as _},token,Address,Env};
use principal_manager::SCALE;
use principal_market_pool::{MarketConfig,MarketPoolContractClient};
use principal_router::RouterContractClient;
fn wasm(name:&str)->std::vec::Vec<u8>{
 let p=std::env::var("PRINCIPAL_CURRENT_WASM").unwrap();
 std::fs::read(std::path::Path::new(&p).join(format!("{name}.wasm"))).unwrap()
}
fn snapshot(s:&Stack,name:&str){
 let p=std::env::var("PRINCIPAL_COURSE_ARTIFACTS").unwrap();
 s.env.to_snapshot_file(std::path::Path::new(&p).join(format!("{name}.json")));
}
fn custody(s:&Stack,p:&MarketPoolContractClient){
 let v=p.reserves();
 assert_eq!(s.pt.balance(&p.address),v.reserve_pt);
 assert_eq!(s.sy.balance_of(&p.address),v.reserve_sy+v.fee_sy+v.creator_sy);
}
#[test]
fn original_accounting_router_swaps_liquidity_fees_recovery_and_cold_maturity(){
 let maturity=T0+31_536_000;let s=deploy_wasm_stack(maturity);
 let pool_id=s.env.register(wasm("principal_market_pool").as_slice(),());
 let p=MarketPoolContractClient::new(&s.env,&pool_id);
 let router_id=s.env.register(wasm("principal_router").as_slice(),());
 let r=RouterContractClient::new(&s.env,&router_id);
 let alice=Address::generate(&s.env);let bob=Address::generate(&s.env);let restricted=Address::generate(&s.env);
 for a in [&alice,&bob,&restricted,&pool_id]{grant_user(&s,a);s.perm.grant_asset(&s.admin,a,&pool_id);}
 s.risk.add_consumer(&s.admin,&pool_id);
 let c=MarketConfig{manager:s.pm.address.clone(),sy:s.sy.address.clone(),pt:s.pt.address.clone(),yt:s.yt.address.clone(),
 oracle:s.oracle.address.clone(),permissioning:s.perm.address.clone(),underlying:s.underlying.clone(),risk:s.risk.address.clone(),escrow:s.escrow.address.clone(),
 protocol_receiver:s.admin.clone(),maturity,anchor_apr:450_000,strength:10,fee_bps:30,protocol_share_bps:2000};
 p.initialize(&s.admin,&c);r.initialize(&s.admin,&pool_id);
 let funded=100_000*SCALE;
 token::StellarAssetClient::new(&s.env,&s.underlying).mint(&alice,&funded);
 let opened=r.tokenize_liquidity(&alice,&funded,&(50_000*SCALE),&(50_000*SCALE),&(50_000*SCALE),&1,&maturity);
 assert_eq!(opened.minted.pt_minted,50_000*SCALE);assert_eq!(p.total_supply(),50_000*SCALE/1000);
 assert_eq!(s.yt.balance(&alice),50_000*SCALE);assert_eq!(s.sy.balance_of(&router_id),0);assert_eq!(s.pt.balance(&router_id),0);custody(&s,&p);
 snapshot(&s,"market-01-original-ten-contracts");
 deposit_sy(&s,&bob,1_000*SCALE);
 let before=s.sy.balance_of(&bob);let q=p.quote_swap(&true,&(100*SCALE));let bought=r.swap_sy_for_pt(&bob,&(100*SCALE),&q.amount_out,&maturity);
 assert_eq!(bought,q);let sold=r.swap_pt_for_sy(&bob,&bought.amount_out,&1,&maturity);
 assert!(s.sy.balance_of(&bob)<=before);assert!(sold.total_fee>0);assert_eq!(sold.gross_amount_out,sold.amount_out+sold.total_fee);custody(&s,&p);
 let frozen=p.reserves();
 assert!(p.try_swap(&bob,&true,&SCALE,&i128::MAX,&maturity).is_err());assert_eq!(p.reserves(),frozen);
 assert!(p.try_swap(&bob,&true,&SCALE,&0,&(T0-1)).is_err());assert_eq!(p.reserves(),frozen);
 s.risk.pause(&s.admin);assert!(p.try_swap(&bob,&true,&SCALE,&0,&maturity).is_err());s.risk.unpause(&s.admin);
 let creator=p.reserves().creator_sy;let protocol=p.reserves().fee_sy;
 // Original current creator changes on SAC admin rotation; protocol destination does not.
 let new_issuer=Address::generate(&s.env);grant_user(&s,&new_issuer);grant_user(&s,&s.admin);
 token::StellarAssetClient::new(&s.env,&s.underlying).set_admin(&new_issuer);
 assert!(p.try_collect_creator_fees(&s.admin).is_err());
 assert_eq!(p.collect_creator_fees(&new_issuer).sy,creator);
 assert_eq!(p.collect_protocol_fees(&s.admin).sy,protocol);custody(&s,&p);
 token::StellarAssetClient::new(&s.env,&s.underlying).set_admin(&s.admin);
 snapshot(&s,"market-02-trades-fees-authentication");
 let moved=p.balance(&alice)/10;p.transfer(&alice,&restricted,&moved);
 let old_lp=p.total_supply();let expect=p.quote_withdrawal(&moved);
 token::StellarAssetClient::new(&s.env,&s.underlying).set_authorized(&restricted,&false);
 assert!(p.try_remove_liquidity(&restricted,&moved,&0,&0,&maturity).is_err());
 let recovered=s.escrow.seize_lp(&s.admin,&pool_id,&restricted,&moved);
 assert_eq!(recovered.pt,expect.pt);assert_eq!(recovered.sy,expect.sy);assert_eq!(recovered.underlying,expect.sy);
 assert_eq!(p.balance(&restricted),0);assert_eq!(p.total_supply(),old_lp-moved);custody(&s,&p);
 snapshot(&s,"market-03-original-escrow-recovery");
 // Same authored future date, fresh original oracle. Curve sample and custody retained.
 s.env.ledger().with_mut(|l|l.timestamp=maturity);
 s.oracle.set_reference_value(&s.admin,&SCALE,&maturity);
 assert!(p.try_quote_swap(&true,&SCALE).is_err());
 let held=p.balance(&alice);let closed=r.remove_liquidity(&alice,&held,&0,&0,&maturity);
 assert_eq!(p.total_supply(),0);assert_eq!(p.reserves().reserve_pt,0);assert_eq!(p.reserves().reserve_sy,0);custody(&s,&p);
 r.redeem(&alice,&closed.pt,&s.yt.balance(&alice),&0,&maturity);
 s.escrow.finalize_pt(&s.admin,&s.pt.balance(&s.escrow.address));
 assert_eq!(s.pt.balance(&pool_id),0);assert_eq!(s.sy.balance_of(&router_id),0);
 snapshot(&s,"market-04-mature-withdrawal");
 let cold=Env::from_snapshot(s.env.to_snapshot());let received=MarketPoolContractClient::new(&cold,&pool_id);
 assert_eq!(received.configuration(),p.configuration());assert_eq!(received.reserves(),p.reserves());
 assert_eq!(received.balance(&alice),0);
 let output=std::env::var("PRINCIPAL_COURSE_ARTIFACTS").unwrap();
 cold.to_snapshot_file(std::path::Path::new(&output).join("market-05-cold-source-reopen.json"));
}
