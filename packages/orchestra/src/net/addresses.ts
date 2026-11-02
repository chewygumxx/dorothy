// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/orchestra/src/net/addresses.ts
//
//

// Whether an address is one a box's traffic may reach: a public unicast
// address, never loopback, private, link-local, carrier-grade NAT,
// multicast, documentation, reserved or unspecified, nor an IPv6 form of
// any IPv4 address that is one of those.

import { isIPv4, isIPv6 } from "node:net";

// [first address, prefix length] for each IPv4 block refused.
const V4_REFUSED: [string, number][] = [
    ["0.0.0.0", 8],
    ["10.0.0.0", 8],
    ["100.64.0.0", 10],
    ["127.0.0.0", 8],
    ["169.254.0.0", 16],
    ["172.16.0.0", 12],
    ["192.0.0.0", 24],
    ["192.0.2.0", 24],
    ["192.168.0.0", 16],
    ["198.18.0.0", 15],
    ["198.51.100.0", 24],
    ["203.0.113.0", 24],
    ["224.0.0.0", 4],
    ["240.0.0.0", 4],
];

const v4Number = (address: string): number =>
    address.split(".").reduce((total, part) => total * 256 + Number(part), 0);

const inBlock = (value: number, [first, prefix]: [string, number]) => {
    const size = 2 ** (32 - prefix);
    const start = v4Number(first);
    return value >= start && value < start + size;
};

const publicV4 = (value: number) =>
    !V4_REFUSED.some((block) => inBlock(value, block));

// The eight 16-bit groups of an IPv6 address, an IPv4 tail included.
function v6Groups(address: string): number[] {
    let text = address.toLowerCase();
    const tail = text.match(/(\d+\.\d+\.\d+\.\d+)$/)?.[1];
    if (tail !== undefined) {
        const value = v4Number(tail);
        text = `${text.slice(0, -tail.length)}${(value >>> 16).toString(16)}:${(value & 0xffff).toString(16)}`;
    }
    const [head, rest] = text.split("::", 2) as [string, string | undefined];
    const parse = (part: string) =>
        part === ""
            ? []
            : part.split(":").map((group) => Number.parseInt(group, 16));
    const front = parse(head);
    const back = rest === undefined ? [] : parse(rest);
    const zeros = new Array(8 - front.length - back.length).fill(0);
    return rest === undefined ? front : [...front, ...zeros, ...back];
}

export function isPublicAddress(address: string): boolean {
    if (isIPv4(address)) {
        return publicV4(v4Number(address));
    }
    if (!isIPv6(address) || address.includes("%")) {
        return false;
    }
    const groups = v6Groups(address);
    const [a = 0, b = 0, c = 0, d = 0, e = 0, f = 0, g = 0, h = 0] = groups;
    const embedded = g * 65536 + h;
    // ::ffff:0:0/96, IPv4-mapped; 64:ff9b::/96, NAT64: judged as IPv4.
    if (a === 0 && b === 0 && c === 0 && d === 0 && e === 0 && f === 0xffff) {
        return publicV4(embedded);
    }
    if (
        a === 0x64 &&
        b === 0xff9b &&
        c === 0 &&
        d === 0 &&
        e === 0 &&
        f === 0
    ) {
        return publicV4(embedded);
    }
    // ::/128, ::1/128 and the rest of ::/8, deprecated IPv4-compatible.
    if (a === 0) {
        return false;
    }
    // fc00::/7 unique-local, fe80::/10 link-local, ff00::/8 multicast,
    // 2001:db8::/32 documentation, 100::/64 discard.
    return !(
        (a & 0xfe00) === 0xfc00 ||
        (a & 0xffc0) === 0xfe80 ||
        (a & 0xff00) === 0xff00 ||
        (a === 0x2001 && b === 0x0db8) ||
        (a === 0x0100 && b === 0 && c === 0 && d === 0)
    );
}
