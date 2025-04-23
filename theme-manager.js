// theme-manager.js - Handles theme switching functionality

// Set up theme functionality
const themeManager = {
    init: function() {
        const checkbox = document.getElementById('checkbox');
        if (!checkbox) return;
        
        // Apply saved theme preference on page load
        const savedTheme = localStorage.getItem('theme') || 'light';
        document.documentElement.setAttribute('data-theme', savedTheme);
        checkbox.checked = savedTheme === 'dark';
        
        // Update meta theme-color for mobile browsers
        const themeColorMeta = document.querySelector('meta[name="theme-color"]');
        if (themeColorMeta) {
            themeColorMeta.setAttribute('content', savedTheme === 'dark' ? '#121212' : '#ffffff');
        }
        
        // Add event listener directly to the checkbox
        checkbox.addEventListener('change', function() {
            const theme = this.checked ? 'dark' : 'light';
            console.log('Theme toggled to:', theme);
            
            // Apply theme to document
            document.documentElement.setAttribute('data-theme', theme);
            
            // Update meta theme-color for mobile browsers
            if (themeColorMeta) {
                themeColorMeta.setAttribute('content', theme === 'dark' ? '#121212' : '#ffffff');
            }
            
            // Save theme preference
            localStorage.setItem('theme', theme);
        });
        
        console.log('Theme manager initialized with theme:', savedTheme);
    }
};

// Initialize theme manager when DOM content is loaded
document.addEventListener('DOMContentLoaded', function() {
    themeManager.init();
});