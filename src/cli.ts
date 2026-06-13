import { Command } from 'commander';
import * as path from 'path';
import * as fs from 'fs';
import { coordinatePipeline } from './coordinator.js';

const program = new Command();

// Helper function to recursively copy directories
function copyFolderSync(from: string, to: string) {
  if (!fs.existsSync(to)) {
    fs.mkdirSync(to, { recursive: true });
  }
  
  const files = fs.readdirSync(from);
  for (const file of files) {
    if (file === 'node_modules' || file === '.git' || file === 'dist' || file === 'build' || file === '.next') {
      continue;
    }
    
    const fromPath = path.join(from, file);
    const toPath = path.join(to, file);
    const stat = fs.statSync(fromPath);
    
    if (stat.isDirectory()) {
      copyFolderSync(fromPath, toPath);
    } else {
      fs.copyFileSync(fromPath, toPath);
    }
  }
}

program
  .name('liberatejs')
  .description('A TypeScript-driven codebase cleanser and JavaScript/TypeScript AST rewriter')
  .version('1.0.0')
  .option('-s, --src <path>', 'Source directory to clean and rewrite')
  .option('-d, --dest <path>', 'Destination directory (leaves source untouched if different)')
  .option('-r, --recipe <path>', 'Path to custom recipe JSON file')
  .option('-n, --rename <name>', 'New name to rewrite package.json project name to')
  .option('--stage <stage>', 'Pipeline stage to run: cleanse, rewrite, or all', 'all')
  .option('--dry-run', 'Run pipeline and log planned changes without writing to disk', false)
  .option('-v, --verbose', 'Enable verbose logging', false)
  .action(async (options) => {
    try {
      const srcDir = options.src ? path.resolve(options.src) : process.cwd();
      let destDir = options.dest ? path.resolve(options.dest) : srcDir;

      console.log(`LiberateJS CLI v1.0.0`);
      console.log(`Source Directory: ${srcDir}`);
      console.log(`Destination Directory: ${destDir}`);
      console.log(`Stage: ${options.stage}`);

      if (srcDir !== destDir && !options.dryRun) {
        console.log(`Copying source files from ${srcDir} to ${destDir}...`);
        copyFolderSync(srcDir, destDir);
        console.log(`Copy complete.`);
      }

      await coordinatePipeline({
        dir: destDir,
        recipe: options.recipe || null,
        rename: options.rename || null,
        stage: options.stage,
        dryRun: options.dryRun,
        verbose: options.verbose
      });
    } catch (error: any) {
      console.error(`Error: ${error.message}`);
      process.exit(1);
    }
  });

program.parse(process.argv);
