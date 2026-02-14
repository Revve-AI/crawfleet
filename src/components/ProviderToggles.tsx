"use client";

interface Props {
  values: {
    allowAnthropic: boolean;
    allowOpenAI: boolean;
    allowGemini: boolean;
    allowBrave: boolean;
    allowElevenLabs: boolean;
  };
  onChange: (key: string, value: boolean) => void;
}

const providers = [
  { key: "allowAnthropic", label: "Anthropic", desc: "Claude models" },
  { key: "allowOpenAI", label: "OpenAI", desc: "GPT models" },
  { key: "allowGemini", label: "Gemini", desc: "Google models" },
  { key: "allowBrave", label: "Brave Search", desc: "Web search" },
  { key: "allowElevenLabs", label: "ElevenLabs", desc: "Voice/TTS" },
];

export default function ProviderToggles({ values, onChange }: Props) {
  return (
    <div className="space-y-3">
      <label className="block text-sm font-medium text-gray-300">Provider Access</label>
      {providers.map((p) => (
        <label key={p.key} className="flex items-center gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={values[p.key as keyof typeof values]}
            onChange={(e) => onChange(p.key, e.target.checked)}
            className="w-4 h-4 rounded border-gray-600 bg-gray-800 text-blue-500 focus:ring-blue-500/30"
          />
          <div>
            <span className="text-sm text-gray-200">{p.label}</span>
            <span className="text-xs text-gray-500 ml-2">{p.desc}</span>
          </div>
        </label>
      ))}
    </div>
  );
}
