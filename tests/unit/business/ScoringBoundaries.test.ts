import { ScoringService } from "@/domain/business/ScoringService";
import { AgendaService } from "@/domain/business/AgendaService";
import { DashboardService } from "@/domain/business/DashboardService";
import { PriorityManager } from "@/domain/business/PriorityManager";
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

    it("lost leads never receive a score or automatic follow-up, even with an active stage", () => {
        const lead = makeLead({ status: false, stage: "NEGOTIATION", score: 200, notes: "ready urgent" });
        expect(service.calculateScore(lead)).toBe(0);
        expect(service.calculatePriority(lead)).toMatchObject({ score: 0, level: "CLOSED" });
        expect(service.generateTimeline(lead)).toEqual([]);
        expect(service.getScientificMission(lead, referenceDate)).toBeNull();
        expect(service.getSilentMilestoneForDate(lead, referenceDate)).toBeNull();
        expect(service.shouldCreateInitialGratitudeTask(lead, lead.createdAt)).toBe(false);
    });

    it("lost leads stay out of priority lists, dashboard recommendations and generated agenda tasks", () => {
        const lead = makeLead({ status: false, stage: "NEGOTIATION", score: 200, createdAt: referenceDate, followUpDate: referenceDate });
        const priorities = new PriorityManager(service);
        const agenda = new AgendaService(service, priorities);
        const dashboard = new DashboardService(service, agenda);
        expect(priorities.getPrioritizedList([lead])).toEqual([]);
        expect(agenda.getTodayAgenda([lead], [], referenceDate)).toEqual([]);
        expect(agenda.getSystemAssignedTasks([lead], [], referenceDate)).toEqual([]);
        expect(agenda.getMissingSystemAssignedTasksUpToDate([lead], [], referenceDate)).toEqual([]);
        expect(dashboard.getHighPriorityLeads([lead])).toEqual([]);
        expect(dashboard.getPriorityActions([lead], [], [], referenceDate)).toEqual([]);
    });
});
