import { ScoringService } from "@/domain/business/ScoringService";
import { Lead } from "@/domain/objects/Lead";
import { getLeadOutcome } from "@/domain/objects/LeadOutcome";
import { Notification } from "@/domain/objects/Notification";
import { Task } from "@/domain/objects/Task";

const DEFAULT_BUDGET_THRESHOLD = 50000;
const HOT_LEAD_THRESHOLD = 80;

export type AnalyticsRatioMetric = {
    label: string;
    numerator: number;
    denominator: number;
    percentage: number;
    description: string;
    note?: string;
};

export type AnalyticsNumberMetric = {
    label: string;
    value: number;
    description: string;
    note?: string;
};

export type SalesClosingRateTrendPoint = {
    period: string;
    rate: number;
};

export type HotLeadsTrendPoint = {
    period: string;
    count: number;
};

export type AnalyticsSummary = {
    conversionPerformance: {
        leadAppointmentRatio: AnalyticsRatioMetric;
        leadDeliveryRatio: AnalyticsRatioMetric;
    };
    leadQuality: {
        activeLeadRatio: AnalyticsRatioMetric;
        hotLeadRatio: AnalyticsRatioMetric;
    };
    communicationEffectiveness: {
        engagementRatio: AnalyticsRatioMetric;
        twoWayCommunicationRatio: AnalyticsRatioMetric;
        followUpCompletionRatio: AnalyticsRatioMetric;
        onTimeFollowUpRatio: AnalyticsRatioMetric;
        averageTouchpointsPerLead: AnalyticsNumberMetric;
    };
    revenueInsights: {
        highValueLeadRatio: AnalyticsRatioMetric;
        budgetThresholdRatio: AnalyticsRatioMetric;
        budgetThreshold: number;
    };
    salesClosingRateTrend: SalesClosingRateTrendPoint[];
    hotLeadsTrend: HotLeadsTrendPoint[];
};

export class AnalyticsService {
    private scoringService: ScoringService;
    private budgetThreshold: number;

    constructor(
        scoringService: ScoringService,
        budgetThreshold = DEFAULT_BUDGET_THRESHOLD
    ) {
        this.scoringService = scoringService;
        this.budgetThreshold = budgetThreshold;
    }

