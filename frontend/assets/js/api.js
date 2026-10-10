/**
 * EventEquip Kenya - API Client
 */

class ApiError extends Error {
    constructor(message, status, code) {
        super(message);
        this.name = 'ApiError';
        this.status = status;
        this.code = code;
    }
}

const Api = (function () {
    function presentErrorMessage(message, status) {
        if (/^Required:/i.test(message || '')) {
            return 'Please complete all required information and try again.';
        }
        if (/^Invalid status\./i.test(message || '')) {
            return 'Choose a valid booking status and try again.';
        }
        if (/^Booking must be in /i.test(message || '')) {
            return 'This booking is not ready for payment yet. Refresh your bookings and try again.';
        }
        if (/^(Access denied|Only owner or admin)/i.test(message || '')) {
            return 'You do not have permission to perform this action.';
        }
        if (status === 404 && /not found/i.test(message || '')) {
            return 'We could not find that item. It may have been removed.';
        }
        return message || 'We could not process your request. Please review your details and try again.';
    }

    async function request(endpoint, options) {
        options = options || {};
        const url = CONFIG.API_BASE_URL + endpoint;
        const token = Storage.getToken();

        const isFormData = typeof FormData !== 'undefined' && options.body instanceof FormData;
        const headers = {};
        if (!isFormData) headers['Content-Type'] = 'application/json';
        if (token) headers['Authorization'] = 'Bearer ' + token;
        if (options.headers) {
            Object.keys(options.headers).forEach(function (k) {
                headers[k] = options.headers[k];
            });
        }

        const config = {
            method: options.method || 'GET',
            headers: headers,
            cache: 'no-store'
        };
        if (options.body) config.body = isFormData ? options.body : JSON.stringify(options.body);

        let response;
        try {
            response = await fetch(url, config);
        } catch (networkError) {
            throw new ApiError(
                'We could not connect to the service. Please check your connection and try again.',
                0,
                'NETWORK_ERROR'
            );
        }

        let data;
        const contentType = response.headers.get('content-type');
        if (contentType && contentType.indexOf('application/json') !== -1) {
            data = await response.json();
        } else {
            data = { message: await response.text() };
        }

        if (!response.ok) {
            if (response.status === 401) {
                const currentUser = Storage.getUser();
                if (currentUser) Storage.forgetRemembered(currentUser.user_id);
                Storage.clear();
            }
            const message = response.status >= 500
                ? 'We could not complete your request right now. Please try again shortly.'
                : presentErrorMessage(data.message, response.status);
            throw new ApiError(
                message,
                response.status,
                data.error
            );
        }

        return data;
    }

    return {
        /* Auth */
        register: function (data) { return request('/api/auth/register', { method: 'POST', body: data }); },
        login: function (data) { return request('/api/auth/login', { method: 'POST', body: data }); },
        getMe: function () { return request('/api/auth/me'); },
        getPasswordResetStatus: function () { return request('/api/auth/password-reset/status'); },
        requestPasswordReset: function (phone) {
            return request('/api/auth/forgot-password', { method: 'POST', body: { phone: phone } });
        },
        verifyPasswordResetCode: function (phone, otp) {
            return request('/api/auth/verify-password-reset-code', { method: 'POST', body: { phone: phone, otp: otp } });
        },
        resetPassword: function (phone, otp, password) {
            return request('/api/auth/reset-password', { method: 'POST', body: { phone: phone, otp: otp, password: password } });
        },
        updateProfile: function (data, photo, removePhoto) {
            const form = new FormData();
            Object.keys(data).forEach(function (key) { form.append(key, data[key] == null ? '' : data[key]); });
            if (photo) form.append('profile_photo', photo);
            if (removePhoto) form.append('remove_photo', 'true');
            return request('/api/auth/me', { method: 'PUT', body: form });
        },

        /* Equipment */
        getCategories: function () { return request('/api/equipment/categories'); },
        getLocations: function () { return request('/api/equipment/locations'); },
        getEquipment: function (filters) {
            filters = filters || {};
            const params = new URLSearchParams();
            Object.keys(filters).forEach(function (k) {
                if (filters[k] !== '' && filters[k] != null) params.append(k, filters[k]);
            });
            const qs = params.toString();
            return request('/api/equipment' + (qs ? '?' + qs : ''));
        },
        getEquipmentById: function (id) { return request('/api/equipment/' + id); },
        createEquipment: function (data) { return request('/api/equipment', { method: 'POST', body: data }); },
        createEquipmentWithImages: function (data, files) {
            const form = new FormData();
            Object.keys(data).forEach(function (key) { form.append(key, data[key] == null ? '' : data[key]); });
            (files || []).forEach(function (file) { form.append('images', file); });
            return request('/api/equipment', { method: 'POST', body: form });
        },
        updateEquipment: function (id, data) { return request('/api/equipment/' + id, { method: 'PUT', body: data }); },
        deleteEquipment: function (id) { return request('/api/equipment/' + id, { method: 'DELETE' }); },
        getMyEquipment: function () { return request('/api/equipment/my'); },

        /* Bookings */
        checkAvailability: function (params) {
            const qs = new URLSearchParams(params).toString();
            return request('/api/bookings/check-availability?' + qs);
        },
        createBooking: function (data) { return request('/api/bookings', { method: 'POST', body: data }); },
        getMyBookings: function () { return request('/api/bookings/my'); },
        getOwnerBookings: function () { return request('/api/bookings/owner'); },
        getBookingById: function (id) { return request('/api/bookings/' + id); },
        updateBookingStatus: function (id, status) {
            return request('/api/bookings/' + id + '/status', {
                method: 'PUT',
                body: { status: status }
            });
        },

        /* Payments */
        initiatePayment: function (data) { return request('/api/payments/stk-push', { method: 'POST', body: data }); },
        getPaymentStatus: function (bookingId) { return request('/api/payments/status/' + bookingId); },

        /* Chat */
        getConversations: function () { return request('/api/chat/conversations'); },
        getChatHistory: function (otherUserId) { return request('/api/chat/history/' + otherUserId); },
        sendMessage: function (data) { return request('/api/chat/send', { method: 'POST', body: data }); },
        getUnreadCount: function () { return request('/api/chat/unread-count'); },

        /* Reviews */
        submitReview: function (data) { return request('/api/reviews', { method: 'POST', body: data }); },
        getMyReviews: function () { return request('/api/reviews/my'); },
        getReviewForBooking: function (bookingId) { return request('/api/reviews/booking/' + bookingId); },
        getEquipmentReviews: function (equipmentId) { return request('/api/reviews/equipment/' + equipmentId); },

        /* Admin */
        adminStats: function () { return request('/api/admin/stats'); },
        adminActivity: function () { return request('/api/admin/activity'); },
        adminUsers: function (role) {
            const qs = role ? '?role=' + encodeURIComponent(role) : '';
            return request('/api/admin/users' + qs);
        },
        adminToggleUser: function (id, isActive) {
            return request('/api/admin/users/' + id + '/toggle-active', {
                method: 'PUT',
                body: { is_active: isActive }
            });
        },
        adminPendingOwners: function () { return request('/api/admin/owners/pending'); },
        adminVerifyOwner: function (id, approve) {
            return request('/api/admin/owners/' + id + '/verify', {
                method: 'PUT',
                body: { approve: approve }
            });
        },
        adminPendingEquipment: function () { return request('/api/admin/equipment/pending'); },
        adminApproveEquipment: function (id, approve) {
            return request('/api/admin/equipment/' + id + '/approve', {
                method: 'PUT',
                body: { approve: approve }
            });
        },
        adminBookings: function () { return request('/api/admin/bookings'); }
    };
})();
