"use client";

import { type FormEvent, useEffect, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

import AgendaCalendar from "@/components/agenda/AgendaCalendar";
import AgendaActivityPanel from "@/components/agenda/AgendaActivityPanel";

import {
    AgendaActivity,
    AgendaService,
} from "@/domain/business/AgendaService";
import { ScoringService } from "@/domain/business/ScoringService";
import { PriorityManager } from "@/domain/business/PriorityManager";
import { Lead } from "@/domain/objects/Lead";
import { Task } from "@/domain/objects/Task";

import { LeadRepo } from "@/lib/persistence/real/supabase/LeadRepo";
import { NotificationRepo } from "@/lib/persistence/real/supabase/NotificationRepo";
import { TaskRepo } from "@/lib/persistence/real/supabase/TaskRepo";

function formatDateInput(date: Date): string {
    const normalizedDate = new Date(date);
    const year = normalizedDate.getFullYear();
    const month = String(normalizedDate.getMonth() + 1).padStart(2, "0");
    const day = String(normalizedDate.getDate()).padStart(2, "0");

    return `${year}-${month}-${day}`;
}

function createDateTime(dateValue: string, timeValue: string): Date {
    const [year, month, day] = dateValue.split("-").map(Number);
    const [hour, minute] = timeValue.split(":").map(Number);

    return new Date(year, month - 1, day, hour, minute);
}

function formatLeadDetails(lead: Lead): string {
    return [lead.phone, lead.leadEmail].filter(Boolean).join(" - ");
}

function getUnfinishedTaskCount(activities: AgendaActivity[]): number {
    return activities.filter(
        (activity) =>
            activity.type === "TASK" && activity.completed === false
    ).length;
}

function getPastUnfinishedTaskCounts(
    tasks: Task[],
    todayDateString: string
): Record<string, number> {
    return tasks.reduce<Record<string, number>>((counts, task) => {
        const taskDateString = formatDateInput(task.getDate());

        if (task.isCompleted() || taskDateString >= todayDateString) {
            return counts;
        }

        counts[taskDateString] = (counts[taskDateString] ?? 0) + 1;
        return counts;
    }, {});
}

function isSameTaskActivity(
    activityA: AgendaActivity,
    activityB: AgendaActivity
): boolean {
    return (
        activityA.type === "TASK" &&
        activityB.type === "TASK" &&
        activityA.leadId === activityB.leadId &&
        activityA.title === activityB.title &&
        formatDateInput(activityA.date) === formatDateInput(activityB.date)
    );
}

export default function AgendaPage() {
    const [selectedDate, setSelectedDate] = useState<Date>(new Date());
    const [agendaActivities, setAgendaActivities] = useState<AgendaActivity[]>([]);
    const [loading, setLoading] = useState(true);
    const [currentTimeMs, setCurrentTimeMs] = useState(0);
    const [todayDateString, setTodayDateString] = useState("");
    const [pastUnfinishedTaskCounts, setPastUnfinishedTaskCounts] = useState<
        Record<string, number>
    >({});
    const [togglingTaskIds, setTogglingTaskIds] = useState<number[]>([]);
    const [refreshKey, setRefreshKey] = useState(0);
    const [leadSearchText, setLeadSearchText] = useState("");
    const [leadSearchResults, setLeadSearchResults] = useState<Lead[]>([]);
    const [leadSearchLoading, setLeadSearchLoading] = useState(false);
    const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
    const [newTaskType, setNewTaskType] = useState("");
    const [newTaskNotes, setNewTaskNotes] = useState("");
    const [newTaskDate, setNewTaskDate] = useState(formatDateInput(new Date()));
    const [newTaskTime, setNewTaskTime] = useState("09:00");
    const [creatingTask, setCreatingTask] = useState(false);
    const [createError, setCreateError] = useState<string | null>(null);

    useEffect(() => {
        let active = true;

        async function loadAgenda() {
            setLoading(true);

            const leadRepo = new LeadRepo();
            const taskRepo = new TaskRepo();
            const notificationRepo = new NotificationRepo();
            const [leads, tasks, notifications] = await Promise.all([
                leadRepo.getAllLeads(),
                taskRepo.getAllTasks(),
                notificationRepo.getAllNotifications(),
            ]);

            const scoringService = new ScoringService();
            const priorityManager = new PriorityManager(scoringService);

            const agendaService = new AgendaService(
                scoringService,
                priorityManager
            );

            const systemTasks = agendaService.getMissingSystemAssignedTasksUpToDate(
                leads,
                tasks,
                new Date()
            );

            for (const task of systemTasks) {
                await taskRepo.insertTask(task);
            }

            if (active) {
                const persistedTasks =
                    systemTasks.length > 0
                        ? await taskRepo.getAllTasks()
                        : tasks;
                const allTasks = agendaService.getUniqueTasks(persistedTasks);
                const now = new Date();

                setAgendaActivities(
                    agendaService.getDailyActivities(
                        allTasks,
                        notifications,
                        selectedDate
                    )
                );
                setCurrentTimeMs(now.getTime());
                setTodayDateString(formatDateInput(now));
                setPastUnfinishedTaskCounts(
                    getPastUnfinishedTaskCounts(allTasks, formatDateInput(now))
                );
                setLoading(false);
            }
        }

        loadAgenda();

        return () => {
            active = false;
        };
    }, [selectedDate, refreshKey]);

    useEffect(() => {
        const query = leadSearchText.trim();

        if (query.length < 2 || selectedLead) {
            return;
        }

        let active = true;

        const timer = window.setTimeout(async () => {
            setLeadSearchLoading(true);

            const leadRepo = new LeadRepo();
            const results = await leadRepo.searchLeads(query, 6);

            if (active) {
                setLeadSearchResults(results);
                setLeadSearchLoading(false);
            }
        }, 250);

        return () => {
            active = false;
            window.clearTimeout(timer);
        };
    }, [leadSearchText, selectedLead]);

    function changeDate(days: number) {
        const nextDate = new Date(selectedDate);
        nextDate.setDate(nextDate.getDate() + days);
        selectAgendaDate(nextDate);
    }

    function selectAgendaDate(date: Date) {
        setSelectedDate(date);
        setNewTaskDate(formatDateInput(date));
    }

    function handleLeadSearchChange(value: string) {
        setLeadSearchText(value);
        setSelectedLead(null);
        setCreateError(null);

        if (value.trim().length < 2) {
            setLeadSearchResults([]);
            setLeadSearchLoading(false);
        }
    }

    function handleSelectLead(lead: Lead) {
        setSelectedLead(lead);
        setLeadSearchText(lead.getLeadName());
        setLeadSearchResults([]);
        setLeadSearchLoading(false);
        setCreateError(null);
    }

    async function handleCreateTask(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();

        if (!selectedLead) {
            setCreateError("Select a lead before creating the task.");
            return;
        }

        if (!newTaskType.trim()) {
            setCreateError("Select a task type before creating the task.");
            return;
        }

        setCreatingTask(true);
        setCreateError(null);

        const taskType = newTaskType.trim();
        const taskRepo = new TaskRepo();
        const task = new Task(
            selectedLead,
            taskType,
            createDateTime(newTaskDate, newTaskTime),
            -1,
            taskType,
            newTaskNotes.trim()
        );
        const error = await taskRepo.insertTask(task);

        if (error) {
            setCreateError(error);
            setCreatingTask(false);
            return;
        }

        setCreatingTask(false);
        setNewTaskType("");
        setNewTaskNotes("");
        setLeadSearchText("");
        setSelectedLead(null);
        setLeadSearchResults([]);
        setRefreshKey((currentKey) => currentKey + 1);
    }

    async function handleToggleTask(activity: AgendaActivity) {
        if (activity.type !== "TASK") {
            return;
        }

        if (togglingTaskIds.includes(activity.id)) {
            return;
        }

        setTogglingTaskIds((currentIds) => [...currentIds, activity.id]);

        if (activity.id < 0) {
            setCreateError("This task has not been saved yet. Refresh Agenda and try again.");
            setTogglingTaskIds((currentIds) =>
                currentIds.filter((taskId) => taskId !== activity.id)
            );
            return;
        }

        const nextCompleted = !activity.completed;
        const taskRepo = new TaskRepo();
        const error = await taskRepo.updateTaskCompletion(
            activity.id,
            nextCompleted
        );

        if (error) {
            setCreateError(error);
            setTogglingTaskIds((currentIds) =>
                currentIds.filter((taskId) => taskId !== activity.id)
            );
            return;
        }

        setAgendaActivities((currentActivities) =>
            currentActivities.map((currentActivity) =>
                isSameTaskActivity(currentActivity, activity)
                    ? {
                          ...currentActivity,
                          completed: nextCompleted,
                      }
                    : currentActivity
            )
        );

        setPastUnfinishedTaskCounts((currentCounts) => {
            const taskDateString = formatDateInput(activity.date);

            if (!todayDateString || taskDateString >= todayDateString) {
                return currentCounts;
            }

            const currentCount = currentCounts[taskDateString] ?? 0;
            const nextCount = activity.completed
                ? currentCount + 1
                : Math.max(0, currentCount - 1);

            if (nextCount === 0) {
                const nextCounts = { ...currentCounts };
                delete nextCounts[taskDateString];
                return nextCounts;
            }

            return {
                ...currentCounts,
                [taskDateString]: nextCount,
            };
        });

        setTogglingTaskIds((currentIds) =>
            currentIds.filter((taskId) => taskId !== activity.id)
        );
    }

    return (
        <div className="flex flex-col gap-6 pb-6">
            <div className="flex items-center justify-between">
                <div className="flex gap-2">
                    <button
                        aria-label="Previous day"
                        onClick={() => changeDate(-1)}
                        className="rounded-lg border border-slate-200 p-2 hover:bg-slate-100"
                    >
                        <ChevronLeft size={18} />
                    </button>

                    <input
                        type="date"
                        aria-label="Agenda date"
                        value={formatDateInput(selectedDate)}
                        onChange={(e) =>
                            selectAgendaDate(createDateTime(e.target.value, "00:00"))
                        }
                        className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
                    />

                    <button
                        aria-label="Next day"
                        onClick={() => changeDate(1)}
                        className="rounded-lg border border-slate-200 p-2 hover:bg-slate-100"
                    >
                        <ChevronRight size={18} />
                    </button>

                    <button
                        onClick={() => selectAgendaDate(new Date())}
                        className="rounded-lg bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700"
                    >
                       Back to Today
                    </button>

                    <button
                        onClick={() =>
                            setRefreshKey((currentKey) => currentKey + 1)
                        }
                        className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-700 hover:bg-slate-100"
                    >
                        Refresh
                    </button>
                </div>
            </div>

            <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                <div className="mb-4">
                    <h2 className="text-lg font-semibold">Create Task</h2>
                    <p className="text-sm text-slate-500">
                        Add a scheduled task to Agenda by selecting the related lead first.
                    </p>
                </div>

                <form
                    onSubmit={handleCreateTask}
                    className="space-y-4"
                >
                    <div className="grid gap-4 lg:grid-cols-[1.3fr_1fr_0.75fr_0.65fr_auto]">
                        <div className="relative">
                            <label htmlFor="agenda-lead" className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                                Lead
                            </label>
                            <input
                                id="agenda-lead"
                                type="search"
                                value={leadSearchText}
                                onChange={(e) =>
                                    handleLeadSearchChange(e.target.value)
                                }
                                placeholder="Search by name, phone, or email"
                                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-500"
                            />

                            {leadSearchText.trim().length >= 2 &&
                            !selectedLead &&
                            (leadSearchLoading || leadSearchResults.length > 0) ? (
                                <div className="absolute z-10 mt-2 max-h-56 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg">
                                    {leadSearchLoading ? (
                                        <div className="px-3 py-2 text-sm text-slate-500">
                                            Searching leads...
                                        </div>
                                    ) : null}

                                    {!leadSearchLoading
                                        ? leadSearchResults.map((lead) => (
                                              <button
                                                  key={lead.leadID}
                                                  type="button"
                                                  onClick={() =>
                                                      handleSelectLead(lead)
                                                  }
                                                  className="block w-full px-3 py-2 text-left text-sm hover:bg-slate-50"
                                              >
                                                  <span className="font-medium text-slate-950">
                                                      {lead.getLeadName()}
                                                  </span>
                                                  <span className="mt-0.5 block text-xs text-slate-500">
                                                      {formatLeadDetails(lead) ||
                                                          `Lead #${lead.leadID}`}
                                                  </span>
                                              </button>
                                          ))
                                        : null}
                                </div>
                            ) : null}
                        </div>

                        <div>
                            <label htmlFor="agenda-task-type" className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                                Task Type
                            </label>
                            <select
                                id="agenda-task-type"
                                value={newTaskType}
                                onChange={(e) => {
                                    setNewTaskType(e.target.value);
                                    setCreateError(null);
                                }}
                                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-500"
                            >
                                <option value="" disabled>
                                    Select task type
                                </option>
                                {Task.TASK_TYPE_OPTIONS.map((taskType) => (
                                    <option key={taskType} value={taskType}>
                                        {taskType}
                                    </option>
                                ))}
                            </select>
                        </div>

                        <div>
                            <label htmlFor="agenda-task-date" className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                                Date
                            </label>
                            <input
                                id="agenda-task-date"
                                type="date"
                                value={newTaskDate}
                                onChange={(e) => setNewTaskDate(e.target.value)}
                                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-500"
                            />
                        </div>

                        <div>
                            <label htmlFor="agenda-task-time" className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                                Time
                            </label>
                            <input
                                id="agenda-task-time"
                                type="time"
                                value={newTaskTime}
                                onChange={(e) => setNewTaskTime(e.target.value)}
                                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-500"
                            />
                        </div>

                        <div className="flex items-end">
                            <button
                                type="submit"
                                disabled={creatingTask}
                                className="w-full rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300"
                            >
                                {creatingTask ? "Creating..." : "Add Task"}
                            </button>
                        </div>
                    </div>

                    <div>
                        <label htmlFor="agenda-task-notes" className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                            Short Description / Notes
                        </label>
                        <input
                            id="agenda-task-notes"
                            type="text"
                            value={newTaskNotes}
                            onChange={(e) => {
                                setNewTaskNotes(e.target.value);
                                setCreateError(null);
                            }}
                            placeholder="Customer request or follow-up notes"
                            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-500"
                        />
                    </div>
                </form>

                {selectedLead ? (
                    <p className="mt-3 text-sm text-slate-600">
                        Selected lead:{" "}
                        <span className="font-semibold text-slate-950">
                            {selectedLead.getLeadName()}
                        </span>
                    </p>
                ) : null}

                {createError ? (
                    <p className="mt-3 text-sm font-medium text-red-600">
                        {createError}
                    </p>
                ) : null}
            </section>

            <AgendaCalendar
                selectedDate={selectedDate}
                onSelectDate={selectAgendaDate}
                unfinishedTaskCount={
                    loading ? 0 : getUnfinishedTaskCount(agendaActivities)
                }
                pastUnfinishedTaskCounts={pastUnfinishedTaskCounts}
                todayDateString={todayDateString}
            />

            <AgendaActivityPanel
                selectedDate={selectedDate}
                agendaActivities={loading ? [] : agendaActivities}
                loading={loading}
                currentTimeMs={currentTimeMs}
                togglingTaskIds={togglingTaskIds}
                onToggleTask={handleToggleTask}
            />
        </div>
    );
}
