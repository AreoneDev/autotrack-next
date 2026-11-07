import { summarizeMessageReplies, type MessageReplyRecord } from "@/domain/business/MessageReplyService";
import { AgendaService } from "@/domain/business/AgendaService";
import {
    RecentActivityItem,
    RecentActivityService,
    RecentActivitySource,
    RecentActivityType,
} from "@/domain/business/RecentActivityService";
import { ScoringService } from "@/domain/business/ScoringService";
import { Lead } from "@/domain/objects/Lead";
import { getLeadOutcome, leadOutcomeLabels } from "@/domain/objects/LeadOutcome";
import { Notification } from "@/domain/objects/Notification";
import { Task } from "@/domain/objects/Task";

export type DashboardTaskStatus = "overdue" | "scheduled" | "completed";

export type DashboardTaskItem = {
    id: number;
    leadId: number | null;
    leadName: string;
    title: string;
    type: string;
    time: string;
    status: DashboardTaskStatus;
    score: number;
    date: Date;
};

export type DashboardPriorityItem = {
    leadId: number;
    leadName: string;
    vehicleInterest: string;
    stage: string;
    status: string;
    score: number;
    priorityLevel: string;
    nextFollowUpDate: string;
    reasonLabel: string;
    reason: string;
    tone: "red" | "amber" | "blue";
};

type DashboardPriorityCandidate = {
    lead: Lead;
    score: number;
    priorityLevel: string;
    reasonLabel: string;
    reason: string;
    actionRank: number;
    nextFollowUpDate: Date | null;
    activityDate: Date | null;
};

export type DashboardRecentActivityType = RecentActivityType;
export type DashboardRecentActivitySource = RecentActivitySource;

export type DashboardRecentActivityItem = RecentActivityItem;

export type DashboardMetrics = {
    todayTaskCount: number;
    highPriorityLeadCount: number;
    unrepliedMessageCount: number | null;
    overdueTaskCount: number;
};

export type DashboardData = {
    metrics: DashboardMetrics;
    todayTasks: DashboardTaskItem[];
    priorityActions: DashboardPriorityItem[];
    recentActivities: DashboardRecentActivityItem[];
};

export class DashboardService {
    private scoringService: ScoringService;
    private agendaService: AgendaService;
    private recentActivityService: RecentActivityService;
    private highPriorityThreshold: number;

    constructor(
        scoringService: ScoringService,
        agendaService: AgendaService
    ) {
        this.scoringService = scoringService;
        this.agendaService = agendaService;
        this.recentActivityService = new RecentActivityService();
        this.highPriorityThreshold = ScoringService.THRESHOLD;
    }

    getDashboardData(
        leads: Lead[],
        tasks: Task[],
        notifications: Notification[],
        targetDate: Date,
        replyRecords: MessageReplyRecord[] | null = null
    ): DashboardData {
        const todayTasks = this.getTodayTasks(tasks, leads, targetDate);
        const overdueTasks = this.getOverdueTasks(tasks, targetDate);
        const highPriorityLeads = this.getHighPriorityLeads(leads);
        const priorityActions = this.getPriorityActions(
            leads,
            tasks,
            notifications,
            targetDate
        );
        const recentActivities = this.getRecentActivities(
            leads,
            tasks,
            notifications,
            targetDate
        );

        return {
            metrics: {
                todayTaskCount: todayTasks.length,
                highPriorityLeadCount: highPriorityLeads.length,
                // Only explicit inbound records count; missing tracking is not an empty inbox.
                unrepliedMessageCount: replyRecords === null ? null : summarizeMessageReplies(replyRecords, targetDate).pending,
                overdueTaskCount: overdueTasks.length,
            },
            todayTasks,
            priorityActions,
            recentActivities,
        };
    }

    getSystemAssignedTasks(
        leads: Lead[],
        existingTasks: Task[],
        targetDate: Date
    ): Task[] {
        return this.agendaService.getSystemAssignedTasks(
            leads,
            existingTasks,
            targetDate
        );
    }

