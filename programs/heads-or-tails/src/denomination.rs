use anchor_lang::prelude::*;
use crate::errors::GameError;

// Public Devnet demo denomination; these units are NOT an oracle USD quote.
// Pin this deployment's existing SPL mint. Never import Mainnet configuration.
pub const DEVNET_MINT: Pubkey = pubkey!("BH7CMEsAEe74yXSyNNM6L5LXJhsRhVDs1hgEMveJmGYh");
pub const DEVNET_DECIMALS: u8 = 6;

pub fn validate_mint(mint: Pubkey, decimals: u8) -> Result<()> {
    validate_config_mint(mint)?;
    require!(decimals == DEVNET_DECIMALS, GameError::WrongMintDecimals);
    Ok(())
}

pub fn validate_config_mint(mint: Pubkey) -> Result<()> {
    require_keys_eq!(mint, DEVNET_MINT, GameError::WrongProjectMint);
    Ok(())
}

pub fn expected_stake(tier: u8) -> Result<u64> {
    require!(tier == 1 || tier == 10, GameError::UnsupportedTier);
    (tier as u64).checked_mul(1_000_000).ok_or_else(|| error!(GameError::ArithmeticError))
}

pub fn validate_stake(tier: u8, amount: u64) -> Result<()> {
    require!(amount > 0, GameError::InvalidAmount);
    require!(amount == expected_stake(tier)?, GameError::WrongStakeDenomination);
    Ok(())
}

// Devnet simulated USD reference policy hts-devnet-usd-v1: 100 HTS/USD,
// six decimals. Immutable within this executable, NOT a market oracle.
// Historical denomination, stored refunds and settlement amounts are unchanged.
pub const HTS_TEST_BASE_UNITS_PER_USD: u64 = 100_000_000;

pub fn expected_hts_usd_stake(tier: u8) -> Result<u64> {
    require!(tier == 1 || tier == 10, GameError::UnsupportedTier);
    (tier as u64).checked_mul(HTS_TEST_BASE_UNITS_PER_USD)
        .ok_or_else(|| error!(GameError::ArithmeticError))
}

pub fn validate_hts_usd_stake(tier: u8, amount: u64) -> Result<()> {
    require!(amount == expected_hts_usd_stake(tier)?, GameError::WrongStakeDenomination);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn hts_usd_reference_is_exact_and_legacy_is_unchanged() {
        for tier in [1u8, 10] {
            let amount = (tier as u64) * 100_000_000;
            assert_eq!(expected_hts_usd_stake(tier).unwrap(), amount);
            assert!(validate_hts_usd_stake(tier, amount).is_ok());
            for invalid in [0, amount-1, amount+1, (tier as u64)*1_000_000, u64::MAX] {
                assert!(validate_hts_usd_stake(tier, invalid).is_err());
            }
            assert_eq!(expected_stake(tier).unwrap(), (tier as u64)*1_000_000);
        }
        for tier in [0, 2, 100, 255] { assert!(expected_hts_usd_stake(tier).is_err()); }
    }
    #[test]
    fn exact_demo_stakes_only() {
        for (tier, expected) in [(1, 1_000_000), (10, 10_000_000)] {
            assert_eq!(expected_stake(tier).unwrap(), expected);
            assert!(validate_stake(tier, expected).is_ok());
            for amount in [0, 1, expected - 1, expected + 1, u64::MAX] {
                assert!(validate_stake(tier, amount).is_err());
            }
        }
        for tier in [0, 2, 100, 255] { assert!(expected_stake(tier).is_err()); }
    }
    #[test]
    fn canonical_mint_and_decimals_only() {
        assert!(validate_mint(DEVNET_MINT, 6).is_ok());
        assert!(validate_mint(Pubkey::new_unique(), 6).is_err());
        for decimals in [0, 5, 7, 9, 255] {
            assert!(validate_mint(DEVNET_MINT, decimals).is_err());
        }
    }
}
