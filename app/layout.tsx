import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "DSA War Room",
  description: "No excuses. No roadmaps. No daydreaming. Just daily execution.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="h-full">
      <body className="min-h-full antialiased">{children}</body>
    </html>
  );
}