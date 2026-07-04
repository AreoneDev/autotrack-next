"use client";

import {
    type FocusEvent,
    type FormEvent,
    type PointerEvent,
    useMemo,
    useRef,
    useState,
} from "react";
import { ChevronDown, Plus, X } from "lucide-react";

import { Lead } from "@/domain/objects/Lead";
import { LeadRepo } from "@/lib/persistence/real/supabase/LeadRepo";
import LeadTableRow from "./LeadTableRow";
import LeadBriefModal from "./LeadBriefModal";

interface LeadTableProps {
    leads: Lead[];
}

function normalizeVehicleFilterText(value: string): string {
    return value.trim().toLowerCase();
}

function getVehicleMakeSearchTerms(value: string): string[] {
    const normalizedValue = normalizeVehicleFilterText(value);

    if (!normalizedValue) {
        return [];
    }

    if (normalizedValue === "vw") {
        return ["vw", "volkswagen"];
    }

    if (normalizedValue === "volkswagen") {
        return ["volkswagen", "vw"];
    }

    return [normalizedValue];
}

function vehicleMakeMatches(make: string | null | undefined, value: string): boolean {
    const normalizedMake = normalizeVehicleFilterText(make ?? "");
    const searchTerms = getVehicleMakeSearchTerms(value);

    if (searchTerms.length === 0) {
        return true;
    }

    return searchTerms.some((term) => normalizedMake.includes(term));
}

function optionContainsSearchText(option: string, value: string): boolean {
    const normalizedValue = normalizeVehicleFilterText(value);

    if (!normalizedValue) {
        return true;
    }

    return option.toLowerCase().includes(normalizedValue);
}

function SearchableVehicleFilter({
    value,
    options,
    placeholder,
    onChange,
    matchesOption = optionContainsSearchText,
}: {
    value: string;
    options: string[];
    placeholder: string;
    onChange: (value: string) => void;
    matchesOption?: (option: string, value: string) => boolean;
}) {
    const [open, setOpen] = useState(false);
    const filteredOptions = options.filter((option) =>
        matchesOption(option, value)
    );

    function handleBlur(event: FocusEvent<HTMLDivElement>) {
        if (event.currentTarget.contains(event.relatedTarget)) {
            return;
        }

        setOpen(false);
    }

    return (
        <div className="relative" onBlur={handleBlur}>
            <div className="relative">
                <input
                    type="text"
                    value={value}
                    onFocus={() => setOpen(true)}
                    onChange={(event) => {
                        onChange(event.target.value);
                        setOpen(true);
                    }}
                    placeholder={placeholder}
                    className="w-full rounded-lg border px-4 py-3 pr-10 text-gray-900"
                />
                <button
                    type="button"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => setOpen((currentOpen) => !currentOpen)}
                    className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-slate-500 hover:text-slate-800"
                    aria-label={`Show ${placeholder.toLowerCase()} options`}
                >
                    <ChevronDown size={18} />
                </button>
            </div>

            {open ? (
                <div className="absolute z-20 mt-2 max-h-56 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg">
                    {filteredOptions.length > 0 ? (
                        filteredOptions.map((option) => (
                            <button
                                key={option}
                                type="button"
                                onMouseDown={(event) => event.preventDefault()}
                                onClick={() => {
                                    onChange(option);
                                    setOpen(false);
                                }}
                                className="block w-full px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
                            >
                                {option}
                            </button>
                        ))
                    ) : (
                        <div className="px-3 py-2 text-sm text-slate-500">
                            No matching options
                        </div>
                    )}
                </div>
            ) : null}
        </div>
    );
}

