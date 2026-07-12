import { app } from "electron";
import { LocalSessionStore } from "../services/localSessions/localSessionStore";
import { CoworkAccountContext } from "../services/coworkAccount/coworkAccountContext";
import { loadCoworkBootstrapIdentity } from "../services/coworkAccount/coworkBootstrapIdentity";
import { createCoworkHostLoopModeResolver } from "../services/coworkHostLoop/createCoworkHostLoopModeResolver";
import { createCoworkAgentQueryFactory } from "../services/coworkRuntime/coworkAgentQueryFactory";
import { createCoworkTranscriptReader } from "../services/coworkRuntime/coworkTranscriptReader";
import { FeatureStateStore } from "../services/featureState/featureStateStore";
import { CoworkSessionManager } from "../services/coworkSessions/coworkSessionManager";
import { CoworkSessionPersistence } from "../services/coworkSessions/coworkSessionPersistence";
import { ScheduledTaskStore } from "../services/scheduledTasks/scheduledTaskStore";
import { SettingsStore } from "../services/settings/settingsStore";
import type { DesktopWindowParts } from "../windows/types";
import type { IpcHandlerContext } from "./context";
import { registerAppBindingsHandlers } from "./appBindingsHandlers";
import { registerFeatureHandlers } from "./featureHandlers";
import { registerFindInPageHandlers } from "./findInPageHandlers";
import { registerCoworkSessionsHandlers } from "./coworkSessionsHandlers";
import { registerLocalSessionsHandlers } from "./localSessionsHandlers";
import { registerOriginalEventSurface } from "./originalEventSurface";
import { dispatchBridgeEvent } from "./registerIpc";
import { registerScheduledTasksHandlers } from "./scheduledTasksHandlers";
import { registerSettingsHandlers } from "./settingsHandlers";
import { registerStoreStateHandlers } from "./storeStateHandlers";
import { registerWebMiscHandlers } from "./webMiscHandlers";
import { registerWindowHandlers } from "./windowHandlers";

export function createDefaultIpcContext(windows: DesktopWindowParts): IpcHandlerContext {
  const coworkAccount = new CoworkAccountContext({
    loadBootstrapIdentity: loadCoworkBootstrapIdentity,
  });
  const featureState = new FeatureStateStore();
  // Official v4(): feature flag 1143815894 is the product gate. Without a GrowthBook
  // bridge yet, default host-loop off (false) — never hard-wire true. Operators can
  // enable via CLAUDE_HOST_LOOP_FEATURE=1 or CLAUDE_FORCE_HOST_LOOP=1 under dev override.
  const resolveHostLoopMode = createCoworkHostLoopModeResolver({
    getForceDisableHostLoop: () => featureState.getBoolean("vmForceDisableHostLoop", "global", false),
  });
  const localAgentModeSessions = new CoworkSessionManager({
    accountContext: coworkAccount,
    createPersistence: (identity) =>
      new CoworkSessionPersistence({
        accountId: identity.accountUuid,
        orgId: identity.organizationUuid,
        userDataPath: app.getPath("userData"),
      }),
    emit: (event) => {
      dispatchBridgeEvent(
        windows.mainView.webContents,
        "claude.web",
        "LocalAgentModeSessions",
        "onEvent",
        event,
      );
    },
    queryFactory: createCoworkAgentQueryFactory({
      onStderr: (chunk) => console.warn("[cowork-agent-sdk]", chunk.trimEnd()),
    }),
    resolveHostLoopMode: () => resolveHostLoopMode(),
    // Org sandbox policy source is unresolved until account/org payload is wired.
    requireCoworkFullVmSandbox: () => false,
    transcriptReader: createCoworkTranscriptReader(),
  });
  return {
    windows,
    coworkAccount,
    localSessions: new LocalSessionStore("code"),
    localAgentModeSessions,
    scheduledTasks: new ScheduledTaskStore(),
    settings: new SettingsStore(),
  };
}

export function registerDesktopIpc(context: IpcHandlerContext): void {
  registerOriginalEventSurface(context);
  registerWindowHandlers(context);
  registerAppBindingsHandlers(context);
  registerFindInPageHandlers(context);
  registerLocalSessionsHandlers(context);
  registerCoworkSessionsHandlers(context);
  registerScheduledTasksHandlers(context);
  registerSettingsHandlers(context);
  registerStoreStateHandlers(context);
  registerWebMiscHandlers(context);
  registerFeatureHandlers(context);
}
