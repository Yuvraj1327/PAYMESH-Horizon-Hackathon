import type { Metadata } from "next";
import { Suspense } from "react";
import { PageHeader } from "@/components/layout/page-header";
import { NewRequestView } from "@/components/procurement/new-request-view";
import { LoadingState } from "@/components/states";

export const metadata: Metadata = { title: "New procurement request" };

export default function NewProcurementPage() {
  return (
    <>
      <PageHeader title="New procurement request" description="Describe the task in plain language or fill in the form. We’ll find matching agents and collect quotations." />
      <Suspense fallback={<LoadingState label="Loading…" />}><NewRequestView /></Suspense>
    </>
  );
}
