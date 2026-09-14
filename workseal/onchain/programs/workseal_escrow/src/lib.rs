use anchor_lang::prelude::*;
use anchor_spl::token_interface::{self, Mint, TokenAccount, TokenInterface, TransferChecked};

declare_id!("BvfrbqcMAERN2VTA9LT84Y4j228UULhsz2iwtKo3aqeA");

const PHASE_CREATED: u8 = 0;
const PHASE_FUNDED: u8 = 1;
const PHASE_COMMITTED: u8 = 2;
const PHASE_ACCEPTED: u8 = 3;
const PHASE_RELEASED: u8 = 4;
const PHASE_REFUNDED: u8 = 5;
const PHASE_DISPUTED: u8 = 6;

#[program]
pub mod workseal_escrow {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>, args: InitializeArgs) -> Result<()> {
        require!(args.amount > 0, WorkSealEscrowError::ZeroAmount);
        require!(ctx.accounts.buyer.key() != ctx.accounts.worker.key(), WorkSealEscrowError::SameParty);
        require!(
            ctx.accounts.verifier.key() != ctx.accounts.buyer.key()
                && ctx.accounts.verifier.key() != ctx.accounts.worker.key(),
            WorkSealEscrowError::VerifierMustDiffer
        );
        require!(
            args.task_digest != [0; 32]
                && args.policy_digest != [0; 32]
                && args.receipt_authority_fingerprint != [0; 32],
            WorkSealEscrowError::ZeroDigest
        );
        require!(
            args.deadline_unix > Clock::get()?.unix_timestamp,
            WorkSealEscrowError::DeadlineNotFuture
        );

        let escrow = &mut ctx.accounts.escrow;
        escrow.version = 1;
        escrow.bump = ctx.bumps.escrow;
        escrow.vault_bump = ctx.bumps.vault;
        escrow.phase = PHASE_CREATED;
        escrow.buyer = ctx.accounts.buyer.key();
        escrow.worker = ctx.accounts.worker.key();
        escrow.verifier = ctx.accounts.verifier.key();
        escrow.mint = ctx.accounts.mint.key();
        escrow.token_program = ctx.accounts.token_program.key();
        escrow.buyer_token = ctx.accounts.buyer_token.key();
        escrow.worker_token = ctx.accounts.worker_token.key();
        escrow.task_digest = args.task_digest;
        escrow.policy_digest = args.policy_digest;
        escrow.receipt_authority_fingerprint = args.receipt_authority_fingerprint;
        escrow.amount = args.amount;
        escrow.deadline_unix = args.deadline_unix;
        escrow.generation = 0;
        escrow.result_digest = [0; 32];
        escrow.acceptance_digest = [0; 32];
        escrow.dispute_digest = [0; 32];
        escrow.settled_amount = 0;

