/** @jest-environment jsdom */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import AgendaCalendar from "@/components/agenda/AgendaCalendar";

describe("UI-CAL — calendar boundaries", () => {
    function setup(selectedDate: Date, counts = {}) {
        const onSelectDate = jest.fn();
        render(<AgendaCalendar selectedDate={selectedDate} onSelectDate={onSelectDate} unfinishedTaskCount={2} pastUnfinishedTaskCounts={counts} todayDateString="2026-06-20" />);
        return onSelectDate;
    }

    it("UI-CAL-01: six-week months include the final day", () => {
        setup(new Date(2026, 7, 1)); // August starts on Saturday and needs six rows.
        expect(screen.getByRole("button", { name: /^31 August 2026/ })).toBeInTheDocument();
    });

    it.each([
        [new Date(2026, 0, 31), "Next month", new Date(2026, 1, 28)],
        [new Date(2024, 0, 31), "Next month", new Date(2024, 1, 29)],
        [new Date(2026, 2, 31), "Previous month", new Date(2026, 1, 28)],
        [new Date(2026, 11, 15), "Next month", new Date(2027, 0, 15)],
    ])("UI-CAL-02: month navigation clamps the day (%s, %s)", async (selected, button, expected) => {
        const select = setup(selected);
        await userEvent.setup().click(screen.getByRole("button", { name: button }));
        expect(select).toHaveBeenCalledWith(expected);
        expect(selected.getDate()).toBe(selected.getMonth() === 11 ? 15 : 31);
    });

    it("UI-CAL-03: selected and past task badges appear; future badges do not", async () => {
        const select = setup(new Date(2026, 5, 20), { "2026-06-19": 3, "2026-06-21": 8 });
        expect(screen.getByRole("button", { name: /^20 June 2026/ })).toHaveTextContent("2 undone");
        expect(screen.getByRole("button", { name: /^20 June 2026/ })).toHaveAttribute("aria-pressed", "true");
        expect(screen.getByRole("button", { name: /^19 June 2026/ })).toHaveTextContent("3 undone");
        expect(screen.queryByText("8 undone")).not.toBeInTheDocument();
        await userEvent.setup().click(screen.getByRole("button", { name: /^19 June 2026/ }));
        expect(select).toHaveBeenCalledWith(new Date(2026, 5, 19));
    });
});
