import { createRoot } from "react-dom/client";
import { ImmersiveReef } from "./ImmersiveReef";
import { ErrorBoundary } from "../components/ErrorBoundary";

const root = createRoot(document.getElementById("reef-root"));
root.render(
  <ErrorBoundary>
    <ImmersiveReef />
  </ErrorBoundary>
);
