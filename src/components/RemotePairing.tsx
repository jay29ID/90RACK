import qrcode from 'qrcode-generator';
import { useMemo } from 'react';
import { setState, useStore } from '../store';

/** The card on the TV that pairs a phone: scan the code, get the remote. */
export function RemotePairing() {
  const open = useStore((s) => s.pairOpen);
  const urls = useStore((s) => s.status?.remoteUrls) ?? [];
  const url = urls[0];
  const svg = useMemo(() => {
    if (!url) return null;
    const qr = qrcode(0, 'M');
    qr.addData(url);
    qr.make();
    return qr.createSvgTag({ cellSize: 6, margin: 2, scalable: true });
  }, [url]);

  if (!open) return null;
  return (
    <div className="pairing" onClick={() => setState({ pairOpen: false })}>
      <div className="pairing-card" onClick={(e) => e.stopPropagation()}>
        <h2>Phone remote</h2>
        {url ? (
          <>
            <div className="qr" dangerouslySetInnerHTML={{ __html: svg! }} />
            <p>Scan with your phone's camera, or open</p>
            <code>{url}</code>
            {urls.length > 1 && <p className="pairing-alt">Other addresses: {urls.slice(1).join(', ')}</p>}
            <p className="pairing-alt">Tip: "Add to Home Screen" makes it feel like a real remote.</p>
          </>
        ) : (
          <>
            <p>
              The rack is only listening on this computer. Add <code>HOST=0.0.0.0</code> to <code>.env</code> and restart, then your phone (on the same
              Wi-Fi) can open the remote.
            </p>
            <p className="pairing-alt">
              On this computer it's at <code>{location.origin}/remote</code>
            </p>
          </>
        )}
        <button className="cta" onClick={() => setState({ pairOpen: false })}>
          Done
        </button>
      </div>
    </div>
  );
}
