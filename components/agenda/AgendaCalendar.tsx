"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";

type Props = {
    selectedDate: Date;
    onSelectDate: (date: Date) => void;
    unfinishedTaskCount: number;
    pastUnfinishedTaskCounts: Record<string, number>;
    todayDateString: string;
};

export default function AgendaCalendar({
    selectedDate,
    onSelectDate,
    unfinishedTaskCount,
    pastUnfinishedTaskCounts,
    todayDateString,
}: Props) {
    const year = selectedDate.getFullYear();
    const month = selectedDate.getMonth();

    const firstDay = new Date(year, month, 1);
    const startDate = new Date(firstDay);
    startDate.setDate(firstDay.getDate() - firstDay.getDay());

    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const cellCount = Math.ceil((firstDay.getDay() + daysInMonth) / 7) * 7;
    const days = Array.from({ length: cellCount }, (_, index) => {
        const date = new Date(startDate);
        date.setDate(startDate.getDate() + index);
        return date;
    });

    function isSameDate(a: Date, b: Date) {
        return a.toDateString() === b.toDateString();
    }

    function formatDateKey(date: Date) {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, "0");
        const day = String(date.getDate()).padStart(2, "0");

        return `${year}-${month}-${day}`;
    }

    function changeMonth(offset: number) {
        const next = new Date(selectedDate);
        const selectedDay = next.getDate();
        next.setDate(1);
        next.setMonth(next.getMonth() + offset);
        const lastDay = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate();
        next.setDate(Math.min(selectedDay, lastDay));
        onSelectDate(next);
    }

    return (
        <section className="w-full rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <div className="mb-4 flex items-center justify-between">
                <button
                    onClick={() => changeMonth(-1)}
                    className="rounded-lg border px-3 py-1"
                    aria-label="Previous month"
                >
                    <ChevronLeft size={16} />
                </button>

                <h2 className="text-lg font-semibold">
                    {selectedDate.toLocaleString("en-CA", {
                        month: "long",
                        year: "numeric",
                    })}
                </h2>

                <button
                    onClick={() => changeMonth(1)}
                    className="rounded-lg border px-3 py-1"
                    aria-label="Next month"
                >
                    <ChevronRight size={16} />
                </button>
            </div>

            <div className="grid grid-cols-7 border-t border-l text-sm">
                {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => (
                    <div key={day} className="border-r border-b bg-slate-50 p-2 font-medium">
                        {day}
                    </div>
                ))}

                {days.map((date) => {
                    const active = isSameDate(date, selectedDate);
                    const muted = date.getMonth() !== month;
                    const dateKey = formatDateKey(date);
                    const pastCount = pastUnfinishedTaskCounts[dateKey] ?? 0;
                    const badgeCount = active
                        ? unfinishedTaskCount
                        : dateKey < todayDateString
                          ? pastCount
                          : 0;
                    const badgeColor = active
                        ? "bg-green-600"
                        : "bg-red-600";

                    return (
                        <button
                            key={date.toISOString()}
                            aria-label={dateKey}
                            aria-pressed={active}
                            onClick={() => onSelectDate(date)}
                            className={`min-h-[66px] border-b border-r p-2 text-left hover:bg-blue-50 ${
                                active ? "bg-blue-100" : ""
                            } ${muted ? "text-slate-300" : "text-slate-700"}`}
                        >
                            <div className="font-medium">{date.getDate()}</div>

                            {badgeCount > 0 && (
                                <div
                                    className={`mt-2 rounded-md px-2 py-1 text-xs text-white ${badgeColor}`}
                                >
                                    {badgeCount} undone
                                </div>
                            )}
                        </button>
                    );
                })}
            </div>
        </section>
    );
}
