"use client";
import { Children, isValidElement, type ComponentProps, type ReactNode } from "react";
import { Select, SelectContent, SelectTrigger, SelectValue } from "@/components/ui/select";

type Props = Omit<ComponentProps<typeof SelectTrigger>, "onChange" | "value" | "children"> & {
    value: string;
    onValueChange: (value: string) => void;
    children: ReactNode;
};
export function SelectField({ value, onValueChange, children, disabled, ...props }: Props) {
    const items = Children.toArray(children).flatMap((child) => {
        if (!isValidElement<{ value: string; children: ReactNode }>(child)) return [];
        return [{ value: child.props.value, label: String(child.props.children) }];
    });
    return <Select items={items} value={value} disabled={disabled} onValueChange={(next) => { if (next !== null) onValueChange(next); }}>
        <SelectTrigger {...props}><SelectValue /></SelectTrigger>
        <SelectContent alignItemWithTrigger={false}>{children}</SelectContent>
    </Select>;
}