    getTodayTasks(
        tasks: Task[],
        leads: Lead[],
        targetDate: Date
    ): DashboardTaskItem[] {
        const leadMap = this.createLeadMap(leads);
        const targetDateString = this.formatDate(targetDate);

        return tasks
            .filter(
                (task) => this.formatDate(task.getDate()) === targetDateString
            )
            .map((task) => this.toTaskItem(task, leadMap, targetDate))
            .sort((taskA, taskB) => {
                const statusRank =
                    this.getTaskStatusRank(taskA.status) -
                    this.getTaskStatusRank(taskB.status);

                if (statusRank !== 0) {
                    return statusRank;
                }

                const timeDiff =
                    taskA.date.getTime() - taskB.date.getTime();

                if (timeDiff !== 0) {
                    return timeDiff;
                }

                return taskB.score - taskA.score;
            });
    }

    getOverdueTasks(tasks: Task[], targetDate: Date): Task[] {
        const targetDateString = this.formatDate(targetDate);

        return tasks.filter(
            (task) =>
                !task.isCompleted() &&
                this.formatDate(task.getDate()) < targetDateString
        );
    }

    getHighPriorityLeads(leads: Lead[]): Lead[] {
        return [...leads]
            .map((lead) => {
                const priority = this.scoringService.calculatePriority(lead);
                lead.updateScore(priority.score);
                return { lead, priority };
            })
            .filter(
                ({ lead, priority }) =>
                    lead.isActive() &&
                    priority.level !== "CLOSED" &&
                    priority.score >= this.highPriorityThreshold
            )
            .sort((leadA, leadB) => {
                const scoreDiff = leadB.priority.score - leadA.priority.score;

                if (scoreDiff !== 0) {
                    return scoreDiff;
                }

                return (
                    this.getPrioritySortDate(leadA.lead).getTime() -
                    this.getPrioritySortDate(leadB.lead).getTime()
                );
            })
            .map(({ lead }) => lead);
    }

    getPriorityActions(
        leads: Lead[],
        tasks: Task[],
        notifications: Notification[],
        targetDate: Date
    ): DashboardPriorityItem[] {
        const candidateMap = new Map<number, DashboardPriorityCandidate>();
        const highPriorityLeadMap = new Map<
            number,
            { lead: Lead; score: number; priorityLevel: string }
        >();

        for (const lead of leads) {
            const priority = this.scoringService.calculatePriority(lead);
            lead.updateScore(priority.score);

            if (
                !lead.isActive() ||
                priority.level === "CLOSED" ||
                priority.score < this.highPriorityThreshold
            ) {
                continue;
            }

            highPriorityLeadMap.set(lead.leadID, {
                lead,
                score: priority.score,
                priorityLevel: priority.level,
            });
            this.upsertPriorityCandidate(candidateMap, {
                lead,
                score: priority.score,
                priorityLevel: priority.level,
                reasonLabel: "High Score Lead",
                reason: "This lead is recommended because its score is above the high-priority threshold.",
                actionRank: 40,
                nextFollowUpDate: lead.followUpDate ?? null,
                activityDate: lead.lastInteractionDate ?? lead.followUpDate ?? null,
            });
        }

        for (const task of tasks) {
            const leadId = task.getLead()?.leadID;
            const leadCandidate = leadId
                ? highPriorityLeadMap.get(leadId)
                : null;

            if (!leadCandidate || task.isCompleted()) {
                continue;
            }

            const isOverdue = this.isTaskOverdue(task, targetDate);

            if (!isOverdue && !this.isRelevantPriorityTask(task, targetDate)) {
                continue;
            }

            const taskReason = this.getTaskPriorityReason(task, isOverdue);

            this.upsertPriorityCandidate(candidateMap, {
                lead: leadCandidate.lead,
                score: leadCandidate.score,
                priorityLevel: leadCandidate.priorityLevel,
                ...taskReason,
                actionRank: isOverdue ? 10 : 20,
                nextFollowUpDate: task.getDate(),
                activityDate: task.getDate(),
            });
        }

        for (const notification of notifications) {
            const leadId = notification.getLead()?.leadID;
            const leadCandidate = leadId
                ? highPriorityLeadMap.get(leadId)
                : null;

            if (
                !leadCandidate ||
                !this.isLeadActionNotification(notification)
            ) {
                continue;
            }

            this.upsertPriorityCandidate(candidateMap, {
                lead: leadCandidate.lead,
                score: leadCandidate.score,
                priorityLevel: leadCandidate.priorityLevel,
                ...this.getNotificationPriorityReason(notification),
                actionRank: 0,
                nextFollowUpDate: leadCandidate.lead.followUpDate ?? null,
                activityDate: notification.getDate(),
            });
        }

        if (candidateMap.size === 0) {
            for (const leadCandidate of this.getFallbackPriorityCandidates(
                highPriorityLeadMap,
                leads
            )) {
                this.upsertPriorityCandidate(candidateMap, {
                    lead: leadCandidate.lead,
                    score: leadCandidate.score,
                    priorityLevel: leadCandidate.priorityLevel,
                    reasonLabel: "Top Recommended Lead",
                    reason: "No lead currently exceeds the high-priority threshold, so this lead is shown as one of the strongest active opportunities.",
                    actionRank: 50,
                    nextFollowUpDate: leadCandidate.lead.followUpDate ?? null,
                    activityDate:
                        leadCandidate.lead.lastInteractionDate ??
                        leadCandidate.lead.followUpDate ??
                        null,
                });
            }
        }

        return [...candidateMap.values()]
            .sort((candidateA, candidateB) => {
                const scoreDiff = candidateB.score - candidateA.score;

                if (scoreDiff !== 0) {
                    return scoreDiff;
                }

                return (
                    this.getPrioritySortDate(candidateA.lead).getTime() -
                    this.getPrioritySortDate(candidateB.lead).getTime()
                );
            })
            .map((candidate) => this.toPriorityItem(candidate));
    }

