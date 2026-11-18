
import type { Metadata } from "next";
import { TooltipProvider } from "@/components/ui/tooltip";
import "./globals.css";

export const metadata: Metadata = {
  title: "NexSpace — Your collaborative workspace",
  description:
    "Think, create, and collaborate in real time with NexSpace.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="antialiased" suppressHydrationWarning>
        <TooltipProvider delay={150}>
          {children}
        </TooltipProvider>
      </body>
    </html>
  );
}
