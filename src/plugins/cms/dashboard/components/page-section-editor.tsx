import { Badge, Button, Input, Label, RichTextInput, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Textarea } from '@vendure/dashboard';
import { ChevronDown, ChevronUp, GripVertical, Trash2 } from 'lucide-react';

/**
 * Mirrors the PageSection union from the plugin's server-side `types.ts`.
 * Duplicated here (rather than imported) because the Dashboard is a
 * separate Vite app from the server — keep the two in sync by hand, or
 * promote this to a shared package if it starts drifting.
 */
type SectionType = 'hero' | 'richText' | 'productGrid' | 'articleGrid' | 'bannerSlot';

interface Section {
    id: string;
    type: SectionType;
    order: number;
    enabled: boolean;
    config: Record<string, any>;
}

const SECTION_LABELS: Record<SectionType, string> = {
    hero: 'Hero banner',
    richText: 'Rich text',
    productGrid: 'Product grid',
    articleGrid: 'Article grid',
    bannerSlot: 'Banner slot',
};

function emptyConfigFor(type: SectionType): Record<string, any> {
    switch (type) {
        case 'hero':
            return { headline: '', subheadline: '', ctaLabel: '', ctaUrl: '' };
        case 'richText':
            return { html: '' };
        case 'productGrid':
            return { title: '', limit: 8 };
        case 'articleGrid':
            return { title: '', articleIds: [] };
        case 'bannerSlot':
            return { placement: 'HOMEPAGE_STRIP' };
    }
}

interface PageSectionEditorProps {
    value: Section[];
    onChange: (sections: Section[]) => void;
}

