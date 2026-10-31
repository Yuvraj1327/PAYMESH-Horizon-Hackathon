import { isDemoMode } from "@/lib/env";
import { demoBackend } from "@/services/demo/payments";
import { liveBackend } from "@/services/payments/live";
import type { PaymentsBackend } from "@/services/payments/types";

export { HspUnavailableError, PaymentBlockedError } from "@/services/payments/types";
export { rotateIdempotencyKey } from "@/services/payments/live";

/**
 * Payment services. Live mode talks to the real FastAPI payment endpoints (see services/payments/live.ts);
 * demo mode uses a clearly labelled local engine that can never create an HSP order or settle anything.
 */
export const payments: PaymentsBackend = isDemoMode ? demoBackend : liveBackend;
