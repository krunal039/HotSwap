# HotSwap - Chrome Extension for Development

**Author:** Krunal Patel  
**Version:** 2.0.0  
**License:** MIT  
**GitHub:** https://github.com/krunal039/HotSwap

A powerful Chrome extension that redirects, blocks, and manages URLs for development debugging. Perfect for PCF controls, Dynamic CRM, Power Apps, and other scenarios where you need to test local code against production environments.

---

## Features

### Core Features
- **URL Redirection** - Redirect any URL pattern to a different URL (e.g., production JS to localhost)
- **URL Blocking** - Block unwanted requests (analytics, ads, third-party scripts)
- **Capture Groups** - Use regex capture groups ($1, $2) for dynamic URL rewriting
- **Regex Support** - Use simple wildcards or full regex patterns for flexible matching

### Organization
- **Profiles** - Create multiple rule sets and switch between them instantly
- **Search/Filter** - Quickly find rules in large configurations
- **Import/Export** - Share configurations between browsers or team members

### Developer Experience
- **Dark Mode** - Easy on the eyes during late-night debugging
- **Keyboard Shortcut** - Ctrl+Shift+H (Cmd+Shift+H on Mac) to toggle on/off
- **Context Menu** - Right-click any link to add a rule for that URL
- **Redirect Counter** - Badge shows live count of redirected/blocked requests
- **Activity Logs** - View all redirected/blocked URLs in real-time
- **Debug Tools** - Test patterns and view active Chrome rules

### Technical
- **CSP Header Stripping** - Automatically removes Content-Security-Policy headers for localhost redirects
- **Cache-Busting** - Prevents browser caching issues with redirected resources
- **Per-Rule Enable/Disable** - Toggle individual rules without deleting them
- **Domain Filtering** - Limit rules to specific domains
- **Resource Type Filtering** - Filter by scripts, XHR, stylesheets, images, etc.

---

## Installation

### From Source (Developer Mode)

1. Download or clone this repository
2. Open Chrome and navigate to `chrome://extensions/`
3. Enable **Developer mode** (toggle in top-right corner)
4. Click **Load unpacked**
5. Select the extension folder
6. The extension icon will appear in your toolbar

---

## Usage

### Adding a Redirect Rule

1. Click the extension icon in your toolbar
2. Click **"+ Add New Rule"**
3. Fill in:
   - **Rule Name**: A descriptive name (e.g., "PCF Bundle Debug")
   - **Type**: Redirect or Block
   - **Source URL Pattern**: The URL to intercept
   - **Use Regex Pattern**: Check for regex, uncheck for simple wildcards
   - **Target URL**: Where to redirect (for Redirect rules)
   - **Limit to Domains** (optional): Only apply on specific domains
4. Click **Add Rule**

### Pattern Examples

#### Simple Patterns (Regex unchecked)
```
*bundle*.js                    → Matches any URL containing "bundle" ending in ".js"
*://cdn.example.com/*.js       → Matches any JS file from cdn.example.com
*dynamics.com*bundle.js        → Matches bundle.js from any dynamics.com subdomain
```

#### Regex Patterns (Regex checked)
```
.*bundle\.[A-Z0-9]+\.js$       → Matches bundle.HASH.js files
.*\.dynamics\.com/.*\.js       → Matches any JS from dynamics.com subdomains
https://.*\.powerapps\.com/.*  → Matches any powerapps.com URL
```

#### Capture Groups (Regex + dynamic replacement)
```
Source: .*/resource/(.*\.js)$
Target: http://localhost:8181/$1
Result: Preserves the filename while changing the host
```

### PCF Control Development Example

```
Name: PCF Bundle Debug
Type: Redirect
Source URL: *bundle*.js
Use Regex: ☐ (unchecked)
Target URL: https://localhost:8181/bundle.js
Domains: crm.dynamics.com
```

### Blocking Analytics Example

```
Name: Block Analytics
Type: Block
Source URL: *google-analytics.com*
Use Regex: ☐ (unchecked)
```

