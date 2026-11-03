// Only port numbers are configurable; test services always bind to loopback.
function port(name: string, fallback: number) {
    const value = Number(process.env[name] ?? fallback);
    if (!Number.isInteger(value) || value < 1024 || value > 65535) throw new Error(`Invalid ${name}`);
    return value;
}
export const appPort = port("E2E_APP_PORT", 3100);
export const backendPort = port("E2E_BACKEND_PORT", 54329);
export const appURL = `http://127.0.0.1:${appPort}`;
export const backendURL = `http://127.0.0.1:${backendPort}`;
