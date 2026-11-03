import type { Config } from "jest";

process.env.TZ = "America/Toronto";

const config: Config = {
    preset: "ts-jest",
    testEnvironment: "node",
    clearMocks: true,
    setupFilesAfterEnv: ["<rootDir>/tests/setup.ts"],
    collectCoverageFrom: [
        "domain/**/*.ts",
        "lib/date.ts",
        "lib/persistence/real/supabase/*.ts",
        "components/**/*.{ts,tsx}",
        "app/login/page.tsx",
        "app/auth/callback/route.ts",
        "proxy.ts",
    ],
    coverageDirectory: "coverage",
    coverageReporters: ["text", "lcov", "json-summary"],

    moduleNameMapper: {
        "^@/(.*)$": "<rootDir>/$1",
    },

    testMatch: [
        "<rootDir>/tests/**/*.test.ts",
        "<rootDir>/tests/**/*.test.tsx",
    ],
};

export default config;
