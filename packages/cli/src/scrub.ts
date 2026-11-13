// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~xxdorothy/dorothy.git
// ::: :/packages/cli/src/scrub.ts
//
//

// The provider-neutral evidence boundary for scripts that already depend
// on the CLI package. Memory owns the secret shapes; no credential file is
// read and no host-specific secret list is built here.
export { scrub } from "@dorothy/memory/scrub";