export default function LeadTable({ leads }: LeadTableProps) {
    const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
    const [leadList, setLeadList] = useState<Lead[]>(leads);
    const [searchText, setSearchText] = useState("");
    const [statusFilter, setStatusFilter] = useState("ALL");
    const [stageFilter, setStageFilter] = useState("ALL");
    const [tradeInFilter, setTradeInFilter] = useState("ALL");
    const [scoreFilter, setScoreFilter] = useState("ALL");
    const [vehicleYearFilter, setVehicleYearFilter] = useState("");
    const [vehicleMakeFilter, setVehicleMakeFilter] = useState("");
    const [vehicleModelFilter, setVehicleModelFilter] = useState("");
    const [deleteError, setDeleteError] = useState<string | null>(null);
    const [deletingLeadId, setDeletingLeadId] = useState<number | null>(null);
    const [updatingStatusLeadId, setUpdatingStatusLeadId] = useState<
        number | null
    >(null);
    const [createOpen, setCreateOpen] = useState(false);
    const [creatingLead, setCreatingLead] = useState(false);
    const [createError, setCreateError] = useState<string | null>(null);
    const [fabPosition, setFabPosition] = useState<{
        x: number;
        y: number;
    } | null>(null);
    const dragOffsetRef = useRef({ x: 0, y: 0 });
    const dragStartRef = useRef({ x: 0, y: 0 });
    const draggedRef = useRef(false);
    const [newLead, setNewLead] = useState({
        firstName: "",
        lastName: "",
        phone: "",
        leadEmail: "",
        stage: "NEW",
        budget: "",
        followUpDate: new Date().toISOString().split("T")[0],
        notes: "",
    });

    function updateNewLead(field: keyof typeof newLead, value: string) {
        setNewLead((currentLead) => ({
            ...currentLead,
            [field]: value,
        }));
        setCreateError(null);
    }

    async function handleCreateLead(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();

        if (!newLead.firstName.trim() && !newLead.lastName.trim()) {
            setCreateError("Lead must have at least a first name or last name.");
            return;
        }

        setCreatingLead(true);
        setCreateError(null);

        const lead = new Lead({
            firstName: newLead.firstName,
            lastName: newLead.lastName,
            phone: newLead.phone,
            leadEmail: newLead.leadEmail,
            stage: newLead.stage,
            budget: Number(newLead.budget) || 0,
            followUpDate: new Date(`${newLead.followUpDate}T09:00:00`),
            notes: newLead.notes,
            createdAt: new Date(),
            status: true,
        });

        const leadRepository = new LeadRepo();
        const error = await leadRepository.insertLead(lead);

        setCreatingLead(false);

        if (error) {
            setCreateError(error);
            return;
        }

        setLeadList((currentLeads) => [...currentLeads, lead]);
        setNewLead({
            firstName: "",
            lastName: "",
            phone: "",
            leadEmail: "",
            stage: "NEW",
            budget: "",
            followUpDate: new Date().toISOString().split("T")[0],
            notes: "",
        });
        setCreateOpen(false);
    }

    const handleDeleteLead = async (leadId: number) => {
        setDeleteError(null);
        setDeletingLeadId(leadId);

        const leadRepository = new LeadRepo();
        const error = await leadRepository.deleteLead(leadId);

        setDeletingLeadId(null);

        if (error) {
            setDeleteError(error);
            return;
        }

        setLeadList((currentLeads) =>
            currentLeads.filter((lead) => lead.leadID !== leadId)
        );
    };

    const handleStatusChange = async (leadId: number, newStatus: boolean) => {
        setDeleteError(null);
        setUpdatingStatusLeadId(leadId);

        const leadToUpdate = leadList.find((lead) => lead.leadID === leadId);

        if (!leadToUpdate) {
            setDeleteError("Lead not found.");
            setUpdatingStatusLeadId(null);
            return;
        }

        const previousStatus = leadToUpdate.status;
        leadToUpdate.status = newStatus;

        setLeadList((currentLeads) =>
            currentLeads.map((lead) =>
                lead.leadID === leadId ? leadToUpdate : lead
            )
        );

        const leadRepository = new LeadRepo();
        const error = await leadRepository.updateLead(leadToUpdate);

        setUpdatingStatusLeadId(null);

        if (error) {
            leadToUpdate.status = previousStatus;
            setLeadList((currentLeads) =>
                currentLeads.map((lead) =>
                    lead.leadID === leadId ? leadToUpdate : lead
                )
            );
            setDeleteError(error);
        }
    };

    const hasActiveFilters =
        searchText.trim() !== "" ||
        statusFilter !== "ALL" ||
        stageFilter !== "ALL" ||
        tradeInFilter !== "ALL" ||
        scoreFilter !== "ALL" ||
        vehicleYearFilter.trim() !== "" ||
        vehicleMakeFilter.trim() !== "" ||
        vehicleModelFilter.trim() !== "";

    const vehicleYearOptions = useMemo(() => {
        const years = leadList
            .map((lead) => lead.vehicleInterest?.year)
            .filter((year): year is number => typeof year === "number");

        return [...new Set(years)]
            .sort((yearA, yearB) => yearB - yearA)
            .map((year) => year.toString());
    }, [leadList]);

    function getVehicleMakeOptions(yearFilter: string): string[] {
        const requestedYear = yearFilter.trim();
        const makes = leadList
            .filter((lead) => {
                if (!requestedYear) {
                    return true;
                }

                return lead.vehicleInterest?.year
                    ?.toString()
                    .includes(requestedYear);
            })
            .map((lead) => lead.vehicleInterest?.make?.trim())
            .filter((make): make is string => Boolean(make));

        return [...new Set(makes)].sort((makeA, makeB) =>
            makeA.localeCompare(makeB)
        );
    }

    const vehicleMakeOptions = getVehicleMakeOptions(vehicleYearFilter);

    function getVehicleModelOptions(
        yearFilter: string,
        makeFilter: string
    ): string[] {
        const requestedYear = yearFilter.trim();
        const models = leadList
            .filter((lead) => {
                if (!requestedYear) {
                    return true;
                }

                return lead.vehicleInterest?.year
                    ?.toString()
                    .includes(requestedYear);
            })
            .filter((lead) =>
                vehicleMakeMatches(lead.vehicleInterest?.make, makeFilter)
            )
            .map((lead) => lead.vehicleInterest?.model?.trim())
            .filter((model): model is string => Boolean(model));

        return [...new Set(models)].sort((modelA, modelB) =>
            modelA.localeCompare(modelB)
        );
    }

    const vehicleModelOptions = getVehicleModelOptions(
        vehicleYearFilter,
        vehicleMakeFilter
    );

    function hasMatchingOption(
        value: string,
        options: string[],
        matchesOption: (option: string, value: string) => boolean
    ): boolean {
        if (!value.trim()) {
            return true;
        }

        return options.some((option) => matchesOption(option, value));
    }

    function handleVehicleYearFilterChange(value: string) {
        setVehicleYearFilter(value);

        const nextMakeOptions = getVehicleMakeOptions(value);

        if (
            !hasMatchingOption(
                vehicleMakeFilter,
                nextMakeOptions,
                vehicleMakeMatches
            )
        ) {
            setVehicleMakeFilter("");
            setVehicleModelFilter("");
            return;
        }

        const nextModelOptions = getVehicleModelOptions(
            value,
            vehicleMakeFilter
        );

        if (
            !hasMatchingOption(
                vehicleModelFilter,
                nextModelOptions,
                optionContainsSearchText
            )
        ) {
            setVehicleModelFilter("");
        }
    }

    function handleVehicleMakeFilterChange(value: string) {
        setVehicleMakeFilter(value);

        const nextModelOptions = getVehicleModelOptions(vehicleYearFilter, value);

        if (
            !hasMatchingOption(
                vehicleModelFilter,
                nextModelOptions,
                optionContainsSearchText
            )
        ) {
            setVehicleModelFilter("");
        }
    }

    const filteredLeads = useMemo(() => {
        if (!hasActiveFilters) {
            return leadList;
        }

        const keyword = searchText.trim().toLowerCase();

        return leadList.filter((lead) => {
            const matchesSearch =
                keyword === "" ||
                lead.getLeadName().toLowerCase().includes(keyword) ||
                lead.phone.toLowerCase().includes(keyword) ||
                lead.leadEmail.toLowerCase().includes(keyword);

            const matchesStatus =
                statusFilter === "ALL" ||
                (statusFilter === "ACTIVE" && lead.status) ||
                (statusFilter === "LOST" && !lead.status);

            const matchesStage =
                stageFilter === "ALL" ||
                lead.stage.toUpperCase() === stageFilter;

            const hasTradeIn = lead.tradeInVehicle !== null;

            const matchesTradeIn =
                tradeInFilter === "ALL" ||
                (tradeInFilter === "YES" && hasTradeIn) ||
                (tradeInFilter === "NO" && !hasTradeIn);

            const matchesScore =
                scoreFilter === "ALL" ||
                (scoreFilter === "BELOW_50" && lead.score < 50) ||
                (scoreFilter === "BETWEEN_50_79" &&
                    lead.score >= 50 &&
                    lead.score <= 79) ||
                (scoreFilter === "ABOVE_80" && lead.score >= 80);

            const vehicleInterest = lead.vehicleInterest;
            const requestedVehicleYear = vehicleYearFilter.trim();
            const requestedVehicleModel = vehicleModelFilter
                .trim()
                .toLowerCase();

            const matchesVehicleYear =
                requestedVehicleYear === "" ||
                vehicleInterest?.year
                    ?.toString()
                    .includes(requestedVehicleYear);

            const matchesVehicleMake =
                vehicleMakeMatches(vehicleInterest?.make, vehicleMakeFilter);

            const matchesVehicleModel =
                requestedVehicleModel === "" ||
                vehicleInterest?.model
                    ?.toLowerCase()
                    .includes(requestedVehicleModel);

            return (
                matchesSearch &&
                matchesStatus &&
                matchesStage &&
                matchesTradeIn &&
                matchesScore &&
                matchesVehicleYear &&
                matchesVehicleMake &&
                matchesVehicleModel
            );
        });
    }, [
        hasActiveFilters,
        leadList,
        scoreFilter,
        searchText,
        stageFilter,
        statusFilter,
        tradeInFilter,
        vehicleMakeFilter,
        vehicleModelFilter,
        vehicleYearFilter,
    ]);

    function clearFilters() {
        setSearchText("");
        setStatusFilter("ALL");
        setStageFilter("ALL");
        setTradeInFilter("ALL");
        setScoreFilter("ALL");
        setVehicleYearFilter("");
        setVehicleMakeFilter("");
        setVehicleModelFilter("");
    }

    function clampFabPosition(x: number, y: number, width: number, height: number) {
        const margin = 16;

        return {
            x: Math.min(Math.max(margin, x), window.innerWidth - width - margin),
            y: Math.min(Math.max(margin, y), window.innerHeight - height - margin),
        };
    }

    function handleFabPointerDown(event: PointerEvent<HTMLButtonElement>) {
        const rect = event.currentTarget.getBoundingClientRect();

        dragOffsetRef.current = {
            x: event.clientX - rect.left,
            y: event.clientY - rect.top,
        };
        dragStartRef.current = {
            x: event.clientX,
            y: event.clientY,
        };
        draggedRef.current = false;

        setFabPosition({ x: rect.left, y: rect.top });
        event.currentTarget.setPointerCapture(event.pointerId);
    }

    function handleFabPointerMove(event: PointerEvent<HTMLButtonElement>) {
        if (!event.currentTarget.hasPointerCapture(event.pointerId)) {
            return;
        }

        const rect = event.currentTarget.getBoundingClientRect();
        const deltaX = Math.abs(event.clientX - dragStartRef.current.x);
        const deltaY = Math.abs(event.clientY - dragStartRef.current.y);

        if (deltaX > 4 || deltaY > 4) {
            draggedRef.current = true;
        }

        setFabPosition(
            clampFabPosition(
                event.clientX - dragOffsetRef.current.x,
                event.clientY - dragOffsetRef.current.y,
                rect.width,
                rect.height
            )
        );
    }

    function handleFabPointerUp(event: PointerEvent<HTMLButtonElement>) {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
        }
    }

    function handleFabClick() {
        if (draggedRef.current) {
            draggedRef.current = false;
            return;
        }

        setCreateOpen(true);
        setCreateError(null);
    }

    return (
        <div>
            <div className="mb-8 rounded-lg border bg-white p-6 shadow-sm">
                <div className="border-b border-slate-100 pb-4">
                    <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500">
                        Lead Filters
                    </h2>
                </div>

                <div className="mt-5 space-y-6">
                    <section>
                        <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">
                            Search
                        </h3>
                        <input
                            type="text"
                            placeholder="Search by customer name, email, or phone"
                            value={searchText}
                            onChange={(event) =>
                                setSearchText(event.target.value)
                            }
                            className="w-full rounded-lg border px-4 py-3 text-gray-900 lg:max-w-4xl"
                        />
                    </section>

                    <section>
                        <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">
                            Basic Filters
                        </h3>
                        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                            <select
                                value={statusFilter}
                                onChange={(event) =>
                                    setStatusFilter(event.target.value)
                                }
                                className="rounded-lg border px-4 py-3 text-gray-900"
                            >
                                <option value="ALL">All Status</option>
                                <option value="ACTIVE">Active</option>
                                <option value="LOST">Lost</option>
                            </select>

                            <select
                                value={stageFilter}
                                onChange={(event) =>
                                    setStageFilter(event.target.value)
                                }
                                className="rounded-lg border px-4 py-3 text-gray-900"
                            >
                                <option value="ALL">All Stages</option>
                                <option value="NEW">New</option>
                                <option value="CONTACTED">Contacted</option>
                                <option value="VISITED">Visited</option>
                                <option value="TEST_DRIVE">Test Drive</option>
                                <option value="NEGOTIATION">Negotiation</option>
                                <option value="DELIVERED">Delivered</option>
                            </select>

                            <select
                                value={tradeInFilter}
                                onChange={(event) =>
                                    setTradeInFilter(event.target.value)
                                }
                                className="rounded-lg border px-4 py-3 text-gray-900"
                            >
                                <option value="ALL">All Trade-in</option>
                                <option value="YES">Yes</option>
                                <option value="NO">No</option>
                            </select>

                            <select
                                value={scoreFilter}
                                onChange={(event) =>
                                    setScoreFilter(event.target.value)
                                }
                                className="rounded-lg border px-4 py-3 text-gray-900"
                            >
                                <option value="ALL">All Scores</option>
                                <option value="BELOW_50">Below 50</option>
                                <option value="BETWEEN_50_79">50 - 79</option>
                                <option value="ABOVE_80">80+</option>
                            </select>
                        </div>
                    </section>

                    <section>
                        <div className="mb-2 flex items-center gap-2">

                            <h3 className="text-xs font-bold uppercase tracking-wide text-slate-500">
                                Vehicle Interest
                            </h3>
                        </div>

                        <div className="grid gap-4 lg:grid-cols-[1fr_1fr_1fr_auto]">
                            <SearchableVehicleFilter
                                value={vehicleYearFilter}
                                options={vehicleYearOptions}
                                placeholder="Any year"
                                onChange={handleVehicleYearFilterChange}
                            />

                            <SearchableVehicleFilter
                                value={vehicleMakeFilter}
                                options={vehicleMakeOptions}
                                placeholder="Any make"
                                onChange={handleVehicleMakeFilterChange}
                                matchesOption={vehicleMakeMatches}
                            />

                            <SearchableVehicleFilter
                                value={vehicleModelFilter}
                                options={vehicleModelOptions}
                                placeholder="Any model"
                                onChange={setVehicleModelFilter}
                            />

                            <div className="flex items-end">
                                {hasActiveFilters ? (
                                    <button
                                        onClick={clearFilters}
                                        className="w-full rounded-lg border border-slate-200 px-4 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                                    >
                                        Clear Filters
                                    </button>
                                ) : (
                                    <div className="hidden lg:block" />
                                )}
                            </div>
                        </div>
                    </section>
                </div>

                <div className="mt-6 text-sm">
                    <p className="text-slate-600">
                        Showing{" "}
                        <span className="font-semibold text-slate-950">
                            {filteredLeads.length}
                        </span>{" "}
                        of{" "}
                        <span className="font-semibold text-slate-950">
                            {leadList.length}
                        </span>{" "}
                        leads
                    </p>
                </div>
            </div>

            <div className="overflow-hidden rounded-lg border bg-white shadow-sm">
                {deleteError ? (
                    <div className="border-b border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                        {deleteError}
                    </div>
                ) : null}

                <table className="w-full text-left text-sm">
                    <thead className="bg-gray-100 text-gray-900">
                    <tr>
                        <th className="px-4 py-4">Lead Status</th>
                        <th className="px-4 py-4">Name</th>
                        <th className="px-4 py-4">Contact</th>
                        <th className="px-4 py-4">Vehicle Interest</th>
                        <th className="px-4 py-4">Trade-in Vehicle</th>
                        <th className="px-4 py-4">Stage</th>
                        <th className="px-4 py-4">Score</th>
                        <th className="px-4 py-4">Last Contact</th>
                        <th className="w-32 px-4 py-4 text-center">Actions</th>
                    </tr>
                    </thead>

                    <tbody>
                    {filteredLeads.map((lead) => (
                        <LeadTableRow
                            key={lead.leadID}
                            lead={lead}
                            onStatusChange={handleStatusChange}
                            onViewBrief={setSelectedLead}
                            onDelete={handleDeleteLead}
                            deleting={deletingLeadId === lead.leadID}
                            updatingStatus={
                                updatingStatusLeadId === lead.leadID
                            }
                        />


                    ))}

                    {filteredLeads.length === 0 ? (
                        <tr>
                            <td
                                colSpan={9}
                                className="px-4 py-10 text-center text-sm text-slate-500"
                            >
                                No leads match the selected filters.
                            </td>
                        </tr>
                    ) : null}
                    </tbody>
                </table>
            </div>

            <LeadBriefModal
                lead={selectedLead}
                onClose={() => setSelectedLead(null)}
            />

            <button
                onClick={handleFabClick}
                onPointerDown={handleFabPointerDown}
                onPointerMove={handleFabPointerMove}
                onPointerUp={handleFabPointerUp}
                onPointerCancel={handleFabPointerUp}
                style={
                    fabPosition
                        ? {
                              left: fabPosition.x,
                              top: fabPosition.y,
                          }
                        : undefined
                }
                className={`fixed z-40 inline-flex touch-none select-none items-center gap-2 rounded-full bg-blue-600 px-5 py-4 text-sm font-semibold text-white shadow-lg shadow-blue-600/25 hover:bg-blue-700 focus:outline-none focus:ring-4 focus:ring-blue-200 ${
                    fabPosition ? "" : "bottom-6 right-6"
                } cursor-grab active:cursor-grabbing`}
                aria-label="Create new lead"
                title="Drag to move, click to create new lead"
            >
                <Plus size={20} />
                <span className="hidden sm:inline">New Lead</span>
            </button>

            {createOpen ? (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
                    <div className="w-full max-w-2xl rounded-lg bg-white p-6 shadow-lg">
                        <div className="mb-5 flex items-center justify-between">
                            <div>
                                <h2 className="text-xl font-bold text-gray-900">
                                    Create Lead
                                </h2>
                                <p className="text-sm text-gray-500">
                                    Add a customer record to the lead pipeline.
                                </p>
                            </div>

                            <button
                                onClick={() => setCreateOpen(false)}
                                className="rounded-lg p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-900"
                                aria-label="Close create lead"
                            >
                                <X size={18} />
                            </button>
                        </div>

                        <form onSubmit={handleCreateLead} className="space-y-4">
                            <div className="grid gap-4 md:grid-cols-2">
                                <label className="text-sm font-medium text-gray-700">
                                    First Name
                                    <input
                                        value={newLead.firstName}
                                        onChange={(event) =>
                                            updateNewLead("firstName", event.target.value)
                                        }
                                        className="mt-1 w-full rounded-lg border px-3 py-2 text-gray-900"
                                    />
                                </label>

                                <label className="text-sm font-medium text-gray-700">
                                    Last Name
                                    <input
                                        value={newLead.lastName}
                                        onChange={(event) =>
                                            updateNewLead("lastName", event.target.value)
                                        }
                                        className="mt-1 w-full rounded-lg border px-3 py-2 text-gray-900"
                                    />
                                </label>

                                <label className="text-sm font-medium text-gray-700">
                                    Phone
                                    <input
                                        value={newLead.phone}
                                        onChange={(event) =>
                                            updateNewLead("phone", event.target.value)
                                        }
                                        className="mt-1 w-full rounded-lg border px-3 py-2 text-gray-900"
                                    />
                                </label>

                                <label className="text-sm font-medium text-gray-700">
                                    Email
                                    <input
                                        type="email"
                                        value={newLead.leadEmail}
                                        onChange={(event) =>
                                            updateNewLead("leadEmail", event.target.value)
                                        }
                                        className="mt-1 w-full rounded-lg border px-3 py-2 text-gray-900"
                                    />
                                </label>

                                <label className="text-sm font-medium text-gray-700">
                                    Stage
                                    <select
                                        value={newLead.stage}
                                        onChange={(event) =>
                                            updateNewLead("stage", event.target.value)
                                        }
                                        className="mt-1 w-full rounded-lg border px-3 py-2 text-gray-900"
                                    >
                                        <option value="NEW">New</option>
                                        <option value="CONTACTED">Contacted</option>
                                        <option value="VISITED">Visited</option>
                                        <option value="TEST_DRIVE">Test Drive</option>
                                        <option value="NEGOTIATION">Negotiation</option>
                                        <option value="CLOSED">Closed</option>
                                    </select>
                                </label>

                                <label className="text-sm font-medium text-gray-700">
                                    Budget
                                    <input
                                        type="number"
                                        value={newLead.budget}
                                        onChange={(event) =>
                                            updateNewLead("budget", event.target.value)
                                        }
                                        className="mt-1 w-full rounded-lg border px-3 py-2 text-gray-900"
                                    />
                                </label>

                                <label className="text-sm font-medium text-gray-700">
                                    Follow-up Date
                                    <input
                                        type="date"
                                        value={newLead.followUpDate}
                                        onChange={(event) =>
                                            updateNewLead(
                                                "followUpDate",
                                                event.target.value
                                            )
                                        }
                                        className="mt-1 w-full rounded-lg border px-3 py-2 text-gray-900"
                                    />
                                </label>
                            </div>

                            <label className="block text-sm font-medium text-gray-700">
                                Notes
                                <textarea
                                    value={newLead.notes}
                                    onChange={(event) =>
                                        updateNewLead("notes", event.target.value)
                                    }
                                    rows={3}
                                    className="mt-1 w-full rounded-lg border px-3 py-2 text-gray-900"
                                />
                            </label>

                            {createError ? (
                                <p className="text-sm font-medium text-red-600">
                                    {createError}
                                </p>
                            ) : null}

                            <div className="flex justify-end gap-3">
                                <button
                                    type="button"
                                    onClick={() => setCreateOpen(false)}
                                    className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                                >
                                    Cancel
                                </button>

                                <button
                                    type="submit"
                                    disabled={creatingLead}
                                    className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300"
                                >
                                    {creatingLead ? "Creating..." : "Create Lead"}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            ) : null}
        </div>
    );
}
