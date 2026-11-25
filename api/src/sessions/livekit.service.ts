import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AccessToken, RoomAgentDispatch, RoomConfiguration, RoomServiceClient } from 'livekit-server-sdk';
import type { Env } from '../config/env.js';

export interface RoomCredentials {
  serverUrl: string;
  roomName: string;
  token: string;
}

@Injectable()
export class LiveKitService {
  private readonly logger = new Logger(LiveKitService.name);
  private readonly rooms: RoomServiceClient;

  constructor(private readonly config: ConfigService<Env, true>) {
    this.rooms = new RoomServiceClient(
      this.httpUrl(),
      this.config.get('LIVEKIT_API_KEY', { infer: true }),
      this.config.get('LIVEKIT_API_SECRET', { infer: true }),
    );
  }

  /**
   * Issues a participant token whose room configuration dispatches the
   * interviewer agent on join. The agent learns which session to run from
   * the dispatch metadata, so no extra signalling is needed.
   */
  async createCandidateToken(input: {
    roomName: string;
    sessionId: string;
    userId: string;
    userName: string;
  }): Promise<RoomCredentials> {
    const token = new AccessToken(
      this.config.get('LIVEKIT_API_KEY', { infer: true }),
      this.config.get('LIVEKIT_API_SECRET', { infer: true }),
      { identity: `candidate-${input.userId}`, name: input.userName, ttl: '2h' },
    );
    token.addGrant({
      roomJoin: true,
      room: input.roomName,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
    });
    token.roomConfig = new RoomConfiguration({
      emptyTimeout: 120,
      departureTimeout: 30,
      agents: [
        new RoomAgentDispatch({
          agentName: this.config.get('LIVEKIT_AGENT_NAME', { infer: true }),
          metadata: JSON.stringify({ sessionId: input.sessionId }),
        }),
      ],
    });

    return {
      serverUrl: this.config.get('LIVEKIT_URL', { infer: true }),
      roomName: input.roomName,
      token: await token.toJwt(),
    };
  }

  /** Closing the room ends the agent job, which then posts the transcript. */
  async closeRoom(roomName: string): Promise<void> {
    try {
      await this.rooms.deleteRoom(roomName);
    } catch (error) {
      // Already gone is fine: the room may have emptied out on its own.
      this.logger.debug(`deleteRoom(${roomName}): ${String(error)}`);
    }
  }

  private httpUrl() {
    return this.config.get('LIVEKIT_URL', { infer: true }).replace(/^ws/, 'http');
  }
}
