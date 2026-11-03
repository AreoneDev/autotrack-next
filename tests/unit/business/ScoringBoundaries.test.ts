import { ScoringService } from "@/domain/business/ScoringService";
import { makeLead, referenceDate } from "@/tests/fixtures/domain";

describe("SC — scoring boundary value analysis", () => {
    const service = new ScoringService();
    beforeEach(() => jest.useFakeTimers().setSystemTime(referenceDate));
    afterEach(() => jest.useRealTimers());

    it.each([
        [2, 110], [3, 105], [4, 105],
        [7, 105], [8, 95], [9, 95],
        [14, 95], [15, 85], [16, 85],
        [29, 85], [30, 70], [31, 70],
        [89, 70], [90, 50], [91, 50],
    ])("SC-01: %i silent days produces %i points", (days, score) => {
        const createdAt = new Date(referenceDate);
        createdAt.setDate(createdAt.getDate() - days);
        expect(service.calculateScore(makeLead({ stage: "NEGOTIATION", createdAt }))).toBe(score);
    });

    it.each([3, 8, 15, 30, 90, 180, 365])("SC-02: milestone %i triggers only on its exact calendar day", (milestone) => {
        const lead = makeLead({ createdAt: new Date(2026, 0, 1, 9) });
        for (const offset of [-1, 0, 1]) {
            const target = new Date(2026, 0, 1 + milestone + offset, 23);
            expect(service.getSilentMilestoneForDate(lead, target)).toBe(offset === 0 ? milestone : null);
        }
    });

    it.each(["CLOSED", "closed", "DELIVERED", "delivered"])("SC-03: terminal stage %s never schedules follow-ups", (stage) => {
        const lead = makeLead({ stage, score: 200, notes: "ready urgent" });
        expect(service.calculatePriority(lead)).toMatchObject({ score: 0, level: "CLOSED" });
        expect(service.generateTimeline(lead)).toEqual([]);
        expect(service.getScientificMission(lead, referenceDate)).toBeNull();
        expect(service.shouldCreateInitialGratitudeTask(lead, lead.createdAt)).toBe(false);
    });

    it("SC-04: time decay never produces a negative score", () => {
        expect(service.calculateScore(makeLead({ stage: "NEW", createdAt: new Date(2020, 0, 1) }))).toBe(0);
    });
});
