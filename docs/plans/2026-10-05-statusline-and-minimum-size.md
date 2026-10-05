---
ctime: 2026-10-05
mtime: 2026-10-05
spdx: GPL-3.0-only
title: Statusline and minimum size plan
description: "Implementation plan for the statusline and a minimum window"
tags:
  - dorothy
  - tui
  - plan
---

<!--
   -
   - ~chewygumxx/dorothy.git
   - ::: :/docs/plans/2026-10-05-statusline-and-minimum-size.md
   -
   -->

# Statusline and Minimum Size Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:executing-plans (chosen) to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A configurable statusline under the input and under each reply, a
five-row input, and a minimum window below which the TUI only says how large
it needs to be.

**Architecture:** `src/config.ts` reads `config.toml` (via a shared
`src/xdg.ts`) into a `Config` of two `LineConfig`s. The pure
`src/tui/statusline.ts` renders modules to text and fits them to a width and
a row count. `fitLayout` gains the statusline's rows and a fixed input cap,
and `minRows` gives the worst case it must hold; below it `App` draws only
the Too Small message beside the still-mounted `History`.

**Tech Stack:** Bun 1.4 (`Bun.TOML.parse`), TypeScript, Ink 7, React 19,
`string-width`, `bun:test`, `ink-testing-library`.

**Spec:** `docs/specs/2026-10-05-statusline-and-minimum-size-design.md`

## Global Constraints

- No new dependency; TOML is parsed with `Bun.TOML.parse`.
- No Agent SDK import under `src/tui/` (`src/tui/boundary.test.ts`).
- `MIN_COLUMNS = 40`; `minRows(statusLines) = 19 + statusLines`, where
  `statusLines` is the statusline's `max-lines`, or 0 when its `modules` is
  empty.
- `INPUT_MAX_ROWS = 5`; `max-lines` is a whole number from 1 to 5.
- Module names: `in`, `cache-read`, `cache-write`, `out`, `ttft`, `duration`,
  `cost`, `chat-cost`; separator `" · "`.
- Too Small text:
  `Too Small: Dorothy's TUI needs at least <R> lines and 40 columns (this window is <rows> × <columns>)`.
- Commits: header at most 50 characters, body lines at most 72; scopes
  `sdk` (`src/` outside the TUI), `tui`, `config`, `claude`; no em dashes.
  Run `bun run format` and `bun run lint` before each commit.
- Markdown passes `remark --frail`: no bracketed text outside code.
- Tests run with colour off, so frames compare as plain text.

## Rulings made while planning

- **No line number in TOML errors.** `Bun.TOML.parse` throws a
  `SyntaxError` whose `line` and `column` point at the calling JavaScript,
  not the TOML. The warning is `config.toml: <message>` with Bun's
  `TOML Parse error: ` prefix removed. Cost if wrong: a less precise
  warning, until a parser that reports lines is worth a dependency.
- **Resumed replies carry their stats.** The spec's "a changed configuration
  also changes how resumed turns display" needs them; today `readTranscript`
  drops them. A stats line attaches to the reply just before it (Task 5).
- **`Statusline` and `Warnings` live in `Header.tsx`**, beside the header,
  so there is no `statusline.ts` and `Statusline.tsx` differing only by case.
- **The Too Small message is cut to `rows - 1` rows**, not merely wrapped,
  so it never fills a tiny window and triggers Ink's full clear.
- **App tests set the window to 100 × 24.** `ink-testing-library` leaves
  `rows` unset, so Ink falls back to `LINES`, `/dev/tty` or `tput`; under a
  short terminal every App test would otherwise see the Too Small message.
- **`initialState` keeps the last three distinct warnings**, as the reducer
  does: config problems can produce more than three at startup.

## Review Focus

1. A reply that streams while the window is too small: it keeps arriving,
   shows once the window grows, and nothing in the scrollback prints twice
   (Task 8, "keeps the draft, the reply and the scrollback").
2. A hand-written `config.toml` with comments, CRLF line endings or a UTF-8
   BOM reads as written (Task 2, "reads comments, CRLF and a BOM").
3. A transcript from before cache counts were recorded resumes with its
   stats, the cache modules rendering nothing (Task 5's reading test).
4. More than three startup warnings never take more than three rows
   (Task 4, "initialState keeps the last three distinct warnings").
5. A `max-lines` above what the modules need draws no blank rows, and the
   layout counts only the rows drawn (Task 3, "draws only the rows it
   uses"; Task 7 passes `statusRows.length`).

## File map

- Create `src/xdg.ts`, `src/xdg.test.ts`: XDG base directories.
- Create `src/config.ts`, `src/config.test.ts`: `config.toml`.
- Create `src/tui/statusline.ts`, `src/tui/statusline.test.ts`: modules.
- Modify `src/transcript.ts`, `src/transcript.test.ts`: `xdgDir`, resumed
  stats.
- Modify `src/tui/state.ts`, `src/tui/state.test.ts`: resumed stats,
  `lastStats`, warning limit at start.
- Modify `src/tui/layout.ts`, `src/tui/layout.test.ts`: row budget,
  `minRows`, `tooSmallMessage`.
- Modify `src/tui/Header.tsx`: one-row header, `Warnings`, `Statusline`.
- Modify `src/tui/History.tsx`, `src/tui/LiveReply.tsx`: reply stats from
  the config; `formatStats` goes.
- Modify `src/tui/App.tsx`, `src/tui/App.test.tsx`,
  `src/tui/components.test.tsx`, `src/tui/run.tsx`.
- Modify `README.md`, `docs/plans/2026-10-03-input-editor.md`,
  `docs/plans/2026-10-03-markdown-replies.md`.

---

### Task 1: Share the XDG directory lookup

**Files:**

- Create: `src/xdg.ts`, `src/xdg.test.ts`
- Modify: `src/transcript.ts:11-14,56-67`

**Interfaces:**

- Produces: `type Env = Record<string, string | undefined>`;
  `xdgDir(env: Env, variable: "XDG_DATA_HOME" | "XDG_CONFIG_HOME", fallback: string): string`.

- [ ] **Step 1: Write the failing test**

Create `src/xdg.test.ts` with the repository's header comment block (as in
`src/transcript.test.ts`, path `src/xdg.test.ts`) and:

```ts
import { describe, expect, it } from "bun:test";
import { homedir } from "node:os";
import { join } from "node:path";
import { xdgDir } from "./xdg.js";

describe("xdgDir", () => {
    it("uses the variable when it is absolute", () => {
        expect(
            xdgDir(
                { XDG_DATA_HOME: "/data", HOME: "/home/u" },
                "XDG_DATA_HOME",
                ".local/share",
            ),
        ).toBe("/data");
        expect(
            xdgDir(
                { XDG_CONFIG_HOME: "/conf", HOME: "/home/u" },
                "XDG_CONFIG_HOME",
                ".config",
            ),
        ).toBe("/conf");
    });

    it("falls back under HOME when unset, empty or relative", () => {
        for (const value of [undefined, "", "conf"]) {
            expect(
                xdgDir(
                    { XDG_CONFIG_HOME: value, HOME: "/home/u" },
                    "XDG_CONFIG_HOME",
                    ".config",
                ),
            ).toBe("/home/u/.config");
        }
    });

    it("reads only the variable it is asked for", () => {
        expect(
            xdgDir(
                { XDG_DATA_HOME: "/data", HOME: "/home/u" },
                "XDG_CONFIG_HOME",
                ".config",
            ),
        ).toBe("/home/u/.config");
    });

    it("uses the user's home directory when HOME is empty", () => {
        expect(xdgDir({ HOME: "" }, "XDG_CONFIG_HOME", ".config")).toBe(
            join(homedir(), ".config"),
        );
    });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun test src/xdg.test.ts`
Expected: FAIL, `Cannot find module './xdg.js'`.

- [ ] **Step 3: Write `src/xdg.ts`**

With the header block (path `src/xdg.ts`):

```ts
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";

export type Env = Record<string, string | undefined>;

// XDG treats an empty or relative base directory as unset. An empty HOME
// would otherwise put files under the working directory.
export function xdgDir(
    env: Env,
    variable: "XDG_DATA_HOME" | "XDG_CONFIG_HOME",
    fallback: string,
): string {
    const xdg = env[variable] ?? "";
    return isAbsolute(xdg) ? xdg : join(env.HOME || homedir(), fallback);
}
```

- [ ] **Step 4: Use it in `src/transcript.ts`**

Replace the `node:os` import and the `node:path` import with:

```ts
import { dirname, join } from "node:path";
```

add `import { type Env, xdgDir } from "./xdg.js";`, delete the local
`type Env = …` line, and make `transcriptDir`:

```ts
export function transcriptDir(env: Env = process.env): string {
    return join(xdgDir(env, "XDG_DATA_HOME", ".local/share"), "dorothy", "transcripts");
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `bun test src/xdg.test.ts src/transcript.test.ts`
Expected: PASS, including `transcriptDir`'s four existing tests.

- [ ] **Step 6: Commit**

```bash
bun run format && bun run lint
git add src/xdg.ts src/xdg.test.ts src/transcript.ts
git commit -m "refactor(sdk): Share the XDG directory lookup"
```

---

### Task 2: Read settings from `config.toml`

**Files:**

- Create: `src/config.ts`, `src/config.test.ts`

**Interfaces:**

- Consumes: `Env`, `xdgDir` from `./xdg.js` (Task 1).
- Produces:
  - `MODULE_NAMES` (readonly tuple of the eight names, in the spec's order)
  - `type ModuleName = (typeof MODULE_NAMES)[number]`
  - `type LineConfig = { modules: ModuleName[]; maxLines: number }`
  - `type Config = { statusline: LineConfig; replyStats: LineConfig }`
  - `MAX_LINES = 5`, `DEFAULT_CONFIG: Config`
  - `parseConfig(text: string): { config: Config; warnings: string[] }`
  - `configPath(env?: Env): string`
  - `readConfig(env?: Env): Promise<{ config: Config; warnings: string[] }>`

- [ ] **Step 1: Write the failing tests**

Create `src/config.test.ts` with the header block and:

```ts
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
    configPath,
    DEFAULT_CONFIG,
    parseConfig,
    readConfig,
} from "./config.js";

