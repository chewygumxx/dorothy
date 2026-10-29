// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/eval/src/errors.ts
//
//

// A failure the user can mend, said in a line, or a line to each problem it
// lists: what is wrong and what to run or set. Anything else is a fault
// and keeps its stack.
export class UsageError extends Error {}

// A reason to stop a run or a generation that is not the work's fault: what
// is done is kept, and the command resumes or runs again later.
export class RunStop extends UsageError {}

// The exit of a command stopped by a plan's usage limit (sysexits' EX_TEMPFAIL),
// for a wrapper to wait for the reset and go on.
export const EXIT_TEMPFAIL = 75;

// The code of a failed system call, if the error has one.
export const codeOf = (error: unknown): string | undefined => {
    const code = (error as { code?: unknown } | null)?.code;
    return typeof code === "string" ? code : undefined;
};
