//! OracleAdapter — admin-submitted reference value feed with monotonic timestamps.
//!
//! # Why the reference value is monotonically non-decreasing
//! The entire PT/YT settlement model is built on the assumption that the reference rate only
//! goes up: `YTToken.update_yield_index` is a no-op unless `now_rate > last_rate` ("YT never
//! accrues negative yield"), and `PrincipalManager`'s PT formula (`pt_amount * SCALE /
//! final_rate`) implicitly assumes `final_rate` is at or above the rate at issuance -- if
//! `final_rate` could fall below it, that formula would release *more* underlying than was
//! ever deposited for that PT, a real insolvency path, not just a pricing inaccuracy. This
//! matches the reference asset this protocol targets first (Ondo's USDY, a Treasury-backed,
//! NAV-appreciating token whose per-unit redemption value does not decrease in normal
//! operation) but does not hold for every conceivable "reference value" an oracle could feed
//! in (a genuine market price, which can fall). Given the settlement math above already,
//! silently, assumes non-decreasing, this contract enforces it explicitly rather than leaving
//! it as an unenforced deployment assumption -- found during an audit review.

#![no_std]

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, panic_with_error, symbol_short, Address,
    Env,
};

#[contracterror]
#[derive(Copy, Clone, Debug, PartialEq)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized = 1,
    Unauthorized = 2,
    InvalidValue = 3,
    TimestampTooOld = 4,
    NotInitialized = 5,
    ValueDecreased = 6,
    InvalidObservation = 7,
}

#[contracttype]
pub enum DataKey {
    Admin,
    Price,
    Timestamp,
    SampleCount,
    Sample(u64),
}

#[contracttype]
#[derive(Clone,Debug,Eq,PartialEq)]
pub struct OracleSample { pub sequence:u64,pub value:i128,pub timestamp:u64,pub observed_at:u64 }

#[contract]
pub struct OracleAdapterContract;

