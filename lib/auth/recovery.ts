export const expiredLinkMessage = "This email link has expired, has already been used, or could not be verified. Request a new link and open it in the same browser.";

export function readLinkError(url: URL) {
    const fragment = new URLSearchParams(url.hash.slice(1));
    return url.searchParams.has("error") || url.searchParams.has("error_code") || fragment.has("error") || fragment.has("error_code");
}

// Called after the mounted effect consumes the error, so Strict Mode replay keeps it.
export function clearLinkError(url: URL) {
    ["error", "error_code", "error_description"].forEach(key => url.searchParams.delete(key));
    window.history.replaceState(null, "", url.pathname + url.search);
}

export function emailRequestError(error: { status?: number; code?: string }) {
    if (error.status === 429 || error.code === "over_email_send_rate_limit" || error.code === "over_request_rate_limit") {
        return "Too many requests. Wait at least a minute before trying again.";
    }
    return "Unable to send the email right now. Please try again.";
}
