// ========== popup.js (resilient version with improved lastError logging) ==========

// --- Centralized logger ---
function logError(context, error) {
  try {
    let msg = "";
    if (!error) {
      msg = "Unknown error";
    } else if (typeof error === "string") {
      msg = error;
    } else if (error.message) {
      msg = error.message;
    } else if (chrome && chrome.runtime && chrome.runtime.lastError && chrome.runtime.lastError.message) {
      msg = chrome.runtime.lastError.message;
    } else {
      msg = JSON.stringify(error, Object.getOwnPropertyNames(error));
    }
    console.error(`[${context}]`, msg);
  } catch (_) {
    // final fallback
    console.error(`[${context}] (non-serializable error)`);
  }
}

// Global safety nets
window.addEventListener("error", (e) => logError("window.error", e.error || e.message));
window.addEventListener("unhandledrejection", (e) => logError("unhandledrejection", e.reason));

// DOM refs
let liveBox, sessionsBox, statusEl, recStateEl, countEl;
try {
  liveBox = document.getElementById("liveBox");
  sessionsBox = document.getElementById("sessionsBox");
  statusEl = document.getElementById("status");
  recStateEl = document.getElementById("recState");
  countEl = document.getElementById("count");
} catch (e) {
  logError("DOM refs init", e);
}

// --- Helpers ---
function getActiveMeetTab(cb) {
  try {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (chrome.runtime.lastError) {
        logError("getActiveMeetTab.query", chrome.runtime.lastError.message);
        return cb(null);
      }
      const tab = Array.isArray(tabs) ? tabs[0] : null;
      if (!tab || !tab.id || !tab.url || !tab.url.includes("meet.google.com")) {
        return cb(null);
      }
      cb(tab);
    });
  } catch (e) {
    logError("getActiveMeetTab", e);
    cb(null);
  }
}

function safeSendMessage(tabId, msg, cb) {
  try {
    chrome.tabs.sendMessage(tabId, msg, (resp) => {
      if (chrome.runtime.lastError) {
        logError("safeSendMessage.sendMessage", chrome.runtime.lastError.message);
        return cb?.(null);
      }
      cb?.(resp);
    });
  } catch (e) {
    logError("safeSendMessage", e);
    cb?.(null);
  }
}

function setStatus(capturing) {
  try {
    if (!statusEl || !recStateEl) return;
    statusEl.className = capturing ? "pill capturing" : "pill idle";
    recStateEl.textContent = capturing ? "Capturing" : "Idle";
  } catch (e) {
    logError("setStatus", e);
  }
}

// --- Start ---
try {
  const startBtn = document.getElementById("startBtn");
  if (startBtn) {
    startBtn.addEventListener("click", () => {
      try {
        getActiveMeetTab((tab) => {
          if (!tab) {
            alert("⚠️ Please open Google Meet with captions enabled.");
            return;
          }
          safeSendMessage(tab.id, { type: "START_CAPTURE" }, (resp) => {
            try {
              if (resp?.ok) {
                setStatus(true);
                alert("🟢 Capture started");
                if (liveBox) liveBox.value = "";
              }
            } catch (e) {
              logError("startBtn.callback", e);
            }
          });
        });
      } catch (e) {
        logError("startBtn.handler", e);
      }
    });
  } else {
    logError("startBtn", "Start button not found in DOM");
  }
} catch (e) {
  logError("startBtn.init", e);
}

// --- Stop ---
try {
  const stopBtn = document.getElementById("stopBtn");
  if (stopBtn) {
    stopBtn.addEventListener("click", () => {
      try {
        getActiveMeetTab((tab) => {
          if (!tab) {
            alert("⚠️ Please open Google Meet first.");
            return;
          }
          safeSendMessage(tab.id, { type: "STOP_CAPTURE" }, (resp) => {
            try {
              if (resp?.ok) {
                setStatus(false);
                alert("🔴 Capture stopped");
                if (liveBox) liveBox.value = "";
                refreshSessions();
              }
            } catch (e) {
              logError("stopBtn.callback", e);
            }
          });
        });
      } catch (e) {
        logError("stopBtn.handler", e);
      }
    });
  } else {
    logError("stopBtn", "Stop button not found in DOM");
  }
} catch (e) {
  logError("stopBtn.init", e);
}