    private getFallbackPriorityCandidates(
        highPriorityLeadMap: Map<
            number,
            { lead: Lead; score: number; priorityLevel: string }
        >,
        leads: Lead[]
    ): { lead: Lead; score: number; priorityLevel: string }[] {
        if (highPriorityLeadMap.size > 0) {
            return [];
        }

        return leads
            .map((lead) => {
                const priority = this.scoringService.calculatePriority(lead);
                lead.updateScore(priority.score);

                return {
                    lead,
                    score: priority.score,
                    priorityLevel: priority.level,
                };
            })
            .filter(
                ({ lead, priorityLevel, score }) =>
                    lead.isActive() &&
                    priorityLevel !== "CLOSED" &&
                    score > 0
            )
            .sort((candidateA, candidateB) => {
                const scoreDiff = candidateB.score - candidateA.score;

                if (scoreDiff !== 0) {
                    return scoreDiff;
                }

                return (
                    this.getPrioritySortDate(candidateA.lead).getTime() -
                    this.getPrioritySortDate(candidateB.lead).getTime()
                );
            })
            .slice(0, 5);
    }

    getRecentActivities(
        leads: Lead[],
        tasks: Task[],
        notifications: Notification[],
        referenceDate: Date
    ): DashboardRecentActivityItem[] {
        return this.recentActivityService.getRecentActivities({
            leads,
            tasks,
            notifications,
            referenceDate,
            limit: 30,
        });
    }

    private toTaskItem(
        task: Task,
        leadMap: Map<number, Lead>,
        targetDate: Date
    ): DashboardTaskItem {
        const leadId = task.getLead()?.leadID ?? null;
        const lead = leadId ? leadMap.get(leadId) : null;
        const status = this.getTaskStatus(task, targetDate);

        return {
            id: task.getEventID(),
            leadId,
            leadName: lead?.getLeadName() ?? `Lead ${leadId ?? "N/A"}`,
            title: task.getTitle(),
            type: task.getTaskType() || this.getTaskType(task.getTitle()),
            time: this.formatTime(task.getDate()),
            status,
            score: lead?.score ?? 0,
            date: task.getDate(),
        };
    }

