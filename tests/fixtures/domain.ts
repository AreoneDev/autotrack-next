import { Lead } from "@/domain/objects/Lead";
import { Task } from "@/domain/objects/Task";
import { Notification } from "@/domain/objects/Notification";

export const referenceDate = new Date(2026, 5, 20, 12);

export function makeLead(overrides: ConstructorParameters<typeof Lead>[0] = {}) {
    return new Lead({
        leadID: 1,
        firstName: "Ada",
        lastName: "Chen",
        createdAt: new Date(2026, 5, 1, 9),
        followUpDate: new Date(2026, 5, 20, 9),
        ...overrides,
    });
}

export function makeTask(lead: Lead | null = makeLead(), title = "Call customer", id = 10) {
    return new Task(lead, title, new Date(referenceDate), id);
}

export function makeNotification(title: string, lead: Lead | null = makeLead(), id = 20) {
    return new Notification(lead, title, new Date(referenceDate), id);
}
