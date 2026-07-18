import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
    resolve: {
        alias: {
            "app-domain": fileURLToPath(
                new URL("../../domain/src/index.ts", import.meta.url),
            ),
        },
    },
    test: {
        coverage: {
            exclude: ["**/index.ts", "src/errors/generic-errors/**/*"],
        },
        passWithNoTests: false,
    },
});
