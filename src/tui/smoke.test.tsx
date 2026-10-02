// vim:set expandtab shiftwidth=4 filetype=typescriptreact:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/src/tui/smoke.test.tsx
//
//

import { describe, expect, it } from "bun:test";
import { Text } from "ink";
import { render } from "ink-testing-library";

describe("Ink under Bun", () => {
    it("renders a frame", () => {
        const { lastFrame, unmount } = render(<Text>hello</Text>);
        expect(lastFrame()).toBe("hello");
        unmount();
    });
});
