/**
 * Wallet + RPC error classification.
 * Production users must never see minified errors such as `e is not iterable`.
 */

export type TxErrorCode =
  | "RPC_RATE_LIMIT"
  | "RPC_UNAVAILABLE"
  | "WALLET_REJECTED"
  | "WALLET_CONNECT_UNSUPPORTED"
  | "WALLET_SIGNING_UNSUPPORTED"
  | "WALLET_SIGNING_INVALID_OUTPUT"
  | "TRANSACTION_SERIALIZATION_ERROR"
  | "TRANSACTION_SEND_FAILED"
  | "TRANSACTION_CONFIRMATION_UNKNOWN"
  | "WRONG_NETWORK"
  | "INSUFFICIENT_PROJECT_TOKEN"
  | "INSUFFICIENT_SOL"
  | "PROGRAM_ERROR"
  | "ALREADY_ACTIVE"
  | "UNKNOWN";

export interface ClassifiedError {
  code: TxErrorCode;
  /** Human-safe message (never minified internals). */
  message: string;
  /** Technical detail for logs/diagnostics (never shown raw in UI). */
  technical: string;
  retryable: boolean;
}

function technicalOf(e: unknown): string {
  if (e instanceof Error) return `${e.name}: ${e.message}`.slice(0, 500);
  try {
    return String(e).slice(0, 500);
  } catch {
    return "unknown error";
  }
}

export function isRateLimitError(e: unknown): boolean {
  const t = technicalOf(e);
  return (
    t.includes("429") ||
    t.includes("rate limit") ||
    t.includes("Rate limit") ||
    t.includes("Connection rate limits exceeded") ||
    t.includes("Too Many Requests") ||
    t.includes("too many requests")
  );
}

function isUserRejection(e: unknown): boolean {
  const t = technicalOf(e).toLowerCase();
  return (
    t.includes("user rejected") ||
    t.includes("user denied") ||
    t.includes("rejected the request") ||
    t.includes("declined") ||
    t.includes("cancelled") ||
    t.includes("canceled")
  );
}

function isInsufficientFundsProgram(e: unknown): boolean {
  const t = technicalOf(e);
  return (
    t.includes("InsufficientFunds") ||
    t.includes("insufficient funds") ||
    t.includes("0x1") && t.includes("custom program error")
  );
}

