type WebSocketPayload = string | ArrayBufferLike | Blob | ArrayBufferView;

export interface ReconnectingWebSocketOptions {
  initialDelayMs?: number;
  maxDelayMs?: number;
  maxQueuedMessages?: number;
}

class ReconnectingWebSocketClient {
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;

  private socket: WebSocket | null = null;
  private reconnectTimer: number | null = null;
  private manuallyClosed = false;
  private reconnectAttempt = 0;
  private readonly pendingMessages: WebSocketPayload[] = [];

  constructor(
    private readonly url: string,
    private readonly protocols?: string | string[],
    private readonly options: ReconnectingWebSocketOptions = {},
  ) {
    this.connect();
  }

  get readyState() {
    return this.socket?.readyState ?? WebSocket.CONNECTING;
  }

  get bufferedAmount() {
    return this.socket?.bufferedAmount ?? 0;
  }

  get extensions() {
    return this.socket?.extensions ?? "";
  }

  get protocol() {
    return this.socket?.protocol ?? "";
  }

  get binaryType() {
    return this.socket?.binaryType ?? "blob";
  }

  set binaryType(value: BinaryType) {
    if (this.socket) this.socket.binaryType = value;
  }

  send(data: WebSocketPayload) {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(data);
      return;
    }

    const maxQueuedMessages = this.options.maxQueuedMessages ?? 100;
    if (this.pendingMessages.length >= maxQueuedMessages) {
      this.pendingMessages.shift();
    }
    this.pendingMessages.push(data);
  }

  close(code?: number, reason?: string) {
    this.manuallyClosed = true;
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.socket?.close(code, reason);
  }

  private connect() {
    if (this.manuallyClosed) return;

    const socket = this.protocols
      ? new WebSocket(this.url, this.protocols)
      : new WebSocket(this.url);
    this.socket = socket;

    socket.onopen = (event) => {
      this.reconnectAttempt = 0;

      // MOBILE_CALL_DELIVERY_FIX: authenticate first.
      // SocialBIRD's onopen handler sends AUTH. Queued CALL_ACCEPT/CALL_ANSWER/ICE
      // must never be flushed before that AUTH frame, otherwise the server ignores
      // them because ws.userId has not been established yet.
      this.onopen?.(event);

      while (this.pendingMessages.length > 0 && socket.readyState === WebSocket.OPEN) {
        socket.send(this.pendingMessages.shift() as WebSocketPayload);
      }
    };

    socket.onmessage = (event) => this.onmessage?.(event);
    socket.onerror = (event) => this.onerror?.(event);
    socket.onclose = (event) => {
      this.onclose?.(event);
      if (!this.manuallyClosed) this.scheduleReconnect();
    };
  }

  private scheduleReconnect() {
    if (this.reconnectTimer !== null || this.manuallyClosed) return;

    const initialDelay = this.options.initialDelayMs ?? 1000;
    const maxDelayMs = this.options.maxDelayMs ?? 30000;
    const exponentialDelay = Math.min(
      maxDelayMs,
      initialDelay * 2 ** Math.min(this.reconnectAttempt, 6),
    );
    const jitter = Math.floor(Math.random() * Math.min(1000, exponentialDelay / 4));
    this.reconnectAttempt += 1;

    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, exponentialDelay + jitter);
  }
}

export const createReconnectingWebSocket = (
  url: string,
  protocols?: string | string[],
  options?: ReconnectingWebSocketOptions,
) => new ReconnectingWebSocketClient(url, protocols, options) as unknown as WebSocket;
