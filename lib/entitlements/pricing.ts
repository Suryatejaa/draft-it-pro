/**
 * Centralized Sarvam AI model pricing.
 *
 * All pricing is stored and calculated in integer paise.
 * Model token rates are defined in paise per 1,000 tokens.
 */

export interface ModelRate {
  inputPaisePer1k: number;
  outputPaisePer1k: number;
}

export const SARVAM_MODEL_RATES: Record<string, ModelRate> = {
  'sarvam-105b': {
    inputPaisePer1k: 10,
    outputPaisePer1k: 25,
  },
  'sarvam-2b': {
    inputPaisePer1k: 2,
    outputPaisePer1k: 5,
  },
};

const DEFAULT_RATE: ModelRate = {
  inputPaisePer1k: 10,
  outputPaisePer1k: 25,
};

export function getModelRates(model: string): ModelRate {
  return SARVAM_MODEL_RATES[model] || DEFAULT_RATE;
}

/**
 * Calculates prompt and completion costs in integer paise.
 */
export function calculateModelCostPaise(
  model: string,
  promptTokens: number,
  completionTokens: number
): { inputCostPaise: number; outputCostPaise: number; totalCostPaise: number } {
  const rate = getModelRates(model);
  const safePrompt = Math.max(0, promptTokens || 0);
  const safeCompletion = Math.max(0, completionTokens || 0);

  const inputCostPaise = Math.ceil((safePrompt * rate.inputPaisePer1k) / 1000);
  const outputCostPaise = Math.ceil((safeCompletion * rate.outputPaisePer1k) / 1000);
  const totalCostPaise = inputCostPaise + outputCostPaise;

  return {
    inputCostPaise,
    outputCostPaise,
    totalCostPaise,
  };
}

/**
 * Calculates a conservative estimated reservation cost before dispatch
 * to prevent concurrent request overspending.
 */
export function estimateReservationCostPaise(model: string, maxTokens = 2048): number {
  const rate = getModelRates(model);
  // Estimate ~1500 prompt tokens + maxTokens completion
  const estimatedPromptTokens = 1500;
  const inputCost = Math.ceil((estimatedPromptTokens * rate.inputPaisePer1k) / 1000);
  const outputCost = Math.ceil((maxTokens * rate.outputPaisePer1k) / 1000);
  // At least 20 paise minimum reservation
  return Math.max(20, inputCost + outputCost);
}
