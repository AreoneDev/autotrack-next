import type { Config } from "jest";
const config: Config = {
    rootDir: "../..",
    preset: "ts-jest",
    testEnvironment: "node",
    testMatch: ["**/tests/supabase/**/*.live.ts"],
    moduleNameMapper: { "^@/(.*)$": "<rootDir>/$1" },
    testTimeout: 30000,
    maxWorkers: 1,
};
export default config;