// --- Clear ---
try {
  const clearBtn = document.getElementById("clearBtn");
  if (clearBtn) {
    clearBtn.addEventListener("click", () => {
      try {
        getActiveMeetTab((tab) => {
          if (!tab) {
            alert("⚠️ Nothing to clear. Open Google Meet first.");
            return;
          }
          safeSendMessage(tab.id, { type: "CLEAR_CAPTIONS" }, (resp) => {
            try {
              if (resp?.ok) {
                setStatus(false);
                if (countEl) countEl.textContent = "0";
                alert("🗑 Cleared");
                if (liveBox) liveBox.value = "";
                if (sessionsBox) sessionsBox.innerHTML = "";
              }
            } catch (e) {
              logError("clearBtn.callback", e);
            }
          });
        });
      } catch (e) {
        logError("clearBtn.handler", e);
      }
    });
  } else {
    logError("clearBtn", "Clear button not found in DOM");
  }
} catch (e) {
  logError("clearBtn.init", e);
}

// --- Download PDF ---
try {
  const downloadBtn = document.getElementById("downloadPdf");
  if (downloadBtn) {
    downloadBtn.addEventListener("click", () => {
      try {
        getActiveMeetTab((tab) => {
          if (!tab) {
            alert("⚠️ No captions to export. Open Google Meet first.");
            return;
          }
          safeSendMessage(tab.id, { type: "GET_COMPLETED_SESSIONS" }, (response) => {
            try {
              const completedSessions = response?.completedSessions || [];
              const keywords = response?.keywords || [];

              if (completedSessions.length === 0) {
                alert("⚠️ Nothing to export");
                return;
              }

              const { jsPDF } = window.jspdf || {};
              if (!jsPDF) {
                alert("⚠️ PDF library not loaded.");
                return;
              }

              const doc = new jsPDF();
              doc.setFont("helvetica", "normal");
              doc.setFontSize(12);

              const margin = 15, maxWidth = 180, lineHeight = 8, pageHeight = 280;
              let y = margin;

              // --- Helper: add header & footer on current page ---
              function addHeaderFooter() {
                try {
                  const pageWidth = doc.internal.pageSize.getWidth();
                  const pageHeight = doc.internal.pageSize.getHeight();

                  // Header (top-right)
                  doc.setFont("helvetica", "italic");
                  doc.setFontSize(12);
                  doc.text("Caption Way", pageWidth - margin, 10, { align: "right" });

                  // Footer (bottom center)
                  doc.setFont("helvetica", "italic");
                  doc.setFontSize(9);
                  const note = "Note: Text in this PDF depends on Google Meet captions and your internet. Some text may be inaccurate.";
                  doc.text(note, pageWidth / 2, pageHeight - 10, { align: "center" });
                } catch (err) {
                  logError("addHeaderFooter", err);
                }
              }

              // First page header/footer
              addHeaderFooter();

              completedSessions.forEach((sessionText, idx) => {
                try {
                  if (idx > 0) {
                    y += lineHeight * 1.5;
                  }

                  const header = `Session ${idx + 1}:`;
                  doc.setFont("helvetica", "bold");
                  doc.setFontSize(13);
                  doc.text(header, margin, y);
                  y += lineHeight;

                  doc.setFont("helvetica", "normal");
                  doc.setFontSize(12);
                  const lines = doc.splitTextToSize(sessionText, maxWidth);

                  lines.forEach(line => {
                    if (y > pageHeight - lineHeight - 15) {
                      doc.addPage();
                      addHeaderFooter(); // add header/footer on new page
                      y = margin;
                    }

                    const lower = (line || "").toLowerCase();
                    if (lower.includes("important") || lower.includes("attention") || lower.includes("note this")) {
                      const textWidth = doc.getTextWidth(line);
                      doc.setFillColor(255, 255, 0);
                      doc.rect(margin - 2, y - 5, textWidth + 4, lineHeight + 2, "F");
                      doc.setFont("helvetica", "bold");
                      doc.text(line, margin, y);
                      doc.setFont("helvetica", "normal");
                    } else {
                      doc.text(line || "", margin, y);
                    }

                    y += lineHeight;
                  });
                } catch (e) {
                  logError("downloadPdf.sessionLoop", e);
                }
              });

              try {
                if (Array.isArray(keywords) && keywords.length > 0) {
                  if (y > pageHeight - 20) {
                    doc.addPage();
                    addHeaderFooter();
                    y = margin;
                  }

                  y += lineHeight * 2;
                  doc.setFont("helvetica", "bold");
                  doc.setFontSize(14);
                  doc.text("Suggestion YouTube Videos", margin, y);
                  y += lineHeight + 2;

                  doc.setFont("helvetica", "normal");
                  doc.setFontSize(12);

                  keywords.forEach((kw, i) => {
                    try {
                      const term = String(kw || "").trim();
                      if (!term) return;
                      const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(term + " lecture")}`;
                      const linkText = `${i + 1}. ${term} lecture`;
                      doc.setTextColor(0, 0, 255);
                      doc.textWithLink(linkText, margin, y, { url });
                      y += lineHeight;
                    } catch (e) {
                      logError("downloadPdf.keywordItem", e);
                    }
                  });

                  doc.setTextColor(0, 0, 0);
                }
              } catch (e) {
                logError("downloadPdf.keywords", e);
              }

              try {
                doc.save("captions.pdf");
              } catch (e) {
                logError("downloadPdf.save", e);
                alert("⚠️ Failed to save PDF. See console for details.");
              }
            } catch (e) {
              logError("downloadPdf.callback", e);
            }
          });
        });
      } catch (e) {
        logError("downloadPdf.handler", e);
      }
    });
  } else {
    logError("downloadPdf", "Download button not found in DOM");
  }
} catch (e) {
  logError("downloadPdf.init", e);
}

// // --- Download PDF ---
// try {
//   const downloadBtn = document.getElementById("downloadPdf");
//   if (downloadBtn) {
//     downloadBtn.addEventListener("click", () => {
//       try {
//         getActiveMeetTab((tab) => {
//           if (!tab) {
//             alert("⚠️ No captions to export. Open Google Meet first.");
//             return;
//           }
//           safeSendMessage(tab.id, { type: "GET_COMPLETED_SESSIONS" }, (response) => {
//             try {
//               const completedSessions = response?.completedSessions || [];
//               const keywords = response?.keywords || [];

//               if (completedSessions.length === 0) {
//                 alert("⚠️ Nothing to export");
//                 return;
//               }

//               const { jsPDF } = window.jspdf || {};
//               if (!jsPDF) {
//                 alert("⚠️ PDF library not loaded.");
//                 return;
//               }

//               const doc = new jsPDF();
//               doc.setFont("helvetica", "normal");
//               doc.setFontSize(12);

//               const margin = 15, maxWidth = 180, lineHeight = 8, pageHeight = 280;
//               let y = margin;

//               completedSessions.forEach((sessionText, idx) => {
//                 try {
//                   if (idx > 0) {
//                     y += lineHeight * 1.5;
//                   }

//                   const header = `Session ${idx + 1}:`;
//                   doc.setFont("helvetica", "bold");
//                   doc.setFontSize(13);
//                   doc.text(header, margin, y);
//                   y += lineHeight;

//                   doc.setFont("helvetica", "normal");
//                   doc.setFontSize(12);
//                   const lines = doc.splitTextToSize(sessionText, maxWidth);

//                   lines.forEach(line => {
//                     if (y > pageHeight - lineHeight) {
//                       doc.addPage();
//                       y = margin;
//                     }

//                     const lower = (line || "").toLowerCase();
//                     if (lower.includes("important") || lower.includes("attention") || lower.includes("note this")) {
//                       const textWidth = doc.getTextWidth(line);
//                       doc.setFillColor(255, 255, 0);
//                       doc.rect(margin - 2, y - 5, textWidth + 4, lineHeight + 2, "F");
//                       doc.setFont("helvetica", "bold");
//                       doc.text(line, margin, y);
//                       doc.setFont("helvetica", "normal");
//                     } else {
//                       doc.text(line || "", margin, y);
//                     }

//                     y += lineHeight;
//                   });
//                 } catch (e) {
//                   logError("downloadPdf.sessionLoop", e);
//                 }
//               });

//               try {
//                 if (Array.isArray(keywords) && keywords.length > 0) {
//                   if (y > pageHeight - 20) {
//                     doc.addPage();
//                     y = margin;
//                   }

//                   y += lineHeight * 2;
//                   doc.setFont("helvetica", "bold");
//                   doc.setFontSize(14);
//                   doc.text("Suggestion YouTube Videos", margin, y);
//                   y += lineHeight + 2;

//                   doc.setFont("helvetica", "normal");
//                   doc.setFontSize(12);

//                   keywords.forEach((kw, i) => {
//                     try {
//                       const term = String(kw || "").trim();
//                       if (!term) return;
//                       const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(term + " lecture")}`;
//                       const linkText = `${i + 1}. ${term} lecture`;
//                       doc.setTextColor(0, 0, 255);
//                       doc.textWithLink(linkText, margin, y, { url });
//                       y += lineHeight;
//                     } catch (e) {
//                       logError("downloadPdf.keywordItem", e);
//                     }
//                   });

//                   doc.setTextColor(0, 0, 0);
//                 }
//               } catch (e) {
//                 logError("downloadPdf.keywords", e);
//               }

//               try {
//                 doc.save("captions.pdf");
//               } catch (e) {
//                 logError("downloadPdf.save", e);
//                 alert("⚠️ Failed to save PDF. See console for details.");
//               }
//             } catch (e) {
//               logError("downloadPdf.callback", e);
//             }
//           });
//         });
//       } catch (e) {
//         logError("downloadPdf.handler", e);
//       }
//     });
//   } else {
//     logError("downloadPdf", "Download button not found in DOM");
//   }
// } catch (e) {
//   logError("downloadPdf.init", e);
// }

// --- Close ---
try {
  const closeBtn = document.getElementById("closeBtn");
  if (closeBtn) {
    closeBtn.addEventListener("click", () => {
      try {
        window.close();
      } catch (e) {
        logError("closeBtn.handler", e);
      }
    });
  } else {
    logError("closeBtn", "Close button not found in DOM");
  }
} catch (e) {
  logError("closeBtn.init", e);
}

// --- Listen for live updates from content script ---
try {
  chrome.runtime.onMessage.addListener((msg) => {
    try {
      if (!msg) return;
      if (msg.type === "LIVE_UPDATE" && liveBox) {
        liveBox.value += (msg.line ?? "") + "\n";
      }
      if (msg.type === "CLEAR_LIVE" && liveBox) {
        liveBox.value = "";
      }
    } catch (e) {
      logError("runtime.onMessage.handler", e);
    }
  });
} catch (e) {
  logError("runtime.onMessage.init", e);
}

// --- Refresh sessions view ---
function refreshSessions() {
  try {
    if (!sessionsBox) return;

    getActiveMeetTab((tab) => {
      if (!tab) return;

      safeSendMessage(tab.id, { type: "GET_COMPLETED_SESSIONS" }, (response) => {
        try {
          const completedSessions = response?.completedSessions || [];
          try {
            sessionsBox.innerHTML = "";
          } catch (e) {
            logError("refreshSessions.clear", e);
          }

          completedSessions.forEach((s, idx) => {
            try {
              const div = document.createElement("div");
              div.textContent = `Session ${idx + 1}\n${s ?? ""}`;
              sessionsBox.appendChild(div);
            } catch (e) {
              logError("refreshSessions.append", e);
            }
          });
        } catch (e) {
          logError("refreshSessions.callback", e);
        }
      });
    });
  } catch (e) {
    logError("refreshSessions", e);
  }
}

