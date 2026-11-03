import { useCallback, useEffect, useRef, useState } from 'react';
import { Peer, type DataConnection, type PeerOptions } from 'peerjs';
import type { RoomMessage, RoomMember } from './match';

export type RoomRole = 'host' | 'guest' | null;
export type RoomStatus = 'idle' | 'connecting' | 'waiting' | 'connected' | 'disconnected' | 'error';
type Connection = { channel: DataConnection; seat: number; token: string; lastSeen: number };
type Welcome = { type: 'welcome'; seat: number; capacity: number; members: RoomMember[] };

function peerOptions(): PeerOptions {
  const options: PeerOptions = {};
  if (import.meta.env.VITE_PEER_HOST) Object.assign(options, {
    host: import.meta.env.VITE_PEER_HOST, port: Number(import.meta.env.VITE_PEER_PORT || 443),
    path: import.meta.env.VITE_PEER_PATH || '/', secure: import.meta.env.VITE_PEER_SECURE !== 'false',
  });
  if (import.meta.env.VITE_TURN_URL) options.config = { iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: import.meta.env.VITE_TURN_URL, username: import.meta.env.VITE_TURN_USERNAME || '', credential: import.meta.env.VITE_TURN_CREDENTIAL || '' },
  ] };
  return options;
}

export function roomIdFromLink(raw: string): string | null {
  const text = raw.trim();
  try {
    const id = new URL(text, window.location.href).searchParams.get('room');
    if (id && /^[\w-]{1,80}$/.test(id)) return id;
  } catch { /* A bare room code is accepted too. */ }
  return /^[\w-]{1,80}$/.test(text) ? text : null;
}