export function PageSectionEditor({ value, onChange }: PageSectionEditorProps) {
    // The `sections` field is a JSON scalar and can arrive as a stringified
    // array (e.g. '"[]"'), null, undefined, or an already-parsed array.
    // Normalise defensively before any spread or sort.
    const raw = value ?? [];
    const parsed: Section[] = Array.isArray(raw)
        ? raw
        : typeof raw === 'string'
          ? (() => {
                try {
                    const p = JSON.parse(raw);
                    return Array.isArray(p) ? p : [];
                } catch {
                    return [];
                }
            })()
          : [];

    const sections = [...parsed].sort((a, b) => a.order - b.order);

    function update(id: string, patch: Partial<Section>) {
        onChange(sections.map(s => (s.id === id ? { ...s, ...patch } : s)));
    }

    function updateConfig(id: string, configPatch: Record<string, any>) {
        const section = sections.find(s => s.id === id);
        if (!section) return;
        update(id, { config: { ...section.config, ...configPatch } });
    }

    function addSection(type: SectionType) {
        const newSection: Section = {
            id: crypto.randomUUID(),
            type,
            order: sections.length,
            enabled: true,
            config: emptyConfigFor(type),
        };
        onChange([...sections, newSection]);
    }

    function remove(id: string) {
        onChange(sections.filter(s => s.id !== id).map((s, i) => ({ ...s, order: i })));
    }

    function move(id: string, direction: -1 | 1) {
        const index = sections.findIndex(s => s.id === id);
        const targetIndex = index + direction;
        if (targetIndex < 0 || targetIndex >= sections.length) return;
        const reordered = [...sections];
        [reordered[index], reordered[targetIndex]] = [reordered[targetIndex], reordered[index]];
        onChange(reordered.map((s, i) => ({ ...s, order: i })));
    }

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <Label>Page sections</Label>
                <Select onValueChange={(type: SectionType) => addSection(type)}>
                    <SelectTrigger className="w-48">
                        <SelectValue placeholder="Add section..." />
                    </SelectTrigger>
                    <SelectContent>
                        {(Object.keys(SECTION_LABELS) as SectionType[]).map(type => (
                            <SelectItem key={type} value={type}>
                                {SECTION_LABELS[type]}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </div>

            {sections.length === 0 && (
                <p className="text-sm text-muted-foreground">No sections yet — add one above.</p>
            )}

            <div className="space-y-3">
                {sections.map((section, i) => (
                    <div key={section.id} className="rounded-md border p-4 space-y-3">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                <GripVertical className="h-4 w-4 text-muted-foreground" />
                                <Badge variant="outline">{SECTION_LABELS[section.type]}</Badge>
                                {!section.enabled && <Badge variant="secondary">Hidden</Badge>}
                            </div>
                            <div className="flex items-center gap-1">
                                <Button
                                    type="button"
                                    size="icon"
                                    variant="ghost"
                                    disabled={i === 0}
                                    onClick={() => move(section.id, -1)}
                                >
                                    <ChevronUp className="h-4 w-4" />
                                </Button>
                                <Button
                                    type="button"
                                    size="icon"
                                    variant="ghost"
                                    disabled={i === sections.length - 1}
                                    onClick={() => move(section.id, 1)}
                                >
                                    <ChevronDown className="h-4 w-4" />
                                </Button>
                                <Button
                                    type="button"
                                    size="sm"
                                    variant={section.enabled ? 'outline' : 'secondary'}
                                    onClick={() => update(section.id, { enabled: !section.enabled })}
                                >
                                    {section.enabled ? 'Hide' : 'Show'}
                                </Button>
                                <Button
                                    type="button"
                                    size="icon"
                                    variant="ghost"
                                    onClick={() => remove(section.id)}
                                >
                                    <Trash2 className="h-4 w-4 text-destructive" />
                                </Button>
                            </div>
                        </div>

                        <SectionConfigFields
                            type={section.type}
                            config={section.config}
                            onChange={patch => updateConfig(section.id, patch)}
                        />
                    </div>
                ))}
            </div>
        </div>
    );
}

function SectionConfigFields({
    type,
    config,
    onChange,
}: {
    type: SectionType;
    config: Record<string, any>;
    onChange: (patch: Record<string, any>) => void;
}) {
    // RichTextInput is typed for react-hook-form ControllerRenderProps;
    // cast it for standalone use outside a form context.
    const RichText = RichTextInput as React.ComponentType<{
        value: string;
        onChange: (html: string) => void;
    }>;

    switch (type) {
        case 'hero':
            return (
                <div className="grid grid-cols-2 gap-3">
                    <Field label="Headline">
                        <Input value={config.headline ?? ''} onChange={e => onChange({ headline: e.target.value })} />
                    </Field>
                    <Field label="Subheadline">
                        <Input
                            value={config.subheadline ?? ''}
                            onChange={e => onChange({ subheadline: e.target.value })}
                        />
                    </Field>
                    <Field label="CTA label">
                        <Input value={config.ctaLabel ?? ''} onChange={e => onChange({ ctaLabel: e.target.value })} />
                    </Field>
                    <Field label="CTA URL">
                        <Input value={config.ctaUrl ?? ''} onChange={e => onChange({ ctaUrl: e.target.value })} />
                    </Field>
                </div>
            );
        case 'richText':
            return (
                <Field label="Content">
                    <RichText value={config.html ?? ''} onChange={html => onChange({ html })} />
                </Field>
            );
        case 'productGrid':
            return (
                <div className="grid grid-cols-2 gap-3">
                    <Field label="Title">
                        <Input value={config.title ?? ''} onChange={e => onChange({ title: e.target.value })} />
                    </Field>
                    <Field label="Limit">
                        <Input
                            type="number"
                            value={config.limit ?? 8}
                            onChange={e => onChange({ limit: Number(e.target.value) })}
                        />
                    </Field>
                    {/*
                        TODO: swap `collectionId` for the Catalog's
                        SingleRelationInput + createRelationSelectorConfig
                        (see banner-detail.tsx's asset picker for the pattern)
                        once you wire a `collections` list query here.
                    */}
                </div>
            );
        case 'articleGrid':
            return (
                <Field label="Title">
                    <Input value={config.title ?? ''} onChange={e => onChange({ title: e.target.value })} />
                </Field>
            );
        case 'bannerSlot':
            return (
                <Field label="Placement">
                    <Select value={config.placement} onValueChange={placement => onChange({ placement })}>
                        <SelectTrigger>
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            {['HOMEPAGE_HERO', 'HOMEPAGE_STRIP', 'CATEGORY_TOP', 'SIDEBAR', 'CHECKOUT_PROMO'].map(p => (
                                <SelectItem key={p} value={p}>
                                    {p}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </Field>
            );
    }
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">{label}</Label>
            {children}
        </div>
    );
}
