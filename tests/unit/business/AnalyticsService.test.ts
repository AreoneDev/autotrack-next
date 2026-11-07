import { AnalyticsService } from "@/domain/business/AnalyticsService";
import { ScoringService } from "@/domain/business/ScoringService";
import { makeLead, makeNotification, makeTask, referenceDate } from "@/tests/fixtures/domain";

describe("AN — analytics rules (equivalence partitions, boundaries, decision tables)", () => {
    const scoring = new ScoringService();
    const service = new AnalyticsService(scoring);

    beforeEach(() => {
        jest.useFakeTimers().setSystemTime(referenceDate);
    });
    afterEach(() => jest.useRealTimers());

    it("AN-01: empty denominators produce zero metrics and empty trends", () => {
        const result = service.getAnalyticsSummary([], [], []);
        const ratios = [
            ...Object.values(result.conversionPerformance),
            ...Object.values(result.leadQuality),
            result.communicationEffectiveness.engagementRatio,
            result.communicationEffectiveness.twoWayCommunicationRatio,
            result.communicationEffectiveness.followUpCompletionRatio,
            result.communicationEffectiveness.onTimeFollowUpRatio,
            result.revenueInsights.highValueLeadRatio,
            result.revenueInsights.budgetThresholdRatio,
        ];
        ratios.forEach((metric) => expect(metric).toMatchObject({ numerator: 0, denominator: 0, percentage: 0 }));
        expect(result.communicationEffectiveness.averageTouchpointsPerLead.value).toBe(0);
        expect(result.salesClosingRateTrend).toEqual([]);
        expect(result.hotLeadsTrend).toEqual([]);
    });

    it.each([49999, 50000, 50001])("AN-02: budget boundary %i", (budget) => {
        const result = service.getAnalyticsSummary([makeLead({ budget })], [], []);
        expect(result.revenueInsights.budgetThresholdRatio.percentage).toBe(budget < 50000 ? 0 : 100);
    });

    it("AN-03: a configured budget threshold replaces the default", () => {
        const result = new AnalyticsService(scoring, 75000).getAnalyticsSummary(
            [makeLead({ budget: 74999 }), makeLead({ leadID: 2, budget: 75000 })], [], []
        );
        expect(result.revenueInsights.budgetThreshold).toBe(75000);
        expect(result.revenueInsights.budgetThresholdRatio.percentage).toBe(50);
    });

    it.each([79, 80, 81])("AN-04: hot lead score boundary %i", (score) => {
        const result = service.getAnalyticsSummary([makeLead({ score })], [], []);
        expect(result.leadQuality.hotLeadRatio.percentage).toBe(score < 80 ? 0 : 100);
    });

    it("AN-05: current calculated scores can qualify a lead with a low stored score", () => {
        const result = service.getAnalyticsSummary([makeLead({ stage: "NEGOTIATION", createdAt: referenceDate })], [], []);
        expect(result.leadQuality.hotLeadRatio.numerator).toBe(1);
    });

    it("inactive and terminal leads cannot qualify as hot through stale stored scores", () => {
        const result = service.getAnalyticsSummary([
            makeLead({ status: false, stage: "NEGOTIATION", score: 200 }),
            makeLead({ leadID: 2, stage: "DELIVERED", score: 200 }),
            makeLead({ leadID: 3, stage: "CLOSED", score: 200 }),
        ], [], []);
        expect(result.leadQuality.hotLeadRatio.numerator).toBe(0);
        expect(result.hotLeadsTrend.map((point) => point.count)).toEqual([0]);
    });

    it.each([
        [true, "NEW", 100, 0],
        [false, "NEW", 0, 0],
        [true, "delivered", 0, 100],
        [false, "CLOSED", 0, 0],
        [true, " CLOSED ", 0, 0],
        [false, " delivered ", 0, 100],
    ])("AN-06: active=%s stage=%s", (status, stage, active, delivered) => {
        const result = service.getAnalyticsSummary([makeLead({ status, stage })], [], []);
        expect(result.leadQuality.activeLeadRatio.percentage).toBe(active);
        expect(result.conversionPerformance.leadDeliveryRatio.percentage).toBe(delivered);
    });

    it("AN-07: appointments and customer replies count unique leads across sources", () => {
        const lead = makeLead({ lastInteractionBy: "LEAD" });
        const result = service.getAnalyticsSummary(
            [lead, makeLead({ leadID: 2 }), makeLead({ leadID: 3 })],
            [makeTask(lead, "TEST DRIVE"), makeTask(lead, "Call customer")],
            [makeNotification("Appointment confirmed", lead), makeNotification("Customer replied", lead)]
        );
        expect(result.conversionPerformance.leadAppointmentRatio).toMatchObject({ numerator: 1, denominator: 3, percentage: 33 });
        expect(result.communicationEffectiveness.engagementRatio.numerator).toBe(1);
        expect(result.communicationEffectiveness.twoWayCommunicationRatio.numerator).toBe(1);
    });

    it.each([
        [false, false, 0], [true, false, 0], [false, true, 0], [true, true, 100],
    ])("AN-08: outbound=%s response=%s", (outbound, response, expected) => {
        const lead = makeLead({ lastInteractionBy: response ? "LEAD" : "USER" });
        const result = service.getAnalyticsSummary([lead], outbound ? [makeTask(lead)] : [], []);
        expect(result.communicationEffectiveness.twoWayCommunicationRatio.percentage).toBe(expected);
    });

    it("AN-09: completion and touchpoints include notes and interactions with correct rounding", () => {
        const lead = makeLead({ notes: "Interested", lastInteractionDate: referenceDate });
        const completed = makeTask(lead);
        completed.setCompleted(true);
        const result = service.getAnalyticsSummary(
            [lead, makeLead({ leadID: 2, notes: "   " }), makeLead({ leadID: 3 })],
            [completed, makeTask(lead, "Email", 11)], [makeNotification("Reminder", lead)]
        );
        expect(result.communicationEffectiveness.followUpCompletionRatio.percentage).toBe(50);
        expect(result.communicationEffectiveness.averageTouchpointsPerLead.value).toBe(1.7);
        expect(result.communicationEffectiveness.onTimeFollowUpRatio.note).toMatch(/Pending/);
        expect(result.revenueInsights.highValueLeadRatio.note).toMatch(/Pending/);
    });

    it("AN-10: trends group across year boundaries and sort chronologically", () => {
        const result = service.getAnalyticsSummary([
            makeLead({ createdAt: new Date(2026, 0, 1), score: 80 }),
            makeLead({ leadID: 2, createdAt: new Date(2025, 11, 31), stage: "CLOSED" }),
            makeLead({ leadID: 3, createdAt: new Date(2026, 0, 31), stage: "DELIVERED" }),
        ], [], []);
        expect(result.salesClosingRateTrend.map((point) => point.rate)).toEqual([0, 50]);
        expect(result.hotLeadsTrend.map((point) => point.count)).toEqual([0, 1]);
        expect(result.salesClosingRateTrend[0].period).toMatch(/Dec.*2025/);
        expect(result.salesClosingRateTrend[1].period).toMatch(/Jan.*2026/);
    });
});