    getAnalyticsSummary(
        leads: Lead[],
        tasks: Task[],
        notifications: Notification[]
    ): AnalyticsSummary {
        const totalLeads = leads.length;
        const leadIdsWithAppointments = this.getLeadIdsWithAppointments(
            tasks,
            notifications
        );
        const deliveredLeads = leads.filter((lead) => this.isDelivered(lead));
        const activeLeads = leads.filter((lead) => this.isActiveLead(lead));
        const hotLeads = leads.filter(
            (lead) => this.getLeadScore(lead) >= HOT_LEAD_THRESHOLD
        );
        const leadIdsWithCustomerResponse =
            this.getLeadIdsWithCustomerResponse(leads, notifications);
        const leadIdsWithOutbound = this.getLeadIdsWithOutboundActivity(
            tasks,
            notifications
        );
        const twoWayLeadCount = [...leadIdsWithOutbound].filter((leadId) =>
            leadIdsWithCustomerResponse.has(leadId)
        ).length;
        const completedFollowUps = tasks.filter((task) => task.isCompleted());
        const totalTouchpoints = this.getTotalTouchpoints(
            leads,
            tasks,
            notifications
        );
        const leadsAboveBudgetThreshold = leads.filter(
            (lead) => lead.budget >= this.budgetThreshold
        );
        const salesClosingRateTrend =
            this.getSalesClosingRateTrend(leads);
        const hotLeadsTrend = this.getHotLeadsTrend(leads);

        return {
            conversionPerformance: {
                leadAppointmentRatio: this.createRatioMetric({
                    label: "Appointment Conversion Rate",
                    numerator: leadIdsWithAppointments.size,
                    denominator: totalLeads,
                    description:
                        "Percentage of leads that progressed to an appointment.",
                }),
                leadDeliveryRatio: this.createRatioMetric({
                    label: "Deals Closing Rate",
                    numerator: deliveredLeads.length,
                    denominator: totalLeads,
                    description:
                        "Delivered leads divided by all leads. Lost and unconfirmed closed leads remain in the denominator; only delivered leads count as deals.",
                }),
            },
            leadQuality: {
                activeLeadRatio: this.createRatioMetric({
                    label: "Active Lead Ratio",
                    numerator: activeLeads.length,
                    denominator: totalLeads,
                    description:
                        "Active leads, excluding lost, delivered and unconfirmed closed leads.",
                }),
                hotLeadRatio: this.createRatioMetric({
                    label: "Hot Lead Ratio",
                    numerator: hotLeads.length,
                    denominator: totalLeads,
                    description:
                        "Leads with calculated score greater than or equal to 80.",
                }),
            },
            communicationEffectiveness: {
                engagementRatio: this.createRatioMetric({
                    label: "Engagement Ratio",
                    numerator: leadIdsWithCustomerResponse.size,
                    denominator: totalLeads,
                    description:
                        "Leads with a recorded customer response or confirmation.",
                }),
                twoWayCommunicationRatio: this.createRatioMetric({
                    label: "Two-Way Communication Ratio",
                    numerator: twoWayLeadCount,
                    denominator: totalLeads,
                    description:
                        "Leads with both salesperson outreach and customer response.",
                }),
                followUpCompletionRatio: this.createRatioMetric({
                    label: "Follow-Up Completion Ratio",
                    numerator: completedFollowUps.length,
                    denominator: tasks.length,
                    description:
                        "Completed follow-up tasks out of all scheduled follow-ups.",
                }),
                onTimeFollowUpRatio: this.createRatioMetric({
                    label: "On-Time Follow-Up Ratio",
                    numerator: 0,
                    denominator: completedFollowUps.length,
                    description:
                        "Completed follow-ups finished on or before their due date.",
                    note:
                        "Pending completion timestamp support in the tasks table.",
                }),
                averageTouchpointsPerLead: {
                    label: "Average Touchpoints Per Lead",
                    value:
                        totalLeads === 0
                            ? 0
                            : Number((totalTouchpoints / totalLeads).toFixed(1)),
                    description:
                        "Average tasks, notifications, notes, and recorded interactions per lead.",
                },
            },
            revenueInsights: {
                highValueLeadRatio: this.createRatioMetric({
                    label: "High-Value Lead Ratio",
                    numerator: 0,
                    denominator: deliveredLeads.length,
                    description:
                        "Delivered leads with discount below 5%.",
                    note:
                        "Pending delivery discount data in the database.",
                }),
                budgetThresholdRatio: this.createRatioMetric({
                    label: "Budget Threshold Ratio",
                    numerator: leadsAboveBudgetThreshold.length,
                    denominator: totalLeads,
                    description: `Leads with budget greater than or equal to $${this.budgetThreshold.toLocaleString("en-CA")}.`,
                }),
                budgetThreshold: this.budgetThreshold,
            },
            salesClosingRateTrend,
            hotLeadsTrend,
        };
    }

    private createRatioMetric({
        label,
        numerator,
        denominator,
        description,
        note,
    }: {
        label: string;
        numerator: number;
        denominator: number;
        description: string;
        note?: string;
    }): AnalyticsRatioMetric {
        return {
            label,
            numerator,
            denominator,
            percentage:
                denominator === 0
                    ? 0
                    : Math.round((numerator / denominator) * 100),
            description,
            note,
        };
    }

    private getLeadIdsWithAppointments(
        tasks: Task[],
        notifications: Notification[]
    ): Set<number> {
        const leadIds = new Set<number>();

        for (const task of tasks) {
            const leadId = task.getLead()?.leadID;

            if (leadId && this.isAppointmentText(task.getTitle())) {
                leadIds.add(leadId);
            }
        }

        for (const notification of notifications) {
            const leadId = notification.getLead()?.leadID;

            if (leadId && this.isAppointmentText(notification.getTitle())) {
                leadIds.add(leadId);
            }
        }

        return leadIds;
    }

    private getLeadIdsWithCustomerResponse(
        leads: Lead[],
        notifications: Notification[]
    ): Set<number> {
        const leadIds = new Set<number>();

        for (const lead of leads) {
            if (lead.lastInteractionBy === "LEAD") {
                leadIds.add(lead.leadID);
            }
        }

        for (const notification of notifications) {
            const leadId = notification.getLead()?.leadID;

            if (leadId && this.isCustomerResponseText(notification.getTitle())) {
                leadIds.add(leadId);
            }
        }

        return leadIds;
    }

