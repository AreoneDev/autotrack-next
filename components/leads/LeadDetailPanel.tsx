"use client";

import { useMemo, useState } from "react";
import { localDateInput } from "@/lib/date";
import type { ComponentType } from "react";
import { useRouter } from "next/navigation";
import {
    Bell,
    CalendarClock,
    Car,
    Check,
    CheckCircle2,
    Circle,
    Mail,
    MapPin,
    MessageSquare,
    Pencil,
    Phone,
    PlusCircle,
    Save,
    Trash2,
    UserRound,
    X,
} from "lucide-react";

import { ScoringService } from "@/domain/business/ScoringService";
import {
    VehicleSelection,
    VehicleSelectionService,
} from "@/domain/business/VehicleSelectionService";
import { Lead } from "@/domain/objects/Lead";
import { Notification } from "@/domain/objects/Notification";
import { Task } from "@/domain/objects/Task";
import { Vehicle } from "@/domain/objects/Vehicle";
import { LeadRepo } from "@/lib/persistence/real/supabase/LeadRepo";
import { NotificationRepo } from "@/lib/persistence/real/supabase/NotificationRepo";
import { TaskRepo } from "@/lib/persistence/real/supabase/TaskRepo";
import VehicleInterestSelector from "@/components/leads/VehicleInterestSelector";

export interface LeadDetailTaskViewModel {
    taskID: number;
    title: string;
    taskType: string;
    notes: string;
    date: string;
    time: string;
    completed: boolean;
    leadID: number | null;
}

export interface LeadDetailNotificationViewModel {
    notificationID: number;
    title: string;
    date: string;
    leadID: number | null;
}

export interface LeadDetailViewModel {
    leadID: number;
    firstName: string;
    lastName: string;
    phone: string;
    leadEmail: string;
    leadDivision: string;
    leadAddress: string;
    leadCity: string;
    leadProvince: string;
    leadCountry: string;
    leadPostalCode: string;
    budget: number;
    vehicleInterestId: number | null;
    vehicleInterest: string;
    vehicleInterestYear: string;
    vehicleInterestMake: string;
    vehicleInterestModel: string;
    vehicleInterestTrim: string;
    tradeInVehicleId: number | null;
    tradeInVehicle: string;
    tradeInVehicleYear: string;
    tradeInVehicleMake: string;
    tradeInVehicleModel: string;
    tradeInVehicleTrim: string;
    stage: string;
    followUpDate: string;
    score: number;
    priorityLevel: string;
    priorityReasons: string[];
    notes: string;
    createdAt: string;
    lastInteractionDate: string;
    lastInteractionBy: string;
    status: boolean;
}

interface LeadDetailPanelProps {
    lead: LeadDetailViewModel;
    tasks: LeadDetailTaskViewModel[];
    notifications: LeadDetailNotificationViewModel[];
}

const stageOptions = [
    "NEW",
    "CONTACTED",
    "VISITED",
    "TEST_DRIVE",
    "NEGOTIATION",
    "CLOSED",
];

const currencyFormatter = new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency: "CAD",
    maximumFractionDigits: 0,
});

function formatDisplayDate(value: string) {
    if (!value) {
        return "N/A";
    }

    return new Intl.DateTimeFormat("en-CA", {
        month: "short",
        day: "numeric",
        year: "numeric",
    }).format(new Date(`${value}T00:00:00`));
}

function toDate(value: string) {
    return value ? new Date(`${value}T00:00:00`) : new Date();
}

function toTaskDateTime(date: string, time: string) {
    const dateValue = date || localDateInput();
    const timeValue = time || "09:00";

    return new Date(`${dateValue}T${timeValue}:00`);
}

function formatTaskDateTime(task: LeadDetailTaskViewModel) {
    if (!task.date) {
        return "N/A";
    }

    return new Intl.DateTimeFormat("en-CA", {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
    }).format(toTaskDateTime(task.date, task.time));
}

function toTaskDateInputValue(date: Date) {
    const normalizedDate = new Date(date);
    const year = normalizedDate.getFullYear();
    const month = String(normalizedDate.getMonth() + 1).padStart(2, "0");
    const day = String(normalizedDate.getDate()).padStart(2, "0");

    return `${year}-${month}-${day}`;
}

function toTaskTimeInputValue(date: Date) {
    const hours = String(date.getHours()).padStart(2, "0");
    const minutes = String(date.getMinutes()).padStart(2, "0");

    return `${hours}:${minutes}`;
}

function toTaskViewModel(task: Task): LeadDetailTaskViewModel {
    return {
        taskID: task.getEventID(),
        title: task.getTitle(),
        taskType: task.getTaskType(),
        notes: task.getNotes(),
        date: toTaskDateInputValue(task.getDate()),
        time: toTaskTimeInputValue(task.getDate()),
        completed: task.isCompleted(),
        leadID: task.getLead()?.leadID ?? null,
    };
}

function getVehicleSelectionFromLead(
    lead: LeadDetailViewModel
): VehicleSelection {
    return {
        year: lead.vehicleInterestYear,
        make: lead.vehicleInterestMake,
        model: lead.vehicleInterestModel,
        trim: lead.vehicleInterestTrim,
    };
}

function getTradeInSelectionFromLead(
    lead: LeadDetailViewModel
): VehicleSelection {
    return {
        year: lead.tradeInVehicleYear,
        make: lead.tradeInVehicleMake,
        model: lead.tradeInVehicleModel,
        trim: lead.tradeInVehicleTrim,
    };
}

