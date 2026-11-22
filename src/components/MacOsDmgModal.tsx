import React, { useEffect, useState } from 'react';
import { Download, Check, Copy, HardDrive, Package, Terminal, X, Sparkles, ShieldCheck, ExternalLink } from 'lucide-react';
import { copyToClipboard } from '../utils/clipboardUtils';

interface MacOsPackageInfo {
  available: boolean;
  version: string;
  appId: string;
  productName: string;
  dmgFilename: string;
  dmgSizeBytes: number;
  dmgSizeMb: number;
  zipFilename: string;
  zipSizeBytes: number;
  zipSizeMb: number;
  updatedAt: number;
  includedComponents: string[];
}

interface MacOsDmgModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const MacOsDmgModal: React.FC<MacOsDmgModalProps> = ({ isOpen, onClose }) => {
  const [info, setInfo] = useState<MacOsPackageInfo | null>(null);
  const [loadingInfo, setLoadingInfo] = useState(false);
  const [downloadingFormat, setDownloadingFormat] = useState<'dmg' | 'zip' | null>(null);
  const [downloadProgress, setDownloadProgress] = useState<number>(0);
  const [downloadSuccess, setDownloadSuccess] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [copiedCurl, setCopiedCurl] = useState(false);

  const dmgUrl = typeof window !== 'undefined' ? `${window.location.origin}/api/download/macos-dmg` : '/api/download/macos-dmg';

  useEffect(() => {
    if (!isOpen) return;
    setLoadingInfo(true);
    fetch('/api/download/macos-info')
      .then((r) => r.json())
      .then((data) => {
        if (data && data.status === 'success') {
          setInfo(data);
        }
      })
      .catch(() => {})
      .finally(() => setLoadingInfo(false));
  }, [isOpen]);

  if (!isOpen) return null;

  const triggerBlobDownload = async (format: 'dmg' | 'zip') => {
    const endpoint = format === 'dmg' ? '/api/download/macos-dmg' : '/api/download/macos-zip';
    const filename = format === 'dmg' ? 'DeltaAI-1.0.0.dmg' : 'DeltaAI-macOS-1.0.0.zip';
    setDownloadingFormat(format);
    setDownloadProgress(5);
    setDownloadError(null);
    setDownloadSuccess(null);

    try {
      const response = await fetch(endpoint);
      if (!response.ok) {
        throw new Error(`Server returned ${response.status}`);
      }

      const contentLength = Number(response.headers.get('Content-Length')) || (info?.dmgSizeBytes ?? 9500000);
      const reader = response.body?.getReader();

      let blob: Blob;
      if (reader) {
        const chunks: Uint8Array[] = [];
        let receivedLength = 0;
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) {
            chunks.push(value);
            receivedLength += value.length;
            if (contentLength > 0) {
              setDownloadProgress(Math.min(99, Math.round((receivedLength / contentLength) * 100)));
            }
          }
        }
        blob = new Blob(chunks as BlobPart[], {
          type: format === 'dmg' ? 'application/x-apple-diskimage' : 'application/zip',
        });
      } else {
        blob = await response.blob();
      }

