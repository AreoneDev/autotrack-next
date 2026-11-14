import { SelectField } from "@/components/ui/select-field";
import { SelectItem } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { TableRow, TableCell } from "@/components/ui/table";
import Link from "next/link";
import { useState } from "react";
import { Eye, Pencil, Trash2 } from "lucide-react";

import { Lead } from "@/domain/objects/Lead";
import { getLeadOutcome, isTerminalLeadStage, leadOutcomeLabels, normalizeLeadStage } from "@/domain/objects/LeadOutcome";

interface LeadTableRowProps {
    lead: Lead;
    onStatusChange: (leadId: number, status: boolean) => Promise<void>;
    onViewBrief: (lead: Lead) => void;
    onDelete: (leadId: number) => Promise<void>;
    deleting: boolean;
    updatingStatus: boolean;
}

export default function LeadTableRow({
    lead,
    onStatusChange,
    onViewBrief,
    onDelete,
    deleting,
    updatingStatus,
}: LeadTableRowProps) {
    const [expanded, setExpanded] = useState(false);
    const outcome = getLeadOutcome(lead);
    const formatDate = (date: Date | null | undefined): string => {
        if (!date) {
            return "N/A";
        }

        return date.toISOString().split("T")[0];
    };

    return (
        <TableRow className="grid grid-cols-2 gap-x-3 border-b p-4 hover:bg-gray-50 md:table-row md:p-0">
            <TableCell className="block min-w-0 break-words whitespace-normal px-0 py-2 md:whitespace-nowrap md:table-cell md:px-4 md:py-3">
                <div className="flex items-center gap-2">
                    <span
                        className={`h-3 w-3 rounded-full ${
                            outcome === "ACTIVE" ? "bg-green-500" : outcome === "LOST" ? "bg-red-500" : "bg-slate-500"
                        }`}
                    />

                    <SelectField
                        aria-label={`Status for ${lead.getLeadName()}`}
                        value={outcome}
                        onValueChange={(event) =>
                            void onStatusChange(
                                lead.leadID,
                                event === "ACTIVE"
                            )
                        }
                        disabled={updatingStatus || isTerminalLeadStage(lead.stage)}
                        title={isTerminalLeadStage(lead.stage) ? "Change the stage in lead details to update this outcome." : undefined}
                        className="rounded border px-2 py-1 text-sm text-gray-900 disabled:cursor-wait disabled:bg-slate-100 disabled:text-slate-500"
                    >
                        <SelectItem value="ACTIVE">Active</SelectItem>
                        <SelectItem value="LOST">Lost</SelectItem>
                        {isTerminalLeadStage(lead.stage) && (
                            <SelectItem value={outcome}>{leadOutcomeLabels[outcome]}</SelectItem>
                        )}
                    </SelectField>
                </div>
            </TableCell>

            <TableCell className="block min-w-0 break-words whitespace-normal px-0 py-2 md:whitespace-nowrap font-medium text-gray-900 md:table-cell md:px-4 md:py-3">
                <div className="flex items-center gap-2">
                    <Button variant="ghost"
                        onClick={() => onViewBrief(lead)}
                        className="cursor-pointer text-gray-500 hover:text-blue-600"
                        title="View lead brief"
                        aria-label={`View lead brief for ${lead.getLeadName()}`}
                    >
                        <Eye size={18} strokeWidth={2} />
                    </Button>

                    <Link href={`/leads/${lead.leadID}`} className="text-blue-600">
                        {lead.getLeadName()}
                    </Link>
                </div>
                <Button type="button" variant="ghost" className="mt-1 min-h-10 px-0 text-blue-600 md:hidden" aria-expanded={expanded} aria-label={`${expanded ? "Hide details" : "More details"} for ${lead.getLeadName()}`} onClick={() => setExpanded(!expanded)}>
                    {expanded ? "Hide details" : "More details"}
                </Button>
            </TableCell>

            <TableCell className="block min-w-0 break-words whitespace-normal px-0 py-2 md:whitespace-nowrap md:table-cell md:px-4 md:py-3">
                <div className="text-gray-900">
                    {lead.leadEmail || "N/A"}
                </div>
                <div className="text-gray-500">
                    {lead.phone || "N/A"}
                </div>
            </TableCell>

            <TableCell className="block min-w-0 break-words whitespace-normal px-0 py-2 md:whitespace-nowrap md:table-cell md:px-4 md:py-3"><span className="block text-xs text-slate-500 md:hidden">Vehicle interest</span>
                {lead.vehicleInterest?.getFullDescription() ?? "None"}
            </TableCell>

            <TableCell className={`${expanded ? "block" : "hidden"} min-w-0 break-words whitespace-normal px-0 py-2 md:whitespace-nowrap md:table-cell md:px-4 md:py-3`}><span className="block text-xs text-slate-500 md:hidden">Trade-in vehicle</span>
                {lead.tradeInVehicle
                    ? lead.tradeInVehicle.getFullDescription()
                    : "No"}
            </TableCell>

            <TableCell className="block min-w-0 break-words whitespace-normal px-0 py-2 md:whitespace-nowrap md:table-cell md:px-4 md:py-3"><span className="block text-xs text-slate-500 md:hidden">Stage</span>{normalizeLeadStage(lead.stage)}</TableCell>

            <TableCell className="block whitespace-normal px-0 py-2 font-semibold md:whitespace-nowrap md:table-cell md:px-4 md:py-3">
                <span className="block text-xs font-normal text-slate-500 md:hidden">Score</span>{Math.floor(lead.score)}
            </TableCell>

            <TableCell className={`${expanded ? "block" : "hidden"} min-w-0 break-words whitespace-normal px-0 py-2 md:whitespace-nowrap md:table-cell md:px-4 md:py-3`}>
                <span className="block text-xs text-slate-500 md:hidden">Last contact</span>{formatDate(lead.lastInteractionDate)}
            </TableCell>

            <TableCell className={`${expanded ? "block" : "hidden"} min-w-0 break-words whitespace-normal px-0 py-2 md:whitespace-nowrap md:table-cell md:px-4 md:py-3`}>
                <div className="flex items-center justify-center gap-4">
                    <Link
                        href={`/leads/${lead.leadID}`}
                        className="text-blue-600 hover:text-blue-800"
                        title="Modify Lead"
                        aria-label={`Modify Lead ${lead.getLeadName()}`}
                    >
                        <Pencil size={18} />
                    </Link>

                    <Button variant="ghost"
                        onClick={() => onDelete(lead.leadID)}
                        disabled={deleting}
                        className="cursor-pointer text-red-600 hover:text-red-800 disabled:cursor-not-allowed disabled:text-slate-300"
                        title="Delete Lead"
                        aria-label={`Delete Lead ${lead.getLeadName()}`}
                    >
                        <Trash2 size={18} />
                    </Button>
                </div>
            </TableCell>
        </TableRow>
    );
}
