export type {
  CompletionOptions,
  CompletionProvider,
  CompletionResult,
  EmbeddingProvider,
} from './provider';

export { createGroqProvider, GROQ_SUMMARY_MODEL } from './groq';

export { createGeminiProvider, GEMINI_ASSISTANT_MODEL } from './gemini';

export {
  createAssistantProvider,
  GROQ_ASSISTANT_MODEL,
  type AssistantProviderConfig,
  type AssistantProviderResult,
} from './assistant-provider';

export {
  ABSOLUTE_FLOOR,
  ASSISTANT_SYSTEM_PROMPT,
  buildAssistantPrompt,
  EMPTY_CORPUS_ANSWER,
  MAX_CONTEXT_MESSAGES,
  parseAnswer,
  RELATIVE_FLOOR,
  selectContext,
  type ParsedAnswer,
  type RetrievedMessage,
} from './assistant';

export {
  chunkText,
  CHUNK_OVERLAP,
  CHUNK_SIZE,
  type Chunk,
} from './chunk';

export {
  embedPassages,
  embedQuery,
  EMBEDDING_DIMENSIONS,
  EMBEDDING_MODEL,
  isEmbedderLoaded,
  localEmbeddingProvider,
  toVectorLiteral,
  warmEmbedder,
} from './embed';

export {
  buildSummaryPrompt,
  randomNonce,
  shouldSummarise,
  SUMMARY_INPUT_LIMIT,
  SUMMARY_MAX_CHARS,
  SUMMARY_MIN_BODY,
  SUMMARY_SYSTEM_PROMPT,
  validateSummary,
  type SkipReason,
  type SummarisableMessage,
  type SummaryDecision,
  type SummaryValidation,
} from './summarize';
