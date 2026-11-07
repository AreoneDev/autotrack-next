"use client";
import { useState, type ComponentProps } from "react";
import { CalendarDays, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { localDateInput } from "@/lib/date";

type Props = Omit<ComponentProps<typeof Input>, "onChange" | "value" | "type"> & {
    type: "date" | "time";
    value: string;
    onValueChange: (value: string) => void;
    allowEmpty?: boolean;
};
export function DateTimeField({ type, value, onValueChange, disabled, className, allowEmpty = true, ...props }: Props) {
    const [open, setOpen] = useState(false);
    const [draft, setDraft] = useState(value);
    const [previousValue, setPreviousValue] = useState(value);
    if (previousValue !== value) {
        setPreviousValue(value);
        setDraft(value);
    }
    const selected = type === "date" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00`) : undefined;
    return <div className={`relative flex items-center ${type === "date" ? "min-w-32" : "min-w-24"}`}>
        <Input {...props} type="text" value={draft} disabled={disabled}
            placeholder={type === "date" ? "YYYY-MM-DD" : "HH:MM"}
            pattern={type === "date" ? "[0-9]{4}-[0-9]{2}-[0-9]{2}" : "([01][0-9]|2[0-3]):[0-5][0-9]"}
            onChange={(event) => {
                const next = event.target.value;
                setDraft(next);
                if (type === "time" && (/^([01]\d|2[0-3]):[0-5]\d$/.test(next) || next === "")) onValueChange(next);
                if (type === "date" && /^\d{4}-\d{2}-\d{2}$/.test(next)) {
                    const date = new Date(`${next}T12:00:00`);
                    if (!Number.isNaN(date.getTime()) && localDateInput(date) === next) onValueChange(next);
                }
                if (type === "date" && next === "" && allowEmpty) onValueChange(next);
            }}
            onBlur={(event) => { if (draft !== value) setDraft(value); props.onBlur?.(event); }}
            className={className} />
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger render={<Button type="button" variant="ghost" size="icon-sm" disabled={disabled} aria-label={type === "date" ? "Choose date" : "Choose time"} className="absolute right-1" />}>
                {type === "date" ? <CalendarDays /> : <Clock />}
            </PopoverTrigger>
            <PopoverContent align="end" className="w-auto p-2">
                {type === "date" ? <Calendar mode="single" selected={selected} defaultMonth={selected} onSelect={(date) => { if (date) { onValueChange(localDateInput(date)); setOpen(false); } }} /> :
                    <div className="grid max-h-64 grid-cols-3 gap-1 overflow-auto" aria-label="Choose time">
                        {Array.from({ length: 48 }, (_, index) => {
                            const time = `${String(Math.floor(index / 2)).padStart(2, "0")}:${index % 2 ? "30" : "00"}`;
                            return <Button key={time} type="button" variant={time === value ? "default" : "ghost"} onClick={() => { onValueChange(time); setOpen(false); }}>{time}</Button>;
                        })}
                    </div>}
            </PopoverContent>
        </Popover>
    </div>;
}
