/**
 * Quick Entry window UI — residual structure from
 *   app.asar .vite/renderer/quick_window/quick-window.html
 *   assets/main-oBdKGVdT.js (window load handlers)
 *
 * Bridge:
 *   globalThis["claude.internal.ui"].QuickWindow
 *     requestDismiss / requestDismissWithPayload / requestSkooch
 *   globalThis["claude.hybrid"].DesktopIntl
 *     onLocaleChanged (refresh placeholder)
 *
 * Residual behavior (main-oBdKGVdT):
 *   - placeholder formatMessage id S3MXlbjkax
 *   - input auto-height (cap window.innerHeight-100; overflow pad 22/8)
 *   - debounce 750ms → requestSkooch(container.scrollWidth, scrollHeight)
 *   - outside click / Escape → requestDismiss(null)
 *   - Enter (no shift/alt) → requestDismiss(value) then clear
 *   - wheel when overflowing; drag effects none
 */
const ui = globalThis["claude.internal.ui"];
const quick = ui?.QuickWindow;
const desktopIntl = globalThis["claude.hybrid"]?.DesktopIntl;

const DEFAULT_PLACEHOLDER = "What can I help you with today?";
const PLACEHOLDER_ID = "S3MXlbjkax";

/** residual Claude mark path (app-logo lit component) */
const CLAUDE_MARK_PATH =
  "M52.4285 162.873L98.7844 136.879L99.5485 134.602L98.7844 133.334H96.4921L88.7237 132.862L62.2346 132.153L39.3113 131.207L17.0249 130.026L11.4214 128.844L6.2 121.873L6.7094 118.447L11.4214 115.257L18.171 115.847L33.0711 116.911L55.485 118.447L71.6586 119.392L95.728 121.873H99.5485L100.058 120.337L98.7844 119.392L97.7656 118.447L74.5877 102.732L49.4995 86.1905L36.3823 76.62L29.3779 71.7757L25.8121 67.2858L24.2839 57.3608L30.6515 50.2716L39.3113 50.8623L41.4763 51.4531L50.2636 58.1879L68.9842 72.7209L93.4357 90.6804L97.0015 93.6343L98.4374 92.6652L98.6571 91.9801L97.0015 89.2625L83.757 65.2772L69.621 40.8192L63.2534 30.6579L61.5978 24.632C60.9565 22.1032 60.579 20.0111 60.579 17.4246L67.8381 7.49965L71.9133 6.19995L81.7193 7.49965L85.7946 11.0443L91.9074 24.9865L101.714 46.8451L116.996 76.62L121.453 85.4816L123.873 93.6343L124.764 96.1155H126.292V94.6976L127.566 77.9197L129.858 57.3608L132.15 30.8942L132.915 23.4505L136.608 14.4708L143.994 9.62643L149.725 12.344L154.437 19.0788L153.8 23.4505L150.998 41.6463L145.522 70.1215L141.957 89.2625H143.994L146.414 86.7813L156.093 74.0206L172.266 53.698L179.398 45.6635L187.803 36.802L193.152 32.5484H203.34L210.726 43.6549L207.415 55.1159L196.972 68.3492L188.312 79.5739L175.896 96.2095L168.191 109.585L168.882 110.689L170.738 110.53L198.755 104.504L213.91 101.787L231.994 98.7149L240.144 102.496L241.036 106.395L237.852 114.311L218.495 119.037L195.826 123.645L162.07 131.592L161.696 131.893L162.137 132.547L177.36 133.925L183.855 134.279H199.774L229.447 136.524L237.215 141.605L241.8 147.867L241.036 152.711L229.065 158.737L213.019 154.956L175.45 145.977L162.587 142.787H160.805V143.85L171.502 154.366L191.242 172.089L215.82 195.011L217.094 200.682L213.91 205.172L210.599 204.699L188.949 188.394L180.544 181.069L161.696 165.118H160.422V166.772L164.752 173.152L187.803 207.771L188.949 218.405L187.294 221.832L181.308 223.959L174.813 222.777L161.187 203.754L147.305 182.486L136.098 163.345L134.745 164.2L128.075 235.42L125.019 239.082L117.887 241.8L111.902 237.31L108.718 229.984L111.902 215.452L115.722 196.547L118.779 181.541L121.58 162.873L123.291 156.636L123.14 156.219L121.773 156.449L107.699 175.752L86.304 204.699L69.3663 222.777L65.291 224.431L58.2867 220.768L58.9235 214.27L62.8713 208.48L86.304 178.705L100.44 160.155L109.551 149.507L109.462 147.967L108.959 147.924L46.6977 188.512L35.6182 189.93L30.7788 185.44L31.4156 178.115L33.7079 175.752L52.4285 162.873Z";

