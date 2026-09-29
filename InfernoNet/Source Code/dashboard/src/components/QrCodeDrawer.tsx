import { QRCodeSVG } from 'qrcode.react';
import { useId, useRef, useState } from 'react';

export function QrCodeDrawer({
  uid,
  open,
  onClose,
}: {
  readonly uid: string;
  readonly open: boolean;
  readonly onClose: () => void;
}) {
  const titleId = useId();
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [copied, setCopied] = useState(false);

const download = () => {
    const svg = svgRef.current;
    if (svg === null) return;
    const serializer = new XMLSerializer();
    const source = serializer.serializeToString(svg);
    const blob = new Blob([source], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${uid}.svg`;
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  };

  const print = () => {
    const svg = svgRef.current;
    if (svg === null) return;
    const serializer = new XMLSerializer();
    const source = serializer.serializeToString(svg);
    const wrapper = window.open('', 'QRCode');
    if (wrapper === null) return;
    const doc = wrapper.document;
    doc.open();
    doc.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>QR code for ${uid}</title>
          <style>
            @media print {
              body { margin: 0; display: flex; align-items: center; justify-content: center; height: 100vh; }
              svg { max-width: 90vw; max-height: 90vh; }
            }
          </style>
        </head>
        <body>${source}</body>
      </html>
    `);
    doc.close();
    wrapper.onload = () => {
      wrapper.focus();
      wrapper.print();
      wrapper.close();
    };
  };

  const copy = () => {
    navigator.clipboard.writeText(uid).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  if (!open) return null;

  return (
    <div className="qr-drawer__backdrop" onClick={onClose}>
      <aside
        className="qr-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="qr-drawer__head">
          <h3 className="qr-drawer__title" id={titleId}>
            QR code for this item
          </h3>
          <button type="button" className="btn btn--quiet" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>

        <div className="qr-drawer__body">
          <p className="qr-drawer__uid">
            Unique id: <span className="num" translate="no">{uid}</span>
          </p>
          <div className="qr-drawer__canvas">
            <QRCodeSVG
              ref={svgRef}
              value={uid}
              size={256}
              level="M"
            />
          </div>
          {copied ? <p className="qr-drawer__copied">Copied!</p> : null}
        </div>

        <footer className="qr-drawer__foot">
          <div className="qr-drawer__actions">
            <button type="button" className="btn" onClick={copy}>
              Copy id
            </button>
            <button type="button" className="btn" onClick={download}>
              Download SVG
            </button>
            <button type="button" className="btn btn--primary" onClick={print}>
              Print
            </button>
          </div>
          <button type="button" className="btn btn--quiet" onClick={onClose}>
            Close
          </button>
        </footer>
      </aside>
    </div>
  );
}
