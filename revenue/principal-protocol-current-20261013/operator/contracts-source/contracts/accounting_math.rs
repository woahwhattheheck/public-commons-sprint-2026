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
