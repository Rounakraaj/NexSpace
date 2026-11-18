import type { NextAuthOptions } from "next-auth";
import { PrismaAdapter } from "@auth/prisma-adapter";
import GoogleProvider from "next-auth/providers/google";
import CredentialsProvider from "next-auth/providers/credentials";
import { env } from "@/lib/env";
import { verifyPassword } from "@/lib/password";
import { prisma } from "@/lib/prisma";
import { consumeCredentialsLoginLimit, getRequestIp } from "@/lib/rate-limit";

const providers: NextAuthOptions["providers"] = [];
const missingUserPasswordHash = `scrypt:${"0".repeat(32)}:${"0".repeat(128)}`;
if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) {
  providers.push(
    GoogleProvider({
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
    }),
  );
}
providers.push(CredentialsProvider({
  name: "Email and password",
  credentials: { email: { label: "Email", type: "email" }, password: { label: "Password", type: "password" } },
  async authorize(credentials, req) {
    const email = credentials?.email?.trim().toLowerCase();
    const password = credentials?.password;
    if (!email || email.length > 254 || !password || password.length > 128) return null;
    const ip = getRequestIp(req.headers);
    const rate = await consumeCredentialsLoginLimit(ip, email);
    if (!rate.allowed) return null;
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user?.passwordHash) {
      await verifyPassword(password, missingUserPasswordHash);
      return null;
    }
    if (!await verifyPassword(password, user.passwordHash)) return null;
    return { id: user.id, name: user.name, email: user.email, image: user.image };
  },
}));

export const authOptions: NextAuthOptions = {
  adapter: PrismaAdapter(prisma),
  secret: env.NEXTAUTH_SECRET ?? env.AUTH_SECRET,
  // Credentials provider requires JWT sessions; Prisma continues to persist OAuth accounts.
  session: { strategy: "jwt" },
  providers,
  pages: { signIn: "/login" },
  callbacks: {
    async jwt({ token, user }) {
      if (user) token.sub = user.id;
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.sub ?? "";
      }
      return session;
    },
  },
  events: {
    async createUser({ user }) {
      if (!user.id) return;
      const existing = await prisma.workspace.findFirst({ where: { ownerId: user.id }, select: { id: true } });
      if (existing) return;
      const label = user.name?.trim().split(/\s+/)[0] || "My";
      await prisma.$transaction(async (tx) => {
        const workspace = await tx.workspace.create({
          data: { name: `${label}'s workspace`, slug: `workspace-${user.id!.slice(0, 8)}`, ownerId: user.id! },
        });
        await tx.workspaceMember.create({ data: { workspaceId: workspace.id, userId: user.id!, role: "OWNER" } });
        await tx.document.create({
          data: {
            workspaceId: workspace.id,
            createdById: user.id!,
            title: "Welcome to NexSpace",
            slug: "welcome-to-nexspace",
            content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Your workspace is ready. Start writing your first idea here." }] }] },
          },
        });
        await tx.activityLog.create({ data: { workspaceId: workspace.id, actorId: user.id!, action: "workspace.created" } });
      });
    },
  },
  debug: process.env.NODE_ENV === "development",
};
