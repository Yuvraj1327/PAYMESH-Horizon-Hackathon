import { ZodError } from "zod";
import { ApiError } from "@/lib/api/client";
import { HspUnavailableError, PaymentBlockedError } from "@/services/payments/types";
import { BackendNotConnectedError, NotFoundError } from "@/services/errors";

export interface PaymentErrorInfo { title: string; message: string; /** Safe to try the same action again by hand (never retried automatically). */ canRetry: boolean }

/** Turns any payment-flow failure into a message a person can act on. Raw payloads are never shown. */
export function describePaymentError(e: unknown): PaymentErrorInfo {
  if (e instanceof PaymentBlockedError) return { title: "Blocked by Payment Guardian", message: "The backend's spending policy does not allow this payment. See the checks above; nothing was authorized.", canRetry: false };
  if (e instanceof HspUnavailableError) return { title: "HSP checkout unavailable", message: e.message, canRetry: false };
  if (e instanceof BackendNotConnectedError) return { title: "Backend not connected", message: e.message, canRetry: false };
  if (e instanceof NotFoundError) return { title: "Not found", message: e.message, canRetry: false };
  if (e instanceof ZodError) return { title: "Unexpected backend response", message: "The backend returned data in a format this app does not recognize, so it was not used. Nothing was submitted from here.", canRetry: true };
  if (e instanceof ApiError) {
    switch (e.code) {
      case "api_not_configured": return { title: "Backend not configured", message: "NEXT_PUBLIC_API_BASE_URL is not set.", canRetry: false };
      case "unsafe_payment_url": return { title: "Unsafe payment link", message: e.message, canRetry: false };
      case "illegal_transition": return { title: "Payment has moved on", message: "This payment changed state. Refresh to see where it stands before doing anything else.", canRetry: true };
      case "hsp_order_uncertain": return { title: "Order status unknown", message: "A previous attempt to register the HSP order has an unknown outcome and will not be retried automatically, to avoid a double order. Let this payment expire and start a new one, or contact support.", canRetry: false };
      case "hsp_order_registered": return { title: "Cannot cancel", message: "An HSP order is already registered for this payment and cannot be withdrawn. It expires on its own.", canRetry: false };
      case "payment_not_submitted": return { title: "No payment yet", message: "HSP has not received a signed payment for this order yet. Complete the signature in the HSP checkout first.", canRetry: false };
      case "payment_not_found": return { title: "No payment found at HSP", message: "HSP has no payment record for this order yet.", canRetry: true };
      case "snapshot_integrity":
      case "conditions_changed": return { title: "Payment conditions changed", message: "The payment conditions changed after they were reviewed, so the payment was stopped. Create a new payment and review it again.", canRetry: false };
      case "hsp_record_mismatch": return { title: "Gateway record mismatch", message: "The HSP record does not match this order, so it was ignored. Contact support.", canRetry: false };
      case "no_hsp_order": return { title: "No HSP order yet", message: "Approve the payment first so the HSP order can be registered.", canRetry: false };
      default: break;
    }
    if (e.status === 401) return { title: "Sign-in required", message: "Your session is missing or expired. Sign in again to continue.", canRetry: false };
    if (e.status === 403) return { title: "Not allowed", message: "You do not have access to this payment.", canRetry: false };
    if (e.status === 404) return { title: "Not found", message: "This payment or request was not found.", canRetry: false };
    if (e.status === 429) return { title: "Too many requests", message: "Please wait a moment before trying again.", canRetry: true };
    if (e.status === 502 || e.status === 503 || e.status === 504) return { title: "HSP or network unavailable", message: "The payment network did not respond. Nothing was changed. Wait a moment, then check the status before trying again.", canRetry: true };
    return { title: "Request failed", message: e.message || "The backend rejected the request.", canRetry: e.status >= 500 };
  }
  if (e instanceof TypeError) return { title: "Network error", message: "Could not reach the backend. Check your connection. Nothing was submitted twice.", canRetry: true };
  return { title: "Something went wrong", message: "An unexpected error occurred. Nothing was changed.", canRetry: true };
}
