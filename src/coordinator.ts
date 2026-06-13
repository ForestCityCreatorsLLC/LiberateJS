import * as path from 'path';
import * as fs from 'fs';
import { runCleanser } from './cleanser.js';
import { runRewriter } from './rewriter.js';

export interface CoordinatorOptions {
  dir: string;
  recipe: string | null;
  rename: string | null;
  stage?: string;
  dryRun: boolean;
  verbose: boolean;
  wrappers?: string[];
}

export async function coordinatePipeline(options: CoordinatorOptions): Promise<void> {
  const resolvedDir = path.resolve(options.dir);
  const runStage = options.stage || 'all';
  
  if (options.verbose) {
    console.log(`[COORDINATOR] Starting LiberateJS pipeline on directory: ${resolvedDir}`);
    console.log(`[COORDINATOR] Recipe: ${options.recipe || 'default'}`);
    console.log(`[COORDINATOR] Rename target: ${options.rename || 'none'}`);
    console.log(`[COORDINATOR] Stage: ${runStage}`);
    console.log(`[COORDINATOR] Dry Run: ${options.dryRun}`);
  }

  // 1. Run the codebase Cleanser stage
  if (runStage === 'all' || runStage === 'cleanse') {
    console.log('\n--- Stage 1: Codebase Cleanser ---');
    runCleanser({
      dir: resolvedDir,
      rename: options.rename,
      dryRun: options.dryRun,
      recipe: options.recipe
    });
  } else {
    console.log('\n--- Stage 1: Codebase Cleanser (SKIPPED) ---');
  }

  // 2. Run the AST Rewriter stage
  if (runStage === 'all' || runStage === 'rewrite') {
    console.log('\n--- Stage 2: AST Rewriter ---');
    // Run the rewriter on the resolved directory. The rewriter walks the directory looking for JS/JSX/TS/TSX files.
    runRewriter([resolvedDir], {
      dryRun: options.dryRun,
      verbose: options.verbose,
      recipePath: options.recipe,
      wrappers: options.wrappers
    });
  } else {
    console.log('\n--- Stage 2: AST Rewriter (SKIPPED) ---');
  }

  console.log('\n--- LiberateJS Pipeline Complete ---');
}
