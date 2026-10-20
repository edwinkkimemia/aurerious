import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import bcrypt from "bcryptjs"
import { generateReferralCode } from "@/lib/utils"
import { initiateMembershipPayment } from "@/lib/payments"

const PHONE_REGEX = /^0[17]\d{8}$/

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { name, email, phone, password, referralCode: incomingReferralCode } = body

    if (!name || !name.trim()) {
      return NextResponse.json({ error: "Full name is required" }, { status: 400 })
    }
    if (!email || !email.trim()) {
      return NextResponse.json({ error: "Email is required" }, { status: 400 })
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: "Invalid email address" }, { status: 400 })
    }
    if (!phone || !password) {
      return NextResponse.json(
        { error: "Phone and password are required" },
        { status: 400 }
      )
    }

    if (!PHONE_REGEX.test(phone)) {
      return NextResponse.json(
        { error: "Phone must be a valid Kenyan number (07XX or 01XX)" },
        { status: 400 }
      )
    }

    if (password.length < 6) {
      return NextResponse.json(
        { error: "Password must be at least 6 characters" },
        { status: 400 }
      )
    }

    const existing = await db.user.findFirst({
      where: {
        OR: [
          { phone },
          ...(email ? [{ email }] : []),
        ],
      },
    })

    if (existing) {
      return NextResponse.json(
        { error: "Phone or email already registered" },
        { status: 409 }
      )
    }

    let referrer: Awaited<ReturnType<typeof db.user.findUnique>> | null = null
    if (incomingReferralCode) {
      referrer = await db.user.findUnique({
        where: { referralCode: incomingReferralCode },
      })
      if (!referrer) {
        return NextResponse.json(
          { error: "Invalid referral code" },
          { status: 400 }
        )
      }
    }

    const hashedPassword = await bcrypt.hash(password, 10)

    let referralCode = generateReferralCode()
    while (await db.user.findUnique({ where: { referralCode } })) {
      referralCode = generateReferralCode()
    }

    const user = await db.user.create({
      data: {
        name: name.trim(),
        email: email.trim().toLowerCase(),
        phone,
        password: hashedPassword,
        referralCode,
        referredBy: referrer?.id || null,
        status: "pending",
        mpesaNumber: phone,
      },
    })

    if (referrer) {
      await db.referral.create({
        data: {
          referrerId: referrer.id,
          refereeId: user.id,
          status: "completed",
          level: 1,
        },
      })
    }

    const payment = await initiateMembershipPayment({
      userId: user.id,
      phone,
    })

    if (!payment.success) {
      return NextResponse.json(
        {
          error: `${payment.error || "Could not send the M-Pesa prompt"}. Your account was created — sign in to retry payment.`,
          requiresLogin: true,
        },
        { status: 502 }
      )
    }

    return NextResponse.json(
      {
        message: "M-Pesa STK push sent. Enter your M-Pesa PIN to complete payment.",
        checkoutRequestId: payment.checkoutRequestId,
        reference: payment.reference,
        phone: payment.phone,
        amount: payment.amount,
        userId: user.id,
      },
      { status: 201 }
    )
  } catch (error) {
    console.error("Registration error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
