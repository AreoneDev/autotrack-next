import { localDateInput } from "@/lib/date";

describe("local calendar input", () => {
    it("uses local calendar components without formatting a UTC date", () => {
        const lateEvening = new Date(2026, 9, 26, 23, 59);
        lateEvening.toISOString = () => "2026-10-27T03:59:00.000Z";
        expect(localDateInput(lateEvening)).toBe("2026-10-26");
    });
    it("pads calendar components", () => {
        expect(localDateInput(new Date(2026, 0, 3, 0, 1))).toBe("2026-01-03");
    });
});
