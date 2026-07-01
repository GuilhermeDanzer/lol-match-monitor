import { withAuth } from "next-auth/middleware";

/**
 * Proxy (antigo `middleware.ts` — renomeado no Next.js 16).
 *
 * Protege todas as rotas `/dashboard/*` via NextAuth — exceto
 * `/dashboard/setup`, que é o wizard de onboarding do MVP e usa userId
 * mockado.
 */
export default withAuth({
  pages: { signIn: "/login" },
});

export const config = {
  matcher: ["/dashboard/((?!setup).*)"],
};
