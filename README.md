# HotSwap v3.0.0

Advanced URL redirect, block, and header modification Chrome extension for development debugging.

**Author:** Krunal Patel  
**License:** MIT  
**GitHub:** [https://github.com/krunal039/HotSwap](https://github.com/krunal039/HotSwap)

## Features

### Core Functionality
- **URL Redirect** - Replace production URLs with localhost for debugging
- **URL Block** - Block unwanted requests (analytics, ads, etc.)
- **Header Modification** - Add, remove, or modify request/response headers
- **Regex Support** - Full regex patterns with capture groups ($1, $2, etc.)
- **Wildcard Patterns** - Simple `*` wildcards for quick matching

### Organization
- **Rule Groups** - Organize rules into groups (PCF, API, Blocking, etc.)
- **Rule Colors** - Color-code rules for visual organization
- **Profiles** - Switch between different rule sets quickly
- **Search & Filter** - Find rules by name, pattern, or group

### Developer Experience
- **Templates** - Quick-start templates for common scenarios
- **Undo/Redo** - Revert changes with Ctrl+Z / Ctrl+Y
- **Drag & Drop** - Reorder rules by dragging
- **Bulk Actions** - Enable/disable/delete multiple rules at once
- **Duplicate Detection** - Warning when adding similar patterns
- **Domain Toggle** - Quick toggle rules for current domain

### Keyboard Shortcuts
- `Ctrl+Shift+H` (Mac: `Cmd+Shift+H`) - Toggle HotSwap on/off
- `Ctrl+Z` - Undo last action
- `Ctrl+Y` - Redo action
- `↑/↓` - Navigate rules
- `Enter` - Edit selected rule
- `Delete` - Delete selected rule
- `Space` - Toggle selected rule

### Monitoring
- **Live Stats** - Real-time redirect/block/header counts
- **Activity Logs** - Full URL logging with timestamps
- **Export CSV** - Export logs and stats to CSV
- **Debug Tools** - View active Chrome rules, test patterns

### Technical
- **CSP Stripping** - Automatically removes Content-Security-Policy headers
- **Cache Busting** - Prevents browser caching of redirected resources
- **Per-Rule Toggle** - Enable/disable individual rules
- **Priority Control** - Set rule priorities for ordering
- **Resource Type Filtering** - Filter by script, XHR, CSS, image, etc.

## Installation

1. Clone or download this repository
2. Open Chrome and go to `chrome://extensions/`
3. Enable "Developer mode" (toggle in top right)
4. Click "Load unpacked" and select the extension folder
5. Pin HotSwap to your toolbar for easy access

## Quick Start

1. Click the HotSwap icon in your toolbar
2. Click **"+ Add Rule"**
3. Enter a **Rule Name** (e.g., "My PCF Debug")
4. Select **Type**: Redirect, Block, or Modify Headers
5. Enter **Source URL Pattern** (e.g., `*bundle*.js`)
6. Enter **Target URL** for redirects (e.g., `http://localhost:8181/bundle.js`)
7. Click **Add Rule** and refresh your page!

## Templates

Click the **Templates** tab for pre-configured rules:

| Template | Description |
|----------|-------------|
| PCF Control Debug | Redirect PCF bundle.js to localhost |
| React DevTools | Enable React DevTools in production |
| Block Analytics | Block Google Analytics tracking |
| Block Ads | Block common ad networks |
| Local API | Redirect API calls to localhost |
| Add CORS Headers | Add permissive CORS headers |
| Disable Cache | Add no-cache headers |
| Custom Header | Add custom request headers |

## Pattern Examples

### Simple Wildcards (Regex OFF)
```
*bundle*.js              - Match any URL containing "bundle" ending in .js
*cdn.example.com/*.js    - Match JS files from cdn.example.com
*/api/v1/*               - Match any API v1 endpoint
```

### Regex Patterns (Regex ON)
```
.*/(bundle\.[A-Z0-9]+\.js)$    - Capture versioned bundle filename
.*/api/v(\d+)/.*               - Capture API version number
^https://.*\.example\.com/.*   - Match all subdomains
```

### Capture Groups
Source: `.*/(bundle\.[A-Z0-9]+\.js)$`  
Target: `http://localhost:8181/$1`  
Result: Redirects `https://cdn.example.com/bundle.ABC123.js` to `http://localhost:8181/bundle.ABC123.js`

## Header Modification

Add, remove, or modify HTTP headers:

```
Operation: Set | Remove | Append
Type: Request | Response
Header: Content-Type, Authorization, X-Custom-Header, etc.
Value: The header value (not needed for Remove)
```

### Examples
- **Add Auth Header**: Set Request `Authorization` = `Bearer token123`
- **Enable CORS**: Set Response `Access-Control-Allow-Origin` = `*`
- **Remove CSP**: Remove Response `Content-Security-Policy`
- **Disable Cache**: Set Request `Cache-Control` = `no-cache`

## Profiles

Create multiple profiles for different debugging scenarios:

1. Click the profile dropdown in the header
2. Click the menu button (⋮)
3. Choose: New Profile, Duplicate, Rename, or Delete

Profiles are completely isolated - each has its own set of rules.

## PCF Development Example

Debugging a Power Apps PCF control:

1. **Add Rule**:
   - Name: `MyControl Bundle`
   - Type: `Redirect`
   - Source: `*mycontrol*bundle.js`
   - Target: `http://localhost:8181/bundle.js`
   - Domain: `make.powerapps.com`

2. Enable **Strip CSP Headers** (checked by default)

3. Start your local dev server: `npm start`

4. Refresh Power Apps and your local code will load!

## Troubleshooting

### Rules not working?
1. Go to **Settings** tab
2. Click **"View Chrome Rules"**
3. If empty, your pattern is invalid
4. Use **"Test Pattern"** to validate

### CSP errors?
1. Ensure **"Strip CSP"** is checked in the header
2. Add specific domains to the "Limit to Domains" field

### Cached responses?
1. HotSwap auto-adds cache-busting headers
2. Open DevTools → Network → check "Disable cache"
3. Do a hard refresh (Ctrl+Shift+R)

### Regex not matching?
- Don't use `*` alone - use `.*` for "match anything"
- Escape dots: `\.` not `.`
- Test your pattern in Settings → Test Pattern

## Changelog

### v3.0.0
- **Header Modification** - Add/remove/modify request and response headers
- **Rule Groups & Colors** - Organize and color-code rules
- **Templates** - Quick-start templates for common scenarios
- **Undo/Redo** - Full undo/redo support with Ctrl+Z/Y
- **Drag & Drop Reorder** - Reorder rules by dragging
- **Bulk Actions** - Select and manage multiple rules at once
- **Duplicate Detection** - Warning for similar patterns
- **Domain Toggle** - Quick toggle rules for current domain
- **Keyboard Navigation** - Full keyboard support for power users
- **Export CSV** - Export logs and stats to CSV
- **Improved UI** - Cleaner, more compact design
- **Better Performance** - Optimized rule application

### v2.0.0
- Profiles for multiple rule sets
- Block rules
- Regex capture groups
- Dark mode
- Context menu integration
- Keyboard shortcut
- Live stats

### v1.0.0
- Initial release
- URL redirect rules
- Wildcard patterns
- CSP stripping

## License

MIT License

Copyright (c) 2026 Krunal Patel

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
