import {
  compressToEncodedURIComponent,
  compressToUint8Array,
  decompressFromEncodedURIComponent,
  decompressFromUint8Array,
} from "lz-string";

export type SyncWireMessage = {
  type: string;
  [key: string]: unknown;
};

export type SyncOfferPayload = {
  kind: "qwixx-sync-offer";
  version: 1;
  roomId: string;
  offerId: string;
  hostPlayerId: string;
  hostName: string;
  sdp: RTCSessionDescriptionInit;
};

export type SyncAnswerPayload = {
  kind: "qwixx-sync-answer";
  version: 1;
  roomId: string;
  offerId: string;
  playerId: string;
  playerName: string;
  sdp: RTCSessionDescriptionInit;
};

type PendingOffer = {
  channel: RTCDataChannel;
  peerConnection: RTCPeerConnection;
};

type HostPeer = {
  channel: RTCDataChannel;
  peerConnection: RTCPeerConnection;
  playerName: string;
};

type SyncTransportCallbacks = {
  onPeerClosed?: (playerId: string) => void;
  onPeerOpen?: (playerId: string) => void;
  onMessage?: (playerId: string, message: SyncWireMessage) => void;
};

const CHANNEL_NAME = "qwixx";
const ICE_TIMEOUT_MS = 1800;
const COMPACT_OFFER_PREFIX = "QWO:";
const COMPACT_ANSWER_PREFIX = "QWA:";
const QR_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:";

function createPeerConnection() {
  return new RTCPeerConnection({ iceServers: [] });
}

function waitForIceGathering(peerConnection: RTCPeerConnection) {
  if (peerConnection.iceGatheringState === "complete") {
    return Promise.resolve();
  }

  return new Promise<void>((resolve) => {
    const timeout = window.setTimeout(done, ICE_TIMEOUT_MS);

    function done() {
      window.clearTimeout(timeout);
      peerConnection.removeEventListener("icegatheringstatechange", handleChange);
      resolve();
    }

    function handleChange() {
      if (peerConnection.iceGatheringState === "complete") {
        done();
      }
    }

    peerConnection.addEventListener("icegatheringstatechange", handleChange);
  });
}

function waitForChannelOpen(channel: RTCDataChannel) {
  if (channel.readyState === "open") {
    return Promise.resolve();
  }

  return new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      cleanup();
      reject(new Error("Connection did not open."));
    }, 6000);

    function cleanup() {
      window.clearTimeout(timeout);
      channel.removeEventListener("open", handleOpen);
      channel.removeEventListener("close", handleClose);
      channel.removeEventListener("error", handleClose);
    }

    function handleOpen() {
      cleanup();
      resolve();
    }

    function handleClose() {
      cleanup();
      reject(new Error("Connection closed before opening."));
    }

    channel.addEventListener("open", handleOpen);
    channel.addEventListener("close", handleClose);
    channel.addEventListener("error", handleClose);
  });
}

function encodeBase45(bytes: Uint8Array) {
  let encoded = "";

  for (let index = 0; index < bytes.length; index += 2) {
    if (index + 1 >= bytes.length) {
      const value = bytes[index];

      encoded += QR_ALPHABET[value % 45];
      encoded += QR_ALPHABET[Math.floor(value / 45)];
      continue;
    }

    const value = bytes[index] * 256 + bytes[index + 1];

    encoded += QR_ALPHABET[value % 45];
    encoded += QR_ALPHABET[Math.floor(value / 45) % 45];
    encoded += QR_ALPHABET[Math.floor(value / 2025)];
  }

  return encoded;
}

function decodeBase45(value: string) {
  const bytes: number[] = [];

  for (let index = 0; index < value.length; ) {
    const remaining = value.length - index;

    if (remaining === 1) {
      return null;
    }

    if (remaining === 2) {
      const first = QR_ALPHABET.indexOf(value[index]);
      const second = QR_ALPHABET.indexOf(value[index + 1]);

      if (first < 0 || second < 0) {
        return null;
      }

      const byte = first + second * 45;

      if (byte > 255) {
        return null;
      }

      bytes.push(byte);
      index += 2;
      continue;
    }

    const first = QR_ALPHABET.indexOf(value[index]);
    const second = QR_ALPHABET.indexOf(value[index + 1]);
    const third = QR_ALPHABET.indexOf(value[index + 2]);

    if (first < 0 || second < 0 || third < 0) {
      return null;
    }

    const pair = first + second * 45 + third * 2025;

    if (pair > 65535) {
      return null;
    }

    bytes.push(Math.floor(pair / 256), pair % 256);
    index += 3;
  }

  return new Uint8Array(bytes);
}

function encodeCompactPayload(prefix: string, fields: string[]) {
  return `${prefix}${encodeBase45(compressToUint8Array(JSON.stringify(fields)))}`;
}

