"use client";

import { useState } from "react";

interface Props {
  existingKeys: string[];
  overrides: Record<string, string>;
  onChange: (overrides: Record<string, string>) => void;
}

export default function EnvOverridesEditor({ existingKeys, overrides, onChange }: Props) {
  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("");

  const allKeys = Array.from(new Set([...existingKeys, ...Object.keys(overrides)]));

  function addEntry() {
    if (!newKey.trim() || !newValue.trim()) return;
    onChange({ ...overrides, [newKey.trim()]: newValue.trim() });
    setNewKey("");
    setNewValue("");
  }

  function clearEntry(key: string) {
    onChange({ ...overrides, [key]: "" });
  }

  function removeNewEntry(key: string) {
    const next = { ...overrides };
    delete next[key];
    onChange(next);
  }

  return (
    <div className="space-y-3">
      <label className="block text-sm font-medium text-zinc-300">Environment Overrides</label>
      <p className="text-xs text-zinc-500">Per-tenant env vars that override global settings.</p>

      {allKeys.map((key) => {
        const isExisting = existingKeys.includes(key);
        const hasNewValue = key in overrides && overrides[key] !== "";
        const isMarkedForDeletion = key in overrides && overrides[key] === "";

        return (
          <div key={key} className="flex items-center gap-2">
            <span className="w-44 text-sm font-mono text-zinc-300 truncate shrink-0">{key}</span>
            {isExisting && !hasNewValue && !isMarkedForDeletion && (
              <>
                <span className="flex-1 text-xs text-zinc-500 italic">override set</span>
                <input
                  type="password"
                  value={overrides[key] || ""}
                  onChange={(e) => onChange({ ...overrides, [key]: e.target.value })}
                  placeholder="Enter new value"
                  className="flex-1 px-2.5 py-1.5 bg-zinc-900 border border-zinc-800 rounded-lg text-zinc-100 placeholder-zinc-600 text-xs focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand/50 transition-colors"
                />
                <button
                  type="button"
                  onClick={() => clearEntry(key)}
                  className="px-2 py-1 text-xs text-red-400 hover:text-red-300"
                >
                  Clear
                </button>
              </>
            )}
            {isExisting && isMarkedForDeletion && (
              <>
                <span className="flex-1 text-xs text-red-400 italic">will be cleared</span>
                <button
                  type="button"
                  onClick={() => removeNewEntry(key)}
                  className="px-2 py-1 text-xs text-zinc-400 hover:text-zinc-300"
                >
                  Undo
                </button>
              </>
            )}
            {!isExisting && (
              <>
                <input
                  type="password"
                  value={overrides[key] || ""}
                  onChange={(e) => onChange({ ...overrides, [key]: e.target.value })}
                  placeholder="Value"
                  className="flex-1 px-2.5 py-1.5 bg-zinc-900 border border-zinc-800 rounded-lg text-zinc-100 placeholder-zinc-600 text-xs focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand/50 transition-colors"
                />
                <button
                  type="button"
                  onClick={() => removeNewEntry(key)}
                  className="px-2 py-1 text-xs text-red-400 hover:text-red-300"
                >
                  Remove
                </button>
              </>
            )}
            {isExisting && hasNewValue && (
              <>
                <input
                  type="password"
                  value={overrides[key]}
                  onChange={(e) => onChange({ ...overrides, [key]: e.target.value })}
                  placeholder="New value"
                  className="flex-1 px-2.5 py-1.5 bg-zinc-900 border border-zinc-800 rounded-lg text-zinc-100 placeholder-zinc-600 text-xs focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand/50 transition-colors"
                />
                <button
                  type="button"
                  onClick={() => removeNewEntry(key)}
                  className="px-2 py-1 text-xs text-zinc-400 hover:text-zinc-300"
                >
                  Cancel
                </button>
              </>
            )}
          </div>
        );
      })}

      <div className="flex gap-2 pt-1">
        <input
          type="text"
          value={newKey}
          onChange={(e) => setNewKey(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, ""))}
          placeholder="KEY_NAME"
          className="w-44 px-2.5 py-1.5 bg-zinc-900 border border-zinc-800 rounded-lg text-zinc-100 placeholder-zinc-600 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand/50 transition-colors"
        />
        <input
          type="password"
          value={newValue}
          onChange={(e) => setNewValue(e.target.value)}
          placeholder="Value"
          className="flex-1 px-2.5 py-1.5 bg-zinc-900 border border-zinc-800 rounded-lg text-zinc-100 placeholder-zinc-600 text-xs focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand/50 transition-colors"
        />
        <button
          type="button"
          onClick={addEntry}
          disabled={!newKey.trim() || !newValue.trim()}
          className="px-3 py-1.5 bg-brand hover:bg-brand-light disabled:opacity-30 text-white text-xs font-medium rounded-lg transition-colors"
        >
          Add
        </button>
      </div>
    </div>
  );
}
