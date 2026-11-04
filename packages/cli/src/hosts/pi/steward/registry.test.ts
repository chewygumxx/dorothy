// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/cli/src/hosts/pi/steward/registry.test.ts
//
//

import { afterEach, describe, expect, it } from "bun:test";
import { mkdir, symlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
    FLEET_ID,
    NOW,
    type Raw,
    type Registry,
    writeRegistry,
} from "./fixtures.js";
import { fixturePath, isTaskId, readFleet } from "./registry.js";

const made: Registry[] = [];

async function registry(edit?: (raw: Raw) => void, now = NOW) {
    const made1 = await writeRegistry(edit, now);
    made.push(made1);
    return made1;
}

async function refused(edit: (raw: Raw) => void, code: string, now = NOW) {
    const { path } = await registry(edit, now);
    await expect(readFleet(path, now)).rejects.toThrow(code);
}

afterEach(async () => {
    await Promise.all(made.splice(0).map((one) => one.cleanup()));
});

describe("readFleet", () => {
    it("reads a declared fleet with canonical paths", async () => {
        const { path, fixtureRoot, workers } = await registry();
        const fleet = await readFleet(path, NOW);
        expect(fleet.version).toBe(1);
        expect(fleet.fleetId).toBe(FLEET_ID);
        expect(fleet.fixtureRoot).toBe(fixtureRoot);
        expect(fleet.workers).toEqual(workers);
    });

    it("canonicalizes a cwd reached through a link inside the root", async () => {
        const reg = await registry();
        const link = join(reg.fixtureRoot, "alias");
        await symlink(reg.workers[0]?.cwd as string, link);
        const raw = JSON.parse(await Bun.file(reg.path).text());
        raw.workers[0].cwd = link;
        await Bun.write(reg.path, JSON.stringify(raw));
        const fleet = await readFleet(reg.path, NOW);
        expect(fleet.workers[0]?.cwd).toBe(reg.workers[0]?.cwd as string);
    });

    it("refuses duplicate ids, names and panes", async () => {
        await refused((raw) => {
            raw.workers[1].id = raw.workers[0].id;
        }, "REGISTRY_DUPLICATE");
        await refused((raw) => {
            raw.workers[1].name = raw.workers[0].name;
        }, "REGISTRY_DUPLICATE");
        await refused((raw) => {
            raw.workers[1].pane = raw.workers[0].pane;
        }, "REGISTRY_DUPLICATE");
    });

    it("refuses an expired registry and one that expires in the future too far", async () => {
        await refused((raw) => {
            raw.workers[0].expiresAt = "2026-11-03T11:59:59.999Z";
        }, "REGISTRY_EXPIRED");
        await refused((raw) => {
            raw.workers[0].expiresAt = NOW.toISOString();
        }, "REGISTRY_EXPIRED");
        await refused((raw) => {
            raw.workers[0].observedAt = "2026-11-03T11:00:00.000Z";
            raw.workers[0].expiresAt = "2026-11-03T12:00:00.001Z";
        }, "REGISTRY_EXPIRY_SPAN");
        await refused((raw) => {
            raw.workers[0].expiresAt = raw.workers[0].observedAt;
        }, "REGISTRY_EXPIRY_SPAN");
    });

    it("accepts an expiry exactly an hour after the observation", async () => {
        const { path } = await registry((raw) => {
            raw.workers[0].observedAt = "2026-11-03T11:30:00.000Z";
            raw.workers[0].expiresAt = "2026-11-03T12:30:00.000Z";
        });
        expect((await readFleet(path, NOW)).workers).toHaveLength(2);
    });

    it("refuses an observation later than the clock", async () => {
        await refused((raw) => {
            raw.workers[0].observedAt = "2026-11-03T12:00:00.001Z";
            raw.workers[0].expiresAt = "2026-11-03T12:30:00.000Z";
        }, "REGISTRY_FUTURE");
    });

    it("refuses times that are not exact UTC instants", async () => {
        for (const bad of ["yesterday", "2026-11-03", "2026-11-03 11:50:00Z"]) {
            await refused((raw) => {
                raw.workers[0].observedAt = bad;
            }, "REGISTRY_FIELD_INVALID");
        }
        await refused((raw) => {
            raw.workers[0].observedAt = "2026-13-45T11:50:00.000Z";
        }, "REGISTRY_FIELD_INVALID");
    });

    it("refuses unknown fields at either level", async () => {
        await refused((raw) => {
            raw.extra = 1;
        }, "REGISTRY_UNKNOWN_FIELD");
        await refused((raw) => {
            raw.workers[0].shell = "bash";
        }, "REGISTRY_UNKNOWN_FIELD");
    });

    it("refuses a missing field and a wrong version", async () => {
        await refused((raw) => {
            delete raw.workers[0].pane;
        }, "REGISTRY_FIELD_MISSING");
        await refused((raw) => {
            raw.version = 2;
        }, "REGISTRY_VERSION");
        await refused((raw) => {
            delete raw.version;
        }, "REGISTRY_FIELD_MISSING");
    });

    it("refuses token-like fields and values as credentials", async () => {
        await refused((raw) => {
            raw.workers[0].apiToken = "x";
        }, "REGISTRY_CREDENTIAL");
        await refused((raw) => {
            raw.password = "x";
        }, "REGISTRY_CREDENTIAL");
        await refused((raw) => {
            raw.workers[0].accountLabel = "sk-ant-0123456789abcdef";
        }, "REGISTRY_CREDENTIAL");
        await refused((raw) => {
            raw.workers[1].accountLabel = "ghp_0123456789abcdef0123";
        }, "REGISTRY_CREDENTIAL");
    });

    it("refuses a root escape, by path, dot-dot or link", async () => {
        await refused((raw) => {
            raw.workers[0].cwd = resolve(raw.fixtureRoot, "..");
        }, "REGISTRY_ROOT_ESCAPE");
        await refused((raw) => {
            raw.workers[0].cwd = `${raw.fixtureRoot}/trial-codex/../../..`;
        }, "REGISTRY_ROOT_ESCAPE");
        const reg = await registry();
        await mkdir(`${reg.fixtureRoot}-sibling`);
        const sibling = JSON.parse(await Bun.file(reg.path).text());
        sibling.workers[0].cwd = `${reg.fixtureRoot}-sibling`;
        await Bun.write(reg.path, JSON.stringify(sibling));
        await expect(readFleet(reg.path, NOW)).rejects.toThrow(
            "REGISTRY_ROOT_ESCAPE",
        );
        const outside = join(reg.root, "outside");
        await mkdir(outside);
        await symlink(outside, join(reg.fixtureRoot, "escape"));
        const raw = JSON.parse(await Bun.file(reg.path).text());
        raw.workers[0].cwd = join(reg.fixtureRoot, "escape");
        await Bun.write(reg.path, JSON.stringify(raw));
        await expect(readFleet(reg.path, NOW)).rejects.toThrow(
            "REGISTRY_ROOT_ESCAPE",
        );
    });

    it("refuses relative, missing and root paths", async () => {
        await refused((raw) => {
            raw.workers[0].cwd = "trial-codex";
        }, "REGISTRY_PATH_INVALID");
        await refused((raw) => {
            raw.workers[0].cwd = `${raw.fixtureRoot}/never-made`;
        }, "REGISTRY_PATH_INVALID");
        await refused((raw) => {
            raw.fixtureRoot = "/";
        }, "REGISTRY_PATH_INVALID");
    });

    it("refuses a bad fleet id, and unsafe ids, names and panes", async () => {
        await refused((raw) => {
            raw.fleetId = "not-a-uuid";
        }, "REGISTRY_FIELD_INVALID");
        for (const field of ["id", "name", "pane"]) {
            for (const bad of ["", "-rf", "a b", "x".repeat(33), "a;b", 7]) {
                await refused((raw) => {
                    raw.workers[0][field] = bad;
                }, "REGISTRY_FIELD_INVALID");
            }
        }
    });

    it("refuses unknown harnesses, roles and availabilities", async () => {
        for (const [field, bad] of [
            ["harness", "pi"],
            ["role", "admin"],
            ["availability", "ready"],
            ["accountLabel", ""],
            ["accountLabel", "a".repeat(33)],
        ]) {
            await refused((raw) => {
                raw.workers[0][field as string] = bad;
            }, "REGISTRY_FIELD_INVALID");
        }
    });

    it("bounds the worker count to one through eight", async () => {
        await refused((raw) => {
            raw.workers = [] as unknown as Raw["workers"];
        }, "REGISTRY_FIELD_INVALID");
        await refused((raw) => {
            const base = raw.workers[0];
            raw.workers = Array.from({ length: 9 }, (_, i) => ({
                ...base,
                id: `w${i}`,
                name: `w${i}`,
                pane: `p${i}`,
            })) as unknown as Raw["workers"];
        }, "REGISTRY_FIELD_INVALID");
    });

    it("refuses an oversized file before parsing it", async () => {
        const reg = await registry();
        await Bun.write(reg.path, `{"pad":"${"x".repeat(64 * 1024)}"}`);
        await expect(readFleet(reg.path, NOW)).rejects.toThrow(
            "REGISTRY_TOO_LARGE",
        );
    });

    it("accepts a file of exactly 64 KiB of valid JSON", async () => {
        const reg = await registry();
        const text = JSON.stringify(reg.raw);
        await Bun.write(reg.path, text + " ".repeat(64 * 1024 - text.length));
        expect((await readFleet(reg.path, NOW)).workers).toHaveLength(2);
    });

    it("refuses a missing file, a link, a directory and bad JSON", async () => {
        const reg = await registry();
        await expect(readFleet(join(reg.root, "none"), NOW)).rejects.toThrow(
            "REGISTRY_MISSING",
        );
        const link = join(reg.root, "link.json");
        await symlink(reg.path, link);
        await expect(readFleet(link, NOW)).rejects.toThrow(
            "REGISTRY_NOT_REGULAR",
        );
        await expect(readFleet(reg.fixtureRoot, NOW)).rejects.toThrow(
            "REGISTRY_NOT_REGULAR",
        );
        await Bun.write(reg.path, "{not json");
        await expect(readFleet(reg.path, NOW)).rejects.toThrow(
            "REGISTRY_INVALID",
        );
        await Bun.write(reg.path, "[]");
        await expect(readFleet(reg.path, NOW)).rejects.toThrow(
            "REGISTRY_INVALID",
        );
    });

    it("carries the code on the error", async () => {
        const { path } = await registry((raw) => {
            raw.version = 3;
        });
        const error = await readFleet(path, NOW).catch((e) => e);
        expect(error.code).toBe("REGISTRY_VERSION");
        expect(error.message.startsWith("REGISTRY_VERSION: ")).toBe(true);
    });
});

