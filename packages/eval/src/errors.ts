// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/eval/src/errors.ts
//
//

// A failure the user can mend, said in one line: what is wrong and what
// to run or set. Anything else is a fault and keeps its stack.
export class UsageError extends Error {}

// The code of a failed system call, if the error has one.
export const codeOf = (error: unknown): string | undefined => {
    const code = (error as { code?: unknown } | null)?.code;
    return typeof code === "string" ? code : undefined;
};
