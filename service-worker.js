// ========== service-worker.js (resilient version with improved logging) ==========

// --- Centralized error logger ---
function logError(context, error) {
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
  } catch (_) {
    console.error(`[${context}] (non-serializable error)`);
  }
}

const STATE = {
  isRecording: false,
  transcript: [] // {tsISO, time, speaker, text}
};

// --- Keep transcript mirrored in storage (survives reloads) ---
async function saveTranscript() {
  try {
    await chrome.storage.local.set({ captionWayTranscript: STATE.transcript });
  } catch (err) {
    logError("saveTranscript", err);
  }
}

async function loadTranscript() {
  try {
    const { captionWayTranscript } = await chrome.storage.local.get("captionWayTranscript");
    if (Array.isArray(captionWayTranscript)) {
      STATE.transcript = captionWayTranscript;
    }
  } catch (err) {
    logError("loadTranscript", err);
  }
}

// initial load
loadTranscript().catch(err => logError("initial loadTranscript", err));

// --- Relay commands to content script ---
async function sendToActiveMeet(tabId, payload) {
  if (!tabId) return;
  try {
    await chrome.tabs.sendMessage(tabId, payload);
    if (chrome.runtime.lastError) {
      logError("sendToActiveMeet.lastError", chrome.runtime.lastError.message);
    }
  } catch (err) {
    logError("sendToActiveMeet", err);
  }
}

// --- Find the current Meet tab (best-effort) ---
async function getMeetTab() {
  try {
    const tabs = await chrome.tabs.query({ url: "https://meet.google.com/*" });
    return tabs?.[0] || null;
  } catch (err) {
    logError("getMeetTab", err);
    return null;
  }
}

// --- Main message listener ---
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      switch (msg?.type) {
        case "POPUP_GET_STATE": {
          sendResponse({
            ok: true,
            isRecording: STATE.isRecording,
            transcriptCount: STATE.transcript.length
          });
          break;
        }

        case "POPUP_CLEAR": {
          STATE.transcript = [];
          await saveTranscript();
          sendResponse({ ok: true });
          break;
        }

        case "POPUP_START": {
          const tab = await getMeetTab();
          if (!tab || !tab.id) {
            sendResponse({ ok: false, error: "Open a Google Meet tab first." });
            return;
          }
          STATE.isRecording = true;
          await sendToActiveMeet(tab.id, { type: "START_CAPTURE" });
          sendResponse({ ok: true });
          break;
        }

        case "POPUP_STOP": {
          STATE.isRecording = false;
          const tab = await getMeetTab();
          if (tab && tab.id) {
            await sendToActiveMeet(tab.id, { type: "STOP_CAPTURE" });
          }
          sendResponse({ ok: true });
          break;
        }

        case "CONTENT_CHUNK": {
          try {
            if (msg.payload && Array.isArray(msg.payload)) {
              const seen = new Set(STATE.transcript.map(x => `${x.tsISO}:::${x.text}`));
              for (const it of msg.payload) {
                if (!it || !it.tsISO || !it.text) continue;
                const key = `${it.tsISO}:::${it.text}`;
                if (!seen.has(key)) {
                  STATE.transcript.push(it);
                  seen.add(key);
                }
              }
              STATE.transcript.sort((a, b) => a.tsISO.localeCompare(b.tsISO));
              await saveTranscript();
            }
            sendResponse({ ok: true, total: STATE.transcript.length });
          } catch (err) {
            logError("CONTENT_CHUNK", err);
            sendResponse({ ok: false, error: "Failed to process chunk." });
          }
          break;
        }

        case "POPUP_GET_TRANSCRIPT": {
          await loadTranscript();
          sendResponse({ ok: true, transcript: STATE.transcript });
          break;
        }

        default:
          sendResponse({ ok: false, error: "Unknown message." });
      }
    } catch (err) {
      logError("onMessage handler", err);
      try {
        sendResponse({ ok: false, error: err?.message || "Internal error" });
      } catch (respErr) {
        logError("sendResponse fallback", respErr);
      }
    }
  })();

  // Keep message channel open for async
  return true;
});

