import { RouterProvider } from "@tanstack/react-router";
import { StrictMode, startTransition } from "react";
import { createRoot } from "react-dom/client";

import { getRouter } from "./router";

const router = getRouter();

startTransition(() => {
  createRoot(document).render(
    <StrictMode>
      <RouterProvider router={router} />
    </StrictMode>,
  );
});
