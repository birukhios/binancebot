import { createFileRoute } from "@tanstack/react-router";

import { auth } from "@/lib/auth";

function withoutSessionDataCookie(headers: Headers) {
  const nextHeaders = new Headers(headers);
  const cookie = nextHeaders.get("cookie");
  if (!cookie) return nextHeaders;

  const filtered = cookie
    .split(";")
    .map((part) => part.trim())
    .filter((part) => !/^(__Secure-)?better-auth\.session_data(?:\.\d+)?=/.test(part))
    .join("; ");

  if (filtered) nextHeaders.set("cookie", filtered);
  else nextHeaders.delete("cookie");

  return nextHeaders;
}

function sessionDataClearHeaders() {
  return [
    "better-auth.session_data=; Max-Age=0; Path=/; SameSite=Lax; HttpOnly",
  ];
}

function sessionResponse(data: unknown, clearSessionData = false) {
  const headers = new Headers({ "content-type": "application/json" });
  if (clearSessionData) {
    for (const cookie of sessionDataClearHeaders()) headers.append("set-cookie", cookie);
  }

  return new Response(JSON.stringify(data), { headers });
}

export const Route = createFileRoute("/api/session")({
  server: {
    handlers: {
      GET: async ({ request }: { request: Request }) => {
        try {
          const session = await auth.api.getSession({
            headers: request.headers,
          });

          return sessionResponse(session);
        } catch {
          const session = await auth.api.getSession({
            headers: withoutSessionDataCookie(request.headers),
          });

          return sessionResponse(session, true);
        }
      },
    },
  },
});
