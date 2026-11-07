import { Lead } from "@/domain/objects/Lead";
import { getLeadOutcome, leadStateAfterStageChange, leadStateForWrite } from "@/domain/objects/LeadOutcome";
import { ScoringService } from "@/domain/business/ScoringService";
import { AnalyticsService } from "@/domain/business/AnalyticsService";
import { AgendaService } from "@/domain/business/AgendaService";
import { PriorityManager } from "@/domain/business/PriorityManager";
import { makeLead, referenceDate } from "@/tests/fixtures/domain";

describe("lead outcomes across legacy records, scoring, analytics and agenda", () => {
    beforeEach(() => jest.useFakeTimers().setSystemTime(referenceDate));
    afterEach(() => jest.useRealTimers());

    it.each([
        ["NEW", true, "ACTIVE"], ["NEGOTIATION", false, "LOST"],
        ["DELIVERED", true, "DELIVERED"], [" delivered ", false, "DELIVERED"],
        ["CLOSED", true, "CLOSED"], [" closed ", false, "CLOSED"],
    ] as const)("stage=%s status=%s resolves consistently to %s without rewriting data", (stage, status, outcome) => {
        const lead = makeLead({ stage, status, score: 200, createdAt: referenceDate, followUpDate: referenceDate });
        const scoring = new ScoringService();
        const priorities = new PriorityManager(scoring);
        const agenda = new AgendaService(scoring, priorities);
        expect(getLeadOutcome(lead)).toBe(outcome);
        expect(lead.isActive()).toBe(outcome === "ACTIVE");
        expect(lead.isClosed()).toBe(outcome !== "ACTIVE");
        const analytics = new AnalyticsService(scoring).getAnalyticsSummary([lead], [], []);
        expect(analytics.conversionPerformance.leadDeliveryRatio.percentage).toBe(outcome === "DELIVERED" ? 100 : 0);
        expect(analytics.leadQuality.activeLeadRatio.percentage).toBe(outcome === "ACTIVE" ? 100 : 0);
        expect(analytics.salesClosingRateTrend[0].rate).toBe(outcome === "DELIVERED" ? 100 : 0);
        if (outcome !== "ACTIVE") {
            expect(analytics.leadQuality.hotLeadRatio.numerator).toBe(0);
            expect(scoring.calculatePriority(lead)).toMatchObject({ score: 0, level: "CLOSED" });
            expect(scoring.generateTimeline(lead)).toEqual([]);
            expect(agenda.getTodayAgenda([lead], [], referenceDate)).toEqual([]);
            expect(agenda.getSystemAssignedTasks([lead], [], referenceDate)).toEqual([]);
            expect(agenda.getMissingSystemAssignedTasksUpToDate([lead], [], referenceDate)).toEqual([]);
        }
        expect(lead.stage).toBe(stage);
        expect(lead.status).toBe(status);
    });

    it("only delivered leads enter the numerator; every outcome remains in the denominator", () => {
        const leads = [
            makeLead({ stage: "DELIVERED", status: false }),
            makeLead({ leadID: 2, stage: "CLOSED", status: false }),
            makeLead({ leadID: 3, stage: "CLOSED", status: true }),
            makeLead({ leadID: 4, stage: "NEW", status: false }),
            makeLead({ leadID: 5, stage: "NEW", status: true }),
        ];
        const result = new AnalyticsService(new ScoringService()).getAnalyticsSummary(leads, [], []);
        expect(result.conversionPerformance.leadDeliveryRatio).toMatchObject({ numerator: 1, denominator: 5, percentage: 20 });
        expect(result.salesClosingRateTrend[0].rate).toBe(20);
    });

    it.each(["CLOSED", "DELIVERED"])("explicit stage changes can reopen %s and resolve a closure as a delivery", (stage) => {
        const lead = new Lead({ firstName: "Legacy", stage, status: false });
        expect(leadStateAfterStageChange(lead, " contacted ")).toEqual({ stage: "CONTACTED", status: true });
        expect(leadStateAfterStageChange(lead, "DELIVERED")).toEqual({ stage: "DELIVERED", status: false });
        expect(leadStateForWrite({ stage: " closed ", status: true })).toEqual({ stage: "CLOSED", status: false });
        expect(lead.stage).toBe(stage);
        expect(lead.status).toBe(false);
    });

    it("editing an open lost lead does not implicitly reactivate it", () => {
        expect(leadStateAfterStageChange({ stage: "CONTACTED", status: false }, "NEGOTIATION"))
            .toEqual({ stage: "NEGOTIATION", status: false });
    });
});
