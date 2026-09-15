use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{self, Mint, Token, TokenAccount, TransferChecked};
use solana_program::hash::hashv;

declare_id!("3WxhciNh6XDy9iCYZtoHx2Y8LzbpTRELJURPkLGX81MM");

const ESCROW_SEED: &[u8] = b"workseal-v1";
const ED25519_SPKI_PREFIX: &[u8] = &[
    0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00,
];

#[program]
pub mod workseal_escrow {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>, args: InitializeArgs) -> Result<()> {
        require!(args.amount > 0, WorkSealEscrowError::ZeroAmount);
        require!(
            args.refund_after_unix > Clock::get()?.unix_timestamp,
            WorkSealEscrowError::RefundDeadlineNotFuture
        );
        let escrow = &mut ctx.accounts.escrow;
        escrow.task_digest = args.task_digest;
        escrow.receipt_authority_fingerprint = args.receipt_authority_fingerprint;
        escrow.buyer = ctx.accounts.buyer.key();
        escrow.worker = ctx.accounts.worker.key();
        escrow.mint = ctx.accounts.mint.key();
        escrow.amount = args.amount;
        escrow.refund_after_unix = args.refund_after_unix;
        escrow.bump = ctx.bumps.escrow;
        escrow.phase = EscrowPhase::Unfunded as u8;
        escrow.generation = 0;
        escrow.result_digest = [0; 32];
        escrow.acceptance_digest = [0; 32];
        escrow.event_head = [0; 32];
        escrow.terminal_digest = [0; 32];
        Ok(())
    }

    pub fn fund(ctx: Context<Fund>) -> Result<()> {
        require!(
            ctx.accounts.escrow.phase == EscrowPhase::Unfunded as u8,
            WorkSealEscrowError::BadPhase
        );

        let cpi_accounts = TransferChecked {
            from: ctx.accounts.buyer_token.to_account_info(),
            mint: ctx.accounts.mint.to_account_info(),
            to: ctx.accounts.vault.to_account_info(),
            authority: ctx.accounts.buyer.to_account_info(),
        };
        token::transfer_checked(
            CpiContext::new(ctx.accounts.token_program.to_account_info(), cpi_accounts),
            ctx.accounts.escrow.amount,
            ctx.accounts.mint.decimals,
        )?;
        ctx.accounts.escrow.phase = EscrowPhase::Funded as u8;
        Ok(())
    }

    pub fn settle(ctx: Context<Settle>, args: SettleArgs) -> Result<()> {
        require!(
            ctx.accounts.escrow.phase == EscrowPhase::Funded as u8,
            WorkSealEscrowError::BadPhase
        );
        require!(args.generation > 0, WorkSealEscrowError::BadGeneration);

        // The verifier that signed the off-chain WorkSeal ACCEPT receipt must also sign
        // this Solana transaction. The transaction signature covers the exact settle
        // instruction data (result/acceptance/event-head/generation). The stored
        // fingerprint uses the same Ed25519 SPKI convention as WorkSeal's Node verifier.
        let verifier_raw = ctx.accounts.verifier.key().to_bytes();
        let verifier_fingerprint = hashv(&[ED25519_SPKI_PREFIX, verifier_raw.as_ref()]).to_bytes();
        require!(
            verifier_fingerprint == ctx.accounts.escrow.receipt_authority_fingerprint,
            WorkSealEscrowError::AuthorityMismatch
        );

        let task_digest = ctx.accounts.escrow.task_digest;
        let bump = ctx.accounts.escrow.bump;
        let amount = ctx.accounts.escrow.amount;
        let signer_seeds: &[&[u8]] = &[ESCROW_SEED, task_digest.as_ref(), &[bump]];

        let cpi_accounts = TransferChecked {
            from: ctx.accounts.vault.to_account_info(),
            mint: ctx.accounts.mint.to_account_info(),
            to: ctx.accounts.worker_token.to_account_info(),
            authority: ctx.accounts.escrow.to_account_info(),
        };
        token::transfer_checked(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                cpi_accounts,
                &[signer_seeds],
            ),
            amount,
            ctx.accounts.mint.decimals,
        )?;

        let escrow = &mut ctx.accounts.escrow;
        escrow.result_digest = args.result_digest;
        escrow.acceptance_digest = args.acceptance_digest;
        escrow.event_head = args.event_head;
        escrow.generation = args.generation;
        escrow.terminal_digest = hashv(&[
            b"workseal-settle-v1",
            args.result_digest.as_ref(),
            args.acceptance_digest.as_ref(),
            args.event_head.as_ref(),
            &args.generation.to_le_bytes(),
        ])
        .to_bytes();
        escrow.phase = EscrowPhase::Settled as u8;
        Ok(())
    }

    pub fn refund(ctx: Context<Refund>, reason_digest: [u8; 32]) -> Result<()> {
        require!(
            ctx.accounts.escrow.phase == EscrowPhase::Funded as u8,
            WorkSealEscrowError::BadPhase
        );

        // Refund is intentionally buyer-only. The buyer's Solana transaction signature
        // covers the exact reason digest; settlement and refund are mutually exclusive
        // because either transition leaves Funded permanently.
        let now = Clock::get()?.unix_timestamp;
        require!(
            now >= ctx.accounts.escrow.refund_after_unix,
            WorkSealEscrowError::RefundNotMature
        );
        let task_digest = ctx.accounts.escrow.task_digest;
        let bump = ctx.accounts.escrow.bump;
        let amount = ctx.accounts.escrow.amount;
        let signer_seeds: &[&[u8]] = &[ESCROW_SEED, task_digest.as_ref(), &[bump]];
        let cpi_accounts = TransferChecked {
            from: ctx.accounts.vault.to_account_info(),
            mint: ctx.accounts.mint.to_account_info(),
            to: ctx.accounts.buyer_token.to_account_info(),
            authority: ctx.accounts.escrow.to_account_info(),
        };
        token::transfer_checked(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                cpi_accounts,
                &[signer_seeds],
            ),
            amount,
            ctx.accounts.mint.decimals,
        )?;
        ctx.accounts.escrow.terminal_digest = hashv(&[
            b"workseal-refund-v1",
            ctx.accounts.escrow.task_digest.as_ref(),
            reason_digest.as_ref(),
        ])
        .to_bytes();
        ctx.accounts.escrow.phase = EscrowPhase::Refunded as u8;
        Ok(())
    }
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy)]
pub struct InitializeArgs {
    pub task_digest: [u8; 32],
    pub receipt_authority_fingerprint: [u8; 32],
    pub amount: u64,
    pub refund_after_unix: i64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy)]
