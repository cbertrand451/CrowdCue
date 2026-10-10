import { ExpandDetails } from './ExpandDetails';

export function CreatorContact() {
  return (
    <footer className="creator-contact" aria-label="Creator contact">
      <ExpandDetails title="Connect with the Creator">
        <p>Colin Bertrand</p>
        <div className="creator-contact-links">
          <a
            href="https://www.linkedin.com/in/colin-bertrand-512138265/"
            target="_blank"
            rel="noopener noreferrer"
          >
            LinkedIn
          </a>
          <a href="mailto:colinboebelbertrand@gmail.com">
            colinboebelbertrand@gmail.com
          </a>
        </div>
      </ExpandDetails>
    </footer>
  );
}
