import type { AiCreditManager } from '../entitlements/credit-manager.ts';
import { normalizeSarvamChatResponse, wireMessages, wireTools } from './providers/chat-transport.ts';
import type { LLMMessage, ToolDefinition } from './types.ts';

export interface HostedChatUser {
  uid: string;
}

export interface HostedChatResult {
  status: number;
  body: unknown;
  creditReconciled?: boolean;
}

const SARVAM_ENDPOINT = 'https://api.sarvam.ai/v1/chat/completions';

function sanitizeUpstreamError(value: string): string {
  return value
    .replace(/Bearer\s+[^\s,}]+/gi, 'Bearer [redacted]')
    .replace(/(?:api[-_]?subscription[-_]?key|api[-_]?key|token|secret)["']?\s*[:=]\s*["']?[^\s,"'}]+/gi, '$1: [redacted]')
    .slice(0, 1000);
}

export async function executeHostedChat(
  body: Record<string, any>,
  user: HostedChatUser,
  creditManager: AiCreditManager,
  fetchImpl: typeof fetch = fetch,
): Promise<HostedChatResult> {
  const {
    requestId = `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    messages = [],
    systemInstruction,
    tools,
    maxTokens = 2048,
    temperature,
    reasoningEffort,
    intent,
  } = body;
  let reservation: { reservedPaise: number; requestId: string } | null = null;

  try {
    reservation = await creditManager.reserveCredit({
      userId: user.uid,
      requestId,
      model: 'sarvam-105b',
      maxTokens,
    });

    const platformApiKey = process.env.SARVAM_PLATFORM_API_KEY;
    if (!platformApiKey) {
      console.error('SARVAM_PLATFORM_API_KEY is not configured');
      await creditManager.releaseReservation(user.uid, reservation.reservedPaise);
      return {
        status: 503,
        body: { error: 'Co-Drafter is temporarily unavailable. Please try again shortly.' },
        creditReconciled: true,
      };
    }

    const payload: Record<string, unknown> = {
      model: 'sarvam-105b',
      messages: wireMessages((systemInstruction
        ? [{ role: 'system', content: systemInstruction }, ...messages]
        : messages) as LLMMessage[]),
      max_tokens: maxTokens,
      temperature: temperature ?? (intent === 'alternatives' ? 0.2 : 0.7),
      stream: false,
    };

    if (tools && Array.isArray(tools) && tools.length > 0) {
      Object.assign(payload, wireTools({ tools: tools as ToolDefinition[] } as any), { tool_choice: 'auto' });
    }

    if (reasoningEffort !== undefined) {
      payload.reasoning_effort = reasoningEffort;
    } else if (intent === 'alternatives') {
      payload.reasoning_effort = null;
    }

    let sarvamRes: Response;
    try {
      sarvamRes = await fetchImpl(SARVAM_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${platformApiKey}`,
          'api-subscription-key': platformApiKey,
        },
        body: JSON.stringify(payload),
      });
    } catch (error) {
      if (process.env.NODE_ENV === 'development') {
        console.error('[Hosted Sarvam network failure]', {
          endpoint: SARVAM_ENDPOINT,
          model: 'sarvam-105b',
          platformKeyConfigured: platformApiKey.trim().length > 0,
          error: error instanceof Error ? sanitizeUpstreamError(error.message) : 'Unknown network error',
        });
      }
      throw error;
    }

    if (!sarvamRes.ok) {
      const errorBody = await sarvamRes.text().catch(() => '');
      if (process.env.NODE_ENV === 'development') {
        console.error('[Hosted Sarvam upstream failure]', {
          status: sarvamRes.status,
          statusText: sarvamRes.statusText,
          endpoint: SARVAM_ENDPOINT,
          model: 'sarvam-105b',
          platformKeyConfigured: platformApiKey.trim().length > 0,
          stream: false,
          error: sanitizeUpstreamError(errorBody || 'No response body'),
        });
      }
      await creditManager.releaseReservation(user.uid, reservation.reservedPaise);
      return {
        status: 502,
        body: { error: 'Hosted AI upstream service failed. Please try again shortly.' },
        creditReconciled: true,
      };
    }

    const data = await sarvamRes.json();
    if (process.env.NODE_ENV === 'development') {
      console.debug('[Hosted Sarvam response shape]', {
        topLevelKeys: data && typeof data === 'object' ? Object.keys(data) : [],
        choiceCount: Array.isArray(data?.choices) ? data.choices.length : 0,
        messageKeys: data?.choices?.[0]?.message && typeof data.choices[0].message === 'object'
          ? Object.keys(data.choices[0].message)
          : [],
        hasContent: typeof data?.choices?.[0]?.message?.content === 'string' && data.choices[0].message.content.length > 0,
        contentType: typeof data?.choices?.[0]?.message?.content,
        hasToolCalls: Array.isArray(data?.choices?.[0]?.message?.tool_calls) && data.choices[0].message.tool_calls.length > 0,
        finishReason: data?.choices?.[0]?.finish_reason || null,
        usageKeys: data?.usage && typeof data.usage === 'object' ? Object.keys(data.usage) : [],
      });
    }
    await creditManager.commitCreditUsage({
      userId: user.uid,
      requestId,
      model: 'sarvam-105b',
      provider: 'sarvam',
      intent,
      promptTokens: data.usage?.prompt_tokens || 0,
      completionTokens: data.usage?.completion_tokens || 0,
      reservedPaise: reservation.reservedPaise,
    });

    return { status: 200, body: data, creditReconciled: true };
  } catch (error: any) {
    if (reservation) {
      await creditManager.releaseReservation(user.uid, reservation.reservedPaise);
    }
    const status = error.statusCode || 500;
    return {
      status,
      body: {
        error: status >= 500
          ? 'Hosted AI execution failed. Please try again shortly.'
          : error.message || 'Hosted AI execution failed.',
      },
      creditReconciled: Boolean(reservation),
    };
  }
}
