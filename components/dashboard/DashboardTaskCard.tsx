"use client";

import { Button } from "@/components/ui/button";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { MouseEvent, useState } from "react";
import {
    CalendarCheck,
    CheckCircle2,
    Circle,
    Loader2,
    MessageSquareReply,
    Phone,
    UserRound,
} from "lucide-react";

import {
    DashboardTaskItem,
    DashboardTaskStatus,
} from "@/domain/business/DashboardService";
import { TaskRepo } from "@/lib/persistence/real/supabase/TaskRepo";

function getTaskTone(status: DashboardTaskStatus) {
    if (status === "overdue") {
        return {
            card: "border-red-200 bg-red-50 hover:border-red-300 hover:bg-red-100/60",
            icon: "bg-red-100 text-red-700",
            title: "text-red-950",
            meta: "text-red-700",
            badge: "bg-red-100 text-red-700",
            button: "border-red-200 bg-white text-red-700 hover:bg-red-100",
            label: "Overdue",
        };
    }

    if (status === "completed") {
        return {
            card: "border-green-200 bg-green-50 hover:border-green-300 hover:bg-green-100/60",
            icon: "bg-green-100 text-green-700",
            title: "text-green-950 line-through",
            meta: "text-green-700 line-through",
            badge: "bg-green-100 text-green-700",
            button: "border-green-200 bg-white text-green-700 hover:bg-green-100",
            label: "Completed",
        };
    }

    return {
        card: "border-slate-200 bg-slate-50 hover:border-blue-300 hover:bg-blue-50",
        icon: "bg-slate-100 text-slate-600",
        title: "text-slate-950",
        meta: "text-slate-500",
        badge: "bg-white text-slate-600",
        button: "border-slate-200 bg-white text-slate-700 hover:bg-slate-100",
        label: "Scheduled",
    };
}

function renderTaskIcon(type: string) {
    if (type === "Follow-up call") {
        return <Phone size={20} />;
    }

    if (type === "Message") {
        return <MessageSquareReply size={20} />;
    }

    if (type === "Appointment") {
        return <CalendarCheck size={20} />;
    }

    return <UserRound size={20} />;
}

type DashboardTaskCardProps = {
    task: DashboardTaskItem;
};

export default function DashboardTaskCard({ task }: DashboardTaskCardProps) {
    const router = useRouter();
    const [updating, setUpdating] = useState(false);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    const [optimisticCompleted, setOptimisticCompleted] = useState<
        boolean | null
    >(null);

    const completed = optimisticCompleted ?? task.status === "completed";
    const displayStatus: DashboardTaskStatus = completed
        ? "completed"
        : task.status === "completed"
          ? "scheduled"
          : task.status;
    const tone = getTaskTone(displayStatus);

    async function toggleTaskCompletion(event: MouseEvent<HTMLButtonElement>) {
        event.preventDefault();
        event.stopPropagation();

        if (updating) {
            return;
        }

        const nextCompleted = !completed;
        setUpdating(true);
        setErrorMessage(null);

        try {
            const taskRepo = new TaskRepo();
            const error = await taskRepo.updateTaskCompletion(
                task.id,
                nextCompleted
            );

            if (error) {
                setErrorMessage(error);
                return;
            }

            setOptimisticCompleted(nextCompleted);
            router.refresh();
        } catch (error) {
            setErrorMessage(
                error instanceof Error ? error.message : "Failed to update task."
            );
        } finally {
            setUpdating(false);
        }
    }

    const cardContent = (
        <>
            <div
                className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${tone.icon}`}
            >
                {renderTaskIcon(task.type)}
            </div>

            <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                    <h3 className={`font-semibold ${tone.title}`}>
                        {task.title}
                    </h3>
                    <span
                        className={`rounded-full px-2.5 py-1 text-xs font-semibold ${tone.badge}`}
                    >
                        {tone.label}
                    </span>
                </div>
                <p className={`mt-1 text-sm ${tone.meta}`}>
                    {task.time} - {task.type} - score {task.score}
                </p>
                <p className={`mt-1 text-xs ${tone.meta}`}>
                    {task.leadName}
                </p>
                {errorMessage ? (
                    <p role="alert" className="mt-2 text-xs font-medium text-red-600">
                        {errorMessage}
                    </p>
                ) : null}
            </div>
        </>
    );

    return (
        <article
            className={`flex items-start gap-3 rounded-lg border p-4 transition ${tone.card}`}
        >
            {task.leadId ? (
                <Link
                    href={`/leads/${task.leadId}`}
                    className="flex min-w-0 flex-1 items-start gap-4"
                >
                    {cardContent}
                </Link>
            ) : (
                <div className="flex min-w-0 flex-1 items-start gap-4">
                    {cardContent}
                </div>
            )}

            <Button variant="ghost"
                type="button"
                onClick={toggleTaskCompletion}
                onMouseDown={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                }}
                disabled={updating}
                className={`inline-flex shrink-0 items-center gap-2 rounded-lg border px-3 py-2 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-60 ${tone.button}`}
                aria-label={`${completed ? "Completed" : "Complete"}: ${task.title}. Mark as ${completed ? "uncompleted" : "completed"}`}
            >
                {updating ? (
                    <Loader2 className="animate-spin" size={15} />
                ) : completed ? (
                    <CheckCircle2 size={15} />
                ) : (
                    <Circle size={15} />
                )}
                {completed ? "Completed" : "Complete"}
            </Button>
        </article>
    );
}
