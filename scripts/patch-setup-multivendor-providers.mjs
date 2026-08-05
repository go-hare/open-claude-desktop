/**
 * Product multi-vendor residual for setup-desktop-3p Connection grid.
 *
 * Official ion-dist only exposes gateway/bedrock/vertex/foundry.
 * Product CLI (custom3pCliEnv) also supports openai/gemini/grok modelTypes —
 * this re-applies the matching setup residual UI + bag fields after every
 * `sync:ion-dist` (resources/ion-dist is gitignored and wiped by sync).
 *
 * Idempotent. Safe to re-run.
 *
 * Fields align with electron/main/services/custom3p/custom3pCliEnv.ts:
 *   inferenceOpenAIBaseUrl / inferenceOpenAIApiKey  → OPENAI_*
 *   inferenceGeminiBaseUrl / inferenceGeminiApiKey  → GEMINI_*
 *   inferenceGrokBaseUrl / inferenceGrokApiKey      → GROK_*
 */
import fs from "node:fs";
import path from "node:path";
import { getProjectRoot } from "./originalAppPaths.mjs";

const root = getProjectRoot();
const SETUP = path.join(root, "resources/ion-dist/assets/v1/c71860c77-BOaDa5w5.js");
const INDEX = path.join(root, "resources/ion-dist/assets/v1/index-BELzQL5P.js");

const OLD_KEYS =
  '$e=Object.keys({gateway:"Gateway",bedrock:"Bedrock",vertex:"Vertex",foundry:"Foundry"})';
const NEW_KEYS =
  '$e=Object.keys({gateway:"Gateway",bedrock:"Bedrock",vertex:"Vertex",foundry:"Foundry",' +
  'openai:"OpenAI",gemini:"Gemini",grok:"Grok"})';

const OLD_SCHEMA_ANCHOR =
  'inferenceFoundryApiKey:Ye(r().optional(),{scopes:["3p","3p-bootstrap"],' +
  'provider:"foundry",title:"Azure AI Foundry API key",sensitive:!0}),inferenceModels:';
const NEW_SCHEMA_FIELDS =
  'inferenceFoundryApiKey:Ye(r().optional(),{scopes:["3p","3p-bootstrap"],' +
  'provider:"foundry",title:"Azure AI Foundry API key",sensitive:!0}),' +
  'inferenceOpenAIBaseUrl:Ye(We.optional(),{scopes:["3p","3p-bootstrap"],provider:"openai",' +
  'title:"OpenAI base URL",sensitive:"hostname",' +
  'egressRequirements:(e,t)=>{if("openai"!==t.inferenceProvider)return[];const r=C(e);return r?[r]:[]}}),' +
  'inferenceOpenAIApiKey:Ye(r().optional(),{scopes:["3p","3p-bootstrap"],provider:"openai",' +
  'title:"OpenAI API key",sensitive:!0}),' +
  'inferenceGeminiBaseUrl:Ye(We.optional(),{scopes:["3p","3p-bootstrap"],provider:"gemini",' +
  'title:"Gemini base URL",sensitive:"hostname",' +
  'egressRequirements:(e,t)=>{if("gemini"!==t.inferenceProvider)return[];const r=C(e);return r?[r]:[]}}),' +
  'inferenceGeminiApiKey:Ye(r().optional(),{scopes:["3p","3p-bootstrap"],provider:"gemini",' +
  'title:"Gemini API key",sensitive:!0}),' +
  'inferenceGrokBaseUrl:Ye(We.optional(),{scopes:["3p","3p-bootstrap"],provider:"grok",' +
  'title:"Grok base URL",sensitive:"hostname",' +
  'egressRequirements:(e,t)=>{if("grok"!==t.inferenceProvider)return[];const r=C(e);return r?[r]:[]}}),' +
  'inferenceGrokApiKey:Ye(r().optional(),{scopes:["3p","3p-bootstrap"],provider:"grok",' +
  'title:"Grok API key",sensitive:!0}),' +
  "inferenceModels:";

