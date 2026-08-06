#!/usr/bin/env node
/**
 * Enterprise bag (QB / Ti residual) consumption audit.
 *
 * Scans product main sources against Setup SPA field list + optional official
 * asar dump. Verdicts are derived from live wiring signals — never hardcode
 * MISS for residual keys that already have runtime consumers.
 *
 * Usage:
 *   node scripts/audit-enterprise-bag-consumption.mjs
 *   node scripts/audit-enterprise-bag-consumption.mjs --json out.json
 *
 * Exit: 0 always (report tool). Use --fail-on-miss to exit 1 when any MISS.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const productRoot = path.join(root, "electron", "main");

const args = process.argv.slice(2);
const jsonOutIdx = args.indexOf("--json");
const jsonOut =
  jsonOutIdx >= 0
    ? path.resolve(args[jsonOutIdx + 1] || path.join(root, ".tmp-consumption-matrix.json"))
    : null;
const failOnMiss = args.includes("--fail-on-miss");

function findFirstExisting(candidates) {
  for (const c of candidates) {
    const p = path.isAbsolute(c) ? c : path.join(root, c);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

const setupPath = findFirstExisting([
  "resources/ion-dist/assets/v1/c71860c77-BOaDa5w5.js",
  // fallback: any setup-ish chunk that lists inferenceProvider
]);
const officialPath = findFirstExisting([
  ".tmp-asar-main/index.js",
  "index.js",
]);

function walk(dir, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (ent.name === "node_modules" || ent.name === "dist") continue;
      walk(p, acc);
    } else if (
      /\.(ts|tsx|js|mjs)$/.test(ent.name) &&
      !ent.name.endsWith(".test.ts") &&
      !ent.name.includes(".verify.")
    ) {
      acc.push(p);
    }
  }
  return acc;
}

/** Prefer the Setup SPA chunk that actually lists enterprise bag keys. */
function loadSetupText() {
  if (setupPath) return fs.readFileSync(setupPath, "utf8");
  const assetsDir = path.join(root, "resources", "ion-dist", "assets", "v1");
  if (!fs.existsSync(assetsDir)) return "";
  for (const name of fs.readdirSync(assetsDir)) {
    if (!name.endsWith(".js")) continue;
    const p = path.join(assetsDir, name);
    const t = fs.readFileSync(p, "utf8");
    if (t.includes("inferenceCredentialHelper") && t.includes("bootstrapOidc")) {
      return t;
    }
  }
  return "";
}

const setup = loadSetupText();
const official = officialPath ? fs.readFileSync(officialPath, "utf8") : "";
const productFiles = walk(productRoot);
const fileText = new Map(productFiles.map((f) => [f, fs.readFileSync(f, "utf8")]));
const productText = [...fileText.values()].join("\n");

function rel(f) {
  return path.relative(productRoot, f).replace(/\\/g, "/");
}

function filesWith(...needles) {
  return productFiles
    .filter((f) => {
      const t = fileText.get(f);
      return needles.every((n) => t.includes(n));
    })
    .map(rel);
}

function anyFile(...needles) {
  return filesWith(...needles).length > 0;
}

function countOcc(hay, needle) {
  if (!hay || !needle) return 0;
  let n = 0;
  let i = 0;
  while (true) {
    const j = hay.indexOf(needle, i);
    if (j < 0) break;
    n++;
    i = j + needle.length;
  }
  return n;
}

