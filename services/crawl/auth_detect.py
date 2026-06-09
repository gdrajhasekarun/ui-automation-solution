"""
Shared auth detection helpers used by both crawl4ai_phase and playwright_phase.

DETECTOR_FN_JS  — browser-side JS that locates identity/secret/submit selectors.
build_autofill_js   — wraps detector in a full IIFE for Crawl4AI js_code injection.
auto_credentials    — resolves identity + secret values from env.
has_auto_credentials — returns True when both env vars are non-empty.
"""

import os
import re

# ---------------------------------------------------------------------------
# Browser-side detector function (runs inside page.evaluate / js_code)
# Returns: { identitySel, secretSel, submitSel, hasPassword }
# ---------------------------------------------------------------------------
DETECTOR_FN_JS = r"""
(function detectLoginForm() {
    function rank(el, keywords) {
        const hay = [el.name, el.id, el.placeholder,
                     el.getAttribute('aria-label'),
                     el.getAttribute('autocomplete')].join(' ').toLowerCase();
        return keywords.reduce((s, k) => s + (hay.includes(k) ? 1 : 0), 0);
    }

    function cssPath(el) {
        if (el.id) return '#' + CSS.escape(el.id);
        const name = el.getAttribute('name');
        if (name) return el.tagName.toLowerCase() + '[name="' + CSS.escape(name) + '"]';
        // nth-of-type fallback
        let path = '', node = el;
        while (node && node !== document.body) {
            const tag = node.tagName.toLowerCase();
            const idx = Array.from(node.parentElement
                ? node.parentElement.children : [])
                .filter(c => c.tagName === node.tagName).indexOf(node) + 1;
            path = tag + ':nth-of-type(' + idx + ')' + (path ? ' > ' + path : '');
            node = node.parentElement;
        }
        return path;
    }

    const inputs = Array.from(document.querySelectorAll('input:not([type=hidden])'));

    // ── Secret field ─────────────────────────────────────────────────────────
    const secretKeywords = ['pass', 'pin', 'passcode', 'secret', 'otp', 'password'];
    let secretEl = inputs.find(i => i.type === 'password');
    if (!secretEl) {
        secretEl = inputs
            .filter(i => ['tel', 'number', 'text'].includes(i.type))
            .sort((a, b) => rank(b, secretKeywords) - rank(a, secretKeywords))
            .find(i => rank(i, secretKeywords) > 0);
    }

    // ── Identity field ───────────────────────────────────────────────────────
    const identityKeywords = ['user', 'email', 'login', 'account', 'member', 'id', 'username'];
    let identityEl = inputs.find(i => i.type === 'email');
    if (!identityEl) {
        const candidates = inputs.filter(i =>
            ['text', 'tel'].includes(i.type) && i !== secretEl
        );
        // prefer the visible input that appears before secretEl
        const secretIdx = secretEl ? inputs.indexOf(secretEl) : inputs.length;
        const before = candidates.filter(i => inputs.indexOf(i) < secretIdx);
        identityEl = (before.length ? before : candidates)
            .sort((a, b) => rank(b, identityKeywords) - rank(a, identityKeywords))[0];
    }

    // ── Submit control ───────────────────────────────────────────────────────
    const submitRe = /log\s?in|sign\s?in|continue|submit|next|proceed/i;
    let submitSel = null;
    const form = (secretEl || identityEl) && (secretEl || identityEl).closest('form');
    if (form) {
        const btn = form.querySelector('button[type=submit],input[type=submit]');
        if (btn) submitSel = cssPath(btn);
    }
    if (!submitSel) {
        const all = Array.from(document.querySelectorAll('button,a,input[type=submit]'));
        const match = all.find(el =>
            submitRe.test(el.textContent || el.value || el.getAttribute('aria-label') || ''));
        if (match) submitSel = cssPath(match);
    }

    return {
        identitySel: identityEl ? cssPath(identityEl) : null,
        secretSel:   secretEl   ? cssPath(secretEl)   : null,
        submitSel:   submitSel,
        hasPassword: secretEl ? secretEl.type === 'password' : false,
    };
})()
"""


def build_autofill_js(identity: str, secret: str, success_indicator: str | None = None) -> str:
    """
    Returns a self-contained IIFE for use as Crawl4AI js_code.
    Embeds DETECTOR_FN_JS, fills fields via native value setter + events
    (required for React/Vue controlled inputs), clicks submit, then retries
    once after 1.5 s to handle multi-step logins (identity → password page).
    """
    esc_identity = identity.replace("'", "\\'").replace("\\", "\\\\")
    esc_secret   = secret.replace("'", "\\'").replace("\\", "\\\\")

    return f"""
(async function autoLogin() {{
    function detectForm() {{
        return {DETECTOR_FN_JS};
    }}

    function nativeFill(el, value) {{
        const nativeSetter = Object.getOwnPropertyDescriptor(
            el.tagName === 'TEXTAREA'
                ? window.HTMLTextAreaElement.prototype
                : window.HTMLInputElement.prototype,
            'value'
        ).set;
        nativeSetter.call(el, value);
        el.dispatchEvent(new Event('input',  {{bubbles: true}}));
        el.dispatchEvent(new Event('change', {{bubbles: true}}));
    }}

    async function doFill() {{
        const d = detectForm();
        if (d.identitySel) {{
            const el = document.querySelector(d.identitySel);
            if (el) nativeFill(el, '{esc_identity}');
        }}
        if (d.secretSel) {{
            const el = document.querySelector(d.secretSel);
            if (el) nativeFill(el, '{esc_secret}');
        }}
        if (d.submitSel) {{
            const btn = document.querySelector(d.submitSel);
            if (btn) btn.click();
        }} else if (d.secretSel) {{
            const el = document.querySelector(d.secretSel);
            if (el) el.dispatchEvent(new KeyboardEvent('keypress', {{key:'Enter', bubbles:true}}));
        }}
    }}

    await doFill();
    await new Promise(r => setTimeout(r, 1500));
    // Second pass — covers multi-step (identity page → password page)
    await doFill();
}})();
"""


def _resolve(placeholder: str) -> str:
    """Resolve ${VAR} or plain string from environment."""
    m = re.match(r'^\$\{([^}]+)\}$', placeholder.strip())
    if m:
        return os.environ.get(m.group(1), "")
    return placeholder


def auto_credentials(auth: dict) -> tuple[str, str]:
    """Return (identity, secret) resolved from env vars defined in auth config."""
    identity = _resolve(auth.get("identityEnv", "${APP_USERNAME}"))
    secret   = _resolve(auth.get("secretEnv",   "${APP_PASSWORD}"))
    return identity, secret


def has_auto_credentials(auth: dict) -> bool:
    """True when both identity and secret env vars resolve to non-empty strings."""
    identity, secret = auto_credentials(auth)
    return bool(identity and secret)
