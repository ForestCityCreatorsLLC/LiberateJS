import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

// ESM fallback for __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function log(msg: string, level: string = "INFO") {
  const isWindows = process.platform === "win32";
  const colors: Record<string, string> = {
    INFO: "\x1b[34m[INFO]\x1b[0m",
    SUCCESS: "\x1b[32m[SUCCESS]\x1b[0m",
    WARNING: "\x1b[33m[WARNING]\x1b[0m",
    ERROR: "\x1b[31m[ERROR]\x1b[0m"
  };
  
  if (isWindows) {
    console.log(`[${level}] ${msg}`);
  } else {
    console.log(`${colors[level] || '[INFO]'} ${msg}`);
  }
}

function loadRecipe(recipePath: string | null) {
  if (!recipePath) {
    // Default fallback path relative to compiled dist output location (dist/cleanser.js)
    const defaultPath = path.join(__dirname, "..", "recipes", "standalone.json");
    if (fs.existsSync(defaultPath)) {
      recipePath = defaultPath;
    } else {
      log("No recipe specified and default standalone.json not found.", "ERROR");
      throw new Error("No recipe specified and default standalone.json not found.");
    }
  }

  try {
    const data = fs.readFileSync(recipePath, "utf8");
    const recipe = JSON.parse(data);
    log(`Loaded recipe: ${recipe.name || 'unnamed'}`, "SUCCESS");
    return recipe;
  } catch (err: any) {
    log(`Failed to load recipe from ${recipePath}: ${err.message}`, "ERROR");
    throw new Error(`Failed to load recipe from ${recipePath}: ${err.message}`);
  }
}

function verifyBrackets(code: string): boolean {
  const stack: string[] = [];
  const mapping: Record<string, string> = { ')': '(', '}': '{', ']': '[' };
  
  let inString: string | null = null;
  let escaped = false;
  
  let i = 0;
  const n = code.length;
  while (i < n) {
    const char = code[i];
    
    if (escaped) {
      escaped = false;
      i++;
      continue;
    }
    
    if (char === '\\') {
      escaped = true;
      i++;
      continue;
    }
    
    if (inString) {
      if (char === inString) {
        inString = null;
      }
      i++;
      continue;
    }
    
    if (char === '"' || char === "'" || char === '`') {
      inString = char;
      i++;
      continue;
    }
    
    // Ignore comments
    if (char === '/' && i + 1 < n) {
      if (code[i+1] === '/') {
        const nextNL = code.indexOf('\n', i);
        if (nextNL === -1) break;
        i = nextNL;
        continue;
      } else if (code[i+1] === '*') {
        const nextEnd = code.indexOf('*/', i);
        if (nextEnd === -1) break;
        i = nextEnd + 2;
        continue;
      }
    }
    
    if (Object.values(mapping).includes(char)) {
      stack.push(char);
    } else if (Object.keys(mapping).includes(char)) {
      if (stack.length === 0 || stack[stack.length - 1] !== mapping[char]) {
        return false;
      }
      stack.pop();
    }
    
    i++;
  }
  
  return stack.length === 0;
}

function detectFramework(projectDir: string): string {
  const nextjsIndicators = [
    fs.existsSync(path.join(projectDir, "pages")),
    fs.existsSync(path.join(projectDir, "src", "pages")),
    fs.existsSync(path.join(projectDir, "app")),
    fs.existsSync(path.join(projectDir, "src", "app")),
    fs.existsSync(path.join(projectDir, "next.config.js")),
    fs.existsSync(path.join(projectDir, "next.config.mjs")),
    fs.existsSync(path.join(projectDir, "next.config.ts"))
  ];

  const viteIndicators = [
    fs.existsSync(path.join(projectDir, "vite.config.js")),
    fs.existsSync(path.join(projectDir, "vite.config.ts")),
    fs.existsSync(path.join(projectDir, "vite.config.mjs")),
    fs.existsSync(path.join(projectDir, "vite.config.mts"))
  ];

  let hasNextDep = false;
  let hasViteDep = false;
  const pkgPath = path.join(projectDir, "package.json");
  if (fs.existsSync(pkgPath)) {
    try {
      const data = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
      const deps = { ...data.dependencies, ...data.devDependencies };
      if (deps["next"]) hasNextDep = true;
      if (deps["vite"] || deps["@vitejs/plugin-react"]) hasViteDep = true;
    } catch (err) {}
  }

  const viteReactFiles = [
    fs.existsSync(path.join(projectDir, "src", "main.jsx")),
    fs.existsSync(path.join(projectDir, "src", "main.tsx"))
  ];

  const isNextjs = nextjsIndicators.some(Boolean) || hasNextDep;
  const isVite = viteIndicators.some(Boolean) || hasViteDep || viteReactFiles.some(Boolean);

  if (isNextjs && !isVite) return "nextjs";
  if (isVite && !isNextjs) return "vite";
  if (isNextjs && isVite) {
    if (fs.existsSync(path.join(projectDir, "next.config.js")) || 
        fs.existsSync(path.join(projectDir, "next.config.mjs"))) {
      return "nextjs";
    }
    return "vite";
  }
  return "unknown";
}

