use anchor_lang::{AccountDeserialize, InstructionData, ToAccountMetas};
use solana_program::{
    account_info::AccountInfo, entrypoint::ProgramResult, hash::hashv, program_pack::Pack,
};
use solana_program_test::{processor, ProgramTest, ProgramTestContext};
use solana_sdk::{
    clock::Clock,
    instruction::Instruction,
    signature::{Keypair, Signer},
    system_instruction, system_program,
    transaction::Transaction,
};
use spl_associated_token_account::get_associated_token_address;
use spl_token::state::{Account as SplAccount, Mint};

const TOKEN_DECIMALS: u8 = 6;
const INITIAL_BALANCE: u64 = 900_000_000;
const ESCROW_AMOUNT: u64 = 125_000_000;
const SPKI_PREFIX: &[u8] = &[
    0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00,
];

async fn process(
    context: &mut ProgramTestContext,
    instructions: Vec<Instruction>,
    extra_signers: &[&Keypair],
) -> Result<(), String> {
    let blockhash = context
        .get_new_latest_blockhash()
        .await
        .map_err(|err| format!("blockhash: {err:?}"))?;
    let mut signers: Vec<&dyn Signer> = vec![&context.payer];
    signers.extend(extra_signers.iter().map(|signer| *signer as &dyn Signer));
    let transaction = Transaction::new_signed_with_payer(
        &instructions,
        Some(&context.payer.pubkey()),
        &signers,
        blockhash,
    );
    context
        .banks_client
        .process_transaction(transaction)
        .await
        .map_err(|err| format!("transaction: {err:?}"))
}

// `solana-program-test` keeps the slice borrow and each AccountInfo's inner borrow
// independent, while Anchor's generated `entry` ties both to one `'info` lifetime.
// ProgramTest invokes processors synchronously and guarantees the AccountInfos outlive
// that call, so this wrapper narrows those compatible borrows only for `entry`.
fn process_workseal_instruction(
    program_id: &solana_sdk::pubkey::Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    // SAFETY: this changes lifetimes only, not representation or ownership. The
    // transmuted slice cannot escape this synchronous call to Anchor's entrypoint.
    let tied: &[AccountInfo] = unsafe { core::mem::transmute(accounts) };
    workseal_escrow::entry(program_id, tied, data)
}

async fn test_context() -> ProgramTestContext {
    let mut program = ProgramTest::new(
        "workseal_escrow",
        workseal_escrow::ID,
        processor!(process_workseal_instruction),
    );
    program.add_program(
        "spl_token",
        spl_token::id(),
        processor!(spl_token::processor::Processor::process),
    );
    program.add_program(
        "spl_associated_token_account",
        spl_associated_token_account::id(),
        processor!(spl_associated_token_account::processor::process_instruction),
    );
    program.start_with_context().await
}

async fn bank_clock(context: &mut ProgramTestContext) -> Clock {
    context
        .banks_client
        .get_sysvar::<Clock>()
        .await
        .expect("clock sysvar")
}

async fn create_mint_and_wallets(
    context: &mut ProgramTestContext,
    worker: &Keypair,
) -> (Keypair, solana_sdk::pubkey::Pubkey, solana_sdk::pubkey::Pubkey) {
    let mint = Keypair::new();
    let rent = context.banks_client.get_rent().await.expect("rent");
    let create_mint = system_instruction::create_account(
        &context.payer.pubkey(),
        &mint.pubkey(),
        rent.minimum_balance(Mint::LEN),
        Mint::LEN as u64,
        &spl_token::id(),
    );
    let initialize_mint = spl_token::instruction::initialize_mint2(
        &spl_token::id(),
        &mint.pubkey(),
        &context.payer.pubkey(),
        None,
        TOKEN_DECIMALS,
    )
    .expect("initialize mint instruction");
    process(context, vec![create_mint, initialize_mint], &[&mint])
        .await
        .expect("create mint");

    let buyer_token = get_associated_token_address(&context.payer.pubkey(), &mint.pubkey());
    let worker_token = get_associated_token_address(&worker.pubkey(), &mint.pubkey());
    let create_buyer = spl_associated_token_account::instruction::create_associated_token_account(
        &context.payer.pubkey(),
        &context.payer.pubkey(),
        &mint.pubkey(),
        &spl_token::id(),
    );
    let create_worker = spl_associated_token_account::instruction::create_associated_token_account(
        &context.payer.pubkey(),
        &worker.pubkey(),
        &mint.pubkey(),
        &spl_token::id(),
    );
    process(context, vec![create_buyer, create_worker], &[])
        .await
        .expect("create user ATAs");

    let mint_to = spl_token::instruction::mint_to_checked(
        &spl_token::id(),
        &mint.pubkey(),
        &buyer_token,
        &context.payer.pubkey(),
        &[],
        INITIAL_BALANCE,
        TOKEN_DECIMALS,
    )
    .expect("mint_to instruction");
    process(context, vec![mint_to], &[])
        .await
        .expect("fund buyer token account");

    (mint, buyer_token, worker_token)
}

