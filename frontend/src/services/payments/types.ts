import type {
  GuardianResult, MandateInfo, PaymentDetail, PaymentList, PaymentRecord, PaymentReview, PaymentStatusView,
  PolicyInput, Receipt, SigningData, SpendingPolicy,
} from "@/types/payment";

/** The payment backend contract. Implemented by the live FastAPI client and by the labelled demo engine. */
export interface PaymentsBackend {
  list(): Promise<PaymentList>;
  detail(id: string): Promise<PaymentDetail>;
  activeForRequest(requestId: string): Promise<PaymentRecord | null>;
  create(requestId: string, quotationId?: string): Promise<{ payment: PaymentRecord; created: boolean }>;
  validate(id: string): Promise<GuardianResult>;
  authorize(id: string): Promise<{ payment: PaymentRecord; review: PaymentReview }>;
  createMandate(id: string): Promise<MandateInfo>;
  signingData(id: string): Promise<SigningData>;
  status(id: string, refresh: boolean): Promise<PaymentStatusView>;
  verify(id: string): Promise<{ status: PaymentRecord["status"]; verified: boolean; receiptReference: string | null; txHash: string | null }>;
  cancel(id: string): Promise<PaymentRecord>;
  receipt(id: string): Promise<Receipt | null>;
  getPolicy(): Promise<SpendingPolicy | null>;
  savePolicy(input: PolicyInput): Promise<SpendingPolicy>;
}

/** Thrown when HSP checkout cannot be reached from this mode (demo mode never creates an HSP order). */
export class HspUnavailableError extends Error {
  constructor(message = "HSP checkout is not available in demo mode. No order was created and nothing was paid.") {
    super(message);
    this.name = "HspUnavailableError";
  }
}

/** The backend rejected the payment (Payment Guardian). Carries the structured rule failures. */
export class PaymentBlockedError extends Error {
  constructor(message: string, readonly failures: { rule: string; message: string }[]) {
    super(message);
    this.name = "PaymentBlockedError";
  }
}
