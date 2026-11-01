// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/agent/src/failures.ts
//
//

// A provider's error, thrown or streamed, as core's Failure. Only agent
// knows the wire; runRoute decides on the class.

import type { Failure, FailureClass } from "@dorothy/core";

// Words in a 400 or 403 that mean the account, not the request, is the
// trouble: spent credits, billing, a spending or usage limit.
const USAGE = /credit|billing|spend(ing)? limit|usage limit/i;

// An error's type, as the status it would have had. Read before the
// status: the provider gives a streamed error a status of its own (a
// billing_error comes as 400), which would hide the 402 it means.
const STATUS_OF_TYPE: ReadonlyMap<string, number> = new Map([
    ["rate_limit_error", 429],
    ["overloaded_error", 529],
    ["api_error", 500],
    ["billing_error", 402],
]);

// retry-after, in seconds or as an HTTP date.
export function retryAfterMs(
    headers: Record<string, string> | undefined,
    now = Date.now(),
): number | null {
    const value = headers?.["retry-after"]?.trim();
    if (value === undefined || value === "") {
        return null;
    }
    if (/^\d+(\.\d+)?$/.test(value)) {
        return Number(value) * 1000;
    }
    const at = Date.parse(value);
    return Number.isNaN(at) ? null : Math.max(0, at - now);
}

export function classOf(status: number, message: string): FailureClass {
    if (
        status === 402 ||
        ((status === 400 || status === 403) && USAGE.test(message))
    ) {
        return "usage";
    }
    if (status === 429) {
        return "rate-limit";
    }
    if (status === 503 || status === 529) {
        return "overload";
    }
    if (status >= 500) {
        return "server";
    }
    // A redirect refused, or a body cut off after a 200.
    if (status < 400) {
        return "network";
    }
    return "rejected";
}

// An error with no status, by the AI SDK's name for it: a call that
// never reached a provider is network; an answer the SDK could not read
// is the provider's, as a 5xx is; a request it would not send is
// rejected. An error it does not name stays network.
const CLASS_OF_NAME: ReadonlyMap<string, FailureClass> = new Map([
    ["AI_JSONParseError", "server"],
    ["AI_InvalidResponseDataError", "server"],
    ["AI_TypeValidationError", "server"],
    ["AI_EmptyResponseBodyError", "server"],
    ["AI_NoContentGeneratedError", "server"],
    ["AI_InvalidPromptError", "rejected"],
    ["AI_InvalidArgumentError", "rejected"],
    ["AI_UnsupportedFunctionalityError", "rejected"],
    ["AI_NoSuchModelError", "rejected"],
]);

type Wire = {
    name?: unknown;
    statusCode?: unknown;
    responseHeaders?: Record<string, string>;
    data?: unknown;
    message?: unknown;
};

function typeOf(error: Wire): string | null {
    const data = error.data as
        | { type?: unknown; error?: { type?: unknown } }
        | undefined;
    if (typeof data?.error?.type === "string") {
        return data.error.type;
    }
    return typeof data?.type === "string" ? data.type : null;
}

function statusOf(error: Wire): number | null {
    const type = typeOf(error);
    const mapped = type === null ? undefined : STATUS_OF_TYPE.get(type);
    if (mapped !== undefined) {
        return mapped;
    }
    return typeof error.statusCode === "number" ? error.statusCode : null;
}

// An error the AI SDK threw or streamed; one with no status never
// reached a provider that answered.
export function failureOf(error: unknown, now = Date.now()): Failure {
    const wire = (
        typeof error === "object" && error !== null ? error : {}
    ) as Wire;
    const message =
        error instanceof Error
            ? error.message
            : typeof wire.message === "string"
              ? wire.message
              : String(error);
    const status = statusOf(wire);
    if (status === null) {
        const named =
            typeof wire.name === "string"
                ? CLASS_OF_NAME.get(wire.name)
                : undefined;
        return { class: named ?? "network", message, retryAfterMs: null };
    }
    const kind = classOf(status, message);
    return {
        class: kind,
        message,
        retryAfterMs:
            kind === "usage" || kind === "rate-limit"
                ? retryAfterMs(wire.responseHeaders, now)
                : null,
    };
}
