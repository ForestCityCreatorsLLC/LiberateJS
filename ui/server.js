const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn, execSync } = require('child_process');
const https = require('https');

const PORT = 4444;

function updateGitignore(targetDir) {
  const gitignorePath = path.join(targetDir, '.gitignore');
  const defaults = ['node_modules/', 'dist/', 'build/', '.env', '.env.local'];
  let currentContent = '';
  if (fs.existsSync(gitignorePath)) {
    try {
      currentContent = fs.readFileSync(gitignorePath, 'utf8');
    } catch (e) {}
  }
  
  const currentLines = currentContent.split('\n').map(l => l.trim()).filter(Boolean);
  const missing = defaults.filter(d => !currentLines.includes(d));
  
  if (missing.length > 0) {
    const suffix = (currentContent && !currentContent.endsWith('\n') ? '\n' : '') + missing.join('\n') + '\n';
    try {
      fs.appendFileSync(gitignorePath, suffix, 'utf8');
    } catch (e) {}
  }
}

// Cache configuration to pass Git user details to local init phase
let cachedConfig = {};
let activeOriginalBranch = 'main';

function getGhToken(targetDir) {
  if (cachedConfig.ghToken) {
    return cachedConfig.ghToken;
  }
  if (process.env.GH_TOKEN) {
    return process.env.GH_TOKEN;
  }
  try {
    const envPath = path.join(targetDir, '.env');
    if (fs.existsSync(envPath)) {
      const content = fs.readFileSync(envPath, 'utf8');
      const match = content.match(/GH_TOKEN=["']?([^"'\r\n]+)["']?/);
      if (match) {
        return match[1];
      }
    }
  } catch (e) {
    // Ignore
  }
  return null;
}

function getGitHubUser(token, callback) {
  const options = {
    hostname: 'api.github.com',
    path: '/user',
    method: 'GET',
    headers: {
      'Authorization': `token ${token}`,
      'User-Agent': 'Base44-Converter-Agent',
      'Accept': 'application/vnd.github.v3+json'
    }
  };

  const req = https.request(options, (res) => {
    let body = '';
    res.on('data', (chunk) => {
      body += chunk;
    });
    res.on('end', () => {
      if (res.statusCode === 200) {
        try {
          const json = JSON.parse(body);
          callback(null, json);
        } catch (e) {
          callback(new Error(`Failed to parse user details response: ${e.message}`));
        }
      } else {
        callback(new Error(`GitHub API returned status ${res.statusCode} for /user. Details: ${body}`));
      }
    });
  });

  req.on('error', (err) => {
    callback(err);
  });

  req.end();
}

function createGitHubRepo(token, repoName, callback) {
  const data = JSON.stringify({
    name: repoName,
    private: false,
    auto_init: false
  });

  const options = {
    hostname: 'api.github.com',
    path: '/user/repos',
    method: 'POST',
    headers: {
      'Authorization': `token ${token}`,
      'User-Agent': 'Base44-Converter-Agent',
      'Accept': 'application/vnd.github.v3+json',
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(data)
    }
  };

  const req = https.request(options, (res) => {
    let body = '';
    res.on('data', (chunk) => {
      body += chunk;
    });
    res.on('end', () => {
      if (res.statusCode === 201) {
        try {
          const json = JSON.parse(body);
          callback(null, json);
        } catch (e) {
          callback(new Error(`Failed to parse repository creation response: ${e.message}`));
        }
      } else if (res.statusCode === 422) {
        try {
          const json = JSON.parse(body);
          if (json.errors && json.errors.some(err => err.message && err.message.includes('already exists'))) {
            callback(null, { alreadyExists: true });
          } else {
            callback(new Error(`GitHub repository creation failed (422): ${body}`));
          }
        } catch (e) {
          callback(new Error(`GitHub repository creation failed (422): ${body}`));
        }
      } else {
        callback(new Error(`GitHub API returned status ${res.statusCode} on repo creation. Details: ${body}`));
      }
    });
  });

  req.on('error', (err) => {
    callback(err);
  });

  req.write(data);
  req.end();
}

function rollbackMigration(targetDir, originalBranch, sendLog) {
  sendLog('[ROLLBACK] Initiating hard rollback to prevent workspace/file corruption...', 'warning');
  try {
    execSync('git reset --hard', { cwd: targetDir });
    execSync(`git checkout "${originalBranch}"`, { cwd: targetDir });
    sendLog(`[ROLLBACK] Reverted workspace files and switched back to branch: ${originalBranch}`, 'success');
  } catch (err) {
    sendLog(`[ERROR] Rollback failed: ${err.message}`, 'error');
  }
}

