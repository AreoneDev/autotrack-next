import { Lead } from "@/domain/objects/Lead";
import { Task } from "@/domain/objects/Task";

export type LeadPriorityLevel = "HOT" | "HIGH" | "MEDIUM" | "LOW" | "CLOSED";

export type LeadPriorityResult = {
    score: number;
    level: LeadPriorityLevel;
    hasStrongBuyingIntent: boolean;
    reasons: string[];
};

export class ScoringService {
    static readonly THRESHOLD = 100;
    static readonly HOT_THRESHOLD = 130;
    static readonly MEDIUM_THRESHOLD = 55;

    private readonly silentMilestones = [3, 8, 15, 30, 90, 180, 365];

    calculateScore(lead: Lead): number {
        if (this.isClosedLead(lead)) {
            return 0;
        }

        return this.calculatePriority(lead).score;
    }

    calculatePriority(lead: Lead): LeadPriorityResult {
        const reasons: string[] = [];

        if (this.isClosedLead(lead)) {
            return {
                score: 0,
                level: "CLOSED",
                hasStrongBuyingIntent: false,
                reasons: ["Lead is closed and excluded from active follow-up."],
            };
        }

        const stageWeight = this.getStageWeight(lead.stage);
        let score = stageWeight;

        reasons.push(`${this.normalizeStage(lead.stage)} stage base score ${stageWeight}.`);

        const engagementResult = this.getEngagementWeight(lead);
        score += engagementResult.score;
        reasons.push(...engagementResult.reasons);

        const timeResult = this.getTimeWeight(lead);
        score += timeResult.score;
        reasons.push(...timeResult.reasons);
        score = Math.max(0, score);

        const hasStrongBuyingIntent = this.hasStrongBuyingIntent(lead);

        return {
            score,
            level: this.classifyPriority(lead, score, hasStrongBuyingIntent),
            hasStrongBuyingIntent,
            reasons: this.buildPriorityReasons(
                reasons,
                score,
                hasStrongBuyingIntent
            ),
        };
    }

    getPriorityLevel(lead: Lead): LeadPriorityLevel {
        return this.calculatePriority(lead).level;
    }

    getPriorityReasons(lead: Lead): string[] {
        return this.calculatePriority(lead).reasons;
    }

    getSilentMilestoneForDate(lead: Lead | null, targetDate: Date): number | null {
        if (!lead || !lead.createdAt || this.isClosedLead(lead)) {
            return null;
        }

        const pivotDate =
            lead.lastInteractionDate !== null &&
            lead.lastInteractionBy === "LEAD"
                ? lead.lastInteractionDate
                : lead.createdAt;
        const daysFromPivot = this.getDaysDiff(
            this.resetTime(pivotDate),
            this.resetTime(targetDate)
        );

        return this.silentMilestones.includes(daysFromPivot)
            ? daysFromPivot
            : null;
    }

    shouldCreateInitialGratitudeTask(
        lead: Lead | null,
        targetDate: Date
    ): boolean {
        if (!lead || !lead.createdAt || this.isClosedLead(lead)) {
            return false;
        }

        return (
            this.getDaysDiff(
                this.resetTime(lead.createdAt),
                this.resetTime(targetDate)
            ) === 0
        );
    }