function parseCompactPayload(value: string) {
  const isOffer = value.startsWith(COMPACT_OFFER_PREFIX);
  const isAnswer = value.startsWith(COMPACT_ANSWER_PREFIX);

  if (!isOffer && !isAnswer) {
    return null;
  }

  const bytes = decodeBase45(value.slice(COMPACT_OFFER_PREFIX.length));
  const decompressed = bytes ? decompressFromUint8Array(bytes) : null;
  const fields = decompressed ? (JSON.parse(decompressed) as unknown) : null;

  if (!Array.isArray(fields) || fields.some((field) => typeof field !== "string")) {
    return null;
  }

  if (isOffer && fields.length === 5) {
    const [roomId, offerId, hostPlayerId, hostName, sdp] = fields;

    return {
      kind: "qwixx-sync-offer",
      version: 1,
      roomId,
      offerId,
      hostPlayerId,
      hostName,
      sdp: { type: "offer", sdp },
    } satisfies SyncOfferPayload;
  }

  if (isAnswer && fields.length === 5) {
    const [roomId, offerId, playerId, playerName, sdp] = fields;

    return {
      kind: "qwixx-sync-answer",
      version: 1,
      roomId,
      offerId,
      playerId,
      playerName,
      sdp: { type: "answer", sdp },
    } satisfies SyncAnswerPayload;
  }

  return null;
}

