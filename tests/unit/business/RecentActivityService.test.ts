import { RecentActivityService } from "@/domain/business/RecentActivityService";
import { makeLead, makeNotification, makeTask, referenceDate } from "@/tests/fixtures/domain";

describe("RA — activity feed (partitions and time boundaries)", () => {
    const service = new RecentActivityService();
    it.each([
        ["DELIVERED", false, "delivered"], [" closed ", true, "closed (outcome unconfirmed)"],
    ])("activity labels honor terminal stage=%s rather than boolean=%s", (stage, status, label) => {
        const result = service.getRecentActivities({
            leads: [makeLead({ stage, status, lastInteractionDate: referenceDate })],
            tasks: [], notifications: [], referenceDate,
        });
        expect(result[0].detail).toContain(`marked ${label}.`);
    });
    it("RA-01: empty sources yield no activities", () => {
        expect(service.getRecentActivities({ leads: [], tasks: [], notifications: [], referenceDate })).toEqual([]);
        expect(service.getTopbarNotifications({ leads: [], notifications: [], referenceDate })).toEqual([]);
    });

    it.each([
        [59999, "Just now"], [60000, "1 minutes ago"], [60001, "1 minutes ago"],
        [3599999, "60 minutes ago"], [3600000, "1 hours ago"], [3600001, "1 hours ago"],
        [86399999, "24 hours ago"], [86400000, "1 days ago"], [86400001, "1 days ago"],
        [-60000, "In 1 minutes"], [-3600000, "In 1 hours"], [-86400000, "In 1 days"],
    ])("RA-02: relative time at %i milliseconds", (delta, expected) => {
        const notification = makeNotification("Reminder", null);
        notification.setDate(new Date(referenceDate.getTime() - delta));
        const result = service.getRecentActivities({ leads: [], tasks: [], notifications: [notification], referenceDate });
        expect(result[0].time).toBe(expected);
    });

    it.each([
        ["Customer sent you a message", "message", "lead", "Incoming message"],
        ["Customer replied to your email", "email", "lead", "Incoming email"],
        ["Customer called you", "call", "lead", "Incoming call"],
        ["Confirmed test drive", "appointment", "lead", "Incoming appointment"],
        ["You sent a message", "message", "user", "Customer message sent"],
        ["You emailed customer", "email", "user", "Email sent"],
        ["You called customer", "call", "user", "Call logged"],
        ["You confirmed appointment", "appointment", "user", "Appointment confirmed"],
        ["System reminder", "reminder", "system", "Reminder triggered"],
    ])("RA-03: %s", (title, type, source, label) => {
        const lead = makeLead();
        const result = service.getRecentActivities({ leads: [lead], tasks: [], notifications: [makeNotification(title)], referenceDate });
        expect(result[0]).toMatchObject({ type, source, label, unread: source === "lead", leadName: "Ada Chen" });
    });

    it("RA-04: only completed tasks enter the feed; missing leads remain safe", () => {
        const completed = makeTask(null);
        completed.setCompleted(true);
        const result = service.getRecentActivities({ leads: [], tasks: [completed, makeTask()], notifications: [], referenceDate });
        expect(result).toHaveLength(1);
        expect(result[0]).toMatchObject({ type: "task_completed", leadId: null, leadName: null, unread: false });
    });

    it.each(["LEAD", "USER"])("RA-05: interactions by %s preserve their source", (actor) => {
        const result = service.getRecentActivities({
            leads: [makeLead({ lastInteractionDate: referenceDate, lastInteractionBy: actor, status: false })],
            tasks: [], notifications: [], referenceDate,
        });
        expect(result[0]).toMatchObject({ type: "lead_updated", source: actor === "LEAD" ? "lead" : "user", unread: actor === "LEAD" });
        expect(result[0].detail).toContain("lost");
    });

    it("RA-06: sort newest first before limiting; zero limit returns no rows", () => {
        const old = makeNotification("Old", null, 1);
        old.setDate(new Date(referenceDate.getTime() - 1000));
        const latest = makeNotification("Latest", null, 2);
        const input = { leads: [], tasks: [], notifications: [old, latest], referenceDate };
        expect(service.getRecentActivities({ ...input, limit: 1 }).map((item) => item.detail)).toEqual(["Latest"]);
        expect(service.getRecentActivities({ ...input, limit: 0 })).toEqual([]);
        expect(input.notifications).toEqual([old, latest]);
    });

    it("RA-07: topbar includes incoming customer communication only and defaults to five", () => {
        const incoming = Array.from({ length: 7 }, (_, i) => makeNotification("Customer sent you a message", null, i));
        const result = service.getTopbarNotifications({
            leads: [], notifications: [makeNotification("You sent a message"), makeNotification("Reminder"), ...incoming], referenceDate,
        });
        expect(result).toHaveLength(5);
        expect(result.every((item) => item.source === "lead" && item.unread)).toBe(true);
    });
});