fn authority_fingerprint(verifier: &Keypair) -> [u8; 32] {
    hashv(&[SPKI_PREFIX, verifier.pubkey().as_ref()]).to_bytes()
}

fn escrow_addresses(
    task_digest: [u8; 32],
    mint: &solana_sdk::pubkey::Pubkey,
) -> (solana_sdk::pubkey::Pubkey, solana_sdk::pubkey::Pubkey) {
    let (escrow, _) = solana_sdk::pubkey::Pubkey::find_program_address(
        &[b"workseal-v1", task_digest.as_ref()],
        &workseal_escrow::ID,
    );
    let vault = spl_associated_token_account::get_associated_token_address(&escrow, mint);
    (escrow, vault)
}

fn initialize_instruction(
    context: &ProgramTestContext,
    worker: &Keypair,
    verifier: &Keypair,
    mint: solana_sdk::pubkey::Pubkey,
    buyer_token: solana_sdk::pubkey::Pubkey,
    worker_token: solana_sdk::pubkey::Pubkey,
    task_digest: [u8; 32],
    refund_after_unix: i64,
) -> (Instruction, solana_sdk::pubkey::Pubkey, solana_sdk::pubkey::Pubkey) {
    let (escrow, vault) = escrow_addresses(task_digest, &mint);
    let accounts = workseal_escrow::accounts::Initialize {
        buyer: context.payer.pubkey(),
        worker: worker.pubkey(),
        mint,
        escrow,
        vault,
        buyer_token,
        worker_token,
        token_program: spl_token::id(),
        associated_token_program: spl_associated_token_account::id(),
        system_program: system_program::id(),
    };
    let data = workseal_escrow::instruction::Initialize {
        args: workseal_escrow::InitializeArgs {
            task_digest,
            receipt_authority_fingerprint: authority_fingerprint(verifier),
            amount: ESCROW_AMOUNT,
            refund_after_unix,
        },
    }
    .data();
    (
        Instruction {
            program_id: workseal_escrow::ID,
            accounts: accounts.to_account_metas(None),
            data,
        },
        escrow,
        vault,
    )
}

fn fund_instruction(
    context: &ProgramTestContext,
    mint: solana_sdk::pubkey::Pubkey,
    escrow: solana_sdk::pubkey::Pubkey,
    buyer_token: solana_sdk::pubkey::Pubkey,
    vault: solana_sdk::pubkey::Pubkey,
) -> Instruction {
    Instruction {
        program_id: workseal_escrow::ID,
        accounts: workseal_escrow::accounts::Fund {
            buyer: context.payer.pubkey(),
            mint,
            escrow,
            buyer_token,
            vault,
            token_program: spl_token::id(),
        }
        .to_account_metas(None),
        data: workseal_escrow::instruction::Fund {}.data(),
    }
}

fn settle_instruction(
    verifier: &Keypair,
    worker: &Keypair,
    mint: solana_sdk::pubkey::Pubkey,
    escrow: solana_sdk::pubkey::Pubkey,
    vault: solana_sdk::pubkey::Pubkey,
    worker_token: solana_sdk::pubkey::Pubkey,
) -> Instruction {
    Instruction {
        program_id: workseal_escrow::ID,
        accounts: workseal_escrow::accounts::Settle {
            verifier: verifier.pubkey(),
            worker: worker.pubkey(),
            mint,
            escrow,
            vault,
            worker_token,
            token_program: spl_token::id(),
        }
        .to_account_metas(None),
        data: workseal_escrow::instruction::Settle {
            args: workseal_escrow::SettleArgs {
                result_digest: [0x31; 32],
                acceptance_digest: [0x42; 32],
                event_head: [0x53; 32],
                generation: 7,
            },
        }
        .data(),
    }
}

fn refund_instruction(
    context: &ProgramTestContext,
    mint: solana_sdk::pubkey::Pubkey,
    escrow: solana_sdk::pubkey::Pubkey,
    vault: solana_sdk::pubkey::Pubkey,
    buyer_token: solana_sdk::pubkey::Pubkey,
) -> Instruction {
    Instruction {
        program_id: workseal_escrow::ID,
        accounts: workseal_escrow::accounts::Refund {
            buyer: context.payer.pubkey(),
            mint,
            escrow,
            vault,
            buyer_token,
            token_program: spl_token::id(),
        }
        .to_account_metas(None),
        data: workseal_escrow::instruction::Refund {
            reason_digest: [0x77; 32],
        }
        .data(),
    }
}

async fn token_amount(
    context: &mut ProgramTestContext,
    address: solana_sdk::pubkey::Pubkey,
) -> u64 {
    let account = context
        .banks_client
        .get_account(address)
        .await
        .expect("token lookup")
        .expect("token account exists");
    SplAccount::unpack(&account.data).expect("valid token account").amount
}

