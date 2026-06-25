import { compressToEncodedURIComponent, decompressFromEncodedURIComponent } from "lz-string";

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

function parsePayload(value: string) {
  try {
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
  return `qwixx:${compressToEncodedURIComponent(JSON.stringify(value))}`;
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
      throw new Error("That QR code is not an answer for this room.");
    }

    const pending = this.pendingOffers.get(answer.offerId);

    if (!pending) {
      throw new Error("That answer does not match the current host QR.");
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

    return {
      id: answer.playerId,
      name: answer.playerName,
    };
  }

  broadcast(message: SyncWireMessage) {
    this.peers.forEach((peer) => sendChannelMessage(peer.channel, message));
  }

  sendTo(playerId: string, message: SyncWireMessage) {
    const peer = this.peers.get(playerId);

    if (!peer) {
      return;
    }

    sendChannelMessage(peer.channel, message);
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
      throw new Error("That QR code is not a Qwixx host offer.");
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
