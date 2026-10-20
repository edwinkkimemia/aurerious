import { NextResponse } from "next/server"
import { getPublicSettings } from "@/lib/settings"

export const dynamic = "force-dynamic"

export async function GET() {
  try {
    const settings = await getPublicSettings()
    return NextResponse.json(settings, {
      headers: { "Cache-Control": "no-store" },
    })
  } catch (error) {
    console.error("Public settings error:", error)
    return NextResponse.json(
      { membershipFee: 1000, signupBonus: 500 },
      { headers: { "Cache-Control": "no-store" } }
    )
  }
}
