// These pages render their own authentication UI without the CRM shell.
export function isPublicAuthPage(pathname: string) {
    return ["/login", "/forgot-password", "/reset-password", "/resend-confirmation"].includes(pathname);
}
