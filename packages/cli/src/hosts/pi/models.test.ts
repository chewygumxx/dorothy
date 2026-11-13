// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~xxdorothy/dorothy.git
// ::: :/packages/cli/src/hosts/pi/models.test.ts
//
//

import { expect, it } from "bun:test";
import type { RouteEntry } from "@dorothy/core";
import type { PiModelSpec } from "./models.js";
import { readPiCatalog, selectPiModel, sessionDirFor } from "./models.js";

const modelId = "deepseek-ai/DeepSeek-V4.1-Flash-1017";
const spec: PiModelSpec = {
    id: modelId,
    contextWindow: 262144,
    maxTokens: 32768,
    reasoning: true,
    input: ["text"],
    price: { input: 0.225, output: 0.9, cacheRead: 0.006 },
    checkedAt: "2026-11-03",
    sources: ["https://example.test/catalogue"],
};
const entry = (over: Partial<RouteEntry> = {}): RouteEntry => ({
    provider: "featherless",
    kind: "featherless",
    model: modelId,
    baseUrl: "https://api.featherless.ai/v1",
    key: "FEATHERLESS_API_KEY",
    price: null,
    ...over,
});
const claude = entry({
    provider: "anthropic",
    kind: "anthropic",
    model: "claude-opus-5-5",
    baseUrl: "https://api.anthropic.com",
    key: "ANTHROPIC_API_KEY",
});

it("selects the first Featherless entry of the chat route", () => {
    const first = entry();
    const other = entry({ provider: "feather2", model: "other/Model" });
    const selection = selectPiModel([claude, first, other], null, [
        spec,
        { ...spec, id: "other/Model" },
    ]);
    expect(selection.entry).toBe(first);
    expect(selection.models.map((m) => m.id)).toEqual([modelId]);
});

it("selects an exact provider:model and offers only that provider", () => {
    const a = entry();
    const b = entry({ provider: "feather2", model: "other/Model" });
    const c = entry({ provider: "feather2", model: modelId });
    const catalog = [spec, { ...spec, id: "other/Model" }];
    const selection = selectPiModel(
        [a, claude, b, c],
        `feather2:${modelId}`,
        catalog,
    );
    expect(selection.entry).toBe(c);
    expect(selection.models.map((m) => m.id)).toEqual([modelId, "other/Model"]);
    const chosen = selectPiModel([a, b, c], "feather2:other/Model", catalog);
    expect(chosen.entry).toBe(b);
    expect(chosen.models.map((m) => m.id)).toEqual(["other/Model", modelId]);
});

it("offers no model of another provider or kind", () => {
    const selection = selectPiModel([claude, entry()], null, [
        spec,
        { ...spec, id: "claude-opus-5-5" },
    ]);
    expect(selection.models.map((m) => m.id)).toEqual([modelId]);
});

it("refuses an unknown or non-Featherless model", () => {
    const route = [claude, entry()];
    expect(() => selectPiModel(route, "featherless:nope", [spec])).toThrow(
        /pi_model_unknown/,
    );
    expect(() => selectPiModel(route, modelId, [spec])).toThrow(
        /pi_model_unknown/,
    );
    expect(() =>
        selectPiModel(route, "anthropic:claude-opus-5-5", [spec]),
    ).toThrow(/pi_model_unknown/);
});

it("stops with the configuration needed when no entry is Featherless", () => {
    expect(() => selectPiModel([claude], null, [spec])).toThrow(
        /pi_route_featherless.*\[providers/s,
    );
    expect(() => selectPiModel([], null, [spec])).toThrow(
        /pi_route_featherless/,
    );
});

it("fails clearly on a configured model the catalog does not list", () => {
    expect(() =>
        selectPiModel([entry({ model: "x/Unlisted" })], null, [spec]),
    ).toThrow(/pi_model_unlisted: featherless:x\/Unlisted/);
});

it("lets an explicit route price override and labels it", () => {
    const selection = selectPiModel([entry({ price: [1, 2] })], null, [spec]);
    const [model] = selection.models;
    expect(model?.price).toEqual({ input: 1, output: 2, cacheRead: 0.006 });
    expect(model?.contextWindow).toBe(262144);
    expect(model?.maxTokens).toBe(32768);
    expect(model?.sources).toContain("configuration: route price");
    expect(spec.price.input).toBe(0.225);
    expect(spec.sources).toEqual(["https://example.test/catalogue"]);
});

it("keeps the checked price without a route price", () => {
    const [model] = selectPiModel([entry()], null, [spec]).models;
    expect(model?.price).toEqual(spec.price);
    expect(model?.sources).toEqual(spec.sources);
});

it("commits the first compatibility entry as checked", async () => {
    const catalog = await readPiCatalog();
    expect(catalog).toHaveLength(1);
    expect(catalog[0]).toMatchObject({
        id: modelId,
        contextWindow: 262144,
        maxTokens: 32768,
        reasoning: true,
        input: ["text"],
        price: { input: 0.225, output: 0.9, cacheRead: 0.006 },
        checkedAt: "2026-11-03",
    });
});

it("rejects a malformed catalog", async () => {
    const path = `${import.meta.dir}/models.test.ts`;
    await expect(readPiCatalog(path)).rejects.toThrow(/pi_catalog/);
});

it("separates session directories by working directory", () => {
    expect(sessionDirFor("/a/b")).not.toBe(sessionDirFor("/a-b"));
    expect(sessionDirFor("/a/b")).toBe(sessionDirFor("/a/b"));
    const dir = sessionDirFor("/home/u/my:proj");
    expect(dir).toMatch(/^[0-9a-f]{64}\/--home-u-my-proj--$/);
});
