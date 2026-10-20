import { NextRequest, NextResponse } from "next/server"
import bcrypt from "bcryptjs"
import { db } from "@/lib/db"
import { initiateMembershipPayment } from "@/lib/payments"

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { login, password } = body

    if (!login || !password) {
      return NextResponse.json(
        { error: "Email/phone and password are required" },
        { status: 400 }
      )
    }

    const user = await db.user.findFirst({
      where: {
        OR: [{ email: login }, { phone: login }],
      },
      select: {
        id: true,
        status: true,
        phone: true,
        mpesaNumber: true,
        password: true,
      },
    })

    if (!user?.password || !(await bcrypt.compare(password, user.password))) {
      return NextResponse.json({ error: "Invalid credentials" }, { status: 401 })
    }

    if (user.status !== "pending") {
      return NextResponse.json(
        { error: "Account is not pending payment" },
        { status: 400 }
      )
    }

    const payment = await initiateMembershipPayment({
      userId: user.id,
      phone: user.mpesaNumber || user.phone,
    })

    if (!payment.success) {
      return NextResponse.json(
        { error: payment.error || "Could not send the M-Pesa prompt" },
        { status: 502 }
      )
    }

    return NextResponse.json(
      {
        message: "M-Pesa STK push sent. Enter your M-Pesa PIN to complete payment.",
        checkoutRequestId: payment.checkoutRequestId,
        reference: payment.reference,
        phone: payment.phone,
      },
      { status: 201 }
    )
  } catch (error) {
    console.error("Payment retry error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