    private toPriorityItem(
        candidate: DashboardPriorityCandidate
    ): DashboardPriorityItem {
        const lead = candidate.lead;

        return {
            leadId: lead.leadID,
            leadName: lead.getLeadName(),
            vehicleInterest:
                lead.vehicleInterest?.getFullDescription() ??
                "No vehicle interest listed",
            stage: lead.stage,
            status: leadOutcomeLabels[getLeadOutcome(lead)],
            score: Math.floor(candidate.score),
            priorityLevel: candidate.priorityLevel,
            nextFollowUpDate: candidate.nextFollowUpDate
                ? this.formatDisplayDate(candidate.nextFollowUpDate)
                : "Not scheduled",
            reasonLabel: candidate.reasonLabel,
            reason: candidate.reason,
            tone: this.getPriorityTone(candidate.score),
        };
    }

    private createLeadMap(leads: Lead[]): Map<number, Lead> {
        return new Map(leads.map((lead) => [lead.leadID, lead]));
    }

    private getTaskStatus(
        task: Task,
        targetDate: Date
    ): DashboardTaskStatus {
        if (task.isCompleted()) {
            return "completed";
        }

        if (task.getDate().getTime() < targetDate.getTime()) {
            return "overdue";
        }

        return "scheduled";
    }

    private isTaskOverdue(task: Task, targetDate: Date): boolean {
        return this.formatDate(task.getDate()) < this.formatDate(targetDate);
    }

    private getTaskStatusRank(status: DashboardTaskStatus): number {
        if (status === "overdue") {
            return 0;
        }

        if (status === "scheduled") {
            return 1;
        }

        return 2;
    }

    private getTaskType(title: string): string {
        const normalizedTitle = title.toLowerCase();

        if (
            normalizedTitle.includes("call") ||
            normalizedTitle.includes("phone")
        ) {
            return "Follow-up call";
        }

        if (
            normalizedTitle.includes("message") ||
            normalizedTitle.includes("email") ||
            normalizedTitle.includes("send")
        ) {
            return "Message";
        }

        if (
            normalizedTitle.includes("appointment") ||
            normalizedTitle.includes("test drive")
        ) {
            return "Appointment";
        }

        return "Follow-up";
    }

    private getPriorityTone(score: number): "red" | "amber" | "blue" {
        if (score >= this.highPriorityThreshold + 20) {
            return "red";
        }

        if (score >= this.highPriorityThreshold) {
            return "amber";
        }

        return "blue";
    }

    private getPrioritySortDate(lead: Lead): Date {
        if (lead.followUpDate) {
            return lead.followUpDate;
        }

        if (lead.lastInteractionDate) {
            return lead.lastInteractionDate;
        }

        return new Date(8640000000000000);
    }

    private upsertPriorityCandidate(
        candidateMap: Map<number, DashboardPriorityCandidate>,
        candidate: DashboardPriorityCandidate
    ): void {
        const existingCandidate = candidateMap.get(candidate.lead.leadID);

        if (!existingCandidate) {
            candidateMap.set(candidate.lead.leadID, candidate);
            return;
        }

        if (
            candidate.actionRank < existingCandidate.actionRank ||
            (candidate.actionRank === existingCandidate.actionRank &&
                this.isNewerActivity(
                    candidate.activityDate,
                    existingCandidate.activityDate
                ))
        ) {
            candidateMap.set(candidate.lead.leadID, candidate);
        }
    }

    private isNewerActivity(
        candidateDate: Date | null,
        existingDate: Date | null
    ): boolean {
        if (!candidateDate) {
            return false;
        }

        if (!existingDate) {
            return true;
        }

        return candidateDate.getTime() > existingDate.getTime();
    }

    private isRelevantPriorityTask(task: Task, targetDate: Date): boolean {
        if (!this.isRecentActivityDate(task.getDate(), targetDate)) {
            return false;
        }

        const normalizedTask = this.getTaskSearchText(task);

        return (
            normalizedTask.includes("appointment") ||
            normalizedTask.includes("test drive") ||
            normalizedTask.includes("pricing") ||
            normalizedTask.includes("price") ||
            normalizedTask.includes("payment") ||
            normalizedTask.includes("quote") ||
            normalizedTask.includes("discount") ||
            normalizedTask.includes("trade-in") ||
            normalizedTask.includes("trade in") ||
            normalizedTask.includes("document") ||
            normalizedTask.includes("delivery")
        );
    }

