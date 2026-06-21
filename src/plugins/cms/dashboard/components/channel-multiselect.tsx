import { api, Badge, Button, Label, useQuery } from '@vendure/dashboard';
import { graphql } from '@/gql';
import { useState } from 'react';

const getChannelsDocument = graphql(`
    query GetChannelsForCmsAssignment {
        channels {
            items {
                id
                code
                token
            }
        }
    }
`);

interface ChannelMultiSelectProps {
    /** Channel ids already assigned (read-only display — current channel is always included) */
    assignedChannels?: { id: string; code: string }[];
    value: string[];
    onChange: (channelIds: string[]) => void;
}

/**
 * Lets a platform admin (operating in the default Channel) additionally
 * publish a piece of content into one or more seller Channels. Seller admins
 * operating from within their own channel won't see other sellers' channels
 * here — the Admin API's `channels` query is itself channel-scoped for
 * non-superadmin roles, same as everywhere else in the Dashboard.
 */
export function ChannelMultiSelect({ assignedChannels = [], value, onChange }: ChannelMultiSelectProps) {
    const [open, setOpen] = useState(false);
    const { data } = useQuery({
        queryKey: ['cms-channel-list'],
        queryFn: () => api.query(getChannelsDocument),
    });

    const allChannels = data?.channels.items ?? [];

    function toggle(id: string) {
        onChange(value.includes(id) ? value.filter(v => v !== id) : [...value, id]);
    }

    return (
        <div className="space-y-2">
            <Label>Also publish to channels</Label>
            <div className="flex flex-wrap gap-2">
                {assignedChannels.map(c => (
                    <Badge key={c.id} variant="secondary">
                        {c.code}
                    </Badge>
                ))}
            </div>
            <div className="flex flex-wrap gap-2">
                {allChannels.map(channel => (
                    <Button
                        key={channel.id}
                        type="button"
                        size="sm"
                        variant={value.includes(channel.id) ? 'default' : 'outline'}
                        onClick={() => toggle(channel.id)}
                    >
                        {channel.code}
                    </Button>
                ))}
            </div>
        </div>
    );
}
