import { PluginCommonModule, Type, VendurePlugin } from '@vendure/core';

import { PLATFORM_DASHBOARD_PLUGIN_OPTIONS } from './constants';
import { PluginInitOptions } from './types';

@VendurePlugin({
    imports: [PluginCommonModule],
    providers: [{ provide: PLATFORM_DASHBOARD_PLUGIN_OPTIONS, useFactory: () => PlatformDashboardPlugin.options }],
    dashboard: './dashboard/index.tsx',
    configuration: config => {
        // Plugin-specific configuration
        // such as custom fields, custom permissions,
        // strategies etc. can be configured here by
        // modifying the `config` object.
        return config;
    },
    compatibility: '^3.0.0',
})
export class PlatformDashboardPlugin {
    static options: PluginInitOptions;

    static init(options: PluginInitOptions): Type<PlatformDashboardPlugin> {
        this.options = options;
        return PlatformDashboardPlugin;
    }
}