function writeFrameworkConfig(projectDir: string, framework: string, dryRun: boolean, metadataSummary: any) {
  if (framework === "nextjs") {
    const configFiles = ["next.config.js", "next.config.mjs", "next.config.ts"];
    const exists = configFiles.some(f => fs.existsSync(path.join(projectDir, f)));
    if (!exists) {
      const dest = path.join(projectDir, "next.config.js");
      const content = `/** @type {import('next').NextConfig} */\nconst nextConfig = {\n  reactStrictMode: true,\n};\n\nmodule.exports = nextConfig;\n`;
      if (dryRun) {
        log(`Would create Next.js config file: ${dest}`, "INFO");
      } else {
        try {
          fs.writeFileSync(dest, content, "utf8");
          log(`Created default Next.js config: ${dest}`, "SUCCESS");
          if (metadataSummary) metadataSummary.modified_files.push("next.config.js");
        } catch (err: any) {
          log(`Failed to create Next.js config: ${err.message}`, "ERROR");
        }
      }
    } else {
      log("Next.js configuration file already exists.", "INFO");
    }
  } else if (framework === "vite") {
    const configFiles = ["vite.config.js", "vite.config.ts", "vite.config.mjs", "vite.config.mts"];
    const exists = configFiles.some(f => fs.existsSync(path.join(projectDir, f)));
    if (!exists) {
      const dest = path.join(projectDir, "vite.config.js");
      const content = `import { defineConfig } from 'vite';\nimport react from '@vitejs/plugin-react';\n\n// https://vite.dev/config/\nexport default defineConfig({\n  plugins: [react()],\n});\n`;
      if (dryRun) {
        log(`Would create Vite config file: ${dest}`, "INFO");
      } else {
        try {
          fs.writeFileSync(dest, content, "utf8");
          log(`Created default Vite React config: ${dest}`, "SUCCESS");
          if (metadataSummary) metadataSummary.modified_files.push("vite.config.js");
        } catch (err: any) {
          log(`Failed to create Vite React config: ${err.message}`, "ERROR");
        }
      }
    } else {
      log("Vite configuration file already exists.", "INFO");
    }
  }
}

function runPreflightChecks(projectDir: string, configFramework?: string, configPkgMgr?: string) {
  log("Running Active Pre-Flight Codebase Checks...", "INFO");
  let passed = true;

  // 1. Verify system dependencies
  log("Checking system environment dependencies...", "INFO");
  const tools = ["git", "node", "npm"];
  if (configPkgMgr && !tools.includes(configPkgMgr)) {
    tools.push(configPkgMgr);
  }
  for (const tool of tools) {
    const cmd = process.platform === "win32" ? `where ${tool}` : `which ${tool}`;
    try {
      execSync(cmd, { stdio: 'ignore' });
      log(`  [OK] System dependency '${tool}' is available on PATH.`, "SUCCESS");
    } catch (err) {
      log(`  [WARNING] System dependency '${tool}' is missing or not in PATH.`, "WARNING");
    }
  }

  // 2. Validate package.json
  const pkgPath = path.join(projectDir, "package.json");
  if (fs.existsSync(pkgPath)) {
    try {
      JSON.parse(fs.readFileSync(pkgPath, "utf8"));
      log("  [OK] package.json syntax is valid JSON.", "SUCCESS");
    } catch (err: any) {
      log(`  [ERROR] package.json is malformed JSON: ${err.message}`, "ERROR");
      passed = false;
    }
  } else {
    log("  [WARNING] package.json was not found in this directory.", "WARNING");
  }

  // 3. index.html check
  if (!fs.existsSync(path.join(projectDir, "index.html"))) {
    log("  [WARNING] index.html not found in project root.", "WARNING");
  }

  // 4. Bracket integrity check
  log("Scanning JS/JSX codebase files for bracket syntax errors...", "INFO");
  const excludeDirs = new Set([".git", "node_modules", "dist", "build", ".next", ".cache"]);
  
  function walkAndCheck(dir: string) {
    const list = fs.readdirSync(dir);
    for (const file of list) {
      const fullPath = path.join(dir, file);
      const stat = fs.statSync(fullPath);
      if (stat.isDirectory()) {
        if (!excludeDirs.has(file)) {
          walkAndCheck(fullPath);
        }
      } else if (file.endsWith(".js") || file.endsWith(".jsx") || file.endsWith(".ts") || file.endsWith(".tsx")) {
        try {
          const content = fs.readFileSync(fullPath, "utf8");
          if (!verifyBrackets(content)) {
            log(`  [WARNING] Syntax check heuristic flagged potential unmatched brackets/braces in: ${path.relative(projectDir, fullPath)}`, "WARNING");
          }
        } catch (err) {}
      }
    }
  }
  
  try {
    walkAndCheck(projectDir);
  } catch (err: any) {
    log(`  [WARNING] Error running codebase diagnostics: ${err.message}`, "WARNING");
  }

  // 5. Framework detection
  const framework = configFramework || detectFramework(projectDir);
  if (configFramework) {
    log(`  [OK] Using target framework '${framework}' from configuration.`, "SUCCESS");
  } else if (framework === "nextjs") {
    log(`  [OK] Detected Next.js framework.`, "SUCCESS");
  } else if (framework === "vite") {
    log(`  [OK] Detected Vite React framework.`, "SUCCESS");
  } else {
    log("  [WARNING] Could not automatically determine the web framework.", "WARNING");
  }

  if (!passed) {
    log("Pre-flight validation failed. Aborting conversion to protect codebase.", "ERROR");
    throw new Error("Pre-flight validation failed. Aborting conversion to protect codebase.");
  }

  log("All Pre-Flight codebase diagnostics passed successfully!", "SUCCESS");
}

