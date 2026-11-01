use anchor_lang::prelude::*;
use solana_sha256_hasher::hashv;

use crate::errors::GameError;
use crate::state::FlipResult;

/// Domain separator for VRF seeds. Bumped if the seed scheme ever changes.
pub const VRF_SEED_DOMAIN: &[u8] = b"heads-or-tails-vrf-v2";

/// ORAO VRF program. Stored in code (not config) so settlement validation
/// can never be redirected at a different randomness provider.
pub const ORAO_VRF_PROGRAM_ID: Pubkey = orao_solana_vrf::ID_CONST;

/// A fresh unpredictable caller nonce removes the single reservable request
/// for a public match counter. RequestV2 must INIT atomically; never adopt an
/// existing request. A spoiled attempt retries with a NEW nonce. Settlement
/// always uses Match.seed, including historical v1 matches.
pub fn match_seed(match_id: u64, nonce: &[u8; 32]) -> Result<[u8; 32]> {
    require!(*nonce != [0u8; 32], GameError::InvalidMatchNonce);
    Ok(hashv(&[VRF_SEED_DOMAIN, &crate::ID.to_bytes(), &match_id.to_le_bytes(), nonce]).to_bytes())
}

/// Derive 50/50 HEADS or TAILS from fulfilled randomness bytes.
/// Bit 0 of byte 0: 0 = HEADS, 1 = TAILS.
pub fn result_from_randomness(randomness: &[u8; 64]) -> FlipResult {
    if randomness[0] & 1 == 0 {
        FlipResult::Heads
    } else {
        FlipResult::Tails
    }
}

/// Expected address of the ORAO randomness account for a seed.
pub fn randomness_address(seed: &[u8; 32]) -> Pubkey {
    orao_solana_vrf::randomness_account_address(&ORAO_VRF_PROGRAM_ID, seed)
}

/// Validate a randomness account and return fulfilled bytes.
/// Checks: exact PDA address, VRF program ownership, fulfilled state,
/// and seed binding to this match.
pub fn read_fulfilled_randomness(
    account: &UncheckedAccount,
    expected_seed: &[u8; 32],
) -> Result<[u8; 64]> {
    require_keys_eq!(
        *account.key,
        randomness_address(expected_seed),
        GameError::WrongRandomnessAccount
    );
    require_keys_eq!(
        *account.owner,
        ORAO_VRF_PROGRAM_ID,
        GameError::WrongVrfOwner
    );
    let data = account.try_borrow_data()?;
    let randomness =
        orao_solana_vrf::state::RandomnessV2::try_deserialize(&mut &data[..])
            .map_err(|_| GameError::VrfNotFulfilled)?;
    let fulfilled = randomness.fulfilled().ok_or(GameError::VrfNotFulfilled)?;
    require!(
        fulfilled.seed == *expected_seed,
        GameError::SeedMismatch
    );
    Ok(fulfilled.randomness)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn seeds_are_unique_per_match() {
        assert_ne!(match_seed(0, &[1;32]).unwrap(), match_seed(1, &[1;32]).unwrap());
        assert_ne!(match_seed(42, &[1;32]).unwrap(), match_seed(42, &[2;32]).unwrap());
        assert_eq!(match_seed(42, &[1;32]).unwrap(), match_seed(42, &[1;32]).unwrap());
        assert!(match_seed(42, &[0;32]).is_err());
        // Shared known-answer vector independently reproduced by the SDK.
        assert_eq!(match_seed(42, &[1;32]).unwrap(), [
            57,169,125,220,33,72,123,104,58,3,196,115,192,255,180,165,
            46,65,251,79,132,175,150,221,83,70,65,241,91,189,179,50
        ]);
    }

    #[test]
    fn result_bit_mapping_is_fifty_fifty_shape() {
        let mut zeros = [0u8; 64];
        assert_eq!(result_from_randomness(&zeros), FlipResult::Heads);
        zeros[0] = 1;
        assert_eq!(result_from_randomness(&zeros), FlipResult::Tails);
        zeros[0] = 0xFE;
        assert_eq!(result_from_randomness(&zeros), FlipResult::Heads);
        zeros[0] = 0xFF;
        assert_eq!(result_from_randomness(&zeros), FlipResult::Tails);
    }

    #[test]
    fn randomness_address_is_deterministic() {
        let seed = match_seed(7, &[1;32]).unwrap();
        assert_eq!(randomness_address(&seed), randomness_address(&seed));
        assert_ne!(
            randomness_address(&seed),
            randomness_address(&match_seed(8, &[1;32]).unwrap())
        );
    }
}