const OLD_UT_ANCHOR =
  'inferenceFoundryApiKey:{category:"connection",required:e=>!dt("inferenceCredentialHelper",e)&&!ct(e)},' +
  'inferenceCredentialHelper:{category:"connection",group:"Identity & models",order:2,';
const NEW_UT =
  'inferenceFoundryApiKey:{category:"connection",required:e=>!dt("inferenceCredentialHelper",e)&&!ct(e)},' +
  'inferenceOpenAIBaseUrl:{category:"connection",required:e=>!ct(e),' +
  'placeholder:"https://api.openai.com/v1",hint:"OpenAI-compatible API base URL (native openai client)."},' +
  'inferenceOpenAIApiKey:{category:"connection",required:e=>!dt("inferenceCredentialHelper",e)&&!ct(e)},' +
  'inferenceGeminiBaseUrl:{category:"connection",placeholder:"https://generativelanguage.googleapis.com",' +
  'hint:"Optional Gemini API base URL override."},' +
  'inferenceGeminiApiKey:{category:"connection",required:e=>!dt("inferenceCredentialHelper",e)&&!ct(e)},' +
  'inferenceGrokBaseUrl:{category:"connection",placeholder:"https://api.x.ai/v1",' +
  'hint:"Optional Grok / xAI API base URL override."},' +
  'inferenceGrokApiKey:{category:"connection",required:e=>!dt("inferenceCredentialHelper",e)&&!ct(e)},' +
  'inferenceCredentialHelper:{category:"connection",group:"Identity & models",order:2,';

const OLD_KQT =
  'const kQt=ge({gateway:{defaultMessage:"Gateway",id:"pMcQckggwt"},' +
  'bedrock:{defaultMessage:"Bedrock",id:"voYGE9Q356"},' +
  'vertex:{defaultMessage:"Vertex",id:"Iu7EbVgyNK"},' +
  'foundry:{defaultMessage:"Foundry",id:"wRHZIadJ0A"}}),' +
  '_Qt=ge({gateway:{defaultMessage:"Anthropic-compatible",id:"WHcySsrbNk"},' +
  'bedrock:{defaultMessage:"AWS",id:"3dX6WT/wMl"},' +
  'vertex:{defaultMessage:"Google Cloud",id:"QlBsxMNFtc"},' +
  'foundry:{defaultMessage:"Azure AI",id:"enhYetyVgl"}})';
const NEW_KQT =
  'const kQt=ge({gateway:{defaultMessage:"Gateway",id:"pMcQckggwt"},' +
  'bedrock:{defaultMessage:"Bedrock",id:"voYGE9Q356"},' +
  'vertex:{defaultMessage:"Vertex",id:"Iu7EbVgyNK"},' +
  'foundry:{defaultMessage:"Foundry",id:"wRHZIadJ0A"},' +
  'openai:{defaultMessage:"OpenAI",id:"setupProv.openai"},' +
  'gemini:{defaultMessage:"Gemini",id:"setupProv.gemini"},' +
  'grok:{defaultMessage:"Grok",id:"setupProv.grok"}}),' +
  '_Qt=ge({gateway:{defaultMessage:"Anthropic-compatible",id:"WHcySsrbNk"},' +
  'bedrock:{defaultMessage:"AWS",id:"3dX6WT/wMl"},' +
  'vertex:{defaultMessage:"Google Cloud",id:"QlBsxMNFtc"},' +
  'foundry:{defaultMessage:"Azure AI",id:"enhYetyVgl"},' +
  'openai:{defaultMessage:"OpenAI-compatible",id:"setupProv.openai.sub"},' +
  'gemini:{defaultMessage:"Google AI",id:"setupProv.gemini.sub"},' +
  'grok:{defaultMessage:"xAI",id:"setupProv.grok.sub"}})';

const MSG_EN = {
  "setupProv.openai": "OpenAI",
  "setupProv.gemini": "Gemini",
  "setupProv.grok": "Grok",
  "setupProv.openai.sub": "OpenAI-compatible",
  "setupProv.gemini.sub": "Google AI",
  "setupProv.grok.sub": "xAI",
};
const MSG_ZH = {
  "setupProv.openai": "OpenAI",
  "setupProv.gemini": "Gemini",
  "setupProv.grok": "Grok",
  "setupProv.openai.sub": "OpenAI 兼容",
  "setupProv.gemini.sub": "Google AI",
  "setupProv.grok.sub": "xAI",
};

