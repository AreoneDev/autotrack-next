"use client";

import { type CSSProperties, type ReactNode, useState } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

export default function Modal({ children, labelledBy, onClose, className, style }: {
    children: ReactNode;
    labelledBy: string;
    onClose: () => void;
    className?: string;
    style?: CSSProperties;
}) {
    const [trigger] = useState(() => typeof document !== "undefined" ? document.activeElement as HTMLElement | null : null);

    return (
        <Dialog open disablePointerDismissal onOpenChange={(open) => { if (!open) onClose(); }}>
            <DialogContent
                aria-labelledby={labelledBy}
                showCloseButton={false}
                finalFocus={() => trigger?.isConnected ? trigger : false}
                className={cn("block max-h-[90dvh] w-[calc(100%-2rem)] overflow-y-auto p-6", className)}
                style={style}
            >
                {children}
            </DialogContent>
        </Dialog>
    );
}
