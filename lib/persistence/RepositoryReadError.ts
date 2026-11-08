/** A failed read is never an empty collection or a missing record. */
export class RepositoryReadError extends Error {
    constructor(resource: string, cause?: unknown) {
        super(`Unable to load ${resource}. Check your connection and try again.`, { cause });
        this.name = "RepositoryReadError";
    }
}