/** Official Setup / MDM bag keys (QB residual). */
const QB = [
  "isDesktopExtensionEnabled",
  "isDesktopExtensionDirectoryEnabled",
  "isDesktopExtensionSignatureRequired",
  "isLocalDevMcpEnabled",
  "isClaudeCodeForDesktopEnabled",
  "secureVmFeaturesEnabled",
  "requireCoworkFullVmSandbox",
  "coworkEgressAllowedHosts",
  "otlpEndpoint",
  "otlpProtocol",
  "otlpHeaders",
  "otlpResourceAttributes",
  "autoUpdaterEnforcementHours",
  "disableAutoUpdates",
  "disableDeploymentModeChooser",
  "forceLoginOrgUUID",
  "inferenceProvider",
  "inferenceGatewayBaseUrl",
  "inferenceGatewayApiKey",
  "inferenceGatewayAuthScheme",
  "inferenceGatewayHeaders",
  "inferenceVertexProjectId",
  "inferenceVertexRegion",
  "inferenceVertexCredentialsFile",
  "inferenceVertexOAuthClientId",
  "inferenceVertexOAuthClientSecret",
  "inferenceVertexOAuthScopes",
  "inferenceVertexBaseUrl",
  "inferenceBedrockRegion",
  "inferenceBedrockBearerToken",
  "inferenceBedrockBaseUrl",
  "inferenceBedrockProfile",
  "inferenceBedrockAwsDir",
  "inferenceBedrockSsoStartUrl",
  "inferenceBedrockSsoRegion",
  "inferenceBedrockSsoAccountId",
  "inferenceBedrockSsoRoleName",
  "inferenceBedrockServiceTier",
  "inferenceFoundryResource",
  "inferenceFoundryApiKey",
  "inferenceModels",
  "deploymentOrganizationUuid",
  "disableEssentialTelemetry",
  "disableNonessentialTelemetry",
  "disableNonessentialServices",
  "managedMcpServers",
  "disabledBuiltinTools",
  "allowedWorkspaceFolders",
  "inferenceCredentialHelper",
  "inferenceCredentialHelperTtlSec",
  "bootstrapEnabled",
  "bootstrapUrl",
  "bootstrapOidc",
  "inferenceMaxTokensPerWindow",
  "inferenceTokenWindowHours",
  // product multi-vendor extensions (not official QB)
  "inferenceOpenAIBaseUrl",
  "inferenceOpenAIApiKey",
  "inferenceGeminiBaseUrl",
  "inferenceGeminiApiKey",
  "inferenceGrokBaseUrl",
  "inferenceGrokApiKey",
];

const PRODUCT_EXT = new Set([
  "inferenceOpenAIBaseUrl",
  "inferenceOpenAIApiKey",
  "inferenceGeminiBaseUrl",
  "inferenceGeminiApiKey",
  "inferenceGrokBaseUrl",
  "inferenceGrokApiKey",
]);

const CATEGORY = {
  gates: [
    "isDesktopExtensionEnabled",
    "isDesktopExtensionDirectoryEnabled",
    "isDesktopExtensionSignatureRequired",
    "isLocalDevMcpEnabled",
    "isClaudeCodeForDesktopEnabled",
    "secureVmFeaturesEnabled",
    "requireCoworkFullVmSandbox",
    "disableDeploymentModeChooser",
    "disableNonessentialServices",
    "disableAutoUpdates",
    "autoUpdaterEnforcementHours",
  ],
  connection: [
    "inferenceProvider",
    "inferenceGatewayBaseUrl",
    "inferenceGatewayApiKey",
    "inferenceGatewayAuthScheme",
    "inferenceGatewayHeaders",
    "inferenceVertexProjectId",
    "inferenceVertexRegion",
    "inferenceVertexCredentialsFile",
    "inferenceVertexOAuthClientId",
    "inferenceVertexOAuthClientSecret",
    "inferenceVertexOAuthScopes",
    "inferenceVertexBaseUrl",
    "inferenceBedrockRegion",
    "inferenceBedrockBearerToken",
    "inferenceBedrockBaseUrl",
    "inferenceBedrockProfile",
    "inferenceBedrockAwsDir",
    "inferenceBedrockSsoStartUrl",
    "inferenceBedrockSsoRegion",
    "inferenceBedrockSsoAccountId",
    "inferenceBedrockSsoRoleName",
    "inferenceBedrockServiceTier",
    "inferenceFoundryResource",
    "inferenceFoundryApiKey",
    "inferenceModels",
    "inferenceCredentialHelper",
    "inferenceCredentialHelperTtlSec",
    "bootstrapEnabled",
    "bootstrapUrl",
    "bootstrapOidc",
  ],
  policy: [
    "forceLoginOrgUUID",
    "deploymentOrganizationUuid",
    "disabledBuiltinTools",
    "allowedWorkspaceFolders",
    "coworkEgressAllowedHosts",
    "managedMcpServers",
    "inferenceMaxTokensPerWindow",
    "inferenceTokenWindowHours",
    "disableEssentialTelemetry",
    "disableNonessentialTelemetry",
  ],
  otlp: [
    "otlpEndpoint",
    "otlpProtocol",
    "otlpHeaders",
    "otlpResourceAttributes",
  ],
  product_ext: [...PRODUCT_EXT],
};

