"use client";

import { useState } from "react";
import { Loader2, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/procurement/field";
import { AddressText } from "@/components/common/address-text";
import { DemoNotice } from "@/components/common/data-source-notice";
import { useToast } from "@/components/ui/toaster";
import { useAuth } from "@/components/auth/auth-provider";
import { useUpdateProfile } from "@/hooks/use-developer";
import { useWallet } from "@/hooks/use-wallet";
import { sameAddress } from "@/lib/web3/address";
import { describePaymentError } from "@/lib/payment-errors";
import { env } from "@/lib/env";

export function ProfileCard() {
  const { status, profile, profileError } = useAuth();
  const w = useWallet();
  const update = useUpdateProfile();
  const toast = useToast();
  const [name, setName] = useState<string | null>(null);

  if (status === "preview") return <Card id="profile"><CardHeader><div className="flex items-center gap-2"><User className="size-5 text-brand" aria-hidden="true" /><CardTitle>Profile</CardTitle></div></CardHeader><CardContent><DemoNotice>Demo mode: there is no account. Connect the backend and sign in to manage your profile.</DemoNotice></CardContent></Card>;
  if (!profile) return <Card id="profile"><CardHeader><CardTitle>Profile</CardTitle></CardHeader><CardContent><p className="text-sm text-muted-foreground">{profileError ? "Could not load your profile from the backend." : "Loading your profile…"}</p></CardContent></Card>;

  const value = name ?? profile.fullName ?? "";
  const dirty = value.trim() !== (profile.fullName ?? "");
  const canLink = w.status === "connected" && !!w.address && !sameAddress(w.address, profile.walletAddress);
  return (
    <Card id="profile">
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2"><User className="size-5 text-brand" aria-hidden="true" /><CardTitle>Profile</CardTitle><Badge variant={profile.role === "admin" ? "brand" : "outline"} data-testid="role-badge">{profile.role === "admin" ? "Administrator" : "User"}</Badge></div>
        <CardDescription>Your role is set by the backend and cannot be changed here.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <dl className="text-sm"><dt className="text-xs text-muted-foreground">Email</dt><dd className="font-medium" data-testid="profile-email">{profile.email ?? "—"}</dd></dl>
        <form className="flex flex-wrap items-end gap-3" onSubmit={(e) => { e.preventDefault(); update.mutate({ fullName: value.trim() }, { onSuccess: () => { setName(null); toast.push({ title: "Profile saved", variant: "success" }); } }); }}>
          <div className="min-w-56 flex-1"><Field id="full-name" label="Display name"><Input id="full-name" maxLength={200} value={value} onChange={(e) => setName(e.target.value)} /></Field></div>
          <Button type="submit" variant="outline" disabled={!dirty || update.isPending}>{update.isPending ? <Loader2 className="animate-spin" /> : null} Save</Button>
        </form>
        <div>
          <p className="text-xs text-muted-foreground">Payer wallet on file</p>
          <p className="mt-0.5 text-sm">{profile.walletAddress ? <AddressText value={profile.walletAddress} chainId={env.chainId} /> : <span className="text-muted-foreground">None. The backend checks the paying wallet against this when verifying settlement.</span>}</p>
          {canLink && <Button className="mt-2" size="sm" variant="outline" onClick={() => update.mutate({ walletAddress: w.address! }, { onSuccess: () => toast.push({ title: "Payer wallet saved", variant: "success" }) })} disabled={update.isPending} data-testid="link-wallet">Use connected wallet as my payer wallet</Button>}
        </div>
        {update.error && <p role="alert" className="text-sm text-danger">{describePaymentError(update.error).message}</p>}
      </CardContent>
    </Card>
  );
}
