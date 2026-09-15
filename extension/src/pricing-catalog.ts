import type { ModelDescriptor } from './model-selector';

export const MODEL_CATEGORIES = ['Lightweight', 'Versatile', 'Powerful'] as const;
export type ModelCategory = typeof MODEL_CATEGORIES[number];
export type ThresholdOperator = 'lt' | 'lte' | 'gt' | 'gte';

export const GITHUB_PRICING_SOURCE = 'https://raw.githubusercontent.com/github/docs/main/data/tables/copilot/models-and-pricing.yml';

export interface ModelPrice {
  provider: string;
  model: string;
  category: ModelCategory;
  tier: string;
  thresholdOperator: ThresholdOperator | null;
  thresholdTokens: number | null;
  inputUsdPerMillionTokens: number | null;
  outputUsdPerMillionTokens: number | null;
}

interface PricingDocument {
  prices?: Array<{
    provider?: unknown;
    model?: unknown;
    category?: unknown;
    tier?: unknown;
    threshold_operator?: unknown;
    threshold_tokens?: unknown;
    input_usd_per_million_tokens?: unknown;
    output_usd_per_million_tokens?: unknown;
  }>;
}

export function parsePricingCatalog(value: unknown): ModelPrice[] {
  const document = value as PricingDocument;
  if (!Array.isArray(document?.prices)) {
    throw new Error('Bundled pricing data does not contain a prices array.');
  }

  return document.prices.map((row, index) => {
    if (typeof row.provider !== 'string' || typeof row.model !== 'string' || typeof row.tier !== 'string') {
      throw new Error(`Bundled pricing row ${index + 1} is missing required text fields.`);
    }
    if (!isModelCategory(row.category)) {
      throw new Error(`Bundled pricing row ${index + 1} has unsupported category ${String(row.category)}.`);
    }
    if (!isThresholdOperator(row.threshold_operator)) {
      throw new Error(`Bundled pricing row ${index + 1} has an unsupported threshold operator.`);
    }
    return {
      provider: row.provider,
      model: row.model,
      category: row.category,
      tier: row.tier,
      thresholdOperator: row.threshold_operator,
      thresholdTokens: nullableNumber(row.threshold_tokens, 'threshold_tokens', index),
      inputUsdPerMillionTokens: nullableNumber(row.input_usd_per_million_tokens, 'input price', index),
      outputUsdPerMillionTokens: nullableNumber(row.output_usd_per_million_tokens, 'output price', index)
    };
  });
}

export function normalizeGithubPricing(value: unknown): ModelPrice[] {
  if (!Array.isArray(value)) {
    throw new Error('GitHub pricing source must contain a YAML list.');
  }

  return value.map((raw, index) => {
    if (!raw || typeof raw !== 'object') {
      throw new Error(`GitHub pricing row ${index + 1} must be an object.`);
    }
    const row = raw as Record<string, unknown>;
    if (typeof row.provider !== 'string' || typeof row.model !== 'string') {
      throw new Error(`GitHub pricing row ${index + 1} is missing a provider or model.`);
    }
    if (!isModelCategory(row.category)) {
      throw new Error(`GitHub pricing row ${index + 1} has unsupported category ${String(row.category)}.`);
    }
    const threshold = parseThreshold(row.threshold, index);
    return {
      provider: row.provider.trim().toLowerCase(),
      model: row.model.replace(/\[\^[^\]]+\]/g, '').trim(),
      category: row.category,
      tier: typeof row.tier === 'string' && row.tier.trim() ? row.tier.trim() : 'Default',
      thresholdOperator: threshold.operator,
      thresholdTokens: threshold.tokens,
      inputUsdPerMillionTokens: parsePrice(row.input, 'input price', index),
      outputUsdPerMillionTokens: parsePrice(row.output, 'output price', index)
    };
  });
}

export function serializePricingCatalog(prices: readonly ModelPrice[], sourceSha256: string): string {
  return JSON.stringify({
    schema_version: 1,
    unit: 'USD per 1 million tokens',
    source: { url: GITHUB_PRICING_SOURCE, sha256: sourceSha256 },
    prices: prices.map(price => ({
      provider: price.provider,
      model: price.model,
      category: price.category,
      tier: price.tier,
      threshold_operator: price.thresholdOperator,
      threshold_tokens: price.thresholdTokens,
      input_usd_per_million_tokens: price.inputUsdPerMillionTokens,
      output_usd_per_million_tokens: price.outputUsdPerMillionTokens
    }))
  }, null, 2) + '\n';
}

