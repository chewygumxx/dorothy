// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/memory/src/history/seal.ts
//
//

const MAGIC = "dorothy-sealed 1";
const NONCE_BYTES = 12;
const KEY_BYTES = 32;

const encoder = new TextEncoder();

// Web Crypto wants bytes on an ArrayBuffer of their own.
const own = (bytes: Uint8Array) => new Uint8Array(bytes);
const base64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");

export type Opened =
    | { ok: true; bundle: Uint8Array }
    | { ok: false; reason: string };

// A new DOROTHY_MIRROR_KEY: 32 random bytes, as base64.
export function newKey(): string {
    return base64(crypto.getRandomValues(new Uint8Array(KEY_BYTES)));
}

// The key's bytes, or null when it is missing or not 32 bytes of base64.
export function parseKey(text: string | undefined): Uint8Array | null {
    const trimmed = text?.trim() ?? "";
    const bytes = Buffer.from(trimmed, "base64");
    return bytes.length === KEY_BYTES && base64(bytes) === trimmed
        ? new Uint8Array(bytes)
        : null;
}

const importKey = (key: Uint8Array) =>
    crypto.subtle.importKey("raw", own(key), "AES-GCM", false, [
        "encrypt",
        "decrypt",
    ]);

// AES-256-GCM under a fresh nonce, behind a header that names the format
// and carries the nonce. The header is authenticated with the bundle, so
// a changed version or nonce fails to open.
export async function seal(
    bundle: Uint8Array,
    key: Uint8Array,
    nonce: Uint8Array = crypto.getRandomValues(new Uint8Array(NONCE_BYTES)),
): Promise<Uint8Array> {
    const header = encoder.encode(`${MAGIC}\n${base64(nonce)}\n`);
    const sealed = new Uint8Array(
        await crypto.subtle.encrypt(
            { name: "AES-GCM", iv: own(nonce), additionalData: header },
            await importKey(key),
            own(bundle),
        ),
    );
    const out = new Uint8Array(header.length + sealed.length);
    out.set(header);
    out.set(sealed, header.length);
    return out;
}

export async function unseal(
    sealed: Uint8Array,
    key: Uint8Array,
): Promise<Opened> {
    const first = sealed.indexOf(0x0a);
    const second = first === -1 ? -1 : sealed.indexOf(0x0a, first + 1);
    const magic = Buffer.from(sealed.subarray(0, Math.max(first, 0))).toString(
        "utf8",
    );
    if (second === -1 || !magic.startsWith("dorothy-sealed ")) {
        return { ok: false, reason: "it is not a sealed bundle" };
    }
    if (magic !== MAGIC) {
        return {
            ok: false,
            reason: `it is sealed as version ${magic.slice("dorothy-sealed ".length)}, not 1`,
        };
    }
    const nonce = Buffer.from(
        Buffer.from(sealed.subarray(first + 1, second)).toString("utf8"),
        "base64",
    );
    if (nonce.length !== NONCE_BYTES) {
        return { ok: false, reason: "its nonce is not 12 bytes" };
    }
    try {
        const bundle = await crypto.subtle.decrypt(
            {
                name: "AES-GCM",
                iv: own(nonce),
                additionalData: own(sealed.subarray(0, second + 1)),
            },
            await importKey(key),
            own(sealed.subarray(second + 1)),
        );
        return { ok: true, bundle: new Uint8Array(bundle) };
    } catch {
        return {
            ok: false,
            reason: "it does not open with this key, or it was changed",
        };
    }
}

export const sealedName = (sequence: number) =>
    `bundles/${String(sequence).padStart(6, "0")}.enc`;

export const SEALED_README = [
    "This branch holds Dorothy's memory, sealed.",
    "",
    "Each file in bundles/ is a git bundle of the commits after the one",
    "before it, encrypted with AES-256-GCM under DOROTHY_MIRROR_KEY.",
    "Rebuild the memory into an empty data directory with:",
    "",
    "    dorothy --recover <this repository's url or path>",
    "",
].join("\n");
