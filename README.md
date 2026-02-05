# URL Override - Chrome Extension for Development

**Author:** Krunal Patel  
**Version:** 1.0.0  
**License:** MIT

A Chrome extension that redirects URLs from production to localhost for development debugging. Perfect for PCF controls, Dynamic CRM, Power Apps, and other scenarios where you need to test local code against production environments.

---

## Features

- **URL Redirection** - Redirect any URL pattern to a different URL (e.g., production JS to localhost)
- **Regex Support** - Use simple wildcards or full regex patterns for flexible matching
- **Per-Rule Enable/Disable** - Toggle individual rules on/off without deleting them
- **Global Enable/Disable** - Quickly turn all redirects on/off
- **Domain Filtering** - Limit rules to specific domains (e.g., only on crm.dynamics.com)
- **Resource Type Filtering** - Filter by scripts, XHR, stylesheets, images, etc.
- **CSP Header Stripping** - Automatically removes Content-Security-Policy headers to allow localhost redirects
- **Redirect Logging** - View all redirected URLs in real-time
- **Import/Export** - Share configurations between browsers or team members
- **Debug Tools** - Test patterns and view active Chrome rules

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
2. Go to the **Add Rule** tab
3. Fill in:
   - **Rule Name**: A descriptive name (e.g., "PCF Bundle Debug")
   - **Source URL Pattern**: The URL to intercept
   - **Use Regex Pattern**: Check for regex, uncheck for simple wildcards
   - **Target URL**: Where to redirect (usually localhost)
   - **Limit to Domains** (optional): Only apply on specific domains
   - **Resource Types**: What types of requests to intercept
   - **Priority**: Higher numbers = higher priority

4. Click **Add Rule**

### Pattern Examples

#### Simple Patterns (Regex unchecked)
```
*bundle*.js                    → Matches any URL containing "bundle" and ending in ".js"
*://cdn.example.com/*.js       → Matches any JS file from cdn.example.com
*dynamics.com*bundle.js        → Matches bundle.js from any dynamics.com subdomain
```

#### Regex Patterns (Regex checked)
```
.*bundle\.[A-Z0-9]+\.js$       → Matches bundle.HASH.js files
.*\.dynamics\.com/.*\.js       → Matches any JS from dynamics.com subdomains
https://.*\.powerapps\.com/.*  → Matches any powerapps.com URL
```

### PCF Control Development Example

```
Name: PCF Bundle Debug
Source URL: *bundle*.js
Use Regex: ☐ (unchecked)
Target URL: https://localhost:8181/bundle.js
Domains: crm.dynamics.com
```

---

## Features In Detail

### CSP Header Stripping

When redirecting to localhost, browsers often block the request due to Content-Security-Policy headers. This extension automatically strips CSP headers from configured domains, allowing localhost connections.

Toggle this feature with the **"Strip CSP Headers"** checkbox in the header.

### Redirect Logging

View all redirected URLs in the **Logs** tab:
- Original URL (crossed out)
- Target URL (redirected to)
- Rule name that matched
- Timestamp

### Debug Tools

In the **Import/Export** tab, find debug tools:
- **View Active Chrome Rules** - See what rules are actually registered
- **Test Pattern** - Test if your pattern matches a URL

---

## Troubleshooting

### Rules not working?

1. Check the extension badge shows a number (active rules count)
2. Verify global toggle is ON
3. Verify individual rule is enabled
4. Go to Import/Export → Click "View Active Chrome Rules"
   - If empty, your pattern syntax is invalid
5. Use "Test Pattern" to verify your pattern matches the URL

### Invalid Regex Pattern

If using regex (checkbox checked), remember:
- `*` means "zero or more of previous character" - use `.*` for "match anything"
- Escape dots with `\.`
- `^` means start, `$` means end

**Wrong:** `*bundle*.js` (with regex checked)  
**Right:** `.*bundle.*\.js` (with regex checked)  
**Right:** `*bundle*.js` (with regex unchecked)

### CSP Errors

If you see "violates Content Security Policy":
1. Make sure "Strip CSP Headers" is checked
2. Add the page's domain to your rule's "Limit to Domains" field
3. Hard refresh the page (Ctrl+Shift+R)

---

## Technical Details

- **Manifest Version:** 3 (latest Chrome extension format)
- **API:** declarativeNetRequest (efficient, non-blocking redirects)
- **Storage:** chrome.storage.local
- **Max Rules:** ~5000 dynamic rules supported

---

## Changelog

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

Copyright (c) 2024 Krunal Patel

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
