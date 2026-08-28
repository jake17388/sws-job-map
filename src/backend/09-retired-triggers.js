// ── Retired install-analysis trigger handlers ──────────────────────────────
// Keep these handlers until the old Apps Script triggers have been removed.
function processInstallAnalysisQueue() {
  return { processed: 0, retired: true };
}

function scheduledInstallAnalysisRefresh_() {
  return { processed: 0, retired: true };
}

function setupInstallAnalysisTriggers() {
  ScriptApp.getProjectTriggers()
    .filter(trigger => ['processInstallAnalysisQueue', 'scheduledInstallAnalysisRefresh_'].indexOf(trigger.getHandlerFunction()) !== -1)
    .forEach(trigger => ScriptApp.deleteTrigger(trigger));
  return { retired: true };
}
