"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { DateTimeField } from "@/components/ui/date-time-field";
import { SelectField } from "@/components/ui/select-field";
import { SelectItem } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import Modal from "@/components/ui/Modal";
import { localDateInput } from "@/lib/date";
import { contactChannels, contactOutcomes, type ContactChannel, type ContactDirection, type ContactOutcome, type ContactRecord, type NewContactRecord } from "@/domain/objects/ContactRecord";
import { ContactHistoryRepo } from "@/lib/persistence/real/supabase/ContactHistoryRepo";

const channelLabels: Record<ContactChannel, string> = { call: "Call", email: "Email", message: "Message", in_person: "In person", other: "Other" };
const outcomeLabels: Record<ContactOutcome, string> = { connected: "Connected", no_answer: "No answer", voicemail: "Voicemail", sent: "Sent", received: "Received", other: "Other" };

function displayTime(value: string | null) {
    if (!value || !Number.isFinite(Date.parse(value))) return "Time unknown";
    return new Intl.DateTimeFormat("en-CA", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

/** Reject invalid calendar dates and nonexistent local times rather than silently normalizing. */
export function contactTimeToISO(date: string, time: string): string {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error("Enter a valid date and time.");
    const instant = new Date(`${date}T${time}:00`);
    const clock = `${String(instant.getHours()).padStart(2, "0")}:${String(instant.getMinutes()).padStart(2, "0")}`;
    if (!Number.isFinite(instant.getTime()) || localDateInput(instant) !== date || clock !== time) throw new Error("This local date or time does not exist. Choose another time.");
    return instant.toISOString();
}

export default function ContactHistoryPanel({ leadID, reloadKey = 0, onSaved }: {
    leadID: number; reloadKey?: number; onSaved?: () => Promise<void> | void;
}) {
    const repo = useMemo(() => new ContactHistoryRepo(), []);
    const [records, setRecords] = useState<ContactRecord[]>([]);
    const [hasMore, setHasMore] = useState(false);
    const [loading, setLoading] = useState(true);
    const [historyError, setHistoryError] = useState<string | null>(null);
    const [saveError, setSaveError] = useState<string | null>(null);
    const [success, setSuccess] = useState<string | null>(null);
    const [open, setOpen] = useState(false);
    const [saving, setSaving] = useState(false);
    const [direction, setDirection] = useState<ContactDirection>("outbound");
    const [channel, setChannel] = useState<ContactChannel>("call");
    const [outcome, setOutcome] = useState<ContactOutcome>("connected");
    const [date, setDate] = useState("");
    const [time, setTime] = useState("");
    const [notes, setNotes] = useState("");
    const [followDate, setFollowDate] = useState("");
    const [followTime, setFollowTime] = useState("09:00");
    const [timeZone, setTimeZone] = useState("");
    const attempt = useRef<{ signature: string; requestID: string } | null>(null);
    const busy = useRef(false);
    const generation = useRef(0);

    const load = useCallback(async (offset = 0) => {
        const request = ++generation.current;
        setLoading(true);
        setHistoryError(null);
        try {
            const page = await repo.getPage(leadID, offset);
            if (request !== generation.current) return;
            setRecords(previous => offset === 0 ? page.records : [...previous, ...page.records.filter(item => !previous.some(existing => existing.notificationID === item.notificationID))]);
            setHasMore(page.hasMore);
        } catch (error) {
            if (request === generation.current) setHistoryError(error instanceof Error ? error.message : "Could not load contact history.");
        } finally {
            if (request === generation.current) setLoading(false);
        }
    }, [leadID, repo]);

    useEffect(() => {
        let cancelled = false;
        const request = ++generation.current;
        repo.getPage(leadID).then(page => {
            if (cancelled || request !== generation.current) return;
            setRecords(page.records); setHasMore(page.hasMore); setHistoryError(null);
        }).catch(error => {
            if (!cancelled && request === generation.current) setHistoryError(error instanceof Error ? error.message : "Could not load contact history.");
        }).finally(() => {
            if (!cancelled && request === generation.current) setLoading(false);
        });
        return () => { cancelled = true; };
    }, [leadID, repo, reloadKey]);

    function startContact() {
        const now = new Date();
        setDate(localDateInput(now));
        setTime(`${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`);
        setTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone);
        setDirection("outbound"); setChannel("call"); setOutcome("connected");
        setNotes(""); setFollowDate(""); setFollowTime("09:00");
        setSaveError(null); setSuccess(null); attempt.current = null;
        setOpen(true);
    }

    async function save(event: FormEvent) {
        event.preventDefault();
        if (busy.current) return;
        busy.current = true; setSaving(true); setSaveError(null);
        try {
            const facts = { leadID, direction, channel, outcome, notes: notes.trim(),
                occurredAt: contactTimeToISO(date, time), timeZone,
                nextFollowUpAt: followDate ? contactTimeToISO(followDate, followTime) : null };
            const signature = JSON.stringify(facts);
            if (attempt.current?.signature !== signature) attempt.current = { signature, requestID: crypto.randomUUID() };
            const input: NewContactRecord = { ...facts, requestID: attempt.current.requestID };
            await repo.record(input);
            setOpen(false); attempt.current = null;
            setSuccess("Contact recorded.");
            await load();
            try { await onSaved?.(); }
            catch { setHistoryError("Contact was saved. Refresh the page to reload the lead summary and tasks."); }
        } catch (error) {
            setSaveError(error instanceof Error ? error.message : "Could not save contact. Your draft is preserved.");
        } finally { busy.current = false; setSaving(false); }
    }

    return <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm" aria-labelledby="contact-history-title">
        <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 id="contact-history-title" className="text-lg font-bold text-slate-950">Contact history</h3>
            <div className="flex gap-2">
                <Button variant="outline" onClick={() => void load()} disabled={loading}>Refresh history</Button>
                <Button onClick={startContact}>Log contact</Button>
            </div>
        </div>
        <p className="mt-2 text-sm text-slate-500">Record incoming or outgoing contact manually. Inbox messages are not imported automatically.</p>
        {success && <p role="status" className="mt-3 text-sm text-green-700">{success}</p>}
        {historyError && <div role="alert" className="mt-3 text-sm text-red-700">
            <p>{historyError}</p><Button variant="outline" disabled={loading} onClick={() => void load()}>Retry history</Button>
        </div>}
        <ol className="mt-5 space-y-3" aria-label="Contact timeline">
            {records.map(record => <li key={record.notificationID} className="rounded-lg border border-slate-200 p-4">
                {record.details ? <>
                    <p className="font-semibold text-slate-950">{record.details.direction === "inbound" ? "Incoming" : "Outgoing"} · {channelLabels[record.details.channel]} · {outcomeLabels[record.details.outcome]}</p>
                    {record.details.notes && <p className="mt-2 whitespace-pre-wrap break-words text-sm text-slate-700">{record.details.notes}</p>}
                    {record.details.nextFollowUpAt && <p className="mt-2 text-sm text-blue-700">Next follow-up: {displayTime(record.details.nextFollowUpAt)}</p>}
                </> : <>
                    <p className="font-semibold text-slate-950">{record.title || "Untitled notification"}</p>
                    <p className="mt-1 text-xs text-slate-500">Legacy notification · Direction, channel and result unknown</p>
                </>}
                <p className="mt-2 text-sm text-slate-500">{displayTime(record.occurredAt)}</p>
            </li>)}
        </ol>
        {loading && <p role="status" className="mt-3 text-sm text-slate-500">Loading contact history...</p>}
        {!loading && !historyError && records.length === 0 && <p className="text-sm text-slate-500">No contact history for this lead.</p>}
        {hasMore && <Button variant="outline" className="mt-4" disabled={loading} onClick={() => void load(records.length)}>Load older contacts</Button>}

        {open && <Modal labelledBy="log-contact-title" onClose={() => { if (!saving) setOpen(false); }} className="max-w-xl sm:max-w-xl">
            <h3 id="log-contact-title" className="text-xl font-bold text-slate-950">Log contact</h3>
            <p className="mt-2 text-sm text-slate-500">Times use {timeZone}. A next follow-up also creates a task.</p>
            <form onSubmit={save} className="mt-4 space-y-4">
                <fieldset disabled={saving} className="space-y-4">
                    <div className="grid gap-3 sm:grid-cols-2">
                        <div className="space-y-1 text-sm font-medium">Direction
                            <SelectField aria-label="Contact direction" value={direction} onValueChange={value => {
                                setDirection(value as ContactDirection); setOutcome(value === "inbound" ? "received" : "connected");
                            }}>
                                <SelectItem value="outbound">Outgoing</SelectItem><SelectItem value="inbound">Incoming</SelectItem>
                            </SelectField>
                        </div>
                        <div className="space-y-1 text-sm font-medium">Channel
                            <SelectField aria-label="Contact channel" value={channel} onValueChange={value => setChannel(value as ContactChannel)}>
                                {contactChannels.map(value => <SelectItem key={value} value={value}>{channelLabels[value]}</SelectItem>)}
                            </SelectField>
                        </div>
                    </div>
                    <div className="block space-y-1 text-sm font-medium">Result
                        <SelectField aria-label="Contact result" value={outcome} onValueChange={value => setOutcome(value as ContactOutcome)}>
                            {contactOutcomes.filter(value => direction === "inbound" ? ["connected", "received", "other"].includes(value) : value !== "received")
                                .map(value => <SelectItem key={value} value={value}>{outcomeLabels[value]}</SelectItem>)}
                        </SelectField>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                        <div className="space-y-1 text-sm font-medium">Contact date<DateTimeField type="date" aria-label="Contact date" value={date} onValueChange={setDate} required /></div>
                        <div className="space-y-1 text-sm font-medium">Contact time<DateTimeField type="time" aria-label="Contact time" value={time} onValueChange={setTime} required /></div>
                    </div>
                    <label className="block space-y-1 text-sm font-medium">Contact notes
                        <Textarea aria-label="Contact notes" maxLength={10000} value={notes} onChange={event => setNotes(event.target.value)} rows={4} />
                    </label>
                    <div className="grid gap-3 sm:grid-cols-2">
                        <div className="space-y-1 text-sm font-medium">Next follow-up date (optional)<DateTimeField type="date" aria-label="Contact next follow-up date" value={followDate} onValueChange={setFollowDate} /></div>
                        <div className="space-y-1 text-sm font-medium">Next follow-up time<DateTimeField type="time" aria-label="Contact next follow-up time" value={followTime} onValueChange={setFollowTime} disabled={!followDate} required={Boolean(followDate)} /></div>
                    </div>
                </fieldset>
                {saveError && <div role="alert" className="text-sm text-red-700"><p>{saveError}</p><p className="mt-1">Your draft is preserved. Retry unchanged details to avoid duplicates after a connection error.</p></div>}
                <div className="flex justify-end gap-2">
                    <Button type="button" variant="outline" disabled={saving} onClick={() => setOpen(false)}>Cancel</Button>
                    <Button type="submit" disabled={saving}>{saving ? "Saving contact..." : "Save contact"}</Button>
                </div>
            </form>
        </Modal>}
    </section>;
}
