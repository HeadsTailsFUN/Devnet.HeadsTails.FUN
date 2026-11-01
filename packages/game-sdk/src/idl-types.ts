/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/heads_or_tails.json`.
 */
export type HeadsOrTails = {
  "address": "AFVnPWFoYMG1tdmRFUttmf8kf6gpi24LVkYzNmUSni7k",
  "metadata": {
    "name": "headsOrTails",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "Heads or Tails — FIFO coin-flip game with ORAO VRF and permissionless settlement"
  },
  "instructions": [
    {
      "name": "advanceHead",
      "docs": [
        "Permissionless hole skipping. Advances one queue head past a",
        "provably inactive entry. Moves no funds."
      ],
      "discriminator": [
        100,
        7,
        98,
        197,
        138,
        87,
        255,
        23
      ],
      "accounts": [
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "headEntry",
          "writable": true
        }
      ],
      "args": [
        {
          "name": "side",
          "type": "u8"
        }
      ]
    },
    {
      "name": "advanceHeadRoom",
      "docs": [
        "V2: permissionless hole skipping within ONE tier/room."
      ],
      "discriminator": [
        109,
        91,
        23,
        192,
        31,
        50,
        9,
        39
      ],
      "accounts": [
        {
          "name": "room",
          "writable": true
        },
        {
          "name": "headEntry",
          "writable": true
        }
      ],
      "args": [
        {
          "name": "side",
          "type": "u8"
        },
        {
          "name": "tierUsd",
          "type": "u8"
        }
      ]
    },
    {
      "name": "advanceHtsHeadRoom",
      "discriminator": [
        140,
        30,
        246,
        26,
        166,
        120,
        127,
        110
      ],
      "accounts": [
        {
          "name": "room",
          "writable": true
        },
        {
          "name": "headEntry",
          "writable": true
        }
      ],
      "args": [
        {
          "name": "side",
          "type": "u8"
        },
        {
          "name": "tierUsd",
          "type": "u8"
        }
      ]
    },
    {
      "name": "cancelHtsQueueEntryRoom",
      "discriminator": [
        131,
        220,
        59,
        143,
        49,
        249,
        62,
        13
      ],
      "accounts": [
        {
          "name": "player",
          "writable": true,
          "signer": true
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  104,
                  116,
                  115,
                  45,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "playerState",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  104,
                  116,
                  115,
                  45,
                  112,
                  108,
                  97,
                  121,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "player"
              }
            ]
          }
        },
        {
          "name": "entry",
          "writable": true
        },
        {
          "name": "projectMint"
        },
        {
          "name": "playerTokens",
          "writable": true
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  104,
                  116,
                  115,
                  45,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              }
            ]
          }
        },
        {
          "name": "vaultAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  104,
                  116,
                  115,
                  45,
                  118,
                  97,
                  117,
                  108,
                  116,
                  45,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": []
    },
    {
      "name": "cancelQueueEntry",
      "docs": [
        "Refund an unmatched entry exactly and free the wallet for re-entry."
      ],
      "discriminator": [
        164,
        183,
        143,
        117,
        118,
        221,
        88,
        10
      ],
      "accounts": [
        {
          "name": "player",
          "writable": true,
          "signer": true
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "playerState",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  108,
                  97,
                  121,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "player"
              }
            ]
          }
        },
        {
          "name": "entry",
          "writable": true
        },
        {
          "name": "projectMint"
        },
        {
          "name": "playerTokens",
          "writable": true
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              }
            ]
          }
        },
        {
          "name": "vaultAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116,
                  45,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": []
    },
    {
      "name": "cancelQueueEntryRoom",
      "docs": [
        "V2: refund an unmatched tier-scoped entry exactly."
      ],
      "discriminator": [
        123,
        182,
        144,
        148,
        85,
        133,
        175,
        157
      ],
      "accounts": [
        {
          "name": "player",
          "writable": true,
          "signer": true
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "playerState",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  108,
                  97,
                  121,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "player"
              }
            ]
          }
        },
        {
          "name": "entry",
          "writable": true
        },
        {
          "name": "projectMint"
        },
        {
          "name": "playerTokens",
          "writable": true
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              }
            ]
          }
        },
        {
          "name": "vaultAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116,
                  45,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": []
    },
    {
      "name": "initHtsRoom",
      "discriminator": [
        164,
        165,
        150,
        254,
        171,
        178,
        112,
        92
      ],
      "accounts": [
        {
          "name": "admin",
          "writable": true,
          "signer": true
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  104,
                  116,
                  115,
                  45,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "room",
          "writable": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "tierUsd",
          "type": "u8"
        },
        {
          "name": "active",
          "type": "bool"
        }
      ]
    },
    {
      "name": "initRoom",
      "docs": [
        "V2: create a tier-scoped room. Admin only. Supported: $1, $10."
      ],
      "discriminator": [
        166,
        102,
        103,
        49,
        179,
        136,
        136,
        113
      ],
      "accounts": [
        {
          "name": "admin",
          "writable": true,
          "signer": true
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "room",
          "writable": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "tierUsd",
          "type": "u8"
        },
        {
          "name": "active",
          "type": "bool"
        }
      ]
    },
    {
      "name": "initialize",
      "docs": [
        "Create the game config and the program-controlled token vault."
      ],
      "discriminator": [
        175,
        175,
        109,
        31,
        13,
        152,
        155,
        237
      ],
      "accounts": [
        {
          "name": "admin",
          "writable": true,
          "signer": true
        },
        {
          "name": "projectMint"
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "vaultAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116,
                  45,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": [
        {
          "name": "tier1Active",
          "type": "bool"
        }
      ]
    },
    {
      "name": "initializeHts",
      "docs": [
        "Owner-authorized isolated HTS namespace; legacy config must already be paused."
      ],
      "discriminator": [
        132,
        91,
        152,
        172,
        107,
        27,
        166,
        182
      ],
      "accounts": [
        {
          "name": "admin",
          "signer": true
        },
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "legacyConfig",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "projectMint"
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  104,
                  116,
                  115,
                  45,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "vaultAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  104,
                  116,
                  115,
                  45,
                  118,
                  97,
                  117,
                  108,
                  116,
                  45,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  104,
                  116,
                  115,
                  45,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": []
    },
    {
      "name": "joinHtsQueueRoom",
      "discriminator": [
        65,
        12,
        129,
        79,
        153,
        87,
        153,
        155
      ],
      "accounts": [
        {
          "name": "player",
          "writable": true,
          "signer": true
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  104,
                  116,
                  115,
                  45,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "legacyConfig",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "legacyPlayerState",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  108,
                  97,
                  121,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "player"
              }
            ]
          }
        },
        {
          "name": "room",
          "writable": true
        },
        {
          "name": "playerState",
          "writable": true
        },
        {
          "name": "entry",
          "writable": true
        },
        {
          "name": "projectMint"
        },
        {
          "name": "playerTokens",
          "writable": true
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  104,
                  116,
                  115,
                  45,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              }
            ]
          }
        },
        {
          "name": "vaultAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  104,
                  116,
                  115,
                  45,
                  118,
                  97,
                  117,
                  108,
                  116,
                  45,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "side",
          "type": "u8"
        },
        {
          "name": "tierUsd",
          "type": "u8"
        },
        {
          "name": "stakeAmount",
          "type": "u64"
        },
        {
          "name": "sequence",
          "type": "u64"
        }
      ]
    },
    {
      "name": "joinQueue",
      "docs": [
        "Stake the exact token amount and enqueue it on `side`.",
        "`sequence` must equal the current tail of that side (read from",
        "GameConfig); pass it explicitly so the entry PDA is deterministic."
      ],
      "discriminator": [
        157,
        115,
        48,
        109,
        65,
        86,
        203,
        238
      ],
      "accounts": [
        {
          "name": "player",
          "writable": true,
          "signer": true
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "playerState",
          "writable": true
        },
        {
          "name": "entry",
          "writable": true
        },
        {
          "name": "projectMint"
        },
        {
          "name": "playerTokens",
          "writable": true
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              }
            ]
          }
        },
        {
          "name": "vaultAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116,
                  45,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "side",
          "type": "u8"
        },
        {
          "name": "tierUsd",
          "type": "u8"
        },
        {
          "name": "stakeAmount",
          "type": "u64"
        },
        {
          "name": "sequence",
          "type": "u64"
        }
      ]
    },
    {
      "name": "joinQueueRoom",
      "docs": [
        "V2: stake into a tier-scoped room queue. `sequence` must equal the",
        "room's current tail for `side`. Global one-active rule preserved."
      ],
      "discriminator": [
        243,
        252,
        128,
        17,
        124,
        11,
        41,
        213
      ],
      "accounts": [
        {
          "name": "player",
          "writable": true,
          "signer": true
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "room",
          "writable": true
        },
        {
          "name": "playerState",
          "writable": true
        },
        {
          "name": "entry",
          "writable": true
        },
        {
          "name": "projectMint"
        },
        {
          "name": "playerTokens",
          "writable": true
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              }
            ]
          }
        },
        {
          "name": "vaultAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116,
                  45,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "side",
          "type": "u8"
        },
        {
          "name": "tierUsd",
          "type": "u8"
        },
        {
          "name": "stakeAmount",
          "type": "u64"
        },
        {
          "name": "sequence",
          "type": "u64"
        }
      ]
    },
    {
      "name": "matchNext",
      "docs": [
        "Permissionless FIFO matcher. Matches the two current queue heads and",
        "requests ORAO VRF exactly once. `match_id` must equal",
        "`config.total_matches`. Supply a fresh unpredictable nonce for each",
        "new attempt; an existing ORAO request is never adopted."
      ],
      "discriminator": [
        54,
        2,
        209,
        0,
        163,
        10,
        31,
        225
      ],
      "accounts": [
        {
          "name": "caller",
          "docs": [
            "Payer for the match account, the VRF request account and fees. Anyone."
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "headHeads",
          "writable": true
        },
        {
          "name": "headTails",
          "writable": true
        },
        {
          "name": "headsState",
          "writable": true
        },
        {
          "name": "tailsState",
          "writable": true
        },
        {
          "name": "gameMatch",
          "writable": true
        },
        {
          "name": "vrfProgram"
        },
        {
          "name": "vrfNetworkState",
          "docs": [
            "the VRF program bumps its request counter on each request."
          ],
          "writable": true
        },
        {
          "name": "vrfTreasury",
          "docs": [
            "Mutable: it receives the request fee."
          ],
          "writable": true
        },
        {
          "name": "randomness",
          "writable": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "matchId",
          "type": "u64"
        },
        {
          "name": "nonce",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        }
      ]
    },
    {
      "name": "matchNextHtsRoom",
      "discriminator": [
        37,
        235,
        118,
        86,
        249,
        57,
        91,
        168
      ],
      "accounts": [
        {
          "name": "caller",
          "docs": [
            "Payer for the match account, the VRF request account and fees. Anyone."
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  104,
                  116,
                  115,
                  45,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "legacyConfig",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "room",
          "writable": true
        },
        {
          "name": "headHeads",
          "writable": true
        },
        {
          "name": "headTails",
          "writable": true
        },
        {
          "name": "headsState",
          "writable": true
        },
        {
          "name": "tailsState",
          "writable": true
        },
        {
          "name": "gameMatch",
          "writable": true
        },
        {
          "name": "vrfProgram"
        },
        {
          "name": "vrfNetworkState",
          "writable": true
        },
        {
          "name": "vrfTreasury",
          "writable": true
        },
        {
          "name": "randomness",
          "writable": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "matchId",
          "type": "u64"
        },
        {
          "name": "tierUsd",
          "type": "u8"
        },
        {
          "name": "nonce",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        }
      ]
    },
    {
      "name": "matchNextRoom",
      "docs": [
        "V2: permissionless FIFO matcher within ONE tier/room. `match_id` must",
        "equal global `config.total_matches`. Supply a fresh unpredictable nonce."
      ],
      "discriminator": [
        94,
        29,
        117,
        196,
        66,
        144,
        245,
        94
      ],
      "accounts": [
        {
          "name": "caller",
          "docs": [
            "Payer for the match account, the VRF request account and fees. Anyone."
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "room",
          "writable": true
        },
        {
          "name": "headHeads",
          "writable": true
        },
        {
          "name": "headTails",
          "writable": true
        },
        {
          "name": "headsState",
          "writable": true
        },
        {
          "name": "tailsState",
          "writable": true
        },
        {
          "name": "gameMatch",
          "writable": true
        },
        {
          "name": "vrfProgram"
        },
        {
          "name": "vrfNetworkState",
          "writable": true
        },
        {
          "name": "vrfTreasury",
          "writable": true
        },
        {
          "name": "randomness",
          "writable": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "matchId",
          "type": "u64"
        },
        {
          "name": "tierUsd",
          "type": "u8"
        },
        {
          "name": "nonce",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        }
      ]
    },
    {
      "name": "migratePlayerState",
      "docs": [
        "V2 migration: expand a pre-V2 PlayerState to the tier-aware layout.",
        "Idle-only is trivially safe; active legacy positions default to $1",
        "(the only room that existed pre-V2). Settled history is untouched."
      ],
      "discriminator": [
        23,
        91,
        69,
        70,
        26,
        255,
        26,
        8
      ],
      "accounts": [
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "playerState",
          "writable": true
        },
        {
          "name": "playerOwner",
          "docs": [
            "player field inside the handler."
          ]
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "setAuthority",
      "docs": [
        "Normal owner transfer. The CURRENT owner signs. Prefer a two-step",
        "propose/accept upgrade later; this keeps the account layout unchanged."
      ],
      "discriminator": [
        133,
        250,
        37,
        21,
        110,
        163,
        26,
        121
      ],
      "accounts": [
        {
          "name": "admin",
          "signer": true
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "newAuthority",
          "type": "pubkey"
        }
      ]
    },
    {
      "name": "setHtsPaused",
      "discriminator": [
        232,
        81,
        75,
        237,
        7,
        137,
        140,
        221
      ],
      "accounts": [
        {
          "name": "admin",
          "signer": true
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  104,
                  116,
                  115,
                  45,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "authority",
          "relations": [
            "config"
          ]
        },
        {
          "name": "legacyConfig",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "paused",
          "type": "bool"
        }
      ]
    },
    {
      "name": "setHtsRoomActive",
      "discriminator": [
        11,
        238,
        5,
        149,
        76,
        245,
        99,
        145
      ],
      "accounts": [
        {
          "name": "admin",
          "signer": true
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  104,
                  116,
                  115,
                  45,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "room",
          "writable": true
        }
      ],
      "args": [
        {
          "name": "tierUsd",
          "type": "u8"
        },
        {
          "name": "active",
          "type": "bool"
        }
      ]
    },
    {
      "name": "setPaused",
      "docs": [
        "Pause or unpause new queue joins. Admin only."
      ],
      "discriminator": [
        91,
        60,
        125,
        192,
        176,
        225,
        166,
        218
      ],
      "accounts": [
        {
          "name": "admin",
          "signer": true
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "paused",
          "type": "bool"
        }
      ]
    },
    {
      "name": "setRoomActive",
      "docs": [
        "V2: enable/disable a tier-scoped room. Admin only."
      ],
      "discriminator": [
        176,
        206,
        115,
        181,
        97,
        56,
        172,
        230
      ],
      "accounts": [
        {
          "name": "admin",
          "signer": true
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "room",
          "writable": true
        }
      ],
      "args": [
        {
          "name": "tierUsd",
          "type": "u8"
        },
        {
          "name": "active",
          "type": "bool"
        }
      ]
    },
    {
      "name": "setTierActive",
      "docs": [
        "Enable or disable a tier. Only tier 1 exists in V1. Admin only."
      ],
      "discriminator": [
        118,
        64,
        8,
        193,
        145,
        138,
        136,
        138
      ],
      "accounts": [
        {
          "name": "admin",
          "signer": true
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "tierUsd",
          "type": "u8"
        },
        {
          "name": "active",
          "type": "bool"
        }
      ]
    },
    {
      "name": "settleHtsMatch",
      "discriminator": [
        177,
        143,
        123,
        60,
        196,
        53,
        68,
        141
      ],
      "accounts": [
        {
          "name": "caller",
          "docs": [
            "Caller only pays fees/geometry. Never the payout destination."
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  104,
                  116,
                  115,
                  45,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "gameMatch",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  104,
                  116,
                  115,
                  45,
                  109,
                  97,
                  116,
                  99,
                  104
                ]
              },
              {
                "kind": "arg",
                "path": "matchId"
              }
            ]
          }
        },
        {
          "name": "randomness",
          "docs": [
            "binding verified in handler."
          ]
        },
        {
          "name": "headsState",
          "writable": true
        },
        {
          "name": "tailsState",
          "writable": true
        },
        {
          "name": "projectMint"
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  104,
                  116,
                  115,
                  45,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              }
            ]
          }
        },
        {
          "name": "vaultAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  104,
                  116,
                  115,
                  45,
                  118,
                  97,
                  117,
                  108,
                  116,
                  45,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "winnerTokens",
          "docs": [
            "owner and mint verified in handler."
          ],
          "writable": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": [
        {
          "name": "matchId",
          "type": "u64"
        }
      ]
    },
    {
      "name": "settleMatch",
      "docs": [
        "Permissionless settlement. Anyone may call it (winner, loser, keeper);",
        "the program alone derives the result, the winner, the destination and",
        "the amount from verified on-chain state."
      ],
      "discriminator": [
        71,
        124,
        117,
        96,
        191,
        217,
        116,
        24
      ],
      "accounts": [
        {
          "name": "caller",
          "docs": [
            "Caller only pays fees/geometry. Never the payout destination."
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "gameMatch",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  116,
                  99,
                  104
                ]
              },
              {
                "kind": "arg",
                "path": "matchId"
              }
            ]
          }
        },
        {
          "name": "randomness",
          "docs": [
            "binding verified in handler."
          ]
        },
        {
          "name": "headsState",
          "writable": true
        },
        {
          "name": "tailsState",
          "writable": true
        },
        {
          "name": "projectMint"
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              }
            ]
          }
        },
        {
          "name": "vaultAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116,
                  45,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "winnerTokens",
          "docs": [
            "owner and mint verified in handler."
          ],
          "writable": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": [
        {
          "name": "matchId",
          "type": "u64"
        }
      ]
    }
  ],
  "accounts": [
    {
      "name": "gameConfig",
      "discriminator": [
        45,
        146,
        146,
        33,
        170,
        69,
        96,
        133
      ]
    },
    {
      "name": "match",
      "discriminator": [
        236,
        63,
        169,
        38,
        15,
        56,
        196,
        162
      ]
    },
    {
      "name": "playerState",
      "discriminator": [
        56,
        3,
        60,
        86,
        174,
        16,
        244,
        195
      ]
    },
    {
      "name": "queueEntry",
      "discriminator": [
        211,
        46,
        29,
        56,
        240,
        146,
        48,
        178
      ]
    },
    {
      "name": "roomQueueEntry",
      "discriminator": [
        184,
        196,
        68,
        139,
        164,
        60,
        17,
        241
      ]
    },
    {
      "name": "roomState",
      "discriminator": [
        251,
        176,
        114,
        29,
        232,
        0,
        65,
        181
      ]
    }
  ],
  "events": [
    {
      "name": "matchCreated",
      "discriminator": [
        151,
        176,
        11,
        24,
        34,
        225,
        227,
        16
      ]
    },
    {
      "name": "matchSettled",
      "discriminator": [
        243,
        201,
        134,
        151,
        193,
        131,
        223,
        150
      ]
    },
    {
      "name": "queueCancelled",
      "discriminator": [
        201,
        237,
        195,
        174,
        54,
        218,
        223,
        249
      ]
    },
    {
      "name": "queueJoined",
      "discriminator": [
        56,
        81,
        235,
        53,
        196,
        128,
        138,
        193
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "paused",
      "msg": "Game is paused: new queue joins are disabled"
    },
    {
      "code": 6001,
      "name": "tierInactive",
      "msg": "Requested tier is not active"
    },
    {
      "code": 6002,
      "name": "invalidSide",
      "msg": "Side must be 0 (HEADS) or 1 (TAILS)"
    },
    {
      "code": 6003,
      "name": "invalidAmount",
      "msg": "Stake amount must be greater than zero"
    },
    {
      "code": 6004,
      "name": "wrongMint",
      "msg": "Token account mint does not match the configured project mint"
    },
    {
      "code": 6005,
      "name": "alreadyActive",
      "msg": "Wallet already has an active queue entry or unresolved match"
    },
    {
      "code": 6006,
      "name": "noActiveEntry",
      "msg": "No active queue entry to cancel"
    },
    {
      "code": 6007,
      "name": "entryNotActive",
      "msg": "Queue entry is not active"
    },
    {
      "code": 6008,
      "name": "alreadyMatched",
      "msg": "Queue entry is already matched and cannot be cancelled"
    },
    {
      "code": 6009,
      "name": "notEntryOwner",
      "msg": "Canceller is not the entry owner"
    },
    {
      "code": 6010,
      "name": "stateEntryMismatch",
      "msg": "Player state does not reference this queue entry"
    },
    {
      "code": 6011,
      "name": "selfMatch",
      "msg": "Cannot match with yourself"
    },
    {
      "code": 6012,
      "name": "invalidHeadEntry",
      "msg": "Provided head entry is not the current queue head"
    },
    {
      "code": 6013,
      "name": "headNotActive",
      "msg": "Head entry is not active"
    },
    {
      "code": 6014,
      "name": "headWrongSide",
      "msg": "Head entry side does not match the expected side"
    },
    {
      "code": 6015,
      "name": "matchNotAwaitingRandomness",
      "msg": "Match is not waiting for randomness"
    },
    {
      "code": 6016,
      "name": "alreadySettled",
      "msg": "Match is already settled"
    },
    {
      "code": 6017,
      "name": "wrongRandomnessAccount",
      "msg": "Randomness account address does not match the match seed"
    },
    {
      "code": 6018,
      "name": "wrongVrfOwner",
      "msg": "Randomness account is not owned by the ORAO VRF program"
    },
    {
      "code": 6019,
      "name": "vrfNotFulfilled",
      "msg": "Randomness has not been fulfilled yet"
    },
    {
      "code": 6020,
      "name": "seedMismatch",
      "msg": "Fulfilled randomness seed does not match the match seed"
    },
    {
      "code": 6021,
      "name": "wrongWinnerAccount",
      "msg": "Winner token account is not the winner ATA for the project mint"
    },
    {
      "code": 6022,
      "name": "winnerOwnerMismatch",
      "msg": "Winner token account owner is not the computed winner"
    },
    {
      "code": 6023,
      "name": "winnerMintMismatch",
      "msg": "Winner token account mint is not the project mint"
    },
    {
      "code": 6024,
      "name": "wrongVault",
      "msg": "Vault account is not the configured game vault"
    },
    {
      "code": 6025,
      "name": "arithmeticError",
      "msg": "Arithmetic overflow or underflow"
    },
    {
      "code": 6026,
      "name": "unauthorized",
      "msg": "Unauthorized admin action"
    },
    {
      "code": 6027,
      "name": "unsupportedTier",
      "msg": "Unsupported tier: only $1 and $10 rooms exist (others Opening Soon)"
    },
    {
      "code": 6028,
      "name": "invalidNewAuthority",
      "msg": "New authority must be a valid non-default address"
    },
    {
      "code": 6029,
      "name": "playerStateDataInvalid",
      "msg": "Player state account is not a valid V1 or migrated V2 layout"
    },
    {
      "code": 6030,
      "name": "wrongProjectMint",
      "msg": "Project mint must be the configured canonical Devnet demo mint"
    },
    {
      "code": 6031,
      "name": "wrongMintDecimals",
      "msg": "Devnet demo mint must have six decimals"
    },
    {
      "code": 6032,
      "name": "wrongStakeDenomination",
      "msg": "Stake must equal the exact Devnet room denomination"
    },
    {
      "code": 6033,
      "name": "invalidMatchNonce",
      "msg": "Match nonce must not be all zero"
    },
    {
      "code": 6034,
      "name": "legacyIntakeMustBePaused",
      "msg": "Legacy intake must remain paused while the HTS namespace accepts games"
    },
    {
      "code": 6035,
      "name": "invalidHtsIssuance",
      "msg": "HTS issuance must have the approved six-decimal supply and custody"
    }
  ],
  "types": [
    {
      "name": "entryStatus",
      "docs": [
        "Queue entry lifecycle. Cancelled entries leave holes that the matcher",
        "must provably skip via on-chain account validation."
      ],
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "active"
          },
          {
            "name": "cancelled"
          },
          {
            "name": "matched"
          }
        ]
      }
    },
    {
      "name": "flipResult",
      "docs": [
        "Flip outcome derived deterministically from fulfilled VRF bytes."
      ],
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "heads"
          },
          {
            "name": "tails"
          }
        ]
      }
    },
    {
      "name": "gameConfig",
      "docs": [
        "Global game configuration. The single source of queue head/next indices,",
        "so FIFO order is authoritative on-chain."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "authority",
            "type": "pubkey"
          },
          {
            "name": "projectMint",
            "type": "pubkey"
          },
          {
            "name": "paused",
            "type": "bool"
          },
          {
            "name": "tier1Active",
            "type": "bool"
          },
          {
            "name": "headsHead",
            "type": "u64"
          },
          {
            "name": "headsNext",
            "type": "u64"
          },
          {
            "name": "tailsHead",
            "type": "u64"
          },
          {
            "name": "tailsNext",
            "type": "u64"
          },
          {
            "name": "totalMatches",
            "type": "u64"
          },
          {
            "name": "vaultBump",
            "type": "u8"
          },
          {
            "name": "authorityBump",
            "type": "u8"
          },
          {
            "name": "configBump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "match",
      "docs": [
        "A matched pair awaiting randomness and settlement."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "id",
            "type": "u64"
          },
          {
            "name": "headsPlayer",
            "type": "pubkey"
          },
          {
            "name": "tailsPlayer",
            "type": "pubkey"
          },
          {
            "name": "headsAmount",
            "type": "u64"
          },
          {
            "name": "tailsAmount",
            "type": "u64"
          },
          {
            "name": "totalPot",
            "type": "u64"
          },
          {
            "name": "tierUsd",
            "type": "u8"
          },
          {
            "name": "createdSlot",
            "type": "u64"
          },
          {
            "name": "state",
            "type": {
              "defined": {
                "name": "matchState"
              }
            }
          },
          {
            "name": "seed",
            "docs": [
              "Replay-resistant VRF seed, unique per match."
            ],
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "result",
            "type": {
              "option": {
                "defined": {
                  "name": "flipResult"
                }
              }
            }
          },
          {
            "name": "winner",
            "type": {
              "option": "pubkey"
            }
          },
          {
            "name": "settledSlot",
            "type": {
              "option": "u64"
            }
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "matchCreated",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "matchId",
            "type": "u64"
          },
          {
            "name": "headsPlayer",
            "type": "pubkey"
          },
          {
            "name": "tailsPlayer",
            "type": "pubkey"
          },
          {
            "name": "headsAmount",
            "type": "u64"
          },
          {
            "name": "tailsAmount",
            "type": "u64"
          },
          {
            "name": "totalPot",
            "type": "u64"
          },
          {
            "name": "tierUsd",
            "type": "u8"
          },
          {
            "name": "seed",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "slot",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "matchSettled",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "matchId",
            "type": "u64"
          },
          {
            "name": "result",
            "docs": [
              "0 = HEADS, 1 = TAILS."
            ],
            "type": "u8"
          },
          {
            "name": "winner",
            "type": "pubkey"
          },
          {
            "name": "pot",
            "type": "u64"
          },
          {
            "name": "slot",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "matchState",
      "docs": [
        "Match lifecycle. Randomness is observed and consumed atomically inside",
        "`settle_match`, so no intermediate state is required."
      ],
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "waitingForRandomness"
          },
          {
            "name": "settled"
          }
        ]
      }
    },
    {
      "name": "playerState",
      "docs": [
        "Per-wallet activity guard. V1 allows exactly one active queue entry or",
        "one unresolved match per wallet — V2 keeps the same global rule across",
        "ALL rooms (a wallet may NOT sit in $1 and $10 simultaneously).",
        "`queued_tier_usd` / `match_tier_usd` give the room context needed to",
        "recover state correctly (0 = none/legacy-idle, 1 = $1 legacy default)."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "player",
            "type": "pubkey"
          },
          {
            "name": "queued",
            "type": "bool"
          },
          {
            "name": "queuedSide",
            "type": "u8"
          },
          {
            "name": "queuedSequence",
            "type": "u64"
          },
          {
            "name": "inMatch",
            "type": "bool"
          },
          {
            "name": "matchId",
            "type": "u64"
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "queuedTierUsd",
            "type": "u8"
          },
          {
            "name": "matchTierUsd",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "queueCancelled",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "player",
            "type": "pubkey"
          },
          {
            "name": "side",
            "type": "u8"
          },
          {
            "name": "sequence",
            "type": "u64"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "slot",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "queueEntry",
      "docs": [
        "One FIFO queue slot. PDAs are deterministic in (side, sequence), so any",
        "client can resolve the current head address off-chain.",
        "NOTE: legacy V1 global queue. Preserved for settled-history and drain;",
        "new rooms use RoomQueueEntry below with tier-scoped PDAs."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "player",
            "type": "pubkey"
          },
          {
            "name": "side",
            "type": "u8"
          },
          {
            "name": "sequence",
            "type": "u64"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "joinedSlot",
            "type": "u64"
          },
          {
            "name": "status",
            "type": {
              "defined": {
                "name": "entryStatus"
              }
            }
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "queueJoined",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "player",
            "type": "pubkey"
          },
          {
            "name": "side",
            "type": "u8"
          },
          {
            "name": "sequence",
            "type": "u64"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "tierUsd",
            "type": "u8"
          },
          {
            "name": "matched",
            "type": "bool"
          },
          {
            "name": "slot",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "roomQueueEntry",
      "docs": [
        "Tier-scoped FIFO queue slot. PDA:",
        "[\"queue\", tier_usd_byte, side_byte, sequence_le_bytes].",
        "A $1 HEADS entry can NEVER match a $10 TAILS entry: matching only pairs",
        "entries from the SAME RoomState/tier."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "player",
            "type": "pubkey"
          },
          {
            "name": "tierUsd",
            "type": "u8"
          },
          {
            "name": "side",
            "type": "u8"
          },
          {
            "name": "sequence",
            "type": "u64"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "joinedSlot",
            "type": "u64"
          },
          {
            "name": "status",
            "type": {
              "defined": {
                "name": "entryStatus"
              }
            }
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "roomState",
      "docs": [
        "Tier-scoped room state: independent FIFO pointers per real room.",
        "PDA: [\"room\", tier_usd_byte]. `total_matches` stays global in GameConfig."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "tierUsd",
            "type": "u8"
          },
          {
            "name": "active",
            "type": "bool"
          },
          {
            "name": "headsHead",
            "type": "u64"
          },
          {
            "name": "headsNext",
            "type": "u64"
          },
          {
            "name": "tailsHead",
            "type": "u64"
          },
          {
            "name": "tailsNext",
            "type": "u64"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    }
  ]
};