        emit!(EscrowInitialized {
            escrow: escrow.key(),
            vault: ctx.accounts.vault.key(),
            task_digest: escrow.task_digest,
            policy_digest: escrow.policy_digest,
            buyer: escrow.buyer,
            worker: escrow.worker,
            verifier: escrow.verifier,
            mint: escrow.mint,
            buyer_token: escrow.buyer_token,
            worker_token: escrow.worker_token,
            amount: escrow.amount,
            deadline_unix: escrow.deadline_unix,
        });
        Ok(())
    }

    pub fn fund(ctx: Context<Fund>) -> Result<()> {
        require_eq!(ctx.accounts.escrow.phase, PHASE_CREATED, WorkSealEscrowError::BadPhase);
        let amount = ctx.accounts.escrow.amount;
        let cpi_accounts = TransferChecked {
            from: ctx.accounts.buyer_token.to_account_info(),
            mint: ctx.accounts.mint.to_account_info(),
            to: ctx.accounts.vault.to_account_info(),
            authority: ctx.accounts.buyer.to_account_info(),
        };
        token_interface::transfer_checked(
            CpiContext::new(ctx.accounts.token_program.to_account_info(), cpi_accounts),
            amount,
            ctx.accounts.mint.decimals,
        )?;
        ctx.accounts.escrow.phase = PHASE_FUNDED;
        emit!(EscrowFunded { escrow: ctx.accounts.escrow.key(), amount });
        Ok(())
    }

    pub fn commit_result(ctx: Context<CommitResult>, args: CommitResultArgs) -> Result<()> {
        let escrow = &mut ctx.accounts.escrow;
        require!(
            escrow.phase == PHASE_FUNDED || escrow.phase == PHASE_COMMITTED,
            WorkSealEscrowError::BadPhase
        );
        require!(args.task_digest == escrow.task_digest, WorkSealEscrowError::TaskDigestMismatch);
        require!(args.result_digest != [0; 32], WorkSealEscrowError::ZeroDigest);
        let expected = escrow.generation.checked_add(1).ok_or(error!(WorkSealEscrowError::GenerationOverflow))?;
        require_eq!(args.generation, expected, WorkSealEscrowError::GenerationMismatch);
        escrow.phase = PHASE_COMMITTED;
        escrow.generation = args.generation;
        escrow.result_digest = args.result_digest;
        escrow.acceptance_digest = [0; 32];
        emit!(ResultCommitted {
            escrow: escrow.key(),
            task_digest: escrow.task_digest,
            result_digest: escrow.result_digest,
            generation: escrow.generation,
        });
        Ok(())
    }

    pub fn accept_result(ctx: Context<AcceptResult>, args: AcceptResultArgs) -> Result<()> {
        let escrow = &mut ctx.accounts.escrow;
        require_eq!(escrow.phase, PHASE_COMMITTED, WorkSealEscrowError::BadPhase);
        require!(args.task_digest == escrow.task_digest, WorkSealEscrowError::TaskDigestMismatch);
        require!(args.result_digest == escrow.result_digest, WorkSealEscrowError::ResultDigestMismatch);
        require_eq!(args.generation, escrow.generation, WorkSealEscrowError::GenerationMismatch);
        require!(
            args.receipt_authority_fingerprint == escrow.receipt_authority_fingerprint,
            WorkSealEscrowError::ReceiptAuthorityMismatch
        );
        require!(args.acceptance_digest != [0; 32], WorkSealEscrowError::ZeroDigest);
        escrow.phase = PHASE_ACCEPTED;
        escrow.acceptance_digest = args.acceptance_digest;
        emit!(ResultAccepted {
            escrow: escrow.key(),
            task_digest: escrow.task_digest,
            result_digest: escrow.result_digest,
            acceptance_digest: escrow.acceptance_digest,
            receipt_authority_fingerprint: escrow.receipt_authority_fingerprint,
            verifier: escrow.verifier,
            generation: escrow.generation,
        });
        Ok(())
    }

    pub fn release(ctx: Context<Release>) -> Result<()> {
        require_eq!(ctx.accounts.escrow.phase, PHASE_ACCEPTED, WorkSealEscrowError::BadPhase);
        let amount = ctx.accounts.escrow.amount;
        require_gte!(ctx.accounts.vault.amount, amount, WorkSealEscrowError::InsufficientVaultBalance);
        require_eq!(ctx.accounts.escrow.settled_amount, 0, WorkSealEscrowError::AlreadySettled);

        let buyer = ctx.accounts.escrow.buyer;
        let worker = ctx.accounts.escrow.worker;
        let task_digest = ctx.accounts.escrow.task_digest;
        let mint = ctx.accounts.escrow.mint;
        let bump = [ctx.accounts.escrow.bump];
        let signer_seeds: &[&[u8]] = &[
            b"workseal",
            buyer.as_ref(),
            worker.as_ref(),
            task_digest.as_ref(),
            mint.as_ref(),
            &bump,
        ];
        let signer = &[signer_seeds];
        let cpi_accounts = TransferChecked {
            from: ctx.accounts.vault.to_account_info(),
            mint: ctx.accounts.mint.to_account_info(),
            to: ctx.accounts.worker_token.to_account_info(),
            authority: ctx.accounts.escrow.to_account_info(),
        };
        token_interface::transfer_checked(
            CpiContext::new_with_signer(ctx.accounts.token_program.to_account_info(), cpi_accounts, signer),
            amount,
            ctx.accounts.mint.decimals,
        )?;
        ctx.accounts.escrow.phase = PHASE_RELEASED;
        ctx.accounts.escrow.settled_amount = amount;
        emit!(EscrowReleased {
            escrow: ctx.accounts.escrow.key(),
            worker: ctx.accounts.escrow.worker,
            amount,
            result_digest: ctx.accounts.escrow.result_digest,
            acceptance_digest: ctx.accounts.escrow.acceptance_digest,
        });
        Ok(())
    }

    pub fn refund_expired(ctx: Context<RefundExpired>) -> Result<()> {
        require!(
            ctx.accounts.escrow.phase == PHASE_FUNDED || ctx.accounts.escrow.phase == PHASE_COMMITTED,
            WorkSealEscrowError::BadPhase
        );
        let now = Clock::get()?.unix_timestamp;
        require!(now > ctx.accounts.escrow.deadline_unix, WorkSealEscrowError::NotExpired);
        let amount = ctx.accounts.escrow.amount;
        require_gte!(ctx.accounts.vault.amount, amount, WorkSealEscrowError::InsufficientVaultBalance);
        require_eq!(ctx.accounts.escrow.settled_amount, 0, WorkSealEscrowError::AlreadySettled);

        let buyer = ctx.accounts.escrow.buyer;
        let worker = ctx.accounts.escrow.worker;
        let task_digest = ctx.accounts.escrow.task_digest;
        let mint = ctx.accounts.escrow.mint;
        let bump = [ctx.accounts.escrow.bump];
        let signer_seeds: &[&[u8]] = &[
            b"workseal",
            buyer.as_ref(),
            worker.as_ref(),
            task_digest.as_ref(),
            mint.as_ref(),
            &bump,
        ];
        let signer = &[signer_seeds];
        let cpi_accounts = TransferChecked {
            from: ctx.accounts.vault.to_account_info(),
            mint: ctx.accounts.mint.to_account_info(),
            to: ctx.accounts.buyer_token.to_account_info(),
            authority: ctx.accounts.escrow.to_account_info(),
        };
        token_interface::transfer_checked(
            CpiContext::new_with_signer(ctx.accounts.token_program.to_account_info(), cpi_accounts, signer),
            amount,
            ctx.accounts.mint.decimals,
        )?;
        ctx.accounts.escrow.phase = PHASE_REFUNDED;
        ctx.accounts.escrow.settled_amount = amount;
        emit!(EscrowRefunded { escrow: ctx.accounts.escrow.key(), buyer: ctx.accounts.escrow.buyer, amount, now_unix: now });
        Ok(())
    }

    pub fn dispute(ctx: Context<Dispute>, dispute_digest: [u8; 32]) -> Result<()> {
        require!(
            ctx.accounts.escrow.phase == PHASE_FUNDED || ctx.accounts.escrow.phase == PHASE_COMMITTED,
            WorkSealEscrowError::BadPhase
        );
        require!(dispute_digest != [0; 32], WorkSealEscrowError::ZeroDigest);
        let actor = ctx.accounts.actor.key();
        require!(
            actor == ctx.accounts.escrow.buyer || actor == ctx.accounts.escrow.worker,
            WorkSealEscrowError::DisputeAuthorityMismatch
        );
        ctx.accounts.escrow.phase = PHASE_DISPUTED;
        ctx.accounts.escrow.dispute_digest = dispute_digest;
        emit!(EscrowDisputed { escrow: ctx.accounts.escrow.key(), actor, dispute_digest });
        Ok(())
    }
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct InitializeArgs {
    pub task_digest: [u8; 32],
    pub policy_digest: [u8; 32],
    pub receipt_authority_fingerprint: [u8; 32],
    pub amount: u64,
    pub deadline_unix: i64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct CommitResultArgs {
    pub task_digest: [u8; 32],
    pub result_digest: [u8; 32],
    pub generation: u64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct AcceptResultArgs {
    pub task_digest: [u8; 32],
    pub result_digest: [u8; 32],
    pub acceptance_digest: [u8; 32],
    pub receipt_authority_fingerprint: [u8; 32],
    pub generation: u64,
}

#[derive(Accounts)]
#[instruction(args: InitializeArgs)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub buyer: Signer<'info>,
    /// CHECK: identity only; the worker signs later result commits.
    pub worker: UncheckedAccount<'info>,
    /// CHECK: identity only; the verifier signs later acceptance.
    pub verifier: UncheckedAccount<'info>,
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(token::mint = mint, token::authority = buyer, token::token_program = token_program)]
    pub buyer_token: InterfaceAccount<'info, TokenAccount>,
    #[account(token::mint = mint, token::authority = worker, token::token_program = token_program)]
    pub worker_token: InterfaceAccount<'info, TokenAccount>,
    #[account(
        init,
        payer = buyer,
        space = 8 + Escrow::INIT_SPACE,
        seeds = [b"workseal", buyer.key().as_ref(), worker.key().as_ref(), args.task_digest.as_ref(), mint.key().as_ref()],
        bump
    )]
    pub escrow: Account<'info, Escrow>,
    #[account(
        init,
        payer = buyer,
        token::mint = mint,
        token::authority = escrow,
        token::token_program = token_program,
        seeds = [b"vault", escrow.key().as_ref()],
        bump
    )]
    pub vault: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Fund<'info> {
    #[account(mut, address = escrow.buyer @ WorkSealEscrowError::BuyerMismatch)]
    pub buyer: Signer<'info>,
    #[account(
        mut,
        seeds = [b"workseal", escrow.buyer.as_ref(), escrow.worker.as_ref(), escrow.task_digest.as_ref(), escrow.mint.as_ref()],
        bump = escrow.bump,
        constraint = escrow.mint == mint.key() @ WorkSealEscrowError::MintMismatch,
        constraint = escrow.token_program == token_program.key() @ WorkSealEscrowError::TokenProgramMismatch
    )]
    pub escrow: Account<'info, Escrow>,
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(
        mut,
        address = escrow.buyer_token @ WorkSealEscrowError::TokenAccountMismatch,
        token::mint = mint,
        token::authority = buyer,
        token::token_program = token_program
    )]
    pub buyer_token: InterfaceAccount<'info, TokenAccount>,
    #[account(
        mut,
        seeds = [b"vault", escrow.key().as_ref()],
        bump = escrow.vault_bump,
        token::mint = mint,
        token::authority = escrow,
        token::token_program = token_program
    )]
    pub vault: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Interface<'info, TokenInterface>,
}