---

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+Shift+H` (Windows/Linux) | Toggle HotSwap on/off |
| `Cmd+Shift+H` (Mac) | Toggle HotSwap on/off |

---

## Profiles

Profiles let you maintain different rule sets for different projects or environments.

1. Click the profile dropdown in the header
2. Click the menu button (⋮)
3. Choose:
   - **New Profile** - Create an empty profile
   - **Duplicate Profile** - Copy current profile with all rules
   - **Delete Profile** - Remove current profile (can't delete Default)

Switch between profiles instantly using the dropdown.

---

## Features In Detail

### Dark Mode

Click the moon icon (🌙) in the header to toggle dark mode. Your preference is saved.

### CSP Header Stripping

When redirecting to localhost, browsers often block the request due to Content-Security-Policy headers. This extension automatically strips CSP headers from configured domains.

Toggle with the **"Strip CSP Headers"** checkbox.

### Redirect Counter Badge

The extension badge shows the count of redirected/blocked requests in the current session. This helps verify your rules are working.

### Activity Logs

View all activity in the **Logs** tab:
- Original URL
- Redirected URL (for redirects)
- Rule name that matched
- Request type
- Action (REDIRECT or BLOCK)

### Debug Tools

In the **Settings** tab:
- **View Active Chrome Rules** - See what rules are actually registered
- **Test Pattern** - Test if your pattern matches a URL before adding a rule

---

## Troubleshooting

### Rules not working?

1. Check the extension badge shows a number (active rules count)
2. Verify global toggle is ON
3. Verify individual rule is enabled
4. Go to Settings → Click "View Active Chrome Rules"
   - If empty, your pattern syntax is invalid
5. Use "Test Pattern" to verify your pattern matches the URL

### Invalid Regex Pattern

If using regex (checkbox checked), remember:
- `*` means "zero or more of previous character" - use `.*` for "match anything"
- Escape dots with `\.`
- `^` means start, `$` means end
- Use parentheses `()` to create capture groups

**Wrong:** `*bundle*.js` (with regex checked)  
**Right:** `.*bundle.*\.js` (with regex checked)  
**Right:** `*bundle*.js` (with regex unchecked)

### CSP Errors

If you see "violates Content Security Policy":
1. Make sure "Strip CSP Headers" is checked
2. Add the page's domain to your rule's "Limit to Domains" field
3. Hard refresh the page (Ctrl+Shift+R)

### Caching Issues

If redirects only work on hard refresh:
1. Open DevTools (F12)
2. Go to Network tab
3. Check "Disable cache"
4. Or use Ctrl+Shift+R for hard refresh

The extension automatically adds cache-busting headers, but browser cache from before the rule was added may persist.

---

## Technical Details

- **Manifest Version:** 3 (latest Chrome extension format)
- **API:** declarativeNetRequest (efficient, non-blocking)
- **Storage:** chrome.storage.local
- **Max Rules:** ~5000 dynamic rules supported

---

## Changelog

### v1.1.0
- **Block URLs** - New rule type to block requests entirely
- **Capture Groups** - Use $1, $2 in redirect URLs with regex
- **Profiles** - Create and switch between multiple rule sets
- **Dark Mode** - Toggle with moon icon
- **Keyboard Shortcut** - Ctrl+Shift+H to toggle
- **Context Menu** - Right-click to add rule for any URL
- **Redirect Counter** - Badge shows live redirect count
- **Search/Filter** - Find rules quickly
- **Stats Dashboard** - See redirect/block counts in Logs tab
- Improved UI/UX

### v1.0.0
- Initial release
- URL redirection with simple and regex patterns
- CSP header stripping
- Redirect logging
- Import/Export functionality
- Debug tools

---

## Contributing

Contributions are welcome! Feel free to submit issues or pull requests.

---

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

---

## Author

**Krunal Patel**

Created for PCF control development and Dynamics 365/Power Apps debugging.
