import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { handleCallback } from './sources/spotify';
import { setState, type Status } from './store';
import './styles.css';

async function boot() {
  // Finish a Spotify login round-trip before anything else reads the URL.
  const fromSpotify = await handleCallback().catch((e) => {
    console.error(e);
    return false;
  });
  if (fromSpotify) setState({ input: 'tuner' });

  fetch('/api/status')
    .then((r) => r.json() as Promise<Status>)
    .then((status) => setState({ status }))
    .catch(() => setState({ status: { plex: false, spotifyClientId: null, youtubeApiKey: null, romCount: 0, systems: [] } }));

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

boot();
