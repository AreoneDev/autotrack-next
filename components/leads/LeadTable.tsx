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
    useMemo,
    useRef,
    useState,
} from "react";
import Autocomplete from "@/components/ui/Autocomplete";
import { Plus, X } from "lucide-react";

import { DuplicateLeadError, validateLeadContact, type LeadFieldErrors, type DuplicateLeadMatch } from "@/domain/business/LeadValidation";
import DuplicateLeadNotice from "./DuplicateLeadNotice";
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
    followUpLeadIds?: number[] | null;
    unrepliedLeadIds?: number[] | null;
    onRetryWorkFilters?: () => void;
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

export default function LeadTable({ leads, followUpLeadIds = null, unrepliedLeadIds = null, onRetryWorkFilters }: LeadTableProps) {
    const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
    const [leadList, setLeadList] = useState<Lead[]>(leads);
    const [searchText, setSearchText] = useState("");
    const [advancedOpen, setAdvancedOpen] = useState(false);
    const [pagination, setPagination] = useState({ page: 1, key: "" });
    const [pageSize, setPageSize] = useState(25);
    const [needsFollowUp, setNeedsFollowUp] = useState(false);
    const [needsReply, setNeedsReply] = useState(false);
    const searchRef = useRef<HTMLInputElement>(null);
    const moreFiltersRef = useRef<HTMLButtonElement>(null);
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
    const createInFlight = useRef(false);
    const [fieldErrors, setFieldErrors] = useState<LeadFieldErrors>({});
    const [duplicates, setDuplicates] = useState<DuplicateLeadMatch[]>([]);
    const [createError, setCreateError] = useState<string | null>(null);
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
        setFieldErrors({});
        setDuplicates([]);
    }

    async function handleCreateLead(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (createInFlight.current) return;
        const validation = validateLeadContact(newLead);
        setFieldErrors(validation.errors);
        if (Object.keys(validation.errors).length) return;

        if (!newLead.firstName.trim() && !newLead.lastName.trim()) {
            setCreateError("Lead must have at least a first name or last name.");
            return;
        }

        createInFlight.current = true;
        setCreatingLead(true);
        setCreateError(null);

        try {
            const lead = new Lead({
                firstName: newLead.firstName,
                lastName: newLead.lastName,
                phone: validation.values.phone,
                leadEmail: validation.values.leadEmail,
                ...leadStateForWrite({ stage: newLead.stage, status: true }),
                budget: validation.values.budget,
                followUpDate: new Date(`${newLead.followUpDate}T09:00:00`),
                notes: newLead.notes,
                createdAt: new Date(),
            });

            const leadRepository = new LeadRepo();
            const error = duplicates.length
                ? await leadRepository.insertLead(lead, duplicates.map((match) => match.leadID))
                : await leadRepository.insertLead(lead);

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
            setDuplicates([]);
            setFieldErrors({});
            setCreateOpen(false);
        } catch (error) {
            if (error instanceof DuplicateLeadError) setDuplicates(error.matches);
            else setCreateError(error instanceof Error ? error.message : "Failed to create lead. Please retry.");
        } finally {
            createInFlight.current = false;
            setCreatingLead(false);
        }
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
        needsFollowUp || needsReply ||
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
                (!needsFollowUp || followUpLeadIds === null || (getLeadOutcome(lead) === "ACTIVE" && followUpLeadIds.includes(lead.leadID))) &&
                (!needsReply || unrepliedLeadIds === null || unrepliedLeadIds.includes(lead.leadID)) &&
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
        needsFollowUp,
        needsReply,
        followUpLeadIds,
        unrepliedLeadIds,
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

    const paginationKey = JSON.stringify([searchText, statusFilter, stageFilter, tradeInFilter, scoreFilter, vehicleYearFilter, vehicleMakeFilter, vehicleModelFilter, needsFollowUp, needsReply, pageSize]);
    const pageCount = Math.max(1, Math.ceil(filteredLeads.length / pageSize));
    if (pagination.key !== paginationKey || pagination.page > pageCount) setPagination({ page: pagination.key === paginationKey ? pageCount : 1, key: paginationKey });
    const currentPage = Math.min(pagination.key === paginationKey ? pagination.page : 1, pageCount);
    const firstIndex = (currentPage - 1) * pageSize;
    const visibleLeads = filteredLeads.slice(firstIndex, firstIndex + pageSize);

    function clearFilters() {
        setNeedsFollowUp(false);
        setNeedsReply(false);
        setSearchText("");
        setStatusFilter("ALL");
        setStageFilter("ALL");
        setTradeInFilter("ALL");
        setScoreFilter("ALL");
        setVehicleYearFilter("");
        setVehicleMakeFilter("");
        setVehicleModelFilter("");
        searchRef.current?.focus();
    }

    return (
        <div className="pb-32">
            <div className="mb-4 flex items-center justify-between gap-3">
                <h2 className="text-base font-semibold text-slate-900">All leads</h2>
                <Button type="button" onClick={() => { setCreateError(null); setCreateOpen(true); }} className="bg-blue-600 text-white hover:bg-blue-700" aria-label="Create new lead"><Plus size={18} /> New Lead</Button>
            </div>
            <section aria-label="Search and filter leads" className="rounded-lg border bg-white p-4 shadow-sm">
                <div className="grid grid-cols-2 items-end gap-3 xl:grid-cols-[minmax(16rem,1fr)_auto_auto_auto]">
                    <div className="col-span-2 xl:col-span-1">
                        <label htmlFor="lead-search" className="text-xs font-semibold text-slate-500">Search · name, email, phone</label>
                        <div className="relative mt-1">
                            <Input ref={searchRef} id="lead-search" type="text" aria-label="Search leads" placeholder="Search by customer name, email, or phone" value={searchText} onChange={(event) => setSearchText(event.target.value)} className="w-full pr-12" />
                            {searchText && <Button type="button" variant="ghost" aria-label="Clear search" onClick={() => { setSearchText(""); searchRef.current?.focus(); }} className="absolute right-0 top-0"><X size={16} /></Button>}
                        </div>
                    </div>
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


                    <Button ref={moreFiltersRef} type="button" variant="outline" aria-expanded={advancedOpen} aria-controls="lead-advanced-filters" onClick={() => setAdvancedOpen((open) => !open)} className="col-span-2 min-h-10 xl:col-span-1">
                        More filters {([needsFollowUp, needsReply, tradeInFilter !== "ALL", scoreFilter !== "ALL", !!vehicleYearFilter.trim(), !!vehicleMakeFilter.trim(), !!vehicleModelFilter.trim()].filter(Boolean).length || "")}
                    </Button>
                </div>
                <div id="lead-advanced-filters" hidden={!advancedOpen} onKeyDown={(event) => { if (event.key === "Escape" && !event.defaultPrevented) { setAdvancedOpen(false); moreFiltersRef.current?.focus(); } }} className="mt-4 space-y-4 border-t pt-4">
                    <div className="flex flex-wrap gap-x-6 gap-y-3 text-sm">
                        <label className="flex min-h-10 items-center gap-2"><input type="checkbox" checked={needsFollowUp} disabled={followUpLeadIds === null} onChange={(event) => setNeedsFollowUp(event.target.checked)} /> Follow-up due through today</label>
                        <label className="flex min-h-10 items-center gap-2"><input type="checkbox" checked={needsReply} disabled={unrepliedLeadIds === null} onChange={(event) => setNeedsReply(event.target.checked)} /> Unreplied customer contact</label>
                    </div>
                    <p className="text-xs text-slate-500">Follow-up: active leads with an incomplete follow-up task due on or before today. Unreplied: recorded incoming customer contacts awaiting a reply.</p>
                    {(followUpLeadIds === null || unrepliedLeadIds === null) && <p role="status" className="text-sm text-slate-600">Some work filters are unavailable. {onRetryWorkFilters && <Button type="button" variant="link" onClick={onRetryWorkFilters}>Retry</Button>}</p>}
                    <div className="grid gap-3 sm:grid-cols-2 xl:max-w-xl">
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
                    <section aria-label="Vehicle interest">
                        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Vehicle interest</h3>
                        <div className="grid gap-3 lg:grid-cols-3">
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

                        </div>
                    </section>
                </div>
            </section>
            {((needsFollowUp && followUpLeadIds === null) || (needsReply && unrepliedLeadIds === null)) && <p role="alert" className="mt-3 text-sm text-amber-800">A selected work filter is unavailable and is not applied. {onRetryWorkFilters && <Button type="button" variant="link" onClick={onRetryWorkFilters}>Retry</Button>}</p>}
            <div className="my-4 flex flex-wrap items-center gap-2 text-sm">
                <p role="status" className="mr-auto text-slate-600">Showing <strong className="text-slate-950">{filteredLeads.length}</strong> of <strong className="text-slate-950">{leadList.length}</strong> leads</p>
                {hasActiveFilters && <Button type="button" variant="ghost" onClick={clearFilters}>Clear Filters</Button>}
                {hasActiveFilters && <div className="flex w-full flex-wrap gap-2" aria-label="Applied filters">
                    {[
                        {label: "Follow-up", value: needsFollowUp ? "Due through today" : "", clear: () => setNeedsFollowUp(false)},
                        {label: "Reply", value: needsReply ? "Unreplied customer contact" : "", clear: () => setNeedsReply(false)},
                        {label: "Search", value: searchText.trim(), clear: () => setSearchText("")},
                        {label: "Status", value: statusFilter === "ALL" ? "" : ({ ACTIVE: "Active", LOST: "Lost", DELIVERED: "Delivered", CLOSED: "Closed (outcome unconfirmed)" }[statusFilter] ?? statusFilter), clear: () => setStatusFilter("ALL")},
                        {label: "Stage", value: stageFilter === "ALL" ? "" : stageFilter.replaceAll("_", " "), clear: () => setStageFilter("ALL")},
                        {label: "Trade-in", value: tradeInFilter === "ALL" ? "" : tradeInFilter === "YES" ? "Yes" : "No", clear: () => setTradeInFilter("ALL")},
                        {label: "Score", value: scoreFilter === "ALL" ? "" : ({ BELOW_50: "Below 50", BETWEEN_50_79: "50 - 79", ABOVE_80: "80+" }[scoreFilter] ?? scoreFilter), clear: () => setScoreFilter("ALL")},
                        {label: "Year", value: vehicleYearFilter.trim(), clear: () => handleVehicleYearFilterChange("")},
                        {label: "Make", value: vehicleMakeFilter.trim(), clear: () => handleVehicleMakeFilterChange("")},
                        {label: "Model", value: vehicleModelFilter.trim(), clear: () => setVehicleModelFilter("")},
                    ].filter((filter) => filter.value).map((filter) => <Button key={filter.label} type="button" variant="outline" onClick={() => { filter.clear(); moreFiltersRef.current?.focus(); }} aria-label={`Remove ${filter.label}: ${filter.value}`} className="h-auto max-w-full whitespace-normal bg-blue-50 text-blue-700">{filter.label}: {filter.value} <X size={14} aria-hidden="true" /></Button>)}
                </div>}
            </div>

            <div className="overflow-x-auto rounded-lg border bg-white shadow-sm">
                {deleteError ? (
                    <div role="alert" className="border-b border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                        {deleteError}
                    </div>
                ) : null}

                <Table className="block w-full text-left text-sm md:table">
                    <TableHeader className="hidden bg-gray-100 text-gray-900 md:table-header-group">
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

                    <TableBody className="block md:table-row-group">
                    {visibleLeads.map((lead) => (
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
                                {hasActiveFilters ? "No leads match the selected filters." : "No leads yet. Create a lead to get started."}
                            </TableCell>
                        </TableRow>
                    ) : null}
                    </TableBody>
                </Table>
                {filteredLeads.length > 0 && <nav aria-label="Lead results pages" className="flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3 text-sm">
                    <span role="status">{firstIndex + 1}–{Math.min(firstIndex + pageSize, filteredLeads.length)} of {filteredLeads.length} leads</span>
                    <div className="flex flex-wrap items-center gap-2">
                        <label htmlFor="lead-page-size">Per page</label>
                        <select id="lead-page-size" className="rounded-md border bg-white px-2 py-2" value={pageSize} onChange={(event) => setPageSize(Number(event.target.value))}>
                            <option value={25}>25</option><option value={50}>50</option><option value={100}>100</option>
                        </select>
                        <Button type="button" variant="outline" disabled={currentPage === 1} onClick={() => setPagination({ page: currentPage - 1, key: paginationKey })}>Previous</Button>
                        <span>Page {currentPage} of {pageCount}</span>
                        <Button type="button" variant="outline" disabled={currentPage === pageCount} onClick={() => setPagination({ page: currentPage + 1, key: paginationKey })}>Next</Button>
                    </div>
                </nav>}
            </div>

            <LeadBriefModal
                lead={selectedLead}
                onClose={() => setSelectedLead(null)}
            />

            {createOpen ? (
                <Modal labelledBy="create-lead-title" onClose={() => { if (!creatingLead) setCreateOpen(false); }} className="w-full max-w-2xl">
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
                                disabled={creatingLead}
                            >
                                <X size={18} />
                            </Button>
                        </div>

                        <form noValidate onSubmit={handleCreateLead} className="space-y-4">
                            <fieldset disabled={creatingLead} className="space-y-4">
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
                                        aria-label="Phone"
                                        aria-invalid={Boolean(fieldErrors.phone)}
                                        aria-describedby={fieldErrors.phone ? "create-phone-error" : undefined}
                                        type="tel"
                                        value={newLead.phone}
                                        onChange={(event) =>
                                            updateNewLead("phone", event.target.value)
                                        }
                                        className="mt-1 w-full rounded-lg border px-3 py-2 text-gray-900"
                                    />
                                    {fieldErrors.phone ? <span id="create-phone-error" role="alert" className="mt-1 block text-sm text-red-600">{fieldErrors.phone}</span> : null}
                                </label>

                                <label className="text-sm font-medium text-gray-700">
                                    Email
                                    <Input
                                        type="email"
                                        aria-label="Email"
                                        aria-invalid={Boolean(fieldErrors.leadEmail)}
                                        aria-describedby={fieldErrors.leadEmail ? "create-leadEmail-error" : undefined}
                                        value={newLead.leadEmail}
                                        onChange={(event) =>
                                            updateNewLead("leadEmail", event.target.value)
                                        }
                                        className="mt-1 w-full rounded-lg border px-3 py-2 text-gray-900"
                                    />
                                    {fieldErrors.leadEmail ? <span id="create-leadEmail-error" role="alert" className="mt-1 block text-sm text-red-600">{fieldErrors.leadEmail}</span> : null}
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
                                        type="text"
                                        inputMode="decimal"
                                        aria-label="Budget"
                                        aria-invalid={Boolean(fieldErrors.budget)}
                                        aria-describedby={fieldErrors.budget ? "create-budget-error" : undefined}
                                        value={newLead.budget}
                                        onChange={(event) =>
                                            updateNewLead("budget", event.target.value)
                                        }
                                        className="mt-1 w-full rounded-lg border px-3 py-2 text-gray-900"
                                    />
                                    {fieldErrors.budget ? <span id="create-budget-error" role="alert" className="mt-1 block text-sm text-red-600">{fieldErrors.budget}</span> : null}
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

                            <DuplicateLeadNotice matches={duplicates} />
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
                                    {creatingLead ? "Creating..." : duplicates.length ? "Create Anyway" : "Create Lead"}
                                </Button>
                            </div>
                            </fieldset>
                        </form>
                </Modal>
            ) : null}
        </div>
    );
}