describe("parseConfig", () => {
    it("gives the defaults for an empty file", () => {
        expect(parseConfig("")).toEqual({
            config: DEFAULT_CONFIG,
            warnings: [],
        });
    });

    it("reads both tables", () => {
        const text = [
            "[statusline]",
            'modules = ["cost", "in"]',
            "max-lines = 2",
            "",
            "[reply-stats]",
            "modules = []",
        ].join("\n");
        expect(parseConfig(text)).toEqual({
            config: {
                statusline: { modules: ["cost", "in"], maxLines: 2 },
                replyStats: { modules: [], maxLines: 1 },
            },
            warnings: [],
        });
    });

    it("keeps a table's defaults for the keys it leaves out", () => {
        expect(parseConfig("[statusline]\nmax-lines = 3").config).toEqual({
            ...DEFAULT_CONFIG,
            statusline: {
                modules: DEFAULT_CONFIG.statusline.modules,
                maxLines: 3,
            },
        });
    });

    it("reads comments, CRLF and a BOM", () => {
        const text = "\uFEFF# mine\r\n[statusline]\r\nmax-lines = 2\r\n";
        expect(parseConfig(text)).toEqual({
            config: {
                ...DEFAULT_CONFIG,
                statusline: { ...DEFAULT_CONFIG.statusline, maxLines: 2 },
            },
            warnings: [],
        });
    });

    it("falls back to the defaults on invalid TOML, saying why", () => {
        expect(parseConfig("[statusline]\nmax-lines =")).toEqual({
            config: DEFAULT_CONFIG,
            warnings: ["config.toml: Missing value after '='"],
        });
    });

    it("skips unknown and repeated modules, one warning each", () => {
        const text = '[statusline]\nmodules = ["cost", "tokens", "cost", "in"]';
        expect(parseConfig(text)).toEqual({
            config: {
                ...DEFAULT_CONFIG,
                statusline: { modules: ["cost", "in"], maxLines: 1 },
            },
            warnings: [
                "config.toml: unknown module tokens in statusline",
                "config.toml: cost repeated in statusline",
            ],
        });
    });

    it("keeps the default modules when modules is not a list of names", () => {
        for (const value of ['"cost"', "[1, 2]"]) {
            expect(parseConfig(`[reply-stats]\nmodules = ${value}`)).toEqual({
                config: DEFAULT_CONFIG,
                warnings: [
                    "config.toml: reply-stats.modules is not a list of module names",
                ],
            });
        }
    });

    it("takes one line when max-lines is not a whole number from 1 to 5", () => {
        for (const value of ["0", "6", "2.5", '"2"']) {
            expect(parseConfig(`[statusline]\nmax-lines = ${value}`)).toEqual({
                config: DEFAULT_CONFIG,
                warnings: [
                    "config.toml: statusline.max-lines must be a whole number from 1 to 5",
                ],
            });
        }
    });

    it("ignores unknown tables and keys, naming each", () => {
        const text = "colours = 1\n[statusline]\nmax_lines = 2";
        expect(parseConfig(text)).toEqual({
            config: DEFAULT_CONFIG,
            warnings: [
                "config.toml: unknown key colours",
                "config.toml: unknown key statusline.max_lines",
            ],
        });
    });

    it("keeps a table's defaults when it is not a table", () => {
        expect(parseConfig("statusline = 3")).toEqual({
            config: DEFAULT_CONFIG,
            warnings: ["config.toml: statusline is not a table"],
        });
    });
});