    getScientificMission(
        lead: Lead | null,
        targetDate: Date,
        existingTasks: Task[] = []
    ): string | null {
        if (!lead || !lead.createdAt || this.isClosedLead(lead)) {
            return null;
        }

        const targetDateStr = this.formatDate(targetDate);

        for (const task of existingTasks) {
            if (
                task.getLead()?.leadID === lead.leadID &&
                this.formatDate(task.getDate()) === targetDateStr
            ) {
                return task.getTitle();
            }
        }

        const createdDate = this.resetTime(lead.createdAt);
        const target = this.resetTime(targetDate);

        if (this.getDaysDiff(createdDate, target) === 0) {
            return "Gratitude: Thank You & Info Swap";
        }

        const pivotDate =
            lead.lastInteractionDate !== null &&
            lead.lastInteractionBy === "LEAD"
                ? lead.lastInteractionDate
                : lead.createdAt;

        const daysFromPivot = this.getDaysDiff(
            this.resetTime(pivotDate),
            target
        );

        if (
            lead.lastInteractionBy === "LEAD" &&
            daysFromPivot >= 0 &&
            daysFromPivot <= 2
        ) {
            return "URGENT: Lead replied. Respond within 48h!";
        }

        for (const milestone of this.silentMilestones) {
            if (daysFromPivot === milestone) {
                return this.getMissionNameByDay(milestone);
            }
        }

        const priority = this.calculatePriority(lead);

        if (priority.level === "HOT" || priority.level === "HIGH") {
            return `${priority.level} Priority: Nurture ${lead.stage} (Score: ${Math.floor(priority.score)})`;
        }

        return `Standard Follow-up: ${lead.stage}`;
    }

    generateTimeline(lead: Lead | null, existingTasks: Task[] = []): Task[] {
        const timeline: Task[] = [];

        if (!lead || !lead.createdAt || this.isClosedLead(lead)) {
            return timeline;
        }

        timeline.push(
            ...existingTasks.filter((task) => task.getLead()?.leadID === lead.leadID)
        );

        const today = this.resetTime(new Date());

        const gratitudeTitle = "Gratitude: Thank You & Info Swap";

        if (!this.containsTask(timeline, gratitudeTitle)) {
            const creationDay = this.resetTime(lead.createdAt);

            if (creationDay <= today) {
                const task = new Task(lead, gratitudeTitle, creationDay);
                timeline.push(task);
            }
        }

        const urgentTitle = "URGENT: Lead replied. Respond within 48h!";

        if (
            lead.lastInteractionBy === "LEAD" &&
            !this.containsTask(timeline, urgentTitle)
        ) {
            const urgentTask = new Task(lead, urgentTitle, today);

            const daysFromPivot = this.getDaysDiff(
                this.resetTime(lead.lastInteractionDate ?? lead.createdAt),
                today
            );

            urgentTask.setCompleted(daysFromPivot > 2);
            timeline.push(urgentTask);
        }

        const pivotDate =
            lead.lastInteractionDate !== null &&
            lead.lastInteractionBy === "LEAD"
                ? lead.lastInteractionDate
                : lead.createdAt;

        for (const milestone of this.silentMilestones) {
            const title = this.getMissionNameByDay(milestone);

            if (!this.containsTask(timeline, title)) {
                const milestoneDate = this.addDays(pivotDate, milestone);

                if (milestoneDate <= today) {
                    const task = new Task(lead, title, milestoneDate);
                    timeline.push(task);
                }
            }
        }

        return timeline.sort(
            (taskA, taskB) => taskA.getDate().getTime() - taskB.getDate().getTime()
        );
    }

    private getStageWeight(stage: string | null | undefined): number {
        const normalizedStage = this.normalizeStage(stage);

        switch (normalizedStage) {
            case "NEW":
                return 20;
            case "CONTACTED":
                return 35;
            case "VISITED":
                return 55;
            case "APPOINTMENT":
                return 65;
            case "TEST_DRIVE":
                return 75;
            case "NEGOTIATION":
                return 110;
            case "CLOSED":
                return 0;
            default:
                return 10;
        }
    }

    private getTimeWeight(lead: Lead): { score: number; reasons: string[] } {
        const pivotDate = lead.lastInteractionDate || lead.createdAt;

        if (!pivotDate) {
            return { score: 0, reasons: [] };
        }

        const daysSilent = this.getDaysDiff(
            this.resetTime(pivotDate),
            this.resetTime(new Date())
        );

        if (daysSilent >= 90) {
            return {
                score: -60,
                reasons: ["Lead is long silent and should be treated as reactivation."],
            };
        }

        if (daysSilent >= 30) {
            return {
                score: -40,
                reasons: ["Lead has been silent for 30+ days."],
            };
        }

        if (daysSilent >= 15) {
            return {
                score: -25,
                reasons: ["Lead has been silent for 15+ days."],
            };
        }

        if (daysSilent >= 8) {
            return {
                score: -15,
                reasons: ["Lead has been silent for 8+ days."],
            };
        }

        if (daysSilent >= 3) {
            return {
                score: -5,
                reasons: ["Lead has been silent for 3+ days."],
            };
        }

        return { score: 0, reasons: [] };
    }

