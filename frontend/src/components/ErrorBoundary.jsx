import React from "react";
import { tryRecoverFromChunkError } from "../utils/chunkErrorRecovery";

/**
 * Global ErrorBoundary — catches unhandled React render errors
 * and displays a friendly recovery UI instead of a white screen.
 */
export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    this.setState({ errorInfo });
    console.error("[ErrorBoundary] Uncaught error:", error, errorInfo);
    // A stale service worker can serve an app shell that imports a chunk
    // filename from a previous deploy — React surfaces that dynamic-import
    // failure here (lazy() component boundaries), not always as a global
    // window error. Auto-recover instead of showing the fallback UI for
    // what's really just a one-time cache staleness hiccup.
    tryRecoverFromChunkError(error);
  }

  handleReload = () => {
    window.location.reload();
  };

  handleReset = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div style={styles.container}>
          <div style={styles.card}>
            <div style={styles.icon}>&#x1F41F;</div>
            <h1 style={styles.title}>Something went wrong</h1>
            <p style={styles.message}>
              Aquadex hit an unexpected error. Your data is safe locally — try
              reloading the page.
            </p>
            {this.state.error && (
              <details style={styles.details}>
                <summary style={styles.summary}>Technical details</summary>
                <pre style={styles.pre}>
                  {this.state.error.toString()}
                  {this.state.errorInfo?.componentStack && (
                    <>
                      {"\n\nComponent stack:"}
                      {this.state.errorInfo.componentStack}
                    </>
                  )}
                </pre>
              </details>
            )}
            <div style={styles.buttons}>
              <button onClick={this.handleReset} style={styles.buttonSecondary}>
                Try Again
              </button>
              <button onClick={this.handleReload} style={styles.buttonPrimary}>
                Reload Page
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

const styles = {
  container: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    minHeight: "100vh",
    backgroundColor: "#0f172a",
    padding: "1rem",
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  },
  card: {
    backgroundColor: "#1e293b",
    borderRadius: "12px",
    padding: "2.5rem",
    maxWidth: "480px",
    width: "100%",
    textAlign: "center",
    border: "1px solid #334155",
  },
  icon: {
    fontSize: "3rem",
    marginBottom: "1rem",
  },
  title: {
    color: "#f1f5f9",
    fontSize: "1.5rem",
    margin: "0 0 0.75rem 0",
    fontWeight: 600,
  },
  message: {
    color: "#94a3b8",
    fontSize: "0.95rem",
    lineHeight: 1.5,
    margin: "0 0 1.5rem 0",
  },
  details: {
    textAlign: "left",
    marginBottom: "1.5rem",
  },
  summary: {
    color: "#64748b",
    cursor: "pointer",
    fontSize: "0.8rem",
    marginBottom: "0.5rem",
  },
  pre: {
    color: "#f87171",
    backgroundColor: "#0f172a",
    padding: "0.75rem",
    borderRadius: "6px",
    fontSize: "0.75rem",
    overflow: "auto",
    maxHeight: "200px",
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
  },
  buttons: {
    display: "flex",
    gap: "0.75rem",
    justifyContent: "center",
  },
  buttonPrimary: {
    backgroundColor: "#38bdf8",
    color: "#0f172a",
    border: "none",
    borderRadius: "8px",
    padding: "0.6rem 1.25rem",
    fontSize: "0.9rem",
    fontWeight: 600,
    cursor: "pointer",
  },
  buttonSecondary: {
    backgroundColor: "transparent",
    color: "#94a3b8",
    border: "1px solid #475569",
    borderRadius: "8px",
    padding: "0.6rem 1.25rem",
    fontSize: "0.9rem",
    fontWeight: 500,
    cursor: "pointer",
  },
};