describe("the shipped example", () => {
    it("has the registry's exact shape", async () => {
        const example = JSON.parse(
            await Bun.file(
                join(
                    import.meta.dir,
                    "../../../../assets/pi/stewardship/registry.example.json",
                ),
            ).text(),
        );
        const reg = await registry();
        const rewritten = {
            ...example,
            fixtureRoot: reg.fixtureRoot,
            workers: example.workers.map(
                (worker: Record<string, unknown>, i: number) => ({
                    ...worker,
                    cwd: reg.workers[i % 2]?.cwd,
                    observedAt: reg.workers[0]?.observedAt,
                    expiresAt: reg.workers[0]?.expiresAt,
                }),
            ),
        };
        await Bun.write(reg.path, JSON.stringify(rewritten));
        const fleet = await readFleet(reg.path, NOW);
        expect(fleet.workers.map((w) => w.harness).sort()).toEqual([
            "claude",
            "codex",
        ]);
    });
});

describe("isTaskId", () => {
    it("takes a lowercase letter then up to 63 of [a-z0-9_-]", () => {
        expect(isTaskId("t1")).toBe(true);
        expect(isTaskId("a-b_c9")).toBe(true);
        expect(isTaskId("a".repeat(64))).toBe(true);
        for (const bad of ["", "1a", "A", "a".repeat(65), "a b", "a/b", "-a"]) {
            expect(isTaskId(bad)).toBe(false);
        }
    });
});

