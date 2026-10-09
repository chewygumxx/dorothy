// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/.commitlintrc.mts
//
//

import { defineConfig } from "@chewygumxx/commitlint-config";

// Types, limits and the prompt are shared; only the scopes are this
// repository's own.
export default defineConfig({
    scopes: [
        {
            name: "claude",
            fullName: "Claude",
            description: "Claude Code assets ie. hooks, skills, agents, etc.",
        },
        {
            name: "api",
            fullName: "Api",
            description: "Api",
        },
        {
            name: "config",
            fullName: "Config",
            description:
                "Repository tooling configuration, ie. tsconfig, editorconfig, etc.",
        },
        {
            name: "sdk",
            fullName: "SDK",
            description:
                "Retired: src/ before the workspace packages; kept so older commits still lint",
        },
        {
            name: "tui",
            fullName: "TUI",
            description: "Terminal chat interface, ie. packages/tui/",
        },
        {
            name: "core",
            fullName: "Core",
            description: "Shared contracts and basics, ie. packages/core/",
        },
        {
            name: "memory",
            fullName: "Memory",
            description: "Her memory database, ie. packages/memory/",
        },
        {
            name: "agent",
            fullName: "Agent",
            description: "Her model side, ie. packages/agent/",
        },
        {
            name: "cli",
            fullName: "CLI",
            description: "The entry point, ie. packages/cli/",
        },
    ],
});
