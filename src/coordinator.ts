import * as path from 'path';
import * as fs from 'fs';
import { execSync } from 'child_process';
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
  
  let isGit = false;
  let originalBranchOrCommit = '';

  try {
    const res = execSync('git rev-parse --is-inside-work-tree', { cwd: resolvedDir, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
    isGit = res === 'true';
  } catch (err) {
    // Not a git repo
  }

  if (isGit) {
    try {
      originalBranchOrCommit = execSync('git rev-parse --abbrev-ref HEAD', { cwd: resolvedDir }).toString().trim();
      if (originalBranchOrCommit === 'HEAD') {
        originalBranchOrCommit = execSync('git rev-parse HEAD', { cwd: resolvedDir }).toString().trim();
      }
    } catch (err: any) {
      console.error(`[COORDINATOR] Failed to get original git branch/commit: ${err.message}`);
      isGit = false;
    }
  }

  if (isGit && !options.dryRun) {
    console.log(`[COORDINATOR] Git repository detected. Checking out/creating migration branch 'migration/decouple-cleanup'...`);
    try {
      execSync('git checkout -B migration/decouple-cleanup', { cwd: resolvedDir, stdio: 'inherit' });
    } catch (err: any) {
      console.error(`[COORDINATOR] Failed to checkout migration branch: ${err.message}`);
      throw err;
    }
  }

  try {
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

      if (isGit && !options.dryRun) {
        console.log('[COORDINATOR] Committing Cleanser stage changes...');
        execSync('git add -A', { cwd: resolvedDir, stdio: 'ignore' });
        const status = execSync('git status --porcelain', { cwd: resolvedDir }).toString().trim();
        if (status) {
          execSync('git commit -m "liberatejs: cleanse stage complete"', { cwd: resolvedDir, stdio: 'ignore' });
          console.log('[COORDINATOR] Cleanser changes committed successfully.');
        } else {
          console.log('[COORDINATOR] No changes to commit for Cleanser stage.');
        }
      }
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

      if (isGit && !options.dryRun) {
        console.log('[COORDINATOR] Committing Rewriter stage changes...');
        execSync('git add -A', { cwd: resolvedDir, stdio: 'ignore' });
        const status = execSync('git status --porcelain', { cwd: resolvedDir }).toString().trim();
        if (status) {
          execSync('git commit -m "liberatejs: rewrite stage complete"', { cwd: resolvedDir, stdio: 'ignore' });
          console.log('[COORDINATOR] Rewriter changes committed successfully.');
        } else {
          console.log('[COORDINATOR] No changes to commit for Rewriter stage.');
        }
      }
    } else {
      console.log('\n--- Stage 2: AST Rewriter (SKIPPED) ---');
    }

    // Merge back if successful
    if (isGit && !options.dryRun) {
      if (originalBranchOrCommit !== 'migration/decouple-cleanup') {
        console.log(`[COORDINATOR] Pipeline succeeded. Merging changes back to original branch/commit: ${originalBranchOrCommit}...`);
        execSync(`git checkout ${originalBranchOrCommit}`, { cwd: resolvedDir, stdio: 'ignore' });
        execSync('git merge migration/decouple-cleanup', { cwd: resolvedDir, stdio: 'ignore' });
        console.log(`[COORDINATOR] Merged changes back to ${originalBranchOrCommit} successfully.`);
      } else {
        console.log(`[COORDINATOR] Pipeline succeeded. Already on branch 'migration/decouple-cleanup'.`);
      }
    }

    console.log('\n--- LiberateJS Pipeline Complete ---');

  } catch (error: any) {
    if (isGit && !options.dryRun) {
      console.error(`\n[COORDINATOR] Error occurred during pipeline execution: ${error.message}`);
      console.log(`[COORDINATOR] Reverting changes via 'git reset --hard' and returning to original branch/commit '${originalBranchOrCommit}'...`);
      try {
        execSync('git reset --hard', { cwd: resolvedDir, stdio: 'ignore' });
        execSync(`git checkout ${originalBranchOrCommit}`, { cwd: resolvedDir, stdio: 'ignore' });
        console.log(`[COORDINATOR] Workspace reverted successfully.`);
      } catch (rollbackErr: any) {
        console.error(`[COORDINATOR] Rollback failed: ${rollbackErr.message}`);
      }
    }
    throw error;
  }
}
