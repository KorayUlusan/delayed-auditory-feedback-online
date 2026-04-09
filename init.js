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



// Formspree star rating and consent validation
document.addEventListener('DOMContentLoaded', function () {
    // Star rating UI
    const stars = Array.from(document.querySelectorAll('#ratingStars .star'));
    const ratingInput = document.getElementById('ratingInput');
    const fsError = document.querySelector('[data-fs-error]');

    function setStars(n) {
        stars.forEach((s, i) => {
            if (i < n) s.classList.add('filled'); else s.classList.remove('filled');
            s.setAttribute('aria-checked', i < n ? 'true' : 'false');
        });
        ratingInput.value = n;
    }

    stars.forEach((btn, i) => {
        btn.addEventListener('click', function () {
            setStars(i + 1);
        });
        // highlight previous stars on hover/focus
        btn.addEventListener('mouseenter', function () { highlightHover(i + 1); });
        btn.addEventListener('mouseleave', function () { clearHover(); });
        btn.addEventListener('focus', function () { highlightHover(i + 1); });
        btn.addEventListener('blur', function () { clearHover(); });
    });

    function highlightHover(n) {
        stars.forEach((s, i) => {
            if (i < n) s.classList.add('hover'); else s.classList.remove('hover');
        });
    }

    function clearHover() {
        stars.forEach((s) => s.classList.remove('hover'));
    }

    // Validate consent on submit
    const form = document.getElementById('ratingForm');
    form.addEventListener('submit', function (e) {
        fsError.textContent = '';
        if (!ratingInput.value) {
            e.preventDefault();
            fsError.textContent = 'Please select a star rating before submitting.';
            return;
        }
        // Clicking submit implies consent (consent paragraph shown in form)
    });

    // Init Formspree when library is available
    function initFs() {
        if (window.formspree) {
            formspree('initForm', { formElement: '#ratingForm', formId: 'meepwrew' });
        }
    }

    if (window.formspree) initFs(); else {
        const t = setInterval(function () { if (window.formspree) { clearInterval(t); initFs(); } }, 200);
    }
});