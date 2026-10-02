"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAccount, useSignMessage } from "wagmi";
import {
  createSession,
  endSession,
  getGetMeQueryKey,
  linkWallet as linkWalletRequest,
  resumeSession,
  setAuthTokenGetter,
  unlinkWallet as unlinkWalletRequest,
  useGetMe,
  type GuestUser,
} from "@workspace/api-client-react";
import { isUnauthorized } from "@/lib/api-error";

const STORAGE_KEY = "citrine.session";

let currentToken: string | null = null;

function loadToken(): string | null {
  if (typeof window === "undefined") return null;
  currentToken = window.localStorage.getItem(STORAGE_KEY);
  return currentToken;
}

function storeToken(token: string | null) {
  currentToken = token;
  if (typeof window === "undefined") return;
  if (token) window.localStorage.setItem(STORAGE_KEY, token);
  else window.localStorage.removeItem(STORAGE_KEY);
}

setAuthTokenGetter(() => currentToken);

/** The exact message the API expects when linking a wallet. */
export function walletLinkMessage(username: string, address: string, issuedAt: string): string {
  return ["Citrine wallet link", `Guest: @${username}`, `Wallet: ${address}`, `Issued: ${issuedAt}`].join("\n");
}

/** The exact message the API expects when entering as a guest that has a linked wallet. */
export function guestSignInMessage(username: string, address: string, issuedAt: string): string {
  return ["Citrine guest sign-in", `Guest: @${username}`, `Wallet: ${address}`, `Issued: ${issuedAt}`].join("\n");
}

interface SessionContextValue {
  /** False until the stored session has been checked. */
  ready: boolean;
  user: GuestUser | null;
  enter: (username: string) => Promise<GuestUser>;
  /**
   * Opens a session for a guest that already exists. Pass the guest's linked wallet, if it has
   * one; the connected wallet must be that wallet and signs a sign-in message.
   */
  resume: (username: string, linkedWallet: string | null) => Promise<GuestUser>;
  signOut: () => Promise<void>;
  /** Signs a message with the connected wallet and links it to the guest. */
  linkWallet: () => Promise<GuestUser>;
  unlinkWallet: () => Promise<GuestUser>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const { address } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [token, setToken] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    setToken(loadToken());
    setLoaded(true);
  }, []);

  const me = useGetMe({ query: { queryKey: getGetMeQueryKey(), enabled: loaded && !!token, retry: false, staleTime: 60_000 } });

  useEffect(() => {
    if (me.error && isUnauthorized(me.error)) {
      storeToken(null);
      setToken(null);
      queryClient.removeQueries({ queryKey: getGetMeQueryKey() });
    }
  }, [me.error, queryClient]);

  const user = token ? (me.data ?? null) : null;
  const ready = loaded && (!token || !me.isLoading);

  const enter = useCallback(
    async (username: string) => {
      const session = await createSession({ username });
      storeToken(session.token);
      setToken(session.token);
      queryClient.setQueryData(getGetMeQueryKey(), session.user);
      return session.user;
    },
    [queryClient],
  );

  const resume = useCallback(
    async (username: string, linkedWallet: string | null) => {
      let proof = {};
      if (linkedWallet) {
        if (!address) throw new Error("Connect the wallet linked to this guest first.");
        if (address.toLowerCase() !== linkedWallet.toLowerCase()) throw new Error("Switch to the wallet linked to this guest.");
        const message = guestSignInMessage(username, address, new Date().toISOString());
        const signature = await signMessageAsync({ message });
        proof = { address, message, signature };
      }
      const session = await resumeSession({ username, ...proof });
      storeToken(session.token);
      setToken(session.token);
      queryClient.setQueryData(getGetMeQueryKey(), session.user);
      return session.user;
    },
    [address, signMessageAsync, queryClient],
  );

  const signOut = useCallback(async () => {
    try {
      if (currentToken) await endSession();
    } finally {
      storeToken(null);
      setToken(null);
      queryClient.removeQueries({ queryKey: getGetMeQueryKey() });
    }
  }, [queryClient]);

  const linkWallet = useCallback(async () => {
    if (!user) throw new Error("Enter as a guest first.");
    if (!address) throw new Error("Connect a wallet first.");
    const message = walletLinkMessage(user.username, address, new Date().toISOString());
    const signature = await signMessageAsync({ message });
    const updated = await linkWalletRequest({ address, message, signature });
    queryClient.setQueryData(getGetMeQueryKey(), updated);
    return updated;
  }, [user, address, signMessageAsync, queryClient]);

  const unlinkWallet = useCallback(async () => {
    const updated = await unlinkWalletRequest();
    queryClient.setQueryData(getGetMeQueryKey(), updated);
    return updated;
  }, [queryClient]);

  const value = useMemo<SessionContextValue>(
    () => ({ ready, user, enter, resume, signOut, linkWallet, unlinkWallet }),
    [ready, user, enter, resume, signOut, linkWallet, unlinkWallet],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error("useSession must be used inside SessionProvider");
  return value;
}
