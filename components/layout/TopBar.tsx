"use client";

import Link from "next/link";
import AccountMenu from "@/components/auth/AccountMenu";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import {
    Bell,
    CalendarDays,
    CalendarCheck,
    CheckCircle2,
    Clock,
    Mail,
    MessageSquareReply,
    Phone,
    PlusCircle,
    RefreshCcw,
} from "lucide-react";

import {
    RecentActivityItem,
    RecentActivityService,
    RecentActivityType,
} from "@/domain/business/RecentActivityService";
import { LeadRepo } from "@/lib/persistence/real/supabase/LeadRepo";
import { NotificationRepo } from "@/lib/persistence/real/supabase/NotificationRepo";

const READ_NOTIFICATION_STORAGE_KEY = "autotrack-read-topbar-notifications";

function getActivityIcon(type: RecentActivityType) {
    switch (type) {
        case "lead_added":
            return PlusCircle;
        case "lead_updated":
            return RefreshCcw;
        case "message":
            return MessageSquareReply;
        case "email":
            return Mail;
        case "call":
            return Phone;
        case "task_completed":
            return CheckCircle2;
        case "appointment":
            return CalendarCheck;
        default:
            return Bell;
    }
}

export default function TopBar() {
    const pageInfoMap: Record<string, { title: string; description: string }> = {
        "/dashboard": {
            title: "Dashboard",
            description: "Overview of today's priorities and follow-up actions.",
        },
        "/leads": {
            title: "Leads",
            description: "Manage customer leads, stages, and follow-up status.",
        },
        "/agenda": {
            title: "Agenda",
            description: "Daily follow-up activities generated from leads and tasks.",
        },
        "/analytics": {
            title: "Analytics",
            description: "Track sales performance, lead trends, and activity insights.",
        },
    };

    const pathname = usePathname();

    const pageInfo =
        pathname.startsWith("/leads/") && pathname !== "/leads"
            ? {
                  title: "Lead Details",
                  description: "View customer information, sales status, vehicle interest, and notes.",
              }
            : pageInfoMap[pathname] ?? {
                  title: "AutoTrack CRM",
                  description: "Scientific sales follow-up system",
              };

    const [currentTime, setCurrentTime] = useState<Date | null>(null);
    const [notificationsOpen, setNotificationsOpen] = useState(false);
    const [topbarNotifications, setTopbarNotifications] = useState<
        RecentActivityItem[]
    >([]);
    const [readNotificationIds, setReadNotificationIds] = useState<string[]>([]);
    const [notificationsLoading, setNotificationsLoading] = useState(true);

    const date = currentTime
        ? currentTime.toLocaleDateString("en-CA", {
              year: "numeric",
              month: "short",
              day: "numeric",
          })
        : "--";

    const time = currentTime
        ? currentTime.toLocaleTimeString("en-CA", {
              hour: "2-digit",
              minute: "2-digit",
          })
        : "--";

    useEffect(() => {
        const initialTimer = window.setTimeout(() => {
            setCurrentTime(new Date());
        }, 0);

        const timer = setInterval(() => {
            setCurrentTime(new Date());
        }, 1000);

        return () => {
            window.clearTimeout(initialTimer);
            clearInterval(timer);
        };
    }, []);

    useEffect(() => {
        const storageTimer = window.setTimeout(() => {
            const savedReadNotificationIds = window.localStorage.getItem(
                READ_NOTIFICATION_STORAGE_KEY
            );

            if (!savedReadNotificationIds) {
                return;
            }

            try {
                const parsedReadNotificationIds = JSON.parse(
                    savedReadNotificationIds
                );

                if (Array.isArray(parsedReadNotificationIds)) {
                    setReadNotificationIds(
                        parsedReadNotificationIds.filter(
                            (value): value is string =>
                                typeof value === "string"
                        )
                    );
                }
            } catch {
                window.localStorage.removeItem(READ_NOTIFICATION_STORAGE_KEY);
            }
        }, 0);

        return () => window.clearTimeout(storageTimer);
    }, []);

    useEffect(() => {
        let active = true;

        async function loadTopbarNotifications() {
            try {
                const leadRepo = new LeadRepo();
                const notificationRepo = new NotificationRepo();

                const [leads, notifications] = await Promise.all([
                    leadRepo.getAllLeads(),
                    notificationRepo.getAllNotifications(),
                ]);

                if (!active) {
                    return;
                }

                const recentActivityService = new RecentActivityService();
                setTopbarNotifications(
                    recentActivityService.getTopbarNotifications({
                        leads,
                        notifications,
                        referenceDate: new Date(),
                        limit: 5,
                    })
                );
            } finally {
                if (active) {
                    setNotificationsLoading(false);
                }
            }
        }

        loadTopbarNotifications();
        const refreshTimer = setInterval(loadTopbarNotifications, 60000);

        return () => {
            active = false;
            clearInterval(refreshTimer);
        };
    }, [pathname]);

    function markNotificationRead(activityId: string) {
        setReadNotificationIds((currentReadIds) => {
            if (currentReadIds.includes(activityId)) {
                return currentReadIds;
            }

            const nextReadIds = [...currentReadIds, activityId];

            if (typeof window !== "undefined") {
                window.localStorage.setItem(
                    READ_NOTIFICATION_STORAGE_KEY,
                    JSON.stringify(nextReadIds)
                );
            }

            return nextReadIds;
        });
    }

    const unreadCount = topbarNotifications.filter(
        (activity) =>
            activity.unread && !readNotificationIds.includes(activity.id)
    ).length;

    return (
        <header className="flex h-20 items-center justify-between border-b bg-white px-8">

            <div>
                <h1 className="text-2xl font-bold text-slate-950">
                    {pageInfo.title}
                </h1>
                <p className="text-sm text-slate-500">
                    {pageInfo.description}
                </p>
            </div>

            <div className="flex items-center gap-8">

                <div className="relative">
                    <button
                        type="button"
                        onClick={() =>
                            setNotificationsOpen((current) => !current)
                        }
                        className="relative rounded-full p-2 text-gray-500 hover:bg-blue-50 hover:text-blue-600"
                        aria-label="Open notifications"
                    >
                        <Bell size={20} />
                        {unreadCount > 0 ? (
                            <span className="absolute -right-0.5 -top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold text-white">
                                {unreadCount}
                            </span>
                        ) : null}
                    </button>

                    {notificationsOpen ? (
                        <div className="absolute right-0 top-12 z-50 w-96 rounded-lg border border-slate-200 bg-white shadow-xl">
                            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
                                <div>
                                    <p className="font-semibold text-slate-950">
                                        Notifications
                                    </p>
                                    <p className="text-xs text-slate-500">
                                        Incoming lead messages, emails, calls, and appointments
                                    </p>
                                </div>
                                {unreadCount > 0 ? (
                                    <span className="rounded-full bg-red-50 px-2.5 py-1 text-xs font-semibold text-red-700">
                                        {unreadCount} unread
                                    </span>
                                ) : null}
                            </div>

                            <div className="max-h-96 overflow-y-auto p-2">
                                {notificationsLoading ? (
                                    <p className="px-3 py-4 text-sm text-slate-500">
                                        Loading notifications...
                                    </p>
                                ) : null}

                                {!notificationsLoading &&
                                topbarNotifications.length === 0 ? (
                                    <p className="px-3 py-4 text-sm text-slate-500">
                                        No notifications.
                                    </p>
                                ) : null}

                                {topbarNotifications.map((activity) => {
                                    const Icon = getActivityIcon(activity.type);
                                    const isUnread =
                                        activity.unread &&
                                        !readNotificationIds.includes(
                                            activity.id
                                        );

                                    return (
                                        <Link
                                            key={activity.id}
                                            href={
                                                activity.leadId
                                                    ? `/leads/${activity.leadId}`
                                                    : "/dashboard"
                                            }
                                            onClick={() => {
                                                markNotificationRead(
                                                    activity.id
                                                );
                                                setNotificationsOpen(false);
                                            }}
                                            className="flex gap-3 rounded-lg px-3 py-3 transition hover:bg-blue-50"
                                        >
                                            <div
                                                className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
                                                    isUnread
                                                        ? "bg-red-50 text-red-600"
                                                        : "bg-slate-100 text-slate-600"
                                                }`}
                                            >
                                                <Icon size={17} />
                                            </div>
                                            <div className="min-w-0">
                                                <div className="flex items-center gap-2">
                                                    <p className="truncate text-sm font-semibold text-slate-950">
                                                        {activity.label}
                                                    </p>
                                                    {isUnread ? (
                                                        <span className="h-2 w-2 shrink-0 rounded-full bg-red-600" />
                                                    ) : null}
                                                </div>
                                                <p className="mt-1 line-clamp-2 text-sm text-slate-600">
                                                    {activity.detail}
                                                </p>
                                                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-400">
                                                    {activity.leadName ? (
                                                        <span className="font-medium text-slate-500">
                                                            {activity.leadName}
                                                        </span>
                                                    ) : null}
                                                    <span>{activity.time}</span>
                                                </div>
                                            </div>
                                        </Link>
                                    );
                                })}
                            </div>
                        </div>
                    ) : null}
                </div>

                <div className="flex items-center gap-2 text-sm text-gray-600">
                    <CalendarDays size={16}/>
                    {date}
                </div>

                <div className="flex items-center gap-2 text-sm text-gray-600">
                    <Clock size={16}/>
                    {time}
                </div>

                <AccountMenu />

            </div>

        </header>
    );
}
