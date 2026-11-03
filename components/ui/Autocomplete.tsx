"use client";

import { useEffect, useId, useRef, useState } from "react";

export default function Autocomplete({ label, value, options, placeholder, disabled, onChange, onSelect, onFocus }: {
    label: string; value: string; options: string[]; placeholder: string; disabled?: boolean;
    onChange: (value: string) => void; onSelect: (value: string) => void; onFocus?: () => void;
}) {
    const id = useId();
    const input = useRef<HTMLInputElement>(null);
    const [open, setOpen] = useState(false);
    const [active, setActive] = useState(-1);
    const expanded = open && !disabled && options.length > 0;
    useEffect(() => {
        if (expanded && active >= 0) document.getElementById(`${id}-${active}`)?.scrollIntoView?.({ block: "nearest" });
    }, [active, expanded, id]);
    function select(option: string) {
        onSelect(option);
        setOpen(false);
        setActive(-1);
        input.current?.focus();
    }
    return (
        <div className="relative text-sm font-medium text-slate-700"
            onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}>
            <label htmlFor={id}>{label}</label>
            <input ref={input} id={id} role="combobox" aria-autocomplete="list"
                aria-expanded={expanded} aria-controls={expanded ? `${id}-options` : undefined}
                aria-activedescendant={expanded && active >= 0 && active < options.length ? `${id}-${active}` : undefined}
                value={value} disabled={disabled} placeholder={placeholder}
                onFocus={() => { onFocus?.(); }}
                onClick={() => { setOpen(true); setActive(-1); }}
                onChange={(event) => { setOpen(true); setActive(-1); onChange(event.target.value); }}
                onKeyDown={(event) => {
                    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                        event.preventDefault();
                        setOpen(true);
                        const direction = event.key === "ArrowDown" ? 1 : -1;
                        setActive((index) => {
                            if (!options.length) return -1;
                            if (index < 0) return direction === 1 ? 0 : options.length - 1;
                            return (index + direction + options.length) % options.length;
                        });
                    } else if (event.key === "Enter" && expanded && active >= 0 && active < options.length) {
                        event.preventDefault(); select(options[active]);
                    } else if (event.key === "Escape" && open) {
                        event.preventDefault(); event.stopPropagation(); setOpen(false); setActive(-1);
                    } else if (event.key === "Tab") { setOpen(false); }
                }}
                className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-950 disabled:cursor-not-allowed disabled:bg-slate-100" />
            {expanded && <ul id={`${id}-options`} role="listbox" aria-label={`${label} options`}
                className="absolute z-20 mt-1 max-h-52 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg">
                {options.map((option, index) => <li key={option} id={`${id}-${index}`} role="option"
                    aria-selected={index === active} onMouseDown={(event) => event.preventDefault()}
                    onClick={() => select(option)}
                    className={`cursor-pointer px-3 py-2 text-sm hover:bg-blue-50 ${index === active ? "bg-blue-100" : ""}`}>
                    {option}
                </li>)}
            </ul>}
        </div>
    );
}
