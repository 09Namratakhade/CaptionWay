// ========== content.js (resilient version with safeSendMessage & improved logging) ==========

// Logger
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

console.log("📩 Content script loaded into Meet!");

// Storage
let currentSessionLines = [];   // live buffer during capture
let allSessions = [];           // finalized sessions for export
let seenLines = new Set();      // all unique lines ever captured
let isCapturing = false;

// Stopword list for topic detection
const STOPWORDS = new Set([
  "hello","important","very","hi","morning","evening","afternoon","good","yes","session",
  "lecture","today","no","ok","okay","thanks","thank","please","great",
  "the","and","for","are","was","now","every","were","with","this","that",
  "what","you","your","mine","i","he","she","know","it","we","they","is",
  "am","a","an","or","but","of","to","in","on","do","does","did","at","by",
  "from","as","have","has","had","will","would","can","could","why","not","should",
  "shall","may","might","so","let","s","all","hardware","say","actully","here"
]);

// Academic boost keywords
const academicKeywords = new Set([
  "math","algorithm","data structure","array","data","science","engineering",
  "computer","memory","data structure","file system","operating system","windows","linux",
  "programming","ai","history","algorithm","geography","economics","machine","learning"
]);

// Word frequency store
let wordFrequency = {};

// ---- Safe message wrapper ----
function safeSendMessage(message, callback) {
  try {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        logError(`${message?.type || "UNKNOWN"}`, chrome.runtime.lastError.message);
        if (callback) callback(undefined);
        return;
      }
      if (callback) callback(response);
    });
  } catch (err) {
    logError(`${message?.type || "UNKNOWN"}`, err);
    if (callback) callback(undefined);
  }
}

// Utility: update word frequencies with heuristic filtering + boost
function updateWordFrequency(text) {
  try {
    if (!text || typeof text !== "string") return;

    const words = text.toLowerCase().split(/\s+/);
    words.forEach(w => {
      let clean = w.replace(/[^a-z]/gi, "");
      if (!clean || STOPWORDS.has(clean) || clean.length < 4) return;

      // skip common verb forms unless they are technical terms
      if ((clean.endsWith("ing") || clean.endsWith("ed")) && !academicKeywords.has(clean)) {
        return;
      }

      // boost academic terms
      const weight = academicKeywords.has(clean) ? 3 : 1;
      wordFrequency[clean] = (wordFrequency[clean] || 0) + weight;
    });
  } catch (err) {
    logError("updateWordFrequency", err);
  }
}

// Poll captions only while capturing
function pollCaptions() {
  try {
    if (!isCapturing) {
      return setTimeout(pollCaptions, 300);
    }

    const container = document.querySelector("div.a4cQT");
    if (!container) {
      return setTimeout(pollCaptions, 500);
    }

    const captionEl = container.querySelector("div.ygicle.VbkSUe");
    if (!captionEl) {
      return setTimeout(pollCaptions, 200);
    }

    const text = captionEl.innerText?.trim();
    if (text && text !== currentSessionLines[currentSessionLines.length - 1]) {
      currentSessionLines.push(text);
      safeSendMessage({ type: "LIVE_UPDATE", line: text });
    }
  } catch (err) {
    logError("pollCaptions", err);
  } finally {
    setTimeout(pollCaptions, 200);
  }
}
pollCaptions();

// Extract top keywords from sessions
function extractTopKeywords(sessions, k = 3) {
  try {
    if (!Array.isArray(sessions)) return [];
    const counts = new Map();

    sessions.forEach(text => {
      (text.toLowerCase().match(/[a-z0-9]+/g) || [])
        .filter(w => !STOPWORDS.has(w))
        .forEach(w => counts.set(w, (counts.get(w) || 0) + 1));
    });

    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, k)
      .map(([w]) => w);
  } catch (err) {
    logError("extractTopKeywords", err);
    return [];
  }
}

// Message listener
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  try {
    if (!msg || !msg.type) {
      sendResponse?.({ ok: false });
      return;
    }

    switch (msg.type) {
      case "START_CAPTURE":
        currentSessionLines = []; // fresh buffer for this session
        isCapturing = true;
        sendResponse?.({ ok: true });
        break;

      case "STOP_CAPTURE":
        isCapturing = false;
        try {
          if (currentSessionLines.length > 0) {
            const finalText = currentSessionLines[currentSessionLines.length - 1];
            const words = finalText.split(/\s+/);
            const uniqueWords = words.filter(w => !seenLines.has(w));

            if (uniqueWords.length > 0) {
              const sessionText = uniqueWords.join(" ");
              allSessions.push(sessionText);
              uniqueWords.forEach(w => seenLines.add(w));
            }
          }
        } catch (err) {
          logError("STOP_CAPTURE processing", err);
        }

        currentSessionLines = [];
        safeSendMessage({ type: "CLEAR_LIVE" });
        sendResponse?.({ ok: true });
        break;

      case "CLEAR_CAPTIONS":
        currentSessionLines = [];
        allSessions = [];
        seenLines.clear();
        isCapturing = false;
        safeSendMessage({ type: "CLEAR_LIVE" });
        sendResponse?.({ ok: true });
        break;

      case "GET_COMPLETED_SESSIONS":
        const keywords = extractTopKeywords(allSessions, 3);
        sendResponse?.({ completedSessions: allSessions, keywords });
        break;

      default:
        sendResponse?.({ ok: false });
    }
  } catch (err) {
    logError("onMessage", err);
    try { sendResponse?.({ ok: false, error: err.message }); } catch {}
  }

  // Return true to keep sendResponse async safe
  return true;
});

