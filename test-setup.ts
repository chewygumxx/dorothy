// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/test-setup.ts
//
//

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Preloaded by `bun test` (bunfig.toml) before any test file imports Ink.
// Chalk reads FORCE_COLOR once, at import, and a shell that sets it would
// otherwise wrap every rendered frame the tests compare in ANSI codes.
process.env.FORCE_COLOR = "0";

// The recall index lives in the cache directory; no test may touch the
// user's.
process.env.XDG_CACHE_HOME = mkdtempSync(join(tmpdir(), "dorothy-cache-"));
