import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Upload, File, CheckCircle, AlertCircle, X } from 'lucide-react';
import { importFromString, useSongStore } from '@song-chords/shared';
import { db } from '../ipc/ipc-client';

interface ImportResult {
  filename: string;
  status: 'success' | 'error';
  message?: string;
  songId?: string;
}

export default function ImportPage(): React.ReactElement {
  const navigate = useNavigate();
  const { addSong } = useSongStore();
  const [results, setResults] = useState<ImportResult[]>([]);
  const [importing, setImporting] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  const importFiles = async (filePaths: string[]) => {
    setImporting(true);
    const newResults: ImportResult[] = [];

    for (const filePath of filePaths) {
      const filename = filePath.split(/[/\\]/).pop() ?? filePath;
      try {
        const content = await window.electronAPI.files.readFile(filePath);
        const input = importFromString(content, filename);
        const song = await addSong(db, input);
        newResults.push({ filename, status: 'success', songId: song.id });
      } catch (e) {
        newResults.push({ filename, status: 'error', message: String(e) });
      }
    }

    setResults((prev) => [...newResults, ...prev]);
    setImporting(false);
  };

  const handleBrowse = async () => {
    const paths = await window.electronAPI.files.openDialog([
      { name: 'ChordPro / Text', extensions: ['cho', 'chordpro', 'chopro', 'crd', 'txt'] },
      { name: 'All Files', extensions: ['*'] },
    ]);
    if (paths) await importFiles(paths);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const files: string[] = [];
    for (const item of Array.from(e.dataTransfer.files)) {
      // In Electron, File objects have a path property
      const path = (item as { path?: string }).path;
      if (path) files.push(path);
    }
    if (files.length) await importFiles(files);
  };

  return (
    <div className="flex flex-col h-full p-8 max-w-3xl mx-auto">
      <h1 className="text-2xl font-bold mb-6" style={{ color: 'var(--text-primary)' }}>Import Songs</h1>

      {/* Drop zone */}
      <div
        onDrop={handleDrop}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        className="flex flex-col items-center justify-center gap-4 p-12 rounded-2xl border-2 border-dashed transition-colors cursor-pointer mb-8"
        style={{
          borderColor: dragOver ? 'var(--accent)' : 'var(--border)',
          background: dragOver ? 'color-mix(in srgb, var(--accent) 8%, transparent)' : 'var(--bg-secondary)',
        }}
        onClick={handleBrowse}
      >
        <Upload size={40} style={{ color: dragOver ? 'var(--accent)' : 'var(--text-muted)' }} />
        <div className="text-center">
          <p className="font-semibold" style={{ color: 'var(--text-primary)' }}>Drop files here or click to browse</p>
          <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>
            Supports ChordPro (.cho, .chordpro, .chopro, .crd) and plain text (.txt)
          </p>
        </div>
        <button
          onClick={(e) => { e.stopPropagation(); handleBrowse(); }}
          className="px-4 py-2 rounded-lg text-sm font-medium mt-2"
          style={{ background: 'var(--accent)', color: 'white' }}
        >
          {importing ? 'Importing...' : 'Browse Files'}
        </button>
      </div>

      {/* Results */}
      {results.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold" style={{ color: 'var(--text-primary)' }}>Import Results</h2>
            <button onClick={() => setResults([])} className="text-sm" style={{ color: 'var(--text-muted)' }}>Clear</button>
          </div>
          <div className="flex flex-col gap-2">
            {results.map((result, i) => (
              <div key={i} className="flex items-center gap-3 p-3 rounded-xl" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
                {result.status === 'success' ? (
                  <CheckCircle size={18} style={{ color: 'var(--success)', flexShrink: 0 }} />
                ) : (
                  <AlertCircle size={18} style={{ color: 'var(--danger)', flexShrink: 0 }} />
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>{result.filename}</p>
                  {result.message && <p className="text-xs" style={{ color: 'var(--danger)' }}>{result.message}</p>}
                </div>
                {result.songId && (
                  <button
                    onClick={() => navigate(`/song/${result.songId}`)}
                    className="text-xs px-2 py-1 rounded"
                    style={{ color: 'var(--accent)' }}
                  >
                    View
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
