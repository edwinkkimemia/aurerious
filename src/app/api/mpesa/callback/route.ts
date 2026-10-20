import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { processCallback } from "@/services/mpesa"
import { failMpesaPayment, finalizeMpesaPayment } from "@/lib/payments"

const SAFARICOM_ACK = { ResultCode: 0, ResultDesc: "Success" }

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null)
    if (!body) {
      console.error("[M-Pesa Callback] Invalid JSON body")
      return NextResponse.json(SAFARICOM_ACK)
    }

    console.log("[M-Pesa Callback] Received:", JSON.stringify(body))

    const result = await processCallback(body)
    const checkoutRequestId =
      result.checkoutRequestId ||
      (body as { Body?: { stkCallback?: { CheckoutRequestID?: string } } })?.Body?.stkCallback
        ?.CheckoutRequestID

    if (!checkoutRequestId) {
      console.error("[M-Pesa Callback] Missing CheckoutRequestID")
      return NextResponse.json(SAFARICOM_ACK)
    }

    if (!result.success) {
      await failMpesaPayment({
        checkoutRequestId,
        resultCode: result.resultCode,
        resultDesc: result.resultDesc,
      })
      return NextResponse.json(SAFARICOM_ACK)
    }

    const attempt = await db.mpesaTransaction.findFirst({
      where: { checkoutRequestId },
    })

    if (!attempt) {
      console.error("[M-Pesa Callback] Transaction not found:", checkoutRequestId)
      return NextResponse.json(SAFARICOM_ACK)
    }

    // Protect against spoofed callbacks with a mismatched amount.
    if (!result.amount || Math.abs(result.amount - attempt.amount) > 0.5) {
      console.error("[M-Pesa Callback] Amount mismatch", {
        checkoutRequestId,
        expected: attempt.amount,
        received: result.amount,
      })
      await failMpesaPayment({
        checkoutRequestId,
        resultCode: "amount_mismatch",
        resultDesc: "Callback amount did not match the payment request",
      })
      return NextResponse.json(SAFARICOM_ACK)
    }

    if (!result.mpesaReceiptNumber) {
      console.error("[M-Pesa Callback] Missing receipt number:", checkoutRequestId)
      await failMpesaPayment({
        checkoutRequestId,
        resultCode: "missing_receipt",
        resultDesc: "M-Pesa receipt number was missing",
      })
      return NextResponse.json(SAFARICOM_ACK)
    }

    await finalizeMpesaPayment({
      checkoutRequestId,
      receiptNumber: result.mpesaReceiptNumber,
      resultDesc: result.resultDesc || "Payment received",
    })

    return NextResponse.json(SAFARICOM_ACK)
  } catch (error) {
    console.error("M-Pesa callback error:", error)
    // Always acknowledge so Safaricom does not retry indefinitely.
    return NextResponse.json(SAFARICOM_ACK)
  }
}
