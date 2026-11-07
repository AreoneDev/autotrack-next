"use client";

import { Button } from "@/components/ui/button";
import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import { usePathname } from "next/navigation";
import AccountMenu from "@/components/auth/AccountMenu";
import {
    BarChart3,
    CalendarDays,
    ChevronLeft,
    ChevronRight,
    LayoutDashboard,
    Users,
    ArchiveRestore,
} from "lucide-react";

const navItems = [
    { label: "Customer data", href: "/data", icon: ArchiveRestore },
    {
        label: "Dashboard",
        href: "/dashboard",
        icon: LayoutDashboard,
    },
    {
        label: "Leads",
        href: "/leads",
        icon: Users,
    },
    {
        label: "Agenda",
        href: "/agenda",
        icon: CalendarDays,
    },
    {
        label: "Analytics",
        href: "/analytics",
        icon: BarChart3,
    },
];

export default function Sidebar({ mobile = false, onNavigate }: { mobile?: boolean; onNavigate?: () => void }) {
    const [collapsed, setCollapsed] = useState(false);
    const pathname = usePathname();

    return (
        <aside
            className={`flex h-full min-h-0 shrink-0 flex-col border-r border-gray-200 bg-white shadow-sm transition-all duration-300 ${
                mobile ? "w-full" : collapsed ? "w-16 md:w-24" : "w-72"
            }`}
        >
            <div className="flex items-center justify-between px-2 py-6 md:px-6">
                <div className="flex items-center gap-3">
                    <div className={`h-12 w-12 overflow-hidden rounded-lg ${collapsed ? "hidden md:block" : ""}`}>
                        <Image
                            src="/ic_autotrack_blue.png"
                            alt="AutoTrack Logo"
                            width={48}
                            height={48}
                            className="rounded-lg opacity-75"
                            priority
                        />
                    </div>

                    {!collapsed ? (
                        <div>
                            <p className="text-xl font-bold text-gray-900">
                                AutoTrack
                            </p>
                            <p className="text-xs text-gray-500">
                                CRM
                            </p>
                        </div>
                    ) : null}
                </div>

                {!mobile && <Button variant="ghost"
                    onClick={() => setCollapsed(!collapsed)}
                    className="rounded-lg p-2 text-gray-500 hover:bg-gray-100 hover:text-blue-600"
                    aria-expanded={!collapsed}
                    aria-controls="primary-navigation"
                    aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
                >
                    {collapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
                </Button>}
            </div>

            <nav id={mobile ? "mobile-navigation" : "primary-navigation"} aria-label="Primary" className="mt-6 flex flex-col gap-2 px-2 md:px-4">
                {navItems.map((item) => {
                    const Icon = item.icon;

                    return (
                        <Link
                            key={item.href}
                            href={item.href}
                            aria-label={item.label}
                            aria-current={pathname === item.href || pathname.startsWith(`${item.href}/`) ? "page" : undefined}
                            prefetch={false}
                            onClick={onNavigate}
                            className="flex items-center gap-3 rounded-lg px-4 py-3 text-gray-700 hover:bg-blue-50 hover:text-blue-600"
                        >
                            <Icon size={20} aria-hidden="true" />

                            {!collapsed && (
                                <span className="font-medium">
                                    {item.label}
                                </span>
                            )}
                        </Link>
                    );
                })}
            </nav>

            <div className="mt-auto border-t border-gray-200 px-2 py-6 md:px-4">
                <AccountMenu collapsed={collapsed} mobile={mobile} onNavigate={onNavigate} />
            </div>
        </aside>
    );
}
