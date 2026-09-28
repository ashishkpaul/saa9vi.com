/**
 * FORKED FROM @vendure/dashboard@3.7.3
 * (node_modules/@vendure/dashboard/src/lib/components/layout/nav-main.tsx)
 *
 * Vendure's sidebar opens only the *active* top section: an accordion
 * (opening one section closes the others) whose open-set is reset to
 * "active section only" on every route change, and the `defaultOpen` flag on
 * NavMenuSection is declared but never consumed. For the BBB workspace that
 * hides three of its four groups behind extra clicks on every page load.
 *
 * Patched behaviour (top sections only — the bottom "Administration" group
 * and the collapsed-sidebar hover menus keep upstream behaviour):
 *   1. First visit: every top section renders expanded.
 *   2. Toggling one section no longer collapses the others.
 *   3. Route changes merge the active section into the open set instead of
 *      collapsing everything else, so expand/collapse choices survive
 *      navigation.
 *   4. Explicit toggles persist to localStorage
 *      (`vendure.nav.openTopSectionIds`).
 *
 * On every @vendure/dashboard upgrade: re-diff this file against upstream and
 * re-apply the hunks marked PATCH(bbb-nav).
 */
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/vdb/components/ui/collapsible.js';
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/vdb/components/ui/hover-card.js';
import {
    SidebarGroup,
    SidebarGroupLabel,
    SidebarMenu,
    SidebarMenuButton,
    SidebarMenuItem,
    SidebarMenuSub,
    SidebarMenuSubButton,
    SidebarMenuSubItem,
    useSidebar,
} from '@/vdb/components/ui/sidebar.js';
import {
    NavMenuItem,
    NavMenuSection,
    NavMenuSectionPlacement,
} from '@/vdb/framework/nav-menu/nav-menu-extensions.js';
import { usePermissions } from '@/vdb/hooks/use-permissions.js';
import { cn } from '@/vdb/lib/utils.js';
import { useLingui } from '@lingui/react';
import { Link, useRouter, useRouterState } from '@tanstack/react-router';
import { ChevronRight } from 'lucide-react';
import * as React from 'react';
import { NavItemWrapper } from '@/vdb/components/layout/nav-item-wrapper.js';

// Utility to sort items & sections by the optional `order` prop (ascending) and then alphabetically by title
function sortByOrder<T extends { order?: number; title: string }>(a: T, b: T) {
    const orderA = a.order ?? Number.MAX_SAFE_INTEGER;
    const orderB = b.order ?? Number.MAX_SAFE_INTEGER;
    if (orderA === orderB) {
        return a.title.localeCompare(b.title);
    }
    return orderA - orderB;
}

/**
 * Escapes special regex characters in a string to be used as a literal pattern
 */