describe("readConfig", () => {
    let dir = "";
    beforeEach(async () => {
        dir = await mkdtemp(join(tmpdir(), "dorothy-config-"));
    });
    afterEach(async () => {
        await rm(dir, { recursive: true, force: true });
    });

    it("reads $XDG_CONFIG_HOME/dorothy/config.toml", async () => {
        await mkdir(join(dir, "dorothy"));
        await writeFile(
            join(dir, "dorothy", "config.toml"),
            "[statusline]\nmax-lines = 2\n",
        );
        const { config } = await readConfig({ XDG_CONFIG_HOME: dir });
        expect(config.statusline.maxLines).toBe(2);
    });

    it("gives the defaults, quietly, when there is no file", async () => {
        expect(await readConfig({ XDG_CONFIG_HOME: dir })).toEqual({
            config: DEFAULT_CONFIG,
            warnings: [],
        });
    });

    it("warns and gives the defaults when the file cannot be read", async () => {
        await mkdir(join(dir, "dorothy", "config.toml"), { recursive: true });
        const { config, warnings } = await readConfig({ XDG_CONFIG_HOME: dir });
        expect(config).toEqual(DEFAULT_CONFIG);
        expect(warnings).toHaveLength(1);
        expect(warnings[0]).toStartWith("config.toml: ");
    });

    it("looks under HOME when XDG_CONFIG_HOME is unset, empty or relative", () => {
        for (const value of [undefined, "", "conf"]) {
            expect(configPath({ XDG_CONFIG_HOME: value, HOME: "/home/u" })).toBe(
                "/home/u/.config/dorothy/config.toml",
            );
        }
    });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `bun test src/config.test.ts`
Expected: FAIL, `Cannot find module './config.js'`.

- [ ] **Step 3: Write `src/config.ts`**

With the header block (path `src/config.ts`):

```ts
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { type Env, xdgDir } from "./xdg.js";

export const MODULE_NAMES = [
    "in",
    "cache-read",
    "cache-write",
    "out",
    "ttft",
    "duration",
    "cost",
    "chat-cost",
] as const;
export type ModuleName = (typeof MODULE_NAMES)[number];
export type LineConfig = { modules: ModuleName[]; maxLines: number };
export type Config = { statusline: LineConfig; replyStats: LineConfig };

// More would let a statusline crowd out the reply; five keeps the smallest
// window at 24 lines.
export const MAX_LINES = 5;

export const DEFAULT_CONFIG: Config = {
    statusline: {
        modules: ["chat-cost", "cost", "in", "out", "ttft", "duration"],
        maxLines: 1,
    },
    replyStats: {
        modules: [
            "in",
            "cache-read",
            "cache-write",
            "out",
            "ttft",
            "duration",
            "cost",
            "chat-cost",
        ],
        maxLines: 1,
    },
};

// Tables as the file names them, and the field of Config each fills.
const TABLES = { statusline: "statusline", "reply-stats": "replyStats" } as const;

const describeError = (error: unknown) =>
    error instanceof Error ? error.message : String(error);
const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value);
const isModule = (name: string): name is ModuleName =>
    (MODULE_NAMES as readonly string[]).includes(name);

function parseLine(
    table: string,
    value: unknown,
    fallback: LineConfig,
    warnings: string[],
): LineConfig {
    if (!isRecord(value)) {
        warnings.push(`config.toml: ${table} is not a table`);
        return fallback;
    }
    const line = { ...fallback };
    for (const [key, field] of Object.entries(value)) {
        if (key === "modules") {
            if (
                !Array.isArray(field) ||
                !field.every((name) => typeof name === "string")
            ) {
                warnings.push(
                    `config.toml: ${table}.modules is not a list of module names`,
                );
                continue;
            }
            const modules: ModuleName[] = [];
            for (const name of field as string[]) {
                if (!isModule(name)) {
                    warnings.push(
                        `config.toml: unknown module ${name} in ${table}`,
                    );
                } else if (modules.includes(name)) {
                    warnings.push(`config.toml: ${name} repeated in ${table}`);
                } else {
                    modules.push(name);
                }
            }
            line.modules = modules;
        } else if (key === "max-lines") {
            const valid =
                typeof field === "number" &&
                Number.isInteger(field) &&
                field >= 1 &&
                field <= MAX_LINES;
            if (!valid) {
                warnings.push(
                    `config.toml: ${table}.max-lines must be a whole number from 1 to ${MAX_LINES}`,
                );
            }
            line.maxLines = valid ? field : 1;
        } else {
            warnings.push(`config.toml: unknown key ${table}.${key}`);
        }
    }
    return line;
}

// A broken file never stops Dorothy: each problem is a warning, and whatever
// it spoils falls back to the default.
export function parseConfig(text: string): {
    config: Config;
    warnings: string[];
} {
    let data: unknown;
    try {
        data = Bun.TOML.parse(text);
    } catch (error) {
        const reason = describeError(error).replace(/^TOML Parse error: /, "");
        return { config: DEFAULT_CONFIG, warnings: [`config.toml: ${reason}`] };
    }
    const config = { ...DEFAULT_CONFIG };
    const warnings: string[] = [];
    for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
        if (Object.hasOwn(TABLES, key)) {
            const field = TABLES[key as keyof typeof TABLES];
            config[field] = parseLine(key, value, DEFAULT_CONFIG[field], warnings);
        } else {
            warnings.push(`config.toml: unknown key ${key}`);
        }
    }
    return { config, warnings };
}

export function configPath(env: Env = process.env): string {
    return join(xdgDir(env, "XDG_CONFIG_HOME", ".config"), "dorothy", "config.toml");
}

// No file is the defaults, quietly; a file that cannot be read is a warning.
export async function readConfig(
    env: Env = process.env,
): Promise<{ config: Config; warnings: string[] }> {
    let text: string;
    try {
        text = await readFile(configPath(env), "utf8");
    } catch (error) {
        if ((error as { code?: unknown }).code === "ENOENT") {
            return { config: DEFAULT_CONFIG, warnings: [] };
        }
        return {
            config: DEFAULT_CONFIG,
            warnings: [`config.toml: ${describeError(error)}`],
        };
    }
    return parseConfig(text);
}
```

- [ ] **Step 4: Run them to verify they pass**

Run: `bun test src/config.test.ts && bun run typecheck`
Expected: PASS, 14 tests; typecheck clean.

- [ ] **Step 5: Commit**

```bash
bun run format && bun run lint
git add src/config.ts src/config.test.ts
git commit -m "feat(sdk): Read settings from config.toml"
```

---

### Task 3: Render and fit statusline modules

**Files:**

- Create: `src/tui/statusline.ts`, `src/tui/statusline.test.ts`

**Interfaces:**

- Consumes: `ModuleName`, `LineConfig`, `MODULE_NAMES` from `../config.js`;
  `TurnStats` from `../conversation.js` (type only).
- Produces:
  - `SEPARATOR = " · "`
  - `renderModule(name: ModuleName, stats: TurnStats | null, chatCostUsd: number): string | null`
  - `fitModules(pieces: string[], width: number, maxLines: number): string[]`
  - `moduleRows(line: LineConfig, stats: TurnStats | null, chatCostUsd: number, width: number): string[]`

- [ ] **Step 1: Write the failing tests**

Create `src/tui/statusline.test.ts` with the header block and:

```ts
import { describe, expect, it } from "bun:test";
import stringWidth from "string-width";
import { MODULE_NAMES } from "../config.js";
import type { TurnStats } from "../conversation.js";
import { fitModules, moduleRows, renderModule } from "./statusline.js";

const stats: TurnStats = {
    inputTokens: 12,
    cacheReadTokens: 3000,
    cacheWriteTokens: 400,
    outputTokens: 40,
    ttftMs: 900,
    durationMs: 2100,
    costUsd: 0.0012,
    sessionCostUsd: 0.0034,
};

describe("renderModule", () => {
    it("renders each module of a turn", () => {
        expect(
            MODULE_NAMES.map((name) => renderModule(name, stats, 0.005)),
        ).toEqual([
            "12 in",
            "3000 cache read",
            "400 cache write",
            "40 out",
            "ttft 0.9s",
            "2.1s",
            "$0.0012",
            "chat $0.0050",
        ]);
    });

    it("renders nothing for cache use or a first token there was none of", () => {
        const none = {
            ...stats,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            ttftMs: null,
        };
        expect(
            (["cache-read", "cache-write", "ttft"] as const).map((name) =>
                renderModule(name, none, 0),
            ),
        ).toEqual([null, null, null]);
    });

    it("renders only the chat's cost before the first turn", () => {
        expect(MODULE_NAMES.map((name) => renderModule(name, null, 0.25))).toEqual(
            [null, null, null, null, null, null, null, "chat $0.2500"],
        );
    });
});

describe("fitModules", () => {
    const pieces = [
        "2 in",
        "1010 cache read",
        "286 cache write",
        "378 out",
        "ttft 1.9s",
        "5.3s",
        "$0.0051",
    ];

    it("joins what fits on one row", () => {
        expect(fitModules(["2 in", "378 out"], 40, 1)).toEqual([
            "2 in · 378 out",
        ]);
    });

    it("drops from the right what does not fit", () => {
        expect(fitModules(pieces, 40, 1)).toEqual([
            "2 in · 1010 cache read · 286 cache write",
        ]);
    });

    it("overflows onto up to maxLines rows", () => {
        expect(fitModules(pieces, 40, 2)).toEqual([
            "2 in · 1010 cache read · 286 cache write",
            "378 out · ttft 1.9s · 5.3s · $0.0051",
        ]);
    });

    it("never draws a piece after one it dropped", () => {
        expect(fitModules(["aaaa", "bbbbbbbbbb", "c"], 12, 1)).toEqual([
            "aaaa",
        ]);
    });

    it("measures wide characters as two columns", () => {
        expect(fitModules(["会話", "ab"], 8, 1)).toEqual(["会話"]);
        expect(fitModules(["会話", "ab"], 9, 1)).toEqual(["会話 · ab"]);
    });

    it("draws only the rows it uses", () => {
        expect(fitModules(["a"], 40, 3)).toEqual(["a"]);
        expect(fitModules([], 40, 3)).toEqual([]);
    });

    it("keeps every row within the width", () => {
        for (let width = 10; width <= 60; width++) {
            for (const maxLines of [1, 2, 3]) {
                for (const row of fitModules(pieces, width, maxLines)) {
                    expect(stringWidth(row)).toBeLessThanOrEqual(width);
                }
            }
        }
    });
});

describe("moduleRows", () => {
    it("renders a line's modules in its order and fits them", () => {
        expect(
            moduleRows(
                { modules: ["out", "in", "ttft"], maxLines: 1 },
                { ...stats, ttftMs: null },
                0,
                40,
            ),
        ).toEqual(["40 out · 12 in"]);
    });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `bun test src/tui/statusline.test.ts`
Expected: FAIL, `Cannot find module './statusline.js'`.

- [ ] **Step 3: Write `src/tui/statusline.ts`**

With the header block (path `src/tui/statusline.ts`):

```ts
import stringWidth from "string-width";
import type { LineConfig, ModuleName } from "../config.js";
import type { TurnStats } from "../conversation.js";

export const SEPARATOR = " · ";

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)}s`;
const dollars = (usd: number) => `$${usd.toFixed(4)}`;

// A module's text, or null when it has nothing to say: no turn yet, or
// cache use or a first token there was none of.
export function renderModule(
    name: ModuleName,
    stats: TurnStats | null,
    chatCostUsd: number,
): string | null {
    if (name === "chat-cost") {
        return `chat ${dollars(chatCostUsd)}`;
    }
    if (stats === null) {
        return null;
    }
    switch (name) {
        case "in":
            return `${stats.inputTokens} in`;
        case "cache-read":
            return stats.cacheReadTokens > 0
                ? `${stats.cacheReadTokens} cache read`
                : null;
        case "cache-write":
            return stats.cacheWriteTokens > 0
                ? `${stats.cacheWriteTokens} cache write`
                : null;
        case "out":
            return `${stats.outputTokens} out`;
        case "ttft":
            return stats.ttftMs === null ? null : `ttft ${seconds(stats.ttftMs)}`;
        case "duration":
            return seconds(stats.durationMs);
        case "cost":
            return dollars(stats.costUsd);
    }
}

// Pieces fill rows left to right and never split. The first that fits
// neither the current row nor a new one ends the line, so a later, shorter
// piece never shows without one ranked before it.
export function fitModules(
    pieces: string[],
    width: number,
    maxLines: number,
): string[] {
    const rows: string[] = [];
    for (const piece of pieces) {
        const last = rows.at(-1);
        const joined = last === undefined ? null : `${last}${SEPARATOR}${piece}`;
        if (joined !== null && stringWidth(joined) <= width) {
            rows[rows.length - 1] = joined;
        } else if (rows.length < maxLines && stringWidth(piece) <= width) {
            rows.push(piece);
        } else {
            break;
        }
    }
    return rows;
}

export function moduleRows(
    line: LineConfig,
    stats: TurnStats | null,
    chatCostUsd: number,
    width: number,
): string[] {
    const pieces = line.modules
        .map((name) => renderModule(name, stats, chatCostUsd))
        .filter((piece): piece is string => piece !== null);
    return fitModules(pieces, width, line.maxLines);
}
```

