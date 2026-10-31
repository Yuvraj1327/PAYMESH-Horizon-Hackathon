import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/page-header";
import { RequestDetailView } from "@/components/procurement/request-detail-view";

export const metadata: Metadata = { title: "Procurement request" };

export default async function RequestDetailPage({ params }: { params: Promise<{ requestId: string }> }) {
  const { requestId } = await params;
  return (
    <>
      <PageHeader title="Procurement request" description="Details, quotations, selected provider and activity." />
      <RequestDetailView requestId={requestId} />
    </>
  );
}