function escapeRegexChars(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const HOVER_OPEN_DELAY = 150;
const HOVER_CLOSE_DELAY = 250;

// PATCH(bbb-nav): persisted open/closed preference for top sections.
const OPEN_TOP_SECTIONS_KEY = 'vendure.nav.openTopSectionIds';

function readPersistedOpenTopSections(): Set<string> | null {
    try {
        const raw = localStorage.getItem(OPEN_TOP_SECTIONS_KEY);
        if (!raw) return null;
        const parsed: unknown = JSON.parse(raw);
        return Array.isArray(parsed)
            ? new Set(parsed.filter((id): id is string => typeof id === 'string'))
            : null;
    } catch {
        return null; // private mode / corrupted value → fall back to defaults
    }
}

function persistOpenTopSections(ids: Set<string>) {
    try {
        localStorage.setItem(OPEN_TOP_SECTIONS_KEY, JSON.stringify([...ids]));
    } catch {
        /* private mode */
    }
}

function CollapsedSectionMenu({
    item,
    isPathActive,
}: Readonly<{
    item: NavMenuSection;
    isPathActive: (url: string) => boolean;
}>) {
    const { i18n } = useLingui();
    return (
        <HoverCard>
            <HoverCardTrigger delay={HOVER_OPEN_DELAY} render={<SidebarMenuButton isActive={item.items?.some(subItem => isPathActive(subItem.url))} />}>
                    {item.icon && <item.icon />}
                    <span>{i18n.t(item.title)}</span>
            </HoverCardTrigger>
            <HoverCardContent
                side="right"
                align="start"
                sideOffset={4}
                className="w-auto min-w-[8rem] p-1"
            >
                <p className="px-2 py-1.5 text-sm font-semibold" data-testid="sidebar-hover-title">
                    {i18n.t(item.title)}
                </p>
                <div className="bg-border my-1 h-px" />
                {item.items?.map(subItem => (
                    <NavItemWrapper
                        key={subItem.id}
                        locationId={subItem.id}
                        order={subItem.order}
                        parentLocationId={item.id}
                    >
                        <Link
                            to={subItem.url}
                            className={cn(
                                'flex items-center rounded-sm px-2 py-1.5 text-sm outline-hidden hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring',
                                isPathActive(subItem.url) && 'bg-accent text-accent-foreground font-medium',
                            )}
                        >
                            {i18n.t(subItem.title)}
                        </Link>
                    </NavItemWrapper>
                ))}
            </HoverCardContent>
        </HoverCard>
    );
}

export function NavMain({ items }: Readonly<{ items: Array<NavMenuSection | NavMenuItem> }>) {
    const router = useRouter();
    const routerState = useRouterState();
    const { hasPermissions } = usePermissions();
    const { i18n } = useLingui();
    const { state: sidebarState, isMobile, setOpenMobile } = useSidebar();
    const isCollapsed = sidebarState === 'collapsed' && !isMobile;
    const currentPath = routerState.location.pathname;
    const basePath = router.basepath || '';

    // Helper to check if a path is active
    const isPathActive = React.useCallback(
        (itemUrl: string) => {
            // Remove basepath prefix from current path for comparison
            const normalizedCurrentPath = basePath
                ? currentPath.replace(new RegExp(`^${escapeRegexChars(basePath)}`), '')
                : currentPath;

            // Ensure normalized path starts with /
            const cleanPath = normalizedCurrentPath.startsWith('/')
                ? normalizedCurrentPath
                : `/${normalizedCurrentPath}`;

            // Special handling for root path
            if (itemUrl === '/') {
                return cleanPath === '/' || cleanPath === '';
            }

            // For other paths, check exact match or prefix match
            return cleanPath === itemUrl || cleanPath.startsWith(`${itemUrl}/`);
        },
        [currentPath, basePath],
    );

    // Helper to find sections containing active routes
    const findActiveSections = React.useCallback(
        (sections: Array<NavMenuSection | NavMenuItem>) => {
            const activeTopSections = new Set<string>();
            let activeBottomSection: string | null = null;

            for (const section of sections) {
                if ('items' in section && section.items) {
                    const hasActiveItem = section.items.some(item => isPathActive(item.url));
                    if (hasActiveItem) {
                        if (section.placement === 'top') {
                            activeTopSections.add(section.id);
                        } else if (section.placement === 'bottom' && !activeBottomSection) {
                            activeBottomSection = section.id;
                        }
                    }
                }
            }

            return { activeTopSections, activeBottomSection };
        },
        [isPathActive],
    );

    // Initialize state with active sections on mount
    const [openBottomSectionId, setOpenBottomSectionId] = React.useState<string | null>(() => {
        const { activeBottomSection } = findActiveSections(items);
        return activeBottomSection;
    });

    // PATCH(bbb-nav): default to *every* top section expanded (first visit),
    // honour the persisted preference afterwards, and always include the
    // active section so the current page's group is never hidden.
    const [openTopSectionIds, setOpenTopSectionIds] = React.useState<Set<string>>(() => {
        const { activeTopSections } = findActiveSections(items);
        const persisted = readPersistedOpenTopSections();
        if (persisted) {
            return new Set([...persisted, ...activeTopSections]);
        }
        const allTopSectionIds = items
            .filter(section => !('url' in section))
            .map(section => section.id);
        return new Set([...allTopSectionIds, ...activeTopSections]);
    });

    // Helper to check if an item is allowed based on permissions
    const isItemAllowed = React.useCallback(
        (item: NavMenuItem) => {
            if (!item.requiresPermission) {
                return true;
            }
            const permissions = Array.isArray(item.requiresPermission)
                ? item.requiresPermission
                : [item.requiresPermission];
            return hasPermissions(permissions);
        },
        [hasPermissions],
    );

    // Helper to build a sorted list of sections for a given placement, memoized for stability
    const getSortedSections = React.useCallback(
        (placement: NavMenuSectionPlacement) => {
            return items
                .filter(item => item.placement === placement)
                .slice()
                .sort(sortByOrder)
                .map(section => {
                    if ('items' in section) {
                        // Filter items based on permissions
                        const allowedItems = (section.items ?? [])
                            .filter(item => isItemAllowed(item))
                            .sort(sortByOrder);
                        return { ...section, items: allowedItems };
                    }
                    return section;
                })
                .filter(section => {
                    // Drop sections that have no items after permission filtering
                    if ('items' in section) {
                        return section.items && section.items.length > 0;
                    }
                    // For single items, check if they're allowed
                    return isItemAllowed(section as NavMenuItem);
                });
        },
        [items, isItemAllowed],
    );

    const topSections = React.useMemo(() => getSortedSections('top'), [getSortedSections]);
    const bottomSections = React.useMemo(() => getSortedSections('bottom'), [getSortedSections]);

    // PATCH(bbb-nav): independent toggles (no accordion) + persistence.
    const handleTopSectionToggle = (sectionId: string, isOpen: boolean) => {
        setOpenTopSectionIds(prev => {
            const next = new Set(prev);
            if (isOpen) {
                next.add(sectionId);
            } else {
                next.delete(sectionId);
            }
            persistOpenTopSections(next);
            return next;
        });
    };

    // Handle bottom section open/close
    const handleBottomSectionToggle = (sectionId: string, isOpen: boolean) => {
        if (isOpen) {
            setOpenBottomSectionId(sectionId);
        } else if (openBottomSectionId === sectionId) {
            setOpenBottomSectionId(null);
        }
    };

    // PATCH(bbb-nav): merge the active section into the open set on route
    // changes instead of collapsing everything else, so the operator's
    // expand/collapse choices survive navigation. Not persisted — only
    // explicit toggles write the preference.
    React.useEffect(() => {
        const { activeTopSections, activeBottomSection } = findActiveSections(items);

        setOpenTopSectionIds(prev => {
            const allPresent = [...activeTopSections].every(id => prev.has(id));
            return allPresent ? prev : new Set([...prev, ...activeTopSections]);
        });

        if (activeBottomSection) {
            setOpenBottomSectionId(activeBottomSection);
        }
    }, [currentPath, items, findActiveSections]);

    // Close mobile sidebar on route change
    const prevPathRef = React.useRef(currentPath);
    React.useEffect(() => {
        if (prevPathRef.current !== currentPath && isMobile) {
            setOpenMobile(false);
        }
        prevPathRef.current = currentPath;
    }, [currentPath, isMobile, setOpenMobile]);

    const renderSection = (
        item: NavMenuSection | NavMenuItem,
        isOpen: boolean,
        onToggle: (id: string, isOpen: boolean) => void,
    ) => {
        if ('url' in item) {
            return (
                <NavItemWrapper key={item.id} locationId={item.id} order={item.order} offset={true}>
                    <SidebarMenuItem>
                        <SidebarMenuButton
                            tooltip={i18n.t(item.title)}
                            render={<Link to={item.url} />}
                            isActive={isPathActive(item.url)}
                        >
                                {item.icon && <item.icon />}
                                <span>{i18n.t(item.title)}</span>
                        </SidebarMenuButton>
                    </SidebarMenuItem>
                </NavItemWrapper>
            );
        }

        if (isCollapsed) {
            return (
                <NavItemWrapper key={item.id} locationId={item.id} order={item.order} offset={true}>
                    <SidebarMenuItem>
                        <CollapsedSectionMenu item={item} isPathActive={isPathActive} />
                    </SidebarMenuItem>
                </NavItemWrapper>
            );
        }

        return (
            <NavItemWrapper key={item.id} locationId={item.id} order={item.order} offset={true}>
                <Collapsible
                    open={isOpen}
                    onOpenChange={open => onToggle(item.id, open)}
                    className="group/collapsible"
                >
                    <SidebarMenuItem>
                        <CollapsibleTrigger render={<SidebarMenuButton tooltip={i18n.t(item.title)} />}>
                                {item.icon && <item.icon />}
                                <span>{i18n.t(item.title)}</span>
                                <ChevronRight className="ms-auto transition-transform duration-200 rtl:rotate-180 group-data-open/collapsible:rotate-90" />
                        </CollapsibleTrigger>
                        <CollapsibleContent>
                            <SidebarMenuSub>
                                {item.items?.map(subItem => (
                                    <NavItemWrapper
                                        key={subItem.id}
                                        locationId={subItem.id}
                                        order={subItem.order}
                                        parentLocationId={item.id}
                                    >
                                        <SidebarMenuSubItem>
                                            <SidebarMenuSubButton
                                                render={<Link to={subItem.url} />}
                                                isActive={isPathActive(subItem.url)}
                                            >
                                                    <span>{i18n.t(subItem.title)}</span>
                                            </SidebarMenuSubButton>
                                        </SidebarMenuSubItem>
                                    </NavItemWrapper>
                                ))}
                            </SidebarMenuSub>
                        </CollapsibleContent>
                    </SidebarMenuItem>
                </Collapsible>
            </NavItemWrapper>
        );
    };



    return (
        <>
            {/* Top sections */}
            <SidebarGroup>
                <SidebarMenu>
                    {topSections.map(item =>
                        renderSection(item, openTopSectionIds.has(item.id), handleTopSectionToggle),
                    )}
                </SidebarMenu>
            </SidebarGroup>

            {/* Bottom sections - will be pushed to the bottom by CSS */}
            {bottomSections.length ? (
                <SidebarGroup className="mt-auto">
                    <SidebarGroupLabel>Administration</SidebarGroupLabel>
                    <SidebarMenu>
                        {bottomSections.map(item =>
                            renderSection(
                                item,
                                openBottomSectionId === item.id,
                                handleBottomSectionToggle,
                            ),
                        )}
                    </SidebarMenu>
                </SidebarGroup>
            ) : null}
        </>
    );
}
