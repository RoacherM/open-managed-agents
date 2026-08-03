import { createContext, useContext, type ReactNode } from "react";
import { authClient } from "./auth-client";
import { useApiQuery } from "./useApiQuery";

interface User {
  id: string;
  name: string;
  email: string;
  image?: string | null;
}

interface AuthCtx {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
}

const AuthContext = createContext<AuthCtx>({
  user: null,
  isLoading: true,
  isAuthenticated: false,
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const { data: session, isPending } = authClient.useSession();
  const { data: authInfo, isLoading: isAuthInfoLoading } = useApiQuery<{
    auth_disabled: boolean;
  }>("/auth-info");

  const user = authInfo?.auth_disabled
    ? {
        id: "default",
        name: "Default User",
        email: "default@local",
        image: null,
      }
    : session?.user
    ? {
        id: session.user.id,
        name: session.user.name,
        email: session.user.email,
        image: session.user.image,
      }
    : null;

  return (
    <AuthContext.Provider
      value={{
        user,
        // Only "loading" when we have no user yet. Background session
        // revalidations (focus/network/timer) flip isPending back to
        // true momentarily even with a valid session — without this
        // guard, Layout briefly returns the BrandLoader, the sidebar
        // unmounts, and any click landing in that 50-200ms window gets
        // lost (the link's <a> tag is mid-unmount, React Router never
        // sees the navigation). Symptom: random "click does nothing,
        // refresh fixes it".
        isLoading: isAuthInfoLoading || (isPending && !user),
        isAuthenticated: !!user,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
