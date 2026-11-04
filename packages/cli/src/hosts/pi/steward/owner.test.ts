// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/cli/src/hosts/pi/steward/owner.test.ts
//
//

// The runner's verification: the revision it computes from the clone, the
// export it tests outside every clone, and the receipt it writes only after
// that run. A worker's claim, working tree, config and copies of the test
// count for nothing.

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createOwnerKit, FIXTURE, isFile } from "./owner.js";
import { DEFAULT_CAST, Sim } from "./simulation.js";

let s: Sim;

beforeEach(async () => {
    s = await Sim.boot(DEFAULT_CAST);
});

afterEach(async () => {
    await s.close();
});

// A reported task for the implementer, its claim set as given.
async function reported(revision: (head: string) => string | null) {
    const { impl } = s.w;
    const id = s.id("fix");
    await s.dispatch(id, impl);
    const head = await s.commit(impl, "complete", id);
    await s.report(id, { revision: revision(head) });
    await s.act("reconcile", { kind: "reconcile", taskId: id });
    return { id, head };
}

const logs = async () =>
    (await readdir(join(s.kit.root, "logs")).catch(() => [])).sort();

describe("the owner's verification", () => {
    it("takes the revision from the clone and tests that commit", async () => {
        const { id, head } = await reported((h) => h);
        const outcome = await s.owner(id, s.w.impl);
        expect(outcome.kind).toBe("receipt");
        if (outcome.kind !== "receipt") return;
        expect(outcome.passed).toBe(true);
        expect(outcome.receipt).toMatchObject({
            taskId: id,
            revision: head,
            exitCode: 0,
            reportDigest: s.task(id)?.reportDigest,
        });
        // The ledger holds exactly that receipt, and the log names the run.
        expect(s.ledger((db) => db.receipts(id))).toMatchObject([
            { revision: head, exitCode: 0 },
        ]);
        const log = await readFile(outcome.receipt.logPath, "utf8");
        expect(log).toContain(`revision: ${head}`);
        expect(log).toContain(`acceptance: ${s.kit.acceptance.digest}`);
        expect(log).toContain("10/10 cases pass");
    });

    it("runs the test in an export outside every clone, then removes it", async () => {
        const { id } = await reported((h) => h);
        const outcome = await s.owner(id, s.w.impl);
        if (outcome.kind !== "receipt") throw new Error("no receipt");
        const [bun, test, exported] = outcome.receipt.command as [
            string,
            string,
            string,
        ];
        expect(bun).toBe("bun");
        expect(test.startsWith(`${s.kit.root}/`)).toBe(true);
        expect(exported.startsWith(`${s.kit.root}/exports/`)).toBe(true);
        for (const worker of s.fleet.workers) {
            expect(exported.startsWith(`${worker.cwd}/`)).toBe(false);
        }
        expect(await isFile(exported)).toBe(false);
        expect(await readdir(join(s.kit.root, "exports"))).toEqual([]);
        // The test is the template's, byte for byte, in a read-only file.
        expect(await readFile(test, "utf8")).toBe(
            await readFile(join(FIXTURE, "owner", "acceptance.ts"), "utf8"),
        );
    });

    it("records no receipt for a revision the report claims but the clone lacks", async () => {
        const { id, head } = await reported(() => "e".repeat(40));
        const outcome = await s.owner(id, s.w.impl);
        expect(outcome).toEqual({
            kind: "pending",
            why: "CLAIM_MISMATCH",
            claimed: "e".repeat(40),
            actual: head,
        });
        expect(s.ledger((db) => db.receipts(id))).toEqual([]);
        expect(await logs()).toEqual([]);
        expect(s.stateOf(id)).toBe("reported");
    });

    it("tests the head, never the working tree", async () => {
        const { impl } = s.w;
        const id = s.id("fix");
        await s.dispatch(id, impl);
        const head = await s.commit(impl, "incomplete", id);
        await s.edit(impl, "complete");
        await s.report(id, { revision: head });
        await s.act("reconcile", { kind: "reconcile", taskId: id });
        const outcome = await s.owner(id, impl);
        expect(outcome).toMatchObject({ kind: "receipt", passed: false });
        if (outcome.kind === "receipt") {
            expect(outcome.receipt.revision).toBe(head);
            expect(outcome.receipt.exitCode).toBe(1);
        }
    });

    it("ignores a worker's own test, bunfig and preload", async () => {
        const { impl } = s.w;
        const id = s.id("fix");
        await s.dispatch(id, impl);
        const clone = await s.clone(impl);
        await s.edit(impl, "incomplete");
        // A config that preloads a script ending the run as a pass, and a
        // copy of the test that always passes, both committed.
        await writeFile(join(clone, "preload.ts"), "process.exit(0);\n");
        await writeFile(
            join(clone, "bunfig.toml"),
            'preload = ["./preload.ts"]\n',
        );
        await mkdir(join(clone, "owner"), { recursive: true });
        await writeFile(
            join(clone, "owner", "acceptance.ts"),
            "process.exit(0);\n",
        );
        const head = await s.commit(impl, "incomplete", "with a config");
        await s.report(id, { revision: head });
        await s.act("reconcile", { kind: "reconcile", taskId: id });
        const outcome = await s.owner(id, impl);
        expect(outcome).toMatchObject({ kind: "receipt", passed: false });
    });

    it("gives the worker's code no variable of the runner's own", async () => {
        const { impl } = s.w;
        const id = s.id("fix");
        await s.dispatch(id, impl);
        const clone = await s.clone(impl);
        await s.edit(impl, "complete");
        const file = join(clone, "src", "slug.ts");
        await writeFile(
            file,
            `${await readFile(file, "utf8")}\nconsole.log("ENV " + Object.keys(process.env).sort().join(","));\n`,
        );
        process.env.DOROTHY_OWNER_TEST_SECRET = "synthetic";
        try {
            const head = await s.commit(impl, "complete", "noisy");
            await s.report(id, { revision: head });
            await s.act("reconcile", { kind: "reconcile", taskId: id });
            const outcome = await s.owner(id, impl);
            if (outcome.kind !== "receipt") throw new Error("no receipt");
            const log = await readFile(outcome.receipt.logPath, "utf8");
            const names = /^ENV (.*)$/m.exec(log)?.[1] ?? "";
            expect(names).toContain("PATH");
            expect(names).not.toContain("DOROTHY_OWNER_TEST_SECRET");
            expect(log).not.toContain("synthetic");
        } finally {
            delete process.env.DOROTHY_OWNER_TEST_SECRET;
        }
    });

    it("refuses history that does not descend from the base", async () => {
        const { impl } = s.w;
        const id = s.id("fix");
        await s.dispatch(id, impl);
        const clone = await s.clone(impl);
        const orphan = Bun.spawnSync(
            ["git", "checkout", "-q", "--orphan", "other"],
            {
                cwd: clone,
            },
        );
        expect(orphan.exitCode).toBe(0);
        const head = await s.commit(impl, "complete", "unrelated");
        await s.report(id, { revision: head });
        await s.act("reconcile", { kind: "reconcile", taskId: id });
        const outcome = await s.owner(id, impl);
        expect(outcome).toMatchObject({
            kind: "pending",
            why: "NOT_FROM_BASE",
        });
        expect(s.ledger((db) => db.receipts(id))).toEqual([]);
    });

    it("records nothing for a report with no revision", async () => {
        const none = await reported(() => null);
        expect(await s.owner(none.id, s.w.impl)).toMatchObject({
            kind: "pending",
            why: "NO_CLAIM",
        });
        expect(s.ledger((db) => db.receipts(none.id))).toEqual([]);
    });

    it("records nothing for a report the ledger has not seen", async () => {
        const seen = await reported((head) => head);
        await s.report(seen.id, { revision: seen.head, extra: ["Note: new"] });
        expect(await s.owner(seen.id, s.w.impl)).toMatchObject({
            kind: "pending",
            why: "REPORT_CHANGED",
        });
        expect(s.ledger((db) => db.receipts(seen.id))).toEqual([]);
    });

    it("verifies only a reported task", async () => {
        const id = s.id("fix");
        await s.dispatch(id, s.w.impl);
        expect(await s.owner(id, s.w.impl)).toMatchObject({
            kind: "pending",
            why: "NOT_REPORTED",
        });
    });

    it("refuses an owner root inside the fixture root", async () => {
        await expect(
            createOwnerKit({
                root: join(s.fixtureRoot, "owner"),
                fixtureRoot: s.fixtureRoot,
                env: { PATH: "/usr/bin:/bin", home: join(s.root, "h") },
            }),
        ).rejects.toThrow("OWNER_ROOT_INSIDE_FIXTURE");
    });
});

