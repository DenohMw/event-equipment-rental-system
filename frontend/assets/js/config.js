/**
 * EventEquip Kenya - Configuration
 */

const CONFIG = {
    // When using a separate local static server (or opening a file directly),
    // send API requests to the local backend. Deployed pages use their own origin.
    API_BASE_URL: window.EVENTEQUIP_API_BASE_URL || (
        window.location.protocol === 'file:' || ['5500', '5501', '5173', '8080'].includes(window.location.port)
            ? 'http://' + (window.location.hostname || 'localhost') + ':3000'
            : window.location.origin
    ),
    STORAGE_KEYS: {
        TOKEN: 'eventrent_token',
        USER: 'eventrent_user'
    },
    ROUTES: {
        LOGIN: '/login.html',
        REGISTER: '/register.html',
        CUSTOMER_DASHBOARD: '/customer/dashboard.html',
        OWNER_DASHBOARD: '/owner/dashboard.html',
        ADMIN_DASHBOARD: '/admin/dashboard.html'
    },
    ROLES: {
        CUSTOMER: 'customer',
        OWNER: 'owner',
        ADMIN: 'admin'
    },
    DEFAULT_CURRENCY: 'KSh',
    DATE_LOCALE: 'en-KE'
};

Object.freeze(CONFIG);
Object.freeze(CONFIG.STORAGE_KEYS);
Object.freeze(CONFIG.ROUTES);
Object.freeze(CONFIG.ROLES);
