import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import * as https from 'node:https';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { parse as parseYaml } from 'yaml';
import {
  GITHUB_PRICING_SOURCE,
  normalizeGithubPricing,
  parsePricingCatalog,
  serializePricingCatalog
} from './pricing-catalog';
import type { ModelPrice } from './pricing-catalog';

const MAX_DOWNLOAD_BYTES = 2 * 1024 * 1024;

export interface PricingRefreshResult {
  modelCount: number;
  rowCount: number;
  cacheLocation: string;
  sourceSha256: string;
}

export class PricingStore {
  private constructor(
    private readonly cacheUri: vscode.Uri,
    private currentPrices: ModelPrice[]
  ) {}

  static async load(context: vscode.ExtensionContext): Promise<PricingStore> {
    const bundledFilename = path.join(context.extensionPath, 'resources', 'copilot-pricing.json');
    const bundled = parsePricingCatalog(JSON.parse(await readFile(bundledFilename, 'utf8')) as unknown);
    const cacheUri = vscode.Uri.joinPath(context.globalStorageUri, 'copilot-pricing.json');

    try {
      const cached = JSON.parse(new TextDecoder().decode(await vscode.workspace.fs.readFile(cacheUri))) as unknown;
      return new PricingStore(cacheUri, parsePricingCatalog(cached));
    } catch {
      return new PricingStore(cacheUri, bundled);
    }
  }

  prices(): readonly ModelPrice[] {
    return this.currentPrices;
  }

  async refresh(): Promise<PricingRefreshResult> {
    const source = await download(GITHUB_PRICING_SOURCE);
    const prices = normalizeGithubPricing(parseYaml(source, { maxAliasCount: 100 }) as unknown);
    if (prices.length === 0) {
      throw new Error('GitHub pricing source contained no model rows.');
    }
    const sourceSha256 = createHash('sha256').update(source).digest('hex');
    const serialized = serializePricingCatalog(prices, sourceSha256);

    await vscode.workspace.fs.createDirectory(
      this.cacheUri.with({ path: path.posix.dirname(this.cacheUri.path) })
    );
    await vscode.workspace.fs.writeFile(this.cacheUri, new TextEncoder().encode(serialized));
    this.currentPrices = prices;

    return {
      rowCount: prices.length,
      modelCount: new Set(prices.map(price => `${price.provider}:${price.model}`)).size,
      cacheLocation: this.cacheUri.toString(),
      sourceSha256
    };
  }
}

function download(url: string, redirectsRemaining = 3): Promise<string> {
  return new Promise((resolve, reject) => {
    const request = https.get(url, { headers: { 'User-Agent': 'rigel-vscode/0.1' } }, response => {
      const status = response.statusCode ?? 0;
      if (status >= 300 && status < 400 && response.headers.location) {
        response.resume();
        if (redirectsRemaining === 0) {
          reject(new Error('Too many redirects while downloading GitHub pricing.'));
          return;
        }
        const redirectUrl = new URL(response.headers.location, url);
        if (redirectUrl.hostname !== 'raw.githubusercontent.com') {
          reject(new Error(`Refusing pricing redirect to ${redirectUrl.hostname}.`));
          return;
        }
        download(redirectUrl.toString(), redirectsRemaining - 1).then(resolve, reject);
        return;
      }
      if (status !== 200) {
        response.resume();
        reject(new Error(`GitHub pricing request returned HTTP ${status}.`));
        return;
      }

      const chunks: Buffer[] = [];
      let bytes = 0;
      response.on('data', chunk => {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        bytes += buffer.byteLength;
        if (bytes > MAX_DOWNLOAD_BYTES) {
          request.destroy(new Error('GitHub pricing response exceeded 2 MiB.'));
          return;
        }
        chunks.push(buffer);
      });
      response.once('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      response.once('error', reject);
    });
    request.setTimeout(30_000, () => request.destroy(new Error('GitHub pricing request timed out.')));
    request.once('error', reject);
  });
}
