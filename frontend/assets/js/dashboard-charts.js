(function () {
    function escapeHtml(value) {
        return String(value).replace(/[&<>"']/g, function (char) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char];
        });
    }

    function renderBars(id, data, options) {
        const container = document.getElementById(id);
        if (!container) return;
        const points = (data || []).filter(function (point) {
            return Number.isFinite(Number(point.value)) && Number(point.value) >= 0;
        });
        if (!points.length || !points.some(function (point) { return Number(point.value) > 0; })) {
            container.innerHTML = '<div class="dashboard-chart-empty">Chart data will appear here as activity is recorded.</div>';
            return;
        }
        const max = Math.max.apply(null, points.map(function (point) { return Number(point.value); })) || 1;
        container.innerHTML = '<div class="dashboard-chart-bars" role="img" aria-label="' + escapeHtml(options.label || 'Dashboard chart') + '">' +
            points.map(function (point) {
                const value = Number(point.value);
                const width = Math.max(value > 0 ? 3 : 0, Math.round(value / max * 100));
                const shown = options.currency ? 'KSh ' + value.toLocaleString('en-KE', { maximumFractionDigits: 0 }) : value.toLocaleString();
                return '<div class="dashboard-chart-row"><span class="dashboard-chart-label">' + escapeHtml(point.label) + '</span>' +
                    '<span class="dashboard-chart-track"><span class="dashboard-chart-fill" style="width:' + width + '%"></span></span>' +
                    '<strong class="dashboard-chart-value">' + escapeHtml(shown) + '</strong></div>';
            }).join('') + '</div>';
    }

    function lastSixMonths(bookings, valueForBooking) {
        const now = new Date();
        const months = [];
        for (let offset = 5; offset >= 0; offset -= 1) {
            const date = new Date(now.getFullYear(), now.getMonth() - offset, 1);
            months.push({ key: date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0'), label: date.toLocaleDateString(undefined, { month: 'short' }), value: 0 });
        }
        (bookings || []).forEach(function (booking) {
            const date = new Date(booking.created_at || booking.start_date);
            if (Number.isNaN(date.getTime())) return;
            const key = date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0');
            const month = months.find(function (item) { return item.key === key; });
            if (month) month.value += Number(valueForBooking(booking) || 0);
        });
        return months;
    }

    function statusCounts(bookings) {
        const counts = {};
        (bookings || []).forEach(function (booking) {
            const label = String(booking.status || 'unknown').replace(/[_-]/g, ' ');
            counts[label] = (counts[label] || 0) + 1;
        });
        return Object.keys(counts).sort().map(function (label) { return { label: label.replace(/\b\w/g, function (c) { return c.toUpperCase(); }), value: counts[label] }; });
    }

    window.DashboardCharts = { renderBars: renderBars, lastSixMonths: lastSixMonths, statusCounts: statusCounts };
}());
