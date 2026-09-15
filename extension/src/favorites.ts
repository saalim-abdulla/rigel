import * as vscode from 'vscode';
import { findModelPrice, formatPrice, MODEL_CATEGORIES } from './pricing-catalog';
import type { ModelCategory, ModelPrice } from './pricing-catalog';

export type FavoriteModels = Partial<Record<ModelCategory, string>>;

export async function chooseFavoriteModel(prices: readonly ModelPrice[]): Promise<boolean> {
  const categoryPick = await vscode.window.showQuickPick(
    MODEL_CATEGORIES.map(category => ({ label: category, category })),
    { title: 'Choose a GitHub Copilot model category', placeHolder: 'Model category' }
  );
  if (!categoryPick) return false;

  const models = await vscode.lm.selectChatModels({ vendor: 'copilot' });
  const candidates = models
    .map(model => ({ model, price: findModelPrice(model, prices) }))
    .filter((candidate): candidate is { model: vscode.LanguageModelChat; price: ModelPrice } =>
      candidate.price?.category === categoryPick.category
    )
    .sort((left, right) => left.model.name.localeCompare(right.model.name));

  if (candidates.length === 0) {
    await vscode.window.showWarningMessage(`No available Copilot models matched GitHub's ${categoryPick.category} category.`);
    return false;
  }

  const current = readFavorites()[categoryPick.category];
  const selection = await vscode.window.showQuickPick(
    [
      {
        label: 'Use cheapest available model',
        description: 'Default',
        modelId: undefined as string | undefined
      },
      ...candidates.map(candidate => ({
        label: candidate.model.name,
        description: formatPrice(candidate.price),
        detail: `id=${candidate.model.id}${candidate.model.id === current ? ' · current favorite' : ''}`,
        modelId: candidate.model.id as string | undefined
      }))
    ],
    {
      title: `Favorite ${categoryPick.category} model`,
      placeHolder: 'Choose a model, or use Rigel’s cheapest default'
    }
  );
  if (!selection) return false;

  const favorites = readFavorites();
  if (selection.modelId) {
    favorites[categoryPick.category] = selection.modelId;
  } else {
    delete favorites[categoryPick.category];
  }
  const configuration = vscode.workspace.getConfiguration('rigel');
  const inspected = configuration.inspect<Record<string, unknown>>('favoriteModels');
  const target = inspected?.workspaceFolderValue !== undefined
    ? vscode.ConfigurationTarget.WorkspaceFolder
    : inspected?.workspaceValue !== undefined
      ? vscode.ConfigurationTarget.Workspace
      : vscode.ConfigurationTarget.Global;
  await configuration.update('favoriteModels', favorites, target);
  await vscode.window.showInformationMessage(
    selection.modelId
      ? `${selection.label} is now the favorite ${categoryPick.category} model.`
      : `${categoryPick.category} now uses the cheapest available model.`
  );
  return true;
}

export function readFavorites(): FavoriteModels {
  const configured = vscode.workspace
    .getConfiguration('rigel')
    .get<Record<string, unknown>>('favoriteModels', {});
  const favorites: FavoriteModels = {};
  for (const category of MODEL_CATEGORIES) {
    const value = configured[category];
    if (typeof value === 'string' && value.trim()) {
      favorites[category] = value;
    }
  }
  return favorites;
}
