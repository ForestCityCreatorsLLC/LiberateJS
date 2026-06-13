import React from 'react';

export function AppLayout({ children }) {
  return (
    <div className="app-layout">
      <nav className="navbar">
        <div className="nav-container">
          <div className="nav-brand">
            <span className="brand-logo">⚡</span>
            <span className="brand-name">Standalone App</span>
          </div>
          <div className="nav-links">
            <a href="#modern-dashboard" className="nav-link active">Dashboard</a>
            <a href="#settings" className="nav-link">Settings</a>
            <a href="https://github.com" target="_blank" rel="noopener noreferrer" className="nav-link">GitHub</a>
          </div>
        </div>
      </nav>
      <main className="main-content">
        <div className="content-container">
          {children}
        </div>
      </main>
      <footer className="footer">
        <p>&copy; {new Date().getFullYear()} Standalone Web App. Decoupled from Standalone.</p>
      </footer>
    </div>
  );
}
