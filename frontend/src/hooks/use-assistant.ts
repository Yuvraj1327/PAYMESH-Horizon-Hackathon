"use client";

import { useMutation } from "@tanstack/react-query";
import { sendAssistantMessage, type AssistantRequest } from "@/services/assistant";

export function useAssistantMessage() {
  return useMutation({ mutationFn: (req: AssistantRequest) => sendAssistantMessage(req) });
}
