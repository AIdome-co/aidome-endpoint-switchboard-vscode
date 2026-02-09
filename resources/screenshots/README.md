# Screenshots Needed for Marketplace

Before publishing to VS Code Marketplace, capture these screenshots:

1. **`wizard-detection.png`** — Wizard showing detected assistants with tier badges
2. **`wizard-profile.png`** — Profile creation flow (base_url + dialect)
3. **`verification-results.png`** — Verification pipeline results (7 steps)
4. **`diagnostics-report.png`** — Sample diagnostics report (redacted)
5. **`status-bar.png`** — Status bar showing profile status
6. **`profile-management.png`** — Profile CRUD QuickPick menu
7. **`generic-scanner.png`** — Generic scanner results with confidence scores

## Size Recommendations

- **Aspect Ratio**: Widescreen (16:9 or similar)
- **Recommended Dimensions**: 1200x800 or 1920x1080
- **Format**: PNG or JPEG
- **Quality**: High resolution for clarity

## Tips for Capturing Screenshots

- Use a clean VS Code theme (e.g., Dark+ or Light+)
- Close unnecessary panels to focus on the feature
- Highlight key UI elements or results
- Use realistic but safe sample data (no real API keys, endpoints should be examples like `gateway.example.com`)
- Ensure text is readable at marketplace display sizes

## Adding to package.json

Once screenshots are captured, add them to `package.json`:

```json
"galleryBanner": {
  "color": "#1e1e2e",
  "theme": "dark"
},
"icon": "resources/icon.png",
"screenshots": [
  "resources/screenshots/wizard-detection.png",
  "resources/screenshots/wizard-profile.png",
  "resources/screenshots/verification-results.png"
]
```
