import { Button } from "@/components/ui/button";
import Modal from "@/components/ui/Modal";
import { X } from "lucide-react";

import { Lead } from "@/domain/objects/Lead";

interface LeadBriefModalProps {
    lead: Lead | null;
    onClose: () => void;
}

export default function LeadBriefModal({ lead, onClose }: LeadBriefModalProps) {
    if (!lead) {
        return null;
    }

    return (
        <Modal labelledBy="lead-brief-title" onClose={onClose} className="w-full max-w-lg">
                <div className="mb-4 flex items-center justify-between">
                    <h2 id="lead-brief-title" className="text-xl font-bold" style={{ color: "var(--foreground)" }}>
                        Lead Brief
                    </h2>

                    <Button variant="ghost"
                        onClick={onClose}
                        className="rounded-lg p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-900"
                        aria-label="Close lead brief"
                    >
                        <X size={18} />
                    </Button>
                </div>

                <div className="space-y-3 text-sm" style={{ color: "var(--foreground)" }}>
                    <p><strong>Name:</strong> {lead.getLeadName()}</p>
                    <p><strong>Phone:</strong> {lead.phone || "N/A"}</p>
                    <p><strong>Email:</strong> {lead.leadEmail || "N/A"}</p>
                    <p><strong>Stage:</strong> {lead.stage}</p>
                    <p><strong>Score:</strong> {lead.score}</p>
                    <p>
                        <strong>Vehicle Interest:</strong>{" "}
                        {lead.vehicleInterest?.getFullDescription() ?? "None"}
                    </p>
                    <p>
                        <strong>Trade-in:</strong>{" "}
                        {lead.tradeInVehicle?.getFullDescription() ?? "No"}
                    </p>
                    <p><strong>Notes:</strong> {lead.notes || "No notes"}</p>
                </div>
        </Modal>
    );
}
