import type { Metadata } from "next";
import Link from "next/link";
import { Plus } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { ProcurementDashboard } from "@/components/procurement/procurement-dashboard";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "Procurement" };

export default function ProcurementPage() {
  return (
    <>
      <PageHeader
        title="Procurement"
        description="Create requests, collect quotations from provider agents and choose who to hire."
        actions={<Button asChild><Link href="/procurement/new"><Plus /> New request</Link></Button>}
      />
      <ProcurementDashboard />
    </>
  );
}