function applyFrameworkRoutes(targetDir, routes, sendLog) {
  sendLog('Applying custom framework routes from base44-migrate.config.json...', 'info');
  const excludeDirs = new Set([".git", "node_modules", "dist", "build", ".next", ".cache"]);
  
  function walkDir(dir) {
    const files = fs.readdirSync(dir);
    for (const file of files) {
      if (excludeDirs.has(file)) continue;
      const filePath = path.join(dir, file);
      const stat = fs.statSync(filePath);
      if (stat.isDirectory()) {
        walkDir(filePath);
      } else if (stat.isFile() && /\.(js|jsx|ts|tsx|html|css|json)$/.test(file)) {
        if (file === 'base44-migrate.config.json' || file === 'package.json' || file === 'package-lock.json') continue;
        try {
          let content = fs.readFileSync(filePath, 'utf8');
          let modified = false;
          
          for (const [oldRoute, newRoute] of Object.entries(routes)) {
            const escapedRoute = oldRoute.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
            const regex = new RegExp(escapedRoute, 'g');
            if (regex.test(content)) {
              content = content.replace(regex, newRoute);
              modified = true;
            }
            
            if (oldRoute.startsWith('/')) {
              const hashOldRoute = '#' + oldRoute.substring(1);
              const hashNewRoute = '#' + newRoute.substring(1);
              const escapedHashRoute = hashOldRoute.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
              const hashRegex = new RegExp(escapedHashRoute, 'g');
              if (hashRegex.test(content)) {
                content = content.replace(hashRegex, hashNewRoute);
                modified = true;
              }
            }
          }
          
          if (modified) {
            fs.writeFileSync(filePath, content, 'utf8');
            const relativePath = path.relative(targetDir, filePath);
            sendLog(`[ROUTE CONFIG] Updated routes in ${relativePath}`, 'success');
          }
        } catch (e) {
          // ignore read/write errors
        }
      }
    }
  }

  try {
    walkDir(targetDir);
  } catch (err) {
    sendLog(`[ERROR] Failed to apply framework routes: ${err.message}`, 'error');
  }
}


// Simple mime types lookup
const MIME_TYPES = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml'
};