- [ ] **Step 4: Run them to verify they pass**

Run: `bun test src/tui/statusline.test.ts src/tui/boundary.test.ts && bun run typecheck`
Expected: PASS; typecheck clean.

- [ ] **Step 5: Commit**

```bash
bun run format && bun run lint
git add src/tui/statusline.ts src/tui/statusline.test.ts
git commit -m "feat(tui): Render and fit statusline modules"
```

---

### Task 4: Configure the stats under each reply

**Files:**

- Modify: `src/tui/History.tsx`, `src/tui/LiveReply.tsx:13,17-34`,
  `src/tui/App.tsx`, `src/tui/run.tsx`, `src/tui/state.ts:56-78`
- Test: `src/tui/components.test.tsx`, `src/tui/App.test.tsx`,
  `src/tui/state.test.ts`

**Interfaces:**

- Consumes: `moduleRows` (Task 3); `Config`, `LineConfig`, `DEFAULT_CONFIG`,
  `readConfig` (Task 2).
- Produces: `History({ lines, replyStats }: { lines: Line[]; replyStats: LineConfig })`;
  `AppProps.config?: Config` (default `DEFAULT_CONFIG`); `formatStats` is
  removed.

- [ ] **Step 1: Write the failing tests**

In `src/tui/components.test.tsx`: add
`import { DEFAULT_CONFIG } from "../config.js";`, change the `LiveReply`
import to `import { LiveReply, wrapRows } from "./LiveReply.js";`, delete the
whole `describe("formatStats", …)` block, give every `<History lines={…} />`
in the file the prop `replyStats={DEFAULT_CONFIG.replyStats}`, and add to
`describe("History and LiveReply", …)`:

```tsx
    it("draws reply stats in the configured order", () => {
        const { lastFrame } = render(
            <History
                lines={[
                    {
                        id: 0,
                        role: "dorothy",
                        text: "Hi",
                        stats,
                        chatCostUsd: 0.5,
                    },
                ]}
                replyStats={{ modules: ["chat-cost", "out", "in"], maxLines: 1 }}
            />,
        );
        expect(lastFrame()).toContain(
            `${" ".repeat(9)}chat $0.5000 · 40 out · 12 in`,
        );
    });

    it("draws no stats row when no modules are configured", () => {
        const { lastFrame } = render(
            <History
                lines={[{ id: 0, role: "dorothy", text: "Hi", stats }]}
                replyStats={{ modules: [], maxLines: 1 }}
            />,
        );
        expect((lastFrame() ?? "").split("\n")).toHaveLength(1);
    });

    it("drops or overflows reply stats that do not fit", () => {
        // 94 columns of stats beside a 91-column reply.
        const lines = [
            { id: 0, role: "dorothy" as const, text: "Hi", stats },
        ];
        const one =
            render(
                <History
                    lines={lines}
                    replyStats={{ ...DEFAULT_CONFIG.replyStats, maxLines: 1 }}
                />,
            ).lastFrame() ?? "";
        expect(one).toContain("· $0.0012");
        expect(one).not.toContain("chat $");
        const two =
            render(
                <History
                    lines={lines}
                    replyStats={{ ...DEFAULT_CONFIG.replyStats, maxLines: 2 }}
                />,
            ).lastFrame() ?? "";
        expect(two.split("\n").at(-1)).toBe(`${" ".repeat(9)}chat $0.0034`);
    });
```

In the existing "renders finished lines with stats and interruption" test
the assertion `toContain("12 in · 3000 cache read")` stays.

In `src/tui/App.test.tsx`: add
`import { type Config, DEFAULT_CONFIG } from "../config.js";`, give
`setup` a `config` option passed to `<App config={config} … />`:

```tsx
function setup({
    history = [],
    failWrites = false,
    config = DEFAULT_CONFIG,
}: {
    history?: Turn[];
    failWrites?: boolean;
    config?: Config;
} = {}) {
```

and add to `describe("App", …)`:

```tsx
    it("draws reply stats as configured", async () => {
        const { app, session, type } = setup({
            // No statusline, whose defaults would show "1 in" too.
            config: {
                statusline: { modules: [], maxLines: 1 },
                replyStats: { modules: ["out"], maxLines: 1 },
            },
        });
        await tick();
        await type("hello");
        await type("\r");
        session().emit({
            type: "turn-end",
            reply: "Hi there",
            interrupted: false,
            stats,
        });
        await tick();
        expect(app.lastFrame()).toContain(`${" ".repeat(9)}2 out`);
        expect(app.lastFrame()).not.toContain("1 in");
    });
```

In `src/tui/state.test.ts`, add to the `initialState` tests (or a new
`describe("initialState", …)`):

```ts
    it("initialState keeps the last three distinct warnings", () => {
        expect(
            initialState([], ["a", "b", "a", "c", "d"]).warnings,
        ).toEqual(["b", "c", "d"]);
    });
```

- [ ] **Step 2: Run them to verify they fail**

Run: `bun test src/tui`
Expected: FAIL: the three new History tests (the config is ignored; the
default line still ends `(chat $…)`), "draws reply stats as configured", and
"initialState keeps the last three distinct warnings" (all five kept).

- [ ] **Step 3: Draw reply stats from the config**

In `src/tui/LiveReply.tsx` delete `formatStats` and the
`import type { TurnStats } from "../conversation.js";` line.

In `src/tui/History.tsx` replace the imports from `./LiveReply.js` and
`./state.js` with:

```ts
import type { LineConfig } from "../config.js";
import { LABEL_WIDTH, wrapRows } from "./LiveReply.js";
import type { Line } from "./state.js";
import { moduleRows } from "./statusline.js";
```

Make `LineView` take `{ line, replyStats }: { line: Line; replyStats: LineConfig }`
and replace its stats block with:

```tsx
            {line.stats ? (
                <Box marginLeft={LABEL_WIDTH} flexDirection="column">
                    {moduleRows(
                        replyStats,
                        line.stats,
                        line.chatCostUsd ?? line.stats.sessionCostUsd,
                        columns - LABEL_WIDTH,
                    ).map((row, index) => (
                        // biome-ignore lint/suspicious/noArrayIndexKey: rows are positional.
                        <Text key={index} dimColor>
                            {row}
                        </Text>
                    ))}
                </Box>
            ) : null}
```

and `History`:

```tsx
export function History({
    lines,
    replyStats,
}: {
    lines: Line[];
    replyStats: LineConfig;
}) {
    return (
        <Static items={lines} style={FULL_WIDTH}>
            {(line) => (
                <LineView key={line.id} line={line} replyStats={replyStats} />
            )}
        </Static>
    );
}
```

In `src/tui/App.tsx` add
`import { type Config, DEFAULT_CONFIG } from "../config.js";`, add to
`AppProps`:

```ts
    // The statusline and reply stats; the defaults when not given.
    config?: Config;
```

destructure `config = DEFAULT_CONFIG`, and render
`<History lines={state.lines} replyStats={config.replyStats} />`.

In `src/tui/run.tsx` add `import { readConfig } from "../config.js";` and,
before `if (resume !== null) {`:

```ts
    const { config, warnings: configWarnings } = await readConfig();
    warnings.push(...configWarnings);
```

and pass `config={config}` to `<App>`.

In `src/tui/state.ts`, make `initialState` keep the warnings the reducer
would:

```ts
        warnings: [...new Set(warnings)].slice(-WARNING_LIMIT),
```

- [ ] **Step 4: Run them to verify they pass**

Run: `bun test && bun run typecheck`
Expected: PASS, the whole suite; typecheck clean.

- [ ] **Step 5: Commit**

```bash
bun run format && bun run lint
git add src/tui/History.tsx src/tui/LiveReply.tsx src/tui/App.tsx src/tui/run.tsx src/tui/state.ts src/tui/components.test.tsx src/tui/App.test.tsx src/tui/state.test.ts
git commit -m "feat(tui): Configure the stats under each reply"
```

---

### Task 5: Keep each resumed reply's stats

**Files:**

- Modify: `src/transcript.ts:84-119`, `src/tui/state.ts:56-66`,
  `src/tui/App.tsx` (`history` prop type), `src/tui/run.tsx` (`history`)
- Test: `src/transcript.test.ts`, `src/tui/state.test.ts`,
  `src/tui/App.test.tsx`

