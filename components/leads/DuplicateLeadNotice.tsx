import Link from "next/link";
import type { DuplicateLeadMatch } from "@/domain/business/LeadValidation";

export default function DuplicateLeadNotice({ matches }: { matches: DuplicateLeadMatch[] }) {
    if (!matches.length) return null;
    return (
        <div role="status" className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
            <p className="font-semibold">Possible duplicate customers</p>
            <p>These records share this email or phone. Review them, then save anyway if this is a separate customer.</p>
            <ul className="mt-2 space-y-1">
                {matches.map((match) => (
                    <li key={match.leadID}>
                        <Link href={`/leads/${match.leadID}`} target="_blank" rel="noopener noreferrer" className="font-medium underline">
                            {match.name || `Lead #${match.leadID}`}
                        </Link>{" — "}{[match.email && "email", match.phone && "phone"].filter(Boolean).join(" and ")}
                    </li>
                ))}
            </ul>
        </div>
    );
}