    private getEngagementWeight(lead: Lead): {
        score: number;
        reasons: string[];
    } {
        let engagementScore = 0;
        const notes = lead.notes ? lead.notes.toLowerCase() : "";
        const reasons: string[] = [];

        if (this.hasRecentLeadReply(lead)) {
            engagementScore += 30;
            reasons.push("Recent reply from the lead.");
        }

        if (
            notes.includes("hot") ||
            notes.includes("ready") ||
            notes.includes("urgent") ||
            notes.includes("interested")
        ) {
            engagementScore += 20;
            reasons.push("Notes contain hot, ready, urgent, or interested buying intent.");
        }

        if (this.hasMultipleShowroomVisits(lead)) {
            engagementScore += 20;
            reasons.push("Multiple showroom visits indicate stronger intent.");
        }

        if (this.hasCompletedTestDrive(lead)) {
            engagementScore += 20;
            reasons.push("Test drive completed.");
        }

        if (this.hasSecondTestDrive(lead)) {
            engagementScore += 15;
            reasons.push("Second test drive requested or completed.");
        }

        if (this.hasPriceNegotiationSignal(lead)) {
            engagementScore += 30;
            reasons.push("Price negotiation signal found.");
        }

        return { score: engagementScore, reasons };
    }

    private classifyPriority(
        lead: Lead,
        score: number,
        hasStrongBuyingIntent: boolean
    ): LeadPriorityLevel {
        const stage = this.normalizeStage(lead.stage);

        if (
            hasStrongBuyingIntent &&
            score >= ScoringService.HOT_THRESHOLD &&
            (stage === "NEGOTIATION" ||
                stage === "TEST_DRIVE" ||
                stage === "APPOINTMENT")
        ) {
            return "HOT";
        }

        if (
            (stage === "NEGOTIATION" && score >= ScoringService.THRESHOLD) ||
            (stage === "TEST_DRIVE" && hasStrongBuyingIntent) ||
            (stage === "APPOINTMENT" && hasStrongBuyingIntent) ||
            (score >= ScoringService.THRESHOLD && hasStrongBuyingIntent)
        ) {
            return "HIGH";
        }

        if (score >= ScoringService.MEDIUM_THRESHOLD) {
            return "MEDIUM";
        }

        return "LOW";
    }

    private buildPriorityReasons(
        reasons: string[],
        score: number,
        hasStrongBuyingIntent: boolean
    ): string[] {
        const priorityReasons = [...reasons];

        if (hasStrongBuyingIntent) {
            priorityReasons.push("Strong buying intent signal detected.");
        }

        if (score >= ScoringService.HOT_THRESHOLD && !hasStrongBuyingIntent) {
            priorityReasons.push(
                "Score is high, but HOT priority requires strong buying intent."
            );
        }

        return priorityReasons.slice(0, 5);
    }

    private hasStrongBuyingIntent(lead: Lead): boolean {
        const stage = this.normalizeStage(lead.stage);

        return (
            stage === "NEGOTIATION" ||
            stage === "APPOINTMENT" ||
            this.hasRecentLeadReply(lead) ||
            this.hasUrgencyKeywords(lead) ||
            this.hasMultipleShowroomVisits(lead) ||
            this.hasCompletedTestDrive(lead) ||
            this.hasSecondTestDrive(lead) ||
            this.hasPriceNegotiationSignal(lead)
        );
    }

    private hasRecentLeadReply(lead: Lead): boolean {
        if (lead.lastInteractionBy !== "LEAD" || !lead.lastInteractionDate) {
            return false;
        }

        const daysSinceReply = this.getDaysDiff(
            this.resetTime(lead.lastInteractionDate),
            this.resetTime(new Date())
        );

        return daysSinceReply >= 0 && daysSinceReply <= 3;
    }