export function usePeerRoom() {
  const [role, setRole] = useState<RoomRole>(null);
  const [status, setStatus] = useState<RoomStatus>('idle');
  const [message, setMessage] = useState('');
  const [invite, setInvite] = useState('');
  const [localSeat, setLocalSeat] = useState<number | null>(null);
  const [members, setMembers] = useState<RoomMember[]>([]);
  const [capacity, setCapacity] = useState(2);
  const peerRef = useRef<Peer | null>(null);
  const roleRef = useRef<RoomRole>(null);
  const capacityRef = useRef(2);
  const connections = useRef(new Map<number, Connection>());
  const reservations = useRef(new Map<string, number>());
  const handler = useRef<(payload: RoomMessage, fromSeat: number) => void>(() => {});
  const timeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cleanup = useCallback(() => {
    if (timeout.current) clearTimeout(timeout.current);
    const peer = peerRef.current;
    peerRef.current = null;
    connections.current.forEach(({ channel }) => channel.close());
    connections.current.clear();
    reservations.current.clear();
    peer?.destroy();
  }, []);

  const close = useCallback(() => {
    cleanup(); roleRef.current = null; setRole(null); setStatus('idle'); setMessage('');
    setInvite(''); setLocalSeat(null); setMembers([]);
  }, [cleanup]);

  useEffect(() => {
    const timer = setInterval(() => {
      connections.current.forEach((entry) => {
        if (Date.now() - entry.lastSeen > 90000) entry.channel.close();
        else if (entry.channel.open) entry.channel.send({ type: 'heartbeat' });
      });
    }, 5000);
    window.addEventListener('pagehide', cleanup);
    return () => { clearInterval(timer); window.removeEventListener('pagehide', cleanup); cleanup(); };
  }, [cleanup]);

  const publishMembers = useCallback(() => {
    const list = Array.from({ length: capacityRef.current }, (_, seat) => ({
      seat, connected: seat === 0 || !!connections.current.get(seat)?.channel.open,
      reserved: seat === 0 || [...reservations.current.values()].includes(seat),
    }));
    setMembers(list);
    connections.current.forEach(({ channel, seat }) => {
      if (channel.open) channel.send({ type: 'welcome', seat, capacity: capacityRef.current, members: list } satisfies Welcome);
    });
    const count = list.filter((member) => member.connected).length;
    setStatus(count > 1 ? 'connected' : 'waiting');
    setMessage(`${count} / ${capacityRef.current} players connected. Each seat controls one civilization.`);
  }, []);

  const attach = useCallback((channel: DataConnection, peer: Peer, isHost: boolean) => {
    let seat = isHost ? -1 : 0;
    channel.on('open', () => {
      if (peerRef.current !== peer) { channel.close(); return; }
      if (isHost) {
        const metadata = channel.metadata as { token?: unknown } | undefined;
        const token = typeof metadata?.token === 'string' ? metadata.token.slice(0, 128) : channel.peer;
        const previousSeat = reservations.current.get(token);
        seat = previousSeat ?? Array.from({ length: capacityRef.current - 1 }, (_, i) => i + 1)
          .find((candidate) => ![...reservations.current.values()].includes(candidate)) ?? -1;
        if (seat < 0) {
          channel.send({ type: 'room-error', message: 'This room is full. Ask the host for a larger new room.' });
          setTimeout(() => channel.close(), 150);
          return;
        }
        reservations.current.set(token, seat);
        const old = connections.current.get(seat);
        connections.current.set(seat, { channel, seat, token, lastSeen: Date.now() });
        old?.channel.close();
        publishMembers();
      } else {
        connections.current.set(0, { channel, seat: 0, token: '', lastSeen: Date.now() });
        if (timeout.current) clearTimeout(timeout.current);
        setStatus('connected');
        setMessage('Connected to host. Synchronizing your civilization...');
      }
    });
    channel.on('data', (data: unknown) => {
      const entry = connections.current.get(seat);
      if (entry?.channel !== channel || !data || typeof data !== 'object' || !('type' in data)) return;
      entry.lastSeen = Date.now();
      if (data.type === 'heartbeat') return;
      if (!isHost && data.type === 'welcome') {
        const welcome = data as Welcome;
        if (Number.isInteger(welcome.seat) && welcome.seat > 0 && welcome.seat < 10
          && Array.isArray(welcome.members) && welcome.members.length <= 10) {
          setLocalSeat(welcome.seat); setCapacity(welcome.capacity); setMembers(welcome.members);
          setMessage(`Connected as player ${welcome.seat + 1}. Only your civilization can be commanded.`);
        }
        return;
      }
      if (!isHost && data.type === 'room-error') {
        setStatus('error'); setMessage(String((data as { message?: unknown }).message || 'Room unavailable.')); return;
      }
      handler.current(data as RoomMessage, isHost ? seat : 0);
    });
    channel.on('close', () => {
      if (peerRef.current !== peer || connections.current.get(seat)?.channel !== channel) return;
      connections.current.delete(seat);
      if (isHost) publishMembers();
      else { setStatus('disconnected'); setMessage('Host disconnected. Keep this page and rejoin the same room if the host is still online.'); }
    });
    channel.on('error', (error) => {
      if (peerRef.current !== peer) return;
      setMessage(`Connection error: ${error.message}. Try rejoining; strict networks may require TURN.`);
    });
  }, [publishMembers]);

  const makePeer = useCallback((nextRole: 'host' | 'guest') => {
    cleanup(); roleRef.current = nextRole; setRole(nextRole); setLocalSeat(nextRole === 'host' ? 0 : null);
    setMembers([]); setInvite(''); setStatus('connecting'); setMessage('Connecting to signaling service...');
    const peer = new Peer(peerOptions()); peerRef.current = peer;
    peer.on('error', (error) => {
      if (peerRef.current !== peer) return;
      setStatus('error'); setMessage(error.type === 'peer-unavailable'
        ? 'Room not found. The host must keep the room open.' : `Online connection failed: ${error.message}`);
    });
    peer.on('disconnected', () => {
      if (peerRef.current !== peer || [...connections.current.values()].some((c) => c.channel.open)) return;
      setStatus('disconnected'); setMessage('Lost signaling connection. Please create or join the room again.');
    });
    return peer;
  }, [cleanup]);

  const create = useCallback((count = 2) => {
    capacityRef.current = Math.max(2, Math.min(10, Math.round(count)));
    setCapacity(capacityRef.current);
    const peer = makePeer('host');
    peer.on('open', (id) => {
      if (peerRef.current !== peer) return;
      const url = new URL(window.location.href); url.search = ''; url.hash = ''; url.searchParams.set('room', id);
      setInvite(url.toString()); publishMembers();
    });
    peer.on('connection', (connection) => attach(connection, peer, true));
  }, [attach, makePeer, publishMembers]);

  const join = useCallback((raw: string) => {
    const id = roomIdFromLink(raw);
    if (!id) { setStatus('error'); setMessage('Paste a valid room invitation or code.'); return; }
    let token: string = crypto.randomUUID();
    try {
      token = sessionStorage.getItem(`hexfield-seat-${id}`) || token;
      sessionStorage.setItem(`hexfield-seat-${id}`, token);
    } catch { /* Reconnection identity is optional if storage is blocked. */ }
    const peer = makePeer('guest');
    peer.on('open', () => {
      if (peerRef.current !== peer) return;
      // PeerJS's JSON transport rejects messages >=16 KB. Binary transport
      // chunks and reassembles world snapshots as cities and armies grow.
      attach(peer.connect(id, { reliable: true, serialization: 'binary', metadata: { token } }), peer, false);
      timeout.current = setTimeout(() => {
        if (peerRef.current === peer && !connections.current.get(0)?.channel.open) {
          setStatus('error'); setMessage('Connection timed out. Keep the host online; a TURN relay may be needed on restrictive networks.');
        }
      }, 25000);
    });
  }, [attach, makePeer]);

  const send = useCallback((payload: RoomMessage, targetSeat?: number): boolean => {
    const targets = roleRef.current === 'guest' ? [connections.current.get(0)]
      : targetSeat !== undefined ? [connections.current.get(targetSeat)] : [...connections.current.values()];
    let sent = false;
    for (const target of targets) if (target?.channel.open) { target.channel.send(payload); sent = true; }
    return sent;
  }, []);
  const setHandler = useCallback((next: (payload: RoomMessage, fromSeat: number) => void) => { handler.current = next; }, []);
  return { role, status, message, invite, localSeat, members, capacity, create, join, send, close, setHandler };
}
