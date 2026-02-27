// init.js - Initialization script for the DAF Online application

// Initialize app when DOM is fully loaded
window.onload = function () {
    // Set current year in footer
    document.getElementById('currentYear').textContent = new Date().getFullYear();
};

// Observe status message updates and trigger a brief flash/glow animation
(function () {
    var status = document.getElementById('statusMessage');
    if (!status) return;

    var lastText = status.textContent;

    var flash = function () {
        // restart animation if already applied
        status.classList.remove('status-flash');
        // force reflow to allow re-trigger
        void status.offsetWidth;
        status.classList.add('status-flash');
        // remove class after animation completes (fallback timeout)
        setTimeout(function () { status.classList.remove('status-flash'); }, 1100);
    };

    var observer = new MutationObserver(function (mutations) {
        mutations.forEach(function (m) {
            var newText = status.textContent;
            if (newText !== lastText) {
                lastText = newText;
                flash();
            }
        });
    });

    observer.observe(status, { characterData: true, childList: true, subtree: true });
})();


// Fequently Asked Questions "More FAQs" toggle
(function () {
    function toggleFaq() {
        var btn = document.getElementById('faqToggle');
        var more = document.getElementById('moreFaq');
        if (!btn || !more) return;
        var expanded = btn.getAttribute('aria-expanded') === 'true';
        if (expanded) {
            more.hidden = true;
            btn.setAttribute('aria-expanded', 'false');
            btn.textContent = 'Show more FAQs';
        } else {
            more.hidden = false;
            btn.setAttribute('aria-expanded', 'true');
            btn.textContent = 'Hide extra FAQs';
        }
    }
    document.addEventListener('DOMContentLoaded', function () {
        var btn = document.getElementById('faqToggle');
        if (!btn) return;
        btn.addEventListener('click', toggleFaq);
    });
})();
