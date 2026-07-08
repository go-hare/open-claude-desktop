const CANONICAL_MODIFIER = {
  // Key::Meta — "meta"|"super"|"command"|"cmd"|"windows"|"win"
  meta: "meta",
  super: "meta",
  command: "meta",
  cmd: "meta",
  windows: "meta",
  win: "meta",
  // Key::Control + LControl + RControl
  ctrl: "ctrl",
  control: "ctrl",
  lctrl: "ctrl",
  lcontrol: "ctrl",
  rctrl: "ctrl",
  rcontrol: "ctrl",
  // Key::Shift + LShift + RShift
  shift: "shift",
  lshift: "shift",
  rshift: "shift",
  // Key::Alt and Key::Option — distinct Rust variants but same keycode on
  // darwin (kVK_Option). Collapse: cmd+alt+escape and cmd+option+escape
  // both Force Quit.
  alt: "alt",
  option: "alt"
};
const MODIFIER_ORDER = ["ctrl", "alt", "shift", "meta"];
const BLOCKED_DARWIN = /* @__PURE__ */ new Set([
  "meta+q",
  // Cmd+Q — quit frontmost app
  "shift+meta+q",
  // Cmd+Shift+Q — log out
  "alt+meta+escape",
  // Cmd+Option+Esc — Force Quit dialog
  "meta+tab",
  // Cmd+Tab — app switcher
  "meta+space",
  // Cmd+Space — Spotlight
  "ctrl+meta+q"
  // Ctrl+Cmd+Q — lock screen
]);
const BLOCKED_WIN32 = /* @__PURE__ */ new Set([
  "ctrl+alt+delete",
  // Secure Attention Sequence
  "alt+f4",
  // close window
  "alt+tab",
  // window switcher
  "meta+l",
  // Win+L — lock
  "meta+d"
  // Win+D — show desktop
]);
function partitionKeys(seq) {
  const parts = seq.toLowerCase().split("+").map((p) => p.trim()).filter(Boolean);
  const mods = [];
  const keys = [];
  for (const p of parts) {
    const canonical = CANONICAL_MODIFIER[p];
    if (canonical !== void 0) {
      mods.push(canonical);
    } else {
      keys.push(p);
    }
  }
  const uniqueMods = [...new Set(mods)];
  uniqueMods.sort(
    (a, b) => MODIFIER_ORDER.indexOf(a) - MODIFIER_ORDER.indexOf(b)
  );
  return { mods: uniqueMods, keys };
}
function normalizeKeySequence(seq) {
  const { mods, keys } = partitionKeys(seq);
  return [...mods, ...keys].join("+");
}
function isSystemKeyCombo(seq, platform) {
  const blocklist = platform === "darwin" ? BLOCKED_DARWIN : BLOCKED_WIN32;
  const { mods, keys } = partitionKeys(seq);
  const prefix = mods.length > 0 ? mods.join("+") + "+" : "";
  if (keys.length === 0) {
    return blocklist.has(mods.join("+"));
  }
  for (const key of keys) {
    if (blocklist.has(prefix + key)) {
      return true;
    }
  }
  return false;
}
const _test = {
  CANONICAL_MODIFIER,
  BLOCKED_DARWIN,
  BLOCKED_WIN32,
  MODIFIER_ORDER
};
export {
  _test,
  isSystemKeyCombo,
  normalizeKeySequence
};
