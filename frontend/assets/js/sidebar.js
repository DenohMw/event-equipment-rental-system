/**
 * EventEquip Kenya - Sidebar Renderer
 * Renders the sidebar navigation based on the current user's role.
 */

const Sidebar = (() => {
    const ICONS = {
        dashboard: `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M3 12l9-9 9 9M5 10v10a1 1 0 001 1h3a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1h3a1 1 0 001-1V10"/></svg>`,
        search: `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor"><circle cx="11" cy="11" r="7"/><path stroke-linecap="round" d="M21 21l-4.35-4.35"/></svg>`,
        bookings: `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>`,
        messages: `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M8 10h.01M12 10h.01M16 10h.01M21 12a8 8 0 11-3.5 6.6L3 21l2.4-6.5A8 8 0 0121 12z"/></svg>`,
        reviews: `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M11.05 2.9a1 1 0 011.9 0l2.4 4.9 5.4.8a1 1 0 01.55 1.7l-3.9 3.8.9 5.3a1 1 0 01-1.45 1.06L12 18l-4.85 2.55A1 1 0 016.7 19.5l.9-5.3L3.7 10.3a1 1 0 01.55-1.7l5.4-.8 2.4-4.9z"/></svg>`,
        user: `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor"><circle cx="12" cy="8" r="4"/><path d="M4 21v-2a4 4 0 014-4h8a4 4 0 014 4v2"/></svg>`,
        inventory: `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path d="M3 7l9-4 9 4-9 4-9-4z"/><path d="M3 12l9 4 9-4M3 17l9 4 9-4"/></svg>`,
        money: `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor"><circle cx="12" cy="12" r="9"/><path d="M14.5 9.5h-4a1.5 1.5 0 100 3h3a1.5 1.5 0 110 3h-4M12 7v10"/></svg>`,
        users: `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor"><circle cx="9" cy="8" r="3.5"/><circle cx="17" cy="9" r="3"/><path d="M2 21v-2a4 4 0 014-4h6a4 4 0 014 4v2M17 14a4 4 0 014 4v2"/></svg>`,
        shield: `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path d="M12 2l8 4v6c0 5-3.5 9-8 10-4.5-1-8-5-8-10V6l8-4z"/><path stroke-linecap="round" d="M9 12l2 2 4-4"/></svg>`,
        chart: `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path d="M3 3v18h18"/><path stroke-linecap="round" d="M7 15l4-4 3 3 5-6"/></svg>`
    };

    const MENUS = {
        customer: [
            { label: 'Dashboard', href: '/customer/dashboard.html', icon: 'dashboard' },
            { label: 'Browse Equipment', href: '/customer/browse.html', icon: 'search' },
            { label: 'My Bookings', href: '/customer/bookings.html', icon: 'bookings' },
            { label: 'Messages', href: '/customer/chat.html', icon: 'messages', badge: 'unread' },
            { label: 'Reviews', href: '/customer/reviews.html', icon: 'reviews' },
            { label: 'Profile', href: '/profile.html', icon: 'user' }
        ],
        owner: [
            { label: 'Dashboard', href: '/owner/dashboard.html', icon: 'dashboard' },
            { label: 'My Equipment', href: '/owner/equipment.html', icon: 'inventory' },
            { label: 'Bookings', href: '/owner/bookings.html', icon: 'bookings' },
            { label: 'Messages', href: '/owner/chat.html', icon: 'messages', badge: 'unread' },
            { label: 'Earnings', href: '/owner/earnings.html', icon: 'money' },
            { label: 'Profile', href: '/profile.html', icon: 'user' }
        ],
        admin: [
            { label: 'Dashboard', href: '/admin/dashboard.html', icon: 'dashboard' },
            { label: 'Users', href: '/admin/users.html', icon: 'users' },
            { label: 'Owners', href: '/admin/owners.html', icon: 'shield' },
            { label: 'Equipment Approval', href: '/admin/equipment.html', icon: 'inventory' },
            { label: 'Bookings', href: '/admin/bookings.html', icon: 'bookings' },
            { label: 'Reports', href: '/admin/reports.html', icon: 'chart' },
            { label: 'Profile', href: '/profile.html', icon: 'user' }
        ]
    };

    function render() {
        const user = Storage.getUser();
        if (!user) return;

        const menu = MENUS[user.role] || [];
        const navHtml = menu.map(item => `
            <a href="${item.href}" class="sidebar-link">
                <span class="sidebar-link-icon">${ICONS[item.icon] || ''}</span>
                <span>${item.label}</span>
                ${item.badge ? `<span class="sidebar-link-badge" data-badge="${item.badge}" style="display:none;">0</span>` : ''}
            </a>
        `).join('');

        const html = `
            <div class="sidebar-header">
                <a href="/" class="sidebar-brand">
                    <span class="sidebar-brand-mark">
                        <img src="/assets/images/icons/Icon.png" alt="" width="40" height="40">
                    </span>
                    <span class="sidebar-brand-text">
                        EventEquip
                        <small>KENYA</small>
                    </span>
                </a>
            </div>
            <nav class="sidebar-nav">
                ${navHtml}
            </nav>
            <div class="sidebar-footer">
                <div class="sidebar-user" data-action="logout" title="Click to logout">
                    <div class="sidebar-user-avatar" data-user="initials">?</div>
                    <div class="sidebar-user-info">
                        <div class="sidebar-user-name" data-user="name">Loading...</div>
                        <div class="sidebar-user-role" data-user="role"></div>
                    </div>
                </div>
            </div>
        `;

        const container = document.querySelector('.sidebar');
        if (container) {
            container.innerHTML = html;
        }
    }

    async function updateUnreadBadge() {
        try {
            const data = await Api.getUnreadCount();
            document.querySelectorAll('[data-badge="unread"]').forEach(el => {
                if (data.unread > 0) {
                    el.textContent = data.unread;
                    el.style.display = 'inline-block';
                } else {
                    el.style.display = 'none';
                }
            });
        } catch {
            // Silent fail — user may not be logged in
        }
    }

    return { render, updateUnreadBadge };
})();
