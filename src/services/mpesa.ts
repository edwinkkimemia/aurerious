function env(name: string, fallback = ""): string {
  return (process.env[name] || fallback).trim().replace(/^["']|["']$/g, "")
}

const CONSUMER_KEY = env("MPESA_CONSUMER_KEY")
const CONSUMER_SECRET = env("MPESA_CONSUMER_SECRET")
const PASSKEY = env("MPESA_PASSKEY")
const BUSINESS_SHORTCODE = env("MPESA_BUSINESS_SHORTCODE")
const CALLBACK_URL = env("MPESA_CALLBACK_URL")
const ENVIRONMENT = env("MPESA_ENVIRONMENT", "sandbox").toLowerCase()
const SHORTCODE_TYPE = env("MPESA_SHORTCODE_TYPE", "paybill").toLowerCase()

const BASE_URL = ENVIRONMENT === "production"
  ? "https://api.safaricom.co.ke"
  : "https://sandbox.safaricom.co.ke"

/**
 * Paybill and Buy Goods (Till) STK requests use different transaction types.
 * Using Paybill against a Till shortcode returns Safaricom result code 2029.
 */
function getTransactionType(): "CustomerPayBillOnline" | "CustomerBuyGoodsOnline" {
  return SHORTCODE_TYPE === "till" || SHORTCODE_TYPE === "buygoods"
    ? "CustomerBuyGoodsOnline"
    : "CustomerPayBillOnline"
}

function hasPlaceholder(value: string): boolean {
  return /yourdomain|example\.com|your-|xxx/i.test(value)
}

function isConfigured(): boolean {
  return !!(
    CONSUMER_KEY &&
    CONSUMER_SECRET &&
    PASSKEY &&
    BUSINESS_SHORTCODE &&
    CALLBACK_URL &&
    !hasPlaceholder(CALLBACK_URL)
  )
}

// Mock mode is opt-in and only allowed outside production builds.
function isMockMode(): boolean {
  return env("MPESA_MOCK").toLowerCase() === "true" && process.env.NODE_ENV !== "production"
}

/**
 * Safaricom expects MSISDN in 2547XXXXXXXX / 2541XXXXXXXX format.
 */
export function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, "")
  if (digits.startsWith("254")) return digits
  if (digits.startsWith("0")) return `254${digits.slice(1)}`
  if (digits.startsWith("7") || digits.startsWith("1")) return `254${digits}`
  return digits
}

export function isValidKenyanPhone(phone: string): boolean {
  return /^254[17]\d{8}$/.test(normalizePhone(phone))
}

/**
 * Safaricom timestamps must be in East Africa Time (UTC+3).
 */
function getTimestamp(): string {
  const now = new Date(Date.now() + 3 * 60 * 60 * 1000)
  const year = now.getUTCFullYear()
  const month = String(now.getUTCMonth() + 1).padStart(2, "0")
  const day = String(now.getUTCDate()).padStart(2, "0")
  const hours = String(now.getUTCHours()).padStart(2, "0")
  const minutes = String(now.getUTCMinutes()).padStart(2, "0")
  const seconds = String(now.getUTCSeconds()).padStart(2, "0")
  return `${year}${month}${day}${hours}${minutes}${seconds}`
}

function getPassword(timestamp: string): string {
  const raw = `${BUSINESS_SHORTCODE}${PASSKEY}${timestamp}`
  return Buffer.from(raw).toString("base64")
}

async function getAccessToken(): Promise<string | null> {
  try {
    const url = `${BASE_URL}/oauth/v1/generate?grant_type=client_credentials`
    const auth = Buffer.from(`${CONSUMER_KEY}:${CONSUMER_SECRET}`).toString("base64")

    const res = await fetch(url, {
      method: "GET",
      headers: { Authorization: `Basic ${auth}` },
      cache: "no-store",
    })

    if (!res.ok) {
      const text = await res.text().catch(() => "")
      console.error(`[M-Pesa] OAuth failed ${res.status} ${res.statusText} ${text}`)
      return null
    }

    const data = await res.json()
    if (!data.access_token) {
      console.error("[M-Pesa] OAuth response missing access_token")
      return null
    }
    return data.access_token
  } catch (error) {
    console.error("[M-Pesa] OAuth exception", error)
    return null
  }
}

