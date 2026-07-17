import { defineDashboardExtension } from '@vendure/dashboard';

import { Saa9viLogo } from './components/login/Saa9viLogo';
import { LoginWelcome } from './components/login/LoginWelcome';
import { LoginFooter } from './components/login/LoginFooter';

import './styles.css';

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