    private getLeadIdsWithOutboundActivity(
        tasks: Task[],
        notifications: Notification[]
    ): Set<number> {
        const leadIds = new Set<number>();

        for (const task of tasks) {
            const leadId = task.getLead()?.leadID;

            if (leadId && this.isOutboundText(task.getTitle())) {
                leadIds.add(leadId);
            }
        }

        for (const notification of notifications) {
            const leadId = notification.getLead()?.leadID;

            if (leadId && this.isOutboundText(notification.getTitle())) {
                leadIds.add(leadId);
            }
        }

        return leadIds;
    }

    private getTotalTouchpoints(
        leads: Lead[],
        tasks: Task[],
        notifications: Notification[]
    ): number {
        const recordedLeadInteractions = leads.filter(
            (lead) => lead.lastInteractionDate !== null
        ).length;
        const notes = leads.filter((lead) => lead.notes.trim() !== "").length;

        return (
            tasks.length +
            notifications.length +
            recordedLeadInteractions +
            notes
        );
    }

    private getLeadScore(lead: Lead): number {
        if (!this.isActiveLead(lead)) {
            return 0;
        }

        return Math.max(lead.score, this.scoringService.calculateScore(lead));
    }

    private getSalesClosingRateTrend(
        leads: Lead[]
    ): SalesClosingRateTrendPoint[] {
        const periodMap = this.groupLeadsByCreatedPeriod(leads);

        return [...periodMap.entries()].map(([periodKey, periodLeads]) => {
            const deliveredCount = periodLeads.filter((lead) =>
                this.isDelivered(lead)
            ).length;

            return {
                period: this.formatPeriodLabel(periodKey),
                rate:
                    periodLeads.length === 0
                        ? 0
                        : Math.round(
                              (deliveredCount / periodLeads.length) * 100
                          ),
            };
        });
    }

    private getHotLeadsTrend(leads: Lead[]): HotLeadsTrendPoint[] {
        const periodMap = this.groupLeadsByCreatedPeriod(leads);

        return [...periodMap.entries()].map(([periodKey, periodLeads]) => ({
            period: this.formatPeriodLabel(periodKey),
            count: periodLeads.filter(
                (lead) => this.getLeadScore(lead) >= HOT_LEAD_THRESHOLD
            ).length,
        }));
    }

    private groupLeadsByCreatedPeriod(leads: Lead[]): Map<string, Lead[]> {
        const periodMap = new Map<string, Lead[]>();

        for (const lead of leads) {
            const periodKey = this.getPeriodKey(lead.createdAt);
            const periodLeads = periodMap.get(periodKey) ?? [];
            periodLeads.push(lead);
            periodMap.set(periodKey, periodLeads);
        }

        return new Map(
            [...periodMap.entries()].sort(([periodA], [periodB]) =>
                periodA.localeCompare(periodB)
            )
        );
    }

    private getPeriodKey(date: Date): string {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, "0");

        return `${year}-${month}`;
    }

    private formatPeriodLabel(periodKey: string): string {
        const [year, month] = periodKey.split("-").map(Number);
        const date = new Date(year, month - 1, 1);

        return new Intl.DateTimeFormat("en-CA", {
            month: "short",
            year: "numeric",
        }).format(date);
    }

    private isActiveLead(lead: Lead): boolean {
        return lead.isActive();
    }

    private isDelivered(lead: Lead): boolean {
        return getLeadOutcome(lead) === "DELIVERED";
    }

    private isAppointmentText(value: string): boolean {
        const normalizedValue = value.toLowerCase();

        return (
            normalizedValue.includes("appointment") ||
            normalizedValue.includes("test drive") ||
            normalizedValue.includes("meeting") ||
            normalizedValue.includes("confirmed")
        );
    }

    private isCustomerResponseText(value: string): boolean {
        const normalizedValue = value.toLowerCase();

        return (
            normalizedValue.includes("reply") ||
            normalizedValue.includes("replied") ||
            normalizedValue.includes("answered") ||
            normalizedValue.includes("confirmed") ||
            normalizedValue.includes("customer response")
        );
    }

    private isOutboundText(value: string): boolean {
        const normalizedValue = value.toLowerCase();

        return (
            normalizedValue.includes("call") ||
            normalizedValue.includes("send") ||
            normalizedValue.includes("sent") ||
            normalizedValue.includes("email") ||
            normalizedValue.includes("message") ||
            normalizedValue.includes("follow")
        );
    }
}
