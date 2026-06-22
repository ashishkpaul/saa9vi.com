type Option = { value: string; label: string; disabled?: boolean };

export function ChannelMultiselect({
  value,
  onChange,
  options,
  removeOnly = false,
}: {
  value: { channelIds: string[] };
  onChange: (value: { channelIds: string[] }) => void;
  options: Option[];
  removeOnly?: boolean;
}) {
  const selected = new Set(value?.channelIds ?? []);

  return (
    <div>
      <label className="mb-1 block text-sm font-medium text-gray-700">Channels</label>
      <select
        multiple={true}
        value={Array.from(multiValueToArray(value?.channelIds ?? []))}
        onChange={(e) => {
          const selectedIds = Array.from(e.target.selectedOptions).map((o) => o.value);
          onChange({ channelIds: selectedIds });
        }}
        className="w-full rounded-md border border-gray-300 bg-white p-2"
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value} disabled={removeOnly && !selected.has(opt.value)}>
            {opt.label}
          </option>
        ))}
      </select>
      <p className="mt-1 text-xs text-gray-500">
        {removeOnly ? 'Deselect to remove the item from a channel.' : 'Hold Ctrl/Cmd to select multiple channels.'}
      </p>
    </div>
  );
}

function multiValueToArray(value: string | string[] | undefined): string[] {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  return [value];
}

export default ChannelMultiselect;