**Interfaces:**

- Consumes: `TurnStats` (type) from `./conversation.js`.
- Produces: `type ResumedTurn = Turn & { stats?: TurnStats; chatCostUsd?: number }`
  from `src/transcript.ts`; `readTranscript(path): Promise<{ turns: ResumedTurn[]; skipped: number; costUsd: number }>`;
  `initialState(history: readonly ResumedTurn[], …)`;
  `AppProps.history: ResumedTurn[]`.

- [ ] **Step 1: Write the failing tests**

In `src/transcript.test.ts`, change the expected `turns` of "returns turns
in order and the cost so far, skipping malformed lines" to:

```ts
            turns: [
                { role: "user", text: "hello" },
                {
                    role: "assistant",
                    text: "hi there",
                    stats: {
                        inputTokens: 1,
                        cacheReadTokens: 0,
                        cacheWriteTokens: 0,
                        outputTokens: 2,
                        ttftMs: null,
                        durationMs: 3,
                        costUsd: 0.25,
                        sessionCostUsd: 0.25,
                    },
                    chatCostUsd: 0.25,
                },
            ],
```

(its stats line predates cache counts, which read as 0) and add to
`describe("readTranscript", …)`:

```ts
    const statsLine = (costUsd: number, extra = {}) =>
        JSON.stringify({
            v: 1,
            kind: "stats",
            at: "x",
            inputTokens: 1,
            cacheReadTokens: 2,
            cacheWriteTokens: 3,
            outputTokens: 4,
            ttftMs: 5,
            durationMs: 6,
            costUsd,
            sessionCostUsd: costUsd,
            ...extra,
        });
    const turnLine = (kind: string, text: string) =>
        JSON.stringify({ v: 1, kind, at: "x", text, interrupted: false });
    const turnStats = (costUsd: number) => ({
        inputTokens: 1,
        cacheReadTokens: 2,
        cacheWriteTokens: 3,
        outputTokens: 4,
        ttftMs: 5,
        durationMs: 6,
        costUsd,
        sessionCostUsd: costUsd,
    });

    it("gives each reply its stats and the chat's cost by then", async () => {
        const path = join(dir, "stats.jsonl");
        await writeFile(
            path,
            [
                turnLine("user", "a"),
                turnLine("assistant", "b"),
                statsLine(0.25),
                turnLine("user", "c"),
                turnLine("assistant", "d"),
                turnLine("user", "e"),
                turnLine("assistant", "f"),
                statsLine(0.5),
            ].join("\n"),
        );
        expect((await readTranscript(path)).turns).toEqual([
            { role: "user", text: "a" },
            {
                role: "assistant",
                text: "b",
                stats: turnStats(0.25),
                chatCostUsd: 0.25,
            },
            { role: "user", text: "c" },
            { role: "assistant", text: "d" },
            { role: "user", text: "e" },
            {
                role: "assistant",
                text: "f",
                stats: turnStats(0.5),
                chatCostUsd: 0.75,
            },
        ]);
    });

    it("attaches no stats that are malformed or follow no reply", async () => {
        const path = join(dir, "stray.jsonl");
        await writeFile(
            path,
            [
                turnLine("user", "a"),
                statsLine(0.25),
                turnLine("assistant", "b"),
                statsLine(0.5, { inputTokens: "many" }),
            ].join("\n"),
        );
        expect(await readTranscript(path)).toEqual({
            turns: [
                { role: "user", text: "a" },
                { role: "assistant", text: "b" },
            ],
            skipped: 0,
            costUsd: 0.75,
        });
    });
```

In `src/tui/state.test.ts`:

```ts
    it("initialState gives resumed replies their stats", () => {
        expect(
            initialState([
                { role: "user", text: "a" },
                { role: "assistant", text: "b", stats, chatCostUsd: 0.5 },
            ]).lines,
        ).toEqual([
            { id: 0, role: "you", text: "a" },
            { id: 1, role: "dorothy", text: "b", stats, chatCostUsd: 0.5 },
        ]);
    });
```

In `src/tui/App.test.tsx`, change `setup`'s `history?: Turn[]` to
`history?: ResumedTurn[]` (import `type ResumedTurn` from
`../transcript.js`) and add:

```tsx
    it("shows a resumed reply's stats", async () => {
        const { app } = setup({
            history: [
                { role: "user", text: "earlier" },
                {
                    role: "assistant",
                    text: "yes",
                    stats,
                    chatCostUsd: 0.002,
                },
            ],
        });
        await tick();
        expect(app.lastFrame()).toContain(
            "1 in · 2 out · ttft 0.3s · 1.5s · $0.0010 · chat $0.0020",
        );
    });
```

- [ ] **Step 2: Run them to verify they fail**

Run: `bun test src/transcript.test.ts src/tui`
Expected: FAIL: the changed and two new `readTranscript` tests (no `stats`
on turns), "initialState gives resumed replies their stats", "shows a
resumed reply's stats".

- [ ] **Step 3: Attach stats when reading**

In `src/transcript.ts` add `import type { TurnStats } from "./conversation.js";`
and:

```ts
// A turn read back from a transcript: a reply keeps the stats recorded after
// it and what the chat had cost by then.
export type ResumedTurn = Turn & { stats?: TurnStats; chatCostUsd?: number };

const finite = (value: unknown): value is number =>
    typeof value === "number" && Number.isFinite(value);

// Transcripts from before cache use was recorded have no cache counts.
function toStats(event: Record<string, unknown>): TurnStats | null {
    const stats = {
        inputTokens: event.inputTokens,
        cacheReadTokens: event.cacheReadTokens ?? 0,
        cacheWriteTokens: event.cacheWriteTokens ?? 0,
        outputTokens: event.outputTokens,
        ttftMs: event.ttftMs,
        durationMs: event.durationMs,
        costUsd: event.costUsd,
        sessionCostUsd: event.sessionCostUsd,
    };
    const { ttftMs, ...counts } = stats;
    return Object.values(counts).every(finite) &&
        (ttftMs === null || finite(ttftMs))
        ? (stats as TurnStats)
        : null;
}
```

Change `readTranscript`'s return type to
`Promise<{ turns: ResumedTurn[]; skipped: number; costUsd: number }>`,
declare `const turns: ResumedTurn[] = [];` and
`let reply: ResumedTurn | null = null;` (the reply a stats line would belong
to), and replace everything in the loop after the `JSON.parse` `try`/`catch`
with:

```ts
        if ((event as { kind?: unknown } | null)?.kind === "stats") {
            const fields = event as Record<string, unknown>;
            const cost = fields.costUsd;
            if (finite(cost)) {
                costUsd += cost;
            }
            const stats = toStats(fields);
            if (reply !== null && stats !== null) {
                reply.stats = stats;
                reply.chatCostUsd = costUsd;
            }
            reply = null;
            continue;
        }
        const turn = toTurn(event);
        if (turn === "malformed") {
            skipped++;
        } else if (turn !== "ignore") {
            turns.push(turn);
            reply = turn.role === "assistant" ? turn : null;
        }
```

In `src/tui/state.ts` import `type ResumedTurn` from `../transcript.js` in
place of `Turn` from `../persona.js` (keep `Turn` if still used), type
`initialState`'s `history` as `readonly ResumedTurn[]`, and map:

```ts
        lines: history.map((turn, id) => ({
            id,
            role: turn.role === "user" ? "you" : "dorothy",
            text: turn.text,
            stats: turn.stats,
            chatCostUsd: turn.chatCostUsd,
        })),
```

In `src/tui/App.tsx` type `AppProps.history` as `ResumedTurn[]` (import the
type from `../transcript.js`); `turns` stays `useRef<Turn[]>([...history])`.
In `src/tui/run.tsx` declare `let history: ResumedTurn[] = [];`.

- [ ] **Step 4: Run them to verify they pass**

Run: `bun test && bun run typecheck`
Expected: PASS, the whole suite; typecheck clean. App's "reconnects with
full history" still sees plain turns, since its history has no stats.

- [ ] **Step 5: Commit**

```bash
bun run format && bun run lint
git add src/transcript.ts src/transcript.test.ts src/tui/state.ts src/tui/state.test.ts src/tui/App.tsx src/tui/App.test.tsx src/tui/run.tsx
git commit -m "feat(sdk): Keep each resumed reply's stats"
```

---

### Task 6: Budget rows for a statusline and a 5-row draft

**Files:**

- Modify: `src/tui/layout.ts` (whole file), `src/tui/App.tsx` (the
  `fitLayout` call)
- Test: `src/tui/layout.test.ts` (whole file)

**Interfaces:**

- Consumes: `WARNING_LIMIT` from `./state.js`.
- Produces: `MIN_COLUMNS = 40`; `INPUT_MAX_ROWS = 5`;
  `minRows(statusLines: number): number`;
  `tooSmallMessage(neededRows: number, rows: number, columns: number): string`;
  `fitLayout(rows, { showRaw, rawCount, warnings, statusRows, inputRows }): Layout`.

