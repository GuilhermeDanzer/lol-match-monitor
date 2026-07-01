/**
 * Cliente HTTP para a mini-API do Worker (setup-UI).
 *
 * Aponta para `NEXT_PUBLIC_API_URL`. Em dev local:
 *   NEXT_PUBLIC_API_URL=http://localhost:4000
 */

const API_URL = process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") ?? "";

export interface WhatsAppStatus {
  connected: boolean;
  qr?: string;
}

export interface WhatsAppGroup {
  id: string;
  name: string;
}

async function jsonOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}

export async function fetchWhatsAppStatus(
  userId: string,
  signal?: AbortSignal,
): Promise<WhatsAppStatus> {
  const res = await fetch(
    `${API_URL}/api/whatsapp/${encodeURIComponent(userId)}/status`,
    { signal, cache: "no-store" },
  );
  return jsonOrThrow<WhatsAppStatus>(res);
}

export async function fetchWhatsAppGroups(
  userId: string,
  signal?: AbortSignal,
): Promise<WhatsAppGroup[]> {
  const res = await fetch(
    `${API_URL}/api/whatsapp/${encodeURIComponent(userId)}/groups`,
    { signal, cache: "no-store" },
  );
  const data = await jsonOrThrow<{ groups: WhatsAppGroup[] }>(res);
  return data.groups;
}

export interface CreateSubscriptionInput {
  userId: string;
  riotId: string;
  whatsappGroupId: string;
}

export interface CreatedSubscription {
  subscription: {
    id: string;
    userId: string;
    whatsappGroupId: string;
  };
  trackedPlayer: {
    id: string;
    riotId: string;
    puuid: string;
  };
}

export async function createSubscription(
  input: CreateSubscriptionInput,
): Promise<CreatedSubscription> {
  const res = await fetch(`${API_URL}/api/subscriptions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return jsonOrThrow<CreatedSubscription>(res);
}

export interface SubscriptionListItem {
  id: string;
  whatsappGroupId: string;
  groupName: string | null;
  riotId: string;
  trackedPlayerId: string;
  createdAt: string;
}

export async function listSubscriptions(
  userId: string,
  signal?: AbortSignal,
): Promise<SubscriptionListItem[]> {
  const res = await fetch(
    `${API_URL}/api/subscriptions/${encodeURIComponent(userId)}`,
    { signal, cache: "no-store" },
  );
  const data = await jsonOrThrow<{ subscriptions: SubscriptionListItem[] }>(
    res,
  );
  return data.subscriptions;
}

export interface SendTestMessageInput {
  userId: string;
  whatsappGroupId: string;
  message?: string;
}

export async function sendTestMessage(
  input: SendTestMessageInput,
): Promise<{ ok: true; sentAt: string }> {
  const res = await fetch(
    `${API_URL}/api/whatsapp/${encodeURIComponent(input.userId)}/test`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        whatsappGroupId: input.whatsappGroupId,
        message: input.message,
      }),
    },
  );
  return jsonOrThrow<{ ok: true; sentAt: string }>(res);
}

export async function resetWhatsAppSession(
  userId: string,
): Promise<{ ok: true; resetAt: string }> {
  const res = await fetch(
    `${API_URL}/api/whatsapp/${encodeURIComponent(userId)}/reset`,
    { method: "POST" },
  );
  return jsonOrThrow<{ ok: true; resetAt: string }>(res);
}
