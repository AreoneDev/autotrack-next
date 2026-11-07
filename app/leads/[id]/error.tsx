"use client";

import ReadError from "@/components/ui/read-error";

export default function ErrorPage({ retry }: { error: unknown; retry: () => void }) {
    return <ReadError resource="lead details" onRetry={retry} />;
}