async fn escrow_state(
    context: &mut ProgramTestContext,
    address: solana_sdk::pubkey::Pubkey,
) -> workseal_escrow::Escrow {
    let account = context
        .banks_client
        .get_account(address)
        .await
        .expect("escrow lookup")
        .expect("escrow exists");
    let mut data: &[u8] = &account.data;
    workseal_escrow::Escrow::try_deserialize(&mut data).expect("valid escrow account")
}

#[tokio::test]
async fn real_program_settlement_moves_exact_tokens_and_rejects_hostiles() {
    let mut context = test_context().await;
    let worker = Keypair::new();
    let verifier = Keypair::new();
    let wrong_verifier = Keypair::new();
    let (mint, buyer_token, worker_token) = create_mint_and_wallets(&mut context, &worker).await;
    let task_digest = [0x11; 32];
    let refund_after_unix = bank_clock(&mut context).await.unix_timestamp + 600;
    let (initialize, escrow, vault) = initialize_instruction(
        &context,
        &worker,
        &verifier,
        mint.pubkey(),
        buyer_token,
        worker_token,
        task_digest,
        refund_after_unix,
    );
    process(&mut context, vec![initialize], &[&worker])
        .await
        .expect("initialize escrow");
    let fund = fund_instruction(&context, mint.pubkey(), escrow, buyer_token, vault);
    process(&mut context, vec![fund], &[])
        .await
        .expect("fund escrow");

    assert_eq!(token_amount(&mut context, buyer_token).await, INITIAL_BALANCE - ESCROW_AMOUNT);
    assert_eq!(token_amount(&mut context, vault).await, ESCROW_AMOUNT);
    assert_eq!(escrow_state(&mut context, escrow).await.phase, 1);

    let wrong_settle = settle_instruction(
        &wrong_verifier,
        &worker,
        mint.pubkey(),
        escrow,
        vault,
        worker_token,
    );
    assert!(process(&mut context, vec![wrong_settle], &[&wrong_verifier])
        .await
        .is_err());
    assert_eq!(token_amount(&mut context, vault).await, ESCROW_AMOUNT);

    let valid_settle = settle_instruction(
        &verifier,
        &worker,
        mint.pubkey(),
        escrow,
        vault,
        worker_token,
    );
    process(&mut context, vec![valid_settle.clone()], &[&verifier])
        .await
        .expect("valid settlement");
    assert_eq!(token_amount(&mut context, vault).await, 0);
    assert_eq!(token_amount(&mut context, worker_token).await, ESCROW_AMOUNT);
    let settled = escrow_state(&mut context, escrow).await;
    assert_eq!(settled.phase, 2);
    assert_eq!(settled.generation, 7);
    assert_eq!(settled.result_digest, [0x31; 32]);
    assert_eq!(settled.acceptance_digest, [0x42; 32]);
    assert_eq!(settled.event_head, [0x53; 32]);

    assert!(process(&mut context, vec![valid_settle], &[&verifier])
        .await
        .is_err());
    assert_eq!(token_amount(&mut context, worker_token).await, ESCROW_AMOUNT);
}

#[tokio::test]
async fn real_program_refund_is_time_gated_and_terminal() {
    let mut context = test_context().await;
    let worker = Keypair::new();
    let verifier = Keypair::new();
    let (mint, buyer_token, worker_token) = create_mint_and_wallets(&mut context, &worker).await;
    let task_digest = [0x22; 32];
    let refund_after_unix = bank_clock(&mut context).await.unix_timestamp + 10;
    let (initialize, escrow, vault) = initialize_instruction(
        &context,
        &worker,
        &verifier,
        mint.pubkey(),
        buyer_token,
        worker_token,
        task_digest,
        refund_after_unix,
    );
    process(&mut context, vec![initialize], &[&worker])
        .await
        .expect("initialize refund escrow");
    let fund = fund_instruction(&context, mint.pubkey(), escrow, buyer_token, vault);
    process(&mut context, vec![fund], &[])
        .await
        .expect("fund refund escrow");

    let refund = refund_instruction(&context, mint.pubkey(), escrow, vault, buyer_token);
    assert!(process(&mut context, vec![refund.clone()], &[]).await.is_err());
    assert_eq!(token_amount(&mut context, vault).await, ESCROW_AMOUNT);

    let mut clock = bank_clock(&mut context).await;
    clock.unix_timestamp = refund_after_unix + 1;
    context.set_sysvar(&clock);
    assert_eq!(
        bank_clock(&mut context).await.unix_timestamp,
        refund_after_unix + 1
    );

    process(&mut context, vec![refund.clone()], &[])
        .await
        .expect("mature refund");
    assert_eq!(token_amount(&mut context, vault).await, 0);
    assert_eq!(token_amount(&mut context, buyer_token).await, INITIAL_BALANCE);
    assert_eq!(escrow_state(&mut context, escrow).await.phase, 3);

    assert!(process(&mut context, vec![refund], &[]).await.is_err());
    assert_eq!(token_amount(&mut context, buyer_token).await, INITIAL_BALANCE);
}
