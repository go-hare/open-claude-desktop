import { expect, it } from "vitest";
import { getCoworkSupportedCommands } from "./coworkSessionCommands";
import type { CoworkSessionRuntimeState } from "./coworkSessionTypes";

it("combines live CLI commands with the official Cowork commands", async () => {
  const session = {
    query: {
      supportedCommands: async () => [
        { description: "CLI context", name: "context" },
        { description: "Open config", name: "config" },
      ],
    },
  } as CoworkSessionRuntimeState;

  const commands = await getCoworkSupportedCommands(session);

  expect(commands.map((command) => command.name)).toEqual([
    "context",
    "config",
    "schedule",
    "setup-cowork",
  ]);
  expect(commands.find((command) => command.name === "context")).toEqual({
    description: "CLI context",
    name: "context",
  });
});
