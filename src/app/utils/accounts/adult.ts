import { AccountError } from "./errors";

/** Lanza ADULT_REQUIRED (403) si el usuario no ha confirmado que es mayor de 18. */
export function assertAdult(user: { adult_confirmed_at: number | null }): void {
  if (!user.adult_confirmed_at) {
    throw new AccountError("ADULT_REQUIRED", 403);
  }
}