function resolvePlaceholder(messages) {
  if (messages && typeof messages === "object") {
    const entry = messages[PLACEHOLDER_ID] ?? messages[`id:${PLACEHOLDER_ID}`];
    if (typeof entry === "string" && entry.length > 0) return entry;
    if (entry && typeof entry === "object") {
      const def = entry.defaultMessage ?? entry.message ?? entry.default;
      if (typeof def === "string" && def.length > 0) return def;
    }
  }
  return DEFAULT_PLACEHOLDER;
}

function applyPlaceholder(input, messages) {
  input.placeholder = resolvePlaceholder(messages);
}

function mountAppLogo(host) {
  const width = host.getAttribute("width") || "18";
  const height = host.getAttribute("height") || "18";
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("width", `${width}px`);
  svg.setAttribute("height", `${height}px`);
  svg.setAttribute("viewBox", "0 0 248 248");
  svg.setAttribute("fill", "none");
  svg.setAttribute("xmlns", ns);
  const path = document.createElementNS(ns, "path");
  path.setAttribute("d", CLAUDE_MARK_PATH);
  path.setAttribute("fill", "#D97757");
  svg.appendChild(path);
  host.replaceChildren(svg);
}

/** residual auto-height for #prompt-input */
function resizePromptInput(input) {
  input.style.height = "24px";
  const next = Math.min(input.scrollHeight, window.innerHeight - 100);
  input.style.height = `${next}px`;
  const overflowing = input.scrollHeight > next;
  input.style.overflowY = overflowing ? "auto" : "hidden";
  input.style.paddingTop = overflowing ? "22px" : "8px";
  input.style.paddingBottom = overflowing ? "22px" : "8px";
}

function debounce(fn, ms) {
  let timer = null;
  return (...args) => {
    if (timer != null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      fn(...args);
    }, ms);
  };
}

function mount() {
  const input = document.getElementById("prompt-input");
  const container = document.querySelector(".container");
  const logo = document.querySelector("app-logo");
  if (!input || !container) return;

  if (logo) mountAppLogo(logo);

  let messages = globalThis.initialMessages;
  applyPlaceholder(input, messages);

  input.addEventListener("input", () => {
    resizePromptInput(input);
  });

  // residual: Hl(input,"input").pipe(debounceTime(750)) → requestSkooch
  const requestSkoochDebounced = debounce(() => {
    console.log("Requesting Skooch!", container.scrollHeight);
    void quick?.requestSkooch?.(container.scrollWidth, container.scrollHeight);
  }, 750);
  input.addEventListener("input", requestSkoochDebounced);

  // residual: click outside container → focus + requestDismiss(null)
  document.body.addEventListener("click", (event) => {
    if (container && event.target instanceof Node && container.contains(event.target)) {
      return;
    }
    input.focus();
    void quick?.requestDismiss?.(null);
  });

  // residual: Enter (no shift/alt) → requestDismiss(value) then clear + resize
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" || event.shiftKey || event.altKey) return;
    event.preventDefault();
    void quick?.requestDismiss?.(input.value);
    input.value = "";
    resizePromptInput(input);
  });

  // residual: Escape → requestDismiss(null)
  document.addEventListener("keyup", (event) => {
    if (event.key !== "Escape") return;
    void quick?.requestDismiss?.(null);
  });

  // residual: wheel when overflowing
  input.addEventListener(
    "wheel",
    (event) => {
      if (input.scrollHeight <= input.clientHeight) return;
      event.preventDefault();
      input.scrollTop += event.deltaY;
    },
    { passive: false },
  );

  // residual: block drag/drop on textarea
  for (const type of ["dragenter", "dragover", "dragleave", "drop"]) {
    input.addEventListener(
      type,
      (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (event instanceof DragEvent && event.dataTransfer) {
          event.dataTransfer.effectAllowed = "none";
          event.dataTransfer.dropEffect = "none";
        }
      },
      { passive: false },
    );
  }

  // residual: DesktopIntl.onLocaleChanged → refresh placeholder
  const onLocale = desktopIntl?.onLocaleChanged ?? desktopIntl?.localeChanged;
  if (typeof onLocale === "function") {
    onLocale((locale, nextMessages) => {
      void locale;
      messages = nextMessages;
      applyPlaceholder(input, messages);
    });
  }

  setTimeout(() => input.focus(), 0);
}

if (document.readyState === "loading") {
  window.addEventListener("load", mount);
} else {
  mount();
}
