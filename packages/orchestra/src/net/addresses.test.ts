// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/orchestra/src/net/addresses.test.ts
//
//

import { describe, expect, it } from "bun:test";
import { isPublicAddress } from "./addresses.js";

describe("isPublicAddress", () => {
    it.each([
        "1.1.1.1",
        "104.18.0.1",
        "2606:4700::1111",
        "2a00:1450:4009:81f::200e",
    ])("admits %s", (address) => {
        expect(isPublicAddress(address)).toBe(true);
    });

    it.each([
        ["unspecified", "0.0.0.0"],
        ["this network", "0.1.2.3"],
        ["private", "10.0.0.1"],
        ["carrier-grade NAT", "100.64.0.1"],
        ["loopback", "127.0.0.1"],
        ["loopback, anywhere in its block", "127.255.0.9"],
        ["link-local", "169.254.169.254"],
        ["private, 172.16/12", "172.31.255.255"],
        ["IETF protocol assignments", "192.0.0.8"],
        ["documentation", "192.0.2.1"],
        ["private, 192.168/16", "192.168.1.1"],
        ["benchmarking", "198.18.0.1"],
        ["multicast", "224.0.0.1"],
        ["reserved", "240.0.0.1"],
        ["broadcast", "255.255.255.255"],
        ["IPv6 unspecified", "::"],
        ["IPv6 loopback", "::1"],
        ["unique-local", "fd00::1"],
        ["link-local IPv6", "fe80::1"],
        ["IPv6 multicast", "ff02::1"],
        ["documentation IPv6", "2001:db8::1"],
        ["IPv4-mapped loopback", "::ffff:127.0.0.1"],
        ["IPv4-mapped private, in hex", "::ffff:a00:1"],
        ["NAT64 of a private address", "64:ff9b::a00:1"],
        ["not an address", "example.com"],
        ["an address with a zone", "fe80::1%eth0"],
    ])("refuses %s (%s)", (_, address) => {
        expect(isPublicAddress(address)).toBe(false);
    });
});
