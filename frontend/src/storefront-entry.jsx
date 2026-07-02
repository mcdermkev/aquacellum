/**
 * storefront-entry.jsx — Entry point for the standalone storefront page (store.html).
 * Renders the StorefrontPage component into the #storefront-root div.
 * This is a lightweight entry that doesn't load the full app shell.
 */
import React from "react";
import ReactDOM from "react-dom/client";
import { StorefrontPage } from "./components/storefront/StorefrontPage";
import { ErrorBoundary } from "./components/ErrorBoundary";
import "./styles/storefront.css";

ReactDOM.createRoot(document.getElementById("storefront-root")).render(
  <React.StrictMode>
    <ErrorBoundary>
      <StorefrontPage />
    </ErrorBoundary>
  </React.StrictMode>
);
