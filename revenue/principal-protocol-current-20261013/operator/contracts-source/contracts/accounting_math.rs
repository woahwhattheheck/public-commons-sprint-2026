//! Checked integer operations shared by the current accounting edition.
use soroban_sdk::{contracterror,panic_with_error,Env,U256};
#[contracterror]
#[derive(Copy,Clone,Debug,Eq,PartialEq)]
#[repr(u32)]
pub enum AccountingError { InvalidAmount=701,Overflow=702 }
pub fn add(e:&Env,a:i128,b:i128)->i128 { a.checked_add(b).unwrap_or_else(||panic_with_error!(e,AccountingError::Overflow)) }
pub fn sub(e:&Env,a:i128,b:i128)->i128 { if a<0||b<0||b>a {panic_with_error!(e,AccountingError::InvalidAmount)} a-b }
pub fn floor(e:&Env,a:i128,b:i128,d:i128)->i128 {
 if a<0||b<0||d<=0 {panic_with_error!(e,AccountingError::InvalidAmount)}
 let q=U256::from_u128(e,a as u128).mul(&U256::from_u128(e,b as u128)).div(&U256::from_u128(e,d as u128));
 let n=q.to_u128().unwrap_or_else(||panic_with_error!(e,AccountingError::Overflow));
 if n>i128::MAX as u128 {panic_with_error!(e,AccountingError::Overflow)} n as i128
}
pub fn ceil(e:&Env,a:i128,b:i128,d:i128)->i128 {
 if a<0||b<0||d<=0 {panic_with_error!(e,AccountingError::InvalidAmount)}
 let p=U256::from_u128(e,a as u128).mul(&U256::from_u128(e,b as u128));
 let den=U256::from_u128(e,d as u128);let q=p.div(&den);
 let n=q.to_u128().unwrap_or_else(||panic_with_error!(e,AccountingError::Overflow));
 let carry=if p.rem_euclid(&den)==U256::from_u128(e,0){0}else{1};
 if n>i128::MAX as u128-carry {panic_with_error!(e,AccountingError::Overflow)} (n+carry) as i128
}

pub const REWARD_SCALE:i128=1_000_000_000_000_000_000_000_000_000_000;
pub const MAX_ACCOUNTING_RATE:i128=1_000_000_000_000_000_000;
/// Conservative underlying-atom numerator per notional atom. O(1), never a float.
pub fn inverse(e:&Env,rate:i128)->i128 {
 if rate<=0||rate>MAX_ACCOUNTING_RATE {panic_with_error!(e,AccountingError::InvalidAmount)}
 ceil(e,10_000_000,REWARD_SCALE,rate)
}
fn narrow(e:&Env,n:U256)->i128 {
 let v=n.to_u128().unwrap_or_else(||panic_with_error!(e,AccountingError::Overflow));
 if v>i128::MAX as u128 {panic_with_error!(e,AccountingError::Overflow)} v as i128
}
fn reward_parts(e:&Env,n:U256)->(i128,i128) {
 let d=U256::from_u128(e,REWARD_SCALE as u128);
 (narrow(e,n.div(&d)),narrow(e,n.rem_euclid(&d)))
}
pub fn reward(e:&Env,balance:i128,delta:i128,remainder:i128)->(i128,i128) {
 if balance<0||delta<0||remainder<0||remainder>=REWARD_SCALE {panic_with_error!(e,AccountingError::InvalidAmount)}
 let n=U256::from_u128(e,balance as u128).mul(&U256::from_u128(e,delta as u128))
   .add(&U256::from_u128(e,remainder as u128));
 reward_parts(e,n)
}
/// Exact floor((pending*Q+fraction)*amount/balance) without a triple-width product.
pub fn proportional_reward(e:&Env,pending:i128,fraction:i128,amount:i128,balance:i128)->(i128,i128) {
 if pending<0||fraction<0||fraction>=REWARD_SCALE||amount<=0||balance<=0||amount>balance {panic_with_error!(e,AccountingError::InvalidAmount)}
 if amount==balance{return (pending,fraction)}
 let n=U256::from_u128(e,pending as u128).mul(&U256::from_u128(e,REWARD_SCALE as u128))
   .add(&U256::from_u128(e,fraction as u128));
 let d=U256::from_u128(e,balance as u128);let a=U256::from_u128(e,amount as u128);
 reward_parts(e,n.div(&d).mul(&a).add(&n.rem_euclid(&d).mul(&a).div(&d)))
}
