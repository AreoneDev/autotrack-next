import { Lead } from "@/domain/objects/Lead";
import { Task } from "@/domain/objects/Task";
import { ScoringService } from "@/domain/business/ScoringService";
import { PriorityManager } from "@/domain/business/PriorityManager";
import { AgendaService } from "@/domain/business/AgendaService";

const scoring = new ScoringService();
const agenda = new AgendaService(scoring, new PriorityManager(scoring));
beforeEach(() => jest.useFakeTimers().setSystemTime(new Date(2026, 10, 7, 15)));
afterEach(() => jest.useRealTimers());

it("uses the latest outbound contact for both score recency and follow-up milestones", () => {
    const lead = new Lead({ leadID: 1, firstName: "Ada", stage: "CONTACTED",
        createdAt: new Date(2026, 0, 1), followUpDate: new Date(2027, 0, 1) });
    expect(scoring.calculateScore(lead)).toBe(0);
    lead.recordInteraction(new Date(2026, 10, 7, 12), "USER");
    expect(scoring.calculateScore(lead)).toBe(35);
    expect(scoring.getSilentMilestoneForDate(lead, new Date(2026, 10, 10))).toBe(3);
    expect(scoring.getScientificMission(lead, new Date(2026, 10, 10))).toBe("Quick check-in: Gratitude follow-up");
    expect(scoring.generateTimeline(lead).some((task) => task.getTitle().startsWith("URGENT:"))).toBe(false);
    expect(lead.followUpDate).toEqual(new Date(2027, 0, 1));
});

it("keeps prior tasks and allows the same milestone in a new contact cycle", () => {
    jest.setSystemTime(new Date(2026, 10, 12, 12));
    const lead = new Lead({ leadID: 1, firstName: "Ada", createdAt: new Date(2026, 9, 1),
        lastInteractionDate: new Date(2026, 10, 7), lastInteractionBy: "USER" });
    const old = new Task(lead, "Quick check-in: Gratitude follow-up", new Date(2026, 9, 4), 8);
    old.setCompleted(true);
    const manual = new Task(lead, "Confirm appointment", new Date(2026, 10, 12), 9);
    const missing = agenda.getMissingSystemAssignedTasksUpToDate([lead], [old, manual], new Date(2026, 10, 12));
    const followUp = missing.find((task) => task.getTitle() === old.getTitle());
    expect(followUp?.getDate()).toEqual(new Date(2026, 10, 10));
    expect(old.isCompleted()).toBe(true);
    expect(manual.isCompleted()).toBe(false);
    expect(agenda.getMissingSystemAssignedTasksUpToDate([lead], [old, manual, ...missing], new Date(2026, 10, 12))).toEqual([]);
});

it("anchors urgent auto-tasks to the reply date so viewing on another day is idempotent", () => {
    const lead = new Lead({ leadID: 1, firstName: "Ada", createdAt: new Date(2026, 9, 1),
        lastInteractionDate: new Date(2026, 10, 6, 23), lastInteractionBy: "LEAD" });
    const first = scoring.generateTimeline(lead);
    first.forEach((task, index) => task.setEventID(index + 1));
    jest.setSystemTime(new Date(2026, 10, 8, 12));
    const second = scoring.generateTimeline(lead, first);
    const urgent = second.filter((task) => task.getTitle().startsWith("URGENT:"));
    expect(urgent).toHaveLength(1);
    expect(urgent[0].getDate()).toEqual(new Date(2026, 10, 6));
});

it("counts local days correctly across the fall DST boundary", () => {
    const lead = new Lead({ firstName: "Ada", createdAt: new Date(2026, 0, 1),
        lastInteractionDate: new Date(2026, 9, 31, 23), lastInteractionBy: "USER" });
    expect(scoring.getSilentMilestoneForDate(lead, new Date(2026, 10, 3, 1))).toBe(3);
});

it("reuses a legacy urgent task assigned after the current reply day", () => {
    const lead = new Lead({ leadID: 1, firstName: "Ada", createdAt: new Date(2026, 9, 1),
        lastInteractionDate: new Date(2026, 10, 6, 23), lastInteractionBy: "LEAD" });
    const old = new Task(lead, "URGENT: Lead replied. Respond within 48h!", new Date(2026, 10, 7), 7);
    expect(scoring.generateTimeline(lead, [old]).filter((task) => task.getTitle() === old.getTitle())).toEqual([old]);
});
