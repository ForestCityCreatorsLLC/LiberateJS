// LiberateJS App logic - Connected to Node.js Local Bridge Server
document.addEventListener('DOMContentLoaded', () => {
  // Elements
  const b44UsernameInput = document.getElementById('b44-username');
  const b44PasswordInput = document.getElementById('b44-password');
  const btnSaveB44 = document.getElementById('btn-save-b44');
  const b44AuthStatus = document.getElementById('b44-auth-status');

  const ghTokenInput = document.getElementById('gh-token');
  const gitNameInput = document.getElementById('git-name');
  const gitEmailInput = document.getElementById('git-email');
  const btnSaveGH = document.getElementById('btn-save-gh');
  const ghAuthStatus = document.getElementById('gh-auth-status');

  const projectSection = document.getElementById('project-section');
  const projectSelect = document.getElementById('project-select');
  const btnRefreshProjects = document.getElementById('btn-refresh-projects');

  const convertSection = document.getElementById('convert-section');
  const btnStartConvert = document.getElementById('btn-start-convert');
  const progressBar = document.getElementById('progress-bar');
  const consoleOutput = document.getElementById('console-output');
  const successCard = document.getElementById('success-card');
  const linkRepo = document.getElementById('link-repo');
  const btnReset = document.getElementById('btn-reset');

  const stepIngest = document.getElementById('step-ingest');
  const stepCleanse = document.getElementById('step-cleanse');
  const stepRework = document.getElementById('step-rework');
  const stepQA = document.getElementById('step-qa');
  const stepDeploy = document.getElementById('step-deploy');

  // Diff Elements
  const diffSection = document.getElementById('diff-section');
  const diffFilesList = document.getElementById('diff-files-list');
  const diffCurrentFile = document.getElementById('diff-current-file');
  const diffCurrentStatus = document.getElementById('diff-current-status');
  const diffPaneOriginal = document.getElementById('diff-pane-original');
  const diffPaneModified = document.getElementById('diff-pane-modified');

  // State
  let isB44Verified = false;
  let isGHVerified = false;
  let selectedProject = null;
  let projectsList = [];

  // Load saved configuration from localStorage
  loadSavedConfig();

  // Step 1: Save & Verify Base44
  btnSaveB44.addEventListener('click', () => {
    const username = b44UsernameInput.value.trim();
    const password = b44PasswordInput.value.trim();

    if (!username || !password) {
      showStatus(b44AuthStatus, 'Please enter username and password.', 'error');
      return;
    }

    showStatus(b44AuthStatus, 'Connecting to Base44...', 'loading');
    btnSaveB44.disabled = true;

    // Send credentials to local server config API
    saveConfigToServer(() => {
      isB44Verified = true;
      btnSaveB44.disabled = false;
      showStatus(b44AuthStatus, 'Connected & Verified as ' + username, 'success');
      
      localStorage.setItem('B44_EMAIL', username);
      localStorage.setItem('B44_PASSWORD', password);

      // Unlock project section
      projectSection.classList.remove('disabled');
      projectSelect.disabled = false;
      btnRefreshProjects.disabled = false;
      
      fetchProjects();
    });
  });

  // Step 1: Save & Verify GitHub
  btnSaveGH.addEventListener('click', () => {
    const token = ghTokenInput.value.trim();
    const gitName = gitNameInput.value.trim() || 'Base44 Migrator';
    const gitEmail = gitEmailInput.value.trim() || 'migrator@standalone.io';

    if (!token) {
      showStatus(ghAuthStatus, 'Please enter a GitHub Personal Access Token.', 'error');
      return;
    }

    showStatus(ghAuthStatus, 'Configuring Git & GitHub...', 'loading');
    btnSaveGH.disabled = true;

    saveConfigToServer(() => {
      isGHVerified = true;
      btnSaveGH.disabled = false;
      showStatus(ghAuthStatus, 'GitHub authenticated successfully', 'success');

      localStorage.setItem('GH_TOKEN', token);
      localStorage.setItem('GIT_NAME', gitName);
      localStorage.setItem('GIT_EMAIL', gitEmail);

      checkAllAuths();
    });
  });

  // Step 2: Refresh Projects
  btnRefreshProjects.addEventListener('click', () => {
    fetchProjects();
  });

  projectSelect.addEventListener('change', (e) => {
    const selectedId = e.target.value;
    selectedProject = projectsList.find(p => p.id === selectedId);
    checkAllAuths();
  });

  // Step 3: Start Conversion (SSE connection)
  btnStartConvert.addEventListener('click', () => {
    if (!isB44Verified || !isGHVerified || !selectedProject) return;

    // Disable all controls during conversion
    btnStartConvert.disabled = true;
    projectSelect.disabled = true;
    btnRefreshProjects.disabled = true;
    b44UsernameInput.disabled = true;
    b44PasswordInput.disabled = true;
    ghTokenInput.disabled = true;
    gitNameInput.disabled = true;
    gitEmailInput.disabled = true;
    btnSaveB44.disabled = true;
    btnSaveGH.disabled = true;

    runRealPipeline();
  });

  btnReset.addEventListener('click', () => {
    progressBar.style.width = '0%';
    successCard.classList.add('hidden');
    
    [stepIngest, stepCleanse, stepRework, stepQA, stepDeploy].forEach(step => {
      step.classList.remove('active', 'success', 'error');
      step.querySelector('.step-icon').textContent = '⚪';
    });

    consoleOutput.innerHTML = '<div class="console-line system">[SYSTEM] Ready to start conversion pipeline.</div>';

    // Reset Diff Panel
    diffSection.classList.add('disabled');
    diffFilesList.innerHTML = '<div class="diff-no-files">No files modified yet. Run conversion pipeline to view diffs.</div>';
    diffCurrentFile.textContent = 'Select a file to view diff';
    diffCurrentStatus.textContent = '';
    diffCurrentStatus.className = '';
    diffPaneOriginal.innerHTML = '<div class="diff-empty-state">No file selected</div>';
    diffPaneModified.innerHTML = '<div class="diff-empty-state">No file selected</div>';

    // Unlock controls
    projectSelect.disabled = false;
    btnRefreshProjects.disabled = false;
    b44UsernameInput.disabled = false;
    b44PasswordInput.disabled = false;
    ghTokenInput.disabled = false;
    gitNameInput.disabled = false;
    gitEmailInput.disabled = false;
    btnSaveB44.disabled = false;
    btnSaveGH.disabled = false;
    btnStartConvert.disabled = false;
  });

  // Helper functions
  function showStatus(elem, text, className) {
    elem.textContent = text;
    elem.className = 'status-msg ' + className;
  }

  function loadSavedConfig() {
    const savedEmail = localStorage.getItem('B44_EMAIL');
    const savedPwd = localStorage.getItem('B44_PASSWORD');
    const savedToken = localStorage.getItem('GH_TOKEN');
    const savedGitName = localStorage.getItem('GIT_NAME');
    const savedGitEmail = localStorage.getItem('GIT_EMAIL');

    if (savedEmail) b44UsernameInput.value = savedEmail;
    if (savedPwd) b44PasswordInput.value = savedPwd;
    if (savedToken) ghTokenInput.value = savedToken;
    if (savedGitName) gitNameInput.value = savedGitName;
    if (savedGitEmail) gitEmailInput.value = savedGitEmail;

    // Auto trigger check if already input
    if (savedEmail && savedPwd) {
      isB44Verified = true;
      showStatus(b44AuthStatus, 'Loaded verified email: ' + savedEmail, 'success');
      projectSection.classList.remove('disabled');
      projectSelect.disabled = false;
      btnRefreshProjects.disabled = false;
      fetchProjects();
    }
    if (savedToken) {
      isGHVerified = true;
      showStatus(ghAuthStatus, 'Loaded GitHub session token', 'success');
    }
    checkAllAuths();
  }

  function checkAllAuths() {
    if (isB44Verified && isGHVerified && selectedProject) {
      convertSection.classList.remove('disabled');
      btnStartConvert.disabled = false;
    } else {
      convertSection.classList.add('disabled');
      btnStartConvert.disabled = true;
    }
  }

  function saveConfigToServer(callback) {
    const payload = {
      b44Email: b44UsernameInput.value.trim(),
      b44Password: b44PasswordInput.value.trim(),
      ghToken: ghTokenInput.value.trim(),
      gitName: gitNameInput.value.trim(),
      gitEmail: gitEmailInput.value.trim()
    };

    fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
    .then(res => res.json())
    .then(data => {
      if (data.success) {
        callback();
      } else {
        alert('Failed to configure server: ' + data.error);
      }
    })
    .catch(err => {
      console.error(err);
      alert('Error connecting to local bridge server.');
    });
  }

  function fetchProjects() {
    fetch('/api/projects')
    .then(res => res.json())
    .then(data => {
      if (data.success) {
        projectsList = data.projects;
        projectSelect.innerHTML = '<option value="" disabled selected>Select a project...</option>';
        projectsList.forEach(proj => {
          const opt = document.createElement('option');
          opt.value = proj.id;
          opt.textContent = proj.name;
          projectSelect.appendChild(opt);
        });
      }
    })
    .catch(err => console.error('Error loading projects:', err));
  }

  function writeConsole(text, type = '') {
    const line = document.createElement('div');
    line.className = 'console-line ' + type;
    line.textContent = `[${new Date().toLocaleTimeString()}] ${text}`;
    consoleOutput.appendChild(line);
    consoleOutput.scrollTop = consoleOutput.scrollHeight;
  }

  // Diff Panel functions
  function fetchDiffs() {
    fetch('/api/diff')
      .then(res => res.json())
      .then(data => {
        if (data.success && data.files && data.files.length > 0) {
          diffSection.classList.remove('disabled');
          const currentActive = document.querySelector('.diff-file-item.active');
          const activePath = currentActive ? currentActive.querySelector('.diff-file-name').title : null;
          
          diffFilesList.innerHTML = '';
          data.files.forEach(file => {
            const item = document.createElement('div');
            item.className = 'diff-file-item';
            if (activePath === file.path) {
              item.classList.add('active');
            }
            item.innerHTML = `
              <span class="diff-file-name" title="${file.path}">${file.path.split(/[/\\]/).pop()}</span>
              <span class="diff-badge ${file.status}">${file.status}</span>
            `;
            item.addEventListener('click', () => {
              document.querySelectorAll('.diff-file-item').forEach(el => el.classList.remove('active'));
              item.classList.add('active');
              loadDiffForFile(file.path, file.status);
            });
            diffFilesList.appendChild(item);
          });
        }
      })
      .catch(err => console.error('Error fetching diffs:', err));
  }

  function loadDiffForFile(filePath, status) {
    diffCurrentFile.textContent = filePath;
    diffCurrentStatus.textContent = status;
    diffCurrentStatus.className = 'diff-badge ' + status;
    
    diffPaneOriginal.innerHTML = '<div class="diff-empty-state">Loading original file...</div>';
    diffPaneModified.innerHTML = '<div class="diff-empty-state">Loading modified file...</div>';
    
    Promise.all([
      fetch(`/api/file-content?path=${encodeURIComponent(filePath)}&version=original`).then(res => res.text()),
      fetch(`/api/file-content?path=${encodeURIComponent(filePath)}&version=modified`).then(res => res.text())
    ])
    .then(([originalContent, modifiedContent]) => {
      renderSideBySide(originalContent, modifiedContent);
    })
    .catch(err => {
      console.error(err);
      diffPaneOriginal.innerHTML = '<div class="diff-empty-state">Error loading file content</div>';
      diffPaneModified.innerHTML = '<div class="diff-empty-state">Error loading file content</div>';
    });
  }

  function renderSideBySide(originalContent, modifiedContent) {
    if (typeof Diff === 'undefined') {
      diffPaneOriginal.textContent = originalContent;
      diffPaneModified.textContent = modifiedContent;
      return;
    }
    
    const diff = Diff.diffLines(originalContent, modifiedContent);
    let leftLines = [];
    let rightLines = [];
    
    diff.forEach(part => {
      let lines = part.value.split('\n');
      if (part.value.endsWith('\n')) {
        lines.pop();
      }
      
      if (part.added) {
        lines.forEach(line => {
          leftLines.push({ text: '', type: 'empty' });
          rightLines.push({ text: line, type: 'added' });
        });
      } else if (part.removed) {
        lines.forEach(line => {
          leftLines.push({ text: line, type: 'removed' });
          rightLines.push({ text: '', type: 'empty' });
        });
      } else {
        lines.forEach(line => {
          leftLines.push({ text: line, type: 'normal' });
          rightLines.push({ text: line, type: 'normal' });
        });
      }
    });

    let leftHtml = '';
    let rightHtml = '';
    let leftLineNum = 1;
    let rightLineNum = 1;

    for (let i = 0; i < leftLines.length; i++) {
      const left = leftLines[i];
      const right = rightLines[i];

      if (left.type === 'empty') {
        leftHtml += `<div class="diff-line empty">&nbsp;</div>`;
      } else {
        leftHtml += `<div class="diff-line ${left.type}"><span class="line-num">${leftLineNum++}</span><span class="line-text">${escapeHtml(left.text)}</span></div>`;
      }

      if (right.type === 'empty') {
        rightHtml += `<div class="diff-line empty">&nbsp;</div>`;
      } else {
        rightHtml += `<div class="diff-line ${right.type}"><span class="line-num">${rightLineNum++}</span><span class="line-text">${escapeHtml(right.text)}</span></div>`;
      }
    }

    diffPaneOriginal.innerHTML = leftHtml || '<div class="diff-empty-state">Empty file</div>';
    diffPaneModified.innerHTML = rightHtml || '<div class="diff-empty-state">Empty file</div>';
  }

  function escapeHtml(text) {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // Synchronous scrolling
  let isScrollingOriginal = false;
  let isScrollingModified = false;

  diffPaneOriginal.addEventListener('scroll', () => {
    if (isScrollingModified) return;
    isScrollingOriginal = true;
    diffPaneModified.scrollTop = diffPaneOriginal.scrollTop;
    diffPaneModified.scrollLeft = diffPaneOriginal.scrollLeft;
    isScrollingOriginal = false;
  });

  diffPaneModified.addEventListener('scroll', () => {
    if (isScrollingOriginal) return;
    isScrollingModified = true;
    diffPaneOriginal.scrollTop = diffPaneModified.scrollTop;
    diffPaneOriginal.scrollLeft = diffPaneModified.scrollLeft;
    isScrollingModified = false;
  });

  // Helper to re-enable UI controls
  function enableAllControls() {
    btnStartConvert.disabled = false;
    projectSelect.disabled = false;
    btnRefreshProjects.disabled = false;
    b44UsernameInput.disabled = false;
    b44PasswordInput.disabled = false;
    ghTokenInput.disabled = false;
    gitNameInput.disabled = false;
    gitEmailInput.disabled = false;
    btnSaveB44.disabled = false;
    btnSaveGH.disabled = false;
  }

  // Real-time EventSource connection
  function runRealPipeline() {
    writeConsole(`Initialising live pipeline for: ${selectedProject.name}...`, 'system');
    
    // Set first step active
    stepIngest.classList.add('active');
    stepIngest.querySelector('.step-icon').textContent = '⚙️';
    progressBar.style.width = '10%';

    const stepElements = {
      ingest: stepIngest,
      cleanse: stepCleanse,
      rework: stepRework,
      qa: stepQA,
      deploy: stepDeploy
    };

    const eventSource = new EventSource(`/api/convert?projectId=${selectedProject.id}&repoName=${selectedProject.repoName}`);

    eventSource.onmessage = (event) => {
      const data = JSON.parse(event.data);

      if (data.text) {
        writeConsole(data.text, data.type);
      }

      // Handle step updates
      if (data.step) {
        if (data.status === 'error') {
          const stepEl = stepElements[data.step];
          if (stepEl) {
            stepEl.classList.remove('active');
            stepEl.classList.add('error');
            stepEl.querySelector('.step-icon').textContent = '❌';
          }
          eventSource.close();
          writeConsole(`Pipeline failed at step: ${data.step}. Please check the console output above.`, 'error');
          enableAllControls();
          return;
        }

        if (data.step === 'ingest' && data.status === 'success') {
          stepIngest.classList.remove('active');
          stepIngest.classList.add('success');
          stepIngest.querySelector('.step-icon').textContent = '✅';
          progressBar.style.width = '20%';
          // Trigger next step active UI
          stepCleanse.classList.add('active');
          stepCleanse.querySelector('.step-icon').textContent = '⚙️';
          fetchDiffs();
        }
        else if (data.step === 'cleanse' && data.status === 'success') {
          stepCleanse.classList.remove('active');
          stepCleanse.classList.add('success');
          stepCleanse.querySelector('.step-icon').textContent = '✅';
          progressBar.style.width = '45%';
          
          stepRework.classList.add('active');
          stepRework.querySelector('.step-icon').textContent = '⚙️';
          fetchDiffs();
        }
        else if (data.step === 'rework' && data.status === 'success') {
          stepRework.classList.remove('active');
          stepRework.classList.add('success');
          stepRework.querySelector('.step-icon').textContent = '✅';
          progressBar.style.width = '65%';
          
          stepQA.classList.add('active');
          stepQA.querySelector('.step-icon').textContent = '⚙️';
          fetchDiffs();
        }
        else if (data.step === 'qa' && data.status === 'success') {
          stepQA.classList.remove('active');
          stepQA.classList.add('success');
          stepQA.querySelector('.step-icon').textContent = '✅';
          progressBar.style.width = '85%';
          
          stepDeploy.classList.add('active');
          stepDeploy.querySelector('.step-icon').textContent = '⚙️';
          fetchDiffs();
        }
        else if (data.step === 'deploy' && data.status === 'success') {
          stepDeploy.classList.remove('active');
          stepDeploy.classList.add('success');
          stepDeploy.querySelector('.step-icon').textContent = '✅';
          progressBar.style.width = '100%';
          fetchDiffs();
 
          if (data.finished) {
            eventSource.close();
            writeConsole(`All phases completed successfully! Decoupled standalone app is live on GitHub!`, 'success');
            
            // Show Success Card
            setTimeout(() => {
              successCard.classList.remove('hidden');
              linkRepo.href = data.repoUrl;
            }, 500);
          }
        }
      }
    };

    eventSource.onerror = (err) => {
      writeConsole('Connection interrupted or error occurred in bridge server.', 'error');
      eventSource.close();
      enableAllControls();
    };
  }
});
