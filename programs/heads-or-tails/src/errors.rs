use anchor_lang::prelude::*;

#[error_code]
pub enum GameError {
    #[msg("Game is paused: new queue joins are disabled")]
    Paused,
    #[msg("Requested tier is not active")]
    TierInactive,
    #[msg("Side must be 0 (HEADS) or 1 (TAILS)")]
    InvalidSide,
    #[msg("Stake amount must be greater than zero")]
    InvalidAmount,
    #[msg("Token account mint does not match the configured project mint")]
    WrongMint,
    #[msg("Wallet already has an active queue entry or unresolved match")]
    AlreadyActive,
    #[msg("No active queue entry to cancel")]
    NoActiveEntry,
    #[msg("Queue entry is not active")]
    EntryNotActive,
    #[msg("Queue entry is already matched and cannot be cancelled")]
    AlreadyMatched,
    #[msg("Canceller is not the entry owner")]
    NotEntryOwner,
    #[msg("Player state does not reference this queue entry")]
    StateEntryMismatch,
    #[msg("Cannot match with yourself")]
    SelfMatch,
    #[msg("Provided head entry is not the current queue head")]
    InvalidHeadEntry,
    #[msg("Head entry is not active")]
    HeadNotActive,
    #[msg("Head entry side does not match the expected side")]
    HeadWrongSide,
    #[msg("Match is not waiting for randomness")]
    MatchNotAwaitingRandomness,
    #[msg("Match is already settled")]
    AlreadySettled,
    #[msg("Randomness account address does not match the match seed")]
    WrongRandomnessAccount,
    #[msg("Randomness account is not owned by the ORAO VRF program")]
    WrongVrfOwner,
    #[msg("Randomness has not been fulfilled yet")]
    VrfNotFulfilled,
    #[msg("Fulfilled randomness seed does not match the match seed")]
    SeedMismatch,
    #[msg("Winner token account is not the winner ATA for the project mint")]
    WrongWinnerAccount,
    #[msg("Winner token account owner is not the computed winner")]
    WinnerOwnerMismatch,
    #[msg("Winner token account mint is not the project mint")]
    WinnerMintMismatch,
    #[msg("Vault account is not the configured game vault")]
    WrongVault,
    #[msg("Arithmetic overflow or underflow")]
    ArithmeticError,
    #[msg("Unauthorized admin action")]
    Unauthorized,
    #[msg("Unsupported tier: only $1 and $10 rooms exist (others Opening Soon)")]
    UnsupportedTier,
    // NOTE: recovery errors (InvalidRecoveryProgram, InvalidProgramData,
    // MissingUpgradeAuthority, UnauthorizedRecovery) existed only while the
    // one-time Devnet `recover_authority` instruction existed; both were
    // removed after the recovery. InvalidNewAuthority is retained by
    // `set_authority`.
    #[msg("New authority must be a valid non-default address")]
    InvalidNewAuthority,
    #[msg("Player state account is not a valid V1 or migrated V2 layout")]
    PlayerStateDataInvalid,
    #[msg("Project mint must be the configured canonical Devnet demo mint")]
    WrongProjectMint,
    #[msg("Devnet demo mint must have six decimals")]
    WrongMintDecimals,
    #[msg("Stake must equal the exact Devnet room denomination")]
    WrongStakeDenomination,
    #[msg("Match nonce must not be all zero")]
    InvalidMatchNonce,
    #[msg("Legacy intake must remain paused while the HTS namespace accepts games")]
    LegacyIntakeMustBePaused,
    #[msg("HTS issuance must have the approved six-decimal supply and custody")]
    InvalidHtsIssuance,
}
