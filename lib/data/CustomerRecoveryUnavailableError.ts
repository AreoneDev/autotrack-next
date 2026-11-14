/** Recovery storage is absent from the API schema; retry alone may not help. */
export class CustomerRecoveryUnavailableError extends Error {
    constructor(cause?: unknown) {
        super("Deleted customer recovery is unavailable. Ask an administrator to verify its database setup.", { cause });
        this.name = "CustomerRecoveryUnavailableError";
    }
}
