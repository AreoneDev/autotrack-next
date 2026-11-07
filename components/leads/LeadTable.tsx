"use client";

import { DateTimeField } from "@/components/ui/date-time-field";
import { SelectField } from "@/components/ui/select-field";
import { SelectItem } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import {
    type FormEvent,
    type PointerEvent,
    useMemo,
    useRef,
    useState,
} from "react";
import Autocomplete from "@/components/ui/Autocomplete";
import { Plus, X } from "lucide-react";

import { Lead } from "@/domain/objects/Lead";
import { ScoringService } from "@/domain/business/ScoringService";
import { getLeadOutcome, isTerminalLeadStage, leadStateForWrite, normalizeLeadStage } from "@/domain/objects/LeadOutcome";
import { localDateInput } from "@/lib/date";
import { LeadRepo } from "@/lib/persistence/real/supabase/LeadRepo";
import Modal from "@/components/ui/Modal";
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
    return <Autocomplete label={`Filter by vehicle ${placeholder.replace("Any ", "")}`} value={value}
        options={options.filter((option) => matchesOption(option, value))}
        placeholder={placeholder} onChange={onChange} onSelect={onChange} />;
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
        followUpDate: localDateInput(),
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
            ...leadStateForWrite({ stage: newLead.stage, status: true }),
            budget: Number(newLead.budget) || 0,
            followUpDate: new Date(`${newLead.followUpDate}T09:00:00`),
            notes: newLead.notes,
            createdAt: new Date(),
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
            followUpDate: localDateInput(),
            notes: "",
        });
        setCreateOpen(false);
    }

    const handleDeleteLead = async (leadId: number) => {
        setDeleteError(null);
        setDeletingLeadId(leadId);

        try {
            const leadRepository = new LeadRepo();
            const error = await leadRepository.deleteLead(leadId);
            if (error) {
                setDeleteError(error);
                return;
            }
            setLeadList((currentLeads) =>
                currentLeads.filter((lead) => lead.leadID !== leadId)
            );
        } catch (error) {
            setDeleteError(error instanceof Error ? error.message : "Unable to delete lead. Check your connection and try again.");
        } finally {
            setDeletingLeadId(null);
        }
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

        if (isTerminalLeadStage(leadToUpdate.stage)) {
            setDeleteError("Change the stage in lead details to update a closed or delivered lead.");
            setUpdatingStatusLeadId(null);
            return;
        }

        const previousStatus = leadToUpdate.status;
        const previousScore = leadToUpdate.score;
        leadToUpdate.status = newStatus;
        leadToUpdate.updateScore(new ScoringService().calculateScore(leadToUpdate));

        setLeadList((currentLeads) =>
            currentLeads.map((lead) =>
                lead.leadID === leadId ? leadToUpdate : lead
            )
        );

        try {
            const leadRepository = new LeadRepo();
            const error = await leadRepository.updateLead(leadToUpdate);
            if (error) throw new Error(error);
        } catch (error) {
            leadToUpdate.status = previousStatus;
            leadToUpdate.score = previousScore;
            setLeadList((currentLeads) =>
                currentLeads.map((lead) =>
                    lead.leadID === leadId ? leadToUpdate : lead
                )
            );
            setDeleteError(error instanceof Error ? error.message : "Unable to update lead status. Check your connection and try again.");
        } finally {
            setUpdatingStatusLeadId(null);
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
                getLeadOutcome(lead) === statusFilter;

            const matchesStage =
                stageFilter === "ALL" ||
                normalizeLeadStage(lead.stage) === stageFilter;

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
        <div className="pb-32">
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
                        <Input
                            type="text"
                            aria-label="Search leads"
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
                            <SelectField
                                aria-label="Filter by status"
                                value={statusFilter}
                                onValueChange={(event) =>
                                    setStatusFilter(event)
                                }
                                className="rounded-lg border px-4 py-3 text-gray-900"
                            >
                                <SelectItem value="ALL">All Status</SelectItem>
                                <SelectItem value="ACTIVE">Active</SelectItem>
                                <SelectItem value="LOST">Lost</SelectItem>
                                <SelectItem value="DELIVERED">Delivered</SelectItem>
                                <SelectItem value="CLOSED">Closed (outcome unconfirmed)</SelectItem>
                            </SelectField>

                            <SelectField
                                aria-label="Filter by stage"
                                value={stageFilter}
                                onValueChange={(event) =>
                                    setStageFilter(event)
                                }
                                className="rounded-lg border px-4 py-3 text-gray-900"
                            >
                                <SelectItem value="ALL">All Stages</SelectItem>
                                <SelectItem value="NEW">New</SelectItem>
                                <SelectItem value="CONTACTED">Contacted</SelectItem>
                                <SelectItem value="VISITED">Visited</SelectItem>
                                <SelectItem value="APPOINTMENT">Appointment</SelectItem>
                                <SelectItem value="TEST_DRIVE">Test Drive</SelectItem>
                                <SelectItem value="NEGOTIATION">Negotiation</SelectItem>
                                <SelectItem value="DELIVERED">Delivered</SelectItem>
                                <SelectItem value="CLOSED">Closed</SelectItem>
                            </SelectField>

                            <SelectField
                                aria-label="Filter by trade-in"
                                value={tradeInFilter}
                                onValueChange={(event) =>
                                    setTradeInFilter(event)
                                }
                                className="rounded-lg border px-4 py-3 text-gray-900"
                            >
                                <SelectItem value="ALL">All Trade-in</SelectItem>
                                <SelectItem value="YES">Yes</SelectItem>
                                <SelectItem value="NO">No</SelectItem>
                            </SelectField>

                            <SelectField
                                aria-label="Filter by score"
                                value={scoreFilter}
                                onValueChange={(event) =>
                                    setScoreFilter(event)
                                }
                                className="rounded-lg border px-4 py-3 text-gray-900"
                            >
                                <SelectItem value="ALL">All Scores</SelectItem>
                                <SelectItem value="BELOW_50">Below 50</SelectItem>
                                <SelectItem value="BETWEEN_50_79">50 - 79</SelectItem>
                                <SelectItem value="ABOVE_80">80+</SelectItem>
                            </SelectField>
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
                                    <Button variant="ghost"
                                        onClick={clearFilters}
                                        className="w-full rounded-lg border border-slate-200 px-4 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                                    >
                                        Clear Filters
                                    </Button>
                                ) : (
                                    <div className="hidden lg:block" />
                                )}
                            </div>
                        </div>
                    </section>
                </div>

                <div role="status" className="mt-6 text-sm">
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

            <div className="overflow-x-auto rounded-lg border bg-white shadow-sm">
                {deleteError ? (
                    <div role="alert" className="border-b border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                        {deleteError}
                    </div>
                ) : null}

                <Table className="w-full text-left text-sm">
                    <TableHeader className="bg-gray-100 text-gray-900">
                    <TableRow>
                        <TableHead className="px-4 py-4">Lead Status</TableHead>
                        <TableHead className="px-4 py-4">Name</TableHead>
                        <TableHead className="px-4 py-4">Contact</TableHead>
                        <TableHead className="px-4 py-4">Vehicle Interest</TableHead>
                        <TableHead className="px-4 py-4">Trade-in Vehicle</TableHead>
                        <TableHead className="px-4 py-4">Stage</TableHead>
                        <TableHead className="px-4 py-4">Score</TableHead>
                        <TableHead className="px-4 py-4">Last Contact</TableHead>
                        <TableHead className="w-32 px-4 py-4 text-center">Actions</TableHead>
                    </TableRow>
                    </TableHeader>

                    <TableBody>
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
                        <TableRow>
                            <TableCell
                                colSpan={9}
                                className="px-4 py-10 text-center text-sm text-slate-500"
                            >
                                No leads match the selected filters.
                            </TableCell>
                        </TableRow>
                    ) : null}
                    </TableBody>
                </Table>
            </div>

            <LeadBriefModal
                lead={selectedLead}
                onClose={() => setSelectedLead(null)}
            />

            <Button variant="ghost"
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
            </Button>

            {createOpen ? (
                <Modal labelledBy="create-lead-title" onClose={() => setCreateOpen(false)} className="w-full max-w-2xl">
                        <div className="mb-5 flex items-center justify-between">
                            <div>
                                <h2 id="create-lead-title" className="text-xl font-bold text-gray-900">
                                    Create Lead
                                </h2>
                                <p className="text-sm text-gray-500">
                                    Add a customer record to the lead pipeline.
                                </p>
                            </div>

                            <Button variant="ghost"
                                onClick={() => setCreateOpen(false)}
                                className="rounded-lg p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-900"
                                aria-label="Close create lead"
                            >
                                <X size={18} />
                            </Button>
                        </div>

                        <form onSubmit={handleCreateLead} className="space-y-4">
                            <div className="grid gap-4 md:grid-cols-2">
                                <label className="text-sm font-medium text-gray-700">
                                    First Name
                                    <Input
                                        value={newLead.firstName}
                                        onChange={(event) =>
                                            updateNewLead("firstName", event.target.value)
                                        }
                                        className="mt-1 w-full rounded-lg border px-3 py-2 text-gray-900"
                                    />
                                </label>

                                <label className="text-sm font-medium text-gray-700">
                                    Last Name
                                    <Input
                                        value={newLead.lastName}
                                        onChange={(event) =>
                                            updateNewLead("lastName", event.target.value)
                                        }
                                        className="mt-1 w-full rounded-lg border px-3 py-2 text-gray-900"
                                    />
                                </label>

                                <label className="text-sm font-medium text-gray-700">
                                    Phone
                                    <Input
                                        value={newLead.phone}
                                        onChange={(event) =>
                                            updateNewLead("phone", event.target.value)
                                        }
                                        className="mt-1 w-full rounded-lg border px-3 py-2 text-gray-900"
                                    />
                                </label>

                                <label className="text-sm font-medium text-gray-700">
                                    Email
                                    <Input
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
                                    <SelectField
                                        value={newLead.stage}
                                        onValueChange={(event) =>
                                            updateNewLead("stage", event)
                                        }
                                        className="mt-1 w-full rounded-lg border px-3 py-2 text-gray-900"
                                    >
                                        <SelectItem value="NEW">New</SelectItem>
                                        <SelectItem value="CONTACTED">Contacted</SelectItem>
                                        <SelectItem value="VISITED">Visited</SelectItem>
                                        <SelectItem value="APPOINTMENT">Appointment</SelectItem>
                                        <SelectItem value="TEST_DRIVE">Test Drive</SelectItem>
                                        <SelectItem value="NEGOTIATION">Negotiation</SelectItem>
                                        <SelectItem value="DELIVERED">Delivered</SelectItem>
                                        <SelectItem value="CLOSED">Closed (outcome unconfirmed)</SelectItem>
                                    </SelectField>
                                </label>

                                <label className="text-sm font-medium text-gray-700">
                                    Budget
                                    <Input
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
                                    <DateTimeField
                                        type="date"
                                        value={newLead.followUpDate}
                                        onValueChange={(event) =>
                                            updateNewLead(
                                                "followUpDate",
                                                event
                                            )
                                        }
                                        className="mt-1 w-full rounded-lg border px-3 py-2 text-gray-900"
                                    />
                                </label>
                            </div>

                            <label className="block text-sm font-medium text-gray-700">
                                Notes
                                <Textarea
                                    value={newLead.notes}
                                    onChange={(event) =>
                                        updateNewLead("notes", event.target.value)
                                    }
                                    rows={3}
                                    className="mt-1 w-full rounded-lg border px-3 py-2 text-gray-900"
                                />
                            </label>

                            {createError ? (
                                <p role="alert" className="text-sm font-medium text-red-600">
                                    {createError}
                                </p>
                            ) : null}

                            <div className="flex justify-end gap-3">
                                <Button variant="ghost"
                                    type="button"
                                    onClick={() => setCreateOpen(false)}
                                    className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                                >
                                    Cancel
                                </Button>

                                <Button variant="ghost"
                                    type="submit"
                                    disabled={creatingLead}
                                    className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300"
                                >
                                    {creatingLead ? "Creating..." : "Create Lead"}
                                </Button>
                            </div>
                        </form>
                </Modal>
            ) : null}
        </div>
    );
}
