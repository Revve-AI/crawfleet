"use client";

import { useState, useEffect } from "react";

interface Setting {
  key: string;
  masked: string;
}

export default function SettingsForm() {
  const [settings, setSettings] = useState<Setting[]>([]);
  const [editValues, setEditValues] = useState<Record<string, string>>({});
  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("");
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState("");

  async function load() {
    const res = await fetch("/api/settings");
    const data = await res.json();
    if (data.data) setSettings(data.data);
  }

  useEffect(() => { load(); }, []);

  async function save(key: string, value: string) {
    setSaving(key);
    setError("");
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [key]: value }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Save failed");
      }
      setEditValues((prev) => { const next = { ...prev }; delete next[key]; return next; });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setSaving(null);
    }
  }

  async function handleAdd() {
    if (!newKey.trim() || !newValue.trim()) return;
    await save(newKey.trim(), newValue.trim());
    setNewKey("");
    setNewValue("");
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="bg-red-500/10 border border-red-500/20 text-red-400 px-4 py-3 rounded-lg text-sm">
          {error}
        </div>
      )}

      {settings.map((s) => (
        <div key={s.key} className="bg-zinc-800/40 border border-zinc-700/50 rounded-lg p-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-zinc-200 font-mono">{s.key}</span>
            <span className="text-xs text-zinc-500 font-mono">{s.masked}</span>
          </div>
          <div className="flex gap-2">
            <input
              type="password"
              value={editValues[s.key] || ""}
              onChange={(e) => setEditValues((prev) => ({ ...prev, [s.key]: e.target.value }))}
              placeholder="Enter new value to replace"
              className="flex-1 px-3 py-1.5 bg-zinc-900 border border-zinc-800 rounded-lg text-zinc-100 placeholder-zinc-600 text-sm focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand/50 transition-colors"
            />
            <button
              onClick={() => save(s.key, editValues[s.key] || "")}
              disabled={!editValues[s.key] || saving === s.key}
              className="px-3 py-1.5 bg-brand hover:bg-brand-light disabled:opacity-30 text-white text-sm font-medium rounded-lg transition-colors"
            >
              {saving === s.key ? "..." : "Save"}
            </button>
            <button
              onClick={() => save(s.key, "")}
              disabled={saving === s.key}
              className="px-3 py-1.5 text-red-400 hover:bg-red-500/10 border border-transparent hover:border-red-500/20 text-sm rounded-lg transition-all disabled:opacity-50"
            >
              Delete
            </button>
          </div>
        </div>
      ))}

      <div className="border border-dashed border-zinc-700/60 rounded-lg p-4 space-y-3">
        <p className="text-sm text-zinc-400">Add new variable</p>
        <div className="flex gap-2">
          <input
            type="text"
            value={newKey}
            onChange={(e) => setNewKey(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, ""))}
            placeholder="KEY_NAME"
            className="w-48 px-3 py-1.5 bg-zinc-900 border border-zinc-800 rounded-lg text-zinc-100 placeholder-zinc-600 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand/50 transition-colors"
          />
          <input
            type="password"
            value={newValue}
            onChange={(e) => setNewValue(e.target.value)}
            placeholder="Value"
            className="flex-1 px-3 py-1.5 bg-zinc-900 border border-zinc-800 rounded-lg text-zinc-100 placeholder-zinc-600 text-sm focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand/50 transition-colors"
          />
          <button
            onClick={handleAdd}
            disabled={!newKey.trim() || !newValue.trim() || saving !== null}
            className="px-4 py-1.5 bg-brand hover:bg-brand-light disabled:opacity-30 text-white text-sm font-medium rounded-lg transition-colors"
          >
            Add
          </button>
        </div>
      </div>

      {settings.length === 0 && (
        <p className="text-sm text-zinc-500">No variables configured. Environment variables from .env are still used as fallback.</p>
      )}
    </div>
  );
}
