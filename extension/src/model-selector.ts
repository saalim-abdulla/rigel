import { blendedPrice, findModelPrice } from './pricing-catalog';
import type { ModelCategory, ModelPrice } from './pricing-catalog';

export interface ModelDescriptor {
  id: string;
  name: string;
  family: string;
  vendor: string;
}

export interface ModelSelection<T extends ModelDescriptor> {
  model?: T;
  category: ModelCategory;
  price?: ModelPrice;
  reason: string;
}

export interface ModelSelectionOptions<T extends ModelDescriptor> {
  category: ModelCategory;
  available: readonly T[];
  prices: readonly ModelPrice[];
  inputTokens?: number;
  favoriteModelId?: string;
}

export function selectModel<T extends ModelDescriptor>(
  options: ModelSelectionOptions<T>
): ModelSelection<T> {
  const candidates = options.available
    .filter(model => model.vendor.toLowerCase() === 'copilot')
    .map(model => ({ model, price: findModelPrice(model, options.prices, options.inputTokens ?? 0) }))
    .filter((candidate): candidate is { model: T; price: ModelPrice } =>
      candidate.price?.category === options.category
    );

  if (options.favoriteModelId) {
    const favorite = candidates.find(candidate => candidate.model.id === options.favoriteModelId);
    if (favorite) {
      return {
        model: favorite.model,
        category: options.category,
        price: favorite.price,
        reason: `Using your favorite ${options.category} model.`
      };
    }
  }

  const cheapest = candidates
    .filter(candidate => blendedPrice(candidate.price) !== undefined)
    .sort(comparePrice)[0];
  if (cheapest) {
    return {
      model: cheapest.model,
      category: options.category,
      price: cheapest.price,
      reason: `Using the cheapest available ${options.category} model in the bundled GitHub pricing catalog.`
    };
  }

  return {
    category: options.category,
    reason: candidates.length
      ? `No available ${options.category} model has complete published input and output prices.`
      : `No available Copilot model matched GitHub's ${options.category} category.`
  };
}

export function describeModel(model: ModelDescriptor): string {
  return `${model.name} (${model.family}; ${model.id})`;
}

function comparePrice<T extends ModelDescriptor>(
  left: { model: T; price: ModelPrice },
  right: { model: T; price: ModelPrice }
): number {
  const leftScore = blendedPrice(left.price) ?? Number.POSITIVE_INFINITY;
  const rightScore = blendedPrice(right.price) ?? Number.POSITIVE_INFINITY;
  return leftScore - rightScore
    || nullablePrice(left.price.inputUsdPerMillionTokens) - nullablePrice(right.price.inputUsdPerMillionTokens)
    || nullablePrice(left.price.outputUsdPerMillionTokens) - nullablePrice(right.price.outputUsdPerMillionTokens)
    || left.model.name.localeCompare(right.model.name);
}

function nullablePrice(value: number | null): number {
  return value ?? Number.POSITIVE_INFINITY;
}
