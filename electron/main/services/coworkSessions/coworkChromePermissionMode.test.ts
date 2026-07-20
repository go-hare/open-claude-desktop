import { expect, it } from "vitest";
import {
  applyCoworkChromePermissionFields,
  applyCoworkDispatchChildStartInherit,
  mergeCoworkChromePermissionWriteBack,
  pickCoworkDispatchChildInheritedFields,
  rankCoworkChromePermissionMode,
  resolveCoworkChromePermsOnPermissionModeChange,
} from "./coworkChromePermissionMode";
import type { CoworkChromePermissionFields } from "./coworkChromePermissionMode";

it("gXi enter unsupervised without snapshot saves current chrome", () => {
  const session: CoworkChromePermissionFields = {
    chromePermissionMode: "ask",
    chromeAllowedDomains: ["a.com"],
  };
  const next = resolveCoworkChromePermsOnPermissionModeChange(
    session,
    "auto",
    true,
  );
  expect(next).toEqual({
    chromePermissionMode: "skip_all_permission_checks",
    chromeAllowedDomains: undefined,
    chromePermsBeforeUnsupervised: {
      mode: "ask",
      domains: ["a.com"],
    },
  });
});

it("gXi enter unsupervised with snapshot keeps prior snapshot", () => {
  const session: CoworkChromePermissionFields = {
    chromePermissionMode: "follow_a_plan",
    chromeAllowedDomains: ["live.com"],
    chromePermsBeforeUnsupervised: {
      mode: "ask",
      domains: ["saved.com"],
    },
  };
  const next = resolveCoworkChromePermsOnPermissionModeChange(
    session,
    "bypassPermissions",
    false,
  );
  expect(next).toEqual({
    chromePermissionMode: undefined,
    chromeAllowedDomains: undefined,
    chromePermsBeforeUnsupervised: {
      mode: "ask",
      domains: ["saved.com"],
    },
  });
});

it("gXi leave unsupervised restores snapshot", () => {
  const session: CoworkChromePermissionFields = {
    chromePermissionMode: "skip_all_permission_checks",
    chromeAllowedDomains: undefined,
    chromePermsBeforeUnsupervised: {
      mode: "follow_a_plan",
      domains: ["restored.com"],
    },
  };
  const next = resolveCoworkChromePermsOnPermissionModeChange(
    session,
    "default",
  );
  expect(next).toEqual({
    chromePermissionMode: "follow_a_plan",
    chromeAllowedDomains: ["restored.com"],
    chromePermsBeforeUnsupervised: undefined,
  });
});

it("gXi no-ops when not unsupervised and no snapshot", () => {
  const session: CoworkChromePermissionFields = {
    chromePermissionMode: "ask",
    chromeAllowedDomains: ["x.com"],
  };
  expect(
    resolveCoworkChromePermsOnPermissionModeChange(session, "acceptEdits"),
  ).toBeUndefined();
});

it("applyCoworkChromePermissionFields writes clones", () => {
  const session: CoworkChromePermissionFields = {
    chromePermissionMode: "ask",
    chromeAllowedDomains: ["old"],
  };
  const domains = ["new"];
  applyCoworkChromePermissionFields(session, {
    chromePermissionMode: "follow_a_plan",
    chromeAllowedDomains: domains,
    chromePermsBeforeUnsupervised: undefined,
  });
  domains.push("mut");
  expect(session.chromePermissionMode).toBe("follow_a_plan");
  expect(session.chromeAllowedDomains).toEqual(["new"]);
  expect(session.chromePermsBeforeUnsupervised).toBeUndefined();
});

it("aXi wwe rank and merge write-back", () => {
  expect(rankCoworkChromePermissionMode(undefined)).toBe(-1);
  expect(rankCoworkChromePermissionMode("ask")).toBe(0);
  expect(rankCoworkChromePermissionMode("follow_a_plan")).toBe(1);
  expect(rankCoworkChromePermissionMode("skip_all_permission_checks")).toBe(2);

  // Child skip_all upgrades parent ask; unions domains.
  expect(
    mergeCoworkChromePermissionWriteBack(
      { chromePermissionMode: "ask", chromeAllowedDomains: ["a.com"] },
      "skip_all_permission_checks",
      ["b.com", "a.com"],
    ),
  ).toEqual({
    chromePermissionMode: "skip_all_permission_checks",
    chromeAllowedDomains: ["a.com", "b.com"],
  });

  // Lower child rank does not downgrade parent mode; still unions domains.
  expect(
    mergeCoworkChromePermissionWriteBack(
      {
        chromePermissionMode: "skip_all_permission_checks",
        chromeAllowedDomains: ["p.com"],
      },
      "ask",
      ["c.com"],
    ),
  ).toEqual({
    chromePermissionMode: "skip_all_permission_checks",
    chromeAllowedDomains: ["p.com", "c.com"],
  });

  // Equal rank keeps proposed mode (wwe(A) >= r).
  expect(
    mergeCoworkChromePermissionWriteBack(
      { chromePermissionMode: "follow_a_plan", chromeAllowedDomains: [] },
      "follow_a_plan",
      ["x.com"],
    ),
  ).toEqual({
    chromePermissionMode: "follow_a_plan",
    chromeAllowedDomains: ["x.com"],
  });

  // Undefined parent mode (-1) always takes proposed mode.
  expect(
    mergeCoworkChromePermissionWriteBack(
      { chromeAllowedDomains: undefined },
      "ask",
      ["only.com"],
    ),
  ).toEqual({
    chromePermissionMode: "ask",
    chromeAllowedDomains: ["only.com"],
  });
});

