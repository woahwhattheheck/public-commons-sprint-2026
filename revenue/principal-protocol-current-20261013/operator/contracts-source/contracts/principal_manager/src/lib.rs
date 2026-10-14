//! Current PrincipalManager accounting edition 3.
//! Real SEP41 PT/YT and original SAC/Permissioning remain the authority.
//! Mint values actual SY custody using the wrapper rate. Yield is paid only from
//! inverse-index earned rewards; queued claims and outstanding PT are reserved.
//! Both redemption sides use the same YT-frozen authenticated maturity sample.
//! This source requires a newly initialized economic edition; it does not infer
//! earlier payouts or outstanding liabilities from a prior deployment's balances.
#![no_std]

use soroban_sdk::{
    contract, contractclient, contracterror, contractimpl, contracttype, panic_with_error,
    symbol_short, token, Address, Env,
};

#[path="../../accounting_math.rs"] mod accounting_math;
use accounting_math::{add,sub,floor,ceil,inverse,reward,REWARD_SCALE};

pub const SCALE: i128 = 10_000_000; // 1e7

/// Maximum seconds the oracle price may be stale at redemption.
const MAX_ORACLE_STALENESS_SECS: u64 = 3_600;

// ---------------------------------------------------------------------------
// External contract interfaces (used for cross-contract calls)
// ---------------------------------------------------------------------------

/// Minimum interface required from the OracleAdapter.
#[contractclient(name = "OracleClient")]
pub trait OracleInterface {
    fn get_reference_value(env: Env) -> i128;
    fn is_fresh(env: Env, max_stale_seconds: u64) -> bool;
}

/// Minimum interface required from the Permissioning contract.
#[contractclient(name = "PermClient")]
pub trait PermissioningInterface {
    fn is_allowed(env: Env, account: Address) -> bool;
    fn is_allowed_for_asset(env:Env,account:Address,asset:Address)->bool;
}

/// Minimum interface required from SYWrapper.
#[contractclient(name = "SYWrapperClient")]
pub trait SYWrapperInterface {
    fn transfer(env: Env, from: Address, to: Address, amount: i128) -> i128;
    fn withdraw(env: Env, from: Address, shares: i128, to: Address) -> i128;
    fn exchange_rate(env: Env) -> i128;
    fn balance_of(env:Env,account:Address)->i128;
    fn total_underlying(env:Env)->i128;
    fn underlying_address(env: Env) -> Address;
    fn permissioning_address(env: Env) -> Address;
}

/// Minimum interface required from PTToken.
#[contractclient(name = "PTTokenClient")]
pub trait PTTokenInterface {
    fn mint(env: Env, to: Address, amount: i128);
    fn burn(env: Env, from: Address, amount: i128);
    fn balance(env: Env, account: Address) -> i128;
    fn total_supply(env: Env) -> i128;
    fn underlying_address(env: Env) -> Address;
    fn permissioning_address(env: Env) -> Address;
    fn maturity(env: Env) -> u64;
}

/// Minimum interface required from YTToken.
#[contractclient(name = "YTTokenClient")]
pub trait YTTokenInterface {
    fn mint(env: Env, to: Address, amount: i128);
    fn burn(env: Env, from: Address, amount: i128);
    fn update_yield_index(env: Env);
    fn claim_yield(env: Env, caller: Address, from: Address) -> i128;
    fn settle_yield(env:Env,caller:Address,from:Address)->i128;
    fn consume_yield(env:Env,caller:Address,from:Address,amount:i128);
    fn accounting_edition(env:Env)->u32;
    fn accounting_rate(env:Env)->i128;
    fn inverse_index(env:Env)->i128;
    fn total_pending(env:Env)->i128;
    fn pending_claim(env:Env,account:Address)->i128;
    fn last_inverse_index(env:Env,account:Address)->i128;
    fn reward_remainder(env:Env,account:Address)->i128;
    fn balance(env: Env, account: Address) -> i128;
    fn total_supply(env: Env) -> i128;
    fn underlying_address(env: Env) -> Address;
    fn permissioning_address(env: Env) -> Address;
    fn oracle_address(env: Env) -> Address;
    fn maturity(env: Env) -> u64;
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
    NotMature = 5,
    AlreadyMature = 6,
    OracleStale = 7,
    Paused = 9,
    PermissionDenied = 10,
    NotAuthorizedOnSac = 11,
    IssuerMismatch = 12,
    TopologyMismatch = 13,
    AccountingEditionRequired = 14,
    Insolvent = 15,
    UnexpectedTransfer = 16,
    PrincipalNotRepresentable = 17,
    OracleRegressed = 18,
    Slippage = 19,
    InsufficientPair = 20,
}

// ---------------------------------------------------------------------------
// Storage key schema
// ---------------------------------------------------------------------------

#[contracttype]
pub enum DataKey {
    Admin,
    SYWrapper,
    PTToken,
    YTToken,
    Oracle,
    Permissioning,
    Underlying, // Address of the underlying SAC, used for authorization inheritance
    Maturity,   // u64 unix timestamp
    Paused,
    AccountingEdition,
    LockedShares,
    TotalDepositedUnderlying,
    TotalPaidPrincipal,
    TotalPaidYield,
    TotalRecombinedShares,
    TotalRecombinedUnderlying,
}

// ---------------------------------------------------------------------------
// Return types
// ---------------------------------------------------------------------------

#[contracttype]
#[derive(Clone)]
pub struct MintResult {
    pub pt_minted: i128,
    pub yt_minted: i128,
}

#[contracttype]
#[derive(Clone)]
pub struct RedeemResult {
    pub underlying_from_pt: i128,
    pub underlying_from_yt: i128,
}

#[contracttype]
#[derive(Clone,Debug,Eq,PartialEq)]
pub struct RecombineQuote {
    pub amount:i128,pub sy_shares:i128,pub underlying_allowance:i128,
    pub underlying_value:i128,pub retained_rounding:i128,pub oracle_rate:i128,
    pub sy_rate:i128,pub inverse_index:i128,pub pending_yield:i128,
    pub reward_remainder:i128,pub sampled_at:u64,pub maturity:u64,
}

#[contracttype]
#[derive(Clone,Debug,Eq,PartialEq)]
pub struct MintPreview {
    pub sy_shares:i128,pub underlying:i128,pub oracle_rate:i128,pub inverse_index:i128,
    pub reward_scale:i128,pub original_rate_notional:i128,pub issued_notional:i128,
    pub issuance_adjustment:i128,
}

// ---------------------------------------------------------------------------
// Contract
// ---------------------------------------------------------------------------

#[contract]
pub struct PrincipalManagerContract;

