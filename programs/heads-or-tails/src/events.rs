use anchor_lang::prelude::*;

#[event]
pub struct QueueJoined {
    pub player: Pubkey,
    pub side: u8,
    pub sequence: u64,
    pub amount: u64,
    pub tier_usd: u8,
    pub matched: bool,
    pub slot: u64,
}

#[event]
pub struct QueueCancelled {
    pub player: Pubkey,
    pub side: u8,
    pub sequence: u64,
    pub amount: u64,
    pub slot: u64,
}

#[event]
pub struct MatchCreated {
    pub match_id: u64,
    pub heads_player: Pubkey,
    pub tails_player: Pubkey,
    pub heads_amount: u64,
    pub tails_amount: u64,
    pub total_pot: u64,
    pub tier_usd: u8,
    pub seed: [u8; 32],
    pub slot: u64,
}

#[event]
pub struct MatchSettled {
    pub match_id: u64,
    /// 0 = HEADS, 1 = TAILS.
    pub result: u8,
    pub winner: Pubkey,
    pub pot: u64,
    pub slot: u64,
}
