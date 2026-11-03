"use client";

import { type ReactNode, useEffect, useRef } from "react";

// Mount only while open. Native modal dialogs make the background inert,
// contain keyboard focus, handle Escape and restore the invoking control.
export default function Modal({ children, labelledBy, onClose, className = "" }: {
    children: ReactNode;
    labelledBy: string;
    onClose: () => void;
    className?: string;
}) {
    const ref = useRef<HTMLDialogElement>(null);
    useEffect(() => {
        const dialog = ref.current!;
        const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        dialog.showModal();
        return () => {
            dialog.close();
            if (trigger?.isConnected) trigger.focus();
        };
    }, []);

    return (
        <dialog ref={ref} aria-labelledby={labelledBy}
            onKeyDown={(event) => {
                if (event.key !== "Tab") return;
                // Keep the first/last boundary consistent across browser engines.
                const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(
                    'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'
                )).filter((element) => element.tabIndex >= 0 && element.getClientRects().length > 0);
                const first = controls[0];
                const last = controls[controls.length - 1];
                if (event.shiftKey && document.activeElement === first) {
                    event.preventDefault(); last?.focus();
                } else if (!event.shiftKey && document.activeElement === last) {
                    event.preventDefault(); first?.focus();
                }
            }}
            onCancel={(event) => { event.preventDefault(); onClose(); }}
            className={`m-auto max-h-[90vh] overflow-y-auto rounded-lg bg-white p-6 text-slate-900 shadow-xl backdrop:bg-black/40 ${className}`}>
            {children}
        </dialog>
    );
}
