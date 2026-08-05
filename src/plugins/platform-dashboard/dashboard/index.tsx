import { defineDashboardExtension } from '@vendure/dashboard';

import { Saa9viLogo } from './components/login/Saa9viLogo';
import { LoginWelcome } from './components/login/LoginWelcome';
import { LoginFooter } from './components/login/LoginFooter';

import './styles.css';

/**
 * Unofficial override: No extension point exists for the account-menu
 * "Explore Platform & Cloud" link (Vendure's built-in marketing link to
 * vendure.io/pricing). We patch it via MutationObserver to point to
 * https://www.saa9vi.com instead.
 *
 * React re-renders this menu on open/close, so we reapply on every mutation
 * rather than once — a one-shot patch would get overwritten.
 *
 * We use a[href*="vendure.io"] rather than a class name because hrefs
 * pointing at Vendure's marketing domain are more stable across dashboard
 * versions than generated utility-class names.
 *
 * Caveat: This mutates DOM nodes that React owns and re-renders. Usually
 * fine for href/target attribute patches since React won't fight over an
 * attribute it's not actively re-setting, but not guaranteed across
 * dashboard versions. If a future Vendure release changes how that menu
 * re-renders, this could silently stop working (link reverts).
 */
if (typeof window !== 'undefined') {
    const SAA9VI_URL = 'https://www.saa9vi.com';
    const observer = new MutationObserver(() => {
        document
            .querySelectorAll<HTMLAnchorElement>('a[href*="vendure.io"]')
            .forEach((link) => {
                if (link.textContent?.includes('Explore Platform')) {
                    link.href = SAA9VI_URL;
                    link.setAttribute('aria-label', 'Visit Saa9vi');
                }
            });
    });
    observer.observe(document.body, { childList: true, subtree: true });
}

export default defineDashboardExtension({
    login: {
        logo: {
            component: Saa9viLogo,
        },
        beforeForm: {
            component: LoginWelcome,
        },
        afterForm: {
            component: LoginFooter,
        },
    },
});
