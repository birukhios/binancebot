import { createMiddleware } from "@tanstack/react-start";
import { getRequestHeaders } from "@tanstack/react-start/server";
import { auth } from "@/lib/auth";

export const requireAuth = createMiddleware({ type: "function" }).server(async ({ next }) => {
  const session = await auth.api.getSession({
    headers: getRequestHeaders(),
  });

  if (!session?.user?.id) {
    throw new Error("Unauthorized: Sign in required");
  }

  return next({
    context: {
      userId: session.user.id,
      user: session.user,
    },
  });
});
