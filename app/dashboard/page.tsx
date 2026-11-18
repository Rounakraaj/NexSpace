import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { Dashboard } from "./workspace-dashboard";

// Session-bound data cannot be prerendered with Cache Components enabled.
export const instant = false;

export default async function DashboardPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const workspaces = await prisma.workspace.findMany({
    where: { OR: [{ ownerId: user.id }, { members: { some: { userId: user.id } } }] },
    orderBy: { updatedAt: "desc" },
    select: { id: true, name: true, description: true, ownerId: true, members: { where: { userId: user.id }, select: { role: true }, take: 1 } },
  });
  return <Dashboard initialWorkspaces={workspaces.map(({ ownerId, members, ...workspace }) => ({ ...workspace, role: ownerId === user.id ? "OWNER" : members[0]?.role ?? "VIEWER" }))} user={{ name: user.name, email: user.email }} />;
}
