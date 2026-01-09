// ========== logger.js (universal centralized logger) ==========

// Detect runtime environment
function getEnv() {
  if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.id) {
    if (chrome.runtime.getManifest) {
      return "extension";
    }
    return "unknown-chrome";
  }
  if (typeof window !== "undefined" && window.document) return "popup";
  return "unknown";
}

// Centralized error logger
async function logError(context, error) {
  try {
    const env = getEnv();
    const entry = {
      context: `[${env}] ${context}`,
      error: error?.message || error?.toString?.() || error,
      ts: new Date().toISOString(),
    };

    // Console logging
    console.error(entry.context, entry.error);

    // Try saving to storage (if available)
    if (typeof chrome !== "undefined" && chrome.storage?.local) {
      const { errorLogs } = await chrome.storage.local.get("errorLogs");
      const logs = Array.isArray(errorLogs) ? errorLogs : [];
      logs.push(entry);

      if (logs.length > 100) logs.shift(); // keep last 100
      await chrome.storage.local.set({ errorLogs: logs });
    }
  } catch (e) {
    console.error("[logError-fallback]", e);
  }
}

// Global runtime error handler (popup/content only)
if (typeof window !== "undefined") {
  window.addEventListener("error", (event) => {
    logError("GlobalError", event.error || event.message);
  });

  window.addEventListener("unhandledrejection", (event) => {
    logError("UnhandledPromise", event.reason);
  });

  // Safe DOMContentLoaded wrapper for popup
  document.addEventListener("DOMContentLoaded", () => {
    try {
      const requiredIds = [
        "status", "recState", "startBtn", "stopBtn",
        "closeBtn", "downloadPdf", "clearBtn", "count"
      ];
      for (const id of requiredIds) {
        if (!document.getElementById(id)) {
          logError("DOMContentLoaded", `Missing element: #${id}`);
        }
      }
    } catch (err) {
      logError("DOMContentLoaded wrapper", err);
    }
  });
}

// Global error handling (background/service worker)
if (typeof self !== "undefined" && !self.document) {
  self.onerror = (msg, src, line, col, err) => {
    logError("GlobalError", { msg, src, line, col, err });
  };
  self.onunhandledrejection = (event) => {
    logError("UnhandledRejection", event.reason);
  };
}

// ========== End logger.js ==========
