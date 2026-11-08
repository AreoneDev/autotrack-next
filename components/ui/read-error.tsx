"use client";

import { Button } from "@/components/ui/button";

export default function ReadError({
    resource,
    onRetry,
    pending = false,
}: {
    resource: string;
    onRetry: () => void;
    pending?: boolean;
}) {
    return (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
            <p className="font-semibold">Unable to load {resource}.</p>
            <p className="mt-1">Check your connection and try again. This data is currently unavailable.</p>
            <Button type="button" variant="outline" className="mt-3" onClick={onRetry} disabled={pending}>
                {pending ? "Retrying..." : "Try again"}
            </Button>
        </div>
    );
}
