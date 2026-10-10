/** Small, progressive motion effects shared across EventEquip pages. */
(function () {
    if (!('IntersectionObserver' in window)) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const selectors = [
        '.section-header', '.feature-card', '.category-tile', '.cta-inner',
        '.page-header', '.filter-panel', '.metric-card', '.equipment-card',
        '.card', '.site-footer-grid > div'
    ].join(',');
    const observer = new IntersectionObserver((entries, io) => {
        entries.forEach((entry) => {
            if (!entry.isIntersecting) return;
            entry.target.classList.add('motion-visible');
            io.unobserve(entry.target);
        });
    }, { threshold: 0.08, rootMargin: '0px 0px -32px 0px' });

    function observeElements(root) {
        if (root.matches && root.matches(selectors)) observe(root);
        root.querySelectorAll?.(selectors).forEach(observe);
    }

    function observe(element) {
        if (element.classList.contains('motion-reveal')) return;
        element.classList.add('motion-reveal');
        const siblings = element.parentElement ? Array.from(element.parentElement.querySelectorAll(':scope > ' + element.tagName.toLowerCase())) : [];
        const index = Math.max(0, siblings.indexOf(element));
        element.style.setProperty('--motion-delay', Math.min(index, 4) * 65 + 'ms');
        observer.observe(element);
    }

    function start() {
        observeElements(document);
        const navLinks = Array.from(document.querySelectorAll('.site-navbar-links a[href^="#"]'));
        const navTargets = navLinks
            .map((link) => ({ link, target: document.getElementById(decodeURIComponent(link.hash.slice(1))) }))
            .filter((item) => item.target)
            .sort((a, b) => a.target.offsetTop - b.target.offsetTop);

        if (navTargets.length) {
            let ticking = false;
            const updateCurrentSection = () => {
                const marker = window.scrollY + (document.querySelector('.site-navbar')?.offsetHeight || 0) + 96;
                let current = null;
                navTargets.forEach((item) => {
                    if (item.target.getBoundingClientRect().top + window.scrollY <= marker) current = item.link;
                });
                navLinks.forEach((link) => {
                    if (link === current) link.setAttribute('aria-current', 'location');
                    else link.removeAttribute('aria-current');
                });
                ticking = false;
            };
            const onScroll = () => {
                if (ticking) return;
                ticking = true;
                window.requestAnimationFrame(updateCurrentSection);
            };
            window.addEventListener('scroll', onScroll, { passive: true });
            window.addEventListener('resize', onScroll, { passive: true });
            window.addEventListener('hashchange', onScroll);
            updateCurrentSection();
        }

        const content = document.querySelector('main, .app-content, body');
        if (content && 'MutationObserver' in window) {
            new MutationObserver((records) => {
                records.forEach((record) => record.addedNodes.forEach((node) => {
                    if (node.nodeType === 1) observeElements(node);
                }));
            }).observe(content, { childList: true, subtree: true });
        }
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
    else start();
})();
