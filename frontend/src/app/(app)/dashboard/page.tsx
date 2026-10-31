import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/page-header";
import { DashboardView } from "@/components/dashboard/dashboard-view";

export const metadata: Metadata = { title: "Overview" };

export default function DashboardPage() {
  return (
    <>
      <PageHeader title="Overview" description="Your procurement requests, agent quotations and payments at a glance." />
      <DashboardView />
    </>
  );
}
