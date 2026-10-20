import { db } from "@/lib/db"

export const DEFAULT_MEMBERSHIP_FEE = 1000
export const DEFAULT_SIGNUP_BONUS = 500

async function getSettingNumber(key: string, fallback: number): Promise<number> {
  try {
    const setting = await db.setting.findUnique({ where: { key } })
    const parsed = setting ? Number.parseFloat(setting.value) : NaN
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
  } catch {
    return fallback
  }
}

export async function getMembershipFee(): Promise<number> {
  const fee = await getSettingNumber("membership_fee", DEFAULT_MEMBERSHIP_FEE)
  return Math.round(fee)
}

export async function getSignupBonus(): Promise<number> {
  return getSettingNumber("signup_bonus", DEFAULT_SIGNUP_BONUS)
}

export async function getPublicSettings(): Promise<{
  membershipFee: number
  signupBonus: number
}> {
  const [membershipFee, signupBonus] = await Promise.all([
    getMembershipFee(),
    getSignupBonus(),
  ])
  return { membershipFee, signupBonus }
}
