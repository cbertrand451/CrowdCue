import { DropdownDisclosure } from './DropdownDisclosure';
export type RequestFilter = 'all' | 'waiting' | 'approved' | 'history';
export function FilterDisclosure({
  value,
  onChange,
}: {
  value: RequestFilter;
  onChange: (value: RequestFilter) => void;
}) {
  return (
    <DropdownDisclosure
      label="Filter requests on this page"
      value={value}
      onChange={(v) => onChange(v as RequestFilter)}
      options={[
        { id: 'all', label: 'All requests' },
        { id: 'waiting', label: 'Awaiting approval' },
        { id: 'approved', label: 'Approved & queued' },
        { id: 'history', label: 'Past requests' },
      ]}
    />
  );
}