export async function stkPush(
  phone: string,
  amount: number,
  accountRef: string
): Promise<{
  success: boolean
  checkoutRequestId?: string
  merchantRequestId?: string
  responseDescription?: string
  error?: string
}> {
  const partyA = normalizePhone(phone)

  if (!isValidKenyanPhone(partyA)) {
    return { success: false, error: "Enter a valid Kenyan M-Pesa number (07XX or 01XX)" }
  }

  if (!Number.isFinite(amount) || amount <= 0) {
    return { success: false, error: "Invalid payment amount" }
  }

  if (isMockMode()) {
    console.log("[M-Pesa] Mock STK Push:", { phone: partyA, amount, accountRef })
    return {
      success: true,
      checkoutRequestId: `wsr_mock_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      merchantRequestId: `mock_${Date.now()}`,
      responseDescription: "Mock STK push accepted",
    }
  }

  if (!isConfigured()) {
    console.error("[M-Pesa] STK push requested but credentials are not configured")
    return { success: false, error: "M-Pesa payments are not configured. Please contact support." }
  }

  try {
    const timestamp = getTimestamp()
    const password = getPassword(timestamp)
    const token = await getAccessToken()
    if (!token) {
      return { success: false, error: "Could not authenticate with M-Pesa. Please try again." }
    }

    const body = {
      BusinessShortCode: BUSINESS_SHORTCODE,
      Password: password,
      Timestamp: timestamp,
      TransactionType: getTransactionType(),
      Amount: Math.round(amount),
      PartyA: partyA,
      PartyB: BUSINESS_SHORTCODE,
      PhoneNumber: partyA,
      CallBackURL: CALLBACK_URL,
      AccountReference: accountRef.slice(0, 12),
      TransactionDesc: `Payment of KES ${Math.round(amount)}`,
    }

    console.log("[M-Pesa] Sending STK push", {
      environment: ENVIRONMENT,
      transactionType: getTransactionType(),
      shortcode: `${BUSINESS_SHORTCODE.slice(0, 3)}***`,
      amount: Math.round(amount),
      accountRef,
    })

    const res = await fetch(`${BASE_URL}/mpesa/stkpush/v1/processrequest`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      cache: "no-store",
    })

    const data = await res.json().catch(() => ({} as Record<string, unknown>))

    if (!res.ok || data.ResponseCode !== "0") {
      console.error("[M-Pesa] STK push failed", data)
      return {
        success: false,
        error:
          (data.errorMessage as string) ||
          (data.ResponseDescription as string) ||
          "M-Pesa rejected the payment request",
      }
    }

    return {
      success: true,
      checkoutRequestId: data.CheckoutRequestID as string,
      merchantRequestId: data.MerchantRequestID as string,
      responseDescription: (data.CustomerMessage as string) || "STK push sent",
    }
  } catch (error) {
    console.error("[M-Pesa] STK push exception", error)
    return { success: false, error: "Could not reach M-Pesa. Please try again." }
  }
}

export async function queryStatus(
  checkoutRequestId: string
): Promise<{
  status: "success" | "pending" | "failed"
  resultCode?: string
  resultDesc?: string
  error?: string
}> {
  if (isMockMode()) {
    console.log("[M-Pesa] Mock query status:", { checkoutRequestId })
    return {
      status: "success",
      resultCode: "0",
      resultDesc: "The service request is processed successfully.",
    }
  }

  if (!isConfigured()) {
    return { status: "pending", error: "M-Pesa is not configured" }
  }

  try {
    const timestamp = getTimestamp()
    const password = getPassword(timestamp)
    const token = await getAccessToken()
    if (!token) {
      return { status: "pending", error: "Could not authenticate with M-Pesa" }
    }

    const body = {
      BusinessShortCode: BUSINESS_SHORTCODE,
      Password: password,
      Timestamp: timestamp,
      CheckoutRequestID: checkoutRequestId,
    }

    const res = await fetch(`${BASE_URL}/mpesa/stkpushquery/v1/query`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      cache: "no-store",
    })

    const data = await res.json().catch(() => ({} as Record<string, unknown>))

    // While the customer is still entering their PIN, Daraja returns an
    // errorCode/errorMessage instead of a ResultCode.
    if (data.ResultCode === undefined || data.ResultCode === null) {
      return {
        status: "pending",
        error: (data.errorMessage as string) || "Awaiting customer confirmation",
      }
    }

    const resultCode = String(data.ResultCode)
    return {
      status: resultCode === "0" ? "success" : "failed",
      resultCode,
      resultDesc: (data.ResultDesc as string) || (data.errorMessage as string),
    }
  } catch (error) {
    console.error("[M-Pesa] Query status exception", error)
    return { status: "pending", error: "Could not check payment status" }
  }
}

export async function processCallback(body: unknown): Promise<{
  success: boolean
  resultCode?: string
  resultDesc?: string
  amount?: number
  mpesaReceiptNumber?: string
  phone?: string
  transactionDate?: string
  checkoutRequestId?: string
}> {
  const stkCallback = (body as { Body?: { stkCallback?: Record<string, unknown> } })?.Body?.stkCallback
  if (!stkCallback) {
    console.error("[M-Pesa] Invalid callback body")
    return { success: false, resultDesc: "Invalid callback body" }
  }

  const ResultCode = stkCallback.ResultCode
  const ResultDesc = stkCallback.ResultDesc as string
  const checkoutRequestId = stkCallback.CheckoutRequestID as string | undefined

  if (String(ResultCode) !== "0") {
    return {
      success: false,
      resultCode: String(ResultCode),
      resultDesc: ResultDesc || "Transaction failed",
      checkoutRequestId,
    }
  }

  let amount = 0
  let mpesaReceiptNumber = ""
  let phone = ""
  let transactionDate = ""

  const metadata = stkCallback.CallbackMetadata as
    | { Item?: Array<{ Name: string; Value?: string | number }> }
    | undefined

  for (const item of metadata?.Item || []) {
    switch (item.Name) {
      case "Amount":
        amount = Number(item.Value) || 0
        break
      case "MpesaReceiptNumber":
        mpesaReceiptNumber = String(item.Value || "")
        break
      case "PhoneNumber":
        phone = String(item.Value || "")
        break
      case "TransactionDate":
        transactionDate = String(item.Value || "")
        break
    }
  }

  return {
    success: true,
    resultCode: "0",
    resultDesc: ResultDesc || "Success",
    amount,
    mpesaReceiptNumber,
    phone,
    transactionDate,
    checkoutRequestId,
  }
}
