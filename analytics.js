/**
 * Analytics wrapper: initializes dataLayer/gtag and exposes
 * normalized, debounced tracking helpers.
 */
(function () {
    // Ensure dataLayer and a safe gtag function exist so events can be queued
    window.dataLayer = window.dataLayer || [];
    if (typeof window.gtag !== 'function') {
        window.gtag = function () { window.dataLayer.push(arguments); };
    }

    // Basic config (will be ignored if real gtag config runs later)
    try {
        window.gtag('js', new Date());
        window.gtag('config', 'G-J3ZKY02K30', { cookie_domain: 'auto' });
    } catch (e) {
        // ignore
    }

    // Debounce helper for high-frequency events
    const debounceTimers = new Map();
    function debounce(key, fn, wait = 250) {
        if (debounceTimers.has(key)) clearTimeout(debounceTimers.get(key));
        const t = setTimeout(() => { debounceTimers.delete(key); fn(); }, wait);
        debounceTimers.set(key, t);
    }

    // Normalize and send event to gtag (or queued dataLayer)
    function sendEvent(name, params = {}, options = {}) {
        const normalized = normalizeEvent(name, params);

        const doSend = () => {
            try {
                window.gtag('event', normalized.name, normalized.params);
            } catch (e) {
                // fallback to dataLayer push
                window.dataLayer.push(['event', normalized.name, normalized.params]);
            }
        };

        if (options.debounce) {
            debounce(normalized.name, doSend, options.debounceMs || 800);
        } else {
            doSend();
        }
    }

    // Map various input event names to consistent analytics names/params
    function normalizeEvent(name, params) {
        const p = Object.assign({}, params);
        let normalizedName = String(name);

        switch (normalizedName) {
            case 'delay_time':
            case 'adjust_delay':
                normalizedName = 'adjust_delay';
                p.event_category = p.event_category || 'user_action';
                p.event_label = p.event_label || `delay:${p.value || p}`;
                break;
            case 'input_gain':
            case 'adjust_input_gain':
                normalizedName = 'adjust_input_gain';
                p.event_category = p.event_category || 'user_action';
                p.event_label = p.event_label || `gain:${p.value || p}`;
                break;
            case 'start_daf':
            case 'stop_daf':
                normalizedName = normalizedName;
                p.event_category = p.event_category || 'daf_usage';
                p.event_label = p.event_label || '';
                break;
            case 'device_switch':
                normalizedName = 'device_switch';
                p.event_category = p.event_category || 'hardware';
                break;
            case 'faq_interaction':
                normalizedName = 'faq_interaction';
                p.event_category = p.event_category || 'ui';
                break;
            default:
                normalizedName = normalizedName.replace(/\s+/g, '_').toLowerCase();
                p.event_category = p.event_category || 'engagement';
        }

        return { name: normalizedName, params: p };
    }

    // Public helpers
    function trackDAFEvent(action, label) {
        sendEvent(action, { event_label: label, event_category: 'daf_usage' });
    }

    function trackControlEvent(controlName, value) {
        // Debounce high-frequency control adjustments
        sendEvent('adjust_settings', { event_label: `${controlName}: ${value}`, control: controlName, value }, { debounce: true, debounceMs: 800 });
    }

    function trackErrorEvent(errorType, errorMessage) {
        sendEvent('error', { event_category: 'daf_errors', event_label: `${errorType}: ${errorMessage}` });
    }

    function trackPageView(pagePath, additionalParams = {}) {
        try {
            window.gtag('event', 'page_view', Object.assign({ page_path: pagePath }, additionalParams));
        } catch (e) {
            window.dataLayer.push(['event', 'page_view', Object.assign({ page_path: pagePath }, additionalParams)]);
        }
    }

    // Expose on window
    window.trackDAFEvent = trackDAFEvent;
    window.trackControlEvent = trackControlEvent;
    window.trackErrorEvent = trackErrorEvent;
    window.trackPageView = trackPageView;
    window.sendAnalyticsEvent = sendEvent;

})();