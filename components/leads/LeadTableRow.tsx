import { SelectField } from "@/components/ui/select-field";
import { SelectItem } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { TableRow, TableCell } from "@/components/ui/table";
import Link from "next/link";
import { Eye, Pencil, Trash2 } from "lucide-react";

import { Lead } from "@/domain/objects/Lead";

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
    const formatDate = (date: Date | null | undefined): string => {
        if (!date) {
            return "N/A";
        }

        return date.toISOString().split("T")[0];
    };

    return (
        <TableRow className="border-b hover:bg-gray-50">
            <TableCell className="px-4 py-4">
                <div className="flex items-center gap-2">
                    <span
                        className={`h-3 w-3 rounded-full ${
                            lead.status ? "bg-green-500" : "bg-red-500"
                        }`}
                    />

                    <SelectField
                        aria-label={`Status for ${lead.getLeadName()}`}
                        value={lead.status ? "ACTIVE" : "LOST"}
                        onValueChange={(event) =>
                            void onStatusChange(
                                lead.leadID,
                                event === "ACTIVE"
                            )
                        }
                        disabled={updatingStatus}
                        className="rounded border px-2 py-1 text-sm text-gray-900 disabled:cursor-wait disabled:bg-slate-100 disabled:text-slate-500"
                    >
                        <SelectItem value="ACTIVE">Active</SelectItem>
                        <SelectItem value="LOST">Lost</SelectItem>
                    </SelectField>
                </div>
            </TableCell>

            <TableCell className="px-4 py-4 font-medium text-gray-900">
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
            </TableCell>

            <TableCell className="px-4 py-4">
                <div className="text-gray-900">
                    {lead.leadEmail || "N/A"}
                </div>
                <div className="text-gray-500">
                    {lead.phone || "N/A"}
                </div>
            </TableCell>

            <TableCell className="px-4 py-4">
                {lead.vehicleInterest?.getFullDescription() ?? "None"}
            </TableCell>

            <TableCell className="px-4 py-4">
                {lead.tradeInVehicle
                    ? lead.tradeInVehicle.getFullDescription()
                    : "No"}
            </TableCell>

            <TableCell className="px-4 py-4">{lead.stage}</TableCell>

            <TableCell className="px-4 py-4 font-semibold">
                {Math.floor(lead.score)}
            </TableCell>

            <TableCell className="px-4 py-4">
                {formatDate(lead.lastInteractionDate)}
            </TableCell>

            <TableCell className="px-4 py-4">
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