function parsePayload(value: string) {
  try {
    const compactPayload = parseCompactPayload(value);

    if (compactPayload) {
      return compactPayload;
    }

    if (value.startsWith("qwixx:")) {
      const decompressed = decompressFromEncodedURIComponent(value.slice(6));
      return decompressed ? (JSON.parse(decompressed) as unknown) : null;
    }

    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function encodePayload(value: SyncOfferPayload | SyncAnswerPayload) {
  if (value.kind === "qwixx-sync-offer") {
    return encodeCompactPayload(COMPACT_OFFER_PREFIX, [
      value.roomId,
      value.offerId,
      value.hostPlayerId,
      value.hostName,
      typeof value.sdp.sdp === "string" ? value.sdp.sdp : "",
    ]);
  }

  return encodeCompactPayload(COMPACT_ANSWER_PREFIX, [
    value.roomId,
    value.offerId,
    value.playerId,
    value.playerName,
    typeof value.sdp.sdp === "string" ? value.sdp.sdp : "",
  ]);
}

function isOfferPayload(value: unknown): value is SyncOfferPayload {
  const payload = value as Partial<SyncOfferPayload>;
  return (
    Boolean(payload) &&
    payload.kind === "qwixx-sync-offer" &&
    payload.version === 1 &&
    typeof payload.roomId === "string" &&
    typeof payload.offerId === "string" &&
    typeof payload.hostPlayerId === "string" &&
    typeof payload.hostName === "string" &&
    Boolean(payload.sdp)
  );
}

function isAnswerPayload(value: unknown): value is SyncAnswerPayload {
  const payload = value as Partial<SyncAnswerPayload>;
  return (
    Boolean(payload) &&
    payload.kind === "qwixx-sync-answer" &&
    payload.version === 1 &&
    typeof payload.roomId === "string" &&
    typeof payload.offerId === "string" &&
    typeof payload.playerId === "string" &&
    typeof payload.playerName === "string" &&
    Boolean(payload.sdp)
  );
}

function attachMessageHandler(
  channel: RTCDataChannel,
  playerId: string,
  callbacks: SyncTransportCallbacks,
) {
  channel.addEventListener("message", (event) => {
    if (typeof event.data !== "string") {
      return;
    }

    const message = parsePayload(event.data);
    if (!message || typeof message !== "object" || typeof (message as SyncWireMessage).type !== "string") {
      return;
    }

    callbacks.onMessage?.(playerId, message as SyncWireMessage);
  });
}

function sendChannelMessage(channel: RTCDataChannel, message: SyncWireMessage) {
  if (channel.readyState !== "open") {
    return;
  }

  channel.send(JSON.stringify(message));
}

export function parseSyncOffer(value: string) {
  const payload = parsePayload(value);
  return isOfferPayload(payload) ? payload : null;
}

export function parseSyncAnswer(value: string) {
  const payload = parsePayload(value);
  return isAnswerPayload(payload) ? payload : null;
}

export class SyncHostTransport {
  private callbacks: SyncTransportCallbacks;
  private pendingOffers = new Map<string, PendingOffer>();
  private peers = new Map<string, HostPeer>();
  private roomId: string;
  private hostPlayerId: string;
  private hostName: string;

  constructor({
    callbacks,
    hostName,
    hostPlayerId,
    roomId,
  }: {
    callbacks: SyncTransportCallbacks;
    hostName: string;
    hostPlayerId: string;
    roomId: string;
  }) {
    this.callbacks = callbacks;
    this.hostName = hostName;
    this.hostPlayerId = hostPlayerId;
    this.roomId = roomId;
  }

  async createOffer() {
    const offerId = crypto.randomUUID();
    const peerConnection = createPeerConnection();
    const channel = peerConnection.createDataChannel(CHANNEL_NAME);

    this.pendingOffers.set(offerId, { channel, peerConnection });
    peerConnection.addEventListener("connectionstatechange", () => {
      if (peerConnection.connectionState === "closed" || peerConnection.connectionState === "failed") {
        this.closePendingOffer(offerId);
      }
    });

    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    await waitForIceGathering(peerConnection);

    const payload: SyncOfferPayload = {
      kind: "qwixx-sync-offer",
      version: 1,
      roomId: this.roomId,
      offerId,
      hostPlayerId: this.hostPlayerId,
      hostName: this.hostName,
      sdp: peerConnection.localDescription?.toJSON() ?? offer,
    };

    return encodePayload(payload);
  }

  async acceptAnswer(value: string) {
    const answer = parseSyncAnswer(value);

    if (!answer || answer.roomId !== this.roomId) {
      throw new Error("this is not an answer QR for this room.");
    }

    const pending = this.pendingOffers.get(answer.offerId);

    if (!pending) {
      throw new Error("this answer does not match the current host QR.");
    }

    this.pendingOffers.delete(answer.offerId);
    this.peers.set(answer.playerId, {
      channel: pending.channel,
      peerConnection: pending.peerConnection,
      playerName: answer.playerName,
    });

    attachMessageHandler(pending.channel, answer.playerId, this.callbacks);
    pending.channel.addEventListener("open", () => this.callbacks.onPeerOpen?.(answer.playerId));
    pending.channel.addEventListener("close", () => this.callbacks.onPeerClosed?.(answer.playerId));
    pending.peerConnection.addEventListener("connectionstatechange", () => {
      if (
        pending.peerConnection.connectionState === "closed" ||
        pending.peerConnection.connectionState === "failed" ||
        pending.peerConnection.connectionState === "disconnected"
      ) {
        this.callbacks.onPeerClosed?.(answer.playerId);
      }
    });

    await pending.peerConnection.setRemoteDescription(answer.sdp);
    await waitForChannelOpen(pending.channel);

    return {
      id: answer.playerId,
      name: answer.playerName,
    };
  }

  broadcast(message: SyncWireMessage) {
    this.peers.forEach((peer) => sendChannelMessage(peer.channel, message));
  }

  removePeer(playerId: string) {
    const peer = this.peers.get(playerId);

    if (!peer) {
      return;
    }

    peer.channel.close();
    peer.peerConnection.close();
    this.peers.delete(playerId);
  }

  close() {
    this.pendingOffers.forEach((pending) => {
      pending.channel.close();
      pending.peerConnection.close();
    });
    this.pendingOffers.clear();

    this.peers.forEach((peer) => {
      peer.channel.close();
      peer.peerConnection.close();
    });
    this.peers.clear();
  }

  private closePendingOffer(offerId: string) {
    const pending = this.pendingOffers.get(offerId);

    if (!pending) {
      return;
    }

    pending.channel.close();
    pending.peerConnection.close();
    this.pendingOffers.delete(offerId);
  }
}

export class SyncJoinTransport {
  private callbacks: Omit<SyncTransportCallbacks, "onPeerClosed" | "onPeerOpen"> & {
    onClosed?: () => void;
    onOpen?: () => void;
  };
  private channel: RTCDataChannel | null = null;
  private peerConnection: RTCPeerConnection | null = null;

  constructor(callbacks: Omit<SyncTransportCallbacks, "onPeerClosed" | "onPeerOpen"> & {
    onClosed?: () => void;
    onOpen?: () => void;
  }) {
    this.callbacks = callbacks;
  }

  async createAnswer(value: string, player: { id: string; name: string }) {
    const offer = parseSyncOffer(value);

    if (!offer) {
      throw new Error("this is not a Qwixx host QR.");
    }

    const peerConnection = createPeerConnection();
    this.peerConnection = peerConnection;

    peerConnection.addEventListener("datachannel", (event) => {
      this.channel = event.channel;
      attachMessageHandler(event.channel, offer.hostPlayerId, this.callbacks);
      event.channel.addEventListener("open", () => {
        this.callbacks.onOpen?.();
        this.send({ type: "join", playerId: player.id, playerName: player.name });
      });
      event.channel.addEventListener("close", () => this.callbacks.onClosed?.());
    });
    peerConnection.addEventListener("connectionstatechange", () => {
      if (
        peerConnection.connectionState === "closed" ||
        peerConnection.connectionState === "failed" ||
        peerConnection.connectionState === "disconnected"
      ) {
        this.callbacks.onClosed?.();
      }
    });

    await peerConnection.setRemoteDescription(offer.sdp);
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);
    await waitForIceGathering(peerConnection);

    const payload: SyncAnswerPayload = {
      kind: "qwixx-sync-answer",
      version: 1,
      roomId: offer.roomId,
      offerId: offer.offerId,
      playerId: player.id,
      playerName: player.name,
      sdp: peerConnection.localDescription?.toJSON() ?? answer,
    };

    return {
      answerText: encodePayload(payload),
      hostName: offer.hostName,
      hostPlayerId: offer.hostPlayerId,
      roomId: offer.roomId,
    };
  }

  send(message: SyncWireMessage) {
    if (!this.channel) {
      return;
    }

    sendChannelMessage(this.channel, message);
  }

  close() {
    this.channel?.close();
    this.peerConnection?.close();
    this.channel = null;
    this.peerConnection = null;
  }
}