export function findModelPrice(
  model: ModelDescriptor,
  prices: readonly ModelPrice[],
  inputTokens = 0
): ModelPrice | undefined {
  const modelNames = [model.id, model.family, model.name]
    .flatMap(runtimeModelAliases);
  const matches = prices.filter(price => {
    const catalogName = normalizeModelName(price.model);
    return modelNames.includes(catalogName);
  });
  return matches.find(price => thresholdApplies(price, inputTokens));
}

export function blendedPrice(price: ModelPrice): number | undefined {
  if (price.inputUsdPerMillionTokens === null || price.outputUsdPerMillionTokens === null) {
    return undefined;
  }
  return price.inputUsdPerMillionTokens + price.outputUsdPerMillionTokens;
}

export function formatPrice(price: ModelPrice): string {
  const input = price.inputUsdPerMillionTokens === null ? 'n/a' : `$${price.inputUsdPerMillionTokens}`;
  const output = price.outputUsdPerMillionTokens === null ? 'n/a' : `$${price.outputUsdPerMillionTokens}`;
  return `${input} input + ${output} output per 1M tokens (${price.tier})`;
}

export function normalizeModelName(value: string): string {
  return value
    .toLowerCase()
    .replace(/\s*\(preview\)\s*$/i, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function runtimeModelAliases(value: string): string[] {
  const normalized = normalizeModelName(value);
  return normalized.startsWith('copilot-')
    ? [normalized, normalized.slice('copilot-'.length)]
    : [normalized];
}

function thresholdApplies(price: ModelPrice, inputTokens: number): boolean {
  if (price.thresholdOperator === null || price.thresholdTokens === null) return true;
  if (price.thresholdOperator === 'lt') return inputTokens < price.thresholdTokens;
  if (price.thresholdOperator === 'lte') return inputTokens <= price.thresholdTokens;
  if (price.thresholdOperator === 'gt') return inputTokens > price.thresholdTokens;
  return inputTokens >= price.thresholdTokens;
}

function parseThreshold(value: unknown, index: number): { operator: ThresholdOperator | null; tokens: number | null } {
  if (value === null || value === undefined || String(value).trim().toLowerCase() === 'not applicable') {
    return { operator: null, tokens: null };
  }
  const match = /^(≤|<=|<|>|≥|>=)\s*([\d,.]+)\s*([kmb]?)$/i.exec(String(value).trim());
  if (!match) {
    throw new Error(`GitHub pricing row ${index + 1} has unsupported threshold ${String(value)}.`);
  }
  const multipliers: Record<string, number> = { '': 1, k: 1_000, m: 1_000_000, b: 1_000_000_000 };
  const tokens = Number(match[2].replace(/,/g, '')) * multipliers[match[3].toLowerCase()];
  const operators: Record<string, ThresholdOperator> = {
    '≤': 'lte', '<=': 'lte', '<': 'lt', '>': 'gt', '≥': 'gte', '>=': 'gte'
  };
  if (!Number.isInteger(tokens)) {
    throw new Error(`GitHub pricing row ${index + 1} has a non-integer threshold.`);
  }
  return { operator: operators[match[1]], tokens };
}

function parsePrice(value: unknown, field: string, index: number): number | null {
  if (value === null || value === undefined || String(value).trim().toLowerCase() === 'not applicable') {
    return null;
  }
  const parsed = typeof value === 'number'
    ? value
    : Number(String(value).trim().replace(/[$,]/g, ''));
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`GitHub pricing row ${index + 1} has an invalid ${field}.`);
  }
  return parsed;
}

function isModelCategory(value: unknown): value is ModelCategory {
  return typeof value === 'string' && MODEL_CATEGORIES.includes(value as ModelCategory);
}

function isThresholdOperator(value: unknown): value is ThresholdOperator | null {
  return value === null || value === 'lt' || value === 'lte' || value === 'gt' || value === 'gte';
}

function nullableNumber(value: unknown, field: string, index: number): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  throw new Error(`Bundled pricing row ${index + 1} has an invalid ${field}.`);
}
