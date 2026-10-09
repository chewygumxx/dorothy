// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/tui/src/markdown/highlight.ts
//
//

import { common, createLowlight } from "lowlight";
import { PLAIN, type Span, type Style } from "./spans.js";

const lowlight = createLowlight(common);

const MAGENTA: Style = { color: "magenta" };
const GREEN: Style = { color: "green" };
const YELLOW: Style = { color: "yellow" };
const DIM: Style = { dim: true };
const BLUE: Style = { color: "blue" };
const CYAN: Style = { color: "cyan" };

// The 16 ANSI colours, so code follows the terminal's own theme.
const COLOURS: Record<string, Style> = {
    keyword: MAGENTA,
    built_in: MAGENTA,
    type: MAGENTA,
    literal: MAGENTA,
    string: GREEN,
    regexp: GREEN,
    symbol: GREEN,
    number: YELLOW,
    comment: DIM,
    quote: DIM,
    title: BLUE,
    function: BLUE,
    class: BLUE,
    section: BLUE,
    attr: CYAN,
    attribute: CYAN,
    property: CYAN,
    variable: CYAN,
    params: CYAN,
};

// The parts of lowlight's hast tree this walks.
type Node = {
    type: string;
    value?: string;
    properties?: { className?: unknown };
    children?: Node[];
};

// "hljs-title function_" maps by its first known class; an element without
// one inherits its parent's colour.
function styleOf(className: unknown, inherited: Style): Style {
    if (!Array.isArray(className)) {
        return inherited;
    }
    for (const name of className) {
        const style =
            COLOURS[
                String(name)
                    .replace(/^hljs-/, "")
                    .replace(/_+$/, "")
            ];
        if (style) {
            return style;
        }
    }
    return inherited;
}

function collect(node: Node, style: Style, spans: Span[]): void {
    if (node.type === "text") {
        spans.push({ text: node.value ?? "", style });
        return;
    }
    const own =
        node.type === "element"
            ? styleOf(node.properties?.className, style)
            : style;
    for (const child of node.children ?? []) {
        collect(child, own, spans);
    }
}

export function highlight(
    code: string,
    lang: string | undefined,
): Span[] | null {
    const name = lang?.trim().split(/\s+/)[0];
    if (!name || !lowlight.registered(name)) {
        return null;
    }
    const spans: Span[] = [];
    collect(lowlight.highlight(name, code) as unknown as Node, PLAIN, spans);
    return spans;
}