function getVehicleDescription(selection: VehicleSelection): string {
    return [
        selection.year,
        selection.make,
        selection.model,
        selection.trim ? `(${selection.trim})` : "",
    ]
        .filter(Boolean)
        .join(" ")
        .trim();
}

function getEmptyVehicleSelection(): VehicleSelection {
    return {
        year: "",
        make: "",
        model: "",
        trim: "",
    };
}

function sortTasksByNewest(
    tasks: LeadDetailTaskViewModel[]
): LeadDetailTaskViewModel[] {
    return [...tasks].sort(
        (taskA, taskB) =>
            toTaskDateTime(taskB.date, taskB.time).getTime() -
            toTaskDateTime(taskA.date, taskA.time).getTime()
    );
}

function createVehicleReference(vehicleId: number | null) {
    if (!vehicleId) {
        return null;
    }

    const vehicle = new Vehicle();
    vehicle.vehicleID = vehicleId;
    return vehicle;
}

function createLeadFromViewModel(viewModel: LeadDetailViewModel) {
    return new Lead({
        leadID: viewModel.leadID,
        firstName: viewModel.firstName,
        lastName: viewModel.lastName,
        phone: viewModel.phone,
        leadEmail: viewModel.leadEmail,
        leadDivision: viewModel.leadDivision,
        leadAddress: viewModel.leadAddress,
        leadCity: viewModel.leadCity,
        leadProvince: viewModel.leadProvince,
        leadCountry: viewModel.leadCountry,
        leadPostalCode: viewModel.leadPostalCode,
        budget: viewModel.budget,
        vehicleInterest: createVehicleReference(viewModel.vehicleInterestId),
        tradeInVehicle: createVehicleReference(viewModel.tradeInVehicleId),
        stage: viewModel.stage,
        followUpDate: toDate(viewModel.followUpDate),
        score: viewModel.score,
        notes: viewModel.notes,
        createdAt: toDate(viewModel.createdAt),
        lastInteractionDate: viewModel.lastInteractionDate
            ? toDate(viewModel.lastInteractionDate)
            : null,
        lastInteractionBy: viewModel.lastInteractionBy,
        status: viewModel.status,
    });
}

function createTaskFromViewModel(task: LeadDetailTaskViewModel) {
    const leadReference =
        task.leadID === null
            ? null
            : new Lead({
                  leadID: task.leadID,
                  firstName: `Lead ${task.leadID}`,
              });

    const nextTask = new Task(
        leadReference,
        task.title,
        toTaskDateTime(task.date, task.time),
        task.taskID,
        task.taskType,
        task.notes
    );

    nextTask.setCompleted(task.completed);
    return nextTask;
}

function Field({
    label,
    value,
    icon: Icon,
}: {
    label: string;
    value: string;
    icon: ComponentType<{ size?: number; className?: string }>;
}) {
    return (
        <div className="rounded-lg border border-slate-200 bg-white p-4">
            <div className="mb-2 flex items-center gap-2 text-sm font-medium text-slate-500">
                <Icon size={16} className="text-blue-600" />
                {label}
            </div>
            <p className="text-sm font-semibold text-slate-950">
                {value || "N/A"}
            </p>
        </div>
    );
}

