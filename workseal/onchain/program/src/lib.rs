//! WorkSeal Solana escrow program.
//!
//! Chain-side custody counterpart to the executable JS reference model. The
//! program owns a PDA state account and can custody SOL directly in that PDA or
//! authorize an SPL/Token-2022 vault whose token owner is the PDA.

use core::str::FromStr;
use solana_program::{
    account_info::{next_account_info, AccountInfo},
    clock::Clock,
    entrypoint,
    entrypoint::ProgramResult,
    hash::hashv,
    instruction::{AccountMeta, Instruction},
    program::{invoke, invoke_signed},
    program_error::ProgramError,
    pubkey::Pubkey,
    rent::Rent,
    system_instruction, system_program,
    sysvar::{instructions as ix_sysvar, Sysvar},
};

pub const DOMAIN: &[u8] = b"workseal";
pub const VERSION: u8 = 1;
pub const TOKEN_PROGRAM_TEXT: &str = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
pub const TOKEN_2022_PROGRAM_TEXT: &str = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
const ED25519_SELF_INDEX: u16 = u16::MAX;

#[repr(u8)]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Phase { Created=0, Funded=1, Committed=2, Accepted=3, Settled=4, Cancelled=5 }

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct EscrowState {
    pub version:u8, pub phase:Phase, pub bump:u8, pub asset_kind:u8, pub decimals:u8,
    pub generation:u32, pub amount:u64, pub deadline_unix:i64,
    pub buyer:Pubkey, pub worker:Pubkey, pub verifier:Pubkey, pub mint:Pubkey, pub token_program:Pubkey,
    pub task_digest:[u8;32], pub result_digest:[u8;32], pub acceptance_digest:[u8;32],
}

impl EscrowState {
    pub const LEN:usize=281;
    pub fn unpack(input:&[u8])->Result<Self,ProgramError>{
        if input.len()!=Self::LEN{return Err(ProgramError::InvalidAccountData)}
        let phase=match input[1]{0=>Phase::Created,1=>Phase::Funded,2=>Phase::Committed,3=>Phase::Accepted,4=>Phase::Settled,5=>Phase::Cancelled,_=>return Err(ProgramError::InvalidAccountData)};
        let pk=|s:usize| Pubkey::new_from_array(input[s..s+32].try_into().unwrap());
        let a=|s:usize| ->[u8;32]{input[s..s+32].try_into().unwrap()};
        Ok(Self{version:input[0],phase,bump:input[2],asset_kind:input[3],decimals:input[4],generation:u32::from_le_bytes(input[5..9].try_into().unwrap()),amount:u64::from_le_bytes(input[9..17].try_into().unwrap()),deadline_unix:i64::from_le_bytes(input[17..25].try_into().unwrap()),buyer:pk(25),worker:pk(57),verifier:pk(89),mint:pk(121),token_program:pk(153),task_digest:a(185),result_digest:a(217),acceptance_digest:a(249)})
    }
    pub fn pack(&self,out:&mut[u8])->ProgramResult{
        if out.len()!=Self::LEN{return Err(ProgramError::InvalidAccountData)}
        out.fill(0);out[0]=self.version;out[1]=self.phase as u8;out[2]=self.bump;out[3]=self.asset_kind;out[4]=self.decimals;
        out[5..9].copy_from_slice(&self.generation.to_le_bytes());out[9..17].copy_from_slice(&self.amount.to_le_bytes());out[17..25].copy_from_slice(&self.deadline_unix.to_le_bytes());
        for(s,k)in[(25,&self.buyer),(57,&self.worker),(89,&self.verifier),(121,&self.mint),(153,&self.token_program)]{out[s..s+32].copy_from_slice(k.as_ref())}
        out[185..217].copy_from_slice(&self.task_digest);out[217..249].copy_from_slice(&self.result_digest);out[249..281].copy_from_slice(&self.acceptance_digest);Ok(())
    }
}