    private isRecentActivityDate(activityDate: Date, targetDate: Date): boolean {
        const millisecondsPerDay = 24 * 60 * 60 * 1000;
        const activityDay = new Date(activityDate);
        const targetDay = new Date(targetDate);
        activityDay.setHours(0, 0, 0, 0);
        targetDay.setHours(0, 0, 0, 0);

        return (
            Math.abs(targetDay.getTime() - activityDay.getTime()) <=
            14 * millisecondsPerDay
        );
    }

    private getTaskPriorityReason(
        task: Task,
        isOverdue: boolean
    ): { reasonLabel: string; reason: string } {
        const normalizedTask = this.getTaskSearchText(task);
        const description = this.getTaskDescription(task);

        if (isOverdue) {
            return {
                reasonLabel: "Overdue Follow-up",
                reason: description,
            };
        }

        if (
            normalizedTask.includes("pricing") ||
            normalizedTask.includes("price") ||
            normalizedTask.includes("payment") ||
            normalizedTask.includes("quote") ||
            normalizedTask.includes("discount")
        ) {
            return {
                reasonLabel: "Pricing Request",
                reason: description,
            };
        }

        if (
            normalizedTask.includes("appointment") ||
            normalizedTask.includes("test drive")
        ) {
            return {
                reasonLabel: "Appointment Activity",
                reason: description,
            };
        }

        if (
            normalizedTask.includes("trade-in") ||
            normalizedTask.includes("trade in")
        ) {
            return {
                reasonLabel: "Trade-in Discussion",
                reason: description,
            };
        }

        if (normalizedTask.includes("document")) {
            return {
                reasonLabel: "Document Collection",
                reason: description,
            };
        }

        if (normalizedTask.includes("delivery")) {
            return {
                reasonLabel: "Delivery Preparation",
                reason: description,
            };
        }

        return {
            reasonLabel: "Recent Lead Activity",
            reason: description,
        };
    }

    private getTaskDescription(task: Task): string {
        const notes = task.getNotes().trim();

        if (notes) {
            return notes;
        }

        return task.getTitle();
    }

    private getTaskSearchText(task: Task): string {
        return [task.getTaskType(), task.getTitle(), task.getNotes()]
            .join(" ")
            .toLowerCase();
    }

    private isLeadActionNotification(notification: Notification): boolean {
        const title = notification.getTitle().toLowerCase();

        return (
            title.includes("sent you") ||
            title.includes("replied") ||
            title.includes("called you") ||
            title.includes("incoming") ||
            title.includes("confirmed appointment") ||
            title.includes("appointment confirmed") ||
            title.includes("confirmed test drive") ||
            title.includes("pricing") ||
            title.includes("price") ||
            title.includes("appointment")
        );
    }

    private getNotificationPriorityReason(
        notification: Notification
    ): { reasonLabel: string; reason: string } {
        const title = notification.getTitle().toLowerCase();
        const description = notification.getTitle();

        if (title.includes("price") || title.includes("pricing")) {
            return {
                reasonLabel: "Pricing Request",
                reason: description,
            };
        }

        if (
            title.includes("appointment") ||
            title.includes("confirmed test drive")
        ) {
            return {
                reasonLabel: "Appointment Activity",
                reason: description,
            };
        }

        if (title.includes("called")) {
            return {
                reasonLabel: "Unreplied Customer Call",
                reason: description,
            };
        }

        if (title.includes("email")) {
            return {
                reasonLabel: "Unreplied Customer Email",
                reason: description,
            };
        }

        return {
            reasonLabel: "Unreplied Customer Message",
            reason: description,
        };
    }

    private formatDate(date: Date): string {
        const normalizedDate = new Date(date);
        const year = normalizedDate.getFullYear();
        const month = String(normalizedDate.getMonth() + 1).padStart(2, "0");
        const day = String(normalizedDate.getDate()).padStart(2, "0");

        return `${year}-${month}-${day}`;
    }

    private formatTime(date: Date): string {
        return new Intl.DateTimeFormat("en-CA", {
            hour: "numeric",
            minute: "2-digit",
        }).format(date);
    }

    private formatDisplayDate(date: Date): string {
        return new Intl.DateTimeFormat("en-CA", {
            month: "short",
            day: "numeric",
            year: "numeric",
        }).format(date);
    }

}