describe("fixturePath", () => {
    async function fleetIn(reg: Registry) {
        return readFleet(reg.path, NOW);
    }

    it("takes a regular brief beneath the root", async () => {
        const reg = await registry();
        const brief = join(reg.fixtureRoot, "briefs", "t1.md");
        await Bun.write(brief, "do it");
        expect(await fixturePath(await fleetIn(reg), brief, "brief")).toBe(
            brief,
        );
    });

    it("takes a report not yet written, in an existing directory", async () => {
        const reg = await registry();
        const report = join(reg.fixtureRoot, "reports", "t1.md");
        await mkdir(join(reg.fixtureRoot, "reports"));
        expect(await fixturePath(await fleetIn(reg), report, "report")).toBe(
            report,
        );
    });

    it("refuses a path outside the root, however written", async () => {
        const reg = await registry();
        const fleet = await fleetIn(reg);
        await Bun.write(join(reg.root, "outside.md"), "x");
        for (const path of [
            join(reg.root, "outside.md"),
            `${reg.fixtureRoot}/../outside.md`,
            `${reg.fixtureRoot}-sibling/x.md`,
            "relative.md",
            "",
        ]) {
            await expect(fixturePath(fleet, path, "brief")).rejects.toThrow(
                /PATH_ESCAPE|PATH_INVALID/,
            );
        }
    });

    it("refuses a symlink, also through a directory, and a non-file", async () => {
        const reg = await registry();
        const fleet = await fleetIn(reg);
        const real = join(reg.fixtureRoot, "real.md");
        await Bun.write(real, "x");
        await symlink(real, join(reg.fixtureRoot, "link.md"));
        await expect(
            fixturePath(fleet, join(reg.fixtureRoot, "link.md"), "brief"),
        ).rejects.toThrow("PATH_SYMLINK");
        await mkdir(join(reg.fixtureRoot, "dir"));
        await symlink(
            join(reg.fixtureRoot, "dir"),
            join(reg.fixtureRoot, "dirlink"),
        );
        await Bun.write(join(reg.fixtureRoot, "dir", "a.md"), "x");
        await expect(
            fixturePath(
                fleet,
                join(reg.fixtureRoot, "dirlink", "a.md"),
                "brief",
            ),
        ).rejects.toThrow("PATH_SYMLINK");
        await expect(
            fixturePath(fleet, join(reg.fixtureRoot, "dir"), "brief"),
        ).rejects.toThrow("PATH_NOT_REGULAR");
        await expect(
            fixturePath(fleet, join(reg.fixtureRoot, "link.md"), "report"),
        ).rejects.toThrow("PATH_SYMLINK");
    });

    it("refuses a missing brief and a report in a missing directory", async () => {
        const reg = await registry();
        const fleet = await fleetIn(reg);
        await expect(
            fixturePath(fleet, join(reg.fixtureRoot, "nope.md"), "brief"),
        ).rejects.toThrow("PATH_MISSING");
        await expect(
            fixturePath(fleet, join(reg.fixtureRoot, "no/dir/r.md"), "report"),
        ).rejects.toThrow("PATH_MISSING");
    });
});
