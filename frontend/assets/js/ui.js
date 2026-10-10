/**
 * EventEquip Kenya - UI Helpers
 * DOM manipulation, toasts, modals, loading states.
 */

const UI = (() => {
    /**
     * Ensure a toast container exists.
     */
    function ensureToastContainer() {
        let container = document.querySelector('.toast-container');
        if (!container) {
            container = document.createElement('div');
            container.className = 'toast-container';
            document.body.appendChild(container);
        }
        return container;
    }

    /**
     * Show a toast notification.
     * type: 'success' | 'error' | 'warning' | 'info'
     */
    function toast(message, type = 'info', duration = 3500) {
        const container = ensureToastContainer();
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        toast.innerHTML = `
            <span class="toast-message">${Utils.escapeHtml(message)}</span>
        `;
        container.appendChild(toast);

        setTimeout(() => {
            toast.style.transition = 'opacity 0.25s, transform 0.25s';
            toast.style.opacity = '0';
            toast.style.transform = 'translateX(20px)';
            setTimeout(() => toast.remove(), 300);
        }, duration);
    }

    /**
     * Set a button to loading state and return a restore function.
     */
    function buttonLoading(button, loadingText = 'Loading...') {
        const originalHTML = button.innerHTML;
        const originalDisabled = button.disabled;
        button.disabled = true;
        button.classList.add('loading');
        button.innerHTML = `<span class="spinner"></span> ${loadingText}`;
        return function restore() {
            button.disabled = originalDisabled;
            button.classList.remove('loading');
            button.innerHTML = originalHTML;
        };
    }

    /**
     * Show a modal by ID.
     */
    function showModal(modalId) {
        const modal = document.getElementById(modalId);
        if (modal) modal.classList.add('active');
    }

    /**
     * Hide a modal by ID.
     */
    function hideModal(modalId) {
        const modal = document.getElementById(modalId);
        if (modal) modal.classList.remove('active');
    }

    /**
     * Render a list of skeleton cards while loading.
     */
    function skeletonCards(container, count = 4) {
        let html = '';
        for (let i = 0; i < count; i++) {
            html += `
                <div class="equipment-card">
                    <div class="skeleton" style="aspect-ratio: 4/3;"></div>
                    <div class="equipment-card-body">
                        <div class="skeleton skeleton-text" style="width: 70%;"></div>
                        <div class="skeleton skeleton-text"></div>
                        <div class="skeleton skeleton-text" style="width: 40%;"></div>
                    </div>
                </div>
            `;
        }
        container.innerHTML = html;
    }

    /**
     * Render an empty state inside a container.
     */
    function emptyState(container, title, message, actionHtml = '') {
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-title">${Utils.escapeHtml(title)}</div>
                <div class="empty-state-message">${Utils.escapeHtml(message)}</div>
                ${actionHtml}
            </div>
        `;
    }

    /**
     * Toggle sidebar (mobile).
     */
    function toggleSidebar() {
        const sidebar = document.querySelector('.sidebar');
        const overlay = document.querySelector('.sidebar-overlay');
        if (!sidebar) return;
        sidebar.classList.toggle('open');
        if (overlay) overlay.classList.toggle('active');
    }

    /**
     * Populate sidebar and topbar user info.
     */
    function hydrateUser() {
        const user = Storage.getUser();
        if (!user) return;

        const initials = Utils.initials(user.full_name);

        document.querySelectorAll('[data-user="name"]').forEach(el => el.textContent = user.full_name);
        document.querySelectorAll('[data-user="role"]').forEach(el => el.textContent = user.role);
        document.querySelectorAll('[data-user="initials"]').forEach(el => el.textContent = initials);
        document.querySelectorAll('.topbar-user-avatar, .sidebar-user-avatar').forEach(el => {
            el.textContent = initials;
            if (!user.profile_photo) return;
            const img = document.createElement('img');
            img.src = Utils.imageUrl(user.profile_photo);
            img.alt = user.full_name + ' profile photo';
            img.onerror = () => { el.textContent = initials; };
            el.textContent = '';
            el.appendChild(img);
        });
        document.querySelectorAll('[data-user="first-name"]').forEach(el => {
            el.textContent = user.full_name.split(' ')[0];
        });
    }

    /**
     * Highlight the active sidebar link.
     */
    function highlightActiveNav() {
        const path = window.location.pathname;
        document.querySelectorAll('.sidebar-link').forEach(link => {
            const href = link.getAttribute('href');
            if (href && (path === href || path.startsWith(href.replace('.html', '')))) {
                link.classList.add('active');
            }
        });
    }

    /**
     * Bootstrap the app shell (user info, sidebar, logout).
     */
    function initShell() {
        hydrateUser();
        highlightActiveNav();

        document.querySelectorAll('[data-action="logout"]').forEach(el => {
            el.addEventListener('click', (e) => {
                e.preventDefault();
                Auth.logout();
            });
        });
    }

    function initPublicShell() {
        const user = Storage.getUser();
        if (user) {
            Sidebar.render();
            initShell();
            Sidebar.updateUnreadBadge();
            return;
        }

        document.body.classList.add('public-marketplace');
        const sidebar = document.querySelector('.sidebar');
        if (sidebar) sidebar.remove();
        document.querySelectorAll('.topbar-toggle').forEach(el => { el.style.display = 'none'; });
        const topbarRight = document.querySelector('.topbar-right');
        if (topbarRight) {
            topbarRight.innerHTML =
                '<a class="public-brand" href="/" aria-label="EventEquip Kenya home">' +
                    '<img src="/assets/images/icons/Icon.png" alt="">' +
                    '<span>EventEquip<small>KENYA</small></span>' +
                '</a>' +
                '<a class="btn btn-outline btn-sm" href="/login.html">Sign in</a>' +
                '<a class="btn btn-primary btn-sm" href="/register.html">Create account</a>';
        }
    }

    return {
        toast,
        buttonLoading,
        showModal,
        hideModal,
        skeletonCards,
        emptyState,
        toggleSidebar,
        initShell,
        initPublicShell,
        hydrateUser
    };
})();