pub struct SettleArgs {
    pub result_digest: [u8; 32],
    pub acceptance_digest: [u8; 32],
    pub event_head: [u8; 32],
    pub generation: u64,
}

#[derive(Accounts)]
#[instruction(args: InitializeArgs)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub buyer: Signer<'info>,
    // Worker co-signs initialization so the payer cannot unilaterally shorten the
    // task-bound refund deadline or alter amount/mint economics before funding.
    pub worker: Signer<'info>,
    pub mint: Account<'info, Mint>,
    #[account(
        init,
        payer = buyer,
        space = 8 + Escrow::LEN,
        seeds = [ESCROW_SEED, args.task_digest.as_ref()],
        bump
    )]
    pub escrow: Account<'info, Escrow>,
    #[account(
        init,
        payer = buyer,
        associated_token::mint = mint,
        associated_token::authority = escrow
    )]
    pub vault: Account<'info, TokenAccount>,
    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = buyer
    )]
    pub buyer_token: Account<'info, TokenAccount>,
    #[account(
        associated_token::mint = mint,
        associated_token::authority = worker
    )]
    pub worker_token: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Fund<'info> {
    #[account(mut)]
    pub buyer: Signer<'info>,
    pub mint: Account<'info, Mint>,
    #[account(
        mut,
        has_one = buyer,
        has_one = mint,
        seeds = [ESCROW_SEED, escrow.task_digest.as_ref()],
        bump = escrow.bump
    )]
    pub escrow: Account<'info, Escrow>,
    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = buyer
    )]
    pub buyer_token: Account<'info, TokenAccount>,
    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = escrow
    )]
    pub vault: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct Settle<'info> {
    pub verifier: Signer<'info>,
    /// CHECK: identity is constrained by Escrow::worker and its ATA below.
    pub worker: UncheckedAccount<'info>,
    pub mint: Account<'info, Mint>,
    #[account(
        mut,
        has_one = worker,
        has_one = mint,
        seeds = [ESCROW_SEED, escrow.task_digest.as_ref()],
        bump = escrow.bump
    )]
    pub escrow: Account<'info, Escrow>,
    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = escrow
    )]
    pub vault: Account<'info, TokenAccount>,
    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = worker
    )]
    pub worker_token: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct Refund<'info> {
    #[account(mut)]
    pub buyer: Signer<'info>,
    pub mint: Account<'info, Mint>,
    #[account(
        mut,
        has_one = buyer,
        has_one = mint,
        seeds = [ESCROW_SEED, escrow.task_digest.as_ref()],
        bump = escrow.bump
    )]
    pub escrow: Account<'info, Escrow>,
    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = escrow
    )]
    pub vault: Account<'info, TokenAccount>,
    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = buyer
    )]
    pub buyer_token: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[account]
pub struct Escrow {
    pub task_digest: [u8; 32],
    pub receipt_authority_fingerprint: [u8; 32],
    pub buyer: Pubkey,
    pub worker: Pubkey,
    pub mint: Pubkey,
    pub amount: u64,
    pub refund_after_unix: i64,
    pub bump: u8,
    pub phase: u8,
    pub generation: u64,
    pub result_digest: [u8; 32],
    pub acceptance_digest: [u8; 32],
    pub event_head: [u8; 32],
    pub terminal_digest: [u8; 32],
}

impl Escrow {
    pub const LEN: usize = (9 * 32) + 8 + 8 + 1 + 1 + 8;
}

#[repr(u8)]
pub enum EscrowPhase {
    Unfunded = 0,
    Funded = 1,
    Settled = 2,
    Refunded = 3,
}

#[error_code]
pub enum WorkSealEscrowError {
    #[msg("escrow phase does not permit this transition")]
    BadPhase,
    #[msg("amount must be positive")]
    ZeroAmount,
    #[msg("settlement generation must be positive")]
    BadGeneration,
    #[msg("settlement signer does not match the pinned WorkSeal verifier authority")]
    AuthorityMismatch,
    #[msg("buyer refund is not available before the task-bound refund deadline")]
    RefundNotMature,
    #[msg("refund deadline must be in the future when escrow is initialized")]
    RefundDeadlineNotFuture,
}
