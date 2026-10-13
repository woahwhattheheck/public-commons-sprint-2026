//! SEP41 YT with conserved underlying backing credit.
//! Current accounting edition 2. This is a new-initialization source selection:
//! balances from the former factor-rebase edition cannot silently infer paid history.
//! Every mint assigns funded underlying credit; settle debits it before creating a
//! pending claim. Transfers move remaining credit after settling both participants.
//! Seizure additionally moves proportional earned pending to the original escrow.
#![no_std]

use soroban_sdk::{
    contract, contractclient, contracterror, contractimpl, contracttype, panic_with_error,
    symbol_short, token, Address, Env, String,
};

#[path="../../accounting_math.rs"] mod accounting_math;
use accounting_math::{add,sub,floor,ceil};

pub const SCALE: i128 = 10_000_000; // 1e7, matches PrincipalManager's SCALE

/// TTL extension applied to every persistent per-user entry (~30 days at 5 s/ledger).
const BALANCE_TTL_LEDGERS: u32 = 518_400;

/// Matches PrincipalManager's staleness window. Without this check, update_yield_index would
/// happily advance the accrual index off a rate the oracle relay stopped refreshing long ago —
/// every other oracle-consuming path in this codebase (PrincipalManager.mint/redeem) checks
/// freshness before using a rate; this one must too, for the same reason.
const MAX_ORACLE_STALENESS_SECS: u64 = 3_600;

// ---------------------------------------------------------------------------
// External contract interfaces
// ---------------------------------------------------------------------------

#[contractclient(name = "PermClient")]
pub trait PermissioningInterface {
    fn is_allowed(env: Env, account: Address) -> bool;
    fn is_allowed_for_asset(env: Env, account: Address, asset: Address) -> bool;
}

#[contractclient(name = "OracleClient")]
pub trait OracleInterface {
    fn get_reference_value(env: Env) -> i128;
    fn is_fresh(env: Env, max_stale_seconds: u64) -> bool;
    fn first_at_or_after(env:Env,timestamp:u64)->Option<OracleSample>;
}

// ---------------------------------------------------------------------------
// Error codes
// ---------------------------------------------------------------------------

#[contracterror]
#[derive(Copy, Clone, Debug, PartialEq)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized = 1,
    Unauthorized = 2,
    NotInitialized = 3,
    ZeroAmount = 4,
    InsufficientBalance = 5,
    InsufficientAllowance = 6,
    PermissionDenied = 7,
    MinterAlreadySet = 8,
    MinterNotSet = 9,
    OracleStale = 10,
    NotAuthorizedOnSac = 11,
    IssuerMismatch = 12,
    RecoveryEscrowAlreadySet = 13,
    NotRecoveryEscrow = 14,
    AccountingEditionRequired = 15,
    InvalidSettlementSample = 16,
    AlreadyMature = 17,
}

// ---------------------------------------------------------------------------
// Storage key schema
// ---------------------------------------------------------------------------

#[contracttype]
pub enum DataKey {
    Admin,
    Minter,
    Permissioning,
    Underlying,     // Address of the underlying SAC, for authorization inheritance
    RecoveryEscrow, // Option<Address>; absent until set_recovery_escrow is called
    Oracle,
    Maturity,
    Name,
    Symbol,
    Decimals,
    TotalSupply,
    AccountingEdition,
    GenesisRate,
    TotalCredit,
    TotalPending,
    TotalClaimed,
    FrozenSample,
    BackingCredit(Address),
    Balance(Address),
    Allowance(Address, Address),
    YieldIndex, // display factor only: floor(genesis_rate*SCALE/current_rate).
    LastOracleRate, // actual authenticated rate, immutable once maturity freezes.
    LastClaimedIndex(Address), // display snapshot; never the payout denominator.
    PendingClaim(Address),     // i128, settled-but-unclaimed yield, underlying units
}

#[contracttype]
#[derive(Clone,Debug,Eq,PartialEq)]
pub struct OracleSample { pub sequence:u64,pub value:i128,pub timestamp:u64,pub observed_at:u64 }
#[contracttype]
#[derive(Clone,Debug,Eq,PartialEq)]
pub struct RecoveryMovement {pub amount:i128,pub backing_credit:i128,pub pending_underlying:i128}
#[contracttype]
#[derive(Clone,Debug,Eq,PartialEq)]
pub struct YieldPosition {
 pub balance:i128,pub backing_credit:i128,pub pending:i128,
 pub current_rate:i128,pub projected_yield:i128,pub last_factor:i128,
}
#[contracttype]
#[derive(Clone)]
pub struct AllowanceValue {
    pub amount: i128,
    pub expiration_ledger: u32,
}

// ---------------------------------------------------------------------------
// Contract
// ---------------------------------------------------------------------------

#[contract]
pub struct YTTokenContract;

