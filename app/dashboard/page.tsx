import Link from "next/link";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireServerClient } from "@/lib/supabase/server";
import {
    AlertTriangle,
    Bell,
    CalendarCheck,
    CheckCircle2,
    Clock,
    Mail,
    MessageSquareReply,
    MessageSquareWarning,
    Phone,
    PlusCircle,
    RefreshCcw,
} from "lucide-react";

import { AgendaService } from "@/domain/business/AgendaService";
import { DashboardService } from "@/domain/business/DashboardService";
import { PriorityManager } from "@/domain/business/PriorityManager";
import { ScoringService } from "@/domain/business/ScoringService";
import { Lead } from "@/domain/objects/Lead";
import { LeadTradeInVehicleRepo } from "@/lib/persistence/real/supabase/LeadTradeInVehicleRepo";
import { LeadVehicleInterestRepo } from "@/lib/persistence/real/supabase/LeadVehicleInterestRepo";
import { LeadRepo } from "@/lib/persistence/real/supabase/LeadRepo";
import { NotificationRepo } from "@/lib/persistence/real/supabase/NotificationRepo";
import { TaskRepo } from "@/lib/persistence/real/supabase/TaskRepo";
import { VehicleRepo } from "@/lib/persistence/real/supabase/VehicleRepo";
import { DashboardRecentActivityType } from "@/domain/business/DashboardService";
import DashboardTaskCard from "@/components/dashboard/DashboardTaskCard";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

async function hydrateLeadVehicleData(leads: Lead[], client: SupabaseClient): Promise<Lead[]> {
    const vehicleRepository = new VehicleRepo(client);
    const vehicleInterestRepository = new LeadVehicleInterestRepo(
        vehicleRepository, client
    );
    const tradeInVehicleRepository = new LeadTradeInVehicleRepo(
        vehicleRepository, client
    );

    return Promise.all(
        leads.map(async (lead) => {
            const [vehicleInterest, tradeInVehicle] = await Promise.all([
                vehicleInterestRepository.getVehicleInterestByLeadId(
                    lead.leadID
                ),
                tradeInVehicleRepository.getTradeInVehicleByLeadId(
                    lead.leadID
                ),
            ]);

            lead.vehicleInterest = vehicleInterest;
            lead.tradeInVehicle = tradeInVehicle;

            return lead;
        })
    );
}

function getPriorityTone(tone: string) {
    if (tone === "red") {
        return "border-red-200 bg-red-50 text-red-700";
    }

    if (tone === "amber") {
        return "border-amber-200 bg-amber-50 text-amber-700";
    }

    return "border-blue-200 bg-blue-50 text-blue-700";
}

