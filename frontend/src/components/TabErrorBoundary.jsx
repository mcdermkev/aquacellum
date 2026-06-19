import React from "react";

/**
 * TabErrorBoundary — Lightweight per-section error boundary.
 * Shows an inline recovery card instead of crashing the whole app.
 * Resets on tab change via the `resetKey` prop.
 */
export class TabErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error(`[TabErrorBoundary:${this.props.name || "unknown"}]`, error, errorInfo);
  }

  // Reset error state when user navigates to a different tab
  componentDidUpdate(prevProps) {
    if (prevProps.resetKey !== this.props.resetKey && this.state.hasError) {
      this.setState({ hasError: false, error: null });
    }
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div
          className="glass-card"
          style={{
            padding: "2.5rem 2rem",
            textAlign: "center",
            maxWidth: "500px",
            margin: "2rem auto",
            border: "1px solid rgba(248, 113, 113, 0.15)",
          }}
          role="alert"
        >
          <div style={{ fontSize: "2.5rem", marginBottom: "0.75rem" }}>
            &#x26A0;&#xFE0F;
          </div>
          <h3
            style={{
              color: "var(--text-primary)",
              fontSize: "1.1rem",
              marginBottom: "0.5rem",
              fontFamily: "'Outfit', sans-serif",
            }}
          >
            Something went wrong
          </h3>
          <p
            style={{
              color: "var(--text-secondary)",
              fontSize: "0.85rem",
              lineHeight: 1.5,
              marginBottom: "1.25rem",
            }}
          >
            This section encountered an error. Your data is safe — try again or
            switch to another tab.
          </p>
          {this.state.error && (
            <details
              style={{
                textAlign: "left",
                marginBottom: "1.25rem",
                padding: "0.75rem",
                background: "rgba(0, 0, 0, 0.3)",
                borderRadius: "8px",
              }}
            >
              <summary
                style={{
                  color: "var(--text-muted)",
                  cursor: "pointer",
                  fontSize: "0.75rem",
                }}
              >
                Error details
              </summary>
              <pre
                style={{
                  color: "var(--accent-red)",
                  fontSize: "0.7rem",
                  marginTop: "0.5rem",
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                  maxHeight: "120px",
                  overflow: "auto",
                }}
              >
                {this.state.error.toString()}
              </pre>
            </details>
          )}
          <button
            className="btn-primary"
            onClick={this.handleRetry}
            style={{ padding: "0.6rem 1.5rem" }}
          >
            Try Again
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
