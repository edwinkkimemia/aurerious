"use client"

import { Suspense, useEffect, useRef, useState } from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { AlertCircle, ArrowLeft, CheckCircle2, Loader2, Smartphone } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardTitle } from "@/components/ui/card"
import { usePublicSettings } from "@/hooks/use-public-settings"

type PaymentState = "waiting" | "success" | "failed" | "missing"

function WaitingContent() {
  const router = useRouter()
  const params = useSearchParams()
  const checkoutRequestId = params.get("checkout") || ""
  const phone = params.get("phone") || ""
  const reference = params.get("reference") || ""
  const { membershipFee } = usePublicSettings()
  const requestedAmount = Number(params.get("amount"))
  const amount = Number.isFinite(requestedAmount) && requestedAmount > 0 ? requestedAmount : membershipFee
  const amountLabel = amount.toLocaleString("en-KE")

  const [state, setState] = useState<PaymentState>(checkoutRequestId ? "waiting" : "missing")
  const [message, setMessage] = useState("")
  const [attempts, setAttempts] = useState(0)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    if (!checkoutRequestId) return

    let cancelled = false

    const poll = async () => {
      try {
        const res = await fetch(
          `/api/mpesa/status?checkoutRequestId=${encodeURIComponent(checkoutRequestId)}`,
          { cache: "no-store" }
        )
        const data = await res.json()

        if (cancelled) return

        if (data.status === "completed") {
          if (pollRef.current) clearInterval(pollRef.current)
          setState("success")
          setTimeout(() => router.push("/login?verified=true"), 2500)
        } else if (data.status === "failed") {
          if (pollRef.current) clearInterval(pollRef.current)
          setState("failed")
          setMessage(data.resultDesc || "The M-Pesa payment was not completed.")
        } else {
          setAttempts((n) => n + 1)
        }
      } catch {
        if (!cancelled) setAttempts((n) => n + 1)
      }
    }

    poll()
    pollRef.current = setInterval(poll, 4000)

    return () => {
      cancelled = true
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [checkoutRequestId, router])

  return (
    <div className="min-h-screen bg-lux-cream flex flex-col items-center justify-center p-4 relative overflow-hidden">
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-0 right-0 w-[600px] h-[600px] bg-lux-gold/5 rounded-full blur-3xl" />
        <div className="absolute bottom-0 left-0 w-[500px] h-[500px] bg-lux-navy/5 rounded-full blur-3xl" />
      </div>

      <Card className="w-full max-w-lg border-lux-gold/20 shadow-2xl glass">
        <CardContent className="p-8 sm:p-10 text-center">
          {state === "success" && (
            <>
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-green-100 mb-6">
                <CheckCircle2 className="h-8 w-8 text-green-600" />
              </div>
              <CardTitle className="font-heading text-2xl text-lux-navy mb-2">
                Payment Received!
              </CardTitle>
              <CardDescription className="text-lux-text-light text-base leading-relaxed">
                Your account is now active. Redirecting you to sign in...
              </CardDescription>
            </>
          )}

          {state === "waiting" && (
            <>
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-lux-gold/10 mb-6">
                <Smartphone className="h-8 w-8 text-lux-gold" />
              </div>
              <CardTitle className="font-heading text-2xl text-lux-navy mb-2">
                Check Your Phone
              </CardTitle>
              <CardDescription className="text-lux-text-light text-base leading-relaxed">
                An M-Pesa payment prompt for <strong className="text-lux-navy">KES {amountLabel}</strong>
                {phone ? <> has been sent to <strong className="text-lux-navy">{phone}</strong></> : " has been sent to your phone"}.
                Enter your M-Pesa PIN to activate your account.
              </CardDescription>

              <div className="mt-8 flex items-center justify-center gap-3 rounded-xl bg-lux-gold-pale/60 border border-lux-gold/10 px-4 py-3">
                <Loader2 className="h-5 w-5 text-lux-gold animate-spin flex-shrink-0" />
                <span className="text-sm text-lux-text">Waiting for M-Pesa confirmation...</span>
              </div>

              {reference && (
                <p className="mt-4 text-xs text-lux-text-light">
                  Reference: <span className="font-mono text-lux-navy">{reference}</span>
                </p>
              )}

              {attempts > 45 && (
                <p className="mt-5 text-xs text-lux-text-light leading-relaxed">
                  Still waiting? Make sure your phone has network coverage and the SIM is in the device.
                  You can sign in and tap <strong>Pay via M-Pesa</strong> to resend the prompt.
                </p>
              )}

              <p className="mt-5 text-xs text-lux-text-light leading-relaxed">
                Do not close this page. If you cancel the prompt, you can retry from the sign-in page.
              </p>

              <Link href="/login" className="inline-flex items-center gap-2 mt-6 text-sm text-lux-gold hover:text-lux-gold-dark font-semibold">
                <ArrowLeft className="h-4 w-4" /> Back to sign in
              </Link>
            </>
          )}

          {(state === "failed" || state === "missing") && (
            <>
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-red-50 mb-6">
                <AlertCircle className="h-8 w-8 text-red-500" />
              </div>
              <CardTitle className="font-heading text-2xl text-lux-navy mb-2">
                Payment Not Completed
              </CardTitle>
              <CardDescription className="text-lux-text-light text-base leading-relaxed">
                {state === "missing"
                  ? "We could not start the M-Pesa prompt. Your account may already have been created — sign in to retry payment."
                  : message || "The M-Pesa prompt was cancelled or the payment failed."}
              </CardDescription>

              <div className="mt-8 space-y-3">
                <Button asChild className="w-full bg-lux-gold hover:bg-lux-gold-dark text-white font-heading font-bold h-11 rounded-lg">
                  <Link href="/login">Sign in to retry payment</Link>
                </Button>
                <Button asChild variant="outline" className="w-full h-11 rounded-lg border-lux-gold/30">
                  <Link href="/register">Back to registration</Link>
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

export default function WaitingPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-lux-cream flex items-center justify-center">
          <Loader2 className="h-6 w-6 text-lux-gold animate-spin" />
        </div>
      }
    >
      <WaitingContent />
    </Suspense>
  )
}