export function classifyError(e: unknown): ClassifiedError {
  const technical = technicalOf(e);

  // The minified `e is not iterable` (and friends) always indicates a
  // malformed signing/serialization path — never show it raw.
  if (
    technical.includes("is not iterable") ||
    technical.includes("is not a function") ||
    technical.includes("undefined is not an object") ||
    technical.includes("Cannot read properties of undefined")
  ) {
    // Heuristic: if it happened around signing, it is a signing-output bug.
    // Callers with more context should use classifySigningError(); this is
    // the safe generic mapping.
    return {
      code: "WALLET_SIGNING_INVALID_OUTPUT",
      message: "Your wallet could not sign this transaction correctly. Please reconnect and try again.",
      technical,
      retryable: false,
    };
  }

  if (isRateLimitError(e)) {
    return {
      code: "RPC_RATE_LIMIT",
      message: "Solana network is temporarily busy. Retrying…",
      technical,
      retryable: true,
    };
  }

  if (
    technical.includes("Failed to fetch") ||
    technical.includes("NetworkError") ||
    technical.includes("fetch failed") ||
    technical.includes("ENOTFOUND") ||
    technical.includes("503") ||
    technical.includes("502") ||
    technical.includes("ECONNREFUSED")
  ) {
    return {
      code: "RPC_UNAVAILABLE",
      message: "Could not reach the Solana network. Check your connection and try again.",
      technical,
      retryable: true,
    };
  }

  if (isUserRejection(e)) {
    return {
      code: "WALLET_REJECTED",
      message: "You rejected the request in your wallet. Nothing was submitted.",
      technical,
      retryable: false,
    };
  }

  if (
    technical.includes("WALLET_CONNECT_UNSUPPORTED") ||
    technical.includes("does not support standard:connect")
  ) {
    return {
      code: "WALLET_CONNECT_UNSUPPORTED",
      message: "This wallet cannot connect through the Solana Wallet Standard.",
      technical,
      retryable: false,
    };
  }

  if (
    technical.includes("does not support solana:signTransaction") ||
    technical.includes("signing unsupported") ||
    technical.includes("WALLET_SIGNING_UNSUPPORTED")
  ) {
    return {
      code: "WALLET_SIGNING_UNSUPPORTED",
      message: "This Solana account cannot sign transactions.",
      technical,
      retryable: false,
    };
  }

  if (
    technical.includes("WALLET_SIGNING_INVALID_OUTPUT") ||
    technical.includes("signedTransaction") ||
    technical.includes("deserial")
  ) {
    return {
      code: "WALLET_SIGNING_INVALID_OUTPUT",
      message: "Your wallet could not sign this transaction correctly. Please reconnect and try again.",
      technical,
      retryable: false,
    };
  }

  if (technical.includes("Blockhash not found") || technical.includes("blockhash")) {
    return {
      code: "TRANSACTION_SEND_FAILED",
      message: "The transaction expired before it could be submitted. Please try again.",
      technical,
      retryable: true,
    };
  }

  if (
    technical.includes("Transaction was not confirmed") ||
    technical.includes("confirmation") ||
    technical.includes("TRANSACTION_CONFIRMATION_UNKNOWN")
  ) {
    return {
      code: "TRANSACTION_CONFIRMATION_UNKNOWN",
      message: "Transaction submitted. Checking its on-chain status…",
      technical,
      retryable: true,
    };
  }

  if (technical.includes("WRONG_NETWORK") || technical.includes("switch to Solana Devnet")) {
    return {
      code: "WRONG_NETWORK",
      message: "Your wallet is on the wrong network. Switch to Solana Devnet to play.",
      technical,
      retryable: false,
    };
  }

  if (technical.includes("INSUFFICIENT_PROJECT_TOKEN") || technical.includes("Insufficient project tokens")) {
    return {
      code: "INSUFFICIENT_PROJECT_TOKEN",
      message: "Insufficient project tokens for a $1 flip. Get test tokens first.",
      technical,
      retryable: false,
    };
  }

  if (technical.includes("INSUFFICIENT_SOL") || technical.includes("Insufficient SOL")) {
    return {
      code: "INSUFFICIENT_SOL",
      message: "Preparing Devnet SOL for fees… Please try again in a moment.",
      technical,
      retryable: true,
    };
  }

  if (technical.includes("AlreadyActive") || technical.includes("ALREADY_ACTIVE")) {
    return {
      code: "ALREADY_ACTIVE",
      message: "You already have an active queue position or match. Refreshing state…",
      technical,
      retryable: false,
    };
  }

  if (
    technical.includes("custom program error") ||
    technical.includes("ProgramError") ||
    isInsufficientFundsProgram(e)
  ) {
    return {
      code: "PROGRAM_ERROR",
      message: "The on-chain program rejected this action. Refreshing state…",
      technical,
      retryable: false,
    };
  }

  if (technical.includes("TRANSACTION_SEND_FAILED") || technical.includes("sendRawTransaction")) {
    return {
      code: "TRANSACTION_SEND_FAILED",
      message: "Could not submit the transaction. Please try again.",
      technical,
      retryable: true,
    };
  }

  return {
    code: "UNKNOWN",
    message: "Something went wrong. Please try again.",
    technical,
    retryable: false,
  };
}

/** Map a signing-stage throw into a classified error with signing context. */
export function classifySigningError(stage: string, e: unknown): ClassifiedError {
  const base = classifyError(e);
  if (base.code !== "UNKNOWN") return base;
  return {
    code: "WALLET_SIGNING_INVALID_OUTPUT",
    message: "Your wallet could not sign this transaction correctly. Please reconnect and try again.",
    technical: `signing stage ${stage}: ${base.technical}`.slice(0, 500),
    retryable: false,
  };
}

export function userMessageForCode(code: TxErrorCode): string {
  switch (code) {
    case "RPC_RATE_LIMIT":
      return "Solana network is temporarily busy. Retrying…";
    case "RPC_UNAVAILABLE":
      return "Could not reach the Solana network. Check your connection and try again.";
    case "WALLET_REJECTED":
      return "You rejected the request in your wallet. Nothing was submitted.";
    case "WALLET_CONNECT_UNSUPPORTED":
      return "This wallet cannot connect through the Solana Wallet Standard.";
    case "WALLET_SIGNING_UNSUPPORTED":
      return "This Solana account cannot sign transactions.";
    case "WALLET_SIGNING_INVALID_OUTPUT":
      return "Your wallet could not sign this transaction correctly. Please reconnect and try again.";
    case "TRANSACTION_SERIALIZATION_ERROR":
      return "Could not prepare the transaction. Please try again.";
    case "TRANSACTION_SEND_FAILED":
      return "Could not submit the transaction. Please try again.";
    case "TRANSACTION_CONFIRMATION_UNKNOWN":
      return "Transaction submitted. Checking its on-chain status…";
    case "WRONG_NETWORK":
      return "Your wallet is on the wrong network. Switch to Solana Devnet to play.";
    case "INSUFFICIENT_PROJECT_TOKEN":
      return "Insufficient project tokens for a $1 flip. Get test tokens first.";
    case "INSUFFICIENT_SOL":
      return "Preparing Devnet SOL for fees… Please try again in a moment.";
    case "PROGRAM_ERROR":
      return "The on-chain program rejected this action. Refreshing state…";
    case "ALREADY_ACTIVE":
      return "You already have an active queue position or match. Refreshing state…";
    default:
      return "Something went wrong. Please try again.";
  }
}
