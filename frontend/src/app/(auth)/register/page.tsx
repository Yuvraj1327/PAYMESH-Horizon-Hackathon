import type { Metadata } from "next";
import { AuthCard } from "@/components/auth/auth-form";

export const metadata: Metadata = { title: "Create account" };

export default function RegisterPage() {
  return <AuthCard mode="register" />;
}