- [ ] **Step 1: Write the failing tests**

Replace the body of `src/tui/layout.test.ts` below its header with:

```ts
import { describe, expect, it } from "bun:test";
import {
    fitLayout,
    INPUT_MAX_ROWS,
    MIN_COLUMNS,
    minRows,
    tooSmallMessage,
} from "./layout.js";

type Options = Parameters<typeof fitLayout>[1];
// Every row of the live region: the reply, the raw pane and its frame, the
// border, the warnings, the input, the statusline and the header.
const used = (rows: number, options: Options) => {
    const { replyRows, rawRows, inputRows } = fitLayout(rows, options);
    return (
        replyRows +
        rawRows +
        (options.showRaw ? 3 : 0) +
        1 +
        options.warnings +
        inputRows +
        options.statusRows +
        1
    );
};

describe("minRows", () => {
    it("is 19 lines and the statusline's", () => {
        expect([minRows(0), minRows(1), minRows(5)]).toEqual([19, 20, 24]);
        expect([MIN_COLUMNS, INPUT_MAX_ROWS]).toEqual([40, 5]);
    });
});

describe("tooSmallMessage", () => {
    it("names the minimum and the window", () => {
        expect(tooSmallMessage(20, 14, 80)).toBe(
            "Too Small: Dorothy's TUI needs at least 20 lines and 40 columns (this window is 14 × 80)",
        );
    });
});

describe("fitLayout", () => {
    it("fits every part, two rows short of the window, from the minimum up", () => {
        for (let statusLines = 0; statusLines <= 5; statusLines++) {
            for (let rows = minRows(statusLines); rows <= 60; rows++) {
                for (const showRaw of [false, true]) {
                    for (let warnings = 0; warnings <= 3; warnings++) {
                        for (let statusRows = 0; statusRows <= statusLines; statusRows++) {
                            for (const wanted of [1, 3, 5, 6, 50]) {
                                const options = {
                                    showRaw,
                                    rawCount: 20,
                                    warnings,
                                    statusRows,
                                    inputRows: wanted,
                                };
                                const layout = fitLayout(rows, options);
                                expect(used(rows, options)).toBe(rows - 2);
                                expect(layout.replyRows).toBeGreaterThanOrEqual(3);
                                expect(layout.inputRows).toBe(Math.min(wanted, 5));
                                expect(layout.rawRows > 0).toBe(showRaw);
                            }
                        }
                    }
                }
            }
        }
    });

    it("gives the reply the room the raw pane does not use", () => {
        const options = {
            showRaw: false,
            rawCount: 20,
            warnings: 0,
            statusRows: 1,
            inputRows: 1,
        };
        expect(fitLayout(24, options)).toEqual({
            replyRows: 18,
            rawRows: 0,
            inputRows: 1,
        });
        expect(fitLayout(24, { ...options, showRaw: true })).toEqual({
            replyRows: 10,
            rawRows: 5,
            inputRows: 1,
        });
    });

    it("shows no more raw rows than there are messages", () => {
        expect(
            fitLayout(50, {
                showRaw: true,
                rawCount: 2,
                warnings: 0,
                statusRows: 1,
                inputRows: 1,
            }).rawRows,
        ).toBe(2);
    });

    it("caps the input at five rows", () => {
        const options = {
            showRaw: false,
            rawCount: 0,
            warnings: 0,
            statusRows: 1,
            inputRows: 30,
        };
        expect(fitLayout(60, options).inputRows).toBe(5);
        expect(fitLayout(60, { ...options, inputRows: 2 }).inputRows).toBe(2);
    });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `bun test src/tui/layout.test.ts`
Expected: FAIL: `minRows`, `tooSmallMessage`, `MIN_COLUMNS` and
`INPUT_MAX_ROWS` are not exported; the old `fitLayout` caps the input at a
third of the window and ignores `statusRows`.

- [ ] **Step 3: Rewrite `src/tui/layout.ts`**

Below the header block:

```ts
import { WARNING_LIMIT } from "./state.js";

// The narrowest window the TUI draws in, and the most rows a draft shows.
export const MIN_COLUMNS = 40;
export const INPUT_MAX_ROWS = 5;
// The border above the warnings, the header under the statusline, and the
// raw pane's frame (two borders and its title).
const BORDER_ROWS = 1;
const HEADER_ROWS = 1;
const RAW_FRAME_ROWS = 3;
// One row spare for a row Ink wraps despite the measuring, and one so the
// live region never fills the terminal.
const SPARE_ROWS = 2;
// The fewest rows the reply has in the smallest window.
const MIN_REPLY_ROWS = 3;

export type Layout = { replyRows: number; rawRows: number; inputRows: number };

// The fewest rows that hold every part at its largest at once: three
// warnings, the raw pane with an entry, a full draft and every statusline
// line. Below it the TUI draws nothing but tooSmallMessage.
export const minRows = (statusLines: number): number =>
    BORDER_ROWS +
    WARNING_LIMIT +
    INPUT_MAX_ROWS +
    statusLines +
    HEADER_ROWS +
    SPARE_ROWS +
    RAW_FRAME_ROWS +
    1 +
    MIN_REPLY_ROWS;

export function tooSmallMessage(
    neededRows: number,
    rows: number,
    columns: number,
): string {
    return `Too Small: Dorothy's TUI needs at least ${neededRows} lines and ${MIN_COLUMNS} columns (this window is ${rows} × ${columns})`;
}

// Ink clears the whole terminal, scrollback included, and repaints every line
// on each frame once the live region is as tall as the window, so the
// streaming reply and the raw pane share the rows the rest leaves. At or
// above minRows nothing else needs squeezing.
export function fitLayout(
    rows: number,
    {
        showRaw,
        rawCount,
        warnings,
        statusRows,
        inputRows: wanted,
    }: {
        showRaw: boolean;
        rawCount: number;
        warnings: number;
        statusRows: number;
        inputRows: number;
    },
): Layout {
    const inputRows = Math.max(1, Math.min(wanted, INPUT_MAX_ROWS));
    const rest =
        rows -
        BORDER_ROWS -
        warnings -
        inputRows -
        statusRows -
        HEADER_ROWS -
        SPARE_ROWS -
        (showRaw ? RAW_FRAME_ROWS : 0);
    const rawRows = showRaw
        ? Math.min(rawCount, Math.max(1, Math.floor(rest / 3)))
        : 0;
    return { replyRows: Math.max(1, rest - rawRows), rawRows, inputRows };
}
```

In `src/tui/App.tsx` add `statusRows: 0,` to the `fitLayout` options (Task 7
gives it the statusline's rows).

- [ ] **Step 4: Run them to verify they pass**

Run: `bun test && bun run typecheck`
Expected: PASS, the whole suite, including App's "keeps a tall draft
shorter than the window"; typecheck clean.

- [ ] **Step 5: Commit**

```bash
bun run format && bun run lint
git add src/tui/layout.ts src/tui/layout.test.ts src/tui/App.tsx
git commit -m "feat(tui): Cap the draft at 5 rows, set a minimum"
```

---

### Task 7: Add a statusline under the input

**Files:**

- Modify: `src/tui/Header.tsx`, `src/tui/state.ts`, `src/tui/App.tsx`
- Test: `src/tui/components.test.tsx`, `src/tui/state.test.ts`,
  `src/tui/App.test.tsx`

**Interfaces:**

- Consumes: `moduleRows` (Task 3), `fitLayout` with `statusRows` (Task 6),
  `ResumedTurn` (Task 5).
- Produces: `Header({ phrase, model, sdkSessionId, status })` (no
  `warnings`); `Warnings({ warnings }: { warnings: string[] })`;
  `Statusline({ rows }: { rows: string[] })`;
  `ChatState.lastStats: TurnStats | null`.

- [ ] **Step 1: Write the failing tests**

In `src/tui/components.test.tsx`: change the import to
`import { Header, shortId, Statusline, Warnings } from "./Header.js";`, add
`Box` to an `import { Box } from "ink";`, remove `warnings={[]}` from the
first Header test, replace "shows each warning on one row of its own" with:

```tsx
    it("keeps to one row however narrow the window", () => {
        const { lastFrame } = render(
            <Box width={40}>
                <Header
                    phrase="tumble-orchid-vapor-lantern"
                    model="claude-sonnet-5-5"
                    sdkSessionId="3f2a0000-0000-0000-0000-000000000c91"
                    status="disconnected"
                />
            </Box>,
        );
        expect((lastFrame() ?? "").split("\n")).toHaveLength(1);
    });
});

