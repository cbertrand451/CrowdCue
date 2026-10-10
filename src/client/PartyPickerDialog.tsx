import { ShowQR } from './ShowQR';
import { ComponentIcon } from './ComponentIcon';
import { useMemo, useState } from 'react';
import { motion, MotionConfig } from 'motion/react';
import type { PartyDetails } from '../server/parties/contracts.js';
import { Modal } from './Modal';

// Supplied UniSwapDialog search/list pattern, adapted to existing host parties.
export function PartyPickerDialog({ parties }: { parties: PartyDetails[] }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const matches = useMemo(
    () =>
      parties.filter((party) =>
        party.name
          .toLocaleLowerCase()
          .includes(search.trim().toLocaleLowerCase()),
      ),
    [parties, search],
  );
  return (
    <MotionConfig reducedMotion="user">
      <div className="party-picker">
        <button
          type="button"
          className="secondary"
          aria-haspopup="dialog"
          onClick={() => {
            setSearch('');
            setOpen(true);
          }}
        >
          Find a party <ComponentIcon symbol="⌄" />
        </button>
        {open && (
          <Modal title="Find a party" onClose={() => setOpen(false)}>
            <label htmlFor="party-picker-query">
              Search your loaded parties
            </label>
            <input
              id="party-picker-query"
              type="search"
              autoFocus
              maxLength={120}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search by party name"
            />
            <p className="muted">
              Searches the parties currently loaded in Your parties.
            </p>
            <motion.ul
              className="picker-results"
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
            >
              {matches.map((party) => (
                <li key={party.id}>
                  <a
                    href={party.links.admin ?? party.links.guest}
                    rel="noreferrer"
                  >
                    <span className="picker-icon" aria-hidden="true">
                      <ComponentIcon symbol="≋" />
                    </span>
                    <span>
                      {party.name}
                      <small>
                        {party.status === 'ACTIVE' ? 'Active' : 'Ended'}
                      </small>
                    </span>
                    <ComponentIcon symbol="↗" />
                  </a>
                  {party.status === 'ACTIVE' && (
                    <ShowQR url={party.links.guest} />
                  )}
                </li>
              ))}
            </motion.ul>
            {!matches.length && <p role="status">No matching parties.</p>}
          </Modal>
        )}
      </div>
    </MotionConfig>
  );
}
