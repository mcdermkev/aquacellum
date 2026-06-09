import React from "react";
import { createRoot } from "react-dom/client";
import { ImmersiveReef } from "./ImmersiveReef";

const root = createRoot(document.getElementById("reef-root"));
root.render(<ImmersiveReef />);