#[derive(Accounts)]
pub struct CommitResult<'info> {
    #[account(address = escrow.worker @ WorkSealEscrowError::WorkerMismatch)]
    pub worker: Signer<'info>,
    #[account(
        mut,
        seeds = [b"workseal", escrow.buyer.as_ref(), escrow.worker.as_ref(), escrow.task_digest.as_ref(), escrow.mint.as_ref()],
        bump = escrow.bump
    )]
    pub escrow: Account<'info, Escrow>,
}

#[derive(Accounts)]
pub struct AcceptResult<'info> {
    #[account(address = escrow.verifier @ WorkSealEscrowError::VerifierMismatch)]
    pub verifier: Signer<'info>,
    #[account(
        mut,
        seeds = [b"workseal", escrow.buyer.as_ref(), escrow.worker.as_ref(), escrow.task_digest.as_ref(), escrow.mint.as_ref()],
        bump = escrow.bump
    )]
    pub escrow: Account<'info, Escrow>,
}

#[derive(Accounts)]
pub struct Release<'info> {
    /// CHECK: constrained to the pinned worker and used only as token authority identity.
    #[account(address = escrow.worker @ WorkSealEscrowError::WorkerMismatch)]
    pub worker: UncheckedAccount<'info>,
    #[account(
        mut,
        seeds = [b"workseal", escrow.buyer.as_ref(), escrow.worker.as_ref(), escrow.task_digest.as_ref(), escrow.mint.as_ref()],
        bump = escrow.bump,
        constraint = escrow.mint == mint.key() @ WorkSealEscrowError::MintMismatch,
        constraint = escrow.token_program == token_program.key() @ WorkSealEscrowError::TokenProgramMismatch
    )]
    pub escrow: Account<'info, Escrow>,
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(
        mut,
        seeds = [b"vault", escrow.key().as_ref()],
        bump = escrow.vault_bump,
        token::mint = mint,
        token::authority = escrow,
        token::token_program = token_program
    )]
    pub vault: InterfaceAccount<'info, TokenAccount>,
    #[account(
        mut,
        address = escrow.worker_token @ WorkSealEscrowError::TokenAccountMismatch,
        token::mint = mint,
        token::authority = worker,
        token::token_program = token_program
    )]
    pub worker_token: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Interface<'info, TokenInterface>,
}

