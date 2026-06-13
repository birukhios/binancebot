import { createFileRoute } from "@tanstack/react-router";

import { auth } from "@/lib/auth";

function rewriteAuthRequest(request: Request) {
  const url = new URL(request.url);
  url.pathname = url.pathname.replace(/^\/auth\/api\/auth/, "/api/auth");
  return new Request(url, request);
}

export const Route = createFileRoute("/auth/api/auth/$")({
  server: {
    handlers: {
      GET: async ({ request }: { request: Request }) => auth.handler(rewriteAuthRequest(request)),
      POST: async ({ request }: { request: Request }) => auth.handler(rewriteAuthRequest(request)),
    },
  },
});