#[contractimpl]
impl OracleAdapterContract {
    pub fn initialize(env: Env, admin: Address) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic_with_error!(&env, Error::AlreadyInitialized);
        }
        admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &admin);
    }

    /// Update the reference value. `caller` must match the stored admin and must authorize.
    pub fn set_reference_value(env: Env, caller: Address, value: i128, timestamp: u64) {
        caller.require_auth();
        let admin: Address = Self::require_admin(&env);
        if caller != admin {
            panic_with_error!(&env, Error::Unauthorized);
        }
        let observed_at=env.ledger().timestamp();
        if timestamp>observed_at || observed_at-timestamp>3_600 {
            panic_with_error!(&env,Error::InvalidObservation);
        }
        if value <= 0 {
            panic_with_error!(&env, Error::InvalidValue);
        }
        let current_price: i128 = env.storage().instance().get(&DataKey::Price).unwrap_or(0);
        if value < current_price {
            panic_with_error!(&env, Error::ValueDecreased);
        }
        let current_ts: u64 = env
            .storage()
            .instance()
            .get(&DataKey::Timestamp)
            .unwrap_or(0u64);
        if timestamp <= current_ts {
            panic_with_error!(&env, Error::TimestampTooOld);
        }
        env.storage().instance().set(&DataKey::Price, &value);
        env.storage()
            .instance()
            .set(&DataKey::Timestamp, &timestamp);
        let sequence:u64=env.storage().instance().get(&DataKey::SampleCount).unwrap_or(0);
        let sequence=sequence.checked_add(1).unwrap_or_else(||panic_with_error!(&env,Error::InvalidObservation));
        let sample=OracleSample{sequence,value,timestamp,observed_at};
        let key=DataKey::Sample(sequence);
        env.storage().persistent().set(&key,&sample);
        let ttl=env.storage().max_ttl();
        env.storage().persistent().extend_ttl(&key,ttl/2,ttl);
        env.storage().instance().set(&DataKey::SampleCount,&sequence);
        env.events()
            .publish((symbol_short!("ref_set"),), (value, timestamp));
    }

    pub fn get_reference_value(env: Env) -> i128 {
        env.storage()
            .instance()
            .get(&DataKey::Price)
            .unwrap_or_else(|| panic_with_error!(&env, Error::NotInitialized))
    }

    pub fn get_reference_timestamp(env: Env) -> u64 {
        env.storage()
            .instance()
            .get(&DataKey::Timestamp)
            .unwrap_or_else(|| panic_with_error!(&env, Error::NotInitialized))
    }

    /// Returns true when the stored timestamp is within `max_stale_seconds` of the ledger clock.
    /// Uses `env.ledger().timestamp()` — callers cannot manipulate this value.
    pub fn is_fresh(env: Env, max_stale_seconds: u64) -> bool {
        let stored_ts: u64 = env
            .storage()
            .instance()
            .get(&DataKey::Timestamp)
            .unwrap_or(0u64);
        let ledger_ts = env.ledger().timestamp();
        if ledger_ts < stored_ts {
            return false;
        }
        ledger_ts - stored_ts <= max_stale_seconds
    }

    /// Single-step admin transfer: current admin authorizes and immediately names a new admin
    /// (no separate acceptance step from the new admin), matching every other contract's
    /// transfer_admin in this codebase.
    pub fn transfer_admin(env: Env, current_admin: Address, new_admin: Address) {
        current_admin.require_auth();
        let admin: Address = Self::require_admin(&env);
        if current_admin != admin {
            panic_with_error!(&env, Error::Unauthorized);
        }
        env.storage().instance().set(&DataKey::Admin, &new_admin);
        env.events()
            .publish((symbol_short!("adm_xfer"),), (current_admin, new_admin));
    }

    pub fn get_admin(env: Env) -> Address {
        Self::require_admin(&env)
    }

    pub fn sample_count(env:Env)->u64 { env.storage().instance().get(&DataKey::SampleCount).unwrap_or(0) }
    pub fn get_sample(env:Env,sequence:u64)->Option<OracleSample> {
        let key=DataKey::Sample(sequence);
        let result=env.storage().persistent().get(&key);
        if result.is_some() { let ttl=env.storage().max_ttl();env.storage().persistent().extend_ttl(&key,ttl/2,ttl); }
        result
    }
    pub fn first_at_or_after(env:Env,timestamp:u64)->Option<OracleSample> {
        let count=Self::sample_count(env.clone());let mut lo=1u64;let mut hi=count;
        let mut found=None;
        while lo<=hi {
            let mid=lo+(hi-lo)/2;
            let sample=Self::get_sample(env.clone(),mid).unwrap_or_else(||panic_with_error!(&env,Error::NotInitialized));
            if sample.timestamp>=timestamp { found=Some(sample);if mid==1{break}hi=mid-1; }
            else {lo=mid+1;}
        }
        found
    }

    // --- internal helpers ---

    fn require_admin(env: &Env) -> Address {
        env.storage()
            .instance()
            .get(&DataKey::Admin)
            .unwrap_or_else(|| panic_with_error!(env, Error::NotInitialized))
    }
}

#[cfg(test)]
mod test {
    use soroban_sdk::{
        testutils::{Address as _, Ledger as _},
        Address, Env,
    };

    use super::{OracleAdapterContract, OracleAdapterContractClient};

    fn setup() -> (Env, OracleAdapterContractClient<'static>, Address) {
        let env = Env::default();
        env.mock_all_auths();
        env.ledger().with_mut(|li|li.timestamp=1_700_001_000);
        let contract_id = env.register_contract(None, OracleAdapterContract);
        let client = OracleAdapterContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        client.initialize(&admin);
        (env, client, admin)
    }

    #[test]
    fn initialize_and_set_price() {
        let (_env, client, admin) = setup();
        client.set_reference_value(&admin, &103_00000000_i128, &1_700_000_000_u64);
        assert_eq!(client.get_reference_value(), 103_00000000_i128);
        assert_eq!(client.get_reference_timestamp(), 1_700_000_000_u64);
    }

    #[test]
    #[should_panic]
    fn value_decrease_rejected() {
        // The entire PT/YT settlement model assumes the reference rate never falls -- see
        // this module's doc comment for why a decrease must be rejected outright, not just
        // priced in.
        let (_env, client, admin) = setup();
        client.set_reference_value(&admin, &10_300_000_i128, &1_700_000_000_u64);
        client.set_reference_value(&admin, &10_200_000_i128, &1_700_001_000_u64);
    }

