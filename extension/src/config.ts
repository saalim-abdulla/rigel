import * as vscode from 'vscode';
import type { ModelCategory } from './pricing-catalog';

const SECTION = 'rigel';

export interface RigelConfig {
  defaultCategory: ModelCategory;
  maxToolActions: number;
  repeatedActionLimit: number;
  repeatedErrorLimit: number;
}

export function readConfig(): RigelConfig {
  const config = vscode.workspace.getConfiguration(SECTION);
  return {
    defaultCategory: config.get<ModelCategory>('defaultCategory', 'Versatile'),
    maxToolActions: config.get<number>('maxToolActions', 30),
    repeatedActionLimit: config.get<number>('repeatedActionLimit', 3),
    repeatedErrorLimit: config.get<number>('repeatedErrorLimit', 2)
  };
}
