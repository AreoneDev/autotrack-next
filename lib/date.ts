/** A date input is a local calendar day, not the date component of a UTC instant. */
export function localDateInput(date = new Date()): string {
    return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
}