#[derive(Accounts)]
pub struct RefundExpired<'info> {
    #[account(address = escrow.buyer @ WorkSealEscrowError::BuyerMismatch)]
    pub buyer: Signer<'info>,
    #[account(
        mut,
        seeds = [b"workseal", escrow.buyer.as_ref(), escrow.worker.as_ref(), escrow.task_digest.as_ref(), escrow.mint.as_ref()],
        bump = escrow.bump,
        constraint = escrow.mint == mint.key() @ WorkSealEscrowError::MintMismatch,
        constraint = escrow.token_program == token_program.key() @ WorkSealEscrowError::TokenProgramMismatch
    )]
    pub escrow: Account<'info, Escrow>,
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(
        mut,
        seeds = [b"vault", escrow.key().as_ref()],
        bump = escrow.vault_bump,
        token::mint = mint,
        token::authority = escrow,
        token::token_program = token_program
    )]
    pub vault: InterfaceAccount<'info, TokenAccount>,
    #[account(
        mut,
        address = escrow.buyer_token @ WorkSealEscrowError::TokenAccountMismatch,
        token::mint = mint,
        token::authority = buyer,
        token::token_program = token_program
    )]
    pub buyer_token: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Interface<'info, TokenInterface>,
}

#[derive(Accounts)]
pub struct Dispute<'info> {
    pub actor: Signer<'info>,
    #[account(
        mut,
        seeds = [b"workseal", escrow.buyer.as_ref(), escrow.worker.as_ref(), escrow.task_digest.as_ref(), escrow.mint.as_ref()],
        bump = escrow.bump
    )]
    pub escrow: Account<'info, Escrow>,
}

