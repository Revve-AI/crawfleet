---
paths:
  - "libs/llm*.ts"
  - "lib/ai*.ts"
  - "**/*llm*.ts"
  - "**/*langchain*.ts"
---

# LLM Rules (Auto-applied)

## Factory Functions

ALWAYS use `/libs/llm-factory.ts` for creating LLM instances.
Never instantiate OpenAI/Anthropic clients directly.

```typescript
// Correct
import { createOpenAILLM } from "@/libs/llm-factory"
const llm = await createOpenAILLM({ model: "gpt-4o", teamId })

// Incorrect - don't do this
import { ChatOpenAI } from "@langchain/openai"
const llm = new ChatOpenAI({ model: "gpt-4o" })
```

## Team API Keys

Use `getOpenAIKeyByTeamId(teamId)` for team-specific keys.
This allows teams to configure their own API keys.

## Key Reference Files

- `/libs/llm-factory.ts` - Instance factory
- `/libs/llm.ts` - Analysis functions
- `/lib/constants/ai-models.ts` - Model definitions
