import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/page-header";
import { QuotationsView } from "@/components/procurement/quotations-view";

export const metadata: Metadata = { title: "Quotations" };

export default async function QuotationsPage({ params }: { params: Promise<{ requestId: string }> }) {
  const { requestId } = await params;
  return (
    <>
      <PageHeader title="Quotations" description="Compare provider quotations and choose who to hire." />
      <QuotationsView requestId={requestId} />
    </>
  );
}
