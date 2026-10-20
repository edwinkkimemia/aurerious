"use client"

import { useEffect, useState } from "react"

const DEFAULT_MEMBERSHIP_FEE = 1000
const DEFAULT_SIGNUP_BONUS = 500

export function usePublicSettings() {
  const [membershipFee, setMembershipFee] = useState(DEFAULT_MEMBERSHIP_FEE)
  const [signupBonus, setSignupBonus] = useState(DEFAULT_SIGNUP_BONUS)

  useEffect(() => {
    let cancelled = false

    fetch("/api/settings/public", { cache: "no-store" })
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return
        if (Number.isFinite(data.membershipFee) && data.membershipFee > 0) {
          setMembershipFee(data.membershipFee)
        }
        if (Number.isFinite(data.signupBonus) && data.signupBonus > 0) {
          setSignupBonus(data.signupBonus)
        }
      })
      .catch(() => {
        // Keep defaults if settings can't be loaded.
      })

    return () => {
      cancelled = true
    }
  }, [])

  return { membershipFee, signupBonus }
}
