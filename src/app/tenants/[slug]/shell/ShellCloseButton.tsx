"use client";

export default function ShellCloseButton() {
  return (
    <button
      onClick={() => window.close()}
      className="px-3 py-1 text-xs bg-zinc-800 text-zinc-400 border border-zinc-700/60 rounded-lg hover:bg-zinc-700 hover:text-zinc-200 transition-colors"
    >
      Close
    </button>
  );
}
