import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";

const prisma = new PrismaClient();
const email = process.env.SEED_OWNER_EMAIL?.trim().toLowerCase();

try {
  if (!email) throw new Error("Set SEED_OWNER_EMAIL to an existing Auth.js user email before running the seed.");
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) throw new Error("No account matches SEED_OWNER_EMAIL. Sign in once through Google first, then run the seed.");

  let workspace = await prisma.workspace.findFirst({ where: { ownerId: user.id, name: "Personal" } });
  if (!workspace) {
    workspace = await prisma.workspace.create({ data: {
      name: "Personal",
      slug: `personal-${randomUUID().slice(0, 8)}`,
      ownerId: user.id,
      members: { create: { userId: user.id, role: "OWNER" } },
    } });
  } else {
    await prisma.workspaceMember.upsert({
      where: { workspaceId_userId: { workspaceId: workspace.id, userId: user.id } },
      update: { role: "OWNER" },
      create: { workspaceId: workspace.id, userId: user.id, role: "OWNER" },
    });
  }
  console.log(`Ready: ${workspace.name} workspace (${workspace.id}) for ${user.email}.`);
} finally {
  await prisma.$disconnect();
}