#[repr(u8)] enum Op{Initialize=0,Fund=1,Commit=2,Accept=3,Settle=4,Cancel=5}
fn signer(a:&AccountInfo)->ProgramResult{if a.is_signer{Ok(())}else{Err(ProgramError::MissingRequiredSignature)}}
fn live(p:Phase)->ProgramResult{if matches!(p,Phase::Settled|Phase::Cancelled){Err(ProgramError::InvalidAccountData)}else{Ok(())}}
fn known_token_program(p:&Pubkey)->bool{p==&Pubkey::from_str(TOKEN_PROGRAM_TEXT).unwrap()||p==&Pubkey::from_str(TOKEN_2022_PROGRAM_TEXT).unwrap()}
fn token_base(data:&[u8],mint:&Pubkey,owner:&Pubkey)->ProgramResult{if data.len()<64||&data[0..32]!=mint.as_ref()||&data[32..64]!=owner.as_ref(){Err(ProgramError::InvalidAccountData)}else{Ok(())}}
fn pda_seeds<'a>(state:&'a EscrowState,bump:&'a[u8;1])->[&'a[u8];4]{[DOMAIN,&state.task_digest,state.buyer.as_ref(),bump]}
fn require_pda(program_id:&Pubkey,escrow:&AccountInfo,state:&EscrowState)->ProgramResult{let(e,b)=Pubkey::find_program_address(&[DOMAIN,&state.task_digest,state.buyer.as_ref()],program_id);if e!=*escrow.key||b!=state.bump{Err(ProgramError::InvalidSeeds)}else{Ok(())}}

fn transfer_checked<'a>(program:&AccountInfo<'a>,source:&AccountInfo<'a>,mint:&AccountInfo<'a>,dest:&AccountInfo<'a>,authority:&AccountInfo<'a>,amount:u64,decimals:u8,seeds:Option<&[&[u8]]>)->ProgramResult{
    if program.key!=source.owner||program.key!=dest.owner||program.key!=mint.owner||!known_token_program(program.key){return Err(ProgramError::IncorrectProgramId)}
    let mut data=Vec::with_capacity(10);data.push(12);data.extend_from_slice(&amount.to_le_bytes());data.push(decimals);
    let ix=Instruction{program_id:*program.key,accounts:vec![AccountMeta::new(*source.key,false),AccountMeta::new_readonly(*mint.key,false),AccountMeta::new(*dest.key,false),AccountMeta::new_readonly(*authority.key,true)],data};
    match seeds{Some(s)=>invoke_signed(&ix,&[source.clone(),mint.clone(),dest.clone(),authority.clone(),program.clone()],[s]),None=>invoke(&ix,&[source.clone(),mint.clone(),dest.clone(),authority.clone(),program.clone()])}
}

fn acceptance_message(state:&EscrowState,acceptance_digest:&[u8;32])->[u8;32]{
    let g=state.generation.to_le_bytes();*hashv(&[b"WORKSEAL_ACCEPT_V1",&state.task_digest,&state.result_digest,acceptance_digest,&g]).as_ref()
}

fn verified_ed25519_predecessor(ix_account:&AccountInfo,verifier:&Pubkey,message:&[u8;32])->ProgramResult{
    if ix_account.key!=&ix_sysvar::id(){return Err(ProgramError::UnsupportedSysvar)}
    let current=ix_sysvar::load_current_index_checked(ix_account)? as usize;if current==0{return Err(ProgramError::InvalidInstructionData)}
    let ix=ix_sysvar::load_instruction_at_checked(current-1,ix_account)?;
    if ix.program_id!=solana_program::ed25519_program::id()||ix.data.len()<16||ix.data[0]!=1||ix.data[1]!=0{return Err(ProgramError::InvalidInstructionData)}
    let u=|s:usize|u16::from_le_bytes(ix.data[s..s+2].try_into().unwrap());
    let sig_off=u(2) as usize;let sig_ix=u(4);let pk_off=u(6) as usize;let pk_ix=u(8);let msg_off=u(10) as usize;let msg_len=u(12) as usize;let msg_ix=u(14);
    if sig_ix!=ED25519_SELF_INDEX||pk_ix!=ED25519_SELF_INDEX||msg_ix!=ED25519_SELF_INDEX||sig_off.checked_add(64).filter(|x|*x<=ix.data.len()).is_none()||pk_off.checked_add(32).filter(|x|*x<=ix.data.len()).is_none()||msg_len!=32||msg_off.checked_add(32).filter(|x|*x<=ix.data.len()).is_none(){return Err(ProgramError::InvalidInstructionData)}
    if &ix.data[pk_off..pk_off+32]!=verifier.as_ref()||&ix.data[msg_off..msg_off+32]!=message{return Err(ProgramError::InvalidInstructionData)}
    Ok(())
}

