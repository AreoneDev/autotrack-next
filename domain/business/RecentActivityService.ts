import { Lead } from "@/domain/objects/Lead";
import { getLeadOutcome, leadOutcomeLabels } from "@/domain/objects/LeadOutcome";
import { Notification } from "@/domain/objects/Notification";
import { Task } from "@/domain/objects/Task";

export type RecentActivityType =
    | "lead_added"
    | "lead_updated"
    | "message"
    | "email"
    | "call"
    | "task_completed"
    | "appointment"
    | "reminder";

export type RecentActivitySource = "lead" | "user" | "system";

export type RecentActivityItem = {
    id: string;
    type: RecentActivityType;
    source: RecentActivitySource;
    label: string;
    detail: string;
    leadId: number | null;
    leadName: string | null;
    timestamp: Date;
    time: string;
    unread: boolean;
};

export class RecentActivityService {
    getRecentActivities({
        leads,
        tasks,
        notifications,
        referenceDate,
        limit = 30,
    }: {
        leads: Lead[];
        tasks: Task[];
        notifications: Notification[];
        referenceDate: Date;
        limit?: number;
    }): RecentActivityItem[] {
        const leadMap = new Map(leads.map((lead) => [lead.leadID, lead]));

        return [
            ...this.getLeadActivities(leads, referenceDate),
            ...this.getTaskActivities(tasks, leadMap, referenceDate),
            ...this.getNotificationActivities(
                notifications,
                leadMap,
                referenceDate
            ),
        ]
            .sort(
                (activityA, activityB) =>
                    activityB.timestamp.getTime() -
                    activityA.timestamp.getTime()
            )
            .slice(0, limit);
    }

    getTopbarNotifications({
        leads,
        notifications,
        referenceDate,
        limit = 5,
    }: {
        leads: Lead[];
        notifications: Notification[];
        referenceDate: Date;
        limit?: number;
    }): RecentActivityItem[] {
        const leadMap = new Map(leads.map((lead) => [lead.leadID, lead]));

        return this.getNotificationActivities(
            notifications,
            leadMap,
            referenceDate
        )
            .filter(
                (activity) =>
                    activity.source === "lead" &&
                    ["message", "email", "call", "appointment"].includes(
                        activity.type
                    )
            )
            .sort(
                (activityA, activityB) =>
                    activityB.timestamp.getTime() -
                    activityA.timestamp.getTime()
            )
            .slice(0, limit);
    }

    private getLeadActivities(
        leads: Lead[],
        referenceDate: Date
    ): RecentActivityItem[] {
        return leads.flatMap((lead) => {
            const activities: RecentActivityItem[] = [
                {
                    id: `lead-added-${lead.leadID}`,
                    type: "lead_added",
                    source: "user",
                    label: "New lead added",
                    detail: `${lead.getLeadName()} was added to the CRM.`,
                    leadId: lead.leadID,
                    leadName: lead.getLeadName(),
                    timestamp: lead.createdAt,
                    time: this.formatRelativeTime(
                        lead.createdAt,
                        referenceDate
                    ),
                    unread: false,
                },
            ];

            if (lead.lastInteractionDate) {
                activities.push({
                    id: `lead-updated-${lead.leadID}-${lead.lastInteractionDate.getTime()}`,
                    type: "lead_updated",
                    source:
                        lead.lastInteractionBy === "LEAD" ? "lead" : "user",
                    label: "Lead activity updated",
                    detail: `${lead.stage} lead marked ${leadOutcomeLabels[getLeadOutcome(lead)].toLowerCase()}.`,
                    leadId: lead.leadID,
                    leadName: lead.getLeadName(),
                    timestamp: lead.lastInteractionDate,
                    time: this.formatRelativeTime(
                        lead.lastInteractionDate,
                        referenceDate
                    ),
                    unread: lead.lastInteractionBy === "LEAD",
                });
            }

            return activities;
        });
    }

    private getTaskActivities(
        tasks: Task[],
        leadMap: Map<number, Lead>,
        referenceDate: Date
    ): RecentActivityItem[] {
        return tasks
            .filter((task) => task.isCompleted())
            .map((task): RecentActivityItem => {
                const leadId = task.getLead()?.leadID ?? null;
                const lead = leadId ? leadMap.get(leadId) : null;

                return {
                    id: `task-completed-${task.getEventID()}`,
                    type: "task_completed",
                    source: "user",
                    label: "Task completed",
                    detail: task.getTitle(),
                    leadId,
                    leadName: lead?.getLeadName() ?? null,
                    timestamp: task.getDate(),
                    time: this.formatRelativeTime(
                        task.getDate(),
                        referenceDate
                    ),
                    unread: false,
                };
            });
    }

