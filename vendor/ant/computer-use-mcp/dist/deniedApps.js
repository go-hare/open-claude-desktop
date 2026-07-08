function categoryToTier(category) {
  if (category === "browser" || category === "trading") return "read";
  if (category === "terminal") return "click";
  return "full";
}
const BROWSER_BUNDLE_IDS = /* @__PURE__ */ new Set([
  // Apple
  "com.apple.Safari",
  "com.apple.SafariTechnologyPreview",
  // Google
  "com.google.Chrome",
  "com.google.Chrome.beta",
  "com.google.Chrome.dev",
  "com.google.Chrome.canary",
  // Microsoft
  "com.microsoft.edgemac",
  "com.microsoft.edgemac.Beta",
  "com.microsoft.edgemac.Dev",
  "com.microsoft.edgemac.Canary",
  // Mozilla
  "org.mozilla.firefox",
  "org.mozilla.firefoxdeveloperedition",
  "org.mozilla.nightly",
  // Chromium-based
  "org.chromium.Chromium",
  "com.brave.Browser",
  "com.brave.Browser.beta",
  "com.brave.Browser.nightly",
  "com.operasoftware.Opera",
  "com.operasoftware.OperaGX",
  "com.operasoftware.OperaDeveloper",
  "com.vivaldi.Vivaldi",
  // The Browser Company
  "company.thebrowser.Browser",
  // Arc
  "company.thebrowser.dia",
  // Dia (agentic)
  // Privacy-focused
  "org.torproject.torbrowser",
  "com.duckduckgo.macos.browser",
  "ru.yandex.desktop.yandex-browser",
  // Agentic / AI browsers — newer entrants with LLM integrations
  "ai.perplexity.comet",
  "com.sigmaos.sigmaos.macos",
  // SigmaOS
  // Webkit-based misc
  "com.kagi.kagimacOS"
  // Orion
]);
const TERMINAL_BUNDLE_IDS = /* @__PURE__ */ new Set([
  // Dedicated terminals
  "com.apple.Terminal",
  "com.googlecode.iterm2",
  "dev.warp.Warp-Stable",
  "dev.warp.Warp-Beta",
  "com.github.wez.wezterm",
  "org.alacritty",
  "io.alacritty",
  // pre-v0.11.0 (renamed 2022-07) — kept for legacy installs
  "net.kovidgoyal.kitty",
  "co.zeit.hyper",
  "com.mitchellh.ghostty",
  "org.tabby",
  "com.termius-dmg.mac",
  // Termius
  // IDEs with integrated terminals — we can't distinguish "type in the
  // editor" from "type in the integrated terminal" via screenshot+click.
  //   VS Code family
  "com.microsoft.VSCode",
  "com.microsoft.VSCodeInsiders",
  "com.vscodium",
  // VSCodium
  "com.todesktop.230313mzl4w4u92",
  // Cursor
  "com.exafunction.windsurf",
  // Windsurf / Codeium
  "dev.zed.Zed",
  "dev.zed.Zed-Preview",
  //   JetBrains family (all have integrated terminals)
  "com.jetbrains.intellij",
  "com.jetbrains.intellij.ce",
  "com.jetbrains.pycharm",
  "com.jetbrains.pycharm.ce",
  "com.jetbrains.WebStorm",
  "com.jetbrains.CLion",
  "com.jetbrains.goland",
  "com.jetbrains.rubymine",
  "com.jetbrains.PhpStorm",
  "com.jetbrains.datagrip",
  "com.jetbrains.rider",
  "com.jetbrains.AppCode",
  "com.jetbrains.rustrover",
  "com.jetbrains.fleet",
  "com.google.android.studio",
  // Android Studio (JetBrains-based)
  //   Other IDEs
  "com.axosoft.gitkraken",
  // GitKraken has an integrated terminal panel. Also keeps the "kraken" trading-substring from miscategorizing it — bundle-ID wins.
  "com.sublimetext.4",
  "com.sublimetext.3",
  "org.vim.MacVim",
  "com.neovim.neovim",
  "org.gnu.Emacs",
  // Xcode's previous carve-out (full tier for Interface Builder / simulator)
  // was reversed — at tier "click" IB and simulator taps still work (both are
  // plain clicks) while the integrated terminal is blocked from keyboard input.
  "com.apple.dt.Xcode",
  "org.eclipse.platform.ide",
  "org.netbeans.ide",
  "com.microsoft.visual-studio",
  // Visual Studio for Mac
  // AppleScript/automation execution surfaces — same threat as terminals:
  // type(script) → key("cmd+r") runs arbitrary code. Added after #28011
  // removed the osascript MCP server, making CU the only tool-call route
  // to AppleScript.
  "com.apple.ScriptEditor2",
  "com.apple.Automator",
  "com.apple.shortcuts"
]);
const TRADING_BUNDLE_IDS = /* @__PURE__ */ new Set([
  // Verified via Homebrew quit/zap stanzas + mdls + electron-builder source.
  //   Trading
  "com.webull.desktop.v1",
  // Webull (direct download, Qt)
  "com.webull.trade.mac.v1",
  // Webull (Mac App Store)
  "com.tastytrade.desktop",
  "com.tradingview.tradingviewapp.desktop",
  "com.fidelity.activetrader",
  // Fidelity Trader+ (new)
  "com.fmr.activetrader",
  // Fidelity Active Trader Pro (legacy)
  // Interactive Brokers TWS — install4j wrapper; Homebrew quit stanza is
  // authoritative for this exact value but install4j IDs can drift across
  // major versions — name-substring "trader workstation" is the fallback.
  "com.install4j.5889-6375-8446-2021",
  //   Crypto
  "com.binance.BinanceDesktop",
  "com.electron.exodus",
  // Electrum uses PyInstaller with bundle_identifier=None → defaults to
  // org.pythonmac.unspecified.<AppName>. Confirmed in spesmilo/electrum
  // source + Homebrew zap. IntuneBrew's "org.electrum.electrum" is a fork.
  "org.pythonmac.unspecified.Electrum",
  "com.ledger.live",
  "io.trezor.TrezorSuite"
  // No native macOS app (name-substring only): Schwab, E*TRADE, TradeStation,
  // Robinhood, NinjaTrader, Coinbase, Kraken, Bloomberg. thinkorswim
  // install4j ID drifts per-install — substring safer.
]);
const POLICY_DENIED_BUNDLE_IDS = /* @__PURE__ */ new Set([
  // Verified via Homebrew quit/zap + mdls /System/Applications + IntuneBrew.
  //   Apple built-ins
  "com.apple.TV",
  "com.apple.Music",
  "com.apple.iBooksX",
  "com.apple.podcasts",
  //   Music
  "com.spotify.client",
  "com.amazon.music",
  "com.tidal.desktop",
  "com.deezer.deezer-desktop",
  "com.pandora.desktop",
  "com.electron.pocket-casts",
  // direct-download Electron wrapper
  "au.com.shiftyjelly.PocketCasts",
  // Mac App Store
  //   Video
  "tv.plex.desktop",
  "tv.plex.htpc",
  "tv.plex.plexamp",
  "com.amazon.aiv.AIVApp",
  // Prime Video (iOS-on-Apple-Silicon)
  //   Ebooks
  "net.kovidgoyal.calibre",
  "com.amazon.Kindle",
  // legacy desktop, discontinued
  "com.amazon.Lassen",
  // current Mac App Store (iOS-on-Mac)
  "com.kobo.desktop.Kobo"
  // No native macOS app (name-substring only): Netflix, Disney+, Hulu,
  // HBO Max, Peacock, Paramount+, YouTube, Crunchyroll, Tubi, Vudu,
  // Audible, Reddit, NYTimes. Their iOS apps don't opt into iPad-on-Mac.
]);
const POLICY_DENIED_NAME_SUBSTRINGS = [
  // Video streaming
  "netflix",
  "disney+",
  "hulu",
  "prime video",
  "apple tv",
  "peacock",
  "paramount+",
  // "plex" is too generic — would match "Perplexity". Covered by
  // tv.plex.* bundle IDs on macOS.
  "tubi",
  "crunchyroll",
  "vudu",
  // E-readers / audiobooks
  "kindle",
  "apple books",
  "kobo",
  "play books",
  "calibre",
  "libby",
  "readium",
  "audible",
  "libro.fm",
  "speechify",
  // Music
  "spotify",
  "apple music",
  "amazon music",
  "youtube music",
  "tidal",
  "deezer",
  "pandora",
  "pocket casts",
  // Publisher / social apps (from the same blocklist tab)
  "naver",
  "reddit",
  "sony music",
  "vegas pro",
  "pitchfork",
  "economist",
  "nytimes"
  // Skipped (too generic for substring matching — need bundle ID):
  //   HBO Max / Max, YouTube (non-Music), Nook, Sony Catalyst, Wired
];
function isPolicyDenied(bundleId, displayName) {
  if (bundleId && POLICY_DENIED_BUNDLE_IDS.has(bundleId)) return true;
  const lower = displayName.toLowerCase();
  for (const sub of POLICY_DENIED_NAME_SUBSTRINGS) {
    if (lower.includes(sub)) return true;
  }
  return false;
}
function getDeniedCategory(bundleId) {
  if (BROWSER_BUNDLE_IDS.has(bundleId)) return "browser";
  if (TERMINAL_BUNDLE_IDS.has(bundleId)) return "terminal";
  if (TRADING_BUNDLE_IDS.has(bundleId)) return "trading";
  return null;
}
const BROWSER_NAME_SUBSTRINGS = [
  "safari",
  "chrome",
  "firefox",
  "microsoft edge",
  "brave",
  "opera",
  "vivaldi",
  "chromium",
  // Arc/Dia: the canonical display name is just "Arc"/"Dia" — too short for
  // substring matching (false-positives: "Arcade", "Diagram"). Covered by
  // bundle ID on macOS. The "... browser" entries below catch natural-language
  // phrasings ("the arc browser") but NOT the canonical short name.
  "arc browser",
  "tor browser",
  "duckduckgo",
  "yandex",
  "orion browser",
  // Agentic / AI browsers
  "comet",
  // Perplexity's browser — "Comet" substring risks false positives
  // but leaving for now; "comet" in an app name is rare
  "sigmaos",
  "dia browser"
];
const TERMINAL_NAME_SUBSTRINGS = [
  // macOS / cross-platform terminals
  "terminal",
  // catches Terminal, Windows Terminal (NOT iTerm — separate entry)
  "iterm",
  "wezterm",
  "alacritty",
  "kitty",
  "ghostty",
  "tabby",
  "termius",
  // AppleScript runners — see bundle-ID comment above. "shortcuts" is too
  // generic for substring matching (many apps have "shortcuts" in the name);
  // covered by bundle ID only, like warp/hyper.
  "script editor",
  "automator",
  // NOTE: "warp" and "hyper" are too generic for substring matching —
  // they'd false-positive on "Warpaint" or "Hyperion". Covered by bundle ID
  // (dev.warp.Warp-Stable, co.zeit.hyper) for macOS; Windows exe-name
  // matching can be added when Windows CU ships.
  // Windows shells (activate when the darwin gate lifts)
  "powershell",
  "cmd.exe",
  "command prompt",
  "git bash",
  "conemu",
  "cmder",
  // IDEs (VS Code family)
  "visual studio code",
  "visual studio",
  // catches VS for Mac + Windows
  "vscode",
  "vs code",
  "vscodium",
  "cursor",
  // Cursor IDE — "cursor" is generic but IDE is the only common app
  "windsurf",
  // Zed: display name is just "Zed" — too short for substring matching
  // (false-positives). Covered by bundle ID (dev.zed.Zed) on macOS.
  // IDEs (JetBrains family)
  "intellij",
  "pycharm",
  "webstorm",
  "clion",
  "goland",
  "rubymine",
  "phpstorm",
  "datagrip",
  "rider",
  "appcode",
  "rustrover",
  "fleet",
  "android studio",
  // Other IDEs
  "sublime text",
  "macvim",
  "neovim",
  "emacs",
  "xcode",
  "eclipse",
  "netbeans"
];
const TRADING_NAME_SUBSTRINGS = [
  // Trading — brokerage apps. Sourced from the ACP CU-apps blocklist xlsx
  // ("Read Only" tab). Name-substring safe for proper nouns below; generic
  // names (IG, Delta, HTX) are skipped and need bundle-ID matching once
  // verified.
  "bloomberg",
  "ameritrade",
  "thinkorswim",
  "schwab",
  "fidelity",
  "e*trade",
  "interactive brokers",
  "trader workstation",
  // Interactive Brokers TWS
  "tradestation",
  "webull",
  "robinhood",
  "tastytrade",
  "ninjatrader",
  "tradingview",
  "moomoo",
  "tradezero",
  "prorealtime",
  "plus500",
  "saxotrader",
  "oanda",
  "metatrader",
  "forex.com",
  "avaoptions",
  "ctrader",
  "jforex",
  "iq option",
  "olymp trade",
  "binomo",
  "pocket option",
  "raceoption",
  "expertoption",
  "quotex",
  "naga",
  "morgan stanley",
  "ubs neo",
  "eikon",
  // Thomson Reuters / LSEG Workspace
  // Crypto — exchanges, wallets, portfolio trackers
  "coinbase",
  "kraken",
  "binance",
  "okx",
  "bybit",
  // "gate.io" is too generic — the ".io" TLD suffix is common in app names
  // (e.g., "Draw.io"). Needs bundle-ID matching once verified.
  "phemex",
  "stormgain",
  "crypto.com",
  // "exodus" is too generic — it's a common noun and would match unrelated
  // apps/games. Needs bundle-ID matching once verified.
  "electrum",
  "ledger live",
  "trezor",
  "guarda",
  "atomic wallet",
  "bitpay",
  "bisq",
  "koinly",
  "cointracker",
  "blockfi",
  "stripe cli",
  // Crypto games / metaverse (same trade-execution risk model)
  "decentraland",
  "axie infinity",
  "gods unchained"
];
function getDeniedCategoryByDisplayName(name) {
  const lower = name.toLowerCase();
  for (const sub of TRADING_NAME_SUBSTRINGS) {
    if (lower.includes(sub)) return "trading";
  }
  for (const sub of BROWSER_NAME_SUBSTRINGS) {
    if (lower.includes(sub)) return "browser";
  }
  for (const sub of TERMINAL_NAME_SUBSTRINGS) {
    if (lower.includes(sub)) return "terminal";
  }
  return null;
}
function getDeniedCategoryForApp(bundleId, displayName) {
  if (bundleId) {
    const byId = getDeniedCategory(bundleId);
    if (byId) return byId;
  }
  return getDeniedCategoryByDisplayName(displayName);
}
function getDefaultTierForApp(bundleId, displayName) {
  return categoryToTier(getDeniedCategoryForApp(bundleId, displayName));
}
const _test = {
  BROWSER_BUNDLE_IDS,
  TERMINAL_BUNDLE_IDS,
  TRADING_BUNDLE_IDS,
  POLICY_DENIED_BUNDLE_IDS,
  BROWSER_NAME_SUBSTRINGS,
  TERMINAL_NAME_SUBSTRINGS,
  TRADING_NAME_SUBSTRINGS,
  POLICY_DENIED_NAME_SUBSTRINGS
};
export {
  _test,
  categoryToTier,
  getDefaultTierForApp,
  getDeniedCategory,
  getDeniedCategoryByDisplayName,
  getDeniedCategoryForApp,
  isPolicyDenied
};