export default function LeadDetailPanel({
    lead,
    tasks,
    notifications,
}: LeadDetailPanelProps) {
    const router = useRouter();
    const [currentLead, setCurrentLead] = useState(lead);
    const [draftLead, setDraftLead] = useState(lead);
    const [draftVehicleInterest, setDraftVehicleInterest] =
        useState<VehicleSelection>(() => getVehicleSelectionFromLead(lead));
    const [draftTradeInVehicle, setDraftTradeInVehicle] =
        useState<VehicleSelection>(() => getTradeInSelectionFromLead(lead));
    const [leadTasks, setLeadTasks] = useState(() =>
        sortTasksByNewest(tasks)
    );
    const [leadNotifications, setLeadNotifications] = useState(notifications);
    const [isEditing, setIsEditing] = useState(false);
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
    const [saving, setSaving] = useState(false);
    const [deleting, setDeleting] = useState(false);
    const [creatingTask, setCreatingTask] = useState(false);
    const [updatingTaskId, setUpdatingTaskId] = useState<number | null>(null);
    const [loggingCommunication, setLoggingCommunication] = useState<
        "call" | "email" | "message" | null
    >(null);
    const [editingTaskId, setEditingTaskId] = useState<number | null>(null);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    const [newTaskType, setNewTaskType] = useState("");
    const [newTaskNotes, setNewTaskNotes] = useState("");
    const [newTaskDate, setNewTaskDate] = useState(
        localDateInput()
    );
    const [newTaskTime, setNewTaskTime] = useState("09:00");
    const [draftTaskTitle, setDraftTaskTitle] = useState("");
    const [draftTaskNotes, setDraftTaskNotes] = useState("");
    const [draftTaskDate, setDraftTaskDate] = useState("");
    const [draftTaskTime, setDraftTaskTime] = useState("");
    const scoringService = useMemo(() => new ScoringService(), []);
    const vehicleSelectionService = useMemo(
        () => new VehicleSelectionService(),
        []
    );

    async function reloadLeadTasks(taskRepository = new TaskRepo()) {
        const refreshedTasks = await taskRepository.getTasksByLeadId(
            currentLead.leadID
        );

        setLeadTasks(sortTasksByNewest(refreshedTasks.map(toTaskViewModel)));
    }

    const fullName = useMemo(
        () => `${currentLead.firstName} ${currentLead.lastName}`.trim(),
        [currentLead.firstName, currentLead.lastName]
    );

    const draftFullName = `${draftLead.firstName} ${draftLead.lastName}`.trim();

    function updateDraft<Value extends keyof LeadDetailViewModel>(
        field: Value,
        value: LeadDetailViewModel[Value]
    ) {
        setDraftLead((previous) => ({
            ...previous,
            [field]: value,
        }));
    }

    async function handleSave() {
        setErrorMessage(null);
        setSaving(true);

        try {
            const leadRepository = new LeadRepo();
            const normalizedDraftLead = {
                ...draftLead,
                status:
                    draftLead.stage.toUpperCase() === "CLOSED"
                        ? false
                        : draftLead.status,
            };
            const leadToSave = createLeadFromViewModel(normalizedDraftLead);
            const priority = scoringService.calculatePriority(leadToSave);
            leadToSave.updateScore(priority.score);

            const error = await leadRepository.updateLead(leadToSave);

            if (error) {
                setErrorMessage(error);
                return;
            }

            const vehicleError =
                await vehicleSelectionService.saveLeadVehicleInterest(
                    currentLead.leadID,
                    draftVehicleInterest
                );

            if (vehicleError) {
                setErrorMessage(vehicleError);
                return;
            }

            const tradeInError =
                await vehicleSelectionService.saveLeadTradeInVehicle(
                    currentLead.leadID,
                    draftTradeInVehicle
                );

            if (tradeInError) {
                setErrorMessage(tradeInError);
                return;
            }

            const vehicleDescription =
                getVehicleDescription(draftVehicleInterest);
            const tradeInDescription =
                getVehicleDescription(draftTradeInVehicle);

            const nextLead = {
                ...normalizedDraftLead,
                score: priority.score,
                priorityLevel: priority.level,
                priorityReasons: priority.reasons,
                vehicleInterest: vehicleDescription,
                vehicleInterestYear: draftVehicleInterest.year,
                vehicleInterestMake: draftVehicleInterest.make,
                vehicleInterestModel: draftVehicleInterest.model,
                vehicleInterestTrim: draftVehicleInterest.trim,
                tradeInVehicle: tradeInDescription,
                tradeInVehicleYear: draftTradeInVehicle.year,
                tradeInVehicleMake: draftTradeInVehicle.make,
                tradeInVehicleModel: draftTradeInVehicle.model,
                tradeInVehicleTrim: draftTradeInVehicle.trim,
            };

            setCurrentLead(nextLead);
            setDraftLead(nextLead);
            setIsEditing(false);
            router.refresh();
        } catch (error) {
            setErrorMessage(
                error instanceof Error ? error.message : "Failed to save lead."
            );
        } finally {
            setSaving(false);
        }
    }

    function handleCancel() {
        setDraftLead(currentLead);
        setDraftVehicleInterest(getVehicleSelectionFromLead(currentLead));
        setDraftTradeInVehicle(getTradeInSelectionFromLead(currentLead));
        setIsEditing(false);
        setErrorMessage(null);
    }

    async function handleDelete() {
        setErrorMessage(null);
        setDeleting(true);

        try {
            const leadRepository = new LeadRepo();
            const error = await leadRepository.deleteLead(currentLead.leadID);

            if (error) {
                setErrorMessage(error);
                return;
            }

            router.push("/leads");
            router.refresh();
        } catch (error) {
            setErrorMessage(
                error instanceof Error ? error.message : "Failed to delete lead."
            );
        } finally {
            setDeleting(false);
            setShowDeleteConfirm(false);
        }
    }

    async function toggleTaskCompletion(taskID: number) {
        const targetTask = leadTasks.find((task) => task.taskID === taskID);

        if (!targetTask) {
            return;
        }

        const nextTask = {
            ...targetTask,
            completed: !targetTask.completed,
        };

        setUpdatingTaskId(taskID);
        setErrorMessage(null);

        try {
            const taskRepository = new TaskRepo();
            const error = await taskRepository.updateTask(
                createTaskFromViewModel(nextTask)
            );

            if (error) {
                setErrorMessage(error);
                return;
            }

            await reloadLeadTasks(taskRepository);
            router.refresh();
        } catch (error) {
            setErrorMessage(
                error instanceof Error ? error.message : "Failed to update task."
            );
        } finally {
            setUpdatingTaskId(null);
        }
    }

    async function handleCreateTask() {
        const taskType = newTaskType.trim();
        const notes = newTaskNotes.trim();

        if (!taskType) {
            setErrorMessage("Task type is required.");
            return;
        }

        if (!newTaskDate) {
            setErrorMessage("Task date is required.");
            return;
        }

        if (!newTaskTime) {
            setErrorMessage("Task time is required.");
            return;
        }

        setCreatingTask(true);
        setErrorMessage(null);

        const taskViewModel: LeadDetailTaskViewModel = {
            taskID: -1,
            title: taskType,
            taskType,
            notes,
            date: newTaskDate,
            time: newTaskTime,
            completed: false,
            leadID: currentLead.leadID,
        };

        const task = createTaskFromViewModel(taskViewModel);

        try {
            const taskRepository = new TaskRepo();
            const error = await taskRepository.insertTask(task);

            if (error) {
                setErrorMessage(error);
                return;
            }

            await reloadLeadTasks(taskRepository);
            setNewTaskType("");
            setNewTaskNotes("");
            setNewTaskDate(localDateInput());
            setNewTaskTime("09:00");
            router.refresh();
        } catch (error) {
            setErrorMessage(
                error instanceof Error ? error.message : "Failed to create task."
            );
        } finally {
            setCreatingTask(false);
        }
    }

    async function handleLogCommunication(
        communicationType: "call" | "email" | "message"
    ) {
        const leadName = fullName || "this lead";
        const communicationTitleMap = {
            call: `You called ${leadName}`,
            email: `You sent an email to ${leadName}`,
            message: `You sent a message to ${leadName}`,
        };

        setLoggingCommunication(communicationType);
        setErrorMessage(null);

        try {
            const notificationRepository = new NotificationRepo();
            const notification = new Notification(
                new Lead({
                    leadID: currentLead.leadID,
                    firstName: currentLead.firstName || "Lead",
                    lastName: currentLead.lastName,
                }),
                communicationTitleMap[communicationType],
                new Date()
            );
            const error =
                await notificationRepository.insertNotification(notification);

            if (error) {
                setErrorMessage(error);
                return;
            }

            const now = new Date();

            setLeadNotifications((currentNotifications) => [
                {
                    notificationID: notification.getEventID(),
                    title: notification.getTitle(),
                    date: now.toISOString().split("T")[0],
                    leadID: currentLead.leadID,
                },
                ...currentNotifications,
            ]);
            router.refresh();
        } catch (error) {
            setErrorMessage(
                error instanceof Error
                    ? error.message
                    : "Failed to log communication."
            );
        } finally {
            setLoggingCommunication(null);
        }
    }

    function startEditingTask(task: LeadDetailTaskViewModel) {
        setEditingTaskId(task.taskID);
        setDraftTaskTitle(task.title);
        setDraftTaskNotes(task.notes);
        setDraftTaskDate(task.date);
        setDraftTaskTime(task.time || "09:00");
        setErrorMessage(null);
    }

    function cancelEditingTask() {
        setEditingTaskId(null);
        setDraftTaskTitle("");
        setDraftTaskNotes("");
        setDraftTaskDate("");
        setDraftTaskTime("");
        setErrorMessage(null);
    }

    async function handleSaveTask(taskID: number) {
        const targetTask = leadTasks.find((task) => task.taskID === taskID);
        const title = draftTaskTitle.trim();

        if (!targetTask) {
            return;
        }

        if (!title) {
            setErrorMessage("Task title is required.");
            return;
        }

        if (!draftTaskDate) {
            setErrorMessage("Task date is required.");
            return;
        }

        if (!draftTaskTime) {
            setErrorMessage("Task time is required.");
            return;
        }

        const nextTask = {
            ...targetTask,
            title,
            taskType: targetTask.taskType || title,
            notes: draftTaskNotes.trim(),
            date: draftTaskDate,
            time: draftTaskTime,
        };

        setUpdatingTaskId(taskID);
        setErrorMessage(null);

        try {
            const taskRepository = new TaskRepo();
            const error = await taskRepository.updateTask(
                createTaskFromViewModel(nextTask)
            );

            if (error) {
                setErrorMessage(error);
                return;
            }

            await reloadLeadTasks(taskRepository);
            cancelEditingTask();
            router.refresh();
        } catch (error) {
            setErrorMessage(
                error instanceof Error ? error.message : "Failed to update task."
            );
        } finally {
            setUpdatingTaskId(null);
        }
    }

    async function handleDeleteTask(taskID: number) {
        setUpdatingTaskId(taskID);
        setErrorMessage(null);

        try {
            const taskRepository = new TaskRepo();
            const error = await taskRepository.deleteTask(taskID);

            if (error) {
                setErrorMessage(error);
                return;
            }

            await reloadLeadTasks(taskRepository);

            if (editingTaskId === taskID) {
                cancelEditingTask();
            }

            router.refresh();
        } catch (error) {
            setErrorMessage(
                error instanceof Error ? error.message : "Failed to delete task."
            );
        } finally {
            setUpdatingTaskId(null);
        }
    }

    return (
        <div className="space-y-6">
            {errorMessage ? (
                <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
                    {errorMessage}
                </div>
            ) : null}

            <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="flex items-start gap-3">
                        <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
                            <UserRound size={24} />
                        </div>
                        <div>
                            <h2 className="text-2xl font-bold text-slate-950">
                                {fullName || "Unnamed Lead"}
                            </h2>
                            <p className="mt-1 text-sm text-slate-500">
                                Lead #{currentLead.leadID} - created{" "}
                                {formatDisplayDate(currentLead.createdAt)}
                            </p>
                            {!isEditing ? (
                                <div className="mt-3 flex flex-wrap gap-2">
                                    <button
                                        onClick={() =>
                                            handleLogCommunication("call")
                                        }
                                        disabled={loggingCommunication !== null}
                                        className="inline-flex min-w-24 items-center justify-center gap-2 rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                                    >
                                        <Phone size={15} />
                                        {loggingCommunication === "call"
                                            ? "Logging..."
                                            : "Call"}
                                    </button>
                                    <button
                                        onClick={() =>
                                            handleLogCommunication("email")
                                        }
                                        disabled={loggingCommunication !== null}
                                        className="inline-flex min-w-24 items-center justify-center gap-2 rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                                    >
                                        <Mail size={15} />
                                        {loggingCommunication === "email"
                                            ? "Logging..."
                                            : "Email"}
                                    </button>
                                    <button
                                        onClick={() =>
                                            handleLogCommunication("message")
                                        }
                                        disabled={loggingCommunication !== null}
                                        className="inline-flex min-w-24 items-center justify-center gap-2 rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                                    >
                                        <MessageSquare size={15} />
                                        {loggingCommunication === "message"
                                            ? "Logging..."
                                            : "Message"}
                                    </button>
                                </div>
                            ) : null}
                        </div>
                    </div>

                    <div className="flex flex-wrap gap-2">
                        {isEditing ? (
                            <>
                                <button
                                    onClick={handleCancel}
                                    disabled={saving}
                                    className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                    <X size={16} />
                                    Cancel
                                </button>
                                <button
                                    onClick={handleSave}
                                    disabled={saving}
                                    className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-300"
                                >
                                    <Save size={16} />
                                    {saving ? "Saving..." : "Save Changes"}
                                </button>
                            </>
                        ) : (
                            <>
                                <button
                                    onClick={() => setIsEditing(true)}
                                    className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
                                >
                                    <Pencil size={16} />
                                    Modify
                                </button>
                                <button
                                    onClick={() => setShowDeleteConfirm(true)}
                                    className="inline-flex items-center gap-2 rounded-lg border border-red-200 px-4 py-2 text-sm font-semibold text-red-700 hover:bg-red-50"
                                >
                                    <Trash2 size={16} />
                                    Delete
                                </button>
                            </>
                        )}
                    </div>
                </div>

                <div className="mt-6 grid gap-4 md:grid-cols-4">
                    <div className="rounded-lg bg-slate-50 p-4">
                        <p className="text-sm font-medium text-slate-500">Stage</p>
                        <p className="mt-2 text-xl font-bold text-slate-950">
                            {currentLead.stage}
                        </p>
                    </div>
                    <div className="rounded-lg bg-slate-50 p-4">
                        <p className="text-sm font-medium text-slate-500">Score</p>
                        <p className="mt-2 text-xl font-bold text-slate-950">
                            {Math.floor(currentLead.score)}
                        </p>
                    </div>
                    <div className="rounded-lg bg-slate-50 p-4">
                        <p className="text-sm font-medium text-slate-500">
                            Priority
                        </p>
                        <p
                            className={`mt-2 inline-flex rounded-full px-3 py-1 text-sm font-bold ${
                                currentLead.priorityLevel === "HOT"
                                    ? "bg-red-100 text-red-700"
                                    : currentLead.priorityLevel === "HIGH"
                                      ? "bg-amber-100 text-amber-700"
                                      : currentLead.priorityLevel === "MEDIUM"
                                        ? "bg-blue-100 text-blue-700"
                                        : currentLead.priorityLevel === "CLOSED"
                                          ? "bg-slate-200 text-slate-600"
                                          : "bg-slate-100 text-slate-600"
                            }`}
                        >
                            {currentLead.priorityLevel}
                        </p>
                    </div>
                    <div className="rounded-lg bg-slate-50 p-4">
                        <p className="text-sm font-medium text-slate-500">Status</p>
                        <p
                            className={`mt-2 inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm font-semibold ${
                                currentLead.status
                                    ? "bg-green-50 text-green-700"
                                    : "bg-red-50 text-red-700"
                            }`}
                        >
                            <Check size={14} />
                            {currentLead.status ? "Active" : "Lost"}
                        </p>
                    </div>
                </div>

                <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-4">
                    <p className="text-sm font-semibold text-slate-950">
                        Why this priority?
                    </p>
                    <ul className="mt-2 space-y-1 text-sm text-slate-600">
                        {currentLead.priorityReasons.map((reason) => (
                            <li key={reason}>- {reason}</li>
                        ))}
                    </ul>
                </div>
            </section>

            {isEditing ? (
                <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
                    <h3 className="text-lg font-bold text-slate-950">
                        Modify Lead Information
                    </h3>

                    <div className="mt-5 grid gap-4 md:grid-cols-2">
                        <label className="text-sm font-medium text-slate-700">
                            First Name
                            <input
                                value={draftLead.firstName}
                                onChange={(event) =>
                                    updateDraft("firstName", event.target.value)
                                }
                                className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2 text-slate-950"
                            />
                        </label>
                        <label className="text-sm font-medium text-slate-700">
                            Last Name
                            <input
                                value={draftLead.lastName}
                                onChange={(event) =>
                                    updateDraft("lastName", event.target.value)
                                }
                                className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2 text-slate-950"
                            />
                        </label>
                        <label className="text-sm font-medium text-slate-700">
                            Phone
                            <input
                                value={draftLead.phone}
                                onChange={(event) =>
                                    updateDraft("phone", event.target.value)
                                }
                                className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2 text-slate-950"
                            />
                        </label>
                        <label className="text-sm font-medium text-slate-700">
                            Email
                            <input
                                value={draftLead.leadEmail}
                                onChange={(event) =>
                                    updateDraft("leadEmail", event.target.value)
                                }
                                className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2 text-slate-950"
                            />
                        </label>
                        <label className="text-sm font-medium text-slate-700">
                            Stage
                            <select
                                value={draftLead.stage}
                                onChange={(event) =>
                                    updateDraft("stage", event.target.value)
                                }
                                className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2 text-slate-950"
                            >
                                {stageOptions.map((stage) => (
                                    <option key={stage} value={stage}>
                                        {stage}
                                    </option>
                                ))}
                            </select>
                        </label>
                        <label className="text-sm font-medium text-slate-700">
                            Status
                            <select
                                value={draftLead.status ? "ACTIVE" : "LOST"}
                                onChange={(event) =>
                                    updateDraft(
                                        "status",
                                        event.target.value === "ACTIVE"
                                    )
                                }
                                className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2 text-slate-950"
                            >
                                <option value="ACTIVE">Active</option>
                                <option value="LOST">Lost</option>
                            </select>
                        </label>
                        <label className="text-sm font-medium text-slate-700">
                            Budget
                            <input
                                type="number"
                                value={draftLead.budget}
                                onChange={(event) =>
                                    updateDraft("budget", Number(event.target.value))
                                }
                                className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2 text-slate-950"
                            />
                        </label>
                        <label className="text-sm font-medium text-slate-700">
                            Score
                            <input
                                type="number"
                                min={0}
                                value={draftLead.score}
                                readOnly
                                className="mt-2 w-full rounded-lg border border-slate-200 bg-slate-100 px-3 py-2 text-slate-500"
                            />
                            <span className="mt-1 block text-xs text-slate-500">
                                Score recalculates automatically when saved.
                            </span>
                        </label>
                        <label className="text-sm font-medium text-slate-700">
                            Follow-up Date
                            <input
                                type="date"
                                value={draftLead.followUpDate}
                                onChange={(event) =>
                                    updateDraft("followUpDate", event.target.value)
                                }
                                className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2 text-slate-950"
                            />
                        </label>
                        <div className="md:col-span-2">
                            <div className="flex items-center justify-between gap-3">
                                <p className="text-sm font-medium text-slate-700">
                                    Vehicle Interest
                                </p>
                                <button
                                    type="button"
                                    onClick={() =>
                                        setDraftVehicleInterest(
                                            getEmptyVehicleSelection()
                                        )
                                    }
                                    className="text-sm font-semibold text-slate-500 hover:text-red-600"
                                >
                                    Clear
                                </button>
                            </div>
                            <div className="mt-2 rounded-lg border border-slate-200 bg-slate-50 p-4">
                                <VehicleInterestSelector
                                    value={draftVehicleInterest}
                                    onChange={setDraftVehicleInterest}
                                    placeholders={{
                                        year: "Select year",
                                        make: "Select make",
                                        model: "Select model",
                                        trim: "Optional trim",
                                    }}
                                />
                            </div>
                        </div>
                        <div className="md:col-span-2">
                            <div className="flex items-center justify-between gap-3">
                                <p className="text-sm font-medium text-slate-700">
                                    Trade-in Vehicle
                                </p>
                                <button
                                    type="button"
                                    onClick={() =>
                                        setDraftTradeInVehicle(
                                            getEmptyVehicleSelection()
                                        )
                                    }
                                    className="text-sm font-semibold text-slate-500 hover:text-red-600"
                                >
                                    Clear
                                </button>
                            </div>
                            <div className="mt-2 rounded-lg border border-slate-200 bg-slate-50 p-4">
                                <VehicleInterestSelector
                                    value={draftTradeInVehicle}
                                    onChange={setDraftTradeInVehicle}
                                    placeholders={{
                                        year: "Enter year",
                                        make: "Enter make",
                                        model: "Enter model",
                                        trim: "Optional trim",
                                    }}
                                />
                            </div>
                        </div>
                        <label className="text-sm font-medium text-slate-700">
                            Division
                            <input
                                value={draftLead.leadDivision}
                                onChange={(event) =>
                                    updateDraft("leadDivision", event.target.value)
                                }
                                className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2 text-slate-950"
                            />
                        </label>
                        <label className="text-sm font-medium text-slate-700 md:col-span-2">
                            Address
                            <input
                                value={draftLead.leadAddress}
                                onChange={(event) =>
                                    updateDraft("leadAddress", event.target.value)
                                }
                                className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2 text-slate-950"
                            />
                        </label>
                        <label className="text-sm font-medium text-slate-700">
                            City
                            <input
                                value={draftLead.leadCity}
                                onChange={(event) =>
                                    updateDraft("leadCity", event.target.value)
                                }
                                className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2 text-slate-950"
                            />
                        </label>
                        <label className="text-sm font-medium text-slate-700">
                            Province
                            <input
                                value={draftLead.leadProvince}
                                onChange={(event) =>
                                    updateDraft("leadProvince", event.target.value)
                                }
                                className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2 text-slate-950"
                            />
                        </label>
                        <label className="text-sm font-medium text-slate-700">
                            Postal Code
                            <input
                                value={draftLead.leadPostalCode}
                                onChange={(event) =>
                                    updateDraft(
                                        "leadPostalCode",
                                        event.target.value
                                    )
                                }
                                className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2 text-slate-950"
                            />
                        </label>
                        <label className="text-sm font-medium text-slate-700">
                            Country
                            <input
                                value={draftLead.leadCountry}
                                onChange={(event) =>
                                    updateDraft("leadCountry", event.target.value)
                                }
                                className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2 text-slate-950"
                            />
                        </label>
                        <label className="text-sm font-medium text-slate-700 md:col-span-2">
                            Notes
                            <textarea
                                value={draftLead.notes}
                                onChange={(event) =>
                                    updateDraft("notes", event.target.value)
                                }
                                rows={5}
                                className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2 text-slate-950"
                            />
                        </label>
                    </div>

                    <p className="mt-4 rounded-lg bg-blue-50 p-3 text-sm text-blue-800">
                        Saving changes for {draftFullName || "this lead"} will update the Supabase lead record.
                    </p>
                </section>
            ) : (
                <section className="grid gap-6 xl:grid-cols-[1fr_0.85fr]">
                    <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
                        <h3 className="text-lg font-bold text-slate-950">
                            Contact Information
                        </h3>

                        <div className="mt-5 grid gap-4 md:grid-cols-2">
                            <Field label="Phone" value={currentLead.phone} icon={Phone} />
                            <Field label="Email" value={currentLead.leadEmail} icon={Mail} />
                            <Field
                                label="Address"
                                value={[
                                    currentLead.leadAddress,
                                    currentLead.leadCity,
                                    currentLead.leadProvince,
                                    currentLead.leadPostalCode,
                                    currentLead.leadCountry,
                                ]
                                    .filter(Boolean)
                                    .join(", ")}
                                icon={MapPin}
                            />
                            <Field
                                label="Division"
                                value={currentLead.leadDivision}
                                icon={UserRound}
                            />
                        </div>
                    </div>

                    <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
                        <h3 className="text-lg font-bold text-slate-950">
                            Sales Details
                        </h3>

                        <div className="mt-5 space-y-4">
                            <Field
                                label="Budget"
                                value={currencyFormatter.format(currentLead.budget)}
                                icon={CalendarClock}
                            />
                            <Field
                                label="Next Follow-up"
                                value={formatDisplayDate(currentLead.followUpDate)}
                                icon={CalendarClock}
                            />
                            <Field
                                label="Last Interaction"
                                value={formatDisplayDate(
                                    currentLead.lastInteractionDate
                                )}
                                icon={CalendarClock}
                            />
                        </div>
                    </div>
                </section>
            )}

            {!isEditing ? (
                <>
                    <section className="grid gap-6 xl:grid-cols-2">
                        <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
                            <h3 className="text-lg font-bold text-slate-950">
                                Vehicle Interest
                            </h3>
                            <div className="mt-5">
                                <Field
                                    label="Selected Vehicle"
                                    value={
                                        getVehicleDescription(
                                            getVehicleSelectionFromLead(
                                                currentLead
                                            )
                                        ) ||
                                        "No vehicle has been selected."
                                    }
                                    icon={Car}
                                />
                            </div>
                        </div>

                        <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
                            <h3 className="text-lg font-bold text-slate-950">
                                Trade-in Vehicle
                            </h3>
                            <div className="mt-5">
                                <Field
                                    label="Trade-in"
                                    value={
                                        getVehicleDescription(
                                            getTradeInSelectionFromLead(
                                                currentLead
                                            )
                                        ) ||
                                        "No trade-in vehicle has been selected."
                                    }
                                    icon={Car}
                                />
                            </div>
                        </div>
                    </section>

                    <section className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
                        <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
                            <h3 className="text-lg font-bold text-slate-950">
                                Notes
                            </h3>
                            <p className="mt-4 whitespace-pre-line text-sm leading-6 text-slate-700">
                                {currentLead.notes || "No notes available."}
                            </p>
                        </div>

                        <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
                            <h3 className="text-lg font-bold text-slate-950">
                                Tasks
                            </h3>

                            <div className="mt-5 rounded-lg border border-slate-200 bg-slate-50 p-4">
                                <p className="text-sm font-semibold text-slate-950">
                                    Add Task for This Lead
                                </p>
                                <div className="mt-3 space-y-3">
                                    <div className="grid gap-3 md:grid-cols-[minmax(180px,1fr)_150px_120px_auto]">
                                        <select
                                            value={newTaskType}
                                            onChange={(event) =>
                                                setNewTaskType(event.target.value)
                                            }
                                            className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-950"
                                        >
                                            <option value="" disabled>
                                                Select task type
                                            </option>
                                            {Task.TASK_TYPE_OPTIONS.map(
                                                (taskType) => (
                                                    <option
                                                        key={taskType}
                                                        value={taskType}
                                                    >
                                                        {taskType}
                                                    </option>
                                                )
                                            )}
                                        </select>
                                        <input
                                            type="date"
                                            value={newTaskDate}
                                            onChange={(event) =>
                                                setNewTaskDate(event.target.value)
                                            }
                                            className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-950"
                                        />
                                        <input
                                            type="time"
                                            value={newTaskTime}
                                            onChange={(event) =>
                                                setNewTaskTime(event.target.value)
                                            }
                                            className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-950"
                                        />
                                        <button
                                            onClick={handleCreateTask}
                                            disabled={creatingTask}
                                            className="inline-flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-300"
                                        >
                                            <PlusCircle size={16} />
                                            {creatingTask ? "Adding..." : "Add"}
                                        </button>
                                    </div>
                                    <input
                                        value={newTaskNotes}
                                        onChange={(event) =>
                                            setNewTaskNotes(event.target.value)
                                        }
                                        placeholder="Short notes or description"
                                        className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-950"
                                    />
                                </div>
                            </div>

                            <div className="mt-5 space-y-3">
                                {leadTasks.map((task) => {
                                    const isTaskEditing =
                                        editingTaskId === task.taskID;
                                    const isTaskUpdating =
                                        updatingTaskId === task.taskID;

                                    return (
                                        <div
                                            key={task.taskID}
                                            className="rounded-lg border border-slate-200 p-4"
                                        >
                                            {isTaskEditing ? (
                                                <div className="space-y-3">
                                                    <input
                                                        value={draftTaskTitle}
                                                        onChange={(event) =>
                                                            setDraftTaskTitle(
                                                                event.target.value
                                                            )
                                                        }
                                                        className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-950"
                                                    />
                                                    <input
                                                        value={draftTaskNotes}
                                                        onChange={(event) =>
                                                            setDraftTaskNotes(
                                                                event.target.value
                                                            )
                                                        }
                                                        placeholder="Short notes or description"
                                                        className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-950"
                                                    />
                                                    <div className="grid gap-3 md:grid-cols-[1fr_1fr]">
                                                        <input
                                                            type="date"
                                                            value={draftTaskDate}
                                                            onChange={(event) =>
                                                                setDraftTaskDate(
                                                                    event.target.value
                                                                )
                                                            }
                                                            className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-950"
                                                        />
                                                        <input
                                                            type="time"
                                                            value={draftTaskTime}
                                                            onChange={(event) =>
                                                                setDraftTaskTime(
                                                                    event.target.value
                                                                )
                                                            }
                                                            className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-950"
                                                        />
                                                    </div>
                                                    <div className="flex flex-wrap justify-end gap-2">
                                                        <button
                                                            onClick={cancelEditingTask}
                                                            disabled={isTaskUpdating}
                                                            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                                                        >
                                                            <X size={15} />
                                                            Cancel
                                                        </button>
                                                        <button
                                                            onClick={() =>
                                                                handleSaveTask(
                                                                    task.taskID
                                                                )
                                                            }
                                                            disabled={isTaskUpdating}
                                                            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-300"
                                                        >
                                                            <Save size={15} />
                                                            {isTaskUpdating
                                                                ? "Saving..."
                                                                : "Save"}
                                                        </button>
                                                    </div>
                                                </div>
                                            ) : (
                                                <div className="flex items-start justify-between gap-4">
                                                    <div>
                                                        <p className="font-semibold text-slate-950">
                                                            {task.title}
                                                        </p>
                                                        {task.notes ? (
                                                            <p className="mt-1 text-sm text-slate-600">
                                                                {task.notes}
                                                            </p>
                                                        ) : null}
                                                        <p className="mt-1 text-sm text-slate-500">
                                                            {formatTaskDateTime(task)}
                                                        </p>
                                                    </div>

                                                    <div className="flex flex-wrap items-center justify-end gap-2">
                                                        <button
                                                            onClick={() =>
                                                                toggleTaskCompletion(
                                                                    task.taskID
                                                                )
                                                            }
                                                            disabled={isTaskUpdating}
                                                            className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-60 ${
                                                                task.completed
                                                                    ? "bg-green-50 text-green-700"
                                                                    : "bg-slate-100 text-slate-600"
                                                            }`}
                                                        >
                                                            {task.completed ? (
                                                                <CheckCircle2
                                                                    size={14}
                                                                />
                                                            ) : (
                                                                <Circle size={14} />
                                                            )}
                                                            {task.completed
                                                                ? "Completed"
                                                                : "Uncompleted"}
                                                        </button>
                                                        <button
                                                            onClick={() =>
                                                                startEditingTask(task)
                                                            }
                                                            disabled={isTaskUpdating}
                                                            className="text-blue-600 hover:text-blue-800 disabled:cursor-not-allowed disabled:text-slate-300"
                                                            title="Edit task"
                                                        >
                                                            <Pencil size={17} />
                                                        </button>
                                                        <button
                                                            onClick={() =>
                                                                handleDeleteTask(
                                                                    task.taskID
                                                                )
                                                            }
                                                            disabled={isTaskUpdating}
                                                            className="text-red-600 hover:text-red-800 disabled:cursor-not-allowed disabled:text-slate-300"
                                                            title="Delete task"
                                                        >
                                                            <Trash2 size={17} />
                                                        </button>
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}

                                {leadTasks.length === 0 ? (
                                    <p className="text-sm text-slate-400">
                                        No tasks for this lead.
                                    </p>
                                ) : null}
                            </div>
                        </div>
                    </section>

                    <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
                        <h3 className="text-lg font-bold text-slate-950">
                            Notifications
                        </h3>

                        <div className="mt-5 space-y-3">
                            {leadNotifications.map((notification) => (
                                <div
                                    key={notification.notificationID}
                                    className="flex gap-3 rounded-lg border border-slate-200 p-4"
                                >
                                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-amber-50 text-amber-600">
                                        <Bell size={18} />
                                    </div>
                                    <div>
                                        <p className="font-semibold text-slate-950">
                                            {notification.title}
                                        </p>
                                        <p className="mt-1 text-sm text-slate-500">
                                            {formatDisplayDate(notification.date)}
                                        </p>
                                    </div>
                                </div>
                            ))}

                            {leadNotifications.length === 0 ? (
                                <p className="text-sm text-slate-400">
                                    No notifications for this lead.
                                </p>
                            ) : null}
                        </div>
                    </section>
                </>
            ) : null}

            {showDeleteConfirm && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4">
                    <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
                        <h3 className="text-xl font-bold text-slate-950">
                            Delete this lead?
                        </h3>
                        <p className="mt-2 text-sm text-slate-600">
                            This will permanently delete {fullName || "this lead"} from Supabase.
                        </p>

                        <div className="mt-6 flex justify-end gap-3">
                            <button
                                onClick={() => setShowDeleteConfirm(false)}
                                disabled={deleting}
                                className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleDelete}
                                disabled={deleting}
                                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:bg-red-300"
                            >
                                {deleting ? "Deleting..." : "Delete Lead"}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
