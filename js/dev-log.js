/**
 * dev-log.js — Development Log Interface
 * Automatically loads the local `dev_log.txt` file inside a fresh iframe.
 * Recreates the iframe on load to bypass browser security origin blocks (such as about:blank blocks on file://)
 * and force reload from disk.
 */
window.DevLog = (function () {
  const devLogBtn = document.getElementById('globalDevLogBtn');
  const devLogPanel = document.getElementById('globalDevLogPanel');
  const devLogCloseBtn = document.getElementById('devLogCloseBtn');
  const devLogRefreshBtn = document.getElementById('devLogRefreshBtn');

  function loadDevLog() {
    // Dynamically find the body container
    const body = document.querySelector('.dev-log-body');
    if (!body) return;

    // Remove the existing iframe to prevent any caching or origin transition blocks
    const existingFrame = document.getElementById('devLogFrame');
    if (existingFrame) {
      existingFrame.remove();
    }

    // Create a brand new iframe element
    const frame = document.createElement('iframe');
    frame.id = 'devLogFrame';
    frame.style.width = '100%';
    frame.style.height = '100%';
    frame.style.border = 'none';
    frame.src = './dev_log.txt?t=' + Date.now();

    // Append to body container to trigger load
    body.appendChild(frame);
  }

  function init() {
    if (!devLogBtn || !devLogPanel) return;

    // Toggle dev log panel
    devLogBtn.addEventListener('click', (e) => {
      e.preventDefault();
      const isHidden = devLogPanel.classList.toggle('hidden');
      if (!isHidden) {
        loadDevLog();
        // Close IDE Agent panel if open to prevent UI overlap
        const agentPane = document.getElementById('globalIdeAgentPanel');
        if (agentPane) agentPane.classList.add('hidden');
      }
    });

    // Close panel button
    if (devLogCloseBtn) {
      devLogCloseBtn.addEventListener('click', () => {
        devLogPanel.classList.add('hidden');
      });
    }

    // Refresh content button
    if (devLogRefreshBtn) {
      devLogRefreshBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        loadDevLog();
      });
    }

    // Mutual exclusion: close dev log when IDE Agent is toggled open
    const agentBtn = document.getElementById('globalIdeAgentBtn');
    const agentPane = document.getElementById('globalIdeAgentPanel');
    if (agentBtn && agentPane) {
      agentBtn.addEventListener('click', () => {
        if (!agentPane.classList.contains('hidden')) {
          devLogPanel.classList.add('hidden');
        }
      });
    }
  }

  // Safely init when DOM is loaded
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  return {
    loadDevLog
  };
})();