    #[test]
    fn value_may_stay_equal() {
        // A resubmission at the same price (e.g. a heartbeat refresh with no real price move)
        // must not be treated as a decrease.
        let (_env, client, admin) = setup();
        client.set_reference_value(&admin, &10_300_000_i128, &1_700_000_000_u64);
        client.set_reference_value(&admin, &10_300_000_i128, &1_700_001_000_u64);
        assert_eq!(client.get_reference_value(), 10_300_000_i128);
    }

    #[test]
    #[should_panic]
    fn double_initialize_panics() {
        let (_env, client, admin) = setup();
        client.initialize(&admin);
    }

    #[test]
    #[should_panic]
    fn unauthorized_price_update_panics() {
        let (env, client, admin) = setup();
        client.set_reference_value(&admin, &103_00000000_i128, &1_700_000_000_u64);
        let attacker = Address::generate(&env);
        client.set_reference_value(&attacker, &200_00000000_i128, &1_700_001_000_u64);
    }

    #[test]
    #[should_panic]
    fn stale_timestamp_rejected() {
        let (_env, client, admin) = setup();
        client.set_reference_value(&admin, &103_00000000_i128, &1_700_000_000_u64);
        client.set_reference_value(&admin, &103_00000000_i128, &1_700_000_000_u64);
    }

    #[test]
    #[should_panic]
    fn invalid_price_rejected() {
        let (_env, client, admin) = setup();
        client.set_reference_value(&admin, &0_i128, &1_700_000_000_u64);
    }

    #[test]
    fn admin_transfer() {
        let (env, client, admin) = setup();
        let new_admin = Address::generate(&env);
        client.transfer_admin(&admin, &new_admin);
        assert_eq!(client.get_admin(), new_admin);
    }

    #[test]
    #[should_panic]
    fn unauthorized_transfer_admin_panics() {
        let (env, client, _admin) = setup();
        let impostor = Address::generate(&env);
        let new_admin = Address::generate(&env);
        client.transfer_admin(&impostor, &new_admin);
    }

    #[test]
    fn is_fresh_within_staleness_window() {
        let (env, client, admin) = setup();
        // Ledger at t=1000; oracle set at t=900 → diff=100 ≤ 3600 → fresh.
        env.ledger().with_mut(|li| li.timestamp = 1_000);
        client.set_reference_value(&admin, &10_300_000_i128, &900_u64);
        assert!(client.is_fresh(&3_600_u64));
    }

    #[test]
    fn is_fresh_false_when_stale() {
        let (env, client, admin) = setup();
        // Ledger at t=1000; oracle set at t=1 → diff=999 > 100 → stale.
        env.ledger().with_mut(|li| li.timestamp = 1_000);
        client.set_reference_value(&admin, &10_300_000_i128, &1_u64);
        assert!(!client.is_fresh(&100_u64));
    }

    #[test]
    fn is_fresh_false_before_any_price_set() {
        let (env, client, _admin) = setup();
        // No price ever set → stored timestamp = 0; ledger = 5000; diff > 3600 → not fresh.
        env.ledger().with_mut(|li| li.timestamp = 5_000);
        assert!(!client.is_fresh(&3_600_u64));
    }

    #[test]
    fn is_fresh_at_exact_boundary() {
        let (env, client, admin) = setup();
        // diff == max_stale_seconds exactly → still fresh (≤ not <).
        env.ledger().with_mut(|li| li.timestamp = 1_000);
        client.set_reference_value(&admin, &10_000_000_i128, &600_u64); // diff = 400
        assert!(client.is_fresh(&400_u64)); // 400 ≤ 400 → fresh
        assert!(!client.is_fresh(&399_u64)); // 400 > 399 → stale
    }

    #[test]
    fn future_source_timestamp_is_rejected() {
        let (env,client,admin)=setup();
        env.ledger().with_mut(|li|li.timestamp=1_000);
        assert!(client.try_set_reference_value(&admin,&10_000_000_i128,&5_000_u64).is_err());
        assert_eq!(client.sample_count(),0);
    }
}