function replaceOnce(text, old, neu, label, file) {
  if (!text.includes(old)) {
    throw new Error(`${label} not found in ${file}`);
  }
  return text.replace(old, neu);
}

function patchSetup(filePath) {
  if (!fs.existsSync(filePath)) {
    console.warn("setup skip (missing):", filePath);
    return;
  }
  let t = fs.readFileSync(filePath, "utf8");
  if (t.includes('openai:"OpenAI"') && t.includes("inferenceOpenAIBaseUrl")) {
    console.log("setup already patched", filePath);
    return;
  }
  t = replaceOnce(t, OLD_KEYS, NEW_KEYS, "provider keys ($e)", filePath);
  t = replaceOnce(t, OLD_SCHEMA_ANCHOR, NEW_SCHEMA_FIELDS, "schema anchor", filePath);
  t = replaceOnce(t, OLD_UT_ANCHOR, NEW_UT, "ut form meta", filePath);
  fs.writeFileSync(filePath, t, "utf8");
  console.log("patched setup", filePath);
}

function patchIndex(filePath) {
  if (!fs.existsSync(filePath)) {
    console.warn("index skip (missing):", filePath);
    return;
  }
  let t = fs.readFileSync(filePath, "utf8");
  if (t.includes("setupProv.openai") || t.includes("cldxKQtOpenAI")) {
    console.log("index already multi-vendor", filePath);
    return;
  }
  t = replaceOnce(t, OLD_KQT, NEW_KQT, "kQt/_Qt", filePath);
  fs.writeFileSync(filePath, t, "utf8");
  console.log("patched index", filePath);
}

function patchI18nJson(filePath, bag) {
  if (!fs.existsSync(filePath)) return;
  const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
  Object.assign(data, bag);
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  console.log("i18n", path.relative(root, filePath));
}

function patchI18n() {
  patchI18nJson(path.join(root, "resources/ion-dist/i18n/en-US.json"), MSG_EN);
  patchI18nJson(path.join(root, "resources/ion-dist/i18n/zh-CN.json"), MSG_ZH);
  patchI18nJson(path.join(root, "resources/ion-dist/i18n/zh-CN.overrides.json"), MSG_ZH);

  // product-web public copies when present (optional mirror)
  const webRoot = path.join(root, "..", "open-claude-web");
  for (const [rel, bag] of [
    ["public/i18n/en-US.json", MSG_EN],
    ["public/i18n/zh-CN.json", MSG_ZH],
    ["public/i18n/zh-CN.overrides.json", MSG_ZH],
  ]) {
    patchI18nJson(path.join(webRoot, rel), bag);
  }
}

function main() {
  patchSetup(SETUP);
  patchIndex(INDEX);
  // optional web residual copies
  const webSetup = path.join(root, "..", "open-claude-web", "public/assets/v1/c71860c77-BOaDa5w5.js");
  const webIndex = path.join(root, "..", "open-claude-web", "public/assets/v1/index-BELzQL5P.js");
  try {
    patchSetup(webSetup);
  } catch (e) {
    console.warn("web setup skip:", e.message);
  }
  try {
    patchIndex(webIndex);
  } catch (e) {
    console.warn("web index skip:", e.message);
  }
  patchI18n();

  const t = fs.readFileSync(SETUP, "utf8");
  if (!t.includes('openai:"OpenAI"') || !t.includes("inferenceOpenAIBaseUrl") || !t.includes("inferenceGrokApiKey")) {
    throw new Error("setup patch sanity failed");
  }
  const idx = fs.readFileSync(INDEX, "utf8");
  if (!idx.includes("setupProv.openai") && !idx.includes("cldxKQtOpenAI")) {
    throw new Error("index patch sanity failed");
  }
  console.log("OK multi-vendor setup providers");
}

main();
