"use client";

import { useState } from "react";

export default function SshKeyForm({ slug, existingKey }: { slug: string; existingKey: string | null }) {
  const [key, setKey] = useState(existingKey || "");
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  async function handleSave() {
    if (!key.trim()) return;
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/tenants/${slug}/ssh-key`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ publicKey: key.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save key");
      setMessage({ type: "success", text: "SSH key installed on VM" });
    } catch (e) {
      setMessage({ type: "error", text: e instanceof Error ? e.message : "Failed" });
    } finally {
      setSaving(false);
    }
  }

  async function handleRemove() {
    setRemoving(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/tenants/${slug}/ssh-key`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to remove key");
      setKey("");
      setMessage({ type: "success", text: "SSH key removed" });
    } catch (e) {
      setMessage({ type: "error", text: e instanceof Error ? e.message : "Failed" });
    } finally {
      setRemoving(false);
    }
  }

  return (
    <div className="bg-zinc-900/80 border border-zinc-800/60 rounded-xl p-5 space-y-3">
      <h2 className="text-[11px] text-zinc-500 uppercase tracking-wider font-medium">Your SSH Public Key</h2>
      <p className="text-zinc-500 text-sm">Paste your public key to enable SSH access to this VM.</p>
      <textarea
        value={key}
        onChange={(e) => setKey(e.target.value)}
        placeholder="ssh-ed25519 AAAA... you@example.com"
        rows={3}
        className="w-full bg-zinc-950 border border-zinc-800/60 rounded-lg px-3 py-2 text-xs font-mono text-zinc-300 placeholder:text-zinc-600 focus:outline-none focus:ring-1 focus:ring-brand/50 resize-none"
      />
      <div className="flex items-center gap-2">
        <button
          onClick={handleSave}
          disabled={saving || !key.trim()}
          className="px-4 py-2 bg-brand hover:bg-brand-light disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-colors"
        >
          {saving ? "Installing..." : "Save & Install Key"}
        </button>
        {existingKey && (
          <button
            onClick={handleRemove}
            disabled={removing}
            className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 text-zinc-300 text-sm font-medium rounded-lg transition-colors border border-zinc-700/60"
          >
            {removing ? "Removing..." : "Remove Key"}
          </button>
        )}
      </div>
      {message && (
        <p className={`text-sm ${message.type === "success" ? "text-emerald-400" : "text-red-400"}`}>
          {message.text}
        </p>
      )}
    </div>
  );
}