function getRecentActivityIcon(type: DashboardRecentActivityType) {
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

export default async function DashboardPage() {
    const client = await requireServerClient();
    const targetDate = new Date();
    const leadRepo = new LeadRepo(client);
    const taskRepo = new TaskRepo(client);
    const notificationRepo = new NotificationRepo(client);
    const scoringService = new ScoringService();
    const priorityManager = new PriorityManager(scoringService);
    const agendaService = new AgendaService(scoringService, priorityManager);
    const dashboardService = new DashboardService(
        scoringService,
        agendaService
    );

    const [leads, tasks, notifications] = await Promise.all([
        leadRepo.getAllLeads(),
        taskRepo.getAllTasks(),
        notificationRepo.getAllNotifications(),
    ]);
    const hydratedLeads = await hydrateLeadVehicleData(leads, client);

    const allTasks = agendaService.getUniqueTasks(tasks);

    const dashboardData = dashboardService.getDashboardData(
        hydratedLeads,
        allTasks,
        notifications,
        targetDate
    );

    const summaryCards = [
        {
            title: "Today's Tasks",
            value: dashboardData.metrics.todayTaskCount.toString(),
            description: "Scheduled work due today",
            icon: CalendarCheck,
        },
        {
            title: "High Priority Leads",
            value: dashboardData.metrics.highPriorityLeadCount.toString(),
            description: "Need immediate attention today",
            icon: AlertTriangle,
        },
        {
            title: "Unreplied Messages",
            value: dashboardData.metrics.unrepliedMessageCount.toString(),
            description: "Customer replies waiting for response",
            icon: MessageSquareWarning,
        },
        {
            title: "Overdue Follow-ups",
            value: dashboardData.metrics.overdueTaskCount.toString(),
            description: "Missed or past-due scheduled actions",
            icon: Clock,
        },
    ];

    return (
        <main className="bg-slate-50 text-slate-900">
            <section className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
                {summaryCards.map((card) => {
                    const Icon = card.icon;

                    return (
                        <div
                            key={card.title}
                            className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm"
                        >
                            <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
                                <Icon size={24} />
                            </div>

                            <p className="text-sm font-medium text-slate-500">
                                {card.title}
                            </p>
                            <h2 className="mt-2 text-3xl font-bold text-slate-950">
                                {card.value}
                            </h2>
                            <p className="mt-2 text-sm text-slate-500">
                                {card.description}
                            </p>
                        </div>
                    );
                })}
            </section>

            <section className="mt-8 grid gap-6 xl:grid-cols-[1.25fr_1fr]">
                <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
                    <div className="mb-6 flex items-start justify-between gap-4">
                        <div>
                            <h2 className="text-xl font-bold text-slate-950">
                                Priority Action Center
                            </h2>
                            <p className="mt-1 text-sm text-slate-500">
                                Recommended customers to contact first based on lead score, overdue follow-ups, replies, and important activity.
                            </p>
                        </div>

                        <Bell className="shrink-0 text-blue-600" size={24} />
                    </div>

                    <div className="max-h-[430px] space-y-4 overflow-y-auto pr-2">
                        {dashboardData.priorityActions.map((action) => (
                            <Link
                                key={action.leadId}
                                href={`/leads/${action.leadId}`}
                                className={`block rounded-lg border p-5 transition hover:border-blue-300 hover:bg-blue-50/60 ${getPriorityTone(action.tone)}`}
                            >
                                <div className="flex items-start justify-between gap-4">
                                    <div>
                                        <div className="flex flex-wrap items-center gap-2">
                                            <h3 className="font-semibold text-slate-950">
                                                {action.leadName}
                                            </h3>
                                            <span className="rounded-full bg-white/80 px-2.5 py-1 text-xs font-semibold">
                                                Score {action.score}
                                            </span>
                                        </div>

                                        <p className="mt-2 text-sm font-semibold">
                                            {action.stage} - {action.status}
                                        </p>
                                        <p className="mt-2 text-sm text-slate-700">
                                            {action.vehicleInterest}
                                        </p>
                                        <p className="mt-2 text-sm text-slate-700">
                                            Next follow-up: {action.nextFollowUpDate}
                                        </p>
                                        <span className="mt-3 inline-flex rounded-full bg-white/80 px-2.5 py-1 text-xs font-semibold">
                                            {action.reasonLabel}
                                        </span>
                                        <p className="mt-2 text-sm text-slate-700">
                                            {action.reason}
                                        </p>
                                    </div>

                                    <span className="rounded-full bg-white/80 px-3 py-1 text-xs font-semibold">
                                        {action.priorityLevel}
                                    </span>
                                </div>
                            </Link>
                        ))}

                        {dashboardData.priorityActions.length === 0 ? (
                            <p className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">
                                Great work! There are currently no high-priority leads requiring immediate attention.
                            </p>
                        ) : null}
                    </div>
                </div>

                <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
                    <div className="mb-6">
                        <h2 className="text-xl font-bold text-slate-950">
                            Today&apos;s Tasks
                        </h2>
                        <p className="mt-1 text-sm text-slate-500">
                            Planned work for today only. Overdue tasks stay on top, scheduled tasks stay neutral, and completed work moves to the bottom.
                        </p>
                    </div>

                    <div className="max-h-[430px] space-y-4 overflow-y-auto pr-2">
                        {dashboardData.todayTasks.map((task) => (
                            <DashboardTaskCard
                                key={`${task.id}-${task.status}`}
                                task={task}
                            />
                        ))}

                        {dashboardData.todayTasks.length === 0 ? (
                            <p className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">
                                No tasks scheduled for today.
                            </p>
                        ) : null}
                    </div>
                </div>
            </section>

            <section className="mt-8 rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
                <div className="mb-5">
                    <h2 className="text-xl font-bold text-slate-950">
                        Recent Activity
                    </h2>
                    <p className="mt-1 text-sm text-slate-500">
                        Recent system updates from leads, messages, tasks, appointments, and reminders.
                    </p>
                </div>

                <div className="max-h-[270px] space-y-3 overflow-y-auto pr-2">
                    {dashboardData.recentActivities.map((activity) => {
                        const Icon = getRecentActivityIcon(activity.type);

                        return (
                            <Link
                                key={activity.id}
                                href={
                                    activity.leadId
                                        ? `/leads/${activity.leadId}`
                                        : "/dashboard"
                                }
                                className="flex gap-4 rounded-lg bg-slate-50 px-4 py-3 text-sm text-slate-600 transition hover:bg-blue-50"
                            >
                                <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white text-blue-600">
                                    <Icon size={17} />
                                </div>

                                <div>
                                    <p className="font-semibold text-slate-950">
                                        {activity.label}
                                    </p>
                                    <p className="mt-1">
                                        {activity.detail}
                                    </p>
                                    {activity.leadName ? (
                                        <p className="mt-1 text-xs font-medium text-slate-500">
                                            {activity.leadName}
                                        </p>
                                    ) : null}
                                    <p className="mt-1 text-xs text-slate-400">
                                        {activity.time}
                                    </p>
                                </div>
                            </Link>
                        );
                    })}

                    {dashboardData.recentActivities.length === 0 ? (
                        <p className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">
                            No recent activity found.
                        </p>
                    ) : null}
                </div>
            </section>
        </main>
    );
}
