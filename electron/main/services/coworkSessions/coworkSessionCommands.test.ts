import { expect, it } from "vitest";
import {
  extractCoworkSlashCommandNames,
  getCoworkSupportedCommands,
  mergeCoworkSupportedCommands,
} from "./coworkSessionCommands";
import type { CoworkSessionRuntimeState } from "./coworkSessionTypes";

it("extractCoworkSlashCommandNames keeps strings, drops junk, first-wins order", () => {
  expect(
    extractCoworkSlashCommandNames([
      "help",
      "",
      "  ",
      "help",
      12,
      "config",
      null,
      "compact",
    ]),
  ).toEqual(["help", "config", "compact"]);
  expect(extractCoworkSlashCommandNames(undefined)).toEqual([]);
  expect(extractCoworkSlashCommandNames("nope")).toEqual([]);
});

it("mergeCoworkSupportedCommands is session slash → RT → K2e (official order)", () => {
  const names = mergeCoworkSupportedCommands(["help", "config"]).map(
    (c) => c.name,
  );
  expect(names).toEqual([
    "help",
    "config",
    "schedule",
    "setup-cowork",
    "consolidate-memory",
    "context",
  ]);
  expect(mergeCoworkSupportedCommands(["help"])[0]).toEqual({
    name: "help",
    description: "help",
  });
  expect(
    mergeCoworkSupportedCommands(undefined).find((c) => c.name === "schedule")
      ?.scope,
  ).toBe("cowork");
});

it("getCoworkSupportedCommands uses session.slashCommands not live query", async () => {
  // Official LAM: slashCommands map + RT + K2e — not query.supportedCommands
  // (Code LocalSessions residual).
  const session = {
    slashCommands: ["help", "compact"],
    query: {
      supportedCommands: async () => [
        { description: "should not appear first alone", name: "config" },
      ],
    },
  } as unknown as CoworkSessionRuntimeState;

  const commands = await getCoworkSupportedCommands(session);
  expect(commands.map((c) => c.name)).toEqual([
    "help",
    "compact",
    "schedule",
    "setup-cowork",
    "consolidate-memory",
    "context",
  ]);
});

it("getCoworkSupportedCommands without session returns RT+K2e only", async () => {
  const commands = await getCoworkSupportedCommands();
  expect(commands.map((c) => c.name)).toEqual([
    "schedule",
    "setup-cowork",
    "consolidate-memory",
    "context",
  ]);
});
