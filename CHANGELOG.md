# Changelog – Caption Way

## [Unreleased]

### Added
- **PDF header & footer:**  
  - Added “Caption Way” text in the top-right corner of every page.  
  - Added footer note: *“The text generated here is completely dependent on Google Meet captions and internet connection. You may get inaccurate or incomplete text.”*

### Changed
- **Optimized permissions:**  
  - Removed unused `scripting` permission to comply with Chrome Web Store policies.
- **Improved local packaging:**  
  - Removed remotely hosted code from `jspdf.umd.min.js` to meet Manifest V3 requirements.
- **Performance tweaks:**  
  - Reduced unnecessary console logs.
  - Enhanced error handling in popup and content scripts.

### Fixed
- Minor bug fixes and UI improvements for smoother caption capturing.
- Stability improvements in PDF export process.

---

