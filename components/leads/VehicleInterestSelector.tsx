"use client";

import { useEffect, useMemo, useState } from "react";

import {
    VehicleSelection,
    VehicleSelectionService,
} from "@/domain/business/VehicleSelectionService";

type VehicleInterestSelectorProps = {
    value: VehicleSelection;
    onChange: (value: VehicleSelection) => void;
    placeholders?: Partial<Record<FieldName, string>>;
    disabled?: boolean;
};

type FieldName = keyof VehicleSelection;

function AutocompleteField({
    label,
    value,
    options,
    placeholder,
    disabled,
    onChange,
    onSelect,
    onFocus,
}: {
    label: string;
    value: string;
    options: string[];
    placeholder: string;
    disabled?: boolean;
    onChange: (value: string) => void;
    onSelect: (value: string) => void;
    onFocus: () => void;
}) {
    const [open, setOpen] = useState(false);

    return (
        <label className="relative text-sm font-medium text-slate-700">
            {label}
            <input
                aria-label={label}
                value={value}
                disabled={disabled}
                onFocus={() => {
                    setOpen(true);
                    onFocus();
                }}
                onBlur={() => {
                    window.setTimeout(() => setOpen(false), 120);
                }}
                onChange={(event) => {
                    setOpen(true);
                    onChange(event.target.value);
                }}
                placeholder={placeholder}
                className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-950 outline-none focus:border-blue-500 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
            />
            {open && !disabled && options.length > 0 ? (
                <div className="absolute z-20 mt-1 max-h-52 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg">
                    {options.map((option) => (
                        <button
                            key={option}
                            type="button"
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={() => {
                                onSelect(option);
                                setOpen(false);
                            }}
                            className="block w-full px-3 py-2 text-left text-sm text-slate-700 hover:bg-blue-50"
                        >
                            {option}
                        </button>
                    ))}
                </div>
            ) : null}
        </label>
    );
}

export default function VehicleInterestSelector({
    value,
    onChange,
    placeholders = {},
    disabled = false,
}: VehicleInterestSelectorProps) {
    const service = useMemo(() => new VehicleSelectionService(), []);
    const [options, setOptions] = useState<Record<FieldName, string[]>>({
        year: [],
        make: [],
        model: [],
        trim: [],
    });

    function updateSelection(nextValue: Partial<VehicleSelection>) {
        onChange({
            ...value,
            ...nextValue,
        });
    }

    useEffect(() => {
        let active = true;

        service.searchYears(value.year).then((years) => {
            if (active) {
                setOptions((currentOptions) => ({
                    ...currentOptions,
                    year: years.map(String),
                }));
            }
        });

        return () => {
            active = false;
        };
    }, [service, value.year]);

    useEffect(() => {
        let active = true;

        service.searchMakes(value.year, value.make).then((makes) => {
            if (active) {
                setOptions((currentOptions) => ({
                    ...currentOptions,
                    make: makes,
                }));
            }
        });

        return () => {
            active = false;
        };
    }, [service, value.year, value.make]);

    useEffect(() => {
        let active = true;

        service
            .searchModels(value.year, value.make, value.model)
            .then((models) => {
                if (active) {
                    setOptions((currentOptions) => ({
                        ...currentOptions,
                        model: models,
                    }));
                }
            });

        return () => {
            active = false;
        };
    }, [service, value.year, value.make, value.model]);

    useEffect(() => {
        let active = true;

        service
            .searchTrims(value.year, value.make, value.model, value.trim)
            .then((trims) => {
                if (active) {
                    setOptions((currentOptions) => ({
                        ...currentOptions,
                        trim: trims,
                    }));
                }
            });

        return () => {
            active = false;
        };
    }, [service, value.year, value.make, value.model, value.trim]);

    return (
        <div>
            <div className="grid gap-4 md:grid-cols-4">
                <AutocompleteField
                    label="Year"
                    value={value.year}
                    options={options.year}
                    placeholder={placeholders.year ?? "Select year"}
                    disabled={disabled}
                    onFocus={() => undefined}
                    onChange={(year) =>
                        updateSelection({
                            year,
                            make: "",
                            model: "",
                            trim: "",
                        })
                    }
                    onSelect={(year) =>
                        updateSelection({
                            year,
                            make: "",
                            model: "",
                            trim: "",
                        })
                    }
                />
                <AutocompleteField
                    label="Make"
                    value={value.make}
                    options={options.make}
                    placeholder={placeholders.make ?? "Select make"}
                    disabled={disabled || !value.year}
                    onFocus={() => undefined}
                    onChange={(make) =>
                        updateSelection({
                            make,
                            model: "",
                            trim: "",
                        })
                    }
                    onSelect={(make) =>
                        updateSelection({
                            make,
                            model: "",
                            trim: "",
                        })
                    }
                />
                <AutocompleteField
                    label="Model"
                    value={value.model}
                    options={options.model}
                    placeholder={placeholders.model ?? "Select model"}
                    disabled={disabled || !value.year || !value.make}
                    onFocus={() => undefined}
                    onChange={(model) =>
                        updateSelection({
                            model,
                            trim: "",
                        })
                    }
                    onSelect={(model) =>
                        updateSelection({
                            model,
                            trim: "",
                        })
                    }
                />
                <AutocompleteField
                    label="Trim"
                    value={value.trim}
                    options={options.trim}
                    placeholder={placeholders.trim ?? "Optional trim"}
                    disabled={
                        disabled || !value.year || !value.make || !value.model
                    }
                    onFocus={() => undefined}
                    onChange={(trim) => updateSelection({ trim })}
                    onSelect={(trim) => updateSelection({ trim })}
                />
            </div>
            <p className="mt-2 text-xs text-slate-500">
                Trim is optional. If it is not in the catalog, enter it manually
                or leave it blank.
            </p>
        </div>
    );
}
