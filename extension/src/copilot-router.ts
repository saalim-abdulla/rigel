import * as vscode from 'vscode';
import { readFavorites } from './favorites';
import { selectModel } from './model-selector';
import type { ModelCategory, ModelPrice } from './pricing-catalog';
import type { PricingStore } from './pricing-loader';

export interface RoutedModel {
  kind: 'routed';
  model: vscode.LanguageModelChat;
  category: ModelCategory;
  price?: ModelPrice;
  inputTokens: number;
  reason: string;
}

export interface RoutingFailure {
  kind: 'failure';
  reason: string;
}

export async function routeCopilotModel(
  category: ModelCategory,
  messages: vscode.LanguageModelChatMessage[],
  pricing: PricingStore,
  token: vscode.CancellationToken
): Promise<RoutedModel | RoutingFailure> {
  const available = await vscode.lm.selectChatModels({ vendor: 'copilot' });
  const favoriteModelId = readFavorites()[category];
  let selection = selectModel({ category, available, prices: pricing.prices(), favoriteModelId });
  if (!selection.model) return { kind: 'failure', reason: selection.reason };
  let currentModel = selection.model;

  let inputTokens = 0;
  let converged = false;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    inputTokens = 0;
    for (const message of messages) {
      inputTokens += await currentModel.countTokens(message, token);
    }
    const next = selectModel({
      category,
      available,
      prices: pricing.prices(),
      inputTokens,
      favoriteModelId
    });
    if (!next.model) return { kind: 'failure', reason: next.reason };
    if (next.model.id === currentModel.id) {
      selection = next;
      currentModel = next.model;
      converged = true;
      break;
    }
    selection = next;
    currentModel = next.model;
  }
  if (!converged) {
    return { kind: 'failure', reason: 'Model selection did not converge near a pricing threshold.' };
  }

  return {
    kind: 'routed',
    model: currentModel,
    category,
    price: selection.price,
    inputTokens,
    reason: selection.reason
  };
}

export function isRoutingFailure(value: RoutedModel | RoutingFailure): value is RoutingFailure {
  return value.kind === 'failure';
}
