import { ExpenseBudgetError, ExpensePendingError } from "@/lib/solana/expenseJournal";
import { isTransientCrankError } from "@/lib/solana/matchCrank";

export type MaintenanceDeferral = "BUDGET_LIMIT" | "CONFIRMATION_PENDING" | "RPC_RETRY";

/** Expected retry states must not trip the shared recovery safety circuit. */
export function maintenanceDeferral(error: unknown): MaintenanceDeferral | undefined {
  if (error instanceof ExpensePendingError) return "CONFIRMATION_PENDING";
  if (error instanceof ExpenseBudgetError) return "BUDGET_LIMIT";
  const message = error instanceof Error ? error.message : String(error);
  if (isTransientCrankError(message)) return "RPC_RETRY";
  return undefined;
}
