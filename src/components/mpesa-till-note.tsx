export const MPESA_TILL_NUMBER = "1781595"
export const MPESA_TILL_NAME = "PRISM BYTE SOLUTIONS"

export function MpesaTillNote({ className = "" }: { className?: string }) {
  return (
    <p className={`text-[11px] leading-relaxed ${className}`}>
      You&apos;ll see <span className="font-semibold">{MPESA_TILL_NAME}</span> on the M-Pesa prompt
      <span className="mx-1 opacity-60">·</span>
      Till <span className="font-mono font-semibold">{MPESA_TILL_NUMBER}</span>
    </p>
  )
}