fn initialize(program_id:&Pubkey,accounts:&[AccountInfo],data:&[u8])->ProgramResult{
    if data.len()!=179{return Err(ProgramError::InvalidInstructionData)}
    let mut it=accounts.iter();let escrow=next_account_info(&mut it)?;let buyer=next_account_info(&mut it)?;let system=next_account_info(&mut it)?;signer(buyer)?;if system.key!=&system_program::id(){return Err(ProgramError::IncorrectProgramId)}
    let asset_kind=data[1];let decimals=data[2];if asset_kind>1{return Err(ProgramError::InvalidInstructionData)}
    let amount=u64::from_le_bytes(data[3..11].try_into().unwrap());if amount==0{return Err(ProgramError::InvalidArgument)}
    let deadline=i64::from_le_bytes(data[11..19].try_into().unwrap());if deadline<=Clock::get()?.unix_timestamp{return Err(ProgramError::InvalidArgument)}
    let pk=|s:usize|Pubkey::new_from_array(data[s..s+32].try_into().unwrap());let worker=pk(19);let verifier=pk(51);let mint=pk(83);let token_program=pk(115);let task_digest:[u8;32]=data[147..179].try_into().unwrap();if worker==*buyer.key{return Err(ProgramError::InvalidArgument)}
    if asset_kind==0{if mint!=Pubkey::default()||token_program!=Pubkey::default()||decimals!=9{return Err(ProgramError::InvalidArgument)}}else if !known_token_program(&token_program){return Err(ProgramError::IncorrectProgramId)}
    let(expected,bump)=Pubkey::find_program_address(&[DOMAIN,&task_digest,buyer.key.as_ref()],program_id);if expected!=*escrow.key{return Err(ProgramError::InvalidSeeds)}
    let rent=Rent::get()?.minimum_balance(EscrowState::LEN);let b=[bump];let seeds=&[DOMAIN,&task_digest,buyer.key.as_ref(),&b];
    invoke_signed(&system_instruction::create_account(buyer.key,escrow.key,rent,EscrowState::LEN as u64,program_id),&[buyer.clone(),escrow.clone(),system.clone()],[seeds])?;
    EscrowState{version:VERSION,phase:Phase::Created,bump,asset_kind,decimals,generation:0,amount,deadline_unix:deadline,buyer:*buyer.key,worker,verifier,mint,token_program,task_digest,result_digest:[0;32],acceptance_digest:[0;32]}.pack(&mut escrow.try_borrow_mut_data()?)
}

