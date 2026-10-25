import type { Metadata } from "next";
import "./globals.css";
import AuthGate from "@/components/auth/AuthGate";

export const metadata: Metadata = {
    title: "AutoTrack",
    description: "CRM system for automotive sales professionals",
};

export default function RootLayout({
                                       children,
                                   }: Readonly<{
    children: React.ReactNode;
}>) {
    return (
        <html lang="en">
        <body className="h-screen overflow-hidden bg-gray-50 text-gray-900">
        <AuthGate>
            {children}
        </AuthGate>
        </body>
        </html>
    );
}