describe("Warnings and Statusline", () => {
    it("shows each warning on one row of its own", () => {
        const lines = (
            render(
                <Warnings warnings={["no transcript", long("skipped")]} />,
            ).lastFrame() ?? ""
        ).split("\n");
        expect(lines).toHaveLength(2);
        expect(lines[0]).toBe("! no transcript");
        expect(lines[1]).toStartWith("! skipped skipped");
    });

    it("draws the statusline's rows and nothing without them", () => {
        expect(
            render(<Statusline rows={["a · b", "c"]} />).lastFrame(),
        ).toBe("a · b\nc");
        expect(render(<Warnings warnings={[]} />).lastFrame()).toBe("");
        expect(render(<Statusline rows={[]} />).lastFrame()).toBe("");
    });
```

(the `it("shortens long ids only", …)` test moves into this second
`describe` or stays in `Header`'s; either is fine).

In `src/tui/state.test.ts`:

```ts
    it("keeps the latest turn's stats, starting from a resumed reply's", () => {
        expect(initialState([]).lastStats).toBeNull();
        const resumed = initialState([
            { role: "assistant", text: "b", stats, chatCostUsd: 0.5 },
            { role: "user", text: "c" },
        ]);
        expect(resumed.lastStats).toEqual(stats);
        const later = { ...stats, outputTokens: 99 };
        expect(
            reduce(resumed, {
                type: "event",
                event: {
                    type: "turn-end",
                    reply: "d",
                    interrupted: false,
                    stats: later,
                },
            }).lastStats,
        ).toEqual(later);
    });
```

In `src/tui/App.test.tsx`, set the window in `setup` and offer resizing.
Below `const tick = …` add:

```tsx
// ink-testing-library leaves rows unset, so Ink would take the size of the
// terminal running the tests; every test gets 100 × 24 unless it resizes.
const setSize = (
    app: ReturnType<typeof render>,
    columns: number,
    rows: number,
) => {
    Object.defineProperty(app.stdout, "columns", {
        value: columns,
        configurable: true,
    });
    Object.defineProperty(app.stdout, "rows", {
        value: rows,
        configurable: true,
    });
    app.stdout.emit("resize");
};
```

In `setup`, right after `const app = render(…);` add `setSize(app, 100, 24);`,
and return `resize` beside `type`:

```tsx
    const resize = async (columns: number, rows: number) => {
        setSize(app, columns, rows);
        await tick();
    };
    return { app, sessions, histories, entries, session, type, resize };
```

Change "keeps a tall draft shorter than the window" to end:

```tsx
        const lines = (app.lastFrame() ?? "").split("\n");
        expect(lines.length).toBeLessThan(24);
        expect(lines.at(-3)).toContain("▏");
        const top = lines.findIndex((line) => line.startsWith("↑"));
        expect(lines.length - 3 - top + 1).toBe(5);
```

and add:

```tsx
    it("orders warnings, input, statusline and header under the border", async () => {
        const { app, session, type } = setup({ failWrites: true });
        await tick();
        await type("hello");
        await type("\r");
        session().emit({
            type: "turn-end",
            reply: "Hi there",
            interrupted: false,
            stats,
        });
        await tick();
        const lines = (app.lastFrame() ?? "").split("\n");
        const warning = lines.findIndex((line) =>
            line.startsWith("! transcript not saved"),
        );
        expect(lines[warning - 1]).toStartWith("────");
        expect(lines[warning + 1]).toStartWith("›");
        expect(lines.at(-2)).toBe(
            "chat $0.0010 · $0.0010 · 1 in · 2 out · ttft 0.3s · 1.5s",
        );
        expect(lines.at(-1)).toStartWith("dorothy · tumble-orchid-vapor-lantern");
    });

    it("shows the chat's cost in the statusline before the first reply", async () => {
        const { app } = setup();
        await tick();
        expect((app.lastFrame() ?? "").split("\n").at(-2)).toBe("chat $0.0000");
    });

    it("draws no statusline when it has no modules", async () => {
        const { app } = setup({
            config: {
                ...DEFAULT_CONFIG,
                statusline: { modules: [], maxLines: 1 },
            },
        });
        await tick();
        expect((app.lastFrame() ?? "").split("\n").at(-2)).toStartWith("›");
    });
```

- [ ] **Step 2: Run them to verify they fail**

Run: `bun test src/tui`
Expected: FAIL: `Warnings` and `Statusline` are not exported; the header
wraps at 40 columns; `lastStats` is undefined; the App ordering, statusline
and tall-draft tests (the input is still the last row).

- [ ] **Step 3: Split the header's rows**

In `src/tui/Header.tsx`, remove `warnings` from `HeaderProps` and from
`Header`'s parameters, make `Header` return only its line, truncated:

```tsx
    return (
        <Text wrap="truncate">
            <Text bold>{parts.join(" · ")}</Text>
            {" · "}
            <Text color={STATUS_COLORS[status]}>{status}</Text>
        </Text>
    );
```

and add:

```tsx
// Above the input, one row each, cut short rather than wrapped.
export function Warnings({ warnings }: { warnings: string[] }) {
    return (
        <Box flexDirection="column">
            {warnings.map((warning) => (
                <Text key={warning} color="yellow" wrap="truncate">
                    ! {warning}
                </Text>
            ))}
        </Box>
    );
}

// Under the input; fitModules has already fitted each row to the width.
export function Statusline({ rows }: { rows: string[] }) {
    return (
        <Box flexDirection="column">
            {rows.map((row, index) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: rows are positional.
                <Text key={index} dimColor wrap="truncate">
                    {row}
                </Text>
            ))}
        </Box>
    );
}
```

- [ ] **Step 4: Keep the latest stats in state**

In `src/tui/state.ts` add `lastStats: TurnStats | null;` to `ChatState`; in
`initialState` add

```ts
        lastStats:
            history.findLast((turn) => turn.stats !== undefined)?.stats ?? null,
```

and in the `turn-end` case add `lastStats: event.stats,` to the returned
state.

- [ ] **Step 5: Draw the bottom rows in their new order**

In `src/tui/App.tsx` import `{ Header, Statusline, Warnings }` from
`./Header.js` and `{ moduleRows }` from `./statusline.js`; before the
`fitLayout` call add

```tsx
    const statusRows = moduleRows(
        config.statusline,
        state.lastStats,
        state.costUsd,
        columns,
    );
```

pass `statusRows: statusRows.length` (replacing Task 6's `0`), and make the
bordered box's children:

```tsx
                <Warnings warnings={state.warnings} />
                <Input
                    value={draft}
                    disabled={state.streaming || closing}
                    maxRows={layout.inputRows}
                    onChange={setDraft}
                    onSubmit={submit}
                />
                <Statusline rows={statusRows} />
                <Header
                    phrase={phrase}
                    model={state.model}
                    sdkSessionId={state.sdkSessionId}
                    status={state.status}
                />
```

- [ ] **Step 6: Run them to verify they pass**

Run: `bun test && bun run typecheck`
Expected: PASS, the whole suite; typecheck clean.

- [ ] **Step 7: Commit**

```bash
bun run format && bun run lint
git add src/tui/Header.tsx src/tui/state.ts src/tui/App.tsx src/tui/components.test.tsx src/tui/state.test.ts src/tui/App.test.tsx
git commit -m "feat(tui): Add a statusline under the input"
```

---

### Task 8: Ask for a larger window below the minimum

**Files:**

- Modify: `src/tui/App.tsx`
- Test: `src/tui/App.test.tsx`

**Interfaces:**

- Consumes: `MIN_COLUMNS`, `minRows`, `tooSmallMessage` (Task 6);
  `wrapRows` from `./LiveReply.js`; `setup`'s `resize` (Task 7).

- [ ] **Step 1: Write the failing tests**

Add to `describe("App", …)` in `src/tui/App.test.tsx`:

```tsx
    // The message wraps at narrow widths; joining its rows restores it.
    const flat = (frame = "") => frame.split("\n").join(" ");

    it("asks for a larger window below either minimum, and not at it", async () => {
        const { app, resize } = setup();
        await tick();
        await resize(39, 24);
        expect(flat(app.lastFrame())).toContain(
            "Too Small: Dorothy's TUI needs at least 20 lines and 40 columns (this window is 24 × 39)",
        );
        expect(app.lastFrame()).not.toContain("tumble-orchid-vapor-lantern");
        await resize(40, 19);
        expect(flat(app.lastFrame())).toContain("(this window is 19 × 40)");
        await resize(40, 20);
        expect(app.lastFrame()).not.toContain("Too Small");
        expect(app.lastFrame()).toContain("tumble-orchid-vapor-lantern");
    });

    it("needs a line more for each statusline line, and none when hidden", async () => {
        const tall = setup({
            config: {
                ...DEFAULT_CONFIG,
                statusline: { ...DEFAULT_CONFIG.statusline, maxLines: 3 },
            },
        });
        await tick();
        await tall.resize(100, 21);
        expect(flat(tall.app.lastFrame())).toContain("at least 22 lines");
        const hidden = setup({
            config: {
                ...DEFAULT_CONFIG,
                statusline: { modules: [], maxLines: 1 },
            },
        });
        await tick();
        await hidden.resize(100, 19);
        expect(hidden.app.lastFrame()).not.toContain("Too Small");
    });

    it("keeps the draft, the reply and the scrollback while too small", async () => {
        const { app, session, type, resize } = setup();
        await tick();
        await type("hi");
        await type("\r");
        session().emit({
            type: "turn-end",
            reply: "Hi there",
            interrupted: false,
            stats,
        });
        await tick();
        await type("draft");
        await type("\r");
        await resize(30, 10);
        session().emit({ type: "delta", text: "Streamed" });
        await type("x");
        await type("\u0012");
        await type("\u001B");
        await resize(100, 24);
        const frame = app.lastFrame() ?? "";
        expect(frame).toContain("Streamed▍");
        expect(frame).not.toContain("raw (ctrl+r)");
        expect(session().interrupts).toBe(0);
        expect(frame.split("Hi there")).toHaveLength(2);
        expect(session().sent).toEqual(["hi", "draft"]);
    });

    it("quits on Ctrl+C while too small", async () => {
        const { session, type, resize } = setup();
        await tick();
        await resize(30, 10);
        await type("\u0003");
        expect(session().closed).toBe(true);
    });

    it("keeps the message shorter than a tiny window", async () => {
        const { app, resize } = setup();
        await tick();
        await resize(20, 3);
        expect((app.lastFrame() ?? "").split("\n")).toHaveLength(2);
    });

    it("keeps a draft typed before the window shrank", async () => {
        const { app, type, resize } = setup();
        await tick();
        await type("draft");
        await resize(30, 10);
        await type("x");
        await resize(100, 24);
        expect(app.lastFrame()).toContain("› draft▏");
    });
```

- [ ] **Step 2: Run them to verify they fail**

Run: `bun test src/tui/App.test.tsx`
Expected: FAIL: the five size tests find no "Too Small", and while small
Ctrl+R opens the raw pane and Esc interrupts. "quits on Ctrl+C while too
small" passes already; it guards the key gate written next.

- [ ] **Step 3: Draw only the message when the window is too small**

In `src/tui/App.tsx` import `Text` from `ink`, `wrapRows` with `LiveReply`
from `./LiveReply.js`, and `MIN_COLUMNS, minRows, tooSmallMessage` with
`fitLayout` from `./layout.js`. Before `useInput` add:

```tsx
    // Below the minimum only the quit keys act; the draft waits in state.
    const statusLines =
        config.statusline.modules.length > 0 ? config.statusline.maxLines : 0;
    const neededRows = minRows(statusLines);
    const tooSmall = columns < MIN_COLUMNS || rows < neededRows;
```

begin the `useInput` callback with

```tsx
        const quitKey = key.ctrl && (input === "c" || input === "d");
        if (tooSmall && !quitKey) {
            return;
        }
```

and, after the `useInput` call and before the `statusRows` computation:

```tsx
    // History stays mounted: <Static> prints each line once, and mounting it
    // again would print them all again. The message is cut short of the
    // window, which Ink would otherwise clear on every frame.
    if (tooSmall) {
        const message = wrapRows(
            tooSmallMessage(neededRows, rows, columns),
            columns,
        ).slice(0, Math.max(1, rows - 1));
        return (
            <Box flexDirection="column">
                <History lines={state.lines} replyStats={config.replyStats} />
                <Text>{message.join("\n")}</Text>
            </Box>
        );
    }
```

- [ ] **Step 4: Run them to verify they pass**

Run: `bun test && bun run typecheck`
Expected: PASS, the whole suite; typecheck clean.

- [ ] **Step 5: Commit**

```bash
bun run format && bun run lint
git add src/tui/App.tsx src/tui/App.test.tsx
git commit -m "feat(tui): Ask for a larger window below a minimum"
```

---

### Task 9: Document it, amend the plans, verify in a terminal

**Files:**

- Modify: `README.md`, `docs/plans/2026-10-03-input-editor.md`,
  `docs/plans/2026-10-03-markdown-replies.md`

- [ ] **Step 1: Document the configuration**

In `README.md` replace the sentence "Each reply ends with its tokens,
timings, cost and what the chat has cost so far." with "Each reply ends with
its tokens, timings, cost and what the chat has cost so far, and the
statusline under the input shows the latest of them." Then, after the
`--resume` code block, add:

````markdown
The chat needs a window of at least 40 columns and 20 lines, one more line
for each extra statusline line; a smaller one shows only how large it needs
to be. Both stats lines are set in `~/.config/dorothy/config.toml`
(`$XDG_CONFIG_HOME` if set), read at startup:

```toml
[statusline]
modules = ["chat-cost", "cost", "in", "out", "ttft", "duration"]
max-lines = 1

[reply-stats]
modules = [
  "in", "cache-read", "cache-write", "out", "ttft", "duration", "cost",
  "chat-cost",
]
max-lines = 1
```

Modules show left to right as far as the width allows, then on up to
`max-lines` lines (at most 5); those that still do not fit are left out from
the right. An empty `modules` hides the line. A mistake in the file shows as
a warning and the defaults apply.
````

- [ ] **Step 2: Amend the input editor plan**

In `docs/plans/2026-10-03-input-editor.md`, after the last bullet of
"## Amendments of 2026-10-04", add:

```markdown
## Amendments of 2026-10-05

The statusline plan (`2026-10-05-statusline-and-minimum-size.md`) landed
first; where a task disagrees, these win.

- **The draft caps at 5 rows.** `fitLayout(rows, { showRaw, rawCount,
  warnings, statusRows, inputRows })` gives the input at most
  `INPUT_MAX_ROWS` (5, from `layout.ts`). Drop `maxDraftRows` from Task 2
  (its Produces line, its two test lines and its definition); Input's window
  is `maxRows={layout.inputRows}`.
- **The bottom box is warnings, input, statusline, header.** `Header` no
  longer takes `warnings`; `<Warnings>` and `<Statusline>` come from
  `Header.tsx`, and `App` computes `statusRows` with `moduleRows`. In App
  tests the input is `lines.at(-3)`, above the statusline and header.
- **App tests set the window.** `setup` calls `setSize(app, 100, 24)` and
  returns `resize`. Below 40 columns or `minRows` lines App draws only the
  Too Small message; Input is unmounted and only Ctrl+C and Ctrl+D act, so
  the editor's keys need no check for it.
- **History takes `replyStats`**, and resumed turns are `ResumedTurn`s that
  may carry `stats` and `chatCostUsd`.
```

- [ ] **Step 3: Amend the Markdown replies plan**

In `docs/plans/2026-10-03-markdown-replies.md`, after the last bullet of
"## Amendments of 2026-10-04", add:

```markdown
## Amendments of 2026-10-05

The statusline plan (`2026-10-05-statusline-and-minimum-size.md`) landed
first; where a task disagrees, these win.

- **`formatStats` is gone.** Task 6 Step 4 imports only `LABEL_WIDTH` from
  `./LiveReply.js` and keeps `LineView`'s stats rows as they are on main,
  drawn by `moduleRows(replyStats, …)` from `./statusline.js`.
- **`History` and `LineView` take `replyStats: LineConfig`**, so every
  `<History lines={…} />` in the plan's tests also takes
  `replyStats={DEFAULT_CONFIG.replyStats}` (from `../config.js`).
- **App tests set the window** to 100 × 24 through `setup`; below 40 × 20
  App draws only the Too Small message.
```

- [ ] **Step 4: Check the documents**

Run: `bun run lint:md`
Expected: exit 0.

- [ ] **Step 5: Verify in a terminal**

Run, from the repository root (recreate `/tmp/dprobe/run.py` from commit
`94db780`'s investigation if `/tmp` was cleared; the driver is
`.superpowers/probe/driver.tsx`):

```bash
uv run --quiet --with pyte python /tmp/dprobe/run.py 80 24
uv run --quiet --with pyte python /tmp/dprobe/run.py 40 20
uv run --quiet --with pyte python /tmp/dprobe/run.py 30 10
```

Expected: at 80 × 24 and 40 × 20 the snapshot shows at most five draft rows
with `↑`, then the statusline and the header as the last two rows, and
`separators on screen while drafting: 1`; at 30 × 10 the snapshot shows the
Too Small message and no separator.

- [ ] **Step 6: Run the whole check**

Run: `bun run check && bun run build`
Expected: exit 0 for both.

- [ ] **Step 7: Commit**

```bash
git add README.md docs/plans/2026-10-03-input-editor.md docs/plans/2026-10-03-markdown-replies.md
git commit -m "docs: Describe the statusline and minimum window"
```

<!-- vim:set expandtab shiftwidth=2 filetype=markdown foldlevel=3: -->
