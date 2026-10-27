export interface TokenUsage { promptTokens: number; completionTokens: number; cachedTokens: number }
export type BillingState = 'not_submitted' | 'rejected' | 'reported' | 'unknown';
export interface AiCompletion { value: unknown; usage: TokenUsage; requestId: string; model: string }
export interface AiMessage {
  role: 'system' | 'user';
  content: string | Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }>;
}
export interface AiProvider { configured: boolean; complete(messages: AiMessage[]): Promise<AiCompletion> }
export class DeepSeekError extends Error {
  constructor(public code: string, message: string, public billingState: BillingState,
    public usage?: TokenUsage, public requestId = '') { super(message); }
}
const counter = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0;
function usageOf(value: unknown): TokenUsage {
  const usage = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return { promptTokens: counter(usage.prompt_tokens), completionTokens: counter(usage.completion_tokens), cachedTokens: counter(usage.prompt_cache_hit_tokens) };
}
export function createDeepSeekClient(options: { apiKey?: string; fetchImpl?: typeof fetch }): AiProvider {
  const apiKey = options.apiKey?.trim() || '';
  const fetchImpl = options.fetchImpl || fetch;
  return {
    configured: Boolean(apiKey),
    async complete(messages) {
      if (!apiKey) throw new DeepSeekError('AI_NOT_CONFIGURED', '智能服务尚未配置', 'not_submitted');
      let response: Response;
      try {
        response = await fetchImpl('https://api.deepseek.com/chat/completions', {
          method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({ model: 'deepseek-flash', messages, thinking: { type: 'disabled' },
            response_format: { type: 'json_object' }, max_tokens: 1600, stream: false }),
          signal: AbortSignal.timeout(20000), redirect: 'error',
        });
      } catch {
        // A network error cannot prove that a paid request was not accepted.
        throw new DeepSeekError('AI_SUBMISSION_UNKNOWN', '智能服务提交结果暂不确定，请查看原任务', 'unknown');
      }
      if (!response.ok) {
        const known = response.status >= 400 && response.status < 500;
        const code = response.status === 401 ? 'AI_AUTH_FAILED' : response.status === 402 ? 'AI_BALANCE_LOW'
          : response.status === 429 ? 'AI_RATE_LIMITED' : 'AI_UNAVAILABLE';
        // Upstream bodies can contain credential fragments. Never expose or log them.
        await response.body?.cancel().catch(() => {});
        throw new DeepSeekError(code, code === 'AI_BALANCE_LOW' ? '智能服务余额不足' : '智能服务暂不可用，请稍后查看任务', known ? 'rejected' : 'unknown');
      }
      let body: Record<string, unknown>;
      try {
        const raw = await response.text();
        if (raw.length > 100000) throw new Error('RESPONSE_TOO_LARGE');
        body = JSON.parse(raw);
        if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('INVALID_RESPONSE');
      } catch {
        throw new DeepSeekError('AI_INVALID_RESPONSE', '智能服务返回内容无法读取', 'unknown');
      }
      const usage = usageOf(body.usage);
      const requestId = typeof body.id === 'string' && body.id.length <= 200 ? body.id : '';
      const choices = body.choices as Array<{ finish_reason?: string; message?: { content?: unknown } }> | undefined;
      const content = choices?.[0]?.message?.content;
      let value: unknown;
      try {
        if (choices?.[0]?.finish_reason !== 'stop' || typeof content !== 'string' || content.length > 20000) throw new Error('INVALID_COMPLETION');
        value = JSON.parse(content);
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('INVALID_JSON_OBJECT');
      } catch {
        throw new DeepSeekError('AI_INVALID_RESPONSE', '智能服务未返回完整建议，请查看任务记录', 'reported', usage, requestId);
      }
      return { value, usage, requestId, model: 'deepseek-flash' };
    },
  };
}
