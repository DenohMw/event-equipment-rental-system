(function () {
    document.querySelectorAll('[data-password-toggle]').forEach(function (button) {
        const input = document.getElementById(button.getAttribute('data-password-toggle'));
        if (!input) return;
        button.addEventListener('click', function () {
            const showing = input.type === 'password';
            input.type = showing ? 'text' : 'password';
            button.textContent = showing ? 'Hide' : 'Show';
            button.setAttribute('aria-pressed', String(showing));
            button.setAttribute('aria-label', showing ? 'Hide password' : 'Show password');
            input.focus();
        });
    });
}());