#[account]
#[derive(InitSpace)]
pub struct Escrow {
    pub version: u8,
    pub bump: u8,
    pub vault_bump: u8,
    pub phase: u8,
    pub buyer: Pubkey,
    pub worker: Pubkey,
    pub verifier: Pubkey,
    pub mint: Pubkey,
    pub token_program: Pubkey,
    pub buyer_token: Pubkey,
    pub worker_token: Pubkey,
    pub task_digest: [u8; 32],
    pub policy_digest: [u8; 32],
    pub receipt_authority_fingerprint: [u8; 32],
    pub amount: u64,
    pub deadline_unix: i64,
    pub generation: u64,
    pub result_digest: [u8; 32],
    pub acceptance_digest: [u8; 32],
    pub dispute_digest: [u8; 32],
    pub settled_amount: u64,
}

#[event]
pub struct EscrowInitialized {
    pub escrow: Pubkey,
    pub vault: Pubkey,
    pub task_digest: [u8; 32],
    pub policy_digest: [u8; 32],
    pub buyer: Pubkey,
    pub worker: Pubkey,
    pub verifier: Pubkey,
    pub mint: Pubkey,
    pub buyer_token: Pubkey,
    pub worker_token: Pubkey,
    pub amount: u64,
    pub deadline_unix: i64,
}
#[event]
pub struct EscrowFunded { pub escrow: Pubkey, pub amount: u64 }
#[event]
pub struct ResultCommitted { pub escrow: Pubkey, pub task_digest: [u8; 32], pub result_digest: [u8; 32], pub generation: u64 }
#[event]
pub struct ResultAccepted {
    pub escrow: Pubkey,
    pub task_digest: [u8; 32],
    pub result_digest: [u8; 32],
    pub acceptance_digest: [u8; 32],
    pub receipt_authority_fingerprint: [u8; 32],
    pub verifier: Pubkey,
    pub generation: u64,
}
#[event]
pub struct EscrowReleased { pub escrow: Pubkey, pub worker: Pubkey, pub amount: u64, pub result_digest: [u8; 32], pub acceptance_digest: [u8; 32] }
#[event]
pub struct EscrowRefunded { pub escrow: Pubkey, pub buyer: Pubkey, pub amount: u64, pub now_unix: i64 }
#[event]
pub struct EscrowDisputed { pub escrow: Pubkey, pub actor: Pubkey, pub dispute_digest: [u8; 32] }

#[error_code]
pub enum WorkSealEscrowError {
    #[msg("escrow is in the wrong phase for this transition")]
    BadPhase,
    #[msg("escrow amount must be greater than zero")]
    ZeroAmount,
    #[msg("buyer and worker must differ")]
    SameParty,
    #[msg("verifier must differ from buyer and worker")]
    VerifierMustDiffer,
    #[msg("digest commitments must be nonzero")]
    ZeroDigest,
    #[msg("escrow deadline must be in the future")]
    DeadlineNotFuture,
    #[msg("buyer authority mismatch")]
    BuyerMismatch,
    #[msg("worker authority mismatch")]
    WorkerMismatch,
    #[msg("verifier authority mismatch")]
    VerifierMismatch,
    #[msg("token mint mismatch")]
    MintMismatch,
    #[msg("token program mismatch")]
    TokenProgramMismatch,
    #[msg("token account does not match the pinned escrow account")]
    TokenAccountMismatch,
    #[msg("task digest mismatch")]
    TaskDigestMismatch,
    #[msg("result digest mismatch")]
    ResultDigestMismatch,
    #[msg("result generation mismatch")]
    GenerationMismatch,
    #[msg("result generation overflow")]
    GenerationOverflow,
    #[msg("signed receipt authority fingerprint mismatch")]
    ReceiptAuthorityMismatch,
    #[msg("vault balance is smaller than the escrow amount")]
    InsufficientVaultBalance,
    #[msg("escrow has already settled")]
    AlreadySettled,
    #[msg("escrow deadline has not passed")]
    NotExpired,
    #[msg("only buyer or worker may freeze the escrow")]
    DisputeAuthorityMismatch,
}