    private getNotificationActivities(
        notifications: Notification[],
        leadMap: Map<number, Lead>,
        referenceDate: Date
    ): RecentActivityItem[] {
        return notifications.map((notification): RecentActivityItem => {
            const leadId = notification.getLead()?.leadID ?? null;
            const lead = leadId ? leadMap.get(leadId) : null;
            const type = this.getNotificationActivityType(
                notification.getTitle()
            );
            const source = this.getNotificationSource(notification.getTitle());

            return {
                id: `notification-${notification.getEventID()}`,
                type,
                source,
                label: this.getActivityLabel(type, source),
                detail: notification.getTitle(),
                leadId,
                leadName: lead?.getLeadName() ?? null,
                timestamp: notification.getDate(),
                time: this.formatRelativeTime(
                    notification.getDate(),
                    referenceDate
                ),
                unread: source === "lead",
            };
        });
    }

    private getNotificationActivityType(title: string): RecentActivityType {
        const normalizedTitle = title.toLowerCase();

        if (
            normalizedTitle.includes("appointment") ||
            normalizedTitle.includes("test drive") ||
            normalizedTitle.includes("confirmed")
        ) {
            return "appointment";
        }

        if (
            normalizedTitle.includes("call") ||
            normalizedTitle.includes("called") ||
            normalizedTitle.includes("phone")
        ) {
            return "call";
        }

        if (
            normalizedTitle.includes("email") ||
            normalizedTitle.includes("replied to your email") ||
            normalizedTitle.includes("email reply")
        ) {
            return "email";
        }

        if (
            normalizedTitle.includes("message") ||
            normalizedTitle.includes("reply") ||
            normalizedTitle.includes("sms") ||
            normalizedTitle.includes("text") ||
            normalizedTitle.includes("sent")
        ) {
            return "message";
        }

        return "reminder";
    }

    private getNotificationSource(title: string): RecentActivitySource {
        const normalizedTitle = title.toLowerCase();

        if (
            normalizedTitle.includes("you sent") ||
            normalizedTitle.includes("you called") ||
            normalizedTitle.includes("you emailed") ||
            normalizedTitle.includes("you booked") ||
            normalizedTitle.includes("you confirmed")
        ) {
            return "user";
        }

        if (
            normalizedTitle.includes("sent you") ||
            normalizedTitle.includes("replied") ||
            normalizedTitle.includes("called you") ||
            normalizedTitle.includes("incoming") ||
            normalizedTitle.includes("confirmed appointment") ||
            normalizedTitle.includes("appointment confirmed") ||
            normalizedTitle.includes("confirmed test drive")
        ) {
            return "lead";
        }

        return "system";
    }

    private getActivityLabel(
        type: RecentActivityType,
        source: RecentActivitySource
    ): string {
        if (source === "lead") {
            if (type === "call") {
                return "Incoming call";
            }

            if (type === "message") {
                return "Incoming message";
            }

            if (type === "email") {
                return "Incoming email";
            }

            if (type === "appointment") {
                return "Incoming appointment";
            }
        }

        switch (type) {
            case "appointment":
                return "Appointment confirmed";
            case "call":
                return "Call logged";
            case "email":
                return "Email sent";
            case "message":
                return "Customer message sent";
            case "task_completed":
                return "Task completed";
            case "lead_added":
                return "New lead added";
            case "lead_updated":
                return "Lead stage/status changed";
            default:
                return "Reminder triggered";
        }
    }

    private formatRelativeTime(date: Date, referenceDate: Date): string {
        const diffMilliseconds =
            referenceDate.getTime() - date.getTime();
        const absDiffMilliseconds = Math.abs(diffMilliseconds);
        const minute = 60 * 1000;
        const hour = 60 * minute;
        const day = 24 * hour;

        if (absDiffMilliseconds < minute) {
            return "Just now";
        }

        if (absDiffMilliseconds < hour) {
            const minutes = Math.max(
                1,
                Math.round(absDiffMilliseconds / minute)
            );
            return diffMilliseconds >= 0
                ? `${minutes} minutes ago`
                : `In ${minutes} minutes`;
        }

        if (absDiffMilliseconds < day) {
            const hours = Math.max(1, Math.round(absDiffMilliseconds / hour));
            return diffMilliseconds >= 0
                ? `${hours} hours ago`
                : `In ${hours} hours`;
        }

        const days = Math.max(1, Math.round(absDiffMilliseconds / day));

        return diffMilliseconds >= 0
            ? `${days} days ago`
            : `In ${days} days`;
    }
}
