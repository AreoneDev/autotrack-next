"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import {
    BarChart3,
    CalendarDays,
    ChevronLeft,
    ChevronRight,
    LayoutDashboard,
    Users,
} from "lucide-react";

const navItems = [
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

export default function Sidebar() {
    const [collapsed, setCollapsed] = useState(false);

    return (
        <aside
            className={`flex h-screen shrink-0 flex-col border-r border-gray-200 bg-white shadow-sm transition-all duration-300 ${
                collapsed ? "w-24" : "w-72"
            }`}
        >
            <div className="flex items-center justify-between px-6 py-6">
                <div className="flex items-center gap-3">
                    <div className="h-12 w-12 overflow-hidden rounded-lg">
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
                            <h1 className="text-xl font-bold text-gray-900">
                                AutoTrack
                            </h1>
                            <p className="text-xs text-gray-500">
                                CRM
                            </p>
                        </div>
                    ) : null}
                </div>

                <button
                    onClick={() => setCollapsed(!collapsed)}
                    className="rounded-lg p-2 text-gray-500 hover:bg-gray-100 hover:text-blue-600"
                    aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
                >
                    {collapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
                </button>
            </div>

            <nav className="mt-6 flex flex-col gap-2 px-4">
                {navItems.map((item) => {
                    const Icon = item.icon;

                    return (
                        <Link
                            key={item.href}
                            href={item.href}
                            prefetch={false}
                            className="flex items-center gap-3 rounded-lg px-4 py-3 text-gray-700 hover:bg-blue-50 hover:text-blue-600"
                        >
                            <Icon size={20} />

                            {!collapsed && (
                                <span className="font-medium">
                                    {item.label}
                                </span>
                            )}
                        </Link>
                    );
                })}
            </nav>

            <div className="mt-auto border-t border-gray-200 px-6 py-6">
                <div className="flex items-center gap-3">
                    <div className="flex h-12 w-12 items-center justify-center rounded-full bg-blue-600 font-bold text-white">
                        PW
                    </div>

                    {!collapsed && (
                        <div>
                            <p className="font-semibold text-gray-900">
                                AutoTrack account
                            </p>
                            <p className="text-sm text-gray-500">
                                Sales Professional
                            </p>
                        </div>
                    )}
                </div>
            </div>
        </aside>
    );
}