#[contractimpl]
impl PrincipalManagerContract {
    /// One-time initialization.
    ///
    /// * `sy_wrapper`    — address of the SYWrapper contract
    /// * `pt_token`      — address of the PTToken contract (this contract must later be
    ///                     registered as its minter via `PTToken.set_minter`)
    /// * `yt_token`      — address of the YTToken contract (same two-phase pattern)
    /// * `oracle`        — address of the OracleAdapter contract
    /// * `permissioning` — address of the Permissioning contract
    /// * `underlying`    — address of the underlying SAC; `admin` must equal its `admin()`
    /// * `maturity`      — Unix timestamp at which PT and YT can be redeemed
    ///
    /// `admin` must be the underlying SAC's actual admin and must authorize this call --
    /// creating a new market (even a new maturity on an existing asset) requires the issuer's
    /// participation, matching `SYWrapper`'s market-creation gate.
    pub fn initialize(
        env: Env,
        admin: Address,
        sy_wrapper: Address,
        pt_token: Address,
        yt_token: Address,
        oracle: Address,
        permissioning: Address,
        underlying: Address,
        maturity: u64,
    ) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic_with_error!(&env, Error::AlreadyInitialized);
        }
        admin.require_auth();
        let sac_admin = token::StellarAssetClient::new(&env, &underlying).admin();
        if admin != sac_admin {
            panic_with_error!(&env, Error::IssuerMismatch);
        }
        Self::assert_topology_matches(
            &env,
            &sy_wrapper,
            &pt_token,
            &yt_token,
            &oracle,
            &permissioning,
            &underlying,
            maturity,
        );
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage()
            .instance()
            .set(&DataKey::SYWrapper, &sy_wrapper);
        env.storage().instance().set(&DataKey::PTToken, &pt_token);
        env.storage().instance().set(&DataKey::YTToken, &yt_token);
        env.storage().instance().set(&DataKey::Oracle, &oracle);
        env.storage()
            .instance()
            .set(&DataKey::Permissioning, &permissioning);
        env.storage()
            .instance()
            .set(&DataKey::Underlying, &underlying);
        env.storage().instance().set(&DataKey::Maturity, &maturity);
        if YTTokenClient::new(&env,&yt_token).accounting_edition()!=3 {panic_with_error!(&env,Error::AccountingEditionRequired)}
        env.storage().instance().set(&DataKey::AccountingEdition,&3u32);
        env.storage().instance().set(&DataKey::LockedShares,&0i128);
        env.storage().instance().set(&DataKey::TotalDepositedUnderlying,&0i128);
        env.storage().instance().set(&DataKey::TotalPaidPrincipal,&0i128);
        env.storage().instance().set(&DataKey::TotalPaidYield,&0i128);
        env.storage().instance().set(&DataKey::Paused, &false);
    }

    /// Market edition 1 topology reads; no accounting or custody change.
    pub fn sy_wrapper_address(env:Env)->Address{Self::get_sy_wrapper(&env)}
    pub fn pt_token_address(env:Env)->Address{Self::get_pt_token(&env)}
    pub fn yt_token_address(env:Env)->Address{Self::get_yt_token(&env)}
    pub fn oracle_address(env:Env)->Address{env.storage().instance().get(&DataKey::Oracle).unwrap_or_else(||panic_with_error!(&env,Error::NotInitialized))}
    pub fn permissioning_address(env:Env)->Address{env.storage().instance().get(&DataKey::Permissioning).unwrap_or_else(||panic_with_error!(&env,Error::NotInitialized))}

    // --- core protocol operations ---

    /// Split `sy_shares` into PT + YT. The caller must already hold these shares in the
    /// SYWrapper and must authorize both this call and the resulting SYWrapper transfer.
    ///
    /// Returns the number of PT and YT minted (equal at issuance).
    pub fn mint(env: Env, from: Address, sy_shares: i128) -> MintResult {
        from.require_auth();Self::assert_edition(&env);Self::assert_not_paused(&env);
        Self::assert_not_mature(&env);Self::assert_oracle_fresh(&env);
        if sy_shares<=0{panic_with_error!(&env,Error::ZeroAmount)}
        Self::assert_sac_authorized(&env,&from);Self::assert_permitted(&env,&from);
        let yt=YTTokenClient::new(&env,&Self::get_yt_token(&env));yt.update_yield_index();
        let rate=Self::get_oracle_rate(&env);
        if yt.accounting_rate()!=rate{panic_with_error!(&env,Error::TopologyMismatch)}
        let index=yt.inverse_index(); // rate bounds validated before valuation/custody
        let wrapper=Self::get_sy_wrapper(&env);let sy=SYWrapperClient::new(&env,&wrapper);
        Self::assert_custody(&env);
        let underlying=floor(&env,sy_shares,sy.exchange_rate(),SCALE);
        let notional=floor(&env,underlying,REWARD_SCALE,index);
        if notional<=0{panic_with_error!(&env,Error::ZeroAmount)}
        let this=env.current_contract_address();let before=sy.balance_of(&this);
        sy.transfer(&from,&this,&sy_shares);
        if sy.balance_of(&this)!=add(&env,before,sy_shares){panic_with_error!(&env,Error::UnexpectedTransfer)}
        env.storage().instance().set(&DataKey::LockedShares,&add(&env,Self::locked_shares(env.clone()),sy_shares));
        PTTokenClient::new(&env,&Self::get_pt_token(&env)).mint(&from,&notional);
        yt.mint(&from,&notional);
        let total:i128=env.storage().instance().get(&DataKey::TotalDepositedUnderlying).unwrap_or(0);
        env.storage().instance().set(&DataKey::TotalDepositedUnderlying,&add(&env,total,underlying));
        Self::assert_reserved(&env,0);
        env.events().publish((symbol_short!("mint"),),(from,sy_shares,notional));
        MintResult{pt_minted:notional,yt_minted:notional}
    }

    /// Paired exit edition 1: return current principal backing in SY.
    /// Earned whole/fractional YT credit remains with the holder, including after a full burn.
    /// This is not the historical per-user original-deposit sketch: PT/YT are transferable,
    /// and previously paid yield must never be paid again through recombination.
    pub fn preview_recombine(env:Env,from:Address,amount:i128)->RecombineQuote {
        Self::assert_edition(&env);Self::assert_not_paused(&env);
        Self::assert_not_mature(&env);Self::assert_oracle_fresh(&env);
        Self::assert_sac_authorized(&env,&from);Self::assert_permitted(&env,&from);
        if amount<=0{panic_with_error!(&env,Error::ZeroAmount)}
        let this=env.current_contract_address();
        if from==this{panic_with_error!(&env,Error::UnexpectedTransfer)}
        let pt=PTTokenClient::new(&env,&Self::get_pt_token(&env));
        let yt=YTTokenClient::new(&env,&Self::get_yt_token(&env));
        let permission=PermClient::new(&env,&Self::permissioning_address(env.clone()));
        if !permission.is_allowed_for_asset(&from,&Self::get_pt_token(&env))
            ||!permission.is_allowed_for_asset(&from,&Self::get_yt_token(&env)){panic_with_error!(&env,Error::PermissionDenied)}
        let balance=yt.balance(&from);
        if pt.balance(&from)<amount||balance<amount{panic_with_error!(&env,Error::InsufficientPair)}
        Self::assert_custody(&env);
        let rate=Self::get_oracle_rate(&env);let index=inverse(&env,rate);
        if rate<yt.accounting_rate(){panic_with_error!(&env,Error::OracleRegressed)}
        let sy=SYWrapperClient::new(&env,&Self::get_sy_wrapper(&env));
        let sy_rate=sy.exchange_rate();
        let allowance=floor(&env,amount,SCALE,rate);
        let shares=floor(&env,allowance,SCALE,sy_rate);
        if shares<=0{panic_with_error!(&env,Error::ZeroAmount)}
        let value=floor(&env,shares,sy_rate,SCALE);
        let (earned,fraction)=reward(&env,balance,sub(&env,yt.last_inverse_index(&from),index),yt.reward_remainder(&from));
        let pending=add(&env,yt.pending_claim(&from),earned);
        let required=add(&env,ceil(&env,pt.total_supply(),index,REWARD_SCALE),add(&env,yt.total_pending(),earned));
        if Self::backing_underlying(env.clone())<required{panic_with_error!(&env,Error::Insolvent)}
        RecombineQuote{amount,sy_shares:shares,underlying_allowance:allowance,underlying_value:value,
            retained_rounding:sub(&env,allowance,value),oracle_rate:rate,sy_rate,inverse_index:index,
            pending_yield:pending,reward_remainder:fraction,sampled_at:env.ledger().timestamp(),maturity:Self::maturity(env.clone())}
    }

    pub fn recombine(env:Env,from:Address,amount:i128,min_sy:i128)->RecombineQuote {
        from.require_auth();
        if min_sy<0{panic_with_error!(&env,Error::Slippage)}
        let quote=Self::preview_recombine(env.clone(),from.clone(),amount);
        if quote.sy_shares<min_sy{panic_with_error!(&env,Error::Slippage)}
        let this=env.current_contract_address();
        let pt=PTTokenClient::new(&env,&Self::get_pt_token(&env));
        let yt=YTTokenClient::new(&env,&Self::get_yt_token(&env));
        let sy=SYWrapperClient::new(&env,&Self::get_sy_wrapper(&env));
        yt.update_yield_index();
        let pending=yt.settle_yield(&this,&from);
        if yt.accounting_rate()!=quote.oracle_rate||yt.inverse_index()!=quote.inverse_index
            ||pending!=quote.pending_yield||yt.reward_remainder(&from)!=quote.reward_remainder
            ||sy.exchange_rate()!=quote.sy_rate{panic_with_error!(&env,Error::TopologyMismatch)}
        Self::assert_reserved(&env,0);
        let old_pt=pt.balance(&from);let old_yt=yt.balance(&from);
        let supply_pt=pt.total_supply();let supply_yt=yt.total_supply();
        pt.burn(&from,&amount);yt.burn(&from,&amount);
        if pt.balance(&from)!=sub(&env,old_pt,amount)||yt.balance(&from)!=sub(&env,old_yt,amount)
            ||pt.total_supply()!=sub(&env,supply_pt,amount)||yt.total_supply()!=sub(&env,supply_yt,amount)
            ||yt.pending_claim(&from)!=quote.pending_yield||yt.reward_remainder(&from)!=quote.reward_remainder{
            panic_with_error!(&env,Error::UnexpectedTransfer)
        }
        // ceil(T*I/Q)-ceil((T-n)*I/Q) >= floor(n*I/Q) >= floor(n*S/rate).
        // floor(allowance*S/w) shares reduce aggregate backing by at most allowance.
        Self::assert_reserved(&env,quote.underlying_allowance);
        let before=sy.balance_of(&this);let recipient=sy.balance_of(&from);
        let transferred=sy.transfer(&this,&from,&quote.sy_shares);
        if transferred!=quote.sy_shares||sy.balance_of(&this)!=sub(&env,before,quote.sy_shares)
            ||sy.balance_of(&from)!=add(&env,recipient,quote.sy_shares)
            ||sy.exchange_rate()!=quote.sy_rate||Self::get_oracle_rate(&env)!=quote.oracle_rate{
            panic_with_error!(&env,Error::UnexpectedTransfer)
        }
        env.storage().instance().set(&DataKey::LockedShares,&sub(&env,Self::locked_shares(env.clone()),quote.sy_shares));
        let total:i128=env.storage().instance().get(&DataKey::TotalRecombinedShares).unwrap_or(0);
        env.storage().instance().set(&DataKey::TotalRecombinedShares,&add(&env,total,quote.sy_shares));
        let value:i128=env.storage().instance().get(&DataKey::TotalRecombinedUnderlying).unwrap_or(0);
        env.storage().instance().set(&DataKey::TotalRecombinedUnderlying,&add(&env,value,quote.underlying_value));
        Self::assert_reserved(&env,0);
        env.events().publish((symbol_short!("recombine"),),(from,quote.clone()));
        quote
    }

    pub fn recombination_edition(_env:Env)->u32{1}
    pub fn total_recombined_shares(env:Env)->i128{env.storage().instance().get(&DataKey::TotalRecombinedShares).unwrap_or(0)}
    pub fn total_recombined_underlying(env:Env)->i128{env.storage().instance().get(&DataKey::TotalRecombinedUnderlying).unwrap_or(0)}

    /// Redeem PT and/or YT after maturity. Both can be supplied in any combination.
    ///
    /// * `pt_amount` — PT tokens to burn (0 = skip PT redemption)
    /// * `yt_amount` — YT tokens to burn (0 = skip YT redemption)
    ///
    /// Burns the caller's real PT/YT balances and releases real underlying via SYWrapper.
    /// Returns the underlying units actually transferred for each token type.
    pub fn redeem(env: Env, from: Address, pt_amount: i128, yt_amount: i128) -> RedeemResult {
        from.require_auth();Self::assert_edition(&env);Self::assert_not_paused(&env);Self::assert_mature(&env);
        Self::assert_sac_authorized(&env,&from);Self::assert_permitted(&env,&from);
        if pt_amount<0||yt_amount<0||(pt_amount==0&&yt_amount==0){panic_with_error!(&env,Error::ZeroAmount)}
        Self::assert_custody(&env);
        let yt=YTTokenClient::new(&env,&Self::get_yt_token(&env));
        yt.update_yield_index();let final_rate=yt.accounting_rate();
        let mut from_pt=0;let mut from_yt=0;
        if pt_amount>0 {
            PTTokenClient::new(&env,&Self::get_pt_token(&env)).burn(&from,&pt_amount);
            let desired=floor(&env,pt_amount,SCALE,final_rate);
            Self::assert_reserved(&env,desired);
            from_pt=Self::pay_underlying(&env,&from,desired);
            // A generalized wrapper rate can make an underlying atom amount
            // unrepresentable as whole SY shares. Revert the burn and transfer
            // together instead of silently extinguishing an unpaid remainder.
            if from_pt!=desired {panic_with_error!(&env,Error::PrincipalNotRepresentable)}
            let paid:i128=env.storage().instance().get(&DataKey::TotalPaidPrincipal).unwrap_or(0);
            env.storage().instance().set(&DataKey::TotalPaidPrincipal,&add(&env,paid,from_pt));
        }
        if yt_amount>0 {
            yt.burn(&from,&yt_amount);
            from_yt=Self::pay_yield(&env,&from);
        }
        Self::assert_reserved(&env,0);
        env.events().publish((symbol_short!("redeem"),),(from,pt_amount,yt_amount,from_pt,from_yt));
        RedeemResult{underlying_from_pt:from_pt,underlying_from_yt:from_yt}
    }

    /// Claim accrued YT yield without redeeming (burning) the underlying YT position. Available
    /// before maturity -- continuous accrual is the point of holding YT ahead of redemption --
    /// unlike `redeem`, this does not require the market to have matured. See this module's doc
    /// comment for why `YTToken.claim_yield` is minter-gated and why this is now the only path
    /// that turns a settled claim into an actual payment (H-03).
    pub fn claim_yield(env: Env, from: Address) -> i128 {
        from.require_auth();Self::assert_edition(&env);Self::assert_not_paused(&env);
        Self::assert_sac_authorized(&env,&from);Self::assert_permitted(&env,&from);
        Self::assert_custody(&env);
        let paid=Self::pay_yield(&env,&from);
        Self::assert_reserved(&env,0);
        env.events().publish((symbol_short!("yt_claim"),),(from,paid));paid
    }

    /// No dispatch or custody mutation. Exact conservative issuance is visible
    /// before the original mint; unsupported rates fail before valuation.
    pub fn preview_mint(env:Env,sy_shares:i128)->MintPreview {
        Self::assert_edition(&env);Self::assert_not_mature(&env);Self::assert_oracle_fresh(&env);
        if sy_shares<=0{panic_with_error!(&env,Error::ZeroAmount)}
        let rate=Self::get_oracle_rate(&env);let index=inverse(&env,rate);
        let sy=SYWrapperClient::new(&env,&Self::get_sy_wrapper(&env));
        let underlying=floor(&env,sy_shares,sy.exchange_rate(),SCALE);
        let original=floor(&env,underlying,rate,SCALE);
        let issued=floor(&env,underlying,REWARD_SCALE,index);
        MintPreview{sy_shares,underlying,oracle_rate:rate,inverse_index:index,reward_scale:REWARD_SCALE,
            original_rate_notional:original,issued_notional:issued,issuance_adjustment:sub(&env,original,issued)}
    }

    // --- views ---

    pub fn pt_balance(env: Env, account: Address) -> i128 {
        let pt_token = Self::get_pt_token(&env);
        PTTokenClient::new(&env, &pt_token).balance(&account)
    }

    pub fn yt_balance(env: Env, account: Address) -> i128 {
        let yt_token = Self::get_yt_token(&env);
        YTTokenClient::new(&env, &yt_token).balance(&account)
    }

    pub fn total_pt(env: Env) -> i128 {
        let pt_token = Self::get_pt_token(&env);
        PTTokenClient::new(&env, &pt_token).total_supply()
    }

    pub fn total_yt(env: Env) -> i128 {
        let yt_token = Self::get_yt_token(&env);
        YTTokenClient::new(&env, &yt_token).total_supply()
    }

    pub fn maturity(env: Env) -> u64 {
        env.storage()
            .instance()
            .get(&DataKey::Maturity)
            .unwrap_or_else(|| panic_with_error!(&env, Error::NotInitialized))
    }

    pub fn is_mature(env: Env) -> bool {
        let mat: u64 = env
            .storage()
            .instance()
            .get(&DataKey::Maturity)
            .unwrap_or(u64::MAX);
        env.ledger().timestamp() >= mat
    }

    pub fn underlying_address(env: Env) -> Address {
        env.storage()
            .instance()
            .get(&DataKey::Underlying)
            .unwrap_or_else(|| panic_with_error!(&env, Error::NotInitialized))
    }

    // --- admin ---

    pub fn set_paused(env: Env, caller: Address, paused: bool) {
        Self::assert_admin(&env, &caller);
        env.storage().instance().set(&DataKey::Paused, &paused);
        env.events().publish((symbol_short!("paused"),), paused);
    }

    pub fn transfer_admin(env: Env, current_admin: Address, new_admin: Address) {
        Self::assert_admin(&env, &current_admin);
        env.storage().instance().set(&DataKey::Admin, &new_admin);
        env.events()
            .publish((symbol_short!("adm_xfer"),), (current_admin, new_admin));
    }

    pub fn get_admin(env: Env) -> Address {
        Self::require_admin(&env)
    }

    pub fn accounting_edition(env:Env)->u32 {env.storage().instance().get(&DataKey::AccountingEdition).unwrap_or(0)}
    pub fn locked_shares(env:Env)->i128 {env.storage().instance().get(&DataKey::LockedShares).unwrap_or(0)}
    pub fn total_paid_principal(env:Env)->i128 {env.storage().instance().get(&DataKey::TotalPaidPrincipal).unwrap_or(0)}
    pub fn total_paid_yield(env:Env)->i128 {env.storage().instance().get(&DataKey::TotalPaidYield).unwrap_or(0)}
    pub fn total_deposited_underlying(env:Env)->i128 {env.storage().instance().get(&DataKey::TotalDepositedUnderlying).unwrap_or(0)}
    pub fn principal_reserve(env:Env)->i128 {
        let yt=YTTokenClient::new(&env,&Self::get_yt_token(&env));
        ceil(&env,Self::total_pt(env.clone()),yt.inverse_index(),REWARD_SCALE)
    }
    pub fn backing_underlying(env:Env)->i128 {
        let sy=SYWrapperClient::new(&env,&Self::get_sy_wrapper(&env));
        floor(&env,Self::locked_shares(env.clone()),sy.exchange_rate(),SCALE)
    }

    // --- internal helpers ---
    fn assert_edition(env:&Env) {if Self::accounting_edition(env.clone())!=3 {panic_with_error!(env,Error::AccountingEditionRequired)}}
    fn assert_custody(env:&Env) {
        Self::assert_edition(env);
        let wrapper=Self::get_sy_wrapper(env);let sy=SYWrapperClient::new(env,&wrapper);
        let underlying=Self::underlying_address(env.clone());
        if sy.balance_of(&env.current_contract_address())<Self::locked_shares(env.clone())
            ||token::Client::new(env,&underlying).balance(&wrapper)<sy.total_underlying()
            ||sy.exchange_rate()<=0 {panic_with_error!(env,Error::Insolvent)}
        Self::assert_sac_authorized(env,&env.current_contract_address());
        Self::assert_permitted(env,&env.current_contract_address());
    }
    fn assert_reserved(env:&Env,extra:i128) {
        Self::assert_custody(env);
        let yt=YTTokenClient::new(env,&Self::get_yt_token(env));
        let required=add(env,add(env,Self::principal_reserve(env.clone()),yt.total_pending()),extra);
        if Self::backing_underlying(env.clone())<required {panic_with_error!(env,Error::Insolvent)}
    }
    fn pay_underlying(env:&Env,to:&Address,desired:i128)->i128 {
        if desired==0{return 0}
        let wrapper=Self::get_sy_wrapper(env);let sy=SYWrapperClient::new(env,&wrapper);
        let shares=floor(env,desired,SCALE,sy.exchange_rate());
        if shares==0{return 0}
        let this=env.current_contract_address();if *to==this {panic_with_error!(env,Error::UnexpectedTransfer)}
        let old_shares=sy.balance_of(&this);
        let token=token::Client::new(env,&Self::underlying_address(env.clone()));
        let before=token.balance(to);
        let paid=sy.withdraw(&this,&shares,to);
        if paid<0||paid>desired||sy.balance_of(&this)!=sub(env,old_shares,shares)
           ||token.balance(to)!=add(env,before,paid){panic_with_error!(env,Error::UnexpectedTransfer)}
        env.storage().instance().set(&DataKey::LockedShares,&sub(env,Self::locked_shares(env.clone()),shares));
        paid
    }
    fn pay_yield(env:&Env,from:&Address)->i128 {
        let this=env.current_contract_address();
        let yt=YTTokenClient::new(env,&Self::get_yt_token(env));
        let pending=yt.settle_yield(&this,from);
        Self::assert_reserved(env,0);
        let paid=Self::pay_underlying(env,from,pending);
        yt.consume_yield(&this,from,&paid);
        let total:i128=env.storage().instance().get(&DataKey::TotalPaidYield).unwrap_or(0);
        env.storage().instance().set(&DataKey::TotalPaidYield,&add(env,total,paid));
        paid
    }


    /// Verifies the configured SY/PT/YT contracts actually belong together before this market
    /// ever accepts a deposit: same underlying SAC, same permissioning contract, PT/YT maturity
    /// matching this market's own, and YTToken's oracle matching this market's own. Without this,
    /// a deployment mistake could pair PT/YT from one market with SY custody or oracle
    /// assumptions from another -- a high-blast-radius configuration risk even if adversarially
    /// unreachable under a tightly controlled deployment process. Mirrors
    /// `RecoveryEscrow.assert_position_underlying_matches`'s existing precedent for the
    /// underlying-consistency check. Found during audit review (M-01).
    fn assert_topology_matches(
        env: &Env,
        sy_wrapper: &Address,
        pt_token: &Address,
        yt_token: &Address,
        oracle: &Address,
        permissioning: &Address,
        underlying: &Address,
        maturity: u64,
    ) {
        let sy_client = SYWrapperClient::new(env, sy_wrapper);
        let pt_client = PTTokenClient::new(env, pt_token);
        let yt_client = YTTokenClient::new(env, yt_token);

        if sy_client.underlying_address() != *underlying
            || pt_client.underlying_address() != *underlying
            || yt_client.underlying_address() != *underlying
        {
            panic_with_error!(env, Error::TopologyMismatch);
        }

        if sy_client.permissioning_address() != *permissioning
            || pt_client.permissioning_address() != *permissioning
            || yt_client.permissioning_address() != *permissioning
        {
            panic_with_error!(env, Error::TopologyMismatch);
        }

        if pt_client.maturity() != maturity || yt_client.maturity() != maturity {
            panic_with_error!(env, Error::TopologyMismatch);
        }

        if yt_client.oracle_address() != *oracle {
            panic_with_error!(env, Error::TopologyMismatch);
        }
    }

    fn get_oracle_rate(env: &Env) -> i128 {
        let oracle_addr: Address = env
            .storage()
            .instance()
            .get(&DataKey::Oracle)
            .unwrap_or_else(|| panic_with_error!(env, Error::NotInitialized));
        OracleClient::new(env, &oracle_addr).get_reference_value()
    }

    fn assert_oracle_fresh(env: &Env) {
        let oracle_addr: Address = env
            .storage()
            .instance()
            .get(&DataKey::Oracle)
            .unwrap_or_else(|| panic_with_error!(env, Error::NotInitialized));
        if !OracleClient::new(env, &oracle_addr).is_fresh(&MAX_ORACLE_STALENESS_SECS) {
            panic_with_error!(env, Error::OracleStale);
        }
    }

    fn assert_permitted(env: &Env, account: &Address) {
        let perm_addr: Address = env
            .storage()
            .instance()
            .get(&DataKey::Permissioning)
            .unwrap_or_else(|| panic_with_error!(env, Error::NotInitialized));
        if !PermClient::new(env, &perm_addr).is_allowed(account) {
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

    fn get_sy_wrapper(env: &Env) -> Address {
        env.storage()
            .instance()
            .get(&DataKey::SYWrapper)
            .unwrap_or_else(|| panic_with_error!(env, Error::NotInitialized))
    }

    fn get_pt_token(env: &Env) -> Address {
        env.storage()
            .instance()
            .get(&DataKey::PTToken)
            .unwrap_or_else(|| panic_with_error!(env, Error::NotInitialized))
    }

    fn get_yt_token(env: &Env) -> Address {
        env.storage()
            .instance()
            .get(&DataKey::YTToken)
            .unwrap_or_else(|| panic_with_error!(env, Error::NotInitialized))
    }

    /// Convert a desired underlying payout into the SY shares needed to withdraw it, at
    /// SYWrapper's current exchange rate (a different rate from the Oracle's pricing feed --
    /// see this module's doc comment). Inverts SYWrapper's own `shares * rate / RATE_SCALE`.
    fn underlying_to_shares(exchange_rate: i128, underlying: i128) -> i128 {
        underlying * SCALE / exchange_rate
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

    fn assert_not_paused(env: &Env) {
        if env
            .storage()
            .instance()
            .get(&DataKey::Paused)
            .unwrap_or(false)
        {
            panic_with_error!(env, Error::Paused);
        }
    }

    fn assert_mature(env: &Env) {
        let mat: u64 = env
            .storage()
            .instance()
            .get(&DataKey::Maturity)
            .unwrap_or(u64::MAX);
        if env.ledger().timestamp() < mat {
            panic_with_error!(env, Error::NotMature);
        }
    }

    fn assert_not_mature(env: &Env) {
        let mat: u64 = env
            .storage()
            .instance()
            .get(&DataKey::Maturity)
            .unwrap_or(u64::MAX);
        if env.ledger().timestamp() >= mat {
            panic_with_error!(env, Error::AlreadyMature);
        }
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
    use principal_pt_token::{PTTokenContract, PTTokenContractClient};
    use principal_sy_wrapper::{SYWrapperContract, SYWrapperContractClient};
    use principal_yt_token::{YTTokenContract, YTTokenContractClient};

    use super::{
        PrincipalManagerContract, PrincipalManagerContractClient, MAX_ORACLE_STALENESS_SECS, SCALE,
    };

    /// Base ledger timestamp (> 0 so the oracle can accept its first update).
    const T0: u64 = 1_000;

    /// All contracts deployed into the same Env, returned together so tests can
    /// create addresses, advance ledger time, and update the oracle/mint SY after setup.
    struct TestFixture {
        env: Env,
        client: PrincipalManagerContractClient<'static>,
        pm_id: Address,
        pm_admin: Address,
        underlying: Address,
        oracle: OracleAdapterContractClient<'static>,
        oracle_admin: Address,
        perm: PermissioningContractClient<'static>,
        perm_admin: Address,
        sy: SYWrapperContractClient<'static>,
        pt: PTTokenContractClient<'static>,
        yt: YTTokenContractClient<'static>,
    }

    /// Deploy the full contract set (oracle, permissioning, an underlying SAC, SYWrapper,
    /// PTToken, YTToken, PrincipalManager) into a single Env, and wire PrincipalManager as the
    /// registered minter on both token contracts -- mirroring the real two-phase deployment
    /// order in DEPLOYMENT.md. Oracle rate is seeded at SCALE (1.0) at ledger timestamp T0.
    /// `pm_admin` is also the underlying SAC's real admin, satisfying the market-creation gate
    /// on every contract. No users are pre-granted -- tests call `grant_user` explicitly.
    fn setup(maturity: u64) -> TestFixture {
        let env = Env::default();
        env.mock_all_auths();
        env.ledger().with_mut(|li| li.timestamp = T0);

        let oracle_id = env.register_contract(None, OracleAdapterContract);
        let oracle = OracleAdapterContractClient::new(&env, &oracle_id);
        let oracle_admin = Address::generate(&env);
        oracle.initialize(&oracle_admin);
        oracle.set_reference_value(&oracle_admin, &SCALE, &T0);

        let perm_id = env.register_contract(None, PermissioningContract);
        let perm = PermissioningContractClient::new(&env, &perm_id);
        let perm_admin = Address::generate(&env);
        perm.initialize(&perm_admin);

        let pm_admin = Address::generate(&env);
        let underlying_sac = env.register_stellar_asset_contract_v2(pm_admin.clone());
        underlying_sac.issuer().set_flag(IssuerFlags::RevocableFlag);
        let underlying = underlying_sac.address();

        let sy_id = env.register_contract(None, SYWrapperContract);
        let sy = SYWrapperContractClient::new(&env, &sy_id);
        sy.initialize(&pm_admin, &underlying, &perm_id);

        let pt_id = env.register_contract(None, PTTokenContract);
        let pt = PTTokenContractClient::new(&env, &pt_id);
        pt.initialize(
            &pm_admin,
            &perm_id,
            &underlying,
            &maturity,
            &String::from_str(&env, "Principal Token USDY"),
            &String::from_str(&env, "PT-USDY"),
            &7,
        );

        let yt_id = env.register_contract(None, YTTokenContract);
        let yt = YTTokenContractClient::new(&env, &yt_id);
        yt.initialize(
            &pm_admin,
            &perm_id,
            &underlying,
            &oracle_id,
            &maturity,
            &String::from_str(&env, "Yield Token USDY"),
            &String::from_str(&env, "YT-USDY"),
            &7,
        );

        let pm_id = env.register_contract(None, PrincipalManagerContract);
        let client = PrincipalManagerContractClient::new(&env, &pm_id);
        client.initialize(
            &pm_admin, &sy_id, &pt_id, &yt_id, &oracle_id, &perm_id, &underlying, &maturity,
        );

        pt.set_minter(&pm_admin, &pm_id);
        yt.set_minter(&pm_admin, &pm_id);

        // PrincipalManager's own address becomes a genuine SY holder between mint and
        // redemption, and a transfer/withdraw recipient-or-sender on both sides -- it needs
        // the same two compliance layers as any other participant.
        perm.grant_account(&perm_admin, &pm_id);
        token::StellarAssetClient::new(&env, &underlying).set_authorized(&pm_id, &true);

        TestFixture {
            env,
            client,
            pm_id,
            pm_admin,
            underlying,
            oracle,
            oracle_admin,
            perm,
            perm_admin,
            sy,
            pt,
            yt,
        }
    }

    /// Grants a user both compliance layers on the shared Permissioning/SAC, plus the
    /// per-asset PT/YT grants PTToken/YTToken independently require, and mints them
    /// `underlying_amount` of the underlying asset. Does not deposit into SYWrapper --
    /// call `deposit_sy` for that, since not every test needs a real SY position.
    fn grant_user(f: &TestFixture, user: &Address) {
        f.perm.grant_account(&f.perm_admin, user);
        f.perm.grant_asset(&f.perm_admin, user, &f.pt.address);
        f.perm.grant_asset(&f.perm_admin, user, &f.yt.address);
        token::StellarAssetClient::new(&f.env, &f.underlying).set_authorized(user, &true);
    }

    /// Mints `amount` of the underlying to `user` and deposits it into SYWrapper, returning the
    /// SY shares received (1:1 at inception). `user` must already be granted.
    fn deposit_sy(f: &TestFixture, user: &Address, amount: i128) -> i128 {
        token::StellarAssetClient::new(&f.env, &f.underlying).mint(user, &amount);
        f.sy.deposit(user, &amount)
    }

    // --- tests ---

    #[test]
    fn mint_before_maturity() {
        let f = setup(u64::MAX);
        let user = Address::generate(&f.env);
        grant_user(&f, &user);
        let shares = deposit_sy(&f, &user, 100_i128 * SCALE);

        let result = f.client.mint(&user, &shares);
        // Oracle rate = SCALE → notional = 100 * SCALE * SCALE / SCALE = 100 * SCALE.
        assert_eq!(result.pt_minted, 100_i128 * SCALE);
        assert_eq!(result.yt_minted, 100_i128 * SCALE);
        assert_eq!(f.client.pt_balance(&user), 100_i128 * SCALE);
        assert_eq!(f.client.yt_balance(&user), 100_i128 * SCALE);
        // Real custody: the shares moved from the user to PrincipalManager itself.
        assert_eq!(f.sy.balance_of(&user), 0);
        assert_eq!(f.sy.balance_of(&f.pm_id), shares);
    }

    #[test]
    #[should_panic]
    fn mint_after_maturity_panics() {
        // maturity = T0 means the contract is already mature at ledger time T0.
        let f = setup(T0);
        let user = Address::generate(&f.env);
        grant_user(&f, &user);
        let shares = deposit_sy(&f, &user, 100_i128 * SCALE);
        f.client.mint(&user, &shares);
    }

    #[test]
    #[should_panic]
    fn redeem_before_maturity_panics() {
        let f = setup(u64::MAX);
        let user = Address::generate(&f.env);
        grant_user(&f, &user);
        let shares = deposit_sy(&f, &user, 10_i128 * SCALE);
        f.client.mint(&user, &shares);
        f.client.redeem(&user, &(10_i128 * SCALE), &0_i128);
    }

    #[test]
    fn total_supply_tracks_mints() {
        let f = setup(u64::MAX);
        let u1 = Address::generate(&f.env);
        let u2 = Address::generate(&f.env);
        grant_user(&f, &u1);
        grant_user(&f, &u2);
        let s1 = deposit_sy(&f, &u1, 30_i128 * SCALE);
        let s2 = deposit_sy(&f, &u2, 70_i128 * SCALE);

        f.client.mint(&u1, &s1);
        f.client.mint(&u2, &s2);
        assert_eq!(f.client.total_pt(), 100_i128 * SCALE);
        assert_eq!(f.client.total_yt(), 100_i128 * SCALE);
    }

    #[test]
    fn total_supply_decrements_after_redeem() {
        let maturity = T0 + 500;
        let f = setup(maturity);
        let user = Address::generate(&f.env);
        grant_user(&f, &user);
        let shares = deposit_sy(&f, &user, 100_i128 * SCALE);

        let result = f.client.mint(&user, &shares);
        let pt = result.pt_minted;
        let yt = result.yt_minted;
        assert_eq!(f.client.total_pt(), pt);
        assert_eq!(f.client.total_yt(), yt);

        // Advance past maturity; oracle stays fresh (T0+501 − T0 = 501 < 3600).
        f.env.ledger().with_mut(|li| li.timestamp = maturity + 1);
        f.oracle.set_reference_value(&f.oracle_admin,&SCALE,&(maturity+1));

        f.client.redeem(&user, &pt, &0_i128);
        assert_eq!(f.client.total_pt(), 0);
        assert_eq!(f.client.total_yt(), yt); // YT supply unchanged

        // YT with no rate change → nothing accrued in YTToken's index → 0 returned, and the
        // YT balance itself is still burned down to 0.
        f.client.redeem(&user, &0_i128, &yt);
        assert_eq!(f.client.total_yt(), 0);
    }

    #[test]
    fn redeem_pt_correct_formula() {
        let maturity = T0 + 500;
        let f = setup(maturity);
        let user = Address::generate(&f.env);
        grant_user(&f, &user);
        let shares = deposit_sy(&f, &user, 100_i128 * SCALE);

        // Mint at rate = SCALE (1.0).
        let result = f.client.mint(&user, &shares);
        let pt = result.pt_minted; // = 100 * SCALE

        // Advance to maturity; update oracle to 1.03.
        f.env.ledger().with_mut(|li| li.timestamp = maturity + 1);
        let final_rate: i128 = 10_300_000;
        f.oracle
            .set_reference_value(&f.oracle_admin, &final_rate, &(maturity + 1));

        let r = f.client.redeem(&user, &pt, &0_i128);
        let expected = pt * SCALE / final_rate;
        assert_eq!(r.underlying_from_pt, expected);
        assert_eq!(r.underlying_from_yt, 0);
        // Real transfer: the user actually received the underlying asset.
        assert_eq!(token::Client::new(&f.env, &f.underlying).balance(&user), expected);
    }

    #[test]
    fn redeem_yt_correct_formula_with_yield() {
        let maturity = T0 + 500;
        let f = setup(maturity);
        let user = Address::generate(&f.env);
        grant_user(&f, &user);
        let shares = deposit_sy(&f, &user, 100_i128 * SCALE);

        // Mint at rate = SCALE (1.0).
        let result = f.client.mint(&user, &shares);
        let yt = result.yt_minted; // = 100 * SCALE

        // Advance to maturity; oracle → 1.03.
        f.env.ledger().with_mut(|li| li.timestamp = maturity + 1);
        let final_rate: i128 = 10_300_000;
        f.oracle
            .set_reference_value(&f.oracle_admin, &final_rate, &(maturity + 1));

        let r = f.client.redeem(&user, &0_i128, &yt);
        // Earned credit is the original underlying less its ceiling principal reserve.
        let expected=yt-(yt*SCALE+final_rate-1)/final_rate;
        assert_eq!(r.underlying_from_yt, expected);
        assert_eq!(r.underlying_from_pt, 0);
    }

    #[test]
    fn redeem_yt_does_not_double_pay_yield_already_claimed_via_claim_yield() {
        // PrincipalManager.claim_yield lets a holder collect accrued yield ahead of redemption,
        // paying real underlying (H-03). If a user claims this way and then redeems, redeem()
        // must not pay out that same accrued amount a second time -- both paths settle against
        // the same YTToken index, so whichever runs second sees nothing left pending.
        let maturity = T0 + 500;
        let f = setup(maturity);
        let user = Address::generate(&f.env);
        grant_user(&f, &user);
        let shares = deposit_sy(&f, &user, 100_i128 * SCALE);
        let result = f.client.mint(&user, &shares);
        let yt = result.yt_minted;

        f.env.ledger().with_mut(|li| li.timestamp = maturity + 1);
        f.oracle
            .set_reference_value(&f.oracle_admin, &10_300_000_i128, &(maturity + 1));

        // User claims ahead of redemption; this must actually pay out real underlying.
        let direct_claim = f.client.claim_yield(&user);
        assert!(direct_claim > 0);
        assert_eq!(
            token::Client::new(&f.env, &f.underlying).balance(&user),
            direct_claim
        );

        // Redemption must not pay the same yield again.
        let r = f.client.redeem(&user, &0_i128, &yt);
        assert_eq!(r.underlying_from_yt, 0);
    }

    #[test]
    #[should_panic]
    fn claim_yield_cannot_be_called_directly_on_yt_token() {
        // H-03 regression: the old direct-claim footgun the audit flagged must be closed --
        // YTToken.claim_yield is now minter-gated, so a user (not PrincipalManager) calling it
        // directly must fail, not silently zero their pending claim with no payment.
        let maturity = T0 + 500;
        let f = setup(maturity);
        let user = Address::generate(&f.env);
        grant_user(&f, &user);
        let shares = deposit_sy(&f, &user, 100_i128 * SCALE);
        f.client.mint(&user, &shares);

        f.env.ledger().with_mut(|li| li.timestamp = maturity + 1);
        f.oracle
            .set_reference_value(&f.oracle_admin, &10_300_000_i128, &(maturity + 1));

        f.yt.update_yield_index();
        f.yt.claim_yield(&user, &user);
    }

    #[test]
    fn redeem_yt_zero_when_no_yield() {
        let maturity = T0 + 500;
        let f = setup(maturity);
        let user = Address::generate(&f.env);
        grant_user(&f, &user);
        let shares = deposit_sy(&f, &user, 100_i128 * SCALE);

        let result = f.client.mint(&user, &shares);
        let yt = result.yt_minted;

        // Oracle set at T0; ledger at T0+501 → delta = 501 < 3600 → fresh.
        f.env.ledger().with_mut(|li| li.timestamp = maturity + 1);
        f.oracle.set_reference_value(&f.oracle_admin,&SCALE,&(maturity+1));

        let r = f.client.redeem(&user, &0_i128, &yt);
        assert_eq!(r.underlying_from_yt, 0); // rate never moved → nothing accrued
    }

    #[test]
    #[should_panic]
    fn oracle_stale_blocks_redeem() {
        let maturity = T0 + 500;
        let f = setup(maturity);
        let user = Address::generate(&f.env);
        grant_user(&f, &user);
        let shares = deposit_sy(&f, &user, 10_i128 * SCALE);
        f.client.mint(&user, &shares);

        // Advance past maturity AND past the 1-hour staleness window.
        // Oracle set at T0=1000; ledger → 1000+3601=4601 → delta=3601 > 3600 → stale.
        f.env
            .ledger()
            .with_mut(|li| li.timestamp = T0 + MAX_ORACLE_STALENESS_SECS + 1);
        f.client.redeem(&user, &(10_i128 * SCALE), &0_i128);
    }

    #[test]
    #[should_panic]
    fn oracle_stale_blocks_mint() {
        // H-02 regression: mint() must enforce the same freshness gate redeem() already has.
        let f = setup(u64::MAX);
        let user = Address::generate(&f.env);
        grant_user(&f, &user);
        let shares = deposit_sy(&f, &user, 10_i128 * SCALE);

        f.env
            .ledger()
            .with_mut(|li| li.timestamp = T0 + MAX_ORACLE_STALENESS_SECS + 1);
        f.client.mint(&user, &shares);
    }

    #[test]
    fn late_minter_does_not_receive_prior_yield() {
        // H-01 regression (PrincipalManager side): mint() must bring the YT yield index
        // current BEFORE crediting a new mint's balance. Otherwise a rate movement that
        // happened before a user's mint would sit unrealized in the global factor and get
        // credited to that user as soon as anyone eventually calls update_yield_index(),
        // double-counting the same oracle move already priced into their notional at mint.
        let f = setup(u64::MAX);

        let early_user = Address::generate(&f.env);
        grant_user(&f, &early_user);
        let early_shares = deposit_sy(&f, &early_user, 10_i128 * SCALE);
        f.client.mint(&early_user, &early_shares);

        // Rate moves up before the second user ever mints.
        f.env.ledger().with_mut(|li| li.timestamp = T0 + 100);
        f.oracle
            .set_reference_value(&f.oracle_admin, &(SCALE * 11 / 10), &(T0 + 100));

        let late_user = Address::generate(&f.env);
        grant_user(&f, &late_user);
        let late_shares = deposit_sy(&f, &late_user, 10_i128 * SCALE);
        f.client.mint(&late_user, &late_shares);

        // The late minter must not be able to claim any of the yield generated by the rate
        // movement that happened before they ever held YT.
        assert_eq!(f.client.claim_yield(&late_user), 0);
    }

    #[test]
    #[should_panic]
    fn unpermissioned_user_cannot_mint() {
        let f = setup(u64::MAX);
        // stranger was never granted, so it also can't deposit into SYWrapper -- but even a
        // caller who somehow held shares would still be rejected at PrincipalManager's own gate.
        let stranger = Address::generate(&f.env);
        f.client.mint(&stranger, &(10_i128 * SCALE));
    }

    #[test]
    #[should_panic]
    fn revoked_user_cannot_redeem() {
        // Closes the audit gap: redeem() previously had no permissioning check at all.
        let maturity = T0 + 500;
        let f = setup(maturity);
        let user = Address::generate(&f.env);
        grant_user(&f, &user);
        let shares = deposit_sy(&f, &user, 10_i128 * SCALE);
        let result = f.client.mint(&user, &shares);

        f.perm.revoke_account(&f.perm_admin, &user);
        f.env.ledger().with_mut(|li| li.timestamp = maturity + 1);
        f.client.redeem(&user, &result.pt_minted, &0_i128);
    }

    #[test]
    fn admin_transfer() {
        let f = setup(u64::MAX);
        let new_admin = Address::generate(&f.env);
        f.client.transfer_admin(&f.pm_admin, &new_admin);
        assert_eq!(f.client.get_admin(), new_admin);
    }

    #[test]
    #[should_panic]
    fn initialize_rejects_admin_not_matching_sac_admin() {
        let env = Env::default();
        env.mock_all_auths();
        env.ledger().with_mut(|li| li.timestamp = T0);

        let oracle_id = env.register_contract(None, OracleAdapterContract);
        let oracle = OracleAdapterContractClient::new(&env, &oracle_id);
        let oracle_admin = Address::generate(&env);
        oracle.initialize(&oracle_admin);
        oracle.set_reference_value(&oracle_admin, &SCALE, &T0);

        let perm_id = env.register_contract(None, PermissioningContract);
        let perm = PermissioningContractClient::new(&env, &perm_id);
        let perm_admin = Address::generate(&env);
        perm.initialize(&perm_admin);

        let real_sac_admin = Address::generate(&env);
        let underlying = env
            .register_stellar_asset_contract_v2(real_sac_admin.clone())
            .address();

        let impostor = Address::generate(&env);
        let pm_id = env.register_contract(None, PrincipalManagerContract);
        let client = PrincipalManagerContractClient::new(&env, &pm_id);
        let sy_wrapper = Address::generate(&env);
        let pt_token = Address::generate(&env);
        let yt_token = Address::generate(&env);
        // impostor is not the underlying SAC's admin -- market creation must be rejected.
        client.initialize(
            &impostor,
            &sy_wrapper,
            &pt_token,
            &yt_token,
            &oracle_id,
            &perm_id,
            &underlying,
            &u64::MAX,
        );
    }

    /// Deploys oracle + permissioning + an underlying SAC (admined by a freshly generated
    /// address) shared by every test in the M-01 topology-mismatch group below, so each test
    /// only needs to construct the one deliberately-mismatched piece itself.
    struct TopologyBase {
        env: Env,
        admin: Address,
        underlying: Address,
        oracle_id: Address,
        perm_id: Address,
    }

    fn topology_base() -> TopologyBase {
        let env = Env::default();
        env.mock_all_auths();
        env.ledger().with_mut(|li| li.timestamp = T0);

        let oracle_id = env.register_contract(None, OracleAdapterContract);
        let oracle = OracleAdapterContractClient::new(&env, &oracle_id);
        let admin = Address::generate(&env);
        oracle.initialize(&admin);
        oracle.set_reference_value(&admin, &SCALE, &T0);

        let perm_id = env.register_contract(None, PermissioningContract);
        PermissioningContractClient::new(&env, &perm_id).initialize(&admin);

        let underlying = env
            .register_stellar_asset_contract_v2(admin.clone())
            .address();

        TopologyBase {
            env,
            admin,
            underlying,
            oracle_id,
            perm_id,
        }
    }

    #[test]
    #[should_panic]
    fn initialize_rejects_mismatched_underlying() {
        // M-01 regression: PTToken deployed against a different underlying SAC than the one
        // this market's PrincipalManager is configured with.
        let b = topology_base();
        let other_underlying = b
            .env
            .register_stellar_asset_contract_v2(b.admin.clone())
            .address();

        let sy_id = b.env.register_contract(None, SYWrapperContract);
        SYWrapperContractClient::new(&b.env, &sy_id).initialize(&b.admin, &b.underlying, &b.perm_id);

        let pt_id = b.env.register_contract(None, PTTokenContract);
        PTTokenContractClient::new(&b.env, &pt_id).initialize(
            &b.admin,
            &b.perm_id,
            &other_underlying, // mismatched
            &u64::MAX,
            &String::from_str(&b.env, "Principal Token USDY"),
            &String::from_str(&b.env, "PT-USDY"),
            &7,
        );

        let yt_id = b.env.register_contract(None, YTTokenContract);
        YTTokenContractClient::new(&b.env, &yt_id).initialize(
            &b.admin,
            &b.perm_id,
            &b.underlying,
            &b.oracle_id,
            &u64::MAX,
            &String::from_str(&b.env, "Yield Token USDY"),
            &String::from_str(&b.env, "YT-USDY"),
            &7,
        );

        let pm_id = b.env.register_contract(None, PrincipalManagerContract);
        PrincipalManagerContractClient::new(&b.env, &pm_id).initialize(
            &b.admin, &sy_id, &pt_id, &yt_id, &b.oracle_id, &b.perm_id, &b.underlying, &u64::MAX,
        );
    }

    #[test]
    #[should_panic]
    fn initialize_rejects_mismatched_permissioning() {
        // M-01 regression: YTToken deployed against a different permissioning contract than
        // the one this market's PrincipalManager is configured with.
        let b = topology_base();
        let other_perm_id = b.env.register_contract(None, PermissioningContract);
        PermissioningContractClient::new(&b.env, &other_perm_id).initialize(&b.admin);

        let sy_id = b.env.register_contract(None, SYWrapperContract);
        SYWrapperContractClient::new(&b.env, &sy_id).initialize(&b.admin, &b.underlying, &b.perm_id);

        let pt_id = b.env.register_contract(None, PTTokenContract);
        PTTokenContractClient::new(&b.env, &pt_id).initialize(
            &b.admin,
            &b.perm_id,
            &b.underlying,
            &u64::MAX,
            &String::from_str(&b.env, "Principal Token USDY"),
            &String::from_str(&b.env, "PT-USDY"),
            &7,
        );

        let yt_id = b.env.register_contract(None, YTTokenContract);
        YTTokenContractClient::new(&b.env, &yt_id).initialize(
            &b.admin,
            &other_perm_id, // mismatched
            &b.underlying,
            &b.oracle_id,
            &u64::MAX,
            &String::from_str(&b.env, "Yield Token USDY"),
            &String::from_str(&b.env, "YT-USDY"),
            &7,
        );

        let pm_id = b.env.register_contract(None, PrincipalManagerContract);
        PrincipalManagerContractClient::new(&b.env, &pm_id).initialize(
            &b.admin, &sy_id, &pt_id, &yt_id, &b.oracle_id, &b.perm_id, &b.underlying, &u64::MAX,
        );
    }

    #[test]
    #[should_panic]
    fn initialize_rejects_mismatched_maturity() {
        // M-01 regression: YTToken deployed with a different maturity than the one passed to
        // PrincipalManager.initialize (PTToken's maturity matches; YTToken's doesn't).
        let b = topology_base();
        let maturity = T0 + 500;

        let sy_id = b.env.register_contract(None, SYWrapperContract);
        SYWrapperContractClient::new(&b.env, &sy_id).initialize(&b.admin, &b.underlying, &b.perm_id);

        let pt_id = b.env.register_contract(None, PTTokenContract);
        PTTokenContractClient::new(&b.env, &pt_id).initialize(
            &b.admin,
            &b.perm_id,
            &b.underlying,
            &maturity,
            &String::from_str(&b.env, "Principal Token USDY"),
            &String::from_str(&b.env, "PT-USDY"),
            &7,
        );

        let yt_id = b.env.register_contract(None, YTTokenContract);
        YTTokenContractClient::new(&b.env, &yt_id).initialize(
            &b.admin,
            &b.perm_id,
            &b.underlying,
            &b.oracle_id,
            &(maturity + 1), // mismatched
            &String::from_str(&b.env, "Yield Token USDY"),
            &String::from_str(&b.env, "YT-USDY"),
            &7,
        );

        let pm_id = b.env.register_contract(None, PrincipalManagerContract);
        PrincipalManagerContractClient::new(&b.env, &pm_id).initialize(
            &b.admin, &sy_id, &pt_id, &yt_id, &b.oracle_id, &b.perm_id, &b.underlying, &maturity,
        );
    }

    #[test]
    #[should_panic]
    fn initialize_rejects_mismatched_oracle() {
        // M-01 regression: YTToken deployed against a different oracle than the one passed to
        // PrincipalManager.initialize.
        let b = topology_base();
        let other_oracle_id = b.env.register_contract(None, OracleAdapterContract);
        let other_oracle = OracleAdapterContractClient::new(&b.env, &other_oracle_id);
        other_oracle.initialize(&b.admin);
        other_oracle.set_reference_value(&b.admin, &SCALE, &T0);

        let sy_id = b.env.register_contract(None, SYWrapperContract);
        SYWrapperContractClient::new(&b.env, &sy_id).initialize(&b.admin, &b.underlying, &b.perm_id);

        let pt_id = b.env.register_contract(None, PTTokenContract);
        PTTokenContractClient::new(&b.env, &pt_id).initialize(
            &b.admin,
            &b.perm_id,
            &b.underlying,
            &u64::MAX,
            &String::from_str(&b.env, "Principal Token USDY"),
            &String::from_str(&b.env, "PT-USDY"),
            &7,
        );

        let yt_id = b.env.register_contract(None, YTTokenContract);
        YTTokenContractClient::new(&b.env, &yt_id).initialize(
            &b.admin,
            &b.perm_id,
            &b.underlying,
            &other_oracle_id, // mismatched
            &u64::MAX,
            &String::from_str(&b.env, "Yield Token USDY"),
            &String::from_str(&b.env, "YT-USDY"),
            &7,
        );

        let pm_id = b.env.register_contract(None, PrincipalManagerContract);
        PrincipalManagerContractClient::new(&b.env, &pm_id).initialize(
            &b.admin, &sy_id, &pt_id, &yt_id, &b.oracle_id, &b.perm_id, &b.underlying, &u64::MAX,
        );
    }

    #[test]
    #[should_panic]
    fn deauthorized_on_sac_cannot_mint() {
        // Granted in Principal's own Permissioning, but never authorized (or since revoked) on
        // the underlying SAC -- the mandatory floor inherited from the issuer must still block.
        let f = setup(u64::MAX);
        let user = Address::generate(&f.env);
        f.perm.grant_account(&f.perm_admin, &user);
        token::StellarAssetClient::new(&f.env, &f.underlying).set_authorized(&user, &false);
        f.client.mint(&user, &(10_i128 * SCALE));
    }

    #[test]
    #[should_panic]
    fn deauthorized_on_sac_cannot_redeem() {
        let maturity = T0 + 500;
        let f = setup(maturity);
        let user = Address::generate(&f.env);
        grant_user(&f, &user);
        let shares = deposit_sy(&f, &user, 10_i128 * SCALE);
        let result = f.client.mint(&user, &shares);

        // Issuer deauthorizes the account directly on the underlying SAC (not via Principal's
        // own Permissioning) after mint but before redeem.
        token::StellarAssetClient::new(&f.env, &f.underlying).set_authorized(&user, &false);
        f.env.ledger().with_mut(|li| li.timestamp = maturity + 1);
        f.client.redeem(&user, &result.pt_minted, &0_i128);
    }

    #[test]
    #[should_panic]
    fn double_initialize_panics() {
        let f = setup(u64::MAX);
        f.client.initialize(
            &f.pm_admin,
            &f.sy.address,
            &f.pt.address,
            &f.yt.address,
            &f.oracle.address,
            &f.perm.address,
            &f.underlying,
            &u64::MAX,
        );
    }

    #[test]
    #[should_panic]
    fn mint_zero_shares_panics() {
        let f = setup(u64::MAX);
        let user = Address::generate(&f.env);
        grant_user(&f, &user);
        f.client.mint(&user, &0_i128);
    }

    #[test]
    #[should_panic]
    fn redeem_zero_amounts_panics() {
        let maturity = T0 + 500;
        let f = setup(maturity);
        let user = Address::generate(&f.env);
        grant_user(&f, &user);
        let shares = deposit_sy(&f, &user, 10_i128 * SCALE);
        f.client.mint(&user, &shares);

        f.env.ledger().with_mut(|li| li.timestamp = maturity + 1);
        f.client.redeem(&user, &0_i128, &0_i128);
    }

    #[test]
    #[should_panic]
    fn non_admin_cannot_transfer_admin() {
        let f = setup(u64::MAX);
        let impostor = Address::generate(&f.env);
        let new_admin = Address::generate(&f.env);
        f.client.transfer_admin(&impostor, &new_admin);
    }
}
