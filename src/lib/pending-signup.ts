const PENDING_SIGNUP_KEY = "zuri_pending_signup"

type PendingSignup = {
  login: string
  password: string
}

/**
 * Keeps the new member's sign-in details for the current tab only. The waiting
 * page uses them to create a session automatically once payment is confirmed.
 */
export function rememberPendingSignup(email: string, password: string) {
  try {
    const pending: PendingSignup = {
      login: email.trim().toLowerCase(),
      password,
    }
    sessionStorage.setItem(PENDING_SIGNUP_KEY, JSON.stringify(pending))
  } catch {
    // sessionStorage can be unavailable in strict privacy modes.
  }
}

/**
 * Reads and removes the pending sign-in details so they cannot be reused.
 */
export function takePendingSignup(): PendingSignup | null {
  try {
    const raw = sessionStorage.getItem(PENDING_SIGNUP_KEY)
    if (!raw) return null

    sessionStorage.removeItem(PENDING_SIGNUP_KEY)
    const parsed = JSON.parse(raw) as Partial<PendingSignup>

    if (typeof parsed.login !== "string" || typeof parsed.password !== "string") {
      return null
    }

    return { login: parsed.login, password: parsed.password }
  } catch {
    return null
  }
}

export function clearPendingSignup() {
  try {
    sessionStorage.removeItem(PENDING_SIGNUP_KEY)
  } catch {
    // Ignore unavailable storage.
  }
}
