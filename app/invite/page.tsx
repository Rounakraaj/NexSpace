import { redirect } from "next/navigation";
import { connection } from "next/server";
import { getCurrentUser } from "@/lib/permissions";
import { AcceptInvitation } from "./accept-invitation";

export const instant = false;

export default async function InvitationPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  // Invitation state and the current session are request-specific. Do not run
  // NextAuth's session lookup while Next.js is building the static shell.
  await connection();
  const { token } = await searchParams;
  if (!token || token.length > 200) redirect("/login");
  const user = await getCurrentUser();
  if (!user) redirect(`/login?callbackUrl=${encodeURIComponent(`/invite?token=${encodeURIComponent(token)}`)}`);
  return <AcceptInvitation token={token} email={user.email} />;
}
