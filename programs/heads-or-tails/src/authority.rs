use anchor_lang::prelude::*;

use crate::errors::GameError;
use crate::instructions::AdminConfig;

// ---------------------------------------------------------------------------
// Authority management.
//
// `GameConfig.authority` is the off-chain admin identity (pause, tiers,
// future transfers). It is NOT a funds custodian: escrow, matching,
// randomness and payouts are program-derived and permissionless.
//
// NOTE (Devnet, Sep 2026): the initial authority was an inaccessible key,
// so a one-time `recover_authority` instruction (gated ONLY by the program
// upgrade authority, verified via the Upgradeable Loader relationship) was
// deployed, used once to set the correct owner, and then REMOVED in the
// following upgrade. No recovery/backdoor instruction exists anymore; the
// full implementation and its security tests remain in git history. Normal
// transfers go through `set_authority` below (current owner signs).
// ---------------------------------------------------------------------------

/// Reject the default address as a new authority (would brick admin ops).
pub fn validate_new_authority(new_authority: &Pubkey) -> Result<()> {
    require_keys_neq!(
        *new_authority,
        Pubkey::default(),
        GameError::InvalidNewAuthority
    );
    Ok(())
}

/// Normal owner transfer: the CURRENT owner signs. No layout change.
/// (A two-step propose/accept upgrade is possible later without breaking
/// this path.)
pub fn handle_set_authority(
    ctx: Context<AdminConfig>,
    new_authority: Pubkey,
) -> Result<()> {
    require_keys_eq!(
        ctx.accounts.admin.key(),
        ctx.accounts.config.authority,
        GameError::Unauthorized
    );
    validate_new_authority(&new_authority)?;
    ctx.accounts.config.authority = new_authority;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::GameConfig;

    #[test]
    fn default_new_authority_rejected() {
        assert!(validate_new_authority(&Pubkey::default()).is_err());
        assert!(validate_new_authority(&Pubkey::new_from_array([21; 32])).is_ok());
    }

    #[test]
    fn game_config_layout_unchanged_by_authority_work() {
        // Authority management only mutates `authority`; no fields added, so
        // existing on-chain GameConfig accounts keep deserializing and
        // gameplay (queue/escrow/VRF/settle) is untouched.
        assert_eq!(GameConfig::INIT_SPACE, 109);
    }
}