it("oXi pickCoworkDispatchChildInheritedFields + apply start inherit", () => {
  expect(pickCoworkDispatchChildInheritedFields(null)).toEqual({});
  expect(pickCoworkDispatchChildInheritedFields(undefined)).toEqual({});
  expect(pickCoworkDispatchChildInheritedFields({})).toEqual({});

  const parent = {
    chromePermissionMode: "follow_a_plan" as const,
    chromeAllowedDomains: ["p.com"],
    approvedToolNames: ["Bash"],
    cuAllowedApps: [
      { bundleId: "com.a", displayName: "A", grantedAt: 1 },
    ],
    cuGrantFlags: {
      clipboardRead: true,
      clipboardWrite: false,
      systemKeyCombos: false,
    },
    chromePermsBeforeUnsupervised: {
      mode: "ask" as const,
      domains: ["snap.com"],
    },
  };
  const picked = pickCoworkDispatchChildInheritedFields(parent);
  expect(picked).toEqual({
    chromePermissionMode: "follow_a_plan",
    chromeAllowedDomains: ["p.com"],
    approvedToolNames: ["Bash"],
    cuAllowedApps: [
      { bundleId: "com.a", displayName: "A", grantedAt: 1 },
    ],
    cuGrantFlags: {
      clipboardRead: true,
      clipboardWrite: false,
      systemKeyCombos: false,
    },
  });
  // shallow copy isolation
  parent.chromeAllowedDomains.push("mut.com");
  parent.approvedToolNames.push("Edit");
  parent.cuAllowedApps.push({
    bundleId: "com.b",
    displayName: "B",
    grantedAt: 2,
  });
  parent.cuGrantFlags.clipboardWrite = true;
  expect(picked.chromeAllowedDomains).toEqual(["p.com"]);
  expect(picked.approvedToolNames).toEqual(["Bash"]);
  expect(picked.cuAllowedApps).toEqual([
    { bundleId: "com.a", displayName: "A", grantedAt: 1 },
  ]);
  expect(picked.cuGrantFlags?.clipboardWrite).toBe(false);

  const child: CoworkChromePermissionFields & {
    approvedToolNames?: string[];
    cuAllowedApps?: Array<{
      bundleId: string;
      displayName: string;
      grantedAt: number;
    }>;
    cuGrantFlags?: {
      clipboardRead: boolean;
      clipboardWrite: boolean;
      systemKeyCombos: boolean;
    };
  } = {
    chromePermissionMode: "skip_all_permission_checks",
    chromeAllowedDomains: ["seed.com"],
  };
  applyCoworkDispatchChildStartInherit(child, parent);
  expect(child.chromePermissionMode).toBe("follow_a_plan");
  expect(child.chromeAllowedDomains).toEqual(["p.com", "mut.com"]);
  expect(child.approvedToolNames).toEqual(["Bash", "Edit"]);
  expect(child.cuAllowedApps).toEqual([
    { bundleId: "com.a", displayName: "A", grantedAt: 1 },
    { bundleId: "com.b", displayName: "B", grantedAt: 2 },
  ]);
  expect(child.cuGrantFlags).toEqual({
    clipboardRead: true,
    clipboardWrite: true,
    systemKeyCombos: false,
  });
  expect(child.chromePermsBeforeUnsupervised).toEqual({
    mode: "ask",
    domains: ["snap.com"],
  });
  // snapshot domain isolation
  parent.chromePermsBeforeUnsupervised.domains!.push("snap-mut.com");
  expect(child.chromePermsBeforeUnsupervised?.domains).toEqual(["snap.com"]);

  // missing parent fields leave child seed intact for that field
  const child2: CoworkChromePermissionFields = {
    chromePermissionMode: "ask",
    chromeAllowedDomains: ["keep.com"],
  };
  applyCoworkDispatchChildStartInherit(child2, {
    chromePermissionMode: "follow_a_plan",
  });
  expect(child2.chromePermissionMode).toBe("follow_a_plan");
  expect(child2.chromeAllowedDomains).toEqual(["keep.com"]);
  expect(child2.chromePermsBeforeUnsupervised).toBeUndefined();
});