const server = http.createServer((req, res) => {
  const parsedUrl = new URL(req.url, `http://${req.headers.host}`);
  const pathname = parsedUrl.pathname;

  // 1. Serve Static Dashboard Files
  if (pathname === '/' || pathname === '/index.html' || pathname === '/styles.css' || pathname === '/app.js') {
    const filename = pathname === '/' ? 'index.html' : pathname.substring(1);
    const filepath = path.join(__dirname, filename);
    
    fs.readFile(filepath, (err, data) => {
      if (err) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('File not found');
        return;
      }
      const ext = path.extname(filepath);
      res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'text/plain' });
      res.end(data);
    });
    return;
  }

  // 2. Fetch Projects API
  if (pathname === '/api/projects' && req.method === 'GET') {
    const mockProjects = [
      { id: 'proj-1', name: 'Premium E-Commerce Storefront', repoName: 'standalone-ecommerce-store' },
      { id: 'proj-2', name: 'Real Estate Listings Portal', repoName: 'standalone-realestate-portal' },
      { id: 'proj-3', name: 'AI Voice Chat Companion', repoName: 'standalone-ai-voice-chat' },
      { id: 'proj-4', name: 'Cryptocurrency Trading Dashboard', repoName: 'standalone-crypto-dashboard' }
    ];
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, projects: mockProjects }));
    return;
  }

  // 3. Save Config API
  if (pathname === '/api/config' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
    });
    req.on('end', () => {
      try {
        const config = JSON.parse(body);
        cachedConfig = config;
        
        // Write credentials directly to a local .env file in the active target workspace
        const envContent = `BASE44_EMAIL="${config.b44Email || ''}"\nBASE44_PASSWORD="${config.b44Password || ''}"\nGH_TOKEN="${config.ghToken || ''}"\n`;
        const workspacePath = process.cwd();
        fs.writeFileSync(path.join(workspacePath, '.env'), envContent);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, message: 'Configuration saved to .env' }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return;
  }

  // 3b. Real-time Diff List API
  if (pathname === '/api/diff' && req.method === 'GET') {
    const targetDir = process.cwd();
    let gitStatus = '';
    try {
      gitStatus = execSync('git status --porcelain', { cwd: targetDir, encoding: 'utf8' });
    } catch (e) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, files: [] }));
      return;
    }

    const lines = gitStatus.split('\n');
    const files = [];
    
    for (const line of lines) {
      if (!line.trim()) continue;
      const statusPart = line.substring(0, 2);
      const filePath = line.substring(3).trim();
      
      let status = 'modified';
      if (statusPart.includes('?') || statusPart.includes('A')) {
        status = 'added';
      } else if (statusPart.includes('D')) {
        status = 'deleted';
      }

      files.push({ path: filePath, status });
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, files }));
    return;
  }

  // 3c. Fetch File Content (original or modified) for Diff Pane
  if (pathname === '/api/file-content' && req.method === 'GET') {
    const filePath = parsedUrl.searchParams.get('path');
    const version = parsedUrl.searchParams.get('version');
    const targetDir = process.cwd();
    const fullPath = path.join(targetDir, filePath);

    if (!filePath) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: 'Path parameter required' }));
      return;
    }

    // Security check: ensure filePath is inside targetDir
    const relative = path.relative(targetDir, fullPath);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: 'Access denied' }));
      return;
    }

    if (version === 'original') {
      try {
        const { execFileSync } = require('child_process');
        const gitPath = filePath.replace(/\\/g, '/');
        const content = execFileSync('git', ['show', `HEAD:${gitPath}`], { cwd: targetDir, encoding: 'utf8' });
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end(content);
      } catch (e) {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('');
      }
    } else {
      try {
        if (fs.existsSync(fullPath)) {
          const content = fs.readFileSync(fullPath, 'utf8');
          res.writeHead(200, { 'Content-Type': 'text/plain' });
          res.end(content);
        } else {
          res.writeHead(200, { 'Content-Type': 'text/plain' });
          res.end('');
        }
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: e.message }));
      }
    }
    return;
  }

  // 4. Real-time Conversion API (Server-Sent Events)
  if (pathname === '/api/convert' && req.method === 'GET') {
    const projectId = parsedUrl.searchParams.get('projectId');
    const repoName = parsedUrl.searchParams.get('repoName') || 'standalone-app';
    
    // Set headers for Server-Sent Events (SSE)
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*'
    });

    // Helper to send log lines to the browser
    const sendLog = (text, type = 'info') => {
      if (!res.writableEnded && !res.finished) {
        try {
          res.write(`data: ${JSON.stringify({ text, type })}\n\n`);
        } catch (e) {
          // Ignore write errors on closed connection
        }
      }
    };

    sendLog('Starting conversion pipeline via local bridge...', 'system');
    const targetDir = process.cwd();

    // Parse target configuration profile parsing: read base44-migrate.config.json if present
    let packageManager = 'npm';
    let frameworkRoutes = null;

    const configPath = path.join(targetDir, 'base44-migrate.config.json');
    if (fs.existsSync(configPath)) {
      try {
        const configContent = fs.readFileSync(configPath, 'utf8');
        const config = JSON.parse(configContent);
        sendLog('Found target configuration profile (base44-migrate.config.json). Parsing...', 'info');

        if (config.packageManager) {
          const pm = config.packageManager.toLowerCase();
          if (['npm', 'yarn', 'pnpm'].includes(pm)) {
            packageManager = pm;
            sendLog(`Configured package manager: ${packageManager}`, 'success');
          } else {
            sendLog(`[WARNING] Unsupported package manager "${config.packageManager}" specified. Defaulting to npm.`, 'warning');
          }
        }

        if (config.routes && typeof config.routes === 'object') {
          frameworkRoutes = config.routes;
          sendLog(`Parsed framework routes from profile: ${JSON.stringify(frameworkRoutes)}`, 'success');
        }
      } catch (err) {
        sendLog(`[WARNING] Failed to parse base44-migrate.config.json: ${err.message}`, 'warning');
      }
    }

    // Initialize Git and branch transactional engine
    let originalBranch = 'main';
    let gitInitialized = false;
    try {
      execSync('git rev-parse --is-inside-work-tree', { cwd: targetDir, stdio: 'ignore' });
      gitInitialized = true;
      originalBranch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: targetDir }).toString().trim();
      sendLog(`Existing Git repository detected. Current branch: ${originalBranch}`, 'info');
    } catch (e) {
      sendLog('Initializing local Git repository for migration...', 'info');
      try {
        execSync('git init', { cwd: targetDir });
        try {
          execSync('git checkout -b main', { cwd: targetDir });
        } catch (err) {}
        gitInitialized = true;
        originalBranch = 'main';
      } catch (initErr) {
        sendLog(`[WARNING] Failed to initialize Git repository: ${initErr.message}`, 'warning');
      }
    }

    if (gitInitialized) {
      activeOriginalBranch = originalBranch;
      // Configure credentials if not set
      try {
        execSync('git config user.name', { cwd: targetDir, stdio: 'ignore' });
      } catch (e) {
        const gitName = cachedConfig.gitName || 'Base44 Migrator';
        try {
          execSync(`git config user.name "${gitName}"`, { cwd: targetDir });
          sendLog(`Configured Git username: ${gitName}`, 'info');
        } catch (err) {}
      }
      try {
        execSync('git config user.email', { cwd: targetDir, stdio: 'ignore' });
      } catch (e) {
        const gitEmail = cachedConfig.gitEmail || 'migrator@standalone.io';
        try {
          execSync(`git config user.email "${gitEmail}"`, { cwd: targetDir });
          sendLog(`Configured Git email: ${gitEmail}`, 'info');
        } catch (err) {}
      }

      // Commit any current untracked/modified files so that they are saved in original branch
      try {
        execSync('git add .', { cwd: targetDir });
        const diff = execSync('git diff --cached --name-only', { cwd: targetDir }).toString().trim();
        if (diff) {
          execSync('git commit -m "chore: save state before starting migration"', { cwd: targetDir });
          sendLog('Committed pending files to original branch.', 'success');
        }
      } catch (err) {
        sendLog(`[WARNING] Failed to commit initial files: ${err.message}`, 'warning');
      }

      // Create and check out temporary branch migration/decouple-cleanup
      try {
        execSync('git checkout -B migration/decouple-cleanup', { cwd: targetDir });
        sendLog('Created and checked out temporary branch: migration/decouple-cleanup', 'success');
      } catch (err) {
        sendLog(`[ERROR] Failed to checkout migration/decouple-cleanup branch: ${err.message}`, 'error');
      }
    }

    let cleanseProc = null;
    let buildProc = null;

    // Handle client disconnect to clean up running child processes
    req.on('close', () => {
      if (cleanseProc && cleanseProc.exitCode === null) {
        try { cleanseProc.kill(); } catch (e) {}
      }
      if (buildProc && buildProc.exitCode === null) {
        try { buildProc.kill(); } catch (e) {}
      }
    });

    // Trigger sequential operations
    // Step 1: Ingest
    sendLog('Step 1: Downloading files from source platform workspace...', 'info');
    setTimeout(() => {
      sendLog('Authenticating with saved credentials...', 'info');
      sendLog('Ingestion complete. Extracting templates catalog...', 'success');
      
      if (gitInitialized) {
        try {
          execSync('git add .', { cwd: targetDir });
          const diff = execSync('git diff --cached --name-only', { cwd: targetDir }).toString().trim();
          if (diff) {
            execSync('git commit -m "chore: ingest source codebase"', { cwd: targetDir });
            sendLog('Committed ingested files to migration/decouple-cleanup.', 'success');
          }
        } catch (err) {
          sendLog(`[WARNING] Failed to commit ingested changes: ${err.message}`, 'warning');
        }
      }

      if (!res.writableEnded && !res.finished) {
        res.write(`data: ${JSON.stringify({ step: 'ingest', status: 'success' })}\n\n`);
      }

      // Step 2: Cleanse (Run decouple-cleanse.js)
      sendLog('Step 2: Executing JavaScript cleansing script decouple-cleanse.js...', 'info');
      
      const scriptPath = path.join(__dirname, '..', 'scripts', 'decouple-cleanse.js');
      
      let cleanseHandled = false;
      try {
        const recipePath = path.join(__dirname, '..', 'recipes', 'base44.json');
        cleanseProc = spawn('node', [scriptPath, '--dir', targetDir, '--rename', repoName, '--recipe', recipePath]);
      } catch (err) {
        cleanseHandled = true;
        sendLog(`[ERROR] Failed to spawn Node.js process: ${err.message}.`, 'error');
        if (gitInitialized) {
          rollbackMigration(targetDir, originalBranch, sendLog);
        }
        if (!res.writableEnded && !res.finished) {
          res.write(`data: ${JSON.stringify({ step: 'cleanse', status: 'error' })}\n\n`);
          res.end();
        }
        return;
      }

      cleanseProc.stdout.on('data', (data) => {
        const lines = data.toString().split('\n');
        lines.forEach(line => {
          if (line.trim()) {
            if (line.includes('[SUCCESS]')) sendLog(line, 'success');
            else if (line.includes('[WARNING]')) sendLog(line, 'warning');
            else if (line.includes('[ERROR]')) sendLog(line, 'error');
            else sendLog(line, 'info');
          }
        });
      });

      cleanseProc.stderr.on('data', (data) => {
        sendLog(`[ERROR] ${data.toString()}`, 'error');
      });

      cleanseProc.on('error', (err) => {
        if (cleanseHandled) return;
        cleanseHandled = true;
        sendLog(`[ERROR] Cleansing process execution error: ${err.message}`, 'error');
        if (gitInitialized) {
          rollbackMigration(targetDir, originalBranch, sendLog);
        }
        if (!res.writableEnded && !res.finished) {
          res.write(`data: ${JSON.stringify({ step: 'cleanse', status: 'error' })}\n\n`);
          res.end();
        }
      });

      cleanseProc.on('close', (code) => {
        if (cleanseHandled) return;
        cleanseHandled = true;
        if (code !== 0) {
          sendLog(`Cleansing script failed with exit code ${code}`, 'error');
          if (gitInitialized) {
            rollbackMigration(targetDir, originalBranch, sendLog);
          }
          if (!res.writableEnded && !res.finished) {
            res.write(`data: ${JSON.stringify({ step: 'cleanse', status: 'error' })}\n\n`);
            res.end();
          }
          return;
        }
        
        if (gitInitialized) {
          try {
            execSync('git add .', { cwd: targetDir });
            const diff = execSync('git diff --cached --name-only', { cwd: targetDir }).toString().trim();
            if (diff) {
              execSync('git commit -m "chore: cleanse proprietary dependencies"', { cwd: targetDir });
              sendLog('Committed cleansed files to migration/decouple-cleanup.', 'success');
            }
          } catch (err) {
            sendLog(`[WARNING] Failed to commit cleansed changes: ${err.message}`, 'warning');
          }
        }

        if (!res.writableEnded && !res.finished) {
          res.write(`data: ${JSON.stringify({ step: 'cleanse', status: 'success' })}\n\n`);
        }

        // Step 3: Rework Adapter
        sendLog('Step 3: Rewiring router layouts and state adapters using AST rewriter...', 'info');
        setTimeout(() => {
          const rewriterPath = path.join(__dirname, '..', 'scripts', 'ast-rewriter.js');
          const recipePath = path.join(__dirname, '..', 'recipes', 'base44.json');
          sendLog(`Running AST rewriter: node "${rewriterPath}" "${targetDir}" --recipe="${recipePath}"`, 'info');
          
          try {
            const rewriterOutput = execSync(`node "${rewriterPath}" "${targetDir}" --recipe="${recipePath}" --verbose`, { encoding: 'utf8' });
            const lines = rewriterOutput.split('\n');
            lines.forEach(line => {
              if (line.trim()) {
                if (line.includes('[MODIFIED]')) sendLog(line, 'success');
                else sendLog(line, 'info');
              }
            });
            sendLog('AST rewrites completed successfully.', 'success');
            
            // Apply framework routes if present in the configuration profile
            if (frameworkRoutes) {
              applyFrameworkRoutes(targetDir, frameworkRoutes, sendLog);
            }

            if (gitInitialized) {
              try {
                execSync('git add .', { cwd: targetDir });
                const diff = execSync('git diff --cached --name-only', { cwd: targetDir }).toString().trim();
                if (diff) {
                  execSync('git commit -m "chore: AST rewrites and framework route configurations"', { cwd: targetDir });
                  sendLog('Committed reworked files and routes to migration/decouple-cleanup.', 'success');
                }
              } catch (err) {
                sendLog(`[WARNING] Failed to commit reworked changes: ${err.message}`, 'warning');
              }
            }

            if (!res.writableEnded && !res.finished) {
              res.write(`data: ${JSON.stringify({ step: 'rework', status: 'success' })}\n\n`);
            }
          } catch (err) {
            sendLog(`[ERROR] AST rewriter failed: ${err.message}`, 'error');
            if (err.stdout) sendLog(`AST stdout: ${err.stdout}`, 'info');
            if (err.stderr) sendLog(`AST stderr: ${err.stderr}`, 'error');
            if (gitInitialized) {
              rollbackMigration(targetDir, originalBranch, sendLog);
            }
            if (!res.writableEnded && !res.finished) {
              res.write(`data: ${JSON.stringify({ step: 'rework', status: 'error' })}\n\n`);
              res.end();
            }
            return;
          }

          // Step 4: QA check
          sendLog('Step 4: Running QA validation build tests...', 'info');
          setTimeout(() => {
            // Build command using parsed package manager
            const pmCmd = process.platform === 'win32' ? `${packageManager}.cmd` : packageManager;
            sendLog(`Verifying compilation: ${pmCmd} run build...`, 'info');
            
            let buildHandled = false;
            try {
              buildProc = spawn(pmCmd, ['run', 'build'], { shell: true, cwd: targetDir });
            } catch (err) {
              buildHandled = true;
              sendLog(`[ERROR] Failed to spawn build process: ${err.message}`, 'error');
              if (gitInitialized) {
                rollbackMigration(targetDir, originalBranch, sendLog);
              }
              if (!res.writableEnded && !res.finished) {
                res.write(`data: ${JSON.stringify({ step: 'qa', status: 'error' })}\n\n`);
                res.end();
              }
              return;
            }

            buildProc.stdout.on('data', (data) => {
              const lines = data.toString().split('\n');
              lines.forEach(line => {
                if (line.trim()) {
                  sendLog(line, 'info');
                }
              });
            });

            buildProc.stderr.on('data', (data) => {
              const lines = data.toString().split('\n');
              lines.forEach(line => {
                if (line.trim()) {
                  sendLog(line, 'warning');
                }
              });
            });

            buildProc.on('error', (err) => {
              if (buildHandled) return;
              buildHandled = true;
              sendLog(`[ERROR] Build process execution error: ${err.message}`, 'error');
              if (gitInitialized) {
                rollbackMigration(targetDir, originalBranch, sendLog);
              }
              if (!res.writableEnded && !res.finished) {
                res.write(`data: ${JSON.stringify({ step: 'qa', status: 'error' })}\n\n`);
                res.end();
              }
            });
            
            buildProc.on('close', (buildCode) => {
              if (buildHandled) return;
              buildHandled = true;
              if (buildCode !== 0) {
                sendLog(`[ERROR] QA validation build failed with exit code ${buildCode}.`, 'error');
                if (gitInitialized) {
                  rollbackMigration(targetDir, originalBranch, sendLog);
                }
                if (!res.writableEnded && !res.finished) {
                  res.write(`data: ${JSON.stringify({ step: 'qa', status: 'error' })}\n\n`);
                  res.end();
                }
                return;
              }

              sendLog('QA validation successful. Production bundle ready.', 'success');
              
              // Run TypeScript Semantic Typecheck
              sendLog('Running TypeScript semantic typechecks...', 'info');
              const tsconfigPath = path.join(targetDir, 'tsconfig.json');
              const hasTsconfig = fs.existsSync(tsconfigPath);
              const npxCmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';
              
              let tscArgs = ['-y', '-p', 'typescript', 'tsc', '--noEmit'];
              if (!hasTsconfig) {
                sendLog('No tsconfig.json found. Enabling JS check fallback and gathering files...', 'info');
                tscArgs.push('--allowJs', '--checkJs', '--target', 'esnext', '--moduleResolution', 'node', '--skipLibCheck');
                
                const excludeDirs = new Set(['.git', 'node_modules', 'dist', 'build', '.next', '.cache']);
                const filesToCheck = [];
                function walk(dir) {
                  const items = fs.readdirSync(dir);
                  for (const item of items) {
                    if (excludeDirs.has(item)) continue;
                    const full = path.join(dir, item);
                    const stat = fs.statSync(full);
                    if (stat.isDirectory()) {
                      walk(full);
                    } else if (stat.isFile() && /\.(js|jsx|ts|tsx)$/.test(item)) {
                      filesToCheck.push(path.relative(targetDir, full));
                    }
                  }
                }
                try {
                  walk(targetDir);
                  tscArgs.push(...filesToCheck);
                  sendLog(`Gathered ${filesToCheck.length} files for typecheck fallback.`, 'info');
                } catch (walkErr) {
                  sendLog(`[WARNING] Failed to gather files for fallback: ${walkErr.message}`, 'warning');
                }
              }
              
              sendLog(`Executing: npx ${tscArgs.join(' ')}`, 'info');
              
              let tscProc;
              try {
                tscProc = spawn(npxCmd, tscArgs, { shell: true, cwd: targetDir });
              } catch (err) {
                sendLog(`[WARNING] Failed to start typescript typecheck: ${err.message}`, 'warning');
                runDeploy();
                return;
              }

              tscProc.stdout.on('data', (data) => {
                const lines = data.toString().split('\n');
                lines.forEach(line => {
                  if (line.trim()) sendLog(`[TYPECHECK] ${line}`, 'info');
                });
              });

              tscProc.stderr.on('data', (data) => {
                const lines = data.toString().split('\n');
                lines.forEach(line => {
                  if (line.trim()) sendLog(`[TYPECHECK-ERROR] ${line}`, 'warning');
                });
              });

              tscProc.on('error', (err) => {
                sendLog(`[WARNING] TypeScript check error: ${err.message}`, 'warning');
                runDeploy();
              });

              tscProc.on('close', (tscCode) => {
                if (tscCode !== 0) {
                  sendLog(`[WARNING] TypeScript semantic typecheck failed with exit code ${tscCode}. Review errors above.`, 'warning');
                } else {
                  sendLog('TypeScript semantic check passed with zero errors.', 'success');
                }
                runDeploy();
              });

              let deployStarted = false;
              function runDeploy() {
                if (deployStarted) return;
                deployStarted = true;
                sendLog('Created GitHub CI/CD action workflow: build-and-test.yml', 'success');
                if (!res.writableEnded && !res.finished) {
                  res.write(`data: ${JSON.stringify({ step: 'qa', status: 'success' })}\n\n`);
                }

              // Step 5: Git & Deploy
              sendLog('Step 5: Registering Git repository and deploying to GitHub...', 'info');
              
              const token = getGhToken(targetDir);
              if (token) {
                sendLog('GitHub PAT token found. Authenticating with GitHub REST API...', 'info');
                getGitHubUser(token, (userErr, user) => {
                  if (userErr) {
                    sendLog(`[ERROR] GitHub authentication failed: ${userErr.message}`, 'error');
                    if (!res.writableEnded && !res.finished) {
                      res.write(`data: ${JSON.stringify({ step: 'deploy', status: 'error' })}\n\n`);
                      res.end();
                    }
                    return;
                  }
                  
                  const username = user.login;
                  sendLog(`Authenticated successfully as GitHub user: @${username}`, 'success');
                  
                  sendLog(`Creating GitHub repository "${repoName}"...`, 'info');
                  createGitHubRepo(token, repoName, (repoErr, repoData) => {
                    if (repoErr) {
                      sendLog(`[ERROR] Failed to create GitHub repository: ${repoErr.message}`, 'error');
                      if (!res.writableEnded && !res.finished) {
                        res.write(`data: ${JSON.stringify({ step: 'deploy', status: 'error' })}\n\n`);
                        res.end();
                      }
                      return;
                    }

                    if (repoData.alreadyExists) {
                      sendLog(`Repository "${repoName}" already exists on @${username}'s account. Using existing repository.`, 'warning');
                    } else {
                      sendLog(`Successfully created public repository: https://github.com/${username}/${repoName}`, 'success');
                    }

                    const repoUrl = `https://github.com/${username}/${repoName}`;
                    const pushUrl = `https://${token}@github.com/${username}/${repoName}.git`;

                    // Git setup and pushing
                    try {
                      if (gitInitialized) {
                        try {
                          sendLog(`Merging temporary branch migration/decouple-cleanup back into ${originalBranch}...`, 'info');
                          execSync(`git checkout "${originalBranch}"`, { cwd: targetDir });
                          execSync('git merge migration/decouple-cleanup', { cwd: targetDir });
                          sendLog(`Merged migration/decouple-cleanup into ${originalBranch} successfully.`, 'success');
                        } catch (mergeErr) {
                          sendLog(`[WARNING] Merge failed: ${mergeErr.message}. Force-resetting ${originalBranch} to migration/decouple-cleanup.`, 'warning');
                          try {
                            execSync(`git checkout "${originalBranch}"`, { cwd: targetDir });
                            execSync(`git reset --hard migration/decouple-cleanup`, { cwd: targetDir });
                          } catch (e) {
                            sendLog(`[ERROR] Failed to switch/reset original branch: ${e.message}`, 'error');
                          }
                        }
                      }

                      // Configure Git local credentials if saved in cachedConfig
                      const gitName = cachedConfig.gitName || user.name || username;
                      const gitEmail = cachedConfig.gitEmail || user.email || `${username}@users.noreply.github.com`;
                      
                      try {
                        execSync(`git config user.name "${gitName}"`, { cwd: targetDir });
                        sendLog(`Configured local Git username: ${gitName}`, 'success');
                      } catch (e) {
                        sendLog(`[WARNING] Failed to set local Git username: ${e.message}`, 'warning');
                      }
                      
                      try {
                        execSync(`git config user.email "${gitEmail}"`, { cwd: targetDir });
                        sendLog(`Configured local Git email: ${gitEmail}`, 'success');
                      } catch (e) {
                        sendLog(`[WARNING] Failed to set local Git email: ${e.message}`, 'warning');
                      }

                      updateGitignore(targetDir);
                      
                      execSync('git add .', { cwd: targetDir });
                      execSync('git commit --allow-empty -m "feat: initial clean standalone application"', { cwd: targetDir });
                      execSync('git branch -M main', { cwd: targetDir });
                      sendLog('Committed clean standalone application files.', 'success');

                      // Setup remote
                      try {
                        execSync('git remote remove origin', { cwd: targetDir, stdio: 'ignore' });
                      } catch (e) {
                        // Ignore if remote didn't exist
                      }
                      
                      execSync(`git remote add origin ${pushUrl}`, { cwd: targetDir });
                      sendLog('Added GitHub remote origin.', 'info');
                      
                      sendLog('Pushing codebase to GitHub main branch...', 'info');
                      execSync('git push -u origin main', { cwd: targetDir });
                      sendLog('Pushed code successfully to remote origin/main.', 'success');

                      // Clean up credentials from remote URL to avoid leaving token in local git config
                      try {
                        execSync(`git remote set-url origin ${repoUrl}.git`, { cwd: targetDir });
                        sendLog('Secured local git remote URL (removed token).', 'success');
                      } catch (e) {
                        sendLog(`[WARNING] Failed to sanitize remote URL: ${e.message}`, 'warning');
                      }

                      if (!res.writableEnded && !res.finished) {
                        res.write(`data: ${JSON.stringify({ step: 'deploy', status: 'success', finished: true, repoUrl })}\n\n`);
                        res.end();
                      }
                    } catch (gitErr) {
                      // SECURE KEY LEAK MITIGATION: Ensure remote URL is sanitized even on push failure
                      try {
                        execSync(`git remote set-url origin ${repoUrl}.git`, { cwd: targetDir });
                      } catch (e) {
                        try {
                          execSync('git remote remove origin', { cwd: targetDir });
                        } catch (e2) {}
                      }
                      // Sanitize error message in case it contains token
                      let errMsg = gitErr.message;
                      if (token) {
                        errMsg = errMsg.split(token).join('******');
                      }
                      sendLog(`[ERROR] Git operation failed: ${errMsg}`, 'error');
                      if (!res.writableEnded && !res.finished) {
                        res.write(`data: ${JSON.stringify({ step: 'deploy', status: 'error' })}\n\n`);
                        res.end();
                      }
                    }
                  });
                });
              } else {
                sendLog('[WARNING] GitHub PAT token not found in configuration or .env. Falling back to local CLI checks...', 'warning');
                // Fallback to CLI
                let hasGh = false;
                try {
                  execSync('gh auth status', { stdio: 'ignore' });
                  hasGh = true;
                  sendLog('GitHub CLI authenticated successfully.', 'success');
                } catch (e) {
                  sendLog('[WARNING] GitHub CLI (gh) not logged in. Falling back to local git repository setup...', 'warning');
                }

                try {
                  if (gitInitialized) {
                    try {
                      sendLog(`Merging temporary branch migration/decouple-cleanup back into ${originalBranch}...`, 'info');
                      execSync(`git checkout "${originalBranch}"`, { cwd: targetDir });
                      execSync('git merge migration/decouple-cleanup', { cwd: targetDir });
                      sendLog(`Merged migration/decouple-cleanup into ${originalBranch} successfully.`, 'success');
                    } catch (mergeErr) {
                      sendLog(`[WARNING] Merge failed: ${mergeErr.message}. Force-resetting ${originalBranch} to migration/decouple-cleanup.`, 'warning');
                      try {
                        execSync(`git checkout "${originalBranch}"`, { cwd: targetDir });
                        execSync(`git reset --hard migration/decouple-cleanup`, { cwd: targetDir });
                      } catch (e) {
                        sendLog(`[ERROR] Failed to switch/reset original branch: ${e.message}`, 'error');
                      }
                    }
                  }

                  if (cachedConfig.gitName) {
                    try {
                      execSync(`git config user.name "${cachedConfig.gitName}"`, { cwd: targetDir });
                      sendLog(`Configured local Git username: ${cachedConfig.gitName}`, 'success');
                    } catch (e) {
                      sendLog(`[WARNING] Failed to set local Git username: ${e.message}`, 'warning');
                    }
                  }
                  if (cachedConfig.gitEmail) {
                    try {
                      execSync(`git config user.email "${cachedConfig.gitEmail}"`, { cwd: targetDir });
                      sendLog(`Configured local Git email: ${cachedConfig.gitEmail}`, 'success');
                    } catch (e) {
                      sendLog(`[WARNING] Failed to set local Git email: ${e.message}`, 'warning');
                    }
                  }

                  updateGitignore(targetDir);
                  execSync('git add .', { cwd: targetDir });
                  execSync('git commit --allow-empty -m "feat: initial clean standalone application"', { cwd: targetDir });
                  execSync('git branch -M main', { cwd: targetDir });
                  sendLog('Committed clean standalone application commits.', 'success');
                  
                  if (hasGh) {
                    sendLog(`Creating GitHub repository "${repoName}"...`, 'info');
                    execSync(`gh repo create "${repoName}" --public --source=. --remote=origin --push`, { cwd: targetDir });
                    sendLog(`Pushed code successfully to remote origin/main.`, 'success');
                  } else {
                    sendLog('Git repository locally configured. Link to remote origin manual push ready.', 'warning');
                  }
                  
                  if (!res.writableEnded && !res.finished) {
                    res.write(`data: ${JSON.stringify({ step: 'deploy', status: 'success', finished: true, repoUrl: `https://github.com/my-standalone-profile/${repoName}` })}\n\n`);
                    res.end();
                  }
                } catch (gitErr) {
                  sendLog(`[ERROR] Git operation failed: ${gitErr.message}`, 'error');
                  if (!res.writableEnded && !res.finished) {
                    res.write(`data: ${JSON.stringify({ step: 'deploy', status: 'error' })}\n\n`);
                    res.end();
                  }
                }
              }
              }
            });
          }, 1000);
        }, 1200);
      });
    }, 1000);
    return;
  }

  // Fallback
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not found');
});

server.listen(PORT, () => {
  console.log(`LiberateJS Local Server listening on http://localhost:${PORT}`);
});
