/**
 * Cold first-paint chrome probe for mainView (product SPA).
 *
 * Official cold start (app.asar):
 *   createMainWindow opacity:0 → mainWindow shell did-finish-load +50ms setOpacity(1)
 * Official soft got("3p"):
 *   await jsA("3p"); await mainView.webContents.loadURL(CUSTOM_3P_ORIGIN)
 *   — no opacity hold, no setBounds, no chrome wait (verbatim app.asar got).
 *
 * Product soft 3p matches official got body (loadURL only).
 * Product cold first paint still waits residual chrome because open-claude-web SPA
 * is slower than ion-dist (blank /login flash if we only use shell +50ms).
 */

/**
 * Residual chrome probe for first opaque reveal.
 * Returns "ready" | "loading" | "login" from the mainView document.
 */
export const MAIN_VIEW_CHROME_PROBE_JS = `(() => {
  const path = location.pathname || "";
  // Official Gns residual footer trigger — only mounted in signed-in shell.
  if (document.querySelector('[data-testid="user-menu-button"]')) return "ready";
  // LoginRoute / M5t residual: chooser cards or pure-1p Get started CTA.
  if (
    path === "/login"
    || path.startsWith("/login/")
  ) {
    const hasChooserTitle = !!(
      document.body
      && /How do you want to use Claude|Sign in to continue|Get started|Claude for/i.test(
        document.body.innerText || "",
      )
    );
    const hasChoiceCard = !!document.querySelector(
      'button[aria-label="Continue with Gateway"], button[aria-label*="Continue with"], button[aria-label="Sign in to Anthropic"]',
    );
    // Official M5t: void 0===r → empty sVt (bg only, no Ace). Keep hold until
    // chooser title/cards paint so cold reveal does not flash blank shell.
    if (hasChooserTitle || hasChoiceCard) return "ready";
    return "login";
  }
  return "loading";
})()`;
