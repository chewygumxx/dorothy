// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~xxdorothy/dorothy.git
// ::: :/packages/memory/src/recording/pi-tree.ts
//
//

// Pi's entry graph and the archive segment that owns each entry. Modelled
// on @earendil-works/pi-coding-agent 1.5.0, dist/core/session-manager.js:
// every append is a child of the current leaf (_appendEntry), branch() and
// branchWithSummary() move the leaf to an earlier entry, resetLeaf() opens
// another root, usage entries are hidden from the tree view
// (modes/interactive/components/tree-selector.js), and createBranchedSession
// copies a path with labels dropped and parents re-chained.
//
// Invariants, fixed by the plan and pinned by pi.test.ts:
// - Entries are taken in append order. A parent must already exist in the
//   file or the supplied ancestry; a conflicting repeat, a self-parent or
//   a missing parent halts. An identical repeat is ignored.
// - A segment is `pi-` and the SHA-256 of native session, NUL, and its
//   first entry id. A root opens one; an entry's first child keeps its
//   segment; each further child opens one, its parent the segment owning
//   that entry and its anchor that entry's id. Every tree entry counts,
//   context entries included; a usage entry below another claims no
//   child slot, so later speech never changes a branch's identity.
// - A fork inherits the entries its parent's ancestry holds: they keep
//   their owner and origin, and a different payload digest halts. Any new
//   child of an inherited entry opens a segment under the fork's session.
import { createHash } from "node:crypto";

export type PiAncestry = {
    nativeSession: string;
    entries: Record<
        string,
        {
            owner: string;
            origin: string;
            parentId: string | null;
            payloadDigest: string;
        }
    >;
};
export type TreeSegment = {
    session: string;
    parent: string | null;
    anchor: string | null;
};
export type TreeNode = {
    id: string;
    parentId: string | null;
    owner: string;
    origin: string;
    digest: string;
    inherited: boolean;
    // Usage entries below another entry claim no child slot.
    tree: boolean;
    claimed: boolean;
};

// A graph fault, named by a code that quotes no record contents.
export class PiHalt extends Error {
    constructor(readonly code: string) {
        super(code);
    }
}

const sha256 = (value: string) =>
    createHash("sha256").update(value).digest("hex");
export const digestOf = (parts: readonly string[]) => sha256(parts.join("\0"));
export const segmentId = (session: string, first: string) =>
    `pi-${digestOf([session, first])}`;

// JSON with sorted keys, so a copy's key order cannot change its digest.
function canonical(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
    if (value !== null && typeof value === "object") {
        const fields = Object.entries(value)
            .filter(([, field]) => field !== undefined)
            .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
            .map(
                ([key, field]) => `${JSON.stringify(key)}:${canonical(field)}`,
            );
        return `{${fields.join(",")}}`;
    }
    return JSON.stringify(value);
}
// A fork may re-chain parents, so the digest leaves out id and parentId.
// It detects conflicting reuse of an id; it never identifies speech.
export function payloadDigest(entry: Record<string, unknown>): string {
    const { id: _id, parentId: _parentId, ...payload } = entry;
    return sha256(canonical(payload));
}

export class PiTree {
    readonly segments: TreeSegment[] = [];
    private readonly nodes = new Map<string, TreeNode>();

    constructor(
        private readonly session: string,
        private readonly parent: PiAncestry | null,
    ) {}

    node(id: string): TreeNode | undefined {
        return this.nodes.get(id);
    }

    // The new node, or null for an identical repeat of a known entry.
    add(
        id: string,
        parentId: string | null,
        digest: string,
        tree: boolean,
    ): TreeNode | null {
        if (parentId === id) throw new PiHalt("cycle");
        const prior = this.nodes.get(id);
        if (prior) {
            if (prior.digest === digest && prior.parentId === parentId)
                return null;
            throw new PiHalt("duplicate");
        }
        const above = parentId === null ? null : this.lookup(parentId);
        if (above === undefined) throw new PiHalt("parent");
        const inherited = this.inherited(id);
        let node: TreeNode;
        if (inherited) {
            // An inherited entry descends only from inherited entries.
            if (
                inherited.payloadDigest !== digest ||
                above?.inherited === false
            )
                throw new PiHalt("conflict");
            node = {
                id,
                parentId,
                owner: inherited.owner,
                origin: inherited.origin,
                digest,
                inherited: true,
                tree: true,
                claimed: false,
            };
        } else {
            const base = this.effective(above);
            const transparent = !tree && base !== null;
            node = {
                id,
                parentId,
                owner: transparent
                    ? base.owner
                    : this.place(id, parentId, base),
                origin: this.session,
                digest,
                inherited: false,
                tree: !transparent,
                claimed: false,
            };
        }
        this.nodes.set(id, node);
        return node;
    }

    ancestry(): PiAncestry {
        return {
            nativeSession: this.session,
            entries: Object.fromEntries(
                [...this.nodes.values()].map((node) => [
                    node.id,
                    {
                        owner: node.owner,
                        origin: node.origin,
                        parentId: node.parentId,
                        payloadDigest: node.digest,
                    },
                ]),
            ),
        };
    }

    private inherited(id: string) {
        const entries = this.parent?.entries;
        return entries && Object.hasOwn(entries, id) ? entries[id] : undefined;
    }

    // A local node, or a parent known only from the supplied ancestry.
    private lookup(id: string): TreeNode | undefined {
        const local = this.nodes.get(id);
        if (local) return local;
        const inherited = this.inherited(id);
        if (!inherited) return undefined;
        return {
            id,
            parentId: inherited.parentId,
            owner: inherited.owner,
            origin: inherited.origin,
            digest: inherited.payloadDigest,
            inherited: true,
            tree: true,
            claimed: false,
        };
    }

    // Skip usage entries up to the tree entry whose child slots count.
    private effective(node: TreeNode | null): TreeNode | null {
        let current = node;
        while (current !== null && !current.tree)
            current =
                current.parentId === null
                    ? null
                    : (this.lookup(current.parentId) ?? null);
        return current;
    }

    // The first local child keeps its parent's segment; any other child,
    // a root or a fork's first new descendant opens one keyed by itself.
    private place(id: string, anchor: string | null, base: TreeNode | null) {
        if (base !== null && !base.inherited && !base.claimed) {
            base.claimed = true;
            return base.owner;
        }
        const session = segmentId(this.session, id);
        this.segments.push({ session, parent: base?.owner ?? null, anchor });
        return session;
    }
}