fn process(program_id:&Pubkey,accounts:&[AccountInfo],data:&[u8])->ProgramResult{
    let op=*data.first().ok_or(ProgramError::InvalidInstructionData)?;if op==Op::Initialize as u8{return initialize(program_id,accounts,data)}
    let mut it=accounts.iter();let escrow=next_account_info(&mut it)?;if escrow.owner!=program_id{return Err(ProgramError::IncorrectProgramId)}let mut state=EscrowState::unpack(&escrow.try_borrow_data()?)?;if state.version!=VERSION{return Err(ProgramError::InvalidAccountData)}require_pda(program_id,escrow,&state)?;live(state.phase)?;
    match op{
        x if x==Op::Fund as u8=>{if state.phase!=Phase::Created||data.len()!=1{return Err(ProgramError::InvalidArgument)}let buyer=next_account_info(&mut it)?;signer(buyer)?;if buyer.key!=&state.buyer{return Err(ProgramError::InvalidArgument)}if state.asset_kind==0{let system=next_account_info(&mut it)?;if system.key!=&system_program::id(){return Err(ProgramError::IncorrectProgramId)}invoke(&system_instruction::transfer(buyer.key,escrow.key,state.amount),&[buyer.clone(),escrow.clone(),system.clone()])?}else{let source=next_account_info(&mut it)?;let mint=next_account_info(&mut it)?;let vault=next_account_info(&mut it)?;let token_program=next_account_info(&mut it)?;if mint.key!=&state.mint||token_program.key!=&state.token_program{return Err(ProgramError::InvalidArgument)}token_base(&source.try_borrow_data()?,&state.mint,&state.buyer)?;token_base(&vault.try_borrow_data()?,&state.mint,escrow.key)?;transfer_checked(token_program,source,mint,vault,buyer,state.amount,state.decimals,None)?}state.phase=Phase::Funded;}
        x if x==Op::Commit as u8=>{if !matches!(state.phase,Phase::Funded|Phase::Committed)||data.len()!=37{return Err(ProgramError::InvalidArgument)}let worker=next_account_info(&mut it)?;signer(worker)?;if worker.key!=&state.worker{return Err(ProgramError::InvalidArgument)}let g=u32::from_le_bytes(data[1..5].try_into().unwrap());if g!=state.generation.checked_add(1).ok_or(ProgramError::ArithmeticOverflow)?{return Err(ProgramError::InvalidArgument)}state.generation=g;state.result_digest.copy_from_slice(&data[5..37]);state.acceptance_digest=[0;32];state.phase=Phase::Committed;}
        x if x==Op::Accept as u8=>{if state.phase!=Phase::Committed||data.len()!=69{return Err(ProgramError::InvalidArgument)}let ix_account=next_account_info(&mut it)?;let g=u32::from_le_bytes(data[1..5].try_into().unwrap());if g!=state.generation||data[5..37]!=state.result_digest{return Err(ProgramError::InvalidArgument)}let acceptance:[u8;32]=data[37..69].try_into().unwrap();let message=acceptance_message(&state,&acceptance);verified_ed25519_predecessor(ix_account,&state.verifier,&message)?;state.acceptance_digest=acceptance;state.phase=Phase::Accepted;}
        x if x==Op::Settle as u8=>{if state.phase!=Phase::Accepted||data.len()!=1{return Err(ProgramError::InvalidArgument)}if state.asset_kind==0{let worker=next_account_info(&mut it)?;if worker.key!=&state.worker{return Err(ProgramError::InvalidArgument)}let remaining=(**escrow.try_borrow_lamports()?).checked_sub(state.amount).ok_or(ProgramError::InsufficientFunds)?;let worker_new=(**worker.try_borrow_lamports()?).checked_add(state.amount).ok_or(ProgramError::ArithmeticOverflow)?;**escrow.try_borrow_mut_lamports()?=remaining;**worker.try_borrow_mut_lamports()?=worker_new;}else{let vault=next_account_info(&mut it)?;let mint=next_account_info(&mut it)?;let worker_token=next_account_info(&mut it)?;let token_program=next_account_info(&mut it)?;if mint.key!=&state.mint||token_program.key!=&state.token_program{return Err(ProgramError::InvalidArgument)}token_base(&vault.try_borrow_data()?,&state.mint,escrow.key)?;token_base(&worker_token.try_borrow_data()?,&state.mint,&state.worker)?;let b=[state.bump];let seeds=pda_seeds(&state,&b);transfer_checked(token_program,vault,mint,worker_token,escrow,state.amount,state.decimals,Some(&seeds))?}state.phase=Phase::Settled;}
        x if x==Op::Cancel as u8=>{if !matches!(state.phase,Phase::Created|Phase::Funded|Phase::Committed)||data.len()!=1||Clock::get()?.unix_timestamp<=state.deadline_unix{return Err(ProgramError::InvalidArgument)}let buyer=next_account_info(&mut it)?;signer(buyer)?;if buyer.key!=&state.buyer{return Err(ProgramError::InvalidArgument)}if state.phase!=Phase::Created{if state.asset_kind==0{let remaining=(**escrow.try_borrow_lamports()?).checked_sub(state.amount).ok_or(ProgramError::InsufficientFunds)?;let buyer_new=(**buyer.try_borrow_lamports()?).checked_add(state.amount).ok_or(ProgramError::ArithmeticOverflow)?;**escrow.try_borrow_mut_lamports()?=remaining;**buyer.try_borrow_mut_lamports()?=buyer_new;}else{let vault=next_account_info(&mut it)?;let mint=next_account_info(&mut it)?;let buyer_token=next_account_info(&mut it)?;let token_program=next_account_info(&mut it)?;if mint.key!=&state.mint||token_program.key!=&state.token_program{return Err(ProgramError::InvalidArgument)}token_base(&vault.try_borrow_data()?,&state.mint,escrow.key)?;token_base(&buyer_token.try_borrow_data()?,&state.mint,&state.buyer)?;let b=[state.bump];let seeds=pda_seeds(&state,&b);transfer_checked(token_program,vault,mint,buyer_token,escrow,state.amount,state.decimals,Some(&seeds))?}}state.phase=Phase::Cancelled;}
        _=>return Err(ProgramError::InvalidInstructionData),
    }
    state.pack(&mut escrow.try_borrow_mut_data()?)
}

entrypoint!(process_instruction);
pub fn process_instruction(program_id:&Pubkey,accounts:&[AccountInfo],data:&[u8])->ProgramResult{process(program_id,accounts,data)}