      setDownloadProgress(100);
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(blobUrl), 15000);

      setDownloadSuccess(`${filename} (${(blob.size / (1024 * 1024)).toFixed(2)} MB) downloaded to your Mac!`);
    } catch (err: any) {
      setDownloadError(err?.message || 'Failed to stream package. Use the Direct Download Link below.');
    } finally {
      setDownloadingFormat(null);
    }
  };

  const handleCopyUrl = async () => {
    await copyToClipboard(dmgUrl);
    setCopiedUrl(true);
    setTimeout(() => setCopiedUrl(false), 2000);
  };

  const handleCopyCurl = async () => {
    await copyToClipboard(`curl -L "${dmgUrl}" -o ~/Downloads/DeltaAI-1.0.0.dmg`);
    setCopiedCurl(true);
    setTimeout(() => setCopiedCurl(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
      <div className="relative w-full max-w-2xl rounded-2xl panel-delta border-emerald-500/40 shadow-[0_0_50px_rgba(16,185,129,0.25)] overflow-hidden text-slate-100">
        {/* Top Header */}
        <div className="flex items-center justify-between px-6 py-4 bg-gradient-to-r from-emerald-950/60 via-slate-900 to-cyan-950/50 border-b border-emerald-500/30 gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/20 border border-emerald-400/40 flex items-center justify-center shrink-0">
              <HardDrive className="w-5 h-5 text-emerald-400" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="panel-delta-title text-base text-white normal-case tracking-wide">
                  DeltaAI macOS Desktop Installer (.dmg)
                </h2>
                <span className="badge-delta badge-delta-live font-mono">
                  v{info?.version || '1.0.0'} Universal
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Complete Standalone Package • Apple Silicon (M1/M2/M3/M4) &amp; Intel macOS
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="btn-delta-sm btn-secondary px-2 shrink-0"
            aria-label="Close macOS download modal"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-5 max-h-[82vh] overflow-y-auto">
          {/* Primary Action Card */}
          <div className="p-4 rounded-xl bg-gradient-to-br from-emerald-950/40 via-[#101726] to-cyan-950/30 border border-emerald-500/30 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="space-y-1">
                <div className="flex items-center gap-2 text-emerald-300 font-mono text-sm font-bold">
                  <Package className="w-4 h-4" />
                  <span>DeltaAI-1.0.0.dmg</span>
                  <span className="text-xs text-slate-400 font-normal">
                    ({loadingInfo ? 'Checking size...' : `${info?.dmgSizeMb || 9.2} MB`})
                  </span>
                </div>
                <p className="text-xs text-slate-300">
                  Mounts natively in macOS Finder (`DiskImageMounter`). Includes `DeltaAI.app`, compiled production UI, self-contained Express/WebSocket server, Electron launcher, and full source code.
                </p>
              </div>

              <button
                onClick={() => triggerBlobDownload('dmg')}
                disabled={downloadingFormat !== null}
                className="btn-delta-lg btn-primary font-mono"
              >
                <Download className="w-4 h-4" />
                <span>
                  {downloadingFormat === 'dmg'
                    ? `Downloading (${downloadProgress}%)...`
                    : 'Download DeltaAI-1.0.0.dmg'}
                </span>
              </button>
            </div>

            {/* Progress Bar */}
            {downloadingFormat !== null && (
              <div className="w-full bg-slate-800/90 h-2 rounded-full overflow-hidden">
                <div
                  className="bg-gradient-to-r from-emerald-400 to-cyan-400 h-full transition-all duration-200"
                  style={{ width: `${downloadProgress}%` }}
                />
              </div>
            )}

            {/* Status Feedback */}
            {downloadSuccess && (
              <div className="flex items-center gap-2 text-xs text-emerald-300 bg-emerald-500/15 border border-emerald-500/30 px-3 py-2 rounded-lg">
                <ShieldCheck className="w-4 h-4 shrink-0" />
                <span>{downloadSuccess}</span>
              </div>
            )}

            {downloadError && (
              <div className="text-xs text-amber-300 bg-amber-500/15 border border-amber-500/30 px-3 py-2 rounded-lg">
                {downloadError}
              </div>
            )}

            {/* Secondary Download Options (Direct Anchor + ZIP + Copy Link) */}
            <div className="pt-2 border-t border-slate-800/80 flex flex-wrap items-center justify-between gap-2 text-xs">
              <div className="flex flex-wrap items-center gap-2">
                <a
                  href="/api/download/macos-dmg"
                  download="DeltaAI-1.0.0.dmg"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn-delta-sm btn-toggle-active font-mono"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  <span>Direct .dmg Link</span>
                </a>

                <button
                  onClick={() => triggerBlobDownload('zip')}
                  disabled={downloadingFormat !== null}
                  className="btn-delta-sm btn-secondary font-mono"
                >
                  <Download className="w-3.5 h-3.5 text-cyan-400" />
                  <span>Download .zip ({info?.zipSizeMb || 5.4} MB)</span>
                </button>
              </div>

              <button
                onClick={handleCopyUrl}
                className="btn-delta-sm btn-secondary font-mono"
              >
                {copiedUrl ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5 text-emerald-400" />}
                <span>{copiedUrl ? 'Copied .dmg URL!' : 'Copy Direct .dmg URL'}</span>
              </button>
            </div>
          </div>

          {/* Terminal 1-Liner Download Option */}
          <div className="p-3.5 rounded-xl bg-[#0D1322] border border-slate-800 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-mono font-bold text-cyan-300 flex items-center gap-1.5">
                <Terminal className="w-3.5 h-3.5" />
                <span>macOS Terminal Direct Download (Optional)</span>
              </span>
              <button
                onClick={handleCopyCurl}
                className="btn-delta-sm btn-secondary font-mono"
              >
                {copiedCurl ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                <span>{copiedCurl ? 'Copied' : 'Copy Command'}</span>
              </button>
            </div>
            <pre className="text-[11px] font-mono text-slate-300 bg-black/50 p-2.5 rounded-lg overflow-x-auto border border-slate-800/80">
              {`curl -L "${dmgUrl}" -o ~/Downloads/DeltaAI-1.0.0.dmg && open ~/Downloads/DeltaAI-1.0.0.dmg`}
            </pre>
          </div>

          {/* Included in Whole Package */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="p-3.5 rounded-xl bg-[#0D1322] border border-slate-800/90 space-y-2">
              <h3 className="text-xs font-mono font-bold uppercase tracking-wider text-emerald-400 flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5" />
                <span>Bundled Inside DeltaAI-1.0.0.dmg</span>
              </h3>
              <ul className="space-y-1.5 text-xs text-slate-300">
                {(
                  info?.includedComponents || [
                    'DeltaAI.app (macOS Native Application Bundle)',
                    'dist/ (Compiled Production Frontend & PWA Assets)',
                    'dist-server/server.cjs (Self-Contained Express + WS Backend)',
                    'electron/main.cjs (Native 1440x900 Dark Window)',
                    'src/ & server.ts (Complete Full-Stack Source Code)',
                  ]
                ).map((item, idx) => (
                  <li key={idx} className="flex items-start gap-2">
                    <span className="text-emerald-400 font-bold">•</span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="p-3.5 rounded-xl bg-[#0D1322] border border-slate-800/90 space-y-2">
              <h3 className="text-xs font-mono font-bold uppercase tracking-wider text-cyan-400">
                macOS Installation Steps
              </h3>
              <ol className="space-y-1.5 text-xs text-slate-300 list-decimal list-inside">
                <li>
                  Double-click <code className="text-emerald-300 font-mono">DeltaAI-1.0.0.dmg</code> to mount the volume in Finder.
                </li>
                <li>
                  Drag <code className="text-emerald-300 font-mono">DeltaAI.app</code> into your <code className="text-cyan-300 font-mono">/Applications</code> folder.
                </li>
                <li>
                  If macOS Gatekeeper prompts on first launch, run:
                  <code className="block mt-1 px-2 py-1 rounded bg-black/60 text-[11px] font-mono text-amber-300">
                    xattr -cr /Applications/DeltaAI.app
                  </code>
                </li>
                <li>Launch <code className="text-emerald-300 font-mono">DeltaAI.app</code> to start the trading desk.</li>
              </ol>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
