import React, { useState, useEffect, useRef, useCallback } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

/**
 * MultiplayerPresence — WebRTC-based shared reef exploration.
 *
 * Architecture:
 * - Uses a simple signaling server (or Supabase Realtime as you already have it)
 * - Each peer broadcasts: position, rotation, inspected species
 * - Remote peers rendered as diver avatars (simple glowing orbs for Phase 3 MVP)
 *
 * This is a LOCAL-FIRST implementation using BroadcastChannel for same-device
 * testing, with a WebSocket/Supabase upgrade path for real multiplayer.
 */

const BROADCAST_CHANNEL = "aquadex-reef-presence";
const UPDATE_INTERVAL_MS = 100; // 10 FPS broadcast rate

// Generate a stable peer ID for this session
const PEER_ID = `peer_${Math.random().toString(36).slice(2, 10)}`;

export function MultiplayerPresence({ localPosition, localRotation, inspectedSpecies }) {
  const [peers, setPeers] = useState(new Map());
  const channelRef = useRef(null);
  const lastBroadcastRef = useRef(0);

  // Initialize BroadcastChannel (same-origin, multi-tab)
  useEffect(() => {
    const channel = new BroadcastChannel(BROADCAST_CHANNEL);
    channelRef.current = channel;

    channel.onmessage = (event) => {
      const data = event.data;
      if (!data || data.peerId === PEER_ID) return;

      setPeers((prev) => {
        const next = new Map(prev);
        next.set(data.peerId, {
          ...data,
          lastSeen: Date.now()
        });
        return next;
      });
    };

    // Announce arrival
    channel.postMessage({ peerId: PEER_ID, type: "join" });

    // Cleanup: announce departure
    return () => {
      channel.postMessage({ peerId: PEER_ID, type: "leave" });
      channel.close();
    };
  }, []);

  // Broadcast local state periodically
  useEffect(() => {
    const interval = setInterval(() => {
      if (!channelRef.current) return;
      channelRef.current.postMessage({
        peerId: PEER_ID,
        type: "update",
        position: localPosition,
        rotation: localRotation,
        inspectedSpecies: inspectedSpecies?.commonName || null,
        timestamp: Date.now()
      });
    }, UPDATE_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [localPosition, localRotation, inspectedSpecies]);

  // Prune stale peers (no update in 5 seconds)
  useEffect(() => {
    const pruner = setInterval(() => {
      setPeers((prev) => {
        const next = new Map(prev);
        const now = Date.now();
        for (const [id, peer] of next) {
          if (peer.type === "leave" || now - peer.lastSeen > 5000) {
            next.delete(id);
          }
        }
        return next;
      });
    }, 2000);

    return () => clearInterval(pruner);
  }, []);

  return (
    <group>
      {Array.from(peers.values())
        .filter((p) => p.type === "update" && p.position)
        .map((peer) => (
          <PeerAvatar
            key={peer.peerId}
            position={peer.position}
            rotation={peer.rotation}
            label={peer.inspectedSpecies}
          />
        ))}
    </group>
  );
}

/**
 * PeerAvatar — Remote peer rendered as a glowing diver orb with label.
 */
function PeerAvatar({ position, rotation, label }) {
  const meshRef = useRef();
  const targetPos = useRef(new THREE.Vector3(...(position || [0, 2, 0])));

  // Smooth position interpolation
  useEffect(() => {
    if (position) {
      targetPos.current.set(position[0] || 0, position[1] || 2, position[2] || 0);
    }
  }, [position]);

  useFrame(() => {
    if (!meshRef.current) return;
    // Lerp toward target
    meshRef.current.position.lerp(targetPos.current, 0.1);
  });

  return (
    <group ref={meshRef}>
      {/* Diver avatar: glowing sphere */}
      <mesh>
        <sphereGeometry args={[0.2, 16, 12]} />
        <meshBasicMaterial
          color="#8b5cf6"
          transparent
          opacity={0.7}
        />
      </mesh>
      {/* Outer glow ring */}
      <mesh>
        <sphereGeometry args={[0.3, 16, 12]} />
        <meshBasicMaterial
          color="#8b5cf6"
          transparent
          opacity={0.15}
          wireframe
        />
      </mesh>
      {/* Viewing indicator: small line showing look direction */}
      {rotation && (
        <mesh position={[0, 0, -0.4]} scale={[0.05, 0.05, 0.3]}>
          <boxGeometry />
          <meshBasicMaterial color="#c4b5fd" transparent opacity={0.5} />
        </mesh>
      )}
    </group>
  );
}

/**
 * useLocalPeerState — Hook to track and broadcast local player state.
 * Call from the main scene to get the data needed for MultiplayerPresence.
 */
export function useLocalPeerState(cameraRef) {
  const [localPosition, setLocalPosition] = useState([0, 2, 12]);
  const [localRotation, setLocalRotation] = useState([0, 0, 0]);

  useFrame(({ camera }) => {
    setLocalPosition([
      Math.round(camera.position.x * 100) / 100,
      Math.round(camera.position.y * 100) / 100,
      Math.round(camera.position.z * 100) / 100
    ]);
    setLocalRotation([
      Math.round(camera.rotation.x * 100) / 100,
      Math.round(camera.rotation.y * 100) / 100,
      Math.round(camera.rotation.z * 100) / 100
    ]);
  });

  return { localPosition, localRotation };
}