    private hasUrgencyKeywords(lead: Lead): boolean {
        const notes = lead.notes ? lead.notes.toLowerCase() : "";

        return (
            notes.includes("hot") ||
            notes.includes("ready") ||
            notes.includes("urgent") ||
            notes.includes("interested")
        );
    }

    private hasMultipleShowroomVisits(lead: Lead): boolean {
        const notes = lead.notes ? lead.notes.toLowerCase() : "";

        return (
            notes.includes("multiple visit") ||
            notes.includes("second visit") ||
            notes.includes("visited twice") ||
            notes.includes("two visits") ||
            notes.includes("2 visits") ||
            notes.includes("came back")
        );
    }

    private hasCompletedTestDrive(lead: Lead): boolean {
        const notes = lead.notes ? lead.notes.toLowerCase() : "";

        return (
            notes.includes("test drive completed") ||
            notes.includes("completed test drive")
        );
    }

    private hasSecondTestDrive(lead: Lead): boolean {
        const notes = lead.notes ? lead.notes.toLowerCase() : "";

        return (
            notes.includes("second test drive") ||
            notes.includes("2nd test drive") ||
            notes.includes("another test drive")
        );
    }

    private hasPriceNegotiationSignal(lead: Lead): boolean {
        const notes = lead.notes ? lead.notes.toLowerCase() : "";

        return (
            notes.includes("price") ||
            notes.includes("discount") ||
            notes.includes("deal") ||
            notes.includes("trade-in") ||
            notes.includes("trade in") ||
            notes.includes("finance") ||
            notes.includes("financing") ||
            notes.includes("lease") ||
            notes.includes("monthly payment") ||
            notes.includes("payment")
        );
    }

    private isClosedLead(lead: Lead): boolean {
        return !lead.status || this.normalizeStage(lead.stage) === "CLOSED";
    }

    private normalizeStage(stage: string | null | undefined): string {
        const normalizedStage = stage ? stage.toUpperCase() : "DEFAULT";

        if (normalizedStage === "DELIVERED") {
            return "CLOSED";
        }

        return normalizedStage;
    }

    private getMissionNameByDay(day: number): string {
        switch (day) {
            case 3:
                return "Quick check-in: Gratitude follow-up";
            case 8:
                return "New idea: Vehicle option follow-up";
            case 15:
                return "Market update: Inventory follow-up";
            case 30:
                return "Long-term check-in";
            case 90:
                return "Low-pressure reactivation follow-up";
            case 180:
                return "Low-pressure reactivation follow-up";
            case 365:
                return "Low-pressure reactivation follow-up";
            default:
                return "Follow up";
        }
    }

    private containsTask(taskList: Task[], title: string): boolean {
        return taskList.some((task) => task.getTitle() === title);
    }

    private addDays(date: Date, days: number): Date {
        const result = new Date(date);
        result.setDate(result.getDate() + days);
        return this.resetTime(result);
    }

    private getDaysDiff(startDate: Date, endDate: Date): number {
        const millisecondsPerDay = 24 * 60 * 60 * 1000;
        // Cadence follows local calendar days, including 23/25-hour DST days.
        const startDay = Date.UTC(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());
        const endDay = Date.UTC(endDate.getFullYear(), endDate.getMonth(), endDate.getDate());
        return Math.floor(
            (endDay - startDay) / millisecondsPerDay
        );
    }

    private resetTime(date: Date): Date {
        const result = new Date(date);
        result.setHours(0, 0, 0, 0);
        return result;
    }

    private formatDate(date: Date): string {
        const normalizedDate = new Date(date);
        const year = normalizedDate.getFullYear();
        const month = String(normalizedDate.getMonth() + 1).padStart(2, "0");
        const day = String(normalizedDate.getDate()).padStart(2, "0");

        return `${year}-${month}-${day}`;
    }
}
