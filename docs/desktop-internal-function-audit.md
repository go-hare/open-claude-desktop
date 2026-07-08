# Desktop internal function audit

Generated: 2026-07-08T09:28:33.272Z

## Summary

- Official preload invoke methods: 544
- Official preload sendSync methods: 15
- Official renderer event listeners: 75
- Official direct app binding invoke methods: 3
- Official direct app binding event listeners: 2
- Source registered invoke methods: 544
- Source registered sendSync methods: 15
- Source dispatched event methods: 75
- Source direct registered invoke methods: 3
- Source direct dispatched event methods: 2
- Missing invoke handlers: 0
- Missing sendSync handlers: 0
- Missing event dispatch sites: 0
- Extra source invoke handlers: 0
- Extra source sendSync handlers: 0
- Missing direct invoke handlers: 0
- Missing direct event dispatch sites: 0
- Extra direct invoke handlers: 0
- Extra direct event dispatch sites: 0
- Internal request/event surface ok: yes

## Official internal invoke tree

| namespace | interface | methods | names |
| --- | --- | ---: | --- |
| claude.buddy | Buddy | 12 | cancelScan, deviceStatus, forgetDevice, install, pairDevice, pickDevice, pickFolder, preview, scanDevices, setName, status, submitPin |
| claude.buddy | BuddyBleTransport | 3 | log, reportState, rx |
| claude.coworkArtifact | CoworkArtifactBridge | 5 | askClaude, callMcpTool, navigateHost, openExternalUrl, runScheduledTask |
| claude.hybrid | DesktopIntl | 1 | requestLocaleChange |
| claude.internal.findInPage | FindInPage | 3 | endFindSession, findInPage, stopFindInPage |
| claude.internal.ui | AboutWindow | 4 | getAppName, getBuildProps, getSupport, openHelp |
| claude.internal.ui | MainWindowTitleBar | 4 | isClaudeCurrentlyHealthy, requestMainMenuPopup, requestReloadMainView, titleBarReady |
| claude.internal.ui | QuickWindow | 3 | requestDismiss, requestDismissWithPayload, requestSkooch |
| claude.officeAddin | OfficeAddinFiles | 6 | connectedFilesState_$store$_getState, focusFile, getConnectedFiles, isFeatureEnabled, selectFile, updateActiveConversationSummary |
| claude.settings | AppConfig | 4 | getAppConfig, setAppFeature, setIsDxtAutoUpdatesEnabled, setIsUsingBuiltInNodeForMcp |
| claude.settings | AppFeatures | 1 | getSupportedFeatures |
| claude.settings | AppPreferences | 2 | getPreferences, setPreference |
| claude.settings | Custom3pHelperRun | 2 | getCredentialHelperLastRun, runCredentialHelper |
| claude.settings | Custom3pSetup | 23 | authorizeAndProbeMcpServer, bootstrapState_$store$_getState, createConfig, deleteConfig, duplicateConfig, exportConfig, forgetMcpOAuth, getConfigHealth, getLoginDesktop3pStatus, listConfigs, openDeviceCodeWindowForE2e, openSetupWindow, probeEgressHosts, probeMcpServer, readConfig, recheckConfigHealth, relaunchApp, renameConfig, revealConfig, setAppliedConfig, setDeploymentMode, triggerBootstrapAuth, writeConfig |
| claude.settings | DesktopInfo | 2 | getSystemInfo, showLogsInFileManager |
| claude.settings | Extensions | 26 | deleteExtension, getAvailableExtensionRuntimes, getDirectoryUrl, getExtension, getExtensionSettings, getExtensionVersion, getExtensionVersions, getExtensions, getInstalledExtensionsWithState, getIsUpdateAvailable, getManifestCompatibilityResult, handleDxtFile, installDxt, installDxtFromDirectory, installDxtUnpacked, installExtensionFromPreview, isDesktopExtensionDirectoryEnabled, isDesktopExtensionSignatureRequired, isDirectoryEnabled, isExtensionsEnabled, openExtensionSettingsFolder, openExtensionsFolder, refreshAllowlistCheck, setExtensionSettings, showExtensionInFolder, showInstallDxtDialog |
| claude.settings | FilePickers | 2 | getDirectoryPath, getFilePath |
| claude.settings | GlobalShortcut | 2 | getGlobalShortcut, setGlobalShortcut |
| claude.settings | MCP | 7 | getMcpServersConfig, getMcpServersConfigWithStatus, isLocalDevMcpEnabled, revealConfig, revealLogs, revealServerLog, setMcpServerConfigs |
| claude.settings | Startup | 4 | isMenuBarEnabled, isStartupOnLoginEnabled, setMenuBarEnabled, setStartupOnLoginEnabled |
| claude.settings | SupportBundle | 2 | submitAction, supportBundleState_$store$_getState |
| claude.settings | WakeScheduler | 2 | getStatus, openSettings |
| claude.simulator | Simulator | 6 | attach, attachment_$store$_getState, detach, gesture, installAndLaunch, listDevices |
| claude.web | Account | 1 | setAccountDetails |
| claude.web | AgentModeFeedback | 3 | openFeedbackAndConfirmReinstall, openFeedbackWindow, reportErrorToSlack |
| claude.web | Auth | 1 | doAuthInBrowser |
| claude.web | AutoUpdater | 6 | cancelPendingRestart, checkForUpdates, getRunningLocalSessionCount, restartToUpdate, restartToUpdateWhenIdle, updaterState_$store$_getState |
| claude.web | BrowserNavigation | 5 | goBack, goForward, navigationState_$store$_getState, reportNavigationState, requestMainMenuPopup |
| claude.web | BuddyRemoteFeed | 1 | sync |
| claude.web | CCDScheduledTasks | 7 | createScheduledTask, getAllScheduledTasks, getScheduledTaskFileContent, removeApprovedPermission, updateScheduledTask, updateScheduledTaskFileContent, updateScheduledTaskStatus |
| claude.web | ChromeExtension | 3 | installExtension, isInstalled, restartChrome |
| claude.web | ClaudeCode | 4 | checkGitAvailable, getStatus, prepare, resolveLocalSettings |
| claude.web | ClaudeVM | 11 | apiReachability_$store$_getState, checkVirtualMachinePlatform, deleteAndReinstall, download, enableVirtualMachinePlatform, getDownloadStatus, getRunningStatus, restartAfterVMPInstall, setForceDisableHostLoop, setYukonSilverConfig, startVM |
| claude.web | ComputerUseTcc | 7 | getCurrentSessionGrants, getState, listInstalledApps, openSystemSettings, requestAccessibility, requestScreenRecording, revokeGrant |
| claude.web | CoworkArtifacts | 18 | deleteArtifact, getAllArtifacts, getArtifactIndexHtmlPath, getArtifactMetadata, getArtifactThumbnail, hideArtifact, importArtifact, isSharingEnabled, parkAndCaptureArtifact, printArtifactToPdf, refreshImportedArtifact, reloadArtifactView, restoreArtifactVersion, setArtifactMcpTools, setArtifactStarred, shareArtifact, showArtifact, unshareArtifact |
| claude.web | CoworkFilePreview | 5 | hide, isEnabled, isVmReady, parkAndCapture, show |
| claude.web | CoworkMemory | 7 | deleteAccountMemory, listAccountMemories, readAccountMemory, readGlobalMemory, resetMemories, writeAccountMemory, writeGlobalMemory |
| claude.web | CoworkRadar | 7 | adoptSession, dismissCard, getCards, getLastRun, recordCardEngagement, revealLastRunTranscript, setCardStatus |
| claude.web | CoworkScheduledTasks | 8 | clearChromePermissions, createScheduledTask, getAllScheduledTasks, getScheduledTaskFileContent, removeApprovedPermission, updateScheduledTask, updateScheduledTaskFileContent, updateScheduledTaskStatus |
| claude.web | CoworkSpaces | 20 | addFolderToSpace, addLinkToSpace, addProjectToSpace, classifySessions, copyFilesToSpaceFolder, createSpace, createSpaceFolder, deleteSpace, getAllSpaces, getAutoMemoryDir, getSpace, listFolderContents, openFile, readFileContents, removeFolderFromSpace, removeLinkFromSpace, removeProjectFromSpace, setAutoDescription, summarizeSpace, updateSpace |
| claude.web | CustomPlugins | 16 | addMarketplace, checkPluginHasLocalChanges, getAndClearMigrationIssues, getCachedCommands, getInstallCounts, installLocalOrgPlugin, installPlugin, listAvailablePlugins, listInstalledPlugins, listLocalOrgPlugins, listMarketplaces, listRemotePluginsPage, refreshMarketplace, removeMarketplace, uninstallPlugin, updatePlugin |
| claude.web | DesktopNotifications | 4 | getAuthorizationStatus, openNotificationSettings, requestAuthorization, showNotification |
| claude.web | FileSystem | 17 | browseFiles, browseFolder, browseFolders, exportLocalFileToGoogleDrive, getLocalFileThumbnail, getSystemPath, listDirectory, listFilesInFolder, openLocalFile, promoteScratchpadFile, readLocalFile, savePastedFile, showInFolder, whichApplication, writeFileDownload, writeFileDownloadAndOpen, writeLocalFile |
| claude.web | FindInPageProvider | 2 | reportFindResult, setProviderActive |
| claude.web | FloatingPenguinMini | 2 | requestSetMiniExpanded, requestToggleMini |
| claude.web | FramebufferPreview | 8 | attach, detach, listSources, requestFramePort, sendKey, sendPointer, sendScroll, setStreamHints |
| claude.web | GrandPrix | 3 | disconnect, grandPrixStatus_$store$_getState, pair |
| claude.web | Launch | 25 | activeServers_$store$_getState, capturePreviewScreenshot, clearPreviewViewport, deployPreview, destroyPreview, getAutoVerify, getConfiguredServices, getLogs, getPreviewUrl, goBack, goForward, hidePreview, loadHtmlPreview, navigatePreview, pickHtmlFile, refreshPreview, setAutoVerify, setPreviewColorScheme, setPreviewViewport, showPreview, startFromConfig, stopServer, suggestDeployName, toggleSelectionMode, unpublishDeploy |
| claude.web | LocalAgentModeSessions | 63 | abandonBridgeEnvironment, addFolderToSession, addTrustedFolder, archive, authorizeDirectMcpServer, delete, deleteBridgeAgentMemory, deleteBridgeSession, deleteLocalSkill, disconnectDirectMcpServer, getAll, getBridgeConsent, getDirectMcpServerStatuses, getLocalSkillFiles, getSession, getSessionsBridgeEnabled, getSessionsForScheduledTask, getSupportedCommands, getTranscript, getTranscriptFeedback, getTrustedFolders, interactiveAuth_$store$_getState, isFolderTrusted, kickBridgePoll, listLocalSkills, mcpCallTool, mcpListResources, mcpReadResource, noteCuWindowMentions, openOutputsDir, removeTrustedFolder, replaceEnabledMcpTools, replaceRemoteMcpServers, requestFolderTccAccess, resetBridge, resetBridgeSession, respondBridgePermissionPreflight, respondDirectoryServers, respondPluginSearch, respondSlashMenuSkills, respondToToolPermission, revealLocalSkill, revokeInteractiveAuth, rewind, saveLocalSkill, searchSessions, sendMessage, sessionsBridgeStatus_$store$_getState, setChromePermissionMode, setDraftSessionFolders, setFocusedSession, setLocalSkillEnabled, setMcpServers, setModel, setPermissionMode, setSessionsBridgeEnabled, shareSession, start, stop, submitTranscriptFeedback, syncSkills, triggerInteractiveAuth, updateSession |
| claude.web | LocalPlugins | 15 | deletePlugin, getDownloadedRemotePlugins, getPluginCliStatus, getPluginOAuthStatus, getPluginShimOps, getPlugins, listSkillFiles, revokePluginOAuth, setPluginEnabled, setPluginEnvVars, setPluginOAuthClient, setPluginShimPermission, startPluginOAuthFlow, syncRemotePlugins, uploadPlugin |
| claude.web | LocalSessionEnvironment | 2 | get, save |
| claude.web | LocalSessions | 123 | addDirectories, archive, cancelQueuedMessage, checkGhAvailable, checkRemoteTrust, checkTrust, clearSession, commitAllChanges, commitWipForBranchSwitch, createAgent, createLocalPr, delete, disableAutoMerge, discardWorkingTree, enableAutoMerge, ensureBranchPushed, ensureSSHConnected, forkSession, generateLocalPrContent, getAgents, getAll, getCodeStats, getCommitDiff, getContextUsage, getDefaultEffort, getDefaultPermissionMode, getDetectedProjects, getDiffFileContent, getEffort, getGhIssue, getGitCommits, getGitDiff, getGitDiffStats, getGitInfo, getInstalledEditors, getLocalBranches, getPermissionMode, getPlanForSession, getPrChecks, getPrDetails, getPrReviewComments, getPrStateForBranch, getSSHConfigs, getSSHGitInfo, getSSHSupportedCommands, getSession, getSessionsForScheduledTask, getShellPtyBuffer, getSupportedCommands, getTeleportReadiness, getTranscript, getTrustedSSHHosts, getUncommittedChanges, getWorkingTreeStatus, importCliSession, installGh, interrupt, isVSCodeInstalled, isWorkingTreeDirty, launchUltrareview, listGhIssues, listSSHDirectory, listSessionDirectory, logCliEvent, mergePr, openInEditor, openInVSCode, pickFileAtCwd, pickSessionFile, popBackgroundTaskSuggestion, readFileAtCwd, readSessionFile, readSessionImageAsDataUrl, releaseWorktree, replaceEnabledMcpTools, replaceRemoteMcpServers, resizePty, resizeShellPty, resolveSSHSettings, respondToSSHPassword, respondToToolPermission, reviewDiff, rewind, runBashCommand, saveTrust, searchSessions, sendMessage, sendSideChatMessage, setAutoFixEnabled, setAvailableCodeModels, setEffort, setFastMode, setFocusedSession, setMcpServers, setModel, setPermissionMode, setSSHConfigs, setTrustedSSHHosts, setVisibility, shareSession, start, startPty, startShellPty, startSideChat, stashWorkingTree, stop, stopPty, stopSessionSummary, stopShellPty, stopSideChat, stopTask, submitFeedback, summarizeSession, summarizeTranscript, teleportToCloud, testSSHConnection, unarchive, updatePrBody, updateSession, validateSSHPath, writePty, writeSessionFile, writeShellPty |
| claude.web | NestDev | 2 | focus, getState |
| claude.web | OpenDocuments | 2 | getOpenDocuments, readOpenDocumentAsBase64 |
| claude.web | OrbitDeploys | 4 | getAll, removeDeploy, setDeploy, setPinned |
| claude.web | QuickEntry | 1 | setRecentChats |
| claude.web | Resources | 6 | fetchMentionOptions, handleMentionSelect, listProjectFiles, searchFileContents, setFindInPageClaimed, setFocusedCwd |
| claude.web | WindowControl | 6 | captureScreenshot, close, focus, resize, setIncognitoMode, setThemeMode |
| claude.web | WindowState | 3 | getFullscreen, getVisibility, getZoomFactor |

## Missing request handlers

None.


## Event dispatch gaps

None.


Full machine-readable report: `docs/desktop-internal-function-audit.json`
