"use client";

import Link from "next/link";
import {
    Bell,
    CalendarCheck,
    CheckCircle2,
    Circle,
} from "lucide-react";

import { AgendaActivity } from "@/domain/business/AgendaService";

type Props = {
    selectedDate: Date;
    agendaActivities: AgendaActivity[];
    loading: boolean;
    currentTimeMs: number;
    togglingTaskIds: number[];
    onToggleTask: (activity: AgendaActivity) => Promise<void>;
};

function formatTime(date: Date) {
    return new Intl.DateTimeFormat("en-CA", {
        hour: "numeric",
        minute: "2-digit",
    }).format(date);
}

export default function AgendaActivityPanel({
    selectedDate,
    agendaActivities,
    loading,
    currentTimeMs,
    togglingTaskIds,
    onToggleTask,
}: Props) {
    function isOverdue(activity: AgendaActivity) {
        return (
            activity.type === "TASK" &&
            activity.completed === false &&
            activity.date.getTime() < currentTimeMs
        );
    }

    function getSortedActivities() {
        return [...agendaActivities].sort((activityA, activityB) => {
            const rankA = getActivityRank(activityA);
            const rankB = getActivityRank(activityB);

            if (rankA !== rankB) {
                return rankA - rankB;
            }

            return activityA.date.getTime() - activityB.date.getTime();
        });
    }

    function getActivityRank(activity: AgendaActivity) {
        if (activity.type !== "TASK") {
            return 2;
        }

        if (activity.completed) {
            return 3;
        }

        return isOverdue(activity) ? 0 : 1;
    }

    function getTaskStyles(activity: AgendaActivity) {
        if (activity.completed) {
            return {
                card: "border-green-200 bg-green-50 text-green-700",
                icon: "bg-green-100 text-green-700",
                badge: "bg-green-100 text-green-700",
                title: "line-through text-green-800",
            };
        }

        if (isOverdue(activity)) {
            return {
                card: "border-red-200 bg-red-50",
                icon: "bg-red-100 text-red-700",
                badge: "bg-red-100 text-red-700",
                title: "text-slate-950",
            };
        }

        return {
            card: "border-slate-200 bg-slate-50",
            icon: "bg-slate-100 text-slate-600",
            badge: "bg-slate-200 text-slate-700",
            title: "text-slate-950",
        };
    }

    return (
        <section className="min-h-[320px] rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-4 flex items-center justify-between">
                <div>
                    <h2 className="text-lg font-semibold">Daily Activities</h2>
                    <p className="text-sm text-slate-500">
                        {selectedDate.toDateString()}
                    </p>
                </div>

                <span className="rounded-full bg-slate-100 px-3 py-1 text-sm">
                    {agendaActivities.length} Activities
                </span>
            </div>

            <div tabIndex={0} role="region" aria-label="Daily activities list" className="h-[280px] space-y-3 overflow-y-auto pr-2">
                {loading ? (
                    <p className="text-sm text-slate-500">
                        Loading activities...
                    </p>
                ) : null}

                {!loading &&
                    getSortedActivities().map((activity) => {
                        const isTask = activity.type === "TASK";
                        const Icon = isTask ? CalendarCheck : Bell;
                        const taskStyles = isTask
                            ? getTaskStyles(activity)
                            : null;
                        const toggling = togglingTaskIds.includes(activity.id);

                        const activityContent = (
                            <>
                                <div
                                    className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${
                                        isTask
                                            ? taskStyles?.icon
                                            : "bg-amber-50 text-amber-600"
                                    }`}
                                >
                                    <Icon size={20} />
                                </div>

                                <div>
                                    <h3
                                        className={`font-semibold ${
                                            isTask
                                                ? taskStyles?.title
                                                : "text-slate-950"
                                        }`}
                                    >
                                        {activity.title}
                                    </h3>
                                    {isTask && activity.notes ? (
                                        <p className="mt-1 text-sm text-slate-500">
                                            {activity.notes}
                                        </p>
                                    ) : null}
                                    <p className="mt-1 text-sm text-slate-500">
                                        {activity.leadName} - {formatTime(activity.date)}
                                    </p>
                                </div>
                            </>
                        );

                        return (
                            <article
                                key={`${activity.type}-${activity.id}`}
                                className={`flex w-full items-start justify-between gap-4 rounded-lg border p-4 text-left transition ${
                                    isTask
                                        ? taskStyles?.card
                                        : "border-slate-200 bg-white"
                                }`}
                            >
                                {activity.leadId ? (
                                    <Link
                                        href={`/leads/${activity.leadId}`}
                                        className="flex min-w-0 flex-1 gap-3 hover:opacity-80"
                                    >
                                        {activityContent}
                                    </Link>
                                ) : (
                                    <div className="flex min-w-0 flex-1 gap-3">
                                        {activityContent}
                                    </div>
                                )}

                                {isTask ? (
                                    <button
                                        type="button"
                                        disabled={toggling}
                                        onMouseDown={(event) => {
                                            event.preventDefault();
                                            event.stopPropagation();
                                        }}
                                        onClick={(event) => {
                                            event.preventDefault();
                                            event.stopPropagation();
                                            void onToggleTask(activity);
                                        }}
                                        className={`inline-flex min-w-28 shrink-0 items-center justify-center gap-1 rounded-full px-3 py-2 text-xs font-semibold disabled:cursor-wait disabled:opacity-60 ${taskStyles?.badge}`}
                                        aria-label={`${toggling ? "Saving..." : activity.completed ? "Completed" : isOverdue(activity) ? "Overdue" : "Uncompleted"}: ${activity.title}. Mark task as ${activity.completed ? "uncompleted" : "completed"}`}
                                    >
                                        {activity.completed ? (
                                            <CheckCircle2 size={14} />
                                        ) : (
                                            <Circle size={14} />
                                        )}
                                        {toggling
                                            ? "Saving..."
                                            : activity.completed
                                              ? "Completed"
                                              : isOverdue(activity)
                                                ? "Overdue"
                                                : "Uncompleted"}
                                    </button>
                                ) : (
                                    <span className="shrink-0 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700">
                                        Notification
                                    </span>
                                )}
                            </article>
                        );
                    })}

                {!loading && agendaActivities.length === 0 ? (
                    <p className="text-sm text-slate-500">
                        No activities for this date.
                    </p>
                ) : null}
            </div>
        </section>
    );
}