#[contractimpl]
impl YTTokenContract {
    /// `admin` must be the underlying SAC's actual admin and must authorize this call.
    pub fn initialize(
        env: Env,
        admin: Address,
        permissioning: Address,
        underlying: Address,
        oracle: Address,
        maturity: u64,
        name: String,
        symbol: String,
        decimals: u32,
    ) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic_with_error!(&env, Error::AlreadyInitialized);
        }
        admin.require_auth();
        let sac_admin = token::StellarAssetClient::new(&env, &underlying).admin();
        if admin != sac_admin {
            panic_with_error!(&env, Error::IssuerMismatch);
        }

        // Genesis rate: read live from the oracle, not hardcoded to SCALE. If the market is
        // created when the real rate is already above SCALE (e.g. onboarding an
        // already-appreciated asset, or simply redeploying later in an asset's life), hardcoding
        // SCALE here would make the very first `update_yield_index` call treat the gap between
        // SCALE and the real rate as yield accrued since genesis -- overpaying whoever holds YT
        // at that moment for appreciation that happened before their position ever existed.
        // Requiring freshness here too catches deploying a market against a stale feed.
        let oracle_client = OracleClient::new(&env, &oracle);
        if !oracle_client.is_fresh(&MAX_ORACLE_STALENESS_SECS) {
            panic_with_error!(&env, Error::OracleStale);
        }
        let genesis_rate = oracle_client.get_reference_value();
        if genesis_rate<=0 || maturity<=env.ledger().timestamp() || decimals!=7 {
            panic_with_error!(&env,Error::InvalidSettlementSample);
        }
        env.storage().instance().set(&DataKey::AccountingEdition,&2u32);
        env.storage().instance().set(&DataKey::GenesisRate,&genesis_rate);
        env.storage().instance().set(&DataKey::TotalCredit,&0i128);
        env.storage().instance().set(&DataKey::TotalPending,&0i128);
        env.storage().instance().set(&DataKey::TotalClaimed,&0i128);

        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage()
            .instance()
            .set(&DataKey::Permissioning, &permissioning);
        env.storage()
            .instance()
            .set(&DataKey::Underlying, &underlying);
        env.storage().instance().set(&DataKey::Oracle, &oracle);
        env.storage().instance().set(&DataKey::Maturity, &maturity);
        env.storage().instance().set(&DataKey::Name, &name);
        env.storage().instance().set(&DataKey::Symbol, &symbol);
        env.storage().instance().set(&DataKey::Decimals, &decimals);
        env.storage().instance().set(&DataKey::TotalSupply, &0_i128);
        // Genesis factor is always exactly SCALE (representing "zero elapsed appreciation from
        // this contract's own genesis_rate"); what changes is the baseline it's measured against.
        env.storage().instance().set(&DataKey::YieldIndex, &SCALE);
        env.storage()
            .instance()
            .set(&DataKey::LastOracleRate, &genesis_rate);
    }

    pub fn set_minter(env: Env, admin: Address, minter: Address) {
        Self::assert_admin(&env, &admin);
        if env.storage().instance().has(&DataKey::Minter) {
            panic_with_error!(&env, Error::MinterAlreadySet);
        }
        env.storage().instance().set(&DataKey::Minter, &minter);
        env.events().publish((symbol_short!("min_set"),), minter);
    }

    /// One-time wiring of the RecoveryEscrow contract authorized to call `seize`.
    pub fn set_recovery_escrow(env: Env, admin: Address, escrow: Address) {
        Self::assert_admin(&env, &admin);
        if env.storage().instance().has(&DataKey::RecoveryEscrow) {
            panic_with_error!(&env, Error::RecoveryEscrowAlreadySet);
        }
        env.storage()
            .instance()
            .set(&DataKey::RecoveryEscrow, &escrow);
        env.events().publish((symbol_short!("esc_set"),), escrow);
    }

    // --- SEP-41 token interface ---

    pub fn transfer(env: Env, from: Address, to: Address, amount: i128) {
        from.require_auth();
        if amount <= 0 {
            panic_with_error!(&env, Error::ZeroAmount);
        }
        // Both sides checked — see PTToken::transfer for why checking only `to` would let a
        // revoked holder dump YT before being frozen.
        Self::assert_sac_authorized(&env, &from);
        Self::assert_sac_authorized(&env, &to);
        Self::assert_permitted(&env, &from);
        Self::assert_permitted(&env, &to);

        let from_balance = Self::get_balance(&env, &from);
        if from_balance < amount {
            panic_with_error!(&env, Error::InsufficientBalance);
        }
        Self::update_yield_index(env.clone());
        Self::settle(&env, &from);
        Self::settle(&env, &to);

        Self::move_credit(&env,&from,&to,amount,from_balance,false);
        Self::set_balance(&env, &from, sub(&env,from_balance,amount));
        let to_balance = Self::get_balance(&env, &to);
        Self::set_balance(&env, &to, add(&env,to_balance,amount));

        env.events()
            .publish((symbol_short!("transfer"),), (from, to, amount));
    }

    pub fn transfer_from(env: Env, spender: Address, from: Address, to: Address, amount: i128) {
        spender.require_auth();
        if amount <= 0 {
            panic_with_error!(&env, Error::ZeroAmount);
        }
        Self::assert_sac_authorized(&env, &from);
        Self::assert_sac_authorized(&env, &to);
        Self::assert_permitted(&env, &from);
        Self::assert_permitted(&env, &to);

        let allowance = Self::get_allowance(&env, &from, &spender);
        if allowance.amount < amount || allowance.expiration_ledger < env.ledger().sequence() {
            panic_with_error!(&env, Error::InsufficientAllowance);
        }
        let from_balance = Self::get_balance(&env, &from);
        if from_balance < amount {
            panic_with_error!(&env, Error::InsufficientBalance);
        }
        Self::update_yield_index(env.clone());
        Self::settle(&env, &from);
        Self::settle(&env, &to);

        Self::move_credit(&env,&from,&to,amount,from_balance,false);
        Self::set_balance(&env, &from, sub(&env,from_balance,amount));
        let to_balance = Self::get_balance(&env, &to);
        Self::set_balance(&env, &to, add(&env,to_balance,amount));
        Self::set_allowance(
            &env,
            &from,
            &spender,
            allowance.amount - amount,
            allowance.expiration_ledger,
        );

        env.events()
            .publish((symbol_short!("transfer"),), (from, to, amount));
    }

    pub fn approve(
        env: Env,
        from: Address,
        spender: Address,
        amount: i128,
        expiration_ledger: u32,
    ) {
        from.require_auth();
        if amount < 0 {
            panic_with_error!(&env, Error::ZeroAmount);
        }
        Self::set_allowance(&env, &from, &spender, amount, expiration_ledger);
        env.events().publish(
            (symbol_short!("approve"),),
            (from, spender, amount, expiration_ledger),
        );
    }

    pub fn allowance(env: Env, from: Address, spender: Address) -> i128 {
        Self::get_allowance(&env, &from, &spender).amount
    }

    pub fn balance(env: Env, account: Address) -> i128 {
        Self::get_balance(&env, &account)
    }

    pub fn decimals(env: Env) -> u32 {
        env.storage()
            .instance()
            .get(&DataKey::Decimals)
            .unwrap_or(0)
    }

    pub fn name(env: Env) -> String {
        env.storage()
            .instance()
            .get(&DataKey::Name)
            .unwrap_or_else(|| panic_with_error!(&env, Error::NotInitialized))
    }

    pub fn symbol(env: Env) -> String {
        env.storage()
            .instance()
            .get(&DataKey::Symbol)
            .unwrap_or_else(|| panic_with_error!(&env, Error::NotInitialized))
    }

    // --- minter-only ---

    pub fn mint(env: Env, to: Address, amount: i128) {
        let minter = Self::require_minter(&env);
        minter.require_auth();
        if amount <= 0 {
            panic_with_error!(&env, Error::ZeroAmount);
        }
        Self::assert_sac_authorized(&env, &to);
        Self::assert_permitted(&env, &to);
        if env.ledger().timestamp()>=Self::maturity(env.clone()){panic_with_error!(&env,Error::AlreadyMature)}
        Self::update_yield_index(env.clone());
        Self::settle(&env, &to);
        let rate=Self::accounting_rate(env.clone());
        let credit=ceil(&env,amount,SCALE,rate);
        Self::set_credit(&env,&to,add(&env,Self::credit(&env,&to),credit));
        let total_credit=Self::total_backing_credit(env.clone());
        env.storage().instance().set(&DataKey::TotalCredit,&add(&env,total_credit,credit));

        let bal = Self::get_balance(&env, &to);
        Self::set_balance(&env, &to, add(&env,bal,amount));
        let total: i128 = env
            .storage()
            .instance()
            .get(&DataKey::TotalSupply)
            .unwrap_or(0);
        env.storage()
            .instance()
            .set(&DataKey::TotalSupply, &add(&env,total,amount));

        env.events().publish((symbol_short!("mint"),), (to, amount));
    }

    pub fn burn(env: Env, from: Address, amount: i128) {
        let minter = Self::require_minter(&env);
        minter.require_auth();
        if amount <= 0 {
            panic_with_error!(&env, Error::ZeroAmount);
        }
        let bal = Self::get_balance(&env, &from);
        if bal < amount {
            panic_with_error!(&env, Error::InsufficientBalance);
        }
        Self::update_yield_index(env.clone());
        Self::settle(&env, &from);
        let credit=Self::credit(&env,&from);
        let retired=if amount==bal {credit}else{floor(&env,credit,amount,bal)};
        Self::set_credit(&env,&from,sub(&env,credit,retired));
        env.storage().instance().set(&DataKey::TotalCredit,&sub(&env,Self::total_backing_credit(env.clone()),retired));
        Self::set_balance(&env, &from, sub(&env,bal,amount));
        let total: i128 = env
            .storage()
            .instance()
            .get(&DataKey::TotalSupply)
            .unwrap_or(0);
        env.storage()
            .instance()
            .set(&DataKey::TotalSupply, &sub(&env,total,amount));

        env.events()
            .publish((symbol_short!("burn"),), (from, amount));
    }

    // --- compliance recovery (seize) ---

    /// Forcibly move `amount` from `account`'s YT balance to the caller's own balance, without
    /// `account`'s authorization. Callable only by the configured `RecoveryEscrow` — see
    /// `SYWrapper::seize` for the full rationale. Settles both sides' pending yield first, same
    /// as any other balance-changing path. The seized fraction of earned pending yield
    /// moves with its remaining backing credit into the authenticated recovery escrow.
    pub fn seize(env:Env,caller:Address,account:Address,amount:i128)->i128 {
        Self::seize_position(env,caller,account,amount).amount
    }
    pub fn seize_position(env: Env, caller: Address, account: Address, amount: i128) -> RecoveryMovement {
        caller.require_auth();
        let escrow = Self::require_escrow(&env);
        if caller != escrow {
            panic_with_error!(&env, Error::NotRecoveryEscrow);
        }
        if amount <= 0 || caller == account {
            panic_with_error!(&env, Error::ZeroAmount);
        }

        let bal = Self::get_balance(&env, &account);
        if bal < amount {
            panic_with_error!(&env, Error::InsufficientBalance);
        }
        Self::update_yield_index(env.clone());
        Self::settle(&env, &account);
        Self::settle(&env, &caller);

        let credit=Self::credit(&env,&account);
        let pending=Self::pending_claim(env.clone(),account.clone());
        let moved_credit=if amount==bal{credit}else{floor(&env,credit,amount,bal)};
        let moved_pending=if amount==bal{pending}else{floor(&env,pending,amount,bal)};
        Self::move_credit(&env,&account,&caller,amount,bal,true);
        Self::set_balance(&env, &account, sub(&env,bal,amount));
        let to_balance = Self::get_balance(&env, &caller);
        Self::set_balance(&env, &caller, add(&env,to_balance,amount));

        env.events()
            .publish((symbol_short!("seize"),), (caller, account, amount));
        RecoveryMovement{amount,backing_credit:moved_credit,pending_underlying:moved_pending}
    }

    // --- yield accrual ---

    /// Permissionless refresh of the actual rate and display-only genesis factor.
    /// Before maturity this requires a fresh oracle observation. At maturity the
    /// first authenticated, timely sample at or after the boundary is frozen once.
    /// Accrual is calculated from each holder's remaining funded underlying credit;
    /// this display factor never rebases principal after an earlier yield claim.
    pub fn update_yield_index(env: Env) {
        Self::assert_edition(&env);
        let frozen:Option<OracleSample>=env.storage().instance().get(&DataKey::FrozenSample);
        if frozen.is_some(){return}
        let oracle_addr:Address=env.storage().instance().get(&DataKey::Oracle).unwrap();
        let oracle=OracleClient::new(&env,&oracle_addr);
        let maturity=Self::maturity(env.clone());
        let rate=if env.ledger().timestamp()>=maturity {
            let sample=oracle.first_at_or_after(&maturity).unwrap_or_else(||panic_with_error!(&env,Error::InvalidSettlementSample));
            if sample.value<=0||sample.timestamp<maturity||sample.timestamp-maturity>MAX_ORACLE_STALENESS_SECS
              ||sample.observed_at<sample.timestamp||sample.observed_at-sample.timestamp>MAX_ORACLE_STALENESS_SECS
              ||sample.observed_at>env.ledger().timestamp() {
                panic_with_error!(&env,Error::InvalidSettlementSample)
            }
            env.storage().instance().set(&DataKey::FrozenSample,&sample);
            env.events().publish((symbol_short!("y_final"),),sample.clone());
            sample.value
        }else{
            if !oracle.is_fresh(&MAX_ORACLE_STALENESS_SECS){panic_with_error!(&env,Error::OracleStale)}
            oracle.get_reference_value()
        };
        let last:i128=env.storage().instance().get(&DataKey::LastOracleRate).unwrap();
        if rate<last||rate<=0 {panic_with_error!(&env,Error::InvalidSettlementSample)}
        let genesis:i128=env.storage().instance().get(&DataKey::GenesisRate).unwrap();
        let factor=floor(&env,genesis,SCALE,rate);
        env.storage().instance().set(&DataKey::YieldIndex,&factor);
        env.storage().instance().set(&DataKey::LastOracleRate,&rate);
        env.events().publish((symbol_short!("idx_up"),),(factor,rate));
    }

    /// Settles `from`'s pending yield up to the current index, then zeroes and returns it.
    /// Callable only by the registered minter (`PrincipalManager`), which is responsible for
    /// converting the returned amount into a real underlying payment via `SYWrapper.withdraw`
    /// in the same call -- see this module's doc comment (H-03).
    pub fn claim_yield(env: Env, caller: Address, from: Address) -> i128 {
        let amount=Self::settle_yield(env.clone(),caller.clone(),from.clone());
        Self::consume_yield(env,caller,from,amount);
        amount
    }

    /// Display-only floor(genesis_rate*SCALE/current_rate), frozen at maturity.
    /// Financial entitlement uses backing_credit and pending, not this factor.
    pub fn accrued_yield_index(env: Env) -> i128 {
        env.storage()
            .instance()
            .get(&DataKey::YieldIndex)
            .unwrap_or(SCALE)
    }

    pub fn last_claimed_index(env: Env, account: Address) -> i128 {
        env.storage()
            .persistent()
            .get(&DataKey::LastClaimedIndex(account))
            .unwrap_or(SCALE)
    }

    pub fn pending_claim(env: Env, account: Address) -> i128 {
        env.storage()
            .persistent()
            .get(&DataKey::PendingClaim(account))
            .unwrap_or(0)
    }

    // --- views ---

    pub fn total_supply(env: Env) -> i128 {
        env.storage()
            .instance()
            .get(&DataKey::TotalSupply)
            .unwrap_or(0)
    }

    pub fn maturity(env: Env) -> u64 {
        env.storage()
            .instance()
            .get(&DataKey::Maturity)
            .unwrap_or_else(|| panic_with_error!(&env, Error::NotInitialized))
    }

    pub fn minter(env: Env) -> Address {
        Self::require_minter(&env)
    }

    pub fn get_admin(env: Env) -> Address {
        Self::require_admin(&env)
    }

    pub fn recovery_escrow(env: Env) -> Address {
        Self::require_escrow(&env)
    }

    pub fn underlying_address(env: Env) -> Address {
        env.storage()
            .instance()
            .get(&DataKey::Underlying)
            .unwrap_or_else(|| panic_with_error!(&env, Error::NotInitialized))
    }

    pub fn permissioning_address(env: Env) -> Address {
        env.storage()
            .instance()
            .get(&DataKey::Permissioning)
            .unwrap_or_else(|| panic_with_error!(&env, Error::NotInitialized))
    }

    pub fn oracle_address(env: Env) -> Address {
        env.storage()
            .instance()
            .get(&DataKey::Oracle)
            .unwrap_or_else(|| panic_with_error!(&env, Error::NotInitialized))
    }

    /// Explicit accrued-yield recovery, including former holders with zero YT.
    /// The configured escrow authenticates the current SAC issuer and deauthorization.
    pub fn seize_pending(env:Env,caller:Address,account:Address,amount:i128)->i128 {
        caller.require_auth();
        if caller!=Self::require_escrow(&env){panic_with_error!(&env,Error::NotRecoveryEscrow)}
        if amount<=0||caller==account{panic_with_error!(&env,Error::ZeroAmount)}
        Self::update_yield_index(env.clone());Self::settle(&env,&account);Self::settle(&env,&caller);
        let pending=Self::pending_claim(env.clone(),account.clone());
        if amount>pending{panic_with_error!(&env,Error::InsufficientBalance)}
        Self::set_pending(&env,&account,sub(&env,pending,amount));
        Self::set_pending(&env,&caller,add(&env,Self::pending_claim(env.clone(),caller.clone()),amount));
        env.events().publish((symbol_short!("y_pseize"),),(caller,account,amount));amount
    }

    pub fn settle_yield(env:Env,caller:Address,from:Address)->i128 {
        caller.require_auth();
        if caller!=Self::require_minter(&env){panic_with_error!(&env,Error::Unauthorized)}
        Self::update_yield_index(env.clone());Self::settle(&env,&from);
        Self::pending_claim(env,from)
    }
    pub fn consume_yield(env:Env,caller:Address,from:Address,amount:i128) {
        caller.require_auth();
        if caller!=Self::require_minter(&env){panic_with_error!(&env,Error::Unauthorized)}
        let pending=Self::pending_claim(env.clone(),from.clone());
        if amount<0||amount>pending {panic_with_error!(&env,Error::InsufficientBalance)}
        Self::set_pending(&env,&from,sub(&env,pending,amount));
        env.storage().instance().set(&DataKey::TotalPending,&sub(&env,Self::total_pending(env.clone()),amount));
        env.storage().instance().set(&DataKey::TotalClaimed,&add(&env,Self::total_claimed(env.clone()),amount));
        env.events().publish((symbol_short!("claim"),),(from,amount));
    }
    pub fn accounting_edition(env:Env)->u32 { env.storage().instance().get(&DataKey::AccountingEdition).unwrap_or(0) }
    pub fn accounting_rate(env:Env)->i128 { Self::assert_edition(&env);env.storage().instance().get(&DataKey::LastOracleRate).unwrap() }
    pub fn maturity_sample(env:Env)->Option<OracleSample> {env.storage().instance().get(&DataKey::FrozenSample)}
    pub fn total_backing_credit(env:Env)->i128 {env.storage().instance().get(&DataKey::TotalCredit).unwrap_or(0)}
    pub fn total_pending(env:Env)->i128 {env.storage().instance().get(&DataKey::TotalPending).unwrap_or(0)}
    pub fn total_claimed(env:Env)->i128 {env.storage().instance().get(&DataKey::TotalClaimed).unwrap_or(0)}
    pub fn backing_credit(env:Env,account:Address)->i128 {Self::credit(&env,&account)}
    pub fn yield_position(env:Env,account:Address)->YieldPosition {
        let balance=Self::get_balance(&env,&account);let backing_credit=Self::credit(&env,&account);
        let current_rate=Self::accounting_rate(env.clone());let protected=ceil(&env,balance,SCALE,current_rate);
        YieldPosition{balance,backing_credit,pending:Self::pending_claim(env.clone(),account.clone()),current_rate,
          projected_yield:if backing_credit>protected{backing_credit-protected}else{0},
          last_factor:Self::last_claimed_index(env.clone(),account)}
    }

    // --- internal helpers ---
    fn assert_edition(env:&Env) { if Self::accounting_edition(env.clone())!=2 {panic_with_error!(env,Error::AccountingEditionRequired)} }
    fn credit(env:&Env,account:&Address)->i128 {env.storage().persistent().get(&DataKey::BackingCredit(account.clone())).unwrap_or(0)}
    fn set_credit(env:&Env,account:&Address,value:i128) {
        let key=DataKey::BackingCredit(account.clone());env.storage().persistent().set(&key,&value);
        let ttl=env.storage().max_ttl();env.storage().persistent().extend_ttl(&key,ttl/2,ttl);
    }
    fn set_pending(env:&Env,account:&Address,value:i128) {
        let key=DataKey::PendingClaim(account.clone());env.storage().persistent().set(&key,&value);
        let ttl=env.storage().max_ttl();env.storage().persistent().extend_ttl(&key,ttl/2,ttl);
    }
    fn move_credit(env:&Env,from:&Address,to:&Address,amount:i128,balance:i128,recovery:bool) {
        if from==to{return}
        let credit=Self::credit(env,from);
        let moved=if amount==balance{credit}else{floor(env,credit,amount,balance)};
        Self::set_credit(env,from,sub(env,credit,moved));
        Self::set_credit(env,to,add(env,Self::credit(env,to),moved));
        if recovery {
            let pending=Self::pending_claim(env.clone(),from.clone());
            let moved_pending=if amount==balance{pending}else{floor(env,pending,amount,balance)};
            Self::set_pending(env,from,sub(env,pending,moved_pending));
            Self::set_pending(env,to,add(env,Self::pending_claim(env.clone(),to.clone()),moved_pending));
            env.events().publish((symbol_short!("y_recover"),),(from.clone(),to.clone(),amount,moved,moved_pending));
        }
    }


    /// Settle before every balance mutation. Reserve ceil(notional*SCALE/rate)
    /// from this holder's remaining funded credit; move only the excess into
    /// earned pending, debiting that credit first. A later claim cannot recreate
    /// the same yield, and zero-balance accounts retain previously earned pending.
    /// LastClaimedIndex is retained solely as an observable display snapshot.
    fn settle(env: &Env, account: &Address) {
        Self::assert_edition(env);
        let credit=Self::credit(env,account);
        let balance=Self::get_balance(env,account);
        let protected=ceil(env,balance,SCALE,Self::accounting_rate(env.clone()));
        let earned=if credit>protected{credit-protected}else{0};
        if earned>0 {
            Self::set_credit(env,account,sub(env,credit,earned));
            env.storage().instance().set(&DataKey::TotalCredit,&sub(env,Self::total_backing_credit(env.clone()),earned));
            let pending=Self::pending_claim(env.clone(),account.clone());
            Self::set_pending(env,account,add(env,pending,earned));
            env.storage().instance().set(&DataKey::TotalPending,&add(env,Self::total_pending(env.clone()),earned));
        }
        let key=DataKey::LastClaimedIndex(account.clone());
        env.storage().persistent().set(&key,&Self::accrued_yield_index(env.clone()));
        let ttl=env.storage().max_ttl();env.storage().persistent().extend_ttl(&key,ttl/2,ttl);
    }

    fn assert_permitted(env: &Env, account: &Address) {
        let perm_addr: Address = env
            .storage()
            .instance()
            .get(&DataKey::Permissioning)
            .unwrap_or_else(|| panic_with_error!(env, Error::NotInitialized));
        let client = PermClient::new(env, &perm_addr);
        if !client.is_allowed(account) {
            panic_with_error!(env, Error::PermissionDenied);
        }
        if !client.is_allowed_for_asset(account, &env.current_contract_address()) {
            panic_with_error!(env, Error::PermissionDenied);
        }
    }

    fn assert_sac_authorized(env: &Env, account: &Address) {
        let underlying: Address = env
            .storage()
            .instance()
            .get(&DataKey::Underlying)
            .unwrap_or_else(|| panic_with_error!(env, Error::NotInitialized));
        if !token::StellarAssetClient::new(env, &underlying).authorized(account) {
            panic_with_error!(env, Error::NotAuthorizedOnSac);
        }
    }

    fn require_minter(env: &Env) -> Address {
        env.storage()
            .instance()
            .get(&DataKey::Minter)
            .unwrap_or_else(|| panic_with_error!(env, Error::MinterNotSet))
    }

    fn require_escrow(env: &Env) -> Address {
        env.storage()
            .instance()
            .get(&DataKey::RecoveryEscrow)
            .unwrap_or_else(|| panic_with_error!(env, Error::NotRecoveryEscrow))
    }

    fn require_admin(env: &Env) -> Address {
        env.storage()
            .instance()
            .get(&DataKey::Admin)
            .unwrap_or_else(|| panic_with_error!(env, Error::NotInitialized))
    }

    fn assert_admin(env: &Env, caller: &Address) {
        caller.require_auth();
        if *caller != Self::require_admin(env) {
            panic_with_error!(env, Error::Unauthorized);
        }
    }

    fn get_balance(env: &Env, account: &Address) -> i128 {
        env.storage()
            .persistent()
            .get(&DataKey::Balance(account.clone()))
            .unwrap_or(0)
    }

    fn set_balance(env: &Env, account: &Address, amount: i128) {
        let key = DataKey::Balance(account.clone());
        env.storage().persistent().set(&key, &amount);
        env.storage()
            .persistent()
            .extend_ttl(&key, BALANCE_TTL_LEDGERS, BALANCE_TTL_LEDGERS);
    }

    fn get_allowance(env: &Env, from: &Address, spender: &Address) -> AllowanceValue {
        env.storage()
            .persistent()
            .get(&DataKey::Allowance(from.clone(), spender.clone()))
            .unwrap_or(AllowanceValue {
                amount: 0,
                expiration_ledger: 0,
            })
    }

    fn set_allowance(
        env: &Env,
        from: &Address,
        spender: &Address,
        amount: i128,
        expiration_ledger: u32,
    ) {
        let key = DataKey::Allowance(from.clone(), spender.clone());
        env.storage().persistent().set(
            &key,
            &AllowanceValue {
                amount,
                expiration_ledger,
            },
        );
        env.storage()
            .persistent()
            .extend_ttl(&key, BALANCE_TTL_LEDGERS, BALANCE_TTL_LEDGERS);
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod test {
    use soroban_sdk::{
        testutils::{Address as _, IssuerFlags, Ledger as _},
        token, Address, Env, String,
    };

    use principal_oracle_adapter::{OracleAdapterContract, OracleAdapterContractClient};
    use principal_permissioning::{PermissioningContract, PermissioningContractClient};

    use super::{YTTokenContract, YTTokenContractClient, SCALE};

    const T0: u64 = 1_000;

    struct Fixture {
        env: Env,
        client: YTTokenContractClient<'static>,
        admin: Address,
        underlying: Address,
        perm: PermissioningContractClient<'static>,
        perm_admin: Address,
        oracle: OracleAdapterContractClient<'static>,
        oracle_admin: Address,
        yt_id: Address,
    }

    fn setup() -> Fixture {
        let env = Env::default();
        env.mock_all_auths();
        env.ledger().with_mut(|li| li.timestamp = T0);

        let perm_id = env.register_contract(None, PermissioningContract);
        let perm = PermissioningContractClient::new(&env, &perm_id);
        let perm_admin = Address::generate(&env);
        perm.initialize(&perm_admin);

        let oracle_id = env.register_contract(None, OracleAdapterContract);
        let oracle = OracleAdapterContractClient::new(&env, &oracle_id);
        let oracle_admin = Address::generate(&env);
        oracle.initialize(&oracle_admin);
        oracle.set_reference_value(&oracle_admin, &SCALE, &T0);

        // admin doubles as the underlying SAC's real admin, satisfying the issuer-match check.
        // RevocableFlag lets tests simulate deauthorization.
        let admin = Address::generate(&env);
        let underlying_sac = env.register_stellar_asset_contract_v2(admin.clone());
        underlying_sac.issuer().set_flag(IssuerFlags::RevocableFlag);
        let underlying = underlying_sac.address();

        let yt_id = env.register_contract(None, YTTokenContract);
        let client = YTTokenContractClient::new(&env, &yt_id);
        client.initialize(
            &admin,
            &perm_id,
            &underlying,
            &oracle_id,
            &u64::MAX,
            &String::from_str(&env, "Yield Token USDY"),
            &String::from_str(&env, "YT-USDY"),
            &7,
        );

        Fixture {
            env,
            client,
            admin,
            underlying,
            perm,
            perm_admin,
            oracle,
            oracle_admin,
            yt_id,
        }
    }

    fn grant(f: &Fixture, user: &Address) {
        f.perm.grant_account(&f.perm_admin, user);
        f.perm.grant_asset(&f.perm_admin, user, &f.yt_id);
        token::StellarAssetClient::new(&f.env, &f.underlying).set_authorized(user, &true);
    }

    #[test]
    #[should_panic]
    fn initialize_rejects_admin_not_matching_sac_admin() {
        let env = Env::default();
        env.mock_all_auths();
        env.ledger().with_mut(|li| li.timestamp = T0);

        let perm_id = env.register_contract(None, PermissioningContract);
        let real_sac_admin = Address::generate(&env);
        PermissioningContractClient::new(&env, &perm_id).initialize(&real_sac_admin);

        let oracle_id = env.register_contract(None, OracleAdapterContract);
        OracleAdapterContractClient::new(&env, &oracle_id).initialize(&real_sac_admin);

        let underlying = env
            .register_stellar_asset_contract_v2(real_sac_admin.clone())
            .address();

        let impostor = Address::generate(&env);
        let yt_id = env.register_contract(None, YTTokenContract);
        let client = YTTokenContractClient::new(&env, &yt_id);
        client.initialize(
            &impostor,
            &perm_id,
            &underlying,
            &oracle_id,
            &u64::MAX,
            &String::from_str(&env, "Yield Token USDY"),
            &String::from_str(&env, "YT-USDY"),
            &7,
        );
    }

    #[test]
    #[should_panic]
    fn initialize_rejects_stale_oracle() {
        let env = Env::default();
        env.mock_all_auths();
        env.ledger().with_mut(|li| li.timestamp = T0 + 3_601);

        let perm_id = env.register_contract(None, PermissioningContract);
        let admin = Address::generate(&env);
        PermissioningContractClient::new(&env, &perm_id).initialize(&admin);

        let oracle_id = env.register_contract(None, OracleAdapterContract);
        let oracle = OracleAdapterContractClient::new(&env, &oracle_id);
        oracle.initialize(&admin);
        oracle.set_reference_value(&admin, &SCALE, &T0); // stale by the time we initialize below

        let underlying = env.register_stellar_asset_contract_v2(admin.clone()).address();

        let yt_id = env.register_contract(None, YTTokenContract);
        YTTokenContractClient::new(&env, &yt_id).initialize(
            &admin,
            &perm_id,
            &underlying,
            &oracle_id,
            &u64::MAX,
            &String::from_str(&env, "Yield Token USDY"),
            &String::from_str(&env, "YT-USDY"),
            &7,
        );
    }

    #[test]
    fn genesis_above_scale_does_not_overpay_first_mint() {
        // H-01 regression: if a market is created when the real oracle rate is already above
        // SCALE (e.g. onboarding an asset that has already appreciated, or simply redeploying
        // later in its life), the very first mint must not receive credit for the gap between
        // SCALE and the real genesis rate -- that "yield" was never earned by anyone holding
        // this specific YT.
        let env = Env::default();
        env.mock_all_auths();
        env.ledger().with_mut(|li| li.timestamp = T0);

        let perm_id = env.register_contract(None, PermissioningContract);
        let perm = PermissioningContractClient::new(&env, &perm_id);
        let perm_admin = Address::generate(&env);
        perm.initialize(&perm_admin);

        let oracle_id = env.register_contract(None, OracleAdapterContract);
        let oracle = OracleAdapterContractClient::new(&env, &oracle_id);
        let admin = Address::generate(&env);
        oracle.initialize(&admin);
        // Real rate is already 1.05 at market genesis -- not SCALE.
        oracle.set_reference_value(&admin, &10_500_000_i128, &T0);

        let underlying_sac = env.register_stellar_asset_contract_v2(admin.clone());
        underlying_sac.issuer().set_flag(IssuerFlags::RevocableFlag);
        let underlying = underlying_sac.address();

        let yt_id = env.register_contract(None, YTTokenContract);
        let client = YTTokenContractClient::new(&env, &yt_id);
        client.initialize(
            &admin,
            &perm_id,
            &underlying,
            &oracle_id,
            &u64::MAX,
            &String::from_str(&env, "Yield Token USDY"),
            &String::from_str(&env, "YT-USDY"),
            &7,
        );

        let minter = Address::generate(&env);
        client.set_minter(&admin, &minter);
        let user = Address::generate(&env);
        perm.grant_account(&perm_admin, &user);
        perm.grant_asset(&perm_admin, &user, &yt_id);
        token::StellarAssetClient::new(&env, &underlying).set_authorized(&user, &true);

        client.mint(&user, &(1_000 * SCALE));

        // No update_yield_index has run yet, and the rate hasn't moved since genesis --
        // the first mint must not be able to claim anything.
        assert_eq!(client.claim_yield(&minter, &user), 0);

        client.update_yield_index();
        assert_eq!(client.accrued_yield_index(), SCALE); // factor untouched: rate never moved
        assert_eq!(client.claim_yield(&minter, &user), 0);
    }

    #[test]
    fn mint_and_balance() {
        let f = setup();
        let minter = Address::generate(&f.env);
        f.client.set_minter(&f.admin, &minter);
        let user = Address::generate(&f.env);
        grant(&f, &user);

        f.client.mint(&user, &1_000);
        assert_eq!(f.client.balance(&user), 1_000);
    }

    #[test]
    #[should_panic]
    fn mint_without_sac_authorization_panics() {
        let f = setup();
        let minter = Address::generate(&f.env);
        f.client.set_minter(&f.admin, &minter);

        let user = Address::generate(&f.env);
        f.perm.grant_account(&f.perm_admin, &user);
        f.perm.grant_asset(&f.perm_admin, &user, &f.yt_id);
        token::StellarAssetClient::new(&f.env, &f.underlying).set_authorized(&user, &false);

        f.client.mint(&user, &1_000);
    }

    #[test]
    fn no_yield_without_rate_increase() {
        let f = setup();
        let minter = Address::generate(&f.env);
        f.client.set_minter(&f.admin, &minter);
        let user = Address::generate(&f.env);
        grant(&f, &user);
        f.client.mint(&user, &(1_000 * SCALE));

        f.client.update_yield_index(); // rate unchanged since inception
        assert_eq!(f.client.accrued_yield_index(), SCALE); // factor untouched at genesis value
        assert_eq!(f.client.claim_yield(&minter, &user), 0);
    }

    #[test]
    fn yield_accrues_after_rate_increase() {
        let f = setup();
        let minter = Address::generate(&f.env);
        f.client.set_minter(&f.admin, &minter);
        let user = Address::generate(&f.env);
        grant(&f, &user);
        f.client.mint(&user, &(1_000 * SCALE)); // notional 1000 units at SCALE

        // Rate goes from 1.0 to 1.03.
        f.env.ledger().with_mut(|li| li.timestamp = T0 + 1);
        f.oracle
            .set_reference_value(&f.oracle_admin, &10_300_000, &(T0 + 1));
        f.client.update_yield_index();

        // new_factor = factor * last_rate / now_rate = SCALE * SCALE / 10_300_000
        let expected_factor = SCALE * SCALE / 10_300_000_i128;
        assert_eq!(f.client.accrued_yield_index(), expected_factor);

        // Remaining credit protects the whole ceiling principal reserve first.
        let claimed = f.client.claim_yield(&minter, &user);
        let expected_claim = (1_000 * SCALE) - ((1_000 * SCALE)*SCALE + 10_300_000_i128 - 1)/10_300_000_i128;
        assert_eq!(claimed, expected_claim);
        // Compare whole-unit display with the direct single-shot formula.
        let exact = 1_000_i128 * (10_300_000 - SCALE) / 10_300_000;
        assert_eq!(claimed / SCALE, exact);

        // Claiming again immediately yields nothing further.
        assert_eq!(f.client.claim_yield(&minter, &user), 0);
    }

    #[test]
    fn yield_is_path_independent_across_many_intermediate_updates() {
        // The regression this fix exists for: whether the oracle rate moves from R0 to Rfinal
        // in one jump or many small steps, the claimable yield must be identical -- unlike the
        // old additive-index formula, which overstated yield more with every extra step (the
        // failure mode verified numerically during the audit: ~13.5% overstatement for a
        // 90-step, 30%-appreciation market).
        let f = setup();
        let minter = Address::generate(&f.env);
        f.client.set_minter(&f.admin, &minter);

        let user = Address::generate(&f.env);
        grant(&f, &user);
        f.client.mint(&user, &(1_000 * SCALE));

        let final_rate: i128 = 13_000_000; // 1.30, 30% total appreciation
        let n_steps = 30_u64;
        let mut ts = T0;
        for i in 1..=n_steps {
            ts += 1;
            let r = SCALE + (final_rate - SCALE) * (i as i128) / (n_steps as i128);
            f.env.ledger().with_mut(|li| li.timestamp = ts);
            f.oracle.set_reference_value(&f.oracle_admin, &r, &ts);
            f.client.update_yield_index();
        }

        let many_step_claim = f.client.claim_yield(&minter, &user);

        // What a single jump straight from SCALE to final_rate would have produced for the
        // same notional -- the exact, path-independent formula PT redemption also uses.
        let single_jump_expected = (1_000 * SCALE) * (final_rate - SCALE) / final_rate;

        assert_eq!(many_step_claim,single_jump_expected);
    }

    #[test]
    fn late_buyer_does_not_receive_prior_yield() {
        let f = setup();
        let minter = Address::generate(&f.env);
        f.client.set_minter(&f.admin, &minter);
        let alice = Address::generate(&f.env);
        let bob = Address::generate(&f.env);
        grant(&f, &alice);
        grant(&f, &bob);

        f.client.mint(&alice, &(1_000 * SCALE));

        // Rate rises before Bob ever holds YT.
        f.env.ledger().with_mut(|li| li.timestamp = T0 + 1);
        f.oracle
            .set_reference_value(&f.oracle_admin, &10_300_000, &(T0 + 1));
        f.client.update_yield_index();

        // Bob receives YT only now, after the index already moved.
        f.client.mint(&bob, &(500 * SCALE));

        // Bob's settled snapshot should already equal the current index, so he has
        // nothing pending despite the global index being nonzero.
        assert_eq!(f.client.pending_claim(&bob), 0);
        assert_eq!(f.client.claim_yield(&minter, &bob), 0);

        // Alice still gets her full accrued share.
        assert!(f.client.claim_yield(&minter, &alice) > 0);
    }

    #[test]
    fn transfer_settles_both_sides() {
        let f = setup();
        let minter = Address::generate(&f.env);
        f.client.set_minter(&f.admin, &minter);
        let alice = Address::generate(&f.env);
        let bob = Address::generate(&f.env);
        grant(&f, &alice);
        grant(&f, &bob);

        f.client.mint(&alice, &(1_000 * SCALE));
        f.env.ledger().with_mut(|li| li.timestamp = T0 + 1);
        f.oracle
            .set_reference_value(&f.oracle_admin, &10_300_000, &(T0 + 1));
        f.client.update_yield_index();

        // Alice transfers everything to Bob; her accrued yield up to this point must
        // remain hers (settled before the balance moves), not follow the tokens to Bob.
        f.client.transfer(&alice, &bob, &(1_000 * SCALE));

        let alice_claim = f.client.claim_yield(&minter, &alice);
        assert!(alice_claim > 0);
        assert_eq!(f.client.claim_yield(&minter, &bob), 0); // Bob owned nothing while the index moved
    }

    #[test]
    #[should_panic]
    fn revoked_holder_cannot_dump_yt_before_seizure() {
        let f = setup();
        let minter = Address::generate(&f.env);
        f.client.set_minter(&f.admin, &minter);
        let alice = Address::generate(&f.env);
        let bob = Address::generate(&f.env);
        grant(&f, &alice);
        grant(&f, &bob);
        f.client.mint(&alice, &(500 * SCALE));

        f.perm.revoke_account(&f.perm_admin, &alice);
        f.client.transfer(&alice, &bob, &(100 * SCALE)); // bob is still fully eligible
    }

    #[test]
    #[should_panic]
    fn deauthorized_on_sac_cannot_dump_yt_before_seizure() {
        let f = setup();
        let minter = Address::generate(&f.env);
        f.client.set_minter(&f.admin, &minter);
        let alice = Address::generate(&f.env);
        let bob = Address::generate(&f.env);
        grant(&f, &alice);
        grant(&f, &bob);
        f.client.mint(&alice, &(500 * SCALE));

        token::StellarAssetClient::new(&f.env, &f.underlying).set_authorized(&alice, &false);
        f.client.transfer(&alice, &bob, &(100 * SCALE));
    }

    #[test]
    #[should_panic]
    fn update_yield_index_blocked_by_stale_oracle() {
        // Without a freshness check, this would silently advance the accrual index off a rate
        // the oracle relay stopped refreshing long ago.
        let f = setup();
        // Ledger advances far past the oracle's last update without a fresh price ever landing.
        f.env.ledger().with_mut(|li| li.timestamp = T0 + 3_601);
        f.client.update_yield_index();
    }

    // --- seize (compliance recovery) ---

    #[test]
    fn seize_moves_balance_and_settles_both_sides() {
        let f = setup();
        let minter = Address::generate(&f.env);
        f.client.set_minter(&f.admin, &minter);
        let escrow = Address::generate(&f.env);
        f.client.set_recovery_escrow(&f.admin, &escrow);

        let bad_actor = Address::generate(&f.env);
        grant(&f, &bad_actor);
        f.client.mint(&bad_actor, &(1_000 * SCALE));

        // Rate rises before the seizure.
        f.env.ledger().with_mut(|li| li.timestamp = T0 + 1);
        f.oracle
            .set_reference_value(&f.oracle_admin, &10_300_000, &(T0 + 1));
        f.client.update_yield_index();

        let seized = f.client.seize(&escrow, &bad_actor, &(1_000 * SCALE));
        assert_eq!(seized, 1_000 * SCALE);
        assert_eq!(f.client.balance(&bad_actor), 0);
        assert_eq!(f.client.balance(&escrow), 1_000 * SCALE);

        // Explicit recovery includes earned pending; ordinary transfers still leave it.
        assert_eq!(f.client.claim_yield(&minter, &bad_actor),0);
        assert!(f.client.claim_yield(&minter, &escrow)>0);
    }

    #[test]
    #[should_panic]
    fn seize_requires_configured_escrow_caller() {
        let f = setup();
        let minter = Address::generate(&f.env);
        f.client.set_minter(&f.admin, &minter);
        let escrow = Address::generate(&f.env);
        let impostor = Address::generate(&f.env);
        f.client.set_recovery_escrow(&f.admin, &escrow);

        let bad_actor = Address::generate(&f.env);
        grant(&f, &bad_actor);
        f.client.mint(&bad_actor, &(500 * SCALE));

        f.client.seize(&impostor, &bad_actor, &(500 * SCALE));
    }

    #[test]
    #[should_panic]
    fn claim_yield_rejects_non_minter_caller() {
        // H-03 regression: claim_yield must reject a caller that isn't the registered minter,
        // even though the passed `from` address is a real, legitimately-minted holder.
        let f = setup();
        let minter = Address::generate(&f.env);
        f.client.set_minter(&f.admin, &minter);
        let user = Address::generate(&f.env);
        grant(&f, &user);
        f.client.mint(&user, &(1_000 * SCALE));

        let impostor = Address::generate(&f.env);
        f.client.claim_yield(&impostor, &user);
    }

    #[test]
    #[should_panic]
    fn double_initialize_panics() {
        let f = setup();
        f.client.initialize(
            &f.admin,
            &f.perm.address,
            &f.underlying,
            &f.oracle.address,
            &u64::MAX,
            &String::from_str(&f.env, "Yield Token USDY"),
            &String::from_str(&f.env, "YT-USDY"),
            &7,
        );
    }

    #[test]
    #[should_panic]
    fn set_minter_twice_panics() {
        let f = setup();
        let minter = Address::generate(&f.env);
        f.client.set_minter(&f.admin, &minter);
        f.client.set_minter(&f.admin, &minter);
    }

    #[test]
    #[should_panic]
    fn set_recovery_escrow_twice_panics() {
        let f = setup();
        let escrow = Address::generate(&f.env);
        f.client.set_recovery_escrow(&f.admin, &escrow);
        f.client.set_recovery_escrow(&f.admin, &escrow);
    }

    #[test]
    #[should_panic]
    fn transfer_zero_amount_panics() {
        let f = setup();
        let minter = Address::generate(&f.env);
        f.client.set_minter(&f.admin, &minter);
        let alice = Address::generate(&f.env);
        let bob = Address::generate(&f.env);
        grant(&f, &alice);
        grant(&f, &bob);
        f.client.mint(&alice, &(100 * SCALE));
        f.client.transfer(&alice, &bob, &0);
    }

    #[test]
    #[should_panic]
    fn transfer_insufficient_balance_panics() {
        let f = setup();
        let minter = Address::generate(&f.env);
        f.client.set_minter(&f.admin, &minter);
        let alice = Address::generate(&f.env);
        let bob = Address::generate(&f.env);
        grant(&f, &alice);
        grant(&f, &bob);
        f.client.mint(&alice, &(100 * SCALE));
        f.client.transfer(&alice, &bob, &(200 * SCALE));
    }

    #[test]
    fn approve_and_transfer_from() {
        let f = setup();
        let minter = Address::generate(&f.env);
        f.client.set_minter(&f.admin, &minter);
        let alice = Address::generate(&f.env);
        let bob = Address::generate(&f.env);
        let spender = Address::generate(&f.env);
        grant(&f, &alice);
        grant(&f, &bob);

        f.client.mint(&alice, &(500 * SCALE));
        f.client
            .approve(&alice, &spender, &(300 * SCALE), &(f.env.ledger().sequence() + 100));
        assert_eq!(f.client.allowance(&alice, &spender), 300 * SCALE);

        f.client.transfer_from(&spender, &alice, &bob, &(200 * SCALE));
        assert_eq!(f.client.balance(&alice), 300 * SCALE);
        assert_eq!(f.client.balance(&bob), 200 * SCALE);
        assert_eq!(f.client.allowance(&alice, &spender), 100 * SCALE);
    }

    #[test]
    #[should_panic]
    fn transfer_from_exceeding_allowance_panics() {
        let f = setup();
        let minter = Address::generate(&f.env);
        f.client.set_minter(&f.admin, &minter);
        let alice = Address::generate(&f.env);
        let bob = Address::generate(&f.env);
        let spender = Address::generate(&f.env);
        grant(&f, &alice);
        grant(&f, &bob);

        f.client.mint(&alice, &(500 * SCALE));
        f.client
            .approve(&alice, &spender, &(100 * SCALE), &(f.env.ledger().sequence() + 100));
        f.client.transfer_from(&spender, &alice, &bob, &(200 * SCALE));
    }

    #[test]
    #[should_panic]
    fn transfer_from_expired_allowance_panics() {
        let f = setup();
        let minter = Address::generate(&f.env);
        f.client.set_minter(&f.admin, &minter);
        let alice = Address::generate(&f.env);
        let bob = Address::generate(&f.env);
        let spender = Address::generate(&f.env);
        grant(&f, &alice);
        grant(&f, &bob);

        f.client.mint(&alice, &(500 * SCALE));
        let expiration = f.env.ledger().sequence() + 5;
        f.client
            .approve(&alice, &spender, &(200 * SCALE), &expiration);
        f.env
            .ledger()
            .with_mut(|li| li.sequence_number = expiration + 1);
        f.client.transfer_from(&spender, &alice, &bob, &(200 * SCALE));
    }

    #[test]
    fn views_and_getters() {
        let f = setup();
        let minter = Address::generate(&f.env);
        f.client.set_minter(&f.admin, &minter);
        let escrow = Address::generate(&f.env);
        f.client.set_recovery_escrow(&f.admin, &escrow);

        assert_eq!(f.client.decimals(), 7);
        assert_eq!(
            f.client.name(),
            String::from_str(&f.env, "Yield Token USDY")
        );
        assert_eq!(f.client.symbol(), String::from_str(&f.env, "YT-USDY"));
        assert_eq!(f.client.total_supply(), 0);
        assert_eq!(f.client.maturity(), u64::MAX);
        assert_eq!(f.client.minter(), minter);
        assert_eq!(f.client.get_admin(), f.admin);
        assert_eq!(f.client.recovery_escrow(), escrow);
        assert_eq!(f.client.underlying_address(), f.underlying);
        assert_eq!(f.client.permissioning_address(), f.perm.address);
        assert_eq!(f.client.oracle_address(), f.oracle.address);

        let user = Address::generate(&f.env);
        grant(&f, &user);
        f.client.mint(&user, &(10 * SCALE));
        assert_eq!(f.client.last_claimed_index(&user), SCALE);
        assert_eq!(f.client.pending_claim(&user), 0);
    }

    #[test]
    #[should_panic]
    fn set_minter_by_non_admin_panics() {
        let f = setup();
        let impostor = Address::generate(&f.env);
        let minter = Address::generate(&f.env);
        f.client.set_minter(&impostor, &minter);
    }

    #[test]
    #[should_panic]
    fn mint_to_account_granted_but_not_per_asset_panics() {
        let f = setup();
        let minter = Address::generate(&f.env);
        f.client.set_minter(&f.admin, &minter);
        let user = Address::generate(&f.env);
        // Account-level grant only -- never granted for this specific YT asset.
        f.perm.grant_account(&f.perm_admin, &user);
        token::StellarAssetClient::new(&f.env, &f.underlying).set_authorized(&user, &true);
        f.client.mint(&user, &(10 * SCALE));
    }

    #[test]
    #[should_panic]
    fn mint_zero_amount_panics() {
        let f = setup();
        let minter = Address::generate(&f.env);
        f.client.set_minter(&f.admin, &minter);
        let user = Address::generate(&f.env);
        grant(&f, &user);
        f.client.mint(&user, &0);
    }

    #[test]
    #[should_panic]
    fn burn_zero_amount_panics() {
        let f = setup();
        let minter = Address::generate(&f.env);
        f.client.set_minter(&f.admin, &minter);
        let user = Address::generate(&f.env);
        grant(&f, &user);
        f.client.mint(&user, &(10 * SCALE));
        f.client.burn(&user, &0);
    }

    #[test]
    #[should_panic]
    fn burn_insufficient_balance_panics() {
        let f = setup();
        let minter = Address::generate(&f.env);
        f.client.set_minter(&f.admin, &minter);
        let user = Address::generate(&f.env);
        grant(&f, &user);
        f.client.mint(&user, &(10 * SCALE));
        f.client.burn(&user, &(20 * SCALE));
    }

    #[test]
    #[should_panic]
    fn seize_rejects_zero_amount() {
        let f = setup();
        let minter = Address::generate(&f.env);
        f.client.set_minter(&f.admin, &minter);
        let escrow = Address::generate(&f.env);
        f.client.set_recovery_escrow(&f.admin, &escrow);
        let bad_actor = Address::generate(&f.env);
        grant(&f, &bad_actor);
        f.client.mint(&bad_actor, &(10 * SCALE));
        f.client.seize(&escrow, &bad_actor, &0);
    }

    #[test]
    #[should_panic]
    fn seize_cannot_exceed_target_balance() {
        let f = setup();
        let minter = Address::generate(&f.env);
        f.client.set_minter(&f.admin, &minter);
        let escrow = Address::generate(&f.env);
        f.client.set_recovery_escrow(&f.admin, &escrow);
        let bad_actor = Address::generate(&f.env);
        grant(&f, &bad_actor);
        f.client.mint(&bad_actor, &(10 * SCALE));
        f.client.seize(&escrow, &bad_actor, &(20 * SCALE));
    }

    #[test]
    #[should_panic]
    fn transfer_from_zero_amount_panics() {
        let f = setup();
        let minter = Address::generate(&f.env);
        f.client.set_minter(&f.admin, &minter);
        let alice = Address::generate(&f.env);
        let bob = Address::generate(&f.env);
        let spender = Address::generate(&f.env);
        grant(&f, &alice);
        grant(&f, &bob);
        f.client.mint(&alice, &(500 * SCALE));
        f.client.approve(
            &alice,
            &spender,
            &(300 * SCALE),
            &(f.env.ledger().sequence() + 100),
        );
        f.client.transfer_from(&spender, &alice, &bob, &0);
    }

    #[test]
    #[should_panic]
    fn transfer_from_insufficient_balance_panics() {
        let f = setup();
        let minter = Address::generate(&f.env);
        f.client.set_minter(&f.admin, &minter);
        let alice = Address::generate(&f.env);
        let bob = Address::generate(&f.env);
        let spender = Address::generate(&f.env);
        grant(&f, &alice);
        grant(&f, &bob);
        f.client.mint(&alice, &(10 * SCALE));
        f.client.approve(
            &alice,
            &spender,
            &(500 * SCALE),
            &(f.env.ledger().sequence() + 100),
        );
        f.client.transfer_from(&spender, &alice, &bob, &(20 * SCALE));
    }

    #[test]
    #[should_panic]
    fn approve_negative_amount_panics() {
        let f = setup();
        let alice = Address::generate(&f.env);
        let spender = Address::generate(&f.env);
        grant(&f, &alice);
        f.client
            .approve(&alice, &spender, &-1, &(f.env.ledger().sequence() + 100));
    }
}
