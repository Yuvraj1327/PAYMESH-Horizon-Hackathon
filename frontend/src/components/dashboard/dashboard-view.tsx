"use client";

import { ErrorState } from "@/components/states";
import { useDashboard } from "@/hooks/use-dashboard";
import { useCurrentUser } from "@/hooks/use-current-user";
import { ActiveRequests } from "@/components/dashboard/active-requests";
import { DashboardSkeleton } from "@/components/dashboard/dashboard-skeleton";
import { DemoBanner } from "@/components/dashboard/demo-banner";
import { FeaturedAgents } from "@/components/dashboard/featured-agents";
import { KpiCards } from "@/components/dashboard/kpi-cards";
import { PaymentOverview } from "@/components/dashboard/payment-overview";
import { QuickActions } from "@/components/dashboard/quick-actions";
import { RecentActivity } from "@/components/dashboard/recent-activity";
import { WelcomeSection } from "@/components/dashboard/welcome-section";

export function DashboardView() {
  const { data, isPending, isError, error, refetch } = useDashboard();
  const user = useCurrentUser();

  if (isPending) return <DashboardSkeleton />;
  if (isError) return <ErrorState title="Couldn’t load your dashboard" message={error.message} onRetry={() => void refetch()} />;

  return (
    <>
      {data.source === "demo" && <DemoBanner />}
      <WelcomeSection name={user.name} source={data.source} />
      <KpiCards kpis={data.kpis} />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="flex flex-col gap-6 lg:col-span-2">
          <ActiveRequests requests={data.activeRequests} />
          <RecentActivity items={data.activity} />
        </div>
        <div className="flex flex-col gap-6">
          <PaymentOverview payments={data.payments} />
          <QuickActions />
        </div>
      </div>
      <FeaturedAgents agents={data.featuredAgents} />
    </>
  );
}