describe("the fixture template", () => {
    it("fails the owner's test as shipped and the contract's examples too", async () => {
        const origin = join(s.root, "origin");
        const run = (script: string) =>
            Bun.spawnSync(["bun", "--no-env-file", script, origin], {
                cwd: s.root,
            });
        expect(run(join(FIXTURE, "owner", "acceptance.ts")).exitCode).toBe(1);
        expect(run(join(origin, "src", "example.ts")).exitCode).toBe(1);
    });

    it("passes the examples with the incomplete fix and the test with the complete", async () => {
        const { impl, rev } = s.w;
        const incomplete = await s.commit(impl, "incomplete");
        const complete = await s.commit(rev, "complete");
        const owner = join(FIXTURE, "owner", "acceptance.ts");
        const at = async (slot: typeof impl) => await s.clone(slot);
        const run = async (script: string, dir: string) =>
            Bun.spawnSync(["bun", "--no-env-file", script, dir], { cwd: dir })
                .exitCode;
        expect(incomplete).not.toBe(complete);
        expect(
            await run(
                join(await at(impl), "src", "example.ts"),
                await at(impl),
            ),
        ).toBe(0);
        expect(await run(owner, await at(impl))).toBe(1);
        expect(await run(owner, await at(rev))).toBe(0);
    });
});
