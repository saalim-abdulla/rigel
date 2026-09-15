import * as vscode from 'vscode';
import { chooseFavoriteModel } from './favorites';
import { createParticipant } from './participant';
import { findModelPrice, formatPrice } from './pricing-catalog';
import { PricingStore } from './pricing-loader';
import { registerTools } from './tools';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const pricing = await PricingStore.load(context);
  registerTools(context);
  context.subscriptions.push(createParticipant(pricing));
  context.subscriptions.push(
    vscode.commands.registerCommand('rigel.chooseFavoriteModel', () => chooseFavoriteModel(pricing.prices())),
    vscode.commands.registerCommand('rigel.refreshPricing', async () => {
      try {
        const refreshed = await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: 'Refreshing GitHub Copilot pricing…'
          },
          () => pricing.refresh()
        );
        await vscode.window.showInformationMessage(
          `Rigel refreshed ${refreshed.modelCount} models (${refreshed.rowCount} price tiers) from GitHub.`
        );
      } catch (error) {
        await vscode.window.showErrorMessage(
          `Rigel could not refresh pricing: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }),
    vscode.commands.registerCommand('rigel.listModels', async () => {
      const models = await vscode.lm.selectChatModels({ vendor: 'copilot' });
      const lines = models.length
        ? models.map(model => {
            const price = findModelPrice(model, pricing.prices());
            return price
              ? `${model.name} | ${price.category} | ${formatPrice(price)} | family=${model.family} | id=${model.id}`
              : `${model.name} | category and price unavailable | family=${model.family} | id=${model.id}`;
          })
        : ['No Copilot models are currently available.'];
      const document = await vscode.workspace.openTextDocument({
        language: 'text',
        content: ['Rigel: available Copilot models', '', ...lines].join('\n')
      });
      await vscode.window.showTextDocument(document, { preview: true });
    })
  );
}

export function deactivate(): void {}
