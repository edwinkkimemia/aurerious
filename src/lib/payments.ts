import { db } from "@/lib/db"
import { createSignupBonus, processReferralCommission } from "@/lib/commission-engine"
import { getMembershipFee } from "@/lib/settings"
import { isValidKenyanPhone, normalizePhone, stkPush } from "@/services/mpesa"

/** Safaricom AccountReference is limited to 12 characters. */
export function generatePaymentReference(): string {
  const stamp = Date.now().toString().slice(-5)
  const random = Math.random().toString(36).slice(2, 6).toUpperCase()
  return `ZUR${stamp}${random}`
}

export async function initiateMembershipPayment(params: {
  userId: string
  phone: string
}): Promise<{
  success: boolean
  checkoutRequestId?: string
  reference?: string
  phone?: string
  amount?: number
  error?: string
}> {
  const phone = normalizePhone(params.phone)

  if (!isValidKenyanPhone(phone)) {
    return { success: false, error: "Enter a valid Kenyan M-Pesa number (07XX or 01XX)" }
  }

  const amount = await getMembershipFee()

  // Reuse a recent prompt so double-clicks don't send multiple STK requests.
  const recent = await db.mpesaTransaction.findFirst({
    where: {
      userId: params.userId,
      type: "registration",
      status: "pending",
      amount,
      createdAt: { gte: new Date(Date.now() - 60_000) },
      checkoutRequestId: { not: null },
    },
    orderBy: { createdAt: "desc" },
  })

  if (recent?.checkoutRequestId) {
    return {
      success: true,
      checkoutRequestId: recent.checkoutRequestId,
      reference: recent.reference,
      phone: recent.phone,
      amount: recent.amount,
    }
  }

  const reference = generatePaymentReference()

  // Persist the attempt first so the callback can always be matched.
  const attempt = await db.mpesaTransaction.create({
    data: {
      userId: params.userId,
      phone,
      amount,
      reference,
      status: "pending",
      type: "registration",
    },
  })

  const result = await stkPush(phone, amount, reference)

  if (!result.success || !result.checkoutRequestId) {
    const error = result.error || "Could not send the M-Pesa prompt"
    await db.mpesaTransaction.update({
      where: { id: attempt.id },
      data: { status: "failed", resultDesc: error },
    })
    return { success: false, error }
  }

  await db.mpesaTransaction.update({
    where: { id: attempt.id },
    data: {
      checkoutRequestId: result.checkoutRequestId,
      merchantRequestId: result.merchantRequestId,
      resultDesc: result.responseDescription || "STK push sent",
    },
  })

  return {
    success: true,
    checkoutRequestId: result.checkoutRequestId,
    reference,
    phone,
    amount,
  }
}

export async function finalizeMpesaPayment(params: {
  checkoutRequestId: string
  receiptNumber?: string
  resultDesc?: string
}): Promise<{
  success: boolean
  alreadyProcessed?: boolean
  userId?: string | null
  reference?: string
  amount?: number
  error?: string
}> {
  const attempt = await db.mpesaTransaction.findFirst({
    where: { checkoutRequestId: params.checkoutRequestId },
  })

  if (!attempt) {
    return { success: false, error: "M-Pesa transaction not found" }
  }

  const reference = params.receiptNumber || attempt.reference

  if (attempt.status === "completed") {
    return {
      success: true,
      alreadyProcessed: true,
      userId: attempt.userId,
      reference,
      amount: attempt.amount,
    }
  }

  let createdPayment = false

  await db.$transaction(async (tx) => {
    // Only one callback/poll can claim the transaction.
    const claimed = await tx.mpesaTransaction.updateMany({
      where: { id: attempt.id, status: { not: "completed" } },
      data: {
        status: "completed",
        resultCode: "0",
        resultDesc: params.resultDesc || "Payment received",
      },
    })

    if (claimed.count === 0) return

    if (!attempt.userId) return

    await tx.user.update({
      where: { id: attempt.userId },
      data: { status: "active" },
    })

    const existingPayment = await tx.transaction.findFirst({
      where: {
        userId: attempt.userId,
        type: "payment",
        reference,
      },
    })

    if (!existingPayment) {
      await tx.transaction.create({
        data: {
          userId: attempt.userId,
          type: "payment",
          amount: attempt.amount,
          status: "completed",
          reference,
          description: `M-Pesa payment of KES ${attempt.amount.toFixed(2)}`,
        },
      })
      createdPayment = true
    }
  })

  if (createdPayment && attempt.userId) {
    // Both helpers are idempotent.
    await createSignupBonus(attempt.userId)
    await processReferralCommission(attempt.userId)
  }

  return {
    success: true,
    userId: attempt.userId,
    reference,
    amount: attempt.amount,
  }
}

export async function failMpesaPayment(params: {
  checkoutRequestId: string
  resultCode?: string
  resultDesc?: string
}): Promise<void> {
  await db.mpesaTransaction.updateMany({
    where: { checkoutRequestId: params.checkoutRequestId, status: "pending" },
    data: {
      status: "failed",
      resultCode: params.resultCode || "1",
      resultDesc: params.resultDesc || "Payment failed",
    },
  })
}