function officialStrength(key) {
  if (PRODUCT_EXT.has(key)) return { strength: "PRODUCT_ONLY", n: 0 };
  const n = countOcc(official, key);
  if (!official) return { strength: "NO_ASAR", n: 0 };
  if (n === 0) return { strength: "NONE", n: 0 };
  if (n >= 3) return { strength: "STRONG", n };
  if (n >= 1) return { strength: "HIT", n };
  return { strength: "WEAK", n };
}

/**
 * Live wiring probes. Each returns { role, verdict, note? }.
 * Prefer concrete consumer symbols over mere QB key presence.
 */
function classify(key) {
  const hits = filesWith(key);

  if (PRODUCT_EXT.has(key)) {
    const ok =
      productText.includes(key) &&
      (productText.includes("buildClaudeCliSpawnEnv") ||
        productText.includes("custom3pEnterpriseConfigFromUnknown") ||
        productText.includes("ANTHROPIC_BASE_URL"));
    return {
      role: "PRODUCT_EXT",
      verdict: ok ? "PRODUCT_EXT_OK" : "PRODUCT_EXT_MISS",
      files: hits,
    };
  }

  // --- Interactive auth residual ---
  if (key.startsWith("inferenceVertexOAuth")) {
    const ok =
      anyFile("enterpriseVertexAuth") ||
      anyFile("needsVertexInteractiveAuth") ||
      anyFile("triggerEnterpriseInteractiveAuth", "vertex");
    return {
      role: "INTERACTIVE_AUTH",
      verdict: ok ? "OK" : "MISS",
      files: hits,
      note: ok ? "vertex PKCE residual" : "no vertex auth consumer",
    };
  }
  if (key.startsWith("inferenceBedrockSso")) {
    const ok =
      anyFile("enterpriseBedrockSsoAuth") ||
      anyFile("needsBedrockSsoInteractiveAuth");
    return {
      role: "INTERACTIVE_AUTH",
      verdict: ok ? "OK" : "MISS",
      files: hits,
      note: ok ? "bedrock SSO residual" : "no bedrock sso consumer",
    };
  }
  if (key === "bootstrapOidc") {
    const ok =
      anyFile("enterpriseBootstrapOidc") ||
      anyFile("triggerEnterpriseBootstrapAuth");
    return {
      role: "INTERACTIVE_AUTH",
      verdict: ok ? "OK" : "MISS",
      files: hits,
    };
  }
  if (key === "inferenceCredentialHelper" || key === "inferenceCredentialHelperTtlSec") {
    const ok =
      anyFile("runEnterpriseCredentialHelperWithTtl") &&
      anyFile("credentialHelperTokenToSpawnEnv");
    return {
      role: "CLI_ENV_HELPER",
      verdict: ok ? "OK" : "MISS",
      files: hits,
    };
  }

  // --- Token cap ---
  if (key === "inferenceMaxTokensPerWindow" || key === "inferenceTokenWindowHours") {
    const ok =
      anyFile("assertEnterpriseTokenCapAllowsTurn") ||
      anyFile("coworkTokenCap");
    return {
      role: "TOKEN_CAP",
      verdict: ok ? "OK" : "MISS",
      files: hits,
    };
  }

  // --- Nonessential services ---
  if (key === "disableNonessentialServices") {
    const ok =
      anyFile("isEnterpriseNonessentialServicesDisabled") ||
      anyFile("installEnterpriseNonessentialNetworkGate") ||
      anyFile("enterpriseNonessentialGate");
    return {
      role: "NETWORK_GATE",
      verdict: ok ? "OK" : "MISS",
      files: hits,
    };
  }

  // --- OTLP ---
  if (
    key === "otlpEndpoint" ||
    key === "otlpProtocol" ||
    key === "otlpHeaders" ||
    key === "otlpResourceAttributes"
  ) {
    const ok =
      anyFile("resolveEnterpriseOtlpConfig") &&
      productText.includes("OTEL_EXPORTER_OTLP_ENDPOINT");
    return {
      role: "CLI_ENV_OTLP",
      verdict: ok ? "OK" : "MISS",
      files: hits,
      note: ok ? "enterprise OTLP → spawn env" : "no OTEL inject",
    };
  }

  // --- Egress / tools / workspace ---
  if (key === "coworkEgressAllowedHosts") {
    const ok =
      anyFile("resolveEnterpriseVmEgressPolicy") &&
      (anyFile("getVmEgressPolicy") || productText.includes("getVmEgressPolicy"));
    return {
      role: "VM_EGRESS",
      verdict: ok ? "OK" : "MISS",
      files: hits,
    };
  }
  if (key === "disabledBuiltinTools") {
    const ok =
      productText.includes("disabledBuiltinTools") &&
      productText.includes("disallowedTools");
    return {
      role: "TOOL_POLICY",
      verdict: ok ? "OK" : "MISS",
      files: hits,
    };
  }
  if (key === "allowedWorkspaceFolders") {
    const ok =
      productText.includes("allowedWorkspaceFolders") &&
      (productText.includes("getCoworkEnterprise") ||
        productText.includes("resolveEnterprise") ||
        productText.includes("enterpriseConfig"));
    return {
      role: "WORKSPACE_POLICY",
      verdict: ok ? "OK" : "PARTIAL",
      files: hits,
    };
  }
  if (key === "managedMcpServers") {
    const ok = anyFile("managedMcpServersFromEnterprise");
    return {
      role: "RUNTIME_MCP",
      verdict: ok ? "OK" : "MISS",
      files: hits,
    };
  }

  // --- Identity / org ---
  if (key === "forceLoginOrgUUID") {
    const parsed = anyFile("resolveEnterpriseForceLoginOrgUUIDs");
    const exposed =
      productText.includes("forceLoginOrgUUIDs") &&
      productText.includes("custom3pStatus");
    // Main-process hard reject is intentionally incomplete (1p OAuth not invented).
    const hardEnforce = productFiles.some((f) => {
      const t = fileText.get(f);
      const r = rel(f);
      if (r.includes("coworkEnterpriseConfig") || r.includes("custom3pStatus")) {
        return false;
      }
      return (
        t.includes("forceLoginOrgUUIDs") &&
        /(includes|Set\(|reject|block|mismatch|allowedOrgs)/i.test(t)
      );
    });
    if (parsed && exposed && hardEnforce) {
      return { role: "ORG_POLICY", verdict: "OK", files: hits, note: "parse+status+enforce" };
    }
    if (parsed && exposed) {
      return {
        role: "ORG_POLICY",
        verdict: "PARTIAL",
        files: hits,
        note: "parse+status; SPA org filter; no main hard-enforce (1p OAuth not invented)",
      };
    }
    return { role: "ORG_POLICY", verdict: "MISS", files: hits };
  }
  if (key === "deploymentOrganizationUuid") {
    const ok =
      anyFile("resolveEnterpriseDeploymentOrganizationUuid") ||
      (productText.includes("deploymentOrganizationUuid") &&
        productText.includes("OTEL_RESOURCE_ATTRIBUTES"));
    return {
      role: "ORG_TELEMETRY",
      verdict: ok ? "OK" : "MISS",
      files: hits,
    };
  }

  // --- Deploy / health ---
  if (
    key === "bootstrapEnabled" ||
    key === "bootstrapUrl" ||
    key === "disableDeploymentModeChooser"
  ) {
    const ok =
      productText.includes("resolveDeploymentMode") ||
      productText.includes(key);
    return {
      role: "DEPLOY_HEALTH",
      verdict: ok ? "OK" : "MISS",
      files: hits,
    };
  }

  // --- Gates ---
  if (key === "requireCoworkFullVmSandbox") {
    const ok =
      productText.includes("requireCoworkFullVmSandbox") &&
      (productText.includes("hostLoopMode") ||
        productText.includes("createCoworkHostLoopModeResolver"));
    return { role: "RUNTIME_POLICY", verdict: ok ? "OK" : "MISS", files: hits };
  }
  if (key === "isClaudeCodeForDesktopEnabled") {
    const ok =
      productText.includes("isClaudeCodeForDesktopEnterpriseDisabled") ||
      productText.includes("isClaudeCodeForDesktopEnabled");
    return { role: "RUNTIME_POLICY", verdict: ok ? "OK" : "MISS", files: hits };
  }
  if (key === "secureVmFeaturesEnabled") {
    const ok =
      productText.includes("isSecureVmFeaturesEnterpriseDisabled") ||
      productText.includes("secureVmFeaturesEnabled");
    return { role: "RUNTIME_POLICY", verdict: ok ? "OK" : "MISS", files: hits };
  }
  if (key === "isDesktopExtensionDirectoryEnabled") {
    const ok =
      productText.includes("isDesktopExtensionDirectoryEnabledResidual") ||
      productText.includes("isDesktopExtensionDirectoryEnabled");
    return { role: "RUNTIME_GATE", verdict: ok ? "OK" : "MISS", files: hits };
  }
  if (
    key === "isDesktopExtensionEnabled" ||
    key === "isDesktopExtensionSignatureRequired"
  ) {
    const ok =
      productText.includes(key) &&
      (productText.includes("getCoworkEnterprise") ||
        productText.includes("extensionEnableGates") ||
        productText.includes("enterprise"));
    return { role: "QB_OR_GATE", verdict: ok ? "OK" : "PARTIAL", files: hits };
  }
  if (key === "isLocalDevMcpEnabled") {
    const ok =
      anyFile("resolveIsLocalDevMcpEnabled") ||
      (productText.includes("isLocalDevMcpEnabled") &&
        productText.includes("localDevMcpPolicy"));
    return {
      role: "SETTINGS_OR_BAG",
      verdict: ok ? "OK" : "PARTIAL",
      files: hits,
    };
  }
  if (key === "disableAutoUpdates" || key === "autoUpdaterEnforcementHours") {
    // 3p always DISABLE_AUTOUPDATER=1; bag may still not drive updater UI.
    const bagDrivesUpdater = productFiles.some((f) => {
      const t = fileText.get(f);
      return (
        t.includes(key) &&
        (t.includes("autoUpdater") ||
          t.includes("checkForUpdates") ||
          t.includes("setFeedURL"))
      );
    });
    const spawnDisables = productText.includes("DISABLE_AUTOUPDATER");
    if (bagDrivesUpdater) {
      return { role: "UPDATER", verdict: "OK", files: hits };
    }
    if (spawnDisables) {
      return {
        role: "UPDATER",
        verdict: "PARTIAL",
        files: hits,
        note: "3p spawn DISABLE_AUTOUPDATER; bag hours not full updater residual",
      };
    }
    return { role: "UPDATER", verdict: "MISS", files: hits };
  }

  // --- Telemetry flags ---
  if (
    key === "disableEssentialTelemetry" ||
    key === "disableNonessentialTelemetry"
  ) {
    const ok =
      productText.includes(key) &&
      (productText.includes("DISABLE_TELEMETRY") ||
        productText.includes("DISABLE_ERROR_REPORTING") ||
        productText.includes("telemetry"));
    return {
      role: "TELEMETRY",
      verdict: ok ? "OK" : hits.length ? "PARTIAL" : "MISS",
      files: hits,
    };
  }

  // --- Core CLI env / provider fields ---
  const cliEnvKeys = new Set([
    "inferenceProvider",
    "inferenceGatewayBaseUrl",
    "inferenceGatewayApiKey",
    "inferenceGatewayAuthScheme",
    "inferenceGatewayHeaders",
    "inferenceVertexProjectId",
    "inferenceVertexRegion",
    "inferenceVertexCredentialsFile",
    "inferenceVertexBaseUrl",
    "inferenceBedrockRegion",
    "inferenceBedrockBearerToken",
    "inferenceBedrockBaseUrl",
    "inferenceBedrockProfile",
    "inferenceBedrockAwsDir",
    "inferenceBedrockServiceTier",
    "inferenceFoundryResource",
    "inferenceFoundryApiKey",
    "inferenceModels",
  ]);
  if (cliEnvKeys.has(key)) {
    const ok =
      productText.includes("buildClaudeCliSpawnEnv") &&
      (productText.includes(key) ||
        productText.includes("custom3pEnterpriseConfigFromUnknown"));
    return {
      role: "CLI_ENV",
      verdict: ok ? "OK" : "MISS",
      files: hits,
    };
  }

  // Fallback: named in enterprise config + any consumer beyond list/bridge
  if (hits.length === 0) {
    return { role: "NONE", verdict: "MISS", files: hits };
  }
  const onlyList = hits.every(
    (f) =>
      f.includes("coworkEnterpriseConfig") ||
      f.includes("dotClaudeSetupBridge") ||
      f.includes("custom3pConfigLibrary"),
  );
  if (onlyList) {
    return {
      role: "QB_NAMED_ONLY",
      verdict: "MISS",
      files: hits,
      note: "listed in bag schema but no runtime consumer found",
    };
  }
  return {
    role: "BAG_MISC",
    verdict: "PARTIAL",
    files: hits,
    note: "present but no dedicated probe",
  };
}

const rows = [];
for (const key of QB) {
  const off = officialStrength(key);
  const cls = classify(key);
  const form = setup.includes(key) ? "Y" : "N";
  rows.push({
    key,
    form,
    official: `${off.strength}${off.n ? `(${off.n})` : ""}`,
    product: cls.role,
    files: (cls.files || []).slice(0, 6).join(" | "),
    verdict: cls.verdict,
    note: cls.note || "",
  });
}

const counts = {};
for (const r of rows) counts[r.verdict] = (counts[r.verdict] || 0) + 1;

console.log("=== ENTERPRISE BAG CONSUMPTION (live wiring) ===");
console.log("setup:", setupPath || "(auto/missing)");
console.log("official asar:", officialPath || "(missing)");
console.log("product files:", productFiles.length);
console.log("\n=== COUNTS ===");
console.log(counts);
console.log("TOTAL", rows.length);

for (const [cat, keys] of Object.entries(CATEGORY)) {
  console.log("\n## " + cat.toUpperCase());
  for (const key of keys) {
    const r = rows.find((x) => x.key === key);
    if (!r) continue;
    const note = r.note ? ` — ${r.note}` : "";
    console.log(
      `${r.verdict.padEnd(16)} ${r.key.padEnd(42)} form=${r.form} off=${String(r.official).padEnd(16)} prod=${r.product}${note}`,
    );
  }
}

const gaps = rows.filter(
  (r) => r.verdict === "MISS" || r.verdict.startsWith("PARTIAL"),
);
console.log("\n=== MISS / PARTIAL DETAIL ===");
if (!gaps.length) {
  console.log("(none)");
} else {
  for (const r of gaps) {
    console.log(
      `${r.verdict} | ${r.key} | off=${r.official} | prod=${r.product} | ${r.note || r.files}`,
    );
  }
}

if (jsonOut) {
  fs.writeFileSync(
    jsonOut,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        setupPath: setupPath,
        officialPath: officialPath,
        counts,
        rows,
      },
      null,
      2,
    ),
  );
  console.log("\nwrote", jsonOut);
}

if (failOnMiss && rows.some((r) => r.verdict === "MISS")) {
  process.exit(1);
}
