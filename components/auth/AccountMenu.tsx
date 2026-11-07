"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useRef, useState } from "react";
import { ChevronsUpDown, LogOut, Settings, UserRound } from "lucide-react";
import { useAccount } from "./AccountProvider";
export function AccountAvatar() { const { initials } = useAccount(); return <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-blue-600 font-bold text-white">{initials || <UserRound size={20} aria-hidden="true" />}</span>; }
export function SignOutButton() { const { busy, operation, error, signOut } = useAccount(); return <div><button type="button" onClick={() => void signOut()} disabled={busy} className="flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm text-red-700 hover:bg-red-50 disabled:opacity-50"><LogOut size={18} aria-hidden="true" />{operation === "signout" ? "Signing out…" : "Sign out"}</button>{error.startsWith("Sign out") && <p role="alert" className="px-3 text-sm text-red-700">{error}</p>}</div>; }
export default function AccountMenu({ collapsed = false, mobile = false, onNavigate }: { collapsed?: boolean; mobile?: boolean; onNavigate?: () => void }) {
    const { user, name } = useAccount(); const [open, setOpen] = useState(false); const trigger = useRef<HTMLButtonElement>(null); const pathname = usePathname();
    const identity = <><AccountAvatar /><span className="min-w-0 text-left"><span className="block truncate font-semibold text-gray-900">{name || "AutoTrack account"}</span><span className="block truncate text-sm text-gray-500">{user?.email || "Account"}</span></span></>;
    const actions = <><Link href="/settings" onClick={() => { setOpen(false); onNavigate?.(); }} aria-current={pathname === "/settings" ? "page" : undefined} className="flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm text-slate-700 hover:bg-blue-50"><Settings size={18} aria-hidden="true" />Settings</Link><div className="my-1 border-t border-slate-100" /><SignOutButton /></>;
    return <div className="relative" onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }} onKeyDown={event => { if (event.key === "Escape" && open) { event.stopPropagation(); setOpen(false); trigger.current?.focus(); } }}>
        {mobile ? <><div className="flex items-center gap-3 px-2 py-3">{identity}</div>{actions}</> : <>{open && <div id="account-menu" className={`absolute bottom-full z-50 mb-2 w-72 max-w-[calc(100vw-2rem)] rounded-lg border border-slate-200 bg-white p-2 shadow-xl ${collapsed ? "left-full ml-3" : "left-0"}`}><div className="border-b border-slate-100 px-3 py-3"><p className="font-semibold">{name || "AutoTrack account"}</p><p className="break-all text-sm text-slate-500">{user?.email || "Account"}</p></div>{actions}</div>}<button ref={trigger} type="button" aria-label="Account" aria-expanded={open} aria-controls={open ? "account-menu" : undefined} onClick={() => setOpen(!open)} className="flex w-full items-center gap-3 rounded-lg p-2 hover:bg-blue-50">{collapsed ? <AccountAvatar /> : <>{identity}<ChevronsUpDown size={16} className="ml-auto shrink-0 text-slate-500" aria-hidden="true" /></>}</button></>}
    </div>;
}
