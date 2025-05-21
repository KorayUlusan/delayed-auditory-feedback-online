/**
 * Google Analytics Event Tracking
 * This file contains functions for tracking user interactions with Google Analytics
 */

// Initialize Google Analytics
(function initAnalytics() {
    window.dataLayer = window.dataLayer || [];
    function gtag() { dataLayer.push(arguments); }

    // Wait for the Google Analytics script to load
    if (typeof gtag === 'undefined') {
        console.warn('Google Analytics script not yet loaded. Retrying initialization...');
        const retryInterval = setInterval(() => {
            if (typeof gtag === 'function') {
                clearInterval(retryInterval);
                gtag('js', new Date());
                gtag('config', 'G-J3ZKY02K30', {
                    cookie_domain: 'auto',
                });
                console.log('Google Analytics initialized successfully.');
            }
        }, 100); // Retry every 100ms
    } else {
        gtag('js', new Date());
        gtag('config', 'G-J3ZKY02K30', {
            cookie_domain: 'auto',
        });
        console.log('Google Analytics initialized successfully.');
    }
})();

/**
 * Track DAF usage events
 * @param {string} action - The action performed (e.g., 'start', 'stop')
 * @param {string} label - Additional information about the event
 */
function trackDAFEvent(action, label) {
    if (typeof gtag !== 'function') return;
    
    gtag('event', action, {
        'event_category': 'daf_usage',
        'event_label': label
    });
}

/**
 * Track user interaction with controls
 * @param {string} controlName - The name of the control being adjusted
 * @param {string|number} value - The value the control was set to
 */
function trackControlEvent(controlName, value) {
    if (typeof gtag !== 'function') return;
    
    gtag('event', 'adjust_settings', {
        'event_category': 'user_preferences',
        'event_label': `${controlName}: ${value}`
    });
}

/**
 * Track errors that occur during DAF usage
 * @param {string} errorType - The type of error that occurred
 * @param {string} errorMessage - The error message
 */
function trackErrorEvent(errorType, errorMessage) {
    if (typeof gtag !== 'function') return;
    
    gtag('event', 'error', {
        'event_category': 'daf_errors',
        'event_label': `${errorType}: ${errorMessage}`
    });
}

/**
 * Track page views with custom parameters
 * @param {string} pagePath - The path of the page being viewed
 * @param {Object} additionalParams - Additional parameters to include with the page view
 */
function trackPageView(pagePath, additionalParams = {}) {
    if (typeof gtag !== 'function') return;
    
    gtag('event', 'page_view', {
        'page_path': pagePath,
        ...additionalParams
    });
}