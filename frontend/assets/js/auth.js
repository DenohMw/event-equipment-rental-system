/**
 * EventEquip Kenya - Authentication & Session
 */

const Storage = {
    rememberedKey: 'eventequip_remembered_accounts',
    getToken() {
        return sessionStorage.getItem(CONFIG.STORAGE_KEYS.TOKEN);
    },
    setToken(token) {
        sessionStorage.setItem(CONFIG.STORAGE_KEYS.TOKEN, token);
    },
    getUser() {
        const raw = sessionStorage.getItem(CONFIG.STORAGE_KEYS.USER);
        if (!raw) return null;
        try { return JSON.parse(raw); } catch (e) { return null; }
    },
    setUser(user) {
        sessionStorage.setItem(CONFIG.STORAGE_KEYS.USER, JSON.stringify(user));
    },
    save(token, user, rememberMe = false) {
        this.setToken(token);
        this.setUser(user);
        localStorage.removeItem(CONFIG.STORAGE_KEYS.TOKEN);
        localStorage.removeItem(CONFIG.STORAGE_KEYS.USER);
        if (rememberMe && user) this.rememberSession(token, user);
        else if (user) this.forgetRemembered(user.user_id);
    },
    rememberSession(token, user) {
        let accounts = {};
        try { accounts = JSON.parse(localStorage.getItem(this.rememberedKey) || '{}'); } catch (e) { accounts = {}; }
        let expiresAt = Date.now() + 7 * 24 * 60 * 60 * 1000;
        try {
            const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
            if (payload.exp) expiresAt = payload.exp * 1000;
        } catch (e) { /* Keep the configured seven-day fallback. */ }
        accounts[String(user.user_id)] = { token: token, user: user, expires_at: expiresAt };
        localStorage.setItem(this.rememberedKey, JSON.stringify(accounts));
    },
    getRememberedAccounts() {
        let accounts = {};
        try { accounts = JSON.parse(localStorage.getItem(this.rememberedKey) || '{}'); } catch (e) { accounts = {}; }
        const now = Date.now();
        Object.keys(accounts).forEach(id => {
            if (!accounts[id] || !accounts[id].token || !accounts[id].user || accounts[id].expires_at <= now) {
                delete accounts[id];
            }
        });
        localStorage.setItem(this.rememberedKey, JSON.stringify(accounts));
        return Object.values(accounts).sort((a, b) => a.user.full_name.localeCompare(b.user.full_name));
    },
    restoreRemembered(userId) {
        const saved = this.getRememberedAccounts().find(item => String(item.user.user_id) === String(userId));
        if (!saved) return null;
        this.setToken(saved.token);
        this.setUser(saved.user);
        return saved.user;
    },
    forgetRemembered(userId) {
        let accounts = {};
        try { accounts = JSON.parse(localStorage.getItem(this.rememberedKey) || '{}'); } catch (e) { accounts = {}; }
        delete accounts[String(userId)];
        localStorage.setItem(this.rememberedKey, JSON.stringify(accounts));
    },
    isRemembered(userId) {
        return this.getRememberedAccounts().some(item => String(item.user.user_id) === String(userId));
    },
    clear() {
        sessionStorage.removeItem(CONFIG.STORAGE_KEYS.TOKEN);
        sessionStorage.removeItem(CONFIG.STORAGE_KEYS.USER);
        // Remove legacy shared sessions created by earlier versions.
        localStorage.removeItem(CONFIG.STORAGE_KEYS.TOKEN);
        localStorage.removeItem(CONFIG.STORAGE_KEYS.USER);
    },
    isAuthenticated() {
        return !!(this.getToken() && this.getUser());
    }
};

/**
 * Dashboard URLs by role.
 */
const DASHBOARD_URLS = {
    customer: '/customer/dashboard.html',
    owner: '/owner/dashboard.html',
    admin: '/admin/dashboard.html'
};

const Auth = {
    getUser() {
        return Storage.getUser();
    },

    requireAuth(expectedRole) {
        if (!Storage.isAuthenticated()) {
            const redirect = encodeURIComponent(window.location.pathname + window.location.search);
            window.location.href = CONFIG.ROUTES.LOGIN + '?redirect=' + redirect;
            return null;
        }
        const user = Storage.getUser();
        if (expectedRole && user.role !== expectedRole) {
            Auth.redirectToDashboard(user.role);
            return null;
        }
        return user;
    },

    redirectIfLoggedIn() {
        if (!Storage.isAuthenticated()) return;
        Auth.redirectToDashboard(Storage.getUser().role);
    },

    redirectToDashboard(role) {
        const url = DASHBOARD_URLS[role] || CONFIG.ROUTES.LOGIN;
        window.location.href = url;
    },

    logout() {
        const user = Storage.getUser();
        if (user) Storage.forgetRemembered(user.user_id);
        Storage.clear();
        window.location.href = CONFIG.ROUTES.LOGIN;
    }
};
