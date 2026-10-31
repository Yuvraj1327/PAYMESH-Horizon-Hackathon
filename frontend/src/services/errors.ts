/** Thrown by live-mode service branches until the backend integration for that capability exists. */
export class BackendNotConnectedError extends Error {
  constructor(what: string) {
    super(`${what} is not available yet: backend integration for this feature ships in a later step. Unset NEXT_PUBLIC_API_BASE_URL to use demo data.`);
    this.name = "BackendNotConnectedError";
  }
}

export class NotFoundError extends Error {
  constructor(what: string) {
    super(`${what} was not found.`);
    this.name = "NotFoundError";
  }
}

export const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
