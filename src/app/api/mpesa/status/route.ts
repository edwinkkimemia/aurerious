import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { queryStatus } from "@/services/mpesa"
import { failMpesaPayment, finalizeMpesaPayment } from "@/lib/payments"

export async function GET(request: NextRequest) {
  try {
    const checkoutRequestId = request.nextUrl.searchParams.get("checkoutRequestId")

    if (!checkoutRequestId) {
      return NextResponse.json({ error: "Missing checkoutRequestId" }, { status: 400 })
    }

    const attempt = await db.mpesaTransaction.findFirst({
      where: { checkoutRequestId },
    })

    if (!attempt) {
      return NextResponse.json({ error: "Transaction not found" }, { status: 404 })
    }

    if (attempt.status === "completed") {
      return NextResponse.json({
        status: "completed",
        reference: attempt.reference,
        resultCode: attempt.resultCode,
        resultDesc: attempt.resultDesc,
      })
    }

    if (attempt.status === "failed") {
      return NextResponse.json({
        status: "failed",
        reference: attempt.reference,
        resultCode: attempt.resultCode,
        resultDesc: attempt.resultDesc,
      })
    }

    // Ask Safaricom directly in case the callback hasn't arrived yet.
    const queried = await queryStatus(checkoutRequestId)

    if (queried.status === "success") {
      const finalized = await finalizeMpesaPayment({
        checkoutRequestId,
        resultDesc: queried.resultDesc || "Payment received",
      })

      return NextResponse.json({
        status: finalized.success ? "completed" : "pending",
        reference: finalized.reference || attempt.reference,
        resultCode: queried.resultCode,
        resultDesc: queried.resultDesc,
      })
    }

    if (queried.status === "failed") {
      await failMpesaPayment({
        checkoutRequestId,
        resultCode: queried.resultCode,
        resultDesc: queried.resultDesc,
      })

      return NextResponse.json({
        status: "failed",
        reference: attempt.reference,
        resultCode: queried.resultCode,
        resultDesc: queried.resultDesc,
      })
    }

    return NextResponse.json({
      status: "pending",
      reference: attempt.reference,
      resultDesc: queried.resultDesc || attempt.resultDesc || "Waiting for M-Pesa confirmation",
    })
  } catch (error) {
    console.error("M-Pesa status error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
