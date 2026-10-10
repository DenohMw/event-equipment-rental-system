/**
 * EventEquip Kenya - Utilities
 * Formatters, validators, and helpers.
 */

const Utils = {
    /**
     * Format a number as Kenyan Shillings.
     */
    formatCurrency(amount, withDecimals = false) {
        const num = Number(amount) || 0;
        return CONFIG.DEFAULT_CURRENCY + ' ' + num.toLocaleString(CONFIG.DATE_LOCALE, {
            minimumFractionDigits: withDecimals ? 2 : 0,
            maximumFractionDigits: withDecimals ? 2 : 0
        });
    },

    /**
     * Format an ISO date string as a short date.
     */
    formatDate(dateString) {
        if (!dateString) return '-';
        return new Date(dateString).toLocaleDateString(CONFIG.DATE_LOCALE, {
            year: 'numeric',
            month: 'short',
            day: 'numeric'
        });
    },

    /**
     * Format an ISO date string as date + time.
     */
    formatDateTime(dateString) {
        if (!dateString) return '-';
        return new Date(dateString).toLocaleString(CONFIG.DATE_LOCALE, {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    },

    /**
     * Human-friendly relative time.
     */
    timeAgo(dateString) {
        if (!dateString) return '';
        const seconds = Math.floor((Date.now() - new Date(dateString).getTime()) / 1000);
        if (seconds < 60) return 'just now';
        const minutes = Math.floor(seconds / 60);
        if (minutes < 60) return minutes + 'm ago';
        const hours = Math.floor(minutes / 60);
        if (hours < 24) return hours + 'h ago';
        const days = Math.floor(hours / 24);
        if (days < 30) return days + 'd ago';
        return Utils.formatDate(dateString);
    },

    /**
     * Escape a string for safe insertion into HTML.
     */
    escapeHtml(str) {
        if (str == null) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    },

    /** Resolve uploaded files from the API server when the frontend is hosted separately. */
    imageUrl(url) {
        if (!url) return '';
        if (url.indexOf('/uploads/') === 0) {
            return CONFIG.API_BASE_URL.replace(/\/$/, '') + url;
        }
        return url;
    },

    /**
     * Get a query string parameter.
     */
    getQueryParam(name) {
        return new URLSearchParams(window.location.search).get(name);
    },

    /**
     * Compute number of days between two dates (inclusive).
     */
    daysBetween(start, end) {
        const s = new Date(start);
        const e = new Date(end);
        return Math.max(1, Math.ceil((e - s) / (1000 * 60 * 60 * 24)));
    },

    /**
     * Get initials from a full name.
     */
    initials(fullName) {
        if (!fullName) return '?';
        return fullName
            .split(' ')
            .filter(Boolean)
            .slice(0, 2)
            .map(n => n[0].toUpperCase())
            .join('');
    },

    /**
     * Validate Kenyan phone number.
     */
    isValidKenyanPhone(phone) {
        const cleaned = String(phone).replace(/\D/g, '');
        return /^(254|0)(7|1)\d{8}$/.test(cleaned);
    },

    /**
     * Normalise Kenyan phone to 254XXXXXXXXX format.
     */
    normalisePhone(phone) {
        let cleaned = String(phone).replace(/\D/g, '');
        if (cleaned.startsWith('0')) cleaned = '254' + cleaned.substring(1);
        if (cleaned.startsWith('7') || cleaned.startsWith('1')) cleaned = '254' + cleaned;
        return cleaned;
    },

    /**
     * Map booking status to a badge class.
     */
    statusBadgeClass(status) {
        const map = {
            requested: 'badge-warning',
            confirmed: 'badge-info',
            paid: 'badge-success',
            delivered: 'badge-purple',
            rented: 'badge-orange',
            returned: 'badge-gray',
            completed: 'badge-success',
            cancelled: 'badge-danger',
            pending: 'badge-warning',
            failed: 'badge-danger',
            processing: 'badge-info'
        };
        return map[status] || 'badge-gray';
    },

    /**
     * Render a status badge HTML snippet.
     */
    statusBadge(status) {
        const cls = Utils.statusBadgeClass(status);
        const label = status ? status.charAt(0).toUpperCase() + status.slice(1) : 'Unknown';
        return `<span class="badge ${cls}">${Utils.escapeHtml(label)}</span>`;
    }
};
