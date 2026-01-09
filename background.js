// ================= background.js (resilient version) =================

// 🔹 Centralized error logger with storage mirroring
async function logError(context, error) {
  try {
    let msg = "";
    if (!error) {
      msg = "Unknown error";
    } else if (typeof error === "string") {
      msg = error;
    } else if (error.message) {
      msg = error.message;
    } else if (chrome?.runtime?.lastError?.message) {
      msg = chrome.runtime.lastError.message;
    } else {
      msg = JSON.stringify(error, Object.getOwnPropertyNames(error));
    }

    console.error(`[${context}]`, msg);

    // Persist logs in storage
    try {
      const { errorLogs } = await chrome.storage.local.get("errorLogs");
      const logs = Array.isArray(errorLogs) ? errorLogs : [];
      logs.push({ context, error: msg, ts: new Date().toISOString() });

      // Keep last 100 logs only
      if (logs.length > 100) logs.shift();

      await chrome.storage.local.set({ errorLogs: logs });
    } catch (storageErr) {
      console.error("[logError-storage]", storageErr);
    }
  } catch (fatal) {
    console.error("[logError-fatal]", fatal);
  }
}

// 🔹 Extension install/update hook
try {
  chrome.runtime.onInstalled.addListener((details) => {
    try {
      if (chrome.runtime.lastError) {
        logError("onInstalled-lastError", chrome.runtime.lastError.message);
      }
      console.log("Caption Way installed.", details);
    } catch (err) {
      logError("onInstalled-callback", err);
    }
  });
} catch (err) {
  logError("background.js-root", err);
}

// 🔹 Global error handling to avoid silent failures
self.onerror = (msg, src, line, col, err) => {
  logError("GlobalError", { msg, src, line, col, err });
};

self.onunhandledrejection = (event) => {
  logError("UnhandledRejection", event.reason);
};

// ==================================================
// 🔹 Message router to handle content.js messages
// ==================================================
try {
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    try {
      if (!msg || !msg.type) {
        sendResponse?.({ ok: false });
        return;
      }

      switch (msg.type) {
        case "LIVE_UPDATE":
          // Captions coming from content.js
          // Silently acknowledge to avoid port warnings
          sendResponse?.({ ok: true });
          break;

        case "CLEAR_LIVE":
          // Clear live captions event
          sendResponse?.({ ok: true });
          break;

        // Add other custom message types here if needed

        default:
          sendResponse?.({ ok: false, error: "Unknown message type" });
      }
    } catch (err) {
      logError("background.onMessage", err);
      try { sendResponse?.({ ok: false, error: err.message }); } catch {}
    }

    // Keep async channel alive
    return true;
  });
} catch (err) {
  logError("background-messageRouter", err);
}