function extractEnvVariables(projectDir: string, metadataSummary: any, recipe: any) {
  log("Scanning for configuration keys to map to environment variables...", "INFO");
  const envVars: Record<string, string> = {};
  const recipeName = recipe.name || "decouple";

  const configPath = path.join(projectDir, recipeName, "config.json");
  if (fs.existsSync(configPath)) {
    try {
      const configData = JSON.parse(fs.readFileSync(configPath, "utf8"));
      for (const [k, v] of Object.entries(configData)) {
        envVars[`VITE_APP_${k.toUpperCase()}`] = String(v);
      }
      log(`Extracted keys from ${recipeName}/config.json`, "SUCCESS");
    } catch (err: any) {
      log(`Failed to parse config.json: ${err.message}`, "WARNING");
    }
  }

  const paramsPath = path.join(projectDir, "src", "lib", "app-params.js");
  if (fs.existsSync(paramsPath)) {
    try {
      const content = fs.readFileSync(paramsPath, "utf8");
      const regex = /(\w+)\s*:\s*(['"`])((?:\\.|(?!\2).)*)\2/g;
      let match;
      while ((match = regex.exec(content)) !== null) {
        envVars[`VITE_APP_${match[1].toUpperCase()}`] = match[3];
      }
      log("Extracted keys from src/lib/app-params.js", "SUCCESS");
    } catch (err: any) {
      log(`Failed to parse app-params.js: ${err.message}`, "WARNING");
    }
  }

  const keys = Object.keys(envVars);
  if (keys.length > 0) {
    metadataSummary.extracted_env_vars = keys;
    const envExamplePath = path.join(projectDir, ".env.example");
    try {
      let output = `# Environment variables migrated from ${recipeName.toUpperCase()} configurations\n`;
      output += `# Rename this file to .env to use locally\n\n`;
      for (const k of keys.sort()) {
        if (k.includes("SECRET") || k.includes("PASS") || k.includes("TOKEN")) {
          output += `# SECURITY WARNING: Migrate ${k} to a secure backend function.\n`;
        }
        output += `${k}=""\n`;
      }
      fs.writeFileSync(envExamplePath, output, "utf8");
      log(`Generated .env.example at ${envExamplePath}`, "SUCCESS");
    } catch (err: any) {
      log(`Failed to write .env.example: ${err.message}`, "ERROR");
    }
  } else {
    log("No proprietary configuration variables detected for environment mapping.", "INFO");
  }
}

function cleansePackageJson(projectDir: string, newName: string | null, dryRun: boolean, metadataSummary: any, recipe: any) {
  const pkgPath = path.join(projectDir, "package.json");
  if (!fs.existsSync(pkgPath)) {
    log("No package.json found. Skipping package.json updates.", "WARNING");
    return;
  }

  try {
    const data = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
    let modified = false;
    const recipeName = recipe.name || "decouple";

    const currentName = data.name || "";
    metadataSummary.original_project_name = currentName;

    if (currentName.toLowerCase().includes(recipeName.toLowerCase())) {
      const nameToUse = newName || currentName.toLowerCase().replace(new RegExp(recipeName, 'gi'), "app").replace(/^-+|-+$/g, "");
      metadataSummary.new_project_name = nameToUse;
      if (dryRun) {
        log(`Would rename project in package.json from '${currentName}' to '${nameToUse}'`, "INFO");
      } else {
        data.name = nameToUse;
        log(`Renamed project in package.json to '${nameToUse}'`, "SUCCESS");
      }
      modified = true;
    } else {
      metadataSummary.new_project_name = currentName;
    }

    const removeDeps = recipe.dependencies_to_remove || [recipeName];
    const depFields = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"];
    for (const field of depFields) {
      if (data[field]) {
        for (const dep of Object.keys(data[field])) {
          if (removeDeps.some((rd: string) => dep.toLowerCase().includes(rd.toLowerCase()))) {
            metadataSummary.removed_dependencies.push(dep);
            if (dryRun) {
              log(`Would remove ${field} dependency: ${dep}`, "INFO");
            } else {
              delete data[field][dep];
              log(`Removed ${field} dependency: ${dep}`, "SUCCESS");
            }
            modified = true;
          }
        }
      }
    }

    const removeScripts = recipe.scripts_to_remove || [recipeName];
    if (data.scripts) {
      for (const [name, cmd] of Object.entries(data.scripts)) {
        const cmdStr = String(cmd);
        if (removeScripts.some((rs: string) => name.toLowerCase().includes(rs.toLowerCase()) || cmdStr.toLowerCase().includes(rs.toLowerCase()))) {
          metadataSummary.removed_scripts.push(name);
          if (dryRun) {
            log(`Would remove script: ${name} -> ${cmdStr}`, "INFO");
          } else {
            delete data.scripts[name];
            log(`Removed script: ${name}`, "SUCCESS");
          }
          modified = true;
        }
      }
    }

    if (modified && !dryRun) {
      fs.writeFileSync(pkgPath, JSON.stringify(data, null, 2) + "\n", "utf8");
      log("Successfully updated package.json", "SUCCESS");
    }
  } catch (err: any) {
    log(`Failed to update package.json: ${err.message}`, "ERROR");
  }
}

function cleanseHtml(projectDir: string, dryRun: boolean, metadataSummary: any, recipe: any) {
  const htmlPath = path.join(projectDir, "index.html");
  if (!fs.existsSync(htmlPath)) {
    log("No index.html found. Skipping HTML cleansing.", "WARNING");
    return;
  }

  try {
    let content = fs.readFileSync(htmlPath, "utf8");
    let modified = false;
    const replaceTerms = recipe.replace_terms || [{ pattern: "standalone", replacement: "standalone" }];

    const titleMatch = content.match(/<title>(.*?)<\/title>/i);
    if (titleMatch) {
      const titleText = titleMatch[1];
      let newTitle = titleText;
      let replaced = false;

      for (const term of replaceTerms) {
        const regex = new RegExp(term.pattern, "gi");
        if (regex.test(newTitle)) {
          newTitle = newTitle.replace(regex, term.replacement);
          replaced = true;
        }
      }

      if (replaced) {
        newTitle = newTitle.split(/\s+/).map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(" ");
        if (!newTitle) newTitle = "Standalone Web App";
        
        if (dryRun) {
          log(`Would change HTML title from '${titleText}' to '${newTitle}'`, "INFO");
        } else {
          content = content.replace(`<title>${titleText}</title>`, `<title>${newTitle}</title>`);
          log(`Updated HTML title to '${newTitle}'`, "SUCCESS");
        }
        modified = true;
      }
    }

    for (const term of replaceTerms) {
      const linkRegex = new RegExp(`<link[^>]*?href=[^>]*?${term.pattern}[^>]*?>`, "gi");
      const linkMatches = content.match(linkRegex);
      if (linkMatches) {
        for (const link of linkMatches) {
          if (dryRun) {
            log(`Would remove favicon/link reference: ${link.trim()}`, "INFO");
          } else {
            content = content.replace(link, "");
            log(`Removed favicon/link reference from index.html`, "SUCCESS");
          }
          modified = true;
        }
      }
    }

    if (modified && !dryRun) {
      fs.writeFileSync(htmlPath, content, "utf8");
      metadataSummary.modified_files.push("index.html");
      log("Successfully updated index.html", "SUCCESS");
    }
  } catch (err: any) {
    log(`Failed to update index.html: ${err.message}`, "ERROR");
  }
}

function deepSearchAndReplace(projectDir: string, dryRun: boolean, metadataSummary: any, recipe: any) {
  const recipeName = recipe.name || "decouple";
  const replaceTerms = recipe.replace_terms || [{ pattern: "standalone", replacement: "standalone" }];
  log(`Starting global search-and-replace using recipe: ${recipeName}...`, "INFO");

  const excludeDirs = new Set([".git", "node_modules", "dist", "build", ".next", ".cache", ".idea", ".vscode"]);
  const excludeFiles = new Set(["package-lock.json", "yarn.lock", "pnpm-lock.yaml", "decouple-cleanse.py", "decouple-cleanse.js", "standalone-cleanse.py", ".migration-status.json"]);

  const rules = replaceTerms.map((term: any) => {
    return {
      regex: new RegExp(term.pattern, "gi"),
      replacement: term.replacement
    };
  });

  function casePreservingReplace(match: string, replacement: string) {
    if (match === match.toUpperCase()) return replacement.toUpperCase();
    if (match[0] === match[0].toUpperCase()) return replacement.charAt(0).toUpperCase() + replacement.slice(1).toLowerCase();
    return replacement.toLowerCase();
  }

  let count = 0;
  let fileCount = 0;

  function walkAndReplace(dir: string) {
    const list = fs.readdirSync(dir);
    for (const file of list) {
      if (excludeFiles.has(file)) continue;

      const fullPath = path.join(dir, file);
      const stat = fs.statSync(fullPath);

      if (stat.isDirectory()) {
        if (!excludeDirs.has(file)) {
          walkAndReplace(fullPath);
        }
      } else {
        try {
          const buffer = fs.readFileSync(fullPath);
          let isBinary = false;
          for (let b = 0; b < Math.min(buffer.length, 1024); b++) {
            if (buffer[b] === 0) {
              isBinary = true;
              break;
            }
          }
          if (isBinary) continue;

          let content = buffer.toString("utf8");
          let hasMatch = false;
          let newContent = content;

          for (const rule of rules) {
            if (rule.regex.test(newContent)) {
              const matches = (newContent.match(rule.regex) || []).length;
              count += matches;
              newContent = newContent.replace(rule.regex, (match) => casePreservingReplace(match, rule.replacement));
              hasMatch = true;
            }
          }

          if (hasMatch) {
            fileCount++;
            const relPath = path.relative(projectDir, fullPath);
            if (dryRun) {
              log(`Would clean occurrences in: ${relPath}`, "INFO");
            } else {
              fs.writeFileSync(fullPath, newContent, "utf8");
              metadataSummary.modified_files.push(relPath);
              log(`Replaced occurrences in: ${relPath}`, "SUCCESS");
            }
          }
        } catch (err) {}
      }
    }
  }

  try {
    walkAndReplace(projectDir);
  } catch (err: any) {
    log(`Error during search-and-replace: ${err.message}`, "ERROR");
  }

  log(`Search and replace completed. Total occurrences found: ${count} across ${fileCount} files.`, "SUCCESS");
}

function injectPinoLogging(projectDir: string, dryRun: boolean, metadataSummary: any) {
  log("Injecting Pino logging setup in entry files...", "INFO");
  const candidates = [
    path.join(projectDir, "src", "main.jsx"),
    path.join(projectDir, "src", "main.tsx"),
    path.join(projectDir, "src", "App.jsx"),
    path.join(projectDir, "src", "App.tsx")
  ];

  const entryFiles = candidates.filter(c => fs.existsSync(c));
  if (entryFiles.length === 0) {
    log("No standard entry files found to inject Pino logging.", "WARNING");
    return;
  }

  const pinoImport = "import pino from 'pino';\n";
  const pinoSetup = 
    "\n// Pino Structured Logger Setup\n" +
    "export const logger = pino({\n" +
    "  level: 'info',\n" +
    "  browser: {\n" +
    "    asObject: true\n" +
    "  }\n" +
    "});\n" +
    "logger.info('Application initialized successfully');\n\n";

  for (const file of entryFiles) {
    const relPath = path.relative(projectDir, file);
    try {
      const content = fs.readFileSync(file, "utf8");
      if (content.includes("import pino")) {
        log(`Pino logging already present in ${relPath}`, "INFO");
        continue;
      }

      if (dryRun) {
        log(`Would inject Pino logging setup into ${relPath}`, "INFO");
        continue;
      }

      const lines = content.split(/\r?\n/);
      let lastImportIdx = -1;
      for (let idx = 0; idx < lines.length; idx++) {
        if (lines[idx].trim().startsWith("import ")) {
          lastImportIdx = idx;
        }
      }

      let newLines;
      if (lastImportIdx !== -1) {
        newLines = [...lines.slice(0, lastImportIdx + 1), pinoImport.trim(), ...lines.slice(lastImportIdx + 1)];
        
        let firstCodeIdx = -1;
        for (let idx = 0; idx < newLines.length; idx++) {
          if (newLines[idx].trim() && !newLines[idx].trim().startsWith("import ")) {
            firstCodeIdx = idx;
            break;
          }
        }
        if (firstCodeIdx !== -1) {
          newLines.splice(firstCodeIdx, 0, pinoSetup.trim());
        } else {
          newLines.push(pinoSetup.trim());
        }
      } else {
        newLines = [pinoImport.trim(), pinoSetup.trim(), ...lines];
      }

      fs.writeFileSync(file, newLines.join("\n") + "\n", "utf8");
      log(`Injected Pino logging setup into ${relPath}`, "SUCCESS");
      if (metadataSummary) metadataSummary.modified_files.push(relPath);
    } catch (err: any) {
      log(`Failed to inject Pino logging into ${relPath}: ${err.message}`, "ERROR");
    }
  }
}

function scaffoldTestingAndLogging(projectDir: string, framework: string, dryRun: boolean, metadataSummary: any) {
  log("Setting up structured logging and testing scaffolding...", "INFO");

  const pkgPath = path.join(projectDir, "package.json");
  if (fs.existsSync(pkgPath)) {
    try {
      const data = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
      let modified = false;

      if (!data.dependencies) data.dependencies = {};
      if (!data.devDependencies) data.devDependencies = {};
      if (!data.scripts) data.scripts = {};

      if (!data.dependencies["pino"]) {
        data.dependencies["pino"] = "^9.2.0";
        log("Added 'pino' dependency to package.json", "SUCCESS");
        modified = true;
      }

      const testingDeps = {
        "vitest": "^1.6.1",
        "@vitejs/plugin-react": "^4.3.0",
        "@testing-library/react": "^15.0.0",
        "@testing-library/jest-dom": "^6.4.0",
        "jsdom": "^24.1.0",
        "@playwright/test": "^1.44.0"
      };

      for (const [dep, ver] of Object.entries(testingDeps)) {
        if (!data.devDependencies[dep]) {
          data.devDependencies[dep] = ver;
          log(`Added devDependency '${dep}' to package.json`, "SUCCESS");
          modified = true;
        }
      }

      const testScripts = {
        "test": "vitest run",
        "test:watch": "vitest",
        "test:e2e": "playwright test"
      };

      for (const [name, cmd] of Object.entries(testScripts)) {
        if (!data.scripts[name] || data.scripts[name].startsWith("echo")) {
          data.scripts[name] = cmd;
          log(`Added script '${name}' -> '${cmd}' to package.json`, "SUCCESS");
          modified = true;
        }
      }

      if (modified && !dryRun) {
        fs.writeFileSync(pkgPath, JSON.stringify(data, null, 2) + "\n", "utf8");
        log("Updated package.json with test and logging dependencies.", "SUCCESS");
      }
    } catch (err: any) {
      log(`Failed to update package.json for testing: ${err.message}`, "ERROR");
    }
  }

  injectPinoLogging(projectDir, dryRun, metadataSummary);

  const port = framework === "nextjs" ? "3000" : "5173";
  const playwrightConfig = `import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    baseURL: 'http://localhost:${port}',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
    },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:${port}',
    reuseExistingServer: !process.env.CI,
  },
});
`;

  const playwrightPath = path.join(projectDir, "playwright.config.js");
  if (!fs.existsSync(playwrightPath)) {
    if (dryRun) {
      log(`Would create Playwright config: ${playwrightPath}`, "INFO");
    } else {
      try {
        fs.writeFileSync(playwrightPath, playwrightConfig, "utf8");
        log(`Created Playwright config: ${playwrightPath}`, "SUCCESS");
        if (metadataSummary) metadataSummary.modified_files.push("playwright.config.js");
      } catch (err: any) {
        log(`Failed to create Playwright config: ${err.message}`, "ERROR");
      }
    }
  }

  const e2eDir = path.join(projectDir, "e2e");
  const e2eTestPath = path.join(e2eDir, "example.spec.js");
  if (!fs.existsSync(e2eTestPath)) {
    if (dryRun) {
      log(`Would create E2E test folder: ${e2eDir}`, "INFO");
    } else {
      try {
        fs.mkdirSync(e2eDir, { recursive: true });
        const e2eContent = `import { test, expect } from '@playwright/test';\n\ntest('has title', async ({ page }) => {\n  await page.goto('http://localhost:${port}/');\n  await expect(page).toHaveTitle(/./);\n});\n`;
        fs.writeFileSync(e2eTestPath, e2eContent, "utf8");
        log(`Created E2E test file: ${e2eTestPath}`, "SUCCESS");
        if (metadataSummary) metadataSummary.modified_files.push("e2e/example.spec.js");
      } catch (err: any) {
        log(`Failed to create E2E test file: ${err.message}`, "ERROR");
      }
    }
  }

  const vitestConfig = `import { defineConfig, configDefaults } from 'vitest/config';\nimport react from '@vitejs/plugin-react';\n\nexport default defineConfig({\n  plugins: [react()],\n  test: {\n    environment: 'jsdom',\n    globals: true,\n    exclude: [...configDefaults.exclude, 'e2e/**'],\n  },\n});\n`;
  const vitestPath = path.join(projectDir, "vitest.config.js");
  if (!fs.existsSync(vitestPath)) {
    if (dryRun) {
      log(`Would create Vitest config: ${vitestPath}`, "INFO");
    } else {
      try {
        fs.writeFileSync(vitestPath, vitestConfig, "utf8");
        log(`Created Vitest config: ${vitestPath}`, "SUCCESS");
        if (metadataSummary) metadataSummary.modified_files.push("vitest.config.js");
      } catch (err: any) {
        log(`Failed to create Vitest config: ${err.message}`, "ERROR");
      }
    }
  }

  const mockTestPath = path.join(projectDir, "src", "App.test.jsx");
  if (!fs.existsSync(mockTestPath)) {
    if (dryRun) {
      log(`Would create mock unit test: ${mockTestPath}`, "INFO");
    } else {
      try {
        fs.mkdirSync(path.dirname(mockTestPath), { recursive: true });
        const mockTestContent = `import { describe, it, expect } from 'vitest';\nimport { render } from '@testing-library/react';\nimport React from 'react';\nimport App from './App';\n\ndescribe('App Component', () => {\n  it('renders without crashing', () => {\n    const { container } = render(<App />);\n    expect(container).toBeDefined();\n  });\n});\n`;
        fs.writeFileSync(mockTestPath, mockTestContent, "utf8");
        log(`Created mock unit test: ${mockTestPath}`, "SUCCESS");
        if (metadataSummary) metadataSummary.modified_files.push("src/App.test.jsx");
      } catch (err: any) {
        log(`Failed to create mock test file: ${err.message}`, "ERROR");
      }
    }
  }
}

function scaffoldStylingAndOptimization(projectDir: string, dryRun: boolean, metadataSummary: any) {
  log("Setting up modern styling (Tailwind CSS) and bundle optimizations...", "INFO");

  const pkgPath = path.join(projectDir, "package.json");
  if (fs.existsSync(pkgPath)) {
    try {
      const data = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
      let modified = false;
      if (!data.devDependencies) data.devDependencies = {};

      const styleDeps = {
        "tailwindcss": "^3.4.0",
        "postcss": "^8.4.30",
        "autoprefixer": "^10.4.15"
      };

      for (const [dep, ver] of Object.entries(styleDeps)) {
        if (!data.devDependencies[dep]) {
          data.devDependencies[dep] = ver;
          log(`Added devDependency '${dep}' for modern styling`, "SUCCESS");
          modified = true;
        }
      }

      if (modified && !dryRun) {
        fs.writeFileSync(pkgPath, JSON.stringify(data, null, 2) + "\n", "utf8");
        log("Updated package.json with styling dependencies.", "SUCCESS");
      }
    } catch (err: any) {
      log(`Failed to update package.json with styling dependencies: ${err.message}`, "ERROR");
    }
  }

  const tailwindConfig = `/** @type {import('tailwindcss').Config} */\nmodule.exports = {\n  content: [\n    "./index.html",\n    "./src/**/*.{js,ts,jsx,tsx}",\n  ],\n  theme: {\n    extend: {},\n  },\n  plugins: [],\n}\n`;
  const tailwindPath = path.join(projectDir, "tailwind.config.js");
  if (!fs.existsSync(tailwindPath)) {
    if (dryRun) {
      log(`Would create Tailwind config: ${tailwindPath}`, "INFO");
    } else {
      try {
        fs.writeFileSync(tailwindPath, tailwindConfig, "utf8");
        log(`Created Tailwind config: ${tailwindPath}`, "SUCCESS");
        if (metadataSummary) metadataSummary.modified_files.push("tailwind.config.js");
      } catch (err: any) {
        log(`Failed to create Tailwind config: ${err.message}`, "ERROR");
      }
    }
  }

  const postcssConfig = `module.exports = {\n  plugins: {\n    tailwindcss: {},\n    autoprefixer: {},\n  },\n}\n`;
  const postcssPath = path.join(projectDir, "postcss.config.js");
  if (!fs.existsSync(postcssPath)) {
    if (dryRun) {
      log(`Would create PostCSS config: ${postcssPath}`, "INFO");
    } else {
      try {
        fs.writeFileSync(postcssPath, postcssConfig, "utf8");
        log(`Created PostCSS config: ${postcssPath}`, "SUCCESS");
        if (metadataSummary) metadataSummary.modified_files.push("postcss.config.js");
      } catch (err: any) {
        log(`Failed to create PostCSS config: ${err.message}`, "ERROR");
      }
    }
  }

  const htmlPath = path.join(projectDir, "index.html");
  if (fs.existsSync(htmlPath)) {
    try {
      let htmlContent = fs.readFileSync(htmlPath, "utf8");
      const fontsMarkup = 
        '    <link rel="preconnect" href="https://fonts.googleapis.com" />\n' +
        '    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />\n' +
        '    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=Outfit:wght@300;400;500;600;700&display=swap" rel="stylesheet" />\n';

      if (!htmlContent.includes("fonts.googleapis.com")) {
        if (dryRun) {
          log("Would inject Google Fonts into index.html head", "INFO");
        } else {
          htmlContent = htmlContent.replace("</head>", `${fontsMarkup}  </head>`);
          fs.writeFileSync(htmlPath, htmlContent, "utf8");
          log("Injected Google Fonts (Inter/Outfit) into index.html head section", "SUCCESS");
          if (metadataSummary && !metadataSummary.modified_files.includes("index.html")) {
            metadataSummary.modified_files.push("index.html");
          }
        }
      }
    } catch (err: any) {
      log(`Failed to inject Google Fonts: ${err.message}`, "ERROR");
    }
  }

  const vitePath = path.join(projectDir, "vite.config.js");
  if (fs.existsSync(vitePath)) {
    try {
      let viteContent = fs.readFileSync(vitePath, "utf8");
      if (!viteContent.includes("manualChunks") && !viteContent.includes("rollupOptions")) {
        if (dryRun) {
          log("Would add rollup manualChunks optimization to vite.config.js", "INFO");
        } else {
          const optContent = `  build: {\n    rollupOptions: {\n      output: {\n        manualChunks: {\n          vendor: ['react', 'react-dom']\n        }\n      }\n    }\n  }`;
          
          const match = viteContent.match(/plugins:\s*\[[^\]]*\]/);
          if (match && match.index !== undefined) {
            const insertPos = match.index + match[0].length;
            const newVite = viteContent.slice(0, insertPos) + ",\n" + optContent + viteContent.slice(insertPos);
            fs.writeFileSync(vitePath, newVite, "utf8");
            log("Added rollup vendor code-splitting chunks optimization to vite.config.js", "SUCCESS");
            if (metadataSummary) metadataSummary.modified_files.push("vite.config.js");
          }
        }
      }
    } catch (err: any) {
      log(`Failed to inject bundle optimization: ${err.message}`, "ERROR");
    }
  }
}

function applyRoutingConfigurations(projectDir: string, routes: Record<string, string>, dryRun: boolean, metadataSummary: any) {
  log("Applying routing configurations...", "INFO");
  const excludeDirs = new Set([".git", "node_modules", "dist", "build", ".next", ".cache", ".idea", ".vscode"]);
  const excludeFiles = new Set(["package-lock.json", "yarn.lock", "pnpm-lock.yaml", "decouple-cleanse.py", "decouple-cleanse.js", "standalone-cleanse.py", ".migration-status.json", "liberatejs.config.json"]);

  let count = 0;
  let fileCount = 0;

  function walkAndReplace(dir: string) {
    const list = fs.readdirSync(dir);
    for (const file of list) {
      if (excludeFiles.has(file)) continue;

      const fullPath = path.join(dir, file);
      const stat = fs.statSync(fullPath);

      if (stat.isDirectory()) {
        if (!excludeDirs.has(file)) {
          walkAndReplace(fullPath);
        }
      } else {
        try {
          const buffer = fs.readFileSync(fullPath);
          let isBinary = false;
          for (let b = 0; b < Math.min(buffer.length, 1024); b++) {
            if (buffer[b] === 0) {
              isBinary = true;
              break;
            }
          }
          if (isBinary) continue;

          let content = buffer.toString("utf8");
          let hasMatch = false;
          let newContent = content;

          for (const [oldRoute, newRoute] of Object.entries(routes)) {
            const escapedOldRoute = oldRoute.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
            const regex = new RegExp(escapedOldRoute, 'g');
            if (regex.test(newContent)) {
              const matches = (newContent.match(regex) || []).length;
              count += matches;
              newContent = newContent.replace(regex, newRoute);
              hasMatch = true;
            }
          }

          if (hasMatch) {
            fileCount++;
            const relPath = path.relative(projectDir, fullPath);
            if (dryRun) {
              log(`Would rewrite routing configurations in: ${relPath}`, "INFO");
            } else {
              fs.writeFileSync(fullPath, newContent, "utf8");
              if (metadataSummary && !metadataSummary.modified_files.includes(relPath)) {
                metadataSummary.modified_files.push(relPath);
              }
              log(`Rewrote routing configurations in: ${relPath}`, "SUCCESS");
            }
          }
        } catch (err) {}
      }
    }
  }

  try {
    walkAndReplace(projectDir);
  } catch (err: any) {
    log(`Error during routing configuration replacement: ${err.message}`, "ERROR");
  }

  log(`Routing configurations applied. Total occurrences replaced: ${count} across ${fileCount} files.`, "SUCCESS");
}

function runNpmInstall(projectDir: string, dryRun: boolean, configPkgMgr?: string) {
  if (dryRun) {
    log("Would run package installation (npm/yarn/pnpm install)", "INFO");
    return;
  }

  let pkgMgr = "npm";
  if (configPkgMgr && ["npm", "pnpm", "yarn"].includes(configPkgMgr)) {
    pkgMgr = configPkgMgr;
  } else if (fs.existsSync(path.join(projectDir, "pnpm-lock.yaml"))) {
    pkgMgr = "pnpm";
  } else if (fs.existsSync(path.join(projectDir, "yarn.lock"))) {
    pkgMgr = "yarn";
  }

  log(`Running '${pkgMgr} install' to regenerate dependencies...`, "INFO");
  try {
    execSync(`${pkgMgr} install`, { cwd: projectDir, stdio: "inherit" });
    log("Dependencies successfully reinstalled.", "SUCCESS");
  } catch (err: any) {
    log(`Package installation failed: ${err.message}`, "ERROR");
    throw new Error(`Package installation failed: ${err.message}`);
  }
}

export function runCleanser(options: {
  dir: string;
  rename: string | null;
  dryRun: boolean;
  recipe: string | null;
  metadataSummary?: any;
}) {
  const targetDir = path.resolve(options.dir);
  const recipe = loadRecipe(options.recipe);
  const recipeName = recipe.name || "decouple";

  // Load configuration profile from liberatejs.config.json in the target directory
  const configPath = path.join(targetDir, "liberatejs.config.json");
  let config: any = {};
  if (fs.existsSync(configPath)) {
    try {
      config = JSON.parse(fs.readFileSync(configPath, "utf8"));
      log(`Loaded LiberateJS configuration from ${configPath}`, "SUCCESS");
    } catch (err: any) {
      log(`Failed to load LiberateJS configuration: ${err.message}`, "WARNING");
    }
  }

  log(`Starting ${recipeName} cleanup in: ${targetDir}`);
  if (options.dryRun) {
    log("DRY RUN MODE ENABLED - No changes will be saved", "WARNING");
  }

  const configFramework = config.framework || config.targetFramework;
  runPreflightChecks(targetDir, configFramework, config.packageManager);

  const localMetadata = options.metadataSummary || {
    migration_timestamp: new Date().toISOString(),
    original_project_name: "",
    new_project_name: "",
    detected_framework: "",
    deleted_files_and_directories: [],
    modified_files: [],
    removed_dependencies: [],
    removed_scripts: [],
    extracted_env_vars: []
  };

  if (config.routes) {
    localMetadata.routes_configured = config.routes;
  }

  extractEnvVariables(targetDir, localMetadata, recipe);

  log(`Step 1: Deleting ${recipeName} folders...`, "INFO");
  const deletePaths = recipe.delete_paths || [];
  for (const p of deletePaths) {
    const fullP = path.join(targetDir, p);
    if (fs.existsSync(fullP)) {
      const relP = path.relative(targetDir, fullP);
      if (options.dryRun) {
        log(`Would delete: ${fullP}`, "INFO");
        localMetadata.deleted_files_and_directories.push(relP);
      } else {
        try {
          const stat = fs.statSync(fullP);
          if (stat.isDirectory()) {
            fs.rmSync(fullP, { recursive: true, force: true });
          } else {
            fs.unlinkSync(fullP);
          }
          log(`Deleted: ${fullP}`, "SUCCESS");
          localMetadata.deleted_files_and_directories.push(relP);
        } catch (err: any) {
          log(`Failed to delete ${fullP}: ${err.message}`, "ERROR");
        }
      }
    }
  }

  log("Step 2: Cleaning package.json...", "INFO");
  cleansePackageJson(targetDir, options.rename, options.dryRun, localMetadata, recipe);

  log("Step 3: Cleaning index.html...", "INFO");
  cleanseHtml(targetDir, options.dryRun, localMetadata, recipe);

  log("Step 4: Running global case-preserving replacement...", "INFO");
  deepSearchAndReplace(targetDir, options.dryRun, localMetadata, recipe);

  if (config.routes) {
    log("Step 4.1: Applying configuration profile routing configurations...", "INFO");
    applyRoutingConfigurations(targetDir, config.routes, options.dryRun, localMetadata);
  }

  log("Step 4.5: Writing framework configuration file...", "INFO");
  const framework = configFramework || detectFramework(targetDir);
  localMetadata.detected_framework = framework;
  writeFrameworkConfig(targetDir, framework, options.dryRun, localMetadata);

  log("Step 4.6: Scaffolding testing and logging capabilities...", "INFO");
  scaffoldTestingAndLogging(targetDir, framework, options.dryRun, localMetadata);

  log("Step 4.7: Scaffolding styling and bundle optimizations...", "INFO");
  scaffoldStylingAndOptimization(targetDir, options.dryRun, localMetadata);

  if (!options.dryRun) {
    const metaPath = path.join(targetDir, ".migration-status.json");
    try {
      fs.writeFileSync(metaPath, JSON.stringify(localMetadata, null, 2) + "\n", "utf8");
      log(`Generated migration metadata at ${metaPath}`, "SUCCESS");
    } catch (err: any) {
      log(`Failed to write migration status: ${err.message}`, "ERROR");
    }
  }

  log("Step 5: Re-installing dependencies...", "INFO");
  runNpmInstall(targetDir, options.dryRun, config.packageManager);

  log(`${recipeName.toUpperCase()} Decoupling CLI phase complete. Standalone project is ready for AI re-wiring and enhancement!`, "SUCCESS");
  
  return localMetadata;
}
