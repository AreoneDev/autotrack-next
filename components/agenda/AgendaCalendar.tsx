"use client";
import { createContext, useContext, useEffect, useRef } from "react";
import { type DayButton } from "react-day-picker";
import { Calendar } from "@/components/ui/calendar";
import { Button } from "@/components/ui/button";
import { localDateInput } from "@/lib/date";

type Props = {
    selectedDate: Date;
    onSelectDate: (date: Date) => void;
    unfinishedTaskCount: number;
    pastUnfinishedTaskCounts: Record<string, number>;
    todayDateString: string;
};

type AgendaCalendarDayContextValue = Pick<Props, "unfinishedTaskCount" | "pastUnfinishedTaskCounts" | "todayDateString">;

const AgendaCalendarDayContext = createContext<AgendaCalendarDayContextValue | null>(null);

function AgendaDay({ day, modifiers, ...props }: React.ComponentProps<typeof DayButton>) {
    const context = useContext(AgendaCalendarDayContext);
    const ref = useRef<HTMLButtonElement>(null);
    const date = day.date;
    const key = localDateInput(date);
    useEffect(() => {
        if (modifiers.focused) ref.current?.focus();
    }, [modifiers.focused]);
    if (!context) throw new Error("AgendaDay must render inside AgendaCalendar.");
    const active = !!modifiers.selected;
    const count = active ? context.unfinishedTaskCount : key < context.todayDateString ? context.pastUnfinishedTaskCounts[key] ?? 0 : 0;
    return <Button {...props} aria-label={undefined} ref={ref} type="button" variant="ghost" data-date={key} aria-pressed={active}
        className={`min-h-[66px] w-full flex-col items-start rounded-md p-2 ${active ? "bg-blue-100" : ""} ${modifiers.outside ? "text-slate-500" : "text-slate-700"}`}>
        <span>{date.getDate()}<span className="sr-only"> {date.toLocaleDateString("en-CA", { month: "long", year: "numeric" })}</span></span>
        {count > 0 && <span className={`mt-1 rounded-md px-2 py-1 text-xs text-white ${active ? "bg-green-700" : "bg-red-600"}`}>{count} undone</span>}
    </Button>;
}

export default function AgendaCalendar({ selectedDate, onSelectDate, unfinishedTaskCount, pastUnfinishedTaskCounts, todayDateString }: Props) {
    function navigateMonth(month: Date) {
        const lastDay = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
        onSelectDate(new Date(month.getFullYear(), month.getMonth(), Math.min(selectedDate.getDate(), lastDay)));
    }
    return <AgendaCalendarDayContext.Provider value={{ unfinishedTaskCount, pastUnfinishedTaskCounts, todayDateString }}>
      <section aria-label="Calendar" className="w-full rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <Calendar mode="single" required selected={selectedDate} month={selectedDate} onMonthChange={navigateMonth}
            onSelect={(date) => onSelectDate(date)}
            onDayKeyDown={(date, _modifiers, event) => {
                const offsets: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
                if (!(event.key in offsets)) return;
                const next = new Date(date);
                next.setDate(next.getDate() + offsets[event.key]);
                onSelectDate(next);
            }}
            labels={{ labelPrevious: () => "Previous month", labelNext: () => "Next month" }}
            components={{ DayButton: AgendaDay }}
            className="w-full" classNames={{ months: "relative w-full", month: "w-full", month_grid: "w-full", weekdays: "flex", weekday: "flex-1 text-center text-sm text-slate-600", week: "flex w-full", day: "w-full border border-slate-100 p-0" }} />
      </section>
    </AgendaCalendarDayContext.Provider>;
}
